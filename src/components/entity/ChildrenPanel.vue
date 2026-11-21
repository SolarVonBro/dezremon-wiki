<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef, refFields } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import { createRequest } from '@/components/layout/createRequest'
import type { Entity } from '@/model/types'

const props = defineProps<{ entity: Entity }>()
const world = useWorld()
const kids = computed(() => world.children.get(props.entity.id) ?? [])
const showAll = ref<Record<string, boolean>>({})

/** Entities pointing at this one through their type fields ("Персонажи — Местонахождение"). */
const linked = computed(() => {
  const groups = new Map<string, { label: string; items: Entity[] }>()
  const id = props.entity.id
  for (const e of world.list) {
    if (e.id === id) continue
    for (const f of refFields(e.type)) {
      const v = e.fields?.[f.key]
      if (v === id || (Array.isArray(v) && v.includes(id))) {
        const key = `${e.type}:${f.key}`
        if (!groups.has(key)) groups.set(key, { label: `${typeDef(e.type).plural} · ${f.label.toLowerCase()}`, items: [] })
        groups.get(key)!.items.push(e)
      }
    }
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g }))
})
const LIMIT = 12
</script>

<template>
  <div v-if="kids.length || world.canCreate(entity.type) && world.canEdit(entity) && typeDef(entity.type).parentLabel" class="card card-pad">
    <div class="section-title row">
      <span class="grow">Вложенные: {{ typeDef(entity.type).plural.toLowerCase() }} <span v-if="kids.length">({{ kids.length }})</span></span>
      <button v-if="typeDef(entity.type).parentLabel && world.canCreate(entity.type)" class="icon-btn" style="width: 24px; height: 24px" title="Создать вложенную статью" @click="createRequest = { type: entity.type, parentId: entity.id }"><Icon name="plus" :size="14" /></button>
    </div>
    <div class="stack-sm">
      <EntityLink v-for="k in (showAll.kids ? kids : kids.slice(0, LIMIT))" :key="k.id" :id="k.id" avatar />
      <button v-if="kids.length > LIMIT && !showAll.kids" class="btn btn-ghost btn-sm" @click="showAll.kids = true">Показать все ({{ kids.length }})</button>
    </div>
  </div>
  <div v-for="g in linked" :key="g.key" class="card card-pad">
    <div class="section-title">{{ g.label }} ({{ g.items.length }})</div>
    <div class="stack-sm">
      <EntityLink v-for="k in (showAll[g.key] ? g.items : g.items.slice(0, LIMIT))" :key="k.id" :id="k.id" avatar />
      <button v-if="g.items.length > LIMIT && !showAll[g.key]" class="btn btn-ghost btn-sm" @click="showAll[g.key] = true">Показать все</button>
    </div>
  </div>
</template>
