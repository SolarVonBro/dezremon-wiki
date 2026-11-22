// Where overview blocks stand: a table-like grid of 12 columns and rows. A block takes columns x … x+w-1 and rows
// y … y+rs-1 (`rs` = how many rows it spans). Rows are as tall as their tallest block and every block stretches to
// its rows, so blocks of one row always start and end on the same level. Columns may stay empty, and a block
// spanning two rows stands next to two blocks placed one above the other (their common bottom is its bottom).
import type { DashBlock } from '@/model/types'

export interface Cell { x: number; w: number; row: number; span: number }
/** Pixel extent of every row of the page as drawn (relative to the top of the grid). */
export interface Geometry { tops: number[]; bottoms: number[] }

export const clampX = (x: unknown, w: number) => Math.min(12 - w, Math.max(0, Math.round(Number(x) || 0)))
export const cellOf = (b: DashBlock): Cell => ({ x: b.x ?? 0, w: b.w, row: b.y ?? 0, span: Math.max(1, b.rs ?? 1) })
const endOf = (c: Cell) => c.row + c.span - 1
const colsMeet = (a: { x: number; w: number }, b: { x: number; w: number }) => a.x < b.x + b.w && b.x < a.x + a.w
const rowsMeet = (a: Cell, b: Cell) => a.row <= endOf(b) && b.row <= endOf(a)

/**
 * Makes a layout valid: whole numbers, no two blocks on the same cell (the later one, in reading order, moves down;
 * `keep` — the block just placed — never moves), no rows in which no block starts. Sorts into reading order.
 */
export function tidy(blocks: DashBlock[], keep?: string) {
  for (const b of blocks) {
    b.x = clampX(b.x, b.w)
    b.y = Math.max(0, Math.round(Number(b.y) || 0))
    b.rs = Math.max(1, Math.round(Number(b.rs) || 1))
  }
  const order = [...blocks].sort((a, b) => (a.id === keep ? -1 : b.id === keep ? 1 : a.y! - b.y! || a.x! - b.x!))
  const placed: Cell[] = []
  for (const b of order) {
    let c = cellOf(b)
    while (placed.some((p) => colsMeet(p, c) && rowsMeet(p, c))) c = { ...c, row: c.row + 1 }
    b.y = c.row
    placed.push(c)
  }
  dropEmptyRows(blocks)
  blocks.sort((a, b) => a.y! - b.y! || a.x! - b.x!)
}

/** Rows in which no block starts disappear (blocks spanning across them get shorter). */
function dropEmptyRows(blocks: DashBlock[]) {
  const starts = new Set(blocks.map((b) => b.y!))
  const last = Math.max(-1, ...blocks.map((b) => b.y! + b.rs! - 1))
  for (let r = last; r >= 0; r--) {
    if (starts.has(r)) continue
    for (const b of blocks) {
      if (b.y! > r) b.y!--
      else if (b.y! + b.rs! - 1 >= r) b.rs!--
    }
  }
}

/** Cells as drawn for a viewer: blocks they do not see leave no empty rows behind. */
export function visibleCells(blocks: DashBlock[]): Map<string, Cell> {
  const copy = blocks.map((b) => ({ ...b }))
  dropEmptyRows(copy)
  return new Map(copy.map((b) => [b.id, cellOf(b)]))
}

/** Opens an empty row at index k: rows from k on move down, blocks crossing that line stretch over the new row. */
function openRow(blocks: DashBlock[], k: number, stretch: (b: DashBlock) => boolean = () => false) {
  for (const b of blocks) {
    const c = cellOf(b)
    let s = c.row >= k ? c.row + 1 : c.row
    let e = endOf(c) >= k ? endOf(c) + 1 : endOf(c)
    if (stretch(b)) { s = Math.min(s, k); e = Math.max(e, k) }
    b.y = s
    b.rs = e - s + 1
  }
}

/** Puts block `id` into a new row at index k (rows counted without the block itself), at column x. */
export function insertAt(blocks: DashBlock[], id: string, k: number, x: number) {
  const me = blocks.find((b) => b.id === id)
  if (!me) return
  const others = blocks.filter((b) => b !== me)
  // forget the block's old rows first, so that k means the same here as for the caller (see rowsWithout)
  dropEmptyRows(others)
  openRow(others, k)
  me.x = clampX(x, me.w)
  me.y = k
  me.rs = 1
  tidy(blocks, id)
}

/**
 * Where a dragged block lands. `x` — its column, `top` — its top edge in px from the top of the grid, `geo` — the
 * rows as they were drawn when the drag started (the block itself included).
 *  - Blocks in the same columns whose middle is above `top` stay above it; the rest go below.
 *  - Blocks in other columns that reach past `top` on both sides stay next to it (they stretch over its row).
 *  - If its columns are free in that row and nobody beside needs to stretch, it simply joins the row.
 */
