<script setup lang="ts">
// Playlists of the room in the side panel — the music always plays one of them (there is no separate queue).
// One playlist is always open (the switcher in the header changes it); new music goes into it from the add field
// above the player. Clicking a song plays the playlist from it; edits apply live. Rows are reordered by dragging.
import { computed, ref } from 'vue'
import { useSession } from '@/stores/session'
import {
  createPlaylist, deletePlaylist, editPlaylistItem, movePlaylistItemTo, playFromPlaylist,
  removeFromPlaylist, renamePlaylist, type ItemPatch,
} from '@/data/rooms'
import { errorText, plural } from '@/data/util'
import { formatTime, thumbUrl, watchUrl } from './youtube'
import { timingLabel } from './timing'
import { useDragSort } from './dragSort'
import ItemEditor from './ItemEditor.vue'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { toast } from '@/components/common/toast'
import type { QueueItem, RoomPlaylist, RoomTrack } from '@/model/types'

const props = defineProps<{
  rid: string
  playlists: RoomPlaylist[]
  /** the playlist shown (chosen by the room page, remembered per browser) */
  open: RoomPlaylist | null
  tracks: RoomTrack[]
  canControl: boolean
  /** video time of the main track right now (re-anchoring when the playing song's start/speed changes) */
  mainNowTime: () => number
}>()
const emit = defineEmits<{ select: [pid: string] }>()
const session = useSession()
const uid = () => session.user!.uid
const run = async (p: Promise<unknown>, ok?: string) => {
  try { await p; if (ok) toast.success(ok) } catch (e) { toast.error('Не получилось: ' + errorText(e)) }
}

const main = computed(() => props.tracks.find((t) => t.kind === 'main') ?? null)
const layers = computed(() => props.tracks.filter((t) => t.kind !== 'main'))
/** tracks going through this playlist right now */
const playersOf = (pid: string) => props.tracks.filter((t) => t.playlistId === pid)
/** where a click on a song plays: the track already playing this playlist (music first), else the music */
const targetOf = (pid: string) => [...playersOf(pid)].sort((a, b) => (a.kind === 'main' ? -1 : 0) - (b.kind === 'main' ? -1 : 0))[0] ?? main.value
const playingIn = (pid: string, itemId: string) => playersOf(pid).find((t) => t.current === itemId) ?? null
const total = (p: RoomPlaylist) => p.items.reduce((s, x) => s + (x.duration || 0), 0)
const countText = (p: RoomPlaylist) => `${p.items.length} ${plural(p.items.length, 'трек', 'трека', 'треков')}${total(p) ? ' · ' + formatTime(total(p)) : ''}`

// ---------- playlists ----------
async function create() {
  const name = prompt('Название нового плейлиста (например: Бой, Таверна, Город):', '')
  if (!name?.trim() || !session.user) return
  try { emit('select', await createPlaylist(props.rid, session.me!, name.trim(), [], props.playlists.length)) } catch (e) { toast.error('Не получилось: ' + errorText(e)) }
}
function playFrom(p: RoomPlaylist, itemId: string | null, t: RoomTrack | null = targetOf(p.id)) {
  if (!t || !props.canControl) return
  const first = itemId ?? (t.shuffle && p.items.length ? p.items[Math.floor(Math.random() * p.items.length)].id : p.items[0]?.id)
  if (!first) { toast.info('Плейлист пуст — добавьте музыку через поле над плеером'); return }
  void run(playFromPlaylist(props.rid, t.id, uid(), p.id, first))
}
function rename(p: RoomPlaylist) {
  const n = prompt('Новое название плейлиста:', p.name)
  if (n && n.trim() && n.trim() !== p.name) void run(renamePlaylist(props.rid, p.id, n.trim()))
}
function remove(p: RoomPlaylist) {
  if (props.playlists.length < 2) { toast.info('Это единственный плейлист комнаты — его можно переименовать или очистить'); return }
  const playing = playersOf(p.id).length
  if (!confirm(`Удалить плейлист «${p.name}»?${playing ? ' Он сейчас играет — музыка остановится.' : ''}`)) return
  const next = props.playlists.find((x) => x.id !== p.id)
  if (next) emit('select', next.id)
  void run(deletePlaylist(props.rid, p.id, uid(), props.tracks))
}

