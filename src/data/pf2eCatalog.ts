// Lazy-loaded static PF2e catalog store (served from public/data/pf2e/, zero Firestore storage).
// Downloads only what is needed on demand (index + current language descriptions) and caches in memory.
import { ref } from 'vue'
import type { Pf2eItemIndex, Pf2eLang, Pf2eMeta, Pf2eSpellIndex } from '@/model/pf2e'

const BASE = import.meta.env.BASE_URL + 'data/pf2e/'

const meta = ref<Pf2eMeta | null>(null)
const spells = ref<Pf2eSpellIndex[]>([])
const items = ref<Pf2eItemIndex[]>([])
const spellsById = ref<Map<string, Pf2eSpellIndex>>(new Map())
const itemsById = ref<Map<string, Pf2eItemIndex>>(new Map())

const spellDescRu = ref<Record<string, string> | null>(null)
const spellDescEn = ref<Record<string, string> | null>(null)
const itemDescRu = ref<Record<string, string> | null>(null)
const itemDescEn = ref<Record<string, string> | null>(null)

const loadingMeta = ref(false)
const loadingSpells = ref(false)
const loadingItems = ref(false)
const loadError = ref<string | null>(null)

const inflight = new Map<string, Promise<unknown>>()

async function fetchJson<T>(file: string): Promise<T> {
  const existing = inflight.get(file)
  if (existing) return existing as Promise<T>
  const p = fetch(BASE + file)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} при загрузке ${file}`)
      return r.json() as Promise<T>
    })
    .finally(() => inflight.delete(file))
  inflight.set(file, p)
  return p
}

export async function ensurePf2eMeta(): Promise<Pf2eMeta> {
  if (meta.value) return meta.value
  loadingMeta.value = true
  try {
    meta.value = await fetchJson<Pf2eMeta>('meta.json')
    return meta.value
  } catch (e: any) {
    loadError.value = e?.message ?? String(e)
    throw e
  } finally {
    loadingMeta.value = false
  }
}

export async function ensurePf2eSpells(): Promise<Pf2eSpellIndex[]> {
  await ensurePf2eMeta()
  if (spells.value.length) return spells.value
  loadingSpells.value = true
  try {
    const list = await fetchJson<Pf2eSpellIndex[]>('spells-index.json')
    spells.value = list
    spellsById.value = new Map(list.map((s) => [s.id, s]))
    return list
  } catch (e: any) {
    loadError.value = e?.message ?? String(e)
    throw e
  } finally {
    loadingSpells.value = false
  }
}

export async function ensurePf2eItems(): Promise<Pf2eItemIndex[]> {
  await ensurePf2eMeta()
  if (items.value.length) return items.value
  loadingItems.value = true
  try {
    const list = await fetchJson<Pf2eItemIndex[]>('items-index.json')
    items.value = list
    itemsById.value = new Map(list.map((i) => [i.id, i]))
    return list
  } catch (e: any) {
    loadError.value = e?.message ?? String(e)
    throw e
  } finally {
    loadingItems.value = false
  }
}

export async function ensureSpellDescriptions(lang: Pf2eLang): Promise<Record<string, string>> {
  if (lang === 'ru') {
    if (spellDescRu.value) return spellDescRu.value
    spellDescRu.value = await fetchJson<Record<string, string>>('spells-desc-ru.json')
    return spellDescRu.value
  }
  if (spellDescEn.value) return spellDescEn.value
  spellDescEn.value = await fetchJson<Record<string, string>>('spells-desc-en.json')
  return spellDescEn.value
}

export async function ensureItemDescriptions(lang: Pf2eLang): Promise<Record<string, string>> {
  if (lang === 'ru') {
    if (itemDescRu.value) return itemDescRu.value
    itemDescRu.value = await fetchJson<Record<string, string>>('items-desc-ru.json')
    return itemDescRu.value
  }
  if (itemDescEn.value) return itemDescEn.value
  itemDescEn.value = await fetchJson<Record<string, string>>('items-desc-en.json')
  return itemDescEn.value
}

export function getSpellDesc(id: string, lang: Pf2eLang): string {
  return (lang === 'ru' ? spellDescRu.value?.[id] : spellDescEn.value?.[id]) ?? ''
}

export function getItemDesc(id: string, lang: Pf2eLang): string {
  return (lang === 'ru' ? itemDescRu.value?.[id] : itemDescEn.value?.[id]) ?? ''
}

// Persistent user preference for PF2e catalog language (RU / EN)
const LANG_KEY = 'dw.pf2e.lang'
const pf2eLang = ref<Pf2eLang>((() => {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ru' } catch { return 'ru' }
})())
export function setPf2eLang(l: Pf2eLang) {
  pf2eLang.value = l
  try { localStorage.setItem(LANG_KEY, l) } catch { /* ignore */ }
}

export function usePf2eCatalog() {
  return {
    meta,
    spells,
    items,
    spellsById,
    itemsById,
    spellDescRu,
    spellDescEn,
    itemDescRu,
    itemDescEn,
    loadingMeta,
    loadingSpells,
    loadingItems,
    loadError,
    lang: pf2eLang,
    setLang: setPf2eLang,
    ensurePf2eMeta,
    ensurePf2eSpells,
    ensurePf2eItems,
    ensureSpellDescriptions,
    ensureItemDescriptions,
    getSpellDesc,
    getItemDesc,
  }
}
