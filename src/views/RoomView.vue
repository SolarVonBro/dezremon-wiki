<script setup lang="ts">
// A music room: the main track (video + queue), extra layers playing on top of it, listeners and chat.
// Everybody hears the same thing at the same moment (see the sync model in src/data/rooms.ts).
import { errorText } from '@/data/util'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { arrayRemove, arrayUnion } from 'firebase/firestore'
import { useSession } from '@/stores/session'
import { isServiceAdmin, readServiceConfig } from '@/data/admin'
import {
  PRESENCE_TTL, Presence, addTrack, advanceAfterEnd, enterRoom, roomUrl, setPlayback, setTrackProps, skip, updateRoom,
  watchListeners, watchRoom, watchTracks,
} from '@/data/rooms'
import RoomPlayer from '@/components/rooms/RoomPlayer.vue'
import RoomQueue from '@/components/rooms/RoomQueue.vue'
import RoomLayer from '@/components/rooms/RoomLayer.vue'
import RoomChat from '@/components/rooms/RoomChat.vue'
import RoomSettings from '@/components/rooms/RoomSettings.vue'
import AddMedia from '@/components/rooms/AddMedia.vue'
import { formatTime, watchUrl } from '@/components/rooms/youtube'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { toast } from '@/components/common/toast'
import type { LoopMode, Room, RoomListener, RoomTrack } from '@/model/types'

const route = useRoute()
const router = useRouter()
const session = useSession()
const rid = route.params.rid as string

const room = ref<Room | null | undefined>(undefined)
const tracks = ref<RoomTrack[]>([])
const listeners = ref<RoomListener[]>([])
const offset = ref(0)
const apiKey = ref('')
let stops: Array<() => void> = []
let presence: Presence | null = null
let entered = false

watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stops.forEach((s) => s()); stops = []
  presence?.stop(); presence = null
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u || !session.user) return
  const user = session.user
  stops.push(watchRoom(rid, (r) => {
    room.value = r
    if (r && !entered && (!r.memberUids.includes(user.uid) || r.lastActiveAt < Date.now() - 30 * 60000)) { entered = true; void enterRoom(rid, user.uid).catch(() => {}) }
    if (r && !presence) { presence = new Presence(rid, user, (o) => { offset.value = o }); void presence.start() }
  }, () => { room.value = null }))
  stops.push(watchTracks(rid, (r) => { tracks.value = r }))
  stops.push(watchListeners(rid, (r) => { listeners.value = r }))
  void readServiceConfig().then((c) => { apiKey.value = c.youtubeApiKey })
}, { immediate: true })
function leave() { stops.forEach((s) => s()); stops = []; presence?.stop(); presence = null }
onBeforeUnmount(leave)
onMounted(() => window.addEventListener('pagehide', leave))
onBeforeUnmount(() => window.removeEventListener('pagehide', leave))
watch(() => room.value?.name, (n) => { if (n) document.title = `${n} — комната` }, { immediate: true })

const uid = computed(() => session.user?.uid ?? '')
const admin = computed(() => isServiceAdmin(uid.value))
const isOwner = computed(() => !!room.value && (room.value.ownerId === uid.value || admin.value))
const isHost = computed(() => !!room.value && (isOwner.value || room.value.hostUids.includes(uid.value)))
const canControl = computed(() => isHost.value || room.value?.controlMode === 'everyone')
const main = computed(() => tracks.value.find((t) => t.kind === 'main') ?? null)
const layers = computed(() => tracks.value.filter((t) => t.kind !== 'main'))

// ---------- presence ----------
const tick = ref(Date.now())
const ticker = setInterval(() => { tick.value = Date.now() }, 500)
onBeforeUnmount(() => clearInterval(ticker))
const present = computed(() => listeners.value.filter((l) => l.uid === uid.value || tick.value + offset.value - l.at < PRESENCE_TTL))
async function toggleHost(l: RoomListener) {
  if (!room.value) return
  const on = room.value.hostUids.includes(l.uid)
  try { await updateRoom(rid, { hostUids: (on ? arrayRemove(l.uid) : arrayUnion(l.uid)) as unknown as string[] }) } catch (e: any) { toast.error(errorText(e)) }
}

// ---------- audio unlock (browsers block sound until the user clicks) ----------
const unlocked = ref(false)
const blocked = ref(false)
const mainPlayer = ref<InstanceType<typeof RoomPlayer> | null>(null)
const layerRefs = ref<Array<InstanceType<typeof RoomLayer>>>([])
function connect() {
  unlocked.value = true
  blocked.value = false
  setTimeout(() => { mainPlayer.value?.kick(); layerRefs.value.forEach((l) => l?.kick()) }, 300)
}

