// Import of a Kanka campaign export (ZIP) into the current world.
// The conversion itself is pure (src/data/kanka/convert.ts); this file uploads images and writes Firestore.
import JSZip from 'jszip'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { docRef, type Access } from '@/data/access'
import { uploadImage } from '@/data/images'
import { mentionIds, stripSecrets } from '@/data/html'
import { excerptOf, htmlToText, now, randomId, escapeHtml } from '@/data/util'
import type { CustomType, Role } from '@/model/types'
import { BatchWriter, approxDocSize } from './backup/writer'
import { firestoreErrorText, mimeFromName, type ProgressFn } from './backup/format'
import {
  ROW_COLLECTIONS, estimatePlanWrites, loadKankaInput, planKankaImport, stripImages, type KankaInput, type KankaPlan, type PlannedImage,
} from './kanka/convert'

export interface KankaTarget {
  wid: string
  uid: string
  role?: Role | null
  /** Current entities of the world (used to merge tags by name). `useWorld().list` fits. */
  existingEntities?: Array<{ id: string; type: string; name: string; deleted?: boolean }>
}

export interface KankaOptions {
  /** Non-private Kanka entities/posts become 'public' instead of 'members'. */
  publicByDefault?: boolean
  /** Upload gallery images that nothing refers to (costs writes). */
  importUnusedGallery?: boolean
  /** Reuse existing tags with the same name (default true). */
  mergeTags?: boolean
}

export interface KankaInspection {
  campaign: string
  byType: Record<string, number>
  totalEntities: number
  rows: Record<string, number>
  images: number
  customTypes: CustomType[]
  estimatedWrites: number
  warnings: string[]
  skipped: string[]
}

export interface KankaReport {
  ok: boolean
  error?: string
  campaign: string
  /** Entities per type (planned; on failure compare `writes` with `estimatedWrites`). */
  byType: Record<string, number>
  rows: Record<string, number>
  images: { uploaded: number; failed: number }
  mentions: { converted: number; unresolved: number }
  customTypes: string[]
  writes: number
  estimatedWrites: number
  warnings: string[]
  skipped: string[]
}

const MAX_DOC = 1_000_000

async function readKanka(file: Blob): Promise<{ zip: JSZip; input: KankaInput }> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('Файл не похож на ZIP-архив.')
  }
  const input = await loadKankaInput(zip)
  if (!input.records.length) {
    const ours = Object.keys(zip.files).some((p) => /(^|\/)manifest\.json$/.test(p))
    throw new Error(ours ? 'Это резервная копия Dezremon Wiki — используйте раздел «Восстановление».' : 'В архиве не найдено сущностей Kanka. Нужен экспорт кампании (Настройки кампании → Экспорт → JSON).')
  }
  return { zip, input }
}

function makePlan(input: KankaInput, uid: string, options: KankaOptions, existing?: KankaTarget['existingEntities']): KankaPlan {
  const tags = options.mergeTags === false ? [] : (existing ?? []).filter((e) => e.type === 'tag' && !e.deleted).map((e) => ({ id: e.id, name: e.name }))
  return planKankaImport(input, {
    uid, now: now(), publicByDefault: !!options.publicByDefault, importUnusedGallery: !!options.importUnusedGallery, existingTags: tags, idGen: () => randomId(),
  })
}

/** Reads the export and plans the import without writing anything. */
export async function inspectKanka(file: Blob, options: KankaOptions = {}, existing?: KankaTarget['existingEntities']): Promise<KankaInspection> {
  const { input } = await readKanka(file)
  const plan = makePlan(input, 'preview', options, existing)
  return {
    campaign: plan.report.campaign,
    byType: plan.report.byType,
    totalEntities: plan.entities.length,
    rows: plan.report.rows,
    images: plan.images.length,
    customTypes: plan.customTypes,
    estimatedWrites: estimatePlanWrites(plan),
    warnings: plan.report.warnings,
    skipped: plan.report.skipped,
  }
}

