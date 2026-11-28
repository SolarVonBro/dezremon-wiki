<script setup lang="ts">
// A game's cover: its picture framed by coverCrop (the full-size image of the world with `hires` or whenever zoomed,
// the small copy elsewhere), or a gradient tinted by the name with its initials.
import { computed } from 'vue'
import { cropStyle, isZoomedCrop } from '@/data/crop'
import { useWorld } from '@/stores/world'
import Thumb from '@/components/common/Thumb.vue'
import WorldImage from '@/components/common/WorldImage.vue'
import type { Campaign } from '@/model/types'

const props = defineProps<{ campaign: Pick<Campaign, 'name' | 'cover'> & Partial<Pick<Campaign, 'worldId' | 'coverImageId' | 'coverCrop'>>; hires?: boolean }>()
const world = useWorld()
const hue = computed(() => [...props.campaign.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 17))
const initials = computed(() => props.campaign.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase())
const wantFull = computed(() => !!props.campaign.coverImageId && (props.hires || isZoomedCrop(props.campaign.coverCrop)))
const inCurrentWorld = computed(() => !!world.wid && (!props.campaign.worldId || world.wid === props.campaign.worldId))
const has = computed(() => !!props.campaign.cover || (wantFull.value && (inCurrentWorld.value || !!props.campaign.worldId)))
const style = computed(() => cropStyle(props.campaign.coverCrop ?? null))
</script>

<template>
  <div class="ccover" :style="has ? undefined : { '--h': hue }">
    <Thumb v-if="wantFull && inCurrentWorld" :id="campaign.coverImageId" variant="full" :crop="campaign.coverCrop ?? null">
      <img v-if="campaign.cover" :src="campaign.cover" alt="" :style="style" />
    </Thumb>
    <WorldImage v-else-if="wantFull && campaign.worldId" :wid="campaign.worldId" :image-id="campaign.coverImageId" :uid="null" :role="null" variant="full" :crop="campaign.coverCrop ?? null">
      <img v-if="campaign.cover" :src="campaign.cover" alt="" :style="style" />
    </WorldImage>
    <img v-else-if="campaign.cover" :src="campaign.cover" alt="" :style="style" />
    <span v-else>{{ initials }}</span>
  </div>
</template>

<style scoped>
.ccover {
  display: flex; align-items: center; justify-content: center; overflow: hidden;
  background: linear-gradient(135deg, hsl(var(--h, 40) 45% 32%), hsl(calc(var(--h, 40) + 40) 40% 18%));
  color: rgb(255 255 255 / 85%); font: 700 38px var(--font-head); letter-spacing: .04em;
}
.ccover img, .ccover :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.ccover :deep(.thumb-empty) { width: 100%; height: 100%; display: flex; }
</style>
