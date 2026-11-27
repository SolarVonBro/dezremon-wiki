// Pathfinder 2e Foundry formula evaluator, dice roller, expected-value calculator,
// spell heightening calculator, and distribution deviation indicator (zero eval).
import type { Pf2eAreaType, Pf2eSpellDamageEntry, Pf2eSpellIndex } from '@/model/pf2e'

export interface Pf2eFormulaContext {
  /** Cast rank for spells (1..10); defaults to baseRank or 1 */
  rank?: number
  /** Base rank of a spell (1..10) */
  baseRank?: number
  /** Item level for equipment, or spell rank for spells */
  level?: number
  /** Character level (1..20) */
  actorLevel?: number
  /** Character Strength modifier (for @actor.abilities.str.mod) */
  strMod?: number
  /** Weapon dice count fallback */
  diceNum?: number
  /** Weapon damage type fallback */
  dmgType?: string
}

export interface DiceTerm {
  count: number
  sides: number
  sign: 1 | -1
  mult?: number
}

export interface CompiledRollComponent {
  dice: DiceTerm[]
  flat: number
  types: string[]
  displayExpr: string
  min: number
  max: number
  avg: number
  variance: number
}

export interface CompiledPf2eRoll {
  raw: string
  displayExpr: string
  components: CompiledRollComponent[]
  hasDice: boolean
  min: number
  max: number
  avg: number
  stdDev: number
  note?: string
}

export interface RolledDieGroup {
  sides: number
  sign: 1 | -1
  rolls: number[]
}

export interface RolledComponent {
  displayExpr: string
  types: string[]
  groups: RolledDieGroup[]
  flat: number
  subtotal: number
  avg: number
}

export type RollVerdict = 'poor' | 'low' | 'avg' | 'high' | 'great'

export interface Pf2eRollResult {
  formula: CompiledPf2eRoll
  total: number
  components: RolledComponent[]
  min: number
  max: number
  avg: number
  stdDev: number
  diff: number
  pctDiff: number
  percentile: number
  zScore: number
  verdict: RollVerdict
  rolledAt: number
}

/** Substitute Foundry @variables with numeric values from context. */
export function substitutePf2eVars(expr: string, ctx: Pf2eFormulaContext = {}): string {
  const baseRank = Math.max(1, ctx.baseRank ?? ctx.rank ?? 1)
  const rank = Math.max(1, ctx.rank ?? baseRank)
  const level = ctx.level != null ? ctx.level : rank
  const actorLevel = ctx.actorLevel ?? Math.max(1, rank * 2 - 1)
  const strMod = ctx.strMod ?? 0
  const diceNum = ctx.diceNum ?? 1

  return expr
    .replace(/@item\.baseRank\b/gi, String(baseRank))
    .replace(/@item\.rank\b/gi, String(rank))
    .replace(/@spell\.rank\b/gi, String(rank))
    .replace(/@item\.level\b/gi, String(level))
    .replace(/@self\.level\b/gi, String(level))
    .replace(/@actor\.level\b/gi, String(actorLevel))
    .replace(/@actor\.abilities\.str\.mod\b/gi, String(strMod))
    .replace(/@item\.system\.damage\.dice\b/gi, String(diceNum))
}

type Tok =
  | { k: 'num'; v: number }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }

function tokenizeMath(s: string): Tok[] | null {
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const n = Number(s.slice(i, j))
      if (!Number.isFinite(n)) return null
      out.push({ k: 'num', v: n })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++
      out.push({ k: 'id', v: s.slice(i, j).toLowerCase() })
      i = j
      continue
    }
    if ('+-*/(),'.includes(ch)) {
      out.push({ k: 'op', v: ch })
      i++
      continue
    }
    return null
  }
  return out
}

