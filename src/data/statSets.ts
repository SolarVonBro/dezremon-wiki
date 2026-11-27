// Saved ability score sets stored in Firestore under users/{uid}/statSets/{id},
// plus per-user draft in localStorage and JSON backup export/import (compatible with dnd-spells).
import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/firebase'
import { clean, downloadBlob, now, randomId } from './util'
import { emptyData, normalizeStatData, type StatData, type StatSet } from './statCalc'

const setsColl = (uid: string) => collection(db, 'users', uid, 'statSets')
const setDocRef = (uid: string, id: string) => doc(db, 'users', uid, 'statSets', id)

export function watchStatSets(uid: string, cb: (rows: StatSet[]) => void, onErr: (e: unknown) => void = () => {}) {
  return onSnapshot(
    setsColl(uid),
    (snap) => {
      const rows = snap.docs
        .map((d) => {
          const raw = d.data()
          return {
            id: d.id,
            created: typeof raw.created === 'number' ? raw.created : 0,
            updated: typeof raw.updated === 'number' ? raw.updated : 0,
            data: normalizeStatData(raw.data),
          } satisfies StatSet
        })
        .sort((a, b) => b.updated - a.updated)
      cb(rows)
    },
    onErr,
  )
}

export async function createStatSet(uid: string, data: StatData, explicitId?: string): Promise<string> {
  const id = explicitId || randomId(16)
  const t = now()
  await setDoc(setDocRef(uid, id), { id, created: t, updated: t, data: clean(data) })
  return id
}

export async function saveStatSet(uid: string, id: string, data: StatData): Promise<void> {
  await updateDoc(setDocRef(uid, id), { updated: now(), data: clean(data) })
}

export async function deleteStatSet(uid: string, id: string): Promise<void> {
  await deleteDoc(setDocRef(uid, id))
}

export function exportStatSets(sets: StatSet[]) {
  const payload = JSON.stringify({ app: 'dnd-stats', v: 1, sets, deleted: {} }, null, 1)
  downloadBlob(new Blob([payload], { type: 'application/json' }), `ability-scores-${new Date().toISOString().slice(0, 10)}.json`)
}

export async function importStatSets(uid: string, file: File): Promise<number> {
  const parsed = JSON.parse(await file.text())
  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray(parsed.sets)
      ? parsed.sets
      : null!
  if (!rawList) throw new Error('Это не файл с наборами характеристик.')
  const valid = rawList.filter((x): x is Partial<StatSet> & { data: unknown } => Boolean(x && typeof x === 'object' && (x as any).data && typeof (x as any).data === 'object'))
  if (!valid.length) throw new Error('В файле нет наборов характеристик.')
  const t = now()
  for (let i = 0; i < valid.length; i += 400) {
    const b = writeBatch(db)
    for (const item of valid.slice(i, i + 400)) {
      const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(item.id) ? item.id : randomId(16)
      b.set(setDocRef(uid, id), {
        id,
        created: typeof item.created === 'number' ? item.created : t,
        updated: typeof item.updated === 'number' ? item.updated : t,
        data: clean(normalizeStatData(item.data)),
      })
    }
    await b.commit()
  }
  return valid.length
}

/* ---------------- calculator draft in browser ---------------- */

export interface StatDraft { savedId: string | null; data: StatData }
const draftKey = (uid: string) => `dw.stats.draft.${uid}.v1`

export function readStatDraft(uid: string): StatDraft {
  try {
    const v = JSON.parse(localStorage.getItem(draftKey(uid)) ?? 'null')
    if (v && typeof v === 'object') {
      return { savedId: typeof v.savedId === 'string' ? v.savedId : null, data: normalizeStatData(v.data) }
    }
  } catch { /* fresh draft */ }
  return { savedId: null, data: emptyData() }
}

export function writeStatDraft(uid: string, d: StatDraft) {
  try { localStorage.setItem(draftKey(uid), JSON.stringify(d)) } catch { /* quota/private mode */ }
}
