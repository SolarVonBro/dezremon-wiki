<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { ensurePf2eItems, usePf2eCatalog } from '@/data/pf2eCatalog'
import { updatePf2eCharacter, watchPf2eCharacters } from '@/data/pf2eCharacters'
import { usePf2eWorkspace } from '@/data/pf2eWorkspace'
import { copyText } from '@/data/statCalc'
import { errorText, randomId } from '@/data/util'
import type { Pf2eCharacter } from '@/model/pf2e'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Pf2eTopNav from '@/components/pf2e/Pf2eTopNav.vue'
import Pf2eItemCard from '@/components/pf2e/Pf2eItemCard.vue'
import { toast } from '@/components/common/toast'

const session = useSession()
const route = useRoute()
const router = useRouter()
const catalog = usePf2eCatalog()
const ws = usePf2eWorkspace()

const id = computed(() => String(route.params.id ?? ''))
const item = computed(() => catalog.itemsById.value.get(id.value) ?? null)
const ready = ref(false)
const chars = ref<Pf2eCharacter[]>([])
let stopChars: (() => void) | null = null

onMounted(async () => {
  try { await ensurePf2eItems() } finally { ready.value = true }
})

watch(() => [session.ready, session.user?.uid] as const, ([r, u]) => {
  stopChars?.()
  stopChars = null
  if (r && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  stopChars = watchPf2eCharacters(u, (rows) => { chars.value = rows })
}, { immediate: true })
onBeforeUnmount(() => stopChars?.())

watch([item, catalog.lang], ([it, l]) => {
  if (it) document.title = `${l === 'ru' ? it.ru : it.en} — PF2e | Вики сеттинга`
}, { immediate: true })

const activeChar = computed(() => chars.value.find((c) => c.id === ws.activeCharId.value) ?? null)

const addOpen = ref(false)
const asContainer = ref(false)
const pickCharId = ref('')
const pickContainerId = ref('')
const pickedChar = computed(() => chars.value.find((c) => c.id === pickCharId.value) ?? null)

function openAdd() {
  if (!item.value) return
  if (!chars.value.length) { toast.info('Сначала создайте персонажа PF2e'); return }
  const defChar = activeChar.value ?? chars.value[0]
  pickCharId.value = defChar.id
  pickContainerId.value = (ws.targetContainerId.value && defChar.containers.some((c) => c.id === ws.targetContainerId.value))
    ? ws.targetContainerId.value
    : ''
  asContainer.value = item.value.type === 'backpack'
  addOpen.value = true
}
watch(pickCharId, () => { pickContainerId.value = '' })

async function confirmAdd() {
  const uid = session.user?.uid
  const c = pickedChar.value
  const it = item.value
  if (!uid || !c || !it) return
  try {
    if (asContainer.value) {
      const containers = [
        ...c.containers,
        {
          id: randomId(10),
          itemId: it.id,
          name: catalog.lang.value === 'ru' ? it.ru : it.en,
          carryType: (it.usage.startsWith('worn') ? 'worn' : 'held') as 'worn' | 'held',
          parentContainerId: null,
          bulk: it.bulk,
          bulkHeld: it.bulkHeld,
          capacity: it.capacity,
          ignored: it.ignored,
          extradimensional: it.extradimensional,
          invested: false,
          priceCp: it.priceCp,
          order: c.containers.length,
        },
      ]
      await updatePf2eCharacter(uid, c.id, { containers })
      toast.success(`Контейнер добавлен персонажу ${c.name}`)
    } else {
      const inv = [
        ...c.inventory,
        {
          id: randomId(10),
          itemId: it.id,
          name: '',
          quantity: it.bulkPer > 1 && it.bulkPer < 1000 ? it.bulkPer : 1,
          carryType: (pickContainerId.value ? 'stowed' : it.usageGroup === 'worn' || it.usageGroup === 'worn-slot' ? 'worn' : 'held') as 'worn' | 'held' | 'stowed',
          containerId: pickContainerId.value || null,
          group: '',
          invested: false,
          notes: '',
          order: c.inventory.length,
        },
      ]
      await updatePf2eCharacter(uid, c.id, { inventory: inv })
      toast.success(`Предмет добавлен персонажу ${c.name}`)
    }
    ws.setActivePf2eChar(c.id)
    addOpen.value = false
  } catch (e) { toast.error(errorText(e)) }
}

async function copyLink() {
  if (await copyText(location.href)) toast.success('Ссылка скопирована')
}
</script>

<template>
  <div class="page">
    <Pf2eTopNav active="items" :chars="chars" />

    <div class="sub-row">
      <RouterLink :to="{ name: 'toolPf2e', params: { tab: 'items' } }" class="back-link">
        <Icon name="arrow-left" :size="14" /> К библиотеке предметов
      </RouterLink>
    </div>

    <div v-if="!ready || catalog.loadingItems.value" class="card empty">
      <Icon name="refresh-cw" class="spin" :size="24" />
    </div>
    <div v-else-if="!item" class="card empty">
      <p>Предмет не найден.</p>
      <RouterLink class="btn btn-primary" :to="{ name: 'toolPf2e', params: { tab: 'items' } }">К библиотеке предметов</RouterLink>
    </div>
    <section v-else class="card card-pad">
      <Pf2eItemCard :item="item" :meta="catalog.meta.value" :lang="catalog.lang.value" :actor-level="activeChar?.level" :str-mod="activeChar?.strMod" standalone>
        <template #actions>
          <button type="button" class="btn btn-sm" @click="copyLink"><Icon name="link" :size="14" /> Ссылка</button>
          <button v-if="chars.length" type="button" class="btn btn-sm btn-primary" @click="openAdd">
            <Icon name="plus" :size="14" /> {{ activeChar ? `Персонажу «${activeChar.name}»…` : 'Персонажу…' }}
          </button>
        </template>
      </Pf2eItemCard>
    </section>

    <Modal v-if="addOpen && item" title="Добавить предмет персонажу" width="460px" @close="addOpen = false">
      <div class="stack">
        <div class="small"><b>{{ catalog.lang.value === 'ru' ? item.ru : item.en }}</b></div>
        <label class="field">
          <span>Персонаж</span>
          <select v-model="pickCharId" class="input">
            <option v-for="c in chars" :key="c.id" :value="c.id">{{ c.name }} (Ур. {{ c.level }})</option>
          </select>
        </label>
        <label v-if="!asContainer && pickedChar?.containers.length" class="field">
          <span>Контейнер</span>
          <select v-model="pickContainerId" class="input">
            <option value="">— вне контейнера —</option>
            <option v-for="ct in pickedChar.containers" :key="ct.id" :value="ct.id">{{ ct.name }}</option>
          </select>
        </label>
        <label v-if="item.type === 'backpack' || item.capacity > 0" class="check small">
          <input v-model="asContainer" type="checkbox" /> Добавить как контейнер
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
.page { max-width: 1020px; margin: 0 auto; padding: 16px 24px 60px; }
.sub-row { margin-bottom: 10px; }
.back-link { display: inline-flex; align-items: center; gap: 5px; font-size: 13.5px; color: var(--text-muted); }
.back-link:hover { color: var(--accent); text-decoration: none; }
@media (max-width: 720px) { .page { padding: 14px 12px 50px; } }
</style>