export function placeAt(blocks: DashBlock[], id: string, x: number, top: number, geo: Geometry): DashBlock[] {
  const out = blocks.map((b) => ({ ...b }))
  const me = out.find((b) => b.id === id)
  if (!me) return out
  me.x = clampX(x, me.w)
  const others = out.filter((b) => b !== me)
  const end = geo.bottoms.length ? geo.bottoms[geo.bottoms.length - 1] : 0
  const px = (c: Cell) => ({ top: geo.tops[c.row] ?? end, bottom: geo.bottoms[endOf(c)] ?? end })
  const target = { x: me.x, w: me.w }
  let k = 0
  for (const b of others) {
    const c = cellOf(b)
    if (!colsMeet(c, target)) continue
    const p = px(c)
    if ((p.top + p.bottom) / 2 < top) k = Math.max(k, endOf(c) + 1)
  }
  const beside = new Set(others.filter((b) => {
    const c = cellOf(b)
    if (colsMeet(c, target)) return false
    const p = px(c)
    return p.top < top && top < p.bottom
  }))
  const freeAt = (r: number) => !others.some((b) => { const c = cellOf(b); return colsMeet(c, target) && c.row <= r && r <= endOf(c) })
  const rows = geo.tops.length
  const join = k < rows && freeAt(k) && [...beside].every((b) => { const c = cellOf(b); return c.row <= k && k <= endOf(c) })
  if (!join) openRow(others, k, (b) => beside.has(b))
  me.y = k
  me.rs = 1
  tidy(out, me.id)
  return out
}

/** The first place (reading order) where a block of width w fits into an existing row; else a new last row. */
export function freePlace(blocks: DashBlock[], w: number): { x: number; y: number } {
  const cells = blocks.map(cellOf)
  const rows = cells.reduce((n, c) => Math.max(n, endOf(c) + 1), 0)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x + w <= 12; x++) {
      const c = { x, w, row: r, span: 1 }
      if (!cells.some((o) => colsMeet(o, c) && rowsMeet(o, c))) return { x, y: r }
    }
  }
  return { x: 0, y: rows }
}

/** How wide block `id` may grow to the right without running into a neighbour in its rows. */
export function maxWidth(blocks: DashBlock[], id: string): number {
  const me = blocks.find((b) => b.id === id)
  if (!me) return 12
  const c = cellOf(me)
  let limit = 12
  for (const b of blocks) {
    if (b === me) continue
    const o = cellOf(b)
    if (rowsMeet(o, c) && o.x >= c.x + 1) limit = Math.min(limit, o.x)
  }
  return limit - c.x
}

/** The neighbour right above / below in the same columns (for the «Выше» / «Ниже» menu). */
export function neighbour(blocks: DashBlock[], id: string, dir: 'up' | 'down'): DashBlock | null {
  const me = blocks.find((b) => b.id === id)
  if (!me) return null
  const c = cellOf(me)
  const near = blocks.filter((b) => b !== me && colsMeet(cellOf(b), c))
  if (dir === 'up') return near.filter((b) => endOf(cellOf(b)) < c.row).sort((a, b) => endOf(cellOf(b)) - endOf(cellOf(a)))[0] ?? null
  return near.filter((b) => cellOf(b).row > endOf(c)).sort((a, b) => cellOf(a).row - cellOf(b).row)[0] ?? null
}

/** Rows (start, end) of a block after the block `id` is taken out of the layout (for insertAt indexes). */
export function rowsWithout(blocks: DashBlock[], id: string, of: string): { row: number; end: number } | null {
  const copy = blocks.filter((b) => b.id !== id).map((b) => ({ ...b }))
  dropEmptyRows(copy)
  const b = copy.find((x) => x.id === of)
  return b ? { row: b.y!, end: b.y! + (b.rs ?? 1) - 1 } : null
}

/**
 * Positions for layouts saved before blocks had them (and for the standard layout): blocks go left to right in
 * rows, as the page used to flow.
 */
export function flowPositions(blocks: DashBlock[]) {
  let cx = 0, row = 0
  for (const b of blocks) {
    if (cx + b.w > 12) { row++; cx = 0 }
    b.x = cx
    b.y = row
    b.rs = 1
    cx += b.w
    if (cx >= 12) { row++; cx = 0 }
  }
}

/**
 * Layouts saved by the short-lived "column gravity" version (y = top in 4 px steps): blocks that started at the same
 * height share a row; a block with a fixed height spans the rows that start next to it.
 */
export function rowsFromTops(blocks: DashBlock[]) {
  const tops = [...new Set(blocks.map((b) => Math.round(b.y ?? 0)))].sort((a, b) => a - b)
  const index = new Map(tops.map((t, i) => [t, i]))
  for (const b of blocks) {
    const top = Math.round(b.y ?? 0)
    const bottom = b.h > 0 ? top + Math.ceil((b.h + 18) / 4) : top + 1
    b.rs = Math.max(1, tops.filter((t) => t >= top && t < bottom).length)
    b.y = index.get(top) ?? 0
  }
}
