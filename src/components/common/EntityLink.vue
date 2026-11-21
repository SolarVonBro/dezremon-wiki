<script setup lang="ts">
import { computed } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import Icon from './Icon.vue'
import Thumb from './Thumb.vue'
import { showPreview, hidePreview } from '@/components/viewer/preview'

const props = withDefaults(defineProps<{ id: string | null | undefined; avatar?: boolean; icon?: boolean; fallback?: string }>(), { avatar: false, icon: true, fallback: '' })
const world = useWorld()
const e = computed(() => world.get(props.id ?? null))
let t: ReturnType<typeof setTimeout> | null = null
function over(ev: MouseEvent) { if (t) clearTimeout(t); const el = ev.currentTarget as HTMLElement; t = setTimeout(() => e.value && showPreview(el, e.value.id), 400) }
function out() { if (t) clearTimeout(t); hidePreview(200) }
</script>

<template>
  <RouterLink v-if="e" class="entity-link" :to="{ name: 'entity', params: { wid: world.wid!, eid: e.id } }" @mouseenter="over" @mouseleave="out" @click="out">
    <span v-if="avatar" class="avatar el-avatar"><Thumb :id="e.imageId"><Icon :name="typeDef(e.type).icon" :size="14" /></Thumb></span>
    <Icon v-else-if="icon" :name="typeDef(e.type).icon" :size="14" :style="{ color: typeDef(e.type).color }" />
    <span class="el-name">{{ e.name }}</span>
  </RouterLink>
  <span v-else-if="fallback || id" class="entity-link missing">{{ fallback || 'скрыто' }}</span>
</template>

<style scoped>
.entity-link { display: inline-flex; align-items: center; gap: 5px; color: var(--text); font-weight: 500; max-width: 100%; }
.entity-link:hover { color: var(--accent); text-decoration: none; }
.el-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.el-avatar { width: 26px; height: 26px; border-radius: 6px; }
.missing { color: var(--text-faint); font-style: italic; }
</style>
