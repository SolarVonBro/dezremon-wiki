// Music rooms (Watch2Gether-like): synchronized YouTube playback for everybody in the room.
//
// Sync model. Each track stores { current, playing, position, at } where `at` is the SERVER time of the last
// control change (serverTimestamp). Every client computes where playback should be right now:
//   video time = item.start + (playing ? position + (serverNow - at) / 1000 × item.rate : position)
// (position counts video seconds since the item's start; see src/components/rooms/timing.ts)
// serverNow is the local clock corrected by an offset measured against Firestore's clock (see Presence).
// Controls write a new { position, at } instead of streaming the playhead, so playing costs no writes at all;
// only play/pause/seek/skip and queue edits do. When a video ends, the next one is picked in a transaction that
// only succeeds if nobody advanced the track already, so N listeners produce one write.
import {
  arrayUnion, collection, deleteDoc, doc, getDocFromCache, increment, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { now, randomId } from './util'
import { deleteRoomTree } from './admin'
import type { LoopMode, QueueItem, Room, RoomListener, RoomMessage, RoomPlaylist, RoomTrack } from '@/model/types'

type UserLike = { uid: string; displayName: string | null; email: string | null; photoURL: string | null }
const nameOf = (u: UserLike) => u.displayName || u.email || 'Слушатель'
const roomRef = (rid: string) => doc(db, 'rooms', rid)
const trackRef = (rid: string, tid: string) => doc(db, 'rooms', rid, 'tracks', tid)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : now())

export function normalizeRoom(id: string, d: any): Room {
  return {
    name: 'Комната', ownerId: '', ownerName: '', hostUids: [], memberUids: [], campaignId: null, campaignName: '', access: 'link',
    controlMode: 'hosts', createdAt: 0, updatedAt: 0, lastActiveAt: 0, ...d, id,
  }
}
export function normalizeTrack(id: string, d: any): RoomTrack {
  return {
    name: '', kind: 'layer', order: 0, queue: [], current: null, playing: false, position: 0, volume: 100, loop: 'all', shuffle: false,
    rev: 0, updatedAt: 0, updatedBy: '', ...d, at: ms(d.at), id,
  }
}

// ---------- rooms ----------
export async function createRoom(user: UserLike, data: Pick<Room, 'name' | 'campaignId' | 'campaignName' | 'access' | 'controlMode'>): Promise<string> {
  const ref = doc(collection(db, 'rooms'))
  const t = now()
  const room: Omit<Room, 'id'> = { ...data, ownerId: user.uid, ownerName: nameOf(user), hostUids: [], memberUids: [user.uid], createdAt: t, updatedAt: t, lastActiveAt: t }
  const b = writeBatch(db)
  b.set(ref, room)
  b.set(doc(db, 'rooms', ref.id, 'tracks', 'main'), {
    name: 'Музыка', kind: 'main', order: 0, queue: [], current: null, playing: false, position: 0, at: serverTimestamp(), volume: 100,
    loop: 'all', shuffle: false, rev: 0, updatedAt: t, updatedBy: user.uid,
  })
  await b.commit()
  return ref.id
}

export function watchMyRooms(uid: string, cb: (rows: Room[]) => void, onErr: (e: unknown) => void = () => {}) {
  return onSnapshot(query(collection(db, 'rooms'), where('memberUids', 'array-contains', uid)),
    (s) => cb(s.docs.map((d) => normalizeRoom(d.id, d.data())).sort((a, b) => b.lastActiveAt - a.lastActiveAt)), onErr)
}
export function watchCampaignRooms(cid: string, cb: (rows: Room[]) => void) {
  return onSnapshot(query(collection(db, 'rooms'), where('campaignId', '==', cid)),
    (s) => cb(s.docs.map((d) => normalizeRoom(d.id, d.data())).sort((a, b) => b.lastActiveAt - a.lastActiveAt)), () => cb([]))
}
export function watchRoom(rid: string, cb: (r: Room | null) => void, onErr: (e: unknown) => void) {
  return onSnapshot(roomRef(rid), (s) => cb(s.exists() ? normalizeRoom(s.id, s.data()) : null), onErr)
}
export const updateRoom = (rid: string, patch: Partial<Omit<Room, 'id' | 'ownerId'>>) => updateDoc(roomRef(rid), { ...patch, updatedAt: now() })
/** Entering adds the user to the room's memberUids ("my rooms"); allowed for anyone who may enter. */
export const enterRoom = (rid: string, uid: string) => updateDoc(roomRef(rid), { memberUids: arrayUnion(uid), lastActiveAt: now() })
export const deleteRoom = (rid: string) => deleteRoomTree(rid)
export const roomUrl = (rid: string) => `${location.origin}${location.pathname}#/r/${rid}`

