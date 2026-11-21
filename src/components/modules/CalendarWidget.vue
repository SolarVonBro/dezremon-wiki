<script setup lang="ts">
// Dashboard card: current date of a calendar (default: the world's main calendar), moons, season, next events.
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useWorld } from '@/stores/world'
import type { Reminder } from '@/model/types'
import {
  formatCalendarDate, formatYear, MOON_PHASE_LABELS, moonPhase, seasonOf, upcomingOccurrences, weekdayName, yearName,
  type Occurrence,
} from '@/data/calendar'
import Icon from '@/components/common/Icon.vue'
import MoonIcon from './calendar/MoonIcon.vue'
import OccurrenceItem from './calendar/OccurrenceItem.vue'
import ReminderModal from './calendar/ReminderModal.vue'
import { calendarOf, canEditReminder } from './calendar/shared'

const props = withDefaults(defineProps<{ calendarId?: string | null; limit?: number }>(), { calendarId: null, limit: 5 })
const world = useWorld()

/** Explicit id → that calendar; null → main calendar → first calendar of the world. */
const cal = computed(() => {
  if (props.calendarId) return world.get(props.calendarId)
  return world.get(world.settings.mainCalendarId) ?? world.byType.get('calendar')?.[0]
})
const cfg = computed(() => calendarOf(cal.value))

const reminders = shallowRef<Reminder[]>([])
let stop: (() => void) | null = null
watch(() => cal.value?.id ?? null, (id) => {
  stop?.()
  stop = null
  reminders.value = []
  if (id) stop = world.watchRows<Reminder>('reminders', 'calendarId', id, (rows) => { reminders.value = rows }, null)
}, { immediate: true })
onBeforeUnmount(() => stop?.())

const info = computed(() => {
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
const upcoming = computed(() => upcomingOccurrences(cfg.value, reminders.value, cfg.value.current, { limit: props.limit, includeOngoing: true }))
const route = computed(() => (cal.value ? { name: 'entity', params: { wid: world.wid!, eid: cal.value.id } } : null))

const modal = ref<{ key: number; reminder: Reminder; readonly: boolean } | null>(null)
let seq = 0
function openOcc(o: Occurrence<Reminder>) {
  modal.value = { key: ++seq, reminder: o.reminder, readonly: !canEditReminder(world, o.reminder) }
}
</script>

<template>
  <div class="calw card">
    <template v-if="cal && route">
      <RouterLink class="calw-head" :to="route">
        <Icon name="calendar-days" :size="16" />
        <span class="ellipsis grow">{{ cal.name }}</span>
        <Icon name="chevron-right" :size="15" class="faint" />
      </RouterLink>
      <div class="calw-body">
        <div class="calw-date">{{ info.date }}</div>
        <div class="calw-year">{{ info.year }}<span v-if="info.yearName" class="muted"> · {{ info.yearName }}</span></div>
        <div class="calw-tags small">
          <span v-if="info.weekday" class="muted">{{ info.weekday }}</span>
          <span v-if="info.season" class="calw-season" :style="{ '--s': info.season.colour || 'var(--success)' }">{{ info.season.name }}</span>
        </div>
        <div v-if="info.moons.length" class="calw-moons">
          <span v-for="m in info.moons" :key="m.name" class="calw-moon small" :title="`${m.name}: ${m.label}`">
            <MoonIcon :fraction="m.fraction" :colour="m.colour" :size="18" />
            <span><b>{{ m.name }}</b> <span class="muted">{{ m.label.toLowerCase() }}</span></span>
          </span>
        </div>
      </div>
      <div class="calw-events">
        <div class="section-title">Ближайшие события</div>
        <OccurrenceItem v-for="o in upcoming" :key="o.reminder.id + ':' + o.startIndex" :occ="o" :cfg="cfg" compact @open="openOcc" />
        <p v-if="!upcoming.length" class="muted small calw-none">Нет предстоящих событий.</p>
      </div>
      <ReminderModal v-if="modal" :key="modal.key" :reminder="modal.reminder" :calendar-id="cal.id" :readonly="modal.readonly" @close="modal = null" />
    </template>
    <div v-else class="calw-empty">
      <Icon name="calendar-days" :size="22" />
      <span class="small muted">{{ calendarId ? 'Календарь недоступен' : 'В мире нет календаря. Создайте статью типа «Календарь» и выберите её основной в настройках мира.' }}</span>
    </div>
  </div>
</template>

<style scoped>
.calw { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.calw-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text); font-weight: 600; text-decoration: none !important; }
.calw-head:hover { background: var(--surface-2); color: var(--accent); }
.calw-body { padding: 12px 14px 8px; display: flex; flex-direction: column; gap: 2px; }
.calw-date { font-family: var(--font-head); font-size: 30px; font-weight: 600; line-height: 1.05; }
.calw-year { font-weight: 500; }
.calw-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.calw-season { padding: 0 8px; border-radius: 999px; background: color-mix(in srgb, var(--s) 22%, transparent); border: 1px solid color-mix(in srgb, var(--s) 50%, transparent); }
.calw-moons { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; }
.calw-moon { display: inline-flex; align-items: center; gap: 6px; }
.calw-events { padding: 6px 8px 10px; border-top: 1px solid var(--border); }
.calw-events .section-title { padding: 4px 6px 2px; margin: 0; }
.calw-none { margin: 4px 6px; }
.calw-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 22px 16px; text-align: center; color: var(--text-faint); }
</style>
