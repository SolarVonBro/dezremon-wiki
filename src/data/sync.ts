// Delta sync of a world collection into memory + IndexedDB, followed by a live listener.
// One listener per visible query: its first snapshot is the delta since the last visit,
// later snapshots are live edits by other people (or our own optimistic writes).
import { onSnapshot, where, type Unsubscribe } from 'firebase/firestore'
import { cache } from './cache'
import { visibleQueries, type Access } from './access'

const OVERLAP = 15 * 60 * 1000 // tolerate client clock skew between writers
const FULL_EVERY = 24 * 60 * 60 * 1000

interface SyncMeta { since: number; aclVersion: number; fullAt: number }

export interface SyncHandle {
  stop(): void
  ready: Promise<void>
}

export async function syncCollection<T extends { id: string; updatedAt: number }>(
  a: Access,
  name: string,
  aclVersion: number,
  onChange: (upserts: T[], removals: string[], initial: boolean) => void,
  onError: (e: unknown) => void,
): Promise<SyncHandle> {
  const metaKey = `${a.wid}/sync/${name}/${a.uid ?? 'guest'}/${a.role ?? 'guest'}`
  const meta = (await cache.getMeta<SyncMeta>(metaKey)) ?? null
  const full = !meta || meta.aclVersion !== aclVersion || Date.now() - meta.fullAt > FULL_EVERY
  const cached = await cache.loadColl<T>(a.wid, name)
  const known = new Set(cached.map((d) => d.id))
  if (!full) onChange(cached, [], true)

  const since = full ? 0 : Math.max(0, meta!.since - OVERLAP)
  const queries = visibleQueries(a, name, [where('updatedAt', '>', since)])
  // id -> set of query indexes that currently return it (a player's doc may match several)
  const membership = new Map<string, Set<number>>()
  let pendingFirst = queries.length
  const fullIds = new Set<string>()
  let maxSeen = meta?.since ?? 0
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => (resolveReady = r))
  const unsubs: Unsubscribe[] = []

  queries.forEach((q, qi) => {
    let first = true
    unsubs.push(onSnapshot(q, { includeMetadataChanges: false }, (snap) => {
      const ups: T[] = []
      const rem: string[] = []
      for (const ch of snap.docChanges()) {
        const id = ch.doc.id
        if (ch.type === 'removed') {
          const set = membership.get(id)
          set?.delete(qi)
          // Removed from every query → no longer visible to us (visibility narrowed).
          if (!set || set.size === 0) { membership.delete(id); rem.push(id) }
          continue
        }
        const d = { ...ch.doc.data(), id } as T
        if (!membership.has(id)) membership.set(id, new Set())
        membership.get(id)!.add(qi)
        ups.push(d)
        if (!ch.doc.metadata.hasPendingWrites && d.updatedAt > maxSeen) maxSeen = d.updatedAt
        if (full) fullIds.add(id)
      }
      if (ups.length) void cache.putDocs(a.wid, name, ups)
      if (rem.length) void cache.deleteDocs(a.wid, name, rem)
      if (first) {
        first = false
        pendingFirst--
        if (pendingFirst === 0) {
          if (full) {
            // Anything cached but not returned by a full sync is no longer visible.
            const stale = [...known].filter((id) => !fullIds.has(id))
            if (stale.length) void cache.deleteDocs(a.wid, name, stale)
            rem.push(...stale)
          }
          void cache.setMeta(metaKey, { since: maxSeen, aclVersion, fullAt: full ? Date.now() : meta!.fullAt } satisfies SyncMeta)
          onChange(ups, rem, full)
          resolveReady()
          return
        }
      } else if (!snap.metadata.hasPendingWrites) {
        void cache.setMeta(metaKey, { since: maxSeen, aclVersion, fullAt: full ? Date.now() : meta!.fullAt } satisfies SyncMeta)
      }
      if (ups.length || rem.length) onChange(ups, rem, false)
    }, (e) => { onError(e); resolveReady() }))
  })

  return { stop: () => unsubs.forEach((u) => u()), ready }
}
