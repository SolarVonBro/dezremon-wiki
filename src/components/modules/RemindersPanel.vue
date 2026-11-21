<script setup lang="ts">
// Calendar dates of an entity (birth, death, founding, …). Shown on every entity page.
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useWorld } from '@/stores/world'
import type { Entity, Reminder } from '@/model/types'
import {
  clampDate, compareDates, dayIndex, formatCalendarDate, formatDateRange, fromDayIndex, REMINDER_KIND_LABELS, yearsBetween,
  type CalendarConfig,
} from '@/data/calendar'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import ReminderModal from './calendar/ReminderModal.vue'
import { calendarOf, canEditReminder, KIND_ICONS, recurrenceLabel, reminderColour } from './calendar/shared'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()

const rows = shallowRef<Reminder[]>([])
let stop: (() => void) | null = null
watch(() => props.entity.id, (id) => {
  stop?.()
  rows.value = []
  stop = world.watchRows<Reminder>('reminders', 'entityId', id, (r) => { rows.value = r }, null)
}, { immediate: true })
onBeforeUnmount(() => stop?.())

const calendars = computed(() => world.byType.get('calendar') ?? [])
const cfgCache = computed(() => {
  const m = new Map<string, CalendarConfig>()
  for (const r of rows.value) if (!m.has(r.calendarId)) m.set(r.calendarId, calendarOf(world.get(r.calendarId)))
  return m
})
const cfgOf = (id: string) => cfgCache.value.get(id) ?? calendarOf(world.get(id))
const multiCalendar = computed(() => new Set(rows.value.map((r) => r.calendarId)).size > 1 || calendars.value.length > 1)

const KIND_ORDER: Record<Reminder['kind'], number> = { birth: 0, death: 1, event: 2, other: 3 }
const items = computed(() => [...rows.value]
  .filter((r) => world.get(r.calendarId))
  .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareDates(a, b))
  .map((r) => {
    const c = cfgOf(r.calendarId)
    const s = clampDate(c, r)
    const len = Math.max(1, r.length || 1)
    return {
      r,
      date: len > 1 ? formatDateRange(c, s, fromDayIndex(c, dayIndex(c, s) + len - 1)) : formatCalendarDate(c, s),
      recur: recurrenceLabel(c, r),
      title: r.name?.trim() || REMINDER_KIND_LABELS[r.kind],
    }
  }))
/** Reminders on calendars that the user cannot see (or that were deleted). */
const hiddenCount = computed(() => rows.value.length - items.value.length)

// Age of a character: birth → death, or birth → the calendar's current date.
const age = computed(() => {
  if (props.entity.type !== 'character') return null
  const birth = rows.value.find((r) => r.kind === 'birth' && world.get(r.calendarId))
  if (!birth) return null
  const c = cfgOf(birth.calendarId)
  const death = rows.value.find((r) => r.kind === 'death' && r.calendarId === birth.calendarId)
  const years = (n: number) => `${n} ${plural(n, 'год', 'года', 'лет')}`
  if (death) {
    const y = yearsBetween(c, birth, death)
    return y >= 0 ? `Прожил(а) ${years(y)}` : null
  }
  if (props.entity.fields?.isDead) return null
  if (compareDates(c.current, birth) < 0) return `Ещё не родился(ась): до рождения ${years(Math.max(0, yearsBetween(c, c.current, birth)))}`
  return `Возраст: ${years(yearsBetween(c, birth, c.current))} (на ${formatCalendarDate(c, c.current)})`
})

const canAdd = computed(() => props.editing && calendars.value.length > 0)
const canEditRow = (r: Reminder) => props.editing && canEditReminder(world, r)

const modal = ref<{ key: number; reminder: Partial<Reminder> | null; readonly: boolean } | null>(null)
let seq = 0
function openNew(kind: Reminder['kind'] = 'event') {
  modal.value = { key: ++seq, reminder: { kind }, readonly: false }
}
function open(r: Reminder) {
  modal.value = { key: ++seq, reminder: r, readonly: !canEditRow(r) }
}
async function remove(r: Reminder) {
  if (!window.confirm('Удалить эту дату?')) return
  try { await world.deleteRow('reminders', r.id) } catch { /* toast shown by the store */ }
}
const hasBirth = computed(() => rows.value.some((r) => r.kind === 'birth'))
const hasDeath = computed(() => rows.value.some((r) => r.kind === 'death'))
</script>

