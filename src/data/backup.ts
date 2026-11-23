// Full world backup (ZIP) and restore. Archive layout: see src/data/backup/format.ts.
// The scheduled GitHub Actions runner (backup-runner/backup.mjs) writes the same layout, so a zip
// of one of its world folders can be restored here as well.
import JSZip from 'jszip'
import { Bytes, GeoPoint, Timestamp, collection, doc, getDoc, getDocs, increment } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { cache } from '@/data/cache'
import { characterIdsOf, coll, docRef, isMasterRole, visibleQueries, type Access } from '@/data/access'
import { now, slugify } from '@/data/util'
import type { Attribute, Entity, ImageMeta, Member, World } from '@/model/types'
import {
  BACKUP_FORMAT, BACKUP_VERSION, IMAGE_CHUNK, MASTER_ONLY_COLLECTIONS, NON_CONTENT_COLLECTIONS, WORLD_COLLECTIONS,
  chunkCountOf, decodeValue, docsOfCollectionFile, encodeValue, extFromMime, firestoreErrorText, mapPool, stableStringify,
  validateManifest, type BackupImageFile, type BackupManifest, type DecodeFactories, type ProgressFn, type WorldFile,
} from './backup/format'
import { BatchWriter } from './backup/writer'
import { buildOfflineSite } from './backup/offline'

export type { BackupManifest, PortProgress, ProgressFn } from './backup/format'

/** Daily free-tier write quota is 20k; keep a margin for normal use of the wiki. */
export const SAFE_DAILY_WRITES = 18_000

// =====================================================================================
// Export
// =====================================================================================

/** The world store satisfies this shape (`exportWorld(useWorld(), …)`). */
export interface ExportSource {
  wid: string | null
  access: Access
  isMaster: boolean
}

export interface ExportOptions {
  /** Include image binaries (default true). */
  images?: boolean
  /** Include the offline HTML copy (default true). */
  html?: boolean
  /** Masters: show secret blocks and private attributes in the HTML copy (default true). */
  htmlSecrets?: boolean
  /** Masters: include the edit history (default true). */
  revisions?: boolean
}

export interface ExportResult {
  blob: Blob
  manifest: BackupManifest
  filename: string
  reads: number
  warnings: string[]
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function readCollection(a: Access, name: string, master: boolean): Promise<Map<string, any>> {
  const m = new Map<string, any>()
  if (master) {
    const s = await getDocs(coll(a.wid, name))
    s.docs.forEach((d) => m.set(d.id, d.data()))
    return m
  }
  const res = await Promise.all(visibleQueries(a, name).map((q) => getDocs(q).catch(() => null)))
  for (const r of res) r?.docs.forEach((d) => m.set(d.id, d.data()))
  return m
}

/** Image bytes: local IndexedDB cache first (free), otherwise the Firestore chunks. */
async function readImageBytes(a: Access, meta: ImageMeta): Promise<{ bytes: Uint8Array; reads: number }> {
  const cached = await cache.getImage(a.wid, meta.id)
  if (cached) return { bytes: new Uint8Array(await cached.arrayBuffer()), reads: 0 }
  const n = Math.max(1, meta.chunkCount ?? 1)
  const snaps = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(docRef(a.wid, 'imageChunks', `${meta.id}_${i}`))))
  const parts = snaps.map((s) => (s.exists() ? (s.data().data as Bytes).toUint8Array() : null))
  if (parts.some((p) => !p)) throw new Error('не хватает частей изображения')
  const total = parts.reduce((sum, p) => sum + p!.length, 0)
  const bytes = new Uint8Array(total)
  let off = 0
  for (const p of parts) { bytes.set(p!, off); off += p!.length }
  void cache.putImage(a.wid, meta.id, new Blob([bytes], { type: meta.mime || 'image/webp' }))
  return { bytes, reads: n }
}

