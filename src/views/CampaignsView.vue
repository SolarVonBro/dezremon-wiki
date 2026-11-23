<script setup lang="ts">
// All campaigns of the user, as a short list. A campaign lives inside its world: each row leads to its page there,
// and new campaigns are created from a world («Мир → Кампейны»).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { watchMyCampaigns, STATUS_LABELS } from '@/data/campaigns'
import { formatDate, plural, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import CampaignCover from '@/components/campaign/CampaignCover.vue'
import { toast } from '@/components/common/toast'
import type { Campaign } from '@/model/types'

const session = useSession()
const route = useRoute()
const router = useRouter()
const rows = ref<Campaign[]>([])
const loading = ref(true)
let stop: (() => void) | null = null

watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stop?.(); stop = null
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  stop = watchMyCampaigns(u, (r) => { rows.value = r; loading.value = false }, (e: any) => { loading.value = false; toast.error('Не удалось загрузить кампейны: ' + errorText(e)) })
}, { immediate: true })
onBeforeUnmount(() => stop?.())

const uid = computed(() => session.user?.uid ?? '')
// running ones first, then by the last change
const ORDER: Record<string, number> = { active: 0, planning: 1, paused: 2, finished: 3 }
const sorted = computed(() => [...rows.value].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updatedAt - a.updatedAt))
const target = (c: Campaign) => (c.worldId ? { name: 'wcampaign', params: { wid: c.worldId, cid: c.id } } : { name: 'campaign', params: { cid: c.id } })
</script>

<template>
  <div class="page">
    <h1 style="margin: 0 0 6px">Кампейны</h1>
    <p class="muted" style="margin: 0 0 18px; max-width: 760px">
      Игры, в которых вы участвуете. Кампейн живёт внутри своего мира: там его журнал, игроки и их персонажи. Новый кампейн создаётся в мире — откройте мир и раздел «Кампейны».
    </p>

    <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
    <div v-else-if="!rows.length" class="card empty">
      <Icon name="swords" :size="34" />
      <p>Вы пока не участвуете ни в одном кампейне. Мастер мира может добавить вас в кампейн или прислать ссылку-приглашение.</p>
      <RouterLink class="btn" :to="{ name: 'worlds' }"><Icon name="globe" :size="15" /> Мои миры</RouterLink>
    </div>
    <div v-else class="card camp-list">
      <RouterLink v-for="c in sorted" :key="c.id" class="camp-row" :to="target(c)">
        <CampaignCover :campaign="c" class="camp-thumb" />
        <span class="grow camp-main">
          <span class="camp-name ellipsis">{{ c.name }}</span>
          <span class="faint small camp-facts">
            <span><Icon name="globe" :size="12" /> {{ c.worldName || 'без мира' }}</span>
            <span><Icon :name="c.gmUids.includes(uid) ? 'crown' : 'user'" :size="12" /> {{ c.gmUids.includes(uid) ? 'Веду' : 'Играю' }}</span>
            <span><Icon name="users" :size="12" /> {{ c.memberUids.length }} {{ plural(c.memberUids.length, 'участник', 'участника', 'участников') }}</span>
            <span v-if="c.schedule"><Icon name="clock" :size="12" /> {{ c.schedule }}</span>
            <span v-if="c.nextSessionAt && c.nextSessionAt > Date.now()"><Icon name="calendar-clock" :size="12" /> {{ formatDate(c.nextSessionAt) }}</span>
          </span>
        </span>
        <span class="badge" :class="{ 'badge-public': c.status === 'active' }">{{ STATUS_LABELS[c.status] }}</span>
        <Icon name="chevron-right" :size="16" class="faint" />
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 960px; margin: 0 auto; padding: 22px 24px 60px; }
.camp-list { padding: 4px 0; }
.camp-row { display: flex; align-items: center; gap: 14px; padding: 10px 16px; color: var(--text); text-decoration: none !important; }
.camp-row + .camp-row { border-top: 1px solid var(--border); }
.camp-row:hover { background: var(--surface-2); }
.camp-thumb { width: 72px; height: 44px; border-radius: 8px; flex: none; }
.camp-main { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.camp-name { font: 700 18px var(--font-head); }
.camp-facts { display: flex; flex-wrap: wrap; gap: 2px 12px; }
.camp-facts > span { display: inline-flex; align-items: center; gap: 4px; }
@media (max-width: 720px) {
  .page { padding: 16px 14px 50px; }
  .camp-row { padding: 10px 12px; gap: 10px; }
  .camp-thumb { width: 52px; height: 36px; }
}
</style>
