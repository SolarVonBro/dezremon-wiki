<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type {
  Pf2eCarryType, Pf2eCharacter, Pf2eCoins, Pf2eContainer, Pf2eInventoryItem, Pf2eItemIndex, Pf2eItemType,
} from '@/model/pf2e'
import { ensurePf2eItems, usePf2eCatalog } from '@/data/pf2eCatalog'
import { computeCharacterBulk, formatLight, formatPriceCp, formatUnitBulk } from '@/data/pf2eBulk'
import { ITEM_TYPE_LABEL, pf2eIconUrl } from '@/data/pf2eFormat'
import { endPf2eDrag, startPf2eDrag, usePf2eDrag } from '@/data/pf2eDrag'
import { setItemPickTarget } from '@/data/pf2eWorkspace'
import { randomId } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Pf2eItemCard from './Pf2eItemCard.vue'
import { toast } from '@/components/common/toast'

const props = withDefaults(defineProps<{
  character: Pf2eCharacter
  compact?: boolean
}>(), { compact: false })
const emit = defineEmits<{
  patch: [p: Partial<Omit<Pf2eCharacter, 'id' | 'createdAt'>>]
}>()

const router = useRouter()
const catalog = usePf2eCatalog()
const { currentDrag } = usePf2eDrag()
const lang = catalog.lang
const setLang = catalog.setLang
onMounted(() => { void ensurePf2eItems() })

const summary = computed(() => computeCharacterBulk(props.character, catalog.itemsById.value))
const containersById = computed(() => new Map(props.character.containers.map((c) => [c.id, c])))

// ==================== View / Filter / Sort Controls ====================
type GroupMode = 'containers' | 'type' | 'group' | 'carry' | 'flat'
type SortMode = 'order' | 'name' | 'bulk' | 'price' | 'level' | 'qty' | 'type'

const groupMode = ref<GroupMode>('containers')
const sortBy = ref<SortMode>('order')
const sortDir = ref<1 | -1>(1)
const searchQ = ref('')
const filterType = ref<string>('')
const filterGroup = ref<string>('')
const filterCarry = ref<string>('')
const filterInvestedOnly = ref(false)
const showWallet = ref(false)
const viewingItem = ref<Pf2eItemIndex | null>(null)

const allGroups = computed(() => {
  const s = new Set<string>(props.character.customGroups ?? [])
  for (const r of props.character.inventory) if (r.group.trim()) s.add(r.group.trim())
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'))
})

const CARRY_LABEL: Record<Pf2eCarryType, string> = {
  held: 'В руках',
  worn: 'Надето',
  stowed: 'В контейнере',
  dropped: 'Сброшено / В лагере',
}

function itemName(row: Pf2eInventoryItem): string {
  if (row.name.trim()) return row.name.trim()
  const cat = row.itemId ? catalog.itemsById.value.get(row.itemId) : undefined
  if (!cat) return 'Предмет'
  return lang.value === 'ru' ? cat.ru : cat.en
}

function itemSubName(row: Pf2eInventoryItem): string {
  const cat = row.itemId ? catalog.itemsById.value.get(row.itemId) : undefined
  if (!cat) return ''
  if (row.name.trim()) return lang.value === 'ru' ? cat.ru : cat.en
  return lang.value === 'ru' ? cat.en : cat.ru
}

function itemTypeOf(row: Pf2eInventoryItem): Pf2eItemType {
  if (row.customType) return row.customType
  const cat = row.itemId ? catalog.itemsById.value.get(row.itemId) : undefined
  return cat?.type ?? 'equipment'
}

function itemLevelOf(row: Pf2eInventoryItem): number {
  if (row.levelOverride != null) return row.levelOverride
  const cat = row.itemId ? catalog.itemsById.value.get(row.itemId) : undefined
  return cat?.level ?? 0
}

function itemImg(row: Pf2eInventoryItem): string {
  const cat = row.itemId ? catalog.itemsById.value.get(row.itemId) : undefined
  return pf2eIconUrl(cat?.img)
}

function containerImg(c: Pf2eContainer): string {
  const cat = c.itemId ? catalog.itemsById.value.get(c.itemId) : undefined
  return pf2eIconUrl(cat?.img)
}

function passesFilter(row: Pf2eInventoryItem): boolean {
  if (filterInvestedOnly.value && !row.invested) return false
  if (filterType.value && itemTypeOf(row) !== filterType.value) return false
  if (filterGroup.value && (row.group.trim() || '—') !== filterGroup.value) return false
  if (filterCarry.value && row.carryType !== filterCarry.value) return false
  const needle = searchQ.value.trim().toLowerCase()
  if (needle) {
    const n1 = itemName(row).toLowerCase()
    const n2 = itemSubName(row).toLowerCase()
    const g = row.group.toLowerCase()
    const nt = row.notes.toLowerCase()
    if (!n1.includes(needle) && !n2.includes(needle) && !g.includes(needle) && !nt.includes(needle)) return false
  }
  return true
}

function sortItems(rows: Pf2eInventoryItem[]): Pf2eInventoryItem[] {
  const dir = sortDir.value
  const infoMap = summary.value.byItem
  return [...rows].sort((a, b) => {
    let cmp = 0
    if (sortBy.value === 'order') cmp = (a.order ?? 0) - (b.order ?? 0)
    else if (sortBy.value === 'name') cmp = itemName(a).localeCompare(itemName(b), lang.value === 'ru' ? 'ru' : 'en')
    else if (sortBy.value === 'bulk') cmp = (infoMap[a.id]?.totalLight ?? 0) - (infoMap[b.id]?.totalLight ?? 0)
    else if (sortBy.value === 'price') cmp = (infoMap[a.id]?.totalPriceCp ?? 0) - (infoMap[b.id]?.totalPriceCp ?? 0)
    else if (sortBy.value === 'level') cmp = itemLevelOf(a) - itemLevelOf(b)
    else if (sortBy.value === 'qty') cmp = (a.quantity || 0) - (b.quantity || 0)
    else if (sortBy.value === 'type') cmp = itemTypeOf(a).localeCompare(itemTypeOf(b))
    if (cmp !== 0) return cmp * dir
    return itemName(a).localeCompare(itemName(b), 'ru')
  })
}

const filteredItems = computed(() => sortItems(props.character.inventory.filter(passesFilter)))

// Grouped sections for non-container views
const groupedSections = computed(() => {
  const rows = filteredItems.value
  if (groupMode.value === 'flat') return [{ key: 'all', title: 'Все предметы', rows }]
  const m = new Map<string, { key: string; title: string; rows: Pf2eInventoryItem[] }>()
  for (const r of rows) {
    let key = ''
    let title = ''
    if (groupMode.value === 'type') {
      const t = itemTypeOf(r)
      key = t
      title = ITEM_TYPE_LABEL[t]?.[lang.value] ?? t
    } else if (groupMode.value === 'group') {
      key = r.group.trim() || '__none__'
      title = r.group.trim() || 'Без группы'
    } else if (groupMode.value === 'carry') {
      key = r.carryType
      title = CARRY_LABEL[r.carryType]
    }
    if (!m.has(key)) m.set(key, { key, title, rows: [] })
    m.get(key)!.rows.push(r)
  }
  return [...m.values()]
})

// Items outside any valid container (for container view)
const looseCarriedItems = computed(() =>
  filteredItems.value.filter((r) => r.carryType !== 'dropped' && !(r.carryType === 'stowed' && r.containerId && containersById.value.has(r.containerId))),
)
const looseDroppedItems = computed(() =>
  filteredItems.value.filter((r) => r.carryType === 'dropped'),
)
function itemsInContainer(cid: string): Pf2eInventoryItem[] {
  return filteredItems.value.filter((r) => r.carryType === 'stowed' && r.containerId === cid)
}
const sortedContainers = computed(() => [...props.character.containers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))

