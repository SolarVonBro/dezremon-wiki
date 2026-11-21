<script setup lang="ts">
// Adds music to a track: a YouTube link (video or playlist) or, with an API key configured, a search.
import { errorText } from '@/data/util'
import { ref } from 'vue'
import { useSession } from '@/stores/session'
import { addItems, makeItem } from '@/data/rooms'
import { fetchTitle, fetchTitles, formatTime, parseYouTube, playlistIdsViaPlayer, playlistViaApi, searchYouTube, thumbUrl, type SearchResult } from './youtube'
import Icon from '@/components/common/Icon.vue'
import type { QueueItem } from '@/model/types'
import { toast } from '@/components/common/toast'

const props = withDefaults(defineProps<{
  rid: string
  /** track whose queue receives the items… */
  tid?: string
  /** …or any other receiver (a saved playlist); then there is no "play now" */
  target?: (items: QueueItem[]) => Promise<void>
  apiKey: string
  compact?: boolean
  placeholder?: string
}>(), { tid: '', compact: false, placeholder: '' })
const session = useSession()
const text = ref('')
const busy = ref('')
const results = ref<SearchResult[] | null>(null)

async function add(list: Array<{ videoId: string; title: string; duration: number }>, playNow = false) {
  const u = session.user
  if (!u || !list.length) return
  const items = list.map((x) => makeItem(x.videoId, x.title, x.duration, u))
  if (props.target) await props.target(items)
  else await addItems(props.rid, props.tid, u.uid, items, playNow)
}

async function submit() {
  const s = text.value.trim()
  if (!s || busy.value) return
  const p = parseYouTube(s)
  try {
    if (p?.listId && (!p.videoId || confirm('Это ссылка на плейлист. Добавить весь плейлист? (Отмена — только это видео)'))) {
      busy.value = 'Загружаю плейлист…'
      let list: Array<{ videoId: string; title: string; duration: number }>
      if (props.apiKey) list = await playlistViaApi(p.listId, props.apiKey)
      else {
        const ids = (await playlistIdsViaPlayer(p.listId)).slice(0, 200)
        busy.value = `Названия: 0 / ${ids.length}…`
        const titles = await fetchTitles(ids)
        list = ids.map((id) => ({ videoId: id, title: titles.get(id) ?? '', duration: 0 }))
      }
      if (list.length > 60 && !confirm(`В плейлисте ${list.length} видео. Добавить все?`)) return
      await add(list)
      toast.success(`Добавлено: ${list.length}`)
      text.value = ''
    } else if (p?.videoId) {
      busy.value = 'Добавляю…'
      await add([{ videoId: p.videoId, title: await fetchTitle(p.videoId), duration: 0 }])
      text.value = ''
    } else if (props.apiKey) {
      busy.value = 'Ищу…'
      results.value = await searchYouTube(s, props.apiKey)
    } else {
      toast.info('Вставьте ссылку на видео или плейлист YouTube. Поиск включает администратор сервиса (ключ YouTube API).')
    }
  } catch (e: any) { toast.error(errorText(e)) } finally { busy.value = '' }
}
async function pick(r: SearchResult, playNow: boolean) {
  try { await add([r], playNow); toast.success(playNow ? 'Включено' : props.target ? 'Добавлено в плейлист' : 'Добавлено в очередь') } catch (e: any) { toast.error(errorText(e)) }
}
</script>

<template>
  <div class="addm">
    <form class="row gap-sm" @submit.prevent="submit">
      <input v-model="text" class="input" :class="{ 'input-sm': compact }" :placeholder="placeholder || (apiKey ? 'Ссылка YouTube или поиск…' : 'Ссылка на видео или плейлист YouTube…')" />
      <button class="btn btn-primary" :class="{ 'btn-sm': compact }" :disabled="!!busy || !text.trim()">
        <Icon :name="busy ? 'refresh-cw' : parseYouTube(text) || !apiKey ? 'plus' : 'search'" :size="15" :class="{ spin: !!busy }" /><span v-if="!compact" class="hide-sm"> {{ parseYouTube(text) || !apiKey ? 'Добавить' : 'Найти' }}</span>
      </button>
    </form>
    <div v-if="busy" class="faint small" style="margin-top: 4px">{{ busy }}</div>
    <div v-if="results" class="results">
      <div class="row gap" style="margin-bottom: 4px"><b class="grow small">Найдено: {{ results.length }}</b><button class="icon-btn" title="Закрыть" @click="results = null"><Icon name="x" :size="14" /></button></div>
      <div v-for="r in results" :key="r.videoId" class="res">
        <img :src="thumbUrl(r.videoId)" alt="" loading="lazy" />
        <div class="grow" style="min-width: 0">
          <div class="res-title">{{ r.title }}</div>
          <div class="faint small">{{ r.channel }}<template v-if="r.duration"> · {{ formatTime(r.duration) }}</template></div>
        </div>
        <button v-if="!target" class="icon-btn" title="Включить сейчас" @click="pick(r, true)"><Icon name="play" :size="16" /></button>
        <button class="icon-btn" :title="target ? 'Добавить в плейлист' : 'В очередь'" @click="pick(r, false)"><Icon name="list-plus" :size="16" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.results { margin-top: 8px; border: 1px solid var(--border); border-radius: 10px; padding: 6px; max-height: 380px; overflow-y: auto; background: var(--surface); }
.res { display: flex; align-items: center; gap: 8px; padding: 4px; border-radius: 6px; }
.res:hover { background: var(--surface-2); }
.res img { width: 72px; height: 40px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.res-title { font-size: 13.5px; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
