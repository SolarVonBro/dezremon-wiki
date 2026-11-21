#!/usr/bin/env node
// Scheduled Firestore backup of every Dezremon Wiki world (run by GitHub Actions, see README.md).
//
//   FIREBASE_SA='{"type":"service_account",...}' node backup.mjs [--out ../backups] [--world <worldId>]
//
// For every worlds/{id} it writes backups/<id>/ in the SAME layout as the in-app backup ZIP
// (src/data/backup/format.ts — keep both in sync), so a zip of that folder can be restored in the app:
//   manifest.json, world.json, data/<collection>.json (every subcollection + users of the members),
//   images/<imageId>.<ext> rebuilt from imageChunks.
// Files are only rewritten when their content changes and image chunks are only downloaded for images
// that are new (images are immutable), so daily runs produce small git diffs and few Firestore reads.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const BACKUP_FORMAT = 'dezremon-wiki-backup'
export const BACKUP_VERSION = 1
const MIME_EXT = {
  'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
}
const SKIP_COLLECTIONS = new Set(['imageChunks'])

// ---------------------------------------------------------------- encoding (same rules as format.ts)

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

/** Firestore (admin SDK) value → JSON-safe value with { __fs: … } tags for special types. */
export function encodeValue(v) {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? null : v
  if (Array.isArray(v)) return v.map(encodeValue)
  if (v instanceof Uint8Array) return { __fs: 'bytes', base64: Buffer.from(v).toString('base64') }
  if (typeof v.toMillis === 'function' && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') {
    return { __fs: 'timestamp', seconds: v.seconds, nanoseconds: v.nanoseconds }
  }
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && typeof v.isEqual === 'function') {
    return { __fs: 'geopoint', latitude: v.latitude, longitude: v.longitude }
  }
  if (typeof v.path === 'string' && typeof v.id === 'string' && 'firestore' in v) return { __fs: 'ref', path: v.path }
  if (v instanceof Date) return { __fs: 'timestamp', seconds: Math.floor(v.getTime() / 1000), nanoseconds: (v.getTime() % 1000) * 1e6 }
  const out = {}
  for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = encodeValue(v[k])
  return out
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (!isPlainObject(v)) return v
  const out = {}
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
  return out
}

export function stableStringify(v, indent) {
  return JSON.stringify(sortKeys(v), null, indent)
}

export const extFromMime = (mime) => MIME_EXT[String(mime ?? '').toLowerCase()] ?? 'bin'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ---------------------------------------------------------------- files

async function readOrNull(file) {
  try { return await readFile(file) } catch { return null }
}

/** Writes only when the bytes differ. Returns true if the file changed. */
async function writeIfChanged(file, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  const old = await readOrNull(file)
  if (old && old.equals(buf)) return false
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, buf)
  return true
}

async function listFiles(dir) {
  try { return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name) } catch { return [] }
}

// ---------------------------------------------------------------- backup of one world

/**
 * @param db   firebase-admin Firestore (or anything with collection/doc/getAll/listCollections)
 * @param worldSnap  DocumentSnapshot of worlds/{id}
 * @param users  Map uid → user doc data (users collection)
 * @param outRoot  backups folder
 */
