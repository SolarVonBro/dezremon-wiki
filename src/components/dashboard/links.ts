/** Only web and mail links are allowed in the "quick links" block (no javascript: and the like). */
export function safeUrl(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s) ? 'https://' + s : null
  if (!withScheme) return null
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? u.href : null
  } catch { return null }
}

/** "discord.gg/abc" → "discord.gg" for the small caption under a link button. */
export function hostOf(url: string): string {
  try { const u = new URL(url); return u.protocol === 'mailto:' ? u.pathname : u.host.replace(/^www\./, '') } catch { return url }
}
