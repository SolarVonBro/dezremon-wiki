export const now = () => Date.now()

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function randomId(len = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let s = ''
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return s
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null
  const wrapped = (...args: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => { t = null; fn(...args) }, ms)
  }
  wrapped.cancel = () => { if (t) clearTimeout(t); t = null }
  wrapped.flush = (...args: Parameters<T>) => { if (t) clearTimeout(t); t = null; fn(...args) }
  return wrapped
}

/** Plain text of an HTML fragment (used for excerpts and full-text search). */
export function htmlToText(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('style,script').forEach((n) => n.remove())
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,td,th,dt,dd,br,blockquote,section,article').forEach((n) => n.append(' '))
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function excerptOf(html: string, max = 280): string {
  const t = htmlToText(html)
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "через 3 дн." for a moment in the future (or relativeTime for the past). */
export function untilTime(ts: number): string {
  const diff = (ts - Date.now()) / 1000
  if (diff <= 0) return relativeTime(ts)
  if (diff < 3600) return `через ${Math.max(1, Math.round(diff / 60))} мин`
  if (diff < 86400) return `через ${Math.round(diff / 3600)} ч`
  return `через ${Math.round(diff / 86400)} дн.`
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function sortByName<T extends { name: string }>(list: T[]): T[] {
  return list.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base', numeric: true }))
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function slugify(s: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }
  return s.toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item'
}

/** Strip `undefined` recursively (Firestore rejects them in arrays). */
export function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Human-readable text for a Firestore/Auth error (raw rule-evaluation messages mean nothing to users). */
export function errorText(e: unknown): string {
  const code = String((e as any)?.code ?? '')
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return 'Нет прав на это действие (или аккаунт заблокирован администратором сервиса)'
  if (code === 'unavailable' || code === 'firestore/unavailable') return 'Нет связи с сервером — попробуйте ещё раз'
  if (code === 'not-found' || code === 'firestore/not-found') return 'Не найдено — возможно, это уже удалили'
  return (e as any)?.message ?? String(e)
}
