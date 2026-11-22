// The world overview page is a list of blocks in a 12-column grid. This file knows the block kinds, their
// defaults and the standard layout used until a master customises the page.
import type { DashBlock, DashBlockType, DashboardLayout } from '@/model/types'
import { randomId } from '@/data/util'

export interface BlockKind {
  type: DashBlockType
  label: string
  icon: string
  description: string
  /** Defaults for a new block of this kind. */
  defaults: Partial<DashBlock>
  /** A new block opens its settings at once (it shows nothing until configured). */
  needsSetup?: boolean
}

export const BLOCK_KINDS: BlockKind[] = [
  { type: 'hero', label: 'Шапка мира', icon: 'castle', description: 'Название, описание и обложка мира', defaults: { w: 12, heroSize: 'md', align: 'left', showDescription: true } },
  { type: 'stats', label: 'Разделы мира', icon: 'layout-grid', description: 'Сколько статей в каждом разделе — со ссылками на списки', defaults: { w: 12, style: 'plain', hideTitle: true, types: [] } },
  { type: 'text', label: 'Текст', icon: 'type', description: 'Приветствие, правила стола, новости: свой текст с форматированием и ссылками «@»', defaults: { w: 6, html: '' }, needsSetup: true },
  { type: 'pins', label: 'Закреплённые статьи', icon: 'pin', description: 'Выбранные статьи карточками, плитками или списком', defaults: { w: 12, ids: [], view: 'cards' }, needsSetup: true },
  { type: 'entity', label: 'Статья', icon: 'file-text', description: 'Одна статья: карточка или весь её текст', defaults: { w: 6, entityId: null, view: 'card' }, needsSetup: true },
  { type: 'list', label: 'Список статей', icon: 'list', description: 'Статьи раздела или тега: новые, недавно изменённые или по алфавиту', defaults: { w: 4, types: [], tagId: null, sort: 'recent', limit: 8, view: 'rows' }, needsSetup: true },
  { type: 'recent', label: 'Последние изменения', icon: 'clock', description: 'Что недавно правили в мире', defaults: { w: 4, limit: 10, types: [] } },
  { type: 'calendar', label: 'Календарь', icon: 'calendar-days', description: 'Текущая дата и ближайшие события календаря', defaults: { w: 4, calendarId: null, limit: 5, hideTitle: true } },
  { type: 'map', label: 'Карта', icon: 'map', description: 'Превью карты с метками, по клику — сама карта', defaults: { w: 6, entityId: null }, needsSetup: true },
  { type: 'image', label: 'Картинка', icon: 'image', description: 'Картинка из галереи мира с подписью', defaults: { w: 4, imageId: null, caption: '', fit: 'cover' }, needsSetup: true },
  { type: 'links', label: 'Быстрые ссылки', icon: 'link', description: 'Кнопки на статьи и внешние сайты: правила, Discord, виртуальный стол', defaults: { w: 4, links: [] }, needsSetup: true },
  { type: 'character', label: 'Мой персонаж', icon: 'user', description: 'Персонаж игрока — каждый видит своего (у кого нет персонажа, блок не видит)', defaults: { w: 4 } },
  { type: 'campaigns', label: 'Кампейны', icon: 'swords', description: 'Кампейны этого мира, в которых участвует зритель', defaults: { w: 4 } },
  { type: 'random', label: 'Случайная статья', icon: 'shuffle', description: 'Для вдохновения — новая при каждом открытии', defaults: { w: 4, types: [] } },
  { type: 'waiting', label: 'Ждут текста', icon: 'feather', description: 'Статьи без текста и без упоминаний', defaults: { w: 4, show: 'masters', limit: 8 } },
]
const KIND = new Map(BLOCK_KINDS.map((k) => [k.type, k]))
export const kindOf = (t: DashBlockType): BlockKind => KIND.get(t) ?? BLOCK_KINDS[0]
export const titleOf = (b: DashBlock) => b.title?.trim() || kindOf(b.type).label

/** Widths offered by the settings (in twelfths). Drag-resizing allows any value from 2 to 12. */
export const WIDTHS: Array<{ w: number; label: string }> = [
  { w: 3, label: '¼' }, { w: 4, label: '⅓' }, { w: 6, label: '½' }, { w: 8, label: '⅔' }, { w: 9, label: '¾' }, { w: 12, label: 'Вся ширина' },
]
export const HEIGHTS: Array<{ h: number; label: string }> = [
  { h: 0, label: 'По содержимому' }, { h: 240, label: 'Низкий' }, { h: 360, label: 'Средний' }, { h: 480, label: 'Высокий' }, { h: 640, label: 'Очень высокий' },
]
export const MIN_W = 2
export const MIN_H = 120
export const MAX_H = 1600
export const H_STEP = 20

export function newBlock(type: DashBlockType): DashBlock {
  return { id: randomId(8), type, w: 4, h: 0, ...structuredClone(kindOf(type).defaults) }
}

/** The page until a master customises it (the same blocks the overview always had). */
export function defaultLayout(pins: string[] = []): DashboardLayout {
  const b = (id: string, type: DashBlockType, extra: Partial<DashBlock> = {}): DashBlock => ({ ...newBlock(type), id, ...extra })
  return {
    v: 1, gap: 'md', wide: false,
    blocks: [
      b('hero', 'hero'),
      b('stats', 'stats'),
      b('character', 'character'),
      b('pins', 'pins', { ids: pins }),
      b('recent', 'recent', { limit: 14 }),
      b('calendar', 'calendar'),
      b('random', 'random'),
      b('waiting', 'waiting'),
    ],
  }
}

/** Tolerates layouts written by older or newer versions: unknown blocks are dropped, sizes clamped. */
export function normalizeLayout(raw: DashboardLayout | null | undefined, pins: string[] = []): DashboardLayout {
  if (!raw || !Array.isArray(raw.blocks)) return defaultLayout(pins)
  const blocks = raw.blocks
    .filter((b) => b && KIND.has(b.type) && typeof b.id === 'string')
    .map((b) => ({ ...b, w: clampW(b.w), h: clampH(b.h) }))
  return { v: 1, blocks, gap: raw.gap ?? 'md', wide: !!raw.wide }
}

export const clampW = (w: unknown) => Math.min(12, Math.max(MIN_W, Math.round(Number(w) || 12)))
export const clampH = (h: unknown) => { const n = Math.round(Number(h) || 0); return n <= 0 ? 0 : Math.min(MAX_H, Math.max(MIN_H, n)) }

/** Width on mid-size screens (two columns at most): narrow blocks take half, wide ones the full row. */
export const midW = (w: number) => (w <= 6 ? 6 : 12)
