<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  Pf2eAttribute, Pf2eCastingType, Pf2eCharacter, Pf2eProficiency, Pf2eSpellEntryItem,
  Pf2eSpellIndex, Pf2eSpellList, Pf2eTradition,
} from '@/model/pf2e'
import { ensurePf2eSpells, usePf2eCatalog } from '@/data/pf2eCatalog'
import {
  autoRank, computeSpellStats, fullCasterProficiency, PF2E_ATTRIBUTES, PF2E_CASTING_TYPES,
  PF2E_CLASS_PRESETS, PF2E_PROFICIENCIES, PF2E_TRADITIONS,
} from '@/data/pf2eSpellcasting'
import { formatActionSymbol, pf2eIconUrl, SPELL_CAT_LABEL } from '@/data/pf2eFormat'
import { randomId } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Pf2eSpellBrowser from './Pf2eSpellBrowser.vue'
import Pf2eSpellCard from './Pf2eSpellCard.vue'
import { toast } from '@/components/common/toast'

const props = defineProps<{ character: Pf2eCharacter }>()
const emit = defineEmits<{ save: [spellLists: Pf2eSpellList[]] }>()

const catalog = usePf2eCatalog()
const lang = catalog.lang
const setLang = catalog.setLang
onMounted(() => { void ensurePf2eSpells() })

const activeListId = ref<string | null>(props.character.spellLists[0]?.id ?? null)
const searchQ = ref('')
const viewingSpell = ref<Pf2eSpellIndex | null>(null)

// Ensure activeListId stays valid
const activeList = computed(() => {
  const lists = props.character.spellLists
  if (!lists.length) return null
  return lists.find((l) => l.id === activeListId.value) ?? lists[0]
})

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

// ==================== Add Spell Modal (Library + Custom) ====================
const pickerOpen = ref(false)
const pickerTargetRank = ref<number | null>(null)
const customModal = ref<{ name: string; rank: number; notes: string; usesMax: number; atWill: boolean } | null>(null)

function openSpellPicker(rank: number | null = null) {
  pickerTargetRank.value = rank
  pickerOpen.value = true
}

function onPickSpell(sp: Pf2eSpellIndex) {
  const l = activeList.value
  if (!l) return
  const rank = pickerTargetRank.value != null
    ? pickerTargetRank.value
    : sp.cat === 'cantrip' ? 0 : sp.baseRank
  updateList(l.id, (entry) => {
    entry.spells.push({
      id: randomId(10),
      spellId: sp.id,
      rank,
      preparedCount: entry.castingType === 'prepared' && rank > 0 ? 1 : undefined,
      expendedCount: 0,
      usesMax: entry.castingType === 'innate' && rank > 0 ? 1 : undefined,
      usesLeft: entry.castingType === 'innate' && rank > 0 ? 1 : undefined,
      atWill: entry.castingType === 'innate' && rank === 0,
      notes: '',
    })
  })
  toast.success(`Добавлено: ${lang.value === 'ru' ? sp.ru : sp.en} (${rank === 0 ? 'заговор' : `${rank} круг`})`)
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

// ==================== Row Operations ====================
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

function toggleSignature(row: Pf2eSpellEntryItem) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    const t = entry.spells.find((x) => x.id === row.id)
    if (t) t.signature = !t.signature
  })
}

function bumpPrepared(row: Pf2eSpellEntryItem, delta: number) {
  const l = activeList.value
  if (!l) return
  updateList(l.id, (entry) => {
    const t = entry.spells.find((x) => x.id === row.id)
    if (!t) return
    const next = Math.max(0, (t.preparedCount ?? 1) + delta)
    t.preparedCount = next
    if ((t.expendedCount ?? 0) > next) t.expendedCount = next
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
  }
  for (const sp of l.spells) ranksSet.add(sp.rank)

  const sortedRanks = [...ranksSet].sort((a, b) => a - b)
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
    const preparedSum = items.reduce((s, r) => s + (r.preparedCount ?? 0), 0)
    const usedShared = l.slotsUsed[rank] ?? 0
    return { rank, items, maxSlots, preparedSum, usedShared }
  })
})

