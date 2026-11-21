<script setup lang="ts">
// One row of an "upcoming events" list.
import { computed } from 'vue'
import { useWorld } from '@/stores/world'
import type { Reminder } from '@/model/types'
import { dayIndex, formatCalendarDate, formatDateRange, type CalendarConfig, type Occurrence } from '@/data/calendar'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import { anniversaryLabel, KIND_ICONS, reminderColour, reminderTitle } from './shared'

const props = withDefaults(defineProps<{ occ: Occurrence<Reminder>; cfg: CalendarConfig; compact?: boolean; showRelative?: boolean }>(), { compact: false, showRelative: true })
const emit = defineEmits<{ open: [occ: Occurrence<Reminder>] }>()
const world = useWorld()

const r = computed(() => props.occ.reminder)
const when = computed(() => {
  const o = props.occ
  const sameYear = o.start.year === props.cfg.current.year && o.end.year === props.cfg.current.year
  return o.endIndex > o.startIndex
    ? formatDateRange(props.cfg, o.start, o.end, { noYear: sameYear && props.compact })
    : formatCalendarDate(props.cfg, o.start, { noYear: sameYear && props.compact })
})
const relative = computed(() => {
  if (!props.showRelative) return ''
  const today = dayIndex(props.cfg, props.cfg.current)
  const d = props.occ.startIndex - today
  if (d === 0) return 'сегодня'
  if (d === 1) return 'завтра'
  if (d < 0) return props.occ.endIndex >= today ? 'идёт сейчас' : ''
  return `через ${d} ${plural(d, 'день', 'дня', 'дней')}`
})
const anniv = computed(() => anniversaryLabel(props.occ))
const linked = computed(() => world.get(r.value.entityId))
</script>

<template>
  <div class="occ" :class="{ compact }" :style="{ '--c': reminderColour(r) }" role="button" tabindex="0" @click="emit('open', occ)" @keydown.enter="emit('open', occ)">
    <span class="occ-bar" />
    <div class="occ-main">
      <div class="occ-title">
        <Icon v-if="r.kind !== 'event'" :name="KIND_ICONS[r.kind]" :size="13" class="muted" />
        <span class="ellipsis">{{ reminderTitle(r, world.get) }}</span>
        <Icon v-if="r.isRecurring" name="refresh-cw" :size="11" class="faint" />
      </div>
      <div class="occ-meta small muted">
        <span>{{ when }}</span>
        <span v-if="anniv"> · {{ anniv }}</span>
        <span v-if="relative" class="occ-rel"> · {{ relative }}</span>
      </div>
      <div v-if="linked && r.name" class="occ-link small" @click.stop><EntityLink :id="linked.id" /></div>
    </div>
  </div>
</template>

<style scoped>
.occ { display: flex; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; min-width: 0; }
.occ:hover { background: var(--surface-2); }
.occ-bar { width: 4px; border-radius: 4px; background: var(--c); flex-shrink: 0; }
.occ-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
.occ-title { display: flex; align-items: center; gap: 5px; font-weight: 500; min-width: 0; }
.occ-rel { color: var(--accent); }
.occ.compact { padding: 4px 6px; }
.occ-link { max-width: 100%; overflow: hidden; }
</style>
