// Imperative SVG renderer for the relations graph. Elements are created once per data change and only their
// attributes are updated on simulation ticks (no Vue reactivity in the hot path).
import type { GLink, GNode } from './graphData'

const NS = 'http://www.w3.org/2000/svg'

interface NodeEls { g: SVGGElement; bg: SVGCircleElement; initial: SVGTextElement; ring: SVGCircleElement; label: SVGTextElement; img: SVGImageElement | null }
interface LinkEls { path: SVGPathElement; label: SVGTextElement | null }

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  if (cls) e.setAttribute('class', cls)
  return e
}

const f1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)

export class GraphRenderer {
  private linkLayer: SVGGElement
  private labelLayer: SVGGElement
  private nodeLayer: SVGGElement
  private nodeEls = new Map<string, NodeEls>()
  private linkEls = new Map<string, LinkEls>()
  private nodes: GNode[] = []
  private links: GLink[] = []
  private images = new Map<string, string>()
  /** id → neighbour ids / incident link ids */
  private adj = new Map<string, { nodes: Set<string>; links: Set<string> }>()

  constructor(private root: SVGGElement, private svg: SVGSVGElement, private clipId: string) {
    this.linkLayer = el('g', {}, 'rg-links')
    this.labelLayer = el('g', {}, 'rg-link-labels')
    this.nodeLayer = el('g', {}, 'rg-nodes')
    root.append(this.linkLayer, this.labelLayer, this.nodeLayer)
  }

  setData(nodes: GNode[], links: GLink[]) {
    this.nodes = nodes
    this.links = links
    // nodes
    const keepN = new Set(nodes.map((n) => n.id))
    for (const [id, e] of this.nodeEls) if (!keepN.has(id)) { e.g.remove(); this.nodeEls.delete(id) }
    for (const n of nodes) {
      let e = this.nodeEls.get(n.id)
      if (!e) {
        const g = el('g', { 'data-id': n.id }, 'rg-node')
        const bg = el('circle', {}, 'rg-node-bg')
        const initial = el('text', { 'text-anchor': 'middle', dy: '.35em' }, 'rg-node-initial')
        const ring = el('circle', {}, 'rg-node-ring')
        const label = el('text', { 'text-anchor': 'middle' }, 'rg-node-label')
        g.append(bg, initial, ring, label)
        e = { g, bg, initial, ring, label, img: null }
        this.nodeEls.set(n.id, e)
      }
      e.g.classList.toggle('center', n.isCenter)
      e.bg.setAttribute('r', String(n.r))
      e.bg.style.fill = n.color
      e.ring.setAttribute('r', String(n.r))
      e.ring.style.stroke = n.color
      e.initial.textContent = n.initial
      e.initial.setAttribute('font-size', String(Math.round(n.r * 0.95)))
      e.label.textContent = n.name
      e.label.setAttribute('y', String(n.r + 13))
      const url = n.imageId ? this.images.get(n.id) : undefined
      if (url) this.applyImage(n, e, url)
      else if (e.img) { e.img.remove(); e.img = null; e.g.classList.remove('has-img') }
      this.nodeLayer.append(e.g) // keeps DOM order = data order
    }
    // links
    const keepL = new Set(links.map((l) => l.id))
    for (const [id, e] of this.linkEls) if (!keepL.has(id)) { e.path.remove(); e.label?.remove(); this.linkEls.delete(id) }
    for (const l of links) {
      let e = this.linkEls.get(l.id)
      if (!e) {
        e = { path: el('path', { 'data-id': l.id }, 'rg-link'), label: null }
        this.linkLayer.append(e.path)
        this.linkEls.set(l.id, e)
      }
      e.path.style.stroke = l.color
      e.path.style.strokeWidth = String(l.width)
      e.path.style.strokeDasharray = l.dash
      e.path.classList.toggle('directed', l.directed)
      if (l.label) {
        if (!e.label) { e.label = el('text', { 'text-anchor': 'middle', dy: '.35em' }, 'rg-link-label'); this.labelLayer.append(e.label) }
        e.label.textContent = l.label
      } else if (e.label) { e.label.remove(); e.label = null }
    }
    // adjacency for hover highlighting
    this.adj = new Map(nodes.map((n) => [n.id, { nodes: new Set([n.id]), links: new Set<string>() }]))
    for (const l of links) {
      const a = this.adj.get(l.sourceId), b = this.adj.get(l.targetId)
      a?.nodes.add(l.targetId); a?.links.add(l.id)
      b?.nodes.add(l.sourceId); b?.links.add(l.id)
    }
    this.tick()
  }

  setImage(id: string, url: string) {
    this.images.set(id, url)
    const n = this.nodes.find((x) => x.id === id)
    const e = this.nodeEls.get(id)
    if (n && e) this.applyImage(n, e, url)
  }

