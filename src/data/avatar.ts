// The user's own picture: the chosen file is scaled down to a source (kept to frame it again later), and the framed
// square — the same focal point + zoom as article pictures (src/data/crop.ts) — is rendered small for everywhere else.
import type { ImageCrop } from './crop'

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => fail(new Error('Не удалось прочитать картинку'))
    img.src = src
  })
}

function toDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality)
}

/** A picture file → a data URL no larger than `max` px on its longer side (the source of the own picture). */
export async function fileToSource(file: Blob, max = 512): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await load(url)
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k))
    c.height = Math.max(1, Math.round(img.naturalHeight * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return toDataUrl(c, 0.85)
  } finally { URL.revokeObjectURL(url) }
}

/**
 * Renders the framed square exactly as a framed <img> shows it (object-fit: cover at the focal point, then scale(zoom)
 * around that point — see cropStyle), `size` px wide.
 */
export async function renderAvatar(src: string, crop: ImageCrop | null, size = 192): Promise<string> {
  const img = await load(src)
  const x = crop?.x ?? 50, y = crop?.y ?? 50, zoom = crop?.zoom ?? 1
  const s0 = size / Math.min(img.naturalWidth, img.naturalHeight)
  const w = img.naturalWidth * s0, h = img.naturalHeight * s0
  const ox = (size - w) * (x / 100), oy = (size - h) * (y / 100)
  const fx = size * (x / 100), fy = size * (y / 100)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, fx + (ox - fx) * zoom, fy + (oy - fy) * zoom, w * zoom, h * zoom)
  return toDataUrl(c, 0.85)
}
