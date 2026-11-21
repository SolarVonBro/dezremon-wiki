// Role-aware Firestore queries. Security rules are not filters: a player's query must itself
// guarantee that every returned document is readable, so non-masters run several narrower queries.
import { collection, doc, query, where, type Query, type QueryConstraint, type CollectionReference } from 'firebase/firestore'
import { db } from '@/firebase'
import type { Role, Visibility, Visible } from '@/model/types'

export interface Access {
  wid: string
  uid: string | null
  role: Role | null
}

export const isMasterRole = (r: Role | null | undefined) => r === 'owner' || r === 'master'

export const coll = (wid: string, name: string) => collection(db, 'worlds', wid, name) as CollectionReference<any>
export const docRef = (wid: string, name: string, id: string) => doc(db, 'worlds', wid, name, id)

export function visibleQueries(a: Access, name: string, extra: QueryConstraint[] = []): Query[] {
  const c = coll(a.wid, name)
  if (isMasterRole(a.role)) return [query(c, ...extra)]
  if (a.role && a.uid) {
    return [
      query(c, where('visibility', 'in', ['public', 'members']), ...extra),
      query(c, where('allowedUids', 'array-contains', a.uid), ...extra),
      query(c, where('createdBy', '==', a.uid), ...extra),
    ]
  }
  return [query(c, where('visibility', '==', 'public'), ...extra)]
}

/** Client-side mirror of the read rule (used to hide stale cached docs and nested references). */
export function canSee(a: Access, d: Visible | null | undefined, worldPublic: boolean): boolean {
  if (!d) return false
  if (isMasterRole(a.role)) return true
  if (a.role && a.uid) {
    return d.visibility === 'public' || d.visibility === 'members' || d.createdBy === a.uid ||
      (d.visibility === 'custom' && (d.allowedUids ?? []).includes(a.uid))
  }
  return worldPublic && d.visibility === 'public'
}

const RANK: Record<Visibility, number> = { master: 0, custom: 1, members: 2, public: 3 }

/** true if `next` hides the record from someone who could see it under `prev`. */
export function narrows(prev: Visible, next: Visible): boolean {
  if (RANK[next.visibility] < RANK[prev.visibility]) return true
  if (prev.visibility === 'custom' && next.visibility === 'custom') {
    return (prev.allowedUids ?? []).some((u) => !(next.allowedUids ?? []).includes(u))
  }
  return false
}

/** Visibility at least as open as both arguments (for images used in an article). */
export function widen(img: Visible, target: Pick<Visible, 'visibility' | 'allowedUids'>): Pick<Visible, 'visibility' | 'allowedUids'> | null {
  if (RANK[img.visibility] > RANK[target.visibility]) return null
  if (img.visibility === target.visibility && img.visibility !== 'custom') return null
  if (target.visibility === 'custom') {
    if (img.visibility === 'custom') {
      const merged = [...new Set([...(img.allowedUids ?? []), ...target.allowedUids])]
      if (merged.length === (img.allowedUids ?? []).length) return null
      return { visibility: 'custom', allowedUids: merged }
    }
    return { visibility: 'custom', allowedUids: [...target.allowedUids] }
  }
  if (target.visibility === 'master') return null
  return { visibility: target.visibility, allowedUids: img.allowedUids ?? [] }
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: 'Всем (и гостям, если мир открыт)',
  members: 'Участникам мира',
  custom: 'Мастерам и выбранным игрокам',
  master: 'Только мастерам',
}
export const VISIBILITY_SHORT: Record<Visibility, string> = {
  public: 'Публично', members: 'Участники', custom: 'Выбранные', master: 'Мастер',
}
