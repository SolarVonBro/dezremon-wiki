<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Pf2eAttribute, Pf2eItemIndex, Pf2eItemType, Pf2eRarity } from '@/model/pf2e'
import { ensureItemDescriptions, ensurePf2eItems, usePf2eCatalog } from '@/data/pf2eCatalog'
import { ITEM_TYPE_LABEL, RARITY_LABEL } from '@/data/pf2eFormat'
import { formatPriceCp, formatUnitBulk } from '@/data/pf2eBulk'
import { PF2E_ATTRIBUTES } from '@/data/pf2eSpellcasting'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Pf2eTraitPicker, { type PickerOption } from './Pf2eTraitPicker.vue'
import Pf2eTriChip, { type TriVal } from './Pf2eTriChip.vue'
import Pf2eItemCard from './Pf2eItemCard.vue'

const props = withDefaults(defineProps<{
  pickMode?: boolean
  initialType?: Pf2eItemType | ''
  pickLabel?: string
}>(), {
  pickMode: false,
  initialType: '',
  pickLabel: 'Добавить в инвентарь',
})

const emit = defineEmits<{
  pick: [item: Pf2eItemIndex, asContainer?: boolean]
}>()

const catalog = usePf2eCatalog()
const lang = catalog.lang
const setLang = catalog.setLang

onMounted(() => { void ensurePf2eItems() })

// ==================== Filter State ====================
const q = ref('')
const searchInDesc = ref(false)
const types = ref<Pf2eItemType[]>(props.initialType ? [props.initialType] : [])
const lvlMin = ref<string>('')
const lvlMax = ref<string>('')
const priceMinGp = ref<string>('')
const priceMaxGp = ref<string>('')
const triFree = ref<TriVal>(0)
const bulkBuckets = ref<string[]>([]) // '0','L','1','2','3+'
const bulkMin = ref<string>('')
const bulkMax = ref<string>('')
const raritiesInc = ref<Pf2eRarity[]>([])
const raritiesExc = ref<Pf2eRarity[]>([])
const usageGroups = ref<string[]>([])
const exactUsage = ref('')
const handsFilter = ref<string[]>([]) // '1','2'

// Weapon filters
const weaponCats = ref<string[]>([])
const weaponGroups = ref<string[]>([])
const weaponRangeMode = ref<'all' | 'melee' | 'ranged' | 'thrown'>('all')
const weaponDice = ref<string[]>([])
const weaponDmgTypes = ref<string[]>([])
const weaponReloads = ref<string[]>([])
const triSpecific = ref<TriVal>(0)
const triStaff = ref<TriVal>(0)

// Armor & Shield filters
const armorCats = ref<string[]>([])
const armorGroups = ref<string[]>([])
const acMin = ref<string>('')
const hardnessMin = ref<string>('')
const hpMin = ref<string>('')
const noSpeedPen = ref(false)

// Consumable filters
const consumableCats = ref<string[]>([])

// Container filters
const capMin = ref<string>('')
const triIgnoresBulk = ref<TriVal>(0)

// Material / Grade / Apex
const materials = ref<string[]>([])
const grades = ref<string[]>([])
const apexAttrs = ref<Pf2eAttribute[]>([])

// Mechanics Tri-state
const triMagical = ref<TriVal>(0)
const triAlchemical = ref<TriVal>(0)
const triInvested = ref<TriVal>(0)
const triApex = ref<TriVal>(0)
const triRune = ref<TriVal>(0)
const triContainer = ref<TriVal>(0)
const triExtradim = ref<TriVal>(0)
const triActivation = ref<TriVal>(0)
const actActions = ref<string[]>([])
const triCursed = ref<TriVal>(0)
const triArtifact = ref<TriVal>(0)
const triRemaster = ref<TriVal>(0)

// Traits & Publications
const traitsInc = ref<string[]>([])
const traitsExc = ref<string[]>([])
const traitMode = ref<'and' | 'or'>('and')
const pubs = ref<string[]>([])
const pubQuery = ref('')

// Sorting & UI
const sortBy = ref<'level' | 'price' | 'bulk' | 'name' | 'type' | 'pub'>('level')
const sortDir = ref<1 | -1>(1)
const showAdvanced = ref(false)
const limit = ref(60)
const selected = ref<Pf2eItemIndex | null>(null)
const modalOpen = ref(false)

watch([searchInDesc, lang], ([on, l]) => {
  if (on) {
    void ensureItemDescriptions(l)
    void ensureItemDescriptions(l === 'ru' ? 'en' : 'ru')
  }
})

watch(
  [
    q, searchInDesc, types, lvlMin, lvlMax, priceMinGp, priceMaxGp, triFree,
    bulkBuckets, bulkMin, bulkMax, raritiesInc, raritiesExc, usageGroups, exactUsage, handsFilter,
    weaponCats, weaponGroups, weaponRangeMode, weaponDice, weaponDmgTypes, weaponReloads, triSpecific, triStaff,
    armorCats, armorGroups, acMin, hardnessMin, hpMin, noSpeedPen,
    consumableCats, capMin, triIgnoresBulk, materials, grades, apexAttrs,
    triMagical, triAlchemical, triInvested, triApex, triRune, triContainer, triExtradim,
    triActivation, actActions, triCursed, triArtifact, triRemaster,
    traitsInc, traitsExc, traitMode, pubs, sortBy, sortDir,
  ],
  () => { limit.value = 60 },
  { deep: true },
)

const toggleIn = <T>(arr: T[], val: T): T[] => (arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])

function cycleRarity(r: Pf2eRarity) {
  if (raritiesInc.value.includes(r)) {
    raritiesInc.value = raritiesInc.value.filter((x) => x !== r)
    raritiesExc.value = [...raritiesExc.value, r]
  } else if (raritiesExc.value.includes(r)) {
    raritiesExc.value = raritiesExc.value.filter((x) => x !== r)
  } else {
    raritiesInc.value = [...raritiesInc.value, r]
  }
}