// ---------- tracks ----------
export function watchTracks(rid: string, cb: (rows: RoomTrack[]) => void, onErr: (e: unknown) => void = () => {}) {
  return onSnapshot(collection(db, 'rooms', rid, 'tracks'), (s) => cb(s.docs
    .map((d) => normalizeTrack(d.id, d.data({ serverTimestamps: 'estimate' })))
    .sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === 'main' ? -1 : 1))), onErr)
}

const stamp = (uid: string) => ({ at: serverTimestamp(), rev: increment(1), updatedAt: now(), updatedBy: uid })

export const setPlayback = (rid: string, tid: string, uid: string, playing: boolean, position: number) =>
  updateDoc(trackRef(rid, tid), { playing, position: Math.max(0, position), ...stamp(uid) })

export const playItem = (rid: string, tid: string, uid: string, itemId: string) =>
  updateDoc(trackRef(rid, tid), { current: itemId, position: 0, playing: true, ...stamp(uid) })

/** The item after `fromId` according to loop/shuffle; null = the queue is over. */
export function nextItemId(t: Pick<RoomTrack, 'queue' | 'loop' | 'shuffle'>, fromId: string | null, dir: 1 | -1 = 1): string | null {
  const q = t.queue
  if (!q.length) return null
  const i = q.findIndex((x) => x.id === fromId)
  if (t.loop === 'one' && dir === 1 && i >= 0) return q[i].id
  if (t.shuffle && dir === 1 && q.length > 1) {
    let j = i
    while (j === i) j = Math.floor(Math.random() * q.length)
    return q[j].id
  }
  const j = i + dir
  if (j >= 0 && j < q.length) return q[j].id
  if (t.loop === 'all') return q[(j + q.length) % q.length].id
  return dir === -1 ? q[0].id : null
}

/**
 * A video ended (reported by any listener): move on, once. The transaction re-checks that the track still plays
 * the ended item at the same revision, so concurrent reports from other listeners turn into no-ops.
 */
export async function advanceAfterEnd(rid: string, tid: string, uid: string, endedId: string, seenRev: number) {
  await runTransaction(db, async (tx) => {
    const s = await tx.get(trackRef(rid, tid))
    if (!s.exists()) return
    const t = normalizeTrack(s.id, s.data())
    if (t.current !== endedId || t.rev !== seenRev || !t.playing) return
    const next = nextItemId(t, endedId)
    if (next === endedId) return // single looping item: every client loops it locally
    tx.update(trackRef(rid, tid), { current: next, position: 0, playing: next !== null, at: serverTimestamp(), rev: t.rev + 1, updatedAt: now(), updatedBy: uid })
  })
}

export const skip = (rid: string, tid: string, uid: string, t: RoomTrack, dir: 1 | -1) => {
  const next = nextItemId({ ...t, loop: t.loop === 'one' ? 'all' : t.loop }, t.current, dir)
  return updateDoc(trackRef(rid, tid), { current: next, position: 0, playing: next !== null, ...stamp(uid) })
}

export const setTrackProps = (rid: string, tid: string, uid: string, patch: Partial<Pick<RoomTrack, 'name' | 'volume' | 'loop' | 'shuffle'>>) =>
  updateDoc(trackRef(rid, tid), { ...patch, updatedAt: now(), updatedBy: uid })

