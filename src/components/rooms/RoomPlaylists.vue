<script setup lang="ts">
// Saved playlists of the room ("Бой", "Таверна", "Город"…): build them once, then put one on the music or on an
// extra track with one click. Everybody in the room sees them; whoever controls the music edits them.
import { computed, onBeforeUnmount, ref } from 'vue'
import { useSession } from '@/stores/session'
import {
  createPlaylist, deletePlaylist, loadPlaylist, movePlaylistItem, removeFromPlaylist, renamePlaylist, addToPlaylist, watchPlaylists,
} from '@/data/rooms'
import { errorText, plural } from '@/data/util'
import { formatTime, thumbUrl, watchUrl } from './youtube'
import AddMedia from './AddMedia.vue'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { toast } from '@/components/common/toast'
import type { QueueItem, RoomPlaylist, RoomTrack } from '@/model/types'

const props = defineProps<{ rid: string; tracks: RoomTrack[]; canControl: boolean; apiKey: string }>()
const session = useSession()
const rows = ref<RoomPlaylist[]>([])
const stop = watchPlaylists(props.rid, (r) => { rows.value = r })
onBeforeUnmount(stop)

const openId = ref<string | null>(null)
const open = computed(() => rows.value.find((p) => p.id === openId.value) ?? null)
const main = computed(() => props.tracks.find((t) => t.kind === 'main') ?? null)
const layers = computed(() => props.tracks.filter((t) => t.kind !== 'main'))
const uid = () => session.user!.uid
const run = async (p: Promise<unknown>, ok?: string) => {
  try { await p; if (ok) toast.success(ok) } catch (e) { toast.error('Не получилось: ' + errorText(e)) }
}
const total = (p: RoomPlaylist) => p.items.reduce((s, x) => s + (x.duration || 0), 0)
const countText = (p: RoomPlaylist) => `${p.items.length} ${plural(p.items.length, 'трек', 'трека', 'треков')}${total(p) ? ' · ' + formatTime(total(p)) : ''}`

// ---------- create ----------
const newName = ref('')
const creating = ref(false)
async function create(fromQueue = false) {
  const name = fromQueue ? prompt('Название плейлиста из текущей очереди:', main.value?.playlistName || 'Мой плейлист') : newName.value.trim()
  if (!name || !session.user) return
  try {
    const id = await createPlaylist(props.rid, session.user, name.trim(), fromQueue ? (main.value?.queue ?? []) : [], rows.value.length)
    newName.value = ''
    creating.value = false
    if (!fromQueue) openId.value = id
    else toast.success(`Очередь сохранена как «${name.trim()}»`)
  } catch (e) { toast.error('Не получилось: ' + errorText(e)) }
}

// ---------- play ----------
function play(p: RoomPlaylist, t: RoomTrack | null, mode: 'replace' | 'append') {
  if (!t) return
  if (!p.items.length) { toast.info('Плейлист пуст — сначала добавьте в него музыку'); return }
  if (mode === 'replace' && t.queue.length && !confirm(`Включить «${p.name}» на дорожке «${t.name}»? Текущая очередь дорожки будет заменена.`)) return
  void run(loadPlaylist(props.rid, t.id, uid(), p, mode), mode === 'replace' ? `Играет «${p.name}»` : 'Добавлено в очередь')
}
function rename(p: RoomPlaylist) {
  const n = prompt('Новое название плейлиста:', p.name)
  if (n && n.trim() && n.trim() !== p.name) void run(renamePlaylist(props.rid, p.id, n.trim()))
}
function remove(p: RoomPlaylist) {
  if (!confirm(`Удалить плейлист «${p.name}»? Очереди дорожек это не затронет.`)) return
  if (openId.value === p.id) openId.value = null
  void run(deletePlaylist(props.rid, p.id))
}
const intoOpen = (items: QueueItem[]) => addToPlaylist(props.rid, openId.value!, items)
</script>

