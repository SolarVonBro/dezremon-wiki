<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { imageUrl, peekImageUrl } from '@/data/images'
import { cropStyle, isZoomedCrop, type ImageCrop } from '@/data/crop'
import type { Role } from '@/model/types'

// Image of a world shown outside of that world (personal cabinet): access is built from the membership.
const props = defineProps<{ wid: string; imageId: string | null | undefined; uid: string | null; role: Role | null; variant?: 'thumb' | 'full'; crop?: ImageCrop | null }>()
const url = ref<string | null>(null)
const style = computed(() => cropStyle(props.crop))
const effectiveVariant = computed<'thumb' | 'full'>(() => (props.variant === 'full' || isZoomedCrop(props.crop) ? 'full' : 'thumb'))

let req = 0
let loadedKey = ''
watch([() => props.wid, () => props.imageId, effectiveVariant], async ([wid, imageId, variant]) => {
  const token = ++req
  if (!wid || !imageId) { url.value = null; loadedKey = ''; return }
  const key = `${wid}/${imageId}`
  const cached = peekImageUrl(wid, imageId, variant)
  if (cached) { url.value = cached; loadedKey = key; return }
  if (loadedKey !== key) {
    url.value = variant === 'full' ? peekImageUrl(wid, imageId, 'thumb') : null
    loadedKey = key
  }
  try {
    const next = await imageUrl({ wid, uid: props.uid, role: props.role }, imageId, variant)
    if (token === req) url.value = next
  } catch { /* hidden or missing */ }
}, { immediate: true })
</script>

<template>
  <img v-if="url" :src="url" alt="" :style="style" loading="lazy" draggable="false" />
  <slot v-else />
</template>
