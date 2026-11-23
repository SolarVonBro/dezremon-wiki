// Campaigns: a game campaign played in a world. It lives on the world's pages (#/w/{wid}/campaigns/{cid}) and is
// stored next to worlds (campaigns/{cid}), bound by campaign.worldId (+ the denormalized worldName). The world's
// masters run every campaign of their world; its players are members of the world (added by a GM or a world
// master) or people who joined by a campaign invite. World-side helpers (the campaign's tag…) are in worldCampaigns.ts.
import {
  arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { now, randomId } from './util'
import { deleteCampaignTree } from './admin'
import { acceptInvite } from '@/stores/world'
import type { Campaign, CampaignInvite, CampaignParticipant, CampaignRole, CampaignSession, CampaignStatus, Member } from '@/model/types'

type UserLike = { uid: string; displayName: string | null; email: string | null; photoURL: string | null }

export const STATUS_LABELS: Record<CampaignStatus, string> = { planning: 'Готовится', active: 'Идёт', paused: 'На паузе', finished: 'Завершён' }
export const ROLE_LABELS: Record<CampaignRole, string> = { gm: 'Мастер', player: 'Игрок' }

const campRef = (cid: string) => doc(db, 'campaigns', cid)
const sub = (cid: string, name: string) => collection(db, 'campaigns', cid, name)
const nameOf = (u: UserLike) => u.displayName || u.email || 'Без имени'

export function normalizeCampaign(id: string, d: any): Campaign {
  return {
    name: '', description: '', cover: null, worldId: null, worldName: '', ownerId: '', gmUids: [], memberUids: [], status: 'active',
    schedule: '', nextSessionAt: null, tagId: null, characters: {}, createdAt: 0, updatedAt: 0, ...d, id,
  }
}

/** The characters a participant plays in the campaign now (campaign.characters, plus the older single characterId). */
export function currentCharacters(c: Campaign, p: Pick<CampaignParticipant, 'uid' | 'characterId'> | string): string[] {
  const uid = typeof p === 'string' ? p : p.uid
  const old = typeof p === 'string' ? null : p.characterId
  return [...new Set([...(c.characters?.[uid] ?? []), ...(old ? [old] : [])])]
}

// ---------- campaigns ----------
export const newCampaignId = () => doc(collection(db, 'campaigns')).id

export async function createCampaign(user: UserLike, data: Pick<Campaign, 'name' | 'description' | 'worldId' | 'worldName' | 'status' | 'schedule' | 'cover'> & { tagId?: string | null }, id = newCampaignId()): Promise<string> {
  if (!data.worldId) throw new Error('Кампейн создаётся в мире')
  const ref = doc(db, 'campaigns', id)
  const t = now()
  const c: Omit<Campaign, 'id'> = { tagId: null, characters: {}, ...data, ownerId: user.uid, gmUids: [user.uid], memberUids: [user.uid], nextSessionAt: null, createdAt: t, updatedAt: t }
  const p: CampaignParticipant = { uid: user.uid, role: 'gm', displayName: nameOf(user), photoURL: user.photoURL ?? null, characterId: null, characterName: '', joinedAt: t }
  const b = writeBatch(db)
  b.set(ref, c)
  b.set(doc(db, 'campaigns', ref.id, 'participants', user.uid), p)
  await b.commit()
  return ref.id
}

export function watchMyCampaigns(uid: string, cb: (rows: Campaign[]) => void, onErr: (e: unknown) => void = () => {}) {
  return onSnapshot(query(collection(db, 'campaigns'), where('memberUids', 'array-contains', uid)),
    (s) => cb(s.docs.map((d) => normalizeCampaign(d.id, d.data())).sort((a, b) => b.updatedAt - a.updatedAt)), onErr)
}

/** Campaigns played in a world: all of them for its masters (`all`), otherwise those the user takes part in. */
export function watchWorldCampaigns(wid: string, uid: string, cb: (rows: Campaign[]) => void, all = false) {
  const q = all ? query(collection(db, 'campaigns'), where('worldId', '==', wid))
    : query(collection(db, 'campaigns'), where('worldId', '==', wid), where('memberUids', 'array-contains', uid))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => normalizeCampaign(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name, 'ru'))), () => cb([]))
}

export function watchCampaign(cid: string, cb: (c: Campaign | null) => void, onErr: (e: unknown) => void) {
  return onSnapshot(campRef(cid), (s) => cb(s.exists() ? normalizeCampaign(s.id, s.data()) : null), onErr)
}

