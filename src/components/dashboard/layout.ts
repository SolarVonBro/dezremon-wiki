// Where overview blocks stand. Every block has a column `x` (0–11) and a width `w` in twelfths; `y` is its place
// in the vertical order (the top, in ROW units, at the time it was saved). Blocks keep their columns — so a row
// may have empty columns, and two short blocks can stand one above the other next to a tall one — and "fall" up:
// in `y` order each block sits right under the lowest of the earlier blocks that share a column with it.
// Heights come from the content (measured), so the same layout works for viewers who see more or less.
import type { DashBlock } from '@/model/types'

/** Height of one grid row in px: block heights are rounded up to it. */
export const ROW = 4

export interface Slot { x: number; w: number; top: number; rows: number }
export interface LayoutItem { id: string; x: number; w: number; rows: number; key: number }

export const rowsFor = (heightPx: number, gap: number) => Math.max(1, Math.ceil((heightPx + gap) / ROW))
export const clampX = (x: unknown, w: number) => Math.min(12 - w, Math.max(0, Math.round(Number(x) || 0)))

export function compact(items: LayoutItem[]): Map<string, Slot> {
  const order = items.map((it, i) => ({ ...it, x: clampX(it.x, it.w), i })).sort((a, b) => a.key - b.key || a.x - b.x || a.i - b.i)
  const out = new Map<string, Slot>()
  const placed: Slot[] = []
  for (const it of order) {
    let top = 0
    for (const p of placed) if (it.x < p.x + p.w && p.x < it.x + it.w) top = Math.max(top, p.top + p.rows)
    const s = { x: it.x, w: it.w, top, rows: it.rows }
    placed.push(s)
    out.set(it.id, s)
  }
  return out
}

/** The lowest bottom of the blocks over columns [x, x + w). */
function skyline(slots: Iterable<Slot>, x: number, w: number) {
  let top = 0
  for (const s of slots) if (x < s.x + s.w && s.x < x + w) top = Math.max(top, s.top + s.rows)
  return top
}

/** The highest free place for a new block of width `w` (the leftmost of equal ones). */
export function freeSpot(slots: Map<string, Slot>, w: number): { x: number; top: number } {
  let best = { x: 0, top: Infinity }
  for (let x = 0; x + w <= 12; x++) {
    const top = skyline(slots.values(), x, w)
    if (top < best.top) best = { x, top }
  }
  return best.top === Infinity ? { x: 0, top: 0 } : best
}

/**
 * Positions for layouts saved before blocks had them (and for the standard layout): blocks go left to right in
 * rows, as the page used to flow. `y` is the row number — only the order matters until the layout is saved.
 */
export function flowPositions(blocks: DashBlock[]) {
  let cx = 0, row = 0
  for (const b of blocks) {
    if (cx + b.w > 12) { row++; cx = 0 }
    b.x = cx
    b.y = row
    cx += b.w
    if (cx >= 12) { row++; cx = 0 }
  }
}