<template>
  <section v-if="items.length || editing" class="rem-panel">
    <div class="row gap-sm rem-head">
      <h4 class="section-title grow"><Icon name="calendar-days" :size="13" /> Даты</h4>
      <template v-if="canAdd">
        <button v-if="entity.type === 'character' && !hasBirth" type="button" class="btn btn-sm btn-ghost" @click="openNew('birth')"><Icon name="baby" :size="14" /> Рождение</button>
        <button v-if="entity.type === 'character' && hasBirth && !hasDeath" type="button" class="btn btn-sm btn-ghost" @click="openNew('death')"><Icon name="skull" :size="14" /> Смерть</button>
        <button type="button" class="btn btn-sm" @click="openNew()"><Icon name="plus" :size="14" /> Дата</button>
      </template>
    </div>

    <p v-if="age" class="rem-age small"><Icon name="hourglass" :size="14" /> {{ age }}</p>

    <ul v-if="items.length" class="rem-list">
      <li v-for="it in items" :key="it.r.id" class="rem-item" :style="{ '--c': reminderColour(it.r) }">
        <span class="rem-bar" />
        <Icon :name="KIND_ICONS[it.r.kind]" :size="15" class="rem-kind" :title="REMINDER_KIND_LABELS[it.r.kind]" />
        <div class="rem-body" role="button" tabindex="0" @click="open(it.r)" @keydown.enter="open(it.r)">
          <div class="rem-title">
            <span>{{ it.title }}</span>
            <Icon v-if="it.r.visibility === 'master'" name="lock" :size="12" class="faint" />
          </div>
          <div class="small muted">
            {{ it.date }}<template v-if="it.recur"> · <Icon name="refresh-cw" :size="11" /> {{ it.recur }}</template>
          </div>
          <div v-if="multiCalendar" class="small rem-cal" @click.stop><EntityLink :id="it.r.calendarId" /></div>
          <div v-if="it.r.comment" class="small faint rem-comment">{{ it.r.comment }}</div>
        </div>
        <div v-if="canEditRow(it.r)" class="rem-actions">
          <button type="button" class="icon-btn" title="Изменить" @click="open(it.r)"><Icon name="pencil" :size="14" /></button>
          <button type="button" class="icon-btn" title="Удалить" @click="remove(it.r)"><Icon name="trash2" :size="14" /></button>
        </div>
      </li>
    </ul>
    <p v-else-if="editing && !calendars.length" class="muted small">Чтобы добавлять даты, создайте статью типа «Календарь».</p>
    <p v-else-if="editing" class="muted small">Дат пока нет: добавьте рождение, основание, важное событие…</p>
    <p v-if="hiddenCount > 0 && world.isMaster" class="faint small">Ещё {{ hiddenCount }} — в удалённых календарях.</p>

    <ReminderModal
      v-if="modal" :key="modal.key" :reminder="modal.reminder" :entity-id="entity.id" :readonly="modal.readonly"
      @close="modal = null"
    />
  </section>
</template>

<style scoped>
.rem-panel { min-width: 0; }
.rem-head { margin-bottom: 6px; }
.rem-head .section-title { margin: 0; display: flex; align-items: center; gap: 6px; }
.rem-age { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; padding: 6px 10px; border-radius: var(--radius-sm); background: var(--surface-2); }
.rem-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.rem-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px 6px 0; border-radius: 8px; }
.rem-item:hover { background: var(--surface-2); }
.rem-bar { width: 3px; align-self: stretch; border-radius: 3px; background: var(--c); flex-shrink: 0; }
.rem-kind { margin-top: 2px; color: var(--text-muted); }
.rem-body { flex: 1; min-width: 0; cursor: pointer; }
.rem-title { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.rem-cal { margin-top: 1px; }
.rem-comment { white-space: pre-wrap; margin-top: 2px; }
.rem-actions { display: flex; gap: 0; flex-shrink: 0; }
.rem-actions .icon-btn { width: 28px; height: 28px; }
</style>
