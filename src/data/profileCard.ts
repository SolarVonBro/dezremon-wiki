// The public card of an account (profiles/{uid}): name, photo and since — never the e-mail. Kept apart from the
// user's page loader so the session store can publish it without importing the world store.
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import type { PublicProfile } from '@/model/types'

const KEY = 'dw.profile.'

/** Writes the public card when the name or photo changed since the last time (no read, at most one write). */
export async function publishProfile(u: { uid: string; displayName: string | null; photoURL: string | null; metadata?: { creationTime?: string } }) {
  const p: PublicProfile = {
    uid: u.uid, displayName: (u.displayName || 'Без имени').slice(0, 100), photoURL: u.photoURL ?? null,
    since: Date.parse(u.metadata?.creationTime ?? '') || Date.now(), updatedAt: Date.now(),
  }
  const sig = `${p.displayName}|${p.photoURL ?? ''}|${p.since}`
  try { if (localStorage.getItem(KEY + u.uid) === sig) return } catch { /* private mode: write anyway */ }
  await setDoc(doc(db, 'profiles', u.uid), p)
  try { localStorage.setItem(KEY + u.uid, sig) } catch { /* private mode */ }
}

export async function readProfile(uid: string): Promise<PublicProfile | null> {
  const s = await getDoc(doc(db, 'profiles', uid)).catch(() => null)
  return s?.exists() ? (s.data() as PublicProfile) : null
}