/** Safe recursive-descent evaluator for Foundry PF2e numeric/math expressions (no eval). */
export function evalPf2eMath(rawExpr: string, ctx: Pf2eFormulaContext = {}): number | null {
  const sub = substitutePf2eVars(rawExpr, ctx).trim()
  if (!sub) return null
  const toks = tokenizeMath(sub)
  if (!toks || !toks.length) return null
  let pos = 0

  const peek = () => toks[pos]
  const eat = (op?: string) => {
    const t = toks[pos]
    if (op && (!t || t.k !== 'op' || t.v !== op)) return null
    pos++
    return t
  }

  function parseExpr(): number | null {
    let left = parseTerm()
    if (left === null) return null
    while (peek()?.k === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = eat()!.v
      const right = parseTerm()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  function parseTerm(): number | null {
    let left = parseUnary()
    if (left === null) return null
    while (peek()?.k === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = eat()!.v
      const right = parseUnary()
      if (right === null) return null
      if (op === '/' && right === 0) return null
      left = op === '*' ? left * right : left / right
    }
    return left
  }

  function parseUnary(): number | null {
    if (peek()?.k === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = eat()!.v
      const val = parseUnary()
      if (val === null) return null
      return op === '-' ? -val : val
    }
    return parsePrimary()
  }

  function parsePrimary(): number | null {
    const t = peek()
    if (!t) return null
    if (t.k === 'num') { pos++; return t.v }
    if (t.k === 'op' && t.v === '(') {
      pos++
      const v = parseExpr()
      if (v === null || !eat(')')) return null
      return v
    }
    if (t.k === 'id') {
      const fn = t.v
      pos++
      if (!eat('(')) return null
      const args: number[] = []
      if (!(peek()?.k === 'op' && peek()!.v === ')')) {
        while (true) {
          const a = parseExpr()
          if (a === null) return null
          args.push(a)
          if (peek()?.k === 'op' && peek()!.v === ',') { pos++; continue }
          break
        }
      }
      if (!eat(')')) return null
      switch (fn) {
        case 'ceil': return args.length === 1 ? Math.ceil(args[0]) : null
        case 'floor': return args.length === 1 ? Math.floor(args[0]) : null
        case 'round': return args.length === 1 ? Math.round(args[0]) : null
        case 'abs': return args.length === 1 ? Math.abs(args[0]) : null
        case 'max': return args.length >= 1 ? Math.max(...args) : null
        case 'min': return args.length >= 1 ? Math.min(...args) : null
        case 'gte': return args.length === 2 ? (args[0] >= args[1] ? 1 : 0) : null
        case 'gt': return args.length === 2 ? (args[0] > args[1] ? 1 : 0) : null
        case 'lte': return args.length === 2 ? (args[0] <= args[1] ? 1 : 0) : null
        case 'lt': return args.length === 2 ? (args[0] < args[1] ? 1 : 0) : null
        case 'eq': return args.length === 2 ? (args[0] === args[1] ? 1 : 0) : null
        case 'ne': return args.length === 2 ? (args[0] !== args[1] ? 1 : 0) : null
        case 'ternary': return args.length === 3 ? (args[0] ? args[1] : args[2]) : null
        default: return null
      }
    }
    return null
  }

  const res = parseExpr()
  if (res === null || pos !== toks.length || !Number.isFinite(res)) return null
  return res
}

/** Split string by delimiter only at depth 0 of (), [], {}. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = []
  let dp = 0; let db = 0; let dc = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') dp++
    else if (ch === ')') dp = Math.max(0, dp - 1)
    else if (ch === '[') db++
    else if (ch === ']') db = Math.max(0, db - 1)
    else if (ch === '{') dc++
    else if (ch === '}') dc = Math.max(0, dc - 1)
    else if (ch === sep && dp === 0 && db === 0 && dc === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

/** Strip matching outer parentheses or braces if they enclose the whole string. */
function stripOuterWrap(s: string): string {
  let out = s.trim()
  while (out.length >= 2) {
    const open = out[0]
    const close = open === '(' ? ')' : open === '{' ? '}' : ''
    if (!close || out[out.length - 1] !== close) break
    let depth = 0
    let wrapsAll = true
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === open) depth++
      else if (out[i] === close) depth--
      if (depth === 0) { wrapsAll = false; break }
    }
    if (!wrapsAll) break
    out = out.slice(1, -1).trim()
  }
  return out
}

