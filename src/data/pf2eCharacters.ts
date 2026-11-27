// PF2e characters stored in Firestore under users/{uid}/pf2eCharacters/{id},
// plus JSON export/import backup for individual or all characters.
import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/firebase'
import { clean, downloadBlob, now, randomId } from './util'
import type { Pf2eCharacter, Pf2eCoins, Pf2eContainer, Pf2eInventoryItem, Pf2eSpellList } from '@/model/pf2e'

const charsColl = (uid: string) => collection(db, 'users', uid, 'pf2eCharacters')
const charDocRef = (uid: string, cid: string) => doc(db, 'users', uid, 'pf2eCharacters', cid)

export function defaultCoins(): Pf2eCoins {
  return { pp: 0, gp: 0, sp: 0, cp: 0, containerId: null, dropped: false }
}

export function normalizePf2eCharacter(id: string, raw: any): Pf2eCharacter {
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    id,
    name: typeof c.name === 'string' ? c.name : 'Безымянный персонаж',
    description: typeof c.description === 'string' ? c.description : '',
    portrait: typeof c.portrait === 'string' ? c.portrait : null,
    portraitSource: typeof c.portraitSource === 'string' ? c.portraitSource : null,
    portraitCrop: c.portraitCrop && typeof c.portraitCrop === 'object' ? c.portraitCrop : null,
    level: typeof c.level === 'number' && Number.isFinite(c.level) ? Math.min(20, Math.max(1, Math.round(c.level))) : 1,
    strMod: typeof c.strMod === 'number' && Number.isFinite(c.strMod) ? Math.min(12, Math.max(-5, Math.round(c.strMod))) : 0,
    bulkBonus: typeof c.bulkBonus === 'number' && Number.isFinite(c.bulkBonus) ? c.bulkBonus : 0,
    maxInvested: typeof c.maxInvested === 'number' && Number.isFinite(c.maxInvested) ? Math.max(0, Math.round(c.maxInvested)) : 10,
    coins: { ...defaultCoins(), ...(c.coins && typeof c.coins === 'object' ? c.coins : {}) },
    containers: Array.isArray(c.containers) ? (c.containers as Pf2eContainer[]) : [],
    inventory: Array.isArray(c.inventory) ? (c.inventory as Pf2eInventoryItem[]) : [],
    spellLists: Array.isArray(c.spellLists) ? (c.spellLists as Pf2eSpellList[]) : [],
    customGroups: Array.isArray(c.customGroups) ? c.customGroups.filter((g: unknown) => typeof g === 'string') : [],
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
  }
}

export function watchPf2eCharacters(uid: string, cb: (rows: Pf2eCharacter[]) => void, onErr: (e: unknown) => void = () => {}) {
  return onSnapshot(
    charsColl(uid),
    (snap) => {
      const rows = snap.docs
        .map((d) => normalizePf2eCharacter(d.id, d.data()))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      cb(rows)
    },
    onErr,
  )
}

export function watchPf2eCharacter(uid: string, cid: string, cb: (row: Pf2eCharacter | null) => void, onErr: (e: unknown) => void = () => {}) {
  return onSnapshot(
    charDocRef(uid, cid),
    (snap) => cb(snap.exists() ? normalizePf2eCharacter(snap.id, snap.data()) : null),
    onErr,
  )
}

export async function createPf2eCharacter(
  uid: string,
  init: Partial<Pick<Pf2eCharacter, 'name' | 'description' | 'portrait' | 'portraitSource' | 'portraitCrop' | 'level' | 'strMod'>>,
): Promise<string> {
  const id = randomId(16)
  const t = now()
  const docData: Pf2eCharacter = {
    ...normalizePf2eCharacter(id, init),
    id,
    createdAt: t,
    updatedAt: t,
  }
  await setDoc(charDocRef(uid, id), clean(docData))
  return id
}

export async function updatePf2eCharacter(uid: string, cid: string, patch: Partial<Omit<Pf2eCharacter, 'id' | 'createdAt'>>): Promise<void> {
  await updateDoc(charDocRef(uid, cid), clean({ ...patch, updatedAt: now() }))
}

export async function deletePf2eCharacter(uid: string, cid: string): Promise<void> {
  await deleteDoc(charDocRef(uid, cid))
}

export function exportPf2eCharacters(chars: Pf2eCharacter[], filename?: string) {
  const payload = JSON.stringify({ app: 'dezremon-pf2e-chars', v: 1, characters: chars }, null, 1)
  downloadBlob(
    new Blob([payload], { type: 'application/json' }),
    filename || `pf2e-characters-${new Date().toISOString().slice(0, 10)}.json`,
  )
}

export async function importPf2eCharacters(uid: string, file: File): Promise<number> {
  const parsed = JSON.parse(await file.text())
  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray(parsed.characters)
      ? parsed.characters
      : parsed && typeof parsed === 'object' && typeof parsed.name === 'string'
        ? [parsed]
        : null!
  if (!rawList || !rawList.length) throw new Error('Это не файл с персонажами PF2e.')
  const t = now()
  for (let i = 0; i < rawList.length; i += 400) {
    const b = writeBatch(db)
    for (const raw of rawList.slice(i, i + 400)) {
      const id = randomId(16)
      const norm = normalizePf2eCharacter(id, raw)
      norm.createdAt = norm.createdAt || t
      norm.updatedAt = t
      b.set(charDocRef(uid, id), clean(norm))
    }
    await b.commit()
  }
  return rawList.length
}
