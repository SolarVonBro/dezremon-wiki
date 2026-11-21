<script setup lang="ts">
// Calendar configuration editor ("Настройка" tab of CalendarViewer). Writes entity.fields.calendar.
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import type { Entity } from '@/model/types'
import {
  addYears, calendarFromKanka, defaultCalendar, formatCalendarDate, isLeapYear, MOON_PHASE_LABELS, moonPhase,
  normalizeCalendar, type CalendarConfig,
} from '@/data/calendar'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import DateInput from './calendar/DateInput.vue'
import ColourInput from './calendar/ColourInput.vue'
import MoonIcon from './calendar/MoonIcon.vue'

const props = defineProps<{ entity: Entity }>()
const emit = defineEmits<{ saved: [] }>()
const world = useWorld()

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const SEASON_COLOURS = ['#7fb2d6', '#7cbf6a', '#e0b23f', '#c9733a', '#9a7fc4', '#b04a4a', '#8a8a8a']
const MOON_COLOURS = ['#d9c37a', '#e9e4cf', '#9fb8d8', '#c96a5a', '#8fc49a', '#b59ad8', '#8a8a8a']

const baseline = computed(() => normalizeCalendar(props.entity.fields?.calendar))
const baselineJson = computed(() => JSON.stringify(baseline.value))
const draft = ref<CalendarConfig>(clone(baseline.value))
const cfg = computed(() => normalizeCalendar(clone(draft.value)))
const dirty = computed(() => JSON.stringify(cfg.value) !== baselineJson.value)
const saving = ref(false)

// Pick up external changes (e.g. the master advanced the date) when there are no local edits.
watch(baselineJson, (nv, ov) => {
  if (JSON.stringify(cfg.value) === ov) draft.value = clone(baseline.value)
})

function reset() { draft.value = clone(baseline.value) }
function loadDefault() {
  if (!window.confirm('Заменить настройки календарём по умолчанию? Несохранённые изменения пропадут.')) return
  const d = defaultCalendar()
  d.current = clone(draft.value.current)
  draft.value = normalizeCalendar(d)
}

async function save() {
  if (!draft.value.months.length) { toast.error('Нужен хотя бы один месяц'); return }
  if (!draft.value.weekdays.filter((w) => w.trim()).length) { toast.error('Нужен хотя бы один день недели'); return }
  saving.value = true
  try {
    const out = cfg.value
    await world.updateEntity(props.entity.id, { fields: { ...props.entity.fields, calendar: out } })
    draft.value = clone(out)
    toast.success('Календарь сохранён')
    emit('saved')
  } catch {
    // toast shown by the store
  } finally {
    saving.value = false
  }
}

// ---------- index remapping helpers ----------
function swapIndexRefs(a: number, b: number, refs: Array<{ get: () => number; set: (v: number) => void }>) {
  for (const r of refs) {
    const v = r.get()
    if (v === a) r.set(b)
    else if (v === b) r.set(a)
  }
}
function monthRefs() {
  const d = draft.value
  return [
    { get: () => d.leap.month, set: (v: number) => { d.leap.month = v } },
    { get: () => d.current.month, set: (v: number) => { d.current.month = v } },
    ...d.seasons.map((s) => ({ get: () => s.month, set: (v: number) => { s.month = v } })),
  ]
}

// ---------- months ----------
function addMonth() {
  draft.value.months.push({ name: `Месяц ${draft.value.months.length + 1}`, length: 30 })
}
function moveMonth(i: number, dir: -1 | 1) {
  const j = i + dir
  const ms = draft.value.months
  if (j < 0 || j >= ms.length) return
  ;[ms[i], ms[j]] = [ms[j], ms[i]]
  swapIndexRefs(i + 1, j + 1, monthRefs())
}
function removeMonth(i: number) {
  const d = draft.value
  if (d.months.length <= 1) return
  d.months.splice(i, 1)
  const k = i + 1
  const fix = (v: number) => (v > k ? v - 1 : v === k ? Math.max(1, k - 1) : v)
  d.leap.month = fix(d.leap.month)
  d.current.month = fix(d.current.month)
  d.seasons.forEach((s) => { s.month = fix(s.month) })
}
function setIntercalary(i: number, on: boolean) {
  const m = draft.value.months[i]
  if (on) m.intercalary = true
  else delete m.intercalary
}

