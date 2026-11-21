<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { useWorld } from '@/stores/world'
import { isServiceAdmin } from '@/data/admin'
import { watchCampaign, watchParticipants, watchSessions, removeParticipant, STATUS_LABELS, ROLE_LABELS } from '@/data/campaigns'
import { formatDate, untilTime, plural, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import CampaignCover from '@/components/campaign/CampaignCover.vue'
import RichView from '@/components/viewer/RichView.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignParticipant, CampaignSession } from '@/model/types'

const CampaignSessions = defineAsyncComponent(() => import('@/components/campaign/CampaignSessions.vue'))
const CampaignPeople = defineAsyncComponent(() => import('@/components/campaign/CampaignPeople.vue'))
const CampaignSettings = defineAsyncComponent(() => import('@/components/campaign/CampaignSettings.vue'))
const CampaignRooms = defineAsyncComponent(() => import('@/components/campaign/CampaignRooms.vue'))

const route = useRoute()
const router = useRouter()
const session = useSession()
const world = useWorld()
const cid = route.params.cid as string

const campaign = ref<Campaign | null | undefined>(undefined) // undefined = loading, null = missing or no access
const participants = ref<CampaignParticipant[]>([])
const sessions = ref<CampaignSession[]>([])
let stops: Array<() => void> = []
watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stops.forEach((s) => s()); stops = []
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  stops.push(watchCampaign(cid, (c) => { campaign.value = c }, () => { campaign.value = null }))
  stops.push(watchParticipants(cid, (r) => { participants.value = r }))
  stops.push(watchSessions(cid, (r) => { sessions.value = r }))
}, { immediate: true })
onBeforeUnmount(() => stops.forEach((s) => s()))

const uid = computed(() => session.user?.uid ?? '')
const admin = computed(() => isServiceAdmin(uid.value))
const isGM = computed(() => !!campaign.value && (campaign.value.gmUids.includes(uid.value) || admin.value))
const isOwner = computed(() => !!campaign.value && (campaign.value.ownerId === uid.value || admin.value))
const isMember = computed(() => !!campaign.value?.memberUids.includes(uid.value))

// The campaign's world is opened in the background (if the user may read it): article mentions in the journal,
// character links and pickers come from it. The campaign itself does not depend on it.
watch(() => campaign.value?.worldId, (w) => { if (w && world.wid !== w) void world.open(w) }, { immediate: true })
const worldReady = computed(() => !!campaign.value?.worldId && world.wid === campaign.value.worldId && world.status === 'ready')

type Tab = 'overview' | 'sessions' | 'people' | 'rooms' | 'settings'
const tab = computed<Tab>(() => (route.params.tab as Tab) || 'overview')
function setTab(t: Tab) { void router.replace({ name: 'campaign', params: { cid, tab: t === 'overview' ? undefined : t } }) }
watch(() => campaign.value?.name, (n) => { if (n) document.title = `${n} — кампейн` }, { immediate: true })

const gms = computed(() => participants.value.filter((p) => p.role === 'gm'))
const players = computed(() => participants.value.filter((p) => p.role === 'player'))
const lastDone = computed(() => sessions.value.find((s) => s.status === 'done') ?? null)
const nextPlanned = computed(() => [...sessions.value].reverse().find((s) => s.status === 'planned') ?? null)
const nextAt = computed(() => {
  const c = campaign.value
  const cands = [c?.nextSessionAt, nextPlanned.value?.date].filter((x): x is number => !!x && x > Date.now() - 6 * 3600 * 1000)
  return cands.length ? Math.min(...cands) : null
})

async function leave() {
  if (!campaign.value || !confirm(`Покинуть кампейн «${campaign.value.name}»? Вернуться можно будет только по новому приглашению.`)) return
  try {
    await removeParticipant(cid, uid.value)
    toast.success('Вы покинули кампейн')
    void router.replace({ name: 'campaigns' })
  } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) }
}
</script>

