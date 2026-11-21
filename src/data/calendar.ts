// Fantasy calendar date math (Kanka-like "Calendars" module).
// Pure functions only: no Vue, no Firestore. The config lives in `entity.fields.calendar` of a `calendar` entity.
//
// Conventions
// - Dates are { year, month (1-based), day (1-based) }.
// - Absolute day number (`dayIndex`) is 0 for year 1, month 1, day 1. Earlier dates are negative.
// - With `skipYearZero` the year sequence is … -2, -1, 1, 2 …; otherwise … -1, 0, 1 ….
// - Leap rule: a year is leap when (year - leap.offset) is divisible by leap.every (works for negative years);
//   in leap years `leap.amount` days are added to month `leap.month`.
// - Days of intercalary months do not advance the week: `weekdayOf` returns -1 for them.
// - Moons: `cycle` = days between full moons, `offset` = absolute day number of some full moon.
import type { CalendarDate, Reminder } from '@/model/types'

export interface CalendarMonth {
  name: string
  length: number
  intercalary?: boolean
  /** Optional genitive form used in formatted dates ("4 января"). Falls back to `name`. */
  genitive?: string
}
export interface CalendarMoon { name: string; cycle: number; offset: number; colour: string }
export interface CalendarSeason { name: string; month: number; day: number; colour?: string }
export interface CalendarYearName { year: number; name: string }
export interface CalendarEra { name: string; suffix: string; startYear: number; endYear: number | null }
export interface CalendarLeap {
  enabled: boolean
  /** Every N years. */
  every: number
  /** A year that is leap (the rule is periodic from it in both directions). */
  offset: number
  /** 1-based month that receives the extra days. */
  month: number
  /** Extra days (may be negative). */
  amount: number
}

export interface CalendarConfig {
  months: CalendarMonth[]
  weekdays: string[]
  current: { year: number; month: number; day: number }
  /** Appended to years: "1203 г." */
  suffix: string
  /** Weekday index of year 1, month 1, day 1. */
  startWeekday: number
  skipYearZero: boolean
  leap: CalendarLeap
  moons: CalendarMoon[]
  seasons: CalendarSeason[]
  yearNames: CalendarYearName[]
  /** An era adds its suffix after the calendar suffix for years in [startYear, endYear]. */
  eras: CalendarEra[]
}

export type MoonPhaseName =
  | 'new' | 'waxing_crescent' | 'first_quarter' | 'waxing_gibbous'
  | 'full' | 'waning_gibbous' | 'last_quarter' | 'waning_crescent'
export type MoonEvent = 'new' | 'first_quarter' | 'full' | 'last_quarter'

export interface MoonPhase {
  phase: MoonPhaseName
  /** 0 = new moon, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  fraction: number
  /** Lit part of the disc, 0..1. */
  illumination: number
  /** Set when the exact principal phase falls on this day (exactly one day per phase per cycle). */
  event: MoonEvent | null
}

export const MOON_PHASE_LABELS: Record<MoonPhaseName, string> = {
  new: 'Новолуние',
  waxing_crescent: 'Растущий серп',
  first_quarter: 'Первая четверть',
  waxing_gibbous: 'Растущая луна',
  full: 'Полнолуние',
  waning_gibbous: 'Убывающая луна',
  last_quarter: 'Последняя четверть',
  waning_crescent: 'Убывающий серп',
}

export const REMINDER_KIND_LABELS: Record<Reminder['kind'], string> = {
  event: 'Событие',
  birth: 'Рождение',
  death: 'Смерть',
  other: 'Другое',
}

const PHASES: MoonPhaseName[] = ['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full', 'waning_gibbous', 'last_quarter', 'waning_crescent']

// ---------------------------------------------------------------------------------------------------------------------
// Defaults / normalisation
// ---------------------------------------------------------------------------------------------------------------------

