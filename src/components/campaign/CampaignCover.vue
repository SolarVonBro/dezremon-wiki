<script setup lang="ts">
// Campaign cover: the uploaded image, or a gradient tinted by the campaign name with its initials.
import { computed } from 'vue'
import type { Campaign } from '@/model/types'

const props = defineProps<{ campaign: Pick<Campaign, 'name' | 'cover'> }>()
const hue = computed(() => [...props.campaign.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 17))
const initials = computed(() => props.campaign.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase())
</script>

<template>
  <div class="ccover" :style="campaign.cover ? undefined : { '--h': hue }">
    <img v-if="campaign.cover" :src="campaign.cover" alt="" />
    <span v-else>{{ initials }}</span>
  </div>
</template>

<style scoped>
.ccover {
  display: flex; align-items: center; justify-content: center; overflow: hidden;
  background: linear-gradient(135deg, hsl(var(--h, 40) 45% 32%), hsl(calc(var(--h, 40) + 40) 40% 18%));
  color: rgb(255 255 255 / 85%); font: 700 38px var(--font-head); letter-spacing: .04em;
}
.ccover img { width: 100%; height: 100%; object-fit: cover; }
</style>
