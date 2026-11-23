// Character type: PC (a player's character) or NPC. It is stored in the free-form «Тип» field (entity.kind) as
// "PC" / "NPC", so lists can already filter by it. Every world has two tags marked fields.charType = 'pc' | 'npc'
// (created on a master's visit, see ensureCharTags in the world store); they follow the type of each character.
import type { Entity } from '@/model/types'

export type CharType = 'pc' | 'npc'
export const CHAR_TYPES: CharType[] = ['pc', 'npc']
/** What the type writes into the «Тип» field (also the default names of the tags). */
export const CHAR_TYPE_KIND: Record<CharType, string> = { pc: 'PC', npc: 'NPC' }
export const CHAR_TYPE_HINT: Record<CharType, string> = { pc: 'персонаж игрока', npc: 'неигровой персонаж' }
export const CHAR_TAG_COLOUR: Record<CharType, string> = { pc: '#c9a227', npc: '#7d8fa6' }

const ALIASES: Record<CharType, string[]> = {
  pc: ['pc', 'пк', 'игровой персонаж', 'персонаж игрока'],
  npc: ['npc', 'нпс', 'нпц', 'неигровой персонаж'],
}

/** The character type a «Тип» value stands for (null — none, or a free-form type like «бог»). */
export function charTypeOfKind(kind: string | null | undefined): CharType | null {
  const k = (kind ?? '').trim().toLowerCase()
  if (!k) return null
  return CHAR_TYPES.find((t) => ALIASES[t].includes(k)) ?? null
}

export type CharTagIds = Partial<Record<CharType, string>>

/**
 * Keeps a character's type and its PC / NPC tags in agreement after a change (prev = null for a new character).
 * The type changed → the tags follow it. Only the tags changed by hand → the type follows them, but a free-form
 * «Тип» (e.g. «бог») is never overwritten. Returns the extra fields to write (empty — nothing to fix).
 */
export function charTypeFix(prev: Pick<Entity, 'kind' | 'tagIds'> | null, next: Entity, ids: CharTagIds): Partial<Entity> {
  if (next.type !== 'character' || (!ids.pc && !ids.npc)) return {}
  const tPrev = prev ? charTypeOfKind(prev.kind) : null
  const tNext = charTypeOfKind(next.kind)
  const tags = new Set(next.tagIds ?? [])
  let kind = next.kind ?? ''
  if (!prev || tPrev !== tNext) {
    for (const t of CHAR_TYPES) {
      const id = ids[t]
      if (!id) continue
      if (t === tNext) tags.add(id); else tags.delete(id)
    }
  } else {
    const had = (t: CharType) => !!ids[t] && (prev.tagIds ?? []).includes(ids[t]!)
    const has = (t: CharType) => !!ids[t] && tags.has(ids[t]!)
    const added = CHAR_TYPES.find((t) => has(t) && !had(t))
    if (added) {
      const other: CharType = added === 'pc' ? 'npc' : 'pc'
      if (ids[other]) tags.delete(ids[other]!)
      if (!kind.trim() || (tNext && tNext !== added)) kind = CHAR_TYPE_KIND[added]
    } else if (tNext && had(tNext) && !has(tNext)) {
      kind = ''
    }
  }
  const patch: Partial<Entity> = {}
  if (kind !== (next.kind ?? '')) patch.kind = kind
  const before = new Set(next.tagIds ?? [])
  if (tags.size !== before.size || [...tags].some((x) => !before.has(x))) patch.tagIds = [...tags]
  return patch
}