// ==================== Mutations ====================
function saveInv(inventory: Pf2eInventoryItem[]) { emit('patch', { inventory }) }
function saveContainers(containers: Pf2eContainer[]) { emit('patch', { containers }) }

function updateCoins(patch: Partial<Pf2eCoins>) {
  emit('patch', { coins: { ...props.character.coins, ...patch } })
}

function updateLimits(patch: Partial<Pick<Pf2eCharacter, 'strMod' | 'bulkBonus' | 'maxInvested'>>) {
  emit('patch', patch)
}

function bumpQty(row: Pf2eInventoryItem, delta: number) {
  const nextQty = Math.max(0, (row.quantity || 0) + delta)
  saveInv(props.character.inventory.map((x) => (x.id === row.id ? { ...x, quantity: nextQty } : x)))
}

function toggleInvested(row: Pf2eInventoryItem) {
  saveInv(props.character.inventory.map((x) => (x.id === row.id ? { ...x, invested: !x.invested } : x)))
}

function setRowLocation(row: Pf2eInventoryItem, val: string) {
  let carryType: Pf2eCarryType = 'held'
  let containerId: string | null = null
  if (val === 'worn' || val === 'held' || val === 'dropped') {
    carryType = val
  } else if (val.startsWith('c:')) {
    carryType = 'stowed'
    containerId = val.slice(2)
  }
  saveInv(props.character.inventory.map((x) => (x.id === row.id ? { ...x, carryType, containerId } : x)))
}

function rowLocationValue(row: Pf2eInventoryItem): string {
  if (row.carryType === 'stowed' && row.containerId && containersById.value.has(row.containerId)) return 'c:' + row.containerId
  return row.carryType === 'stowed' ? 'held' : row.carryType
}

function moveItemOrder(row: Pf2eInventoryItem, delta: -1 | 1) {
  const inv = [...props.character.inventory].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const idx = inv.findIndex((x) => x.id === row.id)
  const target = idx + delta
  if (idx < 0 || target < 0 || target >= inv.length) return
  const [moved] = inv.splice(idx, 1)
  inv.splice(target, 0, moved)
  saveInv(inv.map((x, i) => ({ ...x, order: i })))
}

function removeItem(row: Pf2eInventoryItem) {
  saveInv(props.character.inventory.filter((x) => x.id !== row.id))
}

function setContainerLocation(c: Pf2eContainer, val: string) {
  let carryType: Pf2eCarryType = 'worn'
  let parentContainerId: string | null = null
  if (val === 'worn' || val === 'held' || val === 'dropped') {
    carryType = val
  } else if (val.startsWith('c:')) {
    const pid = val.slice(2)
    if (pid === c.id) return
    carryType = 'stowed'
    parentContainerId = pid
  }
  saveContainers(props.character.containers.map((x) => (x.id === c.id ? { ...x, carryType, parentContainerId } : x)))
}

function containerLocationValue(c: Pf2eContainer): string {
  if (c.carryType === 'stowed' && c.parentContainerId && containersById.value.has(c.parentContainerId)) return 'c:' + c.parentContainerId
  return c.carryType === 'stowed' ? 'held' : c.carryType
}

function toggleContainerCollapse(c: Pf2eContainer) {
  saveContainers(props.character.containers.map((x) => (x.id === c.id ? { ...x, collapsed: !x.collapsed } : x)))
}

function deleteContainer(c: Pf2eContainer) {
  if (!confirm(`Удалить контейнер «${c.name}»? Предметы внутри не удалятся, а перейдут в «Вне контейнеров».`)) return
  const containers = props.character.containers
    .filter((x) => x.id !== c.id)
    .map((x) => (x.parentContainerId === c.id ? { ...x, parentContainerId: null, carryType: 'held' as Pf2eCarryType } : x))
  const inventory = props.character.inventory.map((r) =>
    r.containerId === c.id ? { ...r, containerId: null, carryType: 'held' as Pf2eCarryType } : r,
  )
  const coins = props.character.coins.containerId === c.id ? { ...props.character.coins, containerId: null } : props.character.coins
  emit('patch', { containers, inventory, coins })
}

// ==================== Full-Page Item Library Navigation & Drag-and-Drop ====================
function openItemPicker(containerId = '', initType: Pf2eItemType | '' = '') {
  setItemPickTarget(props.character.id, containerId)
  void router.push({
    name: 'toolPf2e',
    params: { tab: 'items' },
    query: {
      for: props.character.id,
      ...(containerId ? { container: containerId } : {}),
      ...(initType ? { type: initType } : {}),
    },
  })
}

const invDragOver = ref<string | null>(null) // 'loose' | 'c:<id>' | 'new-container'
const isItemDrag = computed(() => {
  const d = currentDrag.value
  return Boolean(d && (d.kind === 'library-item' || d.kind === 'char-item'))
})
const draggingContainerItem = computed(() => {
  const d = currentDrag.value
  return d?.kind === 'library-item' && (d.item.type === 'backpack' || d.item.capacity > 0)
})

function onInvRowDragStart(e: DragEvent, row: Pf2eInventoryItem) {
  const cat = row.itemId ? catalog.itemsById.value.get(row.itemId) ?? null : null
  startPf2eDrag({ kind: 'char-item', row, item: cat })
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `pf2e-char-item:${row.id}`)
  }
}