const stats = computed(() => (activeList.value ? computeSpellStats(props.character.level, activeList.value) : null))
const cantripRank = computed(() => autoRank(props.character.level))
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
          <Icon name="bed-double" :size="14" /> Дневной отдых
        </button>

        <div class="lang-switch" role="group" aria-label="Язык заклинаний">
          <button type="button" :class="{ on: lang === 'ru' }" @click="setLang('ru')">RU</button>
          <button type="button" :class="{ on: lang === 'en' }" @click="setLang('en')">EN</button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!activeList" class="empty" style="padding: 24px">
        <Icon name="sparkles" :size="30" />
        <p>У персонажа пока нет списков заклинаний. Добавьте список (подготавливаемый, спонтанный, фокусный, врождённый или ритуалы).</p>
        <button type="button" class="btn btn-primary btn-sm" @click="openNewEntry"><Icon name="plus" :size="14" /> Создать список заклинаний</button>
      </div>

      <!-- Active Entry Summary Header -->
      <template v-else>
        <div class="entry-head">
          <div class="row gap wrap grow">
            <div>
              <div class="row gap-sm wrap">
                <h3 style="margin: 0; font-size: 22px">{{ activeList.name }}</h3>
                <span class="badge">{{ PF2E_CASTING_TYPES.find((x) => x.id === activeList!.castingType)?.ru }}</span>
                <span v-if="activeList.flexible" class="badge badge-public">Гибкий заклинатель</span>
                <span
                  v-if="activeList.tradition"
                  class="trad-badge"
                  :style="{ '--tc': PF2E_TRADITIONS.find((x) => x.id === activeList!.tradition)?.color }"
                >
                  {{ PF2E_TRADITIONS.find((x) => x.id === activeList!.tradition)?.[lang] }}
                </span>
              </div>
              <div class="faint small" style="margin-top: 2px">
                Ключевая хар.: {{ PF2E_ATTRIBUTES.find((x) => x.id === activeList!.keyAttr)?.ru }} ({{ signed(activeList.keyMod) }})
                · Мастерство: {{ PF2E_PROFICIENCIES.find((x) => x.rank === activeList!.proficiency)?.ru }}
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
              <span class="faint small">Очки фокуса ({{ activeList.focusCurrent ?? 0 }}/{{ activeList.focusMax ?? 1 }})</span>
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
            <button type="button" class="btn btn-sm btn-primary" @click="openSpellPicker(null)">
              <Icon name="book-open" :size="14" /> Из библиотеки
            </button>
            <button type="button" class="btn btn-sm" @click="openCustomSpell(activeList.castingType === 'focus' ? cantripRank : 1)">
              <Icon name="plus" :size="14" /> Своё
            </button>
            <button type="button" class="icon-btn" title="Настройки списка" @click="openEditEntry(activeList)"><Icon name="settings" :size="16" /></button>
            <button type="button" class="icon-btn danger" title="Удалить список" @click="deleteEntry(activeList)"><Icon name="trash2" :size="16" /></button>
          </div>
        </div>

        <div class="row gap-sm">
          <input v-model="searchQ" type="text" class="input input-sm" style="max-width: 320px" placeholder="Фильтр по заклинаниям в этом списке…" />
          <span class="faint small">Автоусиление заговоров и фокуса на ур. {{ character.level }}: <b>{{ cantripRank }} круг</b></span>
        </div>
      </template>
    </div>

    <!-- Rank Sections -->
    <template v-if="activeList">
      <div v-if="!rankGroups.length" class="card empty">
        <p class="muted">В этом списке пока нет заклинаний. Нажмите «Из библиотеки» или «Своё», чтобы добавить.</p>
      </div>

      <section v-for="g in rankGroups" :key="g.rank" class="card rank-sec">
        <header class="rs-head">
          <div class="row gap-sm wrap grow">
            <h4 style="margin: 0; font-size: 18px">
              <template v-if="g.rank === 0">Заговоры <span class="faint small">(круг {{ cantripRank }})</span></template>
              <template v-else-if="activeList.castingType === 'focus'">Фокусные — базовый круг {{ g.rank }} <span class="faint small">(сотворяются на {{ Math.max(g.rank, cantripRank) }} круге)</span></template>
              <template v-else-if="activeList.castingType === 'ritual'">Ритуалы {{ g.rank }} круга</template>
              <template v-else>Круг {{ g.rank }}</template>
            </h4>

            <!-- Spontaneous / Flexible shared slots -->
            <div v-if="g.rank > 0 && (activeList.castingType === 'spontaneous' || activeList.flexible) && g.maxSlots > 0" class="row gap-sm">
              <span class="small muted">Ячейки: {{ g.maxSlots - g.usedShared }}/{{ g.maxSlots }}</span>
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
              Подготовлено: {{ g.preparedSum }} / {{ g.maxSlots }}
            </span>
          </div>

          <button type="button" class="btn btn-sm btn-ghost" @click="openSpellPicker(g.rank)">
            <Icon name="plus" :size="13" /> Добавить
          </button>
        </header>

        <div v-if="!g.items.length" class="faint small" style="padding: 10px 14px">Пусто</div>
        <div v-else class="sp-rows">
          <div v-for="row in g.items" :key="row.id" class="sp-row">
            <img v-if="spellImg(row)" :src="spellImg(row)" alt="" class="pf-sp-ic" loading="lazy" decoding="async" />
            <button
              type="button"
              class="sp-main grow"
              :disabled="!row.spellId"
              @click="row.spellId && (viewingSpell = catalog.spellsById.value.get(row.spellId) ?? null)"
            >
              <span class="row gap-sm" style="align-items: baseline">
                <b class="ellipsis">{{ spellName(row) }}</b>
                <span v-if="row.spellId && catalog.spellsById.value.get(row.spellId)" class="pf-act-sm">
                  {{ formatActionSymbol(catalog.spellsById.value.get(row.spellId)!.time, lang, catalog.spellsById.value.get(row.spellId)!.timeRu).glyph ?? formatActionSymbol(catalog.spellsById.value.get(row.spellId)!.time, lang, catalog.spellsById.value.get(row.spellId)!.timeRu).text }}
                </span>
                <span v-if="row.signature" class="badge" title="Фирменное заклинание (можно творить на любом круге)">★ Фирменное</span>
                <span v-if="!row.spellId" class="badge">Своё</span>
              </span>
              <span v-if="spellSecondary(row) || row.notes" class="faint small ellipsis">
                {{ spellSecondary(row) }}<template v-if="row.notes"> · {{ row.notes }}</template>
              </span>
            </button>

            <!-- Prepared: count stepper + expended checkboxes -->
            <div v-if="g.rank > 0 && activeList.castingType === 'prepared' && !activeList.flexible" class="row gap-sm">
              <div class="row" style="gap: 3px">
                <button
                  v-for="si in (row.preparedCount ?? 0)"
                  :key="si"
                  type="button"
                  class="slot-box"
                  :class="{ used: si - 1 < (row.expendedCount ?? 0) }"
                  :title="si - 1 < (row.expendedCount ?? 0) ? 'Восстановить' : 'Отметить использованным'"
                  @click="togglePreparedCast(row, si - 1)"
                />
              </div>
              <div class="mini-step">
                <button type="button" title="Уменьшить кол-во подготовок" @click="bumpPrepared(row, -1)">−</button>
                <span>{{ row.preparedCount ?? 0 }}</span>
                <button type="button" title="Подготовить ещё раз" @click="bumpPrepared(row, 1)">+</button>
              </div>
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
              <Icon name="star" :size="15" />
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

            <button type="button" class="icon-btn" title="Настроить запись" @click="editRow = { ...row }"><Icon name="pencil" :size="14" /></button>
            <button type="button" class="icon-btn danger" title="Убрать" @click="removeSpellRow(row.id)"><Icon name="trash2" :size="14" /></button>
          </div>
        </div>
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

    <!-- LIBRARY PICKER MODAL -->
    <Modal v-if="pickerOpen && activeList" :title="`Добавить заклинания в «${activeList.name}»`" width="1140px" @close="pickerOpen = false">
      <div class="row gap-sm wrap" style="margin-bottom: 10px">
        <span class="small muted">Круг при добавлении:</span>
        <select v-model="pickerTargetRank" class="input input-sm" style="width: auto">
          <option :value="null">Базовый круг заклинания</option>
          <option :value="0">Заговор (0)</option>
          <option v-for="r in 10" :key="r" :value="r">Круг {{ r }} (усиление)</option>
        </select>
      </div>
      <Pf2eSpellBrowser
        pick-mode
        :initial-tradition="activeList.tradition"
        :initial-cat="activeList.castingType === 'focus' ? 'focus' : activeList.castingType === 'ritual' ? 'ritual' : ''"
        pick-label="Добавить в список"
        @pick="onPickSpell"
      />
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

    <!-- VIEW SPELL CARD MODAL -->
    <Modal v-if="viewingSpell" width="760px" @close="viewingSpell = null">
      <Pf2eSpellCard :spell="viewingSpell" :meta="catalog.meta.value" :lang="lang" />
    </Modal>
  </div>