// ---------- personal volumes (this browser only) ----------
type Personal = { master: number; tracks: Record<string, { vol: number; muted: boolean }> }
const PKEY = `dw.room.${rid}`
function readPersonal(): Personal { try { return { master: 80, tracks: {}, ...JSON.parse(localStorage.getItem(PKEY) ?? '{}') } } catch { return { master: 80, tracks: {} } } }
const personal = ref<Personal>(readPersonal())
watch(personal, (p) => { try { localStorage.setItem(PKEY, JSON.stringify(p)) } catch { /* private mode */ } }, { deep: true })
const mine = (tid: string) => personal.value.tracks[tid] ?? { vol: 100, muted: false }
function setMine(tid: string, p: { vol: number; muted: boolean }) { personal.value.tracks = { ...personal.value.tracks, [tid]: p } }

// ---------- main track controls ----------
const durations = ref<Record<string, number>>({})
const mainItem = computed(() => main.value?.queue.find((x) => x.id === main.value!.current) ?? null)
const mainDuration = computed(() => (mainItem.value ? mainItem.value.duration || durations.value[mainItem.value.videoId] || 0 : 0))
const position = computed(() => {
  void tick.value
  const t = main.value
  if (!t) return 0
  let p = t.playing ? t.position + Math.max(0, Date.now() + offset.value - t.at) / 1000 : t.position
  const d = mainDuration.value
  if (d > 1 && (t.loop === 'one' || (t.loop === 'all' && t.queue.length === 1))) p %= d
  return d ? Math.min(p, d) : p
})
const run = (p: Promise<unknown>) => p.catch((e) => toast.error('Не получилось: ' + errorText(e)))
function togglePlay() { if (main.value) void run(setPlayback(rid, main.value.id, uid.value, !main.value.playing, position.value)) }
function seek(v: number) { if (main.value) void run(setPlayback(rid, main.value.id, uid.value, main.value.playing, v)) }
function skipBy(dir: 1 | -1) {
  const t = main.value
  if (!t) return
  if (dir === -1 && position.value > 5) { seek(0); return }
  void run(skip(rid, t.id, uid.value, t, dir))
}
const LOOPS: LoopMode[] = ['all', 'one', 'off']
const LOOP_LABEL: Record<LoopMode, string> = { all: 'Повтор очереди', one: 'Повтор трека', off: 'Без повтора' }
function cycleLoop() { if (main.value) void run(setTrackProps(rid, main.value.id, uid.value, { loop: LOOPS[(LOOPS.indexOf(main.value.loop) + 1) % LOOPS.length] })) }
let volTimer: ReturnType<typeof setTimeout> | null = null
function roomVolume(v: number) {
  if (volTimer) clearTimeout(volTimer)
  volTimer = setTimeout(() => { if (main.value) void run(setTrackProps(rid, main.value.id, uid.value, { volume: v })) }, 350)
}
function onEnded(t: RoomTrack, itemId: string, rev: number) { void run(advanceAfterEnd(rid, t.id, uid.value, itemId, rev)) }
function onFailed(t: RoomTrack, itemId: string, rev: number, code: number) {
  toast.error(code === 101 || code === 150 ? 'Автор видео запретил встраивание — пропускаю' : 'Видео не воспроизводится — пропускаю')
  onEnded(t, itemId, rev)
}
async function newLayer() {
  const n = layers.value.length + 1
  try { await addTrack(rid, uid.value, `Дорожка ${n}`, n) } catch (e: any) { toast.error('Не получилось: ' + errorText(e)) }
}
function copyLink() { void navigator.clipboard.writeText(roomUrl(rid)).then(() => toast.success('Ссылка на комнату скопирована')) }
const settingsOpen = ref(false)
</script>

