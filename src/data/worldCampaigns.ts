// The world's side of campaigns: the campaigns of the open world (followed while a world is open: all of them for
// its masters, the user's own for players) and everything that ties a campaign to the world — its tag (created with
// the campaign, renamed with it, set free when it is deleted), its music room (created with it, owned by its creator)
// and the one-time sorting out of older data (tags in quotes become campaigns, campaigns without a tag get one).
import { ref } from 'vue'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useWorld } from '@/stores/world'
import { characterIdsOf } from './access'
import { addParticipants, createCampaign, deleteCampaign, newCampaignId, normalizeCampaign, updateCampaign, watchWorldCampaigns } from './campaigns'
import { campaignTagColour, campaignTagName, isCampaignTag, isQuotedName, plainCampaignName } from './campaignTags'
import { plural } from './util'
import { createRoom, updateRoom } from './rooms'
import type { Campaign, CampaignFormat, CampaignStatus, Entity } from '@/model/types'

type UserLike = { uid: string; displayName: string | null; email: string | null; photoURL: string | null }

/** Campaigns of the open world the user may see (sorted by name). */
export const worldCampaigns = ref<Campaign[]>([])
let stop: (() => void) | null = null
let following = ''
export function followWorldCampaigns(wid: string | null, uid: string | null, all: boolean) {
  const key = wid && uid ? `${wid}|${uid}|${all}` : ''
  if (key === following) return
  following = key
  stop?.(); stop = null
  worldCampaigns.value = []
  if (wid && uid) stop = watchWorldCampaigns(wid, uid, (rows) => { worldCampaigns.value = rows }, all)
}

/** The campaign whose tag this is (among the campaigns the user sees). */
export const campaignOfTag = (tagId: string) => worldCampaigns.value.find((c) => c.tagId === tagId) ?? null

function tagVisibility() {
  const world = useWorld()
  return { visibility: world.world?.isPublic ? 'public' as const : 'members' as const, allowedUids: [] }
}

/**
 * The campaign's music room: same name, owned by whoever created the campaign, open to the campaign's members.
 * A failure here does not undo the campaign (the room can be made later on its «Комнаты» tab).
 */
async function createCampaignRoom(user: UserLike, cid: string, name: string): Promise<string | null> {
  try {
    const rid = await createRoom(user, { name, campaignId: cid, campaignName: name, access: 'campaign', controlMode: 'hosts' })
    await updateCampaign(cid, { roomId: rid })
    return rid
  } catch (e) {
    console.warn('campaign room', e)
    return null
  }
}

/** A master creates a campaign in the open world; its tag «⚔ name» appears in the world and its music room opens. */
export async function createWorldCampaign(user: UserLike, data: { name: string; description: string; status: CampaignStatus; schedule: string; cover: string | null; format: CampaignFormat | null; intro: Array<{ name: string; value: string }> }): Promise<string> {
  const world = useWorld()
  if (!world.wid || !world.world) throw new Error('Мир не открыт')
  const cid = newCampaignId()
  const tagId = await world.createEntity('tag', campaignTagName(data.name), { fields: { colour: campaignTagColour(data.name), campaignId: cid }, ...tagVisibility() })
  await createCampaign(user, { ...data, worldId: world.wid, worldName: world.world.name, tagId }, cid)
  await createCampaignRoom(user, cid, data.name)
  return cid
}

/** The campaign's name changed: its tag follows, and so does its music room while it still has the old name. */
export async function renameCampaignTag(c: Campaign, name: string) {
  const world = useWorld()
  const tag = c.tagId ? world.getAny(c.tagId) : null
  if (tag && !tag.deleted && world.wid === c.worldId) await world.updateEntity(tag.id, { name: campaignTagName(name) })
  if (c.roomId) {
    // only the room's owner and hosts may rename it; anyone else leaves it as it is
    const r = await getDoc(doc(db, 'rooms', c.roomId)).catch(() => null)
    if (r?.exists()) await updateRoom(c.roomId, r.data().name === c.name ? { name, campaignName: name } : { campaignName: name }).catch(() => {})
  }
}

