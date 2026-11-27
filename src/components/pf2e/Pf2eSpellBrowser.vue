<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Pf2eAreaType, Pf2eLang, Pf2eRarity, Pf2eSaveType, Pf2eSpellCategory, Pf2eSpellIndex, Pf2eTradition } from '@/model/pf2e'
import { ensurePf2eSpells, ensureSpellDescriptions, usePf2eCatalog } from '@/data/pf2eCatalog'
import { formatActionSymbol, formatArea, pf2eIconUrl, RARITY_LABEL, SPELL_CAT_LABEL } from '@/data/pf2eFormat'
import { PF2E_TRADITIONS } from '@/data/pf2eSpellcasting'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Pf2eTraitPicker, { type PickerOption } from './Pf2eTraitPicker.vue'
import Pf2eTriChip, { type TriVal } from './Pf2eTriChip.vue'
import Pf2eSpellCard from './Pf2eSpellCard.vue'

const props = withDefaults(defineProps<{
  pickMode?: boolean
  initialTradition?: Pf2eTradition | ''
  initialCat?: Pf2eSpellCategory | ''
  pickLabel?: string
  ownedCounts?: Record<string, number>
}>(), {
  pickMode: false,
  initialTradition: '',
  initialCat: '',
  pickLabel: 'Добавить',
  ownedCounts: () => ({}),
})

const emit = defineEmits<{
  pick: [spell: Pf2eSpellIndex]
}>()

const catalog = usePf2eCatalog()
const lang = catalog.lang
const setLang = catalog.setLang

onMounted(() => { void ensurePf2eSpells() })

// ==================== Filter State ====================
const q = ref('')
const searchInDesc = ref(false)
const ranks = ref<number[]>([])
const rankMin = ref<string>('')
const rankMax = ref<string>('')
const cats = ref<Pf2eSpellCategory[]>(props.initialCat ? [props.initialCat] : [])
const traditionsInc = ref<Pf2eTradition[]>(props.initialTradition ? [props.initialTradition] : [])
const traditionsExc = ref<Pf2eTradition[]>([])
watch(() => props.initialTradition, (t) => {
  traditionsInc.value = t ? [t] : []
  traditionsExc.value = []
})
watch(() => props.initialCat, (c) => {
  cats.value = c ? [c] : []
})
const tradMode = ref<'or' | 'and'>('or')
const raritiesInc = ref<Pf2eRarity[]>([])
const raritiesExc = ref<Pf2eRarity[]>([])
const times = ref<string[]>([])
const combatTime = ref<'all' | 'combat' | 'noncombat'>('all')
const defenseModes = ref<string[]>([]) // 'attack','fort','fort-basic','ref','ref-basic','will','will-basic','none'
const areaTypes = ref<string[]>([]) // 'none' | Pf2eAreaType
const areaMin = ref<string>('')
const areaMax = ref<string>('')
const rangeBuckets = ref<string[]>([])
const rangeMin = ref<string>('')
const rangeMax = ref<string>('')
const durationBuckets = ref<string[]>([])
const damageTypes = ref<string[]>([])
const hasDamage = ref<TriVal>(0)
const conditionsInc = ref<string[]>([])
const conditionsExc = ref<string[]>([])
const condMode = ref<'and' | 'or'>('or')
const heightenFilter = ref<'all' | 'yes' | 'no' | 'interval' | 'fixed'>('all')
const traitsInc = ref<string[]>([])
const traitsExc = ref<string[]>([])
const traitMode = ref<'and' | 'or'>('and')
const deity = ref('')
const deityQuery = ref('')
const pubs = ref<string[]>([])
const pubQuery = ref('')

// Tri-state mechanics
const triSustained = ref<TriVal>(0)
const triConcentrate = ref<TriVal>(0)
const triManipulate = ref<TriVal>(0)
const triSubtle = ref<TriVal>(0)
const triIncap = ref<TriVal>(0)
const triCounteract = ref<TriVal>(0)
const triHealing = ref<TriVal>(0)
const triPersistent = ref<TriVal>(0)
const triCost = ref<TriVal>(0)
const triReq = ref<TriVal>(0)
const triHoly = ref<TriVal>(0)
const triUnholy = ref<TriVal>(0)
const triRemaster = ref<TriVal>(0)

// Sorting & UI
const sortBy = ref<'rank' | 'name' | 'time' | 'range' | 'pub'>('rank')
const sortDir = ref<1 | -1>(1)
const showAdvanced = ref(false)
const limit = ref(60)
const selected = ref<Pf2eSpellIndex | null>(null)
const modalOpen = ref(false)

// Load descriptions if user enables full-text description search
watch([searchInDesc, lang], ([on, l]) => {
  if (on) {
    void ensureSpellDescriptions(l)
    void ensureSpellDescriptions(l === 'ru' ? 'en' : 'ru')
  }
})

