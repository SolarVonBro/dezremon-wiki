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
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type Transaction,
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
    name: 'Музыка', kind: 'main', order: 0, queue: [], current: null, playlistId: null, playing: false, position: 0, at: serverTimestamp(), volume: 100,
    loop: 'all', shuffle: false, rev: 0, updatedAt: t, updatedBy: user.uid,
  })
  await b.commit()
  // every room starts with a playlist (the side panel always shows one); a separate write: the playlist rules
  // look at the room, which must exist first
  await ensureDefaultPlaylist(ref.id, user).catch(() => {})
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
const playlistRef = (rid: string, pid: string) => doc(db, 'rooms', rid, 'playlists', pid)

/**
 * What a track walks through: its own queue or — when `playlistId` is set — a saved playlist of the room, live
 * (editing the playlist while it plays changes what comes next; nothing is copied).
 */
export function itemsOf(t: Pick<RoomTrack, 'queue' | 'playlistId'>, playlists: RoomPlaylist[]): QueueItem[] {
  if (!t.playlistId) return t.queue
  return playlists.find((p) => p.id === t.playlistId)?.items ?? []
}
async function itemsInTx(tx: Transaction, rid: string, t: RoomTrack): Promise<QueueItem[]> {
  if (!t.playlistId) return t.queue
  const p = await tx.get(playlistRef(rid, t.playlistId))
  return p.exists() ? ((p.data().items ?? []) as QueueItem[]) : []
}
/** Moves the item with `id` to index `to` (splice semantics), in place. */
function moveTo(list: QueueItem[], id: string, to: number): QueueItem[] {
  const i = list.findIndex((x) => x.id === id)
  if (i < 0) return list
  const [x] = list.splice(i, 1)
  list.splice(Math.max(0, Math.min(to, list.length)), 0, x)
  return list
}

export const setPlayback = (rid: string, tid: string, uid: string, playing: boolean, position: number) =>
  updateDoc(trackRef(rid, tid), { playing, position: Math.max(0, position), ...stamp(uid) })

/** Plays an item of the track's own queue (the track stops walking through a playlist, if it did). */
export const playItem = (rid: string, tid: string, uid: string, itemId: string) =>
  updateDoc(trackRef(rid, tid), { current: itemId, playlistId: null, position: 0, playing: true, ...stamp(uid) })

/** Plays a saved playlist on the track, from `itemId`; the track then goes through the playlist like a queue. */
export const playFromPlaylist = (rid: string, tid: string, uid: string, pid: string, itemId: string) =>
  updateDoc(trackRef(rid, tid), { playlistId: pid, current: itemId, position: 0, playing: true, ...stamp(uid) })

/** The item after `fromId` according to loop/shuffle; null = the list is over. */
export function nextItemId(t: Pick<RoomTrack, 'loop' | 'shuffle'>, q: QueueItem[], fromId: string | null, dir: 1 | -1 = 1): string | null {
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
    const next = nextItemId(t, await itemsInTx(tx, rid, t), endedId)
    if (next === endedId) return // single looping item: every client loops it locally
    tx.update(trackRef(rid, tid), { current: next, position: 0, playing: next !== null, at: serverTimestamp(), rev: t.rev + 1, updatedAt: now(), updatedBy: uid })
  })
}

/** Previous/next button; `items` = what the track walks through (itemsOf). */
export const skip = (rid: string, tid: string, uid: string, t: RoomTrack, items: QueueItem[], dir: 1 | -1) => {
  const next = nextItemId({ ...t, loop: t.loop === 'one' ? 'all' : t.loop }, items, t.current, dir)
  return updateDoc(trackRef(rid, tid), { current: next, position: 0, playing: next !== null, ...stamp(uid) })
}

export const setTrackProps = (rid: string, tid: string, uid: string, patch: Partial<Pick<RoomTrack, 'name' | 'volume' | 'loop' | 'shuffle'>>) =>
  updateDoc(trackRef(rid, tid), { ...patch, updatedAt: now(), updatedBy: uid })

export async function addTrack(rid: string, uid: string, name: string, order: number): Promise<string> {
  const id = randomId(10)
  await setDoc(trackRef(rid, id), {
    name, kind: 'layer', order, queue: [], current: null, playlistId: null, playing: false, position: 0, at: serverTimestamp(), volume: 60, loop: 'one' as LoopMode,
    shuffle: false, rev: 0, updatedAt: now(), updatedBy: uid,
  })
  return id
}
export const removeTrack = (rid: string, tid: string) => deleteDoc(trackRef(rid, tid))

