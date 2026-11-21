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
  PRESENCE_TTL, Presence, addToPlaylist, addTrack, advanceAfterEnd, ensureDefaultPlaylist, enterRoom, itemsOf, migrateQueueToPlaylist, playFromPlaylist, roomUrl,
  setPlayback, setTrackProps, skip, updateRoom,
  watchListeners, watchPlaylists, watchRoom, watchTracks,
} from '@/data/rooms'
import RoomPlayer from '@/components/rooms/RoomPlayer.vue'
import RoomPlaylists from '@/components/rooms/RoomPlaylists.vue'
import RoomLayer from '@/components/rooms/RoomLayer.vue'
import RoomChat from '@/components/rooms/RoomChat.vue'
import RoomSettings from '@/components/rooms/RoomSettings.vue'
import AddMedia from '@/components/rooms/AddMedia.vue'
import { formatTime, watchUrl } from '@/components/rooms/youtube'
import { expectedTime, itemEnd, itemStart } from '@/components/rooms/timing'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { toast } from '@/components/common/toast'
import type { LoopMode, QueueItem, Room, RoomListener, RoomPlaylist, RoomTrack } from '@/model/types'

const route = useRoute()
const router = useRouter()
const session = useSession()
const rid = route.params.rid as string

const room = ref<Room | null | undefined>(undefined)
const tracks = ref<RoomTrack[]>([])
const playlists = ref<RoomPlaylist[]>([])
const playlistsLoaded = ref(false)
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
  stops.push(watchPlaylists(rid, (r) => { playlists.value = r; playlistsLoaded.value = true }))
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
/** what a track goes through: its queue, or the saved playlist it plays */
const itemsOfTrack = (t: RoomTrack) => itemsOf(t, playlists.value)
const playlistName = (pid: string | null | undefined) => (pid ? playlists.value.find((p) => p.id === pid)?.name ?? '' : '')

// ---------- the playlist open in the side panel (always one; remembered in this browser) ----------
const OPEN_KEY = `dw.room.${rid}.playlist`
const openPlaylistId = ref<string | null>((() => { try { return localStorage.getItem(OPEN_KEY) } catch { return null } })())
const openPlaylist = computed(() => playlists.value.find((p) => p.id === openPlaylistId.value)
  ?? playlists.value.find((p) => p.id === main.value?.playlistId) ?? playlists.value[0] ?? null)
function selectPlaylist(pid: string) {
  openPlaylistId.value = pid
  try { localStorage.setItem(OPEN_KEY, pid) } catch { /* private mode */ }
}
// older rooms have no playlists yet: whoever controls the music creates the default one
watch(() => [playlistsLoaded.value, playlists.value.length, canControl.value] as const, ([loaded, n, can]) => {
  if (loaded && !n && can && session.user) void ensureDefaultPlaylist(rid, session.user).catch(() => {})
}, { immediate: true })
// rooms made while the music had its own queue: it moves into «Основной» (once, by whoever controls the music)
let migrated = false
watch(() => [main.value?.queue.length ?? 0, canControl.value] as const, ([n, can]) => {
  if (n && can && !migrated && main.value && session.user) { migrated = true; void migrateQueueToPlaylist(rid, main.value.id, session.user).catch(() => { migrated = false }) }
}, { immediate: true })

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
type Personal = { tracks: Record<string, { vol: number; muted: boolean }> }
const PKEY = `dw.room.${rid}`
const DEFAULT_PERSONAL: Personal = { tracks: {} }
function readPersonal(): Personal { try { return { ...DEFAULT_PERSONAL, ...JSON.parse(localStorage.getItem(PKEY) ?? '{}') } } catch { return { ...DEFAULT_PERSONAL } } }
const personal = ref<Personal>(readPersonal())
watch(personal, (p) => { try { localStorage.setItem(PKEY, JSON.stringify(p)) } catch { /* private mode */ } }, { deep: true })
const mine = (tid: string) => personal.value.tracks[tid] ?? { vol: 100, muted: false }
function setMine(tid: string, p: { vol: number; muted: boolean }) { personal.value.tracks = { ...personal.value.tracks, [tid]: p } }

