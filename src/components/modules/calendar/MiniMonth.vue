<script setup lang="ts">
// Small month block for the year overview.
import { computed } from 'vue'
import type { Reminder } from '@/model/types'
import {
  compareDates, daysInMonth, occurrencesByDay, occurrencesInMonth, seasonStartingOn, weekdayOf, type CalendarConfig,
} from '@/data/calendar'
import { plural } from '@/data/util'
import { reminderColour } from './shared'

const props = defineProps<{ cfg: CalendarConfig; year: number; month: number; reminders: Reminder[] }>()
const emit = defineEmits<{ open: [month: number]; day: [day: number] }>()

const m = computed(() => props.cfg.months[props.month - 1])
const dim = computed(() => daysInMonth(props.cfg, props.year, props.month))
const lead = computed(() => (m.value?.intercalary || dim.value <= 0 ? 0 : weekdayOf(props.cfg, { year: props.year, month: props.month, day: 1 })))
const byDay = computed(() => occurrencesByDay(occurrencesInMonth(props.cfg, props.reminders, props.year, props.month)))
const count = computed(() => {
  const ids = new Set<string>()
  for (const list of byDay.value.values()) for (const o of list) ids.add(`${o.reminder.id}:${o.startIndex}`)
  return ids.size
})
const days = computed(() => Array.from({ length: dim.value }, (_, i) => {
  const day = i + 1
  const date = { year: props.year, month: props.month, day }
  const occ = byDay.value.get(day) ?? []
  return {
    day,
    today: compareDates(date, props.cfg.current) === 0,
    colour: occ.length ? reminderColour(occ[0].reminder) : '',
    count: occ.length,
    season: seasonStartingOn(props.cfg, date),
  }
}))
const initials = computed(() => props.cfg.weekdays.map((w) => w.slice(0, 2)))
</script>

<template>
  <div class="mini card" :class="{ inter: m?.intercalary }">
    <button type="button" class="mini-head" @click="emit('open', month)">
      <span class="ellipsis">{{ m?.name }}</span>
      <span v-if="count" class="badge">{{ count }}</span>
    </button>
    <template v-if="m?.intercalary || dim <= 0">
      <div class="mini-inter small muted">
        {{ dim <= 0 ? 'В этом году нет дней' : `Вне недели · ${dim} ${plural(dim, 'день', 'дня', 'дней')}` }}
      </div>
      <div v-if="dim > 0" class="mini-flat">
        <button
          v-for="d in days" :key="d.day" type="button" class="mini-day" :class="{ today: d.today, has: d.count }"
          :style="d.colour ? { '--c': d.colour } : {}" @click="emit('day', d.day)"
        >{{ d.day }}</button>
      </div>
    </template>
    <div v-else class="mini-grid" :style="{ '--cols': cfg.weekdays.length }">
      <span v-for="(w, i) in initials" :key="'w' + i" class="mini-wd">{{ w }}</span>
      <span v-for="i in lead" :key="'b' + i" />
      <button
        v-for="d in days" :key="d.day" type="button" class="mini-day" :class="{ today: d.today, has: d.count, season: d.season }"
        :style="{ ...(d.colour ? { '--c': d.colour } : {}), ...(d.season?.colour ? { '--s': d.season.colour } : {}) }"
        :title="d.season ? `Начало сезона: ${d.season.name}` : undefined" @click="emit('day', d.day)"
      >{{ d.day }}</button>
    </div>
  </div>
</template>

<style scoped>
.mini { padding: 8px 10px 10px; box-shadow: none; }
.mini-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; border: 0; background: none; padding: 2px 2px 6px; cursor: pointer; font-family: var(--font-head); font-size: 17px; font-weight: 600; color: var(--text); text-align: left; }
.mini-head:hover { color: var(--accent); }
.mini-grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 1px; }
.mini-wd { font-size: 10px; text-align: center; color: var(--text-faint); text-transform: uppercase; overflow: hidden; }
.mini-flat { display: flex; flex-wrap: wrap; gap: 2px; }
.mini-day {
  position: relative; border: 0; background: none; padding: 2px 0; font-size: 11.5px; border-radius: 4px; cursor: pointer;
  color: var(--text-muted); min-width: 20px; line-height: 1.5;
}
.mini-day:hover { background: var(--surface-2); color: var(--text); }
.mini-day.has { color: var(--text); font-weight: 600; background: color-mix(in srgb, var(--c) 22%, transparent); }
.mini-day.today { outline: 2px solid var(--accent); outline-offset: -2px; color: var(--accent); font-weight: 700; }
.mini-day.season::after { content: ''; position: absolute; top: 2px; right: 2px; width: 4px; height: 4px; border-radius: 50%; background: var(--s, var(--success)); }
.mini-inter { padding: 2px 2px 6px; }
.inter { background: var(--surface-2); }
</style>
