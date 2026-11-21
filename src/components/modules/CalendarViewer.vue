<script setup lang="ts">
// Calendar entity page module: month grid, year overview, event lists, settings (CalendarEditor).
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useWorld } from '@/stores/world'
import type { CalendarDate, Entity, Reminder } from '@/model/types'
import {
  addDays, addMonths, addYears, clampDate, compareDates, dayIndex, daysInMonth, formatCalendarDate, formatDateRange,
  formatYear, fromDayIndex, MOON_PHASE_LABELS, moonPhase, normalizeCalendar, occurrencesByDay, occurrencesInMonth,
  seasonOf, seasonStartingOn, upcomingOccurrences, weekdayName, weekdayOf, yearName,
  type MonthOccurrence, type Occurrence,
} from '@/data/calendar'
import { typeDef } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import CalendarEditor from './CalendarEditor.vue'
import MoonIcon from './calendar/MoonIcon.vue'
import DateInput from './calendar/DateInput.vue'
import MiniMonth from './calendar/MiniMonth.vue'
import OccurrenceItem from './calendar/OccurrenceItem.vue'
import ReminderModal from './calendar/ReminderModal.vue'
import { anniversaryLabel, canEditReminder, KIND_ICONS, recurrenceLabel, reminderColour, reminderTitle } from './calendar/shared'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()

const MAX_CHIPS = 3

const cfg = computed(() => normalizeCalendar(props.entity.fields?.calendar))
const configured = computed(() => !!props.entity.fields?.calendar)
const today = computed(() => cfg.value.current)
const canAdd = computed(() => props.editing || world.isMember)

// ---------- reminders of this calendar ----------
const reminders = shallowRef<Reminder[]>([])
let stop: (() => void) | null = null
watch(() => props.entity.id, (id) => {
  stop?.()
  reminders.value = []
  stop = world.watchRows<Reminder>('reminders', 'calendarId', id, (rows) => { reminders.value = rows }, null)
}, { immediate: true })
onBeforeUnmount(() => stop?.())

// ---------- navigation ----------
type Tab = 'month' | 'year' | 'events' | 'settings'
const tab = ref<Tab>('month')
const cursor = ref({ year: today.value.year, month: today.value.month })
const highlight = ref<CalendarDate | null>(null)
const gotoDraft = ref<CalendarDate>({ ...today.value })

watch(() => props.entity.id, () => { goToday(); tab.value = 'month' })
watch(() => props.editing, (e) => { if (!e && tab.value === 'settings') tab.value = 'month' })
// Config edits may remove months or year zero.
watch(cfg, (c) => {
  const cl = clampDate(c, { year: cursor.value.year, month: cursor.value.month, day: 1 })
  if (cl.year !== cursor.value.year || cl.month !== cursor.value.month) cursor.value = { year: cl.year, month: cl.month }
})

function shiftMonth(n: number) {
  const d = addMonths(cfg.value, { ...cursor.value, day: 1 }, n)
  cursor.value = { year: d.year, month: d.month }
}
function shiftYear(n: number) {
  cursor.value = { year: addYears(cfg.value, cursor.value.year, n), month: cursor.value.month }
}
function goToday() {
  cursor.value = { year: today.value.year, month: today.value.month }
  highlight.value = null
  if (tab.value !== 'month' && tab.value !== 'year') tab.value = 'month'
}
function goTo(d: CalendarDate, close?: () => void) {
  const c = clampDate(cfg.value, d)
  cursor.value = { year: c.year, month: c.month }
  highlight.value = c
  tab.value = 'month'
  close?.()
}
function openMonth(m: number) {
  cursor.value = { year: cursor.value.year, month: m }
  tab.value = 'month'
}

const isCurrentMonth = computed(() => cursor.value.year === today.value.year && cursor.value.month === today.value.month)
const monthTitle = computed(() => cfg.value.months[cursor.value.month - 1]?.name ?? '')
const yearTitle = computed(() => formatYear(cfg.value, cursor.value.year))
const cursorYearName = computed(() => yearName(cfg.value, cursor.value.year))