// ---------- main track controls ----------
const durations = ref<Record<string, number>>({})
const mainItems = computed(() => (main.value ? itemsOfTrack(main.value) : []))
const mainItem = computed(() => mainItems.value.find((x) => x.id === main.value!.current) ?? null)
const mainDuration = computed(() => (mainItem.value ? mainItem.value.duration || durations.value[mainItem.value.videoId] || 0 : 0))
const mainStart = computed(() => itemStart(mainItem.value))
const mainEnd = computed(() => itemEnd(mainItem.value, mainDuration.value))
/** video time everybody hears right now (inside the item's interval) */
const position = computed(() => {
  void tick.value
  const t = main.value
  if (!t) return 0
  const loops = t.loop === 'one' || (t.loop === 'all' && mainItems.value.length === 1)
  const v = expectedTime(t, mainItem.value, mainDuration.value, Date.now() + offset.value, loops)
  return mainEnd.value ? Math.min(v, mainEnd.value) : v
})
const run = (p: Promise<unknown>) => p.catch((e) => toast.error('Не получилось: ' + errorText(e)))
function togglePlay() { if (main.value) void run(setPlayback(rid, main.value.id, uid.value, !main.value.playing, Math.max(0, position.value - mainStart.value))) }
function seek(v: number) { if (main.value) void run(setPlayback(rid, main.value.id, uid.value, main.value.playing, Math.max(0, v - mainStart.value))) }
function skipBy(dir: 1 | -1) {
  const t = main.value
  if (!t) return
  if (dir === -1 && position.value - mainStart.value > 5) { seek(mainStart.value); return }
  void run(skip(rid, t.id, uid.value, t, mainItems.value, dir))
}
// ---------- one add field for the open playlist and the queue ----------
/**
 * The add field above the player: new music goes into the playlist open in the side panel. If nothing is playing
 * (or "play now" was pressed) the music starts going through that playlist from the new song.
 */
async function addMusic(items: QueueItem[], playNow: boolean) {
  const m = main.value
  const pl = openPlaylist.value
  if (!m || !pl || !items.length) { toast.info('Плейлист ещё создаётся — попробуйте через секунду'); return }
  await addToPlaylist(rid, pl.id, uid.value, items)
  if (playNow || !mainItem.value) await playFromPlaylist(rid, m.id, uid.value, pl.id, items[0].id)
}
const addLabel = computed(() => (openPlaylist.value ? `в «${openPlaylist.value.name}»` : 'в плейлист'))

