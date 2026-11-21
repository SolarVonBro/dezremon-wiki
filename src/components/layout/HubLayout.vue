<script setup lang="ts">
// The level above worlds: personal cabinet (worlds), campaigns, music rooms and the service admin.
// One top bar for all of them, with the user's portrait on the right.
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { isServiceAdmin } from '@/data/admin'
import Icon from '@/components/common/Icon.vue'
import UserMenu from './UserMenu.vue'
import BanBanner from './BanBanner.vue'

const logo = import.meta.env.BASE_URL + 'favicon.svg'
const route = useRoute()
const hasRooms = useRouter().hasRoute('rooms')
const session = useSession()
const admin = computed(() => isServiceAdmin(session.user?.uid))
const section = computed(() => {
  const n = String(route.name ?? '')
  if (n === 'campaigns' || n === 'campaign' || n === 'campaignJoin') return 'campaigns'
  if (n === 'rooms' || n === 'room') return 'rooms'
  if (n === 'admin') return 'admin'
  if (n === 'account' && route.query.tab && route.query.tab !== 'worlds' && route.query.tab !== 'requests') return 'profile'
  return 'worlds'
})
</script>

<template>
  <div class="hub">
    <header class="hub-top">
      <RouterLink :to="{ name: 'account' }" class="hub-brand"><img :src="logo" alt="" /><span class="hide-sm">Вики сеттинга</span></RouterLink>
      <nav class="hub-nav">
        <RouterLink :to="{ name: 'account' }" :class="{ on: section === 'worlds' }"><Icon name="globe" :size="16" /> Миры</RouterLink>
        <RouterLink :to="{ name: 'campaigns' }" :class="{ on: section === 'campaigns' }"><Icon name="swords" :size="16" /> Кампейны</RouterLink>
        <RouterLink v-if="hasRooms" :to="{ name: 'rooms' }" :class="{ on: section === 'rooms' }"><Icon name="headphones" :size="16" /> Комнаты</RouterLink>
        <RouterLink v-if="admin" :to="{ name: 'admin' }" :class="{ on: section === 'admin' }"><Icon name="shield-check" :size="16" /> Админка</RouterLink>
      </nav>
      <span class="grow" />
      <UserMenu v-if="session.user" />
      <RouterLink v-else-if="session.ready" class="btn btn-primary btn-sm" :to="{ name: 'login', query: { next: route.fullPath } }"><Icon name="log-in" :size="15" /> Войти</RouterLink>
    </header>
    <BanBanner />
    <RouterView v-slot="{ Component }">
      <component :is="Component" :key="String(route.name) + (route.params.cid ?? route.params.rid ?? '')" />
    </RouterView>
  </div>
</template>

<style scoped>
.hub { min-height: 100vh; background: radial-gradient(ellipse at 15% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 50%), var(--bg); }
.hub-top {
  position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 14px; height: var(--topbar-h); padding: 0 20px;
  background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border);
}
.hub-brand { display: flex; align-items: center; gap: 10px; font: 700 21px var(--font-head); color: var(--text); text-decoration: none !important; flex-shrink: 0; }
.hub-brand img { width: 32px; height: 32px; }
.hub-nav { display: flex; align-items: center; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.hub-nav a { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px; color: var(--text-muted); font-weight: 500; font-size: 14.5px; white-space: nowrap; text-decoration: none !important; }
.hub-nav a:hover { background: var(--surface-2); color: var(--text); }
.hub-nav a.on { background: var(--accent-soft); color: var(--text); }
@media (max-width: 860px) {
  .hub-top { padding: 0 10px; gap: 6px; }
  .hub-nav a { padding: 7px 9px; font-size: 13.5px; gap: 5px; }
}
@media (max-width: 520px) {
  .hub-nav a .icon { display: none; }
  .hub-nav a { padding: 6px 7px; }
}
</style>
