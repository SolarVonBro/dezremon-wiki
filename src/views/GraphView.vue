<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import Icon from '@/components/common/Icon.vue'
import { useWorld } from '@/stores/world'

const RelationsGraph = defineAsyncComponent(() => import('@/components/modules/RelationsGraph.vue'))
const world = useWorld()
</script>

<template>
  <Teleport defer to="#crumbs"><span style="color: var(--text)">Граф связей</span></Teleport>
  <div class="content">
    <div class="page-head"><Icon name="network" :size="28" /><h1 class="grow">Граф связей</h1><span class="muted small">{{ world.visibleRelations.length }} связей</span></div>
    <RelationsGraph height="calc(100vh - 190px)" />
  </div>
</template>
