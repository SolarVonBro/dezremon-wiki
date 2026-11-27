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
import { autoRank } from '@/data/pf2eSpellcasting'
import { computeHeightenedSpell, formatAvgNumber } from '@/data/pf2eRoll'
import { localizeDamageType, pf2eIconUrl } from '@/data/pf2eFormat'
import { usePf2eWorkspace } from '@/data/pf2eWorkspace'
import { fileToSource, renderAvatar } from '@/data/avatar'
import { errorText, plural, randomId, relativeTime } from '@/data/util'
import type { ImageCrop } from '@/data/crop'
import type { Pf2eCharacter, Pf2eItemIndex, Pf2eItemType, Pf2eSpellCategory, Pf2eSpellIndex, Pf2eSpellList, Pf2eTradition } from '@/model/pf2e'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import ImageCropModal from '@/components/entity/ImageCropModal.vue'
import Pf2eTopNav from '@/components/pf2e/Pf2eTopNav.vue'
import Pf2eSpellBrowser from '@/components/pf2e/Pf2eSpellBrowser.vue'
import Pf2eItemBrowser from '@/components/pf2e/Pf2eItemBrowser.vue'
import Pf2eCharSpells from '@/components/pf2e/Pf2eCharSpells.vue'
import Pf2eCharInventory from '@/components/pf2e/Pf2eCharInventory.vue'
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
      if (ws.activeCharId.value && !rows.some((c) => c.id === ws.activeCharId.value)) {
        ws.setActivePf2eChar('')
      }
    },
    (e) => { loading.value = false; toast.error('Не удалось загрузить персонажей: ' + errorText(e)) },
  )
}, { immediate: true })
onBeforeUnmount(() => stopChars?.())

// Docked side-by-side character panel (Desktop) + Mobile 2-segment switcher
const dockOpen = ref(true)
const mobilePane = ref<'library' | 'char'>('library')
const initialItemType = ref<Pf2eItemType | ''>('')
const activeCharSpellList = ref<Pf2eSpellList | null>(null)

watch(() => route.query, (q) => {
  const forCid = typeof q.for === 'string' ? q.for : ''
  if (forCid) {
    ws.setActivePf2eChar(forCid)
    dockOpen.value = true
    mobilePane.value = 'library'
  }
  if (typeof q.list === 'string') ws.targetListId.value = q.list
  const qType = typeof q.type === 'string' ? q.type : ''
  initialItemType.value = (['weapon', 'armor', 'shield', 'equipment', 'consumable', 'backpack', 'ammo', 'treasure', 'kit'].includes(qType) ? qType : '') as Pf2eItemType | ''
}, { immediate: true })

// Auto-open dock when user selects a character from top nav
watch(() => ws.activeCharId.value, (cid) => {
  if (cid) dockOpen.value = true
})

const activeChar = computed(() => chars.value.find((c) => c.id === ws.activeCharId.value) ?? null)
const showSideBySide = computed(() => Boolean(activeChar.value) && dockOpen.value && (tab.value === 'spells' || tab.value === 'items'))

async function patchActiveChar(patch: Partial<Omit<Pf2eCharacter, 'id' | 'createdAt'>>) {
  if (!session.user?.uid || !activeChar.value) return
  try {
    await updatePf2eCharacter(session.user.uid, activeChar.value.id, patch)
  } catch (e) { toast.error('Не удалось сохранить: ' + errorText(e)) }
}

// Optional tradition pre-filter synced from character's active spell list (only when query ?for=... was passed)
const browserTradition = computed<Pf2eTradition | ''>(() => '')
const browserSpellCat = computed<Pf2eSpellCategory | ''>(() => '')

// Live owned counts for ✓ badges on library rows
const ownedSpellCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  const c = activeChar.value
  if (!c) return counts
  const srcLists = activeCharSpellList.value ? [activeCharSpellList.value] : c.spellLists
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

