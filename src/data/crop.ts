// Non-destructive framing of an image: a focal point (in % of the image) and a zoom factor.
// Every frame (square avatar, 4:3 card, wide cover, round icon) shows the area around the focal point,
// so one setting works for all aspect ratios. The original stays intact (lightbox shows it whole).
import type { Entity } from '@/model/types'

export interface ImageCrop {
  /** Focal point, 0..100 % of the image width/height. */
  x: number
  y: number
  /** 1 = cover the frame; >1 zooms in around the focal point. */
  zoom: number
}

export const DEFAULT_CROP: ImageCrop = { x: 50, y: 50, zoom: 1 }

export type CropField = 'imageCrop' | 'headerCrop' | 'backgroundCrop'

export function isZoomedCrop(c: ImageCrop | null | undefined): boolean {
  return !!c && c.zoom > 1.001
}

export function cropOf(e: Entity | null | undefined, field: CropField = 'imageCrop'): ImageCrop | null {
  const c = e?.fields?.[field]
  if (!c || typeof c !== 'object') return null
  return { x: clamp(Number(c.x ?? 50), 0, 100), y: clamp(Number(c.y ?? 50), 0, 100), zoom: clamp(Number(c.zoom ?? 1), 1, 4) }
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)

/** Inline style for an <img> filling its frame. */
export function cropStyle(c: ImageCrop | null | undefined): Record<string, string> {
  if (!c) return {}
  const pos = `${c.x}% ${c.y}%`
  const style: Record<string, string> = { objectFit: 'cover', objectPosition: pos, width: '100%', height: '100%' }
  if (c.zoom > 1.001) { style.transform = `scale(${c.zoom})`; style.transformOrigin = pos }
  return style
}

/** Same as cropStyle but as a CSS string (for DOM built by hand). */
export function cropCss(c: ImageCrop | null | undefined): string {
  const s = cropStyle(c)
  return Object.entries(s).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`).join(';')
}