export async function addTrack(rid: string, uid: string, name: string, order: number): Promise<string> {
  const id = randomId(10)
  await setDoc(trackRef(rid, id), {
    name, kind: 'layer', order, queue: [], current: null, playing: false, position: 0, at: serverTimestamp(), volume: 60, loop: 'one' as LoopMode,
    shuffle: false, rev: 0, updatedAt: now(), updatedBy: uid,
  })
  return id
}
export const removeTrack = (rid: string, tid: string) => deleteDoc(trackRef(rid, tid))

// ---------- queue ----------
export function makeItem(videoId: string, title: string, duration: number, user: UserLike): QueueItem {
  return { id: randomId(10), videoId, title, duration, addedBy: user.uid, addedByName: nameOf(user) }
}

/** Appends items; if nothing is playing, the first new item starts (like dropping a link into Watch2Gether). */
export async function addItems(rid: string, tid: string, uid: string, items: QueueItem[], playNow = false) {
  if (!items.length) return
  await runTransaction(db, async (tx) => {
    const s = await tx.get(trackRef(rid, tid))
    if (!s.exists()) throw new Error('Дорожка удалена')
    const t = normalizeTrack(s.id, s.data())
    const start = playNow || !t.current || !t.queue.some((x) => x.id === t.current)
    tx.update(trackRef(rid, tid), {
      queue: [...t.queue, ...items], updatedAt: now(), updatedBy: uid,
      ...(start ? { current: items[0].id, position: 0, playing: true, at: serverTimestamp(), rev: t.rev + 1 } : {}),
    })
  })
}

export async function editQueue(rid: string, tid: string, uid: string, fn: (q: QueueItem[], t: RoomTrack) => QueueItem[]) {
  await runTransaction(db, async (tx) => {
    const s = await tx.get(trackRef(rid, tid))
    if (!s.exists()) return
    const t = normalizeTrack(s.id, s.data())
    const queue = fn([...t.queue], t)
    const patch: Record<string, unknown> = { queue, updatedAt: now(), updatedBy: uid }
    if (t.current && !queue.some((x) => x.id === t.current)) {
      // the playing item was removed: continue with the one that took its place
      const oldIdx = t.queue.findIndex((x) => x.id === t.current)
      const next = queue[Math.min(oldIdx, queue.length - 1)] ?? null
      Object.assign(patch, { current: next?.id ?? null, position: 0, playing: !!next && t.playing, at: serverTimestamp(), rev: t.rev + 1 })
    }
    tx.update(trackRef(rid, tid), patch)
  })
}
export const removeItem = (rid: string, tid: string, uid: string, itemId: string) => editQueue(rid, tid, uid, (q) => q.filter((x) => x.id !== itemId))

export type ItemPatch = Partial<Pick<QueueItem, 'title' | 'start' | 'end' | 'rate'>>
/** Firestore rejects `undefined`: unset optional timing fields are simply left out. */
function applyPatch(it: QueueItem, patch: ItemPatch): QueueItem {
  const next: QueueItem = { ...it, ...patch }
  for (const k of ['start', 'end', 'rate'] as const) if (next[k] === undefined || next[k] === null) delete next[k]
  return next
}

/**
 * Renames an item or changes its interval/speed. If it is the item playing right now, the playback position is
 * re-anchored at `videoTimeNow` (what everybody hears at this moment) so a new start or speed does not make
 * listeners jump.
 */
