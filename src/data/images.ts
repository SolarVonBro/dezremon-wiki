// Images live in Firestore (free Spark plan has no Cloud Storage): metadata + small thumbnail in
// worlds/{w}/images/{id}, the bytes split into <=900 KB chunks in worlds/{w}/imageChunks/{id}_{n}.
// Images are immutable (a replacement is a new id), so blobs are cached in IndexedDB forever.
import { Bytes, getDoc, writeBatch } from 'firebase/firestore'
import DOMPurify from 'dompurify'
import { db } from '@/firebase'
import { cache } from './cache'
import { docRef, isMasterRole, widen, type Access } from './access'
import { now, randomId } from './util'
import type { ImageMeta, Visibility } from '@/model/types'

const CHUNK = 900_000
const MAX_SIDE = 2400
const MAX_BYTES = 3_500_000

const urlCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
/** Local blob URLs for images still uploading (editor shows them immediately). */
export const pendingImages = new Map<string, string>()
/** Upload promises by image id: visibility updates wait for them instead of skipping the image. */
export const uploadPromises = new Map<string, Promise<unknown>>()

async function canvasBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, q: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality: q })
  return new Promise((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q))
}

async function scaled(bitmap: ImageBitmap, maxSide: number, type: string, q: number): Promise<Blob> {
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvasBlob(c, type, q)
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b) })
}

export interface Processed { blob: Blob; mime: string; width: number; height: number; thumb: string }

export async function processImage(file: Blob): Promise<Processed> {
  const type = file.type || 'image/png'
  if (type === 'image/svg+xml') {
    const clean = DOMPurify.sanitize(await file.text(), { USE_PROFILES: { svg: true, svgFilters: true } })
    const blob = new Blob([clean], { type })
    return { blob, mime: type, width: 0, height: 0, thumb: await blobToDataUrl(blob) }
  }
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const thumb = await blobToDataUrl(await scaled(bitmap, 320, 'image/webp', 0.78))
  let blob: Blob = file
  let mime = type
  const keepOriginal = (type === 'image/gif' || ['image/jpeg', 'image/webp', 'image/png'].includes(type)) &&
    file.size <= MAX_BYTES && Math.max(width, height) <= MAX_SIDE && (type === 'image/gif' || file.size < 600_000)
  if (!keepOriginal) {
    let q = 0.86, side = MAX_SIDE
    blob = await scaled(bitmap, side, 'image/webp', q)
    while (blob.size > MAX_BYTES && side > 600) { side = Math.round(side * 0.8); q = Math.max(0.6, q - 0.06); blob = await scaled(bitmap, side, 'image/webp', q) }
    mime = 'image/webp'
    if (file.size < blob.size && file.size <= MAX_BYTES && Math.max(width, height) <= MAX_SIDE) { blob = file; mime = type }
  }
  const k = Math.min(1, MAX_SIDE / Math.max(width, height))
  bitmap.close()
  return { blob, mime, width: mime === type ? width : Math.round(width * k), height: mime === type ? height : Math.round(height * k), thumb }
}

export async function uploadImage(a: Access, file: Blob, opts: { name?: string; folder?: string; visibility?: Visibility; allowedUids?: string[]; id?: string }): Promise<ImageMeta> {
  if (!a.uid) throw new Error('Нужно войти')
  const p = await processImage(file)
  const id = opts.id ?? randomId()
  const bytes = new Uint8Array(await p.blob.arrayBuffer())
  const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK))
  const t = now()
  const vis = { visibility: opts.visibility ?? 'members', allowedUids: opts.allowedUids ?? [], createdBy: a.uid }
  const meta: ImageMeta = {
    id, name: opts.name ?? ((file as File).name || 'image'), mime: p.mime, width: p.width, height: p.height, size: bytes.length,
    chunkCount, thumb: p.thumb, folder: opts.folder ?? '', deleted: false, ...vis,
    createdAt: t, updatedAt: t, updatedBy: a.uid,
  }
  const batch = writeBatch(db)
  batch.set(docRef(a.wid, 'images', id), meta)
  for (let i = 0; i < chunkCount; i++) {
    batch.set(docRef(a.wid, 'imageChunks', `${id}_${i}`), { imageId: id, n: i, data: Bytes.fromUint8Array(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)), ...vis, updatedAt: t })
  }
  await batch.commit()
  await cache.putImage(a.wid, id, p.blob)
  await cache.putImage(a.wid, `${id}@thumb`, await (await fetch(p.thumb)).blob())
  return meta
}

