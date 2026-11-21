<script setup lang="ts">
import { useSession } from '@/stores/session'
import { toasts } from '@/components/common/toast'

useSession()
</script>

<template>
  <RouterView />
  <div class="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>
