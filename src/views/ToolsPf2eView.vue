<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import {
  createPf2eCharacter, deletePf2eCharacter, exportPf2eCharacters, importPf2eCharacters,
  updatePf2eCharacter, watchPf2eCharacters,
} from '@/data/pf2eCharacters'
import { ensurePf2eItems, usePf2eCatalog } from '@/data/pf2eCatalog'
import { computeCharacterBulk, formatLight } from '@/data/pf2eBulk'
import { fileToSource, renderAvatar } from '@/data/avatar'
import { errorText, plural, randomId, relativeTime } from '@/data/util'
import type { ImageCrop } from '@/data/crop'
import type { Pf2eCharacter, Pf2eItemIndex, Pf2eSpellIndex } from '@/model/pf2e'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import ImageCropModal from '@/components/entity/ImageCropModal.vue'
import Pf2eSpellBrowser from '@/components/pf2e/Pf2eSpellBrowser.vue'
import Pf2eItemBrowser from '@/components/pf2e/Pf2eItemBrowser.vue'
import { toast } from '@/components/common/toast'

const session = useSession()
const route = useRoute()
const router = useRouter()
const catalog = usePf2eCatalog()

type Tab = 'chars' | 'spells' | 'items'
const tab = computed<Tab>(() => {
  const t = String(route.params.tab ?? '')
  if (t === 'spells') return 'spells'
  if (t === 'items') return 'items'
  return 'chars'
})
function setTab(t: Tab) {
  void router.replace({ name: 'toolPf2e', params: { tab: t === 'chars' ? undefined : t } })
}

const chars = ref<Pf2eCharacter[]>([])
const loading = ref(true)
let stopChars: (() => void) | null = null

watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stopChars?.()
  stopChars = null
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  loading.value = true
  stopChars = watchPf2eCharacters(
    u,
    (rows) => {
      chars.value = rows
      loading.value = false
      if (rows.some((c) => c.inventory.length > 0)) void ensurePf2eItems()
    },
    (e) => { loading.value = false; toast.error('Не удалось загрузить персонажей: ' + errorText(e)) },
  )
}, { immediate: true })
onBeforeUnmount(() => stopChars?.())

// Create character modal
const creating = ref(false)
const busy = ref(false)
const form = ref({ name: '', description: '', level: 1, strMod: 0, portrait: null as string | null, portraitSource: null as string | null, portraitCrop: null as ImageCrop | null })
const portraitInput = ref<HTMLInputElement | null>(null)
const framing = ref<{ source: string; crop: ImageCrop | null } | null>(null)

function openCreate() {
  form.value = { name: '', description: '', level: 1, strMod: 0, portrait: null, portraitSource: null, portraitCrop: null }
  creating.value = true
}

async function onPortraitFile(e: Event) {
  const inp = e.target as HTMLInputElement
  const f = inp.files?.[0]
  inp.value = ''
  if (!f) return
  try {
    framing.value = { source: await fileToSource(f), crop: null }
  } catch (err: any) { toast.error(err?.message ?? String(err)) }
}

async function onCropSave(crop: ImageCrop | null) {
  if (!framing.value) return
  try {
    form.value.portrait = await renderAvatar(framing.value.source, crop, 192)
    form.value.portraitSource = framing.value.source
    form.value.portraitCrop = crop
  } catch (err: any) { toast.error(err?.message ?? String(err)) }
  finally { framing.value = null }
}

async function submitCreate() {
  if (!session.user?.uid || !form.value.name.trim()) return
  busy.value = true
  try {
    const cid = await createPf2eCharacter(session.user.uid, {
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      level: form.value.level,
      strMod: form.value.strMod,
      portrait: form.value.portrait,
      portraitSource: form.value.portraitSource,
      portraitCrop: form.value.portraitCrop,
    })
    creating.value = false
    void router.push({ name: 'toolPf2eChar', params: { cid } })
  } catch (e) { toast.error('Не удалось создать персонажа: ' + errorText(e)) }
  finally { busy.value = false }
}

