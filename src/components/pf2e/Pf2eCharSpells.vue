<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type {
  Pf2eAttribute, Pf2eCastingType, Pf2eCharacter, Pf2eProficiency, Pf2eSpellEntryItem,
  Pf2eSpellIndex, Pf2eSpellList, Pf2eTradition,
} from '@/model/pf2e'
import { ensurePf2eSpells, usePf2eCatalog } from '@/data/pf2eCatalog'
import {
  autoRank, computeSpellStats, fullCasterProficiency, PF2E_ATTRIBUTES, PF2E_CASTING_TYPES,
  PF2E_CLASS_PRESETS, PF2E_PROFICIENCIES, PF2E_TRADITIONS,
} from '@/data/pf2eSpellcasting'
import { formatActionSymbol, localizeDamageType, pf2eIconUrl } from '@/data/pf2eFormat'
import { computeHeightenedSpell, formatAvgNumber } from '@/data/pf2eRoll'
import { endPf2eDrag, startPf2eDrag, usePf2eDrag } from '@/data/pf2eDrag'
import { setSpellPickTarget } from '@/data/pf2eWorkspace'
import { randomId } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Pf2eSpellCard from './Pf2eSpellCard.vue'
import { toast } from '@/components/common/toast'

const props = withDefaults(defineProps<{
  character: Pf2eCharacter
  compact?: boolean
  initialListId?: string
}>(), {
  compact: false,
  initialListId: '',
})

const emit = defineEmits<{
  save: [spellLists: Pf2eSpellList[]]
  'active-list': [list: Pf2eSpellList | null]
}>()

const router = useRouter()
const catalog = usePf2eCatalog()
const lang = catalog.lang
const setLang = catalog.setLang
const { currentDrag } = usePf2eDrag()
onMounted(() => { void ensurePf2eSpells() })

const activeListId = ref<string | null>(props.initialListId || props.character.spellLists[0]?.id || null)
watch(() => props.initialListId, (id) => {
  if (id && props.character.spellLists.some((l) => l.id === id)) activeListId.value = id
})

const searchQ = ref('')
const viewingSpell = ref<Pf2eSpellIndex | null>(null)
const viewingSpellRank = ref<number | undefined>(undefined)

const activeList = computed(() => {
  const lists = props.character.spellLists
  if (!lists.length) return null
  return lists.find((l) => l.id === activeListId.value) ?? lists[0]
})
watch(activeList, (l) => emit('active-list', l), { immediate: true })

function cloneLists(): Pf2eSpellList[] {
  return JSON.parse(JSON.stringify(props.character.spellLists)) as Pf2eSpellList[]
}

function updateList(id: string, fn: (l: Pf2eSpellList) => void) {
  const lists = cloneLists()
  const target = lists.find((l) => l.id === id)
  if (!target) return
  fn(target)
  emit('save', lists)
}

// ==================== Create / Edit Spellcasting Entry Modal ====================
interface EntryForm {
  id: string | null
  name: string
  castingType: Pf2eCastingType
  tradition: Pf2eTradition | ''
  keyAttr: Pf2eAttribute
  keyMod: number
  proficiency: Pf2eProficiency
  bonusAttack: number
  bonusDc: number
  flexible: boolean
  focusMax: number
  classPreset: string
  slotsMax: Record<number, number>
  notes: string
}

const entryModal = ref<EntryForm | null>(null)

function openNewEntry() {
  const lvl = props.character.level
  entryModal.value = {
    id: null,
    name: '',
    castingType: 'prepared',
    tradition: 'arcane',
    keyAttr: 'int',
    keyMod: 4,
    proficiency: fullCasterProficiency(lvl),
    bonusAttack: 0,
    bonusDc: 0,
    flexible: false,
    focusMax: 1,
    classPreset: '',
    slotsMax: { 1: 2 },
    notes: '',
  }
}

function openEditEntry(l: Pf2eSpellList) {
  entryModal.value = {
    id: l.id,
    name: l.name,
    castingType: l.castingType,
    tradition: l.tradition,
    keyAttr: l.keyAttr,
    keyMod: l.keyMod,
    proficiency: l.proficiency,
    bonusAttack: l.bonusAttack ?? 0,
    bonusDc: l.bonusDc ?? 0,
    flexible: Boolean(l.flexible),
    focusMax: l.focusMax ?? 1,
    classPreset: l.classPreset ?? '',
    slotsMax: { ...l.slotsMax },
    notes: l.notes ?? '',
  }
}

function applyClassPreset(presetId: string) {
  if (!entryModal.value) return
  const p = PF2E_CLASS_PRESETS.find((x) => x.id === presetId)
  if (!p) return
  entryModal.value.classPreset = p.id
  entryModal.value.castingType = p.castingType
  entryModal.value.tradition = p.tradition
  entryModal.value.keyAttr = p.keyAttr
  if (!entryModal.value.name.trim()) entryModal.value.name = p.ru.split(' (')[0]
  entryModal.value.slotsMax = p.slotsForLevel(props.character.level)
  entryModal.value.proficiency = p.proficiencyForLevel(props.character.level)
  if (!entryModal.value.notes.trim() && p.note) entryModal.value.notes = p.note
}

function saveEntryModal() {
  const f = entryModal.value
  if (!f || !f.name.trim()) return
  const lists = cloneLists()
  const cleanSlots: Record<number, number> = {}
  for (let r = 1; r <= 10; r++) {
    const v = Number(f.slotsMax[r]) || 0
    if (v > 0) cleanSlots[r] = Math.min(20, Math.max(0, Math.round(v)))
  }

  if (f.id) {
    const target = lists.find((l) => l.id === f.id)
    if (target) {
      Object.assign(target, {
        name: f.name.trim(),
        castingType: f.castingType,
        tradition: f.tradition,
        keyAttr: f.keyAttr,
        keyMod: Number(f.keyMod) || 0,
        proficiency: f.proficiency,
        bonusAttack: Number(f.bonusAttack) || 0,
        bonusDc: Number(f.bonusDc) || 0,
        flexible: f.flexible,
        focusMax: f.castingType === 'focus' ? Math.min(3, Math.max(1, Number(f.focusMax) || 1)) : undefined,
        focusCurrent: f.castingType === 'focus' ? Math.min(Number(f.focusMax) || 1, target.focusCurrent ?? 1) : undefined,
        classPreset: f.classPreset,
        slotsMax: cleanSlots,
        notes: f.notes.trim(),
      })
    }
  } else {
    const id = randomId(10)
    lists.push({
      id,
      name: f.name.trim(),
      castingType: f.castingType,
      tradition: f.tradition,
      keyAttr: f.keyAttr,
      keyMod: Number(f.keyMod) || 0,
      proficiency: f.proficiency,
      bonusAttack: Number(f.bonusAttack) || 0,
      bonusDc: Number(f.bonusDc) || 0,
      flexible: f.flexible,
      focusMax: f.castingType === 'focus' ? Math.min(3, Math.max(1, Number(f.focusMax) || 1)) : undefined,
      focusCurrent: f.castingType === 'focus' ? Math.min(3, Math.max(1, Number(f.focusMax) || 1)) : undefined,
      classPreset: f.classPreset,
      slotsMax: cleanSlots,
      slotsUsed: {},
      notes: f.notes.trim(),
      spells: [],
    })
    activeListId.value = id
  }
  emit('save', lists)
  entryModal.value = null
}

