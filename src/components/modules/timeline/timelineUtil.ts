// Pure helpers for the timeline module: ordering, labels, icon names (incl. Kanka/FontAwesome names).
import type { TimelineElement, TimelineEra } from '@/model/types'
import { ICONS } from '@/components/common/icons'

/** Icons offered in the element editor (all exist in icons.ts). */
export const TIMELINE_ICONS: string[] = [
  'circle-dot', 'star', 'flame', 'swords', 'sword', 'shield', 'crown', 'skull', 'heart', 'baby',
  'castle', 'landmark', 'church', 'building2', 'tent', 'flag', 'trophy', 'award', 'gavel', 'scroll',
  'book-open', 'feather', 'handshake', 'heart-handshake', 'users', 'user', 'ghost', 'sparkles', 'wand2', 'zap',
  'flask-conical', 'hammer', 'axe', 'pickaxe', 'coins', 'gem', 'key', 'lock', 'map-pin', 'compass',
  'route', 'footprints', 'ship', 'anchor', 'mountain', 'tree-pine', 'waves', 'snowflake', 'droplet', 'sunrise',
  'sun', 'moon', 'eclipse', 'orbit', 'telescope', 'hourglass', 'clock', 'calendar', 'bell', 'music',
  'lightbulb', 'paw-print', 'bird', 'bug', 'dna', 'leaf', 'wheat', 'target', 'crosshair', 'history',
]

/** A few FontAwesome / RPG-Awesome names used by Kanka exports → our icon names. */
const FOREIGN: Record<string, string> = {
  fire: 'flame', 'fire-flame-curved': 'flame', 'fire-alt': 'flame', dragon: 'flame', bolt: 'zap', 'bolt-lightning': 'zap',
  'skull-crossbones': 'skull', 'chess-rook': 'castle', 'fort-awesome': 'castle', 'place-of-worship': 'church',
  'hat-wizard': 'wand2', 'magic': 'wand2', 'wand-magic': 'wand2', 'wand-magic-sparkles': 'wand2', 'khanda': 'swords',
  'book': 'book-open', 'book-skull': 'book-open', 'scroll-old': 'scroll', 'feather-alt': 'feather', 'feather-pointed': 'feather',
  'shield-alt': 'shield', 'shield-halved': 'shield', 'map-marker': 'map-pin', 'map-marker-alt': 'map-pin', 'location-dot': 'map-pin',
  'location-pin': 'map-pin', tree: 'tree-pine', water: 'waves', 'mountain-sun': 'mountain', 'person': 'user', 'user-alt': 'user',
  'people-group': 'users', 'user-group': 'users', 'hourglass-half': 'hourglass', 'hourglass-start': 'hourglass', 'hourglass-end': 'hourglass',
  'clock-rotate-left': 'history', 'calendar-alt': 'calendar', 'calendar-days': 'calendar', 'coins': 'coins', 'sack-dollar': 'coins',
  'hand-holding-heart': 'heart-handshake', 'ring': 'heart', 'heart-crack': 'heart', 'heart-broken': 'heart', 'cross': 'church',
  'ankh': 'church', 'monument': 'landmark', 'building': 'building2', 'city': 'building2', 'landmark-dome': 'landmark',
  'campground': 'tent', 'flag-checkered': 'flag', 'medal': 'award', 'crosshairs': 'crosshair', 'bullseye': 'target',
  'gavel': 'gavel', 'balance-scale': 'scale', 'scale-balanced': 'scale', 'paw': 'paw-print', 'dove': 'bird', 'crow': 'bird',
  'spider': 'bug', 'virus': 'bug', 'snowman': 'snowflake', 'tint': 'droplet', 'sun': 'sun', 'moon': 'moon', 'star-of-life': 'sparkle',
  'globe': 'globe', 'earth-europe': 'globe', 'ship': 'ship', 'anchor': 'anchor', 'hammer': 'hammer', 'axe': 'axe',
  'sword': 'sword', 'swords': 'swords', 'crossed-swords': 'swords', 'broadsword': 'sword', 'dagger': 'sword', 'battle-axe': 'axe',
  'crown': 'crown', 'castle': 'castle', 'tower': 'castle', 'skull': 'skull', 'death-skull': 'skull', 'potion': 'flask-conical',
  'flask': 'flask-conical', 'key': 'key', 'lock': 'lock', 'baby': 'baby', 'baby-carriage': 'baby', 'ghost': 'ghost',
  'circle': 'circle-dot', 'dot-circle': 'circle-dot', 'circle-dot': 'circle-dot', 'diamond': 'gem', 'gem': 'gem',
}

const STYLE_TOKENS = new Set(['solid', 'regular', 'light', 'thin', 'duotone', 'brands', 'sharp', 'fw', 'lg', 'xl', 'xs', 'sm', 'spin', 'pulse', '2x', '3x', '4x', '5x'])

