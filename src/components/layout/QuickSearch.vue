<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { quickSearch } from '@/data/search'
import { typeDef } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'

const world = useWorld()
const router = useRouter()
const q = ref('')
const open = ref(false)
const idx = ref(0)
const results = computed(() => (q.value.trim() ? quickSearch(world.list, q.value, 10) : []))

function go(i: number) {
  const e = results.value[i]
  if (e) void router.push({ name: 'entity', params: { wid: world.wid!, eid: e.id } })
  else if (q.value.trim()) void router.push({ name: 'search', params: { wid: world.wid! }, query: { q: q.value } })
  q.value = ''
  open.value = false
  ;(document.activeElement as HTMLElement)?.blur()
}
function onBlur() { setTimeout(() => (open.value = false), 150) }
function key(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); idx.value = Math.min(idx.value + 1, results.value.length) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); idx.value = Math.max(idx.value - 1, 0) }
  else if (e.key === 'Enter') { e.preventDefault(); go(idx.value) }
  else if (e.key === 'Escape') { open.value = false; (e.target as HTMLElement).blur() }
}
</script>

<template>
  <div class="quick-search">
    <input v-model="q" class="input" placeholder="Найти статью… (Ctrl+K)" @focus="open = true" @blur="onBlur" @input="idx = 0; open = true" @keydown="key" />
    <div v-if="open && q.trim()" class="qs-results">
      <a v-for="(e, i) in results" :key="e.id" class="qs-item" :class="{ active: i === idx }" @mousedown.prevent="go(i)">
        <Icon :name="typeDef(e.type).icon" :size="15" :style="{ color: typeDef(e.type).color }" />
        <span class="ellipsis">{{ e.name }}</span>
        <span class="sub">{{ e.kind || typeDef(e.type).label }}</span>
      </a>
      <a class="qs-item" :class="{ active: idx === results.length }" @mousedown.prevent="go(results.length)">
        <Icon name="text-search" :size="15" /> Искать «{{ q }}» во всех текстах
      </a>
    </div>
  </div>
</template>