const activeCharSpellTotal = computed(() =>
  activeChar.value?.spellLists.reduce((s, l) => s + l.spells.length, 0) ?? 0,
)

// ==================== Tap-friendly Quick-Add Sheet (Mobile + Desktop "+" button) ====================
const quickSpell = ref<Pf2eSpellIndex | null>(null)
const quickSpellListId = ref<string>('')

function openQuickAddSpell(sp: Pf2eSpellIndex) {
  const c = activeChar.value
  if (!c) return
  if (!c.spellLists.length) {
    // Auto-create default list and add immediately!
    void addSpellToRank(sp, '', sp.cat === 'cantrip' ? 0 : sp.baseRank)
    return
  }
  quickSpell.value = sp
  quickSpellListId.value = activeCharSpellList.value?.id || c.spellLists[0].id
}

const quickTargetList = computed(() =>
  activeChar.value?.spellLists.find((l) => l.id === quickSpellListId.value) ?? activeChar.value?.spellLists[0] ?? null,
)

const quickSpellRankOptions = computed(() => {
  const sp = quickSpell.value
  const c = activeChar.value
  const l = quickTargetList.value
  if (!sp || !c || !l) return []
  const cRank = autoRank(c.level)

  if (sp.cat === 'cantrip') {
    const h = computeHeightenedSpell(sp, Math.max(sp.baseRank, cRank), { actorLevel: c.level })
    return [{
      rank: 0,
      label: `Заговоры (круг ${cRank})`,
      sub: h.compiled?.hasDice ? `🎲 ${h.compiled.displayExpr} · ср. ${formatAvgNumber(h.compiled.avg)}` : '',
      slotsInfo: '',
      full: false,
    }]
  }

  const ranks: number[] = []
  const minR = Math.max(1, sp.baseRank || 1)
  const slotRanks = Object.entries(l.slotsMax).filter(([, cnt]) => cnt > 0).map(([r]) => Number(r)).filter((r) => r >= minR)
  const maxR = Math.max(minR, ...slotRanks, Math.min(10, Math.max(minR + 2, cRank)))
  for (let r = minR; r <= Math.min(10, maxR); r++) ranks.push(r)

  const isPrep = l.castingType === 'prepared' && !l.flexible
  return ranks.map((r) => {
    const eff = l.castingType === 'focus' ? Math.max(r, cRank) : r
    const h = computeHeightenedSpell(sp, eff, { actorLevel: c.level })
    const singleType = h.damageEntries.length === 1 && h.damageEntries[0].type !== 'untyped'
      ? ` ${localizeDamageType(h.damageEntries[0].type, catalog.lang.value, catalog.meta.value)}`
      : ''
    const maxS = l.slotsMax[r] ?? 0
    const prepUsed = l.spells.filter((x) => x.rank === r).reduce((s, x) => s + Math.max(1, x.preparedCount ?? 1), 0)
    const slotsInfo = isPrep && maxS > 0 ? `ячейки ${prepUsed}/${maxS}` : maxS > 0 ? `${maxS} яч.` : ''
    return {
      rank: r,
      label: r > minR ? `Круг ${r} (↑ усил.)` : `Круг ${r}`,
      sub: h.compiled?.hasDice ? `🎲 ${h.compiled.displayExpr}${singleType} · ср. ${formatAvgNumber(h.compiled.avg)}` : '',
      slotsInfo,
      full: isPrep && maxS > 0 && prepUsed >= maxS,
    }
  })
})