/** Turns whatever is stored in `icon` (our name, "fa-solid fa-crown", `<i class="ra ra-sword">`) into a known icon name or ''. */
export function resolveIcon(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.trim()
  if (!s) return ''
  if (ICONS[s]) return s
  const cls = s.match(/class\s*=\s*["']([^"']+)["']/i)
  if (cls) s = cls[1]
  const tokens = s.split(/\s+/).filter(Boolean)
  for (const t of tokens) {
    const name = t.replace(/^(fa[srlbd]?|ra|fa-solid|fa-regular|fa-light|fa-thin|fa-duotone|fa-brands)-/, '').toLowerCase()
    if (!name || STYLE_TOKENS.has(name) || /^(fa|ra|fas|far|fal|fab|fad)$/.test(name)) continue
    if (ICONS[name]) return name
    if (FOREIGN[name] && ICONS[FOREIGN[name]]) return FOREIGN[name]
  }
  return ''
}

/** Year suggested from a free-form date ("12 мая 1250 г." → 1250): the longest number, last one on ties. */
export function parseYear(date: string): number | null {
  const nums = [...(date || '').matchAll(/(^|[^\d])(-?\d+)/g)].map((m) => m[2])
  if (!nums.length) return null
  let best = nums[0]
  for (const n of nums) if (n.replace('-', '').length >= best.replace('-', '').length) best = n
  const v = Number(best)
  return Number.isFinite(v) ? v : null
}

const FAR_PAST = -1e15

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Chronological order of elements: by year, then by manual `order`.
 * Elements without a year keep their manual position: they inherit the year of the element before them.
 */
export function sortElements(els: TimelineElement[], fallbackYear: number | null = null): TimelineElement[] {
  const byOrder = [...els].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
  const eff = new Map<string, number>()
  const idx = new Map<string, number>()
  let last = num(fallbackYear) ?? FAR_PAST
  byOrder.forEach((e, i) => {
    const y = num(e.year)
    if (y !== null) last = y
    eff.set(e.id, last)
    idx.set(e.id, i)
  })
  return byOrder.sort((a, b) => eff.get(a.id)! - eff.get(b.id)! || idx.get(a.id)! - idx.get(b.id)!)
}

export function sortEras(eras: TimelineEra[]): TimelineEra[] {
  return [...eras].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (num(a.startYear) ?? FAR_PAST) - (num(b.startYear) ?? FAR_PAST) || a.name.localeCompare(b.name))
}

export interface EraGroup {
  key: string
  era: TimelineEra | null
  /** Display order (already reversed if needed). */
  elements: TimelineElement[]
}

export function groupTimeline(eras: TimelineEra[], elements: TimelineElement[], reverse: boolean): EraGroup[] {
  const sorted = sortEras(eras)
  const ids = new Set(sorted.map((e) => e.id))
  const groups: EraGroup[] = sorted.map((era) => {
    const els = sortElements(elements.filter((el) => el.eraId === era.id), num(era.startYear))
    return { key: era.id, era, elements: reverse ? els.reverse() : els }
  })
  if (reverse) groups.reverse()
  const orphans = sortElements(elements.filter((el) => !el.eraId || !ids.has(el.eraId)))
  if (orphans.length) groups.push({ key: '__none', era: null, elements: reverse ? orphans.reverse() : orphans })
  return groups
}

export function eraRange(era: Pick<TimelineEra, 'startYear' | 'endYear'>): string {
  const s = num(era.startYear)
  const e = num(era.endYear)
  if (s !== null && e !== null) return `${s} — ${e}`
  if (s !== null) return `с ${s}`
  if (e !== null) return `до ${e}`
  return ''
}

export function dateLabel(el: Pick<TimelineElement, 'date' | 'year'>, era: TimelineEra | null): string {
  if (el.date?.trim()) return el.date.trim()
  const y = num(el.year)
  if (y === null) return ''
  return era?.abbreviation ? `${y} ${era.abbreviation}` : String(y)
}

/** Empty TipTap documents come back as "<p></p>". */
export function normalizeHtml(html: string): string {
  const t = (html || '').trim()
  if (!t || /^(<p>\s*(<br\s*\/?>)?\s*<\/p>\s*)+$/i.test(t)) return ''
  return t
}

/** Accepts "#abc", "#aabbcc", "rgb(...)", css names. Returns '' for empty. */
export function safeColour(c: string | null | undefined): string {
  const s = (c || '').trim()
  if (!s) return ''
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^(rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(s) || /^[a-z]{3,20}$/i.test(s)) return s
  return ''
}

/** Value for <input type="color"> (needs #rrggbb). */
export function colourInputValue(c: string): string {
  const s = safeColour(c)
  if (/^#[0-9a-f]{6}$/i.test(s)) return s
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map((x) => x + x).join('')
  return '#9c7a1c'
}

export const COLOUR_PRESETS = ['#c9a227', '#b03a2e', '#d0703c', '#4f9d69', '#3f9fb5', '#6a7fc1', '#a86fc4', '#c25b8b', '#8b6d3f', '#7d7d7d']
