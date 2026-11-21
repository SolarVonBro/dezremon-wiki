<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSession, type ThemeMode } from '@/stores/session'
import { useWorld } from '@/stores/world'
import { isServiceAdmin } from '@/data/admin'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'

// The portrait button lives in the top bar on every level (hub pages and inside a world).
// `compact` shows only the portrait; the full variant adds the name next to it.
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: true })
const session = useSession()
const world = useWorld()
const router = useRouter()
const hasRooms = router.hasRoute('rooms')
const admin = computed(() => isServiceAdmin(session.user?.uid))
const THEMES: Array<{ v: ThemeMode; label: string; icon: string }> = [
  { v: 'auto', label: 'Как в системе', icon: 'sliders-horizontal' },
  { v: 'dark', label: 'Тёмная', icon: 'moon' },
  { v: 'light', label: 'Светлая', icon: 'sun' },
  { v: 'parchment', label: 'Пергамент', icon: 'scroll' },
]
async function logout() { await session.signOut(); world.close(); void router.push('/') }
</script>

<template>
  <Dropdown placement="bottom-end">
    <template #trigger>
      <button class="btn btn-ghost user-btn" :title="session.user ? session.displayName() : 'Гость'">
        <span class="avatar round user-ava">
          <img v-if="session.user?.photoURL" :src="session.user.photoURL" alt="" referrerpolicy="no-referrer" />
          <Icon v-else name="user" :size="16" />
        </span>
        <span v-if="!props.compact" class="ellipsis small">{{ session.user ? session.displayName() : 'Гость' }}</span>
      </button>
    </template>
    <div class="menu">
      <template v-if="session.user">
        <div class="menu-label">{{ session.displayName() }}</div>
        <RouterLink class="menu-item" :to="{ name: 'account', query: { tab: 'profile' } }"><Icon name="user" :size="15" /> Личный кабинет</RouterLink>
        <RouterLink class="menu-item" :to="{ name: 'account' }"><Icon name="globe" :size="15" /> Миры</RouterLink>
        <RouterLink class="menu-item" :to="{ name: 'campaigns' }"><Icon name="swords" :size="15" /> Кампейны</RouterLink>
        <RouterLink v-if="hasRooms" class="menu-item" :to="{ name: 'rooms' }"><Icon name="headphones" :size="15" /> Музыкальные комнаты</RouterLink>
        <RouterLink v-if="admin" class="menu-item" :to="{ name: 'admin' }"><Icon name="shield-check" :size="15" /> Админка сервиса</RouterLink>
        <div class="menu-sep" />
      </template>
      <div class="menu-label">Тема оформления</div>
      <button v-for="t in THEMES" :key="t.v" class="menu-item" :class="{ on: session.theme === t.v }" @click="session.theme = t.v"><Icon :name="t.icon" :size="15" /> {{ t.label }}</button>
      <div class="menu-sep" />
      <button v-if="session.user" class="menu-item" @click="logout"><Icon name="log-out" :size="15" /> Выйти</button>
      <RouterLink v-else class="menu-item" :to="{ name: 'login', query: { next: $route.fullPath } }"><Icon name="log-in" :size="15" /> Войти</RouterLink>
    </div>
  </Dropdown>
</template>

<style scoped>
.user-btn { padding: 3px 5px; gap: 8px; max-width: 220px; border-radius: 999px; }
.user-ava { width: 30px; height: 30px; }
</style>