async function removeChar(c: Pf2eCharacter) {
  if (!session.user?.uid) return
  if (!confirm(`Удалить персонажа «${c.name}» со всеми его списками заклинаний и инвентарём?`)) return
  try {
    await deletePf2eCharacter(session.user.uid, c.id)
    toast.success('Персонаж удалён')
  } catch (e) { toast.error('Не удалось удалить: ' + errorText(e)) }
}

// Import JSON
const importInput = ref<HTMLInputElement | null>(null)
async function onImport(e: Event) {
  const inp = e.target as HTMLInputElement
  const f = inp.files?.[0]
  inp.value = ''
  if (!f || !session.user?.uid) return
  try {
    const n = await importPf2eCharacters(session.user.uid, f)
    toast.success(`Импортировано персонажей: ${n}`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Не удалось импортировать файл')
  }
}

// Quick add from standalone library tabs to a character
const addSpellTarget = ref<Pf2eSpellIndex | null>(null)
const addItemTarget = ref<{ item: Pf2eItemIndex; asContainer: boolean } | null>(null)
const pickCharId = ref('')
const pickListId = ref('')
const pickRank = ref(1)
const pickContainerId = ref('')

const pickedChar = computed(() => chars.value.find((c) => c.id === pickCharId.value) ?? null)

function startAddSpell(sp: Pf2eSpellIndex) {
  if (!chars.value.length) {
    toast.info('Сначала создайте персонажа во вкладке «Персонажи»')
    return
  }
  addSpellTarget.value = sp
  pickCharId.value = chars.value[0].id
  pickListId.value = chars.value[0].spellLists[0]?.id ?? ''
  pickRank.value = sp.cat === 'cantrip' ? 0 : sp.baseRank
}

watch(pickCharId, () => {
  const c = pickedChar.value
  if (!c) return
  if (addSpellTarget.value) pickListId.value = c.spellLists[0]?.id ?? ''
  if (addItemTarget.value) pickContainerId.value = ''
})

async function confirmAddSpell() {
  const uid = session.user?.uid
  const c = pickedChar.value
  const sp = addSpellTarget.value
  if (!uid || !c || !sp) return
  const lists = c.spellLists.map((l) => ({ ...l, spells: [...l.spells] }))
  let target = lists.find((l) => l.id === pickListId.value)
  if (!target) {
    // Auto-create a spell list if the character has none yet
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
    toast.success(`«${catalog.lang.value === 'ru' ? sp.ru : sp.en}» добавлено персонажу ${c.name}`)
    addSpellTarget.value = null
  } catch (e) { toast.error(errorText(e)) }
}

function startAddItem(item: Pf2eItemIndex, asContainer = false) {
  if (!chars.value.length) {
    toast.info('Сначала создайте персонажа во вкладке «Персонажи»')
    return
  }
  addItemTarget.value = { item, asContainer }
  pickCharId.value = chars.value[0].id
  pickContainerId.value = ''
}

async function confirmAddItem() {
  const uid = session.user?.uid
  const c = pickedChar.value
  const req = addItemTarget.value
  if (!uid || !c || !req) return
  try {
    if (req.asContainer) {
      const containers = [
        ...c.containers,
        {
          id: randomId(10),
          itemId: req.item.id,
          name: catalog.lang.value === 'ru' ? req.item.ru : req.item.en,
          carryType: (req.item.usage.startsWith('worn') ? 'worn' : 'held') as 'worn' | 'held',
          parentContainerId: null,
          bulk: req.item.bulk,
          bulkHeld: req.item.bulkHeld,
          capacity: req.item.capacity,
          ignored: req.item.ignored,
          extradimensional: req.item.extradimensional,
          invested: false,
          priceCp: req.item.priceCp,
          order: c.containers.length,
        },
      ]
      await updatePf2eCharacter(uid, c.id, { containers })
      toast.success(`Контейнер «${req.item.ru}» добавлен персонажу ${c.name}`)
    } else {
      const inv = [
        ...c.inventory,
        {
          id: randomId(10),
          itemId: req.item.id,
          name: '',
          quantity: req.item.bulkPer > 1 && req.item.bulkPer < 1000 ? req.item.bulkPer : 1,
          carryType: (pickContainerId.value ? 'stowed' : req.item.usageGroup === 'worn' || req.item.usageGroup === 'worn-slot' ? 'worn' : 'held') as 'worn' | 'held' | 'stowed',
          containerId: pickContainerId.value || null,
          group: '',
          invested: false,
          notes: '',
          order: c.inventory.length,
        },
      ]
      await updatePf2eCharacter(uid, c.id, { inventory: inv })
      toast.success(`«${catalog.lang.value === 'ru' ? req.item.ru : req.item.en}» добавлено персонажу ${c.name}`)
    }
    addItemTarget.value = null
  } catch (e) { toast.error(errorText(e)) }
}

function charBulkText(c: Pf2eCharacter): string {
  const b = computeCharacterBulk(c, catalog.itemsById.value)
  return `${formatLight(b.totalLight)} / ${b.encumberedAt} (${b.maxBulk})`
}
function charSpellsCount(c: Pf2eCharacter): number {
  return c.spellLists.reduce((s, l) => s + l.spells.length, 0)
}
</script>

<template>
  <div class="page">
    <div class="crumbs-row">
      <RouterLink :to="{ name: 'tools' }" class="back-link"><Icon name="arrow-left" :size="15" /> Инструменты</RouterLink>
    </div>

    <div class="row gap wrap" style="margin-bottom: 12px">
      <div class="grow">
        <h1 style="margin: 0">Pathfinder 2e</h1>
        <p class="muted small" style="margin: 2px 0 0">Персонажи, списки заклинаний, инвентарь с контейнерами и полные актуальные библиотеки RU / EN</p>
      </div>
      <button v-if="tab === 'chars'" type="button" class="btn btn-primary" @click="openCreate">
        <Icon name="plus" :size="16" /> Новый персонаж
      </button>
    </div>

    <div class="tabs">
      <button type="button" class="tab" :class="{ on: tab === 'chars' }" @click="setTab('chars')">
        <Icon name="users" :size="16" /> Персонажи <span class="count">{{ chars.length }}</span>
      </button>
      <button type="button" class="tab" :class="{ on: tab === 'spells' }" @click="setTab('spells')">
        <Icon name="sparkles" :size="16" /> Заклинания
        <span v-if="catalog.meta.value" class="count">{{ catalog.meta.value.spellCount }}</span>
      </button>
      <button type="button" class="tab" :class="{ on: tab === 'items' }" @click="setTab('items')">
        <Icon name="backpack" :size="16" /> Предметы
        <span v-if="catalog.meta.value" class="count">{{ catalog.meta.value.itemCount }}</span>
      </button>
    </div>

    <!-- TAB: CHARACTERS -->
    <template v-if="tab === 'chars'">
      <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
      <div v-else-if="!chars.length" class="card empty">
        <Icon name="user-round" :size="36" />
        <p>У вас пока нет персонажей PF2e. Создайте первого, чтобы собирать списки заклинаний и инвентарь с контейнерами.</p>
        <div class="row gap-sm" style="justify-content: center">
          <button type="button" class="btn btn-primary" @click="openCreate"><Icon name="plus" :size="15" /> Создать персонажа</button>
          <button type="button" class="btn" @click="importInput?.click()"><Icon name="upload" :size="15" /> Импорт JSON</button>
        </div>
      </div>

      <template v-else>
        <div class="char-grid">
          <div v-for="c in chars" :key="c.id" class="char-card">
            <RouterLink class="cc-main" :to="{ name: 'toolPf2eChar', params: { cid: c.id } }">
              <div class="cc-ava">
                <img v-if="c.portrait" :src="c.portrait" alt="" />
                <Icon v-else name="user" :size="28" />
              </div>
              <div class="grow" style="min-width: 0">
                <div class="row gap-sm">
                  <b class="cc-name ellipsis">{{ c.name }}</b>
                  <span class="badge">Ур. {{ c.level }}</span>
                </div>
                <p v-if="c.description" class="muted small cc-desc">{{ c.description }}</p>
                <div class="row gap-sm wrap faint small" style="margin-top: 6px">
                  <span><Icon name="sparkles" :size="12" /> {{ c.spellLists.length }} {{ plural(c.spellLists.length, 'список', 'списка', 'списков') }} ({{ charSpellsCount(c) }})</span>
                  <span>·</span>
                  <span><Icon name="backpack" :size="12" /> {{ c.inventory.length }} {{ plural(c.inventory.length, 'предмет', 'предмета', 'предметов') }}, {{ c.containers.length }} конт.</span>
                  <span>·</span>
                  <span><Icon name="weight" :size="12" /> {{ charBulkText(c) }}</span>
                </div>
              </div>
            </RouterLink>
            <div class="cc-foot row gap-sm">
              <span class="faint small grow">{{ relativeTime(c.updatedAt) }}</span>
              <button type="button" class="icon-btn" title="Экспорт персонажа" @click="exportPf2eCharacters([c], `pf2e-${c.name}.json`)"><Icon name="download" :size="14" /></button>
              <button type="button" class="icon-btn danger" title="Удалить персонажа" @click="removeChar(c)"><Icon name="trash2" :size="14" /></button>
            </div>
          </div>
        </div>

        <div class="row gap-sm wrap" style="margin-top: 20px">
          <button type="button" class="btn btn-sm" @click="exportPf2eCharacters(chars)"><Icon name="download" :size="14" /> Экспорт всех (JSON)</button>
          <button type="button" class="btn btn-sm" @click="importInput?.click()"><Icon name="upload" :size="14" /> Импорт из JSON</button>
        </div>
      </template>

      <input ref="importInput" type="file" accept=".json,application/json" hidden @change="onImport" />
    </template>

    <!-- TAB: SPELLS LIBRARY -->
    <Pf2eSpellBrowser
      v-else-if="tab === 'spells'"
      :pick-mode="chars.length > 0"
      pick-label="Добавить персонажу…"
      @pick="startAddSpell"
    />

    <!-- TAB: ITEMS LIBRARY -->
    <Pf2eItemBrowser
      v-else
      :pick-mode="chars.length > 0"
      pick-label="Добавить персонажу…"
      @pick="startAddItem"
    />

    <!-- CREATE CHARACTER MODAL -->
    <Modal v-if="creating" title="Новый персонаж PF2e" width="540px" @close="creating = false">
      <form class="stack" @submit.prevent="submitCreate">
        <div class="row gap">
          <button type="button" class="port-pick" title="Загрузить портрет" @click="portraitInput?.click()">
            <img v-if="form.portrait" :src="form.portrait" alt="" />
            <Icon v-else name="camera" :size="24" />
          </button>
          <div class="stack-sm grow">
            <label class="field">
              <span>Имя персонажа *</span>
              <input v-model="form.name" type="text" class="input" maxlength="80" placeholder="Например: Лиара из Абсалома" autofocus />
            </label>
            <div class="row gap-sm">
              <button type="button" class="btn btn-sm" @click="portraitInput?.click()"><Icon name="upload" :size="13" /> {{ form.portrait ? 'Другой портрет' : 'Загрузить портрет' }}</button>
              <button v-if="form.portrait" type="button" class="btn btn-sm btn-ghost" @click="form.portrait = null; form.portraitSource = null">Убрать</button>
            </div>
          </div>
          <input ref="portraitInput" type="file" accept="image/*" hidden @change="onPortraitFile" />
        </div>

        <div class="row gap">
          <label class="field grow">
            <span>Уровень (1–20)</span>
            <input v-model.number="form.level" type="number" min="1" max="20" class="input" />
          </label>
          <label class="field grow">
            <span>Модификатор Силы (для массы)</span>
            <input v-model.number="form.strMod" type="number" min="-5" max="10" class="input" />
          </label>
        </div>

        <label class="field">
          <span>Описание / заметки</span>
          <textarea v-model="form.description" class="input" rows="3" maxlength="2000" placeholder="Класс, родословная, заметки о персонаже…" />
        </label>

        <div class="row gap-sm" style="justify-content: flex-end">
          <button type="button" class="btn" @click="creating = false">Отмена</button>
          <button type="submit" class="btn btn-primary" :disabled="busy || !form.name.trim()"><Icon name="plus" :size="15" /> Создать</button>
        </div>
      </form>
    </Modal>

    <ImageCropModal
      v-if="framing"
      :src="framing.source"
      :initial="framing.crop"
      kind="avatar"
      title="Кадр портрета"
      @save="onCropSave"
      @close="framing = null"
    />

    <!-- QUICK ADD SPELL TO CHARACTER MODAL -->
    <Modal v-if="addSpellTarget" title="Добавить заклинание персонажу" width="460px" @close="addSpellTarget = null">
      <div class="stack">
        <div class="small"><b>{{ catalog.lang.value === 'ru' ? addSpellTarget.ru : addSpellTarget.en }}</b></div>
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
        <button type="button" class="btn" @click="addSpellTarget = null">Отмена</button>
        <button type="button" class="btn btn-primary" @click="confirmAddSpell"><Icon name="plus" :size="14" /> Добавить</button>
      </template>
    </Modal>

    <!-- QUICK ADD ITEM TO CHARACTER MODAL -->
    <Modal v-if="addItemTarget" title="Добавить предмет персонажу" width="460px" @close="addItemTarget = null">
      <div class="stack">
        <div class="small"><b>{{ catalog.lang.value === 'ru' ? addItemTarget.item.ru : addItemTarget.item.en }}</b></div>
        <label class="field">
          <span>Персонаж</span>
          <select v-model="pickCharId" class="input">
            <option v-for="c in chars" :key="c.id" :value="c.id">{{ c.name }} (Ур. {{ c.level }})</option>
          </select>
        </label>
        <label v-if="!addItemTarget.asContainer && pickedChar?.containers.length" class="field">
          <span>Положить в контейнер</span>
          <select v-model="pickContainerId" class="input">
            <option value="">— вне контейнера (на себе / в руках) —</option>
            <option v-for="ct in pickedChar.containers" :key="ct.id" :value="ct.id">{{ ct.name }}</option>
          </select>
        </label>
        <label v-if="addItemTarget.item.type === 'backpack' || addItemTarget.item.capacity > 0" class="check small">
          <input v-model="addItemTarget.asContainer" type="checkbox" /> Добавить как контейнер (с учётом вместимости)
        </label>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="addItemTarget = null">Отмена</button>
        <button type="button" class="btn btn-primary" @click="confirmAddItem"><Icon name="plus" :size="14" /> Добавить</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.page { max-width: 1360px; margin: 0 auto; padding: 18px 24px 60px; }
.crumbs-row { margin-bottom: 8px; }
.back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--text-muted); }
.back-link:hover { color: var(--accent); text-decoration: none; }