export function defaultCalendar(): CalendarConfig {
  const m = (name: string, genitive: string, length: number): CalendarMonth => ({ name, genitive, length })
  return {
    months: [
      m('Январь', 'января', 31), m('Февраль', 'февраля', 28), m('Март', 'марта', 31), m('Апрель', 'апреля', 30),
      m('Май', 'мая', 31), m('Июнь', 'июня', 30), m('Июль', 'июля', 31), m('Август', 'августа', 31),
      m('Сентябрь', 'сентября', 30), m('Октябрь', 'октября', 31), m('Ноябрь', 'ноября', 30), m('Декабрь', 'декабря', 31),
    ],
    weekdays: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
    current: { year: 1000, month: 1, day: 1 },
    suffix: 'г.',
    startWeekday: 0,
    skipYearZero: true,
    leap: { enabled: true, every: 4, offset: 0, month: 2, amount: 1 },
    moons: [{ name: 'Луна', cycle: 29.5, offset: 14, colour: '#d9c37a' }],
    seasons: [
      { name: 'Зима', month: 12, day: 1, colour: '#7fb2d6' },
      { name: 'Весна', month: 3, day: 1, colour: '#7cbf6a' },
      { name: 'Лето', month: 6, day: 1, colour: '#e0b23f' },
      { name: 'Осень', month: 9, day: 1, colour: '#c9733a' },
    ],
    yearNames: [],
    eras: [],
  }
}

const num = (v: any, def: number): number => {
  const n = typeof v === 'string' ? Number(v.trim()) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : def
}
const int = (v: any, def: number): number => Math.trunc(num(v, def))
const str = (v: any, def = ''): string => (v === null || v === undefined ? def : String(v))
const bool = (v: any, def: boolean): boolean => (v === undefined || v === null ? def : v === true || v === 1 || v === '1' || v === 'true')
const arr = (v: any): any[] => {
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return Object.values(v)
  return []
}

/** Fills defaults and coerces types. Accepts null (→ default calendar), objects or a JSON string. */
export function normalizeCalendar(raw: any): CalendarConfig {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = null } }
  const def = defaultCalendar()
  if (!raw || typeof raw !== 'object') return def

  let months: CalendarMonth[] = arr(raw.months)
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const out: CalendarMonth = { name: str(m.name).trim() || 'Месяц', length: Math.max(0, int(m.length, 30)) }
      if (m.intercalary === true || m.type === 'intercalary') out.intercalary = true
      if (typeof m.genitive === 'string' && m.genitive.trim()) out.genitive = m.genitive.trim()
      return out
    })
  if (!months.length) months = def.months
  if (!months.some((m) => m.length > 0)) months = months.map((m, i) => (i === 0 ? { ...m, length: 1 } : m))
  // At least one regular month, otherwise weeks make no sense.
  if (months.every((m) => m.intercalary)) months = months.map((m, i) => (i === 0 ? { ...m, intercalary: undefined } : m)).map(stripUndef)

  let weekdays = arr(raw.weekdays).map((w) => str(w).trim()).filter(Boolean)
  if (!weekdays.length) weekdays = def.weekdays

  const l = raw.leap && typeof raw.leap === 'object' ? raw.leap : {}
  const leap: CalendarLeap = {
    enabled: bool(l.enabled, false),
    every: Math.max(1, int(l.every, 4)),
    offset: int(l.offset, 0),
    month: Math.min(months.length, Math.max(1, int(l.month, 1))),
    amount: int(l.amount, 1),
  }

  const cfg: CalendarConfig = {
    months,
    weekdays,
    current: { year: 1, month: 1, day: 1 },
    suffix: str(raw.suffix, ''),
    startWeekday: mod(int(raw.startWeekday, 0), weekdays.length),
    skipYearZero: bool(raw.skipYearZero, false),
    leap,
    moons: arr(raw.moons).filter((m) => m && typeof m === 'object').map((m) => ({
      name: str(m.name).trim() || 'Луна',
      cycle: Math.max(1, num(m.cycle ?? m.fullmoon, 28)),
      offset: num(m.offset, 0),
      colour: str(m.colour ?? m.color, '').trim(),
    })),
    seasons: arr(raw.seasons).filter((s) => s && typeof s === 'object').map((s) => {
      const out: CalendarSeason = { name: str(s.name).trim() || 'Сезон', month: Math.min(months.length, Math.max(1, int(s.month, 1))), day: Math.max(1, int(s.day, 1)) }
      const c = str(s.colour ?? s.color, '').trim()
      if (c) out.colour = c
      return out
    }),
    yearNames: normalizeYearNames(raw.yearNames ?? raw.years),
    eras: arr(raw.eras).filter((e) => e && typeof e === 'object').map((e) => ({
      name: str(e.name).trim(),
      suffix: str(e.suffix ?? e.abbreviation, '').trim(),
      startYear: int(e.startYear, 1),
      endYear: e.endYear === null || e.endYear === undefined || e.endYear === '' ? null : int(e.endYear, 0),
    })),
  }
  const c = raw.current && typeof raw.current === 'object' ? raw.current : typeof raw.current === 'string' ? parseDate(raw.current) : null
  cfg.current = clampDate(cfg, { year: int(c?.year, 1), month: int(c?.month, 1), day: int(c?.day, 1) })
  return cfg
}

