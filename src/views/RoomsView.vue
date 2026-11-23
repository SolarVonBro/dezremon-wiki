<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { createRoom, watchMyRooms } from '@/data/rooms'
import { watchMyCampaigns } from '@/data/campaigns'
import { relativeTime, plural, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, Room, RoomAccess } from '@/model/types'

const session = useSession()
const route = useRoute()
const router = useRouter()
const rooms = ref<Room[]>([])
const campaigns = ref<Campaign[]>([])
const loading = ref(true)
let stops: Array<() => void> = []
watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stops.forEach((s) => s()); stops = []
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  stops.push(watchMyRooms(u, (r) => { rooms.value = r; loading.value = false }, () => { loading.value = false }))
  stops.push(watchMyCampaigns(u, (r) => { campaigns.value = r }))
}, { immediate: true })
onBeforeUnmount(() => stops.forEach((s) => s()))

const creating = ref(false)
const form = ref({ name: '', campaignId: '', access: 'link' as RoomAccess, controlMode: 'hosts' as 'hosts' | 'everyone' })
const busy = ref(false)
function openCreate(campaignId = '') {
  form.value = { name: '', campaignId, access: campaignId ? 'campaign' : 'link', controlMode: 'hosts' }
  creating.value = true
}
watch(() => [route.query.new, session.user?.uid], () => {
  if (route.query.new && session.user) { openCreate(String(route.query.campaign ?? '')); void router.replace({ query: {} }) }
}, { immediate: true })
async function create() {
  if (!session.user || !form.value.name.trim()) return
  const c = campaigns.value.find((x) => x.id === form.value.campaignId) ?? null
  busy.value = true
  try {
    const id = await createRoom(session.user, { name: form.value.name.trim(), campaignId: c?.id ?? null, campaignName: c?.name ?? '', access: c ? form.value.access : 'link', controlMode: form.value.controlMode })
    creating.value = false
    void router.push({ name: 'room', params: { rid: id } })
  } catch (e: any) { toast.error('Не удалось создать комнату: ' + errorText(e)) } finally { busy.value = false }
}
</script>

<template>
  <div class="page">
    <div class="row gap wrap" style="margin-bottom: 14px">
      <h1 class="grow" style="margin: 0">Музыкальные комнаты</h1>
      <button class="btn btn-primary" @click="openCreate()"><Icon name="plus" :size="16" /> Новая комната</button>
    </div>
    <p class="muted" style="margin: 0 0 18px; max-width: 760px">Слушайте музыку с YouTube вместе: у всех в комнате играет одно и то же в одну и ту же секунду. Есть очередь, повтор, чат и дополнительные дорожки — фон вроде дождя или шума таверны поверх музыки. Комнату можно привязать к игре.</p>

    <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
    <div v-else-if="!rooms.length" class="card empty">
      <Icon name="headphones" :size="34" />
      <p>Вы ещё не заходили ни в одну комнату. Создайте свою или откройте ссылку, которую прислал друг.</p>
      <button class="btn btn-primary" @click="openCreate()"><Icon name="plus" :size="15" /> Создать комнату</button>
    </div>
    <div v-else class="room-grid">
      <RouterLink v-for="r in rooms" :key="r.id" class="room-card" :to="{ name: 'room', params: { rid: r.id } }">
        <div class="rc-icon"><Icon name="disc-3" :size="30" /></div>
        <div class="grow" style="min-width: 0">
          <div class="rc-name ellipsis">{{ r.name }}</div>
          <div class="faint small ellipsis">
            <template v-if="r.campaignId"><Icon name="swords" :size="12" /> {{ r.campaignName }} · </template>
            {{ r.ownerId === session.user?.uid ? 'ваша' : r.ownerName }} · {{ r.memberUids.length }} {{ plural(r.memberUids.length, 'слушатель', 'слушателя', 'слушателей') }} · {{ relativeTime(r.lastActiveAt) }}
          </div>
        </div>
      </RouterLink>
    </div>

    <Modal v-if="creating" title="Новая комната" width="520px" @close="creating = false">
      <form class="stack" @submit.prevent="create">
        <label class="field"><span>Название</span><input v-model="form.name" class="input" maxlength="80" placeholder="Таверна «Пьяный грифон»" autofocus /></label>
        <label class="field"><span>Игра (необязательно)</span>
          <select v-model="form.campaignId" class="input" @change="form.access = form.campaignId ? 'campaign' : 'link'">
            <option value="">— без игры —</option>
            <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <div v-if="form.campaignId" class="field"><span>Кто может зайти</span>
          <label class="check"><input v-model="form.access" type="radio" value="campaign" /> Только участники игры</label>
          <label class="check"><input v-model="form.access" type="radio" value="link" /> Все, у кого есть ссылка</label>
        </div>
        <div class="field"><span>Кто управляет музыкой</span>
          <label class="check"><input v-model="form.controlMode" type="radio" value="hosts" /> Я и назначенные ведущие</label>
          <label class="check"><input v-model="form.controlMode" type="radio" value="everyone" /> Все слушатели</label>
        </div>
        <div><button class="btn btn-primary" :disabled="busy || !form.name.trim()"><Icon name="plus" :size="15" /> Создать</button></div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.page { max-width: 1180px; margin: 0 auto; padding: 22px 24px 60px; }
.room-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.room-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; color: var(--text); text-decoration: none !important; }
.room-card:hover { border-color: var(--accent); }
.rc-icon { width: 52px; height: 52px; border-radius: 12px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 40%, var(--surface-2)), var(--surface-3)); display: flex; align-items: center; justify-content: center; color: var(--accent-fg); flex-shrink: 0; }
.rc-name { font: 700 20px var(--font-head); }
@media (max-width: 720px) { .page { padding: 16px 14px 50px; } }
</style>
