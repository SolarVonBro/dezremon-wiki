// Helpers of the interactive map module: normalisation of rows (they may come from the Kanka importer
// with Kanka-style values), HTML for Leaflet div icons, small geometry and search helpers.
//
// Coordinate space (same as Kanka): L.CRS.Simple, image bounds [[0, 0], [height, width]] in image pixels,
// `lat` = y measured from the bottom edge, `lng` = x from the left edge.
import { h, render } from 'vue'
import { ICONS, iconComponent } from '@/components/common/icons'
import { cropCss, type ImageCrop } from '@/data/crop'
import { escapeHtml, htmlToText } from '@/data/util'
import type { Entity, LatLng, MapGroup, MapLayer, MapMarker, Visibility } from '@/model/types'

export type MarkerShape = MapMarker['shape']

export const SHAPES: { value: MarkerShape; label: string; icon: string }[] = [
  { value: 'marker', label: 'Маркер', icon: 'map-pin' },
  { value: 'label', label: 'Подпись', icon: 'type' },
  { value: 'circle', label: 'Круг', icon: 'circle' },
  { value: 'polygon', label: 'Область', icon: 'hexagon' },
]

/** Editable part of a marker (what the editor panel works on). New markers have no id. */
export type MarkerData = Pick<MapMarker,
  'mapId' | 'groupId' | 'entityId' | 'name' | 'lat' | 'lng' | 'shape' | 'icon' | 'colour' | 'fontColour' |
  'opacity' | 'size' | 'radius' | 'points' | 'html' | 'isDraggable' | 'visibility' | 'allowedUids'> & { id?: string }

/** Row of the marker list / legend. `group` is the effective group key (NO_GROUP when none/unknown). */
export interface ListItem { marker: MapMarker; entity: Entity | null; name: string; group: string }

/** Group section of the legend (`key` is a group id or NO_GROUP). */
export interface LegendGroup { key: string; name: string; items: MapMarker[] }

export const NO_GROUP = '__none'
export const DRAFT_ID = '__draft'
export const DEFAULT_COLOUR = '#c9a227'
export const DEFAULT_FONT = '#ffffff'
export const DEFAULT_SIZE = 32
/** Default fill opacity of circles and polygons. */
export const AREA_OPACITY = 0.35
/** Marker icon value meaning "the linked entity's picture" (Kanka icon 4). */
export const ICON_ENTITY = 'entity'

export const SWATCHES = ['#c9a227', '#b5473a', '#d0703c', '#4f9d69', '#4a8f8a', '#3f7fbf', '#6a5acd', '#a86fc4', '#2a241c', '#ffffff']

/** Icons offered first in the icon picker (all icons from icons.ts are searchable). */
export const MAP_ICONS = [
  'map-pin', 'castle', 'landmark', 'building2', 'church', 'home', 'tent', 'store', 'factory', 'warehouse', 'school', 'hospital',
  'crown', 'swords', 'sword', 'shield', 'skull', 'ghost', 'flame', 'mountain', 'tree-pine', 'leaf', 'waves', 'droplet', 'ship', 'anchor',
  'flag', 'star', 'gem', 'coins', 'key', 'lock', 'compass', 'scroll', 'book-open', 'library', 'beer', 'utensils', 'wheat', 'apple',
  'pickaxe', 'hammer', 'axe', 'shovel', 'paw-print', 'bird', 'fish', 'bug', 'rabbit', 'user', 'users', 'heart', 'handshake', 'zap',
  'sparkles', 'wand2', 'flask-conical', 'eye', 'info', 'triangle-alert', 'circle-dot', 'target', 'crosshair', 'footprints',
  'telescope', 'orbit', 'moon', 'sun', 'eclipse', 'snowflake', 'hourglass', 'bell', 'music', 'trophy', 'award', 'gavel', 'dices',
]

// ---------- normalisation ----------

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const round2 = (n: number) => Math.round(n * 100) / 100

const COLOUR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([\d\s.,%/+-]+\))$/i

/** Validated CSS colour (values end up in inline styles / HTML strings). Kanka stores hex without '#'. */
export function safeColour(c: unknown, fallback: string): string {
  let v = typeof c === 'string' ? c.trim() : ''
  if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) v = '#' + v
  return v && COLOUR_RE.test(v) ? v : fallback
}

/** #rrggbb for <input type="color">. */
export function toHex6(c: unknown, fallback: string): string {
  const v = safeColour(c, fallback)
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase()
  return fallback
}

/** 0..1; Kanka uses 0..100. */
export function normOpacity(v: unknown, fallback = 1): number {
  if (v === null || v === undefined || v === '') return fallback
  let n = num(v, fallback)
  if (n > 1) n /= 100
  return Math.min(1, Math.max(0, n))
}

