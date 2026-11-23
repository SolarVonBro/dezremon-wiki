// Every campaign has a tag in its world: a tag article with fields.campaignId = the campaign's id, named «⚔ name».
// The crossed swords set campaign tags apart wherever a tag name is shown (chips, lists, pickers, search) without
// brackets or quotes around the name; older worlds marked campaign tags by quotes («"Вторая Лавина"»).
import type { Entity } from '@/model/types'

export const CAMPAIGN_MARK = '⚔'

export const campaignTagName = (campaignName: string) => `${CAMPAIGN_MARK} ${campaignName.trim()}`

const QUOTED = /^\s*["«„“”'](.+?)["»“”']\s*$/

/** An older campaign tag: the whole name in quotes. */
export const isQuotedName = (name: string) => QUOTED.test(name)

/** The campaign's name inside a tag name: without the mark and without quotes. */
export function plainCampaignName(tagName: string): string {
  let n = tagName.trim()
  if (n.startsWith(CAMPAIGN_MARK)) n = n.slice(CAMPAIGN_MARK.length).trim()
  const m = n.match(QUOTED)
  return (m ? m[1] : n).trim()
}

export const isCampaignTag = (e: Entity | null | undefined): boolean => !!e && e.type === 'tag' && typeof e.fields?.campaignId === 'string' && !!e.fields.campaignId

/** Muted colours for new campaign tags (picked by the name, so the same campaign keeps its colour). */
const PALETTE = ['#b5654a', '#6a7fc1', '#4f9d69', '#a07cc5', '#c4a35a', '#4f9aa8', '#c1708a', '#8c8c5a']
export function campaignTagColour(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
