// Storage usage of a world, computed with Firestore's documented size formula
// (https://firebase.google.com/docs/firestore/storage-size): documents + single-field and composite index entries.
// On the free Spark plan Google does not expose usage metrics through its API (Cloud Monitoring requires billing),
// so the app measures it itself. Image chunks are not downloaded: their size is known from image metadata.
import { collection, doc, getCountFromServer, getDocs, setDoc, Bytes, Timestamp, GeoPoint, DocumentReference } from 'firebase/firestore'
import { db } from '@/firebase'
import { coll } from './access'
import { WORLD_COLLECTIONS, IMAGE_CHUNK } from './backup/format'
import type { ImageMeta } from '@/model/types'

/** Spark plan limits — per PROJECT: every world of every master shares them. */
export const SPARK = { storageBytes: 1024 ** 3, reads: 50_000, writes: 20_000, deletes: 20_000 }

/**
 * Fields excluded from single-field indexing (keep in sync with fieldOverrides in firestore.indexes.json).
 * Nothing queries them on the server, so indexing them would only waste storage and write cost.
 */
export const INDEX_EXEMPT: Record<string, string[]> = {
  entities: ['name', 'kind', 'fields', 'attributes', 'excerpt', 'tooltip', 'links', 'aliases', 'mentions', 'tagIds'],
  bodies: ['html'],
  secrets: ['html', 'attributes', 'gmNotes'],
  revisions: ['html', 'name', 'createdByName'],
  posts: ['html', 'title'],
  images: ['thumb', 'name'],
  imageChunks: ['data'],
  timelineEras: ['html'],
  timelineElements: ['html'],
  questElements: ['html'],
  mapMarkers: ['html', 'points'],
  messages: ['text'],
}

/** Composite indexes per collection (number of fields only matters for the estimate). */
const COMPOSITES: Record<string, string[][]> = {
  entities: [['visibility', 'updatedAt'], ['allowedUids', 'updatedAt'], ['createdBy', 'updatedAt']],
  relations: [['visibility', 'updatedAt'], ['allowedUids', 'updatedAt'], ['createdBy', 'updatedAt']],
  images: [['visibility', 'updatedAt'], ['allowedUids', 'updatedAt'], ['createdBy', 'updatedAt']],
  revisions: [['entityId', 'createdAt'], ['entityId', 'createdBy', 'createdAt']],
}
const CHILD_PARENT: Record<string, string[]> = {
  posts: ['entityId'], orgMembers: ['organisationId', 'characterId'], inventory: ['ownerId'], entityAbilities: ['entityId', 'abilityId'],
  questElements: ['questId'], reminders: ['entityId', 'calendarId'], timelineEras: ['timelineId'], timelineElements: ['timelineId'],
  mapLayers: ['mapId'], mapGroups: ['mapId'], mapMarkers: ['mapId'], messages: ['conversationId'],
}
for (const [c, parents] of Object.entries(CHILD_PARENT)) {
  COMPOSITES[c] = parents.flatMap((p) => [[p, 'visibility'], [p, 'allowedUids'], [p, 'createdBy']])
}

const enc = new TextEncoder()
const strSize = (s: string) => enc.encode(s).length + 1
const INDEX_VALUE_CAP = 1500 // index entries keep only the first 1500 bytes of a value

export function valueSize(v: unknown): number {
  if (v === null || v === undefined) return 1
  if (typeof v === 'string') return strSize(v)
  if (typeof v === 'boolean') return 1
  if (typeof v === 'number') return 8
  if (v instanceof Bytes) return v.toUint8Array().length
  if (v instanceof Timestamp) return 8
  if (v instanceof GeoPoint) return 16
  if (v instanceof DocumentReference) return docNameSize(v.path.split('/'))
  if (Array.isArray(v)) return v.reduce((s, x) => s + valueSize(x), 0)
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).reduce((s, [k, x]) => s + strSize(k) + valueSize(x), 0)
  return 8
}

/** Path segments relative to /documents: ['worlds', wid, 'entities', id]. */
export const docNameSize = (segments: string[]) => segments.reduce((s, x) => s + strSize(x), 0) + 16

function singleFieldEntries(nameSize: number, field: string, v: unknown, out: { n: number; bytes: number }) {
  if (Array.isArray(v)) {
    // array-contains index: one entry per distinct element
    for (const el of new Set(v.map((x) => JSON.stringify(x)))) { out.n++; out.bytes += nameSize + strSize(field) + Math.min(INDEX_VALUE_CAP, el.length) + 32 }
    return
  }
  if (v && typeof v === 'object' && !(v instanceof Bytes) && !(v instanceof Timestamp) && !(v instanceof GeoPoint) && !(v instanceof DocumentReference)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) singleFieldEntries(nameSize, `${field}.${k}`, x, out)
    return
  }
  // ascending + descending
  out.n += 2
  out.bytes += 2 * (nameSize + strSize(field) + Math.min(INDEX_VALUE_CAP, valueSize(v)) + 32)
}

/** Storage of one document including its index entries. */
export function documentStorage(collection: string, segments: string[], data: Record<string, unknown>): number {
  const nameSize = docNameSize(segments)
  let size = nameSize + 32
  for (const [k, v] of Object.entries(data)) size += strSize(k) + valueSize(v)
  const exempt = new Set(INDEX_EXEMPT[collection] ?? [])
  const idx = { n: 0, bytes: 0 }
  for (const [k, v] of Object.entries(data)) if (!exempt.has(k)) singleFieldEntries(nameSize, k, v, idx)
  for (const fields of COMPOSITES[collection] ?? []) {
    const arr = fields.find((f) => Array.isArray(data[f]))
    const copies = arr ? Math.max(1, (data[arr] as unknown[]).length) : 1
    const vals = fields.reduce((s, f) => s + (arr === f ? 9 : Math.min(INDEX_VALUE_CAP, valueSize(data[f]))), 0)
    idx.bytes += copies * (nameSize + vals + 32)
  }
  return size + idx.bytes
}

