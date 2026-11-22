<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { useSession } from '@/stores/session'
import { allTypes } from '@/model/entityTypes'
import { formatDate } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import QuickSearch from '@/components/layout/QuickSearch.vue'
import CreateEntityModal from '@/components/layout/CreateEntityModal.vue'
import AppBar from '@/components/layout/AppBar.vue'
import BookmarksNav from '@/components/layout/BookmarksNav.vue'
import WorldCampaignsNav from '@/components/layout/WorldCampaignsNav.vue'
import BanBanner from '@/components/layout/BanBanner.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import JoinBanner from '@/components/layout/JoinBanner.vue'
import { createRequest } from '@/components/layout/createRequest'
import { unsavedEditors } from '@/composables/useAutosave'

const route = useRoute()
const router = useRouter()
const world = useWorld()
const session = useSession()
const sidebarOpen = ref(false)
const online = ref(navigator.onLine)

watch(() => route.params.wid as string, (wid) => { if (wid) void world.open(wid) }, { immediate: true })
watch(() => route.fullPath, () => { sidebarOpen.value = false })

const types = computed(() => allTypes().filter((t) => world.enabledTypes(t.key)))
const counts = computed(() => {
  const m: Record<string, number> = {}
  for (const [k, v] of world.byType) m[k] = v.length
  return m
})
const roleLabel = computed(() => (world.adminView ? 'Администратор сервиса' : ({ owner: 'Владелец', master: 'Мастер', player: 'Игрок' } as Record<string, string>)[world.role ?? ''] ?? 'Гость'))

const saveState = computed(() => {
  if (!online.value) return { cls: 'offline', text: 'Нет сети — изменения сохранятся позже', icon: 'wifi-off' }
  if (world.pendingWrites > 0 || unsavedEditors.value > 0) return { cls: 'saving', text: 'Сохранение…', icon: 'refresh-cw' }
  if (world.lastSavedAt) return { cls: '', text: 'Сохранено', icon: 'check' }
  return null
})

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  const typing = t?.closest('input, textarea, select, [contenteditable="true"]')
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !typing) {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('.sb-search input')?.focus()
  }
  if (!typing && e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && world.isMember) {
    e.preventDefault()
    createRequest.value = { type: null }
  }
}
const setOnline = () => (online.value = navigator.onLine)
onMounted(() => {
  document.addEventListener('keydown', onKey)
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
})
watch(() => world.world?.name, (n) => { document.title = n ? `${n} — вики` : 'Dezremon — вики' }, { immediate: true })
</script>

