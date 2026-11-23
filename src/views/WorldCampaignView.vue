<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { isServiceAdmin } from '@/data/admin'
import { currentCharacters, watchCampaign, watchParticipants, watchSessions, removeParticipant, updateCampaign, FORMAT_LABELS, STATUS_LABELS, ROLE_LABELS } from '@/data/campaigns'
import { formatDate, untilTime, plural, errorText } from '@/data/util'
import { cropOf } from '@/data/crop'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import CampaignCover from '@/components/campaign/CampaignCover.vue'
import RichView from '@/components/viewer/RichView.vue'
import ImageCropModal from '@/components/entity/ImageCropModal.vue'
import { openLightbox } from '@/components/viewer/lightbox'
import { imageUrl } from '@/data/images'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignParticipant, CampaignSession } from '@/model/types'

const CampaignSessions = defineAsyncComponent(() => import('@/components/campaign/CampaignSessions.vue'))
const CampaignPeople = defineAsyncComponent(() => import('@/components/campaign/CampaignPeople.vue'))
const CampaignSettings = defineAsyncComponent(() => import('@/components/campaign/CampaignSettings.vue'))
const CampaignMembersAdmin = defineAsyncComponent(() => import('@/components/campaign/CampaignMembersAdmin.vue'))
const CampaignRooms = defineAsyncComponent(() => import('@/components/campaign/CampaignRooms.vue'))

// A campaign on its world's pages. Its GMs and the world's masters run it; its players see it.
const route = useRoute()
const router = useRouter()
const world = useWorld()
const cid = route.params.cid as string

const campaign = ref<Campaign | null | undefined>(undefined) // undefined = loading, null = missing or no access
const participants = ref<CampaignParticipant[]>([])
const sessions = ref<CampaignSession[]>([])
let stops: Array<() => void> = []
watch(() => [world.uid, world.status] as const, ([u, st]) => {
  stops.forEach((s) => s()); stops = []
  if (!u || st !== 'ready') return
  stops.push(watchCampaign(cid, (c) => { campaign.value = c && c.worldId === world.wid ? c : null }, () => { campaign.value = null }))
  stops.push(watchParticipants(cid, (r) => { participants.value = r }))
  stops.push(watchSessions(cid, (r) => { sessions.value = r }))
}, { immediate: true })
onBeforeUnmount(() => stops.forEach((s) => s()))
// no world access at all (a guest, or not signed in): the campaign cannot be shown either
watch(() => world.status, (st) => { if (st === 'denied' || (st === 'ready' && !world.uid)) campaign.value = null }, { immediate: true })

const uid = computed(() => world.uid ?? '')
const admin = computed(() => isServiceAdmin(uid.value))
/** GMs of the campaign and the world's masters run it (not while looking through a player's eyes). */
const isGM = computed(() => !!campaign.value && !world.preview && (campaign.value.gmUids.includes(uid.value) || world.isMaster || admin.value))
const isOwner = computed(() => !!campaign.value && !world.preview && (campaign.value.ownerId === uid.value || world.isOwner || admin.value))
const isMember = computed(() => !!campaign.value?.memberUids.includes(uid.value))

type Tab = 'overview' | 'sessions' | 'people' | 'rooms' | 'settings'
const tab = computed<Tab>(() => (route.params.tab as Tab) || 'overview')
function setTab(t: Tab) { void router.replace({ name: 'wcampaign', params: { wid: world.wid!, cid, tab: t === 'overview' ? undefined : t } }) }
watch(() => campaign.value?.name, (n) => { if (n) document.title = `${n} — ${world.world?.name ?? 'игра'}` }, { immediate: true })

const people = computed(() => [...participants.value].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ru') : a.role === 'gm' ? -1 : 1)))
// the cover opens full screen (the full-size picture of the world, or the small copy of older games)
async function openCover() {
  const c = campaign.value
  if (!c || (!c.coverImageId && !c.cover)) return
  const src = c.coverImageId ? await imageUrl(world.access, c.coverImageId, 'full').catch(() => c.cover) : c.cover
  if (src) openLightbox([{ src, caption: c.name }])
}
const framingCover = ref(false)
function saveCoverFrame(crop: { x: number; y: number; zoom: number } | null) {
  void updateCampaign(cid, { coverCrop: crop }).catch((e) => toast.error('Не удалось сохранить кадр: ' + errorText(e)))
}
const charsOf = (p: CampaignParticipant) => (campaign.value ? currentCharacters(campaign.value, p).map((id) => world.get(id)).filter((e) => !!e) : [])
const tag = computed(() => (campaign.value?.tagId ? world.get(campaign.value.tagId) ?? null : null))
const lastDone = computed(() => sessions.value.find((s) => s.status === 'done') ?? null)
const nextPlanned = computed(() => [...sessions.value].reverse().find((s) => s.status === 'planned') ?? null)
const nextAt = computed(() => {
  const c = campaign.value
  const cands = [c?.nextSessionAt, nextPlanned.value?.date].filter((x): x is number => !!x && x > Date.now() - 6 * 3600 * 1000)
  return cands.length ? Math.min(...cands) : null
})

async function leave() {
  if (!campaign.value || !confirm(`Покинуть игру «${campaign.value.name}»? Вернуть вас сможет мастер.`)) return
  try {
    await removeParticipant(cid, uid.value, true)
    toast.success('Вы покинули игру')
    void router.replace({ name: 'wcampaigns', params: { wid: world.wid! } })
  } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) }
}
</script>

