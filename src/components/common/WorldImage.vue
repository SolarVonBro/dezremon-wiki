<script setup lang="ts">
import { ref, watch } from 'vue'
import { imageUrl } from '@/data/images'
import type { Role } from '@/model/types'

// Image of a world shown outside of that world (personal cabinet): access is built from the membership.
const props = defineProps<{ wid: string; imageId: string | null | undefined; uid: string | null; role: Role | null; variant?: 'thumb' | 'full' }>()
const url = ref<string | null>(null)
watch(() => [props.wid, props.imageId], async () => {
  url.value = null
  if (!props.imageId) return
  try { url.value = await imageUrl({ wid: props.wid, uid: props.uid, role: props.role }, props.imageId, props.variant ?? 'thumb') } catch { /* hidden or missing */ }
}, { immediate: true })
</script>

<template>
  <img v-if="url" :src="url" alt="" loading="lazy" draggable="false" />
  <slot v-else />
</template>