// ---------- weekdays ----------
function addWeekday() { draft.value.weekdays.push(`День ${draft.value.weekdays.length + 1}`) }
function moveWeekday(i: number, dir: -1 | 1) {
  const j = i + dir
  const ws = draft.value.weekdays
  if (j < 0 || j >= ws.length) return
  ;[ws[i], ws[j]] = [ws[j], ws[i]]
  const d = draft.value
  swapIndexRefs(i, j, [{ get: () => d.startWeekday, set: (v: number) => { d.startWeekday = v } }])
}
function removeWeekday(i: number) {
  const d = draft.value
  if (d.weekdays.length <= 1) return
  d.weekdays.splice(i, 1)
  if (d.startWeekday > i) d.startWeekday--
  else if (d.startWeekday === i) d.startWeekday = 0
}

// ---------- lists ----------
function addMoon() { draft.value.moons.push({ name: 'Луна', cycle: 28, offset: 0, colour: MOON_COLOURS[draft.value.moons.length % MOON_COLOURS.length] }) }
function addSeason() { draft.value.seasons.push({ name: 'Сезон', month: 1, day: 1, colour: SEASON_COLOURS[draft.value.seasons.length % SEASON_COLOURS.length] }) }
function addYearName() { draft.value.yearNames.push({ year: draft.value.current.year, name: '' }) }
function addEra() { draft.value.eras.push({ name: '', suffix: '', startYear: draft.value.current.year, endYear: null }) }
function eraEnd(i: number) { const v = draft.value.eras[i].endYear; return v === null ? '' : String(v) }
function setEraEnd(i: number, v: string) {
  const n = Math.trunc(Number(v))
  draft.value.eras[i].endYear = v.trim() === '' || !Number.isFinite(n) ? null : n
}

// ---------- summaries ----------
const yearStats = computed(() => {
  const c = cfg.value
  const regular = c.months.reduce((s, m) => s + m.length, 0)
  const lm = c.months[c.leap.month - 1]
  const leapLen = lm ? regular - lm.length + Math.max(0, lm.length + c.leap.amount) : regular
  const nextLeaps: number[] = []
  if (c.leap.enabled) {
    for (let k = 0, yy = c.current.year; k < 5000 && nextLeaps.length < 4; k++, yy = addYears(c, yy, 1)) {
      if (isLeapYear(c, yy)) nextLeaps.push(yy)
    }
  }
  return { regular, leapLen, nextLeaps }
})
const moonNow = computed(() => cfg.value.moons.map((m) => {
  const p = moonPhase(cfg.value, m, cfg.value.current)
  return { fraction: p.fraction, label: MOON_PHASE_LABELS[p.phase] }
}))
const currentLabel = computed(() => formatCalendarDate(cfg.value, cfg.value.current, { weekday: true, yearName: true }))

// ---------- JSON import / export ----------
const showJson = ref(false)
const jsonText = ref('')
function openJson() { jsonText.value = JSON.stringify(cfg.value, null, 2); showJson.value = !showJson.value }
function applyJson() {
  try {
    const raw = JSON.parse(jsonText.value)
    const kanka = raw && typeof raw === 'object' && ('has_leap_year' in raw || 'leap_year_offset' in raw || (typeof raw.date === 'string' && !raw.current))
    draft.value = clone(kanka ? calendarFromKanka(raw) : normalizeCalendar(raw))
    toast.info('Настройки загружены — проверьте и сохраните')
  } catch (e: any) {
    toast.error('Не удалось разобрать JSON: ' + (e?.message ?? e))
  }
}
</script>

