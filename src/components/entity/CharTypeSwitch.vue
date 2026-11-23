<script setup lang="ts">
import { useId } from 'vue'
import { CHAR_TYPE_HINT, CHAR_TYPE_KIND, type CharType } from '@/data/charType'

// PC / NPC / no type for a character (written into its «Тип» field; the PC / NPC tags follow).
// compact: the narrow side panel of a page — no hints next to PC / NPC (they stay in the tooltips)
defineProps<{ modelValue: CharType | null; disabled?: boolean; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [v: CharType | null] }>()
const name = useId()
const OPTS: Array<{ v: CharType | null; label: string; hint: string }> = [
  { v: 'pc', label: CHAR_TYPE_KIND.pc, hint: CHAR_TYPE_HINT.pc },
  { v: 'npc', label: CHAR_TYPE_KIND.npc, hint: CHAR_TYPE_HINT.npc },
  { v: null, label: 'Без типа', hint: '' },
]
</script>

<template>
  <div class="ct-switch" role="radiogroup" aria-label="Тип персонажа">
    <label v-for="o in OPTS" :key="String(o.v)" class="ct-opt" :class="{ on: modelValue === o.v }" :title="o.hint || undefined">
      <input type="radio" :name="name" :value="String(o.v)" :checked="modelValue === o.v" :disabled="disabled" @change="emit('update:modelValue', o.v)" />
      <b>{{ o.label }}</b><span v-if="o.hint && !compact" class="ct-hint">{{ o.hint }}</span>
    </label>
  </div>
</template>

<style scoped>
.ct-switch { display: flex; flex-wrap: wrap; gap: 6px; }
.ct-opt {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface); cursor: pointer; user-select: none; font-size: 13.5px; color: var(--text-muted);
}
.ct-opt:hover { border-color: var(--accent); }
.ct-opt.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.ct-opt input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
.ct-opt b { font-weight: 600; }
.ct-hint { font-size: 12px; color: var(--text-faint); }
</style>