const LOOPS: LoopMode[] = ['all', 'one', 'off']
const LOOP_LABEL: Record<LoopMode, string> = { all: 'Повтор плейлиста', one: 'Повтор трека', off: 'Без повтора' }
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
        <button class="btn btn-sm" @click="copyLink"><Icon name="link" :size="14" /><span class="hide-sm"> Пригласить</span></button>
        <button v-if="isHost" class="btn btn-sm btn-ghost" title="Настройки комнаты" @click="settingsOpen = true"><Icon name="settings" :size="15" /></button>
      </header>

      <div class="room-grid">
        <div class="room-main">
          <!-- one field for new music: it goes into the playlist open in the side panel -->
          <section v-if="canControl && main" class="card add-card s-add">
            <AddMedia :rid="rid" :target="addMusic" allow-play-now :target-label="addLabel" :api-key="apiKey"
              :placeholder="apiKey ? 'Ссылка YouTube или поиск…' : 'Ссылка на видео или плейлист YouTube…'" />
            <div class="faint small"><Icon name="list-video" :size="13" /> Добавится в плейлист <b>«{{ openPlaylist?.name ?? '…' }}»</b> — другой выбирается в панели плейлистов.</div>
          </section>
          <!-- main track -->
          <section v-if="main" class="card main-card s-player">
            <div class="player-wrap">
              <RoomPlayer v-if="unlocked" ref="mainPlayer" :track="main" :items="mainItems" :offset="offset" :volume="(main.volume * mine(main.id).vol) / 100" :muted="mine(main.id).muted"
                :can-control="canControl" @toggle="togglePlay"
                @ended="(id, rev) => onEnded(main!, id, rev)" @failed="(id, rev, code) => onFailed(main!, id, rev, code)" @duration="(v, d) => (durations = { ...durations, [v]: d })" @blocked="blocked = true">
                <template #empty>{{ main.playlistId ? 'Плейлист закончился или пуст.' : 'Ничего не играет — добавьте видео выше или выберите трек в плейлисте.' }}</template>
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
                <div v-if="mainItem" class="faint small">из плейлиста «{{ playlistName(main.playlistId) || '…' }}» · добавил(а) {{ mainItem.addedByName }}<template v-if="(mainItem.rate ?? 1) !== 1"> · скорость ×{{ mainItem.rate }}</template></div>
              </div>
            </div>
            <div class="seek">
              <span class="small faint">{{ formatTime(position) }}</span>
              <input type="range" :min="mainStart" :max="Math.max(mainStart + 1, mainEnd)" step="1" :value="mainEnd ? position : mainStart" :disabled="!canControl || !mainEnd" @change="seek(+($event.target as HTMLInputElement).value)" />
              <span class="small faint">{{ mainEnd ? formatTime(mainEnd) : '--:--' }}</span>
            </div>
            <div class="controls">
              <button class="icon-btn" :disabled="!canControl || !mainItems.length" title="Назад" @click="skipBy(-1)"><Icon name="skip-back" :size="18" /></button>
              <button class="play-btn" :disabled="!canControl || !mainItem" :title="main.playing ? 'Пауза для всех' : 'Играть для всех'" @click="togglePlay"><Icon :name="main.playing ? 'pause' : 'play'" :size="22" /></button>
              <button class="icon-btn" :disabled="!canControl || !mainItems.length" title="Дальше" @click="skipBy(1)"><Icon name="skip-forward" :size="18" /></button>
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

          <section class="stack-sm s-layers">
            <div class="row gap">
              <h3 class="panel-title grow" style="margin: 0"><Icon name="audio-lines" /> Дополнительные дорожки</h3>
              <button v-if="canControl" class="btn btn-sm" @click="newLayer"><Icon name="plus" :size="14" /> Дорожка</button>
            </div>
            <p v-if="!layers.length" class="faint small" style="margin: 0">Фон поверх музыки: дождь, шум таверны, битва. Каждая дорожка играет одновременно с основной, со своей громкостью и повтором.</p>
            <div class="layers">
              <template v-if="unlocked">
                <RoomLayer v-for="t in layers" :key="t.id" ref="layerRefs" :rid="rid" :track="t" :items="itemsOfTrack(t)" :playlist-name="playlistName(t.playlistId)" :can-control="canControl" :offset="offset" :master="100"
                  :personal="mine(t.id)" :api-key="apiKey" @personal="(p) => setMine(t.id, p)" @blocked="blocked = true" />
              </template>
              <div v-else-if="layers.length" class="faint small">Дорожек: {{ layers.length }} — появятся после подключения.</div>
            </div>
          </section>

          <section class="card card-pad s-chat">
            <h3 class="panel-title"><Icon name="messages-square" /> Чат</h3>
            <RoomChat :rid="rid" :is-host="isHost" />
          </section>
        </div>

        <aside class="room-side">
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
            <RoomPlaylists :rid="rid" :playlists="playlists" :open="openPlaylist" :tracks="tracks" :can-control="canControl" :main-now-time="() => position" @select="selectPlaylist" />
          </section>
        </aside>
      </div>

      <RoomSettings v-if="settingsOpen" :room="room" :is-owner="isOwner" @close="settingsOpen = false" />
    </template>
  </div>
</template>

<style scoped>
.room-page { max-width: 1380px; margin: 0 auto; padding: 18px 24px 60px; }
.room-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.room-head h1 { margin: 0; font-size: 32px; display: flex; align-items: center; gap: 10px; }
.room-grid { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 18px; align-items: start; }
.add-card { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.add-to { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.add-to .chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.room-main, .room-side { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
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
.layers { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.who { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
/* one column: add field, player, then the side panel (listeners, playlists), extra tracks, chat at the very bottom */
@media (max-width: 1000px) {
  .room-grid { display: flex; flex-direction: column; align-items: stretch; gap: 18px; }
  .room-main { display: contents; }
  .s-add { order: 1; }
  .s-player { order: 2; }
  .room-side { order: 4; }
  .s-layers { order: 5; }
  .s-chat { order: 6; }
}
@media (max-width: 720px) {
  .room-page { padding: 12px 12px 50px; }
  .room-head h1 { font-size: 24px; }
  .vol input[type=range] { width: 80px; }
  .layers { grid-template-columns: minmax(0, 1fr); }
}
</style>