<template>
  <div class="room-page">
    <div v-if="room === undefined" class="empty"><Icon name="refresh-cw" class="spin" :size="26" /></div>
    <div v-else-if="room === null" class="card empty" style="max-width: 560px; margin: 40px auto">
      <Icon name="lock" :size="34" />
      <h2>Комната недоступна</h2>
      <p class="muted">Её удалили, или она только для участников кампейна, в котором вас нет.</p>
      <RouterLink class="btn" :to="{ name: 'rooms' }">Мои комнаты</RouterLink>
    </div>
    <template v-else>
      <header class="room-head">
        <div class="grow" style="min-width: 0">
          <h1 class="ellipsis"><Icon name="headphones" :size="26" /> {{ room.name }}</h1>
          <div class="row gap-sm wrap small muted">
            <RouterLink v-if="room.campaignId" :to="{ name: 'campaign', params: { cid: room.campaignId } }"><Icon name="swords" :size="13" /> {{ room.campaignName || 'кампейн' }}</RouterLink>
            <span>{{ room.access === 'campaign' ? 'только участники кампейна' : 'вход по ссылке' }}</span>
            <span>· {{ room.controlMode === 'everyone' ? 'управляют все' : 'управляют ведущие' }}</span>
            <span v-if="!canControl" class="badge">вы слушатель</span>
          </div>
        </div>
        <label class="vol master" title="Общая громкость у меня">
          <Icon name="volume-2" :size="16" />
          <input v-model.number="personal.master" type="range" min="0" max="100" />
        </label>
        <button class="btn btn-sm" @click="copyLink"><Icon name="link" :size="14" /><span class="hide-sm"> Пригласить</span></button>
        <button v-if="isHost" class="btn btn-sm btn-ghost" title="Настройки комнаты" @click="settingsOpen = true"><Icon name="settings" :size="15" /></button>
      </header>

      <div class="room-grid">
        <div class="stack">
          <!-- main track -->
          <section v-if="main" class="card main-card">
            <div class="player-wrap">
              <RoomPlayer v-if="unlocked" ref="mainPlayer" :track="main" :offset="offset" :volume="(main.volume * mine(main.id).vol * personal.master) / 10000" :muted="mine(main.id).muted"
                @ended="(id, rev) => onEnded(main!, id, rev)" @failed="(id, rev, code) => onFailed(main!, id, rev, code)" @duration="(v, d) => (durations = { ...durations, [v]: d })" @blocked="blocked = true">
                <template #empty>Очередь пуста — добавьте видео или плейлист YouTube ниже.</template>
              </RoomPlayer>
              <div v-if="!unlocked || blocked" class="gate">
                <Icon name="headphones" :size="40" />
                <div>{{ blocked ? 'Браузер не дал включить звук автоматически.' : 'Музыка играет у всех одновременно. Подключитесь, чтобы слышать её.' }}</div>
                <button class="btn btn-primary btn-lg" @click="connect"><Icon name="play" :size="18" /> {{ blocked ? 'Включить звук' : 'Подключиться' }}</button>
              </div>
            </div>
            <div class="now">
              <div class="grow" style="min-width: 0">
                <a v-if="mainItem" class="now-title" :href="watchUrl(mainItem.videoId)" target="_blank" rel="noopener">{{ mainItem.title || mainItem.videoId }}</a>
                <div v-else class="now-title faint">Ничего не играет</div>
                <div v-if="mainItem" class="faint small">добавил(а) {{ mainItem.addedByName }}</div>
              </div>
            </div>
            <div class="seek">
              <span class="small faint">{{ formatTime(position) }}</span>
              <input type="range" min="0" :max="Math.max(1, mainDuration)" step="1" :value="mainDuration ? position : 0" :disabled="!canControl || !mainDuration" @change="seek(+($event.target as HTMLInputElement).value)" />
              <span class="small faint">{{ mainDuration ? formatTime(mainDuration) : '--:--' }}</span>
            </div>
            <div class="controls">
              <button class="icon-btn" :disabled="!canControl || !main.queue.length" title="Назад" @click="skipBy(-1)"><Icon name="skip-back" :size="18" /></button>
              <button class="play-btn" :disabled="!canControl || !mainItem" :title="main.playing ? 'Пауза для всех' : 'Играть для всех'" @click="togglePlay"><Icon :name="main.playing ? 'pause' : 'play'" :size="22" /></button>
              <button class="icon-btn" :disabled="!canControl || !main.queue.length" title="Дальше" @click="skipBy(1)"><Icon name="skip-forward" :size="18" /></button>
              <button class="icon-btn" :class="{ on: main.loop !== 'off' }" :disabled="!canControl" :title="LOOP_LABEL[main.loop]" @click="cycleLoop"><Icon :name="main.loop === 'one' ? 'repeat-1' : 'repeat'" :size="17" /></button>
              <button class="icon-btn" :class="{ on: main.shuffle }" :disabled="!canControl" title="Перемешивать" @click="run(setTrackProps(rid, main.id, uid, { shuffle: !main.shuffle }))"><Icon name="shuffle" :size="17" /></button>
              <span class="grow" />
              <label v-if="canControl" class="vol" title="Громкость музыки для всех">
                <Icon name="users" :size="14" /><input type="range" min="0" max="100" :value="main.volume" @input="roomVolume(+($event.target as HTMLInputElement).value)" />
              </label>
              <label class="vol" title="Моя громкость музыки">
                <button class="icon-btn" style="width: 26px; height: 26px" :title="mine(main.id).muted ? 'Включить у меня' : 'Выключить у меня'" @click.prevent="setMine(main.id, { ...mine(main.id), muted: !mine(main.id).muted })">
                  <Icon :name="mine(main.id).muted ? 'volume-x' : 'volume-1'" :size="15" />
                </button>
                <input type="range" min="0" max="100" :value="mine(main.id).vol" @input="setMine(main.id, { ...mine(main.id), vol: +($event.target as HTMLInputElement).value })" />
              </label>
            </div>
          </section>

          <section v-if="main" class="card card-pad stack-sm">
            <div class="row gap">
              <h3 class="panel-title grow" style="margin: 0"><Icon name="list-music" /> Очередь <span class="faint small">{{ main.queue.length }}</span></h3>
            </div>
            <AddMedia v-if="canControl" :rid="rid" :tid="main.id" :api-key="apiKey" />
            <RoomQueue :rid="rid" :track="main" :can-control="canControl" :durations="durations" />
          </section>

          <section class="stack-sm">
            <div class="row gap">
              <h3 class="panel-title grow" style="margin: 0"><Icon name="audio-lines" /> Дополнительные дорожки</h3>
              <button v-if="canControl" class="btn btn-sm" @click="newLayer"><Icon name="plus" :size="14" /> Дорожка</button>
            </div>
            <p v-if="!layers.length" class="faint small" style="margin: 0">Фон поверх музыки: дождь, шум таверны, битва. Каждая дорожка играет одновременно с основной, со своей громкостью и повтором.</p>
            <div class="layers">
              <template v-if="unlocked">
                <RoomLayer v-for="t in layers" :key="t.id" ref="layerRefs" :rid="rid" :track="t" :can-control="canControl" :offset="offset" :master="personal.master"
                  :personal="mine(t.id)" :api-key="apiKey" @personal="(p) => setMine(t.id, p)" @blocked="blocked = true" />
              </template>
              <div v-else-if="layers.length" class="faint small">Дорожек: {{ layers.length }} — появятся после подключения.</div>
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="card card-pad">
            <h3 class="panel-title"><Icon name="users" /> Слушают <span class="faint small">{{ present.length }}</span></h3>
            <div v-for="l in present" :key="l.uid" class="who">
              <span class="avatar round" style="width: 28px; height: 28px"><img v-if="l.photoURL" :src="l.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="14" /></span>
              <span class="grow ellipsis">{{ l.displayName }}<span v-if="l.uid === uid" class="faint"> (вы)</span></span>
              <span v-if="l.uid === room.ownerId" class="badge">владелец</span>
              <span v-else-if="room.hostUids.includes(l.uid)" class="badge badge-public">ведущий</span>
              <Dropdown v-if="isOwner && l.uid !== room.ownerId" placement="bottom-end">
                <template #trigger><button class="icon-btn" style="width: 24px; height: 24px"><Icon name="more-horizontal" :size="14" /></button></template>
                <div class="menu"><button class="menu-item" @click="toggleHost(l)"><Icon name="crown" :size="15" /> {{ room.hostUids.includes(l.uid) ? 'Снять ведущего' : 'Сделать ведущим' }}</button></div>
              </Dropdown>
            </div>
          </section>
          <section class="card card-pad">
            <h3 class="panel-title"><Icon name="messages-square" /> Чат</h3>
            <RoomChat :rid="rid" :is-host="isHost" />
          </section>
        </aside>
      </div>

      <RoomSettings v-if="settingsOpen" :room="room" :is-owner="isOwner" @close="settingsOpen = false" />
    </template>
  </div>
