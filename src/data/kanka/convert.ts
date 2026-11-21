// Kanka campaign export (ZIP of JSON files) → Dezremon Wiki documents.
// PURE module: no Firebase, no DOM (its only runtime import, src/data/calendar.ts, is pure too) — the Firestore
// side lives in src/data/kanka.ts, so this file can be exercised from node in tests.
// Format reference: docs/kanka-export-format.md.
import type { Attribute, AttributeKind, CustomType, Entity, EntityLink, LatLng, Visibility } from '@/model/types'
import { calendarFromKanka, type CalendarConfig } from '@/data/calendar'

// =====================================================================================
// Constants
// =====================================================================================

/** Export folder → entity type key. */
export const MODULE_TYPES: Record<string, string> = {
  characters: 'character', locations: 'location', families: 'family', organisations: 'organisation', organizations: 'organisation',
  items: 'item', notes: 'note', events: 'event', calendars: 'calendar', races: 'race', creatures: 'creature', quests: 'quest',
  journals: 'journal', abilities: 'ability', maps: 'map', timelines: 'timeline', tags: 'tag',
}

/** entity.type_id → entity type key. */
export const TYPE_IDS: Record<number, string> = {
  1: 'character', 2: 'family', 3: 'location', 4: 'organisation', 5: 'item', 6: 'note', 7: 'event', 8: 'calendar', 9: 'race',
  10: 'quest', 11: 'journal', 12: 'tag', 16: 'ability', 17: 'map', 18: 'timeline', 20: 'creature',
}

/** Mention prefixes in texts ([character:12]) → type key. */
const MENTION_TYPES: Record<string, string> = {
  character: 'character', location: 'location', family: 'family', organisation: 'organisation', organization: 'organisation',
  item: 'item', note: 'note', event: 'event', calendar: 'calendar', race: 'race', creature: 'creature', quest: 'quest',
  journal: 'journal', ability: 'ability', map: 'map', timeline: 'timeline', tag: 'tag',
}

/** Old exports: parent stored on the module record as a child id of the same module. */
const PARENT_FIELDS: Record<string, string[]> = {
  location: ['parent_location_id', 'location_id'], organisation: ['organisation_id'], family: ['family_id'], item: ['item_id'],
  note: ['note_id'], event: ['event_id'], race: ['race_id'], creature: ['creature_id'], quest: ['quest_id'], journal: ['journal_id'],
  ability: ['ability_id'], map: ['map_id'], timeline: ['timeline_id'], tag: ['tag_id'],
}

const ATTRIBUTE_KINDS: Record<number, AttributeKind> = { 1: 'text', 2: 'multiline', 3: 'checkbox', 4: 'section', 5: 'text', 6: 'number', 7: 'text' }

/** Kanka's legacy named colours (tags, reminders, moons) → hex. */
const NAMED_COLOURS: Record<string, string> = {
  aqua: '#00c0ef', black: '#111111', brown: '#8b4513', grey: '#808080', gray: '#808080', green: '#00a65a', 'light-blue': '#3c8dbc',
  lightblue: '#3c8dbc', maroon: '#d81b60', navy: '#001f3f', orange: '#ff851b', pink: '#e83e8c', purple: '#605ca8', red: '#dd4b39',
  teal: '#39cccc', yellow: '#f39c12', blue: '#0073b7', white: '#ffffff', fuchsia: '#f012be', lime: '#01ff70', olive: '#3d9970',
}

const RANK: Record<Visibility, number> = { master: 0, custom: 1, members: 2, public: 3 }
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
const MAX_UPLOAD = 3_500_000
const CHUNK = 900_000

// =====================================================================================
// Small value helpers
// =====================================================================================

export function bool(v: any): boolean {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on'
}

export function num(v: any): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: any): string {
  return v === null || v === undefined || typeof v === 'object' ? '' : String(v)
}

/** Old exports keep some arrays/objects as JSON strings. */
export function jsonish(v: any): any {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!(s.startsWith('[') || s.startsWith('{'))) return v
  try { return JSON.parse(s) } catch { return v }
}

function arr(v: any): any[] {
  const j = jsonish(v)
  if (Array.isArray(j)) return j.filter((x) => x !== null && x !== undefined)
  if (j && typeof j === 'object') return Object.values(j).filter((x) => x !== null && x !== undefined)
  return []
}

/** First array found under any of `keys` in any of `objs`. */
function listOf(objs: any[], keys: string[]): any[] {
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue
    for (const k of keys) if (o[k] !== undefined && o[k] !== null) {
      const a = arr(o[k])
      if (a.length) return a
    }
  }
  return []
}

function uniq<T>(xs: Array<T | null | undefined>): T[] {
  return [...new Set(xs.filter((x): x is T => x !== null && x !== undefined && x !== ''))]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

function parseYear(v: any): number | null {
  const m = /^\s*(-?\d+)/.exec(str(v))
  return m ? Number(m[1]) : null
}

function parseTime(v: any): number | null {
  const t = Date.parse(str(v))
  return Number.isFinite(t) ? t : null
}

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}_${s.length}`
}

// =====================================================================================
// Visibility / colours
// =====================================================================================

/** Kanka visibility_id: 1 all, 2 admin, 3 admin+self, 4 self, 5 members. */
export function mapVisibilityId(id: any, publicByDefault = false): Visibility {
  switch (num(id)) {
    case 2: case 3: case 4: return 'master'
    case 5: return 'members'
    default: return publicByDefault ? 'public' : 'members'
  }
}

export function entityVisibility(isPrivate: any, publicByDefault = false): Visibility {
  return bool(isPrivate) ? 'master' : publicByDefault ? 'public' : 'members'
}

export function narrowest(...vs: Visibility[]): Visibility {
  return vs.reduce((a, b) => (RANK[b] < RANK[a] ? b : a))
}

export function widest(a: Visibility, b: Visibility): Visibility {
  return RANK[b] > RANK[a] ? b : a
}

export function mapColour(v: any): string {
  const s = str(v).trim()
  if (!s) return ''
  const named = NAMED_COLOURS[s.toLowerCase()]
  if (named) return named
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
  return m ? `#${m[1].toLowerCase()}` : ''
}