function stripUndef<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

function normalizeYearNames(v: any): CalendarYearName[] {
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  if (Array.isArray(v)) {
    return v.filter((y) => y && typeof y === 'object' && str(y.name).trim()).map((y) => ({ year: int(y.year, 1), name: str(y.name).trim() }))
  }
  if (v && typeof v === 'object') {
    // Kanka: { "1203": "Год Дракона" }
    return Object.entries(v).filter(([y, n]) => Number.isFinite(Number(y)) && str(n).trim()).map(([y, n]) => ({ year: Math.trunc(Number(y)), name: str(n).trim() }))
  }
  return []
}

/**
 * Maps a Kanka calendar record (fields of `calendars/*.json`) to our config.
 * Kanka: date "Y-M-D", months[{name,length,type}], weekdays[], years{y:name}, seasons[{name,month,day}],
 * moons[{name,fullmoon,offset,colour}], suffix, has_leap_year, leap_year_amount, leap_year_month,
 * leap_year_offset (every N years), leap_year_start, skip_year_zero, start_offset.
 */
export function calendarFromKanka(raw: any): CalendarConfig {
  if (!raw || typeof raw !== 'object') return defaultCalendar()
  return normalizeCalendar({
    months: arr(raw.months).map((m) => ({ name: m?.name, length: m?.length, intercalary: m?.type === 'intercalary' })),
    weekdays: raw.weekdays,
    current: typeof raw.date === 'string' ? parseDate(raw.date) : null,
    suffix: raw.suffix ?? '',
    startWeekday: raw.start_offset ?? 0,
    skipYearZero: raw.skip_year_zero ?? false,
    leap: {
      enabled: bool(raw.has_leap_year, false),
      every: raw.leap_year_offset ?? 4,
      offset: raw.leap_year_start ?? 0,
      month: raw.leap_year_month ?? 1,
      amount: raw.leap_year_amount ?? 1,
    },
    moons: arr(raw.moons).map((m) => ({ name: m?.name, cycle: m?.fullmoon ?? m?.cycle, offset: m?.offset ?? 0, colour: m?.colour ?? '' })),
    seasons: arr(raw.seasons),
    yearNames: raw.years,
    eras: [],
  })
}

/** Parses "Y-M-D" (year may be negative: "-120-3-14"). */
export function parseDate(s: string | null | undefined): CalendarDate | null {
  const m = /^\s*(-?\d+)-(\d+)-(\d+)\s*$/.exec(s ?? '')
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null
}

// ---------------------------------------------------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------------------------------------------------

/** Mathematical modulo (always >= 0 for positive m). */
export function mod(a: number, m: number): number {
  return ((a % m) + m) % m
}

/** Continuous year number: year 1 → 1, and the year before 1 → 0 (whether or not year zero is skipped). */
export function linearYear(cfg: CalendarConfig, year: number): number {
  if (!cfg.skipYearZero) return year
  return year > 0 ? year : year === 0 ? 1 : year + 1
}
export function yearFromLinear(cfg: CalendarConfig, l: number): number {
  if (!cfg.skipYearZero) return l
  return l > 0 ? l : l - 1
}
/** year + n, skipping year zero when configured. */
export function addYears(cfg: CalendarConfig, year: number, n: number): number {
  return yearFromLinear(cfg, linearYear(cfg, year) + n)
}