<template>
  <div v-if="world.status === 'denied'" class="landing">
    <div class="card auth-card center stack">
      <Icon name="lock" :size="40" />
      <h2>Нет доступа к миру</h2>
      <p class="muted">Мир не найден, закрыт для гостей, или у вас нет приглашения.</p>
      <JoinBanner v-if="session.user" :wid="route.params.wid as string" closed />
      <div class="row gap" style="justify-content: center">
        <RouterLink v-if="!session.user" class="btn btn-primary" :to="{ name: 'login', query: { next: route.fullPath } }">Войти</RouterLink>
        <RouterLink class="btn" to="/">На главную</RouterLink>
      </div>
    </div>
  </div>
  <div v-else-if="world.status === 'error'" class="landing">
    <div class="card auth-card center stack">
      <Icon name="triangle-alert" :size="40" />
      <h2>Ошибка загрузки</h2>
      <p class="muted small">{{ world.errorText }}</p>
      <button class="btn btn-primary" @click="world.close(); world.open(route.params.wid as string)">Повторить</button>
    </div>
  </div>
  <div v-else class="world-app">
    <!-- the same top bar as on the hub pages; the world adds its breadcrumbs and actions to it -->
    <AppBar in-world @menu="sidebarOpen = !sidebarOpen">
      <template #context><div id="crumbs" class="crumbs grow" /></template>
      <template #actions>
        <span v-if="saveState" class="save-state" :class="saveState.cls" :title="(world.lastSavedAt ? 'Последнее сохранение: ' + formatDate(world.lastSavedAt) : '') || saveState.text">
          <Icon :name="saveState.icon" :size="14" :class="{ spin: saveState.cls === 'saving' }" /><span class="hide-md"> {{ saveState.text }}</span>
        </span>
        <div id="topbar-actions" class="row gap-sm" />
        <Dropdown v-if="world.realMaster && !world.preview" placement="bottom-end">
          <template #trigger><button class="btn btn-ghost btn-sm" title="Посмотреть мир так, как его видят игроки или гости"><Icon name="eye" :size="15" /><span class="hide-md"> Глазами игрока</span></button></template>
          <div class="menu">
            <div class="menu-label">Показать мир так, как его видит…</div>
            <button class="menu-item" @click="world.startPreview({ uid: null, name: 'любой игрок' })"><Icon name="users" :size="15" /> Любой игрок</button>
            <button v-for="p in world.players" :key="p.uid" class="menu-item" @click="world.startPreview({ uid: p.uid, name: p.displayName })"><Icon name="user" :size="15" /> {{ p.displayName }}</button>
            <button v-if="world.world?.isPublic" class="menu-item" @click="world.startPreview({ uid: null, name: 'гость', guest: true })"><Icon name="globe" :size="15" /> Гость без входа</button>
          </div>
        </Dropdown>
      </template>
    </AppBar>
  <div class="shell">
    <div v-if="sidebarOpen" class="sb-backdrop" @click="sidebarOpen = false" />
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <RouterLink class="sb-world" :to="{ name: 'dashboard', params: { wid: world.wid ?? '' } }">
        <span class="sb-world-img"><Thumb :id="world.world?.imageId"><Icon name="castle" :size="22" /></Thumb></span>
        <span class="grow">
          <div class="sb-world-name ellipsis">{{ world.world?.name ?? 'Загрузка…' }}</div>
          <div class="sb-world-role">{{ roleLabel }}{{ world.world?.isPublic ? ' · открытый мир' : '' }}</div>
        </span>
      </RouterLink>
      <div class="sb-search"><QuickSearch /></div>
      <div v-if="world.isMember && !world.preview" class="sb-section" style="padding-top: 0">
        <button class="btn btn-primary" style="width: 100%" title="Создать статью (N)" @click="createRequest = { type: null }"><Icon name="plus" :size="16" /> Создать</button>
      </div>
      <nav class="sb-section">
        <RouterLink v-if="world.viewMember?.characterId && world.get(world.viewMember.characterId)" class="sb-link" :to="{ name: 'entity', params: { wid: world.wid ?? '', eid: world.viewMember.characterId } }"><Icon name="user" :size="17" style="color: var(--accent)" /> Мой персонаж</RouterLink>
        <RouterLink class="sb-link" :to="{ name: 'dashboard', params: { wid: world.wid ?? '' } }" active-class="" exact-active-class="active"><Icon name="layout-dashboard" :size="17" /> Обзор</RouterLink>
        <RouterLink class="sb-link" :to="{ name: 'search', params: { wid: world.wid ?? '' } }"><Icon name="text-search" :size="17" /> Поиск по текстам</RouterLink>
        <RouterLink class="sb-link" :to="{ name: 'graph', params: { wid: world.wid ?? '' } }"><Icon name="network" :size="17" /> Граф связей</RouterLink>
        <RouterLink class="sb-link" :to="{ name: 'gallery', params: { wid: world.wid ?? '' } }"><Icon name="images" :size="17" /> Галерея</RouterLink>
      </nav>
      <BookmarksNav />
      <WorldCampaignsNav />
      <nav class="sb-section">
        <div class="sb-section-title">Разделы</div>
        <RouterLink v-for="t in types" :key="t.key" class="sb-link" :style="{ '--sb-color': t.color }" :to="{ name: 'list', params: { wid: world.wid ?? '', type: t.key } }">
          <Icon :name="t.icon" :size="17" /> {{ t.plural }} <span class="count">{{ counts[t.key] || '' }}</span>
        </RouterLink>
      </nav>
      <nav v-if="world.isMaster" class="sb-section">
        <RouterLink class="sb-link" :to="{ name: 'settings', params: { wid: world.wid ?? '' } }"><Icon name="settings" :size="17" /> Настройки мира
          <span v-if="world.pendingRequestCount" class="sb-badge" title="Новые заявки на вступление">{{ world.pendingRequestCount }}</span>
        </RouterLink>
      </nav>
    </aside>

    <div class="main">
      <BanBanner />
      <JoinBanner v-if="world.status === 'ready' && !world.isMember && world.wid" :wid="world.wid" />
      <div v-if="world.adminView && world.status === 'ready'" class="preview-banner admin-banner">
        <Icon name="shield-check" :size="16" />
        <span class="grow">Вы в этом мире как <b>администратор сервиса</b> (не участник): видно и доступно всё, как мастеру. Действуйте аккуратно.</span>
      </div>
      <div v-if="world.preview" class="preview-banner">
        <Icon name="eye" :size="16" />
        <span class="grow">Вы смотрите на мир глазами: <b>{{ world.preview.name }}</b>. Скрытые статьи, разделы и секреты мастера не показываются, редактирование выключено.</span>
        <button class="btn btn-sm" @click="world.stopPreview()"><Icon name="x" :size="14" /> Выйти из просмотра</button>
      </div>
      <div v-if="world.status === 'loading'" class="content empty"><Icon name="refresh-cw" class="spin" :size="28" /><p>Загрузка мира…</p></div>
      <RouterView v-else v-slot="{ Component }">
        <component :is="Component" :key="route.params.eid ?? route.name" />
      </RouterView>
    </div>
    <CreateEntityModal v-if="createRequest" :initial-type="createRequest.type" :parent-id="createRequest.parentId" @close="createRequest = null" @created="(id) => { createRequest = null; router.push({ name: 'entity', params: { wid: world.wid!, eid: id }, query: { edit: '1' } }) }" />
  </div>
  </div>
</template>
