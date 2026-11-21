<script setup lang="ts">
// An extra track playing on top of the music (rain, tavern noise, battle drums…): its own synchronized player,
// room volume (for everybody), personal volume, repeat mode and a small queue.
import { errorText } from '@/data/util'
import { computed, ref } from 'vue'
import { useSession } from '@/stores/session'
import { advanceAfterEnd, playItem, removeTrack, setPlayback, setTrackProps } from '@/data/rooms'
import RoomPlayer from './RoomPlayer.vue'
import RoomQueue from './RoomQueue.vue'
import AddMedia from './AddMedia.vue'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import type { LoopMode, QueueItem, RoomTrack } from '@/model/types'

const props = defineProps<{
  rid: string; track: RoomTrack; canControl: boolean; offset: number; master: number; personal: { vol: number; muted: boolean }; apiKey: string
  /** what the track goes through: its queue or a saved playlist (itemsOf) */
  items: QueueItem[]
  /** name of the saved playlist it plays ('' = its own queue) */
  playlistName: string
}>()
const emit = defineEmits<{ personal: [p: { vol: number; muted: boolean }]; blocked: [] }>()
const session = useSession()
const player = ref<InstanceType<typeof RoomPlayer> | null>(null)
const renaming = ref(false)
const name = ref(props.track.name)
const showQueue = ref(false)

const item = computed(() => props.items.find((x) => x.id === props.track.current) ?? null)
const effective = computed(() => (props.track.volume * props.personal.vol * props.master) / 10000)
const run = (p: Promise<unknown>) => p.catch((e) => toast.error('Не получилось: ' + errorText(e)))
const uid = () => session.user!.uid

function togglePlay() {
  const pos = player.value?.expectedRel() ?? props.track.position
  void run(setPlayback(props.rid, props.track.id, uid(), !props.track.playing, pos))
}
const LOOPS: LoopMode[] = ['one', 'all', 'off']
const LOOP_LABEL: Record<LoopMode, string> = { one: 'повтор трека', all: 'повтор очереди', off: 'без повтора' }
function cycleLoop() { void run(setTrackProps(props.rid, props.track.id, uid(), { loop: LOOPS[(LOOPS.indexOf(props.track.loop) + 1) % LOOPS.length] })) }
function saveName() {
  renaming.value = false
  if (name.value.trim() && name.value.trim() !== props.track.name) void run(setTrackProps(props.rid, props.track.id, uid(), { name: name.value.trim() }))
}
function remove() { if (confirm(`Удалить дорожку «${props.track.name}»?`)) void run(removeTrack(props.rid, props.track.id)) }
let volTimer: ReturnType<typeof setTimeout> | null = null
function roomVolume(v: number) {
  if (volTimer) clearTimeout(volTimer)
  volTimer = setTimeout(() => { void run(setTrackProps(props.rid, props.track.id, uid(), { volume: v })) }, 350)
}
function onFailed(id: string, rev: number) {
  toast.error(`Видео на дорожке «${props.track.name}» не воспроизводится (запрещено встраивание или удалено)`)
  void run(advanceAfterEnd(props.rid, props.track.id, uid(), id, rev))
}
defineExpose({ kick: () => player.value?.kick() })
</script>

<template>
  <article class="layer card">
    <header class="row gap-sm">
      <Icon name="audio-lines" :size="16" :style="{ color: track.playing ? 'var(--accent)' : 'var(--text-faint)' }" />
      <input v-if="renaming" v-model="name" class="input input-sm grow" maxlength="60" autofocus @blur="saveName" @keydown.enter="saveName" />
      <b v-else class="grow ellipsis" :title="canControl ? 'Двойной щелчок — переименовать' : ''" @dblclick="canControl && (renaming = true)">{{ track.name }}</b>
      <button v-if="canControl" class="icon-btn" title="Удалить дорожку" @click="remove"><Icon name="trash2" :size="14" /></button>
    </header>
    <div class="layer-main">
      <RoomPlayer ref="player" :track="track" :items="items" :offset="offset" :volume="effective" :muted="personal.muted" mini class="layer-player" :can-control="canControl" @toggle="togglePlay"
        @ended="(id, rev) => run(advanceAfterEnd(rid, track.id, uid(), id, rev))" @blocked="emit('blocked')" @failed="onFailed">
        <template #empty><span class="small">Пусто</span></template>
      </RoomPlayer>
      <div class="grow layer-ctl" style="min-width: 0">
        <div class="small ellipsis" :title="item?.title">{{ item?.title || (track.playlistId ? 'Плейлист закончился' : 'Добавьте видео ниже') }}</div>
        <div v-if="track.playlistId" class="faint small ellipsis"><Icon name="list-video" :size="12" /> плейлист «{{ playlistName || '…' }}»
          <button v-if="canControl && track.queue.length" class="linkish" title="Играть очередь дорожки" @click="run(playItem(rid, track.id, uid(), track.queue[0].id))">к очереди</button></div>
        <div class="row gap-sm">
          <button class="icon-btn" :disabled="!canControl || !item" :title="track.playing ? 'Пауза для всех' : 'Включить для всех'" @click="togglePlay"><Icon :name="track.playing ? 'pause' : 'play'" :size="17" /></button>
          <button class="icon-btn" :class="{ on: track.loop !== 'off' }" :disabled="!canControl" :title="'Повтор: ' + LOOP_LABEL[track.loop]" @click="cycleLoop"><Icon :name="track.loop === 'one' ? 'repeat-1' : 'repeat'" :size="16" /></button>
          <button class="icon-btn" :class="{ on: showQueue }" title="Очередь дорожки" @click="showQueue = !showQueue"><Icon name="list-music" :size="16" /><span class="small">{{ track.queue.length }}</span></button>
        </div>
      </div>
    </div>
    <label v-if="canControl" class="vol" title="Громкость дорожки для всех">
      <Icon name="users" :size="14" /><input type="range" min="0" max="100" :value="track.volume" @input="roomVolume(+($event.target as HTMLInputElement).value)" /><span class="faint small">{{ track.volume }}</span>
    </label>
    <label class="vol" title="Моя громкость этой дорожки">
      <button class="icon-btn" style="width: 24px; height: 24px" :title="personal.muted ? 'Включить у меня' : 'Выключить у меня'" @click.prevent="emit('personal', { ...personal, muted: !personal.muted })">
        <Icon :name="personal.muted ? 'volume-x' : 'volume-2'" :size="14" />
      </button>
      <input type="range" min="0" max="100" :value="personal.vol" @input="emit('personal', { ...personal, vol: +($event.target as HTMLInputElement).value })" /><span class="faint small">моя</span>
    </label>
    <div v-if="showQueue || !track.queue.length" class="stack-sm" style="margin-top: 4px">
      <RoomQueue :rid="rid" :track="track" :can-control="canControl" compact :now-time="() => player?.expected() ?? 0" />
      <AddMedia v-if="canControl" :rid="rid" :tid="track.id" :api-key="apiKey" compact placeholder="Ссылка YouTube для этой дорожки…" />
    </div>
  </article>
</template>

<style scoped>
.layer { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.layer-main { display: flex; gap: 10px; align-items: center; }
.layer-player { width: 128px; flex-shrink: 0; }
.layer-ctl { display: flex; flex-direction: column; gap: 2px; }
.linkish { border: 0; background: none; padding: 0 0 0 4px; color: var(--link); cursor: pointer; font: inherit; text-decoration: underline; }
.vol { display: flex; align-items: center; gap: 6px; color: var(--text-muted); }
.vol input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); }
</style>
