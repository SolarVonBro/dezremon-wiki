<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { imageUrl } from '@/data/images'
import { cropStyle, type ImageCrop } from '@/data/crop'

const props = withDefaults(defineProps<{ id: string | null | undefined; variant?: 'thumb' | 'full'; alt?: string; fallback?: string; crop?: ImageCrop | null }>(), { variant: 'thumb', alt: '', crop: null })
const world = useWorld()
const url = ref<string | null>(null)
const failed = ref(false)
const style = computed(() => cropStyle(props.crop))

watch(() => [props.id, props.variant, world.wid], async () => {
  url.value = null
  failed.value = false
  if (!props.id) return
  try { url.value = await imageUrl(world.access, props.id, props.variant) } catch { failed.value = true }
}, { immediate: true })
</script>

<template>
  <img v-if="url" :src="url" :alt="alt" :style="style" loading="lazy" draggable="false" />
  <span v-else class="thumb-empty" :class="{ failed }"><slot>{{ fallback }}</slot></span>
</template>