async function addSpellToRank(sp: Pf2eSpellIndex, listId: string, rank: number) {
  const uid = session.user?.uid
  const c = activeChar.value
  if (!uid || !c) return
  const lists = c.spellLists.map((l) => ({ ...l, spells: [...l.spells] }))
  let target = lists.find((l) => l.id === listId) ?? lists[0]
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
    rank,
    preparedCount: target.castingType === 'prepared' && rank > 0 ? 1 : undefined,
    expendedCount: 0,
    usesMax: target.castingType === 'innate' && rank > 0 ? 1 : undefined,
    usesLeft: target.castingType === 'innate' && rank > 0 ? 1 : undefined,
    atWill: target.castingType === 'innate' && rank === 0,
  })
  try {
    await updatePf2eCharacter(uid, c.id, { spellLists: lists })
    const effRank = rank === 0 ? autoRank(c.level) : rank
    const h = computeHeightenedSpell(sp, effRank, { actorLevel: c.level })
    const dmgHint = h.compiled?.hasDice ? ` (${h.compiled.displayExpr})` : ''
    toast.success(`${catalog.lang.value === 'ru' ? sp.ru : sp.en} → ${rank === 0 ? 'Заговоры' : `${rank} круг`}${dmgHint}`)
    quickSpell.value = null
  } catch (e) { toast.error(errorText(e)) }
}

// Quick-add Item sheet (Mobile + Desktop "+" button)
const quickItem = ref<Pf2eItemIndex | null>(null)

function openQuickAddItem(item: Pf2eItemIndex, asContainer = false) {
  const c = activeChar.value
  if (!c) return
  if (asContainer) {
    void addItemToDest(item, 'new-container')
    return
  }
  // If character has no containers and item is not a container itself, add directly to worn/held in 1 tap!
  if (!c.containers.length && item.type !== 'backpack' && item.capacity <= 0) {
    const defDest = item.usageGroup === 'worn' || item.usageGroup === 'worn-slot' || item.type === 'armor' ? 'worn' : 'held'
    void addItemToDest(item, defDest)
    return
  }
  quickItem.value = item
}

async function addItemToDest(item: Pf2eItemIndex, dest: 'worn' | 'held' | 'new-container' | `c:${string}`) {
  const uid = session.user?.uid
  const c = activeChar.value
  if (!uid || !c) return
  try {
    if (dest === 'new-container') {
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
      toast.success(`Контейнер «${catalog.lang.value === 'ru' ? item.ru : item.en}» добавлен`)
    } else {
      const cid = dest.startsWith('c:') ? dest.slice(2) : null
      const carryType = (cid ? 'stowed' : dest) as 'worn' | 'held' | 'stowed'
      const inv = [
        ...c.inventory,
        {
          id: randomId(10),
          itemId: item.id,
          name: '',
          quantity: item.bulkPer > 1 && item.bulkPer < 1000 ? item.bulkPer : 1,
          carryType,
          containerId: cid,
          group: '',
          invested: false,
          notes: '',
          order: c.inventory.length,
        },
      ]
      await updatePf2eCharacter(uid, c.id, { inventory: inv })
      const lbl = cid ? c.containers.find((x) => x.id === cid)?.name : dest === 'worn' ? 'Надето' : 'В руках'
      toast.success(`${catalog.lang.value === 'ru' ? item.ru : item.en} → ${lbl}`)
    }
    quickItem.value = null
  } catch (e) { toast.error(errorText(e)) }
}

const activeCharBulkSummary = computed(() =>
  activeChar.value ? computeCharacterBulk(activeChar.value, catalog.itemsById.value) : null,
)