/** Deletes a campaign; its tag stays in the world as an ordinary tag (articles keep it). */
export async function deleteWorldCampaign(c: Campaign) {
  const world = useWorld()
  await deleteCampaign(c.id)
  const tag = c.tagId ? world.getAny(c.tagId) : null
  if (tag && world.wid === c.worldId) {
    const fields = { ...tag.fields }
    delete fields.campaignId
    await world.updateEntity(tag.id, { name: plainCampaignName(tag.name), fields })
  }
}

/** Members of the world who play characters carrying this tag, with those characters. */
function playersOfTag(tagId: string) {
  const world = useWorld()
  const out: Array<{ uid: string; displayName: string; photoURL: string | null; characters: string[] }> = []
  for (const m of world.members) {
    const chars = characterIdsOf(m).filter((id) => world.getAny(id)?.tagIds?.includes(tagId))
    if (chars.length) out.push({ uid: m.uid, displayName: m.displayName, photoURL: m.photoURL, characters: chars })
  }
  return out
}

/**
 * Once per visit of the world's owner: tags written in quotes (the old way to mark a campaign) become campaigns
 * (with the members whose characters carry the tag as players, those characters as theirs), and campaigns of the
 * world without a tag get one. Campaign tags are renamed to «⚔ name». Returns a summary or '' if nothing changed.
 */
export async function ensureCampaignTags(user: UserLike): Promise<string> {
  const world = useWorld()
  const w = world.wid
  if (!w || !world.world || world.world.ownerId !== user.uid) return ''
  const snap = await getDocs(query(collection(db, 'campaigns'), where('worldId', '==', w)))
  const camps = snap.docs.map((d) => normalizeCampaign(d.id, d.data()))
  const tags = () => [...world.entities.values()].filter((e) => e.type === 'tag' && !e.isTemplate && !e.deleted)
  let newCampaigns = 0, newTags = 0
  const link = async (t: Entity, c: Pick<Campaign, 'id' | 'name' | 'tagId'>) => {
    await world.updateEntity(t.id, { name: campaignTagName(c.name), fields: { ...t.fields, campaignId: c.id } })
    if (c.tagId !== t.id) await updateCampaign(c.id, { tagId: t.id })
  }

  // 1) «"Вторая Лавина"» → the campaign «Вторая Лавина» (an existing one of that name takes the tag)
  for (const t of tags()) {
    if (isCampaignTag(t) || !isQuotedName(t.name)) continue
    const name = plainCampaignName(t.name)
    if (!name) continue
    let c: Pick<Campaign, 'id' | 'name' | 'tagId'> | undefined = camps.find((x) => !x.tagId && x.name.trim().toLowerCase() === name.toLowerCase())
    if (!c) {
      const cid = `${w}_${t.id}`
      const had = await getDoc(doc(db, 'campaigns', cid)).then((s) => s.exists()).catch(() => false)
      if (!had) {
        await createCampaign(user, { name, description: '', worldId: w, worldName: world.world.name, status: 'active', schedule: '', cover: null, tagId: t.id }, cid)
        await addParticipants(cid, playersOfTag(t.id).filter((p) => p.uid !== user.uid))
        await createCampaignRoom(user, cid, name)
        newCampaigns++
      }
      c = { id: cid, name, tagId: t.id }
    }
    await link(t, c)
  }

  // 2) campaigns without a tag: a tag of the same name becomes theirs, otherwise a new one
  for (const c of camps) {
    const all = tags()
    if (all.some((t) => t.fields?.campaignId === c.id)) {
      const t = all.find((x) => x.fields?.campaignId === c.id)!
      if (c.tagId !== t.id) await updateCampaign(c.id, { tagId: t.id })
      continue
    }
    const same = all.find((t) => !isCampaignTag(t) && plainCampaignName(t.name).toLowerCase() === c.name.trim().toLowerCase())
    if (same) { await link(same, c); continue }
    const tagId = await world.createEntity('tag', campaignTagName(c.name), { fields: { colour: campaignTagColour(c.name), campaignId: c.id }, ...tagVisibility() })
    await updateCampaign(c.id, { tagId })
    newTags++
  }
  const parts = []
  if (newCampaigns) parts.push(`${newCampaigns} ${plural(newCampaigns, 'игра', 'игры', 'игр')} из тегов в кавычках`)
  if (newTags) parts.push(`${newTags} ${plural(newTags, 'тег', 'тега', 'тегов')} для игр`)
  return parts.length ? 'Создано: ' + parts.join(', ') : ''
}