// Reset pagination whenever filters change
watch(
  [
    q, searchInDesc, ranks, rankMin, rankMax, cats, traditionsInc, traditionsExc, tradMode,
    raritiesInc, raritiesExc, times, combatTime, defenseModes, areaTypes, areaMin, areaMax,
    rangeBuckets, rangeMin, rangeMax, durationBuckets, damageTypes, hasDamage,
    conditionsInc, conditionsExc, condMode, heightenFilter, traitsInc, traitsExc, traitMode,
    deity, pubs, triSustained, triConcentrate, triManipulate, triSubtle, triIncap,
    triCounteract, triHealing, triPersistent, triCost, triReq, triHoly, triUnholy, triRemaster,
    sortBy, sortDir,
  ],
  () => { limit.value = 60 },
  { deep: true },
)

const toggleIn = <T>(arr: T[], val: T): T[] => (arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])

function cycleTradition(t: Pf2eTradition) {
  if (traditionsInc.value.includes(t)) {
    traditionsInc.value = traditionsInc.value.filter((x) => x !== t)
    traditionsExc.value = [...traditionsExc.value, t]
  } else if (traditionsExc.value.includes(t)) {
    traditionsExc.value = traditionsExc.value.filter((x) => x !== t)
  } else {
    traditionsInc.value = [...traditionsInc.value, t]
  }
}

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

function resetAll() {
  q.value = ''
  searchInDesc.value = false
  ranks.value = []
  rankMin.value = ''
  rankMax.value = ''
  cats.value = []
  traditionsInc.value = []
  traditionsExc.value = []
  tradMode.value = 'or'
  raritiesInc.value = []
  raritiesExc.value = []
  times.value = []
  combatTime.value = 'all'
  defenseModes.value = []
  areaTypes.value = []
  areaMin.value = ''
  areaMax.value = ''
  rangeBuckets.value = []
  rangeMin.value = ''
  rangeMax.value = ''
  durationBuckets.value = []
  damageTypes.value = []
  hasDamage.value = 0
  conditionsInc.value = []
  conditionsExc.value = []
  condMode.value = 'or'
  heightenFilter.value = 'all'
  traitsInc.value = []
  traitsExc.value = []
  traitMode.value = 'and'
  deity.value = ''
  deityQuery.value = ''
  pubs.value = []
  pubQuery.value = ''
  triSustained.value = 0
  triConcentrate.value = 0
  triManipulate.value = 0
  triSubtle.value = 0
  triIncap.value = 0
  triCounteract.value = 0
  triHealing.value = 0
  triPersistent.value = 0
  triCost.value = 0
  triReq.value = 0
  triHoly.value = 0
  triUnholy.value = 0
  triRemaster.value = 0
}

const activeFilterCount = computed(() => {
  let n = 0
  if (q.value.trim()) n++
  if (ranks.value.length || rankMin.value !== '' || rankMax.value !== '') n++
  if (cats.value.length) n++
  if (traditionsInc.value.length || traditionsExc.value.length) n++
  if (raritiesInc.value.length || raritiesExc.value.length) n++
  if (times.value.length || combatTime.value !== 'all') n++
  if (defenseModes.value.length) n++
  if (areaTypes.value.length || areaMin.value !== '' || areaMax.value !== '') n++
  if (rangeBuckets.value.length || rangeMin.value !== '' || rangeMax.value !== '') n++
  if (durationBuckets.value.length) n++
  if (damageTypes.value.length || hasDamage.value !== 0) n++
  if (conditionsInc.value.length || conditionsExc.value.length) n++
  if (heightenFilter.value !== 'all') n++
  if (traitsInc.value.length || traitsExc.value.length) n++
  if (deity.value) n++
  if (pubs.value.length) n++
  for (const t of [triSustained, triConcentrate, triManipulate, triSubtle, triIncap, triCounteract, triHealing, triPersistent, triCost, triReq, triHoly, triUnholy, triRemaster]) {
    if (t.value !== 0) n++
  }
  return n
})

// Dynamic picker option lists with counts
const traitOptions = computed<PickerOption[]>(() => {
  const counts = new Map<string, number>()
  for (const s of catalog.spells.value) for (const t of s.traits) counts.set(t, (counts.get(t) ?? 0) + 1)
  const dict = catalog.meta.value?.traits ?? {}
  return [...counts.entries()]
    .map(([value, count]) => ({ value, ru: dict[value]?.ru ?? value, en: dict[value]?.en ?? value, count }))
    .sort((a, b) => (lang.value === 'ru' ? a.ru.localeCompare(b.ru, 'ru') : a.en.localeCompare(b.en)))
})

const conditionOptions = computed<PickerOption[]>(() => {
  const counts = new Map<string, number>()
  for (const s of catalog.spells.value) for (const c of s.conditions) counts.set(c, (counts.get(c) ?? 0) + 1)
  const dict = catalog.meta.value?.conditions ?? {}
  return [...counts.entries()]
    .map(([value, count]) => ({ value, ru: dict[value]?.ru ?? value, en: dict[value]?.en ?? value, count }))
    .sort((a, b) => (lang.value === 'ru' ? a.ru.localeCompare(b.ru, 'ru') : a.en.localeCompare(b.en)))
})