function deleteEntry(l: Pf2eSpellList) {
  if (!confirm(`Удалить список заклинаний «${l.name}»?`)) return
  const lists = cloneLists().filter((x) => x.id !== l.id)
  if (activeListId.value === l.id) activeListId.value = lists[0]?.id ?? null
  emit('save', lists)
}

function dailyRest() {
  const lists = cloneLists()
  for (const l of lists) {
    l.slotsUsed = {}
    if (l.castingType === 'focus' && l.focusMax) l.focusCurrent = l.focusMax
    for (const sp of l.spells) {
      sp.expendedCount = 0
      if (sp.usesMax != null) sp.usesLeft = sp.usesMax
    }
  }
  emit('save', lists)
  toast.success('Ежедневные приготовления: все ячейки, очки фокуса и использования восстановлены')
}

// ==================== Navigation to Side-by-Side Library & Custom Spell ====================
const customModal = ref<{ name: string; rank: number; notes: string; usesMax: number; atWill: boolean } | null>(null)

function openSpellPicker(rank: number | null = null) {
  const l = activeList.value
  if (!l) return
  setSpellPickTarget(props.character.id, l.id, rank)
  void router.push({
    name: 'toolPf2e',
    params: { tab: 'spells' },
    query: { for: props.character.id, list: l.id },
  })
}

function openCustomSpell(rank = 1) {
  customModal.value = { name: '', rank, notes: '', usesMax: 1, atWill: false }
}

function submitCustomSpell() {
  const f = customModal.value
  const l = activeList.value
  if (!f || !l || !f.name.trim()) return
  updateList(l.id, (entry) => {
    entry.spells.push({
      id: randomId(10),
      spellId: null,
      customName: f.name.trim(),
      rank: Math.min(10, Math.max(0, Number(f.rank) || 0)),
      preparedCount: entry.castingType === 'prepared' && f.rank > 0 ? 1 : undefined,
      expendedCount: 0,
      usesMax: entry.castingType === 'innate' && !f.atWill ? Math.max(1, f.usesMax) : undefined,
      usesLeft: entry.castingType === 'innate' && !f.atWill ? Math.max(1, f.usesMax) : undefined,
      atWill: f.atWill,
      notes: f.notes.trim(),
    })
  })
  customModal.value = null
}

// ==================== Spell Preview & Rank-Aware Scaling ====================
const cantripRank = computed(() => autoRank(props.character.level))

function effectiveRankFor(rowRank: number, sp?: Pf2eSpellIndex | null): number {
  const base = Math.max(1, sp?.baseRank || 1)
  if (rowRank === 0 || activeList.value?.castingType === 'focus') {
    return Math.max(base, cantripRank.value)
  }
  return Math.max(base, rowRank)
}

function openSpellPreview(row: Pf2eSpellEntryItem) {
  if (!row.spellId) return
  const sp = catalog.spellsById.value.get(row.spellId) ?? null
  if (!sp) return
  viewingSpell.value = sp
  viewingSpellRank.value = effectiveRankFor(row.rank, sp)
}

function spellDamageBadge(sp: Pf2eSpellIndex | null | undefined, targetRank: number): { label: string; title: string; heightened: boolean } | null {
  if (!sp) return null
  const effRank = effectiveRankFor(targetRank, sp)
  const h = computeHeightenedSpell(sp, effRank, { actorLevel: props.character.level })
  if (!h.compiled?.hasDice) return null
  const singleType = h.damageEntries.length === 1 && h.damageEntries[0].type !== 'untyped'
    ? localizeDamageType(h.damageEntries[0].type, lang.value, catalog.meta.value)
    : ''
  const avgStr = formatAvgNumber(h.compiled.avg)
  return {
    label: singleType ? `${h.compiled.displayExpr} ${singleType}` : h.compiled.displayExpr,
    title: lang.value === 'ru'
      ? `Круг ${effRank}: ${h.compiled.displayExpr} · среднее ${avgStr} (${h.compiled.min}–${h.compiled.max})`
      : `Rank ${effRank}: ${h.compiled.displayExpr} · avg ${avgStr} (${h.compiled.min}–${h.compiled.max})`,
    heightened: h.isHeightened,
  }
}

// ==================== Drag & Drop Into Prepared Slots & Rank Categories ====================
const dragOverKey = ref<string | null>(null) // "rank:3" | "slot:3:empty:0" | "slot:3:rowId:0"

const draggingSpell = computed<Pf2eSpellIndex | null>(() => {
  const d = currentDrag.value
  if (!d) return null
  if (d.kind === 'library-spell') return d.spell
  if (d.kind === 'char-spell') return d.spell
  return null
})

function isSpellDrag(): boolean {
  const d = currentDrag.value
  return Boolean(d && (d.kind === 'library-spell' || d.kind === 'char-spell'))
}

function canDropInRank(sp: Pf2eSpellIndex | null, targetRank: number): boolean {
  if (!sp) return true // custom spell can move anywhere
  const l = activeList.value
  if (!l) return false
  if (targetRank === 0) {
    return sp.cat === 'cantrip' || l.castingType === 'innate'
  }
  if (sp.cat === 'cantrip') return l.castingType === 'innate'
  return targetRank >= Math.max(1, sp.baseRank || 1)
}

function dropHintFor(sp: Pf2eSpellIndex | null, targetRank: number, replaceMode = false): string {
  if (!sp) return replaceMode ? 'Заменить ячейку' : `Добавить в ${targetRank === 0 ? 'Заговоры' : `${targetRank} круг`}`
  const effRank = effectiveRankFor(targetRank, sp)
  const dmg = spellDamageBadge(sp, targetRank)
  const dmgStr = dmg ? ` (${dmg.label})` : ''
  if (targetRank === 0) return `Заговоры (круг ${effRank})${dmgStr}`
  if (replaceMode) return `Заменить ячейку ${targetRank} круга${dmgStr}`
  const isPrep = activeList.value?.castingType === 'prepared' && !activeList.value?.flexible
  return isPrep ? `Подготовить на ${targetRank} круге${dmgStr}` : `Добавить в ${targetRank} круг${dmgStr}`
}

