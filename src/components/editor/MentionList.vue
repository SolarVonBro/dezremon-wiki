<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { quickSearch } from '@/data/search'
import { allTypes, typeDef } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'

const props = defineProps<{ query: string; command: (attrs: any) => void; editor: any; range: any }>()
const world = useWorld()
const index = ref(0)
const creating = ref(false)

const results = computed(() => quickSearch(world.list, props.query, 8))
const createTypes = computed(() => allTypes().filter((t) => world.enabledTypes(t.key) && world.canCreate(t.key)))
type Row = { kind: 'entity'; id: string; name: string; type: string; sub: string } | { kind: 'create'; type: string; label: string; icon: string }
const rows = computed<Row[]>(() => {
  const out: Row[] = results.value.map((e) => ({ kind: 'entity', id: e.id, name: e.name, type: e.type, sub: e.kind || typeDef(e.type).label }))
  if (props.query.trim() && creating.value) {
    for (const t of createTypes.value) out.push({ kind: 'create', type: t.key, label: t.label, icon: t.icon })
  } else if (props.query.trim()) {
    out.push({ kind: 'create', type: '', label: `Создать «${props.query.trim()}»…`, icon: 'plus' })
  }
  return out
})

watch(() => props.query, () => { index.value = 0; creating.value = false })

async function choose(i: number) {
  const r = rows.value[i]
  if (!r) return
  if (r.kind === 'entity') { props.command({ id: r.id, label: r.name }); return }
  if (!r.type) { creating.value = true; index.value = results.value.length; return }
  const name = props.query.trim()
  const id = await world.createEntity(r.type, name)
  props.command({ id, label: name })
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { index.value = (index.value + 1) % Math.max(1, rows.value.length); return true }
  if (e.key === 'ArrowUp') { index.value = (index.value - 1 + rows.value.length) % Math.max(1, rows.value.length); return true }
  if (e.key === 'Enter' || e.key === 'Tab') { void choose(index.value); return true }
  return false
}
defineExpose({ onKeyDown })
</script>

<template>
  <div class="suggest-list" @mousedown.prevent>
    <div v-if="!rows.length" class="suggest-empty">Начните вводить название статьи</div>
    <button
      v-for="(r, i) in rows" :key="i" type="button" class="suggest-item" :class="{ active: i === index }"
      @mouseenter="index = i" @click="choose(i)"
    >
      <template v-if="r.kind === 'entity'">
        <Icon :name="typeDef(r.type).icon" :size="15" :style="{ color: typeDef(r.type).color }" />
        <span class="suggest-name">{{ r.name }}</span>
        <span class="suggest-sub">{{ r.sub }}</span>
      </template>
      <template v-else>
        <Icon :name="r.icon" :size="15" />
        <span class="suggest-name">{{ r.type ? `Создать: ${r.label}` : r.label }}</span>
      </template>
    </button>
  </div>
</template>