export async function exportWorldDetailed(src: ExportSource, onProgress: ProgressFn = () => {}, opts: ExportOptions = {}): Promise<ExportResult> {
  const wid = src.wid
  if (!wid) throw new Error('Мир не открыт')
  const a: Access = { ...src.access, wid }
  const master = src.isMaster || isMasterRole(a.role)
  const zip = new JSZip()
  const warnings: string[] = []
  let reads = 0
  const step = (phase: string, done: number, total: number, message?: string) => onProgress({ phase, done, total, message })

  step('Чтение мира', 0, 1)
  const ws = await getDoc(doc(db, 'worlds', wid))
  reads++
  if (!ws.exists()) throw new Error('Мир не найден или нет доступа')
  const worldData = ws.data() as Omit<World, 'id'>
  const worldName = worldData.name || 'Мир'

  const names = WORLD_COLLECTIONS.filter((n) => (master || !MASTER_ONLY_COLLECTIONS.has(n)) && (opts.revisions !== false || n !== 'revisions'))
  const data: Record<string, Map<string, any>> = {}
  const counts: Record<string, number> = {}
  for (const [i, name] of names.entries()) {
    step('Чтение данных', i, names.length, `${name}…`)
    let docs: Map<string, any>
    try {
      docs = await readCollection(a, name, master)
    } catch (e: any) {
      warnings.push(`Коллекция ${name} не прочитана: ${firestoreErrorText(e)}`)
      docs = new Map()
    }
    reads += Math.max(1, docs.size)
    data[name] = docs
    counts[name] = docs.size
    const encoded: Record<string, any> = {}
    for (const [id, d] of docs) encoded[id] = encodeValue(d)
    zip.file(`data/${name}.json`, stableStringify({ collection: name, count: docs.size, docs: encoded }, 1))
  }
  step('Чтение данных', names.length, names.length)

  // ---- images ----
  const imageFiles: BackupImageFile[] = []
  const imagePaths = new Map<string, string>()
  if (opts.images !== false) {
    const metas = [...(data.images ?? new Map()).entries()].map(([id, d]) => ({ ...d, id }) as ImageMeta).filter((m) => !m.deleted)
    let done = 0
    step('Изображения', 0, metas.length)
    await mapPool(metas, 4, async (m) => {
      try {
        const { bytes, reads: r } = await readImageBytes(a, m)
        reads += r
        const path = `images/${m.id}.${extFromMime(m.mime)}`
        zip.file(path, bytes, { binary: true, compression: 'STORE' })
        imageFiles.push({ id: m.id, path, mime: m.mime, size: bytes.length, sha256: await sha256Hex(bytes) })
        imagePaths.set(m.id, path)
      } catch (e: any) {
        warnings.push(`Изображение «${m.name || m.id}» не сохранено: ${firestoreErrorText(e)}`)
      }
      step('Изображения', ++done, metas.length, m.name)
    })
    imageFiles.sort((x, y) => x.id.localeCompare(y.id))
  }

  // ---- offline HTML copy ----
  const t = now()
  const wantHtml = opts.html !== false
  if (wantHtml) {
    step('HTML-копия', 0, 1)
    const rows = <T>(name: string): T[] => [...(data[name] ?? new Map()).entries()].map(([id, d]) => ({ ...d, id }) as T)
    const entities = rows<any>('entities').map((e): Entity => ({ tagIds: [], aliases: [], attributes: [], links: [], mentions: [], fields: {}, ...e }))
    const bodies = data.bodies ?? new Map()
    const secrets = data.secrets ?? new Map()
    const withSecrets = master && opts.htmlSecrets !== false
    const texts = new Map<string, string>()
    const privateAttrs = new Map<string, Attribute[]>()
    for (const e of entities) {
      const s = withSecrets ? secrets.get(e.id) : null
      texts.set(e.id, (s?.html as string) || (bodies.get(e.id)?.html as string) || '')
      if (s?.attributes?.length) privateAttrs.set(e.id, s.attributes as Attribute[])
    }
    const pages = buildOfflineSite({
      worldName, worldDescription: worldData.description, exportedAt: t, customTypes: worldData.settings?.customTypes ?? [],
      entities, texts, privateAttrs, imageFiles: imagePaths, includeSecrets: withSecrets,
      rows: {
        posts: rows('posts'), relations: rows('relations'), orgMembers: rows('orgMembers'), inventory: rows('inventory'),
        entityAbilities: rows('entityAbilities'), questElements: rows('questElements'), reminders: rows('reminders'),
        timelineEras: rows('timelineEras'), timelineElements: rows('timelineElements'), mapMarkers: rows('mapMarkers'),
      },
    })
    for (const [path, html] of pages) zip.file(path, html)
    step('HTML-копия', 1, 1, `${pages.size} страниц`)
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(t).toISOString(),
    exportedAtMs: t,
    generator: 'browser',
    scope: master ? 'full' : 'visible',
    exportedBy: a.uid,
    world: { id: wid, name: worldName },
    counts,
    images: { count: imageFiles.length, bytes: imageFiles.reduce((s, f) => s + f.size, 0), files: imageFiles },
    html: wantHtml,
  }
  zip.file('world.json', stableStringify({ id: wid, data: encodeValue(worldData) } satisfies WorldFile, 1))
  zip.file('manifest.json', JSON.stringify(manifest, null, 1))

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' },
    (meta) => step('Упаковка', Math.round(meta.percent), 100),
  )
  const date = new Date(t).toISOString().slice(0, 10)
  return { blob, manifest, filename: `${slugify(worldName)}-${date}.zip`, reads, warnings }
}