// ==================== Create Character Modal & Import ====================
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
  <div class="page" :class="{ wide: showSideBySide }">
    <Pf2eTopNav :active="tab" :chars="chars">
      <template #right>
        <button v-if="tab === 'chars'" type="button" class="btn btn-sm btn-primary" @click="openCreate">
          <Icon name="plus" :size="15" /> Новый персонаж
        </button>
        <button
          v-else-if="activeChar && !dockOpen"
          type="button"
          class="btn btn-sm btn-primary"
          @click="dockOpen = true"
        >
          <Icon name="panel-right-open" :size="14" /> Показать «{{ activeChar.name }}» рядом
        </button>
      </template>
    </Pf2eTopNav>

    <!-- ==================== TAB: CHARACTERS ==================== -->
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

    <!-- ==================== TAB: SPELLS / ITEMS (Side-by-Side Desktop + Segmented Mobile) ==================== -->
    <template v-else>
      <!-- Mobile / Tablet Workspace Switcher (< 1100px) -->
      <div v-if="showSideBySide && activeChar" class="mob-switch" role="tablist">
        <button type="button" class="mob-tab" :class="{ on: mobilePane === 'library' }" @click="mobilePane = 'library'">
          <Icon :name="tab === 'spells' ? 'sparkles' : 'backpack'" :size="15" />
          {{ tab === 'spells' ? 'Библиотека заклинаний' : 'Библиотека предметов' }}
        </button>
        <button type="button" class="mob-tab" :class="{ on: mobilePane === 'char' }" @click="mobilePane = 'char'">
          <img v-if="activeChar.portrait" :src="activeChar.portrait" alt="" class="mob-ava" />
          <Icon v-else name="user" :size="15" />
          <span class="ellipsis">{{ activeChar.name }}</span>
          <span class="mob-cnt">{{ tab === 'spells' ? activeCharSpellTotal : activeChar.inventory.length }}</span>
        </button>
      </div>

      <div class="ws-layout" :class="{ 'has-char': showSideBySide }">
        <!-- LEFT PANE: Full Library -->
        <div class="ws-lib" :class="{ 'mob-hidden': showSideBySide && mobilePane !== 'library' }">
          <Pf2eSpellBrowser
            v-if="tab === 'spells'"
            :pick-mode="Boolean(activeChar)"
            :docked="showSideBySide"
            :draggable-rows="showSideBySide"
            :initial-tradition="browserTradition"
            :initial-cat="browserSpellCat"
            :owned-counts="ownedSpellCounts"
            :pick-label="activeChar ? `Добавить «${activeChar.name}»` : 'Добавить'"
            @pick="openQuickAddSpell"
          />
          <Pf2eItemBrowser
            v-else
            :pick-mode="Boolean(activeChar)"
            :docked="showSideBySide"
            :draggable-rows="showSideBySide"
            :initial-type="initialItemType"
            :owned-counts="ownedItemCounts"
            :pick-label="activeChar ? `В инвентарь «${activeChar.name}»` : 'Добавить'"
            @pick="openQuickAddItem"
          />
        </div>

        <!-- RIGHT PANE: Character Sheet Live Side-by-Side (with Drag-and-Drop Slots & Containers!) -->
        <aside
          v-if="showSideBySide && activeChar"
          class="ws-char"
          :class="{ 'mob-hidden': mobilePane !== 'char' }"
        >
          <div class="ws-char-head">
            <div class="row gap-sm grow" style="min-width: 0">
              <div class="ws-ava">
                <img v-if="activeChar.portrait" :src="activeChar.portrait" alt="" />
                <Icon v-else name="user" :size="18" />
              </div>
              <div style="min-width: 0">
                <div class="row gap-sm">
                  <b class="ellipsis" style="font-size: 16px">{{ activeChar.name }}</b>
                  <span class="badge">Ур. {{ activeChar.level }}</span>
                </div>
                <div class="faint small">
                  {{ tab === 'spells' ? 'Перетащите заклинания в ячейки или круги' : 'Перетащите предметы на себя или в контейнеры' }}
                </div>
              </div>
            </div>

            <div class="row gap-sm" style="flex-shrink: 0">
              <RouterLink
                :to="{ name: 'toolPf2eChar', params: { cid: activeChar.id }, query: tab === 'items' ? { tab: 'inventory' } : undefined }"
                class="btn btn-sm"
                title="Открыть полный лист персонажа"
              >
                <Icon name="maximize2" :size="13" /> <span class="hide-sm">Полный лист</span>
              </RouterLink>
              <button type="button" class="icon-btn hide-mob" title="Свернуть панель персонажа" @click="dockOpen = false">
                <Icon name="x" :size="15" />
              </button>
            </div>
          </div>

          <div class="ws-char-body">
            <Pf2eCharSpells
              v-if="tab === 'spells'"
              :character="activeChar"
              :initial-list-id="ws.targetListId.value"
              compact
              @save="(lists) => patchActiveChar({ spellLists: lists })"
              @active-list="(l) => (activeCharSpellList = l)"
            />
            <Pf2eCharInventory
              v-else
              :character="activeChar"
              compact
              @patch="patchActiveChar"
            />
          </div>
        </aside>
      </div>
    </template>

    <!-- ==================== TOUCH / CLICK QUICK-ADD SPELL SHEET ==================== -->
    <Modal v-if="quickSpell && activeChar" :title="`Добавить в «${activeChar.name}»`" width="480px" @close="quickSpell = null">
      <div class="stack">
        <div class="row gap-sm">
          <img v-if="quickSpell.img" :src="pf2eIconUrl(quickSpell.img)" alt="" class="qa-ic" />
          <div class="grow" style="min-width: 0">
            <b style="font-size: 16px">{{ catalog.lang.value === 'ru' ? quickSpell.ru : quickSpell.en }}</b>
            <div class="faint small">{{ catalog.lang.value === 'ru' ? quickSpell.en : quickSpell.ru }}</div>
          </div>
        </div>

        <div v-if="activeChar.spellLists.length > 1" class="stack-sm">
          <span class="field-label">Список заклинаний</span>
          <div class="row gap-sm wrap">
            <button
              v-for="l in activeChar.spellLists"
              :key="l.id"
              type="button"
              class="chip"
              :class="{ on: quickSpellListId === l.id }"
              @click="quickSpellListId = l.id"
            >
              {{ l.name }}
            </button>
          </div>
        </div>

        <div class="stack-sm">
          <span class="field-label">Выберите круг / ячейку (нажмите для добавления)</span>
          <div class="qa-grid">
            <button
              v-for="opt in quickSpellRankOptions"
              :key="opt.rank"
              type="button"
              class="qa-opt"
              :class="{ full: opt.full }"
              @click="addSpellToRank(quickSpell!, quickSpellListId, opt.rank)"
            >
              <div class="row gap-sm" style="justify-content: space-between; width: 100%">
                <b>{{ opt.label }}</b>
                <span v-if="opt.slotsInfo" class="faint small">{{ opt.slotsInfo }}</span>
              </div>
              <div v-if="opt.sub" class="qa-sub">{{ opt.sub }}</div>
            </button>
          </div>
        </div>
      </div>
    </Modal>

    <!-- ==================== TOUCH / CLICK QUICK-ADD ITEM SHEET ==================== -->
    <Modal v-if="quickItem && activeChar" :title="`Добавить в инвентарь «${activeChar.name}»`" width="460px" @close="quickItem = null">
      <div class="stack">
        <div class="row gap-sm">
          <img v-if="quickItem.img" :src="pf2eIconUrl(quickItem.img)" alt="" class="qa-ic" />
          <div class="grow" style="min-width: 0">
            <b style="font-size: 16px">{{ catalog.lang.value === 'ru' ? quickItem.ru : quickItem.en }}</b>
            <div class="faint small">{{ catalog.lang.value === 'ru' ? quickItem.en : quickItem.ru }}</div>
          </div>
        </div>

        <div class="stack-sm">
          <span class="field-label">Куда положить?</span>
          <div class="qa-grid">
            <button
              v-if="quickItem.type === 'backpack' || quickItem.capacity > 0"
              type="button"
              class="qa-opt accent"
              @click="addItemToDest(quickItem!, 'new-container')"
            >
              <b><Icon name="backpack" :size="14" /> Добавить как контейнер</b>
              <span class="qa-sub">Вместимость {{ quickItem.capacity }} Б<template v-if="quickItem.ignored"> · игн. {{ quickItem.ignored }} Б</template></span>
            </button>
            <button type="button" class="qa-opt" @click="addItemToDest(quickItem!, 'worn')">
              <b><Icon name="shield" :size="14" /> Надето на себя</b>
            </button>
            <button type="button" class="qa-opt" @click="addItemToDest(quickItem!, 'held')">
              <b><Icon name="sword" :size="14" /> В руках</b>
            </button>
            <button
              v-for="ct in activeChar.containers"
              :key="ct.id"
              type="button"
              class="qa-opt"
              @click="addItemToDest(quickItem!, `c:${ct.id}`)"
            >
              <div class="row gap-sm" style="justify-content: space-between; width: 100%">
                <b><Icon name="backpack" :size="13" /> {{ ct.name }}</b>
                <span v-if="activeCharBulkSummary?.byContainer[ct.id]" class="faint small">
                  {{ formatLight(activeCharBulkSummary.byContainer[ct.id].contentsLight) }}<template v-if="ct.capacity"> / {{ ct.capacity }} Б</template>
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Modal>

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
.page { max-width: 1360px; margin: 0 auto; padding: 16px 24px 60px; transition: max-width .15s; }
.page.wide { max-width: 1740px; }

