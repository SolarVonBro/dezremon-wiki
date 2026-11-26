<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSession, type ThemeMode } from '@/stores/session'
import { useWorld } from '@/stores/world'
import { isServiceAdmin } from '@/data/admin'
import { isMasterRole } from '@/data/access'
import { activeWorldTheme } from '@/themes/apply'
import { designById } from '@/themes/designs'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'

// The portrait button at the right end of the app bar (AppBar) on every page. The sections of the service are
// in the bar itself; this menu is about the person: the cabinet, the theme, signing out.
// `compact` shows only the portrait; the full variant adds the name next to it.
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: true })
const session = useSession()
const world = useWorld()
const router = useRouter()
const THEMES: Array<{ v: ThemeMode; label: string; icon: string }> = [
  { v: 'auto', label: 'Как в системе', icon: 'sliders-horizontal' },
  { v: 'dark', label: 'Тёмная', icon: 'moon' },
  { v: 'light', label: 'Светлая', icon: 'sun' },
]
const canSwitchAdmin = computed(() => !!world.wid && world.status === 'ready' && isServiceAdmin(session.user?.uid) && !world.adminView && !!world.member && !isMasterRole(world.member.role))
async function logout() { await session.signOut(); world.close(); void router.push('/') }
</script>

<template>
  <Dropdown placement="bottom-end">
    <template #trigger>
      <button class="btn btn-ghost user-btn" :title="session.user ? session.displayName() : 'Гость'">
        <span class="avatar round user-ava">
          <img v-if="session.photo" :src="session.photo" alt="" referrerpolicy="no-referrer" />
          <Icon v-else name="user" :size="16" />
        </span>
        <span v-if="!props.compact" class="ellipsis small">{{ session.user ? session.displayName() : 'Гость' }}</span>
      </button>
    </template>
    <div class="menu">
      <template v-if="session.user">
        <div class="menu-label">{{ session.displayName() }}</div>
        <RouterLink class="menu-item" :to="{ name: 'user', params: { uid: session.user.uid } }"><Icon name="user" :size="15" /> Личный кабинет</RouterLink>
        <RouterLink class="menu-item" :to="{ name: 'user', params: { uid: session.user.uid }, query: { tab: 'security' } }"><Icon name="key-round" :size="15" /> Вход и безопасность</RouterLink>
        <div class="menu-sep" />
      </template>
      <template v-if="canSwitchAdmin">
        <div class="menu-label">Администратор сервиса</div>
        <button class="menu-item" @click="world.setAdminMode('view')"><Icon name="eye" :size="15" /> Просмотр (админ)</button>
        <button class="menu-item" @click="world.setAdminMode('edit')"><Icon name="pencil" :size="15" /> Редактирование (админ)</button>
        <div class="menu-sep" />
      </template>
      <div class="menu-label">Тема оформления</div>
      <div v-if="activeWorldTheme" class="menu-note">В этом мире действует тема мира «{{ designById(activeWorldTheme)?.name }}» — ваша тема вернётся за его пределами.</div>
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
.menu-note { max-width: 240px; padding: 2px 10px 6px; font-size: 12.5px; line-height: 1.35; color: var(--text-muted); }
</style>