/** Builds the backup ZIP of a world (masters get everything, players only what they can read). */
export async function exportWorld(src: ExportSource, onProgress?: ProgressFn, opts?: ExportOptions): Promise<Blob> {
  return (await exportWorldDetailed(src, onProgress, opts)).blob
}

// =====================================================================================
// Reading an archive
// =====================================================================================

interface OpenedBackup {
  zip: JSZip
  root: string
  manifest: BackupManifest
  world: WorldFile
  /** collection → { docId → JSON (encoded) data } */
  collections: Map<string, Record<string, any>>
  /** imageId → path inside the ZIP */
  imagePaths: Map<string, string>
}

async function openBackup(file: Blob): Promise<OpenedBackup> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('Файл не похож на ZIP-архив.')
  }
  const candidates = Object.keys(zip.files)
    .filter((p) => !zip.files[p].dir && /(^|\/)manifest\.json$/.test(p))
    .sort((x, y) => x.split('/').length - y.split('/').length)
  if (!candidates.length) {
    const kanka = Object.keys(zip.files).some((p) => /(^|\/)(campaign|info)\.json$/.test(p))
    throw new Error(kanka ? 'Это экспорт Kanka, а не резервная копия — используйте раздел «Импорт из Kanka».' : 'В архиве нет manifest.json — это не резервная копия Dezremon Wiki.')
  }
  const mpath = candidates[0]
  const root = mpath.slice(0, mpath.length - 'manifest.json'.length)
  let manifest: any
  try {
    manifest = JSON.parse(await zip.file(mpath)!.async('string'))
  } catch {
    throw new Error('manifest.json повреждён.')
  }
  const err = validateManifest(manifest)
  if (err) throw new Error(err)

  let world: WorldFile = { id: manifest.world.id, data: { name: manifest.world.name } }
  const wf = zip.file(`${root}world.json`)
  if (wf) {
    const j = JSON.parse(await wf.async('string'))
    world = j && j.data ? j : { id: manifest.world.id, data: j ?? {} }
  }

  const collections = new Map<string, Record<string, any>>()
  const imagePaths = new Map<string, string>()
  for (const p of Object.keys(zip.files)) {
    if (zip.files[p].dir || !p.startsWith(root)) continue
    const rel = p.slice(root.length)
    const dm = /^data\/([A-Za-z0-9_-]+)\.json$/.exec(rel)
    if (dm) {
      try {
        collections.set(dm[1], docsOfCollectionFile(JSON.parse(await zip.files[p].async('string'))))
      } catch {
        throw new Error(`Файл ${rel} повреждён.`)
      }
      continue
    }
    const im = /^images\/([^/]+)\.[A-Za-z0-9]+$/.exec(rel)
    if (im) imagePaths.set(im[1], p)
  }
  for (const f of manifest.images?.files ?? []) {
    if (f?.id && f.path && zip.file(root + f.path)) imagePaths.set(f.id, root + f.path)
  }
  return { zip, root, manifest, world, collections, imagePaths }
}

export interface BackupInspection {
  manifest: BackupManifest
  worldName: string
  exportedAt: number
  /** Documents per collection present in the archive. */
  counts: Record<string, number>
  totalDocs: number
  images: number
  imageBytes: number
  missingImages: number
  /** Writes needed to restore into a new world (replace mode needs at most this, usually far less). */
  estimatedWrites: number
  warnings: string[]
}