const KANKA_SIZES = [24, 32, 40, 52, 64, 80]
/** Pin width in px. Small integers (1..6) are treated as Kanka size steps. */
export function normSize(v: unknown): number {
  const n = num(v, 0)
  if (n <= 0) return DEFAULT_SIZE
  if (n <= 6) return KANKA_SIZES[Math.round(n) - 1] ?? DEFAULT_SIZE
  return Math.min(128, Math.max(12, Math.round(n)))
}

export const isArea = (s: MarkerShape) => s === 'circle' || s === 'polygon'

function normPoints(v: unknown): LatLng[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((p) => p && typeof p === 'object')
    .map((p: any) => ({ lat: num(p.lat, NaN), lng: num(p.lng, NaN) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

export function normMarker(r: any): MapMarker {
  let shape: MarkerShape = ['marker', 'label', 'circle', 'polygon'].includes(r?.shape) ? r.shape : 'marker'
  const points = normPoints(r?.points)
  if (shape === 'polygon' && points.length < 3) shape = 'marker'
  let lat = num(r?.lat, NaN), lng = num(r?.lng, NaN)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const c = points.length ? centroid(points) : { lat: 0, lng: 0 }
    lat = c.lat; lng = c.lng
  }
  return {
    ...r,
    groupId: r?.groupId || null,
    entityId: r?.entityId || null,
    name: typeof r?.name === 'string' ? r.name : '',
    lat, lng, shape, points,
    icon: r?.icon == null ? '' : String(r.icon),
    colour: typeof r?.colour === 'string' ? r.colour : '',
    fontColour: typeof r?.fontColour === 'string' ? r.fontColour : '',
    opacity: normOpacity(r?.opacity, isArea(shape) ? AREA_OPACITY : 1),
    size: normSize(r?.size),
    radius: Math.max(1, num(r?.radius, 50)),
    html: typeof r?.html === 'string' ? r.html : '',
    isDraggable: r?.isDraggable !== false,
    visibility: r?.visibility ?? 'members',
    allowedUids: Array.isArray(r?.allowedUids) ? r.allowedUids : [],
  }
}

export function normLayer(r: any): MapLayer {
  return {
    ...r,
    name: typeof r?.name === 'string' ? r.name : '',
    imageId: r?.imageId || null,
    order: num(r?.order, 0),
    kind: r?.kind === 'base' ? 'base' : 'overlay',
    opacity: normOpacity(r?.opacity, 1),
    allowedUids: Array.isArray(r?.allowedUids) ? r.allowedUids : [],
  }
}

export function normGroup(r: any): MapGroup {
  return {
    ...r,
    name: typeof r?.name === 'string' ? r.name : '',
    order: num(r?.order, 0),
    isShown: r?.isShown !== false,
    allowedUids: Array.isArray(r?.allowedUids) ? r.allowedUids : [],
  }
}

/** Visibility for new rows of a map: as visible as the map itself (players cannot create public rows). */
export function inheritVisibility(e: Entity, isMaster: boolean): { visibility: Visibility; allowedUids: string[] } {
  if (isMaster || e.visibility !== 'public') return { visibility: e.visibility, allowedUids: [...(e.allowedUids ?? [])] }
  return { visibility: 'members', allowedUids: [] }
}

/** Copy of the editable fields (points deep-copied). */
export function toData(m: MapMarker): MarkerData {
  return {
    id: m.id, mapId: m.mapId, groupId: m.groupId, entityId: m.entityId, name: m.name, lat: m.lat, lng: m.lng, shape: m.shape,
    icon: m.icon, colour: m.colour, fontColour: m.fontColour, opacity: m.opacity, size: m.size, radius: m.radius,
    points: m.points.map((p) => ({ ...p })), html: m.html, isDraggable: m.isDraggable, visibility: m.visibility,
    allowedUids: [...(m.allowedUids ?? [])],
  }
}

// ---------- texts ----------

export function markerTitle(m: Pick<MapMarker, 'name' | 'shape'>, e?: Entity | null): string {
  return m.name?.trim() || e?.name || (m.shape === 'label' ? 'Подпись' : 'Без названия')
}

/** true if rich-text HTML has visible content. */
export function hasContent(html: string | null | undefined): boolean {
  return !!html && (htmlToText(html).length > 0 || /<(img|iframe)\b/i.test(html))
}

export const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/ё/g, 'е')

// ---------- geometry ----------

/** Area-weighted centroid of a polygon (falls back to the vertex average for degenerate shapes). */
export function centroid(pts: LatLng[]): LatLng {
  if (!pts.length) return { lat: 0, lng: 0 }
  let a = 0, x = 0, y = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].lng * pts[i].lat - pts[i].lng * pts[j].lat
    a += f
    x += (pts[j].lng + pts[i].lng) * f
    y += (pts[j].lat + pts[i].lat) * f
  }
  if (Math.abs(a) < 1e-9) {
    return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length }
  }
  // a = 2·area, centroid = Σ / (6·area) = Σ / (3a)
  return { lat: y / (3 * a), lng: x / (3 * a) }
}

