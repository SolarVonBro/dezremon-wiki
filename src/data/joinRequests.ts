// "Please let me in" requests: worlds/{wid}/joinRequests/{uid}. The requester writes it; a master accepts
// (creates the member doc and deletes the request in one batch) or rejects (status → rejected).
import {
  collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '@/firebase'
import type { JoinRequest, Member } from '@/model/types'

const reqRef = (wid: string, uid: string) => doc(db, 'worlds', wid, 'joinRequests', uid)

export interface Requester { uid: string; displayName: string | null; email: string | null; photoURL: string | null }

export async function sendJoinRequest(wid: string, user: Requester, message: string, fromPath: string, worldName: string | null) {
  const t = Date.now()
  const r: JoinRequest = {
    uid: user.uid, displayName: user.displayName || user.email || 'Без имени', email: user.email ?? '', photoURL: user.photoURL ?? null,
    message: message.trim().slice(0, 1000), fromPath, worldName: worldName ?? '', status: 'pending', createdAt: t, updatedAt: t,
  }
  try {
    await setDoc(reqRef(wid, user.uid), r)
    return r
  } catch (e: any) {
    if (e?.code === 'permission-denied') throw new Error('Не удалось отправить заявку: вы уже участник или мастер закрыл вам доступ к этому миру')
    throw e
  }
}

export const cancelJoinRequest = (wid: string, uid: string) => deleteDoc(reqRef(wid, uid))

/** Live state of my own request in one world (null = none). */
export function watchMyRequest(wid: string, uid: string, cb: (r: JoinRequest | null) => void): Unsubscribe {
  return onSnapshot(reqRef(wid, uid), (s) => cb(s.exists() ? (s.data() as JoinRequest) : null), () => cb(null))
}

/** Fresh read from the server (fallback when a live listener goes quiet). */
export async function fetchMyRequest(wid: string, uid: string): Promise<JoinRequest | null> {
  const s = await getDocFromServer(reqRef(wid, uid))
  return s.exists() ? (s.data() as JoinRequest) : null
}

/** All requests I have sent (personal cabinet). */
export async function myJoinRequests(uid: string): Promise<Array<JoinRequest & { wid: string }>> {
  const s = await getDocs(query(collectionGroup(db, 'joinRequests'), where('uid', '==', uid)))
  return s.docs.map((d) => ({ ...(d.data() as JoinRequest), wid: d.ref.parent.parent!.id })).sort((a, b) => b.createdAt - a.createdAt)
}

/** Requests of a world (masters), live. */
export function watchWorldRequests(wid: string, cb: (rows: JoinRequest[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'worlds', wid, 'joinRequests'), (s) => cb(s.docs.map((d) => d.data() as JoinRequest).sort((a, b) => b.createdAt - a.createdAt)), () => cb([]))
}

export async function pendingRequests(wid: string): Promise<JoinRequest[]> {
  const s = await getDocs(query(collection(db, 'worlds', wid, 'joinRequests'), where('status', '==', 'pending')))
  return s.docs.map((d) => d.data() as JoinRequest).sort((a, b) => b.createdAt - a.createdAt)
}

/** Accept: the requester becomes a member right away (their open page picks it up live). */
export async function acceptJoinRequest(wid: string, r: JoinRequest, role: 'player' | 'master') {
  const m: Member = { uid: r.uid, role, displayName: r.displayName, email: r.email, photoURL: r.photoURL, joinedAt: Date.now(), favorites: [], viaRequest: true }
  const b = writeBatch(db)
  b.set(doc(db, 'worlds', wid, 'members', r.uid), m)
  b.delete(reqRef(wid, r.uid))
  await b.commit()
}

/** Reject and block: the user cannot request again nor join by invite links. */
export async function banRequester(wid: string, r: JoinRequest, by: string) {
  const b = writeBatch(db)
  b.set(doc(db, 'worlds', wid, 'bans', r.uid), { uid: r.uid, displayName: r.displayName, email: r.email, at: Date.now(), by })
  b.delete(reqRef(wid, r.uid))
  await b.commit()
}

export async function rejectJoinRequest(wid: string, uid: string, decidedBy: string, worldName: string) {
  await updateDoc(reqRef(wid, uid), { status: 'rejected', decidedBy, decidedAt: Date.now(), updatedAt: Date.now(), worldName })
}