function setLevelPreset(lo: number, hi: number) {
  if (lvlMin.value === String(lo) && lvlMax.value === String(hi)) {
    lvlMin.value = ''; lvlMax.value = ''
  } else {
    lvlMin.value = String(lo); lvlMax.value = String(hi)
  }
}

function resetAll() {
  q.value = ''
  searchInDesc.value = false
  types.value = []
  lvlMin.value = ''; lvlMax.value = ''
  priceMinGp.value = ''; priceMaxGp.value = ''
  triFree.value = 0
  bulkBuckets.value = []
  bulkMin.value = ''; bulkMax.value = ''
  raritiesInc.value = []; raritiesExc.value = []
  usageGroups.value = []; exactUsage.value = ''; handsFilter.value = []
  weaponCats.value = []; weaponGroups.value = []; weaponRangeMode.value = 'all'
  weaponDice.value = []; weaponDmgTypes.value = []; weaponReloads.value = []
  triSpecific.value = 0; triStaff.value = 0
  armorCats.value = []; armorGroups.value = []; acMin.value = ''; hardnessMin.value = ''; hpMin.value = ''; noSpeedPen.value = false
  consumableCats.value = []
  capMin.value = ''; triIgnoresBulk.value = 0
  materials.value = []; grades.value = []; apexAttrs.value = []
  triMagical.value = 0; triAlchemical.value = 0; triInvested.value = 0; triApex.value = 0
  triRune.value = 0; triContainer.value = 0; triExtradim.value = 0; triActivation.value = 0
  actActions.value = []; triCursed.value = 0; triArtifact.value = 0; triRemaster.value = 0
  traitsInc.value = []; traitsExc.value = []; traitMode.value = 'and'
  pubs.value = []; pubQuery.value = ''
}

const activeFilterCount = computed(() => {
  let n = 0
  if (q.value.trim()) n++
  if (types.value.length) n++
  if (lvlMin.value !== '' || lvlMax.value !== '') n++
  if (priceMinGp.value !== '' || priceMaxGp.value !== '' || triFree.value !== 0) n++
  if (bulkBuckets.value.length || bulkMin.value !== '' || bulkMax.value !== '') n++
  if (raritiesInc.value.length || raritiesExc.value.length) n++
  if (usageGroups.value.length || exactUsage.value || handsFilter.value.length) n++
  if (weaponCats.value.length || weaponGroups.value.length || weaponRangeMode.value !== 'all' || weaponDice.value.length || weaponDmgTypes.value.length || weaponReloads.value.length || triSpecific.value !== 0 || triStaff.value !== 0) n++
  if (armorCats.value.length || armorGroups.value.length || acMin.value !== '' || hardnessMin.value !== '' || hpMin.value !== '' || noSpeedPen.value) n++
  if (consumableCats.value.length) n++
  if (capMin.value !== '' || triIgnoresBulk.value !== 0) n++
  if (materials.value.length || grades.value.length || apexAttrs.value.length) n++
  if (actActions.value.length) n++
  if (traitsInc.value.length || traitsExc.value.length) n++
  if (pubs.value.length) n++
  for (const t of [triMagical, triAlchemical, triInvested, triApex, triRune, triContainer, triExtradim, triActivation, triCursed, triArtifact, triRemaster]) {
    if (t.value !== 0) n++
  }
  return n
})

const ALL_TYPES: Pf2eItemType[] = ['weapon', 'armor', 'shield', 'equipment', 'consumable', 'backpack', 'ammo', 'treasure', 'kit']
const LEVEL_PRESETS: Array<[string, number, number]> = [
  ['0', 0, 0], ['1–4', 1, 4], ['5–8', 5, 8], ['9–12', 9, 12], ['13–16', 13, 16], ['17–20', 17, 20], ['21+', 21, 30],
]
const BULK_OPTIONS = [
  { key: '0', ru: '— (незн.)', en: '— (neg.)' },
  { key: 'L', ru: 'Л (лёгк.)', en: 'L (light)' },
  { key: '1', ru: '1 Б', en: '1 B' },
  { key: '2', ru: '2 Б', en: '2 B' },
  { key: '3+', ru: '3+ Б', en: '3+ B' },
]
const USAGE_GROUPS = [
  { key: 'held1', ru: 'В 1 руке', en: 'Held 1 hand' },
  { key: 'held2', ru: 'В 2 руках', en: 'Held 2 hands' },
  { key: 'worn', ru: 'Надето (общее)', en: 'Worn' },
  { key: 'worn-slot', ru: 'Слот одежды/аксес.', en: 'Worn slot' },
  { key: 'etched', ru: 'Выгравировано (руны)', en: 'Etched (runes)' },
  { key: 'affixed', ru: 'Прикреплено (талисман…)', en: 'Affixed' },
  { key: 'applied', ru: 'Наносится (масла/яды)', en: 'Applied' },
  { key: 'carried', ru: 'Носится с собой', en: 'Carried' },
]
const WEAPON_CATS = [
  { key: 'unarmed', ru: 'Безоружное', en: 'Unarmed' },
  { key: 'simple', ru: 'Простое', en: 'Simple' },
  { key: 'martial', ru: 'Воинское', en: 'Martial' },
  { key: 'advanced', ru: 'Продвинутое', en: 'Advanced' },
]
const ARMOR_CATS = [
  { key: 'unarmored', ru: 'Без доспеха', en: 'Unarmored' },
  { key: 'light', ru: 'Лёгкий', en: 'Light' },
  { key: 'medium', ru: 'Средний', en: 'Medium' },
  { key: 'heavy', ru: 'Тяжёлый', en: 'Heavy' },
  { key: 'light-barding', ru: 'Лёгкий (скакун)', en: 'Light Barding' },
  { key: 'heavy-barding', ru: 'Тяжёлый (скакун)', en: 'Heavy Barding' },
]