/** Resolve all pure-math parenthesized subexpressions (without dice 'd') inside a dice formula. */
function simplifyMathParens(expr: string, ctx: Pf2eFormulaContext): string {
  let s = substitutePf2eVars(expr, ctx)
  // Loop innermost-out to resolve parenthesized expressions that don't contain dice (e.g. "2d6")
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    let out = ''
    let i = 0
    while (i < s.length) {
      if (s[i] === '(') {
        // Find matching ')'
        let depth = 1
        let j = i + 1
        while (j < s.length && depth > 0) {
          if (s[j] === '(') depth++
          else if (s[j] === ')') depth--
          j++
        }
        if (depth === 0) {
          const inner = s.slice(i + 1, j - 1)
          const hasDice = /\b\d*d\d+\b/i.test(inner)
          // Check if preceded by a function name like ceil(
          const prevChar = i > 0 ? s[i - 1] : ''
          const isFnCall = /[a-zA-Z_]/.test(prevChar)
          if (!hasDice && !isFnCall) {
            const val = evalPf2eMath(inner, ctx)
            if (val !== null) {
              out += String(val)
              i = j
              changed = true
              continue
            }
          }
        }
      }
      out += s[i++]
    }
    s = out
    if (!changed) break
  }
  // Also evaluate standalone function calls like ceil(3/2) not wrapped in outer parens
  s = s.replace(/\b(?:ceil|floor|round|abs|max|min|ternary|gte|gt|lte|lt|eq|ne)\([^()]*\)/gi, (m) => {
    const v = evalPf2eMath(m, ctx)
    return v !== null ? String(v) : m
  })
  return s
}

function formatComponentExpr(dice: DiceTerm[], flat: number): string {
  const parts: string[] = []
  for (const d of dice) {
    if (d.count <= 0) continue
    const base = `${d.count}d${d.sides}`
    const term = d.mult && d.mult !== 1 ? `${base}×${d.mult}` : base
    if (!parts.length) parts.push(d.sign < 0 ? `−${term}` : term)
    else parts.push(d.sign < 0 ? `− ${term}` : `+ ${term}`)
  }
  if (flat !== 0 || !parts.length) {
    const absF = Math.abs(flat)
    if (!parts.length) parts.push(flat < 0 ? `−${absF}` : String(absF))
    else parts.push(flat < 0 ? `− ${absF}` : `+ ${absF}`)
  }
  return parts.join(' ')
}