/* Desktop Side-by-Side Workspace */
.ws-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.ws-layout.has-char { grid-template-columns: minmax(0, 1.06fr) minmax(420px, 0.94fr); }
.ws-lib { min-width: 0; }

.ws-char {
  position: sticky; top: calc(var(--topbar-h) + 10px);
  max-height: calc(100vh - var(--topbar-h) - 20px);
  display: flex; flex-direction: column; min-width: 0;
  border-radius: 14px; border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--border));
  background: var(--bg); box-shadow: var(--shadow); overflow: hidden;
}
.ws-char-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.ws-ava {
  width: 36px; height: 36px; border-radius: 9px; overflow: hidden; flex-shrink: 0;
  background: var(--surface-3); color: var(--text-faint); display: flex; align-items: center; justify-content: center;
}
.ws-ava img { width: 100%; height: 100%; object-fit: cover; }
.ws-char-body { padding: 12px; overflow-y: auto; flex: 1; }

/* Mobile Segmented Switcher (hidden on Desktop >= 1100px) */
.mob-switch {
  display: none; position: sticky; top: calc(var(--topbar-h) + 6px); z-index: 25;
  margin-bottom: 12px; padding: 4px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow);
  gap: 4px;
}
.mob-tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 10px; border-radius: 9px; border: 0; background: transparent;
  color: var(--text-muted); font-size: 13.5px; font-weight: 700; cursor: pointer; min-width: 0;
}
.mob-tab.on { background: var(--accent); color: var(--accent-fg); }
.mob-ava { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.mob-cnt {
  padding: 0 6px; border-radius: 999px; font-size: 11px; font-family: var(--font-mono);
  background: rgba(0,0,0,.16);
}

/* Quick-add touch sheet */
.qa-ic { width: 38px; height: 38px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); flex-shrink: 0; }
.qa-grid { display: flex; flex-direction: column; gap: 6px; max-height: 56vh; overflow-y: auto; }
.qa-opt {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%;
  padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-strong);
  background: var(--surface-2); color: var(--text); text-align: left; cursor: pointer;
  transition: border-color .12s, background .12s;
}
.qa-opt:hover { border-color: var(--accent); background: var(--accent-soft); }
.qa-opt.accent { border-color: var(--accent); background: var(--accent-soft); }
.qa-opt.full { opacity: .72; }
.qa-sub { font-size: 12.5px; color: var(--text-muted); font-weight: 600; }

/* Characters grid */
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

@media (max-width: 1099px) {
  .mob-switch { display: flex; }
  .ws-layout.has-char { grid-template-columns: minmax(0, 1fr); }
  .ws-char { position: static; max-height: none; }
  .mob-hidden { display: none !important; }
  .hide-mob { display: none; }
}
@media (max-width: 720px) {
  .page { padding: 12px 10px 50px; }
  .char-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
