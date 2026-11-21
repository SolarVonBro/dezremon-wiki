export interface RollResult { formula: string; total: number; detail: string; at: number }

const rnd = (n: number) => {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return (a[0] % n) + 1
}

/** Tiny dice expression evaluator: NdM, khN/klN, + - * /, parentheses, {attribute} references. */
export function rollFormula(formula: string, attrs: Record<string, number> = {}): RollResult {
  const details: string[] = []
  let expr = formula.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = attrs[name.trim().toLowerCase()]
    if (v === undefined) throw new Error(`Нет атрибута «${name}»`)
    details.push(`${name}=${v}`)
    return `(${v})`
  })
  expr = expr.replace(/(\d*)d(\d+|%)(k[hl]\d+)?/gi, (_, cnt: string, sides: string, keep: string | undefined) => {
    const n = Math.min(Number(cnt || 1), 200)
    const s = sides === '%' ? 100 : Number(sides)
    if (!s) throw new Error('Неверная кость')
    let rolls = Array.from({ length: n }, () => rnd(s))
    let used = rolls
    if (keep) {
      const k = Number(keep.slice(2))
      const sorted = [...rolls].sort((a, b) => (keep[1].toLowerCase() === 'h' ? b - a : a - b))
      used = sorted.slice(0, k)
    }
    const sum = used.reduce((a, b) => a + b, 0)
    details.push(`${n}d${s}${keep ?? ''}: [${rolls.join(', ')}]${keep ? ' → ' + used.join(', ') : ''}`)
    return `(${sum})`
  })
  if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error('Неверная формула')
  // eslint-disable-next-line no-new-func
  const total = Math.floor(Function(`"use strict"; return (${expr})`)())
  return { formula, total, detail: details.join('; '), at: Date.now() }
}