function compileComponent(rawComp: string, ctx: Pf2eFormulaContext): CompiledRollComponent | null {
  let s = rawComp.trim()
  if (!s) return null

  // Extract trailing damage/flavor tags: [fire], [persistent,fire], or stray unclosed [void
  const types: string[] = []
  const addTags = (raw: string) => {
    for (const part of raw.split(',')) {
      let t = part.trim().toLowerCase()
      if (t === '@item.system.damage.damagetype') t = (ctx.dmgType || '').toLowerCase()
      if (t && !t.startsWith('@') && !types.includes(t)) types.push(t)
    }
  }

  const bracketIdx = s.lastIndexOf('[')
  if (bracketIdx > 0) {
    const closeIdx = s.indexOf(']', bracketIdx)
    const tagRaw = closeIdx > bracketIdx ? s.slice(bracketIdx + 1, closeIdx) : s.slice(bracketIdx + 1)
    const after = closeIdx > bracketIdx ? s.slice(closeIdx + 1).trim() : ''
    if (!after) {
      addTags(tagRaw)
      s = s.slice(0, bracketIdx).trim()
    }
  }

  s = stripOuterWrap(s)
  // Handle nested Foundry tags like "(5[splash])[cold]" -> extract [splash] into types
  s = s.replace(/\[([^\]]+)\]/g, (_, innerTag) => {
    addTags(innerTag)
    return ''
  }).trim()

  // Handle stray unmatched opening '{' from upstream typos like "{1d20+30"
  if (s.startsWith('{') && !s.includes('}')) s = s.slice(1).trim()
  if (!s) return null

  // Foundry coin flip syntax: "1dc" -> "1d2"
  s = s.replace(/\b(\d*)dc\b/gi, (_, n) => `${n || '1'}d2`)

  // Simplify math expressions before parsing dice + flat terms
  s = stripOuterWrap(simplifyMathParens(s, ctx))

  // Check if entire expression is pure math (no dice), e.g., "(@item.rank - 2)*2" -> 4
  if (!/\bd\d+\b/i.test(s) && !/\d+d\d+/i.test(s)) {
    const val = evalPf2eMath(s, ctx)
    if (val === null) return null
    const rounded = Math.round(val)
    return {
      dice: [],
      flat: rounded,
      types,
      displayExpr: String(rounded),
      min: rounded,
      max: rounded,
      avg: rounded,
      variance: 0,
    }
  }

  // Split into additive terms at top level (respecting parens)
  const terms: Array<{ sign: 1 | -1; text: string }> = []
  let dp = 0
  let curStart = 0
  let curSign: 1 | -1 = 1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') dp++
    else if (ch === ')') dp = Math.max(0, dp - 1)
    else if ((ch === '+' || ch === '-') && dp === 0) {
      const piece = s.slice(curStart, i).trim()
      if (piece) {
        terms.push({ sign: curSign, text: piece })
        curSign = ch === '-' ? -1 : 1
        curStart = i + 1
      } else if (ch === '-') {
        curSign = (curSign * -1) as 1 | -1
        curStart = i + 1
      } else {
        curStart = i + 1
      }
    }
  }
  const tail = s.slice(curStart).trim()
  if (tail) terms.push({ sign: curSign, text: tail })

  const dice: DiceTerm[] = []
  let flat = 0
  for (const t of terms) {
    const clean = stripOuterWrap(t.text)
    const compact = clean.replace(/\s+/g, '')
    // Match optional scalar multiplier * dice * optional scalar multiplier: e.g. "2d6", "2*2d6", "(1d20)*50"
    const dm = /^(?:(\d+)\*)?\(?(-?\d*)d(\d+)\)?(?:\*(\d+))?$/i.exec(compact)
    if (dm) {
      const preMult = dm[1] ? Number(dm[1]) : 1
      const rawCount = dm[2] === '' ? 1 : dm[2] === '-' ? -1 : Number(dm[2])
      const sides = Number(dm[3])
      const postMult = dm[4] ? Number(dm[4]) : 1
      const mult = preMult * postMult
      if (!Number.isFinite(rawCount) || !Number.isFinite(sides) || !Number.isFinite(mult) || sides < 2 || sides > 1000) return null
      const count = Math.min(100, Math.max(0, Math.abs(Math.round(rawCount))))
      const sign = (rawCount < 0 ? -t.sign : t.sign) as 1 | -1
      if (count > 0) dice.push({ count, sides, sign, ...(mult !== 1 ? { mult } : {}) })
      continue
    }
    const mv = evalPf2eMath(clean, ctx)
    if (mv === null) return null
    flat += t.sign * Math.round(mv)
  }

  let min = flat
  let max = flat
  let avg = flat
  let variance = 0
  for (const d of dice) {
    const m = d.mult ?? 1
    if (d.sign > 0) {
      min += d.count * m
      max += d.count * d.sides * m
      avg += d.count * ((d.sides + 1) / 2) * m
    } else {
      min -= d.count * d.sides * m
      max -= d.count * m
      avg -= d.count * ((d.sides + 1) / 2) * m
    }
    variance += d.count * ((d.sides * d.sides - 1) / 12) * m * m
  }

  return {
    dice,
    flat,
    types,
    displayExpr: formatComponentExpr(dice, flat),
    min,
    max,
    avg,
    variance,
  }
}

/**
 * Compiles any Foundry PF2e @Damage[...] or [[/r ...]] specification into an executable,
 * analytically characterized roll (min, max, expected average, standard deviation).
 */
export function compilePf2eFormula(rawSpec: string, ctx: Pf2eFormulaContext = {}): CompiledPf2eRoll | null {
  if (!rawSpec || !rawSpec.trim()) return null
  // Strip Foundry pipe options: "|options:area-damage|shortLabel"
  let body = splitTopLevel(rawSpec.trim(), '|')[0].trim()
  // Extract optional #comment note (common in [[/r 1d4 #rounds]])
  let note: string | undefined
  const hashIdx = body.indexOf('#')
  if (hashIdx >= 0) {
    note = body.slice(hashIdx + 1).replace(/[}\]]+$/g, '').trim() || undefined
    body = body.slice(0, hashIdx).trim()
  }
  body = stripOuterWrap(body)
  if (!body) return null

  const rawParts = splitTopLevel(body, ',')
  const components: CompiledRollComponent[] = []
  for (const p of rawParts) {
    const c = compileComponent(p, ctx)
    if (!c) return null
    components.push(c)
  }
  if (!components.length) return null

  const hasDice = components.some((c) => c.dice.some((d) => d.count > 0))
  const min = components.reduce((s, c) => s + c.min, 0)
  const max = components.reduce((s, c) => s + c.max, 0)
  const avg = components.reduce((s, c) => s + c.avg, 0)
  const variance = components.reduce((s, c) => s + c.variance, 0)
  const stdDev = Math.sqrt(Math.max(0, variance))
  const displayExpr = components.map((c) => c.displayExpr).join(' + ')

  return { raw: rawSpec, displayExpr, components, hasDice, min, max, avg, stdDev, note }
}

