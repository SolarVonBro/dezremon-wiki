<script setup lang="ts">
// Saved playlists of the room ("Бой", "Таверна", "Город"…) in the room's side panel. Clicking a song plays the
// playlist from it: the track then goes through the playlist itself like a queue (edits apply live; the
// track's own queue stays as it was). Rows are reordered by dragging the grip.
import { computed, ref } from 'vue'
import { useSession } from '@/stores/session'
import {
  addToPlaylist, appendPlaylistToQueue, createPlaylist, deletePlaylist, editPlaylistItem, movePlaylistItemTo, playFromPlaylist,
  removeFromPlaylist, renamePlaylist, type ItemPatch,
} from '@/data/rooms'
import { errorText, plural } from '@/data/util'
import { formatTime, thumbUrl } from './youtube'
import { timingLabel } from './timing'
import { useDragSort } from './dragSort'
import AddMedia from './AddMedia.vue'
import ItemEditor from './ItemEditor.vue'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { toast } from '@/components/common/toast'
import type { QueueItem, RoomPlaylist, RoomTrack } from '@/model/types'

const props = defineProps<{
  rid: string
  playlists: RoomPlaylist[]
  tracks: RoomTrack[]
  canControl: boolean
  apiKey: string
  /** video time of the main track right now (re-anchoring when the playing song's start/speed changes) */
  mainNowTime: () => number
}>()
const session = useSession()
const uid = () => session.user!.uid
const run = async (p: Promise<unknown>, ok?: string) => {
  try { await p; if (ok) toast.success(ok) } catch (e) { toast.error('Не получилось: ' + errorText(e)) }
}

const openId = ref<string | null>(null)
const open = computed(() => props.playlists.find((p) => p.id === openId.value) ?? null)
const main = computed(() => props.tracks.find((t) => t.kind === 'main') ?? null)
const layers = computed(() => props.tracks.filter((t) => t.kind !== 'main'))
/** tracks going through this playlist right now */
const playersOf = (pid: string) => props.tracks.filter((t) => t.playlistId === pid)
/** where a click on a song plays: the track already playing this playlist (music first), else the music */
const targetOf = (pid: string) => [...playersOf(pid)].sort((a, b) => (a.kind === 'main' ? -1 : 0) - (b.kind === 'main' ? -1 : 0))[0] ?? main.value
const playingIn = (pid: string, itemId: string) => playersOf(pid).find((t) => t.current === itemId) ?? null
const total = (p: RoomPlaylist) => p.items.reduce((s, x) => s + (x.duration || 0), 0)
const countText = (p: RoomPlaylist) => `${p.items.length} ${plural(p.items.length, 'трек', 'трека', 'треков')}${total(p) ? ' · ' + formatTime(total(p)) : ''}`

// ---------- create ----------
const newName = ref('')
const creating = ref(false)
async function create() {
  const name = newName.value.trim()
  if (!name || !session.user) return
  try {
    openId.value = await createPlaylist(props.rid, session.user, name, [], props.playlists.length)
    newName.value = ''
    creating.value = false
  } catch (e) { toast.error('Не получилось: ' + errorText(e)) }
}
async function saveQueue() {
  const name = prompt('Название плейлиста из текущей очереди музыки:', 'Мой плейлист')
  if (!name?.trim() || !session.user || !main.value) return
  await run(createPlaylist(props.rid, session.user, name.trim(), main.value.queue, props.playlists.length), `Очередь сохранена как «${name.trim()}»`)
}

// ---------- play ----------
function playFrom(p: RoomPlaylist, itemId: string | null, t: RoomTrack | null = targetOf(p.id)) {
  if (!t || !props.canControl) return
  const first = itemId ?? (t.shuffle && p.items.length ? p.items[Math.floor(Math.random() * p.items.length)].id : p.items[0]?.id)
  if (!first) { toast.info('Плейлист пуст — сначала добавьте в него музыку'); return }
  void run(playFromPlaylist(props.rid, t.id, uid(), p.id, first))
}
function appendToQueue(p: RoomPlaylist) {
  if (main.value) void run(appendPlaylistToQueue(props.rid, main.value.id, uid(), p), 'Добавлено в очередь музыки')
}
function rename(p: RoomPlaylist) {
  const n = prompt('Новое название плейлиста:', p.name)
  if (n && n.trim() && n.trim() !== p.name) void run(renamePlaylist(props.rid, p.id, n.trim()))
}
function remove(p: RoomPlaylist) {
  const playing = playersOf(p.id).length
  if (!confirm(`Удалить плейлист «${p.name}»?${playing ? ' Он сейчас играет — музыка остановится.' : ''}`)) return
  if (openId.value === p.id) openId.value = null
  void run(deletePlaylist(props.rid, p.id, uid(), props.tracks))
}

