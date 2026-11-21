// Backup archive format shared by the browser (src/data/backup.ts) and the scheduled
// runner (backup-runner/backup.mjs keeps its own copy of these rules — keep them in sync).
// Pure module: no Firebase / DOM imports, so it can be used from node scripts and tests.
//
// ZIP layout (paths relative to the archive root, or to the folder holding manifest.json):
//   manifest.json                 BackupManifest
//   world.json                    { id, data }                          the worlds/{wid} document
//   data/<collection>.json        { collection, count, docs: { [docId]: data } }
//   images/<imageId>.<ext>        image bytes rebuilt from imageChunks (imageChunks itself is not stored)
//   html/index.html, html/<type>/<slug>-<id>.html   offline readable copy (browser exports only)
// Firestore special values are tagged objects: { "__fs": "timestamp" | "bytes" | "geopoint" | "ref", ... }.

export const BACKUP_FORMAT = 'dezremon-wiki-backup'
export const BACKUP_VERSION = 1

/** Every collection under worlds/{wid} that a backup may contain (imageChunks are stored as image files). */
export const WORLD_COLLECTIONS = [
  'entities', 'bodies', 'secrets', 'posts', 'relations', 'orgMembers', 'inventory', 'entityAbilities', 'questElements',
  'reminders', 'timelineEras', 'timelineElements', 'mapLayers', 'mapGroups', 'mapMarkers', 'messages', 'images',
  'revisions', 'bookmarks', 'members', 'invites',
] as const

/** Readable only by masters: a player's export skips them. */
export const MASTER_ONLY_COLLECTIONS = new Set<string>(['secrets', 'revisions', 'members', 'invites'])

/** Never written back by restoreWorld as regular content (handled separately or not at all). */
export const NON_CONTENT_COLLECTIONS = new Set<string>(['members', 'invites', 'users', 'imageChunks'])

/** Firestore stores image bytes in chunks of at most this size (same as src/data/images.ts). */
export const IMAGE_CHUNK = 900_000

export interface BackupImageFile {
  id: string
  path: string
  mime: string
  size: number
  sha256: string
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  exportedAtMs: number
  generator: 'browser' | 'backup-runner'
  /** full = master export (secrets, revisions, members, invites included); visible = only what the exporter could read. */
  scope: 'full' | 'visible'
  exportedBy: string | null
  world: { id: string; name: string }
  /** Number of documents per collection (data/<name>.json). */
  counts: Record<string, number>
  images: { count: number; bytes: number; files: BackupImageFile[] }
  /** true when html/ contains the offline copy. */
  html: boolean
}

export interface CollectionFile {
  collection: string
  count: number
  docs: Record<string, any>
}

export interface WorldFile {
  id: string
  data: Record<string, any>
}

/** Progress callback used by export, restore and the Kanka importer. */
export interface PortProgress {
  phase: string
  done: number
  total: number
  message?: string
  level?: 'info' | 'warn' | 'error'
}
export type ProgressFn = (p: PortProgress) => void

// ---------- Firestore value encoding ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '='
  }
  return out
}

function isPlainObject(v: any): boolean {
  if (v === null || typeof v !== 'object') return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

/** Firestore value → JSON-safe value (duck-typed so it works with both the web SDK and firebase-admin). */
export function encodeValue(v: any): any {
  if (v === null || v === undefined) return v ?? null
  if (typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? null : v
  if (Array.isArray(v)) return v.map(encodeValue)
  if (v instanceof Uint8Array) return { __fs: 'bytes', base64: bytesToBase64(v) }
  if (typeof v.toBase64 === 'function' && typeof v.toUint8Array === 'function') return { __fs: 'bytes', base64: v.toBase64() }
  if (typeof v.toMillis === 'function' && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') {
    return { __fs: 'timestamp', seconds: v.seconds, nanoseconds: v.nanoseconds }
  }
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && typeof v.isEqual === 'function') {
    return { __fs: 'geopoint', latitude: v.latitude, longitude: v.longitude }
  }
  if (typeof v.path === 'string' && typeof v.id === 'string' && 'firestore' in v) return { __fs: 'ref', path: v.path }
  if (v instanceof Date) return { __fs: 'timestamp', seconds: Math.floor(v.getTime() / 1000), nanoseconds: (v.getTime() % 1000) * 1e6 }
  const out: Record<string, any> = {}
  for (const k of Object.keys(v)) {
    if (v[k] === undefined) continue
    out[k] = encodeValue(v[k])
  }
  return out
}

export interface DecodeFactories {
  timestamp(seconds: number, nanoseconds: number): any
  bytes(base64: string): any
  geopoint(latitude: number, longitude: number): any
  ref(path: string): any
}

/** JSON value from a backup → Firestore value. */
export function decodeValue(v: any, f: DecodeFactories): any {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, f))
  if (typeof v.__fs === 'string') {
    switch (v.__fs) {
      case 'timestamp': return f.timestamp(Number(v.seconds) || 0, Number(v.nanoseconds) || 0)
      case 'bytes': return f.bytes(String(v.base64 ?? ''))
      case 'geopoint': return f.geopoint(Number(v.latitude) || 0, Number(v.longitude) || 0)
      case 'ref': return f.ref(String(v.path ?? ''))
    }
  }
  const out: Record<string, any> = {}
  for (const k of Object.keys(v)) out[k] = decodeValue(v[k], f)
  return out
}

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (!isPlainObject(v)) return v
  const out: Record<string, any> = {}
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
  return out
}

