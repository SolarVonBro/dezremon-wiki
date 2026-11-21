<script setup lang="ts">
// One synchronized YouTube player for one room track. It keeps the video where the shared track state says
// (interval start + position + elapsed × speed, see ./timing.ts) and reports when an item ends or fails.
// A transparent layer covers the video: a click/tap on it toggles playback for everybody (if you may control),
// so YouTube's own play/pause indicator on top of the picture works as a button.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadYouTubeApi, YT_STATE } from './youtube'
import { expectedTime, itemEnd, itemRate, itemStart } from './timing'
import Icon from '@/components/common/Icon.vue'
import type { RoomTrack } from '@/model/types'

const props = withDefaults(defineProps<{
  track: RoomTrack
  /** server time = Date.now() + offset */
  offset: number
  /** effective volume 0..100 (track volume × personal volume × master) */
  volume: number
  muted: boolean
  mini?: boolean
  /** may this user start/stop the track (click on the video) */
  canControl?: boolean
}>(), { mini: false, canControl: false })
const emit = defineEmits<{
  ended: [itemId: string, rev: number]
  duration: [videoId: string, seconds: number]
  failed: [itemId: string, rev: number, code: number]
  blocked: []
  toggle: []
}>()

const host = ref<HTMLElement | null>(null)
let player: any = null
let ready = false
let loadedVideo: string | null = null
let reportedFor = ''
let blockedTimer: ReturnType<typeof setTimeout> | null = null
const durations = new Map<string, number>()
const item = computed(() => props.track.queue.find((x) => x.id === props.track.current) ?? null)

function durationOf(videoId: string | undefined) { return (videoId && (durations.get(videoId) || props.track.queue.find((x) => x.videoId === videoId)?.duration)) || 0 }
/** a single item that repeats is looped by every client locally, without writes */
const loopsLocally = computed(() => props.track.loop === 'one' || (props.track.loop === 'all' && props.track.queue.length === 1))
const serverNow = () => Date.now() + props.offset
const endOf = () => itemEnd(item.value, durationOf(item.value?.videoId))
function expected(): number { return expectedTime(props.track, item.value, durationOf(item.value?.videoId), serverNow(), loopsLocally.value) }
/** video seconds since the item's start (what track.position stores) */
function expectedRel(): number { return Math.max(0, expected() - itemStart(item.value)) }

function sync(strict: boolean) {
  if (!ready || !player) return
  const it = item.value
  if (!it) {
    if (loadedVideo) { player.stopVideo(); loadedVideo = null }
    return
  }
  const exp = expected()
  if (loadedVideo !== it.videoId) {
    loadedVideo = it.videoId
    if (props.track.playing) { player.loadVideoById({ videoId: it.videoId, startSeconds: exp }); watchBlocked() } else player.cueVideoById({ videoId: it.videoId, startSeconds: exp })
    player.setPlaybackRate?.(itemRate(it))
    return
  }
  if (player.getPlaybackRate?.() !== itemRate(it)) player.setPlaybackRate?.(itemRate(it))
  const state = player.getPlayerState?.()
  const cur = player.getCurrentTime?.() || 0
  const end = endOf()
  if (props.track.playing) {
    const pastEnd = end > 0 && exp >= end - 0.3 && !loopsLocally.value
    if (!pastEnd && Math.abs(cur - exp) > (strict ? 0.7 : 1.6) * Math.max(1, itemRate(it))) player.seekTo(exp, true)
    if (state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING && state !== YT_STATE.ENDED) { player.playVideo(); watchBlocked() }
  } else {
    if (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING) player.pauseVideo()
    if (Math.abs(cur - exp) > 0.5) player.seekTo(exp, true)
  }
}

/** The item reached the end of its interval (or the video): loop it locally, or ask the room to move on. */
function reachedEnd() {
  const it = item.value
  if (!it) return
  if (loopsLocally.value) { player.seekTo(itemStart(it), true); player.playVideo(); return }
  const key = `${it.id}:${props.track.rev}`
  if (props.track.playing && reportedFor !== key) { reportedFor = key; emit('ended', it.id, props.track.rev) }
}

/** Browsers refuse audible autoplay before the user interacted with the page: tell the room to ask for a click. */
function watchBlocked() {
  if (blockedTimer) clearTimeout(blockedTimer)
  blockedTimer = setTimeout(() => {
    const s = player?.getPlayerState?.()
    if (props.track.playing && (s === YT_STATE.UNSTARTED || s === YT_STATE.CUED)) emit('blocked')
  }, 2500)
}

