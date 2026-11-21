<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSession, type ThemeMode } from '@/stores/session'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'

const session = useSession()
const world = useWorld()
const router = useRouter()
const THEMES: Array<{ v: ThemeMode; label: string; icon: string }> = [
  { v: 'auto', label: 'Как в системе', icon: 'sliders-horizontal' },
  { v: 'dark', label: 'Тёмная', icon: 'moon' },
  { v: 'light', label: 'Светлая', icon: 'sun' },
  { v: 'parchment', label: 'Пергамент', icon: 'scroll' },
]
async function logout() { await session.signOut(); world.close(); void router.push('/') }
</script>

<template>
  <Dropdown placement="top-start">
    <template #trigger>
      <button class="btn btn-ghost" style="padding: 4px 6px; gap: 8px; max-width: 220px">
        <span class="avatar round" style="width: 28px; height: 28px">
          <img v-if="session.user?.photoURL" :src="session.user.photoURL" alt="" referrerpolicy="no-referrer" />
          <Icon v-else name="user" :size="16" />
        </span>
        <span class="ellipsis small">{{ session.user ? session.displayName() : 'Гость' }}</span>
      </button>
    </template>
    <div class="menu">
      <div class="menu-label">Тема оформления</div>
      <button v-for="t in THEMES" :key="t.v" class="menu-item" :class="{ on: session.theme === t.v }" @click="session.theme = t.v"><Icon :name="t.icon" :size="15" /> {{ t.label }}</button>
      <div class="menu-sep" />
      <RouterLink class="menu-item" to="/"><Icon name="globe" :size="15" /> Мои миры</RouterLink>
      <button v-if="session.user" class="menu-item" @click="logout"><Icon name="log-out" :size="15" /> Выйти</button>
      <RouterLink v-else class="menu-item" :to="{ name: 'login', query: { next: $route.fullPath } }"><Icon name="log-in" :size="15" /> Войти</RouterLink>
    </div>
  </Dropdown>
</template>
