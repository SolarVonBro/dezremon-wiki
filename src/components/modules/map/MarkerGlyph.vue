<script setup lang="ts">
// Small swatch of a marker's look (shape, colour, icon) for the marker list and the legend.
import { computed } from 'vue'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import { cropOf } from '@/data/crop'
import { DEFAULT_COLOUR, DEFAULT_FONT, resolveIcon, safeColour } from './mapUtils'
import type { Entity, MapMarker } from '@/model/types'

const props = defineProps<{ marker: Pick<MapMarker, 'shape' | 'icon' | 'colour' | 'fontColour'>; entity?: Entity | null }>()

const colour = computed(() => safeColour(props.marker.colour, DEFAULT_COLOUR))
const fg = computed(() => safeColour(props.marker.fontColour, DEFAULT_FONT))
const ic = computed(() => resolveIcon(props.marker.icon))
const entityImage = computed(() => (ic.value.kind === 'entity' ? props.entity?.imageId ?? null : null))
</script>

<template>
  <span class="mg" :class="'mg-' + marker.shape" :style="{ '--mg': colour, '--mg-fg': fg }" aria-hidden="true">
    <template v-if="marker.shape === 'marker'">
      <Thumb v-if="entityImage" :id="entityImage" :crop="cropOf(entity)" class="mg-img" />
      <Icon v-else-if="ic.kind === 'icon'" :name="ic.name" :size="12" :stroke="2.4" />
      <i v-else class="mg-dot" />
    </template>
    <Icon v-else-if="marker.shape === 'label'" name="type" :size="12" :stroke="2.4" />
  </span>
</template>

<style scoped>
.mg { width: 20px; height: 20px; flex: 0 0 20px; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; }
.mg-marker { border-radius: 50%; background: var(--mg); color: var(--mg-fg); box-shadow: 0 0 0 1px rgb(0 0 0 / 18%) inset; }
.mg-label { border-radius: 4px; background: var(--mg); color: var(--mg-fg); }
.mg-circle { border-radius: 50%; border: 2px solid var(--mg); background: color-mix(in srgb, var(--mg) 30%, transparent); }
.mg-polygon { background: var(--mg); clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%); opacity: .8; }
.mg-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--mg-fg); }
.mg-img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
