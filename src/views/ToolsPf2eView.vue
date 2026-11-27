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
import { usePf2eWorkspace } from '@/data/pf2eWorkspace'
import { fileToSource, renderAvatar } from '@/data/avatar'
import { errorText, plural, randomId, relativeTime } from '@/data/util'
import type { ImageCrop } from '@/data/crop'
import type { Pf2eCharacter, Pf2eItemIndex, Pf2eItemType, Pf2eSpellCategory, Pf2eSpellIndex, Pf2eTradition } from '@/model/pf2e'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import ImageCropModal from '@/components/entity/ImageCropModal.vue'
import Pf2eTopNav from '@/components/pf2e/Pf2eTopNav.vue'
import Pf2eSpellBrowser from '@/components/pf2e/Pf2eSpellBrowser.vue'
import Pf2eItemBrowser from '@/components/pf2e/Pf2eItemBrowser.vue'
import { toast } from '@/components/common/toast'

const session = useSession()
const route = useRoute()
const router = useRouter()
const catalog = usePf2eCatalog()
const ws = usePf2eWorkspace()

type Tab = 'chars' | 'spells' | 'items'
const tab = computed<Tab>(() => {
  const t = String(route.params.tab ?? '')
  if (t === 'spells') return 'spells'
  if (t === 'items') return 'items'
  return 'chars'
})

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
      // Keep activeCharId valid
      if (ws.activeCharId.value && !rows.some((c) => c.id === ws.activeCharId.value)) {
        ws.setActivePf2eChar('')
      }
    },
    (e) => { loading.value = false; toast.error('Не удалось загрузить персонажей: ' + errorText(e)) },
  )
}, { immediate: true })
onBeforeUnmount(() => stopChars?.())

// Sync URL query params (?for=<cid>&list=<listId>&rank=<n>&container=<id>&type=<itemType>) into workspace
const filterByListTradition = ref(true)
const initialItemType = ref<Pf2eItemType | ''>('')

watch(() => route.query, (q) => {
  const forCid = typeof q.for === 'string' ? q.for : ''
  if (forCid) ws.setActivePf2eChar(forCid)
  if (typeof q.list === 'string') ws.targetListId.value = q.list
  if (typeof q.rank === 'string' && q.rank !== '' && Number.isFinite(Number(q.rank))) {
    ws.targetRank.value = Number(q.rank)
  } else if (forCid && tab.value === 'spells' && !('rank' in q)) {
    ws.targetRank.value = null
  }
  if (typeof q.container === 'string') ws.targetContainerId.value = q.container
  const qType = typeof q.type === 'string' ? q.type : ''
  initialItemType.value = (['weapon', 'armor', 'shield', 'equipment', 'consumable', 'backpack', 'ammo', 'treasure', 'kit'].includes(qType) ? qType : '') as Pf2eItemType | ''
}, { immediate: true })

const activeChar = computed(() => chars.value.find((c) => c.id === ws.activeCharId.value) ?? null)

// Ensure targetListId & targetContainerId stay valid for activeChar
watch([activeChar, () => activeChar.value?.spellLists.length], ([c]) => {
  if (!c) return
  if (ws.targetListId.value && !c.spellLists.some((l) => l.id === ws.targetListId.value)) {
    ws.targetListId.value = c.spellLists[0]?.id ?? ''
  } else if (!ws.targetListId.value && c.spellLists.length) {
    ws.targetListId.value = c.spellLists[0].id
  }
  if (ws.targetContainerId.value && !c.containers.some((ct) => ct.id === ws.targetContainerId.value)) {
    ws.targetContainerId.value = ''
  }
}, { immediate: true })

const activeSpellList = computed(() =>
  activeChar.value?.spellLists.find((l) => l.id === ws.targetListId.value)
  ?? activeChar.value?.spellLists[0]
  ?? null,
)

const browserTradition = computed<Pf2eTradition | ''>(() =>
  filterByListTradition.value && activeSpellList.value?.tradition ? activeSpellList.value.tradition : '',
)
const browserSpellCat = computed<Pf2eSpellCategory | ''>(() => {
  if (!filterByListTradition.value || !activeSpellList.value) return ''
  if (activeSpellList.value.castingType === 'focus') return 'focus'
  if (activeSpellList.value.castingType === 'ritual') return 'ritual'
  return ''
})

// Owned counts for live "✓" badges in the full-page libraries!
const ownedSpellCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  const c = activeChar.value
  if (!c) return counts
  const list = activeSpellList.value
  const srcLists = list ? [list] : c.spellLists
  for (const l of srcLists) {
    for (const row of l.spells) {
      if (row.spellId) counts[row.spellId] = (counts[row.spellId] ?? 0) + 1
    }
  }
  return counts
})

const ownedItemCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  const c = activeChar.value
  if (!c) return counts
  for (const row of c.inventory) {
    if (row.itemId) counts[row.itemId] = (counts[row.itemId] ?? 0) + (row.quantity || 1)
  }
  for (const ct of c.containers) {
    if (ct.itemId) counts[ct.itemId] = (counts[ct.itemId] ?? 0) + 1
  }
  return counts
})

