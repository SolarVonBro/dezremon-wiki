<script setup lang="ts">
import { computed } from 'vue'
import { iconComponent } from './icons'

const props = withDefaults(defineProps<{ name: string; size?: number | string; stroke?: number }>(), { size: 18, stroke: 1.9 })
const comp = computed(() => iconComponent(props.name))
</script>

<template>
  <component :is="comp" :size="size" :stroke-width="stroke" class="icon" aria-hidden="true" />
</template>