function onInvDragOver(e: DragEvent, key: string) {
  if (!isItemDrag.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = currentDrag.value?.kind === 'char-item' ? 'move' : 'copy'
  invDragOver.value = key
}

function onInvDragLeave(key: string) {
  if (invDragOver.value === key) invDragOver.value = null
}

function handleInvDrop(e: DragEvent, target: 'loose' | 'new-container' | `c:${string}`) {
  e.preventDefault()
  invDragOver.value = null
  const d = currentDrag.value
  if (!d || (d.kind !== 'library-item' && d.kind !== 'char-item')) return

  if (d.kind === 'library-item') {
    const it = d.item
    if (target === 'new-container') {
      const newC: Pf2eContainer = {
        id: randomId(10),
        itemId: it.id,
        name: lang.value === 'ru' ? it.ru : it.en,
        carryType: it.usage.startsWith('worn') ? 'worn' : 'held',
        parentContainerId: null,
        bulk: it.bulk,
        bulkHeld: it.bulkHeld,
        capacity: it.capacity,
        ignored: it.ignored,
        extradimensional: it.extradimensional,
        invested: false,
        priceCp: it.priceCp,
        notes: '',
        order: props.character.containers.length,
      }
      saveContainers([...props.character.containers, newC])
      toast.success(`Контейнер «${newC.name}» добавлен`)
    } else {
      const cid = target.startsWith('c:') ? target.slice(2) : null
      const carryType: Pf2eCarryType = cid
        ? 'stowed'
        : it.usageGroup === 'worn' || it.usageGroup === 'worn-slot' || it.type === 'armor'
          ? 'worn'
          : 'held'
      saveInv([
        ...props.character.inventory,
        {
          id: randomId(10),
          itemId: it.id,
          name: '',
          quantity: it.bulkPer > 1 && it.bulkPer < 1000 ? it.bulkPer : 1,
          carryType,
          containerId: cid,
          group: '',
          invested: false,
          notes: '',
          order: props.character.inventory.length,
        },
      ])
      const cName = cid ? props.character.containers.find((x) => x.id === cid)?.name : 'На себе'
      toast.success(`${lang.value === 'ru' ? it.ru : it.en} → ${cName}`)
    }
  } else if (d.kind === 'char-item') {
    if (target === 'new-container') { endPf2eDrag(); return }
    const cid = target.startsWith('c:') ? target.slice(2) : null
    const carryType: Pf2eCarryType = cid ? 'stowed' : 'held'
    saveInv(props.character.inventory.map((x) => (x.id === d.row.id ? { ...x, carryType, containerId: cid } : x)))
  }

  endPf2eDrag()
}

// Container Presets & Modal
const CONTAINER_PRESETS: Array<{ label: string; data: Omit<Pf2eContainer, 'id' | 'order'> }> = [
  { label: 'Рюкзак (4 Б, игн. 2 Б)', data: { itemId: null, name: 'Рюкзак', carryType: 'worn', parentContainerId: null, bulk: 0, bulkHeld: 0.1, capacity: 4, ignored: 2, extradimensional: false, priceCp: 10 } },
  { label: 'Вместительный мешок I (25 Б)', data: { itemId: null, name: 'Вместительный мешок (Тип I)', carryType: 'held', parentContainerId: null, bulk: 1, bulkHeld: 1, capacity: 25, ignored: 25, extradimensional: true, priceCp: 7500 } },
  { label: 'Вместительный мешок II (50 Б)', data: { itemId: null, name: 'Вместительный мешок (Тип II)', carryType: 'held', parentContainerId: null, bulk: 1, bulkHeld: 1, capacity: 50, ignored: 50, extradimensional: true, priceCp: 30000 } },
  { label: 'Вместительный мешок III (100 Б)', data: { itemId: null, name: 'Вместительный мешок (Тип III)', carryType: 'held', parentContainerId: null, bulk: 1, bulkHeld: 1, capacity: 100, ignored: 100, extradimensional: true, priceCp: 120000 } },
  { label: 'Вместительный мешок IV (150 Б)', data: { itemId: null, name: 'Вместительный мешок (Тип IV)', carryType: 'held', parentContainerId: null, bulk: 1, bulkHeld: 1, capacity: 150, ignored: 150, extradimensional: true, priceCp: 240000 } },
  { label: 'Поясной кошель (4 Л)', data: { itemId: null, name: 'Поясной кошель', carryType: 'worn', parentContainerId: null, bulk: 0, bulkHeld: 0, capacity: 0.4, ignored: 0, extradimensional: false, priceCp: 4 } },
  { label: 'Мешок (8 Б)', data: { itemId: null, name: 'Мешок', carryType: 'held', parentContainerId: null, bulk: 0.1, bulkHeld: 0.1, capacity: 8, ignored: 0, extradimensional: false, priceCp: 1 } },
  { label: 'Сундук / Лагерь (не на себе)', data: { itemId: null, name: 'Лагерный сундук / Обоз', carryType: 'dropped', parentContainerId: null, bulk: 2, bulkHeld: 2, capacity: 0, ignored: 0, extradimensional: false, priceCp: 60 } },
]

const containerModal = ref<(Omit<Pf2eContainer, 'id' | 'order'> & { id: string | null }) | null>(null)
function openNewContainer() {
  containerModal.value = {
    id: null, itemId: null, name: 'Рюкзак', carryType: 'worn', parentContainerId: null,
    bulk: 0, bulkHeld: 0.1, capacity: 4, ignored: 2, extradimensional: false, invested: false, priceCp: 10, notes: '',
  }
}
function openEditContainer(c: Pf2eContainer) {
  containerModal.value = { ...c }
}
function applyContainerPreset(p: Omit<Pf2eContainer, 'id' | 'order'>) {
  if (!containerModal.value) return
  containerModal.value = { ...containerModal.value, ...p }
}
function saveContainerModal() {
  const f = containerModal.value
  if (!f || !f.name.trim()) return
  const payload: Omit<Pf2eContainer, 'id' | 'order'> = {
    itemId: f.itemId,
    name: f.name.trim(),
    carryType: f.carryType,
    parentContainerId: f.carryType === 'stowed' ? f.parentContainerId : null,
    bulk: Math.max(0, Number(f.bulk) || 0),
    bulkHeld: Math.max(0, Number(f.bulkHeld) || 0),
    capacity: Math.max(0, Number(f.capacity) || 0),
    ignored: Math.max(0, Number(f.ignored) || 0),
    extradimensional: Boolean(f.extradimensional),
    invested: Boolean(f.invested),
    priceCp: Math.max(0, Number(f.priceCp) || 0),
    notes: (f.notes ?? '').trim(),
  }
  if (f.id) {
    saveContainers(props.character.containers.map((c) => (c.id === f.id ? { ...c, ...payload } : c)))
  } else {
    saveContainers([...props.character.containers, { ...payload, id: randomId(10), order: props.character.containers.length }])
  }
  containerModal.value = null
}

// Add Custom Item / Edit Item Modal
interface ItemForm {
  id: string | null
  itemId: string | null
  name: string
  customType: Pf2eItemType
  quantity: number
  carryType: Pf2eCarryType
  containerId: string
  group: string
  invested: boolean
  bulkStr: string
  bulkHeldStr: string
  priceGpStr: string
  levelStr: string
  notes: string
}

const itemModal = ref<ItemForm | null>(null)
function openCustomItem(containerId = '') {
  itemModal.value = {
    id: null, itemId: null, name: '', customType: 'equipment', quantity: 1,
    carryType: containerId ? 'stowed' : 'held', containerId, group: '', invested: false,
    bulkStr: '0.1', bulkHeldStr: '', priceGpStr: '0', levelStr: '0', notes: '',
  }
}
function openEditItem(row: Pf2eInventoryItem) {
  itemModal.value = {
    id: row.id,
    itemId: row.itemId,
    name: row.name,
    customType: itemTypeOf(row),
    quantity: row.quantity,
    carryType: row.carryType,
    containerId: row.containerId ?? '',
    group: row.group,
    invested: row.invested,
    bulkStr: row.bulkOverride != null ? String(row.bulkOverride) : '',
    bulkHeldStr: row.bulkHeldOverride != null ? String(row.bulkHeldOverride) : '',
    priceGpStr: row.priceCpOverride != null ? String(row.priceCpOverride / 100) : '',
    levelStr: row.levelOverride != null ? String(row.levelOverride) : '',
    notes: row.notes,
  }
}
function saveItemModal() {
  const f = itemModal.value
  if (!f) return
  if (!f.itemId && !f.name.trim()) return
  const bulkOverride = f.bulkStr.trim() !== '' ? Math.max(0, Number(f.bulkStr)) : null
  const bulkHeldOverride = f.bulkHeldStr.trim() !== '' ? Math.max(0, Number(f.bulkHeldStr)) : null
  const priceCpOverride = f.priceGpStr.trim() !== '' ? Math.max(0, Math.round(Number(f.priceGpStr) * 100)) : null
  const levelOverride = f.levelStr.trim() !== '' ? Math.max(0, Math.round(Number(f.levelStr))) : null
  const carryType: Pf2eCarryType = f.carryType === 'stowed' && !f.containerId ? 'held' : f.carryType
  const containerId = carryType === 'stowed' ? f.containerId || null : null

  if (f.id) {
    saveInv(props.character.inventory.map((r) => (r.id === f.id ? {
      ...r,
      name: f.name.trim(),
      customType: f.itemId ? undefined : f.customType,
      quantity: Math.max(0, Math.round(Number(f.quantity) || 0)),
      carryType,
      containerId,
      group: f.group.trim(),
      invested: f.invested,
      bulkOverride,
      bulkHeldOverride,
      priceCpOverride,
      levelOverride,
      notes: f.notes.trim(),
    } : r)))
  } else {
    saveInv([
      ...props.character.inventory,
      {
        id: randomId(10),
        itemId: null,
        name: f.name.trim(),
        customType: f.customType,
        quantity: Math.max(1, Math.round(Number(f.quantity) || 1)),
        carryType,
        containerId,
        group: f.group.trim(),
        invested: f.invested,
        bulkOverride: bulkOverride ?? 0,
        bulkHeldOverride,
        priceCpOverride: priceCpOverride ?? 0,
        levelOverride: levelOverride ?? 0,
        notes: f.notes.trim(),
        order: props.character.inventory.length,
      },
    ])
  }
  itemModal.value = null
}

const bulkPct = computed(() => Math.min(100, (summary.value.totalLight / Math.max(10, summary.value.maxBulk * 10)) * 100))
const encMarkerPct = computed(() => Math.min(100, (summary.value.encumberedAt / Math.max(1, summary.value.maxBulk)) * 100))
</script>

<template>
  <div class="stack">
    <!-- ==================== BULK & WEALTH DASHBOARD ==================== -->
    <section class="card card-pad stack-sm">
      <div class="bulk-top">
        <div class="grow" style="min-width: 240px">
          <div class="row gap-sm wrap" style="margin-bottom: 4px">
            <span class="section-title" style="margin: 0">Масса (Bulk)</span>
            <b style="font-size: 18px">{{ formatLight(summary.totalLight, lang) }}</b>
            <span class="muted small">
              (учитывается: <b>{{ summary.effectiveBulk }}</b> · перегрузка > {{ summary.encumberedAt }} · макс. {{ summary.maxBulk }})
            </span>
            <span v-if="summary.status === 'ok'" class="badge badge-public">Норма</span>
            <span v-else-if="summary.status === 'encumbered'" class="badge badge-warn" title="Штраф −10 фт. к скорости, состояние Неуклюжий 1">Перегружен (−10 фт., Неуклюжий 1)</span>
            <span v-else class="badge badge-dead">Превышен предел!</span>
          </div>

          <div class="bulk-bar">
            <div class="bulk-fill" :class="summary.status" :style="{ width: `${bulkPct}%` }" />
            <div class="bulk-mark" :style="{ left: `${encMarkerPct}%` }" title="Порог перегрузки (5 + СИЛ)" />
          </div>
        </div>

        <div class="row gap wrap">
          <label class="mini-field" title="Модификатор Силы персонажа (влияет на порог перегрузки 5 + СИЛ и макс. 10 + СИЛ)">
            <span>СИЛ</span>
            <input type="number" min="-5" max="10" class="input input-sm" style="width: 58px" :value="character.strMod" @change="updateLimits({ strMod: Number(($event.target as HTMLInputElement).value) || 0 })" />
          </label>
          <label class="mini-field" title="Бонус к лимиту массы (например, +2 за «Тяжеловоз», +3 за «Муравьиную ношу»)">
            <span>+Лимит</span>
            <input type="number" min="-5" max="20" class="input input-sm" style="width: 58px" :value="character.bulkBonus" @change="updateLimits({ bulkBonus: Number(($event.target as HTMLInputElement).value) || 0 })" />
          </label>
          <div class="stat-pill" :class="{ warn: summary.overInvested }" title="Лимит инвестируемых магических предметов в PF2e (обычно 10)">
            <Icon name="gem" :size="14" />
            <span>Инвест.: <b>{{ summary.investedCount }}/{{ summary.maxInvested }}</b></span>
          </div>
          <button type="button" class="btn btn-sm" :class="{ 'btn-primary': showWallet }" @click="showWallet = !showWallet">
            <Icon name="coins" :size="14" />
            {{ formatPriceCp(summary.coinsValueCp, lang) }}
            <span class="faint">(всего {{ formatPriceCp(summary.totalWealthCp, lang) }})</span>
          </button>
        </div>
      </div>

      <!-- Coin Wallet Drawer -->
      <div v-if="showWallet" class="wallet-box">
        <div class="row gap wrap">
          <label class="mini-field"><span>Платина (пм)</span><input type="number" min="0" class="input input-sm" style="width: 82px" :value="character.coins.pp" @change="updateCoins({ pp: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })" /></label>
          <label class="mini-field"><span>Золото (зм)</span><input type="number" min="0" class="input input-sm" style="width: 88px" :value="character.coins.gp" @change="updateCoins({ gp: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })" /></label>
          <label class="mini-field"><span>Серебро (см)</span><input type="number" min="0" class="input input-sm" style="width: 82px" :value="character.coins.sp" @change="updateCoins({ sp: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })" /></label>
          <label class="mini-field"><span>Медь (мм)</span><input type="number" min="0" class="input input-sm" style="width: 82px" :value="character.coins.cp" @change="updateCoins({ cp: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })" /></label>
          <label class="mini-field grow" style="min-width: 190px">
            <span>Где хранятся монеты (1000 монет = 1 Б)</span>
            <select
              class="input input-sm"
              :value="character.coins.dropped ? 'dropped' : (character.coins.containerId ? 'c:' + character.coins.containerId : 'self')"
              @change="(e) => {
                const v = (e.target as HTMLSelectElement).value
                if (v === 'dropped') updateCoins({ dropped: true, containerId: null })
                else if (v === 'self') updateCoins({ dropped: false, containerId: null })
                else updateCoins({ dropped: false, containerId: v.slice(2) })
              }"
            >
              <option value="self">На себе ({{ formatLight(summary.coinsLight, lang) }})</option>
              <option v-for="c in sortedContainers" :key="c.id" :value="'c:' + c.id">В контейнере: {{ c.name }}</option>
              <option value="dropped">В банке / лагере (не учитывать массу)</option>
            </select>
          </label>
          <label class="mini-field" title="Максимум инвестируемых предметов (по умолчанию 10, с чертой — 12)">
            <span>Макс. инвест.</span>
            <input type="number" min="0" max="30" class="input input-sm" style="width: 66px" :value="character.maxInvested" @change="updateLimits({ maxInvested: Math.max(0, Number(($event.target as HTMLInputElement).value) || 10) })" />
          </label>
        </div>
        <div class="faint small" style="margin-top: 6px">
          Всего монет: <b>{{ summary.totalCoinsCount.toLocaleString('ru-RU') }}</b> шт. ({{ formatLight(summary.coinsLight, lang) }}) ·
          Монеты: <b>{{ formatPriceCp(summary.coinsValueCp, lang) }}</b> ·
          Предметы: <b>{{ formatPriceCp(summary.itemsValueCp, lang) }}</b> ·
          Общее состояние: <b>{{ formatPriceCp(summary.totalWealthCp, lang) }}</b>
        </div>
      </div>

      <!-- PF2e Rule Warnings -->
      <div v-if="summary.warnings.length" class="warn-banner">
        <Icon name="triangle-alert" :size="16" />
        <div class="stack-sm">
          <div v-for="(w, wi) in summary.warnings" :key="wi" class="small">{{ w }}</div>
        </div>
      </div>
    </section>

    <!-- ==================== INVENTORY TOOLBAR ==================== -->
    <section class="card card-pad stack-sm">
      <div class="row gap-sm wrap">
        <button v-if="!compact" type="button" class="btn btn-sm btn-primary" @click="openItemPicker('', '')">
          <Icon name="book-open" :size="14" /> Библиотека рядом
        </button>
        <button type="button" class="btn btn-sm" @click="openNewContainer">
          <Icon name="backpack" :size="14" /> Контейнер
        </button>
        <button type="button" class="btn btn-sm" @click="openCustomItem('')">
          <Icon name="plus" :size="14" /> Свой предмет
        </button>

        <span class="grow" />

        <div v-if="!compact" class="lang-switch" role="group" aria-label="Язык предметов">
          <button type="button" :class="{ on: lang === 'ru' }" @click="setLang('ru')">RU</button>
          <button type="button" :class="{ on: lang === 'en' }" @click="setLang('en')">EN</button>
        </div>
      </div>

      <div class="row gap-sm wrap">
        <input v-model="searchQ" type="text" class="input input-sm grow" style="min-width: 180px" placeholder="Поиск по инвентарю…" />

        <select v-model="groupMode" class="input input-sm" style="width: auto" title="Группировка инвентаря">
          <option value="containers">По контейнерам</option>
          <option value="type">По типам предметов</option>
          <option value="group">По своим группам</option>
          <option value="carry">По статусу ношения</option>
          <option value="flat">Сплошной список</option>
        </select>

        <select v-model="sortBy" class="input input-sm" style="width: auto" title="Сортировка">
          <option value="order">Порядок вручную</option>
          <option value="name">По названию</option>
          <option value="bulk">По массе</option>
          <option value="price">По цене</option>
          <option value="level">По уровню</option>
          <option value="qty">По количеству</option>
          <option value="type">По типу</option>
        </select>

        <button type="button" class="icon-btn" title="Направление сортировки" @click="sortDir = sortDir === 1 ? -1 : 1">
          <Icon :name="sortDir === 1 ? 'arrow-up' : 'arrow-down'" :size="15" />
        </button>
      </div>

      <div class="row gap-sm wrap small">
        <select v-model="filterType" class="input input-sm" style="width: auto">
          <option value="">Все типы</option>
          <option v-for="(info, key) in ITEM_TYPE_LABEL" :key="key" :value="key">{{ info[lang] }}</option>
        </select>

        <select v-if="allGroups.length" v-model="filterGroup" class="input input-sm" style="width: auto">
          <option value="">Все группы</option>
          <option v-for="g in allGroups" :key="g" :value="g">{{ g }}</option>
        </select>

        <select v-model="filterCarry" class="input input-sm" style="width: auto">
          <option value="">Любой статус</option>
          <option value="held">В руках</option>
          <option value="worn">Надето</option>
          <option value="stowed">В контейнерах</option>
          <option value="dropped">Сброшено / В лагере</option>
        </select>

        <label class="check">
          <input v-model="filterInvestedOnly" type="checkbox" /> Только инвестируемые
        </label>

        <button
          v-if="searchQ || filterType || filterGroup || filterCarry || filterInvestedOnly"
          type="button"
          class="btn btn-sm btn-ghost danger"
          @click="searchQ = ''; filterType = ''; filterGroup = ''; filterCarry = ''; filterInvestedOnly = false"
        >
          Сбросить
        </button>
      </div>
    </section>

    <!-- ==================== VIEW 1: BY CONTAINERS ==================== -->
    <template v-if="groupMode === 'containers'">
      <!-- Loose Carried (Worn / Held) -->
      <section
        class="card inv-sec"
        :class="{ 'drop-valid': isItemDrag, 'drop-over': invDragOver === 'loose' }"
        @dragover="onInvDragOver($event, 'loose')"
        @dragleave="onInvDragLeave('loose')"
        @drop="handleInvDrop($event, 'loose')"
      >
        <header class="is-head">
          <div class="row gap-sm grow">
            <Icon name="shield" :size="16" class="faint" />
            <b>На себе и в руках (вне контейнеров)</b>
            <span class="badge">{{ looseCarriedItems.length }}</span>
          </div>
          <button v-if="!compact" type="button" class="btn btn-sm btn-ghost" @click="openItemPicker('', '')"><Icon name="plus" :size="13" /> Добавить</button>
        </header>
        <div v-if="!looseCarriedItems.length" class="faint small" style="padding: 10px 14px">
          {{ invDragOver === 'loose' ? '+ Отпустите сюда, чтобы положить на себя' : 'Нет предметов вне контейнеров — перетащите сюда предмет.' }}
        </div>
        <div v-else class="inv-rows">
          <div
            v-for="row in looseCarriedItems"
            :key="row.id"
            class="inv-row"
            draggable="true"
            @dragstart="onInvRowDragStart($event, row)"
            @dragend="endPf2eDrag()"
          >
            <div v-if="sortBy === 'order'" class="ord-btns">
              <button type="button" title="Выше" @click="moveItemOrder(row, -1)"><Icon name="chevron-up" :size="12" /></button>
              <button type="button" title="Ниже" @click="moveItemOrder(row, 1)"><Icon name="chevron-down" :size="12" /></button>
            </div>
            <img v-if="itemImg(row)" :src="itemImg(row)" alt="" class="pf-inv-ic" loading="lazy" decoding="async" />
            <Icon v-else :name="ITEM_TYPE_LABEL[itemTypeOf(row)]?.icon ?? 'package'" :size="15" class="faint" />
            <button
              type="button"
              class="inv-main grow"
              :disabled="!row.itemId"
              @click="row.itemId && (viewingItem = catalog.itemsById.value.get(row.itemId) ?? null)"
            >
              <span class="row gap-sm wrap">
                <b class="ellipsis">{{ itemName(row) }}</b>
                <span v-if="row.group" class="tag-chip">{{ row.group }}</span>
                <span v-if="row.invested" class="badge badge-secret">Инвест.</span>
              </span>
              <span v-if="itemSubName(row) || row.notes" class="faint small ellipsis">
                {{ itemSubName(row) }}<template v-if="row.notes"> · {{ row.notes }}</template>
              </span>
            </button>

            <select class="input input-sm loc-sel" :value="rowLocationValue(row)" @change="setRowLocation(row, ($event.target as HTMLSelectElement).value)">
              <option value="worn">Надето</option>
              <option value="held">В руках</option>
              <option v-for="c in sortedContainers" :key="c.id" :value="'c:' + c.id">В: {{ c.name }}</option>
              <option value="dropped">Сброшено</option>
            </select>

            <div class="mini-step">
              <button type="button" @click="bumpQty(row, -1)">−</button>
              <span>{{ row.quantity }}</span>
              <button type="button" @click="bumpQty(row, 1)">+</button>
            </div>

            <span class="small nowrap muted" style="min-width: 52px; text-align: right">{{ formatLight(summary.byItem[row.id]?.totalLight ?? 0, lang) }}</span>
            <span class="small nowrap hide-sm" style="min-width: 64px; text-align: right">{{ formatPriceCp(summary.byItem[row.id]?.totalPriceCp ?? 0, lang) }}</span>

            <button
              v-if="summary.byItem[row.id]?.isInvestable || row.invested"
              type="button"
              class="icon-btn"
              :class="{ on: row.invested }"
              title="Инвестировать предмет"
              @click="toggleInvested(row)"
            ><Icon name="gem" :size="14" /></button>
            <button type="button" class="icon-btn" title="Редактировать" @click="openEditItem(row)"><Icon name="pencil" :size="14" /></button>
            <button type="button" class="icon-btn danger" title="Удалить" @click="removeItem(row)"><Icon name="trash2" :size="14" /></button>
          </div>
        </div>
      </section>

      <!-- Containers List -->
      <section
        v-for="c in sortedContainers"
        :key="c.id"
        class="card inv-sec"
        :class="{
          dropped: summary.byContainer[c.id]?.effectivelyDropped,
          'drop-valid': isItemDrag,
          'drop-over': invDragOver === `c:${c.id}`,
        }"
        @dragover="onInvDragOver($event, `c:${c.id}`)"
        @dragleave="onInvDragLeave(`c:${c.id}`)"
        @drop="handleInvDrop($event, `c:${c.id}`)"
      >
        <header class="is-head">
          <button type="button" class="icon-btn" style="width: 24px; height: 24px" @click="toggleContainerCollapse(c)">
            <Icon :name="c.collapsed ? 'chevron-right' : 'chevron-down'" :size="15" />
          </button>
          <img v-if="containerImg(c)" :src="containerImg(c)" alt="" class="pf-inv-ic" loading="lazy" decoding="async" />
          <Icon v-else name="backpack" :size="17" :style="{ color: c.extradimensional ? 'var(--secret)' : 'var(--accent)' }" />
          <div class="grow" style="min-width: 140px">
            <div class="row gap-sm wrap">
              <b>{{ c.name }}</b>
              <span v-if="c.extradimensional" class="badge badge-secret">Экстрапространственный</span>
              <span v-if="c.ignored > 0" class="badge badge-public">
                Игнор. до {{ c.ignored }} Б<template v-if="!c.extradimensional && c.carryType !== 'worn'"> (только когда надет!)</template>
              </span>
              <span v-if="summary.byContainer[c.id]?.effectivelyDropped" class="badge">Не на себе (0 Б)</span>
              <span v-if="summary.byContainer[c.id]?.overCapacity" class="badge badge-dead">Переполнен!</span>
            </div>
            <div class="faint small">
              Внутри: <b>{{ formatLight(summary.byContainer[c.id]?.contentsLight ?? 0, lang) }}</b>
              <template v-if="c.capacity > 0"> / {{ c.capacity }} Б</template>
              · Своя масса: {{ formatUnitBulk(c.carryType === 'worn' ? c.bulk : c.bulkHeld, lang) }}
              · Вклад в общую массу: <b>{{ formatLight(summary.byContainer[c.id]?.contributedLight ?? 0, lang) }}</b>
              <template v-if="character.coins.containerId === c.id && !character.coins.dropped"> · <Icon name="coins" :size="11" /> Монеты внутри</template>
              <template v-if="c.notes"> · {{ c.notes }}</template>
            </div>
          </div>

          <select class="input input-sm loc-sel" :value="containerLocationValue(c)" @change="setContainerLocation(c, ($event.target as HTMLSelectElement).value)">
            <option value="worn">Надето</option>
            <option value="held">В руках</option>
            <option v-for="other in sortedContainers.filter((x) => x.id !== c.id)" :key="other.id" :value="'c:' + other.id">В: {{ other.name }}</option>
            <option value="dropped">Сброшено / В лагере</option>
          </select>

          <button v-if="!compact" type="button" class="btn btn-sm btn-ghost" title="Добавить предмет в этот контейнер" @click="openItemPicker(c.id, '')">
            <Icon name="plus" :size="13" /> Предмет
          </button>
          <button type="button" class="icon-btn" title="Настройки контейнера" @click="openEditContainer(c)"><Icon name="pencil" :size="14" /></button>
          <button type="button" class="icon-btn danger" title="Удалить контейнер" @click="deleteContainer(c)"><Icon name="trash2" :size="14" /></button>
        </header>

        <div v-if="!c.collapsed">
          <div v-if="!itemsInContainer(c.id).length" class="faint small" style="padding: 10px 14px">
            {{ invDragOver === `c:${c.id}` ? `+ Отпустите сюда, чтобы положить в «${c.name}»` : 'Контейнер пуст — перетащите предмет сюда.' }}
          </div>
          <div v-else class="inv-rows">
            <div
              v-for="row in itemsInContainer(c.id)"
              :key="row.id"
              class="inv-row"
              draggable="true"
              @dragstart="onInvRowDragStart($event, row)"
              @dragend="endPf2eDrag()"
            >
              <div v-if="sortBy === 'order'" class="ord-btns">
                <button type="button" title="Выше" @click="moveItemOrder(row, -1)"><Icon name="chevron-up" :size="12" /></button>
                <button type="button" title="Ниже" @click="moveItemOrder(row, 1)"><Icon name="chevron-down" :size="12" /></button>
              </div>
              <img v-if="itemImg(row)" :src="itemImg(row)" alt="" class="pf-inv-ic" loading="lazy" decoding="async" />
            <Icon v-else :name="ITEM_TYPE_LABEL[itemTypeOf(row)]?.icon ?? 'package'" :size="15" class="faint" />
              <button
                type="button"
                class="inv-main grow"
                :disabled="!row.itemId"
                @click="row.itemId && (viewingItem = catalog.itemsById.value.get(row.itemId) ?? null)"
              >
                <span class="row gap-sm wrap">
                  <b class="ellipsis">{{ itemName(row) }}</b>
                  <span v-if="row.group" class="tag-chip">{{ row.group }}</span>
                  <span v-if="row.invested" class="badge badge-secret">Инвест.</span>
                </span>
                <span v-if="itemSubName(row) || row.notes" class="faint small ellipsis">
                  {{ itemSubName(row) }}<template v-if="row.notes"> · {{ row.notes }}</template>
                </span>
              </button>

              <select class="input input-sm loc-sel" :value="rowLocationValue(row)" @change="setRowLocation(row, ($event.target as HTMLSelectElement).value)">
                <option value="worn">Надето</option>
                <option value="held">В руках</option>
                <option v-for="ct in sortedContainers" :key="ct.id" :value="'c:' + ct.id">В: {{ ct.name }}</option>
                <option value="dropped">Сброшено</option>
              </select>

              <div class="mini-step">
                <button type="button" @click="bumpQty(row, -1)">−</button>
                <span>{{ row.quantity }}</span>
                <button type="button" @click="bumpQty(row, 1)">+</button>
              </div>

              <span class="small nowrap muted" style="min-width: 52px; text-align: right">{{ formatLight(summary.byItem[row.id]?.rawLight ?? 0, lang) }}</span>
              <span class="small nowrap hide-sm" style="min-width: 64px; text-align: right">{{ formatPriceCp(summary.byItem[row.id]?.totalPriceCp ?? 0, lang) }}</span>

              <button
                v-if="summary.byItem[row.id]?.isInvestable || row.invested"
                type="button"
                class="icon-btn"
                :class="{ on: row.invested }"
                title="Инвестировать"
                @click="toggleInvested(row)"
              ><Icon name="gem" :size="14" /></button>
              <button type="button" class="icon-btn" title="Редактировать" @click="openEditItem(row)"><Icon name="pencil" :size="14" /></button>
              <button type="button" class="icon-btn danger" title="Удалить" @click="removeItem(row)"><Icon name="trash2" :size="14" /></button>
            </div>
          </div>
        </div>
      </section>

      <!-- Drop Zone for adding a dragged backpack/pouch directly as a new Container -->
      <div
        v-if="draggingContainerItem"
        class="new-cont-drop"
        :class="{ over: invDragOver === 'new-container' }"
        @dragover="onInvDragOver($event, 'new-container')"
        @dragleave="onInvDragLeave('new-container')"
        @drop="handleInvDrop($event, 'new-container')"
      >
        <Icon name="backpack" :size="18" />
        <b>Перетащите сюда, чтобы добавить как отдельный контейнер</b>
      </div>

      <!-- Dropped / Camp Items -->
      <section v-if="looseDroppedItems.length" class="card inv-sec dropped">
        <header class="is-head">
          <div class="row gap-sm grow">
            <Icon name="archive" :size="16" class="faint" />
            <b>Сброшено / В лагере (масса не учитывается)</b>
            <span class="badge">{{ looseDroppedItems.length }}</span>
          </div>
        </header>
        <div class="inv-rows">
          <div v-for="row in looseDroppedItems" :key="row.id" class="inv-row">
            <img v-if="itemImg(row)" :src="itemImg(row)" alt="" class="pf-inv-ic" loading="lazy" decoding="async" />
            <Icon v-else :name="ITEM_TYPE_LABEL[itemTypeOf(row)]?.icon ?? 'package'" :size="15" class="faint" />
            <button
              type="button"
              class="inv-main grow"
              :disabled="!row.itemId"
              @click="row.itemId && (viewingItem = catalog.itemsById.value.get(row.itemId) ?? null)"
            >
              <span class="row gap-sm wrap"><b class="ellipsis">{{ itemName(row) }}</b><span v-if="row.group" class="tag-chip">{{ row.group }}</span></span>
              <span v-if="row.notes" class="faint small ellipsis">{{ row.notes }}</span>
            </button>
            <select class="input input-sm loc-sel" :value="rowLocationValue(row)" @change="setRowLocation(row, ($event.target as HTMLSelectElement).value)">
              <option value="worn">Надето</option>
              <option value="held">В руках</option>
              <option v-for="ct in sortedContainers" :key="ct.id" :value="'c:' + ct.id">В: {{ ct.name }}</option>
              <option value="dropped">Сброшено</option>
            </select>
            <div class="mini-step">
              <button type="button" @click="bumpQty(row, -1)">−</button>
              <span>{{ row.quantity }}</span>
              <button type="button" @click="bumpQty(row, 1)">+</button>
            </div>
            <span class="small nowrap faint" style="min-width: 52px; text-align: right">({{ formatLight(summary.byItem[row.id]?.rawLight ?? 0, lang) }})</span>
            <button type="button" class="icon-btn" @click="openEditItem(row)"><Icon name="pencil" :size="14" /></button>
            <button type="button" class="icon-btn danger" @click="removeItem(row)"><Icon name="trash2" :size="14" /></button>
          </div>
        </div>
      </section>
    </template>

    <!-- ==================== VIEW 2: BY TYPE / GROUP / CARRY / FLAT ==================== -->
    <template v-else>
      <div v-if="!groupedSections.length" class="card empty">Предметы не найдены.</div>
      <section v-for="sec in groupedSections" :key="sec.key" class="card inv-sec">
        <header class="is-head">
          <b class="grow">{{ sec.title }}</b>
          <span class="badge">{{ sec.rows.length }}</span>
        </header>
        <div class="inv-rows">
          <div v-for="row in sec.rows" :key="row.id" class="inv-row" :class="{ dropped: row.carryType === 'dropped' }">
            <div v-if="sortBy === 'order'" class="ord-btns">
              <button type="button" title="Выше" @click="moveItemOrder(row, -1)"><Icon name="chevron-up" :size="12" /></button>
              <button type="button" title="Ниже" @click="moveItemOrder(row, 1)"><Icon name="chevron-down" :size="12" /></button>
            </div>
            <img v-if="itemImg(row)" :src="itemImg(row)" alt="" class="pf-inv-ic" loading="lazy" decoding="async" />
            <Icon v-else :name="ITEM_TYPE_LABEL[itemTypeOf(row)]?.icon ?? 'package'" :size="15" class="faint" />
            <button
              type="button"
              class="inv-main grow"
              :disabled="!row.itemId"
              @click="row.itemId && (viewingItem = catalog.itemsById.value.get(row.itemId) ?? null)"
            >
              <span class="row gap-sm wrap">
                <b class="ellipsis">{{ itemName(row) }}</b>
                <span v-if="row.group" class="tag-chip">{{ row.group }}</span>
                <span v-if="row.invested" class="badge badge-secret">Инвест.</span>
              </span>
              <span v-if="itemSubName(row) || row.notes" class="faint small ellipsis">
                {{ itemSubName(row) }}<template v-if="row.notes"> · {{ row.notes }}</template>
              </span>
            </button>

            <select class="input input-sm loc-sel" :value="rowLocationValue(row)" @change="setRowLocation(row, ($event.target as HTMLSelectElement).value)">
              <option value="worn">Надето</option>
              <option value="held">В руках</option>
              <option v-for="ct in sortedContainers" :key="ct.id" :value="'c:' + ct.id">В: {{ ct.name }}</option>
              <option value="dropped">Сброшено</option>
            </select>

            <div class="mini-step">
              <button type="button" @click="bumpQty(row, -1)">−</button>
              <span>{{ row.quantity }}</span>
              <button type="button" @click="bumpQty(row, 1)">+</button>
            </div>

            <span class="small nowrap muted" style="min-width: 52px; text-align: right">{{ formatLight(summary.byItem[row.id]?.totalLight ?? 0, lang) }}</span>
            <span class="small nowrap hide-sm" style="min-width: 64px; text-align: right">{{ formatPriceCp(summary.byItem[row.id]?.totalPriceCp ?? 0, lang) }}</span>

            <button
              v-if="summary.byItem[row.id]?.isInvestable || row.invested"
              type="button"
              class="icon-btn"
              :class="{ on: row.invested }"
              @click="toggleInvested(row)"
            ><Icon name="gem" :size="14" /></button>
            <button type="button" class="icon-btn" @click="openEditItem(row)"><Icon name="pencil" :size="14" /></button>
            <button type="button" class="icon-btn danger" @click="removeItem(row)"><Icon name="trash2" :size="14" /></button>
          </div>
        </div>
      </section>
    </template>

    <!-- ==================== MODALS ==================== -->
    <!-- Container Modal -->
    <Modal v-if="containerModal" :title="containerModal.id ? 'Настройки контейнера' : 'Новый контейнер'" width="580px" @close="containerModal = null">
      <form class="stack" @submit.prevent="saveContainerModal">
        <div v-if="!containerModal.id" class="stack-sm">
          <span class="field-label">Быстрые шаблоны контейнеров PF2e</span>
          <div class="row gap-sm wrap">
            <button v-for="p in CONTAINER_PRESETS" :key="p.label" type="button" class="chip" @click="applyContainerPreset(p.data)">{{ p.label }}</button>
            <button type="button" class="chip on" @click="containerModal = null; openItemPicker('', 'backpack')">Выбрать из 46 в библиотеке…</button>
          </div>
        </div>

        <label class="field"><span>Название *</span><input v-model="containerModal.name" type="text" class="input" autofocus /></label>

        <div class="row gap wrap">
          <label class="field grow">
            <span>Статус ношения</span>
            <select v-model="containerModal.carryType" class="input">
              <option value="worn">Надето (рюкзак / пояс)</option>
              <option value="held">В руках</option>
              <option value="stowed">Внутри другого контейнера</option>
              <option value="dropped">Сброшено / В лагере / На скакуне (0 Б)</option>
            </select>
          </label>
          <label v-if="containerModal.carryType === 'stowed'" class="field grow">
            <span>Родительский контейнер</span>
            <select v-model="containerModal.parentContainerId" class="input">
              <option :value="null">— выберите —</option>
              <option v-for="o in sortedContainers.filter((x) => x.id !== containerModal!.id)" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </label>
        </div>

        <div class="row gap wrap">
          <label class="field grow"><span>Своя масса (надет, 0.1 = Л)</span><input v-model.number="containerModal.bulk" type="number" step="0.1" min="0" class="input" /></label>
          <label class="field grow"><span>Своя масса (в руках / убран)</span><input v-model.number="containerModal.bulkHeld" type="number" step="0.1" min="0" class="input" /></label>
        </div>

        <div class="row gap wrap">
          <label class="field grow"><span>Вместимость в Б (0 = без лимита)</span><input v-model.number="containerModal.capacity" type="number" step="0.1" min="0" class="input" /></label>
          <label class="field grow"><span>Игнорирует массы внутри (Б)</span><input v-model.number="containerModal.ignored" type="number" step="0.1" min="0" class="input" /></label>
        </div>

        <label class="check small">
          <input v-model="containerModal.extradimensional" type="checkbox" />
          <span><b>Экстрапространственный</b> (как Вместительный мешок — игнорирует массу внутри даже в руках; несовместим с другими экстрапространственными внутри!)</span>
        </label>
        <label class="check small">
          <input v-model="containerModal.invested" type="checkbox" /> Инвестируемый предмет (занимает 1 слот инвестирования)
        </label>
        <label class="field"><span>Заметка</span><input v-model="containerModal.notes" type="text" class="input" placeholder="Например: у коня, на поясе, привязан к седлу…" /></label>

        <div class="row gap-sm" style="justify-content: flex-end">
          <button type="button" class="btn" @click="containerModal = null">Отмена</button>
          <button type="submit" class="btn btn-primary" :disabled="!containerModal.name.trim()"><Icon name="check" :size="14" /> Сохранить</button>
        </div>
      </form>
    </Modal>

    <!-- Custom / Edit Item Modal -->
    <Modal v-if="itemModal" :title="itemModal.id ? 'Редактировать предмет' : 'Свой предмет'" width="540px" @close="itemModal = null">
      <form class="stack" @submit.prevent="saveItemModal">
        <label class="field">
          <span>{{ itemModal.itemId ? 'Своё название (пусто = из библиотеки)' : 'Название предмета *' }}</span>
          <input v-model="itemModal.name" type="text" class="input" :placeholder="itemModal.itemId ? 'Оставить стандартное' : 'Квестовый ключ, трофей…'" autofocus />
        </label>

        <div class="row gap wrap">
          <label v-if="!itemModal.itemId" class="field grow">
            <span>Тип</span>
            <select v-model="itemModal.customType" class="input">
              <option v-for="(info, key) in ITEM_TYPE_LABEL" :key="key" :value="key">{{ info.ru }}</option>
            </select>
          </label>
          <label class="field" style="width: 110px"><span>Количество</span><input v-model.number="itemModal.quantity" type="number" min="0" class="input" /></label>
          <label class="field grow"><span>Группа</span><input v-model="itemModal.group" type="text" list="pf-inv-groups" class="input" placeholder="Алхимия, Бой, Квест…" /></label>
        </div>

        <div class="row gap wrap">
          <label class="field grow">
            <span>Статус</span>
            <select v-model="itemModal.carryType" class="input">
              <option value="worn">Надето</option>
              <option value="held">В руках</option>
              <option value="stowed">В контейнере</option>
              <option value="dropped">Сброшено / В лагере</option>
            </select>
          </label>
          <label v-if="itemModal.carryType === 'stowed'" class="field grow">
            <span>Контейнер</span>
            <select v-model="itemModal.containerId" class="input">
              <option value="">— выберите —</option>
              <option v-for="c in sortedContainers" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
        </div>

        <div class="row gap wrap">
          <label class="field grow"><span>Масса (0.1 = Л){{ itemModal.itemId ? ' [переопр.]' : '' }}</span><input v-model="itemModal.bulkStr" type="number" step="0.1" min="0" class="input" :placeholder="itemModal.itemId ? 'из библиотеки' : '0'" /></label>
          <label class="field grow"><span>Цена (зм){{ itemModal.itemId ? ' [переопр.]' : '' }}</span><input v-model="itemModal.priceGpStr" type="number" step="0.01" min="0" class="input" :placeholder="itemModal.itemId ? 'из библиотеки' : '0'" /></label>
          <label class="field" style="width: 96px"><span>Уровень</span><input v-model="itemModal.levelStr" type="number" min="0" max="30" class="input" :placeholder="itemModal.itemId ? 'авто' : '0'" /></label>
        </div>

        <label class="check small"><input v-model="itemModal.invested" type="checkbox" /> Инвестировано</label>
        <label class="field"><span>Заметки (руны, заряды, особенности)</span><textarea v-model="itemModal.notes" class="input" rows="2" /></label>

        <div class="row gap-sm" style="justify-content: flex-end">
          <button type="button" class="btn" @click="itemModal = null">Отмена</button>
          <button type="submit" class="btn btn-primary" :disabled="!itemModal.itemId && !itemModal.name.trim()">Сохранить</button>
        </div>
      </form>
    </Modal>

    <datalist id="pf-inv-groups">
      <option v-for="g in allGroups" :key="g" :value="g" />
    </datalist>

    <!-- View Item Card Modal -->
    <Modal v-if="viewingItem" width="760px" @close="viewingItem = null">
      <Pf2eItemCard :item="viewingItem" :meta="catalog.meta.value" :lang="lang" :actor-level="character.level" :str-mod="character.strMod" />
    </Modal>
  </div>