/** Deterministic JSON (sorted keys) — small git diffs and cheap equality checks. */
export function stableStringify(v: any, indent: number | undefined = undefined): string {
  return JSON.stringify(sortKeys(v), null, indent)
}

// ---------- misc helpers ----------

const MIME_EXT: Record<string, string> = {
  'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
}
const EXT_MIME: Record<string, string> = {
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
}

export function extFromMime(mime: string | null | undefined): string {
  return MIME_EXT[String(mime ?? '').toLowerCase()] ?? 'bin'
}

export function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

export function chunkCountOf(size: number): number {
  return Math.max(1, Math.ceil(size / IMAGE_CHUNK))
}

/** Error text, or null when the manifest is usable by this version of the app. */
export function validateManifest(m: any): string | null {
  if (!m || typeof m !== 'object') return 'В архиве нет manifest.json — это не резервная копия Dezremon Wiki.'
  if (m.format !== BACKUP_FORMAT) return `Неизвестный формат архива: «${String(m.format ?? '—')}».`
  const v = Number(m.version)
  if (!Number.isFinite(v) || v < 1) return 'Повреждённый manifest.json: нет версии формата.'
  if (v > BACKUP_VERSION) return `Архив создан более новой версией приложения (формат ${v}, поддерживается ${BACKUP_VERSION}). Обновите страницу.`
  if (!m.world || typeof m.world.id !== 'string') return 'Повреждённый manifest.json: нет данных о мире.'
  return null
}

/** Accepts both `{ docs: {id: data} }` and a plain array of documents with `id`. */
export function docsOfCollectionFile(json: any): Record<string, any> {
  if (!json) return {}
  if (Array.isArray(json)) {
    const out: Record<string, any> = {}
    for (const d of json) if (d && typeof d === 'object' && d.id != null) out[String(d.id)] = d
    return out
  }
  if (json.docs && typeof json.docs === 'object') {
    if (Array.isArray(json.docs)) return docsOfCollectionFile(json.docs)
    return json.docs
  }
  return {}
}

/** UTF-8 byte length estimate without allocating (for batch size accounting). */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/** Firestore error → Russian explanation (quota errors are the common case on the free plan). */
export function firestoreErrorText(e: any): string {
  const code = String(e?.code ?? '')
  if (code === 'resource-exhausted' || /quota/i.test(String(e?.message ?? ''))) {
    return 'Превышен дневной лимит Firestore (бесплатный тариф Spark: 20 000 записей и 50 000 чтений в сутки). Лимит сбрасывается в полночь по тихоокеанскому времени (около 10–11 утра по Москве) — продолжите завтра.'
  }
  if (code === 'permission-denied') return 'Нет прав на запись (нужна роль мастера или владельца).'
  if (code === 'unauthenticated') return 'Нужно войти в аккаунт.'
  if (code === 'invalid-argument' && /exceeds the maximum allowed size|longer than/i.test(String(e?.message ?? ''))) {
    return 'Документ больше 1 МиБ — Firestore не принимает такие документы.'
  }
  return String(e?.message ?? e)
}