function onRowDragStart(e: DragEvent, row: Pf2eSpellEntryItem) {
  const l = activeList.value
  if (!l) return
  const sp = row.spellId ? catalog.spellsById.value.get(row.spellId) ?? null : null
  startPf2eDrag({ kind: 'char-spell', listId: l.id, row, spell: sp })
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `pf2e-char-spell:${row.id}`)
  }
}

function onDragOverTarget(e: DragEvent, key: string, targetRank: number) {
  if (!isSpellDrag()) return
  const ok = canDropInRank(draggingSpell.value, targetRank)
  if (!ok) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    return
  }
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = currentDrag.value?.kind === 'char-spell' ? 'move' : 'copy'
  dragOverKey.value = key
}

function onDragLeaveTarget(key: string) {
  if (dragOverKey.value === key) dragOverKey.value = null
}

function handleDropSpell(
  e: DragEvent,
  targetRank: number,
  replaceSlot?: { rowId: string; slotIdx: number },
) {
  e.preventDefault()
  dragOverKey.value = null
  const l = activeList.value
  const d = currentDrag.value
  if (!l || !d) return
  if (d.kind !== 'library-spell' && d.kind !== 'char-spell') return

  const sp = d.kind === 'library-spell' ? d.spell : d.spell
  if (!canDropInRank(sp, targetRank)) {
    if (sp) toast.info(`«${lang.value === 'ru' ? sp.ru : sp.en}» нельзя поместить в ${targetRank === 0 ? 'Заговоры' : `${targetRank} круг`} (мин. ${sp.baseRank} круг)`)
    endPf2eDrag()
    return
  }

  const isSlottedPrep = l.castingType === 'prepared' && !l.flexible && targetRank > 0

  if (d.kind === 'library-spell') {
    updateList(l.id, (entry) => {
      if (replaceSlot && isSlottedPrep) {
        const idx = entry.spells.findIndex((x) => x.id === replaceSlot.rowId)
        if (idx >= 0) {
          const cur = entry.spells[idx]
          const cnt = cur.preparedCount ?? 1
          if (cnt <= 1) {
            entry.spells[idx] = {
              ...cur,
              spellId: d.spell.id,
              customName: undefined,
              rank: targetRank,
              preparedCount: 1,
              expendedCount: 0,
            }
            return
          }
          cur.preparedCount = cnt - 1
          if ((cur.expendedCount ?? 0) > cur.preparedCount) cur.expendedCount = cur.preparedCount
        }
      }
      entry.spells.push({
        id: randomId(10),
        spellId: d.spell.id,
        rank: targetRank,
        preparedCount: entry.castingType === 'prepared' && targetRank > 0 ? 1 : undefined,
        expendedCount: 0,
        usesMax: entry.castingType === 'innate' && targetRank > 0 ? 1 : undefined,
        usesLeft: entry.castingType === 'innate' && targetRank > 0 ? 1 : undefined,
        atWill: entry.castingType === 'innate' && targetRank === 0,
        notes: '',
      })
    })
    const dmg = spellDamageBadge(d.spell, targetRank)
    toast.success(`${lang.value === 'ru' ? d.spell.ru : d.spell.en} → ${targetRank === 0 ? 'Заговоры' : `${targetRank} круг`}${dmg ? ` (${dmg.label})` : ''}`)
  } else if (d.kind === 'char-spell') {
    if (d.listId !== l.id || d.row.rank === targetRank) { endPf2eDrag(); return }
    updateList(l.id, (entry) => {
      const srcIdx = entry.spells.findIndex((x) => x.id === d.row.id)
      if (srcIdx < 0) return
      const src = entry.spells[srcIdx]
      const srcCount = src.preparedCount ?? 1
      if (isSlottedPrep && srcCount > 1) {
        // Move 1 prepared copy to target rank
        src.preparedCount = srcCount - 1
        if ((src.expendedCount ?? 0) > src.preparedCount) src.expendedCount = src.preparedCount
        entry.spells.push({
          ...src,
          id: randomId(10),
          rank: targetRank,
          preparedCount: 1,
          expendedCount: 0,
        })
      } else {
        src.rank = targetRank
        if (entry.castingType === 'prepared' && targetRank > 0 && !src.preparedCount) src.preparedCount = 1
      }
    })
    const name = sp ? (lang.value === 'ru' ? sp.ru : sp.en) : (d.row.customName || 'Заклинание')
    toast.success(`${name} перенесено в ${targetRank === 0 ? 'Заговоры' : `${targetRank} круг`}`)
  }

  endPf2eDrag()
}

// ==================== Row & Slot Operations ====================
const editRow = ref<Pf2eSpellEntryItem | null>(null)
function saveEditRow() {
  const r = editRow.value
  const l = activeList.value
  if (!r || !l) return
  updateList(l.id, (entry) => {
    const idx = entry.spells.findIndex((x) => x.id === r.id)
    if (idx >= 0) entry.spells[idx] = { ...r }
  })
  editRow.value = null
}

function removeSpellRow(rowId: string) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => { entry.spells = entry.spells.filter((x) => x.id !== rowId) })
}

function removeOnePreparedSlot(row: Pf2eSpellEntryItem) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    const t = entry.spells.find((x) => x.id === row.id)
    if (!t) return
    const next = (t.preparedCount ?? 1) - 1
    if (next <= 0) {
      entry.spells = entry.spells.filter((x) => x.id !== row.id)
    } else {
      t.preparedCount = next
      if ((t.expendedCount ?? 0) > next) t.expendedCount = next
    }
  })
}

function toggleSignature(row: Pf2eSpellEntryItem) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    const t = entry.spells.find((x) => x.id === row.id)
    if (t) t.signature = !t.signature
  })
}

function togglePreparedCast(row: Pf2eSpellEntryItem, slotIdx: number) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    const t = entry.spells.find((x) => x.id === row.id)
    if (!t) return
    const used = t.expendedCount ?? 0
    t.expendedCount = slotIdx < used ? slotIdx : slotIdx + 1
  })
}

function toggleSharedSlot(rank: number, slotIdx: number) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    const used = entry.slotsUsed[rank] ?? 0
    entry.slotsUsed[rank] = slotIdx < used ? slotIdx : slotIdx + 1
  })
}

function bumpInnateLeft(row: Pf2eSpellEntryItem, delta: number) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    const t = entry.spells.find((x) => x.id === row.id)
    if (!t) return
    const max = t.usesMax ?? 1
    t.usesLeft = Math.min(max, Math.max(0, (t.usesLeft ?? max) + delta))
  })
}

function setFocusPoints(n: number) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    entry.focusCurrent = entry.focusCurrent === n ? n - 1 : n
  })
}

function spellName(row: Pf2eSpellEntryItem): string {
  if (row.customName) return row.customName
  const cat = row.spellId ? catalog.spellsById.value.get(row.spellId) : undefined
  if (!cat) return row.spellId ?? 'Заклинание'
  return lang.value === 'ru' ? cat.ru : cat.en
}

