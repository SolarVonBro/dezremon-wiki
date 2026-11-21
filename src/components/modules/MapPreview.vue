<script setup lang="ts">
// Static thumbnail of a map entity for lists and cards. With `markers` it also loads the marker rows once
// and draws them as dots (only when the map size is known, so positions are exact).
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import { DEFAULT_COLOUR, centroid, normMarker, safeColour } from './map/mapUtils'
import type { Entity, MapMarker } from '@/model/types'

const props = withDefaults(defineProps<{ entity: Entity; markers?: boolean }>(), { markers: false })
const world = useWorld()

const imageId = computed<string | null>(() => props.entity.fields?.mapImageId || props.entity.imageId || null)
const size = computed(() => {
  const f = props.entity.fields ?? {}
  const w = Number(f.mapWidth ?? f.width), h = Number(f.mapHeight ?? f.height)
  return w > 0 && h > 0 ? { w, h } : null
})
const aspect = computed(() => (size.value ? `${size.value.w} / ${size.value.h}` : '4 / 3'))

const rows = ref<MapMarker[]>([])
let token = 0
watch(() => [props.markers, props.entity.id, world.wid], async () => {
  const t = ++token
  if (!props.markers || !world.wid) { rows.value = []; return }
  const list = await world.fetchRows<MapMarker>('mapMarkers', 'mapId', props.entity.id).catch(() => [])
  if (t === token) rows.value = list.map(normMarker)
}, { immediate: true })

const dots = computed(() => {
  const s = size.value
  if (!s) return []
  return rows.value.map((m) => {
    const p = m.shape === 'polygon' && m.points.length >= 3 ? centroid(m.points) : { lat: m.lat, lng: m.lng }
    return { id: m.id, x: (p.lng / s.w) * 100, y: (1 - p.lat / s.h) * 100, c: safeColour(m.colour, DEFAULT_COLOUR) }
  }).filter((d) => d.x >= 0 && d.x <= 100 && d.y >= 0 && d.y <= 100)
})
</script>

<template>
  <div class="map-prev" :class="{ exact: !!size }" :style="{ aspectRatio: aspect }" :title="entity.name">
    <Thumb v-if="imageId" :id="imageId" class="map-prev-img" :alt="entity.name"><Icon name="map" :size="28" /></Thumb>
    <span v-else class="map-prev-empty"><Icon name="map" :size="28" /></span>
    <span v-for="d in dots" :key="d.id" class="map-prev-dot" :style="{ left: d.x + '%', top: d.y + '%', background: d.c }" />
  </div>
</template>

<style scoped>
.map-prev { position: relative; width: 100%; overflow: hidden; border-radius: var(--radius-sm); background: var(--surface-3); border: 1px solid var(--border); }
.map-prev-img, .map-prev-empty { position: absolute; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-faint); }
img.map-prev-img { object-fit: cover; }
.exact img.map-prev-img { object-fit: fill; }
.map-prev-dot { position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; border: 1px solid rgb(255 255 255 / 85%); box-shadow: 0 0 2px rgb(0 0 0 / 60%); pointer-events: none; }
</style>
