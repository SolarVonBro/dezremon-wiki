<script setup lang="ts">
// Day / month / year input for a fantasy calendar. Always emits a valid (clamped) date.
import { computed } from 'vue'
import type { CalendarDate } from '@/model/types'
import { clampDate, daysInMonth, type CalendarConfig } from '@/data/calendar'

const props = withDefaults(defineProps<{ modelValue: CalendarDate; cfg: CalendarConfig; small?: boolean }>(), { small: true })
const emit = defineEmits<{ 'update:modelValue': [d: CalendarDate] }>()

const maxDay = computed(() => Math.max(1, daysInMonth(props.cfg, props.modelValue.year, props.modelValue.month)))

function set(patch: Partial<CalendarDate>) {
  const next = { ...props.modelValue, ...patch }
  if (![next.year, next.month, next.day].every((n) => Number.isFinite(n))) return
  emit('update:modelValue', clampDate(props.cfg, next))
}
function num(e: Event): number {
  const v = (e.target as HTMLInputElement | HTMLSelectElement).value
  return v === '' || v === '-' ? NaN : Math.trunc(Number(v))
}
</script>

<template>
  <div class="date-input" :class="{ small }">
    <input
      class="input di-day" :class="{ 'input-sm': small }" type="number" min="1" :max="maxDay" :value="modelValue.day" title="День"
      aria-label="День" @input="set({ day: num($event) })"
    />
    <select class="input di-month" :class="{ 'input-sm': small }" :value="modelValue.month" title="Месяц" aria-label="Месяц" @change="set({ month: num($event) })">
      <option v-for="(m, i) in cfg.months" :key="i" :value="i + 1">{{ m.name }}</option>
    </select>
    <input
      class="input di-year" :class="{ 'input-sm': small }" type="number" :value="modelValue.year" title="Год" aria-label="Год"
      @input="set({ year: num($event) })"
    />
  </div>
</template>

<style scoped>
.date-input { display: flex; gap: 6px; align-items: center; min-width: 0; }
.di-day { width: 64px; flex: 0 0 auto; }
.di-month { flex: 1 1 120px; min-width: 0; }
.di-year { width: 92px; flex: 0 0 auto; }
</style>
