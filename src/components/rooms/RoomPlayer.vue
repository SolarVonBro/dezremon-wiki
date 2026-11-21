<script setup lang="ts">
// One synchronized YouTube player for one room track. It never decides anything itself: it keeps the video at
// the position the shared track state says (see src/data/rooms.ts) and reports when a video ends or fails.
// The video is covered by a transparent layer: playback is controlled only through the room's own controls.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadYouTubeApi, YT_STATE } from './youtube'
import type { RoomTrack } from '@/model/types'

const props = withDefaults(defineProps<{
  track: RoomTrack
  /** server time = Date.now() + offset */
  offset: number
  /** effective volume 0..100 (track volume × personal volume × master) */
  volume: number
  muted: boolean
  mini?: boolean
}>(), { mini: false })
const emit = defineEmits<{
  ended: [itemId: string, rev: number]
  duration: [videoId: string, seconds: number]
  failed: [itemId: string, rev: number, code: number]
  blocked: []
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

function expected(): number {
  const t = props.track
  let pos = t.playing ? t.position + Math.max(0, Date.now() + props.offset - t.at) / 1000 : t.position
  const d = durationOf(item.value?.videoId)
  if (d > 1 && loopsLocally.value) pos %= d
  return pos
}

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
    return
  }
  const state = player.getPlayerState?.()
  const cur = player.getCurrentTime?.() || 0
  if (props.track.playing) {
    const d = durationOf(it.videoId)
    if (!(d && exp >= d - 0.5 && !loopsLocally.value) && Math.abs(cur - exp) > (strict ? 0.7 : 1.6)) player.seekTo(exp, true)
    if (state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING && state !== YT_STATE.ENDED) { player.playVideo(); watchBlocked() }
  } else {
    if (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING) player.pauseVideo()
    if (Math.abs(cur - exp) > 0.5) player.seekTo(exp, true)
  }
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
  }
  if (e.data === YT_STATE.ENDED) {
    if (loopsLocally.value) { player.seekTo(0, true); player.playVideo(); return }
    const key = `${it.id}:${props.track.rev}`
    if (props.track.playing && reportedFor !== key) { reportedFor = key; emit('ended', it.id, props.track.rev) }
  }
}
function onError(e: { data: number }) {
  const it = item.value
  if (!it) return
  const key = `${it.id}:${props.track.rev}`
  if (reportedFor !== key) { reportedFor = key; emit('failed', it.id, props.track.rev, e.data) }
}

let drift: ReturnType<typeof setInterval> | null = null
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
})
onBeforeUnmount(() => {
  if (drift) clearInterval(drift)
  if (blockedTimer) clearTimeout(blockedTimer)
  try { player?.destroy() } catch { /* already gone */ }
  player = null
})

watch(() => [props.track.current, props.track.playing, props.track.position, props.track.at, props.track.rev, item.value?.videoId], () => sync(true))
watch(() => [props.volume, props.muted], applyVolume)
watch(() => props.offset, () => sync(false))

/** Called after a user gesture (the "connect" click) so the browser lets audio start. */
function kick() { if (ready && props.track.playing) { player.playVideo(); sync(true) } }
defineExpose({ kick, expected })
</script>

<template>
  <div class="rplayer" :class="{ mini }">
    <div ref="host" />
    <div class="shield" />
    <div v-if="!item" class="rp-empty"><slot name="empty" /></div>
  </div>
</template>

<style scoped>
.rplayer { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 10px; overflow: hidden; }
.rplayer.mini { border-radius: 8px; }
.rplayer :deep(iframe) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.shield { position: absolute; inset: 0; z-index: 2; }
.rp-empty { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;
  background: radial-gradient(ellipse at center, #2a2520, #111); color: rgb(255 255 255 / 70%); font-size: 14px; }
</style>