<template>
  <Teleport defer to="#crumbs">
    <RouterLink :to="{ name: 'dashboard', params: { wid: world.wid! } }">{{ world.world?.name }}</RouterLink>
    <Icon name="chevron-right" :size="13" /><RouterLink :to="{ name: 'wcampaigns', params: { wid: world.wid! } }">Игры</RouterLink>
    <template v-if="campaign"><Icon name="chevron-right" :size="13" /><span class="ellipsis" style="color: var(--text)">{{ campaign.name }}</span></template>
  </Teleport>
  <div class="content" :class="{ 'has-bg': !!campaign?.backgroundImageId }">
    <!-- the page background: behind the page only (not the menus), blurred and dimmed -->
    <div v-if="campaign?.backgroundImageId" class="c-bg" aria-hidden="true">
      <Thumb :id="campaign.backgroundImageId" variant="full" :crop="campaign.backgroundCrop ?? null" />
    </div>
    <div v-if="campaign === undefined" class="empty"><Icon name="refresh-cw" class="spin" :size="26" /></div>
    <div v-else-if="campaign === null" class="card empty" style="max-width: 560px; margin: 40px auto">
      <Icon name="lock" :size="34" />
      <h2>Игра недоступна</h2>
      <p class="muted">Её удалили, или вы в ней не участвуете. Добавить вас в игру может мастер мира.</p>
      <RouterLink class="btn" :to="{ name: 'wcampaigns', params: { wid: world.wid! } }">Игры мира</RouterLink>
    </div>
    <template v-else>
      <section class="c-hero">
        <div class="c-cover-wrap">
          <CampaignCover :campaign="campaign" hires class="c-cover" :class="{ zoomable: !!(campaign.cover || campaign.coverImageId) }" :title="campaign.cover || campaign.coverImageId ? 'Открыть обложку' : undefined" @click="openCover" />
          <button v-if="isGM && (campaign.cover || campaign.coverImageId)" type="button" class="c-crop-btn" title="Кадр обложки: центрирование и масштаб" @click="framingCover = true"><Icon name="crosshair" :size="15" /></button>
        </div>
        <div class="c-hero-text">
          <div class="row gap-sm wrap">
            <span class="badge" :class="{ 'badge-public': campaign.status === 'active' }">{{ STATUS_LABELS[campaign.status] }}</span>
            <span v-if="campaign.format" class="badge">{{ FORMAT_LABELS[campaign.format] }}</span>
            <span v-if="isGM && !isMember" class="badge badge-secret">вы — мастер мира</span>
          </div>
          <h1>{{ campaign.name }}</h1>
          <div class="c-meta">
            <span v-if="campaign.schedule"><Icon name="clock" :size="14" /> {{ campaign.schedule }}</span>
            <span><Icon name="users" :size="14" /> {{ participants.length }} {{ plural(participants.length, 'участник', 'участника', 'участников') }}</span>
            <RouterLink v-if="tag" :to="{ name: 'entity', params: { wid: world.wid!, eid: tag.id }, query: { tab: 'feature' } }" class="tag-chip" :style="{ '--tag-color': tag.fields?.colour }" title="Статьи с тегом игры">{{ tag.name }}</RouterLink>
            <RouterLink v-if="campaign.roomId && isMember" class="c-room" :to="{ name: 'room', params: { rid: campaign.roomId } }" title="Музыкальная комната игры"><Icon name="headphones" :size="14" /> Музыкальная комната</RouterLink>
          </div>
        </div>
      </section>

      <div class="tabs">
        <button class="tab" :class="{ on: tab === 'overview' }" @click="setTab('overview')"><Icon name="layout-dashboard" :size="16" /> Обзор</button>
        <button class="tab" :class="{ on: tab === 'sessions' }" @click="setTab('sessions')"><Icon name="book-open" :size="16" /> Сессии <span v-if="sessions.length" class="count">{{ sessions.length }}</span></button>
        <button class="tab" :class="{ on: tab === 'people' }" @click="setTab('people')"><Icon name="users" :size="16" /> Игроки <span class="count">{{ participants.length }}</span></button>
        <button class="tab" :class="{ on: tab === 'rooms' }" @click="setTab('rooms')"><Icon name="headphones" :size="16" /> Комнаты</button>
        <button v-if="isGM" class="tab" :class="{ on: tab === 'settings' }" @click="setTab('settings')"><Icon name="settings" :size="16" /> Настройки</button>
      </div>

      <div v-if="tab === 'overview'" class="ov-grid">
        <div class="stack">
          <section v-if="nextAt" class="card card-pad next-card">
            <Icon name="calendar-clock" :size="22" />
            <div class="grow">
              <div class="section-title" style="margin: 0">Следующая встреча</div>
              <div class="next-date">{{ formatDate(nextAt) }}</div>
              <div class="faint small">{{ nextAt > Date.now() ? untilTime(nextAt) : 'сейчас' }}{{ nextPlanned?.title ? ' · ' + nextPlanned.title : '' }}</div>
            </div>
          </section>
          <section class="card card-pad">
            <div class="row gap" style="margin-bottom: 8px">
              <h3 class="panel-title grow" style="margin: 0"><Icon name="users" /> Игроки и персонажи</h3>
              <button class="btn btn-sm btn-ghost" @click="setTab(isGM ? 'settings' : 'people')">{{ isGM ? 'Управлять' : 'Подробнее' }} <Icon name="arrow-right" :size="14" /></button>
            </div>
            <div v-if="!people.length" class="faint">Игроков пока нет.</div>
            <div class="ov-people">
              <div v-for="p in people" :key="p.uid" class="ov-person">
                <div class="row gap-sm ov-who">
                  <span class="avatar round" style="width: 26px; height: 26px"><img v-if="p.photoURL" :src="p.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="13" /></span>
                  <RouterLink class="ov-name ellipsis" :to="{ name: 'user', params: { uid: p.uid } }">{{ p.displayName }}</RouterLink><span v-if="p.role === 'gm'" class="badge">{{ ROLE_LABELS.gm }}</span>
                </div>
                <div class="ov-chars">
                  <RouterLink v-for="e in charsOf(p)" :key="e!.id" class="ov-char" :to="{ name: 'entity', params: { wid: world.wid!, eid: e!.id } }" :title="e!.name">
                    <span class="ov-portrait"><Thumb :id="e!.imageId" :crop="cropOf(e!)"><Icon name="user" :size="22" /></Thumb></span>
                    <span class="ov-char-name">{{ e!.name }}</span>
                  </RouterLink>
                  <span v-if="!charsOf(p).length" class="faint small">{{ p.characterName || (p.role === 'gm' ? 'ведёт игру' : 'персонаж не выбран') }}</span>
                </div>
              </div>
            </div>
          </section>
          <section class="card card-pad">
            <div class="row gap" style="margin-bottom: 6px">
              <h3 class="panel-title grow" style="margin: 0"><Icon name="book-open" /> Последняя сессия</h3>
              <button class="btn btn-sm btn-ghost" @click="setTab('sessions')">Журнал <Icon name="arrow-right" :size="14" /></button>
            </div>
            <template v-if="lastDone">
              <div class="muted small">Сессия {{ lastDone.number }}{{ lastDone.title ? ' — ' + lastDone.title : '' }}{{ lastDone.date ? ' · ' + formatDate(lastDone.date).split(',')[0] : '' }}</div>
              <RichView v-if="lastDone.html" :html="lastDone.html" class="prose last-html" />
            </template>
            <p v-else class="faint" style="margin: 0">Сыгранных сессий в журнале пока нет.</p>
          </section>
        </div>
        <aside class="stack">
          <section v-if="campaign.intro?.length || isGM" class="card card-pad intro-card">
            <h3 class="panel-title"><Icon name="compass" /> Вводная</h3>
            <dl v-if="campaign.intro?.length" class="facts intro-facts"><template v-for="(r, i) in campaign.intro" :key="i"><dt>{{ r.name }}</dt><dd>{{ r.value }}</dd></template></dl>
            <p v-else class="faint" style="margin: 0">Жанр, настроение, система, уровень — добавьте вводную в <a href="#" @click.prevent="setTab('settings')">настройках</a>.</p>
          </section>
          <section class="card card-pad">
            <h3 class="panel-title"><Icon name="scroll" /> Об игре</h3>
            <p v-if="campaign.description" class="desc">{{ campaign.description }}</p>
            <p v-else class="faint" style="margin: 0">Описания пока нет.<template v-if="isGM"> Его можно добавить в настройках.</template></p>
          </section>
          <button v-if="isMember && campaign.ownerId !== uid" class="btn btn-ghost btn-sm" style="align-self: flex-start" @click="leave"><Icon name="log-out" :size="14" /> Покинуть игру</button>
        </aside>
      </div>

      <CampaignSessions v-else-if="tab === 'sessions'" :campaign="campaign" :sessions="sessions" :is-gm="isGM" :world-ready="true" />
      <CampaignPeople v-else-if="tab === 'people'" :campaign="campaign" :participants="participants" :is-gm="isGM" />
      <CampaignRooms v-else-if="tab === 'rooms'" :campaign="campaign" />
      <div v-else-if="tab === 'settings' && isGM" class="stack">
        <CampaignMembersAdmin :campaign="campaign" :participants="participants" />
        <CampaignSettings :campaign="campaign" :is-owner="isOwner" />
      </div>
      <ImageCropModal v-if="framingCover" :image-id="campaign.coverImageId" :src="campaign.cover" :initial="campaign.coverCrop ?? null" kind="cover"
        title="Кадр обложки игры" @save="saveCoverFrame" @close="framingCover = false" />
    </template>
  </div>