function contentCollections(b: OpenedBackup, skip: Set<string>): string[] {
  const ORDER = ['images', 'entities', 'bodies', 'secrets', 'relations', 'posts', 'orgMembers', 'inventory', 'entityAbilities',
    'questElements', 'reminders', 'timelineEras', 'timelineElements', 'mapLayers', 'mapGroups', 'mapMarkers', 'messages', 'comments', 'bookmarks', 'revisions']
  const names = [...b.collections.keys()].filter((n) => !NON_CONTENT_COLLECTIONS.has(n) && !skip.has(n))
  return names.sort((x, y) => {
    const ix = ORDER.indexOf(x), iy = ORDER.indexOf(y)
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.localeCompare(y)
  })
}

function estimate(b: OpenedBackup, skip: Set<string>, withMembers: boolean) {
  let writes = 2 // world + owner membership
  let missing = 0, images = 0, bytes = 0
  const sizes = new Map((b.manifest.images?.files ?? []).map((f) => [f.id, f.size]))
  for (const name of contentCollections(b, skip)) {
    const docs = b.collections.get(name)!
    writes += Object.keys(docs).length
    if (name !== 'images') continue
    for (const [id, m] of Object.entries(docs)) {
      if (m?.deleted) continue
      if (!b.imagePaths.has(id)) { missing++; continue }
      const size = sizes.get(id) ?? (Number(m?.size) || IMAGE_CHUNK)
      images++
      bytes += size
      writes += chunkCountOf(size)
    }
  }
  if (withMembers) writes += Object.keys(b.collections.get('members') ?? {}).length + Object.keys(b.collections.get('invites') ?? {}).length
  return { writes, missing, images, bytes }
}

/** Reads an archive without writing anything: manifest, counts and the write estimate. */
export async function inspectBackup(file: Blob): Promise<BackupInspection> {
  const b = await openBackup(file)
  const counts: Record<string, number> = {}
  for (const [name, docs] of b.collections) counts[name] = Object.keys(docs).length
  const est = estimate(b, new Set(), false)
  const warnings: string[] = []
  if (b.manifest.scope === 'visible') warnings.push('Копия сделана не мастером: в ней нет секретов, истории правок и списка участников.')
  if (est.missing) warnings.push(`Для ${est.missing} изображений нет файлов в архиве — они будут восстановлены без картинки.`)
  if (est.writes > SAFE_DAILY_WRITES) {
    warnings.push(`Восстановление в новый мир потребует ~${est.writes.toLocaleString('ru-RU')} записей — больше дневного лимита бесплатного тарифа (20 000). Отключите историю правок или продолжите на следующий день режимом «Заменить» (уже записанные документы будут пропущены).`)
  }
  return {
    manifest: b.manifest,
    worldName: b.manifest.world?.name || String(b.world.data?.name ?? ''),
    exportedAt: b.manifest.exportedAtMs || Date.parse(b.manifest.exportedAt) || 0,
    counts,
    totalDocs: Object.values(counts).reduce((s, n) => s + n, 0),
    images: est.images,
    imageBytes: est.bytes,
    missingImages: est.missing,
    estimatedWrites: est.writes,
    warnings,
  }
}

// =====================================================================================
// Restore
// =====================================================================================

export interface RestoreOptions {
  /** Name of the new world (mode 'new'); defaults to the backed-up name. */
  name?: string
  /** Mode 'new': also restore other members and invites (default false — only you become the owner). */
  restoreMembers?: boolean
  /** Collections to leave out (e.g. ['revisions'] to save writes). In 'replace' mode they are left untouched. */
  skipCollections?: string[]
}

export interface RestoreReport {
  ok: boolean
  error?: string
  mode: 'new' | 'replace'
  wid: string | null
  worldName: string
  /** Documents written per collection (imageChunks included). */
  written: Record<string, number>
  /** replace: documents already identical to the backup (not rewritten). */
  unchanged: number
  /** replace: documents removed because they are not in the backup. */
  deleted: number
  images: { restored: number; reused: number; missing: number }
  writes: number
  reads: number
  warnings: string[]
}

const factories: DecodeFactories = {
  timestamp: (s, ns) => new Timestamp(s, ns),
  bytes: (b64) => Bytes.fromBase64String(b64),
  geopoint: (lat, lng) => new GeoPoint(lat, lng),
  ref: (path) => doc(db, path),
}
const decode = (v: any) => decodeValue(v, factories)