// =====================================================================================
// HTML / text
// =====================================================================================

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export function stripTags(html: string): string {
  return decodeEntities(str(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

export interface ParsedMention {
  type: string
  id: number
  /** Custom display text (HTML text as found in the source), '' if none. */
  text: string
  options: Record<string, string>
}

/** `character:812|Свой текст|page:inventory` (without brackets). */
export function parseMention(token: string): ParsedMention | null {
  const m = /^([a-z_-]+):(.*)$/is.exec(token.trim())
  if (!m) return null
  const parts = m[2].split('|')
  const idPart = parts[0].trim()
  if (!/^\d+$/.test(idPart)) return null
  const out: ParsedMention = { type: m[1].toLowerCase(), id: Number(idPart), text: '', options: {} }
  for (const p of parts.slice(1)) {
    const o = /^(page|anchor|field|alias|tab|params|text):(.*)$/is.exec(p)
    if (o) {
      if (o[1].toLowerCase() === 'text') out.text = o[2]
      else out.options[o[1].toLowerCase()] = o[2]
    } else if (!out.text && p.trim()) out.text = p
  }
  return out
}

export interface MentionTarget { id: string; name: string }

export interface TextStats { mentions: number; unresolved: number; images: number; externalImages: number }

export interface TextContext {
  /** Kanka mention → imported entity (by entity id, falling back to the child id of the mention's module). */
  resolve(type: string, id: number): MentionTarget | null
  /** Gallery uuid → new image id (registers the upload). */
  galleryImage?(uuid: string): string | null
  /** Any other <img src> (data: URI, Kanka-hosted gallery URL, legacy path) → new image id. */
  srcImage?(src: string): string | null
  stats: TextStats
}

export function newStats(): TextStats {
  return { mentions: 0, unresolved: 0, images: 0, externalImages: 0 }
}

function mentionHtml(target: MentionTarget, textHtml: string): string {
  const t = textHtml.trim()
  if (!t) return `<a class="mention" data-entity-id="${escapeHtml(target.id)}">${escapeHtml(target.name)}</a>`
  return `<a class="mention" data-entity-id="${escapeHtml(target.id)}" data-label="${escapeHtml(decodeEntities(t))}">${t}</a>`
}

/** `[type:ID]` / `[type:ID|Text]` (and Kanka's `<a data-mention="[…]">`) → wiki mentions. Unknown ids → plain text. */
export function convertMentions(html: string, ctx: TextContext): string {
  if (!html) return ''
  // 1) rendered mention anchors carrying the raw token
  let out = html.replace(/<a\b([^>]*?)\bdata-mention="\[([^\]"]+)\]"([^>]*)>([\s\S]*?)<\/a>/gi, (whole, _a, token: string, _b, inner: string) => {
    const p = parseMention(decodeEntities(token))
    if (!p) return whole
    const target = ctx.resolve(p.type, p.id)
    const text = inner.replace(/<[^>]*>/g, '').trim()
    if (!target) { ctx.stats.unresolved++; return text || escapeHtml(`[${token}]`) }
    ctx.stats.mentions++
    return mentionHtml(target, p.text || (decodeEntities(text) === target.name ? '' : text))
  })
  // 2) tokens whose custom label contains inline tags ("[character:1|Деву<ins></ins>]"): drop the tags first,
  //    otherwise the split below cuts the token into pieces
  out = out.replace(/\[([a-z_-]+):(\d+)(\|(?:[^\[\]<]|<[^>]*>)*?)\]/gi, (whole, type: string, id: string, rest: string) =>
    rest.includes('<') ? `[${type}:${id}${rest.replace(/<[^>]*>/g, '')}]` : whole)
  // 3) raw tokens, only in text nodes (never inside tags/attributes)
  const parts = out.split(/(<[^>]*>)/)
  for (let i = 0; i < parts.length; i += 2) {
    if (!parts[i] || !parts[i].includes('[')) continue
    parts[i] = parts[i].replace(/\[([a-z_-]+):([^\[\]]*?)\]/gi, (whole, type: string, rest: string) => {
      const p = parseMention(`${type}:${rest}`)
      if (!p) return whole
      const target = ctx.resolve(p.type, p.id)
      if (!target) { ctx.stats.unresolved++; return p.text || whole }
      ctx.stats.mentions++
      return mentionHtml(target, p.text)
    })
  }
  out = parts.join('')
  return out
}

/** Mentions in plain text (attribute values, tooltips) → just the label. */
export function mentionsToPlain(text: string, ctx: TextContext): string {
  return str(text).replace(/\[([a-z_-]+):([^\[\]]*?)\]/gi, (whole, type: string, rest: string) => {
    const p = parseMention(`${type}:${rest}`)
    if (!p) return whole
    const target = ctx.resolve(p.type, p.id)
    return p.text ? decodeEntities(p.text) : target ? target.name : whole
  })
}

/** <img data-gallery-id> / data: URIs / known gallery URLs → `<span class="wiki-img"><img data-image-id></span>`. */
export function convertImages(html: string, ctx: TextContext): string {
  if (!html || !/<img\b/i.test(html)) return html
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const at = parseAttrs(tag)
    let id: string | null = null
    if (at['data-gallery-id'] && ctx.galleryImage) id = ctx.galleryImage(at['data-gallery-id'])
    if (!id && at.src && ctx.srcImage) id = ctx.srcImage(at.src)
    if (!id) {
      if (at.src && !at.src.startsWith('data:')) ctx.stats.externalImages++
      return at.src?.startsWith('data:') ? '' : tag
    }
    ctx.stats.images++
    const style = at.style ?? ''
    const w = /(?:^|;)\s*width\s*:\s*([\d.]+(?:%|px))/i.exec(style)?.[1] ?? (/^\d+$/.test(at.width ?? '') ? `${at.width}px` : '')
    const float = /float\s*:\s*(left|right)/i.exec(style)?.[1]?.toLowerCase()
    const align = float ?? (/\b(note-float-left|float-left|pull-left)\b/.test(at.class ?? '') ? 'left' : /\b(note-float-right|float-right|pull-right)\b/.test(at.class ?? '') ? 'right' : 'center')
    return `<span class="wiki-img" data-align="${align}"${w ? ` style="width:${w}"` : ''}><img data-image-id="${escapeHtml(id)}" alt="${escapeHtml(at.alt ?? '')}"></span>`
  })
}

export function convertText(html: string, ctx: TextContext): string {
  return convertImages(convertMentions(cleanKankaStyles(str(html)), ctx), ctx)
}

