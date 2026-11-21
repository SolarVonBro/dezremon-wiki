<script setup lang="ts">
import { errorText } from '@/data/util'
import { useSession } from '@/stores/session'
import { clearQueue, moveItem, playItem, removeItem } from '@/data/rooms'
import { formatTime, thumbUrl, watchUrl } from './youtube'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import type { RoomTrack } from '@/model/types'

const props = withDefaults(defineProps<{ rid: string; track: RoomTrack; canControl: boolean; compact?: boolean; durations?: Record<string, number> }>(), { compact: false, durations: () => ({}) })
const session = useSession()
const uid = () => session.user!.uid
const run = (p: Promise<unknown>) => p.catch((e) => toast.error('Не получилось: ' + errorText(e)))
function clear() { if (confirm('Очистить очередь этой дорожки?')) void run(clearQueue(props.rid, props.track.id, uid())) }
</script>

<template>
  <div class="queue" :class="{ compact }">
    <div v-if="!track.queue.length" class="faint small q-empty">Очередь пуста.</div>
    <div v-for="(it, i) in track.queue" :key="it.id" class="q-item" :class="{ cur: it.id === track.current }">
      <span class="q-n faint">{{ it.id === track.current ? '' : i + 1 }}<Icon v-if="it.id === track.current" :name="track.playing ? 'audio-lines' : 'pause'" :size="14" /></span>
      <img v-if="!compact" :src="thumbUrl(it.videoId)" alt="" loading="lazy" />
      <div class="grow" style="min-width: 0">
        <a class="q-title" :href="watchUrl(it.videoId)" target="_blank" rel="noopener" :title="it.title">{{ it.title || it.videoId }}</a>
        <div v-if="!compact" class="faint small">{{ it.addedByName }}<template v-if="it.duration || durations[it.videoId]"> · {{ formatTime(it.duration || durations[it.videoId]) }}</template></div>
      </div>
      <template v-if="canControl">
        <button v-if="it.id !== track.current || !track.playing" class="icon-btn" title="Включить" @click="run(playItem(rid, track.id, uid(), it.id))"><Icon name="play" :size="14" /></button>
        <template v-if="!compact">
          <button class="icon-btn" title="Выше" :disabled="i === 0" @click="run(moveItem(rid, track.id, uid(), it.id, -1))"><Icon name="arrow-up" :size="14" /></button>
          <button class="icon-btn" title="Ниже" :disabled="i === track.queue.length - 1" @click="run(moveItem(rid, track.id, uid(), it.id, 1))"><Icon name="arrow-down" :size="14" /></button>
        </template>
        <button class="icon-btn" title="Убрать из очереди" @click="run(removeItem(rid, track.id, uid(), it.id))"><Icon name="x" :size="14" /></button>
      </template>
    </div>
    <button v-if="canControl && track.queue.length > 1 && !compact" class="btn btn-ghost btn-sm" style="align-self: flex-start" @click="clear"><Icon name="trash2" :size="13" /> Очистить очередь</button>
  </div>
</template>

<style scoped>
.queue { display: flex; flex-direction: column; gap: 2px; }
.q-empty { padding: 6px 2px; }
.q-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 8px; }
.q-item:hover { background: var(--surface-2); }
.q-item.cur { background: var(--accent-soft); }
.q-item img { width: 64px; height: 36px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.q-n { width: 20px; text-align: center; font-size: 12px; flex-shrink: 0; color: var(--accent); }
.q-title { display: block; color: var(--text); font-size: 14px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compact .q-title { font-size: 13px; }
.compact .q-item { padding: 2px 4px; }
.compact .icon-btn { width: 26px; height: 26px; }
</style>