<template>
  <div class="pls">
    <!-- ============ one playlist ============ -->
    <template v-if="open">
      <div class="row gap-sm wrap">
        <button class="icon-btn" title="Ко всем плейлистам" @click="openId = null"><Icon name="arrow-left" :size="16" /></button>
        <b class="grow pl-title" :title="canControl ? 'Переименовать' : ''" @click="canControl && rename(open)">{{ open.name }}</b>
        <span class="faint small">{{ countText(open) }}</span>
      </div>
      <div v-if="canControl" class="row gap-sm wrap">
        <button class="btn btn-sm btn-primary" :disabled="!open.items.length" @click="play(open, main, 'replace')"><Icon name="play" :size="14" /> Включить</button>
        <button class="btn btn-sm" :disabled="!open.items.length" @click="play(open, main, 'append')"><Icon name="list-plus" :size="14" /> В очередь</button>
        <Dropdown v-if="layers.length" placement="bottom-start">
          <template #trigger><button class="btn btn-sm btn-ghost" :disabled="!open.items.length"><Icon name="audio-lines" :size="14" /> На дорожку…</button></template>
          <div class="menu"><button v-for="t in layers" :key="t.id" class="menu-item" @click="play(open, t, 'replace')"><Icon name="audio-lines" :size="15" /> {{ t.name }}</button></div>
        </Dropdown>
        <span class="grow" />
        <button class="icon-btn" title="Удалить плейлист" @click="remove(open)"><Icon name="trash2" :size="15" /></button>
      </div>
      <AddMedia v-if="canControl" :rid="rid" :target="intoOpen" :api-key="apiKey" placeholder="Ссылка на видео или плейлист YouTube — в этот плейлист…" />
      <div v-if="!open.items.length" class="faint small" style="padding: 6px 2px">Плейлист пуст.{{ canControl ? ' Добавьте ссылки выше.' : '' }}</div>
      <div v-for="(it, i) in open.items" :key="it.id" class="pl-item">
        <span class="faint small n">{{ i + 1 }}</span>
        <img :src="thumbUrl(it.videoId)" alt="" loading="lazy" />
        <div class="grow" style="min-width: 0">
          <a class="pl-item-title" :href="watchUrl(it.videoId)" target="_blank" rel="noopener" :title="it.title">{{ it.title || it.videoId }}</a>
          <div class="faint small">{{ it.addedByName }}<template v-if="it.duration"> · {{ formatTime(it.duration) }}</template></div>
        </div>
        <template v-if="canControl">
          <button class="icon-btn" title="Выше" :disabled="i === 0" @click="run(movePlaylistItem(rid, open.id, it.id, -1))"><Icon name="arrow-up" :size="14" /></button>
          <button class="icon-btn" title="Ниже" :disabled="i === open.items.length - 1" @click="run(movePlaylistItem(rid, open.id, it.id, 1))"><Icon name="arrow-down" :size="14" /></button>
          <button class="icon-btn" title="Убрать из плейлиста" @click="run(removeFromPlaylist(rid, open.id, it.id))"><Icon name="x" :size="14" /></button>
        </template>
      </div>
    </template>

    <!-- ============ all playlists ============ -->
    <template v-else>
      <div v-if="canControl" class="row gap-sm wrap">
        <form v-if="creating" class="row gap-sm grow" @submit.prevent="create(false)">
          <input v-model="newName" class="input input-sm grow" maxlength="60" placeholder="Название: Бой, Таверна, Город…" autofocus />
          <button class="btn btn-sm btn-primary" :disabled="!newName.trim()">Создать</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="creating = false">Отмена</button>
        </form>
        <template v-else>
          <button class="btn btn-sm btn-primary" @click="creating = true"><Icon name="plus" :size="14" /> Новый плейлист</button>
          <button class="btn btn-sm" :disabled="!main?.queue.length" title="Сохранить нынешнюю очередь музыки как плейлист" @click="create(true)"><Icon name="save" :size="14" /> Сохранить очередь</button>
        </template>
      </div>
      <p v-if="!rows.length" class="faint small" style="margin: 4px 0 0">
        Плейлистов пока нет. Соберите их заранее — «Бой», «Таверна», «Исследование» — и включайте на игре одним нажатием, на музыке или на дополнительной дорожке.
      </p>
      <div v-for="p in rows" :key="p.id" class="pl-row" @click="openId = p.id">
        <Icon name="list-music" :size="18" class="pl-ico" />
        <div class="grow" style="min-width: 0">
          <div class="ellipsis"><b>{{ p.name }}</b></div>
          <div class="faint small ellipsis">{{ countText(p) }} · {{ p.createdByName }}</div>
        </div>
        <template v-if="canControl">
          <button class="icon-btn" title="Включить вместо очереди музыки" :disabled="!p.items.length" @click.stop="play(p, main, 'replace')"><Icon name="play" :size="16" /></button>
          <span @click.stop><Dropdown placement="bottom-end">
            <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" :size="16" /></button></template>
            <div class="menu">
              <button class="menu-item" :disabled="!p.items.length" @click="play(p, main, 'append')"><Icon name="list-plus" :size="15" /> Добавить в очередь музыки</button>
              <button v-for="t in layers" :key="t.id" class="menu-item" :disabled="!p.items.length" @click="play(p, t, 'replace')"><Icon name="audio-lines" :size="15" /> Включить на «{{ t.name }}»</button>
              <div class="menu-sep" />
              <button class="menu-item" @click="rename(p)"><Icon name="pencil" :size="15" /> Переименовать</button>
              <button class="menu-item danger" @click="remove(p)"><Icon name="trash2" :size="15" /> Удалить</button>
            </div>
          </Dropdown></span>
        </template>
        <Icon v-else name="chevron-right" :size="16" class="faint" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pls { display: flex; flex-direction: column; gap: 8px; }
.pl-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
.pl-row:hover { border-color: var(--accent); background: var(--surface-2); }
.pl-ico { color: var(--accent); }
.pl-title { font: 700 19px var(--font-head); min-width: 0; overflow-wrap: break-word; cursor: default; }
.pl-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 8px; }
.pl-item:hover { background: var(--surface-2); }
.pl-item img { width: 64px; height: 36px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.pl-item .n { width: 20px; text-align: center; flex-shrink: 0; }
.pl-item-title { display: block; color: var(--text); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