</template>

<style scoped>
.c-hero { display: flex; gap: 20px; align-items: flex-end; margin-bottom: 18px; }
.c-cover-wrap { position: relative; flex-shrink: 0; }
.c-cover.zoomable { cursor: zoom-in; }
.c-crop-btn {
  position: absolute; right: 8px; bottom: 8px; width: 30px; height: 30px; border-radius: 8px; border: 0; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; background: rgb(0 0 0 / 55%); color: #fff;
}
.c-crop-btn:hover { background: rgb(0 0 0 / 75%); }
/* the page background: fixed under the page area only (the app bar and the sidebar keep their own), blurred, dimmed */
.content.has-bg { position: relative; isolation: isolate; }
.c-bg { position: fixed; top: var(--topbar-h); left: var(--sidebar-w); right: 0; bottom: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.c-bg :deep(img), .c-bg :deep(.thumb-empty) { width: 100%; height: 100%; object-fit: cover; filter: blur(7px) saturate(.85) brightness(.7); transform: scale(1.06); }
.c-bg::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to bottom, color-mix(in srgb, var(--bg) 55%, transparent), color-mix(in srgb, var(--bg) 78%, transparent)); }
@media (max-width: 860px) { .c-bg { left: 0; } }
.c-cover { width: 260px; height: 146px; border-radius: 14px; flex-shrink: 0; box-shadow: var(--shadow); }
.c-hero-text { min-width: 0; flex: 1; }
.c-hero h1 { margin: 6px 0 6px; font-size: 40px; line-height: 1.05; overflow-wrap: break-word; }
.c-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; color: var(--text-muted); font-size: 14px; }
.c-meta > span, .c-room { display: inline-flex; align-items: center; gap: 5px; }
.c-room { color: var(--accent); text-decoration: none; }
.c-room:hover { text-decoration: underline; }
.ov-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
.next-card { display: flex; align-items: center; gap: 14px; border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.next-card > .icon { color: var(--accent); }
.next-date { font: 700 24px var(--font-head); }
.desc { white-space: pre-wrap; margin: 0; }
.intro-facts { margin: 0; }
.intro-facts dd { white-space: pre-wrap; }
.last-html { margin-top: 8px; font-size: 16px; max-height: 360px; overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, #000 75%, transparent); mask-image: linear-gradient(to bottom, #000 75%, transparent); }
.ov-people { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px 18px; }
.ov-person { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; min-width: 0; }
.ov-who { min-width: 0; }
.ov-name { font-weight: 600; color: var(--text); text-decoration: none; }
.ov-name:hover { color: var(--accent); }
.ov-chars { display: flex; flex-wrap: wrap; gap: 8px; }
.ov-char { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 76px; color: var(--text); text-decoration: none; }
.ov-portrait { width: 68px; height: 68px; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--surface-3); color: var(--accent); border: 1px solid var(--border); }
.ov-char:hover .ov-portrait { border-color: var(--accent); }
.ov-portrait :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.ov-char-name { font-size: 12.5px; line-height: 1.2; text-align: center; max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
@media (max-width: 960px) { .ov-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .c-hero { flex-direction: column; align-items: stretch; gap: 12px; }
  .c-cover { width: 100%; height: 140px; }
  .c-hero h1 { font-size: 30px; }
}
</style>