async function imageBlob(zip: JSZip, root: string, img: PlannedImage): Promise<Blob> {
  if (img.source.kind === 'data') return (await fetch(img.source.data)).blob()
  const f = zip.file(root + img.source.path)
  if (!f) throw new Error('файл не найден в архиве')
  const bytes = await f.async('uint8array')
  return new Blob([bytes as BlobPart], { type: mimeFromName(img.source.path) })
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bm = await createImageBitmap(blob)
    const r = { width: bm.width, height: bm.height }
    bm.close()
    return r
  } catch {
    return null
  }
}

/** Firestore rejects documents over 1 MiB: fall back to plain text, then cut. */
function fitHtml(html: string, warn: (m: string) => void, what: string): string {
  if (approxDocSize(html) < MAX_DOC) return html
  const text = htmlToText(html)
  warn(`Текст «${what}» больше 1 МиБ — сохранён без форматирования`)
  const paras = text.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ])/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')
  return approxDocSize(paras) < MAX_DOC ? paras : `<p>${escapeHtml(text.slice(0, 300_000))}…</p>`
}

/**
 * Imports a Kanka campaign export into the world `target.wid`.
 * Order: images (each one is its own small batch) → world settings (custom types) → entities, bodies, secrets → child rows.
 */
export async function importKanka(file: Blob, target: KankaTarget, options: KankaOptions = {}, onProgress: ProgressFn = () => {}): Promise<KankaReport> {
  const log = (phase: string, done: number, total: number, message?: string, level: 'info' | 'warn' | 'error' = 'info') =>
    onProgress({ phase, done, total, message, level })
  log('Чтение архива', 0, 1)
  const { zip, input } = await readKanka(file)
  const plan = makePlan(input, target.uid, options, target.existingEntities)
  const est = estimatePlanWrites(plan)
  const report: KankaReport = {
    ok: true, campaign: plan.report.campaign, byType: plan.report.byType, rows: plan.report.rows,
    images: { uploaded: 0, failed: 0 }, mentions: plan.report.mentions, customTypes: plan.customTypes.map((c) => c.label),
    writes: 0, estimatedWrites: est, warnings: [...plan.report.warnings], skipped: plan.report.skipped,
  }
  const warn = (m: string) => { report.warnings.push(m); log('Предупреждение', 0, 0, m, 'warn') }
  log('Разбор', 1, 1, `Найдено статей: ${plan.entities.length}, изображений: ${plan.images.length}, записей Firestore: ~${est}`)

  const access: Access = { wid: target.wid, uid: target.uid, role: target.role ?? 'master' }
  const byId = new Map(plan.entities.map((e) => [e.id, e]))
  const failed = new Set<string>()
  let phase = 'Запись'
  const writer = new BatchWriter({ onCommit: (n) => log(phase, Math.min(report.writes + n, est), est) })
  let imageWrites = 0

  try {
    // ---- images ----
    for (const [i, img] of plan.images.entries()) {
      try {
        const blob = await imageBlob(zip, input.root, img)
        if (img.mapFor) {
          const dim = await imageSize(blob)
          const map = byId.get(img.mapFor)
          if (dim && map) { map.fields.mapWidth ??= dim.width; map.fields.mapHeight ??= dim.height }
        }
        if (img.focus && img.cropFor?.length) {
          // focal point in pixels of the original → % (independent of our downscaling)
          const dim = await imageSize(blob)
          if (dim && dim.width && dim.height) {
            const crop = { x: Math.round(Math.min(100, Math.max(0, (img.focus.x / dim.width) * 100)) * 10) / 10, y: Math.round(Math.min(100, Math.max(0, (img.focus.y / dim.height) * 100)) * 10) / 10, zoom: 1 }
            for (const t of img.cropFor) { const e = byId.get(t.entityId); if (e) e.fields = { ...e.fields, [t.field]: crop } }
          }
        }
        const meta = await uploadImage(access, blob, { id: img.id, name: img.name, folder: img.folder, visibility: img.visibility })
        imageWrites += 1 + meta.chunkCount
        report.images.uploaded++
      } catch (e: any) {
        const code = String(e?.code ?? '')
        if (code === 'resource-exhausted' || code === 'permission-denied' || code === 'unauthenticated') throw e
        failed.add(img.id)
        report.images.failed++
        warn(`Изображение «${img.name}» не загружено: ${firestoreErrorText(e)}`)
      }
      log('Изображения', i + 1, plan.images.length, img.name)
    }
    report.writes = imageWrites

    // ---- clean references to failed images ----
    if (failed.size) {
      for (const e of plan.entities) {
        if (e.imageId && failed.has(e.imageId)) e.imageId = null
        if (e.headerImageId && failed.has(e.headerImageId)) e.headerImageId = null
        if (e.fields.mapImageId && failed.has(e.fields.mapImageId)) delete e.fields.mapImageId
        plan.bodies[e.id] = stripImages(plan.bodies[e.id] ?? '', failed)
      }
      for (const c of ROW_COLLECTIONS) for (const r of plan.rows[c]) {
        if (typeof r.html === 'string') r.html = stripImages(r.html, failed)
        if (r.imageId && failed.has(r.imageId)) r.imageId = null
      }
    }

    // ---- world settings: custom modules, main calendar ----
    if (plan.customTypes.length || plan.calendarIds.length) {
      const ws = await getDoc(doc(db, 'worlds', target.wid))
      const settings = (ws.data()?.settings ?? {}) as Record<string, any>
      const existing: CustomType[] = Array.isArray(settings.customTypes) ? settings.customTypes : []
      const patch: Record<string, any> = {}
      const added = plan.customTypes.filter((c) => !existing.some((x) => x.key === c.key))
      if (added.length) patch['settings.customTypes'] = [...existing, ...added]
      if (!settings.mainCalendarId && plan.calendarIds[0]) patch['settings.mainCalendarId'] = plan.calendarIds[0]
      if (Object.keys(patch).length) {
        await updateDoc(doc(db, 'worlds', target.wid), { ...patch, updatedAt: now() })
        report.writes++
        if (added.length) log('Настройки мира', 1, 1, `Добавлены типы: ${added.map((c) => c.label).join(', ')}`)
      }
    }
    const base = report.writes

    // ---- entities, texts, secrets ----
    phase = 'Статьи'
    for (const e of plan.entities) {
      const html = fitHtml(plan.bodies[e.id] ?? '', warn, e.name)
      const readable = stripSecrets(html)
      const needBody = !!html || e.hasSecrets
      const t = Date.now()
      e.excerpt = excerptOf(readable)
      e.mentions = mentionIds(readable)
      e.bodyRev = needBody ? 1 : 0
      e.updatedAt = t
      await writer.set(docRef(target.wid, 'entities', e.id), { ...e })
      if (needBody) {
        await writer.set(docRef(target.wid, 'bodies', e.id), {
          html: readable, rev: 1, visibility: e.visibility, allowedUids: e.allowedUids, createdBy: e.createdBy, updatedAt: t, updatedBy: target.uid,
        })
      }
      if (e.hasSecrets) {
        await writer.set(docRef(target.wid, 'secrets', e.id), {
          html, attributes: plan.privateAttrs[e.id] ?? [], gmNotes: plan.gmNotes[e.id] ?? '', rev: 1, updatedAt: t, updatedBy: target.uid,
        })
      }
    }

    // ---- child rows ----
    for (const c of ROW_COLLECTIONS) {
      phase = `Записи: ${c}`
      for (const r of plan.rows[c]) {
        const row: Record<string, any> = { ...r, updatedAt: Date.now() }
        if (typeof row.html === 'string') row.html = fitHtml(row.html, warn, row.title || row.name || c)
        await writer.set(docRef(target.wid, c, row.id), row)
      }
    }
    await writer.flush()
    report.writes = base + writer.writes
  } catch (e: any) {
    console.error(e)
    report.ok = false
    report.error = firestoreErrorText(e)
    report.writes = imageWrites + writer.writes + (report.writes > imageWrites ? 1 : 0)
    report.warnings.push('Импорт прерван — часть данных уже записана. Повторный импорт того же архива создаст дубликаты: удалите импортированное (корзина) или продолжите вручную.')
  }
  log(report.ok ? 'Готово' : 'Ошибка', 1, 1, report.error ?? `Импортировано статей: ${plan.entities.length}`, report.ok ? 'info' : 'error')
  return report
}