export function isLeapYear(cfg: CalendarConfig, year: number): boolean {
  const l = cfg.leap
  if (!l.enabled || !(l.every >= 1)) return false
  return mod(year - l.offset, l.every) === 0
}

/** Number of leap years among nominal years [a, b] (a <= b). Year 0 is excluded when skipped. */
function leapCount(cfg: CalendarConfig, a: number, b: number): number {
  const l = cfg.leap
  if (a > b || !l.enabled || !(l.every >= 1)) return 0
  let n = Math.floor((b - l.offset) / l.every) - Math.floor((a - 1 - l.offset) / l.every)
  if (cfg.skipYearZero && a <= 0 && b >= 0 && isLeapYear(cfg, 0)) n--
  return n
}

function leapMonthIndex(cfg: CalendarConfig): number {
  return Math.min(cfg.months.length, Math.max(1, Math.trunc(cfg.leap.month))) - 1
}

function monthLen(cfg: CalendarConfig, i: number, leap: boolean): number {
  const m = cfg.months[i]
  if (!m) return 0
  return Math.max(0, m.length + (leap && cfg.leap.enabled && i === leapMonthIndex(cfg) ? cfg.leap.amount : 0))
}

export function daysInMonth(cfg: CalendarConfig, year: number, month: number): number {
  return monthLen(cfg, month - 1, isLeapYear(cfg, year))
}

export function daysInYear(cfg: CalendarConfig, year: number): number {
  const leap = isLeapYear(cfg, year)
  let s = 0
  for (let i = 0; i < cfg.months.length; i++) s += monthLen(cfg, i, leap)
  return s
}

type Kind = 'all' | 'week'

/** Lengths of a regular / leap year, counting either all days or only week-advancing (non-intercalary) days. */
function yearLengths(cfg: CalendarConfig, kind: Kind): { base: number; leap: number } {
  let base = 0, leap = 0
  for (let i = 0; i < cfg.months.length; i++) {
    if (kind === 'week' && cfg.months[i].intercalary) continue
    base += monthLen(cfg, i, false)
    leap += monthLen(cfg, i, true)
  }
  return { base, leap }
}

/** Days from the start of year 1 to the start of `year` (negative for earlier years). */
function daysBeforeYear(cfg: CalendarConfig, year: number, kind: Kind = 'all'): number {
  const { base, leap } = yearLengths(cfg, kind)
  const extra = leap - base
  const L = linearYear(cfg, year)
  if (L >= 1) {
    const n = L - 1
    return n * base + (n > 0 ? leapCount(cfg, 1, n) : 0) * extra
  }
  const n = 1 - L
  const leaps = leapCount(cfg, yearFromLinear(cfg, L), yearFromLinear(cfg, 0))
  return -(n * base + leaps * extra)
}

