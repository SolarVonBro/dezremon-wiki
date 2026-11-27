<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { ensurePf2eSpells, usePf2eCatalog } from '@/data/pf2eCatalog'
import { updatePf2eCharacter, watchPf2eCharacters } from '@/data/pf2eCharacters'
import { copyText } from '@/data/statCalc'
import { errorText, randomId } from '@/data/util'
import type { Pf2eCharacter } from '@/model/pf2e'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Pf2eSpellCard from '@/components/pf2e/Pf2eSpellCard.vue'
import { toast } from '@/components/common/toast'

const session = useSession()
const route = useRoute()
const router = useRouter()
const catalog = usePf2eCatalog()

const id = computed(() => String(route.params.id ?? ''))
const spell = computed(() => catalog.spellsById.value.get(id.value) ?? null)
const ready = ref(false)
const chars = ref<Pf2eCharacter[]>([])
let stopChars: (() => void) | null = null

onMounted(async () => {
  try { await ensurePf2eSpells() } finally { ready.value = true }
})

watch(() => [session.ready, session.user?.uid] as const, ([r, u]) => {
  stopChars?.()
  stopChars = null
  if (r && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  stopChars = watchPf2eCharacters(u, (rows) => { chars.value = rows })
}, { immediate: true })
onBeforeUnmount(() => stopChars?.())

watch([spell, catalog.lang], ([s, l]) => {
  if (s) document.title = `${l === 'ru' ? s.ru : s.en} — PF2e | Вики сеттинга`
}, { immediate: true })

// Quick add to character modal
const addOpen = ref(false)
const pickCharId = ref('')
const pickListId = ref('')
const pickRank = ref(1)
const pickedChar = computed(() => chars.value.find((c) => c.id === pickCharId.value) ?? null)

function openAdd() {
  if (!spell.value) return
  if (!chars.value.length) { toast.info('Сначала создайте персонажа PF2e'); return }
  pickCharId.value = chars.value[0].id
  pickListId.value = chars.value[0].spellLists[0]?.id ?? ''
  pickRank.value = spell.value.cat === 'cantrip' ? 0 : spell.value.baseRank
  addOpen.value = true
}
watch(pickCharId, () => {
  if (pickedChar.value) pickListId.value = pickedChar.value.spellLists[0]?.id ?? ''
})

async function confirmAdd() {
  const uid = session.user?.uid
  const c = pickedChar.value
  const sp = spell.value
  if (!uid || !c || !sp) return
  const lists = c.spellLists.map((l) => ({ ...l, spells: [...l.spells] }))
  let target = lists.find((l) => l.id === pickListId.value)
  if (!target) {
    target = {
      id: randomId(10),
      name: sp.cat === 'focus' ? 'Фокусные заклинания' : sp.cat === 'ritual' ? 'Ритуалы' : 'Основной список',
      castingType: sp.cat === 'focus' ? 'focus' : sp.cat === 'ritual' ? 'ritual' : 'prepared',
      tradition: sp.traditions[0] ?? 'arcane',
      keyAttr: 'int',
      keyMod: 4,
      proficiency: 1,
      bonusAttack: 0,
      bonusDc: 0,
      slotsMax: { 1: 2 },
      slotsUsed: {},
      focusMax: sp.cat === 'focus' ? 1 : undefined,
      focusCurrent: sp.cat === 'focus' ? 1 : undefined,
      spells: [],
    }
    lists.push(target)
  }
  target.spells.push({
    id: randomId(10),
    spellId: sp.id,
    rank: pickRank.value,
    preparedCount: target.castingType === 'prepared' ? 1 : undefined,
    expendedCount: 0,
    usesMax: target.castingType === 'innate' ? 1 : undefined,
    usesLeft: target.castingType === 'innate' ? 1 : undefined,
  })
  try {
    await updatePf2eCharacter(uid, c.id, { spellLists: lists })
    toast.success(`Добавлено персонажу ${c.name}`)
    addOpen.value = false
  } catch (e) { toast.error(errorText(e)) }
}

async function copyLink() {
  if (await copyText(location.href)) toast.success('Ссылка скопирована')
}
</script>

<template>
  <div class="page">
    <div class="crumbs-row row gap-sm wrap">
      <RouterLink :to="{ name: 'tools' }" class="back-link">Инструменты</RouterLink>
      <span class="faint">/</span>
      <RouterLink :to="{ name: 'toolPf2e' }" class="back-link">Pathfinder 2e</RouterLink>
      <span class="faint">/</span>
      <RouterLink :to="{ name: 'toolPf2e', params: { tab: 'spells' } }" class="back-link">Заклинания</RouterLink>
    </div>

    <div v-if="!ready || catalog.loadingSpells.value" class="card empty">
      <Icon name="refresh-cw" class="spin" :size="24" />
    </div>
    <div v-else-if="!spell" class="card empty">
      <p>Заклинание не найдено.</p>
      <RouterLink class="btn btn-primary" :to="{ name: 'toolPf2e', params: { tab: 'spells' } }">К библиотеке заклинаний</RouterLink>
    </div>
    <section v-else class="card card-pad">
      <Pf2eSpellCard :spell="spell" :meta="catalog.meta.value" :lang="catalog.lang.value" standalone>
        <template #actions>
          <button type="button" class="btn btn-sm" @click="copyLink"><Icon name="link" :size="14" /> Ссылка</button>
          <button v-if="chars.length" type="button" class="btn btn-sm btn-primary" @click="openAdd"><Icon name="plus" :size="14" /> Персонажу…</button>
        </template>
      </Pf2eSpellCard>
    </section>

    <Modal v-if="addOpen && spell" title="Добавить заклинание персонажу" width="460px" @close="addOpen = false">
      <div class="stack">
        <div class="small"><b>{{ catalog.lang.value === 'ru' ? spell.ru : spell.en }}</b></div>
        <label class="field">
          <span>Персонаж</span>
          <select v-model="pickCharId" class="input">
            <option v-for="c in chars" :key="c.id" :value="c.id">{{ c.name }} (Ур. {{ c.level }})</option>
          </select>
        </label>
        <label class="field">
          <span>Список заклинаний</span>
          <select v-model="pickListId" class="input">
            <option v-if="!pickedChar?.spellLists.length" value="">— создать автоматически —</option>
            <option v-for="l in pickedChar?.spellLists ?? []" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Круг (0 = заговор)</span>
          <input v-model.number="pickRank" type="number" min="0" max="10" class="input" />
        </label>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="addOpen = false">Отмена</button>
        <button type="button" class="btn btn-primary" @click="confirmAdd"><Icon name="plus" :size="14" /> Добавить</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.page { max-width: 920px; margin: 0 auto; padding: 18px 24px 60px; }
.crumbs-row { margin-bottom: 12px; font-size: 13.5px; }
.back-link { color: var(--text-muted); }
.back-link:hover { color: var(--accent); text-decoration: none; }
@media (max-width: 720px) { .page { padding: 14px 12px 50px; } }
</style>
