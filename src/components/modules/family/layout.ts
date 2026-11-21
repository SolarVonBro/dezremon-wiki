// Layered ("generational") layout for family trees. Pure TS, no dependencies.
//
// 1. parent edges that close a cycle are dropped;
// 2. generations: child below every parent, spouses / explicit siblings on the same row, childless roots pulled
//    down next to their children; generation numbers are compressed;
// 3. each connected component is laid out separately: rows are split into rigid "blocks" (spouse groups),
//    ordered with barycenter sweeps, then x is refined by alternating down / up passes that place blocks as
//    close as possible to the mean of their parents / children (exact 1-D quadratic placement with min gaps);
// 4. components are put side by side; connector paths (marriage lines, child buses, sibling arcs) are generated.

export interface LayoutInput {
  /** Node ids in priority order (earlier = more to the left when nothing else decides). */
  ids: string[]
  parentEdges: Array<[parent: string, child: string]>
  spousePairs: Array<[string, string]>
  siblingPairs: Array<[string, string]>
}

export interface LayoutOptions {
  nodeW: number
  nodeH: number
  /** Horizontal gap between spouses. */
  spouseGap: number
  /** Gap between siblings (same parents). */
  siblingGap: number
  /** Gap between unrelated neighbours. */
  hGap: number
  /** Vertical gap between generations. */
  vGap: number
  /** Gap between connected components. */
  componentGap: number
}

export const DEFAULT_LAYOUT: LayoutOptions = { nodeW: 184, nodeH: 64, spouseGap: 30, siblingGap: 26, hGap: 52, vGap: 74, componentGap: 110 }

export interface NodePos { id: string; x: number; y: number; gen: number }

export interface Connector {
  kind: 'spouse' | 'child' | 'sibling'
  /** People this connector touches (for highlighting). */
  ids: string[]
  d: string
  /** For spouse lines: true when partners stand next to each other (solid line). */
  adjacent?: boolean
  /** Small marker (marriage ring) position. */
  mark?: { x: number; y: number }
}