</template>

<style scoped>
.entry-pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px;
  border: 1px solid var(--border-strong); background: var(--surface-2); cursor: pointer; font-size: 13.5px;
}
.entry-pill:hover { border-color: var(--accent); }
.entry-pill.on { background: var(--accent-soft); border-color: var(--accent); }
.ep-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }

.lang-switch { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.lang-switch button { border: 0; background: var(--surface-2); padding: 4px 9px; font-size: 12px; font-weight: 700; cursor: pointer; color: var(--text-muted); }
.lang-switch button.on { background: var(--accent); color: var(--accent-fg); }

.entry-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border);
}
.trad-badge {
  display: inline-flex; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  background: color-mix(in srgb, var(--tc) 18%, transparent); border: 1px solid color-mix(in srgb, var(--tc) 45%, transparent);
}
.stat-box {
  display: flex; flex-direction: column; align-items: center; padding: 4px 12px; border-radius: var(--radius-sm);
  background: var(--surface); border: 1px solid var(--border); min-width: 64px;
}
.stat-box b { font-family: var(--font-head); font-size: 22px; line-height: 1.05; color: var(--accent); }

.focus-pip {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--secret); background: transparent; cursor: pointer; padding: 0;
}
.focus-pip.on { background: var(--secret); }

.rank-sec { overflow: hidden; }
.rs-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border);
}
.slot-box {
  width: 18px; height: 18px; border-radius: 4px; border: 2px solid var(--accent); background: var(--accent-soft); cursor: pointer; padding: 0;
}
.slot-box.used { background: var(--surface-3); border-color: var(--border-strong); opacity: .5; }

.sp-rows { display: flex; flex-direction: column; }
.sp-row { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); }
.sp-row:last-child { border-bottom: 0; }
.sp-row:hover { background: var(--surface-2); }
.pf-sp-ic { width: 28px; height: 28px; border-radius: 5px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); background: var(--surface-2); }
.sp-main { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; min-width: 0; }
.sp-main:not(:disabled):hover b { color: var(--accent); }
.sp-main:disabled { cursor: default; }
.pf-act-sm { color: var(--accent); font-weight: 700; font-size: 13px; }

.mini-step { display: inline-flex; align-items: center; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; background: var(--surface); font-size: 12.5px; }
.mini-step button { width: 22px; height: 24px; border: 0; background: var(--surface-2); cursor: pointer; font-weight: 700; }
.mini-step button:hover { background: var(--accent-soft); color: var(--accent); }
.mini-step span { padding: 0 7px; font-family: var(--font-mono); font-weight: 600; }

.slots-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 600px) { .slots-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
