<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import Icon from '@/components/common/Icon.vue'
import type { SlashItem } from './extensions/slash'

const props = defineProps<{ items: SlashItem[]; command: (item: SlashItem) => void }>()
const index = ref(0)
const listEl = ref<HTMLElement | null>(null)

watch(() => props.items, () => { index.value = 0 })
watch(index, async () => {
  await nextTick()
  listEl.value?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
})

function onKeyDown(e: KeyboardEvent) {
  const n = props.items.length
  if (!n) return false
  if (e.key === 'ArrowDown') { index.value = (index.value + 1) % n; return true }
  if (e.key === 'ArrowUp') { index.value = (index.value - 1 + n) % n; return true }
  if (e.key === 'Enter') { props.command(props.items[index.value]); return true }
  return false
}
defineExpose({ onKeyDown })
</script>

<template>
  <div ref="listEl" class="suggest-list slash-list" @mousedown.prevent>
    <div v-if="!items.length" class="suggest-empty">Нет такой команды</div>
    <template v-for="(it, i) in items" :key="it.title">
      <div v-if="i === 0 || items[i - 1].group !== it.group" class="suggest-group">{{ it.group }}</div>
      <button type="button" class="suggest-item" :class="{ active: i === index }" @mouseenter="index = i" @click="command(it)">
        <Icon :name="it.icon" :size="16" />
        <span class="suggest-name">{{ it.title }}</span>
        <span v-if="it.hint" class="suggest-sub">{{ it.hint }}</span>
      </button>
    </template>
  </div>
</template>