function spellSecondary(row: Pf2eSpellEntryItem): string {
  const cat = row.spellId ? catalog.spellsById.value.get(row.spellId) : undefined
  if (!cat) return ''
  return lang.value === 'ru' ? cat.en : cat.ru
}

function spellImg(row: Pf2eSpellEntryItem): string {
  const cat = row.spellId ? catalog.spellsById.value.get(row.spellId) : undefined
  return pf2eIconUrl(cat?.img)
}

interface PreparedSlotView {
  key: string
  row: Pf2eSpellEntryItem
  slotIdx: number
  expended: boolean
  cat: Pf2eSpellIndex | null
}

// Group active entry's spells by rank (including ranks that have slots > 0)
const rankGroups = computed(() => {
  const l = activeList.value
  if (!l) return []
  const needle = searchQ.value.trim().toLowerCase()
  const ranksSet = new Set<number>()

  if (l.castingType === 'prepared' || l.castingType === 'spontaneous') {
    ranksSet.add(0) // Cantrips
    for (const [rStr, cnt] of Object.entries(l.slotsMax)) {
      if (cnt > 0) ranksSet.add(Number(rStr))
    }
  } else if (l.castingType === 'focus' && !l.spells.length) {
    ranksSet.add(cantripRank.value)
  } else if ((l.castingType === 'innate' || l.castingType === 'ritual') && !l.spells.length) {
    ranksSet.add(1)
  }
  for (const sp of l.spells) ranksSet.add(sp.rank)

  const sortedRanks = [...ranksSet].sort((a, b) => a - b)
  const isPrepSlotted = l.castingType === 'prepared' && !l.flexible

  return sortedRanks.map((rank) => {
    const items = l.spells
      .filter((row) => {
        if (row.rank !== rank) return false
        if (!needle) return true
        const n1 = spellName(row).toLowerCase()
        const n2 = spellSecondary(row).toLowerCase()
        return n1.includes(needle) || n2.includes(needle) || (row.notes ?? '').toLowerCase().includes(needle)
      })
      .sort((a, b) => spellName(a).localeCompare(spellName(b), lang.value === 'ru' ? 'ru' : 'en'))

    const maxSlots = rank > 0 ? (l.slotsMax[rank] ?? 0) : 0
    const preparedSum = items.reduce((s, r) => s + Math.max(1, r.preparedCount ?? 1), 0)
    const usedShared = l.slotsUsed[rank] ?? 0

    // Flatten prepared entries into individual visual slot rows when castingType === 'prepared' && !flexible
    const filledSlots: PreparedSlotView[] = []
    if (isPrepSlotted && rank > 0) {
      for (const row of items) {
        const cnt = Math.max(1, row.preparedCount ?? 1)
        const exp = row.expendedCount ?? 0
        const cat = row.spellId ? catalog.spellsById.value.get(row.spellId) ?? null : null
        for (let k = 0; k < cnt; k++) {
          filledSlots.push({
            key: `${row.id}:${k}`,
            row,
            slotIdx: k,
            expended: k < exp,
            cat,
          })
        }
      }
    }
    const emptySlotCount = isPrepSlotted && rank > 0 && maxSlots > 0 ? Math.max(0, maxSlots - filledSlots.length) : 0

    return {
      rank,
      items,
      maxSlots,
      preparedSum,
      usedShared,
      isSlotted: isPrepSlotted && rank > 0 && maxSlots > 0,
      filledSlots,
      emptySlotCount,
    }
  })
})