// ---------- songs ----------
const intoOpen = (items: QueueItem[]) => addToPlaylist(props.rid, openId.value!, uid(), items)
const drag = useDragSort((from, to) => {
  const p = open.value
  const it = p?.items[from]
  if (p && it) void run(movePlaylistItemTo(props.rid, p.id, uid(), it.id, to))
})
function removeSong(p: RoomPlaylist, it: QueueItem) {
  void run(removeFromPlaylist(props.rid, p.id, uid(), it.id, playersOf(p.id).map((t) => t.id)))
}
const editing = ref<QueueItem | null>(null)
function saveItem(patch: ItemPatch) {
  const it = editing.value
  const p = open.value
  if (!it || !p) return
  editing.value = null
  const m = main.value
  const reanchor = m && m.playlistId === p.id && m.current === it.id ? { tid: m.id, itemId: it.id, videoTimeNow: props.mainNowTime() } : undefined
  void run(editPlaylistItem(props.rid, p.id, uid(), it.id, patch, playersOf(p.id).map((t) => t.id), reanchor))
}
</script>

<template>
  <div class="pls">
    <div class="row gap-sm">
      <h3 class="panel-title grow" style="margin: 0"><Icon name="list-video" /> Плейлисты</h3>
      <template v-if="canControl && !open">
        <button class="icon-btn" title="Сохранить очередь музыки как плейлист" :disabled="!main?.queue.length" @click="saveQueue"><Icon name="save" :size="16" /></button>
        <button class="icon-btn" title="Новый плейлист" @click="creating = !creating"><Icon name="plus" :size="17" /></button>
      </template>
    </div>

    <!-- ============ one playlist ============ -->
    <template v-if="open">
      <div class="row gap-sm">
        <button class="icon-btn" title="Ко всем плейлистам" @click="openId = null"><Icon name="arrow-left" :size="16" /></button>
        <div class="grow" style="min-width: 0">
          <b class="pl-title" :title="canControl ? 'Переименовать' : ''" @click="canControl && rename(open)">{{ open.name }}</b>
          <div class="faint small">{{ countText(open) }}<template v-if="playersOf(open.id).length"> · играет</template></div>
        </div>
        <template v-if="canControl">
          <button class="icon-btn" title="Играть плейлист с начала" :disabled="!open.items.length" @click="playFrom(open, null)"><Icon name="play" :size="17" /></button>
          <Dropdown placement="bottom-end">
            <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" :size="16" /></button></template>
            <div class="menu">
              <button v-for="t in layers" :key="t.id" class="menu-item" :disabled="!open.items.length" @click="playFrom(open, null, t)"><Icon name="audio-lines" :size="15" /> Играть на «{{ t.name }}»</button>
              <button class="menu-item" :disabled="!open.items.length" @click="appendToQueue(open)"><Icon name="list-plus" :size="15" /> Скопировать в очередь музыки</button>
              <div class="menu-sep" />
              <button class="menu-item" @click="rename(open)"><Icon name="pencil" :size="15" /> Переименовать</button>
              <button class="menu-item danger" @click="remove(open)"><Icon name="trash2" :size="15" /> Удалить плейлист</button>
            </div>
          </Dropdown>
        </template>
      </div>
      <AddMedia v-if="canControl" :rid="rid" :target="intoOpen" :api-key="apiKey" compact placeholder="Ссылка YouTube в этот плейлист…" />
      <div v-if="!open.items.length" class="faint small" style="padding: 4px 2px">Плейлист пуст.{{ canControl ? ' Добавьте ссылки выше.' : '' }}</div>
      <div class="pl-list" @pointerdown="canControl && drag.onPointerDown($event)">
        <div v-for="(it, i) in open.items" :key="it.id" class="pl-item" :class="{ cur: !!playingIn(open.id, it.id), clickable: canControl }" data-sort-row
          :title="canControl ? 'Играть с этого трека' : it.title" @click="playFrom(open, it.id)">
          <span v-if="canControl && open.items.length > 1" class="grip" data-drag-handle title="Перетащите, чтобы поменять порядок" @click.stop><Icon name="grip-vertical" :size="15" /></span>
          <span class="n">{{ playingIn(open.id, it.id) ? '' : i + 1 }}<Icon v-if="playingIn(open.id, it.id)" :name="playingIn(open.id, it.id)!.playing ? 'audio-lines' : 'pause'" :size="13" /></span>
          <img :src="thumbUrl(it.videoId)" alt="" loading="lazy" draggable="false" />
          <div class="grow" style="min-width: 0">
            <div class="pl-item-title">{{ it.title || it.videoId }}</div>
            <div v-if="timingLabel(it, formatTime) || it.duration" class="faint small">
              <template v-if="it.duration">{{ formatTime(it.duration) }}</template>
              <span v-if="timingLabel(it, formatTime)" class="timing">{{ timingLabel(it, formatTime) }}</span>
            </div>
          </div>
          <template v-if="canControl">
            <button class="icon-btn sm" title="Название, интервал и скорость" @click.stop="editing = it"><Icon name="pencil" :size="13" /></button>
            <button class="icon-btn sm" title="Убрать из плейлиста" @click.stop="removeSong(open, it)"><Icon name="x" :size="13" /></button>
          </template>
        </div>
      </div>
      <ItemEditor v-if="editing" :item="editing" :duration="editing.duration || 0" @save="saveItem" @close="editing = null" />
    </template>

    <!-- ============ all playlists ============ -->
    <template v-else>
      <form v-if="creating && canControl" class="row gap-sm" @submit.prevent="create">
        <input v-model="newName" class="input input-sm grow" maxlength="60" placeholder="Бой, Таверна, Город…" autofocus />
        <button class="btn btn-sm btn-primary" :disabled="!newName.trim()">Создать</button>
      </form>
      <p v-if="!playlists.length" class="faint small" style="margin: 0">
        Соберите плейлисты заранее — «Бой», «Таверна», «Исследование» — и включайте на игре одним нажатием: музыка пойдёт по плейлисту, как по очереди.
      </p>
      <div v-for="p in playlists" :key="p.id" class="pl-row" :class="{ playing: playersOf(p.id).length }" @click="openId = p.id">
        <Icon :name="playersOf(p.id).some((t) => t.playing) ? 'audio-lines' : 'list-music'" :size="18" class="pl-ico" />
        <div class="grow" style="min-width: 0">
          <div class="ellipsis"><b>{{ p.name }}</b></div>
          <div class="faint small ellipsis">{{ countText(p) }}<template v-if="playersOf(p.id).length"> · играет<template v-if="playersOf(p.id)[0].kind !== 'main'"> на «{{ playersOf(p.id)[0].name }}»</template></template></div>
        </div>
        <button v-if="canControl" class="icon-btn" title="Играть плейлист с начала" :disabled="!p.items.length" @click.stop="playFrom(p, null)"><Icon name="play" :size="16" /></button>
        <Icon v-else name="chevron-right" :size="16" class="faint" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pls { display: flex; flex-direction: column; gap: 8px; }
.pl-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
.pl-row:hover { border-color: var(--accent); background: var(--surface-2); }
.pl-row.playing { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); background: var(--accent-soft); }
.pl-ico { color: var(--accent); }
.pl-title { display: block; font: 700 18px var(--font-head); overflow-wrap: break-word; line-height: 1.15; }
.pl-list { display: flex; flex-direction: column; gap: 2px; }
.pl-item { display: flex; align-items: center; gap: 6px; padding: 4px 4px; border-radius: 8px; user-select: none; }
.pl-item.clickable { cursor: pointer; }
.pl-item:hover { background: var(--surface-2); }
.pl-item.cur { background: var(--accent-soft); }
.pl-item img { width: 44px; height: 25px; object-fit: cover; border-radius: 3px; flex-shrink: 0; }
.grip { width: 16px; height: 28px; }
.n { width: 18px; text-align: center; font-size: 12px; color: var(--accent); flex-shrink: 0; }
.pl-item-title { font-size: 13px; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.icon-btn.sm { width: 26px; height: 26px; flex-shrink: 0; }
.timing { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 6px; background: var(--accent-soft); color: var(--text-muted); font-size: 11px; }
</style>