function daysBeforeMonth(cfg: CalendarConfig, year: number, month: number, kind: Kind = 'all'): number {
  const leap = isLeapYear(cfg, year)
  let s = 0
  const last = Math.min(cfg.months.length, month - 1)
  for (let i = 0; i < last; i++) {
    if (kind === 'week' && cfg.months[i].intercalary) continue
    s += monthLen(cfg, i, leap)
  }
  return s
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------------

const clampMonth = (cfg: CalendarConfig, m: number) => Math.min(cfg.months.length, Math.max(1, Math.trunc(m) || 1))

/** Absolute day number; 0 = year 1, month 1, day 1. Days past the month end overflow into the next months. */
export function dayIndex(cfg: CalendarConfig, date: CalendarDate): number {
  const month = clampMonth(cfg, date.month)
  return daysBeforeYear(cfg, date.year) + daysBeforeMonth(cfg, date.year, month) + (Math.trunc(date.day) - 1)
}

export function fromDayIndex(cfg: CalendarConfig, index: number): CalendarDate {
  index = Math.floor(index)
  const { base, leap } = yearLengths(cfg, 'all')
  const l = cfg.leap
  let avg = base + (l.enabled && l.every >= 1 ? (leap - base) / l.every : 0)
  if (!(avg > 0)) avg = Math.max(base, leap, 1)
  let L = Math.floor(index / avg) + 1
  let guard = 0
  while (daysBeforeYear(cfg, yearFromLinear(cfg, L)) > index && guard++ < 100000) L--
  while (daysBeforeYear(cfg, yearFromLinear(cfg, L + 1)) <= index && guard++ < 100000) L++
  const year = yearFromLinear(cfg, L)
  let rem = index - daysBeforeYear(cfg, year)
  const isLeap = isLeapYear(cfg, year)
  for (let i = 0; i < cfg.months.length; i++) {
    const dim = monthLen(cfg, i, isLeap)
    if (rem < dim) return { year, month: i + 1, day: rem + 1 }
    rem -= dim
  }
  // Unreachable for a consistent config; fall back to the last day of the year.
  const lastMonth = cfg.months.length
  return { year, month: lastMonth, day: Math.max(1, monthLen(cfg, lastMonth - 1, isLeap)) }
}

export function addDays(cfg: CalendarConfig, date: CalendarDate, n: number): CalendarDate {
  return fromDayIndex(cfg, dayIndex(cfg, date) + n)
}

/** Moves by whole months, keeping the day when possible (clamped to the target month length). */
export function addMonths(cfg: CalendarConfig, date: CalendarDate, n: number): CalendarDate {
  const N = cfg.months.length
  const serial = (linearYear(cfg, date.year) - 1) * N + (clampMonth(cfg, date.month) - 1) + n
  const L = Math.floor(serial / N) + 1
  const month = mod(serial, N) + 1
  const year = yearFromLinear(cfg, L)
  return { year, month, day: Math.min(Math.max(1, Math.trunc(date.day)), Math.max(1, daysInMonth(cfg, year, month))) }
}

/** -1 / 0 / 1. Year order is numeric in both year-zero modes, so no config is needed. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return Math.sign(a.year - b.year) || Math.sign(a.month - b.month) || Math.sign(a.day - b.day)
}

export function isValidDate(cfg: CalendarConfig, d: CalendarDate): boolean {
  if (![d.year, d.month, d.day].every(Number.isInteger)) return false
  if (cfg.skipYearZero && d.year === 0) return false
  if (d.month < 1 || d.month > cfg.months.length) return false
  return d.day >= 1 && d.day <= daysInMonth(cfg, d.year, d.month)
}

/** Nearest valid date (year 0 → 1 when skipped, month/day clamped). A zero-length month keeps day 1. */
export function clampDate(cfg: CalendarConfig, d: CalendarDate): CalendarDate {
  let year = Math.trunc(Number(d.year)) || 0
  if (cfg.skipYearZero && year === 0) year = 1
  const month = clampMonth(cfg, Number(d.month))
  const day = Math.min(Math.max(1, Math.trunc(Number(d.day)) || 1), Math.max(1, daysInMonth(cfg, year, month)))
  return { year, month, day }
}

/** Whole years elapsed between two dates (age): negative if `to` is before `from`. */
export function yearsBetween(cfg: CalendarConfig, from: CalendarDate, to: CalendarDate): number {
  let dy = linearYear(cfg, to.year) - linearYear(cfg, from.year)
  const sameYearCmp = Math.sign(to.month - from.month) || Math.sign(to.day - from.day)
  if (dy > 0 && sameYearCmp < 0) dy--
  else if (dy < 0 && sameYearCmp > 0) dy++
  return dy
}

/** Weekday index (0-based) or -1 for days of intercalary months (they stand outside the week). */
export function weekdayOf(cfg: CalendarConfig, date: CalendarDate): number {
  const month = clampMonth(cfg, date.month)
  if (cfg.months[month - 1]?.intercalary) return -1
  const w = daysBeforeYear(cfg, date.year, 'week') + daysBeforeMonth(cfg, date.year, month, 'week') + (Math.trunc(date.day) - 1)
  return mod(cfg.startWeekday + w, cfg.weekdays.length)
}

// ---------------------------------------------------------------------------------------------------------------------
// Moons, seasons, names
// ---------------------------------------------------------------------------------------------------------------------

export function moonPhase(cfg: CalendarConfig, moon: CalendarMoon, date: CalendarDate): MoonPhase {
  const cycle = moon.cycle > 0 ? moon.cycle : 28
  // Days since a full moon.
  const t = dayIndex(cfg, date) - (moon.offset || 0)
  const fraction = mod(t / cycle + 0.5, 1)
  let event: MoonEvent | null = null
  // The exact phase moment falls into [day - 0.5, day + 0.5). Computed in days (not cycle fractions) so that
  // two neighbouring days can never both match because of rounding.
  const targets: Array<[number, MoonEvent]> = [[0, 'full'], [0.25, 'last_quarter'], [0.5, 'new'], [0.75, 'first_quarter']]
  for (const [p, name] of targets) {
    if (mod(t - p * cycle + 0.5, cycle) < 1) { event = name; break }
  }
  const phase: MoonPhaseName = event ?? PHASES[Math.floor(mod(fraction * 8 + 0.5, 8)) % 8]
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2
  return { phase, fraction, illumination, event }
}

function seasonsSorted(cfg: CalendarConfig): CalendarSeason[] {
  return [...cfg.seasons].sort((a, b) => a.month - b.month || a.day - b.day)
}

/** Season the date falls into (the latest season start on or before it, wrapping around the year). */
export function seasonOf(cfg: CalendarConfig, date: CalendarDate): CalendarSeason | null {
  const list = seasonsSorted(cfg)
  if (!list.length) return null
  let found: CalendarSeason | null = null
  for (const s of list) if (s.month < date.month || (s.month === date.month && s.day <= date.day)) found = s
  return found ?? list[list.length - 1]
}

/** Season that starts exactly on this date (start days past the month end are moved to its last day). */
export function seasonStartingOn(cfg: CalendarConfig, date: CalendarDate): CalendarSeason | null {
  const dim = daysInMonth(cfg, date.year, date.month)
  return cfg.seasons.find((s) => s.month === date.month && Math.min(s.day, Math.max(1, dim)) === date.day) ?? null
}

export function monthName(cfg: CalendarConfig, month: number, genitive = false): string {
  const m = cfg.months[month - 1]
  if (!m) return String(month)
  return genitive ? m.genitive || m.name : m.name
}

export function weekdayName(cfg: CalendarConfig, date: CalendarDate): string {
  const w = weekdayOf(cfg, date)
  return w < 0 ? '' : cfg.weekdays[w] ?? ''
}

export function yearName(cfg: CalendarConfig, year: number): string {
  return cfg.yearNames.find((y) => y.year === year)?.name ?? ''
}

/** The era a year belongs to (the latest-starting matching one). */
export function eraOf(cfg: CalendarConfig, year: number): CalendarEra | null {
  let best: CalendarEra | null = null
  for (const e of cfg.eras) {
    if (year < e.startYear) continue
    if (e.endYear !== null && year > e.endYear) continue
    if (!best || e.startYear > best.startYear) best = e
  }
  return best
}

export interface FormatOptions {
  /** Prefix with the weekday: "Среда, 4 марта 1203 г." (default false). */
  weekday?: boolean
  /** Append the year name: "… (Год Дракона)" (default false). */
  yearName?: boolean
  /** Calendar and era suffixes (default true). */
  suffix?: boolean
  /** Omit the year: "4 марта" (default false). */
  noYear?: boolean
  /** Use the month name as is instead of the genitive form (default false). */
  nominative?: boolean
}

/** "1203 г. ЭС": year, calendar suffix, era suffix. Negative years get a minus sign. */
export function formatYear(cfg: CalendarConfig, year: number, opts: { suffix?: boolean; yearName?: boolean } = {}): string {
  let s = year < 0 ? `−${-year}` : String(year)
  if (opts.suffix !== false) {
    if (cfg.suffix) s += ` ${cfg.suffix}`
    const era = eraOf(cfg, year)
    if (era?.suffix) s += ` ${era.suffix}`
  }
  if (opts.yearName) {
    const n = yearName(cfg, year)
    if (n) s += ` (${n})`
  }
  return s
}

/** "4 Морозня 1203 г. ЭС". */
export function formatCalendarDate(cfg: CalendarConfig, date: CalendarDate, opts: FormatOptions = {}): string {
  let s = `${date.day} ${monthName(cfg, date.month, !opts.nominative)}`
  if (!opts.noYear) s += ` ${formatYear(cfg, date.year, opts)}`
  if (opts.weekday) {
    const w = weekdayName(cfg, date)
    if (w) s = `${w}, ${s}`
  }
  return s
}

/** "4–6 марта 1203 г.", "30 марта – 2 апреля 1203 г.", "30 декабря 1203 г. – 2 января 1204 г.". */
export function formatDateRange(cfg: CalendarConfig, a: CalendarDate, b: CalendarDate, opts: FormatOptions = {}): string {
  if (compareDates(a, b) === 0) return formatCalendarDate(cfg, a, opts)
  const o: FormatOptions = { ...opts, weekday: false }
  if (a.year === b.year && a.month === b.month) return `${a.day}–${formatCalendarDate(cfg, b, o)}`
  if (a.year === b.year) return `${formatCalendarDate(cfg, a, { ...o, noYear: true })} – ${formatCalendarDate(cfg, b, o)}`
  return `${formatCalendarDate(cfg, a, o)} – ${formatCalendarDate(cfg, b, o)}`
}

// ---------------------------------------------------------------------------------------------------------------------
// Reminders: recurring expansion
// ---------------------------------------------------------------------------------------------------------------------

export type ReminderLike = Pick<Reminder, 'year' | 'month' | 'day'> & Partial<Pick<Reminder, 'length' | 'isRecurring' | 'recurPeriod' | 'recurUntil'>>

export interface Occurrence<R extends ReminderLike = ReminderLike> {
  reminder: R
  start: CalendarDate
  end: CalendarDate
  startIndex: number
  endIndex: number
  /** 0 for the original date; for recurring reminders the number of periods since it (anniversary years for 'year'). */
  n: number
}

export interface MonthOccurrence<R extends ReminderLike = ReminderLike> extends Occurrence<R> {
  /** Days of the requested month covered by this occurrence. */
  days: number[]
}

const lengthOf = (r: ReminderLike) => Math.max(1, Math.trunc(Number(r.length) || 1))

function makeOcc<R extends ReminderLike>(cfg: CalendarConfig, r: R, start: CalendarDate, n: number): Occurrence<R> {
  const startIndex = dayIndex(cfg, start)
  const endIndex = startIndex + lengthOf(r) - 1
  return { reminder: r, start, end: lengthOf(r) > 1 ? fromDayIndex(cfg, endIndex) : start, startIndex, endIndex, n }
}

const MAX_EXPANSION = 5000

/** Every occurrence (recurring ones expanded) that overlaps the absolute day range [fromIndex, toIndex]. */
export function occurrencesInRange<R extends ReminderLike>(cfg: CalendarConfig, reminders: readonly R[], fromIndex: number, toIndex: number): Occurrence<R>[] {
  const out: Occurrence<R>[] = []
  const N = cfg.months.length
  const toDate = fromDayIndex(cfg, toIndex)
  for (const r of reminders) {
    const len = lengthOf(r)
    const month = clampMonth(cfg, r.month)
    if (!r.isRecurring) {
      const s = dayIndex(cfg, r)
      if (s + len - 1 >= fromIndex && s <= toIndex) out.push(makeOcc(cfg, r, { year: r.year, month, day: r.day }, 0))
      continue
    }
    const fromDate = fromDayIndex(cfg, fromIndex - len + 1)
    const startL = linearYear(cfg, r.year)
    const untilYear = r.recurUntil === null || r.recurUntil === undefined || !Number.isFinite(Number(r.recurUntil)) ? null : Math.trunc(Number(r.recurUntil))
    if (r.recurPeriod === 'month') {
      const ser = (y: number, m: number) => (linearYear(cfg, y) - 1) * N + (m - 1)
      const startSer = ser(r.year, month)
      const untilSer = untilYear === null ? Infinity : Math.max(startSer, ser(untilYear, N))
      const a = Math.max(ser(fromDate.year, fromDate.month), startSer)
      const b = Math.min(ser(toDate.year, toDate.month), untilSer, a + MAX_EXPANSION)
      for (let k = a; k <= b; k++) {
        const y = yearFromLinear(cfg, Math.floor(k / N) + 1)
        const m = mod(k, N) + 1
        if (k !== startSer && cfg.months[m - 1].intercalary) continue
        const dim = daysInMonth(cfg, y, m)
        if (dim <= 0) continue
        const o = makeOcc(cfg, r, { year: y, month: m, day: Math.min(Math.max(1, r.day), dim) }, k - startSer)
        if (o.endIndex >= fromIndex && o.startIndex <= toIndex) out.push(o)
      }
    } else {
      const untilL = untilYear === null ? Infinity : Math.max(startL, linearYear(cfg, untilYear))
      const a = Math.max(linearYear(cfg, fromDate.year), startL)
      const b = Math.min(linearYear(cfg, toDate.year), untilL, a + MAX_EXPANSION)
      for (let L = a; L <= b; L++) {
        const y = yearFromLinear(cfg, L)
        const dim = daysInMonth(cfg, y, month)
        if (dim <= 0) continue
        const o = makeOcc(cfg, r, { year: y, month, day: Math.min(Math.max(1, r.day), dim) }, L - startL)
        if (o.endIndex >= fromIndex && o.startIndex <= toIndex) out.push(o)
      }
    }
  }
  return out.sort((x, y) => x.startIndex - y.startIndex || y.endIndex - x.endIndex)
}

/** Occurrences touching the given month, with the list of its days each one covers. */
export function occurrencesInMonth<R extends ReminderLike>(cfg: CalendarConfig, reminders: readonly R[], year: number, month: number): MonthOccurrence<R>[] {
  const dim = daysInMonth(cfg, year, month)
  if (dim <= 0) return []
  const first = dayIndex(cfg, { year, month, day: 1 })
  const last = first + dim - 1
  return occurrencesInRange(cfg, reminders, first, last).map((o) => {
    const days: number[] = []
    for (let i = Math.max(first, o.startIndex); i <= Math.min(last, o.endIndex); i++) days.push(i - first + 1)
    return { ...o, days }
  })
}

/** Groups month occurrences by day number. */
export function occurrencesByDay<R extends ReminderLike>(occ: MonthOccurrence<R>[]): Map<number, MonthOccurrence<R>[]> {
  const m = new Map<number, MonthOccurrence<R>[]>()
  for (const o of occ) for (const d of o.days) {
    if (!m.has(d)) m.set(d, [])
    m.get(d)!.push(o)
  }
  return m
}

/**
 * Next occurrences starting on/after `from` (or still running on it with `includeOngoing`).
 * Recurring reminders are expanded `horizonDays` ahead (default: two years); one-off ones are never cut off.
 */
export function upcomingOccurrences<R extends ReminderLike>(
  cfg: CalendarConfig, reminders: readonly R[], from: CalendarDate,
  opts: { limit?: number; horizonDays?: number; includeOngoing?: boolean } = {},
): Occurrence<R>[] {
  const limit = opts.limit ?? 5
  const fromIndex = dayIndex(cfg, from)
  const toIndex = fromIndex + Math.max(1, opts.horizonDays ?? daysInYear(cfg, from.year) * 2)
  const ok = (o: Occurrence<R>) => (opts.includeOngoing ? o.endIndex >= fromIndex : o.startIndex >= fromIndex)
  const out: Occurrence<R>[] = []
  const recurring: R[] = []
  for (const r of reminders) {
    if (!r.isRecurring) {
      const o = makeOcc(cfg, r, { year: r.year, month: clampMonth(cfg, r.month), day: r.day }, 0)
      if (ok(o)) out.push(o)
    } else if (dayIndex(cfg, r) > toIndex) {
      out.push(makeOcc(cfg, r, { year: r.year, month: clampMonth(cfg, r.month), day: r.day }, 0))
    } else {
      recurring.push(r)
    }
  }
  for (const o of occurrencesInRange(cfg, recurring, fromIndex, toIndex)) if (ok(o)) out.push(o)
  out.sort((x, y) => x.startIndex - y.startIndex || y.endIndex - x.endIndex)
  return out.slice(0, limit)
}
