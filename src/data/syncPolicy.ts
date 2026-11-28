// Pure sync cache policy helpers (separated from Firebase/IndexedDB for direct unit testing).
import type { Role } from '@/model/types'

export const SYNC_OVERLAP_MS = 15 * 60 * 1000 // tolerate client clock skew between writers
export const SYNC_FULL_EVERY_MS = 24 * 60 * 60 * 1000
export const SYNC_VERSION = 2

export interface SyncMeta {
  v: number
  scope: string
  since: number
  aclVersion: number
  fullAt: number
  count: number
}

/** Identifies which visibility slice of the shared IndexedDB `docs` store is currently cached. */
export function syncScope(a: { uid: string | null; role: Role | null | undefined }): string {
  if (a.role === 'owner' || a.role === 'master') return 'master'
  if (a.role && a.uid) return `member:${a.uid}`
  return 'guest'
}

export function needsFullSync(
  meta: Partial<SyncMeta> | null | undefined,
  opts: { scope: string; aclVersion: number; cachedCount: number; nowMs: number },
): boolean {
  if (!meta) return true
  if (meta.v !== SYNC_VERSION) return true
  if (meta.scope !== opts.scope) return true
  if (meta.aclVersion !== opts.aclVersion) return true
  if (typeof meta.fullAt !== 'number' || !Number.isFinite(meta.fullAt)) return true
  if (opts.nowMs < meta.fullAt || opts.nowMs - meta.fullAt > SYNC_FULL_EVERY_MS) return true
  if (typeof meta.count === 'number' && meta.count > 0 && opts.cachedCount < meta.count) return true
  return false
}

export function deltaSince(since: number | undefined, nowMs: number): number {
  const safe = typeof since === 'number' && Number.isFinite(since) ? since : 0
  return Math.max(0, Math.min(safe, nowMs) - SYNC_OVERLAP_MS)
}
