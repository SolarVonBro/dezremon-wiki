// <input type="datetime-local"> works with local "YYYY-MM-DDTHH:mm" strings; the data stores epoch milliseconds.
const pad = (n: number) => String(n).padStart(2, '0')

export function toLocalInput(ms: number | null | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(s: string): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isFinite(t) ? t : null
}