<template>
  <div class="cale stack">
    <div class="cale-bar card">
      <span class="small" :class="dirty ? 'cale-dirty' : 'muted'">{{ dirty ? 'Есть несохранённые изменения' : 'Изменений нет' }}</span>
      <span class="grow" />
      <button type="button" class="btn btn-sm btn-ghost" title="Импорт / экспорт настроек" @click="openJson"><Icon name="file-code" :size="15" /> JSON</button>
      <button type="button" class="btn btn-sm btn-ghost" @click="loadDefault"><Icon name="rotate-ccw" :size="15" /> По умолчанию</button>
      <button type="button" class="btn btn-sm" :disabled="!dirty || saving" @click="reset">Отменить</button>
      <button type="button" class="btn btn-sm btn-primary" :disabled="!dirty || saving" @click="save"><Icon name="save" :size="15" /> Сохранить</button>
    </div>

    <section v-if="showJson" class="card card-pad stack-sm">
      <h4 class="section-title">Импорт / экспорт</h4>
      <p class="muted small">Скопируйте настройки, чтобы перенести календарь в другой мир, или вставьте JSON (поддерживается и формат календаря Kanka).</p>
      <textarea v-model="jsonText" class="input cale-json" rows="10" spellcheck="false" />
      <div class="row gap-sm"><span class="grow" /><button type="button" class="btn btn-sm" @click="applyJson">Применить</button></div>
    </section>

    <!-- basics -->
    <section class="card card-pad">
      <h4 class="section-title">Основное</h4>
      <div class="cale-grid">
        <div class="field">
          <span>Текущая дата</span>
          <DateInput v-model="draft.current" :cfg="cfg" />
          <span class="muted small">{{ currentLabel }}</span>
        </div>
        <label class="field">
          <span>Суффикс года</span>
          <input v-model="draft.suffix" class="input input-sm" placeholder="г., ЭС, DR…" />
          <span class="muted small">Пример: {{ formatCalendarDate(cfg, cfg.current) }}</span>
        </label>
        <label class="field">
          <span>Первый день 1-го года — это</span>
          <select v-model.number="draft.startWeekday" class="input input-sm">
            <option v-for="(w, i) in draft.weekdays" :key="i" :value="i">{{ w || `День ${i + 1}` }}</option>
          </select>
        </label>
        <div class="field">
          <span>Нулевой год</span>
          <label class="check small"><input v-model="draft.skipYearZero" type="checkbox" /> Пропускать (после −1 сразу идёт 1)</label>
        </div>
      </div>
    </section>

    <!-- months -->
    <section class="card card-pad">
      <div class="row gap cale-head">
        <h4 class="section-title grow">Месяцы · {{ draft.months.length }}</h4>
        <span class="muted small">
          {{ yearStats.regular }} {{ plural(yearStats.regular, 'день', 'дня', 'дней') }} в году<template v-if="cfg.leap.enabled">, в високосном {{ yearStats.leapLen }}</template>
        </span>
      </div>
      <div class="cale-table-wrap">
        <table class="table cale-table">
          <thead><tr><th /><th>Название</th><th>В датах <span class="faint">(род. п.)</span></th><th>Дней</th><th title="Межкалендарный: дни вне недели">Вне недели</th><th /></tr></thead>
          <tbody>
            <tr v-for="(m, i) in draft.months" :key="i">
              <td class="cale-idx faint">{{ i + 1 }}</td>
              <td><input v-model="m.name" class="input input-sm" /></td>
              <td><input v-model="m.genitive" class="input input-sm" :placeholder="m.name" /></td>
              <td><input v-model.number="m.length" class="input input-sm cale-num" type="number" min="0" /></td>
              <td class="center"><input type="checkbox" class="cale-check" :checked="!!m.intercalary" @change="setIntercalary(i, ($event.target as HTMLInputElement).checked)" /></td>
              <td class="nowrap">
                <button type="button" class="icon-btn" title="Выше" :disabled="i === 0" @click="moveMonth(i, -1)"><Icon name="arrow-up" :size="15" /></button>
                <button type="button" class="icon-btn" title="Ниже" :disabled="i === draft.months.length - 1" @click="moveMonth(i, 1)"><Icon name="arrow-down" :size="15" /></button>
                <button type="button" class="icon-btn" title="Удалить" :disabled="draft.months.length <= 1" @click="removeMonth(i)"><Icon name="trash2" :size="15" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button type="button" class="btn btn-sm" @click="addMonth"><Icon name="plus" :size="15" /> Месяц</button>
      <p class="muted small cale-note">«Вне недели» — межкалендарные дни (праздники между месяцами): они не сдвигают дни недели. Месяц с 0 дней появляется только в високосные годы, если ему добавлены дни.</p>
    </section>

    <!-- weekdays -->
    <section class="card card-pad">
      <div class="row gap cale-head">
        <h4 class="section-title grow">Дни недели · {{ draft.weekdays.length }}</h4>
      </div>
      <div class="cale-weekdays">
        <div v-for="(w, i) in draft.weekdays" :key="i" class="row gap-sm">
          <span class="cale-idx faint">{{ i + 1 }}</span>
          <input v-model="draft.weekdays[i]" class="input input-sm grow" />
          <button type="button" class="icon-btn" title="Выше" :disabled="i === 0" @click="moveWeekday(i, -1)"><Icon name="arrow-up" :size="15" /></button>
          <button type="button" class="icon-btn" title="Ниже" :disabled="i === draft.weekdays.length - 1" @click="moveWeekday(i, 1)"><Icon name="arrow-down" :size="15" /></button>
          <button type="button" class="icon-btn" title="Удалить" :disabled="draft.weekdays.length <= 1" @click="removeWeekday(i)"><Icon name="trash2" :size="15" /></button>
        </div>
      </div>
      <button type="button" class="btn btn-sm" @click="addWeekday"><Icon name="plus" :size="15" /> День недели</button>
    </section>

    <!-- leap -->
    <section class="card card-pad">
      <h4 class="section-title">Високосные годы</h4>
      <label class="check small"><input v-model="draft.leap.enabled" type="checkbox" /> Есть високосные годы</label>
      <div v-if="draft.leap.enabled" class="cale-grid cale-mt">
        <label class="field"><span>Каждые N лет</span><input v-model.number="draft.leap.every" class="input input-sm" type="number" min="1" /></label>
        <label class="field"><span>Високосный год (точка отсчёта)</span><input v-model.number="draft.leap.offset" class="input input-sm" type="number" /></label>
        <label class="field">
          <span>Месяц</span>
          <select v-model.number="draft.leap.month" class="input input-sm">
            <option v-for="(m, i) in draft.months" :key="i" :value="i + 1">{{ m.name }}</option>
          </select>
        </label>
        <label class="field"><span>Добавить дней</span><input v-model.number="draft.leap.amount" class="input input-sm" type="number" /></label>
      </div>
      <p v-if="draft.leap.enabled && yearStats.nextLeaps.length" class="muted small cale-note">Ближайшие високосные: {{ yearStats.nextLeaps.join(', ') }}…</p>
    </section>

    <!-- moons -->
    <section class="card card-pad">
      <h4 class="section-title">Луны · {{ draft.moons.length }}</h4>
      <div v-for="(m, i) in draft.moons" :key="i" class="cale-item">
        <MoonIcon :fraction="moonNow[i]?.fraction ?? 0.5" :colour="m.colour" :size="22" :title="moonNow[i]?.label" />
        <div class="cale-item-body">
          <div class="cale-grid">
            <label class="field"><span>Название</span><input v-model="m.name" class="input input-sm" /></label>
            <label class="field"><span>Цикл, дней</span><input v-model.number="m.cycle" class="input input-sm" type="number" min="1" step="0.01" /></label>
            <label class="field"><span>Сдвиг (день полнолуния)</span><input v-model.number="m.offset" class="input input-sm" type="number" step="0.01" /></label>
          </div>
          <div class="row gap-sm wrap cale-mt">
            <ColourInput v-model="m.colour" :presets="MOON_COLOURS" />
            <span class="muted small">Сейчас: {{ moonNow[i]?.label }}</span>
          </div>
        </div>
        <button type="button" class="icon-btn" title="Удалить" @click="draft.moons.splice(i, 1)"><Icon name="trash2" :size="15" /></button>
      </div>
      <button type="button" class="btn btn-sm" @click="addMoon"><Icon name="plus" :size="15" /> Луна</button>
      <p class="muted small cale-note">Сдвиг — номер дня от 1-го дня 1-го года, в который было полнолуние. Меняйте его, чтобы подвинуть фазы.</p>
    </section>

    <!-- seasons -->
    <section class="card card-pad">
      <h4 class="section-title">Сезоны · {{ draft.seasons.length }}</h4>
      <div v-for="(s, i) in draft.seasons" :key="i" class="cale-item">
        <div class="cale-item-body">
          <div class="cale-grid">
            <label class="field"><span>Название</span><input v-model="s.name" class="input input-sm" /></label>
            <label class="field">
              <span>Начинается: месяц</span>
              <select v-model.number="s.month" class="input input-sm">
                <option v-for="(m, k) in draft.months" :key="k" :value="k + 1">{{ m.name }}</option>
              </select>
            </label>
            <label class="field"><span>день</span><input v-model.number="s.day" class="input input-sm" type="number" min="1" /></label>
          </div>
          <div class="cale-mt"><ColourInput v-model="s.colour" :presets="SEASON_COLOURS" /></div>
        </div>
        <button type="button" class="icon-btn" title="Удалить" @click="draft.seasons.splice(i, 1)"><Icon name="trash2" :size="15" /></button>
      </div>
      <button type="button" class="btn btn-sm" @click="addSeason"><Icon name="plus" :size="15" /> Сезон</button>
    </section>

    <!-- year names -->
    <section class="card card-pad">
      <h4 class="section-title">Названия лет · {{ draft.yearNames.length }}</h4>
      <div v-for="(y, i) in draft.yearNames" :key="i" class="row gap-sm cale-row">
        <input v-model.number="y.year" class="input input-sm cale-year" type="number" title="Год" />
        <input v-model="y.name" class="input input-sm grow" placeholder="Год Красного Дракона" />
        <button type="button" class="icon-btn" title="Удалить" @click="draft.yearNames.splice(i, 1)"><Icon name="trash2" :size="15" /></button>
      </div>
      <button type="button" class="btn btn-sm" @click="addYearName"><Icon name="plus" :size="15" /> Название года</button>
    </section>

    <!-- eras -->
    <section class="card card-pad">
      <h4 class="section-title">Эпохи · {{ draft.eras.length }}</h4>
      <div v-for="(e, i) in draft.eras" :key="i" class="cale-item">
        <div class="cale-item-body cale-grid">
          <label class="field"><span>Название</span><input v-model="e.name" class="input input-sm" placeholder="Эпоха Скорби" /></label>
          <label class="field"><span>Суффикс</span><input v-model="e.suffix" class="input input-sm" placeholder="ЭС" /></label>
          <label class="field"><span>С года</span><input v-model.number="e.startYear" class="input input-sm" type="number" /></label>
          <label class="field"><span>По год</span><input class="input input-sm" type="number" placeholder="до сих пор" :value="eraEnd(i)" @input="setEraEnd(i, ($event.target as HTMLInputElement).value)" /></label>
        </div>
        <button type="button" class="icon-btn" title="Удалить" @click="draft.eras.splice(i, 1)"><Icon name="trash2" :size="15" /></button>
      </div>
      <button type="button" class="btn btn-sm" @click="addEra"><Icon name="plus" :size="15" /> Эпоха</button>
      <p class="muted small cale-note">Суффикс эпохи добавляется к годам в её границах: «1203 г. ЭС». Счёт лет не сбрасывается.</p>
    </section>

    <div class="row gap-sm">
      <span class="grow" />
      <button type="button" class="btn" :disabled="!dirty || saving" @click="reset">Отменить</button>
      <button type="button" class="btn btn-primary" :disabled="!dirty || saving" @click="save"><Icon name="save" :size="15" /> Сохранить</button>
    </div>
  </div>
