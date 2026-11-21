<script setup lang="ts">
import { computed } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import type { Entity } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
/** Entities tagged with this tag or any of its sub-tags. */
const tagIds = computed(() => {
  const out = new Set<string>([props.entity.id])
  const walk = (id: string) => (world.children.get(id) ?? []).forEach((c) => { if (c.type === 'tag' && !out.has(c.id)) { out.add(c.id); walk(c.id) } })
  walk(props.entity.id)
  return out
})
const groups = computed(() => {
  const m = new Map<string, Entity[]>()
  for (const e of world.list) if (e.tagIds.some((t) => tagIds.value.has(t))) { if (!m.has(e.type)) m.set(e.type, []); m.get(e.type)!.push(e) }
  return [...m.entries()]
})
</script>

<template>
  <div class="stack">
    <div v-if="!groups.length" class="card empty">Статей с этим тегом пока нет.</div>
    <div v-for="[t, list] in groups" :key="t" class="card card-pad">
      <div class="section-title" :style="{ color: typeDef(t).color }"><Icon :name="typeDef(t).icon" :size="13" /> {{ typeDef(t).plural }} ({{ list.length }})</div>
      <div class="row wrap gap"><EntityLink v-for="e in list" :key="e.id" :id="e.id" avatar /></div>
    </div>
  </div>
</template>