export interface LayoutResult {
  /** x = centre of the card, y = top of the card. */
  nodes: Map<string, NodePos>
  connectors: Connector[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** Parent edges ignored because they formed a cycle. */
  droppedEdges: Array<[string, string]>
}

interface Block { members: number[]; offsets: number[]; width: number }

export function layoutFamily(input: LayoutInput, opt: LayoutOptions = DEFAULT_LAYOUT): LayoutResult {
  const ids = [...new Set(input.ids)]
  const n = ids.length
  const index = new Map(ids.map((id, i) => [id, i]))
  const parentsOf: number[][] = ids.map(() => [])
  const childrenOf: number[][] = ids.map(() => [])
  const spousesOf: number[][] = ids.map(() => [])
  const siblingsOf: number[][] = ids.map(() => [])

  const pushUnique = (arr: number[], v: number) => { if (!arr.includes(v)) arr.push(v) }
  for (const [p, c] of input.parentEdges) {
    const pi = index.get(p), ci = index.get(c)
    if (pi === undefined || ci === undefined || pi === ci) continue
    pushUnique(childrenOf[pi], ci)
    pushUnique(parentsOf[ci], pi)
  }
  for (const [a, b] of input.spousePairs) {
    const ai = index.get(a), bi = index.get(b)
    if (ai === undefined || bi === undefined || ai === bi) continue
    pushUnique(spousesOf[ai], bi)
    pushUnique(spousesOf[bi], ai)
  }
  for (const [a, b] of input.siblingPairs) {
    const ai = index.get(a), bi = index.get(b)
    if (ai === undefined || bi === undefined || ai === bi) continue
    pushUnique(siblingsOf[ai], bi)
    pushUnique(siblingsOf[bi], ai)
  }

  // ---------- 1. break cycles in parent edges (iterative DFS) ----------
  const dropped: Array<[string, string]> = []
  {
    const state = new Uint8Array(n) // 0 new, 1 on stack, 2 done
    for (let s = 0; s < n; s++) {
      if (state[s]) continue
      const stack: Array<[number, number]> = [[s, 0]]
      state[s] = 1
      while (stack.length) {
        const top = stack[stack.length - 1]
        const [v, k] = top
        if (k < childrenOf[v].length) {
          top[1]++
          const c = childrenOf[v][k]
          if (state[c] === 1) {
            // back edge v → c: drop it
            childrenOf[v].splice(k, 1)
            top[1]--
            parentsOf[c] = parentsOf[c].filter((x) => x !== v)
            dropped.push([ids[v], ids[c]])
          } else if (state[c] === 0) {
            state[c] = 1
            stack.push([c, 0])
          }
        } else {
          state[v] = 2
          stack.pop()
        }
      }
    }
  }

  // ---------- 2. generations ----------
  const gen = new Array<number>(n).fill(0)
  const sameRow: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    for (const j of spousesOf[i]) if (i < j) sameRow.push([i, j])
    for (const j of siblingsOf[i]) if (i < j) sameRow.push([i, j])
  }
  const relax = () => {
    for (let iter = 0; iter < n + 5; iter++) {
      let changed = false
      for (let p = 0; p < n; p++) for (const c of childrenOf[p]) if (gen[c] < gen[p] + 1) { gen[c] = gen[p] + 1; changed = true }
      for (const [a, b] of sameRow) if (gen[a] !== gen[b]) { const m = Math.max(gen[a], gen[b]); gen[a] = gen[b] = m; changed = true }
      if (!changed) break
    }
  }
  relax()
  for (let round = 0; round < 4; round++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      if (parentsOf[i].length || !childrenOf[i].length) continue
      const target = Math.min(...childrenOf[i].map((c) => gen[c])) - 1
      if (target > gen[i]) { gen[i] = target; moved = true }
    }
    if (!moved) break
    relax()
  }

  // ---------- 3. components ----------
  const comp = new Array<number>(n).fill(-1)
  const components: number[][] = []
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue
    const cid = components.length
    const list: number[] = []
    const stack = [s]
    comp[s] = cid
    while (stack.length) {
      const v = stack.pop()!
      list.push(v)
      for (const w of [...parentsOf[v], ...childrenOf[v], ...spousesOf[v], ...siblingsOf[v]]) {
        if (comp[w] < 0) { comp[w] = cid; stack.push(w) }
      }
    }
    list.sort((a, b) => a - b)
    components.push(list)
  }
  // biggest components first, isolated people last
  components.sort((a, b) => b.length - a.length || a[0] - b[0])

  const x = new Array<number>(n).fill(0)
  const rowY = (g: number) => g * (opt.nodeH + opt.vGap)
  let cursor = 0
  const orderIndex = new Array<number>(n).fill(0)

  for (const members of components) {
    // compress generations inside the component
    const gens = [...new Set(members.map((i) => gen[i]))].sort((a, b) => a - b)
    const gmap = new Map(gens.map((g, k) => [g, k]))
    for (const i of members) gen[i] = gmap.get(gen[i])!
    layoutComponent(members)
    let minX = Infinity, maxX = -Infinity
    for (const i of members) { minX = Math.min(minX, x[i] - opt.nodeW / 2); maxX = Math.max(maxX, x[i] + opt.nodeW / 2) }
    const shift = cursor - minX
    for (const i of members) x[i] += shift
    cursor += maxX - minX + opt.componentGap
  }

  function layoutComponent(members: number[]) {
    const maxG = Math.max(...members.map((i) => gen[i]))
    const rows: number[][] = Array.from({ length: maxG + 1 }, () => [])
    for (const i of members) rows[gen[i]].push(i)

    // blocks = spouse groups on the same row
    const rowBlocks: Block[][] = rows.map((row) => {
      const done = new Set<number>()
      const blocks: Block[] = []
      for (const i of row) {
        if (done.has(i)) continue
        // collect spouse-connected members on this row
        const group: number[] = []
        const st = [i]
        done.add(i)
        while (st.length) {
          const v = st.pop()!
          group.push(v)
          for (const s of spousesOf[v]) if (!done.has(s) && gen[s] === gen[i]) { done.add(s); st.push(s) }
        }
        const ordered = orderBlock(group)
        const b: Block = { members: ordered, offsets: [], width: 0 }
        let off = 0
        ordered.forEach((m, k) => { if (k) off += opt.nodeW + opt.spouseGap; b.offsets.push(off) })
        b.width = off
        blocks.push(b)
      }
      return blocks
    })

    const sharesParent = (a: number, b: number) => parentsOf[a].some((p) => parentsOf[b].includes(p))
    const gapBetween = (a: Block, b: Block) => {
      const sib = a.members.some((m) => b.members.some((k) => sharesParent(m, k) || siblingsOf[m].includes(k)))
      return opt.nodeW + (sib ? opt.siblingGap : opt.hGap)
    }

    const blockX = new Map<Block, number>() // x of the first member's centre
    const pack = (g: number) => {
      let cur = 0
      rowBlocks[g].forEach((b, k) => {
        if (k) cur += gapBetween(rowBlocks[g][k - 1], b)
        blockX.set(b, cur)
        cur += b.width
      })
      // centre the row around 0 so rows stay comparable before refinement
      const w = cur
      rowBlocks[g].forEach((b) => blockX.set(b, blockX.get(b)! - w / 2))
      syncX(g)
    }
    const syncX = (g: number) => {
      for (const b of rowBlocks[g]) b.members.forEach((m, k) => { x[m] = blockX.get(b)! + b.offsets[k] })
    }
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length

    for (let g = 0; g <= maxG; g++) pack(g)

    // barycenter ordering sweeps
    const sortRow = (g: number, anchor: (m: number) => number[]) => {
      const keyed = rowBlocks[g].map((b, k) => {
        const vals: number[] = []
        for (const m of b.members) for (const a of anchor(m)) vals.push(x[a])
        const centre = blockX.get(b)! + b.width / 2
        return { b, key: vals.length ? mean(vals) : centre, k }
      })
      keyed.sort((p, q) => p.key - q.key || p.k - q.k)
      rowBlocks[g] = keyed.map((e) => e.b)
      for (const b of rowBlocks[g]) orientBlock(b, anchor)
      pack(g)
    }
    const orientBlock = (b: Block, anchor: (m: number) => number[]) => {
      if (b.members.length !== 2) return
      const [l, r] = b.members
      const al = anchor(l), ar = anchor(r)
      if (!al.length && !ar.length) return
      const centre = blockX.get(b)! + b.width / 2
      const kl = al.length ? mean(al.map((a) => x[a])) : centre
      const kr = ar.length ? mean(ar.map((a) => x[a])) : centre
      if (kl > kr) b.members.reverse()
    }
    const up = (m: number) => parentsOf[m]
    const down = (m: number) => childrenOf[m]
    for (let sweep = 0; sweep < 4; sweep++) {
      for (let g = 1; g <= maxG; g++) sortRow(g, up)
      for (let g = maxG - 1; g >= 0; g--) sortRow(g, down)
    }
    for (let g = 1; g <= maxG; g++) sortRow(g, up)

    // x refinement: rigid blocks, quadratic placement with minimum gaps
    const placeRow = (g: number, anchor: (m: number) => number[]) => {
      const blocks = rowBlocks[g]
      if (!blocks.length) return
      const w: number[] = []
      const s: number[] = []
      for (const b of blocks) {
        let ws = 0, ss = 0
        b.members.forEach((m, k) => {
          const a = anchor(m)
          if (a.length) { ws += 1; ss += mean(a.map((v) => x[v])) - b.offsets[k] }
        })
        if (!ws) { ws = 0.05; ss = 0.05 * blockX.get(b)! }
        w.push(ws); s.push(ss)
      }
      const gaps = blocks.map((b, k) => (k ? gapBetween(blocks[k - 1], b) : 0))
      // clusters on a stack: first block, weight, weighted sum, span from first block x to last block x
      const stack: Array<{ first: number; last: number; w: number; s: number; span: number }> = []
      for (let k = 0; k < blocks.length; k++) {
        let c = { first: k, last: k, w: w[k], s: s[k], span: 0 }
        while (stack.length) {
          const p = stack[stack.length - 1]
          const dist = p.span + blocks[p.last].width + gaps[c.first]
          if (c.s / c.w >= p.s / p.w + dist) break
          stack.pop()
          c = { first: p.first, last: c.last, w: p.w + c.w, s: p.s + c.s - c.w * dist, span: dist + c.span }
        }
        stack.push(c)
      }
      for (const c of stack) {
        let pos = c.s / c.w
        for (let k = c.first; k <= c.last; k++) {
          if (k > c.first) pos += blocks[k - 1].width + gaps[k]
          blockX.set(blocks[k], pos)
        }
      }
      syncX(g)
    }
    for (let it = 0; it < 8; it++) {
      for (let g = 1; g <= maxG; g++) placeRow(g, up)
      for (let g = maxG - 1; g >= 0; g--) placeRow(g, down)
    }

    for (let g = 0; g <= maxG; g++) rowBlocks[g].flatMap((b) => b.members).forEach((m, k) => { orderIndex[m] = k })
  }

  /** Spouse group order: the person with most partners in the middle, partners alternating right / left. */
  function orderBlock(group: number[]): number[] {
    if (group.length === 1) return group
    const set = new Set(group)
    const deg = (v: number) => spousesOf[v].filter((s) => set.has(s)).length
    const hub = [...group].sort((a, b) => deg(b) - deg(a) || a - b)[0]
    const left: number[] = []
    const right: number[] = []
    const placed = new Set([hub])
    let toRight = true
    // BFS: partners of the hub alternate sides, partners of partners go further out on the same side
    const queue: Array<[number, 'l' | 'r' | null]> = [[hub, null]]
    while (queue.length) {
      const [v, side] = queue.shift()!
      for (const s of spousesOf[v]) {
        if (!set.has(s) || placed.has(s)) continue
        placed.add(s)
        const sd = side ?? (toRight ? 'r' : 'l')
        if (!side) toRight = !toRight
        if (sd === 'r') right.push(s); else left.unshift(s)
        queue.push([s, sd])
      }
    }
    for (const v of group) if (!placed.has(v)) right.push(v)
    return [...left, hub, ...right]
  }

  // ---------- result ----------
  const nodes = new Map<string, NodePos>()
  for (let i = 0; i < n; i++) nodes.set(ids[i], { id: ids[i], x: Math.round(x[i]), y: rowY(gen[i]), gen: gen[i] })

  const connectors = buildConnectors()

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of nodes.values()) {
    minX = Math.min(minX, p.x - opt.nodeW / 2); maxX = Math.max(maxX, p.x + opt.nodeW / 2)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + opt.nodeH)
  }
  if (!nodes.size) { minX = minY = 0; maxX = maxY = 0 }
  // room for arcs drawn above the top row
  minY -= 30

  return { nodes, connectors, bounds: { minX, minY, maxX, maxY }, droppedEdges: dropped }

  function buildConnectors(): Connector[] {
    const out: Connector[] = []
    const W = opt.nodeW, H = opt.nodeH
    const pos = (i: number) => ({ x: x[i], y: rowY(gen[i]) })
    const r = (v: number) => Math.round(v * 10) / 10
    const adjacentSpouses = (a: number, b: number) => {
      if (gen[a] !== gen[b] || comp[a] !== comp[b]) return false
      if (Math.abs(orderIndex[a] - orderIndex[b]) !== 1) return false
      return Math.abs(x[a] - x[b]) <= W + opt.spouseGap + 1
    }

    // spouse lines
    for (let a = 0; a < n; a++) for (const b of spousesOf[a]) {
      if (a > b) continue
      const pa = pos(a), pb = pos(b)
      if (adjacentSpouses(a, b)) {
        const [l, rr] = pa.x < pb.x ? [pa, pb] : [pb, pa]
        const y = r(l.y + H / 2)
        out.push({ kind: 'spouse', ids: [ids[a], ids[b]], adjacent: true, d: `M${r(l.x + W / 2)} ${y}H${r(rr.x - W / 2)}`, mark: { x: r((l.x + rr.x) / 2), y } })
      } else if (gen[a] === gen[b]) {
        const top = Math.min(pa.y, pb.y)
        const lift = 22 + Math.min(40, Math.abs(pa.x - pb.x) / 12)
        out.push({ kind: 'spouse', ids: [ids[a], ids[b]], adjacent: false, d: `M${r(pa.x)} ${r(top)}C${r(pa.x)} ${r(top - lift)} ${r(pb.x)} ${r(top - lift)} ${r(pb.x)} ${r(top)}`, mark: { x: r((pa.x + pb.x) / 2), y: r(top - lift * 0.75) } })
      } else {
        const [hi, lo] = pa.y < pb.y ? [pa, pb] : [pb, pa]
        const sx = hi.x + (lo.x >= hi.x ? W / 2 : -W / 2), sy = hi.y + H / 2
        const ex = lo.x + (lo.x >= hi.x ? -W / 2 : W / 2), ey = lo.y + H / 2
        out.push({ kind: 'spouse', ids: [ids[a], ids[b]], adjacent: false, d: `M${r(sx)} ${r(sy)}C${r((sx + ex) / 2)} ${r(sy)} ${r((sx + ex) / 2)} ${r(ey)} ${r(ex)} ${r(ey)}`, mark: { x: r((sx + ex) / 2), y: r((sy + ey) / 2) } })
      }
    }

    // child groups: children sharing the same set of parents
    const groups = new Map<string, { parents: number[]; children: number[] }>()
    for (let c = 0; c < n; c++) {
      if (!parentsOf[c].length) continue
      const ps = [...parentsOf[c]].sort((a, b) => a - b)
      const key = ps.join(',')
      const g = groups.get(key)
      if (g) g.children.push(c); else groups.set(key, { parents: ps, children: [c] })
    }
    // lanes: groups whose buses share a row gap get different heights when their spans overlap
    type G = { parents: number[]; children: number[]; busRow: number; minX: number; maxX: number; lane: number; origins: Array<{ x: number; y: number }> }
    const all: G[] = []
    for (const g of groups.values()) {
      const busRow = Math.min(...g.children.map((c) => gen[c]))
      const origins: Array<{ x: number; y: number }> = []
      if (g.parents.length === 2 && adjacentSpouses(g.parents[0], g.parents[1])) {
        const [a, b] = g.parents
        origins.push({ x: (x[a] + x[b]) / 2, y: rowY(gen[a]) + H / 2 })
      } else {
        for (const p of g.parents) origins.push({ x: x[p], y: rowY(gen[p]) + H })
      }
      const xs = [...origins.map((o) => o.x), ...g.children.map((c) => x[c])]
      all.push({ ...g, busRow, minX: Math.min(...xs), maxX: Math.max(...xs), lane: 0, origins })
    }
    const byRow = new Map<number, G[]>()
    for (const g of all) { const l = byRow.get(g.busRow) ?? []; l.push(g); byRow.set(g.busRow, l) }
    const laneCount = new Map<number, number>()
    for (const [row, list] of byRow) {
      list.sort((a, b) => a.minX - b.minX)
      const laneEnds: number[] = []
      for (const g of list) {
        let lane = laneEnds.findIndex((end) => end < g.minX - 12)
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(g.maxX) } else laneEnds[lane] = g.maxX
        g.lane = lane
      }
      laneCount.set(row, laneEnds.length)
    }
    for (const g of all) {
      const lanes = laneCount.get(g.busRow) ?? 1
      const step = Math.min(10, (opt.vGap - 24) / Math.max(1, lanes))
      const busY = rowY(g.busRow) - opt.vGap / 2 + (g.lane - (lanes - 1) / 2) * step
      let d = ''
      for (const o of g.origins) d += `M${r(o.x)} ${r(o.y)}V${r(busY)}`
      if (g.maxX - g.minX > 0.5) d += `M${r(g.minX)} ${r(busY)}H${r(g.maxX)}`
      for (const c of g.children) d += `M${r(x[c])} ${r(busY)}V${r(rowY(gen[c]))}`
      out.push({ kind: 'child', ids: [...g.parents, ...g.children].map((i) => ids[i]), d })
    }

    // explicit siblings without a common parent in the tree
    for (let a = 0; a < n; a++) for (const b of siblingsOf[a]) {
      if (a > b || parentsOf[a].some((p) => parentsOf[b].includes(p))) continue
      const pa = pos(a), pb = pos(b)
      const top = Math.min(pa.y, pb.y)
      const lift = 16 + Math.min(30, Math.abs(pa.x - pb.x) / 14)
      out.push({ kind: 'sibling', ids: [ids[a], ids[b]], d: `M${r(pa.x - 20)} ${r(pa.y)}C${r(pa.x - 20)} ${r(top - lift)} ${r(pb.x - 20)} ${r(top - lift)} ${r(pb.x - 20)} ${r(pb.y)}` })
    }
    return out
  }
}
