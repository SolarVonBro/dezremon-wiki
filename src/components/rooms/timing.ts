// Timing of one queue item inside a room track: an optional interval [start, end) of the video and a speed.
// track.position is measured in VIDEO seconds since item.start, so "start the next item from its beginning"
// is always position = 0 (the rules rely on that for listeners without control).
import type { QueueItem, RoomTrack } from '@/model/types'

export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

export const itemStart = (it: QueueItem | null | undefined) => Math.max(0, it?.start ?? 0)
export const itemRate = (it: QueueItem | null | undefined) => Math.min(2, Math.max(0.25, it?.rate || 1))

/** Absolute end second of the interval; 0 while it is not known yet (needs the video duration). */
export function itemEnd(it: QueueItem | null | undefined, duration: number): number {
  const e = it?.end ?? 0
  const s = itemStart(it)
  if (e > 0) return duration ? Math.min(e, duration) : e
  if (e < 0) return duration ? Math.max(s + 1, duration + e) : 0
  return duration || 0
}

/** Video seconds since the item's start where the track is right now (not wrapped). */
export function trackRel(t: Pick<RoomTrack, 'playing' | 'position' | 'at'>, it: QueueItem | null | undefined, serverNow: number): number {
  return t.playing ? t.position + (Math.max(0, serverNow - t.at) / 1000) * itemRate(it) : t.position
}

/** Expected video time; a single repeating item loops inside its interval. */
export function expectedTime(t: Pick<RoomTrack, 'playing' | 'position' | 'at'>, it: QueueItem | null | undefined, duration: number, serverNow: number, loops: boolean): number {
  const s = itemStart(it)
  const e = itemEnd(it, duration)
  let rel = trackRel(t, it, serverNow)
  if (loops && e > s + 0.5) rel %= e - s
  return s + rel
}

/** "1:20", "80", "1:02:03" → seconds; '' → null; garbage → NaN. */
export function parseTime(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return NaN
  return s.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
}

/** Short description of the item's interval/speed for queue rows ('' when the whole video at ×1). */
export function timingLabel(it: QueueItem, fmt: (s: number) => string): string {
  const parts: string[] = []
  const s = itemStart(it), e = it.end ?? 0
  if (s || e) parts.push(`${fmt(s)}–${e > 0 ? fmt(e) : e < 0 ? 'конец−' + fmt(-e) : 'конец'}`)
  if ((it.rate ?? 1) !== 1) parts.push(`×${it.rate}`)
  return parts.join(' · ')
}
