<script setup lang="ts">
// The level above worlds: the worlds list, campaigns, music rooms, the personal cabinet and the service admin.
// The top bar is the same AppBar the world pages use, so moving between sections never changes the menu.
import { useRoute } from 'vue-router'
import AppBar from './AppBar.vue'
import BanBanner from './BanBanner.vue'

const route = useRoute()
</script>

<template>
  <div class="hub">
    <AppBar />
    <BanBanner />
    <RouterView v-slot="{ Component }">
      <component :is="Component" :key="String(route.name) + (route.params.cid ?? route.params.rid ?? '')" />
    </RouterView>
  </div>
</template>

<style scoped>
.hub { min-height: 100vh; background: radial-gradient(ellipse at 15% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 50%), var(--bg); }
</style>
