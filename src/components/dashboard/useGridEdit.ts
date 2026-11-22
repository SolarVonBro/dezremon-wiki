// Moving and resizing overview blocks with the mouse or a finger (pointer events, so it works on phones).
// Blocks are the grid's children with `data-block`; the grip carries `data-block-grip`, resize handles carry
// `data-block-resize="x" | "y" | "xy"`. Put @pointerdown="onPointerDown" on the grid.
//
// Moving: the block follows the pointer, the block under it shows where it will land (before/after it);
// on release `move(from, to)` is called with splice-style indexes.
// Resizing: the width snaps to twelfths of the grid, the height to H_STEP px; `resize` is called live.
import { onBeforeUnmount } from 'vue'
import { H_STEP, MAX_H, MIN_H, MIN_W } from './blocks'

export interface GridEditHandlers {
  move: (from: number, to: number) => void
  resize: (index: number, w: number | null, h: number | null) => void
  resizeEnd: (index: number) => void
}

type Rect = { l: number; t: number; r: number; b: number }

export function useGridEdit(grid: () => HTMLElement | null, on: GridEditHandlers) {
  let finish: ((commit: boolean) => void) | null = null

  const blocksOf = (g: HTMLElement) => [...g.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-block'))

  /** Keeps scrolling the page while the pointer rests near the top/bottom edge of the window. */
  function edgeScroll(getY: () => number, after: () => void) {
    return setInterval(() => {
      const y = getY(), edge = 70
      const v = y < edge ? -Math.ceil((edge - y) / 5) : y > window.innerHeight - edge ? Math.ceil((y - window.innerHeight + edge) / 5) : 0
      if (v) { window.scrollBy(0, v); after() }
    }, 16)
  }

  function startMove(e: PointerEvent, handle: HTMLElement, g: HTMLElement, list: HTMLElement[], from: number) {
    const el = list[from]
    const rects: Rect[] = list.map((x) => { const r = x.getBoundingClientRect(); return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY } })
    const gridW = g.getBoundingClientRect().width
    const sx = e.clientX + scrollX, sy = e.clientY + scrollY
    let cx = e.clientX, cy = e.clientY, to = from
    let mark: HTMLElement | null = null, markCls = ''
    const setMark = (m: HTMLElement | null, cls: string) => {
      if (m === mark && cls === markCls) return
      mark?.classList.remove(markCls)
      mark = m; markCls = cls
      mark?.classList.add(cls)
    }
    el.classList.add('db-dragging')
    g.classList.add('db-moving')

    function update() {
      const px = cx + scrollX, py = cy + scrollY
      el.style.transform = `translate(${px - sx}px, ${py - sy}px)`
      // the block under the pointer (by the positions before the drag), else the nearest one
      let best = -1, bestD = Infinity
      rects.forEach((r, i) => {
        const dx = px < r.l ? r.l - px : px > r.r ? px - r.r : 0
        const dy = py < r.t ? r.t - py : py > r.b ? py - r.b : 0
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = i }
      })
      if (best < 0 || best === from) { to = from; setMark(null, ''); return }
      const r = rects[best]
      // wide blocks (a row of their own) split top/bottom, narrow ones left/right
      const wide = r.r - r.l > gridW * 0.6
      const after = wide ? py > (r.t + r.b) / 2 : px > (r.l + r.r) / 2
      let p = best + (after ? 1 : 0)
      if (from < p) p--
      to = p
      if (to === from) setMark(null, '')
      else setMark(list[best], wide ? (after ? 'db-drop-below' : 'db-drop-above') : (after ? 'db-drop-right' : 'db-drop-left'))
    }
    const scroll = edgeScroll(() => cy, update)
    const onMove = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; ev.preventDefault(); cx = ev.clientX; cy = ev.clientY; update() }
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
      setMark(null, '')
      el.style.transform = ''
      el.classList.remove('db-dragging')
      g.classList.remove('db-moving')
      if (commit && to !== from) on.move(from, to)
    }
  }

  function startResize(e: PointerEvent, handle: HTMLElement, g: HTMLElement, el: HTMLElement, index: number, axis: string) {
    const cs = getComputedStyle(g)
    const gap = parseFloat(cs.columnGap) || 0
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 12
    const col = (g.clientWidth - (cols - 1) * gap) / cols
    const r0 = el.getBoundingClientRect()
    const sx = e.clientX, sy = e.clientY
    let cy = e.clientY, last = ''
    let dy0 = 0
    el.classList.add('db-resizing')
    const apply = (clientX: number, clientY: number) => {
      const w = axis.includes('x') && cols === 12 ? Math.min(12, Math.max(MIN_W, Math.round((r0.width + clientX - sx + gap) / (col + gap)))) : null
      const h = axis.includes('y') ? Math.min(MAX_H, Math.max(MIN_H, Math.round((r0.height + clientY - sy + dy0) / H_STEP) * H_STEP)) : null
      const key = `${w}:${h}`
      if (key !== last) { last = key; on.resize(index, w, h) }
    }
    let lx = e.clientX
    const startScroll = scrollY
    // when the page scrolls under a stretching block, the height follows
    const scroll = edgeScroll(() => cy, () => { dy0 = scrollY - startScroll; apply(lx, cy) })
    const onMove = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; ev.preventDefault(); lx = ev.clientX; cy = ev.clientY; dy0 = scrollY - startScroll; apply(ev.clientX, ev.clientY) }
    const onUp = () => finish?.(true)
    const onCancel = () => finish?.(true)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onCancel)
    finish = () => {
      finish = null
      clearInterval(scroll)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onCancel)
      try { handle.releasePointerCapture(e.pointerId) } catch { /* already released */ }
      el.classList.remove('db-resizing')
      on.resizeEnd(index)
    }
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
    const list = blocksOf(g)
    const index = el ? list.indexOf(el) : -1
    if (!el || index < 0) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    if (grip) startMove(e, handle, g, list, index)
    else startResize(e, handle, g, el, index, rs!.dataset.blockResize ?? 'xy')
  }

  onBeforeUnmount(() => finish?.(false))
  return { onPointerDown }
}
