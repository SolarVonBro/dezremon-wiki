<script setup lang="ts">
// Icon grid for map markers: plain dot, the linked entity's picture, or any icon from icons.ts.
import { computed, ref } from 'vue'
import Icon from '@/components/common/Icon.vue'
import { ICON_NAMES } from '@/components/common/icons'
import { ICON_ENTITY, MAP_ICONS, resolveIcon } from './mapUtils'

const props = defineProps<{ modelValue: string; allowEntity?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [icon: string] }>()
const q = ref('')

const current = computed(() => resolveIcon(props.modelValue))
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (!s) return MAP_ICONS
  return ICON_NAMES.filter((n) => n.includes(s)).slice(0, 120)
})
</script>

<template>
  <div class="ip">
    <input v-model="q" class="input input-sm" type="search" placeholder="Найти значок (castle, skull…)" />
    <div class="ip-grid">
      <button type="button" class="ip-cell" :class="{ on: current.kind === 'dot' }" title="Точка" @click="emit('update:modelValue', '')"><i class="ip-dot" /></button>
      <button v-if="allowEntity" type="button" class="ip-cell" :class="{ on: current.kind === 'entity' }" title="Картинка статьи" @click="emit('update:modelValue', ICON_ENTITY)">
        <Icon name="image" :size="16" />
      </button>
      <button v-for="n in shown" :key="n" type="button" class="ip-cell" :class="{ on: current.kind === 'icon' && current.name === n }" :title="n" @click="emit('update:modelValue', n)">
        <Icon :name="n" :size="16" />
      </button>
    </div>
    <p v-if="!shown.length" class="muted small">Ничего не найдено.</p>
  </div>
</template>

<style scoped>
.ip { display: flex; flex-direction: column; gap: 6px; }
.ip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 3px; max-height: 136px; overflow-y: auto; padding: 2px; }
.ip-cell { height: 30px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text-muted); cursor: pointer; padding: 0; }
.ip-cell:hover { border-color: var(--accent); color: var(--text); }
.ip-cell.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.ip-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
</style>
