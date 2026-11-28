<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { imageUrl, peekImageUrl } from '@/data/images'
import { cropStyle, isZoomedCrop, type ImageCrop } from '@/data/crop'

const props = withDefaults(defineProps<{ id: string | null | undefined; variant?: 'thumb' | 'full'; alt?: string; fallback?: string; crop?: ImageCrop | null }>(), { variant: 'thumb', alt: '', crop: null })
const world = useWorld()
const url = ref<string | null>(null)
const failed = ref(false)
const style = computed(() => cropStyle(props.crop))
// Zoomed framing magnifies a slice of the image: always use the full-size image so it stays sharp.
const effectiveVariant = computed<'thumb' | 'full'>(() => (props.variant === 'full' || isZoomedCrop(props.crop) ? 'full' : 'thumb'))

let req = 0
let loadedKey = ''
watch([() => props.id, effectiveVariant, () => world.wid], async ([id, variant, wid]) => {
  const token = ++req
  failed.value = false
  if (!id || !wid) { url.value = null; loadedKey = ''; return }
  const key = `${wid}/${id}`
  const cached = peekImageUrl(wid, id, variant)
  if (cached) { url.value = cached; loadedKey = key; return }
  // When switching to a different image, drop the previous one immediately (show cached thumb while full loads if available).
  if (loadedKey !== key) {
    url.value = variant === 'full' ? peekImageUrl(wid, id, 'thumb') : null
    loadedKey = key
  }
  try {
    const next = await imageUrl(world.access, id, variant)
    if (token === req) url.value = next
  } catch {
    if (token === req) { if (!url.value) failed.value = true }
  }
}, { immediate: true })
</script>

<template>
  <img v-if="url" :src="url" :alt="alt" :style="style" loading="lazy" draggable="false" />
  <span v-else class="thumb-empty" :class="{ failed }"><slot>{{ fallback }}</slot></span>
</template>