export async function backupWorld(db, worldSnap, users, outRoot, log = console.log) {
  const wid = worldSnap.id
  const dir = path.join(outRoot, wid)
  const stats = { reads: 0, changed: 0, imagesFetched: 0, warnings: [] }
  const mark = (changed) => { if (changed) stats.changed++ }
  const worldData = worldSnap.data() ?? {}

  // ---- every subcollection ----
  const colls = (await worldSnap.ref.listCollections()).filter((c) => !SKIP_COLLECTIONS.has(c.id)).sort((a, b) => a.id.localeCompare(b.id))
  const counts = {}
  const keepJson = new Set()
  let images = []
  let memberIds = []
  for (const c of colls) {
    const snap = await c.get()
    stats.reads += Math.max(1, snap.size)
    const docs = {}
    for (const d of snap.docs) docs[d.id] = encodeValue(d.data())
    counts[c.id] = snap.size
    if (c.id === 'images') images = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    if (c.id === 'members') memberIds = snap.docs.map((d) => d.id)
    keepJson.add(`${c.id}.json`)
    mark(await writeIfChanged(path.join(dir, 'data', `${c.id}.json`), stableStringify({ collection: c.id, count: snap.size, docs }, 1) + '\n'))
  }

  // ---- profiles of the members (users/{uid}) ----
  const userDocs = {}
  for (const uid of memberIds.sort()) if (users.has(uid)) userDocs[uid] = encodeValue(users.get(uid))
  counts.users = Object.keys(userDocs).length
  keepJson.add('users.json')
  mark(await writeIfChanged(path.join(dir, 'data', 'users.json'), stableStringify({ collection: 'users', count: counts.users, docs: userDocs }, 1) + '\n'))

  for (const f of await listFiles(path.join(dir, 'data'))) {
    if (f.endsWith('.json') && !keepJson.has(f)) { await rm(path.join(dir, 'data', f)); stats.changed++ }
  }

  mark(await writeIfChanged(path.join(dir, 'world.json'), stableStringify({ id: wid, data: encodeValue(worldData) }, 1) + '\n'))

  // ---- images (immutable: chunks are only downloaded for new/changed files) ----
  const prevManifest = JSON.parse((await readOrNull(path.join(dir, 'manifest.json')))?.toString('utf8') || 'null')
  const prevFiles = new Map((prevManifest?.images?.files ?? []).map((f) => [f.id, f]))
  const imageFiles = []
  const keepImages = new Set()
  for (const meta of images.filter((m) => !m.deleted).sort((a, b) => a.id.localeCompare(b.id))) {
    const rel = `images/${meta.id}.${extFromMime(meta.mime)}`
    const abs = path.join(dir, rel)
    keepImages.add(path.basename(rel))
    const st = await stat(abs).catch(() => null)
    const prev = prevFiles.get(meta.id)
    if (st && st.size === Number(meta.size)) {
      const hash = prev && prev.path === rel && prev.size === st.size && prev.sha256 ? prev.sha256 : sha256(await readFile(abs))
      imageFiles.push({ id: meta.id, path: rel, mime: meta.mime, size: st.size, sha256: hash })
      continue
    }
    const n = Math.max(1, Number(meta.chunkCount) || 1)
    const refs = Array.from({ length: n }, (_, i) => db.doc(`worlds/${wid}/imageChunks/${meta.id}_${i}`))
    const snaps = await db.getAll(...refs)
    stats.reads += n
    if (snaps.some((s) => !s.exists)) {
      stats.warnings.push(`${wid}: изображение ${meta.id} повреждено (нет части), пропущено`)
      continue
    }
    const buf = Buffer.concat(snaps.map((s) => Buffer.from(s.get('data'))))
    const hash = sha256(buf)
    const old = st ? await readOrNull(abs) : null
    if (!old || sha256(old) !== hash) { await mkdir(path.dirname(abs), { recursive: true }); await writeFile(abs, buf); stats.changed++ }
    stats.imagesFetched++
    imageFiles.push({ id: meta.id, path: rel, mime: meta.mime, size: buf.length, sha256: hash })
  }
  for (const f of await listFiles(path.join(dir, 'images'))) {
    if (!keepImages.has(f)) { await rm(path.join(dir, 'images', f)); stats.changed++ }
  }

  // ---- manifest: only rewritten when something changed, so an idle day produces no commit ----
  const t = Date.now()
  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(t).toISOString(),
    exportedAtMs: t,
    generator: 'backup-runner',
    scope: 'full',
    exportedBy: null,
    world: { id: wid, name: String(worldData.name ?? '') },
    counts,
    images: { count: imageFiles.length, bytes: imageFiles.reduce((s, f) => s + f.size, 0), files: imageFiles },
    html: false,
  }
  const comparable = (m) => (m ? stableStringify({ ...m, exportedAt: null, exportedAtMs: null }) : '')
  if (stats.changed || comparable(prevManifest) !== comparable(manifest)) {
    await writeIfChanged(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
    stats.changed++
  }
  log(`  ${wid} «${manifest.world.name}»: документов ${Object.values(counts).reduce((s, x) => s + x, 0)}, изображений ${imageFiles.length} (скачано ${stats.imagesFetched}), изменённых файлов ${stats.changed}, чтений ${stats.reads}`)
  return stats
}

/** Backs up all worlds (or `onlyWorld`). */
export async function runBackup(db, { out, onlyWorld = null, log = console.log } = {}) {
  let reads = 0
  const usersSnap = await db.collection('users').get()
  reads += Math.max(1, usersSnap.size)
  const users = new Map(usersSnap.docs.map((d) => [d.id, d.data()]))
  let worlds
  if (onlyWorld) {
    const s = await db.doc(`worlds/${onlyWorld}`).get()
    reads++
    if (!s.exists) throw new Error(`Мир ${onlyWorld} не найден`)
    worlds = [s]
  } else {
    const s = await db.collection('worlds').get()
    reads += Math.max(1, s.size)
    worlds = s.docs
  }
  log(`Миров: ${worlds.length}, профилей пользователей: ${users.size}`)
  const warnings = []
  let changed = 0
  for (const w of worlds) {
    const st = await backupWorld(db, w, users, out, log)
    reads += st.reads
    changed += st.changed
    warnings.push(...st.warnings)
  }
  if (!onlyWorld) {
    const known = new Set(worlds.map((w) => w.id))
    const dirs = await readdir(out, { withFileTypes: true }).catch(() => [])
    for (const d of dirs) if (d.isDirectory() && !known.has(d.name) && !d.name.startsWith('.')) {
      log(`  ${d.name}: мира больше нет в Firestore — старая копия оставлена как есть`)
    }
  }
  for (const w of warnings) log(`ВНИМАНИЕ: ${w}`)
  log(`Готово: изменённых файлов ${changed}, чтений Firestore ~${reads} (бесплатный лимит — 50 000 в сутки)`)
  return { reads, changed, warnings }
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { out: process.env.BACKUP_DIR || 'backups', world: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i]
    else if (argv[i] === '--world') args.world = argv[++i]
  }
  return args
}

function readServiceAccount() {
  const raw = (process.env.FIREBASE_SA ?? '').trim()
  if (!raw) throw new Error('Не задана переменная окружения FIREBASE_SA (JSON ключа сервисного аккаунта).')
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  try { return JSON.parse(text) } catch { throw new Error('FIREBASE_SA не является корректным JSON ключа сервисного аккаунта.') }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const sa = readServiceAccount()
  const { initializeApp, cert } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  initializeApp({ credential: cert(sa), projectId: sa.project_id })
  const db = getFirestore()
  const out = path.resolve(args.out)
  console.log(`Проект ${sa.project_id}, папка ${out}`)
  await mkdir(out, { recursive: true })
  await runBackup(db, { out, onlyWorld: args.world })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e?.stack ?? e); process.exit(1) })
}