// ---------- songs ----------
const drag = useDragSort((from, to) => {
  const p = props.open
  const it = p?.items[from]
  if (p && it) void run(movePlaylistItemTo(props.rid, p.id, uid(), it.id, to))
})
function removeSong(p: RoomPlaylist, it: QueueItem) {
  void run(removeFromPlaylist(props.rid, p.id, uid(), it.id, playersOf(p.id).map((t) => t.id)))
}
const editing = ref<QueueItem | null>(null)
function saveItem(patch: ItemPatch) {
  const it = editing.value
  const p = props.open
  if (!it || !p) return
  editing.value = null
  const m = main.value
  const reanchor = m && m.playlistId === p.id && m.current === it.id ? { tid: m.id, itemId: it.id, videoTimeNow: props.mainNowTime() } : undefined
  void run(editPlaylistItem(props.rid, p.id, uid(), it.id, patch, playersOf(p.id).map((t) => t.id), reanchor))
}
</script>

<template>
  <div class="pls">
    <div class="pls-head">
      <Icon name="list-video" :size="20" class="pl-ico" />
      <Dropdown placement="bottom-start">
        <template #trigger>
          <button class="switcher" :title="'Плейлисты комнаты: ' + playlists.length">
            <span class="ellipsis">{{ open?.name ?? 'Плейлисты' }}</span><Icon name="chevron-down" :size="16" />
          </button>
        </template>
        <div class="menu menu-scroll" style="min-width: 240px">
          <div class="menu-label">Плейлисты комнаты</div>
          <button v-for="p in playlists" :key="p.id" class="menu-item" :class="{ on: p.id === open?.id }" @click="emit('select', p.id)">
            <Icon :name="playersOf(p.id).some((t) => t.playing) ? 'audio-lines' : 'list-music'" :size="15" />
            <span class="grow ellipsis">{{ p.name }}</span><span class="faint small">{{ p.items.length }}</span>
          </button>
          <template v-if="canControl">
            <div class="menu-sep" />
            <button class="menu-item" @click="create"><Icon name="plus" :size="15" /> Новый плейлист</button>
          </template>
        </div>
      </Dropdown>
      <span class="grow" />
      <template v-if="canControl && open">
        <button class="icon-btn" title="Играть плейлист с начала" :disabled="!open.items.length" @click="playFrom(open, null)"><Icon name="play" :size="18" /></button>
        <Dropdown placement="bottom-end">
          <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" :size="17" /></button></template>
          <div class="menu">
            <button v-for="t in layers" :key="t.id" class="menu-item" :disabled="!open.items.length" @click="playFrom(open, null, t)"><Icon name="audio-lines" :size="15" /> Играть на «{{ t.name }}»</button>
            <div class="menu-sep" />
            <button class="menu-item" @click="rename(open)"><Icon name="pencil" :size="15" /> Переименовать</button>
            <button class="menu-item danger" :disabled="playlists.length < 2" @click="remove(open)"><Icon name="trash2" :size="15" /> Удалить плейлист</button>
          </div>
        </Dropdown>
      </template>
    </div>

    <template v-if="open">
      <div class="faint small">{{ countText(open) }}<template v-if="playersOf(open.id).length"> · <b class="playing-now">играет</b><template v-if="playersOf(open.id)[0].kind !== 'main'"> на «{{ playersOf(open.id)[0].name }}»</template></template></div>
      <div v-if="!open.items.length" class="faint small empty-pl">Плейлист пуст.<template v-if="canControl"> Вставьте ссылку YouTube в поле над плеером — она попадёт сюда.</template></div>
      <div class="pl-list" @pointerdown="canControl && drag.onPointerDown($event)">
        <div v-for="(it, i) in open.items" :key="it.id" class="pl-item" :class="{ cur: !!playingIn(open.id, it.id), clickable: canControl }" data-sort-row
          :title="canControl ? 'Играть с этого трека' : it.title" @click="playFrom(open, it.id)">
          <span v-if="canControl && open.items.length > 1" class="grip" data-drag-handle title="Перетащите, чтобы поменять порядок" @click.stop><Icon name="grip-vertical" :size="16" /></span>
          <div class="thumb">
            <img :src="thumbUrl(it.videoId)" alt="" loading="lazy" draggable="false" />
            <span v-if="playingIn(open.id, it.id)" class="thumb-badge"><Icon :name="playingIn(open.id, it.id)!.playing ? 'audio-lines' : 'pause'" :size="18" /></span>
            <span v-else class="thumb-n">{{ i + 1 }}</span>
          </div>
          <div class="grow" style="min-width: 0">
            <div class="pl-item-title">{{ it.title || it.videoId }}</div>
            <div class="faint small">
              <template v-if="it.duration">{{ formatTime(it.duration) }}</template>
              <span v-if="timingLabel(it, formatTime)" class="timing">{{ timingLabel(it, formatTime) }}</span>
            </div>
          </div>
          <div class="pl-actions">
            <a class="icon-btn sm" :href="watchUrl(it.videoId)" target="_blank" rel="noopener" title="Открыть на YouTube" @click.stop><Icon name="external-link" :size="13" /></a>
            <template v-if="canControl">
              <button class="icon-btn sm" title="Название, интервал и скорость" @click.stop="editing = it"><Icon name="pencil" :size="14" /></button>
              <button class="icon-btn sm" title="Убрать из плейлиста" @click.stop="removeSong(open, it)"><Icon name="x" :size="14" /></button>
            </template>
          </div>
        </div>
      </div>
      <ItemEditor v-if="editing" :item="editing" :duration="editing.duration || 0" @save="saveItem" @close="editing = null" />
    </template>
    <div v-else class="faint small empty-pl">{{ canControl ? 'Создаю плейлист…' : 'Плейлистов пока нет.' }}</div>
  </div>