export const updateCampaign = (cid: string, patch: Partial<Omit<Campaign, 'id' | 'ownerId'>>) => updateDoc(campRef(cid), { ...patch, updatedAt: now() })

export const deleteCampaign = (cid: string) => deleteCampaignTree(cid)

// ---------- participants ----------
export function watchParticipants(cid: string, cb: (rows: CampaignParticipant[]) => void) {
  return onSnapshot(sub(cid, 'participants'), (s) => cb(s.docs.map((d) => ({ role: 'player', displayName: '', joinedAt: 0, characterId: null, characterName: '', photoURL: null, ...(d.data() as Partial<CampaignParticipant>), uid: d.id }) as CampaignParticipant)
    .sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ru') : a.role === 'gm' ? -1 : 1))), () => cb([]))
}

export const updateParticipant = (cid: string, uid: string, patch: Partial<Pick<CampaignParticipant, 'characterId' | 'characterName' | 'displayName' | 'photoURL'>>) =>
  updateDoc(doc(db, 'campaigns', cid, 'participants', uid), patch)

/**
 * A GM or a world master adds members of the campaign's world (participant docs + memberUids in one batch),
 * optionally with the characters each of them plays in it.
 */
export async function addParticipants(cid: string, people: Array<Pick<Member, 'uid' | 'displayName' | 'photoURL'> & { role?: CampaignRole; characters?: string[] }>) {
  if (!people.length) return
  const t = now()
  const b = writeBatch(db)
  const patch: Record<string, unknown> = { memberUids: arrayUnion(...people.map((p) => p.uid)), updatedAt: t }
  const gms = people.filter((p) => p.role === 'gm').map((p) => p.uid)
  if (gms.length) patch.gmUids = arrayUnion(...gms)
  for (const p of people) {
    const part: CampaignParticipant = { uid: p.uid, role: p.role ?? 'player', displayName: p.displayName || 'Без имени', photoURL: p.photoURL ?? null, characterId: null, characterName: '', joinedAt: t }
    b.set(doc(db, 'campaigns', cid, 'participants', p.uid), part)
    if (p.characters?.length) patch[`characters.${p.uid}`] = p.characters
  }
  b.update(campRef(cid), patch)
  await b.commit()
}

/** The characters a participant plays in the campaign now (the participant himself, a GM or a world master). */
export async function setCampaignCharacters(cid: string, uid: string, ids: string[], p?: CampaignParticipant) {
  const b = writeBatch(db)
  b.update(campRef(cid), { [`characters.${uid}`]: [...new Set(ids)], updatedAt: now() })
  // the older single character is folded into the list
  if (p?.characterId) b.update(doc(db, 'campaigns', cid, 'participants', uid), { characterId: null })
  await b.commit()
}

/** GM: make a player a co-GM or back (participant role + campaign.gmUids in one batch). */
export async function setParticipantRole(cid: string, uid: string, role: CampaignRole) {
  const b = writeBatch(db)
  b.update(doc(db, 'campaigns', cid, 'participants', uid), { role })
  b.update(campRef(cid), { gmUids: role === 'gm' ? arrayUnion(uid) : arrayRemove(uid), updatedAt: now() })
  await b.commit()
}

/** GM removes somebody, or a participant leaves (the owner cannot leave his campaign). */
export async function removeParticipant(cid: string, uid: string, leaving = false) {
  const b = writeBatch(db)
  b.delete(doc(db, 'campaigns', cid, 'participants', uid))
  // leaving touches nothing but the member lists (rules); a GM also drops the participant's characters
  b.update(campRef(cid), { memberUids: arrayRemove(uid), gmUids: arrayRemove(uid), ...(leaving ? {} : { [`characters.${uid}`]: deleteField() }), updatedAt: now() })
  await b.commit()
}

// ---------- invites ----------
export function watchCampaignInvites(cid: string, cb: (rows: CampaignInvite[]) => void) {
  return onSnapshot(sub(cid, 'invites'), (s) => cb(s.docs.map((d) => d.data() as CampaignInvite).sort((a, b) => b.createdAt - a.createdAt)), () => cb([]))
}

/**
 * Creates an invite link. With `withWorld` (the GM runs the campaign's world) a world invite for players is created
 * too, and accepting the campaign invite also lets the player into the world.
 */
export async function createCampaignInvite(c: Campaign, by: string, role: CampaignRole, days: number | null, withWorld: boolean): Promise<string> {
  const t = now()
  const expiresAt = days ? t + days * 86400000 : null
  let worldInviteCode: string | null = null
  if (withWorld && c.worldId) {
    worldInviteCode = randomId(12)
    await setDoc(doc(db, 'worlds', c.worldId, 'invites', worldInviteCode), {
      code: worldInviteCode, role: role === 'gm' ? 'master' : 'player', createdBy: by, createdAt: t, expiresAt, note: `Кампейн «${c.name}»`, worldName: c.worldName,
    })
  }
  const code = randomId(12)
  const inv: CampaignInvite = { code, role, createdBy: by, createdAt: t, expiresAt, campaignName: c.name, worldId: c.worldId, worldInviteCode }
  await setDoc(doc(db, 'campaigns', c.id, 'invites', code), inv)
  return code
}

export async function deleteCampaignInvite(c: Campaign, inv: CampaignInvite) {
  await deleteDoc(doc(db, 'campaigns', c.id, 'invites', inv.code))
  if (inv.worldId && inv.worldInviteCode) await deleteDoc(doc(db, 'worlds', inv.worldId, 'invites', inv.worldInviteCode)).catch(() => {})
}

export const inviteUrl = (cid: string, code: string) => `${location.origin}${location.pathname}#/cjoin/${cid}/${code}`

export async function readCampaignInvite(cid: string, code: string): Promise<CampaignInvite | null> {
  const s = await getDoc(doc(db, 'campaigns', cid, 'invites', code)).catch(() => null)
  return s?.exists() ? (s.data() as CampaignInvite) : null
}

/** Joins the campaign (participant doc + memberUids in one batch) and, if the invite carries one, the world. */
export async function acceptCampaignInvite(cid: string, code: string, user: UserLike): Promise<{ worldJoined: boolean; worldError: string }> {
  const inv = await readCampaignInvite(cid, code)
  if (!inv) throw new Error('Приглашение не найдено или отозвано')
  if (inv.expiresAt && inv.expiresAt < now()) throw new Error('Срок приглашения истёк')
  const mine = await getDoc(doc(db, 'campaigns', cid, 'participants', user.uid)).catch(() => null)
  if (!mine?.exists()) {
    const p: CampaignParticipant = { uid: user.uid, role: inv.role, displayName: nameOf(user), photoURL: user.photoURL ?? null, characterId: null, characterName: '', joinedAt: now(), inviteCode: code }
    const b = writeBatch(db)
    b.set(doc(db, 'campaigns', cid, 'participants', user.uid), p)
    b.update(campRef(cid), { memberUids: arrayUnion(user.uid), ...(inv.role === 'gm' ? { gmUids: arrayUnion(user.uid) } : {}), updatedAt: now() })
    try { await b.commit() } catch (e: any) {
      if (e?.code === 'permission-denied') throw new Error('Не удалось вступить: приглашение недействительно или доступ закрыт')
      throw e
    }
  }
  if (!inv.worldId || !inv.worldInviteCode) return { worldJoined: false, worldError: '' }
  try {
    await acceptInvite(inv.worldId, inv.worldInviteCode, user)
    return { worldJoined: true, worldError: '' }
  } catch (e: any) { return { worldJoined: false, worldError: e?.message ?? String(e) } }
}

// ---------- sessions (journal) ----------
export function watchSessions(cid: string, cb: (rows: CampaignSession[]) => void) {
  return onSnapshot(sub(cid, 'sessions'), (s) => cb(s.docs.map((d) => ({ number: 0, html: '', title: '', date: null, status: 'done', createdBy: '', createdAt: 0, updatedAt: 0, ...(d.data() as Partial<CampaignSession>), id: d.id }) as CampaignSession)
    .sort((a, b) => b.number - a.number)), () => cb([]))
}

export async function saveSession(cid: string, s: Partial<CampaignSession> & { number: number }, by: string): Promise<string> {
  const id = s.id || randomId()
  const t = now()
  const data: Record<string, unknown> = { ...s, updatedAt: t }
  delete data.id
  if (!s.id) Object.assign(data, { createdAt: t, createdBy: by })
  await setDoc(doc(db, 'campaigns', cid, 'sessions', id), data, { merge: true })
  await updateDoc(campRef(cid), { updatedAt: t }).catch(() => {})
  return id
}

export const deleteSession = (cid: string, sid: string) => deleteDoc(doc(db, 'campaigns', cid, 'sessions', sid))
