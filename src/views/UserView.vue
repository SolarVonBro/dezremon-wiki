<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSession } from '@/stores/session'
import { loadUserPage, type UserPage } from '@/data/profiles'
import { STATUS_LABELS, ROLE_LABELS } from '@/data/campaigns'
import { formatDate, plural, relativeTime } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import WorldImage from '@/components/common/WorldImage.vue'
import type { Role } from '@/model/types'

// A user's page: the public card and what the viewer shares with them — worlds (role, characters) and campaigns.
const route = useRoute()
const session = useSession()
const uid = computed(() => route.params.uid as string)
const me = computed(() => session.user?.uid ?? null)
const own = computed(() => !!me.value && me.value === uid.value)
const page = ref<UserPage | null>(null)
const loading = ref(true)
const ROLE: Record<Role, string> = { owner: 'Владелец', master: 'Мастер', player: 'Игрок' }

watch([uid, me, () => session.ready], async ([u]) => {
  if (!session.ready || !u) return
  loading.value = true
  page.value = null
  try { page.value = await loadUserPage(u, me.value) } finally { loading.value = false }
}, { immediate: true })
watch(() => page.value?.name, (n) => { document.title = `${n || 'Пользователь'} — Вики сеттинга` }, { immediate: true })

const characters = computed(() => (page.value?.worlds ?? []).flatMap((w) => w.characters.map((c) => ({ ...c, world: w }))))
const found = computed(() => !!page.value && (!!page.value.profile || page.value.worlds.length > 0))
</script>