const stats = computed(() => (activeList.value ? computeSpellStats(props.character.level, activeList.value) : null))
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`)
</script>

<template>
  <div class="stack">
    <!-- Top bar: Entry pills + Add Entry + Daily Rest + Lang -->
    <div class="card card-pad stack-sm">
      <div class="row gap-sm wrap">
        <div class="row gap-sm wrap grow">
          <button
            v-for="l in character.spellLists"
            :key="l.id"
            type="button"
            class="entry-pill"
            :class="{ on: activeList?.id === l.id }"
            @click="activeListId = l.id"
          >
            <span
              v-if="l.tradition"
              class="ep-dot"
              :style="{ background: PF2E_TRADITIONS.find((x) => x.id === l.tradition)?.color }"
            />
            <b>{{ l.name }}</b>
            <span class="faint small">({{ l.spells.length }})</span>
          </button>
          <button type="button" class="btn btn-sm btn-primary" @click="openNewEntry">
            <Icon name="plus" :size="14" /> Новый список
          </button>
        </div>

        <button v-if="character.spellLists.length" type="button" class="btn btn-sm" title="Восстановить все ячейки, очки фокуса и использования" @click="dailyRest">
          <Icon name="bed-double" :size="14" /> <span :class="{ 'hide-sm': compact }">Отдых</span>
        </button>

        <div v-if="!compact" class="lang-switch" role="group" aria-label="Язык заклинаний">
          <button type="button" :class="{ on: lang === 'ru' }" @click="setLang('ru')">RU</button>
          <button type="button" :class="{ on: lang === 'en' }" @click="setLang('en')">EN</button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!activeList" class="empty" style="padding: 20px">
        <Icon name="sparkles" :size="28" />
        <p class="small">У персонажа пока нет списков заклинаний. Создайте список (по шаблону класса или вручную), и сможете перетаскивать заклинания прямо в ячейки.</p>
        <button type="button" class="btn btn-primary btn-sm" @click="openNewEntry"><Icon name="plus" :size="14" /> Создать список заклинаний</button>
      </div>

      <!-- Active Entry Summary Header -->
      <template v-else>
        <div class="entry-head">
          <div class="row gap wrap grow">
            <div>
              <div class="row gap-sm wrap">
                <h3 style="margin: 0; font-size: 20px">{{ activeList.name }}</h3>
                <span class="badge">{{ PF2E_CASTING_TYPES.find((x) => x.id === activeList!.castingType)?.ru }}</span>
                <span v-if="activeList.flexible" class="badge badge-public">Гибкий</span>
                <span
                  v-if="activeList.tradition"
                  class="trad-badge"
                  :style="{ '--tc': PF2E_TRADITIONS.find((x) => x.id === activeList!.tradition)?.color }"
                >
                  {{ PF2E_TRADITIONS.find((x) => x.id === activeList!.tradition)?.[lang] }}
                </span>
              </div>
              <div class="faint small" style="margin-top: 2px">
                {{ PF2E_ATTRIBUTES.find((x) => x.id === activeList!.keyAttr)?.shortRu }} {{ signed(activeList.keyMod) }}
                · {{ PF2E_PROFICIENCIES.find((x) => x.rank === activeList!.proficiency)?.ru }}
                <template v-if="activeList.notes"> · {{ activeList.notes }}</template>
              </div>
            </div>

            <div v-if="stats && activeList.castingType !== 'ritual'" class="row gap-sm">
              <div class="stat-box">
                <span class="faint small">Атака</span>
                <b>{{ signed(stats.attack) }}</b>
              </div>
              <div class="stat-box">
                <span class="faint small">КС</span>
                <b>{{ stats.dc }}</b>
              </div>
            </div>

            <!-- Focus Pool Pips -->
            <div v-if="activeList.castingType === 'focus'" class="stat-box">
              <span class="faint small">Фокус ({{ activeList.focusCurrent ?? 0 }}/{{ activeList.focusMax ?? 1 }})</span>
              <div class="row gap-sm" style="margin-top: 2px">
                <button
                  v-for="i in (activeList.focusMax ?? 1)"
                  :key="i"
                  type="button"
                  class="focus-pip"
                  :class="{ on: i <= (activeList.focusCurrent ?? 0) }"
                  :title="i <= (activeList.focusCurrent ?? 0) ? 'Потратить очко фокуса' : 'Восстановить очко фокуса'"
                  @click="setFocusPoints(i)"
                />
              </div>
            </div>
          </div>

          <div class="row gap-sm wrap">
            <button v-if="!compact" type="button" class="btn btn-sm btn-primary" @click="openSpellPicker(null)">
              <Icon name="book-open" :size="14" /> Библиотека рядом
            </button>
            <button type="button" class="btn btn-sm" @click="openCustomSpell(activeList.castingType === 'focus' ? cantripRank : 1)">
              <Icon name="plus" :size="14" /> Своё
            </button>
            <button type="button" class="icon-btn" title="Настройки списка" @click="openEditEntry(activeList)"><Icon name="settings" :size="16" /></button>
            <button type="button" class="icon-btn danger" title="Удалить список" @click="deleteEntry(activeList)"><Icon name="trash2" :size="16" /></button>
          </div>
        </div>

        <div class="row gap-sm wrap">
          <input v-model="searchQ" type="text" class="input input-sm" style="max-width: 260px" placeholder="Фильтр по этому списку…" />
          <span class="faint small">Заговоры/фокус (ур. {{ character.level }}): <b>{{ cantripRank }} круг</b></span>
          <span v-if="compact" class="faint small hide-sm">· Перетащите заклинание в нужный круг или ячейку</span>
        </div>
      </template>
    </div>

    <!-- Rank Sections (each is a Drop Target!) -->
    <template v-if="activeList">
      <div v-if="!rankGroups.length" class="card empty">
        <p class="muted">В этом списке пока нет заклинаний.</p>
      </div>

      <section
        v-for="g in rankGroups"
        :key="g.rank"
        class="card rank-sec"
        :class="{
          'drop-valid': isSpellDrag() && canDropInRank(draggingSpell, g.rank),
          'drop-invalid': isSpellDrag() && !canDropInRank(draggingSpell, g.rank),
          'drop-over': dragOverKey === `rank:${g.rank}`,
        }"
        @dragover="onDragOverTarget($event, `rank:${g.rank}`, g.rank)"
        @dragleave="onDragLeaveTarget(`rank:${g.rank}`)"
        @drop="handleDropSpell($event, g.rank)"
      >
        <header class="rs-head">
          <div class="row gap-sm wrap grow">
            <h4 style="margin: 0; font-size: 16.5px">
              <template v-if="g.rank === 0">Заговоры <span class="faint small">(круг {{ cantripRank }})</span></template>
              <template v-else-if="activeList.castingType === 'focus'">Фокусные — база {{ g.rank }} <span class="faint small">(круг {{ Math.max(g.rank, cantripRank) }})</span></template>
              <template v-else-if="activeList.castingType === 'ritual'">Ритуалы {{ g.rank }} круга</template>
              <template v-else>Круг {{ g.rank }}</template>
            </h4>

            <!-- Spontaneous / Flexible shared slots -->
            <div v-if="g.rank > 0 && (activeList.castingType === 'spontaneous' || activeList.flexible) && g.maxSlots > 0" class="row gap-sm">
              <span class="small muted">{{ g.maxSlots - g.usedShared }}/{{ g.maxSlots }}</span>
              <div class="row" style="gap: 4px">
                <button
                  v-for="si in g.maxSlots"
                  :key="si"
                  type="button"
                  class="slot-box"
                  :class="{ used: si - 1 < g.usedShared }"
                  :title="si - 1 < g.usedShared ? 'Восстановить ячейку' : 'Потратить ячейку'"
                  @click="toggleSharedSlot(g.rank, si - 1)"
                />
              </div>
            </div>

            <!-- Prepared slots counter -->
            <span
              v-else-if="g.rank > 0 && activeList.castingType === 'prepared' && !activeList.flexible && g.maxSlots > 0"
              class="badge"
              :class="{ 'badge-dead': g.preparedSum > g.maxSlots, 'badge-public': g.preparedSum === g.maxSlots }"
            >
              Ячейки: {{ g.preparedSum }}/{{ g.maxSlots }}
            </span>

            <span v-if="isSpellDrag() && !canDropInRank(draggingSpell, g.rank) && draggingSpell" class="faint small">
              (мин. {{ draggingSpell.cat === 'cantrip' ? 'Заговоры' : `${draggingSpell.baseRank} круг` }})
            </span>
          </div>

          <button v-if="!compact" type="button" class="btn btn-sm btn-ghost" @click="openSpellPicker(g.rank)">
            <Icon name="plus" :size="13" /> Добавить
          </button>
        </header>

        <!-- ==================== MODE A: PREPARED EXPLICIT VISUAL SLOTS ==================== -->
        <div v-if="g.isSlotted" class="sp-rows">
          <!-- Filled prepared slots -->
          <div
            v-for="(slot, idx) in g.filledSlots"
            :key="slot.key"
            class="sp-row prep-slot"
            :class="{
              expended: slot.expended,
              'slot-over': dragOverKey === `slot:${g.rank}:${slot.key}`,
            }"
            draggable="true"
            @dragstart="onRowDragStart($event, slot.row)"
            @dragend="endPf2eDrag()"
            @dragover.stop="onDragOverTarget($event, `slot:${g.rank}:${slot.key}`, g.rank)"
            @dragleave.stop="onDragLeaveTarget(`slot:${g.rank}:${slot.key}`)"
            @drop.stop="handleDropSpell($event, g.rank, { rowId: slot.row.id, slotIdx: slot.slotIdx })"
          >
            <button
              type="button"
              class="slot-box"
              :class="{ used: slot.expended }"
              :title="slot.expended ? 'Восстановить ячейку' : 'Отметить ячейку потраченной'"
              @click="togglePreparedCast(slot.row, slot.slotIdx)"
            />
            <span class="slot-num" :class="{ over: idx >= g.maxSlots }">#{{ idx + 1 }}</span>
            <img v-if="spellImg(slot.row)" :src="spellImg(slot.row)" alt="" class="pf-sp-ic" loading="lazy" decoding="async" />

            <div
              role="button"
              :tabindex="slot.row.spellId ? 0 : -1"
              class="sp-main grow"
              :class="{ disabled: !slot.row.spellId }"
              @click="slot.row.spellId && openSpellPreview(slot.row)"
              @keydown.enter.prevent="slot.row.spellId && openSpellPreview(slot.row)"
            >
              <span class="row gap-sm wrap" style="align-items: center">
                <b class="ellipsis">{{ spellName(slot.row) }}</b>
                <span v-if="slot.cat" class="pf-act-sm">
                  {{ formatActionSymbol(slot.cat.time, lang, slot.cat.timeRu).glyph ?? formatActionSymbol(slot.cat.time, lang, slot.cat.timeRu).text }}
                </span>
                <span
                  v-if="spellDamageBadge(slot.cat, g.rank)"
                  class="dmg-pill"
                  :class="{ heightened: spellDamageBadge(slot.cat, g.rank)!.heightened }"
                  :title="spellDamageBadge(slot.cat, g.rank)!.title"
                >
                  🎲 {{ spellDamageBadge(slot.cat, g.rank)!.label }}
                </span>
                <span v-if="slot.cat && g.rank > slot.cat.baseRank" class="badge badge-public" style="font-size: 10.5px" :title="`Усилено с ${slot.cat.baseRank} круга`">
                  ↑{{ g.rank }}
                </span>
                <span v-if="!slot.row.spellId" class="badge">Своё</span>
              </span>
              <span v-if="slot.row.notes || (!compact && spellSecondary(slot.row))" class="faint small ellipsis">
                <template v-if="!compact">{{ spellSecondary(slot.row) }}</template>
                <template v-if="!compact && spellSecondary(slot.row) && slot.row.notes"> · </template>
                <template v-if="slot.row.notes">{{ slot.row.notes }}</template>
              </span>
            </div>

            <span v-if="dragOverKey === `slot:${g.rank}:${slot.key}`" class="drop-pill">
              {{ dropHintFor(draggingSpell, g.rank, true) }}
            </span>
            <template v-else>
              <button type="button" class="icon-btn" title="Настроить" @click="editRow = { ...slot.row }"><Icon name="pencil" :size="13" /></button>
              <button type="button" class="icon-btn danger" title="Очистить ячейку" @click="removeOnePreparedSlot(slot.row)"><Icon name="x" :size="14" /></button>
            </template>
          </div>

          <!-- Empty prepared slot drop zones -->
          <div
            v-for="ei in g.emptySlotCount"
            :key="`empty-${g.rank}-${ei}`"
            class="empty-slot"
            :class="{
              'slot-valid': isSpellDrag() && canDropInRank(draggingSpell, g.rank),
              'slot-over': dragOverKey === `slot:${g.rank}:empty:${ei}`,
            }"
            @dragover.stop="onDragOverTarget($event, `slot:${g.rank}:empty:${ei}`, g.rank)"
            @dragleave.stop="onDragLeaveTarget(`slot:${g.rank}:empty:${ei}`)"
            @drop.stop="handleDropSpell($event, g.rank)"
          >
            <span class="slot-num">#{{ g.filledSlots.length + ei }}</span>
            <span v-if="dragOverKey === `slot:${g.rank}:empty:${ei}`" class="empty-slot-msg active">
              <Icon name="plus" :size="13" /> {{ dropHintFor(draggingSpell, g.rank) }}
            </span>
            <span v-else class="empty-slot-msg">
              Пустая ячейка {{ g.rank }} круга — перетащите заклинание сюда
            </span>
          </div>
        </div>

        <!-- ==================== MODE B: SPONTANEOUS / FLEXIBLE / CANTRIPS / FOCUS / INNATE / RITUAL ==================== -->
        <template v-else>
          <div v-if="!g.items.length" class="empty-cat" :class="{ active: dragOverKey === `rank:${g.rank}` }">
            <template v-if="dragOverKey === `rank:${g.rank}`">
              <Icon name="plus" :size="14" /> {{ dropHintFor(draggingSpell, g.rank) }}
            </template>
            <template v-else>
              Пусто — перетащите сюда заклинание{{ g.rank === 0 ? ' (заговор)' : ` (${g.rank} круг)` }}
            </template>
          </div>
          <div v-else class="sp-rows">
            <div
              v-for="row in g.items"
              :key="row.id"
              class="sp-row"
              draggable="true"
              @dragstart="onRowDragStart($event, row)"
              @dragend="endPf2eDrag()"
            >
              <img v-if="spellImg(row)" :src="spellImg(row)" alt="" class="pf-sp-ic" loading="lazy" decoding="async" />
              <div
                role="button"
                :tabindex="row.spellId ? 0 : -1"
                class="sp-main grow"
                :class="{ disabled: !row.spellId }"
                @click="row.spellId && openSpellPreview(row)"
                @keydown.enter.prevent="row.spellId && openSpellPreview(row)"
              >
                <span class="row gap-sm wrap" style="align-items: center">
                  <b class="ellipsis">{{ spellName(row) }}</b>
                  <span v-if="row.spellId && catalog.spellsById.value.get(row.spellId)" class="pf-act-sm">
                    {{ formatActionSymbol(catalog.spellsById.value.get(row.spellId)!.time, lang, catalog.spellsById.value.get(row.spellId)!.timeRu).glyph ?? formatActionSymbol(catalog.spellsById.value.get(row.spellId)!.time, lang, catalog.spellsById.value.get(row.spellId)!.timeRu).text }}
                  </span>
                  <span
                    v-if="row.spellId && spellDamageBadge(catalog.spellsById.value.get(row.spellId), g.rank)"
                    class="dmg-pill"
                    :class="{ heightened: spellDamageBadge(catalog.spellsById.value.get(row.spellId), g.rank)!.heightened }"
                    :title="spellDamageBadge(catalog.spellsById.value.get(row.spellId), g.rank)!.title"
                  >
                    🎲 {{ spellDamageBadge(catalog.spellsById.value.get(row.spellId), g.rank)!.label }}
                  </span>
                  <span v-if="row.spellId && g.rank > (catalog.spellsById.value.get(row.spellId)?.baseRank ?? g.rank)" class="badge badge-public" style="font-size: 10.5px">
                    ↑{{ g.rank }}
                  </span>
                  <span v-if="row.signature" class="badge" title="Фирменное заклинание (можно творить на любом круге)">★</span>
                  <span v-if="!row.spellId" class="badge">Своё</span>
                </span>
                <span v-if="row.notes || (!compact && spellSecondary(row))" class="faint small ellipsis">
                  <template v-if="!compact">{{ spellSecondary(row) }}</template>
                  <template v-if="!compact && spellSecondary(row) && row.notes"> · </template>
                  <template v-if="row.notes">{{ row.notes }}</template>
                </span>
              </div>

              <!-- Spontaneous: signature toggle -->
              <button
                v-if="g.rank > 0 && activeList.castingType === 'spontaneous'"
                type="button"
                class="icon-btn"
                :class="{ on: row.signature }"
                title="Фирменное заклинание"
                @click="toggleSignature(row)"
              >
                <Icon name="star" :size="14" />
              </button>

              <!-- Innate: uses per day or at-will -->
              <div v-if="activeList.castingType === 'innate'" class="row gap-sm">
                <span v-if="row.atWill" class="badge badge-public">По желанию</span>
                <div v-else class="mini-step">
                  <button type="button" @click="bumpInnateLeft(row, -1)">−</button>
                  <span>{{ row.usesLeft ?? row.usesMax ?? 1 }}/{{ row.usesMax ?? 1 }}</span>
                  <button type="button" @click="bumpInnateLeft(row, 1)">+</button>
                </div>
              </div>

              <button type="button" class="icon-btn" title="Настроить запись" @click="editRow = { ...row }"><Icon name="pencil" :size="13" /></button>
              <button type="button" class="icon-btn danger" title="Убрать" @click="removeSpellRow(row.id)"><Icon name="trash2" :size="13" /></button>
            </div>

            <!-- Live bottom drop banner while dragging over a non-empty rank category -->
            <div v-if="dragOverKey === `rank:${g.rank}`" class="cat-drop-banner">
              <Icon name="plus" :size="14" /> {{ dropHintFor(draggingSpell, g.rank) }}
            </div>
          </div>
        </template>
      </section>
    </template>

    <!-- ENTRY SETTINGS MODAL -->
    <Modal v-if="entryModal" :title="entryModal.id ? 'Настройки списка заклинаний' : 'Новый список заклинаний'" width="620px" @close="entryModal = null">
      <form class="stack" @submit.prevent="saveEntryModal">
        <label class="field">
          <span>Быстрый шаблон класса (необязательно — заполнит ячейки по ур. {{ character.level }})</span>
          <select :value="entryModal.classPreset" class="input" @change="applyClassPreset(($event.target as HTMLSelectElement).value)">
            <option value="">— настроить вручную —</option>
            <option v-for="p in PF2E_CLASS_PRESETS" :key="p.id" :value="p.id">{{ p.ru }}</option>
          </select>
        </label>

        <div class="row gap">
          <label class="field grow">
            <span>Название списка *</span>
            <input v-model="entryModal.name" type="text" class="input" placeholder="Например: Заклинания волшебника" autofocus />
          </label>
          <label class="field" style="width: 190px">
            <span>Тип сотворения</span>
            <select v-model="entryModal.castingType" class="input">
              <option v-for="t in PF2E_CASTING_TYPES" :key="t.id" :value="t.id">{{ t.ru }}</option>
            </select>
          </label>
        </div>

        <div class="row gap wrap">
          <label v-if="entryModal.castingType !== 'ritual'" class="field grow">
            <span>Традиция</span>
            <select v-model="entryModal.tradition" class="input">
              <option value="">— любая / без традиции —</option>
              <option v-for="t in PF2E_TRADITIONS" :key="t.id" :value="t.id">{{ t.ru }} ({{ t.en }})</option>
            </select>
          </label>
          <label class="field" style="width: 150px">
            <span>Ключ. хар.</span>
            <select v-model="entryModal.keyAttr" class="input">
              <option v-for="a in PF2E_ATTRIBUTES" :key="a.id" :value="a.id">{{ a.ru }} ({{ a.shortRu }})</option>
            </select>
          </label>
          <label class="field" style="width: 100px">
            <span>Мод. хар.</span>
            <input v-model.number="entryModal.keyMod" type="number" min="-5" max="10" class="input" />
          </label>
        </div>

        <div v-if="entryModal.castingType !== 'ritual'" class="row gap wrap">
          <label class="field grow">
            <span>Мастерство заклинаний</span>
            <select v-model.number="entryModal.proficiency" class="input">
              <option v-for="p in PF2E_PROFICIENCIES" :key="p.rank" :value="p.rank">{{ p.ru }} (+{{ p.bonus }})</option>
            </select>
          </label>
          <label class="field" style="width: 115px">
            <span>Бонус атаки</span>
            <input v-model.number="entryModal.bonusAttack" type="number" min="-10" max="10" class="input" />
          </label>
          <label class="field" style="width: 115px">
            <span>Бонус КС</span>
            <input v-model.number="entryModal.bonusDc" type="number" min="-10" max="10" class="input" />
          </label>
        </div>

        <label v-if="entryModal.castingType === 'prepared'" class="check small">
          <input v-model="entryModal.flexible" type="checkbox" /> Гибкий заклинатель (Flexible Spellcaster — общие ячейки на круг)
        </label>

        <label v-if="entryModal.castingType === 'focus'" class="field" style="max-width: 180px">
          <span>Максимум очков фокуса (1–3)</span>
          <input v-model.number="entryModal.focusMax" type="number" min="1" max="3" class="input" />
        </label>

        <div v-if="entryModal.castingType === 'prepared' || entryModal.castingType === 'spontaneous'" class="stack-sm">
          <span class="field-label">Ячейки заклинаний по кругам (1–10)</span>
          <div class="slots-grid">
            <label v-for="r in 10" :key="r" class="field">
              <span>{{ r }} круг</span>
              <input v-model.number="entryModal.slotsMax[r]" type="number" min="0" max="20" class="input input-sm" placeholder="0" />
            </label>
          </div>
        </div>

        <label class="field">
          <span>Заметки</span>
          <input v-model="entryModal.notes" type="text" class="input" placeholder="Школа магии, источник, домен, фамильяр…" />
        </label>

        <div class="row gap-sm" style="justify-content: flex-end">
          <button type="button" class="btn" @click="entryModal = null">Отмена</button>
          <button type="submit" class="btn btn-primary" :disabled="!entryModal.name.trim()"><Icon name="check" :size="14" /> Сохранить</button>
        </div>
      </form>
    </Modal>

    <!-- CUSTOM SPELL MODAL -->
    <Modal v-if="customModal" title="Своё заклинание" width="460px" @close="customModal = null">
      <form class="stack" @submit.prevent="submitCustomSpell">
        <label class="field"><span>Название *</span><input v-model="customModal.name" type="text" class="input" autofocus /></label>
        <label class="field"><span>Круг (0 = заговор)</span><input v-model.number="customModal.rank" type="number" min="0" max="10" class="input" /></label>
        <template v-if="activeList?.castingType === 'innate'">
          <label class="check small"><input v-model="customModal.atWill" type="checkbox" /> По желанию (неограниченно)</label>
          <label v-if="!customModal.atWill" class="field"><span>Использований в день</span><input v-model.number="customModal.usesMax" type="number" min="1" max="20" class="input" /></label>
        </template>
        <label class="field"><span>Заметка</span><textarea v-model="customModal.notes" class="input" rows="2" /></label>
        <div class="row gap-sm" style="justify-content: flex-end">
          <button type="button" class="btn" @click="customModal = null">Отмена</button>
          <button type="submit" class="btn btn-primary" :disabled="!customModal.name.trim()">Добавить</button>
        </div>
      </form>
    </Modal>

    <!-- EDIT ROW MODAL -->
    <Modal v-if="editRow" title="Настройки заклинания в списке" width="460px" @close="editRow = null">
      <form class="stack" @submit.prevent="saveEditRow">
        <label v-if="!editRow.spellId" class="field"><span>Название</span><input v-model="editRow.customName" type="text" class="input" /></label>
        <label class="field"><span>Круг в списке (0 = заговор, 1–10 = круг / усиление)</span><input v-model.number="editRow.rank" type="number" min="0" max="10" class="input" /></label>
        <template v-if="activeList?.castingType === 'innate'">
          <label class="check small"><input v-model="editRow.atWill" type="checkbox" /> По желанию</label>
          <label v-if="!editRow.atWill" class="field"><span>Макс. использований в день</span><input v-model.number="editRow.usesMax" type="number" min="1" max="20" class="input" /></label>
        </template>
        <label class="field"><span>Заметка</span><textarea v-model="editRow.notes" class="input" rows="2" placeholder="Например: от божества, из посоха, усилить…" /></label>
        <div class="row gap-sm" style="justify-content: flex-end">
          <button type="button" class="btn" @click="editRow = null">Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Modal>

    <!-- VIEW SPELL CARD MODAL (pre-scaled to the slot's exact rank!) -->
    <Modal v-if="viewingSpell" width="760px" @close="viewingSpell = null">
      <Pf2eSpellCard :spell="viewingSpell" :meta="catalog.meta.value" :lang="lang" :initial-rank="viewingSpellRank" :actor-level="character.level" />
    </Modal>
  </div>
</template>

<style scoped>
.entry-pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--border-strong); background: var(--surface-2); cursor: pointer; font-size: 13px;
}
.entry-pill:hover { border-color: var(--accent); }
.entry-pill.on { background: var(--accent-soft); border-color: var(--accent); }
.ep-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }

.lang-switch { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.lang-switch button { border: 0; background: var(--surface-2); padding: 4px 9px; font-size: 12px; font-weight: 700; cursor: pointer; color: var(--text-muted); }
.lang-switch button.on { background: var(--accent); color: var(--accent-fg); }

.entry-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 9px 11px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border);
}
.trad-badge {
  display: inline-flex; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  background: color-mix(in srgb, var(--tc) 18%, transparent); border: 1px solid color-mix(in srgb, var(--tc) 45%, transparent);
}
.stat-box {
  display: flex; flex-direction: column; align-items: center; padding: 3px 10px; border-radius: var(--radius-sm);
  background: var(--surface); border: 1px solid var(--border); min-width: 58px;
}
.stat-box b { font-family: var(--font-head); font-size: 20px; line-height: 1.05; color: var(--accent); }
.focus-pip {
  width: 15px; height: 15px; border-radius: 50%; border: 2px solid var(--secret); background: transparent; cursor: pointer; padding: 0;
}
.focus-pip.on { background: var(--secret); }

.rank-sec { overflow: hidden; transition: border-color .14s, opacity .14s, box-shadow .14s; }
.rank-sec.drop-valid { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.rank-sec.drop-invalid { opacity: .48; }
.rank-sec.drop-over { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

.rs-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; background: var(--surface-2); border-bottom: 1px solid var(--border);
}
.slot-box {
  width: 18px; height: 18px; border-radius: 4px; border: 2px solid var(--accent); background: var(--accent-soft);
  cursor: pointer; padding: 0; flex-shrink: 0;
}
.slot-box.used { background: var(--surface-3); border-color: var(--border-strong); opacity: .5; }
.slot-num { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: var(--text-faint); width: 22px; flex-shrink: 0; }
.slot-num.over { color: var(--danger); }

.sp-rows { display: flex; flex-direction: column; }
.sp-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--border);
  cursor: grab; transition: background .1s;
}
.sp-row:last-child { border-bottom: 0; }
.sp-row:hover { background: var(--surface-2); }
.sp-row.expended { opacity: .58; }
.sp-row.expended .sp-main b { text-decoration: line-through; }
.sp-row.slot-over { background: var(--accent-soft); outline: 2px dashed var(--accent); outline-offset: -2px; }

.pf-sp-ic { width: 28px; height: 28px; border-radius: 5px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); background: var(--surface-2); }
.sp-main { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; min-width: 0; }
.sp-main:not(.disabled):hover b { color: var(--accent); }
.sp-main.disabled { cursor: default; }
.pf-act-sm { color: var(--accent); font-weight: 700; font-size: 13px; }

.dmg-pill {
  display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 5px;
  font-size: 11.5px; font-weight: 700; font-family: var(--font-ui); white-space: nowrap;
  background: color-mix(in srgb, var(--danger) 12%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border)); color: var(--text);
}
.dmg-pill.heightened {
  background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.empty-slot {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px dashed var(--border); background: color-mix(in srgb, var(--surface-2) 55%, transparent);
  transition: background .12s, border-color .12s;
}
.empty-slot:last-child { border-bottom: 0; }
.empty-slot.slot-valid { background: color-mix(in srgb, var(--accent) 7%, var(--surface)); border-bottom-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.empty-slot.slot-over { background: var(--accent-soft); outline: 2px dashed var(--accent); outline-offset: -2px; }
.empty-slot-msg { font-size: 12.5px; color: var(--text-faint); display: inline-flex; align-items: center; gap: 4px; }
.empty-slot-msg.active { color: var(--accent); font-weight: 700; }

.empty-cat {
  padding: 12px 14px; font-size: 12.5px; color: var(--text-faint);
  display: flex; align-items: center; gap: 6px; transition: background .12s, color .12s;
}
.empty-cat.active { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
.cat-drop-banner {
  padding: 8px 12px; background: var(--accent-soft); color: var(--accent); font-size: 12.5px; font-weight: 700;
  display: flex; align-items: center; gap: 6px; border-top: 2px dashed var(--accent);
}
.drop-pill {
  padding: 2px 8px; border-radius: 999px; background: var(--accent); color: var(--accent-fg);
  font-size: 11.5px; font-weight: 700; white-space: nowrap;
}

.mini-step { display: inline-flex; align-items: center; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; background: var(--surface); font-size: 12.5px; }
.mini-step button { width: 22px; height: 24px; border: 0; background: var(--surface-2); cursor: pointer; font-weight: 700; }
.mini-step button:hover { background: var(--accent-soft); color: var(--accent); }
.mini-step span { padding: 0 7px; font-family: var(--font-mono); font-weight: 600; }

.slots-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 600px) { .slots-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