function parseColor(v: string): [number, number, number] | null {
  const s = v.trim().toLowerCase()
  let m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (!m) return s === 'white' ? [255, 255, 255] : null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/**
 * Kanka campaigns written in a dark theme carry the theme's text colour (light grey) as inline styles.
 * On a light page such text is invisible, so: light greys are dropped (they are "default text"), light but
 * saturated colours are darkened keeping their hue (an accent stays an accent and reads on any theme).
 * Returns null to drop the colour.
 */
export function adaptTextColor(v: string): string | null {
  const c = parseColor(v)
  if (!c) return v
  const [r, g, b] = c
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum < 0.62) return v
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const sat = max ? (max - min) / max : 0
  if (sat < 0.22) return null
  const k = 0.5 / lum
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`
}

/** Removes editor/theme artefacts from Kanka HTML (see adaptTextColor); keeps real formatting. */
export function cleanKankaStyles(html: string): string {
  if (!html) return html
  let out = html.replace(/\sstyle="([^"]*)"/gi, (_w, style: string) => {
    const decls = style.split(';').map((d) => d.trim()).filter(Boolean).flatMap((d) => {
      const i = d.indexOf(':')
      if (i < 0) return []
      const prop = d.slice(0, i).trim().toLowerCase()
      const val = d.slice(i + 1).trim()
      if ((prop === 'background-color' || prop === 'background') && /^(unset|initial|inherit|transparent)$/i.test(val)) return []
      if (prop === 'border-color') return []
      if (prop === 'color') { const nv = adaptTextColor(val); return nv ? [`color: ${nv}`] : [] }
      return [`${prop}: ${val}`]
    })
    return decls.length ? ` style="${decls.join('; ')}"` : ''
  })
  // <font color> (legacy markup from Kanka's editor) → span with an adapted colour, or nothing
  const stack: boolean[] = []
  out = out.replace(/<font\b([^>]*)>|<\/font\s*>/gi, (tag: string, attrs?: string) => {
    if (tag.startsWith('</')) return stack.pop() ? '</span>' : ''
    const color = /\bcolor\s*=\s*"([^"]*)"/i.exec(attrs ?? '')?.[1]
    const nv = color ? adaptTextColor(color) : null
    stack.push(!!nv)
    return nv ? `<span style="color: ${nv}">` : ''
  })
  return out.replace(/<ins>/gi, '<u>').replace(/<\/ins>/gi, '</u>')
}

/** Removes images whose upload failed. */
export function stripImages(html: string, ids: Set<string>): string {
  if (!html || !ids.size) return html
  return html
    .replace(/<span class="wiki-img"[^>]*>\s*<img data-image-id="([^"]+)"[^>]*>\s*<\/span>/g, (whole, id: string) => (ids.has(id) ? '' : whole))
    .replace(/<img data-image-id="([^"]+)"[^>]*>/g, (whole, id: string) => (ids.has(id) ? '' : whole))
}

// =====================================================================================
// Type specific converters
// =====================================================================================

/**
 * Kanka calendar record → fields.calendar. The mapping itself lives in src/data/calendar.ts (`calendarFromKanka`,
 * which also parses old JSON-string fields); here only Kanka's named moon colours are turned into hex first.
 */
export function mapCalendar(rec: any): CalendarConfig {
  if (!rec || typeof rec !== 'object') return calendarFromKanka(rec)
  const moons = arr(rec.moons).map((m: any) => (m && typeof m === 'object' ? { ...m, colour: mapColour(m.colour) || str(m.colour) } : m))
  return calendarFromKanka({ ...rec, moons })
}

export type MarkerShape = 'marker' | 'label' | 'circle' | 'polygon'

/** shape_id: 1 marker, 2 label, 3 circle, 5 polygon, 6 path (stored as polygon). */
export function mapMarkerShape(id: any): MarkerShape {
  switch (num(id)) {
    case 2: return 'label'
    case 3: return 'circle'
    case 5: case 6: return 'polygon'
    default: return 'marker'
  }
}

/** "lat,lng lat,lng …" → points. */
export function parseCustomShape(s: any): LatLng[] {
  return str(s).trim().split(/\s+/).map((p) => p.split(','))
    .filter((p) => p.length >= 2)
    .map(([a, b]) => ({ lat: Number(a), lng: Number(b) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

/** reminders.type_id: null event, 2 birth, 3 death, 4 quest/journal date, 5 founding. */
export function mapReminderKind(typeId: any): 'event' | 'birth' | 'death' | 'other' {
  switch (num(typeId)) {
    case null: case 1: return 'event'
    case 2: return 'birth'
    case 3: return 'death'
    default: return 'other'
  }
}

export function mapMemberStatus(statusId: any): 'active' | 'inactive' | 'unknown' {
  const n = num(statusId)
  return n === 1 ? 'inactive' : n === 2 ? 'unknown' : 'active'
}

// =====================================================================================
// Reading the ZIP
// =====================================================================================

/** Minimal JSZip surface used here (JSZip instances satisfy it). */
export interface ZipLike {
  files: Record<string, { dir: boolean; async(type: 'string'): Promise<string> }>
}

export interface KankaRecord {
  path: string
  dir: string
  type: string
  customId: number | null
  data: any
}

export interface KankaInput {
  /** Folder inside the ZIP holding the export (usually ''). Paths below are relative to it. */
  root: string
  records: KankaRecord[]
  paths: string[]
  galleryMeta: Map<string, any>
  galleryFiles: Map<string, string>
  customModules: any[]
  campaign: any
  /** Uncompressed sizes of binary files (when the ZIP library exposes them). */
  sizes: Map<string, number>
  warnings: string[]
  skippedDirs: Record<string, number>
}

function customModuleList(json: any): any[] {
  const out: any[] = []
  const visit = (v: any, depth: number) => {
    if (!v || depth > 3) return
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return }
    if (typeof v !== 'object') return
    if (num(v.id) !== null && (v.singular || v.plural || v.name || v.code)) { out.push(v); return }
    Object.values(v).forEach((x) => visit(x, depth + 1))
  }
  visit(jsonish(json), 0)
  return out
}

export async function loadKankaInput(zip: ZipLike): Promise<KankaInput> {
  const all = Object.keys(zip.files).filter((p) => !zip.files[p].dir && !p.startsWith('__MACOSX/'))
  const markers = all.filter((p) => /(^|\/)(campaign|info)\.json$/.test(p)).sort((a, b) => a.split('/').length - b.split('/').length)
  let root = ''
  if (markers.length) root = markers[0].slice(0, markers[0].lastIndexOf('/') + 1)
  else {
    const firsts = new Set(all.map((p) => p.split('/')[0]))
    if (firsts.size === 1 && all.every((p) => p.includes('/'))) {
      const only = [...firsts][0]
      if (!MODULE_TYPES[only]) root = `${only}/`
    }
  }
  const input: KankaInput = {
    root, records: [], paths: [], galleryMeta: new Map(), galleryFiles: new Map(), customModules: [], campaign: null,
    sizes: new Map(), warnings: [], skippedDirs: {},
  }
  for (const full of all) {
    if (!full.startsWith(root)) continue
    const rel = full.slice(root.length)
    input.paths.push(rel)
    const size = (zip.files[full] as any)?._data?.uncompressedSize
    if (typeof size === 'number') input.sizes.set(rel, size)
    const gm = /^gallery\/([^/]+)\.([A-Za-z0-9]+)$/.exec(rel)
    if (gm && gm[2].toLowerCase() !== 'json') { input.galleryFiles.set(gm[1], rel); continue }
    if (!rel.toLowerCase().endsWith('.json')) continue
    const parse = async () => {
      try { return JSON.parse(await zip.files[full].async('string')) } catch { input.warnings.push(`Не удалось прочитать ${rel}`); return null }
    }
    if (rel === 'campaign.json') { input.campaign = await parse(); continue }
    if (rel === 'info.json') { input.campaign ??= await parse(); continue }
    const m = /^([^/]+)\/([^/]+)\.json$/i.exec(rel)
    if (!m) continue
    const dir = m[1]
    if (dir === 'gallery') { const j = await parse(); if (j) input.galleryMeta.set(str(j.id) || m[2], j); continue }
    if (dir === 'settings') {
      if (/custom[-_]?modules/i.test(m[2])) input.customModules = customModuleList(await parse())
      continue
    }
    const builtin = MODULE_TYPES[dir]
    const cm = /^[A-Za-z][A-Za-z0-9]*_(\d+)$/.exec(dir)
    if (!builtin && !cm) { input.skippedDirs[dir] = (input.skippedDirs[dir] ?? 0) + 1; continue }
    const data = await parse()
    if (!data || typeof data !== 'object') continue
    input.records.push({ path: rel, dir, type: builtin ?? `c_${cm![1]}`, customId: cm ? Number(cm[1]) : null, data })
  }
  // Gallery metadata may be keyed by its own uuid while the binary is named differently: keep both lookups.
  for (const [uuid, meta] of input.galleryMeta) {
    if (!input.galleryFiles.has(uuid) && meta?.ext) {
      const p = `gallery/${uuid}.${meta.ext}`
      if (input.paths.includes(p)) input.galleryFiles.set(uuid, p)
    }
  }
  return input
}

// =====================================================================================
// Planning the import
// =====================================================================================

export interface PlanOptions {
  uid: string
  now: number
  /** Non-private Kanka content → 'public' instead of 'members'. */
  publicByDefault?: boolean
  /** Also upload gallery images nothing refers to. */
  importUnusedGallery?: boolean
  /** Reuse existing tag entities with the same name instead of creating duplicates. */
  existingTags?: Array<{ id: string; name: string }>
  idGen?: () => string
}

export type ImageSource = { kind: 'zip'; path: string } | { kind: 'data'; data: string }

export interface PlannedImage {
  id: string
  source: ImageSource
  name: string
  folder: string
  visibility: Visibility
  /** Original size in bytes if known (0 = unknown). */
  size: number
  /** Map entity whose fields.mapWidth/mapHeight must come from this image. */
  mapFor: string | null
  /** Kanka focal point of the gallery image, in pixels of the original file. */
  focus?: { x: number; y: number } | null
  /** Entity framings to derive from `focus` once the original size is known. */
  cropFor?: Array<{ entityId: string; field: 'imageCrop' | 'headerCrop' }>
}

export interface PlanReport {
  campaign: string
  byType: Record<string, number>
  rows: Record<string, number>
  mentions: { converted: number; unresolved: number }
  images: { inline: number; external: number; planned: number }
  warnings: string[]
  skipped: string[]
}

export type RowCollection = 'posts' | 'relations' | 'orgMembers' | 'inventory' | 'entityAbilities' | 'questElements' | 'reminders'
  | 'timelineEras' | 'timelineElements' | 'mapLayers' | 'mapGroups' | 'mapMarkers'

export const ROW_COLLECTIONS: RowCollection[] = ['posts', 'relations', 'orgMembers', 'inventory', 'entityAbilities', 'questElements',
  'reminders', 'timelineEras', 'timelineElements', 'mapLayers', 'mapGroups', 'mapMarkers']

export interface KankaPlan {
  /** Entity docs without excerpt/mentions/bodyRev (the writer fills them from the HTML). */
  entities: Entity[]
  /** entityId → article HTML (readable — Kanka texts have no secret blocks). */
  bodies: Record<string, string>
  /** entityId → private attributes (go to the master-only secrets doc). */
  privateAttrs: Record<string, Attribute[]>
  /** entityId → master notes (private links/aliases). */
  gmNotes: Record<string, string>
  rows: Record<RowCollection, Array<Record<string, any>>>
  images: PlannedImage[]
  customTypes: CustomType[]
  calendarIds: string[]
  report: PlanReport
}

interface EntInfo {
  kid: number
  type: string
  rec: any
  ent: any
  newId: string
  name: string
  vis: Visibility
  merged: boolean
}

function defaultIdGen(): () => string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return () => {
    const bytes = new Uint8Array(20)
    globalThis.crypto.getRandomValues(bytes)
    let s = ''
    for (const b of bytes) s += A[b % A.length]
    return s
  }
}

function humanizeDir(dir: string): string {
  const base = dir.replace(/_\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim()
  return base ? base[0].toUpperCase() + base.slice(1).toLowerCase() : dir
}

export function planKankaImport(input: KankaInput, opts: PlanOptions): KankaPlan {
  const gen = opts.idGen ?? defaultIdGen()
  const pub = !!opts.publicByDefault
  const t = opts.now
  const uid = opts.uid
  const stats = newStats()
  const report: PlanReport = {
    campaign: str(input.campaign?.name ?? input.campaign?.campaign?.name),
    byType: {}, rows: {}, mentions: { converted: 0, unresolved: 0 }, images: { inline: 0, external: 0, planned: 0 },
    warnings: [...input.warnings], skipped: [],
  }
  const warnCounts = new Map<string, number>()
  const warn = (msg: string) => {
    const n = (warnCounts.get(msg) ?? 0) + 1
    warnCounts.set(msg, n)
    if (n === 1 && report.warnings.length < 400) report.warnings.push(msg)
  }
  const skip = (msg: string) => { if (report.skipped.length < 400) report.skipped.push(msg) }
  for (const [dir, n] of Object.entries(input.skippedDirs)) skip(`Папка «${dir}» (${n} файлов) не поддерживается`)

  const rows: KankaPlan['rows'] = Object.fromEntries(ROW_COLLECTIONS.map((c) => [c, []])) as unknown as KankaPlan['rows']
  const stamp = (visibility: Visibility, createdAt?: number | null) => ({
    visibility, allowedUids: [] as string[], createdBy: uid, createdAt: createdAt ?? t, updatedAt: t, updatedBy: uid,
  })
  const rowVis = (r: any, ...parents: Visibility[]): Visibility =>
    narrowest(bool(r?.is_private) ? 'master' : mapVisibilityId(r?.visibility_id, pub), ...parents)

  // ---------- pass 1: (module, childId) → entity, new ids ----------
  const byKid = new Map<number, EntInfo>()
  const byChild = new Map<string, EntInfo>()
  const existingTags = new Map((opts.existingTags ?? []).map((x) => [norm(x.name), x.id]))
  for (const r of input.records) {
    const rec = r.data ?? {}
    const ent = rec.entity && typeof rec.entity === 'object' ? rec.entity : null
    const kid = num(ent?.id)
    if (kid === null) { skip(`${r.path}: нет entity.id`); continue }
    if (byKid.has(kid)) { warn(`Сущность ${kid} встречается в архиве дважды — взята первая`); continue }
    let type = r.type
    if (!type) type = TYPE_IDS[num(ent?.type_id) ?? -1]
    if (!type) { skip(`${r.path}: неизвестный тип`); continue }
    const name = str(ent?.name ?? rec.name).trim() || 'Без названия'
    const vis = entityVisibility(ent?.is_private ?? rec.is_private, pub)
    let newId = gen()
    let merged = false
    if (type === 'tag' && existingTags.has(norm(name))) { newId = existingTags.get(norm(name))!; merged = true }
    const info: EntInfo = { kid, type, rec, ent, newId, name, vis, merged }
    byKid.set(kid, info)
    const childId = num(r.customId === null ? rec.id ?? ent?.entity_id : ent?.entity_id ?? rec.id)
    if (childId !== null) byChild.set(`${type}:${childId}`, info)
  }
  const entRef = (id: any): EntInfo | null => { const n = num(id); return n === null ? null : byKid.get(n) ?? null }
  const childRef = (type: string, id: any): EntInfo | null => {
    const n = num(typeof id === 'object' && id ? id.id : id)
    return n === null ? null : byChild.get(`${type}:${n}`) ?? null
  }

  // ---------- images ----------
  const images = new Map<string, PlannedImage>()
  const pathSet = new Set(input.paths)
  const byBase = new Map<string, string>()
  for (const p of input.paths) if (IMAGE_EXT.test(p) && !byBase.has(basename(p))) byBase.set(basename(p), p)
  const folderNames = new Map<string, string>()
  for (const [uuid, meta] of input.galleryMeta) if (bool(meta?.is_folder)) folderNames.set(str(meta.id) || uuid, str(meta.name))

  const addImage = (key: string, source: ImageSource, name: string, folder: string, vis: Visibility, size: number): string => {
    const ex = images.get(key)
    if (ex) { ex.visibility = widest(ex.visibility, vis); return ex.id }
    const img: PlannedImage = { id: gen(), source, name, folder, visibility: vis, size, mapFor: null }
    images.set(key, img)
    return img.id
  }
  const galleryImage = (uuid: string, vis: Visibility): string | null => {
    const path = input.galleryFiles.get(uuid)
    if (!path) return null
    const meta = input.galleryMeta.get(uuid) ?? {}
    const folder = folderNames.get(str(meta.folder_id)) || 'Kanka'
    const name = str(meta.name) || basename(path)
    const id = addImage(`zip:${path}`, { kind: 'zip', path }, name, folder, vis, input.sizes.get(path) ?? 0)
    const fx = num(meta.focus_x), fy = num(meta.focus_y)
    const img = images.get(`zip:${path}`)
    if (img && fx !== null && fy !== null) img.focus = { x: fx, y: fy }
    return id
  }
  const pathImage = (p: any, vis: Visibility, allowRemote = false): string | null => {
    let s = str(p).trim()
    if (!s) return null
    if (/^https?:\/\//i.test(s)) {
      if (!allowRemote) return null
      s = s.replace(/^https?:\/\/[^/]+\//i, '').split('?')[0]
    }
    s = s.replace(/^\/+/, '')
    const uuid = UUID_RE.exec(s)?.[1]
    if (uuid && input.galleryFiles.has(uuid)) return galleryImage(uuid, vis)
    let hit = pathSet.has(s) ? s : null
    if (!hit) {
      const base = basename(s)
      // basename matches are only trusted for hash-like names (Kanka stores uploads under random names)
      if (base.length >= 12) hit = byBase.get(base) ?? null
    }
    if (!hit || !IMAGE_EXT.test(hit)) return null
    return addImage(`zip:${hit}`, { kind: 'zip', path: hit }, basename(hit), 'Kanka', vis, input.sizes.get(hit) ?? 0)
  }
  const srcImage = (src: string, vis: Visibility): string | null => {
    if (/^data:image\//i.test(src)) return addImage(`data:${hashString(src)}`, { kind: 'data', data: src }, 'image', 'Kanka', vis, Math.round(src.length * 0.75))
    return pathImage(src, vis, true)
  }
  const ctxFor = (vis: Visibility): TextContext => ({
    resolve: (type, id) => {
      const i = byKid.get(id) ?? (MENTION_TYPES[type] ? byChild.get(`${MENTION_TYPES[type]}:${id}`) : undefined)
      return i ? { id: i.newId, name: i.name } : null
    },
    galleryImage: (uuid) => galleryImage(uuid, vis),
    srcImage: (src) => srcImage(src, vis),
    stats,
  })

  // ---------- pass 2: documents ----------
  const entities: Entity[] = []
  const bodies: Record<string, string> = {}
  const privateAttrs: Record<string, Attribute[]> = {}
  const gmNotes: Record<string, string> = {}
  const calendarIds: string[] = []
  const familyExtra = new Map<string, Set<string>>()
  const memberKeys = new Set<string>()
  const relByKankaId = new Map<number, Record<string, any>>()
  const relDone = new Set<number>()
  const usedCustom = new Map<number, string>()
  const mapNeedsSize: Array<{ entityId: string; imageId: string }> = []

  const addMember = (org: EntInfo, ch: EntInfo, m: any, order: number) => {
    const role = str(m?.role ?? m?.pivot?.role)
    const key = `${org.newId}|${ch.newId}|${norm(role)}`
    if (memberKeys.has(key)) return
    memberKeys.add(key)
    rows.orgMembers.push({
      id: gen(), organisationId: org.newId, characterId: ch.newId, role, status: mapMemberStatus(m?.status_id ?? m?.pivot?.status_id),
      isPinned: (num(m?.pin_id ?? m?.pivot?.pin_id) ?? 0) > 0, order, ...stamp(rowVis(m, org.vis, ch.vis)),
    })
  }

  for (const info of byKid.values()) {
    const { rec, ent, type } = info
    const vis = info.vis
    const ctx = ctxFor(vis)
    if (info.merged) { warn(`Тег «${info.name}» уже есть в мире — использован существующий`); continue }
    if (type.startsWith('c_')) {
      const cid = Number(type.slice(2))
      if (!usedCustom.has(cid)) {
        const r = input.records.find((x) => x.customId === cid)
        usedCustom.set(cid, r?.dir ?? type)
      }
    }

    // parent
    let parent = entRef(ent?.parent_id)
    if (!parent) for (const k of PARENT_FIELDS[type] ?? []) { parent = childRef(type, rec?.[k]); if (parent) break }
    if (parent && parent.newId === info.newId) parent = null

    // locations (entityLocations pivots, or the legacy single location_id)
    const locPivots = listOf([ent, rec], ['entityLocations', 'entity_locations', 'pivotLocations', 'pivot_locations'])
    let locIds = uniq(locPivots.map((l) => childRef('location', typeof l === 'object' ? l.location_id ?? l.id : l)?.newId))
    if (!locIds.length && type !== 'location') { const l = childRef('location', rec?.location_id); if (l) locIds = [l.newId] }

    // text
    let html = convertText(str(ent?.entry ?? rec?.entry), ctx)

    // images
    const imgUuid = str(ent?.image_uuid)
    let imageId = imgUuid ? galleryImage(imgUuid, vis) : null
    const imgPath = ent?.image_path ?? rec?.image
    if (!imageId && imgPath) imageId = pathImage(imgPath, vis)
    if (!imageId && (imgUuid || imgPath)) warn(`Картинка статьи «${info.name}» не найдена в архиве`)
    const headUuid = str(ent?.header_uuid)
    let headerImageId = headUuid ? galleryImage(headUuid, vis) : null
    if (!headerImageId && ent?.header_image) headerImageId = pathImage(ent.header_image, vis)

    // fields
    const fields: Record<string, any> = {}
    const set = (k: string, v: any) => {
      if (v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length)) return
      fields[k] = v
    }
    const status = num(ent?.status_id)
    switch (type) {
      case 'character': {
        set('title', str(rec.title))
        set('age', str(rec.age))
        set('sex', str(rec.sex))
        set('pronouns', str(rec.pronouns))
        set('isDead', status === 3 || bool(rec.is_dead))
        set('locationId', locIds[0] ?? null)
        const races = listOf([rec, ent], ['characterRaces', 'character_races', 'races'])
        set('raceIds', uniq([...races.map((x) => childRef('race', typeof x === 'object' ? x.race_id ?? x.id : x)?.newId), childRef('race', rec.race_id)?.newId]))
        const fams = listOf([rec, ent], ['characterFamilies', 'character_families', 'families'])
        set('familyIds', uniq([...fams.map((x) => childRef('family', typeof x === 'object' ? x.family_id ?? x.id : x)?.newId), childRef('family', rec.family_id)?.newId]))
        const traits = listOf([rec, ent], ['characterTraits', 'character_traits', 'traits'])
          .slice().sort((a, b) => (num(a?.default_order) ?? 0) - (num(b?.default_order) ?? 0))
        const pair = (x: any) => ({ name: str(x?.name), value: stripTags(mentionsToPlain(str(x?.entry ?? x?.value), ctx)) })
        const isAppearance = (x: any) => num(x?.section_id) === 1 || str(x?.section).toLowerCase() === 'appearance'
        set('appearance', traits.filter(isAppearance).map(pair).filter((p) => p.name || p.value))
        set('personality', traits.filter((x) => !isAppearance(x)).map(pair).filter((p) => p.name || p.value))
        for (const m of listOf([rec], ['organisationMemberships', 'organisation_memberships', 'pivotMembers', 'organisations'])) {
          const org = childRef('organisation', m?.organisation_id ?? m?.pivot?.organisation_id ?? m?.id)
          if (org) addMember(org, info, m, rows.orgMembers.length)
        }
        break
      }
      case 'location':
        set('title', str(rec.title))
        break
      case 'family':
        set('locationId', locIds[0] ?? null)
        for (const m of listOf([rec], ['members', 'pivotMembers', 'characterFamilies'])) {
          const ch = childRef('character', m?.character_id ?? m?.id)
          if (!ch) continue
          if (!familyExtra.has(ch.newId)) familyExtra.set(ch.newId, new Set())
          familyExtra.get(ch.newId)!.add(info.newId)
        }
        break
      case 'organisation': {
        set('locationIds', locIds)
        set('isDefunct', status === 13 || bool(rec.is_defunct))
        const members = listOf([rec], ['members', 'pivotMembers', 'organisationMembers', 'organisation_members'])
        members.forEach((m, i) => {
          const ch = childRef('character', m?.character_id)
          const org = childRef('organisation', m?.organisation_id) ?? info
          if (!ch) { skip(`Участник организации «${info.name}»: персонаж ${str(m?.character_id)} не найден`); return }
          addMember(org, ch, m, i)
        })
        break
      }
      case 'item': {
        set('price', str(rec.price))
        set('size', str(rec.size))
        set('weight', str(rec.weight))
        set('ownerId', childRef('character', rec.character_id)?.newId ?? null)
        set('locationId', locIds[0] ?? null)
        for (const c of listOf([rec], ['itemCreators', 'item_creators', 'creators'])) {
          const creator = entRef(c?.creator_id ?? c?.entity_id)
          if (!creator) continue
          rows.relations.push({
            id: gen(), sourceId: creator.newId, targetId: info.newId, label: 'создатель', reverseLabel: 'творение', kind: 'generic',
            attitude: 0, colour: '', isPinned: false, deleted: false, ...stamp(narrowest(vis, creator.vis)),
          })
        }
        break
      }
      case 'event':
        set('date', str(rec.date))
        set('locationId', locIds[0] ?? null)
        break
      case 'calendar':
        fields.calendar = mapCalendar(rec)
        calendarIds.push(info.newId)
        if (arr(rec.calendarWeather ?? rec.calendar_weather).length) warn('Погода календарей Kanka не импортируется')
        break
      case 'race':
        set('locationIds', locIds)
        set('isExtinct', status === 7 || bool(rec.is_extinct))
        break
      case 'creature':
        set('locationIds', locIds)
        set('isExtinct', status === 5 || bool(rec.is_extinct))
        set('isDead', status === 4 || bool(rec.is_dead))
        break
      case 'quest': {
        set('giverId', entRef(rec.instigator_id)?.newId ?? childRef('character', rec.character_id)?.newId ?? null)
        set('locationId', childRef('location', rec.location_id)?.newId ?? locIds[0] ?? null)
        set('date', str(rec.date))
        set('isCompleted', status === 10 || bool(rec.is_completed))
        let order = 0
        for (const el of listOf([rec], ['elements', 'questElements', 'quest_elements'])) {
          const ev = rowVis(el, vis)
          rows.questElements.push({
            id: gen(), questId: info.newId, entityId: entRef(el?.entity_id)?.newId ?? null, name: str(el?.name), role: str(el?.role),
            html: convertText(str(el?.entry ?? el?.description), ctxFor(ev)), colour: mapColour(el?.colour), order: order++, ...stamp(ev),
          })
        }
        const legacy: Array<[string[], string, string]> = [
          [['questCharacters', 'quest_characters', 'characters'], 'character', 'character_id'],
          [['questLocations', 'quest_locations', 'locations'], 'location', 'location_id'],
          [['questItems', 'quest_items', 'items'], 'item', 'item_id'],
          [['questOrganisations', 'quest_organisations', 'organisations'], 'organisation', 'organisation_id'],
        ]
        for (const [keys, t2, idKey] of legacy) {
          for (const el of listOf([rec], keys)) {
            const target = childRef(t2, el?.[idKey])
            if (!target) continue
            const ev = rowVis(el, vis)
            rows.questElements.push({
              id: gen(), questId: info.newId, entityId: target.newId, name: '', role: str(el?.role),
              html: convertText(str(el?.description ?? el?.entry), ctxFor(ev)), colour: mapColour(el?.colour), order: order++, ...stamp(ev),
            })
          }
        }
        break
      }
      case 'journal':
        set('date', str(rec.date))
        set('authorId', entRef(rec.author_id)?.newId ?? childRef('character', rec.character_id)?.newId ?? null)
        set('locationId', childRef('location', rec.location_id)?.newId ?? locIds[0] ?? null)
        break
      case 'ability':
        set('charges', str(rec.charges))
        break
      case 'map': {
        set('locationId', childRef('location', rec.location_id)?.newId ?? null)
        set('mapImageId', imageId)
        set('mapWidth', num(rec.width))
        set('mapHeight', num(rec.height))
        set('mapGrid', num(rec.grid))
        set('mapMinZoom', num(rec.min_zoom))
        set('mapMaxZoom', num(rec.max_zoom))
        set('mapInitialZoom', num(rec.initial_zoom))
        if (num(rec.center_x) !== null && num(rec.center_y) !== null) fields.mapCenter = { lat: num(rec.center_x), lng: num(rec.center_y) }
        set('mapIsReal', bool(rec.is_real))
        if (imageId && (num(rec.width) === null || num(rec.height) === null)) mapNeedsSize.push({ entityId: info.newId, imageId })
        if (!imageId) warn(bool(rec.is_real) ? `Карта «${info.name}»: карты реального мира (OpenStreetMap) не поддерживаются — импортирована без подложки` : `Карта «${info.name}» без изображения`)
        const groupIds = new Map<number, string>()
        listOf([rec], ['groups', 'mapGroups', 'map_groups']).forEach((g, i) => {
          const id = gen()
          const k = num(g?.id)
          if (k !== null) groupIds.set(k, id)
          rows.mapGroups.push({ id, mapId: info.newId, name: str(g?.name), order: num(g?.position) ?? i, isShown: g?.is_shown === undefined ? true : bool(g.is_shown), ...stamp(rowVis(g, vis)) })
        })
        listOf([rec], ['layers', 'mapLayers', 'map_layers']).forEach((l, i) => {
          const lv = rowVis(l, vis)
          const img = (l?.image_uuid ? galleryImage(str(l.image_uuid), lv) : null) ?? pathImage(l?.image_path ?? l?.image, lv)
          if (!img) warn(`Слой «${str(l?.name)}» карты «${info.name}» без изображения`)
          rows.mapLayers.push({ id: gen(), mapId: info.newId, name: str(l?.name), imageId: img, order: num(l?.position) ?? i, kind: num(l?.type_id) ? 'overlay' : 'base', opacity: 1, ...stamp(lv) })
        })
        for (const m of listOf([rec], ['markers', 'mapMarkers', 'map_markers'])) {
          // a marker shows the name and position of its entity: never more visible than that entity
          const linked = entRef(m?.entity_id)
          const mv = linked ? rowVis(m, vis, linked.vis) : rowVis(m, vis)
          const shape = mapMarkerShape(m?.shape_id)
          let opacity = num(m?.opacity) ?? 1
          if (opacity > 1) opacity = opacity / 100
          rows.mapMarkers.push({
            id: gen(), mapId: info.newId, groupId: groupIds.get(num(m?.group_id) ?? -1) ?? null, entityId: linked?.newId ?? null,
            name: str(m?.name), lat: num(m?.latitude) ?? 0, lng: num(m?.longitude) ?? 0, shape, icon: '', colour: mapColour(m?.colour),
            fontColour: mapColour(m?.font_colour), opacity: Math.max(0, Math.min(1, opacity)), size: num(m?.size_id) ?? 1,
            radius: num(m?.circle_radius) ?? 0, points: shape === 'polygon' ? parseCustomShape(m?.custom_shape) : [],
            html: convertText(str(m?.entry), ctxFor(mv)), isDraggable: bool(m?.is_draggable), ...stamp(mv),
          })
          if (num(m?.shape_id) === 6) warn('Пути на картах Kanka импортированы как многоугольники')
        }
        break
      }
      case 'timeline': {
        set('reverse', bool(rec.revert_order))
        set('calendarId', childRef('calendar', rec.calendar_id)?.newId ?? null)
        const eraIds = new Map<number, string>()
        const seenEls = new Set<number>()
        const pushEl = (el: any, eraId: string | null, i: number) => {
          const k = num(el?.id)
          if (k !== null) { if (seenEls.has(k)) return; seenEls.add(k) }
          const ev = rowVis(el, vis)
          rows.timelineElements.push({
            id: gen(), timelineId: info.newId, eraId, entityId: entRef(el?.entity_id)?.newId ?? null, name: str(el?.name), date: str(el?.date),
            year: parseYear(el?.date), html: convertText(str(el?.entry), ctxFor(ev)), icon: '', colour: mapColour(el?.colour),
            order: num(el?.position) ?? i, isCollapsed: bool(el?.is_collapsed), ...stamp(ev),
          })
        }
        listOf([rec], ['eras', 'timelineEras', 'timeline_eras']).forEach((era, i) => {
          const id = gen()
          const k = num(era?.id)
          if (k !== null) eraIds.set(k, id)
          rows.timelineEras.push({
            id, timelineId: info.newId, name: str(era?.name), abbreviation: str(era?.abbreviation), startYear: num(era?.start_year),
            endYear: num(era?.end_year), html: convertText(str(era?.entry), ctx), order: num(era?.position) ?? i, isCollapsed: bool(era?.is_collapsed),
            ...stamp(vis),
          })
          listOf([era], ['elements', 'timelineElements', 'timeline_elements']).forEach((el, j) => pushEl(el, id, j))
        })
        listOf([rec], ['elements', 'timelineElements', 'timeline_elements']).forEach((el, j) => pushEl(el, eraIds.get(num(el?.era_id) ?? -1) ?? null, j))
        break
      }
      case 'tag':
        set('colour', mapColour(rec.colour))
        set('isAutoApplied', bool(rec.is_auto_applied))
        break
    }

    // tags
    const tagIds = uniq(listOf([ent, rec], ['entityTags', 'entity_tags', 'tags']).map((x) => childRef('tag', typeof x === 'object' ? x.tag_id ?? x.id : x)?.newId))
      .filter((id) => id !== info.newId)

    // attributes
    const allPrivate = bool(ent?.is_attributes_private)
    const pubAttrs: Attribute[] = []
    const privAttrs: Attribute[] = []
    const attrs = listOf([ent, rec], ['entityAttributes', 'entity_attributes', 'attributes'])
      .slice().sort((a, b) => (num(a?.default_order) ?? 0) - (num(b?.default_order) ?? 0))
    for (const a of attrs) {
      const typeId = num(a?.type_id) ?? 1
      if (typeId === 5) warn('Случайные атрибуты Kanka импортированы как текст (значение — исходная формула)')
      if (typeId === 7) warn('Атрибуты-списки Kanka импортированы как текст')
      const attr: Attribute = {
        id: gen().slice(0, 8), name: str(a?.name), value: mentionsToPlain(str(a?.value), ctx), kind: ATTRIBUTE_KINDS[typeId] ?? 'text', isPinned: bool(a?.is_pinned),
      }
      if (allPrivate || bool(a?.is_private) || bool(a?.is_hidden)) privAttrs.push({ ...attr, isPrivate: true })
      else pubAttrs.push(attr)
    }

    // assets: links, aliases, files
    const links: EntityLink[] = []
    const aliases: string[] = []
    const notes: string[] = []
    const files: string[] = []
    const assets = listOf([ent, rec], ['assets', 'entityAssets', 'entity_assets'])
    for (const l of listOf([ent], ['links', 'entityLinks', 'entity_links'])) assets.push({ ...l, type_id: 2, metadata: { url: l?.url } })
    for (const f of listOf([ent], ['files', 'entityFiles', 'entity_files'])) assets.push({ ...f, type_id: 1, metadata: { path: f?.path } })
    for (const a of assets) {
      const kind = num(a?.type_id)
      const meta = jsonish(a?.metadata) ?? {}
      const priv = bool(a?.is_private) || mapVisibilityId(a?.visibility_id, pub) === 'master'
      const name = str(a?.name)
      if (kind === 2) {
        const url = str(meta?.url ?? a?.url)
        if (!url) continue
        if (priv) notes.push(`Ссылка: ${name ? name + ' — ' : ''}${url}`)
        else links.push({ id: gen().slice(0, 8), name: name || url, url })
      } else if (kind === 3) {
        if (!name) continue
        if (priv) notes.push(`Псевдоним: ${name}`)
        else aliases.push(name)
      } else if (kind === 1) {
        if (priv) { skip(`Скрытый файл «${name}» статьи «${info.name}»`); continue }
        const img = (a?.image_uuid ? galleryImage(str(a.image_uuid), vis) : null) ?? pathImage(meta?.path ?? a?.path, vis)
        if (img) files.push(`<span class="wiki-img" data-align="center"><img data-image-id="${img}" alt="${escapeHtml(name)}"><span class="wiki-img-cap">${escapeHtml(name)}</span></span>`)
        else skip(`Файл «${name || str(meta?.path)}» статьи «${info.name}» (не изображение или нет в архиве)`)
      }
    }
    if (files.length) html += `<h3>Файлы</h3>${files.join('')}`

    // posts
    const posts = listOf([ent, rec], ['posts', 'entityNotes', 'entity_notes'])
    posts.forEach((p, i) => {
      const entry = str(p?.entry)
      if (!entry.trim() && num(p?.layout_id) !== null) { skip(`Пост-раскладка «${str(p?.name)}» статьи «${info.name}»`); return }
      const pv = rowVis(p, vis)
      const position = num(p?.position) ?? i + 1
      const settings = jsonish(p?.settings) ?? {}
      rows.posts.push({
        id: gen(), entityId: info.newId, title: str(p?.name), html: convertText(entry, ctxFor(pv)), order: position,
        position: position < 0 ? 'before' : 'after', isCollapsed: bool(settings?.collapsed ?? p?.is_collapsed), deleted: false,
        ...stamp(pv, parseTime(p?.created_at)),
      })
    })

    // relations (mirrored pairs → one doc with label + reverseLabel)
    for (const r of listOf([ent, rec], ['relationships', 'relations'])) {
      const rid = num(r?.id)
      if (rid !== null && relDone.has(rid)) continue
      const owner = entRef(r?.owner_id) ?? info
      const target = entRef(r?.target_id)
      if (!target) { skip(`Связь «${str(r?.relation)}» статьи «${info.name}»: цель не найдена`); continue }
      const rv = rowVis(r, owner.vis, target.vis)
      const mirror = num(r?.mirror_id)
      const twin = mirror !== null ? relByKankaId.get(mirror) : undefined
      if (twin && twin.sourceId === target.newId && twin.targetId === owner.newId) {
        const label = str(r?.relation)
        if (label && label !== twin.label) twin.reverseLabel = label
        twin.visibility = narrowest(twin.visibility, rv)
        if (rid !== null) { relDone.add(rid); relByKankaId.set(rid, twin) }
        continue
      }
      const row = {
        id: gen(), sourceId: owner.newId, targetId: target.newId, label: str(r?.relation), reverseLabel: '', kind: 'generic',
        attitude: num(r?.attitude) ?? 0, colour: mapColour(r?.colour), isPinned: bool(r?.is_pinned ?? r?.is_star), deleted: false, ...stamp(rv),
      }
      rows.relations.push(row)
      if (rid !== null) { relDone.add(rid); relByKankaId.set(rid, row) }
    }

    // inventory
    listOf([ent, rec], ['inventories', 'inventory']).forEach((x, i) => {
      const item = childRef('item', x?.item_id)
      const name = str(x?.name)
      if (!item && !name) { skip(`Предмет инвентаря статьи «${info.name}»: предмет ${str(x?.item_id)} не найден`); return }
      rows.inventory.push({
        id: gen(), ownerId: info.newId, itemId: item?.newId ?? null, name, amount: num(x?.amount) ?? 1, group: str(x?.position),
        description: str(x?.description), isEquipped: bool(x?.is_equipped), order: i, ...stamp(rowVis(x, vis)),
      })
    })

    // entity abilities
    listOf([ent], ['abilities', 'entityAbilities', 'entity_abilities']).forEach((x, i) => {
      const ab = childRef('ability', x?.ability_id)
      if (!ab) { skip(`Способность статьи «${info.name}»: способность ${str(x?.ability_id)} не найдена`); return }
      rows.entityAbilities.push({
        id: gen(), entityId: info.newId, abilityId: ab.newId, charges: num(x?.charges) ?? 0, usedCharges: 0, note: str(x?.note),
        order: num(x?.position) ?? i, ...stamp(rowVis(x, vis, ab.vis)),
      })
    })

    // reminders (calendar_id is the calendar's child id)
    const reminders = [...listOf([ent, rec], ['reminders']), ...listOf([ent], ['events', 'entityEvents', 'entity_events'])]
    for (const r of reminders) {
      const cal = childRef('calendar', r?.calendar_id)
      if (!cal) { skip(`Дата статьи «${info.name}»: календарь ${str(r?.calendar_id)} не найден`); continue }
      rows.reminders.push({
        id: gen(), calendarId: cal.newId, entityId: info.newId, name: '', year: num(r?.year) ?? 0, month: Math.max(1, num(r?.month) ?? 1),
        day: Math.max(1, num(r?.day) ?? 1), length: Math.max(1, num(r?.length) ?? 1), colour: mapColour(r?.colour), comment: str(r?.comment),
        kind: mapReminderKind(r?.type_id), isRecurring: bool(r?.is_recurring),
        recurPeriod: str(r?.recurring_periodicity).toLowerCase() === 'month' ? 'month' : 'year', recurUntil: num(r?.recurring_until),
        ...stamp(rowVis(r, vis, cal.vis)),
      })
    }

    // kind (subtype): new exports keep it on the entity, old ones on the module record
    let kind = str(ent?.type).trim()
    if (!kind || MODULE_TYPES[kind + 's'] || kind === type) kind = str(rec?.type).trim()
    if (MODULE_TYPES[kind + 's'] === type) kind = ''

    const e: Entity = {
      id: info.newId, type, name: info.name, kind, parentId: parent?.newId ?? null, imageId, headerImageId, tagIds, aliases: uniq(aliases),
      fields, attributes: pubAttrs, links, excerpt: '', tooltip: stripTags(mentionsToPlain(str(ent?.tooltip), ctx)).slice(0, 1000), mentions: [],
      editorUids: [], hasSecrets: privAttrs.length > 0 || notes.length > 0, bodyRev: 0, isTemplate: bool(ent?.is_template),
      deleted: false, deletedAt: null, ...stamp(vis, parseTime(ent?.created_at ?? rec?.created_at)),
    }
    entities.push(e)
    bodies[e.id] = html
    if (privAttrs.length) privateAttrs[e.id] = privAttrs
    if (notes.length) gmNotes[e.id] = notes.join('\n')
    report.byType[type] = (report.byType[type] ?? 0) + 1
  }

  // characters listed as family members on the family side
  for (const e of entities) {
    const extra = familyExtra.get(e.id)
    if (extra) e.fields.familyIds = uniq([...(e.fields.familyIds ?? []), ...extra])
  }

  if (opts.importUnusedGallery) {
    for (const uuid of input.galleryFiles.keys()) {
      const meta = input.galleryMeta.get(uuid)
      if (meta && bool(meta.is_folder)) continue
      galleryImage(uuid, pub ? 'public' : 'members')
    }
  }
  for (const { entityId, imageId } of mapNeedsSize) {
    for (const img of images.values()) if (img.id === imageId) img.mapFor = entityId
  }
  // Kanka's gallery focal points become the framing of the articles using those pictures
  const imgById = new Map([...images.values()].map((i) => [i.id, i]))
  for (const e of entities) {
    for (const [idField, cropField] of [['imageId', 'imageCrop'], ['headerImageId', 'headerCrop']] as const) {
      const img = e[idField] ? imgById.get(e[idField] as string) : undefined
      if (img?.focus) (img.cropFor ??= []).push({ entityId: e.id, field: cropField })
    }
  }

  const customTypes: CustomType[] = [...usedCustom.entries()].sort((a, b) => a[0] - b[0]).map(([cid, dir]) => {
    const def = input.customModules.find((m) => num(m.id) === cid)
    const label = str(def?.singular ?? def?.name).trim() || humanizeDir(dir)
    return { key: `c_${cid}`, label, plural: str(def?.plural).trim() || label, icon: 'file-text' }
  })

  for (const c of ROW_COLLECTIONS) report.rows[c] = rows[c].length
  report.mentions = { converted: stats.mentions, unresolved: stats.unresolved }
  report.images = { inline: stats.images, external: stats.externalImages, planned: images.size }
  if (stats.unresolved) warn(`${stats.unresolved} упоминаний ссылаются на статьи, которых нет в архиве — оставлены текстом`)
  if (stats.externalImages) warn(`${stats.externalImages} внешних картинок (по URL) оставлены ссылками`)
  for (const [msg, n] of warnCounts) if (n > 1) {
    const i = report.warnings.indexOf(msg)
    if (i >= 0) report.warnings[i] = `${msg} (×${n})`
  }
  return { entities, bodies, privateAttrs, gmNotes, rows, images: [...images.values()], customTypes, calendarIds, report }
}

/** Firestore writes the plan will need (images: metadata + chunks). */
export function estimatePlanWrites(plan: KankaPlan): number {
  let n = 1 // world settings
  n += plan.entities.length
  for (const e of plan.entities) {
    if (plan.bodies[e.id] || e.hasSecrets) n++
    if (e.hasSecrets) n++
  }
  for (const c of ROW_COLLECTIONS) n += plan.rows[c].length
  for (const img of plan.images) n += 1 + Math.max(1, Math.ceil(Math.min(img.size || 600_000, MAX_UPLOAD) / CHUNK))
  return n
}