.char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
.char-card {
  display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden; box-shadow: var(--shadow); transition: border-color .12s, transform .12s;
}
.char-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.cc-main { display: flex; align-items: flex-start; gap: 14px; padding: 14px 16px; color: var(--text); text-decoration: none !important; flex: 1; }
.cc-ava {
  width: 64px; height: 64px; border-radius: 12px; overflow: hidden; flex-shrink: 0;
  background: var(--surface-3); color: var(--text-faint); display: flex; align-items: center; justify-content: center;
}
.cc-ava img { width: 100%; height: 100%; object-fit: cover; }
.cc-name { font-family: var(--font-head); font-size: 22px; line-height: 1.15; }
.cc-desc { margin: 4px 0 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cc-foot { padding: 6px 14px; background: var(--surface-2); border-top: 1px solid var(--border); }

.port-pick {
  width: 78px; height: 78px; border-radius: 14px; overflow: hidden; flex-shrink: 0;
  border: 2px dashed var(--border-strong); background: var(--surface-2); color: var(--text-faint);
  display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
}
.port-pick:hover { border-color: var(--accent); color: var(--accent); }
.port-pick img { width: 100%; height: 100%; object-fit: cover; }

@media (max-width: 720px) {
  .page { padding: 14px 12px 50px; }
  .char-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
