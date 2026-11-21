// UI helpers shared by the calendar components.
import type { Entity, Reminder } from '@/model/types'
import { formatYear, normalizeCalendar, REMINDER_KIND_LABELS, type CalendarConfig, type Occurrence } from '@/data/calendar'
import { plural } from '@/data/util'

export const KIND_ICONS: Record<Reminder['kind'], string> = { event: 'calendar', birth: 'baby', death: 'skull', other: 'circle-dot' }

export const KIND_OPTIONS = (Object.keys(REMINDER_KIND_LABELS) as Reminder['kind'][]).map((k) => ({ value: k, label: REMINDER_KIND_LABELS[k] }))

export const REMINDER_COLOURS = ['#c9a227', '#d0703c', '#b04a4a', '#c25b8b', '#8e6cc4', '#6a7fc1', '#3f9fb5', '#4a8f8a', '#4f9d69', '#7aa13d', '#8b6d3f', '#8a8a8a']

/** Normalised calendar config of a calendar entity (default calendar for a missing / non-configured one). */
export function calendarOf(e: Entity | null | undefined): CalendarConfig {
  return normalizeCalendar(e?.fields?.calendar)
}

/** Masters edit everything, others only their own rows. */
export function canEditReminder(world: { isMaster: boolean; uid: string | null }, r: Pick<Reminder, 'createdBy'>): boolean {
  return world.isMaster || (!!world.uid && r.createdBy === world.uid)
}

/** Title shown in chips and lists: own name, else the linked entity name, else the kind. */
export function reminderTitle(r: Pick<Reminder, 'name' | 'entityId' | 'kind'>, getEntity: (id: string | null) => Entity | undefined): string {
  return r.name?.trim() || getEntity(r.entityId)?.name || REMINDER_KIND_LABELS[r.kind] || 'Событие'
}

export function recurrenceLabel(cfg: CalendarConfig, r: Pick<Reminder, 'isRecurring' | 'recurPeriod' | 'recurUntil'>): string {
  if (!r.isRecurring) return ''
  const p = r.recurPeriod === 'month' ? 'ежемесячно' : 'ежегодно'
  return r.recurUntil === null || r.recurUntil === undefined ? p : `${p} до ${formatYear(cfg, r.recurUntil)}`
}

/** "34 года" for birthdays, "5-я годовщина" for other yearly events, '' otherwise. */
export function anniversaryLabel(o: Occurrence<Reminder>): string {
  const r = o.reminder
  if (!r.isRecurring || r.recurPeriod !== 'year' || o.n <= 0) return ''
  if (r.kind === 'birth') return `${o.n} ${plural(o.n, 'год', 'года', 'лет')}`
  return `${o.n}-я годовщина`
}

/** Chip colour (user value or the theme accent). */
export function reminderColour(r: Pick<Reminder, 'colour'>): string {
  return r.colour?.trim() || 'var(--accent)'
}
