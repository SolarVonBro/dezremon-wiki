// Which theme the page shows. The reader picks light, dark or "as the system" for themselves (session.theme); a world
// may pick one of the world themes (world.settings.theme), which wins on that world's pages only. Every world theme
// is dark, so while one is on, the base tokens are the dark ones and the theme's tokens go on top (themes*.css).
import { ref } from 'vue'
import { designById, fontsHref } from './designs'

export type UserTheme = 'auto' | 'dark' | 'light'

let userTheme: UserTheme = 'auto'
/** The world theme shown right now (null — the reader's own theme). */
export const activeWorldTheme = ref<string | null>(null)
let fontLink: HTMLLinkElement | null = null

export function setUserTheme(t: UserTheme) {
  userTheme = t
  render()
}

/** Called by the world layout: the theme of the open world, or null when leaving the world or it has none. */
export function setWorldTheme(id: string | null | undefined) {
  activeWorldTheme.value = designById(id) ? id! : null
  render()
}

function render() {
  const root = document.documentElement
  const wt = activeWorldTheme.value
  const t = wt ? 'dark' : userTheme
  if (t === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  if (wt) root.setAttribute('data-wtheme', wt)
  else root.removeAttribute('data-wtheme')
  // the theme's fonts: one stylesheet, swapped when the theme changes
  const href = wt ? fontsHref(designById(wt)!.families) : null
  if (!href) { fontLink?.remove(); fontLink = null; return }
  if (fontLink?.getAttribute('href') === href) return
  fontLink?.remove()
  fontLink = document.createElement('link')
  fontLink.rel = 'stylesheet'
  fontLink.href = href
  document.head.appendChild(fontLink)
}

/** The last known theme of a world, so its pages open in it before the world document arrives. */
export function cachedWorldTheme(wid: string): string | null {
  try { return localStorage.getItem('dw.wtheme.' + wid) } catch { return null }
}
export function cacheWorldTheme(wid: string, id: string | null) {
  try {
    if (id) localStorage.setItem('dw.wtheme.' + wid, id)
    else localStorage.removeItem('dw.wtheme.' + wid)
  } catch { /* private mode */ }
}