</template>

<style scoped>
.cale { min-width: 0; }
.cale-bar { position: sticky; top: calc(var(--topbar-h) + 6px); z-index: 5; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; box-shadow: var(--shadow); }
.cale-dirty { color: var(--warning); font-weight: 600; }
.cale-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 14px; align-items: start; }
.cale-head { margin-bottom: 4px; }
.cale-head .section-title { margin: 0; }
.cale-table-wrap { overflow-x: auto; margin-bottom: 8px; }
.cale-table td { padding: 4px 6px; }
.cale-table th { padding: 6px; }
.cale-table tr:hover td { background: transparent; }
.cale-num { width: 76px; }
.cale-check { width: 16px; height: 16px; accent-color: var(--accent); }
.cale-idx { width: 22px; text-align: right; font-size: 12px; flex-shrink: 0; }
.cale-weekdays { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 4px 14px; margin-bottom: 8px; }
.cale-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--border); }
.cale-item:last-of-type { margin-bottom: 8px; }
.cale-item-body { flex: 1; min-width: 0; }
.cale-row { margin-bottom: 6px; }
.cale-year { width: 100px; flex: 0 0 auto; }
.cale-mt { margin-top: 8px; }
.cale-note { margin: 8px 0 0; }
.cale-json { font-family: var(--font-mono); font-size: 12px; }
</style>