// ---------- queue ----------
export function makeItem(videoId: string, title: string, duration: number, user: UserLike): QueueItem {
  return { id: randomId(10), videoId, title, duration, addedBy: user.uid, addedByName: nameOf(user) }
}

/** Appends items to the queue; if nothing is playing, the first new item starts (like dropping a link into Watch2Gether). */
export async function addItems(rid: string, tid: string, uid: string, items: QueueItem[], playNow = false) {
  if (!items.length) return
  await runTransaction(db, async (tx) => {
    const s = await tx.get(trackRef(rid, tid))
    if (!s.exists()) throw new Error('Дорожка удалена')
    const t = normalizeTrack(s.id, s.data())
    const playingNow = await itemsInTx(tx, rid, t)
    const start = playNow || !t.current || !playingNow.some((x) => x.id === t.current)
    tx.update(trackRef(rid, tid), {
      queue: [...t.queue, ...items], updatedAt: now(), updatedBy: uid,
      ...(start ? { current: items[0].id, playlistId: null, position: 0, playing: true, at: serverTimestamp(), rev: t.rev + 1 } : {}),
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
    if (!t.playlistId && t.current && !queue.some((x) => x.id === t.current)) {
      // the playing item was removed: continue with the one that took its place
      const oldIdx = t.queue.findIndex((x) => x.id === t.current)
      const next = queue[Math.min(oldIdx, queue.length - 1)] ?? null
      Object.assign(patch, { current: next?.id ?? null, position: 0, playing: !!next && t.playing, at: serverTimestamp(), rev: t.rev + 1 })
    }
    tx.update(trackRef(rid, tid), patch)
  })
}
export const removeItem = (rid: string, tid: string, uid: string, itemId: string) => editQueue(rid, tid, uid, (q) => q.filter((x) => x.id !== itemId))
export const moveItemTo = (rid: string, tid: string, uid: string, itemId: string, to: number) => editQueue(rid, tid, uid, (q) => moveTo(q, itemId, to))
export const clearQueue = (rid: string, tid: string, uid: string) => editQueue(rid, tid, uid, () => [])

export type ItemPatch = Partial<Pick<QueueItem, 'title' | 'start' | 'end' | 'rate'>>
/** Firestore rejects `undefined`: unset optional timing fields are simply left out. */
function applyPatch(it: QueueItem, patch: ItemPatch): QueueItem {
  const next: QueueItem = { ...it, ...patch }
  for (const k of ['start', 'end', 'rate'] as const) if (next[k] === undefined || next[k] === null) delete next[k]
  return next
}
const timingChanged = (a: QueueItem, b: QueueItem) => (a.start ?? 0) !== (b.start ?? 0) || (a.rate ?? 1) !== (b.rate ?? 1)

/**
 * Renames a queue item or changes its interval/speed. If it is the item playing right now, the playback position
 * is re-anchored at `videoTimeNow` (what everybody hears at this moment) so a new start or speed makes nobody jump.
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
    const reanchor = !t.playlistId && t.current === itemId && timingChanged(before, queue[i]) && typeof videoTimeNow === 'number'
    tx.update(trackRef(rid, tid), {
      queue, updatedAt: now(), updatedBy: uid,
      ...(reanchor ? { position: Math.max(0, videoTimeNow! - (queue[i].start ?? 0)), at: serverTimestamp(), rev: t.rev + 1 } : {}),
    })
  })
}

// ---------- saved playlists ----------
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
export const DEFAULT_PLAYLIST_ID = 'main'
/** Creates the room's default playlist «Основной» unless it exists (safe when several clients race). */
export async function ensureDefaultPlaylist(rid: string, user: UserLike) {
  await runTransaction(db, async (tx) => {
    const ref = playlistRef(rid, DEFAULT_PLAYLIST_ID)
    if ((await tx.get(ref)).exists()) return
    const t = now()
    tx.set(ref, { name: 'Основной', items: [], order: 0, createdBy: user.uid, createdByName: nameOf(user), createdAt: t, updatedAt: t })
  })
}
/**
 * Rooms made while the music had its own queue: move the queue into «Основной» (same item ids, so a song that is
 * playing keeps playing) and let the music go through that playlist from now on.
 */
export async function migrateQueueToPlaylist(rid: string, tid: string, user: UserLike) {
  await ensureDefaultPlaylist(rid, user)
  await runTransaction(db, async (tx) => {
    const ts = await tx.get(trackRef(rid, tid))
    const ps = await tx.get(playlistRef(rid, DEFAULT_PLAYLIST_ID))
    if (!ts.exists() || !ps.exists()) return
    const t = normalizeTrack(ts.id, ts.data())
    if (!t.queue.length) return
    const items = (ps.data().items ?? []) as QueueItem[]
    const have = new Set(items.map((x) => x.id))
    tx.update(playlistRef(rid, DEFAULT_PLAYLIST_ID), { items: [...items, ...t.queue.filter((x) => !have.has(x.id))], updatedAt: now() })
    tx.update(trackRef(rid, tid), { queue: [], ...(t.playlistId ? {} : { playlistId: DEFAULT_PLAYLIST_ID }), updatedAt: now(), updatedBy: user.uid })
  })
}
export const renamePlaylist = (rid: string, pid: string, name: string) => updateDoc(playlistRef(rid, pid), { name, updatedAt: now() })

/** Deletes a playlist; tracks that were playing it stop (their own queues are untouched). */
export async function deletePlaylist(rid: string, pid: string, uid: string, tracks: RoomTrack[]) {
  const b = writeBatch(db)
  b.delete(playlistRef(rid, pid))
  for (const t of tracks.filter((x) => x.playlistId === pid)) {
    b.update(trackRef(rid, t.id), { playlistId: null, current: null, playing: false, position: 0, ...stamp(uid) })
  }
  await b.commit()
}

/**
 * Edits a playlist in a transaction together with the tracks that are walking through it (`trackIds`, as known to
 * the client): if the playing item disappears they continue with the item that took its place; `reanchor`
 * keeps the position of a playing item whose start/speed changed.
 */
async function editPlaylistLive(rid: string, pid: string, uid: string, fn: (items: QueueItem[]) => QueueItem[], trackIds: string[] = [],
  reanchor?: { tid: string; itemId: string; videoTimeNow: number }) {
  await runTransaction(db, async (tx) => {
    const ps = await tx.get(playlistRef(rid, pid))
    if (!ps.exists()) throw new Error('Плейлист удалён')
    const tracks = (await Promise.all(trackIds.map((id) => tx.get(trackRef(rid, id))))).filter((x) => x.exists()).map((x) => normalizeTrack(x.id, x.data()))
    const before = (ps.data().items ?? []) as QueueItem[]
    const items = fn([...before])
    tx.update(playlistRef(rid, pid), { items, updatedAt: now() })
    for (const t of tracks) {
      if (t.playlistId !== pid || !t.current) continue
      if (!items.some((x) => x.id === t.current)) {
        const oldIdx = before.findIndex((x) => x.id === t.current)
        const next = items[Math.min(oldIdx, items.length - 1)] ?? null
        tx.update(trackRef(rid, t.id), { current: next?.id ?? null, position: 0, playing: !!next && t.playing, at: serverTimestamp(), rev: t.rev + 1, updatedAt: now(), updatedBy: uid })
      } else if (reanchor && reanchor.tid === t.id && reanchor.itemId === t.current) {
        const a = before.find((x) => x.id === t.current)!, b = items.find((x) => x.id === t.current)!
        if (timingChanged(a, b)) tx.update(trackRef(rid, t.id), { position: Math.max(0, reanchor.videoTimeNow - (b.start ?? 0)), at: serverTimestamp(), rev: t.rev + 1, updatedAt: now(), updatedBy: uid })
      }
    }
  })
}
export const addToPlaylist = (rid: string, pid: string, uid: string, items: QueueItem[]) => editPlaylistLive(rid, pid, uid, (q) => [...q, ...items])
export const movePlaylistItemTo = (rid: string, pid: string, uid: string, itemId: string, to: number) => editPlaylistLive(rid, pid, uid, (q) => moveTo(q, itemId, to))
export const removeFromPlaylist = (rid: string, pid: string, uid: string, itemId: string, trackIds: string[]) =>
  editPlaylistLive(rid, pid, uid, (q) => q.filter((x) => x.id !== itemId), trackIds)
export const editPlaylistItem = (rid: string, pid: string, uid: string, itemId: string, patch: ItemPatch, trackIds: string[],
  reanchor?: { tid: string; itemId: string; videoTimeNow: number }) =>
  editPlaylistLive(rid, pid, uid, (q) => q.map((x) => (x.id === itemId ? applyPatch(x, patch) : x)), trackIds, reanchor)

/** Copies a playlist's items to the end of a track's queue (starting them only if nothing plays). */
export async function appendPlaylistToQueue(rid: string, tid: string, uid: string, pl: RoomPlaylist) {
  if (!pl.items.length) throw new Error('Плейлист пуст')
  await addItems(rid, tid, uid, pl.items.map((x) => ({ ...x, id: randomId(10) })))
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
