<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import EntityLink from '@/components/common/EntityLink.vue'
import type { Entity } from '@/model/types'

const props = defineProps<{ entity: Entity }>()
const world = useWorld()
const list = computed(() => world.backlinks.get(props.entity.id) ?? [])
const all = ref(false)
</script>

<template>
  <div v-if="list.length" class="card card-pad">
    <div class="section-title">Упоминается в ({{ list.length }})</div>
    <div class="stack-sm">
      <EntityLink v-for="e in (all ? list : list.slice(0, 15))" :key="e.id" :id="e.id" />
      <button v-if="list.length > 15 && !all" class="btn btn-ghost btn-sm" @click="all = true">Показать все</button>
    </div>
  </div>
</template>
