/** Normalizes HTML pasted from Word / Google Docs / web pages while keeping real formatting. */
export function cleanPastedHtml(html: string): string {
  const isWord = /urn:schemas-microsoft-com|class="?Mso|mso-/i.test(html)
  const isGDocs = /docs-internal-guid/.test(html)
  if (!isWord && !isGDocs && !/<(meta|style|link|title|xml)/i.test(html)) return html
  let h = html.replace(/<!--\[if[\s\S]*?endif\]-->/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  h = h.replace(/<\/?o:p[^>]*>/gi, '').replace(/<\/?(w|m|v):[^>]*>/gi, '')
  const doc = new DOMParser().parseFromString(h, 'text/html')
  doc.querySelectorAll('meta,style,link,title,xml,script').forEach((n) => n.remove())
  if (isGDocs) {
    // Google Docs wraps the whole fragment in <b style="font-weight:normal">.
    doc.querySelectorAll('b[id^="docs-internal-guid"]').forEach((b) => b.replaceWith(...Array.from(b.childNodes)))
    doc.querySelectorAll<HTMLElement>('span').forEach((s) => {
      if (s.style.fontWeight === '400' || s.style.fontWeight === 'normal') s.style.removeProperty('font-weight')
      if (s.style.fontStyle === 'normal') s.style.removeProperty('font-style')
      if (s.style.textDecoration === 'none') s.style.removeProperty('text-decoration')
      if (s.style.backgroundColor === 'transparent') s.style.removeProperty('background-color')
      if (s.style.color === 'rgb(0, 0, 0)') s.style.removeProperty('color')
      if (/^Arial/.test(s.style.fontFamily)) s.style.removeProperty('font-family')
      if (s.style.fontSize === '11pt') s.style.removeProperty('font-size')
    })
  }
  if (isWord || isGDocs) {
    doc.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, div, td, th, table').forEach((el) => {
      ;['margin', 'margin-top', 'margin-bottom', 'margin-right', 'padding-top', 'padding-bottom'].forEach((p) => el.style.removeProperty(p))
      if (el.style.lineHeight === 'normal') el.style.removeProperty('line-height')
      if (el.className && /Mso/.test(el.className)) el.removeAttribute('class')
      if (!el.getAttribute('style')) el.removeAttribute('style')
    })
    doc.querySelectorAll<HTMLElement>('span').forEach((s) => {
      if (/^(Calibri|Times New Roman|Arial)/.test(s.style.fontFamily)) s.style.removeProperty('font-family')
      if (!s.getAttribute('style')) s.removeAttribute('style')
    })
  }
  return doc.body.innerHTML
}

export function dataUrlToFile(dataUrl: string, name = 'pasted'): File | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], `${name}.${m[1].split('/')[1] ?? 'png'}`, { type: m[1] })
}