export interface CollectionUsage { docs: number; bytes: number }
export interface WorldUsage {
  bytes: number
  docs: number
  at: number
  byCollection: Record<string, CollectionUsage>
}

/** Cheap pre-check: how many documents a full measurement would read (count queries cost ~1 read per 1000 docs). */
export async function countWorldDocs(wid: string): Promise<{ total: number; byCollection: Record<string, number> }> {
  const names = WORLD_COLLECTIONS.filter((n) => n !== 'invites')
  const counts = await Promise.all(names.map((n) => getCountFromServer(coll(wid, n)).then((s) => s.data().count).catch(() => 0)))
  const byCollection: Record<string, number> = {}
  names.forEach((n, i) => (byCollection[n] = counts[i]))
  return { total: counts.reduce((a, b) => a + b, 0), byCollection }
}

/** Reads every document of the world once (masters only) and sums their storage. */
export async function measureWorld(wid: string, onProgress: (done: number, total: number, name: string) => void = () => {}): Promise<WorldUsage> {
  const names = WORLD_COLLECTIONS.filter((n) => n !== 'invites')
  const byCollection: Record<string, CollectionUsage> = {}
  let images: ImageMeta[] = []
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    onProgress(i, names.length + 1, name)
    const snap = await getDocs(coll(wid, name))
    let bytes = 0
    snap.forEach((d) => { bytes += documentStorage(name, ['worlds', wid, name, d.id], d.data()) })
    byCollection[name] = { docs: snap.size, bytes }
    if (name === 'images') images = snap.docs.map((d) => ({ ...(d.data() as ImageMeta), id: d.id })).filter((m) => !m.deleted)
  }
  // Image bytes: chunk documents rebuilt from metadata instead of downloading them.
  onProgress(names.length, names.length + 1, 'imageChunks')
  let chunkBytes = 0, chunkDocs = 0
  for (const m of images) {
    const n = m.chunkCount ?? Math.max(1, Math.ceil((m.size ?? 0) / IMAGE_CHUNK))
    for (let c = 0; c < n; c++) {
      const part = Math.min(IMAGE_CHUNK, Math.max(0, (m.size ?? 0) - c * IMAGE_CHUNK))
      const meta = { imageId: m.id, n: c, visibility: m.visibility, allowedUids: m.allowedUids ?? [], createdBy: m.createdBy, updatedAt: m.updatedAt }
      chunkBytes += documentStorage('imageChunks', ['worlds', wid, 'imageChunks', `${m.id}_${c}`], meta) + strSize('data') + part
      chunkDocs++
    }
  }
  byCollection.imageChunks = { docs: chunkDocs, bytes: chunkBytes }
  const docs = Object.values(byCollection).reduce((s, c) => s + c.docs, 0) + 1
  const bytes = Object.values(byCollection).reduce((s, c) => s + c.bytes, 0) + 2048 // + world doc
  onProgress(names.length + 1, names.length + 1, '')
  return { bytes, docs, at: Date.now(), byCollection }
}

/** Anonymous per-world totals (usage/{wid}); at = 0 means "never measured". */
export interface WorldUsageRow { id: string; bytes: number; docs: number; at: number }

export async function readProjectUsage(): Promise<WorldUsageRow[]> {
  const s = await getDocs(collection(db, 'usage'))
  return s.docs.map((d) => {
    const x = d.data()
    return { id: d.id, bytes: Number(x.bytes) || 0, docs: Number(x.docs) || 0, at: Number(x.at) || 0 }
  })
}

export const saveWorldUsage = (wid: string, u: { bytes: number; docs: number; at: number }) =>
  setDoc(doc(db, 'usage', wid), { bytes: u.bytes, docs: u.docs, at: u.at })

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} КБ`
  if (n < 1000 * 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} МБ`
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`
}

/** Row id in usage/ for everything that is not inside a world (campaigns, rooms, profiles, bans, config). */
export const SERVICE_USAGE_ID = 'service'

/**
 * Measures the service-level data (admins only): campaigns and rooms with their subcollections, user profiles,
 * bans and config. Reads every one of those documents once.
 */
export async function measureService(onProgress: (name: string) => void = () => {}): Promise<WorldUsage> {
  const byCollection: Record<string, CollectionUsage> = {}
  const add = (name: string, segments: string[], data: Record<string, unknown>) => {
    const c = (byCollection[name] ??= { docs: 0, bytes: 0 })
    c.docs++
    c.bytes += documentStorage(name, segments, data)
  }
  for (const top of ['users', 'serviceBans', 'service']) {
    onProgress(top)
    const s = await getDocs(collection(db, top))
    s.forEach((d) => add(top, [top, d.id], d.data()))
  }
  for (const [top, subs] of [['campaigns', ['participants', 'sessions', 'invites']], ['rooms', ['tracks', 'listeners', 'messages']]] as const) {
    onProgress(top)
    const s = await getDocs(collection(db, top))
    for (const d of s.docs) {
      add(top, [top, d.id], d.data())
      for (const sub of subs) {
        const ss = await getDocs(collection(db, top, d.id, sub))
        ss.forEach((x) => add(`${top}/${sub}`, [top, d.id, sub, x.id], x.data()))
      }
    }
  }
  const docs = Object.values(byCollection).reduce((s, c) => s + c.docs, 0)
  const bytes = Object.values(byCollection).reduce((s, c) => s + c.bytes, 0)
  return { bytes, docs, at: Date.now(), byCollection }
}
