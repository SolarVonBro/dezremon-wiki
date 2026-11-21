// Minimal pan & zoom controller for a viewport element (mouse drag, wheel, pinch, buttons).
// Used by the family tree (CSS transform on a div) and the relations graph (SVG <g> transform).
import { onBeforeUnmount, reactive, watch, type Ref } from 'vue'

export interface View { x: number; y: number; k: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface PanZoomOptions {
  minK?: number
  maxK?: number
  /** Return false to let the element handle the pointer itself (e.g. node dragging). */
  canPan?: (e: PointerEvent) => boolean
  /** Called on every view change (for imperative renderers). */
  onChange?: (v: View) => void
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [contenteditable], .no-pan, .dd-trigger'

export function usePanZoom(el: Ref<HTMLElement | SVGElement | null>, opts: PanZoomOptions = {}) {
  const minK = opts.minK ?? 0.15
  const maxK = opts.maxK ?? 3
  const view = reactive<View>({ x: 0, y: 0, k: 1 })
  const clampK = (k: number) => Math.min(maxK, Math.max(minK, k))

  let dragged = false
  const pointers = new Map<number, { x: number; y: number }>()
  let start: { x: number; y: number; vx: number; vy: number } | null = null
  let pinch: { dist: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null

  const changed = () => opts.onChange?.(view)

  function rect() { return (el.value as Element | null)?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0) }

  /** Zoom by factor around a point given in viewport coordinates (default: centre). */
  function zoomBy(f: number, cx?: number, cy?: number) {
    const r = rect()
    const px = cx ?? r.width / 2
    const py = cy ?? r.height / 2
    const k = clampK(view.k * f)
    const ratio = k / view.k
    view.x = px - (px - view.x) * ratio
    view.y = py - (py - view.y) * ratio
    view.k = k
    changed()
  }

  function setView(v: Partial<View>) {
    if (v.k !== undefined) view.k = clampK(v.k)
    if (v.x !== undefined) view.x = v.x
    if (v.y !== undefined) view.y = v.y
    changed()
  }

  /** Put world point (wx, wy) at the viewport centre. */
  function centerOn(wx: number, wy: number, k = view.k) {
    const r = rect()
    const kk = clampK(k)
    setView({ k: kk, x: r.width / 2 - wx * kk, y: r.height / 2 - wy * kk })
  }

  /** Fit bounds into the viewport. Returns the scale that would have been needed (before clamping to [minFit, maxFit]). */
  function fit(b: Bounds, pad = 40, maxFit = 1, minFit = minK) {
    const r = rect()
    const w = Math.max(1, b.maxX - b.minX)
    const h = Math.max(1, b.maxY - b.minY)
    if (!r.width || !r.height) return 1
    const need = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)
    const k = clampK(Math.min(maxFit, Math.max(minFit, need)))
    setView({ k, x: r.width / 2 - ((b.minX + b.maxX) / 2) * k, y: r.height / 2 - ((b.minY + b.maxY) / 2) * k })
    return need
  }

  /** Viewport (client) → world coordinates. */
  function toWorld(clientX: number, clientY: number) {
    const r = rect()
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k }
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const t = e.target as Element | null
    if (t?.closest?.(INTERACTIVE)) return
    if (opts.canPan && !opts.canPan(e)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    dragged = false
    if (pointers.size === 1) {
      start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const r = rect()
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: view.k, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, vx: view.x, vy: view.y }
      start = null
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      const k = clampK(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist))
      const ratio = k / pinch.k
      view.x = pinch.cx - (pinch.cx - pinch.vx) * ratio
      view.y = pinch.cy - (pinch.cy - pinch.vy) * ratio
      view.k = k
      dragged = true
      changed()
      return
    }
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!dragged && Math.hypot(dx, dy) < 4) return
    dragged = true
    view.x = start.vx + dx
    view.y = start.vy + dy
    changed()
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    if (pointers.size === 1) {
      const [p] = [...pointers.values()]
      start = { x: p.x, y: p.y, vx: view.x, vy: view.y }
    }
    if (!pointers.size) {
      start = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }

  function onWheel(e: WheelEvent) {
    // Plain wheel scrolls the page; Ctrl/⌘ + wheel (or a trackpad pinch, which sets ctrlKey) zooms.
    // In fullscreen there is no page to scroll, so the wheel always zooms.
    const fs = !!document.fullscreenElement && !!bound && document.fullscreenElement.contains(bound)
    if (!e.ctrlKey && !e.metaKey && !fs) return
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const f = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018))
    const r = rect()
    zoomBy(f, e.clientX - r.left, e.clientY - r.top)
  }

  let bound: Element | null = null
  function bind(node: Element | null) {
    if (bound === node) return
    if (bound) {
      bound.removeEventListener('pointerdown', onPointerDown as EventListener)
      bound.removeEventListener('wheel', onWheel as EventListener)
    }
    bound = node
    if (node) {
      node.addEventListener('pointerdown', onPointerDown as EventListener)
      node.addEventListener('wheel', onWheel as EventListener, { passive: false })
    }
  }
  watch(el, (node) => bind(node as Element | null), { immediate: true })
  onBeforeUnmount(() => {
    bind(null)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  })

  return {
    view,
    zoomBy,
    setView,
    centerOn,
    fit,
    toWorld,
    /** true if the last gesture moved the view (use to ignore the click that ends a drag). */
    wasDragged: () => dragged,
  }
}