</template>

<style scoped>
.room-page { max-width: 1280px; margin: 0 auto; padding: 18px 24px 60px; }
.room-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.room-head h1 { margin: 0; font-size: 32px; display: flex; align-items: center; gap: 10px; }
.room-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
.main-card { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.player-wrap { position: relative; aspect-ratio: 16 / 9; background: #000; border-radius: 10px; overflow: hidden; }
.gate { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 16px;
  background: radial-gradient(ellipse at center, rgb(40 34 26 / 92%), rgb(12 10 8 / 96%)); color: #f2eadb; }
.now { display: flex; align-items: center; gap: 10px; }
.now-title { font: 700 19px var(--font-head); color: var(--text); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seek { display: flex; align-items: center; gap: 8px; }
.seek input { flex: 1; accent-color: var(--accent); }
.controls { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.play-btn { width: 46px; height: 46px; border-radius: 50%; border: 0; background: var(--accent); color: var(--accent-fg); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.play-btn:disabled { opacity: .5; cursor: not-allowed; }
.vol { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); }
.vol input[type=range] { width: 100px; accent-color: var(--accent); }
.master input[type=range] { width: 90px; }
.layers { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.who { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
@media (max-width: 1000px) { .room-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .room-page { padding: 12px 12px 50px; }
  .room-head h1 { font-size: 24px; }
  .vol input[type=range] { width: 80px; }
  .layers { grid-template-columns: minmax(0, 1fr); }
}
</style>
