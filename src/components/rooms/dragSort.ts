// Drag-and-drop reordering of a vertical list with the mouse and on touch screens (pointer events; HTML5 drag and
// drop does not work on phones). Rows carry `data-sort-row`, the grip carries `data-drag-handle`; put
// @pointerdown="onPointerDown" on the list. While dragging, the row follows the pointer and the rows it passes
// slide out of the way; on release onDrop(from, to) is called with splice-style indexes.
import { onBeforeUnmount } from 'vue'

interface DragState {
  rows: HTMLElement[]
  from: number
  to: number
  startPageY: number
  clientY: number
  mids: number[]
  step: number
  handle: HTMLElement
  pointerId: number
  scroll: ReturnType<typeof setInterval>
}

export function useDragSort(onDrop: (from: number, to: number) => void) {
  let st: DragState | null = null

  function update() {
    if (!st) return
    const dy = st.clientY + window.scrollY - st.startPageY
    st.rows[st.from].style.transform = `translateY(${dy}px)`
    const center = st.mids[st.from] + dy
    let to = st.from
    while (to < st.rows.length - 1 && center > st.mids[to + 1]) to++
    while (to > 0 && center < st.mids[to - 1]) to--
    st.to = to
    st.rows.forEach((r, i) => {
      if (i === st!.from) return
      const shift = st!.from < to && i > st!.from && i <= to ? -st!.step : st!.from > to && i >= to && i < st!.from ? st!.step : 0
      r.style.transform = shift ? `translateY(${shift}px)` : ''
    })
  }
  function onMove(e: PointerEvent) {
    if (!st || e.pointerId !== st.pointerId) return
    e.preventDefault()
    st.clientY = e.clientY
    update()
  }
  function finish(commit: boolean) {
    if (!st) return
    const s = st
    st = null
    clearInterval(s.scroll)
    s.handle.removeEventListener('pointermove', onMove)
    s.handle.removeEventListener('pointerup', onUp)
    s.handle.removeEventListener('pointercancel', onCancel)
    try { s.handle.releasePointerCapture(s.pointerId) } catch { /* already released */ }
    s.rows.forEach((r) => { r.style.transform = ''; r.classList.remove('sort-dragging', 'sort-moving') })
    if (commit && s.to !== s.from) onDrop(s.from, s.to)
  }
  const onUp = () => finish(true)
  const onCancel = () => finish(false)

  function onPointerDown(e: PointerEvent) {
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-drag-handle]')
    if (!handle || (e.pointerType === 'mouse' && e.button !== 0) || st) return
    const row = handle.closest<HTMLElement>('[data-sort-row]')
    const list = row?.parentElement
    if (!row || !list) return
    const rows = [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-sort-row'))
    const from = rows.indexOf(row)
    if (from < 0 || rows.length < 2) return
    e.preventDefault()
    const rects = rows.map((r) => r.getBoundingClientRect())
    const gap = rects.length > 1 ? Math.max(0, (from < rects.length - 1 ? rects[from + 1].top - rects[from].bottom : rects[from].top - rects[from - 1].bottom)) : 0
    handle.setPointerCapture(e.pointerId)
    st = {
      rows, from, to: from, startPageY: e.clientY + window.scrollY, clientY: e.clientY,
      mids: rects.map((r) => r.top + window.scrollY + r.height / 2), step: rects[from].height + gap, handle, pointerId: e.pointerId,
      // keep scrolling the page while the pointer rests near the top/bottom edge
      scroll: setInterval(() => {
        if (!st) return
        const edge = 70
        const v = st.clientY < edge ? -Math.ceil((edge - st.clientY) / 5) : st.clientY > window.innerHeight - edge ? Math.ceil((st.clientY - window.innerHeight + edge) / 5) : 0
        if (v) { window.scrollBy(0, v); update() }
      }, 16),
    }
    row.classList.add('sort-dragging')
    rows.forEach((r, i) => { if (i !== from) r.classList.add('sort-moving') })
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onCancel)
  }

  onBeforeUnmount(() => finish(false))
  return { onPointerDown }
}