// ---------- month grid ----------
interface Cell {
  day: number
  date: CalendarDate
  isToday: boolean
  isHighlight: boolean
  season: ReturnType<typeof seasonStartingOn>
  moons: { name: string; colour: string; fraction: number; label: string }[]
  occ: MonthOccurrence<Reminder>[]
}
const monthOcc = computed(() => occurrencesInMonth(cfg.value, reminders.value, cursor.value.year, cursor.value.month))
const month = computed(() => {
  const c = cfg.value
  const { year, month: m } = cursor.value
  const dim = daysInMonth(c, year, m)
  const inter = !!c.months[m - 1]?.intercalary
  const lead = inter || dim <= 0 ? 0 : weekdayOf(c, { year, month: m, day: 1 })
  const byDay = occurrencesByDay(monthOcc.value)
  const cells: Cell[] = []
  for (let day = 1; day <= dim; day++) {
    const date = { year, month: m, day }
    const moons: Cell['moons'] = []
    for (const moon of c.moons) {
      const p = moonPhase(c, moon, date)
      if (p.event) moons.push({ name: moon.name, colour: moon.colour, fraction: p.fraction, label: MOON_PHASE_LABELS[p.event] })
    }
    cells.push({
      day, date, moons,
      isToday: compareDates(date, c.current) === 0,
      isHighlight: !!highlight.value && compareDates(date, highlight.value) === 0,
      season: seasonStartingOn(c, date),
      occ: byDay.get(day) ?? [],
    })
  }
  const cols = c.weekdays.length
  const trail = inter || dim <= 0 ? 0 : (cols - ((lead + dim) % cols)) % cols
  return { dim, inter, lead, trail, cells }
})

function isStartDay(o: MonthOccurrence<Reminder>, c: Cell) {
  return o.startIndex === dayIndex(cfg.value, c.date)
}
function chipTitle(o: Occurrence<Reminder>) {
  const parts = [reminderTitle(o.reminder, world.get)]
  const a = anniversaryLabel(o)
  if (a) parts.push(a)
  if (o.endIndex > o.startIndex) parts.push(formatDateRange(cfg.value, o.start, o.end))
  if (o.reminder.comment) parts.push(o.reminder.comment)
  return parts.join(' — ')
}
function linkedOf(r: Reminder) { return world.get(r.entityId) }
function entityRoute(id: string) { return { name: 'entity', params: { wid: world.wid!, eid: id } } }