const activeCharGroups = computed(() => {
  const c = activeChar.value
  if (!c) return []
  const s = new Set<string>(c.customGroups ?? [])
  for (const r of c.inventory) if (r.group.trim()) s.add(r.group.trim())
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'))
})

const activeCharBulk = computed(() => (activeChar.value ? computeCharacterBulk(activeChar.value, catalog.itemsById.value) : null))

// 1-click instant Add Spell to active character!
async function quickAddSpell(sp: Pf2eSpellIndex) {
  const uid = session.user?.uid
  const c = activeChar.value
  if (!uid || !c) return
  const lists = c.spellLists.map((l) => ({ ...l, spells: [...l.spells] }))
  let target = lists.find((l) => l.id === ws.targetListId.value) ?? lists[0]
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
    ws.targetListId.value = target.id
  }
  const rank = ws.targetRank.value != null
    ? ws.targetRank.value
    : sp.cat === 'cantrip' ? 0 : sp.baseRank
  target.spells.push({
    id: randomId(10),
    spellId: sp.id,
    rank,
    preparedCount: target.castingType === 'prepared' && rank > 0 ? 1 : undefined,
    expendedCount: 0,
    usesMax: target.castingType === 'innate' && rank > 0 ? 1 : undefined,
    usesLeft: target.castingType === 'innate' && rank > 0 ? 1 : undefined,
    atWill: target.castingType === 'innate' && rank === 0,
  })
  try {
    await updatePf2eCharacter(uid, c.id, { spellLists: lists })
    toast.success(`+ ${catalog.lang.value === 'ru' ? sp.ru : sp.en} → ${c.name} (${rank === 0 ? 'заговор' : `${rank} круг`})`)
  } catch (e) { toast.error(errorText(e)) }
}