function defaultDieRng(sides: number): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    const limit = Math.floor(0x100000000 / sides) * sides
    let v = 0
    do {
      crypto.getRandomValues(buf)
      v = buf[0]
    } while (v >= limit)
    return (v % sides) + 1
  }
  return Math.floor(Math.random() * sides) + 1
}

/** Rolls a compiled PF2e formula and computes its exact deviation from expected average. */
export function executePf2eRoll(compiled: CompiledPf2eRoll, rng: (sides: number) => number = defaultDieRng): Pf2eRollResult {
  let total = 0
  const components: RolledComponent[] = []

  for (const c of compiled.components) {
    const groups: RolledDieGroup[] = []
    let sub = c.flat
    for (const d of c.dice) {
      const rolls: number[] = []
      const m = d.mult ?? 1
      for (let i = 0; i < d.count; i++) {
        const r = Math.max(1, Math.min(d.sides, Math.round(rng(d.sides))))
        rolls.push(r)
        sub += d.sign * r * m
      }
      groups.push({ sides: d.sides, sign: d.sign, rolls })
    }
    total += sub
    components.push({
      displayExpr: c.displayExpr,
      types: c.types,
      groups,
      flat: c.flat,
      subtotal: sub,
      avg: c.avg,
    })
  }

  const diff = total - compiled.avg
  const pctDiff = compiled.avg !== 0 ? (diff / Math.abs(compiled.avg)) * 100 : 0
  const span = compiled.max - compiled.min
  const percentile = span > 0 ? Math.max(0, Math.min(1, (total - compiled.min) / span)) : 0.5
  const zScore = compiled.stdDev > 0 ? diff / compiled.stdDev : 0

  let verdict: RollVerdict = 'avg'
  if (compiled.stdDev > 0) {
    if (zScore >= 1.25) verdict = 'great'
    else if (zScore >= 0.4) verdict = 'high'
    else if (zScore <= -1.25) verdict = 'poor'
    else if (zScore <= -0.4) verdict = 'low'
  }

  return {
    formula: compiled,
    total,
    components,
    min: compiled.min,
    max: compiled.max,
    avg: compiled.avg,
    stdDev: compiled.stdDev,
    diff,
    pctDiff,
    percentile,
    zScore,
    verdict,
    rolledAt: Date.now(),
  }
}

export function formatAvgNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** Combine a base formula (e.g. "6d6" or "1d4+1") with `steps` copies of an increment (e.g. "2d6"). */
export function addScaledFormula(baseFormula: string, stepFormula: string, steps: number, ctx: Pf2eFormulaContext = {}): string {
  if (steps <= 0 || !stepFormula) return baseFormula
  const b = compilePf2eFormula(baseFormula, ctx)
  const inc = compilePf2eFormula(stepFormula, ctx)
  if (!b || !inc || b.components.length !== 1 || inc.components.length !== 1) {
    return `${baseFormula} + ${steps}*(${stepFormula})`
  }
  const bc = b.components[0]
  const ic = inc.components[0]
  const diceMap = new Map<number, number>()
  for (const d of bc.dice) diceMap.set(d.sides, (diceMap.get(d.sides) ?? 0) + d.sign * d.count * (d.mult ?? 1))
  for (const d of ic.dice) diceMap.set(d.sides, (diceMap.get(d.sides) ?? 0) + d.sign * d.count * (d.mult ?? 1) * steps)
  const mergedDice: DiceTerm[] = [...diceMap.entries()]
    .filter(([, cnt]) => cnt !== 0)
    .sort((a, b2) => b2[0] - a[0])
    .map(([sides, cnt]) => ({ count: Math.abs(cnt), sides, sign: (cnt < 0 ? -1 : 1) as 1 | -1 }))
  const mergedFlat = bc.flat + ic.flat * steps
  return formatComponentExpr(mergedDice, mergedFlat)
}

export interface HeightenedSpellState {
  rank: number
  isHeightened: boolean
  damageEntries: Array<{ formula: string; baseFormula: string; type: string; category?: string | null; healing?: boolean; spec: string }>
  /** Full combined Foundry-style roll spec across all primary damage entries, e.g. "10d6[fire]" */
  combinedSpec: string
  /** Compiled roll stats for combinedSpec (if it has dice) */
  compiled: CompiledPf2eRoll | null
  /** Maps normalized base formula ("6d6") -> scaled formula ("10d6") for prose auto-upgrading */
  baseOverrides: Record<string, string>
  areaType: Pf2eAreaType | null
  areaVal: number | null
  rangeOverride: string | null
  targetOverride: string | null
}

