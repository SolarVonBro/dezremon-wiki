// HTML conventions shared by the editor, the viewer, backups and importers.
//   mention:  <a class="mention" data-entity-id="ID" [data-label="custom"]>Text</a>
//   image:    <span class="wiki-img" data-align="left|right|center|inline|full" style="width:40%">
//               <img data-image-id="ID" alt=".."><span class="wiki-img-cap">caption</span></span>
//   secret:   <div data-secret>…</div>      (master-only, removed from the readable copy)
//   callout:  <div data-callout="info">…</div>
//   columns:  <div data-columns="2"><div data-column>…</div>…</div>
import DOMPurify from 'dompurify'

const parser = () => new DOMParser()

export function stripSecrets(html: string): string {
  if (!html || !html.includes('data-secret')) return html
  const doc = parser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('[data-secret]').forEach((n) => n.remove())
  return doc.body.innerHTML
}

export function hasSecretBlocks(html: string): boolean {
  return !!html && html.includes('data-secret')
}

export function mentionIds(html: string): string[] {
  const out = new Set<string>()
  html?.replace(/data-entity-id="([^"]+)"/g, (_, id) => { out.add(id); return '' })
  return [...out]
}

let hooked = false
function hookPurify() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'iframe') {
      const src = (node as Element).getAttribute('src') ?? ''
      const ok = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|w\.soundcloud\.com|open\.spotify\.com)\//.test(src)
      if (!ok) node.parentNode?.removeChild(node)
    }
    if (data.tagName === 'input') {
      const el = node as Element
      if (el.getAttribute('type') !== 'checkbox') el.parentNode?.removeChild(el)
      else el.setAttribute('disabled', '')
    }
  })
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')?.startsWith('http')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

/** Sanitize article HTML before rendering it (content can come from any member). */
export function sanitize(html: string): string {
  hookPurify()
  return DOMPurify.sanitize(html ?? '', {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder', 'data-secret', 'data-callout', 'data-columns', 'data-column', 'data-entity-id', 'data-image-id', 'data-align', 'data-label', 'data-type', 'data-indent', 'colspan', 'rowspan', 'colwidth', 'open', 'start', 'data-checked'],
    FORBID_TAGS: ['script', 'style', 'form', 'button', 'textarea', 'select', 'object', 'embed', 'link', 'meta', 'base'],
    ALLOW_DATA_ATTR: true,
  })
}

/** Readable copy of a master's text for a given entity visibility. */
export function readableCopy(fullHtml: string): string {
  return stripSecrets(fullHtml)
}
