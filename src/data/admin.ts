// Service administration (the whole project, above every world/campaign/room).
// Administrators are fixed by uid. KEEP IN SYNC with isAdmin() in firestore.rules — the rules are what actually
// grants the rights (admins act as owner of every world); this list only decides what the client shows.
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch, type DocumentReference } from 'firebase/firestore'
import { db } from '@/firebase'
import { WORLD_COLLECTIONS } from './backup/format'
import { now } from './util'
import type { Campaign, Member, Room, ServiceBan, ServiceConfig, UserProfile, World } from '@/model/types'

export const ADMIN_UIDS: readonly string[] = ['TRLvfuNmFtR9TByopvMl8yIG1jG2']

export const isServiceAdmin = (uid: string | null | undefined) => !!uid && ADMIN_UIDS.includes(uid)

// ---------- bans ----------
export function watchMyServiceBan(uid: string, cb: (b: ServiceBan | null) => void) {
  return onSnapshot(doc(db, 'serviceBans', uid), (s) => cb(s.exists() ? (s.data() as ServiceBan) : null), () => cb(null))
}
export async function listServiceBans(): Promise<ServiceBan[]> {
  return (await getDocs(collection(db, 'serviceBans'))).docs.map((d) => ({ ...(d.data() as ServiceBan), uid: d.id }))
}
export const banUser = (uid: string, reason: string, by: string) =>
  setDoc(doc(db, 'serviceBans', uid), { uid, reason, createdAt: now(), createdBy: by } satisfies ServiceBan)
export const unbanUser = (uid: string) => deleteDoc(doc(db, 'serviceBans', uid))

// ---------- service config ----------
export const DEFAULT_SERVICE_CONFIG: ServiceConfig = { youtubeApiKey: '' }
export async function readServiceConfig(): Promise<ServiceConfig> {
  const s = await getDoc(doc(db, 'service', 'config')).catch(() => null)
  return { ...DEFAULT_SERVICE_CONFIG, ...(s?.exists() ? (s.data() as Partial<ServiceConfig>) : {}) }
}
export const saveServiceConfig = (patch: Partial<ServiceConfig>) => setDoc(doc(db, 'service', 'config'), patch, { merge: true })

// ---------- whole-service listings (admins only; every call reads the whole collection) ----------
export async function listUsers(): Promise<UserProfile[]> {
  return (await getDocs(collection(db, 'users'))).docs.map((d) => ({ displayName: '', email: '', photoURL: null, lastSeen: 0, ...(d.data() as Partial<UserProfile>), uid: d.id }))
}
export async function listWorlds(): Promise<World[]> {
  return (await getDocs(collection(db, 'worlds'))).docs.map((d) => ({ ...(d.data() as World), id: d.id }))
}
/** Every world membership of every user: { wid, member }. */
export async function listWorldMemberships(): Promise<Array<{ wid: string; member: Member }>> {
  const s = await getDocs(collectionGroup(db, 'members'))
  return s.docs.filter((d) => d.ref.parent.parent?.parent.id === 'worlds').map((d) => ({ wid: d.ref.parent.parent!.id, member: d.data() as Member }))
}
export async function listAllCampaigns(): Promise<Campaign[]> {
  return (await getDocs(collection(db, 'campaigns'))).docs.map((d) => ({ ...(d.data() as Campaign), id: d.id }))
}
export async function listAllRooms(): Promise<Room[]> {
  return (await getDocs(collection(db, 'rooms'))).docs.map((d) => ({ ...(d.data() as Room), id: d.id }))
}

// ---------- deleting things that belong to someone else ----------
async function deleteRefs(refs: DocumentReference[], onProgress?: (n: number) => void) {
  let done = 0
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db)
    refs.slice(i, i + 400).forEach((r) => b.delete(r))
    await b.commit()
    done += Math.min(400, refs.length - i)
    onProgress?.(done)
  }
}

/** Deletes a world with everything in it (any world: admins act as its owner). */
export async function deleteWorldById(wid: string, onProgress: (done: number, what: string) => void = () => {}) {
  let done = 0
  // members last: the rules check the caller's role through them (admins do not need it, owners do)
  const names = [...WORLD_COLLECTIONS.filter((n) => n !== 'members'), 'imageChunks', 'joinRequests', 'bans', 'members']
  for (const name of [...new Set(names)]) {
    const snap = await getDocs(collection(db, 'worlds', wid, name)).catch(() => null)
    if (!snap?.size) continue
    await deleteRefs(snap.docs.map((d) => d.ref), (n) => onProgress(done + n, name))
    done += snap.size
  }
  // games are played in the world and live on its pages: they go with it
  const games = await getDocs(query(collection(db, 'campaigns'), where('worldId', '==', wid))).catch(() => null)
  for (const g of games?.docs ?? []) await deleteCampaignTree(g.id).catch(() => {})
  await deleteDoc(doc(db, 'usage', wid)).catch(() => {})
  await deleteDoc(doc(db, 'worlds', wid))
}

export const CAMPAIGN_COLLECTIONS = ['sessions', 'invites', 'participants'] as const
export const ROOM_COLLECTIONS = ['tracks', 'playlists', 'listeners', 'messages'] as const

/** Deletes a campaign with its journal, invites and participants (owner or admin). */
export async function deleteCampaignTree(cid: string) {
  for (const name of CAMPAIGN_COLLECTIONS) {
    const snap = await getDocs(collection(db, 'campaigns', cid, name)).catch(() => null)
    if (snap?.size) await deleteRefs(snap.docs.map((d) => d.ref))
  }
  await deleteDoc(doc(db, 'campaigns', cid))
}

/** Deletes a room with its tracks, presence and chat (owner or admin). */
export async function deleteRoomTree(rid: string) {
  for (const name of ROOM_COLLECTIONS) {
    const snap = await getDocs(collection(db, 'rooms', rid, name)).catch(() => null)
    if (snap?.size) await deleteRefs(snap.docs.map((d) => d.ref))
  }
  await deleteDoc(doc(db, 'rooms', rid))
}

/** Removes the profile doc of an account (the Firebase Auth account itself is deleted in the Firebase console). */
export const deleteUserProfile = (uid: string) => deleteDoc(doc(db, 'users', uid))