export async function editQueueItem(rid: string, tid: string, uid: string, itemId: string, patch: ItemPatch, videoTimeNow?: number) {
  await runTransaction(db, async (tx) => {
    const s = await tx.get(trackRef(rid, tid))
    if (!s.exists()) throw new Error('Дорожка удалена')
    const t = normalizeTrack(s.id, s.data())
    const i = t.queue.findIndex((x) => x.id === itemId)
    if (i < 0) throw new Error('Трека уже нет в очереди')
    const queue = [...t.queue]
    const before = queue[i]
    queue[i] = applyPatch(before, patch)
    const timingChanged = (before.start ?? 0) !== (queue[i].start ?? 0) || (before.rate ?? 1) !== (queue[i].rate ?? 1)
    const reanchor = t.current === itemId && timingChanged && typeof videoTimeNow === 'number'
    tx.update(trackRef(rid, tid), {
      queue, updatedAt: now(), updatedBy: uid,
      ...(reanchor ? { position: Math.max(0, videoTimeNow! - (queue[i].start ?? 0)), at: serverTimestamp(), rev: t.rev + 1 } : {}),
    })
  })
}
export const moveItem = (rid: string, tid: string, uid: string, itemId: string, dir: -1 | 1) => editQueue(rid, tid, uid, (q) => {
  const i = q.findIndex((x) => x.id === itemId), j = i + dir
  if (i < 0 || j < 0 || j >= q.length) return q
  ;[q[i], q[j]] = [q[j], q[i]]
  return q
})
export const clearQueue = (rid: string, tid: string, uid: string) => editQueue(rid, tid, uid, () => [])

// ---------- saved playlists ----------
const playlistRef = (rid: string, pid: string) => doc(db, 'rooms', rid, 'playlists', pid)

export function watchPlaylists(rid: string, cb: (rows: RoomPlaylist[]) => void) {
  return onSnapshot(collection(db, 'rooms', rid, 'playlists'), (s) => cb(s.docs
    .map((d) => ({ name: '', items: [], order: 0, createdBy: '', createdByName: '', createdAt: 0, updatedAt: 0, ...d.data(), id: d.id }) as RoomPlaylist)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)), () => cb([]))
}

/** New playlist (optionally filled, e.g. from the current queue); items get fresh ids. */
export async function createPlaylist(rid: string, user: UserLike, name: string, items: QueueItem[] = [], order = 0): Promise<string> {
  const ref = doc(collection(db, 'rooms', rid, 'playlists'))
  const t = now()
  await setDoc(ref, { name, items: items.map((x) => ({ ...x, id: randomId(10) })), order, createdBy: user.uid, createdByName: nameOf(user), createdAt: t, updatedAt: t })
  return ref.id
}
export const renamePlaylist = (rid: string, pid: string, name: string) => updateDoc(playlistRef(rid, pid), { name, updatedAt: now() })
export const deletePlaylist = (rid: string, pid: string) => deleteDoc(playlistRef(rid, pid))

export async function editPlaylist(rid: string, pid: string, fn: (items: QueueItem[]) => QueueItem[]) {
  await runTransaction(db, async (tx) => {
    const s = await tx.get(playlistRef(rid, pid))
    if (!s.exists()) throw new Error('Плейлист удалён')
    tx.update(playlistRef(rid, pid), { items: fn([...((s.data().items ?? []) as QueueItem[])]), updatedAt: now() })
  })
}
export const addToPlaylist = (rid: string, pid: string, items: QueueItem[]) => editPlaylist(rid, pid, (q) => [...q, ...items])
export const editPlaylistItem = (rid: string, pid: string, itemId: string, patch: ItemPatch) =>
  editPlaylist(rid, pid, (q) => q.map((x) => (x.id === itemId ? applyPatch(x, patch) : x)))
export const removeFromPlaylist = (rid: string, pid: string, itemId: string) => editPlaylist(rid, pid, (q) => q.filter((x) => x.id !== itemId))
export const movePlaylistItem = (rid: string, pid: string, itemId: string, dir: -1 | 1) => editPlaylist(rid, pid, (q) => {
  const i = q.findIndex((x) => x.id === itemId), j = i + dir
  if (i < 0 || j < 0 || j >= q.length) return q
  ;[q[i], q[j]] = [q[j], q[i]]
  return q
})

/**
 * Plays a saved playlist on a track. 'replace' swaps the queue for a copy of the playlist and starts its first
 * item for everybody; 'append' adds the copy after the current queue (starting it only if nothing plays).
 */