/** Rebuild an image from its chunks (or local caches). `thumb` returns the small preview only. */
export function imageUrl(a: Access, id: string, variant: 'full' | 'thumb' = 'full'): Promise<string> {
  if (pendingImages.has(id)) return Promise.resolve(pendingImages.get(id)!)
  const key = `${a.wid}/${id}@${variant}`
  if (urlCache.has(key)) return Promise.resolve(urlCache.get(key)!)
  if (variant === 'thumb' && urlCache.has(`${a.wid}/${id}@full`)) return Promise.resolve(urlCache.get(`${a.wid}/${id}@full`)!)
  if (inflight.has(key)) return inflight.get(key)!
  const p = (async () => {
    const cacheKey = variant === 'thumb' ? `${id}@thumb` : id
    let blob = await cache.getImage(a.wid, cacheKey)
    if (!blob && variant === 'thumb') blob = await cache.getImage(a.wid, id)
    if (!blob) {
      if (variant === 'thumb') {
        const snap = await getDoc(docRef(a.wid, 'images', id))
        if (!snap.exists()) throw new Error('нет изображения')
        blob = await (await fetch((snap.data() as ImageMeta).thumb)).blob()
      } else {
        blob = await fetchFull(a, id)
      }
      await cache.putImage(a.wid, cacheKey, blob)
    }
    const url = URL.createObjectURL(blob)
    urlCache.set(key, url)
    return url
  })()
  inflight.set(key, p)
  p.finally(() => inflight.delete(key))
  return p
}

async function fetchFull(a: Access, id: string): Promise<Blob> {
  const meta = await getDoc(docRef(a.wid, 'images', id)).catch(() => null)
  const m = meta?.exists() ? (meta.data() as ImageMeta) : null
  const n = m?.chunkCount ?? 1
  const ids = Array.from({ length: n }, (_, i) => `${id}_${i}`)
  // Chunks are fetched by id; visibility filters keep the query within the rules for players/guests.
  const parts: Uint8Array[] = new Array(n)
  const chunkDocs = await Promise.all(ids.map((cid) => getDoc(docRef(a.wid, 'imageChunks', cid))))
  chunkDocs.forEach((d, i) => { if (d.exists()) parts[i] = (d.data().data as Bytes).toUint8Array() })
  if (parts.some((p) => !p)) throw new Error('изображение повреждено')
  return new Blob(parts as BlobPart[], { type: m?.mime ?? 'image/webp' })
}

export async function imageBlob(a: Access, id: string): Promise<Blob> {
  const cached = await cache.getImage(a.wid, id)
  if (cached) return cached
  const b = await fetchFull(a, id)
  await cache.putImage(a.wid, id, b)
  return b
}

/** Make sure every image referenced by readable content is at least as visible as that content. */
export async function ensureImageAccess(a: Access, ids: string[], target: { visibility: Visibility; allowedUids: string[] }) {
  if (!ids.length || !a.uid) return
  const unique = [...new Set(ids)]
  await Promise.allSettled(unique.map((i) => uploadPromises.get(i)).filter(Boolean))
  const snaps = await Promise.all(unique.map((id) => getDoc(docRef(a.wid, 'images', id)).catch(() => null)))
  const batch = writeBatch(db)
  let n = 0
  for (const s of snaps) {
    if (!s?.exists()) continue
    const m = s.data() as ImageMeta
    if (!isMasterRole(a.role) && m.createdBy !== a.uid) continue
    const w = widen(m, target)
    if (!w) continue
    batch.update(s.ref, { ...w, updatedAt: now() })
    for (let c = 0; c < (m.chunkCount ?? 1); c++) batch.update(docRef(a.wid, 'imageChunks', `${s.id}_${c}`), { ...w })
    n++
  }
  if (n) await batch.commit().catch((e) => console.warn('image visibility update failed', e))
}

export function imageIdsInHtml(html: string): string[] {
  const out: string[] = []
  html.replace(/data-image-id="([^"]+)"/g, (_, id) => { out.push(id); return '' })
  return out
}