<template>
  <div class="page">
    <div v-if="campaign === undefined" class="empty"><Icon name="refresh-cw" class="spin" :size="26" /></div>
    <div v-else-if="campaign === null" class="card empty" style="max-width: 560px; margin: 40px auto">
      <Icon name="lock" :size="34" />
      <h2>Кампейн недоступен</h2>
      <p class="muted">Его удалили, или вы в нём не участвуете. Попросите мастера прислать ссылку-приглашение.</p>
      <RouterLink class="btn" :to="{ name: 'campaigns' }">Все кампейны</RouterLink>
    </div>
    <template v-else>
      <section class="c-hero">
        <CampaignCover :campaign="campaign" class="c-cover" />
        <div class="c-hero-text">
          <div class="row gap-sm wrap">
            <span class="badge" :class="{ 'badge-public': campaign.status === 'active' }">{{ STATUS_LABELS[campaign.status] }}</span>
            <span v-if="admin && !isMember" class="badge badge-secret">вы — администратор сервиса</span>
          </div>
          <h1>{{ campaign.name }}</h1>
          <div class="c-meta">
            <span v-if="campaign.worldId"><Icon name="globe" :size="14" />
              <RouterLink v-if="worldReady" :to="{ name: 'dashboard', params: { wid: campaign.worldId } }">{{ campaign.worldName }}</RouterLink>
              <template v-else>{{ campaign.worldName }} <span class="faint">(нет доступа к миру)</span></template>
            </span>
            <span v-if="campaign.schedule"><Icon name="clock" :size="14" /> {{ campaign.schedule }}</span>
            <span><Icon name="users" :size="14" /> {{ participants.length }} {{ plural(participants.length, 'участник', 'участника', 'участников') }}</span>
          </div>
        </div>
      </section>

      <div class="tabs">
        <button class="tab" :class="{ on: tab === 'overview' }" @click="setTab('overview')"><Icon name="layout-dashboard" :size="16" /> Обзор</button>
        <button class="tab" :class="{ on: tab === 'sessions' }" @click="setTab('sessions')"><Icon name="book-open" :size="16" /> Сессии <span v-if="sessions.length" class="count">{{ sessions.length }}</span></button>
        <button class="tab" :class="{ on: tab === 'people' }" @click="setTab('people')"><Icon name="users" :size="16" /> Участники <span class="count">{{ participants.length }}</span></button>
        <button class="tab" :class="{ on: tab === 'rooms' }" @click="setTab('rooms')"><Icon name="headphones" :size="16" /> Комнаты</button>
        <button v-if="isGM" class="tab" :class="{ on: tab === 'settings' }" @click="setTab('settings')"><Icon name="settings" :size="16" /> Настройки</button>
      </div>

      <div v-if="tab === 'overview'" class="ov-grid">
        <div class="stack">
          <section v-if="nextAt" class="card card-pad next-card">
            <Icon name="calendar-clock" :size="22" />
            <div class="grow">
              <div class="section-title" style="margin: 0">Следующая игра</div>
              <div class="next-date">{{ formatDate(nextAt) }}</div>
              <div class="faint small">{{ nextAt > Date.now() ? untilTime(nextAt) : 'сейчас' }}{{ nextPlanned?.title ? ' · ' + nextPlanned.title : '' }}</div>
            </div>
          </section>
          <section class="card card-pad">
            <h3 class="panel-title"><Icon name="scroll" /> О кампейне</h3>
            <p v-if="campaign.description" class="desc">{{ campaign.description }}</p>
            <p v-else class="faint">Описания пока нет.<template v-if="isGM"> Его можно добавить в настройках.</template></p>
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
          <section class="card card-pad">
            <h3 class="panel-title"><Icon name="users" /> Участники</h3>
            <div v-for="p in [...gms, ...players]" :key="p.uid" class="who">
              <span class="avatar round" style="width: 30px; height: 30px"><img v-if="p.photoURL" :src="p.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="15" /></span>
              <div class="grow" style="min-width: 0">
                <div class="ellipsis"><b>{{ p.displayName }}</b> <span v-if="p.role === 'gm'" class="badge" style="margin-left: 4px">{{ ROLE_LABELS.gm }}</span></div>
                <div v-if="p.characterName" class="faint small ellipsis"><Icon name="user" :size="12" /> {{ p.characterName }}</div>
              </div>
            </div>
            <button v-if="isGM" class="btn btn-sm" style="margin-top: 8px" @click="setTab('people')"><Icon name="user-plus" :size="14" /> Пригласить</button>
          </section>
          <button v-if="isMember && campaign.ownerId !== uid" class="btn btn-ghost btn-sm" style="align-self: flex-start" @click="leave"><Icon name="log-out" :size="14" /> Покинуть кампейн</button>
        </aside>
      </div>

      <CampaignSessions v-else-if="tab === 'sessions'" :campaign="campaign" :sessions="sessions" :is-gm="isGM" :world-ready="worldReady" />
      <CampaignPeople v-else-if="tab === 'people'" :campaign="campaign" :participants="participants" :is-gm="isGM" :world-ready="worldReady" />
      <CampaignRooms v-else-if="tab === 'rooms'" :campaign="campaign" />
      <CampaignSettings v-else-if="tab === 'settings' && isGM" :campaign="campaign" :is-owner="isOwner" />
    </template>
  </div>
</template>

<style scoped>
.page { max-width: 1180px; margin: 0 auto; padding: 22px 24px 60px; }
.c-hero { display: flex; gap: 20px; align-items: flex-end; margin-bottom: 18px; }
.c-cover { width: 260px; height: 146px; border-radius: 14px; flex-shrink: 0; box-shadow: var(--shadow); }
.c-hero-text { min-width: 0; flex: 1; }
.c-hero h1 { margin: 6px 0 6px; font-size: 40px; line-height: 1.05; overflow-wrap: break-word; }
.c-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--text-muted); font-size: 14px; }
.c-meta > span { display: inline-flex; align-items: center; gap: 5px; }
.ov-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
.next-card { display: flex; align-items: center; gap: 14px; border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.next-card > .icon { color: var(--accent); }
.next-date { font: 700 24px var(--font-head); }
.desc { white-space: pre-wrap; margin: 0; }
.last-html { margin-top: 8px; font-size: 16px; max-height: 360px; overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, #000 75%, transparent); mask-image: linear-gradient(to bottom, #000 75%, transparent); }
.who { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.who:last-of-type { border-bottom: 0; }
@media (max-width: 960px) { .ov-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .page { padding: 16px 14px 50px; }
  .c-hero { flex-direction: column; align-items: stretch; gap: 12px; }
  .c-cover { width: 100%; height: 140px; }
  .c-hero h1 { font-size: 30px; }
}
</style>
