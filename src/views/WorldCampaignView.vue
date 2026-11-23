<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { isServiceAdmin } from '@/data/admin'
import { currentCharacters, watchCampaign, watchParticipants, watchSessions, removeParticipant, STATUS_LABELS, ROLE_LABELS } from '@/data/campaigns'
import { formatDate, untilTime, plural, errorText } from '@/data/util'
import { cropOf } from '@/data/crop'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import CampaignCover from '@/components/campaign/CampaignCover.vue'
import RichView from '@/components/viewer/RichView.vue'
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
watch(() => campaign.value?.name, (n) => { if (n) document.title = `${n} — ${world.world?.name ?? 'кампейн'}` }, { immediate: true })

const people = computed(() => [...participants.value].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ru') : a.role === 'gm' ? -1 : 1)))
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
  if (!campaign.value || !confirm(`Покинуть кампейн «${campaign.value.name}»? Вернуть вас сможет мастер.`)) return
  try {
    await removeParticipant(cid, uid.value, true)
    toast.success('Вы покинули кампейн')
    void router.replace({ name: 'wcampaigns', params: { wid: world.wid! } })
  } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) }
}
</script>

<template>
  <Teleport defer to="#crumbs">
    <RouterLink :to="{ name: 'dashboard', params: { wid: world.wid! } }">{{ world.world?.name }}</RouterLink>
    <Icon name="chevron-right" :size="13" /><RouterLink :to="{ name: 'wcampaigns', params: { wid: world.wid! } }">Кампейны</RouterLink>
    <template v-if="campaign"><Icon name="chevron-right" :size="13" /><span class="ellipsis" style="color: var(--text)">{{ campaign.name }}</span></template>
  </Teleport>
  <div class="content">
    <div v-if="campaign === undefined" class="empty"><Icon name="refresh-cw" class="spin" :size="26" /></div>
    <div v-else-if="campaign === null" class="card empty" style="max-width: 560px; margin: 40px auto">
      <Icon name="lock" :size="34" />
      <h2>Кампейн недоступен</h2>
      <p class="muted">Его удалили, или вы в нём не участвуете. Добавить вас в кампейн может мастер мира.</p>
      <RouterLink class="btn" :to="{ name: 'wcampaigns', params: { wid: world.wid! } }">Кампейны мира</RouterLink>
    </div>
    <template v-else>
      <section class="c-hero">
        <CampaignCover :campaign="campaign" class="c-cover" />
        <div class="c-hero-text">
          <div class="row gap-sm wrap">
            <span class="badge" :class="{ 'badge-public': campaign.status === 'active' }">{{ STATUS_LABELS[campaign.status] }}</span>
            <span v-if="isGM && !isMember" class="badge badge-secret">вы — мастер мира</span>
          </div>
          <h1>{{ campaign.name }}</h1>
          <div class="c-meta">
            <span v-if="campaign.schedule"><Icon name="clock" :size="14" /> {{ campaign.schedule }}</span>
            <span><Icon name="users" :size="14" /> {{ participants.length }} {{ plural(participants.length, 'участник', 'участника', 'участников') }}</span>
            <RouterLink v-if="tag" :to="{ name: 'entity', params: { wid: world.wid!, eid: tag.id }, query: { tab: 'feature' } }" class="tag-chip" :style="{ '--tag-color': tag.fields?.colour }" title="Статьи с тегом кампейна">{{ tag.name }}</RouterLink>
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
              <div class="section-title" style="margin: 0">Следующая игра</div>
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
                <span class="avatar round" style="width: 34px; height: 34px"><img v-if="p.photoURL" :src="p.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="16" /></span>
                <div class="grow" style="min-width: 0">
                  <div class="row gap-sm"><RouterLink class="ov-name ellipsis" :to="{ name: 'user', params: { uid: p.uid } }">{{ p.displayName }}</RouterLink><span v-if="p.role === 'gm'" class="badge">{{ ROLE_LABELS.gm }}</span></div>
                  <div class="ov-chars">
                    <RouterLink v-for="e in charsOf(p)" :key="e!.id" class="ov-char" :to="{ name: 'entity', params: { wid: world.wid!, eid: e!.id } }">
                      <span class="ov-char-ava"><Thumb :id="e!.imageId" :crop="cropOf(e!)"><Icon name="user" :size="11" /></Thumb></span>{{ e!.name }}
                    </RouterLink>
                    <span v-if="!charsOf(p).length" class="faint small">{{ p.characterName || (p.role === 'gm' ? 'ведёт игру' : 'персонаж не выбран') }}</span>
                  </div>
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
          <section class="card card-pad">
            <h3 class="panel-title"><Icon name="scroll" /> О кампейне</h3>
            <p v-if="campaign.description" class="desc">{{ campaign.description }}</p>
            <p v-else class="faint" style="margin: 0">Описания пока нет.<template v-if="isGM"> Его можно добавить в настройках.</template></p>
          </section>
          <button v-if="isMember && campaign.ownerId !== uid" class="btn btn-ghost btn-sm" style="align-self: flex-start" @click="leave"><Icon name="log-out" :size="14" /> Покинуть кампейн</button>
        </aside>
      </div>

      <CampaignSessions v-else-if="tab === 'sessions'" :campaign="campaign" :sessions="sessions" :is-gm="isGM" :world-ready="true" />
      <CampaignPeople v-else-if="tab === 'people'" :campaign="campaign" :participants="participants" :is-gm="isGM" />
      <CampaignRooms v-else-if="tab === 'rooms'" :campaign="campaign" />
      <div v-else-if="tab === 'settings' && isGM" class="stack">
        <CampaignMembersAdmin :campaign="campaign" :participants="participants" />
        <CampaignSettings :campaign="campaign" :is-owner="isOwner" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.c-hero { display: flex; gap: 20px; align-items: flex-end; margin-bottom: 18px; }
.c-cover { width: 260px; height: 146px; border-radius: 14px; flex-shrink: 0; box-shadow: var(--shadow); }
.c-hero-text { min-width: 0; flex: 1; }
.c-hero h1 { margin: 6px 0 6px; font-size: 40px; line-height: 1.05; overflow-wrap: break-word; }
.c-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; color: var(--text-muted); font-size: 14px; }
.c-meta > span { display: inline-flex; align-items: center; gap: 5px; }
.ov-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
.next-card { display: flex; align-items: center; gap: 14px; border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.next-card > .icon { color: var(--accent); }
.next-date { font: 700 24px var(--font-head); }
.desc { white-space: pre-wrap; margin: 0; }
.last-html { margin-top: 8px; font-size: 16px; max-height: 360px; overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, #000 75%, transparent); mask-image: linear-gradient(to bottom, #000 75%, transparent); }
.ov-people { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px 18px; }
.ov-person { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; }
.ov-name { font-weight: 600; color: var(--text); text-decoration: none; }
.ov-name:hover { color: var(--accent); }
.ov-chars { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.ov-char { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 2px; border: 1px solid var(--border); border-radius: 99px; font-size: 13px; color: var(--text); text-decoration: none; background: var(--surface-2); }
.ov-char:hover { border-color: var(--accent); }
.ov-char-ava { width: 20px; height: 20px; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-3); color: var(--accent); flex: none; }
.ov-char-ava :deep(img) { width: 100%; height: 100%; object-fit: cover; }
@media (max-width: 960px) { .ov-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .c-hero { flex-direction: column; align-items: stretch; gap: 12px; }
  .c-cover { width: 100%; height: 140px; }
  .c-hero h1 { font-size: 30px; }
}
</style>
