// Moving and resizing overview blocks with the mouse or a finger (pointer events, so it works on phones).
// Blocks are the grid's children with `data-block` / `data-block-id`; the grip carries `data-block-grip`, resize
// handles carry `data-block-resize="x" | "y" | "xy"`. Put @pointerdown="onPointerDown" on the grid.
//
// Wide page ("grid" mode): the block floats under the pointer (`floating`) and `dragTo` gets the cell under it
//   (column, top row), so the page can show where it lands and move the others out of the way live.
// Narrow page ("list" mode, one or two blocks per row): the block under the pointer shows where it will land
//   (before / after it) and `move` is called on release.
// Resizing: the width snaps to twelfths of the grid, the height to H_STEP px; `resize` is called live.
import { onBeforeUnmount, ref } from 'vue'
import { H_STEP, MAX_H, MIN_H, MIN_W } from './blocks'
import { ROW } from './layout'

export interface GridEditHandlers {
  mode: () => 'grid' | 'list'
  gap: () => number
  dragStart: (id: string) => void
  dragTo: (id: string, x: number, top: number) => void
  dragEnd: (id: string, commit: boolean) => void
  move: (id: string, targetId: string, after: boolean) => void
  resize: (id: string, w: number | null, h: number | null) => void
  resizeEnd: (id: string) => void
}

export interface Floating { id: string; left: number; top: number; width: number; height: number }

