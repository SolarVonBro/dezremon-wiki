<script setup lang="ts">
// Moon disc with the lit part for a phase fraction (0 = new, 0.5 = full).
import { computed } from 'vue'

const props = withDefaults(defineProps<{ fraction: number; colour?: string; size?: number; title?: string }>(), { colour: '', size: 14, title: '' })

const R = 10
const C = 12
const f = computed(() => ((props.fraction % 1) + 1) % 1)
const isNew = computed(() => f.value < 0.01 || f.value > 0.99)
const isFull = computed(() => Math.abs(f.value - 0.5) < 0.01)
const path = computed(() => {
  if (isNew.value || isFull.value) return ''
  const waxing = f.value < 0.5
  const k = Math.cos(2 * Math.PI * f.value) // > 0: crescent, < 0: gibbous
  const rx = Math.abs(k) * R
  const sweepLit = waxing ? 1 : 0
  const crescent = k > 0
  const sweepTerm = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0)
  return `M ${C} ${C - R} A ${R} ${R} 0 0 ${sweepLit} ${C} ${C + R} A ${rx.toFixed(3)} ${R} 0 0 ${sweepTerm} ${C} ${C - R} Z`
})
const lit = computed(() => props.colour || 'var(--accent)')
</script>

<template>
  <svg class="moon-icon" :width="size" :height="size" viewBox="0 0 24 24" role="img" :aria-label="title || undefined">
    <title v-if="title">{{ title }}</title>
    <circle class="moon-dark" :cx="C" :cy="C" :r="R" />
    <circle v-if="isFull" :cx="C" :cy="C" :r="R" :fill="lit" />
    <path v-else-if="path" :d="path" :fill="lit" />
    <circle class="moon-rim" :cx="C" :cy="C" :r="R" />
  </svg>
</template>

<style scoped>
.moon-icon { flex-shrink: 0; vertical-align: middle; }
.moon-dark { fill: color-mix(in srgb, var(--text) 14%, var(--surface)); }
.moon-rim { fill: none; stroke: color-mix(in srgb, var(--text) 40%, transparent); stroke-width: 1.4; }
</style>