<template>
  <div class="page user-page">
    <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
    <div v-else-if="!found" class="card empty">
      <Icon name="user" :size="34" />
      <p>Пользователь не найден{{ session.user ? ' или у вас нет общих миров' : '' }}.</p>
    </div>
    <template v-else-if="page">
      <div class="card card-pad u-head">
        <span class="avatar round u-ava"><img v-if="page.photoURL" :src="page.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="30" /></span>
        <div class="grow">
          <h1 class="u-name">{{ page.name || 'Без имени' }} <span v-if="own" class="badge badge-public">это вы</span></h1>
          <div class="muted small u-facts">
            <span v-if="page.profile?.since"><Icon name="calendar" :size="13" /> В сервисе с {{ formatDate(page.profile.since).split(',')[0] }}</span>
            <span v-if="page.worlds.length"><Icon name="globe" :size="13" /> {{ page.worlds.length }} {{ plural(page.worlds.length, 'мир', 'мира', 'миров') }}{{ own ? '' : ' вместе с вами' }}</span>
            <span v-if="characters.length"><Icon name="user" :size="13" /> {{ characters.length }} {{ plural(characters.length, 'персонаж', 'персонажа', 'персонажей') }}</span>
          </div>
        </div>
        <RouterLink v-if="own" class="btn btn-sm" :to="{ name: 'account' }"><Icon name="settings" :size="14" /> Имя и вход</RouterLink>
      </div>

      <p v-if="!session.user" class="card card-pad muted">
        <RouterLink :to="{ name: 'login', query: { next: route.fullPath } }">Войдите</RouterLink>, чтобы увидеть общие миры, персонажей и игры.
      </p>
      <p v-else-if="!own" class="faint small" style="margin: 0 2px 14px">Здесь видно только то, что у вас общее: миры и игры, где вы оба участники, и персонажи, которых вы можете открыть.</p>

      <template v-if="session.user">
        <h2 class="u-h">Персонажи</h2>
        <div v-if="!characters.length" class="faint small u-empty">{{ own ? 'За вами пока не закреплён ни один персонаж.' : 'В общих мирах персонажей нет.' }}</div>
        <div v-else class="u-grid">
          <RouterLink v-for="c in characters" :key="c.world.id + c.id" class="card u-char" :to="{ name: 'entity', params: { wid: c.world.id, eid: c.id } }">
            <span class="avatar round u-char-ava"><WorldImage :wid="c.world.id" :image-id="c.imageId" :uid="me" :role="c.world.viewerRole"><Icon name="user" :size="18" /></WorldImage></span>
            <span class="grow" style="min-width: 0">
              <span class="u-char-name ellipsis">{{ c.name }}</span>
              <span class="faint small ellipsis">{{ c.kind ? c.kind + ' · ' : '' }}{{ c.world.name }}</span>
            </span>
          </RouterLink>
        </div>

        <h2 class="u-h">{{ own ? 'Миры' : 'Общие миры' }}</h2>
        <div v-if="!page.worlds.length" class="faint small u-empty">{{ own ? 'Вы пока не состоите ни в одном мире.' : 'Общих миров нет.' }}</div>
        <div v-else class="stack-sm">
          <RouterLink v-for="w in page.worlds" :key="w.id" class="card u-world" :to="{ name: 'dashboard', params: { wid: w.id } }">
            <span class="u-world-img"><WorldImage :wid="w.id" :image-id="w.imageId" :uid="me" :role="w.viewerRole"><Icon name="castle" :size="20" /></WorldImage></span>
            <span class="grow" style="min-width: 0">
              <span class="u-world-name ellipsis">{{ w.name }}</span>
              <span class="faint small">
                {{ ROLE[w.member.role] }} · с {{ formatDate(w.member.joinedAt).split(',')[0] }}<template v-if="w.member.lastSeenAt"> · заходил(а) {{ relativeTime(w.member.lastSeenAt) }}</template>
              </span>
            </span>
            <span v-if="w.characters.length" class="faint small u-world-chars">{{ w.characters.map((c) => c.name).join(', ') }}</span>
          </RouterLink>
        </div>

        <template v-if="page.campaigns.length">
          <h2 class="u-h">{{ own ? 'Игры' : 'Общие игры' }}</h2>
          <div class="stack-sm">
            <RouterLink v-for="c in page.campaigns" :key="c.id" class="card u-world" :to="c.worldId ? { name: 'wcampaign', params: { wid: c.worldId, cid: c.id } } : { name: 'campaign', params: { cid: c.id } }">
              <span class="u-world-img"><Icon name="swords" :size="20" /></span>
              <span class="grow" style="min-width: 0">
                <span class="u-world-name ellipsis">{{ c.name }}</span>
                <span class="faint small">{{ ROLE_LABELS[c.role] }}{{ c.characterName ? ' · ' + c.characterName : '' }}{{ c.worldName ? ' · ' + c.worldName : '' }}</span>
              </span>
              <span class="badge" :class="{ 'badge-public': c.status === 'active' }">{{ STATUS_LABELS[c.status] }}</span>
            </RouterLink>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.user-page { max-width: 900px; margin: 0 auto; padding: 22px 24px 60px; }
@media (max-width: 640px) { .user-page { padding: 16px 16px 48px; } }
.u-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.u-ava { width: 72px; height: 72px; }
.u-name { margin: 0 0 4px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.u-facts { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.u-facts span { display: inline-flex; align-items: center; gap: 5px; }
.u-h { margin: 22px 0 10px; font-size: 18px; }
.u-empty { margin: 0 2px; }
.u-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.u-char, .u-world { display: flex; align-items: center; gap: 10px; padding: 10px 12px; color: var(--text); text-decoration: none; }
.u-char:hover, .u-world:hover { border-color: var(--accent); }
.u-char > span.grow, .u-world > span.grow { display: flex; flex-direction: column; }
.u-char-ava { width: 38px; height: 38px; }
.u-char-ava :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.u-char-name, .u-world-name { font-weight: 600; }
.u-world-img { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; flex: none; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-3); color: var(--text-faint); }
.u-world-img :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.u-world-chars { max-width: 40%; text-align: right; }
@media (max-width: 640px) { .u-world-chars { display: none; } }
</style>
