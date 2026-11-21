<script lang="ts">
export interface MultiOption { value: string; label: string; icon?: string; color?: string; count?: number }
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Dropdown from './Dropdown.vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ modelValue: string[]; options: MultiOption[]; placeholder?: string; searchable?: boolean }>(), { placeholder: 'Любые' })
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>()
const q = ref('')
const input = ref<HTMLInputElement | null>(null)

const selected = computed(() => new Set(props.modelValue))
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? props.options.filter((o) => o.label.toLowerCase().includes(s)) : props.options
})
const search = computed(() => props.searchable ?? props.options.length > 8)
const label = computed(() => {
  const picked = props.options.filter((o) => selected.value.has(o.value))
  if (!picked.length) return props.placeholder
  if (picked.length <= 2) return picked.map((o) => o.label).join(', ')
  return `${picked[0].label} и ещё ${picked.length - 1}`
})
function toggle(v: string) {
  const s = new Set(props.modelValue)
  if (s.has(v)) s.delete(v); else s.add(v)
  emit('update:modelValue', props.options.map((o) => o.value).filter((x) => s.has(x)))
}
async function opened() { q.value = ''; await nextTick(); input.value?.focus() }
</script>

<template>
  <Dropdown keep-open>
    <template #trigger>
      <button type="button" class="ms-btn input" :class="{ on: modelValue.length }" @click="opened">
        <span class="grow ellipsis">{{ label }}</span>
        <span v-if="modelValue.length" class="ms-count">{{ modelValue.length }}</span>
        <Icon name="chevron-down" :size="14" />
      </button>
    </template>
    <div class="menu ms-menu">
      <input v-if="search" ref="input" v-model="q" class="input input-sm" placeholder="Поиск…" />
      <div class="menu-scroll">
        <label v-for="o in shown" :key="o.value" class="menu-item ms-item">
          <input type="checkbox" :checked="selected.has(o.value)" @change="toggle(o.value)" />
          <Icon v-if="o.icon" :name="o.icon" :size="14" :style="{ color: o.color }" />
          <span v-else-if="o.color" class="ms-dot" :style="{ background: o.color }" />
          <span class="grow ellipsis">{{ o.label }}</span>
          <span v-if="o.count !== undefined" class="faint small">{{ o.count }}</span>
        </label>
        <div v-if="!shown.length" class="menu-label">Ничего не найдено</div>
      </div>
      <button v-if="modelValue.length" type="button" class="menu-item faint" @click="emit('update:modelValue', [])"><Icon name="x" :size="14" /> Сбросить</button>
    </div>
  </Dropdown>
</template>

<style scoped>
.ms-btn { display: flex; align-items: center; gap: 6px; text-align: left; cursor: pointer; min-width: 0; width: 100%; }
.ms-btn.on { border-color: var(--accent); }
.ms-count { font-size: 11px; font-weight: 700; background: var(--accent); color: var(--accent-fg); border-radius: 8px; padding: 0 6px; }
.ms-menu { width: 300px; gap: 4px; }
.ms-item { cursor: pointer; }
.ms-item input { accent-color: var(--accent); }
.ms-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
</style>