const damageOptions = computed(() => {
  const dict = catalog.meta.value?.damageTypes ?? {}
  return Object.entries(dict)
    .filter(([k]) => k !== 'untyped')
    .map(([k, v]) => ({ value: k, label: lang.value === 'ru' ? v.ru : v.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang.value === 'ru' ? 'ru' : 'en'))
})

const filteredDeities = computed(() => {
  const list = catalog.meta.value?.deities ?? []
  const s = deityQuery.value.trim().toLowerCase()
  return (s ? list.filter((d) => d.toLowerCase().includes(s)) : list).slice(0, 60)
})

const filteredPubs = computed(() => {
  const list = catalog.meta.value?.spellPubs ?? []
  const s = pubQuery.value.trim().toLowerCase()
  return s ? list.filter((p) => p.toLowerCase().includes(s)) : list
})

const TIME_OPTIONS = [
  { key: 'free', ru: '◇ Свободное', en: '◇ Free' },
  { key: 'reaction', ru: '↺ Реакция', en: '↺ Reaction' },
  { key: '1', ru: '◆ 1 действие', en: '◆ 1 action' },
  { key: '2', ru: '◆◆ 2 действия', en: '◆◆ 2 actions' },
  { key: '3', ru: '◆◆◆ 3 действия', en: '◆◆◆ 3 actions' },
  { key: 'var', ru: '◆–◆◆◆ Перемен.', en: '◆–◆◆◆ Variable' },
  { key: '1m', ru: '1 минута', en: '1 min' },
  { key: '10m', ru: '10 минут', en: '10 min' },
  { key: '1h', ru: '1 час', en: '1 hour' },
  { key: 'long', ru: 'Дольше (ритуалы)', en: 'Longer' },
]

const DEFENSE_OPTIONS = [
  { key: 'attack', ru: 'Атака (КБ)', en: 'Spell Attack (AC)' },
  { key: 'fort', ru: 'Стойкость (любой)', en: 'Fortitude (any)' },
  { key: 'fort-basic', ru: 'Простой Стойкости', en: 'Basic Fortitude' },
  { key: 'ref', ru: 'Реакция (любой)', en: 'Reflex (any)' },
  { key: 'ref-basic', ru: 'Простой Реакции', en: 'Basic Reflex' },
  { key: 'will', ru: 'Воля (любой)', en: 'Will (any)' },
  { key: 'will-basic', ru: 'Простой Воли', en: 'Basic Will' },
  { key: 'none', ru: 'Без атаки и спасбр.', en: 'No attack / save' },
]

const AREA_OPTIONS: Array<{ key: 'none' | Pf2eAreaType; ru: string; en: string }> = [
  { key: 'none', ru: 'Без области', en: 'No area' },
  { key: 'burst', ru: 'Взрыв', en: 'Burst' },
  { key: 'cone', ru: 'Конус', en: 'Cone' },
  { key: 'emanation', ru: 'Эманация', en: 'Emanation' },
  { key: 'line', ru: 'Линия', en: 'Line' },
  { key: 'cube', ru: 'Куб', en: 'Cube' },
  { key: 'cylinder', ru: 'Цилиндр', en: 'Cylinder' },
  { key: 'square', ru: 'Квадрат', en: 'Square' },
]

const RANGE_OPTIONS = [
  { key: 'self', ru: 'На себя / нет', en: 'Self / None' },
  { key: 'touch', ru: 'Касание', en: 'Touch' },
  { key: 'short', ru: '≤ 30 фт.', en: '≤ 30 ft' },
  { key: 'med', ru: '35–60 фт.', en: '35–60 ft' },
  { key: 'long', ru: '65–120 фт.', en: '65–120 ft' },
  { key: 'far', ru: '> 120 фт.', en: '> 120 ft' },
  { key: 'special', ru: 'Особая', en: 'Special' },
]

const DURATION_OPTIONS = [
  { key: 'instant', ru: 'Мгновенная', en: 'Instant' },
  { key: 'round', ru: '1 раунд / до хода', en: '1 round / turn' },
  { key: 'rounds', ru: 'Неск. раундов', en: 'Rounds' },
  { key: '1m', ru: '1 минута', en: '1 min' },
  { key: '10m', ru: '10 минут', en: '10 min' },
  { key: '1h', ru: '1–4 часа', en: '1–4 hours' },
  { key: '8h', ru: '8 ч. / подготовка', en: '8h / daily prep' },
  { key: 'day', ru: 'Сутки и дольше', en: 'Days+' },
  { key: 'unlimited', ru: 'Бесконечно', en: 'Unlimited' },
  { key: 'other', ru: 'Особая', en: 'Other' },
]

const TIME_ORDER: Record<string, number> = { free: 0, reaction: 1, '1': 2, '2': 3, '3': 4, var: 5, '1m': 6, '10m': 7, '1h': 8, long: 9 }
const COMBAT_BUCKETS = new Set(['free', 'reaction', '1', '2', '3', 'var'])

const triOk = (tri: TriVal, val: boolean) => tri === 0 || (tri === 1 ? val : !val)

function matchesDefense(s: Pf2eSpellIndex, mode: string): boolean {
  if (mode === 'attack') return s.defenseKind === 'attack' || s.defenseKind === 'both'
  if (mode === 'none') return s.defenseKind === 'none'
  if (mode === 'fort') return s.save === 'fortitude'
  if (mode === 'fort-basic') return s.save === 'fortitude' && s.basicSave
  if (mode === 'ref') return s.save === 'reflex'
  if (mode === 'ref-basic') return s.save === 'reflex' && s.basicSave
  if (mode === 'will') return s.save === 'will'
  if (mode === 'will-basic') return s.save === 'will' && s.basicSave
  return false
}

const filtered = computed(() => {
  const list = catalog.spells.value
  const needle = q.value.trim().toLowerCase()
  const descRu = catalog.spellDescRu.value
  const descEn = catalog.spellDescEn.value
  const rMin = rankMin.value !== '' ? Number(rankMin.value) : null
  const rMax = rankMax.value !== '' ? Number(rankMax.value) : null
  const aMin = areaMin.value !== '' ? Number(areaMin.value) : null
  const aMax = areaMax.value !== '' ? Number(areaMax.value) : null
  const rngMin = rangeMin.value !== '' ? Number(rangeMin.value) : null
  const rngMax = rangeMax.value !== '' ? Number(rangeMax.value) : null

  const out: Pf2eSpellIndex[] = []
  for (const s of list) {
    if (needle) {
      const nameHit = s.ru.toLowerCase().includes(needle) || s.en.toLowerCase().includes(needle)
      if (!nameHit) {
        if (!searchInDesc.value) continue
        const dRu = (descRu?.[s.id] ?? '').toLowerCase()
        const dEn = (descEn?.[s.id] ?? '').toLowerCase()
        if (!dRu.includes(needle) && !dEn.includes(needle)) continue
      }
    }
    if (ranks.value.length && !ranks.value.includes(s.rank)) continue
    if (rMin !== null && s.rank < rMin) continue
    if (rMax !== null && s.rank > rMax) continue
    if (cats.value.length && !cats.value.includes(s.cat)) continue

    if (traditionsInc.value.length) {
      const ok = tradMode.value === 'and'
        ? traditionsInc.value.every((t) => s.traditions.includes(t))
        : traditionsInc.value.some((t) => s.traditions.includes(t))
      if (!ok) continue
    }
    if (traditionsExc.value.length && traditionsExc.value.some((t) => s.traditions.includes(t))) continue

    if (raritiesInc.value.length && !raritiesInc.value.includes(s.rarity)) continue
    if (raritiesExc.value.length && raritiesExc.value.includes(s.rarity)) continue

    if (times.value.length && !times.value.includes(s.timeBucket)) continue
    if (combatTime.value === 'combat' && !COMBAT_BUCKETS.has(s.timeBucket)) continue
    if (combatTime.value === 'noncombat' && COMBAT_BUCKETS.has(s.timeBucket)) continue

    if (defenseModes.value.length && !defenseModes.value.some((m) => matchesDefense(s, m))) continue

    if (areaTypes.value.length) {
      const matchArea = areaTypes.value.some((a) => (a === 'none' ? !s.areaType : s.areaType === a))
      if (!matchArea) continue
    }
    if (aMin !== null && (s.areaVal == null || s.areaVal < aMin)) continue
    if (aMax !== null && (s.areaVal == null || s.areaVal > aMax)) continue

    if (rangeBuckets.value.length && !rangeBuckets.value.includes(s.rangeBucket)) continue
    if (rngMin !== null && (s.rangeFt == null || s.rangeFt < rngMin)) continue
    if (rngMax !== null && (s.rangeFt == null || s.rangeFt > rngMax)) continue

    if (durationBuckets.value.length && !durationBuckets.value.includes(s.durationBucket)) continue

    if (!triOk(hasDamage.value, s.damageTypes.length > 0)) continue
    if (damageTypes.value.length && !damageTypes.value.some((dt) => s.damageTypes.includes(dt))) continue

    if (conditionsInc.value.length) {
      const ok = condMode.value === 'and'
        ? conditionsInc.value.every((c) => s.conditions.includes(c))
        : conditionsInc.value.some((c) => s.conditions.includes(c))
      if (!ok) continue
    }
    if (conditionsExc.value.length && conditionsExc.value.some((c) => s.conditions.includes(c))) continue

    if (heightenFilter.value === 'yes' && s.heightenType === 'none') continue
    if (heightenFilter.value === 'no' && s.heightenType !== 'none') continue
    if (heightenFilter.value === 'interval' && s.heightenType !== 'interval') continue
    if (heightenFilter.value === 'fixed' && s.heightenType !== 'fixed') continue

    if (traitsInc.value.length) {
      const ok = traitMode.value === 'and'
        ? traitsInc.value.every((t) => s.traits.includes(t))
        : traitsInc.value.some((t) => s.traits.includes(t))
      if (!ok) continue
    }
    if (traitsExc.value.length && traitsExc.value.some((t) => s.traits.includes(t))) continue

    if (deity.value && !s.deities.includes(deity.value)) continue
    if (pubs.value.length && !pubs.value.includes(s.pub)) continue

    if (!triOk(triSustained.value, s.sustained)) continue
    if (!triOk(triConcentrate.value, s.traits.includes('concentrate'))) continue
    if (!triOk(triManipulate.value, s.traits.includes('manipulate'))) continue
    if (!triOk(triSubtle.value, s.traits.includes('subtle'))) continue
    if (!triOk(triIncap.value, s.traits.includes('incapacitation'))) continue
    if (!triOk(triCounteract.value, s.counteract)) continue
    if (!triOk(triHealing.value, s.hasHealing)) continue
    if (!triOk(triPersistent.value, s.hasPersistent)) continue
    if (!triOk(triCost.value, s.hasCost)) continue
    if (!triOk(triReq.value, s.hasReq)) continue
    if (!triOk(triHoly.value, s.traits.includes('holy') || s.traits.includes('sanctified'))) continue
    if (!triOk(triUnholy.value, s.traits.includes('unholy') || s.traits.includes('sanctified'))) continue
    if (!triOk(triRemaster.value, s.remaster)) continue

    out.push(s)
  }

  const dir = sortDir.value
  const l = lang.value
  out.sort((a, b) => {
    let cmp = 0
    if (sortBy.value === 'rank') cmp = a.rank - b.rank
    else if (sortBy.value === 'time') cmp = (TIME_ORDER[a.timeBucket] ?? 9) - (TIME_ORDER[b.timeBucket] ?? 9)
    else if (sortBy.value === 'range') cmp = (a.rangeFt ?? 999999) - (b.rangeFt ?? 999999)
    else if (sortBy.value === 'pub') cmp = a.pub.localeCompare(b.pub)
    if (cmp !== 0) return cmp * dir
    return (l === 'ru' ? a.ru.localeCompare(b.ru, 'ru') : a.en.localeCompare(b.en)) * (sortBy.value === 'name' ? dir : 1)
  })
  return out
})

const shown = computed(() => filtered.value.slice(0, limit.value))

function openSpell(s: Pf2eSpellIndex) {
  selected.value = s
  if (window.innerWidth < 1140) modalOpen.value = true
}

function saveShort(s: Pf2eSpellIndex): string {
  const parts: string[] = []
  if (s.defenseKind === 'attack' || s.defenseKind === 'both') parts.push(lang.value === 'ru' ? 'КБ' : 'AC')
  if (s.save) {
    const mapRu: Record<Pf2eSaveType, string> = { fortitude: 'Ст', reflex: 'Ре', will: 'Во' }
    const mapEn: Record<Pf2eSaveType, string> = { fortitude: 'Fort', reflex: 'Ref', will: 'Will' }
    parts.push((s.basicSave ? (lang.value === 'ru' ? 'пр.' : 'b.') : '') + (lang.value === 'ru' ? mapRu[s.save] : mapEn[s.save]))
  }
  return parts.join('/')
}
</script>

<template>
  <div class="pf-browser">
    <!-- Top search + language + quick controls -->
    <div class="card card-pad stack-sm pf-filter-bar">
      <div class="row gap-sm wrap">
        <div class="search-wrap grow">
          <Icon name="search" :size="15" class="search-ic" />
          <input
            v-model="q"
            type="text"
            class="input search-inp"
            :placeholder="lang === 'ru' ? 'Поиск заклинаний (RU / EN)…' : 'Search spells (EN / RU)…'"
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

      <!-- Quick always-visible filter strips: Rank, Tradition, Category, Cast Time -->
      <div class="quick-strip">
        <div class="qs-group">
          <span class="qs-lbl">Круг:</span>
          <button
            v-for="r in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"
            :key="r"
            type="button"
            class="chip"
            :class="{ on: ranks.includes(r) }"
            @click="ranks = toggleIn(ranks, r)"
          >
            {{ r === 0 ? 'Заг' : r }}
          </button>
        </div>

        <div class="qs-group">
          <span class="qs-lbl" title="1 клик — включить, 2 клика — исключить">Традиция:</span>
          <button
            v-for="t in PF2E_TRADITIONS"
            :key="t.id"
            type="button"
            class="chip"
            :class="{ on: traditionsInc.includes(t.id), exc: traditionsExc.includes(t.id) }"
            :title="traditionsInc.includes(t.id) ? 'Включено (кликните для исключения)' : traditionsExc.includes(t.id) ? 'Исключено (кликните для сброса)' : 'Кликните, чтобы включить'"
            @click="cycleTradition(t.id)"
          >
            {{ traditionsExc.includes(t.id) ? '− ' : '' }}{{ lang === 'ru' ? t.ru : t.en }}
          </button>
          <button
            v-if="traditionsInc.length > 1"
            type="button"
            class="btn btn-sm btn-ghost"
            style="padding: 2px 7px; font-size: 11.5px"
            @click="tradMode = tradMode === 'or' ? 'and' : 'or'"
          >
            {{ tradMode === 'or' ? 'ИЛИ' : 'И (все)' }}
          </button>
        </div>

        <div class="qs-group">
          <span class="qs-lbl">Тип:</span>
          <button
            v-for="c in (['spell', 'cantrip', 'focus', 'ritual', 'impossible'] as Pf2eSpellCategory[])"
            :key="c"
            type="button"
            class="chip"
            :class="{ on: cats.includes(c) }"
            @click="cats = toggleIn(cats, c)"
          >
            {{ SPELL_CAT_LABEL[c][lang] }}
          </button>
        </div>
      </div>

      <!-- Advanced Filters Drawer -->
      <div v-if="showAdvanced" class="adv-grid">
        <!-- Cast Time -->
        <div class="adv-sec">
          <div class="adv-head">
            <span>Время сотворения</span>
            <div class="row gap-sm">
              <button type="button" class="mini-btn" :class="{ on: combatTime === 'combat' }" @click="combatTime = combatTime === 'combat' ? 'all' : 'combat'">Боевые (≤3)</button>
              <button type="button" class="mini-btn" :class="{ on: combatTime === 'noncombat' }" @click="combatTime = combatTime === 'noncombat' ? 'all' : 'noncombat'">Внебоевые</button>
            </div>
          </div>
          <div class="row gap-sm wrap">
            <button v-for="t in TIME_OPTIONS" :key="t.key" type="button" class="chip" :class="{ on: times.includes(t.key) }" @click="times = toggleIn(times, t.key)">
              {{ lang === 'ru' ? t.ru : t.en }}
            </button>
          </div>
        </div>

        <!-- Defense & Saves -->
        <div class="adv-sec">
          <div class="adv-head"><span>Защита и спасброски</span></div>
          <div class="row gap-sm wrap">
            <button v-for="d in DEFENSE_OPTIONS" :key="d.key" type="button" class="chip" :class="{ on: defenseModes.includes(d.key) }" @click="defenseModes = toggleIn(defenseModes, d.key)">
              {{ lang === 'ru' ? d.ru : d.en }}
            </button>
          </div>
        </div>

        <!-- Area -->
        <div class="adv-sec">
          <div class="adv-head">
            <span>Область действия</span>
            <div class="row gap-sm small">
              <input v-model="areaMin" type="number" min="0" class="input input-sm rng-inp" placeholder="от фт" />
              <span>–</span>
              <input v-model="areaMax" type="number" min="0" class="input input-sm rng-inp" placeholder="до фт" />
            </div>
          </div>
          <div class="row gap-sm wrap">
            <button v-for="a in AREA_OPTIONS" :key="a.key" type="button" class="chip" :class="{ on: areaTypes.includes(a.key) }" @click="areaTypes = toggleIn(areaTypes, a.key)">
              {{ lang === 'ru' ? a.ru : a.en }}
            </button>
          </div>
        </div>

        <!-- Range -->
        <div class="adv-sec">
          <div class="adv-head">
            <span>Дистанция</span>
            <div class="row gap-sm small">
              <input v-model="rangeMin" type="number" min="0" class="input input-sm rng-inp" placeholder="от фт" />
              <span>–</span>
              <input v-model="rangeMax" type="number" min="0" class="input input-sm rng-inp" placeholder="до фт" />
            </div>
          </div>
          <div class="row gap-sm wrap">
            <button v-for="r in RANGE_OPTIONS" :key="r.key" type="button" class="chip" :class="{ on: rangeBuckets.includes(r.key) }" @click="rangeBuckets = toggleIn(rangeBuckets, r.key)">
              {{ lang === 'ru' ? r.ru : r.en }}
            </button>
          </div>
        </div>

        <!-- Duration -->
        <div class="adv-sec">
          <div class="adv-head"><span>Длительность</span></div>
          <div class="row gap-sm wrap">
            <button v-for="d in DURATION_OPTIONS" :key="d.key" type="button" class="chip" :class="{ on: durationBuckets.includes(d.key) }" @click="durationBuckets = toggleIn(durationBuckets, d.key)">
              {{ lang === 'ru' ? d.ru : d.en }}
            </button>
          </div>
        </div>

        <!-- Damage Types -->
        <div class="adv-sec">
          <div class="adv-head">
            <span>Типы урона</span>
            <Pf2eTriChip v-model="hasDamage" label="Наносит урон" />
          </div>
          <div class="row gap-sm wrap">
            <button v-for="dt in damageOptions" :key="dt.value" type="button" class="chip" :class="{ on: damageTypes.includes(dt.value) }" @click="damageTypes = toggleIn(damageTypes, dt.value)">
              {{ dt.label }}
            </button>
          </div>
        </div>

        <!-- Rarity & Heightening & Rank Range -->
        <div class="adv-sec">
          <div class="adv-head"><span>Редкость (1 клик: вкл / 2: искл), Усиление, Круг</span></div>
          <div class="row gap-sm wrap" style="margin-bottom: 6px">
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
          <div class="row gap wrap small">
            <label class="row gap-sm">
              <span class="muted">Усиление:</span>
              <select v-model="heightenFilter" class="input input-sm" style="width: auto">
                <option value="all">Любое</option>
                <option value="yes">Есть усиление</option>
                <option value="no">Без усиления</option>
                <option value="interval">Интервальное (+1, +2…)</option>
                <option value="fixed">Фиксированные круги</option>
              </select>
            </label>
            <label class="row gap-sm">
              <span class="muted">Круг:</span>
              <input v-model="rankMin" type="number" min="0" max="10" class="input input-sm rng-inp" placeholder="от" />
              <span>–</span>
              <input v-model="rankMax" type="number" min="0" max="10" class="input input-sm rng-inp" placeholder="до" />
            </label>
          </div>
        </div>

        <!-- Tri-state Mechanics -->
        <div class="adv-sec adv-wide">
          <div class="adv-head"><span>Механики (клик: Любое → Да ✓ → Нет ✕)</span></div>
          <div class="row gap-sm wrap">
            <Pf2eTriChip v-model="triSustained" label="Поддерживаемое" />
            <Pf2eTriChip v-model="triConcentrate" label="Концентрация" />
            <Pf2eTriChip v-model="triManipulate" label="Манипуляция" />
            <Pf2eTriChip v-model="triSubtle" label="Тонкое (Subtle)" />
            <Pf2eTriChip v-model="triIncap" label="Недееспособность" />
            <Pf2eTriChip v-model="triCounteract" label="Противодействие" />
            <Pf2eTriChip v-model="triHealing" label="Исцеление" />
            <Pf2eTriChip v-model="triPersistent" label="Продолж. урон" />
            <Pf2eTriChip v-model="triCost" label="Есть стоимость" />
            <Pf2eTriChip v-model="triReq" label="Есть требования" />
            <Pf2eTriChip v-model="triHoly" label="Святое" />
            <Pf2eTriChip v-model="triUnholy" label="Нечестивое" />
            <Pf2eTriChip v-model="triRemaster" label="Remaster" />
          </div>
        </div>

        <!-- Conditions -->
        <div class="adv-sec adv-wide">
          <div class="adv-head"><span>Налагаемые состояния (Conditions)</span></div>
          <Pf2eTraitPicker
            v-model:include="conditionsInc"
            v-model:exclude="conditionsExc"
            v-model:mode="condMode"
            :options="conditionOptions"
            :lang="lang"
            placeholder="Напуган, Ошеломлён, Замедлен, Frightened…"
          />
        </div>

        <!-- Traits -->
        <div class="adv-sec adv-wide">
          <div class="adv-head"><span>Черты заклинаний (Traits — включить И/ИЛИ или исключить)</span></div>
          <Pf2eTraitPicker
            v-model:include="traitsInc"
            v-model:exclude="traitsExc"
            v-model:mode="traitMode"
            :options="traitOptions"
            :lang="lang"
            placeholder="Огонь, Иллюзия, Психический, Emotion, Mental…"
          />
        </div>

        <!-- Deity & Publication -->
        <div class="adv-sec">
          <div class="adv-head"><span>Божество (даруемые заклинания)</span></div>
          <div class="row gap-sm">
            <input v-model="deityQuery" type="text" class="input input-sm grow" placeholder="Поиск божества (Sarenrae, Pharasma…)" />
            <button v-if="deity" type="button" class="btn btn-sm btn-ghost danger" @click="deity = ''"><Icon name="x" :size="13" /> {{ deity }}</button>
          </div>
          <div v-if="deityQuery.trim()" class="mini-scroll">
            <button v-for="d in filteredDeities" :key="d" type="button" class="chip" :class="{ on: deity === d }" @click="deity = deity === d ? '' : d; deityQuery = ''">
              {{ d }}
            </button>
          </div>
        </div>

        <div class="adv-sec">
          <div class="adv-head">
            <span>Источники / книги ({{ pubs.length || 'все' }})</span>
            <button v-if="pubs.length" type="button" class="mini-btn" @click="pubs = []">Сбросить</button>
          </div>
          <input v-model="pubQuery" type="text" class="input input-sm" placeholder="Фильтр книг (Player Core, Secrets of Magic…)" />
          <div class="mini-scroll">
            <button v-for="p in filteredPubs" :key="p" type="button" class="chip" :class="{ on: pubs.includes(p) }" @click="pubs = toggleIn(pubs, p)">
              {{ p }}
            </button>
          </div>
        </div>
      </div>

      <!-- Result count & sort bar -->
      <div class="row gap wrap small muted" style="padding-top: 4px; border-top: 1px solid var(--border)">
        <span>Найдено: <b>{{ filtered.length }}</b> из {{ catalog.spells.value.length }}</span>
        <span class="grow" />
        <label class="row gap-sm">
          <span>Сортировка:</span>
          <select v-model="sortBy" class="input input-sm" style="width: auto">
            <option value="rank">По кругу</option>
            <option value="name">По названию</option>
            <option value="time">По действиям</option>
            <option value="range">По дистанции</option>
            <option value="pub">По источнику</option>
          </select>
        </label>
        <button type="button" class="btn btn-sm btn-ghost" @click="sortDir = sortDir === 1 ? -1 : 1">
          <Icon :name="sortDir === 1 ? 'arrow-up' : 'arrow-down'" :size="14" /> {{ sortDir === 1 ? 'Возр.' : 'Убыв.' }}
        </button>
      </div>
    </div>

    <!-- Loading / Error -->
    <div v-if="catalog.loadingSpells.value" class="card empty">
      <Icon name="refresh-cw" class="spin" :size="24" />
      <p>Загружаем библиотеку заклинаний Pathfinder 2e…</p>
    </div>
    <div v-else-if="catalog.loadError.value" class="card empty danger">
      Ошибка загрузки: {{ catalog.loadError.value }}
    </div>

    <!-- Results + Split Detail -->
    <div v-else class="pf-split" :class="{ 'has-detail': Boolean(selected) }">
      <div class="card pf-list-card">
        <div v-if="!filtered.length" class="empty">
          <Icon name="search" :size="28" />
          <p>Заклинания по заданным фильтрам не найдены.</p>
          <button v-if="activeFilterCount" type="button" class="btn btn-sm" @click="resetAll">Сбросить фильтры</button>
        </div>

        <div v-else class="pf-rows">
          <div
            v-for="s in shown"
            :key="s.id"
            class="pf-row"
            :class="{ on: selected?.id === s.id }"
            @click="openSpell(s)"
          >
            <span class="pf-rk" :class="'cat-' + s.cat" :title="SPELL_CAT_LABEL[s.cat][lang]">
              {{ s.cat === 'cantrip' ? 'З' : s.cat === 'focus' ? `Ф${s.baseRank}` : s.cat === 'ritual' ? `Р${s.baseRank}` : s.rank }}
            </span>

            <img v-if="s.img" :src="pf2eIconUrl(s.img)" alt="" class="pf-row-ic" loading="lazy" decoding="async" />

            <div class="pf-rname grow">
              <div class="row gap-sm" style="align-items: baseline">
                <b class="ellipsis">{{ lang === 'ru' ? s.ru : s.en }}</b>
                <span v-if="s.rarity !== 'common'" class="rar-dot" :class="'rd-' + s.rarity" :title="RARITY_LABEL[s.rarity][lang]" />
                <span v-if="ownedCounts[s.id]" class="badge badge-public" style="font-size: 10.5px" :title="lang === 'ru' ? 'Уже в списке персонажа' : 'Already in character list'">
                  ✓<template v-if="ownedCounts[s.id] > 1"> ×{{ ownedCounts[s.id] }}</template>
                </span>
              </div>
              <div class="faint small ellipsis">
                {{ lang === 'ru' ? s.en : s.ru }}
                <template v-if="s.areaType"> · {{ formatArea(s.areaType, s.areaVal, lang) }}</template>
                <template v-else-if="s.range"> · {{ lang === 'ru' ? s.rangeRu : s.range }}</template>
              </div>
            </div>

            <span class="pf-ract" :title="formatActionSymbol(s.time, lang, s.timeRu).text">
              {{ formatActionSymbol(s.time, lang, s.timeRu).glyph ?? formatActionSymbol(s.time, lang, s.timeRu).text }}
            </span>

            <span v-if="saveShort(s)" class="badge hide-sm">{{ saveShort(s) }}</span>

            <div class="pf-rtrads hide-sm">
              <span
                v-for="t in s.traditions"
                :key="t"
                class="tdot"
                :style="{ background: PF2E_TRADITIONS.find((x) => x.id === t)?.color }"
                :title="PF2E_TRADITIONS.find((x) => x.id === t)?.[lang]"
              />
            </div>

            <button
              v-if="pickMode"
              type="button"
              class="btn btn-sm btn-primary"
              style="flex-shrink: 0"
              @click.stop="emit('pick', s)"
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

      <!-- Sticky Desktop Detail Card -->
      <aside v-if="selected" class="card card-pad pf-detail-pane">
        <Pf2eSpellCard :spell="selected" :meta="catalog.meta.value" :lang="lang">
          <template #actions>
            <button v-if="pickMode" type="button" class="btn btn-primary btn-sm" @click="emit('pick', selected)">
              <Icon name="plus" :size="14" /> {{ pickLabel }}
            </button>
            <button type="button" class="btn btn-sm btn-ghost" @click="selected = null">Закрыть</button>
          </template>
        </Pf2eSpellCard>
      </aside>
    </div>

    <!-- Mobile / Tablet Detail Modal -->
    <Modal v-if="modalOpen && selected" width="760px" @close="modalOpen = false">
      <Pf2eSpellCard :spell="selected" :meta="catalog.meta.value" :lang="lang">
        <template #actions>
          <button v-if="pickMode" type="button" class="btn btn-primary btn-sm" @click="emit('pick', selected); modalOpen = false">
            <Icon name="plus" :size="14" /> {{ pickLabel }}
          </button>
        </template>
      </Pf2eSpellCard>
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

.adv-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
  padding-top: 10px; border-top: 1px solid var(--border);
}
.adv-sec { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border); }
.adv-wide { grid-column: 1 / -1; }
.adv-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.mini-btn { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 999px; padding: 1px 8px; font-size: 11.5px; cursor: pointer; color: var(--text-muted); }
.mini-btn.on { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.rng-inp { width: 78px; }
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

.pf-rk {
  width: 30px; height: 28px; border-radius: 6px; flex-shrink: 0; font-size: 12.5px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface-3); color: var(--text);
}
.pf-rk.cat-cantrip { background: color-mix(in srgb, var(--info) 20%, transparent); color: var(--info); }
.pf-rk.cat-focus { background: color-mix(in srgb, var(--secret) 20%, transparent); color: var(--secret); }
.pf-rk.cat-ritual { background: color-mix(in srgb, var(--warning) 20%, transparent); color: var(--warning); }
.pf-row-ic { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); background: var(--surface-2); }

.pf-rname { min-width: 0; }
.pf-ract { font-size: 13px; color: var(--accent); font-weight: 700; white-space: nowrap; flex-shrink: 0; }
.pf-rtrads { display: inline-flex; gap: 4px; flex-shrink: 0; }
.tdot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }

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
