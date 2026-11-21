// Hover card for @-mentions (Kanka-style tooltip): image, type, subtype, tooltip/excerpt, pinned attributes.
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { escapeHtml } from '@/data/util'
import { imageUrl } from '@/data/images'

let card: HTMLDivElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function ensureCard() {
  if (card) return card
  card = document.createElement('div')
  card.className = 'preview-card'
  card.addEventListener('mouseenter', () => { if (hideTimer) clearTimeout(hideTimer) })
  card.addEventListener('mouseleave', () => hidePreview(150))
  document.body.append(card)
  return card
}

export function showPreview(anchor: HTMLElement, id: string) {
  const world = useWorld()
  const e = world.get(id)
  if (!e) return
  if (hideTimer) clearTimeout(hideTimer)
  const t = typeDef(e.type)
  const c = ensureCard()
  const pinned = (e.attributes ?? []).filter((a) => a.isPinned && a.kind !== 'section').slice(0, 5)
  const tags = (e.tagIds ?? []).map((tid) => world.get(tid)).filter(Boolean).slice(0, 4)
  c.innerHTML = `
    <div class="pc-head">
      ${e.imageId ? '<div class="pc-img"><img alt=""></div>' : ''}
      <div>
        <div class="pc-type" style="color:${t.color}">${escapeHtml(t.label)}${e.kind ? ' · ' + escapeHtml(e.kind) : ''}</div>
        <div class="pc-name">${escapeHtml(e.name)}</div>
        ${e.fields?.title ? `<div class="pc-sub">${escapeHtml(e.fields.title)}</div>` : ''}
      </div>
    </div>
    ${(e.tooltip || e.excerpt) ? `<div class="pc-text">${escapeHtml(e.tooltip || e.excerpt)}</div>` : ''}
    ${pinned.length ? `<dl class="pc-attrs">${pinned.map((a) => `<dt>${escapeHtml(a.name)}</dt><dd>${escapeHtml(a.kind === 'checkbox' ? (a.value === 'true' ? '✓' : '—') : a.value)}</dd>`).join('')}</dl>` : ''}
    ${tags.length ? `<div class="pc-tags">${tags.map((tg) => `<span class="tag-chip">${escapeHtml(tg!.name)}</span>`).join('')}</div>` : ''}
  `
  if (e.imageId) {
    void imageUrl(world.access, e.imageId, 'thumb').then((u) => { const img = c.querySelector('img'); if (img) img.src = u }).catch(() => {})
  }
  c.style.display = 'block'
  void computePosition(anchor, c, { placement: 'bottom-start', strategy: 'fixed', middleware: [offset(8), flip(), shift({ padding: 10 })] })
    .then(({ x, y }) => Object.assign(c.style, { left: `${x}px`, top: `${y}px` }))
}

export function hidePreview(delay = 0) {
  if (hideTimer) clearTimeout(hideTimer)
  const run = () => { if (card) card.style.display = 'none' }
  if (delay) hideTimer = setTimeout(run, delay)
  else run()
}