</template>

<style scoped>
.bulk-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.bulk-bar { position: relative; height: 10px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.bulk-fill { height: 100%; background: var(--success); transition: width .15s; }
.bulk-fill.encumbered { background: var(--warning); }
.bulk-fill.overloaded { background: var(--danger); }
.bulk-mark { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text); opacity: .6; }
.badge-warn { background: color-mix(in srgb, var(--warning) 22%, transparent); color: var(--warning); }

.mini-field { display: flex; flex-direction: column; gap: 2px; }
.mini-field > span { font-size: 11px; font-weight: 700; color: var(--text-faint); text-transform: uppercase; }
.stat-pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--surface-2); font-size: 13px;
}
.stat-pill.warn { border-color: var(--danger); color: var(--danger); }

.wallet-box { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border); }
.warn-banner {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warning) 14%, transparent); border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent); color: var(--text);
}
.warn-banner > .icon { color: var(--warning); margin-top: 2px; }

.lang-switch { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.lang-switch button { border: 0; background: var(--surface-2); padding: 4px 9px; font-size: 12px; font-weight: 700; cursor: pointer; color: var(--text-muted); }
.lang-switch button.on { background: var(--accent); color: var(--accent-fg); }

.inv-sec { overflow: hidden; transition: border-color .14s, box-shadow .14s; }
.inv-sec.dropped { opacity: .76; border-style: dashed; }
.inv-sec.drop-valid { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.inv-sec.drop-over { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.new-cont-drop {
  display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px;
  border-radius: var(--radius-sm); border: 2px dashed var(--accent); background: var(--accent-soft);
  color: var(--accent); font-size: 13.5px; transition: background .12s;
}
.new-cont-drop.over { background: color-mix(in srgb, var(--accent) 26%, transparent); }
.is-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border);
}
.inv-rows { display: flex; flex-direction: column; }
.inv-row { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.inv-row:last-child { border-bottom: 0; }
.inv-row:hover { background: var(--surface-2); }
.inv-row.dropped { opacity: .68; }
.pf-inv-ic { width: 26px; height: 26px; border-radius: 5px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); background: var(--surface-2); }
.inv-main { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; min-width: 140px; }
.inv-main:not(:disabled):hover b { color: var(--accent); }
.inv-main:disabled { cursor: default; }

.ord-btns { display: flex; flex-direction: column; gap: 1px; }
.ord-btns button { border: 0; background: none; padding: 0; width: 16px; height: 13px; cursor: pointer; color: var(--text-faint); display: flex; align-items: center; justify-content: center; }
.ord-btns button:hover { color: var(--accent); }

.loc-sel { width: auto; max-width: 165px; }
.mini-step { display: inline-flex; align-items: center; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; background: var(--surface); font-size: 12.5px; }
.mini-step button { width: 22px; height: 24px; border: 0; background: var(--surface-2); cursor: pointer; font-weight: 700; }
.mini-step button:hover { background: var(--accent-soft); color: var(--accent); }
.mini-step span { padding: 0 7px; font-family: var(--font-mono); font-weight: 600; }
</style>