/**
 * Computes the exact damage, healing, area, range, and target of a PF2e spell when cast at `castRank`,
 * using Foundry's structured `scaling` metadata (both interval and fixed heightening).
 */
export function computeHeightenedSpell(spell: Pf2eSpellIndex, castRank: number, ctx?: Pf2eFormulaContext): HeightenedSpellState {
  const baseRank = Math.max(1, spell.baseRank || 1)
  const rank = Math.max(baseRank, Math.min(10, Math.round(castRank || baseRank)))
  const isHeightened = rank > baseRank
  const sc = spell.scaling
  const evalCtx: Pf2eFormulaContext = {
    rank,
    baseRank,
    level: rank,
    actorLevel: ctx?.actorLevel ?? Math.max(1, rank * 2 - 1),
    strMod: ctx?.strMod ?? 0,
  }

  let areaType: Pf2eAreaType | null = spell.areaType
  let areaVal: number | null = spell.areaVal
  let rangeOverride: string | null = null
  let targetOverride: string | null = null

  const baseList: Pf2eSpellDamageEntry[] = sc?.baseDamage ?? []
  const currentByKey = new Map<string, { baseFormula: string; formula: string; type: string; category?: string | null; healing?: boolean }>()
  for (const d of baseList) {
    currentByKey.set(d.key, {
      baseFormula: d.formula,
      formula: d.formula,
      type: d.type,
      category: d.category,
      healing: d.healing,
    })
  }

  // 1. Interval heightening
  if (sc?.interval && sc.interval > 0 && isHeightened) {
    const steps = Math.floor((rank - baseRank) / sc.interval)
    if (steps > 0) {
      if (sc.intervalArea && areaVal != null) areaVal += steps * sc.intervalArea
      if (sc.intervalDamage) {
        for (const [k, incFormula] of Object.entries(sc.intervalDamage)) {
          const cur = currentByKey.get(k)
          if (cur) {
            cur.formula = addScaledFormula(cur.formula, incFormula, steps, evalCtx)
          }
        }
      }
    }
  }

  // 2. Fixed-level heightening (apply all thresholds <= castRank in ascending order)
  if (sc?.fixed && isHeightened) {
    const lvls = Object.keys(sc.fixed).map(Number).filter((n) => Number.isFinite(n) && n <= rank).sort((a, b) => a - b)
    for (const lvl of lvls) {
      const f = sc.fixed[lvl]
      if (!f) continue
      if (f.areaVal != null) areaVal = f.areaVal
      if (f.areaType) areaType = f.areaType
      if (f.range) rangeOverride = f.range
      if (f.target) targetOverride = f.target
      if (f.damage) {
        for (const fd of f.damage) {
          const prev = currentByKey.get(fd.key)
          currentByKey.set(fd.key, {
            baseFormula: prev?.baseFormula ?? fd.formula,
            formula: fd.formula,
            type: fd.type || prev?.type || 'untyped',
            category: fd.category !== undefined ? fd.category : prev?.category,
            healing: fd.healing ?? prev?.healing,
          })
        }
      }
    }
  }

  const baseOverrides: Record<string, string> = {}
  const damageEntries = [...currentByKey.values()].map((d) => {
    const tags: string[] = []
    if (d.category) tags.push(d.category)
    if (d.healing) tags.push('healing')
    if (d.type && d.type !== 'untyped') tags.push(d.type)
    const spec = tags.length ? `${d.formula}[${tags.join(',')}]` : d.formula
    const normBase = d.baseFormula.replace(/\s+/g, '').toLowerCase()
    const normCur = d.formula.replace(/\s+/g, '').toLowerCase()
    if (normBase && normCur && normBase !== normCur) {
      baseOverrides[normBase] = d.formula
    }
    return { ...d, spec }
  })

  const combinedSpec = damageEntries.map((d) => d.spec).join(',')
  const compiled = combinedSpec ? compilePf2eFormula(combinedSpec, evalCtx) : null

  return {
    rank,
    isHeightened,
    damageEntries,
    combinedSpec,
    compiled,
    baseOverrides,
    areaType,
    areaVal,
    rangeOverride,
    targetOverride,
  }
}
