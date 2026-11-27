<script setup lang="ts">
export type TriVal = 0 | 1 | -1 // 0 = any, 1 = yes, -1 = no

const props = defineProps<{
  modelValue: TriVal
  label: string
  title?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [v: TriVal] }>()

function cycle() {
  const next: TriVal = props.modelValue === 0 ? 1 : props.modelValue === 1 ? -1 : 0
  emit('update:modelValue', next)
}
</script>

<template>
  <button
    type="button"
    class="tri"
    :class="{ yes: modelValue === 1, no: modelValue === -1 }"
    :title="title || `${label}: нажмите для переключения (Любое → Да → Нет)`"
    @click="cycle"
  >
    <span class="tri-mark">{{ modelValue === 1 ? '✓' : modelValue === -1 ? '✕' : '·' }}</span>
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.tri {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
  font-size: 12.5px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted);
  cursor: pointer; white-space: nowrap; transition: border-color .12s, background .12s, color .12s;
}
.tri:hover { border-color: var(--accent); color: var(--text); }
.tri.yes { background: color-mix(in srgb, var(--success) 18%, transparent); border-color: var(--success); color: var(--text); font-weight: 600; }
.tri.yes .tri-mark { color: var(--success); }
.tri.no { background: color-mix(in srgb, var(--danger) 14%, transparent); border-color: var(--danger); color: var(--danger); font-weight: 600; }
.tri-mark { font-weight: 700; font-size: 11px; }
</style>
