<script setup lang="ts">
import { ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { imageUrl } from '@/data/images'

const props = withDefaults(defineProps<{ id: string | null | undefined; variant?: 'thumb' | 'full'; alt?: string; fallback?: string }>(), { variant: 'thumb', alt: '' })
const world = useWorld()
const url = ref<string | null>(null)
const failed = ref(false)

watch(() => [props.id, props.variant, world.wid], async () => {
  url.value = null
  failed.value = false
  if (!props.id) return
  try { url.value = await imageUrl(world.access, props.id, props.variant) } catch { failed.value = true }
}, { immediate: true })
</script>

<template>
  <img v-if="url" :src="url" :alt="alt" loading="lazy" draggable="false" />
  <span v-else class="thumb-empty" :class="{ failed }"><slot>{{ fallback }}</slot></span>
</template>