function applyVolume() {
  if (!ready || !player) return
  player.setVolume(Math.round(Math.max(0, Math.min(100, props.volume))))
  if (props.muted || props.volume <= 0) player.mute(); else player.unMute()
}

function onState(e: { data: number }) {
  const it = item.value
  if (!it) return
  if (e.data === YT_STATE.PLAYING) {
    const d = player.getDuration?.() || 0
    if (d > 0 && durations.get(it.videoId) !== d) { durations.set(it.videoId, d); emit('duration', it.videoId, d) }
    if (player.getPlaybackRate?.() !== itemRate(it)) player.setPlaybackRate?.(itemRate(it))
  }
  if (e.data === YT_STATE.ENDED) reachedEnd()
}
function onError(e: { data: number }) {
  const it = item.value
  if (!it) return
  const key = `${it.id}:${props.track.rev}`
  if (reportedFor !== key) { reportedFor = key; emit('failed', it.id, props.track.rev, e.data) }
}

let drift: ReturnType<typeof setInterval> | null = null
let endWatch: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  const YT = await loadYouTubeApi()
  if (!host.value) return
  player = new YT.Player(host.value, {
    width: '100%', height: '100%',
    playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, autoplay: 0 },
    events: {
      onReady: () => { ready = true; applyVolume(); sync(true) },
      onStateChange: onState,
      onError,
    },
  })
  drift = setInterval(() => { if (props.track.playing) sync(false) }, 3000)
  // a custom end inside the video is not reported by YouTube: watch the playhead ourselves
  endWatch = setInterval(() => {
    if (!ready || !player || !props.track.playing || !item.value || player.getPlayerState?.() !== YT_STATE.PLAYING) return
    const end = endOf()
    const d = durationOf(item.value.videoId)
    if (end > 0 && (!d || end < d - 0.5) && (player.getCurrentTime?.() || 0) >= end - 0.1) reachedEnd()
  }, 250)
})
onBeforeUnmount(() => {
  if (drift) clearInterval(drift)
  if (endWatch) clearInterval(endWatch)
  if (blockedTimer) clearTimeout(blockedTimer)
  try { player?.destroy() } catch { /* already gone */ }
  player = null
})

watch(() => [props.track.current, props.track.playing, props.track.position, props.track.at, props.track.rev, item.value?.videoId, item.value?.start, item.value?.end, item.value?.rate], () => sync(true))
watch(() => [props.volume, props.muted], applyVolume)
watch(() => props.offset, () => sync(false))

/** Called after a user gesture (the "connect" click) so the browser lets audio start. */
function kick() { if (ready && props.track.playing) { player.playVideo(); sync(true) } }
defineExpose({ kick, expected, expectedRel })
</script>

<template>
  <div class="rplayer" :class="{ mini }">
    <div ref="host" />
    <button type="button" class="shield" :class="{ clickable: canControl && !!item }"
      :title="!item ? '' : canControl ? (track.playing ? 'Пауза для всех' : 'Включить для всех') : 'Музыкой управляют ведущие комнаты'"
      :aria-label="track.playing ? 'Пауза' : 'Играть'" @click="canControl && item && emit('toggle')">
      <span v-if="canControl && item" class="shield-icon"><Icon :name="track.playing ? 'pause' : 'play'" :size="mini ? 22 : 42" /></span>
    </button>
    <div v-if="!item" class="rp-empty"><slot name="empty" /></div>
  </div>
</template>

<style scoped>
.rplayer { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 10px; overflow: hidden; }
.rplayer.mini { border-radius: 8px; }
.rplayer :deep(iframe) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.shield { position: absolute; inset: 0; z-index: 2; border: 0; padding: 0; background: transparent; cursor: default; display: flex; align-items: center; justify-content: center; }
.shield.clickable { cursor: pointer; }
.shield-icon { display: inline-flex; align-items: center; justify-content: center; color: #fff; background: rgb(0 0 0 / 45%); border-radius: 50%; padding: 14px; opacity: 0; transition: opacity .15s; }
.mini .shield-icon { padding: 7px; }
.shield.clickable:hover .shield-icon, .shield.clickable:focus-visible .shield-icon { opacity: 1; }
.rp-empty { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;
  background: radial-gradient(ellipse at center, #2a2520, #111); color: rgb(255 255 255 / 70%); font-size: 14px; }
</style>
