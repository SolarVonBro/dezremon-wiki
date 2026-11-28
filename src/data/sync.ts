// Delta sync of a world collection into memory + IndexedDB, followed by a live listener.
// One listener per visible query: its first snapshot is the delta since the last visit,
// later snapshots are live edits by other people (or our own optimistic writes).
import { onSnapshot, where, type Unsubscribe } from 'firebase/firestore'
import { cache } from './cache'
import { visibleQueries, type Access } from './access'
import { SYNC_VERSION, deltaSince, needsFullSync, syncScope, type SyncMeta } from './syncPolicy'

export { SYNC_VERSION, deltaSince, needsFullSync, syncScope, type SyncMeta }

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
  // Single meta key per world+collection matching the single shared `docs` store:
  // any change of access scope (guest ↔ player ↔ master, or another player) forces a clean full sync.
  const scope = syncScope(a)
  const metaKey = `${a.wid}/sync/${name}`
  const [meta, cached] = await Promise.all([
    cache.getMeta<SyncMeta>(metaKey),
    cache.loadColl<T>(a.wid, name),
  ])
  const nowMs = Date.now()
  const full = needsFullSync(meta, { scope, aclVersion, cachedCount: cached.length, nowMs })
  const initialCachedIds = new Set(cached.map((d) => d.id))
  const known = new Set(initialCachedIds)
  if (!full) onChange(cached, [], true)

  // Full sync fetches without an updatedAt filter so docs with missing/0/non-numeric updatedAt are never skipped.
  const extra = full ? [] : [where('updatedAt', '>', deltaSince(meta?.since, nowMs))]
  const queries = visibleQueries(a, name, extra)
  // id -> set of query indexes that currently return it (a player's doc may match several)
  const membership = new Map<string, Set<number>>()
  let pendingFirst = queries.length
  let initialDone = false
  let anyFromCache = false
  const fullIds = new Set<string>()
  let maxSeen = full ? 0 : (typeof meta?.since === 'number' && Number.isFinite(meta.since) ? meta.since : 0)
  let fullAtMs = full ? nowMs : meta!.fullAt
  let stopped = false
  let cacheChain = Promise.resolve()
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => (resolveReady = r))
  const unsubs: Unsubscribe[] = []

  const persist = (ups: T[], rem: string[], nextMeta?: SyncMeta) => {
    if (!ups.length && !rem.length && !nextMeta) return
    cacheChain = cacheChain.then(() => {
      if (stopped) return
      return cache.commitSync(a.wid, name, ups, rem, nextMeta ? metaKey : undefined, nextMeta)
    })
  }

  queries.forEach((q, qi) => {
    let first = true
    unsubs.push(onSnapshot(q, { includeMetadataChanges: false }, (snap) => {
      if (stopped) return
      const ups: T[] = []
      const rem: string[] = []
      for (const ch of snap.docChanges()) {
        const id = ch.doc.id
        if (ch.type === 'removed') {
          const set = membership.get(id)
          set?.delete(qi)
          // Removed from every query → no longer visible to us (visibility narrowed or doc deleted).
          if (!set || set.size === 0) {
            membership.delete(id)
            known.delete(id)
            if (full && !initialDone) fullIds.delete(id)
            rem.push(id)
          }
          continue
        }
        const d = { ...ch.doc.data(), id } as T
        if (!membership.has(id)) membership.set(id, new Set())
        membership.get(id)!.add(qi)
        known.add(id)
        ups.push(d)
        if (!ch.doc.metadata.hasPendingWrites && typeof d.updatedAt === 'number' && Number.isFinite(d.updatedAt) && d.updatedAt > maxSeen) {
          maxSeen = d.updatedAt
        }
        if (full && !initialDone) fullIds.add(id)
      }
      if (first) {
        first = false
        if (snap.metadata.fromCache) anyFromCache = true
        pendingFirst--
        if (pendingFirst === 0) {
          initialDone = true
          if (full && !anyFromCache) {
            // Anything cached but not returned by an authoritative full sync is no longer visible.
            const stale = [...initialCachedIds].filter((id) => !fullIds.has(id))
            for (const id of stale) known.delete(id)
            rem.push(...stale)
            fullAtMs = Date.now()
          }
          const nextMeta = !anyFromCache
            ? ({ v: SYNC_VERSION, scope, since: maxSeen, aclVersion, fullAt: fullAtMs, count: known.size } satisfies SyncMeta)
            : undefined
          persist(ups, rem, nextMeta)
          onChange(ups, rem, full)
          resolveReady()
          return
        }
        persist(ups, rem)
        if (ups.length || rem.length) onChange(ups, rem, false)
        return
      }
      const nextMeta = !snap.metadata.hasPendingWrites && !snap.metadata.fromCache && initialDone && !anyFromCache
        ? ({ v: SYNC_VERSION, scope, since: maxSeen, aclVersion, fullAt: fullAtMs, count: known.size } satisfies SyncMeta)
        : undefined
      persist(ups, rem, nextMeta)
      if (ups.length || rem.length) onChange(ups, rem, false)
    }, (e) => {
      if (stopped) return
      onError(e)
      resolveReady()
    }))
  })

  return {
    stop() {
      if (stopped) return
      stopped = true
      unsubs.forEach((u) => u())
      resolveReady()
    },
    ready,
  }
}