const traitOptions = computed<PickerOption[]>(() => {
  const counts = new Map<string, number>()
  for (const it of catalog.items.value) for (const t of it.traits) counts.set(t, (counts.get(t) ?? 0) + 1)
  const dict = catalog.meta.value?.traits ?? {}
  return [...counts.entries()]
    .map(([value, count]) => ({ value, ru: dict[value]?.ru ?? value, en: dict[value]?.en ?? value, count }))
    .sort((a, b) => (lang.value === 'ru' ? a.ru.localeCompare(b.ru, 'ru') : a.en.localeCompare(b.en)))
})

const weaponGroupList = computed(() =>
  Object.entries(catalog.meta.value?.weaponGroups ?? {})
    .map(([k, v]) => ({ key: k, label: lang.value === 'ru' ? v.ru : v.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang.value === 'ru' ? 'ru' : 'en')),
)
const armorGroupList = computed(() =>
  Object.entries(catalog.meta.value?.armorGroups ?? {})
    .map(([k, v]) => ({ key: k, label: lang.value === 'ru' ? v.ru : v.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang.value === 'ru' ? 'ru' : 'en')),
)
const consumableCatList = computed(() =>
  Object.entries(catalog.meta.value?.consumableCats ?? {})
    .map(([k, v]) => ({ key: k, label: lang.value === 'ru' ? v.ru : v.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang.value === 'ru' ? 'ru' : 'en')),
)
const materialList = computed(() =>
  Object.entries(catalog.meta.value?.materials ?? {})
    .map(([k, v]) => ({ key: k, label: lang.value === 'ru' ? v.ru : v.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang.value === 'ru' ? 'ru' : 'en')),
)
const dmgTypeList = computed(() =>
  Object.entries(catalog.meta.value?.damageTypes ?? {})
    .filter(([k]) => k !== 'untyped' && k !== 'bleed')
    .map(([k, v]) => ({ key: k, label: lang.value === 'ru' ? v.ru : v.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang.value === 'ru' ? 'ru' : 'en')),
)
const wornSlotUsages = computed(() =>
  Object.entries(catalog.meta.value?.usages ?? {})
    .filter(([k]) => k.startsWith('worn') && k !== 'worn' && k !== 'worn-under-armor')
    .map(([k, v]) => ({ key: k, label: lang.value === 'ru' ? v.ru : v.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang.value === 'ru' ? 'ru' : 'en')),
)
const filteredPubs = computed(() => {
  const list = catalog.meta.value?.itemPubs ?? []
  const s = pubQuery.value.trim().toLowerCase()
  return s ? list.filter((p) => p.toLowerCase().includes(s)) : list
})

const showWeaponSec = computed(() => !types.value.length || types.value.includes('weapon'))
const showArmorSec = computed(() => !types.value.length || types.value.includes('armor') || types.value.includes('shield'))
const showConsumableSec = computed(() => !types.value.length || types.value.includes('consumable'))
const showContainerSec = computed(() => !types.value.length || types.value.includes('backpack'))

const triOk = (tri: TriVal, val: boolean) => tri === 0 || (tri === 1 ? val : !val)

function bulkBucketOf(b: number): string {
  if (b <= 0) return '0'
  if (b < 1) return 'L'
  if (b === 1) return '1'
  if (b === 2) return '2'
  return '3+'
}

const filtered = computed(() => {
  const list = catalog.items.value
  const needle = q.value.trim().toLowerCase()
  const descRu = catalog.itemDescRu.value
  const descEn = catalog.itemDescEn.value
  const lMin = lvlMin.value !== '' ? Number(lvlMin.value) : null
  const lMax = lvlMax.value !== '' ? Number(lvlMax.value) : null
  const pMinCp = priceMinGp.value !== '' ? Math.round(Number(priceMinGp.value) * 100) : null
  const pMaxCp = priceMaxGp.value !== '' ? Math.round(Number(priceMaxGp.value) * 100) : null
  const bMin = bulkMin.value !== '' ? Number(bulkMin.value) : null
  const bMax = bulkMax.value !== '' ? Number(bulkMax.value) : null
  const acLo = acMin.value !== '' ? Number(acMin.value) : null
  const hLo = hardnessMin.value !== '' ? Number(hardnessMin.value) : null
  const hpLo = hpMin.value !== '' ? Number(hpMin.value) : null
  const cLo = capMin.value !== '' ? Number(capMin.value) : null

  const out: Pf2eItemIndex[] = []
  for (const it of list) {
    if (needle) {
      const hit = it.ru.toLowerCase().includes(needle) || it.en.toLowerCase().includes(needle) || it.baseItem.toLowerCase().includes(needle)
      if (!hit) {
        if (!searchInDesc.value) continue
        const dRu = (descRu?.[it.id] ?? '').toLowerCase()
        const dEn = (descEn?.[it.id] ?? '').toLowerCase()
        if (!dRu.includes(needle) && !dEn.includes(needle)) continue
      }
    }

    if (types.value.length && !types.value.includes(it.type)) continue
    if (lMin !== null && it.level < lMin) continue
    if (lMax !== null && it.level > lMax) continue

    if (!triOk(triFree.value, it.priceCp === 0)) continue
    if (pMinCp !== null && it.priceCp < pMinCp) continue
    if (pMaxCp !== null && it.priceCp > pMaxCp) continue

    if (bulkBuckets.value.length && !bulkBuckets.value.includes(bulkBucketOf(it.bulk))) continue
    if (bMin !== null && it.bulk < bMin) continue
    if (bMax !== null && it.bulk > bMax) continue

    if (raritiesInc.value.length && !raritiesInc.value.includes(it.rarity)) continue
    if (raritiesExc.value.length && raritiesExc.value.includes(it.rarity)) continue

    if (usageGroups.value.length && !usageGroups.value.includes(it.usageGroup)) continue
    if (exactUsage.value && it.usage !== exactUsage.value) continue
    if (handsFilter.value.length && !handsFilter.value.includes(String(it.hands ?? ''))) continue

    // Weapon filters
    if (weaponCats.value.length && (it.type !== 'weapon' || !weaponCats.value.includes(it.category))) continue
    if (weaponGroups.value.length && (it.type !== 'weapon' || !weaponGroups.value.includes(it.group))) continue
    if (weaponRangeMode.value === 'melee' && (it.type !== 'weapon' || it.isRanged)) continue
    if (weaponRangeMode.value === 'ranged' && (it.type !== 'weapon' || !it.isRanged)) continue
    if (weaponRangeMode.value === 'thrown' && (it.type !== 'weapon' || !it.isThrown)) continue
    if (weaponDice.value.length && (it.type !== 'weapon' || !weaponDice.value.includes(it.die))) continue
    if (weaponDmgTypes.value.length && (it.type !== 'weapon' || !weaponDmgTypes.value.includes(it.dmgType))) continue
    if (weaponReloads.value.length && (it.type !== 'weapon' || !weaponReloads.value.includes(it.reload))) continue
    if (!triOk(triSpecific.value, it.isSpecific)) continue
    if (!triOk(triStaff.value, it.isStaff)) continue

    // Armor & Shield filters
    if (armorCats.value.length && (it.type !== 'armor' || !armorCats.value.includes(it.category))) continue
    if (armorGroups.value.length && (it.type !== 'armor' || !armorGroups.value.includes(it.group))) continue
    if (acLo !== null && (it.acBonus == null || it.acBonus < acLo)) continue
    if (hLo !== null && (it.hardness == null || it.hardness < hLo)) continue
    if (hpLo !== null && (it.hp == null || it.hp < hpLo)) continue
    if (noSpeedPen.value && (it.speedPenalty != null && it.speedPenalty < 0)) continue

    // Consumables
    if (consumableCats.value.length && (it.type !== 'consumable' || !consumableCats.value.includes(it.category))) continue

    // Containers
    if (cLo !== null && it.capacity < cLo) continue
    if (!triOk(triIgnoresBulk.value, it.ignored > 0)) continue

    // Materials & Apex
    if (materials.value.length && !materials.value.includes(it.material)) continue
    if (grades.value.length && !grades.value.includes(it.grade)) continue
    if (apexAttrs.value.length && (!it.apex || !apexAttrs.value.includes(it.apex))) continue

    // Tri-state mechanics
    if (!triOk(triMagical.value, it.magical)) continue
    if (!triOk(triAlchemical.value, it.alchemical)) continue
    if (!triOk(triInvested.value, it.invested)) continue
    if (!triOk(triApex.value, Boolean(it.apex))) continue
    if (!triOk(triRune.value, it.isRune)) continue
    if (!triOk(triContainer.value, it.type === 'backpack' || it.capacity > 0)) continue
    if (!triOk(triExtradim.value, it.extradimensional)) continue
    if (!triOk(triActivation.value, it.hasActivation)) continue
    if (actActions.value.length && !actActions.value.some((a) => it.actActions.includes(a))) continue
    if (!triOk(triCursed.value, it.cursed)) continue
    if (!triOk(triArtifact.value, it.artifact)) continue
    if (!triOk(triRemaster.value, it.remaster)) continue

    // Traits
    if (traitsInc.value.length) {
      const ok = traitMode.value === 'and'
        ? traitsInc.value.every((t) => it.traits.includes(t))
        : traitsInc.value.some((t) => it.traits.includes(t))
      if (!ok) continue
    }
    if (traitsExc.value.length && traitsExc.value.some((t) => it.traits.includes(t))) continue

    if (pubs.value.length && !pubs.value.includes(it.pub)) continue

    out.push(it)
  }

  const dir = sortDir.value
  const l = lang.value
  out.sort((a, b) => {
    let cmp = 0
    if (sortBy.value === 'level') cmp = a.level - b.level
    else if (sortBy.value === 'price') cmp = a.priceCp - b.priceCp
    else if (sortBy.value === 'bulk') cmp = a.bulk - b.bulk
    else if (sortBy.value === 'type') cmp = a.type.localeCompare(b.type)
    else if (sortBy.value === 'pub') cmp = a.pub.localeCompare(b.pub)
    if (cmp !== 0) return cmp * dir
    return (l === 'ru' ? a.ru.localeCompare(b.ru, 'ru') : a.en.localeCompare(b.en)) * (sortBy.value === 'name' ? dir : 1)
  })
  return out
})

const shown = computed(() => filtered.value.slice(0, limit.value))

function openItem(it: Pf2eItemIndex) {
  selected.value = it
  if (window.innerWidth < 1140) modalOpen.value = true
}
</script>

<template>
  <div class="pf-browser">
    <!-- Top search + language + quick strip -->
    <div class="card card-pad stack-sm">
      <div class="row gap-sm wrap">
        <div class="search-wrap grow">
          <Icon name="search" :size="15" class="search-ic" />
          <input
            v-model="q"
            type="text"
            class="input search-inp"
            :placeholder="lang === 'ru' ? 'Поиск предметов (RU / EN)…' : 'Search items (EN / RU)…'"
          />
          <button v-if="q" type="button" class="icon-btn search-x" @click="q = ''"><Icon name="x" :size="14" /></button>
        </div>

        <label class="check small nowrap" title="Искать также по полному тексту описания на обоих языках">
          <input v-model="searchInDesc" type="checkbox" /> По описанию
        </label>

        <div class="lang-switch" role="group" aria-label="Язык списка">
          <button type="button" :class="{ on: lang === 'ru' }" @click="setLang('ru')">RU</button>
          <button type="button" :class="{ on: lang === 'en' }" @click="setLang('en')">EN</button>
        </div>

        <button type="button" class="btn btn-sm" :class="{ 'btn-primary': showAdvanced }" @click="showAdvanced = !showAdvanced">
          <Icon name="sliders-horizontal" :size="14" />
          Все фильтры
          <span v-if="activeFilterCount" class="fcount">{{ activeFilterCount }}</span>
        </button>

        <button v-if="activeFilterCount" type="button" class="btn btn-sm btn-ghost danger" @click="resetAll">
          <Icon name="rotate-ccw" :size="14" /> Сбросить
        </button>
      </div>

      <!-- Quick Strip: Types + Level Presets -->
      <div class="quick-strip">
        <div class="qs-group">
          <span class="qs-lbl">Тип:</span>
          <button
            v-for="t in ALL_TYPES"
            :key="t"
            type="button"
            class="chip"
            :class="{ on: types.includes(t) }"
            @click="types = toggleIn(types, t)"
          >
            <Icon :name="ITEM_TYPE_LABEL[t].icon" :size="12" /> {{ ITEM_TYPE_LABEL[t][lang] }}
          </button>
        </div>

        <div class="qs-group">
          <span class="qs-lbl">Ур.:</span>
          <button
            v-for="[lbl, lo, hi] in LEVEL_PRESETS"
            :key="lbl"
            type="button"
            class="chip"
            :class="{ on: lvlMin === String(lo) && lvlMax === String(hi) }"
            @click="setLevelPreset(lo, hi)"
          >
            {{ lbl }}
          </button>
        </div>
      </div>

      <!-- Advanced Filters Drawer -->
      <div v-if="showAdvanced" class="adv-grid">
        <!-- Level, Price, Bulk -->
        <div class="adv-sec">
          <div class="adv-head"><span>Уровень и Цена (в зм)</span><Pf2eTriChip v-model="triFree" label="Бесплатно" /></div>
          <div class="row gap wrap small">
            <label class="row gap-sm">
              <span class="muted">Уровень:</span>
              <input v-model="lvlMin" type="number" min="0" max="30" class="input input-sm rng-inp" placeholder="от" />
              <span>–</span>
              <input v-model="lvlMax" type="number" min="0" max="30" class="input input-sm rng-inp" placeholder="до" />
            </label>
            <label class="row gap-sm">
              <span class="muted">Цена (зм):</span>
              <input v-model="priceMinGp" type="number" min="0" step="0.1" class="input input-sm rng-inp" placeholder="от" />
              <span>–</span>
              <input v-model="priceMaxGp" type="number" min="0" step="0.1" class="input input-sm rng-inp" placeholder="до" />
            </label>
          </div>
        </div>

        <!-- Bulk & Rarity -->
        <div class="adv-sec">
          <div class="adv-head">
            <span>Масса (Bulk) и Редкость</span>
            <div class="row gap-sm small">
              <input v-model="bulkMin" type="number" min="0" step="0.1" class="input input-sm rng-inp" placeholder="от" />
              <span>–</span>
              <input v-model="bulkMax" type="number" min="0" step="0.1" class="input input-sm rng-inp" placeholder="до" />
            </div>
          </div>
          <div class="row gap-sm wrap" style="margin-bottom: 4px">
            <button v-for="b in BULK_OPTIONS" :key="b.key" type="button" class="chip" :class="{ on: bulkBuckets.includes(b.key) }" @click="bulkBuckets = toggleIn(bulkBuckets, b.key)">
              {{ lang === 'ru' ? b.ru : b.en }}
            </button>
          </div>
          <div class="row gap-sm wrap">
            <button
              v-for="r in (['common', 'uncommon', 'rare', 'unique'] as Pf2eRarity[])"
              :key="r"
              type="button"
              class="chip"
              :class="{ on: raritiesInc.includes(r), exc: raritiesExc.includes(r) }"
              @click="cycleRarity(r)"
            >
              {{ raritiesExc.includes(r) ? '− ' : '' }}{{ RARITY_LABEL[r][lang] }}
            </button>
          </div>
        </div>

        <!-- Usage / Slot / Hands -->
        <div class="adv-sec adv-wide">
          <div class="adv-head">
            <span>Использование / Слот ношения / Руки</span>
            <div class="row gap-sm small">
              <button type="button" class="mini-btn" :class="{ on: handsFilter.includes('1') }" @click="handsFilter = toggleIn(handsFilter, '1')">1 рука</button>
              <button type="button" class="mini-btn" :class="{ on: handsFilter.includes('2') }" @click="handsFilter = toggleIn(handsFilter, '2')">2 руки</button>
              <select v-model="exactUsage" class="input input-sm" style="width: auto; max-width: 240px">
                <option value="">Точный слот одежды…</option>
                <option v-for="u in wornSlotUsages" :key="u.key" :value="u.key">{{ u.label }}</option>
              </select>
            </div>
          </div>
          <div class="row gap-sm wrap">
            <button v-for="u in USAGE_GROUPS" :key="u.key" type="button" class="chip" :class="{ on: usageGroups.includes(u.key) }" @click="usageGroups = toggleIn(usageGroups, u.key)">
              {{ lang === 'ru' ? u.ru : u.en }}
            </button>
          </div>
        </div>

        <!-- Weapon Filters -->
        <div v-if="showWeaponSec" class="adv-sec adv-wide">
          <div class="adv-head">
            <span>Оружие</span>
            <div class="row gap-sm wrap">
              <button type="button" class="mini-btn" :class="{ on: weaponRangeMode === 'melee' }" @click="weaponRangeMode = weaponRangeMode === 'melee' ? 'all' : 'melee'">Ближнее</button>
              <button type="button" class="mini-btn" :class="{ on: weaponRangeMode === 'ranged' }" @click="weaponRangeMode = weaponRangeMode === 'ranged' ? 'all' : 'ranged'">Дистанционное</button>
              <button type="button" class="mini-btn" :class="{ on: weaponRangeMode === 'thrown' }" @click="weaponRangeMode = weaponRangeMode === 'thrown' ? 'all' : 'thrown'">Метательное</button>
              <Pf2eTriChip v-model="triSpecific" label="Особое магическое" />
              <Pf2eTriChip v-model="triStaff" label="Посох" />
            </div>
          </div>
          <div class="row gap-sm wrap">
            <button v-for="c in WEAPON_CATS" :key="c.key" type="button" class="chip" :class="{ on: weaponCats.includes(c.key) }" @click="weaponCats = toggleIn(weaponCats, c.key)">
              {{ lang === 'ru' ? c.ru : c.en }}
            </button>
            <span class="faint">|</span>
            <button v-for="d in ['d4', 'd6', 'd8', 'd10', 'd12']" :key="d" type="button" class="chip" :class="{ on: weaponDice.includes(d) }" @click="weaponDice = toggleIn(weaponDice, d)">
              {{ d }}
            </button>
            <span class="faint">|</span>
            <button v-for="rl in ['0', '1', '2']" :key="rl" type="button" class="chip" :class="{ on: weaponReloads.includes(rl) }" @click="weaponReloads = toggleIn(weaponReloads, rl)">
              Перез. {{ rl }}
            </button>
          </div>
          <div class="row gap-sm wrap">
            <span class="faint small">Группа:</span>
            <button v-for="g in weaponGroupList" :key="g.key" type="button" class="chip" :class="{ on: weaponGroups.includes(g.key) }" @click="weaponGroups = toggleIn(weaponGroups, g.key)">
              {{ g.label }}
            </button>
          </div>
          <div class="row gap-sm wrap">
            <span class="faint small">Урон:</span>
            <button v-for="dt in dmgTypeList" :key="dt.key" type="button" class="chip" :class="{ on: weaponDmgTypes.includes(dt.key) }" @click="weaponDmgTypes = toggleIn(weaponDmgTypes, dt.key)">
              {{ dt.label }}
            </button>
          </div>
        </div>

        <!-- Armor & Shield Filters -->
        <div v-if="showArmorSec" class="adv-sec">
          <div class="adv-head">
            <span>Доспехи и щиты</span>
            <label class="check small"><input v-model="noSpeedPen" type="checkbox" /> Без штрафа скорости</label>
          </div>
          <div class="row gap-sm wrap">
            <button v-for="c in ARMOR_CATS" :key="c.key" type="button" class="chip" :class="{ on: armorCats.includes(c.key) }" @click="armorCats = toggleIn(armorCats, c.key)">
              {{ lang === 'ru' ? c.ru : c.en }}
            </button>
          </div>
          <div class="row gap-sm wrap">
            <button v-for="g in armorGroupList" :key="g.key" type="button" class="chip" :class="{ on: armorGroups.includes(g.key) }" @click="armorGroups = toggleIn(armorGroups, g.key)">
              {{ g.label }}
            </button>
          </div>
          <div class="row gap-sm wrap small">
            <input v-model="acMin" type="number" min="0" class="input input-sm rng-inp" placeholder="КБ от" />
            <input v-model="hardnessMin" type="number" min="0" class="input input-sm rng-inp" placeholder="Твёрд. от" />
            <input v-model="hpMin" type="number" min="0" class="input input-sm rng-inp" placeholder="ОЗ от" />
          </div>
        </div>

        <!-- Consumables -->
        <div v-if="showConsumableSec" class="adv-sec">
          <div class="adv-head"><span>Подтип расходника</span></div>
          <div class="row gap-sm wrap">
            <button v-for="c in consumableCatList" :key="c.key" type="button" class="chip" :class="{ on: consumableCats.includes(c.key) }" @click="consumableCats = toggleIn(consumableCats, c.key)">
              {{ c.label }}
            </button>
          </div>
        </div>

        <!-- Containers -->
        <div v-if="showContainerSec" class="adv-sec">
          <div class="adv-head"><span>Контейнеры</span></div>
          <div class="row gap-sm wrap small">
            <Pf2eTriChip v-model="triContainer" label="Контейнер" />
            <Pf2eTriChip v-model="triIgnoresBulk" label="Снижает массу" />
            <Pf2eTriChip v-model="triExtradim" label="Экстрапространств." />
            <input v-model="capMin" type="number" min="0" class="input input-sm rng-inp" placeholder="Вмест. от" />
          </div>
        </div>

        <!-- Materials & Apex -->
        <div class="adv-sec">
          <div class="adv-head"><span>Особый материал и Апекс</span></div>
          <div class="row gap-sm wrap">
            <button v-for="m in materialList" :key="m.key" type="button" class="chip" :class="{ on: materials.includes(m.key) }" @click="materials = toggleIn(materials, m.key)">
              {{ m.label }}
            </button>
          </div>
          <div class="row gap-sm wrap">
            <span class="faint small">Качество:</span>
            <button type="button" class="chip" :class="{ on: grades.includes('low') }" @click="grades = toggleIn(grades, 'low')">Низкое</button>
            <button type="button" class="chip" :class="{ on: grades.includes('standard') }" @click="grades = toggleIn(grades, 'standard')">Стандарт</button>
            <button type="button" class="chip" :class="{ on: grades.includes('high') }" @click="grades = toggleIn(grades, 'high')">Высокое</button>
            <span class="faint small" style="margin-left: 4px">Апекс:</span>
            <button v-for="a in PF2E_ATTRIBUTES" :key="a.id" type="button" class="chip" :class="{ on: apexAttrs.includes(a.id) }" @click="apexAttrs = toggleIn(apexAttrs, a.id)">
              {{ a.shortRu }}
            </button>
          </div>
        </div>

        <!-- Tri-state Mechanics -->
        <div class="adv-sec adv-wide">
          <div class="adv-head"><span>Механики и свойства (клик: Любое → Да ✓ → Нет ✕)</span></div>
          <div class="row gap-sm wrap">
            <Pf2eTriChip v-model="triMagical" label="Магический" />
            <Pf2eTriChip v-model="triAlchemical" label="Алхимический" />
            <Pf2eTriChip v-model="triInvested" label="Инвестируемый" />
            <Pf2eTriChip v-model="triApex" label="Апекс" />
            <Pf2eTriChip v-model="triRune" label="Руна" />
            <Pf2eTriChip v-model="triActivation" label="Есть активация" />
            <Pf2eTriChip v-model="triCursed" label="Проклятый" />
            <Pf2eTriChip v-model="triArtifact" label="Артефакт" />
            <Pf2eTriChip v-model="triRemaster" label="Remaster" />
          </div>
          <div class="row gap-sm wrap" style="margin-top: 2px">
            <span class="faint small">Действие активации:</span>
            <button v-for="[k, lbl] in [['free', '◇ Своб.'], ['reaction', '↺ Реакц.'], ['1', '◆ 1'], ['2', '◆◆ 2'], ['3', '◆◆◆ 3'], ['long', 'Долго']]" :key="k" type="button" class="chip" :class="{ on: actActions.includes(k) }" @click="actActions = toggleIn(actActions, k)">
              {{ lbl }}
            </button>
          </div>
        </div>

        <!-- Traits -->
        <div class="adv-sec adv-wide">
          <div class="adv-head"><span>Черты предметов (Traits — включить И/ИЛИ или исключить)</span></div>
          <Pf2eTraitPicker
            v-model:include="traitsInc"
            v-model:exclude="traitsExc"
            v-model:mode="traitMode"
            :options="traitOptions"
            :lang="lang"
            placeholder="Магический, Ловкое, Досягаемость, Agile, Finesse, Healing…"
          />
        </div>

        <!-- Publications -->
        <div class="adv-sec adv-wide">
          <div class="adv-head">
            <span>Источники / книги ({{ pubs.length || 'все' }})</span>
            <button v-if="pubs.length" type="button" class="mini-btn" @click="pubs = []">Сбросить</button>
          </div>
          <input v-model="pubQuery" type="text" class="input input-sm" placeholder="Фильтр книг (GM Core, Treasure Vault, Guns & Gears…)" />
          <div class="mini-scroll">
            <button v-for="p in filteredPubs" :key="p" type="button" class="chip" :class="{ on: pubs.includes(p) }" @click="pubs = toggleIn(pubs, p)">
              {{ p }}
            </button>
          </div>
        </div>
      </div>

      <!-- Result count & sort -->
      <div class="row gap wrap small muted" style="padding-top: 4px; border-top: 1px solid var(--border)">
        <span>Найдено: <b>{{ filtered.length }}</b> из {{ catalog.items.value.length }}</span>
        <span class="grow" />
        <label class="row gap-sm">
          <span>Сортировка:</span>
          <select v-model="sortBy" class="input input-sm" style="width: auto">
            <option value="level">По уровню</option>
            <option value="price">По цене</option>
            <option value="bulk">По массе</option>
            <option value="name">По названию</option>
            <option value="type">По типу</option>
            <option value="pub">По источнику</option>
          </select>
        </label>
        <button type="button" class="btn btn-sm btn-ghost" @click="sortDir = sortDir === 1 ? -1 : 1">
          <Icon :name="sortDir === 1 ? 'arrow-up' : 'arrow-down'" :size="14" /> {{ sortDir === 1 ? 'Возр.' : 'Убыв.' }}
        </button>
      </div>
    </div>

    <!-- Loading / Error -->
    <div v-if="catalog.loadingItems.value" class="card empty">
      <Icon name="refresh-cw" class="spin" :size="24" />
      <p>Загружаем библиотеку снаряжения Pathfinder 2e…</p>
    </div>
    <div v-else-if="catalog.loadError.value" class="card empty danger">
      Ошибка загрузки: {{ catalog.loadError.value }}
    </div>

    <!-- Results + Split Detail -->
    <div v-else class="pf-split" :class="{ 'has-detail': Boolean(selected) }">
      <div class="card pf-list-card">
        <div v-if="!filtered.length" class="empty">
          <Icon name="search" :size="28" />
          <p>Предметы по заданным фильтрам не найдены.</p>
          <button v-if="activeFilterCount" type="button" class="btn btn-sm" @click="resetAll">Сбросить фильтры</button>
        </div>

        <div v-else class="pf-rows">
          <div
            v-for="it in shown"
            :key="it.id"
            class="pf-row"
            :class="{ on: selected?.id === it.id }"
            @click="openItem(it)"
          >
            <span class="pf-lvl" :title="lang === 'ru' ? `Уровень ${it.level}` : `Level ${it.level}`">{{ it.level }}</span>
            <Icon :name="ITEM_TYPE_LABEL[it.type]?.icon ?? 'package'" :size="15" class="faint" />

            <div class="pf-rname grow">
              <div class="row gap-sm" style="align-items: baseline">
                <b class="ellipsis">{{ lang === 'ru' ? it.ru : it.en }}</b>
                <span v-if="it.rarity !== 'common'" class="rar-dot" :class="'rd-' + it.rarity" :title="RARITY_LABEL[it.rarity][lang]" />
                <span v-if="it.extradimensional" class="badge badge-secret hide-sm" style="font-size: 10.5px">экстрапр.</span>
              </div>
              <div class="faint small ellipsis">
                {{ lang === 'ru' ? it.en : it.ru }}
                <template v-if="it.type === 'weapon' && it.die"> · {{ it.diceNum || 1 }}{{ it.die }}</template>
                <template v-else-if="it.type === 'backpack' && it.capacity"> · вмест. {{ it.capacity }} Б<template v-if="it.ignored"> (игн. {{ it.ignored }})</template></template>
                <template v-else-if="it.type === 'armor' && it.acBonus != null"> · КБ +{{ it.acBonus }}</template>
                <template v-else-if="it.type === 'shield' && it.hardness != null"> · Тв. {{ it.hardness }} / ОЗ {{ it.hp }}</template>
              </div>
            </div>

            <span class="small nowrap muted hide-sm" :title="lang === 'ru' ? 'Масса (Bulk)' : 'Bulk'">
              {{ formatUnitBulk(it.bulk, lang) }}
            </span>
            <span class="small nowrap" style="min-width: 68px; text-align: right; font-weight: 600">
              {{ formatPriceCp(it.priceCp, lang) }}
            </span>

            <button
              v-if="pickMode"
              type="button"
              class="btn btn-sm btn-primary"
              style="flex-shrink: 0"
              :title="it.type === 'backpack' ? 'Добавить как контейнер' : 'Добавить в инвентарь'"
              @click.stop="emit('pick', it, it.type === 'backpack')"
            >
              <Icon name="plus" :size="13" />
            </button>
          </div>

          <div v-if="filtered.length > shown.length" class="load-more">
            <button type="button" class="btn" @click="limit += 80">
              Показать ещё (показано {{ shown.length }} из {{ filtered.length }})
            </button>
          </div>
        </div>
      </div>

      <!-- Sticky Desktop Detail -->
      <aside v-if="selected" class="card card-pad pf-detail-pane">
        <Pf2eItemCard :item="selected" :meta="catalog.meta.value" :lang="lang">
          <template #actions>
            <template v-if="pickMode">
              <button v-if="selected.type === 'backpack' || selected.capacity > 0" type="button" class="btn btn-primary btn-sm" @click="emit('pick', selected, true)">
                <Icon name="backpack" :size="14" /> Как контейнер
              </button>
              <button type="button" class="btn btn-sm" :class="{ 'btn-primary': !(selected.type === 'backpack' || selected.capacity > 0) }" @click="emit('pick', selected, false)">
                <Icon name="plus" :size="14" /> {{ pickLabel }}
              </button>
            </template>
            <button type="button" class="btn btn-sm btn-ghost" @click="selected = null">Закрыть</button>
          </template>
        </Pf2eItemCard>
      </aside>
    </div>

    <!-- Mobile / Tablet Detail Modal -->
    <Modal v-if="modalOpen && selected" width="760px" @close="modalOpen = false">
      <Pf2eItemCard :item="selected" :meta="catalog.meta.value" :lang="lang">
        <template #actions>
          <template v-if="pickMode">
            <button v-if="selected.type === 'backpack' || selected.capacity > 0" type="button" class="btn btn-primary btn-sm" @click="emit('pick', selected, true); modalOpen = false">
              <Icon name="backpack" :size="14" /> Как контейнер
            </button>
            <button type="button" class="btn btn-sm" :class="{ 'btn-primary': !(selected.type === 'backpack' || selected.capacity > 0) }" @click="emit('pick', selected, false); modalOpen = false">
              <Icon name="plus" :size="14" /> {{ pickLabel }}
            </button>
          </template>
        </template>
      </Pf2eItemCard>
    </Modal>
  </div>
</template>

<style scoped>
.pf-browser { display: flex; flex-direction: column; gap: 14px; }
.search-wrap { position: relative; min-width: 220px; }
.search-ic { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-faint); pointer-events: none; }
.search-inp { padding-left: 32px; padding-right: 30px; }
.search-x { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); width: 26px; height: 26px; }

.lang-switch { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.lang-switch button { border: 0; background: var(--surface-2); padding: 5px 10px; font-size: 12.5px; font-weight: 700; cursor: pointer; color: var(--text-muted); }
.lang-switch button.on { background: var(--accent); color: var(--accent-fg); }

.fcount { padding: 0 6px; border-radius: 999px; background: var(--accent-fg); color: var(--accent); font-size: 11px; font-weight: 700; }

.quick-strip { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.qs-group { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.qs-lbl { font-size: 12px; font-weight: 700; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; margin-right: 2px; }
.chip.exc { background: color-mix(in srgb, var(--danger) 16%, transparent); border-color: var(--danger); color: var(--danger); text-decoration: line-through; }

.adv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.adv-sec { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border); }
.adv-wide { grid-column: 1 / -1; }
.adv-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.mini-btn { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 999px; padding: 1px 8px; font-size: 11.5px; cursor: pointer; color: var(--text-muted); }
.mini-btn.on { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.rng-inp { width: 80px; }
.mini-scroll { display: flex; flex-wrap: wrap; gap: 4px; max-height: 110px; overflow-y: auto; margin-top: 4px; }

.pf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
.pf-split.has-detail { grid-template-columns: minmax(0, 1fr) minmax(420px, 48%); }
.pf-list-card { overflow: hidden; }
.pf-rows { display: flex; flex-direction: column; }
.pf-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border);
  cursor: pointer; transition: background .1s;
}
.pf-row:last-child { border-bottom: 0; }
.pf-row:hover { background: var(--surface-2); }
.pf-row.on { background: var(--accent-soft); }

.pf-lvl {
  width: 28px; height: 26px; border-radius: 6px; flex-shrink: 0; font-size: 12px; font-weight: 700; font-family: var(--font-mono);
  display: inline-flex; align-items: center; justify-content: center; background: var(--surface-3); color: var(--text);
}
.pf-rname { min-width: 0; }
.rar-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.rar-dot.rd-uncommon { background: #c2640c; }
.rar-dot.rd-rare { background: #2f6f95; }
.rar-dot.rd-unique { background: var(--secret); }

.pf-detail-pane { position: sticky; top: calc(var(--topbar-h) + 12px); max-height: calc(100vh - var(--topbar-h) - 24px); overflow-y: auto; }
.load-more { padding: 14px; text-align: center; }

@media (max-width: 1139px) {
  .pf-split.has-detail { grid-template-columns: minmax(0, 1fr); }
  .pf-detail-pane { display: none; }
}
@media (max-width: 820px) {
  .adv-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