  private applyImage(n: GNode, e: NodeEls, url: string) {
    if (!e.img) {
      e.img = el('image', { preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${this.clipId})` }, 'rg-node-img')
      e.g.insertBefore(e.img, e.ring)
    }
    e.img.setAttribute('href', url)
    e.img.setAttribute('x', String(-n.r))
    e.img.setAttribute('y', String(-n.r))
    e.img.setAttribute('width', String(n.r * 2))
    e.img.setAttribute('height', String(n.r * 2))
    e.g.classList.add('has-img')
  }

  tick() {
    for (const n of this.nodes) {
      const e = this.nodeEls.get(n.id)
      if (e) e.g.setAttribute('transform', `translate(${f1(n.x ?? 0)},${f1(n.y ?? 0)})`)
    }
    for (const l of this.links) {
      const e = this.linkEls.get(l.id)
      const s = l.source as GNode, t = l.target as GNode
      if (!e || typeof s !== 'object' || typeof t !== 'object') continue
      const geo = linkGeometry(s, t, l)
      e.path.setAttribute('d', geo.d)
      if (e.label) { e.label.setAttribute('x', String(f1(geo.mx))); e.label.setAttribute('y', String(f1(geo.my))) }
    }
  }

  /** Highlight a node with its neighbours (null = clear). */
  highlight(id: string | null) {
    const hit = id ? this.adj.get(id) : null
    this.svg.classList.toggle('has-hl', !!hit)
    for (const [nid, e] of this.nodeEls) e.g.classList.toggle('hl', !!hit?.nodes.has(nid))
    for (const [lid, e] of this.linkEls) {
      const on = !!hit?.links.has(lid)
      e.path.classList.toggle('hl', on)
      e.label?.classList.toggle('hl', on)
    }
  }

  setSelected(id: string | null) {
    for (const [nid, e] of this.nodeEls) e.g.classList.toggle('selected', nid === id)
  }

  setPinned(id: string, pinned: boolean) {
    this.nodeEls.get(id)?.g.classList.toggle('pinned', pinned)
  }

  setMatches(ids: Set<string> | null) {
    this.svg.classList.toggle('searching', !!ids)
    for (const [nid, e] of this.nodeEls) e.g.classList.toggle('match', !!ids?.has(nid))
  }

  neighbours(id: string): Set<string> {
    return this.adj.get(id)?.nodes ?? new Set([id])
  }

  destroy() {
    this.linkLayer.remove()
    this.labelLayer.remove()
    this.nodeLayer.remove()
    this.nodeEls.clear()
    this.linkEls.clear()
  }
}

/** Path for a link: straight or curved (parallel edges), trimmed to the node circles, with an arrow head if directed. */
export function linkGeometry(s: GNode, t: GNode, l: GLink): { d: string; mx: number; my: number } {
  const sx = s.x ?? 0, sy = s.y ?? 0, tx = t.x ?? 0, ty = t.y ?? 0
  const dx = tx - sx, dy = ty - sy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const ARROW = 8
  const tailGap = 2
  const headGap = l.directed ? 3 : 2
  if (!l.curve) {
    const x1 = sx + ux * (s.r + tailGap), y1 = sy + uy * (s.r + tailGap)
    const x2 = tx - ux * (t.r + headGap), y2 = ty - uy * (t.r + headGap)
    let d = `M${f1(x1)},${f1(y1)}L${f1(x2)},${f1(y2)}`
    if (l.directed && len > s.r + t.r + ARROW) d += arrow(x2, y2, ux, uy, ARROW)
    return { d, mx: (sx + tx) / 2, my: (sy + ty) / 2 }
  }
  // canonical normal so that A→B and B→A edges bend to opposite sides consistently
  const flip = s.id < t.id ? 1 : -1
  const nx = -uy * flip, ny = ux * flip
  const off = l.curve * Math.min(46, 18 + len * 0.12)
  const mx = (sx + tx) / 2 + nx * off, my = (sy + ty) / 2 + ny * off
  const cx = (sx + tx) / 2 + nx * off * 2, cy = (sy + ty) / 2 + ny * off * 2
  const a1 = Math.hypot(cx - sx, cy - sy) || 1
  const a2 = Math.hypot(tx - cx, ty - cy) || 1
  const sux = (cx - sx) / a1, suy = (cy - sy) / a1
  const eux = (tx - cx) / a2, euy = (ty - cy) / a2
  const x1 = sx + sux * (s.r + tailGap), y1 = sy + suy * (s.r + tailGap)
  const x2 = tx - eux * (t.r + headGap), y2 = ty - euy * (t.r + headGap)
  let d = `M${f1(x1)},${f1(y1)}Q${f1(cx)},${f1(cy)} ${f1(x2)},${f1(y2)}`
  if (l.directed && len > s.r + t.r + ARROW) d += arrow(x2, y2, eux, euy, ARROW)
  return { d, mx, my }
}

function arrow(x: number, y: number, ux: number, uy: number, size: number): string {
  const bx = x - ux * size, by = y - uy * size
  const px = -uy * size * 0.55, py = ux * size * 0.55
  return `M${f1(bx + px)},${f1(by + py)}L${f1(x)},${f1(y)}L${f1(bx - px)},${f1(by - py)}`
}
