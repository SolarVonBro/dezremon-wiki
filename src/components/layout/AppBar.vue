<script setup lang="ts">
// The one top bar of the whole app — on the hub pages and inside a world alike: brand, the sections of the
// service (worlds, campaigns, music rooms, admin) and the user's portrait. Inside a world it also carries the
// world's breadcrumbs (slot `context`) and actions (slot `actions`).
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { isServiceAdmin } from '@/data/admin'
import Icon from '@/components/common/Icon.vue'
import UserMenu from './UserMenu.vue'

const props = withDefaults(defineProps<{ inWorld?: boolean }>(), { inWorld: false })
const emit = defineEmits<{ menu: [] }>()
const logo = import.meta.env.BASE_URL + 'favicon.svg'
const route = useRoute()
const router = useRouter()
const session = useSession()

type Section = 'worlds' | 'campaigns' | 'rooms' | 'admin'
const section = computed<Section | null>(() => {
  const n = String(route.name ?? '')
  if (props.inWorld || n === 'worlds') return 'worlds'
  if (n === 'campaigns' || n === 'campaign' || n === 'campaignJoin') return 'campaigns'
  if (n === 'rooms' || n === 'room') return 'rooms'
  if (n === 'admin') return 'admin'
  return null
})
const sections = computed(() => [
  { key: 'worlds', label: 'Миры', icon: 'globe', to: { name: 'worlds' } },
  { key: 'campaigns', label: 'Игры', icon: 'swords', to: { name: 'campaigns' } },
  ...(router.hasRoute('rooms') ? [{ key: 'rooms', label: 'Комнаты', icon: 'headphones', to: { name: 'rooms' } }] : []),
  ...(isServiceAdmin(session.user?.uid) ? [{ key: 'admin', label: 'Админка', icon: 'shield-check', to: { name: 'admin' } }] : []),
])
</script>

<template>
  <header class="topbar app-bar" :class="{ 'in-world': inWorld }">
    <button v-if="inWorld" class="icon-btn mobile-only" title="Меню мира" @click="emit('menu')"><Icon name="menu" /></button>
    <RouterLink :to="session.user ? { name: 'worlds' } : '/'" class="ab-brand" title="Вики сеттинга — все миры">
      <img :src="logo" alt="" /><span class="ab-brand-text">Вики сеттинга</span>
    </RouterLink>
    <!-- active-class off: the section is decided by `section` (a world page belongs to «Миры») -->
    <nav v-if="session.user" class="app-nav" aria-label="Разделы">
      <RouterLink v-for="s in sections" :key="s.key" :to="s.to" :class="{ on: section === s.key }" :title="s.label" active-class="" exact-active-class="">
        <Icon :name="s.icon" :size="16" /><span class="ab-label">{{ s.label }}</span>
      </RouterLink>
    </nav>
    <template v-if="inWorld">
      <span class="ab-sep" />
      <slot name="context" />
    </template>
    <span v-else class="grow" />
    <slot name="actions" />
    <UserMenu v-if="session.user" />
    <RouterLink v-else-if="session.ready" class="btn btn-primary btn-sm" :to="{ name: 'login', query: { next: route.fullPath } }"><Icon name="log-in" :size="15" /> Войти</RouterLink>
  </header>
</template>

<style scoped>
.app-bar { gap: 8px; }
.ab-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; font: 700 20px var(--font-head); color: var(--text); text-decoration: none !important; white-space: nowrap; }
.ab-brand img { width: 30px; height: 30px; }
/* inside a world the brand is as wide as the sidebar, so the sections start over the page column */
.in-world .ab-brand { width: calc(var(--sidebar-w) - 28px); }
/* never wider than the screen: on the narrowest phones the sections scroll sideways instead of the page */
.app-nav { display: flex; align-items: center; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.app-nav::-webkit-scrollbar { display: none; }
.app-nav a { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 8px; color: var(--text-muted); font-weight: 500; font-size: 14.5px; white-space: nowrap; text-decoration: none !important; }
.app-nav a:hover { background: var(--surface-2); color: var(--text); }
.app-nav a.on { background: var(--accent-soft); color: var(--text); }
.app-nav a.on .icon { color: var(--accent); }
.ab-sep { width: 1px; height: 24px; background: var(--border); flex-shrink: 0; margin: 0 6px; }

/* a world page needs room for its breadcrumbs: the section names shrink to icons first */
@media (max-width: 1280px) {
  .in-world .ab-brand { width: auto; }
  .in-world .ab-brand-text { display: none; }
}
@media (max-width: 1100px) {
  .in-world .ab-label { display: none; }
  .in-world .app-nav a { padding: 7px 9px; }
}
@media (max-width: 860px) {
  .ab-brand-text { display: none; }
  .app-nav a { padding: 7px 9px; font-size: 13.5px; gap: 5px; }
  .ab-sep { margin: 0 2px; }
}
@media (max-width: 600px) {
  .in-world .ab-brand { display: none; }
  .in-world .ab-sep { display: none; }
  .app-nav a { padding: 6px 7px; }
}
@media (max-width: 420px) {
  .app-bar { gap: 4px; }
  .app-nav { gap: 0; }
  .app-nav a { padding: 6px 6px; font-size: 13px; }
  .app-nav a .icon { display: none; }
  .in-world .app-nav a .icon { display: inline-flex; }
}
</style>
