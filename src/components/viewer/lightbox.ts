import { escapeHtml } from '@/data/util'

/** Minimal full-screen image viewer with keyboard navigation. */
export function openLightbox(items: Array<{ src: string; caption?: string }>, start = 0) {
  if (!items.length) return
  let i = Math.max(0, start)
  const el = document.createElement('div')
  el.className = 'lightbox'
  const draw = () => {
    const it = items[i]
    el.innerHTML = `
      <button class="lb-close" aria-label="Закрыть">×</button>
      ${items.length > 1 ? '<button class="lb-prev" aria-label="Назад">‹</button><button class="lb-next" aria-label="Вперёд">›</button>' : ''}
      <figure><img src="${it.src}" alt=""><figcaption>${escapeHtml(it.caption ?? '')}${items.length > 1 ? ` <span>${i + 1} / ${items.length}</span>` : ''}</figcaption></figure>`
  }
  const close = () => { el.remove(); document.removeEventListener('keydown', key) }
  const go = (d: number) => { i = (i + d + items.length) % items.length; draw() }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowRight') go(1)
    if (e.key === 'ArrowLeft') go(-1)
  }
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.classList.contains('lb-prev')) go(-1)
    else if (t.classList.contains('lb-next')) go(1)
    else if (t.tagName !== 'IMG') close()
  })
  document.addEventListener('keydown', key)
  draw()
  document.body.append(el)
}
