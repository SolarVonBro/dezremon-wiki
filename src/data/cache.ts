// Local IndexedDB cache. Synced collections are stored per world so that a page load only
// downloads documents changed since the previous visit (Firestore free tier: 50k reads/day).
import { openDB, type IDBPDatabase } from 'idb'

interface CacheSchema {
  docs: { key: string; value: { wid: string; coll: string; id: string; data: any }; indexes: { byWorldColl: [string, string] } }
  meta: { key: string; value: any }
  bodies: { key: string; value: { rev: number; html: string; text: string; secret: boolean } }
  images: { key: string; value: Blob }
  drafts: { key: string; value: { html: string; at: number } }
}

let dbp: Promise<IDBPDatabase<any>> | null = null

function idb() {
  if (!dbp) {
    dbp = openDB('dezremon-wiki', 1, {
      upgrade(db) {
        const docs = db.createObjectStore('docs')
        docs.createIndex('byWorldColl', ['wid', 'coll'])
        db.createObjectStore('meta')
        db.createObjectStore('bodies')
        db.createObjectStore('images')
        db.createObjectStore('drafts')
      },
    }).catch((e) => {
      console.warn('IndexedDB unavailable, working without local cache', e)
      return null as any
    })
  }
  return dbp
}

async function safe<T>(fn: (db: IDBPDatabase<CacheSchema & any>) => Promise<T>, fallback: T): Promise<T> {
  try {
    const db = await idb()
    if (!db) return fallback
    return await fn(db)
  } catch (e) {
    console.warn('cache error', e)
    return fallback
  }
}

export const cache = {
  async loadColl<T>(wid: string, coll: string): Promise<T[]> {
    return safe(async (db) => {
      const rows = await db.getAllFromIndex('docs', 'byWorldColl', [wid, coll])
      return rows.map((r: any) => r.data as T)
    }, [] as T[])
  },
  async putDocs(wid: string, coll: string, docs: Array<{ id: string }>) {
    if (!docs.length) return
    await safe(async (db) => {
      const tx = db.transaction('docs', 'readwrite')
      for (const d of docs) tx.store.put({ wid, coll, id: d.id, data: d }, `${wid}/${coll}/${d.id}`)
      await tx.done
    }, undefined)
  },
  async deleteDocs(wid: string, coll: string, ids: string[]) {
    if (!ids.length) return
    await safe(async (db) => {
      const tx = db.transaction('docs', 'readwrite')
      for (const id of ids) tx.store.delete(`${wid}/${coll}/${id}`)
      await tx.done
    }, undefined)
  },
  /** Atomically apply document upserts/removals together with sync metadata in a single transaction. */
  async commitSync(
    wid: string,
    coll: string,
    ups: Array<{ id: string }>,
    rem: string[],
    metaKey?: string,
    meta?: any,
  ) {
    if (!ups.length && !rem.length && !metaKey) return
    await safe(async (db) => {
      const stores = metaKey ? ['docs', 'meta'] : ['docs']
      const tx = db.transaction(stores, 'readwrite')
      const docs = tx.objectStore('docs')
      for (const d of ups) docs.put({ wid, coll, id: d.id, data: d }, `${wid}/${coll}/${d.id}`)
      for (const id of rem) docs.delete(`${wid}/${coll}/${id}`)
      if (metaKey) tx.objectStore('meta').put(meta, metaKey)
      await tx.done
    }, undefined)
  },
  async clearWorld(wid: string) {
    await safe(async (db) => {
      const tx = db.transaction(['docs', 'meta', 'bodies'], 'readwrite')
      const range = IDBKeyRange.bound(`${wid}/`, `${wid}/\uffff`)
      await tx.objectStore('docs').delete(range)
      await tx.objectStore('meta').delete(range)
      await tx.objectStore('bodies').delete(range)
      await tx.done
    }, undefined)
  },
  getMeta: <T>(key: string) => safe((db) => db.get('meta', key) as Promise<T | undefined>, undefined),
  setMeta: (key: string, value: any) => safe((db) => db.put('meta', value, key), undefined),

  getBody: (wid: string, eid: string) => safe((db) => db.get('bodies', `${wid}/${eid}`), undefined) as Promise<CacheSchema['bodies']['value'] | undefined>,
  putBody: (wid: string, eid: string, v: CacheSchema['bodies']['value']) => safe((db) => db.put('bodies', v, `${wid}/${eid}`), undefined),
  async allBodies(wid: string): Promise<Map<string, CacheSchema['bodies']['value']>> {
    return safe(async (db) => {
      const range = IDBKeyRange.bound(`${wid}/`, `${wid}/\uffff`)
      const keys = await db.getAllKeys('bodies', range)
      const vals = await db.getAll('bodies', range)
      const m = new Map<string, any>()
      keys.forEach((k: any, i: number) => m.set(String(k).slice(wid.length + 1), vals[i]))
      return m
    }, new Map())
  },

  getImage: (wid: string, id: string) => safe((db) => db.get('images', `${wid}/${id}`), undefined) as Promise<Blob | undefined>,
  putImage: (wid: string, id: string, blob: Blob) => safe((db) => db.put('images', blob, `${wid}/${id}`), undefined),

  getDraft: (key: string) => safe((db) => db.get('drafts', key), undefined) as Promise<{ html: string; at: number } | undefined>,
  putDraft: (key: string, html: string) => safe((db) => db.put('drafts', { html, at: Date.now() }, key), undefined),
  deleteDraft: (key: string) => safe((db) => db.delete('drafts', key), undefined),
}
