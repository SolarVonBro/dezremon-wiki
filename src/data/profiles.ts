// The user's page (#/u/{uid}): the public card (profiles/{uid}) plus what the viewer may know about the user —
// the worlds both of them are members of (the user's role there and characters the viewer can open) and the
// campaigns both of them play in. Nobody learns about worlds or campaigns they are not part of themselves.
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { characterIdsOf, docRef } from './access'
import { myWorlds } from '@/stores/world'
import { readProfile } from './profileCard'
import type { CampaignParticipant, CampaignRole, CampaignStatus, Entity, Member, PublicProfile, Role } from '@/model/types'

export interface PageCharacter { id: string; name: string; kind: string; imageId: string | null }
export interface PageWorld {
  id: string
  name: string
  imageId: string | null
  /** the viewer's role (for loading images with the viewer's access) */
  viewerRole: Role
  member: Member
  characters: PageCharacter[]
}
export interface PageCampaign { id: string; name: string; status: CampaignStatus; worldId: string | null; worldName: string; role: CampaignRole; characterName: string }
export interface UserPage {
  profile: PublicProfile | null
  /** name / photo to show (the card, or the member record of a shared world for accounts without a card yet) */
  name: string
  photoURL: string | null
  worlds: PageWorld[]
  campaigns: PageCampaign[]
}

async function characters(wid: string, m: Member): Promise<PageCharacter[]> {
  const out: PageCharacter[] = []
  await Promise.all(characterIdsOf(m).map(async (id) => {
    const s = await getDoc(docRef(wid, 'entities', id)).catch(() => null)
    const e = s?.exists() ? (s.data() as Entity) : null
    if (e && !e.deleted) out.push({ id, name: e.name, kind: e.kind ?? '', imageId: e.imageId ?? null })
  }))
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadUserPage(target: string, viewer: string | null): Promise<UserPage> {
  const profile = await readProfile(target)
  const worlds: PageWorld[] = []
  const campaigns: PageCampaign[] = []
  if (viewer) {
    const mine = await myWorlds(viewer).catch(() => [])
    await Promise.all(mine.map(async (w) => {
      let m: Member | null = w.membership
      if (target !== viewer) {
        const s = await getDoc(docRef(w.id, 'members', target)).catch(() => null)
        m = s?.exists() ? (s.data() as Member) : null
      }
      if (m) worlds.push({ id: w.id, name: w.name, imageId: w.imageId ?? null, viewerRole: w.role, member: m, characters: await characters(w.id, m) })
    }))
    worlds.sort((a, b) => a.name.localeCompare(b.name))
    const cs = await getDocs(query(collection(db, 'campaigns'), where('memberUids', 'array-contains', viewer))).catch(() => null)
    await Promise.all((cs?.docs ?? []).filter((d) => (d.data().memberUids ?? []).includes(target)).map(async (d) => {
      const c = d.data()
      const p = await getDoc(doc(db, 'campaigns', d.id, 'participants', target)).catch(() => null)
      const part = p?.exists() ? (p.data() as CampaignParticipant) : null
      campaigns.push({ id: d.id, name: c.name ?? '', status: c.status ?? 'planning', worldId: c.worldId ?? null, worldName: c.worldName ?? '', role: part?.role ?? 'player', characterName: part?.characterName ?? '' })
    }))
    campaigns.sort((a, b) => a.name.localeCompare(b.name))
  }
  const anyMember = worlds[0]?.member
  return { profile, name: profile?.displayName ?? anyMember?.displayName ?? '', photoURL: profile?.photoURL ?? anyMember?.photoURL ?? null, worlds, campaigns }
}