/** Hexagon around a point (used when a point marker is switched to the polygon shape). */
export function defaultPolygon(c: LatLng, r: number): LatLng[] {
  return Array.from({ length: 6 }, (_, i) => {
    const t = (Math.PI / 3) * i
    return { lat: round2(c.lat + r * Math.sin(t)), lng: round2(c.lng + r * Math.cos(t)) }
  })
}

// ---------- icons ----------

/** How a marker's `icon` value is drawn: plain dot, linked entity picture or a lucide icon. */
export function resolveIcon(icon: string | null | undefined): { kind: 'dot' | 'entity' | 'icon'; name: string } {
  const v = (icon ?? '').trim()
  if (!v || v === '1') return { kind: 'dot', name: '' }
  if (v === ICON_ENTITY || v === '4') return { kind: 'entity', name: '' }
  if (v === '2') return { kind: 'icon', name: 'info' } // Kanka "question"
  if (v === '3') return { kind: 'icon', name: 'triangle-alert' } // Kanka "exclamation"
  if (ICONS[v]) return { kind: 'icon', name: v }
  return { kind: 'dot', name: '' } // unknown (e.g. Font Awesome classes from Kanka)
}

const svgCache = new Map<string, string>()
/** SVG markup of a lucide icon, rendered once through Vue and cached (Leaflet div icons need HTML strings). */
export function iconSvg(name: string): string {
  let s = svgCache.get(name)
  if (s === undefined) {
    const el = document.createElement('div')
    render(h(iconComponent(name), { size: 24, strokeWidth: 2.25 }), el)
    s = el.innerHTML
    render(null, el)
    svgCache.set(name, s)
  }
  return s
}

export interface IconSpec {
  html: string
  size: [number, number]
  anchor: [number, number]
  /** Vertical popup/tooltip offset from the anchor point (negative = above). */
  top: number
}

/** Outer box of a pin of the given width. Avatar pins are a circle plus a small tip. */
export function pinBox(size: number, avatar: boolean): { w: number; h: number } {
  return avatar ? { w: size, h: size + 8 } : { w: size, h: Math.round((size * 42) / 32) }
}

const PIN_PATH = 'M16 1.2C8.2 1.2 1.8 7.4 1.8 15.2c0 10.6 14.2 25.6 14.2 25.6s14.2-15 14.2-25.6C30.2 7.4 23.8 1.2 16 1.2z'

export function pinSpec(o: { colour: string; fontColour: string; size: number; icon: string; imageUrl?: string | null; crop?: ImageCrop | null }): IconSpec {
  const colour = safeColour(o.colour, DEFAULT_COLOUR)
  const fg = safeColour(o.fontColour, DEFAULT_FONT)
  const ic = resolveIcon(o.icon)
  const avatar = ic.kind === 'entity' && !!o.imageUrl
  const { w, h: ht } = pinBox(o.size, avatar)
  let html: string
  if (avatar) {
    const cs = cropCss(o.crop)
    html = `<div class="dw-pin dw-pin-avatar" style="width:${w}px;height:${ht}px;--pin:${colour}">` +
      `<span class="dw-pin-img"><img src="${escapeHtml(o.imageUrl!)}"${cs ? ` style="${cs}"` : ''} alt="" draggable="false"></span></div>`
  } else {
    const glyph = ic.kind === 'icon' ? iconSvg(ic.name) : '<i class="dw-pin-dot"></i>'
    html = `<div class="dw-pin" style="width:${w}px;height:${ht}px;--pin:${colour};--pin-fg:${fg}">` +
      `<svg class="dw-pin-shape" viewBox="0 0 32 42" aria-hidden="true"><path d="${PIN_PATH}"/></svg>` +
      `<span class="dw-pin-glyph">${glyph}</span></div>`
  }
  return { html, size: [w, ht], anchor: [Math.round(w / 2), ht], top: -ht }
}

export const labelFontSize = (size: number) => Math.max(9, Math.round(size * 0.45))

/** Text label centred on its point. `colour` is the background ('transparent' = text only). */
export function labelSpec(o: { text: string; colour: string; fontColour: string; size: number }): IconSpec {
  const bg = safeColour(o.colour, DEFAULT_COLOUR)
  const fg = safeColour(o.fontColour, DEFAULT_FONT)
  const fs = labelFontSize(o.size)
  const cls = bg === 'transparent' ? 'dw-label no-bg' : 'dw-label'
  const html = `<div class="${cls}" style="--lbl-bg:${bg};--lbl-fg:${fg};font-size:${fs}px">${escapeHtml(o.text)}</div>`
  // zero-sized icon box: the label itself is centred with a CSS transform
  return { html, size: [0, 0], anchor: [0, 0], top: -Math.round(fs * 0.8) }
}