</template>

<style scoped>
.pls { display: flex; flex-direction: column; gap: 10px; }
.pls-head { display: flex; align-items: center; gap: 6px; }
.pl-ico { color: var(--accent); flex-shrink: 0; }
.switcher { display: inline-flex; align-items: center; gap: 4px; max-width: 250px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 4px 8px 4px 10px; cursor: pointer; color: var(--text); font: 700 19px var(--font-head); }
.switcher:hover { border-color: var(--accent); }
.playing-now { color: var(--accent); }
.empty-pl { padding: 10px 2px; }
.pl-list { display: flex; flex-direction: column; gap: 4px; }
.pl-item { display: flex; align-items: center; gap: 10px; padding: 5px 6px; border-radius: 10px; user-select: none; }
.pl-item.clickable { cursor: pointer; }
.pl-item:hover { background: var(--surface-2); }
.pl-item.cur { background: var(--accent-soft); }
.thumb { position: relative; width: 104px; height: 58px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #000; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-n { position: absolute; left: 4px; bottom: 3px; font-size: 11px; font-weight: 700; color: #fff; background: rgb(0 0 0 / 60%); border-radius: 4px; padding: 0 5px; }
.thumb-badge { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent) 55%, rgb(0 0 0 / 30%)); color: #fff; }
.grip { width: 16px; height: 40px; margin-right: -4px; }
.pl-item-title { font-size: 14px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.pl-actions { display: flex; flex-direction: column; gap: 0; flex-shrink: 0; }
.icon-btn.sm { width: 26px; height: 24px; }
.timing { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 6px; background: var(--accent-soft); color: var(--text-muted); font-size: 11px; }
@media (min-width: 1001px) { .pl-actions { opacity: .55; } .pl-item:hover .pl-actions { opacity: 1; } }
</style>