export function useGridEdit(grid: () => HTMLElement | null, on: GridEditHandlers) {
  let finish: ((commit: boolean) => void) | null = null
  /** The block being dragged on a wide page: drawn at a fixed position under the pointer. */
  const floating = ref<Floating | null>(null)

  const blocksOf = (g: HTMLElement) => [...g.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-block'))

  /** Keeps scrolling the page while the pointer rests near the top/bottom edge of the window. */
  function edgeScroll(getY: () => number, after: () => void) {
    return setInterval(() => {
      const y = getY(), edge = 70
      const v = y < edge ? -Math.ceil((edge - y) / 5) : y > window.innerHeight - edge ? Math.ceil((y - window.innerHeight + edge) / 5) : 0
      if (v) { window.scrollBy(0, v); after() }
    }, 16)
  }

  /** Common plumbing: listeners on the captured handle, cleanup on release/cancel. */
  function track(e: PointerEvent, handle: HTMLElement, move: (x: number, y: number) => void, done: (commit: boolean) => void, getY: () => number, rescroll: () => void) {
    const scroll = edgeScroll(getY, rescroll)
    const onMove = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; ev.preventDefault(); move(ev.clientX, ev.clientY) }
    const onUp = () => finish?.(true)
    const onCancel = () => finish?.(false)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onCancel)
    finish = (commit) => {
      finish = null
      clearInterval(scroll)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onCancel)
      try { handle.releasePointerCapture(e.pointerId) } catch { /* already released */ }
      done(commit)
    }
  }

  // ---------- wide page: free placement ----------
  function startFloat(e: PointerEvent, handle: HTMLElement, g: HTMLElement, el: HTMLElement, id: string) {
    const r = el.getBoundingClientRect()
    const gx = e.clientX - r.left, gy = e.clientY - r.top
    let cx = e.clientX, cy = e.clientY
    floating.value = { id, left: r.left, top: r.top, width: r.width, height: r.height }
    on.dragStart(id)
    const update = () => {
      floating.value = { ...floating.value!, left: cx - gx, top: cy - gy }
      const gr = g.getBoundingClientRect()
      const gap = on.gap()
      const col = (gr.width - 11 * gap) / 12
      on.dragTo(id, Math.round((cx - gx - gr.left) / (col + gap)), Math.max(0, Math.round((cy - gy - gr.top) / ROW)))
    }
    track(e, handle, (x, y) => { cx = x; cy = y; update() }, (commit) => {
      floating.value = null
      on.dragEnd(id, commit)
    }, () => cy, update)
  }

  // ---------- narrow page: before / after another block ----------
  function startList(e: PointerEvent, handle: HTMLElement, g: HTMLElement, list: HTMLElement[], from: number) {
    const el = list[from]
    const rects = list.map((x) => { const r = x.getBoundingClientRect(); return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY } })
    const gridW = g.getBoundingClientRect().width
    const sx = e.clientX + scrollX, sy = e.clientY + scrollY
    let cx = e.clientX, cy = e.clientY
    let target: { id: string; after: boolean } | null = null
    let mark: HTMLElement | null = null, markCls = ''
    const setMark = (m: HTMLElement | null, cls: string) => {
      if (m === mark && cls === markCls) return
      mark?.classList.remove(markCls)
      mark = m; markCls = cls
      mark?.classList.add(cls)
    }
    el.classList.add('db-dragging')
    g.classList.add('db-moving')
    const update = () => {
      const px = cx + scrollX, py = cy + scrollY
      el.style.transform = `translate(${px - sx}px, ${py - sy}px)`
      let best = -1, bestD = Infinity
      rects.forEach((r, i) => {
        const dx = px < r.l ? r.l - px : px > r.r ? px - r.r : 0
        const dy = py < r.t ? r.t - py : py > r.b ? py - r.b : 0
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = i }
      })
      if (best < 0 || best === from) { target = null; setMark(null, ''); return }
      const r = rects[best]
      const wide = r.r - r.l > gridW * 0.6
      const after = wide ? py > (r.t + r.b) / 2 : px > (r.l + r.r) / 2
      // landing right where it already is
      if ((after && best === from - 1) || (!after && best === from + 1)) { target = null; setMark(null, ''); return }
      target = { id: list[best].dataset.blockId!, after }
      setMark(list[best], wide ? (after ? 'db-drop-below' : 'db-drop-above') : (after ? 'db-drop-right' : 'db-drop-left'))
    }
    track(e, handle, (x, y) => { cx = x; cy = y; update() }, (commit) => {
      setMark(null, '')
      el.style.transform = ''
      el.classList.remove('db-dragging')
      g.classList.remove('db-moving')
      if (commit && target) on.move(el.dataset.blockId!, target.id, target.after)
    }, () => cy, update)
  }

  // ---------- resizing ----------
  function startResize(e: PointerEvent, handle: HTMLElement, g: HTMLElement, el: HTMLElement, id: string, axis: string) {
    const cs = getComputedStyle(g)
    const gap = parseFloat(cs.columnGap) || 0
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 12
    const col = (g.clientWidth - (cols - 1) * gap) / cols
    const r0 = el.getBoundingClientRect()
    const sx = e.clientX, sy = e.clientY, startScroll = scrollY
    let cx = e.clientX, cy = e.clientY, last = ''
    el.classList.add('db-resizing')
    const apply = () => {
      const dy = cy - sy + (scrollY - startScroll)
      const w = axis.includes('x') && on.mode() === 'grid' ? Math.min(12, Math.max(MIN_W, Math.round((r0.width + cx - sx + gap) / (col + gap)))) : null
      const h = axis.includes('y') ? Math.min(MAX_H, Math.max(MIN_H, Math.round((r0.height + dy) / H_STEP) * H_STEP)) : null
      const key = `${w}:${h}`
      if (key !== last) { last = key; on.resize(id, w, h) }
    }
    track(e, handle, (x, y) => { cx = x; cy = y; apply() }, () => {
      el.classList.remove('db-resizing')
      on.resizeEnd(id)
    }, () => cy, apply)
  }

  function onPointerDown(e: PointerEvent) {
    if (finish || (e.pointerType === 'mouse' && e.button !== 0)) return
    const target = e.target as HTMLElement
    const grip = target.closest<HTMLElement>('[data-block-grip]')
    const rs = grip ? null : target.closest<HTMLElement>('[data-block-resize]')
    const handle = grip ?? rs
    const g = grid()
    if (!handle || !g) return
    const el = handle.closest<HTMLElement>('[data-block]')
    const id = el?.dataset.blockId
    if (!el || !id) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    if (rs) startResize(e, handle, g, el, id, rs.dataset.blockResize ?? 'xy')
    else if (on.mode() === 'grid') startFloat(e, handle, g, el, id)
    else {
      const list = blocksOf(g)
      if (list.length > 1) startList(e, handle, g, list, list.indexOf(el))
    }
  }

  onBeforeUnmount(() => finish?.(false))
  return { onPointerDown, floating }
}