// 1-click instant Add Item / Container to active character!
async function quickAddItem(item: Pf2eItemIndex, asContainer = false) {
  const uid = session.user?.uid
  const c = activeChar.value
  if (!uid || !c) return
  try {
    if (asContainer) {
      const containers = [
        ...c.containers,
        {
          id: randomId(10),
          itemId: item.id,
          name: catalog.lang.value === 'ru' ? item.ru : item.en,
          carryType: (item.usage.startsWith('worn') ? 'worn' : 'held') as 'worn' | 'held',
          parentContainerId: null,
          bulk: item.bulk,
          bulkHeld: item.bulkHeld,
          capacity: item.capacity,
          ignored: item.ignored,
          extradimensional: item.extradimensional,
          invested: false,
          priceCp: item.priceCp,
          notes: '',
          order: c.containers.length,
        },
      ]
      await updatePf2eCharacter(uid, c.id, { containers })
      toast.success(`+ Контейнер «${catalog.lang.value === 'ru' ? item.ru : item.en}» → ${c.name}`)
    } else {
      const cid = ws.targetContainerId.value || null
      const carryType = (cid ? 'stowed' : item.usageGroup === 'worn' || item.usageGroup === 'worn-slot' || item.type === 'armor' ? 'worn' : 'held') as 'worn' | 'held' | 'stowed'
      const inv = [
        ...c.inventory,
        {
          id: randomId(10),
          itemId: item.id,
          name: '',
          quantity: item.bulkPer > 1 && item.bulkPer < 1000 ? item.bulkPer : 1,
          carryType,
          containerId: cid,
          group: ws.targetGroup.value.trim(),
          invested: false,
          notes: '',
          order: c.inventory.length,
        },
      ]
      await updatePf2eCharacter(uid, c.id, { inventory: inv })
      const cName = cid ? c.containers.find((x) => x.id === cid)?.name : ''
      toast.success(`+ ${catalog.lang.value === 'ru' ? item.ru : item.en} → ${c.name}${cName ? ` (${cName})` : ''}`)
    }
  } catch (e) { toast.error(errorText(e)) }
}

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
    ws.setActivePf2eChar(cid)
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
    if (ws.activeCharId.value === c.id) ws.setActivePf2eChar('')
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
    <Pf2eTopNav :active="tab" :chars="chars">
      <template #right>
        <button v-if="tab === 'chars'" type="button" class="btn btn-sm btn-primary" @click="openCreate">
          <Icon name="plus" :size="15" /> Новый персонаж
        </button>
      </template>
    </Pf2eTopNav>

    <!-- TAB: CHARACTERS -->
    <template v-if="tab === 'chars'">
      <div class="row gap wrap" style="margin-bottom: 14px">
        <div class="grow">
          <h1 style="margin: 0; font-size: 28px">Персонажи Pathfinder 2e</h1>
          <p class="muted small" style="margin: 2px 0 0">Наборы заклинаний и инвентарь с точным подсчётом массы и контейнеров</p>
        </div>
      </div>

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
          <div v-for="c in chars" :key="c.id" class="char-card" :class="{ active: ws.activeCharId.value === c.id }">
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

    <!-- TAB: SPELLS LIBRARY (full-page with seamless 1-click target character bar) -->
    <template v-else-if="tab === 'spells'">
      <div v-if="activeChar" class="pick-ctx-bar">
        <RouterLink
          :to="{ name: 'toolPf2eChar', params: { cid: activeChar.id }, query: { tab: 'spells' } }"
          class="btn btn-sm btn-primary"
        >
          <Icon name="arrow-left" :size="14" /> К «{{ activeChar.name }}»
        </RouterLink>

        <div class="row gap-sm wrap grow">
          <label class="row gap-sm small">
            <span class="muted">Список:</span>
            <select v-model="ws.targetListId.value" class="input input-sm" style="width: auto; max-width: 220px">
              <option v-if="!activeChar.spellLists.length" value="">— создастся автоматически —</option>
              <option v-for="l in activeChar.spellLists" :key="l.id" :value="l.id">{{ l.name }} ({{ l.spells.length }})</option>
            </select>
          </label>

          <label class="row gap-sm small">
            <span class="muted">Круг:</span>
            <select v-model="ws.targetRank.value" class="input input-sm" style="width: auto">
              <option :value="null">Базовый круг</option>
              <option :value="0">Заговор (0)</option>
              <option v-for="r in 10" :key="r" :value="r">Круг {{ r }}</option>
            </select>
          </label>

          <label v-if="activeSpellList?.tradition || activeSpellList?.castingType === 'focus' || activeSpellList?.castingType === 'ritual'" class="check small nowrap">
            <input v-model="filterByListTradition" type="checkbox" /> Фильтр по списку
          </label>
        </div>

        <button type="button" class="icon-btn" title="Отключить режим добавления персонажу" @click="ws.setActivePf2eChar('')">
          <Icon name="x" :size="15" />
        </button>
      </div>

      <Pf2eSpellBrowser
        :pick-mode="Boolean(activeChar)"
        :initial-tradition="browserTradition"
        :initial-cat="browserSpellCat"
        :owned-counts="ownedSpellCounts"
        :pick-label="activeChar ? `Добавить «${activeChar.name}»` : 'Добавить'"
        @pick="quickAddSpell"
      />
    </template>

    <!-- TAB: ITEMS LIBRARY (full-page with seamless 1-click target character bar) -->
    <template v-else>
      <div v-if="activeChar" class="pick-ctx-bar">
        <RouterLink
          :to="{ name: 'toolPf2eChar', params: { cid: activeChar.id }, query: { tab: 'inventory' } }"
          class="btn btn-sm btn-primary"
        >
          <Icon name="arrow-left" :size="14" /> К «{{ activeChar.name }}»
        </RouterLink>

        <div class="row gap-sm wrap grow">
          <label class="row gap-sm small">
            <span class="muted">Куда класть:</span>
            <select v-model="ws.targetContainerId.value" class="input input-sm" style="width: auto; max-width: 230px">
              <option value="">На себе / в руках</option>
              <option v-for="ct in activeChar.containers" :key="ct.id" :value="ct.id">В контейнер: {{ ct.name }}</option>
            </select>
          </label>

          <label class="row gap-sm small">
            <span class="muted">Группа:</span>
            <input
              v-model="ws.targetGroup.value"
              type="text"
              list="pf-lib-groups"
              class="input input-sm"
              style="width: 145px"
              placeholder="Необязательно…"
            />
          </label>

          <span v-if="activeCharBulk" class="badge" :class="activeCharBulk.status === 'overloaded' ? 'badge-dead' : activeCharBulk.status === 'encumbered' ? 'badge-warn' : ''">
            <Icon name="weight" :size="12" /> {{ formatLight(activeCharBulk.totalLight) }} / {{ activeCharBulk.encumberedAt }} ({{ activeCharBulk.maxBulk }})
          </span>
        </div>

        <button type="button" class="icon-btn" title="Отключить режим добавления персонажу" @click="ws.setActivePf2eChar('')">
          <Icon name="x" :size="15" />
        </button>

        <datalist id="pf-lib-groups">
          <option v-for="g in activeCharGroups" :key="g" :value="g" />
        </datalist>
      </div>

      <Pf2eItemBrowser
        :pick-mode="Boolean(activeChar)"
        :initial-type="initialItemType"
        :owned-counts="ownedItemCounts"
        :pick-label="activeChar ? `В инвентарь «${activeChar.name}»` : 'Добавить'"
        @pick="quickAddItem"
      />
    </template>

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
  </div>
</template>

<style scoped>
.page { max-width: 1360px; margin: 0 auto; padding: 16px 24px 60px; }

.pick-ctx-bar {
  position: sticky; top: calc(var(--topbar-h) + 8px); z-index: 20;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 9px 12px; margin-bottom: 12px; border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  box-shadow: var(--shadow);
}
.badge-warn { background: color-mix(in srgb, var(--warning) 22%, transparent); color: var(--warning); }

.char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
.char-card {
  display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden; box-shadow: var(--shadow); transition: border-color .12s, transform .12s;
}
.char-card.active { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
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