export async function loadPlaylist(rid: string, tid: string, uid: string, pl: RoomPlaylist, mode: 'replace' | 'append') {
  if (!pl.items.length) throw new Error('Плейлист пуст')
  const copies = pl.items.map((x) => ({ ...x, id: randomId(10) }))
  await runTransaction(db, async (tx) => {
    const s = await tx.get(trackRef(rid, tid))
    if (!s.exists()) throw new Error('Дорожка удалена')
    const t = normalizeTrack(s.id, s.data())
    const start = mode === 'replace' || !t.current || !t.queue.some((x) => x.id === t.current)
    const first = t.shuffle && mode === 'replace' ? copies[Math.floor(Math.random() * copies.length)] : copies[0]
    tx.update(trackRef(rid, tid), {
      queue: mode === 'replace' ? copies : [...t.queue, ...copies], playlistName: mode === 'replace' ? pl.name : (t.playlistName ?? ''),
      updatedAt: now(), updatedBy: uid,
      ...(start ? { current: first.id, position: 0, playing: true, at: serverTimestamp(), rev: t.rev + 1 } : {}),
    })
  })
}

// ---------- presence & clock ----------
/**
 * Keeps rooms/{rid}/listeners/{uid} fresh while the room is open and measures the offset between the local clock
 * and Firestore's (serverTimestamp → value in the local cache right after the write is acknowledged).
 */
export class Presence {
  offset = 0
  private bestRtt = Infinity
  private timer: ReturnType<typeof setInterval> | null = null
  private ref
  constructor(private rid: string, private user: UserLike, private onOffset: (ms: number) => void) {
    this.ref = doc(db, 'rooms', rid, 'listeners', user.uid)
  }
  async start() {
    await this.beat(true)
    this.timer = setInterval(() => { void this.beat(false) }, 60_000)
    // a couple of quick extra samples improve the clock estimate
    setTimeout(() => { void this.beat(false) }, 3000)
    setTimeout(() => { void this.beat(false) }, 9000)
  }
  private async beat(first: boolean) {
    const t0 = now()
    try {
      await setDoc(this.ref, {
        uid: this.user.uid, displayName: nameOf(this.user), photoURL: this.user.photoURL ?? null, at: serverTimestamp(),
        ...(first ? { joinedAt: now() } : {}),
      }, { merge: true })
      const t1 = now()
      const s = await getDocFromCache(this.ref).catch(() => null)
      const server = s?.get('at')
      if (server instanceof Timestamp && t1 - t0 < this.bestRtt) {
        this.bestRtt = t1 - t0
        this.offset = server.toMillis() - (t0 + t1) / 2
        this.onOffset(this.offset)
      }
    } catch { /* offline: try again on the next beat */ }
  }
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    void deleteDoc(this.ref).catch(() => {})
  }
}

/** Listeners whose heartbeat is older than this are considered gone (tab closed without saying goodbye). */
export const PRESENCE_TTL = 150_000
export function watchListeners(rid: string, cb: (rows: RoomListener[]) => void) {
  return onSnapshot(collection(db, 'rooms', rid, 'listeners'), (s) => cb(s.docs
    .map((d) => { const x = d.data({ serverTimestamps: 'estimate' }); return { displayName: '', photoURL: null, joinedAt: 0, ...x, at: ms(x.at), uid: d.id } as RoomListener })
    .sort((a, b) => a.joinedAt - b.joinedAt)), () => cb([]))
}

// ---------- chat ----------
export function watchMessages(rid: string, cb: (rows: RoomMessage[]) => void) {
  return onSnapshot(query(collection(db, 'rooms', rid, 'messages'), orderBy('at', 'desc'), limit(100)), (s) => cb(s.docs
    .map((d) => { const x = d.data({ serverTimestamps: 'estimate' }); return { ...x, at: ms(x.at), id: d.id } as RoomMessage }).reverse()), () => cb([]))
}
export const sendMessage = (rid: string, user: UserLike, text: string) =>
  setDoc(doc(collection(db, 'rooms', rid, 'messages')), { uid: user.uid, name: nameOf(user), text: text.slice(0, 2000), at: serverTimestamp() })
export const deleteMessage = (rid: string, mid: string) => deleteDoc(doc(db, 'rooms', rid, 'messages', mid))