// ---------- side panel ----------
const todayInfo = computed(() => {
  const c = cfg.value
  const d = c.current
  return {
    date: formatCalendarDate(c, d, { noYear: true }),
    year: formatYear(c, d.year),
    yearName: yearName(c, d.year),
    weekday: weekdayName(c, d),
    season: seasonOf(c, d),
    moons: c.moons.map((m) => {
      const p = moonPhase(c, m, d)
      return { name: m.name, colour: m.colour, fraction: p.fraction, label: MOON_PHASE_LABELS[p.phase] }
    }),
  }
})
const upcoming = computed(() => upcomingOccurrences(cfg.value, reminders.value, today.value, { limit: 8, includeOngoing: true }))
const upcomingLong = computed(() => upcomingOccurrences(cfg.value, reminders.value, today.value, { limit: 40, includeOngoing: true }))
const monthList = computed(() => {
  const seen = new Set<string>()
  return monthOcc.value.filter((o) => {
    const k = `${o.reminder.id}:${o.startIndex}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
})

// ---------- current date (masters) ----------
const setDraft = ref<CalendarDate>({ ...today.value })
const savingCurrent = ref(false)
async function setCurrent(d: CalendarDate, close?: () => void) {
  if (!world.isMaster || savingCurrent.value) return
  const c = clampDate(cfg.value, d)
  const follow = isCurrentMonth.value
  savingCurrent.value = true
  try {
    await world.updateEntity(props.entity.id, { fields: { ...props.entity.fields, calendar: { ...cfg.value, current: c } } })
    if (follow) cursor.value = { year: c.year, month: c.month }
    close?.()
  } catch {
    // toast shown by the store
  } finally {
    savingCurrent.value = false
  }
}
function shiftCurrent(n: number) { void setCurrent(addDays(cfg.value, today.value, n)) }

// ---------- all reminders list ----------
const filter = ref('')
const allSorted = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return [...reminders.value]
    .filter((r) => !q || reminderTitle(r, world.get).toLowerCase().includes(q) || (r.comment ?? '').toLowerCase().includes(q))
    .sort((a, b) => compareDates(a, b) || reminderTitle(a, world.get).localeCompare(reminderTitle(b, world.get), 'ru'))
})
function rangeOf(r: Reminder) {
  const c = cfg.value
  const s = clampDate(c, r)
  const len = Math.max(1, r.length || 1)
  return len > 1 ? formatDateRange(c, s, fromDayIndex(c, dayIndex(c, s) + len - 1)) : formatCalendarDate(c, s)
}

// ---------- modals ----------
const modal = ref<{ key: number; reminder: Partial<Reminder> | null; readonly: boolean } | null>(null)
let modalSeq = 0
function openNew(d?: CalendarDate) {
  const date = d ?? (isCurrentMonth.value ? today.value : { ...cursor.value, day: 1 })
  modal.value = { key: ++modalSeq, reminder: { year: date.year, month: date.month, day: date.day }, readonly: false }
}
function openReminder(r: Reminder) {
  modal.value = { key: ++modalSeq, reminder: r, readonly: !canEditReminder(world, r) }
}
function openOcc(o: Occurrence<Reminder>) { openReminder(o.reminder) }

const dayModal = ref<Cell | null>(null)
const dayModalCell = computed(() => (dayModal.value ? month.value.cells.find((c) => c.day === dayModal.value!.day) ?? dayModal.value : null))
function onDay(c: Cell) {
  if (canAdd.value) openNew(c.date)
  else if (c.occ.length) dayModal.value = c
}
function onYearDay(m: number, day: number) {
  cursor.value = { year: cursor.value.year, month: m }
  highlight.value = { year: cursor.value.year, month: m, day }
  tab.value = 'month'
}
</script>

<template>
  <div class="calv">
    <div class="tabs">
      <button type="button" class="tab" :class="{ on: tab === 'month' }" @click="tab = 'month'"><Icon name="calendar-days" :size="16" /> Месяц</button>
      <button type="button" class="tab" :class="{ on: tab === 'year' }" @click="tab = 'year'"><Icon name="layout-grid" :size="16" /> Год</button>
      <button type="button" class="tab" :class="{ on: tab === 'events' }" @click="tab = 'events'">
        <Icon name="list" :size="16" /> События <span v-if="reminders.length" class="count">{{ reminders.length }}</span>
      </button>
      <button v-if="editing" type="button" class="tab" :class="{ on: tab === 'settings' }" @click="tab = 'settings'"><Icon name="settings" :size="16" /> Настройка</button>
    </div>

    <p v-if="editing && !configured && tab !== 'settings'" class="calv-hint small">
      <Icon name="info" :size="15" /> Календарь пока использует настройки по умолчанию.
      <button type="button" class="btn btn-sm btn-ghost" @click="tab = 'settings'">Настроить месяцы и недели</button>
    </p>

    <CalendarEditor v-if="tab === 'settings' && editing" :entity="entity" />

    <div v-else class="calv-layout">
      <div class="calv-main">
        <!-- toolbar -->
        <div v-if="tab !== 'events'" class="calv-toolbar">
          <div class="row gap-sm calv-nav">
            <button type="button" class="icon-btn" title="Предыдущий год" @click="shiftYear(-1)"><Icon name="chevron-left" :size="16" /><Icon name="chevron-left" :size="16" class="dbl" /></button>
            <button v-if="tab === 'month'" type="button" class="icon-btn" title="Предыдущий месяц" @click="shiftMonth(-1)"><Icon name="chevron-left" /></button>
            <h3 class="calv-title">
              <template v-if="tab === 'month'">{{ monthTitle }} </template>
              <span :class="{ muted: tab === 'month' }">{{ yearTitle }}</span>
              <span v-if="cursorYearName" class="calv-yname">{{ cursorYearName }}</span>
            </h3>
            <button v-if="tab === 'month'" type="button" class="icon-btn" title="Следующий месяц" @click="shiftMonth(1)"><Icon name="chevron-right" /></button>
            <button type="button" class="icon-btn" title="Следующий год" @click="shiftYear(1)"><Icon name="chevron-right" :size="16" /><Icon name="chevron-right" :size="16" class="dbl" /></button>
          </div>
          <div class="row gap-sm wrap">
            <button type="button" class="btn btn-sm" :disabled="isCurrentMonth && tab === 'month' && !highlight" title="К текущей дате" @click="goToday"><Icon name="locate" :size="15" /> Сегодня</button>
            <Dropdown keep-open placement="bottom-end">
              <template #trigger><button type="button" class="btn btn-sm" @click="gotoDraft = { ...(highlight ?? { ...cursor, day: 1 }) }"><Icon name="search" :size="15" /> Перейти</button></template>
              <template #default="{ close }">
                <form class="menu calv-pop" @submit.prevent="goTo(gotoDraft, close)">
                  <div class="menu-label">Перейти к дате</div>
                  <DateInput v-model="gotoDraft" :cfg="cfg" />
                  <button type="submit" class="btn btn-sm btn-primary">Перейти</button>
                </form>
              </template>
            </Dropdown>
            <button v-if="canAdd" type="button" class="btn btn-sm btn-primary" @click="openNew()"><Icon name="plus" :size="15" /> Событие</button>
          </div>
        </div>

        <!-- MONTH -->
        <template v-if="tab === 'month'">
          <div v-if="month.dim <= 0" class="empty">В этом году в месяце «{{ monthTitle }}» нет дней.</div>
          <div v-else-if="month.inter" class="calv-inter">
            <p class="muted small"><Icon name="info" :size="14" /> Межкалендарный месяц: эти дни не входят ни в одну неделю.</p>
            <div class="calv-flat">
              <div
                v-for="c in month.cells" :key="c.day" class="cell" :class="{ today: c.isToday, hl: c.isHighlight, clickable: canAdd || c.occ.length }"
                @click="onDay(c)"
              >
                <div class="cell-head">
                  <span class="cell-num">{{ c.day }}</span>
                  <span class="cell-icons">
                    <MoonIcon v-for="m in c.moons" :key="m.name" :fraction="m.fraction" :colour="m.colour" :size="13" :title="`${m.name}: ${m.label}`" />
                  </span>
                  <button v-if="world.isMaster && !c.isToday" type="button" class="cell-set" title="Сделать текущей датой" @click.stop="setCurrent(c.date)"><Icon name="flag" :size="12" /></button>
                </div>
                <div class="cell-events">
                  <div
                    v-for="o in c.occ.slice(0, MAX_CHIPS)" :key="o.reminder.id + o.startIndex" class="ev" :class="{ cont: !isStartDay(o, c) }"
                    :style="{ '--c': reminderColour(o.reminder) }" :title="chipTitle(o)" @click.stop="openOcc(o)"
                  >
                    <Icon v-if="o.reminder.kind !== 'event'" :name="KIND_ICONS[o.reminder.kind]" :size="11" />
                    <span class="ev-name">{{ reminderTitle(o.reminder, world.get) }}</span>
                  </div>
                  <button v-if="c.occ.length > MAX_CHIPS" type="button" class="ev-more" @click.stop="dayModal = c">+{{ c.occ.length - MAX_CHIPS }} ещё</button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="calv-grid" :style="{ '--cols': cfg.weekdays.length }">
            <div v-for="(w, i) in cfg.weekdays" :key="'wd' + i" class="wd" :title="w"><span class="wd-full">{{ w }}</span><span class="wd-short">{{ w.slice(0, 2) }}</span></div>
            <div v-for="i in month.lead" :key="'lead' + i" class="cell blank" />
            <div
              v-for="c in month.cells" :key="c.day" class="cell" :class="{ today: c.isToday, hl: c.isHighlight, clickable: canAdd || c.occ.length }"
              @click="onDay(c)"
            >
              <div class="cell-head">
                <span class="cell-num">{{ c.day }}</span>
                <span v-if="c.season" class="season-mark" :style="{ '--s': c.season.colour || 'var(--success)' }" :title="`Начало сезона: ${c.season.name}`">{{ c.season.name }}</span>
                <span class="cell-icons">
                  <MoonIcon v-for="m in c.moons" :key="m.name" :fraction="m.fraction" :colour="m.colour" :size="13" :title="`${m.name}: ${m.label}`" />
                </span>
                <button v-if="world.isMaster && !c.isToday" type="button" class="cell-set" title="Сделать текущей датой" @click.stop="setCurrent(c.date)"><Icon name="flag" :size="12" /></button>
              </div>
              <div class="cell-events">
                <div
                  v-for="o in c.occ.slice(0, MAX_CHIPS)" :key="o.reminder.id + o.startIndex" class="ev" :class="{ cont: !isStartDay(o, c) }"
                  :style="{ '--c': reminderColour(o.reminder) }" :title="chipTitle(o)" @click.stop="openOcc(o)"
                >
                  <Icon v-if="o.reminder.kind !== 'event'" :name="KIND_ICONS[o.reminder.kind]" :size="11" />
                  <span class="ev-name">{{ reminderTitle(o.reminder, world.get) }}</span>
                  <RouterLink
                    v-if="linkedOf(o.reminder)" class="ev-link" :to="entityRoute(o.reminder.entityId!)"
                    :title="`Открыть статью: ${linkedOf(o.reminder)!.name}`" @click.stop
                  ><Icon :name="typeDef(linkedOf(o.reminder)!.type).icon" :size="11" /></RouterLink>
                </div>
                <button v-if="c.occ.length > MAX_CHIPS" type="button" class="ev-more" @click.stop="dayModal = c">+{{ c.occ.length - MAX_CHIPS }} ещё</button>
              </div>
            </div>
            <div v-for="i in month.trail" :key="'trail' + i" class="cell blank" />
          </div>

          <section v-if="monthList.length" class="calv-month-list">
            <h4 class="section-title">В этом месяце · {{ monthList.length }}</h4>
            <div class="calv-month-items">
              <OccurrenceItem v-for="o in monthList" :key="o.reminder.id + ':' + o.startIndex" :occ="o" :cfg="cfg" compact :show-relative="false" @open="openOcc" />
            </div>
          </section>
        </template>

        <!-- YEAR -->
        <div v-else-if="tab === 'year'" class="calv-year">
          <MiniMonth
            v-for="(m, i) in cfg.months" :key="i" :cfg="cfg" :year="cursor.year" :month="i + 1" :reminders="reminders"
            @open="openMonth" @day="(d) => onYearDay(i + 1, d)"
          />
        </div>

        <!-- EVENTS -->
        <div v-else-if="tab === 'events'" class="stack">
          <div class="row gap wrap">
            <span class="grow" />
            <button v-if="canAdd" type="button" class="btn btn-sm btn-primary" @click="openNew()"><Icon name="plus" :size="15" /> Событие</button>
          </div>
          <section>
            <h4 class="section-title">Ближайшие события</h4>
            <div v-if="upcomingLong.length" class="calv-upcoming">
              <OccurrenceItem v-for="o in upcomingLong" :key="o.reminder.id + ':' + o.startIndex" :occ="o" :cfg="cfg" @open="openOcc" />
            </div>
            <p v-else class="muted small">Нет предстоящих событий.</p>
          </section>
          <section>
            <div class="row gap wrap calv-all-head">
              <h4 class="section-title grow">Все записи · {{ reminders.length }}</h4>
              <input v-model="filter" class="input input-sm calv-filter" placeholder="Фильтр…" />
            </div>
            <div v-if="allSorted.length" class="calv-table-wrap">
              <table class="table">
                <thead><tr><th>Дата</th><th>Название</th><th>Статья</th><th>Повтор</th></tr></thead>
                <tbody>
                  <tr v-for="r in allSorted" :key="r.id" class="calv-row" @click="openReminder(r)">
                    <td class="nowrap">{{ rangeOf(r) }}</td>
                    <td>
                      <span class="row gap-sm">
                        <span class="dot" :style="{ background: reminderColour(r) }" />
                        <Icon v-if="r.kind !== 'event'" :name="KIND_ICONS[r.kind]" :size="13" class="muted" />
                        <span>{{ reminderTitle(r, world.get) }}</span>
                        <Icon v-if="r.visibility === 'master'" name="lock" :size="12" class="faint" />
                      </span>
                    </td>
                    <td @click.stop><EntityLink v-if="r.entityId" :id="r.entityId" /></td>
                    <td class="muted small nowrap">{{ recurrenceLabel(cfg, r) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">{{ filter ? 'Ничего не найдено.' : 'В календаре пока нет событий.' }}</p>
          </section>
        </div>
      </div>

      <!-- side panel -->
      <aside class="calv-side">
        <div class="card card-pad side-card">
          <div class="section-title">Текущая дата</div>
          <div class="cur-date">{{ todayInfo.date }}</div>
          <div class="cur-year">{{ todayInfo.year }}<span v-if="todayInfo.yearName" class="muted"> · {{ todayInfo.yearName }}</span></div>
          <div v-if="todayInfo.weekday" class="muted small">{{ todayInfo.weekday }}</div>
          <div v-if="todayInfo.season" class="row gap-sm small side-line">
            <span class="dot" :style="{ background: todayInfo.season.colour || 'var(--success)' }" /> {{ todayInfo.season.name }}
          </div>
          <div v-for="m in todayInfo.moons" :key="m.name" class="row gap-sm small side-line">
            <MoonIcon :fraction="m.fraction" :colour="m.colour" :size="16" /> <span>{{ m.name }}</span> <span class="muted">— {{ m.label }}</span>
          </div>
          <div v-if="world.isMaster" class="row gap-sm wrap cur-ctl">
            <button type="button" class="btn btn-sm" :disabled="savingCurrent" title="На день назад" @click="shiftCurrent(-1)"><Icon name="chevron-left" :size="14" /> День</button>
            <button type="button" class="btn btn-sm" :disabled="savingCurrent" title="На день вперёд" @click="shiftCurrent(1)">День <Icon name="chevron-right" :size="14" /></button>
            <Dropdown keep-open placement="bottom-end">
              <template #trigger><button type="button" class="btn btn-sm" @click="setDraft = { ...today }"><Icon name="pencil" :size="14" /> Дата</button></template>
              <template #default="{ close }">
                <form class="menu calv-pop" @submit.prevent="setCurrent(setDraft, close)">
                  <div class="menu-label">Текущая дата мира</div>
                  <DateInput v-model="setDraft" :cfg="cfg" />
                  <button type="submit" class="btn btn-sm btn-primary" :disabled="savingCurrent">Сохранить</button>
                </form>
              </template>
            </Dropdown>
          </div>
        </div>
        <div v-if="tab !== 'events'" class="card card-pad side-card">
          <div class="section-title">Ближайшие события</div>
          <OccurrenceItem v-for="o in upcoming" :key="o.reminder.id + ':' + o.startIndex" :occ="o" :cfg="cfg" compact @open="openOcc" />
          <p v-if="!upcoming.length" class="muted small">Нет предстоящих событий.</p>
        </div>
      </aside>
    </div>

    <ReminderModal
      v-if="modal" :key="modal.key" :reminder="modal.reminder" :calendar-id="entity.id" :readonly="modal.readonly"
      @close="modal = null"
    />

    <Modal v-if="dayModalCell" :title="formatCalendarDate(cfg, dayModalCell.date, { weekday: true })" width="460px" @close="dayModal = null">
      <div class="stack-sm">
        <OccurrenceItem v-for="o in dayModalCell.occ" :key="o.reminder.id + ':' + o.startIndex" :occ="o" :cfg="cfg" @open="(x) => { dayModal = null; openOcc(x) }" />
        <p v-if="!dayModalCell.occ.length" class="muted small">Нет событий.</p>
        <div v-if="dayModalCell.moons.length" class="row gap-sm wrap small muted">
          <span v-for="m in dayModalCell.moons" :key="m.name" class="row gap-sm"><MoonIcon :fraction="m.fraction" :colour="m.colour" /> {{ m.name }}: {{ m.label }}</span>
        </div>
      </div>
      <template #footer>
        <button v-if="world.isMaster && !dayModalCell.isToday" type="button" class="btn btn-ghost" @click="setCurrent(dayModalCell.date); dayModal = null"><Icon name="flag" :size="15" /> Сделать текущей</button>
        <span class="grow" />
        <button v-if="canAdd" type="button" class="btn btn-primary" @click="openNew(dayModalCell.date); dayModal = null"><Icon name="plus" :size="15" /> Добавить событие</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.calv { min-width: 0; }
.calv-hint { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); margin: 0 0 12px; }
.calv-layout { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 18px; align-items: start; }
.calv-main { min-width: 0; }
.calv-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.calv-nav { min-width: 0; }
.calv-nav .icon-btn { width: auto; min-width: 30px; padding: 0 4px; }
.dbl { margin-left: -11px; }
.calv-title { margin: 0; font-size: 24px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.calv-yname { font-family: var(--font-ui); font-size: 13px; font-weight: 500; color: var(--text-muted); padding: 1px 8px; border-radius: 999px; background: var(--surface-2); }
.calv-pop { gap: 8px; padding: 10px; min-width: 320px; }

/* month grid */
.calv-grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); }
.wd { padding: 6px 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--text-faint); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--surface-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.wd-short { display: none; }
.cell { position: relative; min-height: 96px; padding: 4px 5px 5px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cell.blank { background: color-mix(in srgb, var(--surface-2) 60%, transparent); }
.cell.clickable { cursor: pointer; }
.cell.clickable:hover { background: var(--surface-2); }
.cell.today { background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent); }
.cell.hl { box-shadow: inset 0 0 0 2px var(--info); }
.cell-head { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 20px; }
.cell-num { font-weight: 600; font-size: 13px; color: var(--text-muted); min-width: 18px; }
.cell.today .cell-num { color: var(--accent); }
.cell-icons { display: inline-flex; gap: 2px; margin-left: auto; }
.season-mark { font-size: 10.5px; padding: 0 5px; border-radius: 999px; color: var(--text); background: color-mix(in srgb, var(--s) 25%, transparent); border: 1px solid color-mix(in srgb, var(--s) 55%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.cell-set { position: absolute; right: 3px; bottom: 3px; display: none; border: 0; background: var(--surface-3); color: var(--text-muted); border-radius: 4px; padding: 2px 3px; cursor: pointer; line-height: 0; }
.cell:hover .cell-set { display: inline-flex; }
.cell-set:hover { color: var(--accent); }
.cell-events { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ev {
  display: flex; align-items: center; gap: 3px; font-size: 11.5px; line-height: 1.35; padding: 1px 5px; border-radius: 4px; min-width: 0;
  background: color-mix(in srgb, var(--c) 22%, var(--surface)); border-left: 3px solid var(--c); color: var(--text); cursor: pointer;
}
.ev:hover { background: color-mix(in srgb, var(--c) 36%, var(--surface)); }
.ev.cont { border-left-width: 0; border-radius: 0 4px 4px 0; opacity: .8; }
.ev-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.ev-link { display: inline-flex; color: var(--text-muted); flex-shrink: 0; }
.ev-link:hover { color: var(--accent); }
.ev-more { border: 0; background: none; padding: 0 4px; font-size: 11px; color: var(--text-muted); cursor: pointer; text-align: left; }
.ev-more:hover { color: var(--accent); }
.calv-inter .calv-flat { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); border-top: 1px solid var(--border); border-left: 1px solid var(--border); background: var(--surface); }
.calv-inter p { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; }

.calv-month-list { margin-top: 16px; }
.calv-month-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 2px 10px; }

/* year */
.calv-year { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }

/* events */
.calv-upcoming { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 2px 10px; }
.calv-all-head { margin-bottom: 4px; }
.calv-all-head .section-title { margin: 0; }
.calv-filter { max-width: 220px; }
.calv-table-wrap { overflow-x: auto; }
.calv-row { cursor: pointer; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

/* side */
.calv-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.side-card { box-shadow: none; padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
.cur-date { font-family: var(--font-head); font-size: 26px; font-weight: 600; line-height: 1.1; }
.cur-year { font-weight: 500; }
.side-line { margin-top: 2px; }
.cur-ctl { margin-top: 8px; }

@media (max-width: 1100px) {
  .calv-layout { grid-template-columns: minmax(0, 1fr); }
  .calv-side { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
}
@media (max-width: 640px) {
  .wd-full { display: none; }
  .wd-short { display: inline; }
  .cell { min-height: 58px; padding: 3px; }
  .ev { padding: 0; min-height: 5px; border-left-width: 0; border-radius: 3px; background: var(--c); }
  .ev .ev-name, .ev .icon, .ev-link { display: none; }
  .season-mark { display: none; }
  .calv-title { font-size: 20px; }
  .calv-pop { min-width: 0; width: calc(100vw - 32px); }
}
</style>