/**
 * Restores an archive.
 *  - 'new': creates a new world (new id, you are the owner) and writes every document with its original id.
 *  - 'replace': rewrites the content of `currentWid` — documents identical to the backup are skipped, the rest is
 *    overwritten, documents missing from the backup are deleted at the end. Members and invites are never touched.
 */
export async function restoreWorld(
  file: Blob, mode: 'new' | 'replace', currentWid?: string, onProgress: ProgressFn = () => {}, opts: RestoreOptions = {},
): Promise<RestoreReport> {
  const user = auth.currentUser
  if (!user) throw new Error('Нужно войти в аккаунт')
  if (mode === 'replace' && !currentWid) throw new Error('Не выбран мир для замены')
  onProgress({ phase: 'Чтение архива', done: 0, total: 1 })
  const b = await openBackup(file)
  const skip = new Set(opts.skipCollections ?? [])
  const est = estimate(b, skip, mode === 'new' && !!opts.restoreMembers)
  const report: RestoreReport = {
    ok: true, mode, wid: null, worldName: '', written: {}, unchanged: 0, deleted: 0,
    images: { restored: 0, reused: 0, missing: 0 }, writes: 0, reads: 0, warnings: [],
  }
  const bump = (name: string, n = 1) => { report.written[name] = (report.written[name] ?? 0) + n }
  let phase = 'Запись'
  const writer = new BatchWriter({
    onCommit: (n) => onProgress({ phase, done: Math.min(n, est.writes), total: est.writes, message: `записано ${n} из ~${est.writes}` }),
  })
  const t = now()
  const worldData = decode(b.world.data ?? {}) as Record<string, any>
  delete worldData.id

  try {
    let wid: string
    if (mode === 'new') {
      wid = doc(collection(db, 'worlds')).id
      const name = opts.name?.trim() || String(worldData.name || b.manifest.world.name || 'Восстановленный мир')
      report.worldName = name
      const prevMe = b.collections.get('members')?.[user.uid]
      const me: Member = {
        uid: user.uid, role: 'owner', displayName: user.displayName || user.email || 'Мастер', email: user.email ?? '',
        photoURL: user.photoURL ?? null, joinedAt: t, favorites: Array.isArray(prevMe?.favorites) ? prevMe.favorites : [],
        characterIds: characterIdsOf(prevMe),
      }
      const w = {
        description: '', isPublic: false, imageId: null, headerImageId: null, settings: {}, ...worldData,
        name, ownerId: user.uid, aclVersion: 0, createdAt: Number(worldData.createdAt) || t, updatedAt: t,
      }
      phase = 'Создание мира'
      await writer.set(doc(db, 'worlds', wid), w)
      await writer.set(docRef(wid, 'members', user.uid), me)
      await writer.flush() // ownership must exist before the security rules let us write content
    } else {
      wid = currentWid!
      const ms = await getDoc(docRef(wid, 'members', user.uid))
      report.reads++
      if (!ms.exists() || !isMasterRole((ms.data() as Member).role)) throw new Error('Заменить содержимое мира может только мастер или владелец.')
      report.worldName = String(worldData.name || b.manifest.world.name || '')
    }
    report.wid = wid

    const stale: Array<ReturnType<typeof docRef>> = []
    for (const name of contentCollections(b, skip)) {
      phase = `Запись: ${name}`
      const docs = b.collections.get(name)!
      let have: Map<string, string> | null = null
      const oldImages = new Map<string, { size: number; chunkCount: number; deleted: boolean }>()
      if (mode === 'replace') {
        onProgress({ phase: 'Сравнение с текущими данными', done: 0, total: 1, message: name })
        const snap = await getDocs(coll(wid, name))
        report.reads += Math.max(1, snap.size)
        have = new Map()
        for (const d of snap.docs) {
          const data = d.data()
          have.set(d.id, stableStringify(encodeValue(data)))
          if (name === 'images') oldImages.set(d.id, { size: Number(data.size) || 0, chunkCount: Number(data.chunkCount) || 1, deleted: !!data.deleted })
        }
      }

      if (name === 'images') {
        for (const [id, raw] of Object.entries(docs)) {
          const meta: Record<string, any> = { ...raw }
          let bytes: Uint8Array | null = null
          if (!meta.deleted) {
            const path = b.imagePaths.get(id)
            if (path) {
              bytes = await b.zip.file(path)!.async('uint8array')
              meta.size = bytes.length
              meta.chunkCount = chunkCountOf(bytes.length)
            } else {
              report.images.missing++
              report.warnings.push(`Нет файла изображения «${meta.name || id}» — восстановлены только метаданные.`)
            }
          }
          if (have?.get(id) === stableStringify(meta)) report.unchanged++
          else { await writer.set(docRef(wid, 'images', id), decode(meta)); bump('images') }
          const old = oldImages.get(id)
          const newCount = bytes ? meta.chunkCount as number : 0
          if (bytes) {
            if (old && !old.deleted && old.size === bytes.length && old.chunkCount === newCount) {
              report.images.reused++
            } else {
              const vis = { visibility: meta.visibility ?? 'members', allowedUids: meta.allowedUids ?? [], createdBy: meta.createdBy ?? user.uid }
              for (let n = 0; n < newCount; n++) {
                const part = bytes.subarray(n * IMAGE_CHUNK, (n + 1) * IMAGE_CHUNK)
                await writer.set(docRef(wid, 'imageChunks', `${id}_${n}`), { imageId: id, n, data: Bytes.fromUint8Array(part), ...vis, updatedAt: Number(meta.updatedAt) || t }, part.length + 512)
                bump('imageChunks')
              }
              report.images.restored++
            }
            void cache.putImage(wid, id, new Blob([bytes as BlobPart], { type: meta.mime || 'image/webp' }))
          }
          if (old && !old.deleted) for (let n = newCount; n < old.chunkCount; n++) stale.push(docRef(wid, 'imageChunks', `${id}_${n}`))
        }
        for (const [id, old] of oldImages) {
          if (id in docs) continue
          stale.push(docRef(wid, 'images', id))
          if (!old.deleted) for (let n = 0; n < old.chunkCount; n++) stale.push(docRef(wid, 'imageChunks', `${id}_${n}`))
        }
        continue
      }

      for (const [id, raw] of Object.entries(docs)) {
        if (have && have.get(id) === stableStringify(raw)) { report.unchanged++; continue }
        await writer.set(docRef(wid, name, id), decode(raw))
        bump(name)
      }
      if (have) for (const id of have.keys()) if (!(id in docs)) stale.push(docRef(wid, name, id))
    }

    if (mode === 'new' && opts.restoreMembers) {
      phase = 'Запись: участники'
      for (const [uid, raw] of Object.entries(b.collections.get('members') ?? {})) {
        if (uid === user.uid) continue
        const m = decode(raw)
        await writer.set(docRef(wid, 'members', uid), { ...m, uid, role: m.role === 'owner' ? 'master' : m.role })
        bump('members')
      }
      for (const [code, raw] of Object.entries(b.collections.get('invites') ?? {})) {
        await writer.set(docRef(wid, 'invites', code), { ...decode(raw), worldName: report.worldName })
        bump('invites')
      }
    }

    if (stale.length) {
      phase = 'Удаление лишнего'
      for (const ref of stale) await writer.delete(ref)
      report.deleted = stale.length
    }
    await writer.flush()

    if (mode === 'replace') {
      // Restored docs keep their original updatedAt, so delta-syncing clients must do a full resync: bump aclVersion.
      await writer.update(doc(db, 'worlds', wid), {
        name: worldData.name ?? report.worldName, description: worldData.description ?? '', isPublic: !!worldData.isPublic,
        imageId: worldData.imageId ?? null, headerImageId: worldData.headerImageId ?? null, settings: worldData.settings ?? {},
        aclVersion: increment(1), updatedAt: now(),
      })
      await writer.flush()
      await cache.clearWorld(wid)
    }
  } catch (e: any) {
    console.error(e)
    report.ok = false
    report.error = firestoreErrorText(e)
  }
  report.writes = writer.writes
  if (!report.ok && report.wid && writer.writes > 0) {
    report.warnings.push(mode === 'new'
      ? 'Восстановление прервано. Мир создан частично: откройте его и запустите восстановление ещё раз в режиме «Заменить текущий мир» — уже записанные документы будут пропущены.'
      : 'Восстановление прервано. Запустите его ещё раз позже — уже записанные документы будут пропущены.')
  }
  onProgress({ phase: report.ok ? 'Готово' : 'Ошибка', done: 1, total: 1, message: report.error, level: report.ok ? 'info' : 'error' })
  return report
}
