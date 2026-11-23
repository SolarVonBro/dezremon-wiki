import { escapeHtml } from '@/data/util'

/**
 * Full-screen image viewer with keyboard navigation and zoom. The picture is fitted to the screen (small ones are
 * scaled up too); the wheel, a pinch or a click zooms in around the pointer (up to 8×), dragging moves the zoomed
 * picture, a click on a zoomed picture fits it back. A click outside the picture or Escape closes the viewer.
 */
export function openLightbox(items: Array<{ src: string; caption?: string }>, start = 0) {
  if (!items.length) return
  let i = Math.max(0, start)
  const el = document.createElement('div')
  el.className = 'lightbox'
  let img: HTMLImageElement | null = null
  let s = 1, tx = 0, ty = 0
  const apply = () => {
    if (!img) return
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
    img.classList.toggle('zoomed', s > 1.001)
  }
  const reset = () => { s = 1; tx = 0; ty = 0; apply() }
  // keeps the image point under (cx, cy) in place while the scale changes
  const zoomAt = (cx: number, cy: number, next: number) => {
    if (!img) return
    const ns = Math.min(8, Math.max(1, next))
    const r = img.getBoundingClientRect()
    const lx = (cx - r.left) / s, ly = (cy - r.top) / s
    tx += lx * (s - ns); ty += ly * (s - ns); s = ns
    if (s <= 1.001) { s = 1; tx = 0; ty = 0 }
    apply()
  }
  const fit = () => {
    if (!img || !img.naturalWidth) return
    const k = Math.min((window.innerWidth * 0.94) / img.naturalWidth, (window.innerHeight * 0.86) / img.naturalHeight)
    img.style.width = `${Math.round(img.naturalWidth * k)}px`
    img.style.height = `${Math.round(img.naturalHeight * k)}px`
  }

  const draw = () => {
    const it = items[i]
    el.innerHTML = `
      <button class="lb-close" aria-label="Закрыть">×</button>
      ${items.length > 1 ? '<button class="lb-prev" aria-label="Назад">‹</button><button class="lb-next" aria-label="Вперёд">›</button>' : ''}
      <figure><img src="${it.src}" alt="" draggable="false"><figcaption>${escapeHtml(it.caption ?? '')}${items.length > 1 ? ` <span>${i + 1} / ${items.length}</span>` : ''}<span class="lb-hint">колесо или щелчок — приблизить</span></figcaption></figure>`
    img = el.querySelector('img')
    s = 1; tx = 0; ty = 0
    if (img) {
      img.addEventListener('load', fit)
      if (img.complete) fit()
    }
  }
  const close = () => { el.remove(); document.removeEventListener('keydown', key); window.removeEventListener('resize', fit) }
  const go = (d: number) => { i = (i + d + items.length) % items.length; draw() }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowRight') go(1)
    if (e.key === 'ArrowLeft') go(-1)
    if (e.key === '+' || e.key === '=') zoomAt(window.innerWidth / 2, window.innerHeight / 2, s * 1.5)
    if (e.key === '-') zoomAt(window.innerWidth / 2, window.innerHeight / 2, s / 1.5)
    if (e.key === '0') reset()
  }

  // pointers: drag to move, pinch to zoom, a click (no movement) to zoom in / fit back
  const pts = new Map<number, { x: number; y: number }>()
  let moved = false, pinch = 0, suppressClick = false
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== img) return
    e.preventDefault()
    img!.setPointerCapture(e.pointerId)
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved = false
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y) }
  })
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, s * (d / pinch))
      pinch = d
    } else if (s > 1) { tx += dx; ty += dy; apply() }
  })
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return
    const wasPinch = pts.size === 2
    pts.delete(e.pointerId)
    if (pts.size < 2) pinch = 0
    if (wasPinch || moved) { suppressClick = true; return }
    if (s > 1) reset(); else zoomAt(e.clientX, e.clientY, 2.5)
    suppressClick = true
  }
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = 0 })
  el.addEventListener('wheel', (e) => {
    if (!img) return
    e.preventDefault()
    zoomAt(e.clientX, e.clientY, s * Math.exp(-e.deltaY * 0.0022))
  }, { passive: false })

  el.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return }
    const t = e.target as HTMLElement
    if (t.classList.contains('lb-prev')) go(-1)
    else if (t.classList.contains('lb-next')) go(1)
    else if (t.tagName !== 'IMG') close()
  })
  document.addEventListener('keydown', key)
  window.addEventListener('resize', fit)
  draw()
  document.body.append(el)
}
