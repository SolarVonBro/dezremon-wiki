// Accurate Pathfinder 2e (Remaster) Bulk, Container, Coin, Encumbrance, and Wealth calculation engine.
//
// PF2e Remaster Rules implemented:
// 1. Bulk units: Negligible = 0, Light (L) = 0.1 Bulk. 10 L = 1 Bulk (floored — 9L = 0 Bulk, 10L = 1 Bulk, 19L = 1 Bulk).
//    We represent everything internally in integer "light units" (1 L = 1, 1 Bulk = 10) to avoid IEEE-754 float errors!
// 2. Coins: 1,000 coins of any denomination = 1 Bulk (floored: 999 coins = 0 Bulk, 1,000 = 1 Bulk, 2,500 = 2 Bulk).
// 3. Stack items (`bulkPer`, e.g., 10 arrows = 1L): Math.ceil(quantity / per) * unitBulkLight (0 if quantity <= 0).
// 4. Carry states:
//    - worn: uses item's worn Bulk (`bulk`).
//    - held: uses item's held/stowed Bulk (`bulkHeld`).
//    - stowed: placed inside a container, uses `bulkHeld`.
//    - dropped (or inside a dropped container): does NOT count toward character's carried Bulk!
// 5. Containers:
//    - Regular containers (e.g., Sack, Chest): `ignored = 0` -> full content Bulk adds to carried Bulk.
//    - Backpacks (non-extradimensional with `ignored > 0`, e.g., Backpack `capacity: 4, ignored: 2`):
//      Only ignore up to `ignored` Bulk of contents while WORN! And per PF2e rules, you benefit from ignoring bulk from
//      at most ONE worn non-extradimensional backpack at a time (extra worn backpacks warn & don't double-negate).
//    - Extradimensional containers (e.g., Spacious Pouch / Bag of Holding, `extradimensional: true`):
//      Ignore up to `ignored` Bulk of contents whether worn, held, or stowed!
//      Warns if an extradimensional container is placed inside another extradimensional container (PF2e rule hazard!).
//    - Capacity check: warns when contents exceed `capacity` (if `capacity > 0`).
//    - Nested containers: recursively computed with cycle protection!
// 6. Encumbrance thresholds:
//    - Encumbered limit: 5 + strMod + bulkBonus (if effective Bulk > limit -> Encumbered: -10 ft Speed, Clumsy 1)
//    - Maximum limit: 10 + strMod + bulkBonus (cannot carry more than this!)
// 7. Invested items: tracks invested count vs maxInvested (default 10).

import type { Pf2eCharacter, Pf2eContainer, Pf2eInventoryItem, Pf2eItemIndex } from '@/model/pf2e'

/** Convert Bulk number (0, 0.1, 1, 2...) to integer Light units (0, 1, 10, 20...). */
export function bulkToLight(bulk: number): number {
  if (!Number.isFinite(bulk) || bulk <= 0) return 0
  return Math.round(bulk * 10)
}

/** Floor Light units to whole Bulk (PF2e: 9L -> 0, 10L -> 1, 19L -> 1). */
export function lightToWholeBulk(light: number): number {
  return Math.floor(Math.max(0, light) / 10)
}

/** Format Light units into readable RU/EN string: e.g. 0 -> "—", 3 -> "3 Л", 14 -> "1 Б, 4 Л" (or "1.4"). */
export function formatLight(light: number, lang: 'ru' | 'en' = 'ru'): string {
  const n = Math.max(0, Math.round(light))
  if (n === 0) return '—'
  const b = Math.floor(n / 10)
  const l = n % 10
  const unitL = lang === 'ru' ? 'Л' : 'L'
  const unitB = lang === 'ru' ? 'Б' : 'B'
  if (b === 0) return `${l} ${unitL}`
  if (l === 0) return `${b} ${unitB}`
  return `${b} ${unitB}, ${l} ${unitL}`
}

/** Format a single item's unit bulk (0 -> "—", 0.1 -> "Л"/"L", 1 -> "1", etc.). */
export function formatUnitBulk(bulk: number, lang: 'ru' | 'en' = 'ru'): string {
  const l = bulkToLight(bulk)
  if (l === 0) return '—'
  if (l === 1) return lang === 'ru' ? 'Л' : 'L'
  if (l % 10 === 0) return String(l / 10)
  return formatLight(l, lang)
}

/** Format copper pieces into clean PF2e currency string (пм/зм/см/мм or pp/gp/sp/cp). */
export function formatPriceCp(cp: number, lang: 'ru' | 'en' = 'ru'): string {
  const total = Math.max(0, Math.round(cp))
  if (total === 0) return lang === 'ru' ? 'Бесплатно' : 'Free'
  const gp = Math.floor(total / 100)
  const sp = Math.floor((total % 100) / 10)
  const remCp = total % 10
  const parts: string[] = []
  if (gp > 0) parts.push(`${gp.toLocaleString('ru-RU')} ${lang === 'ru' ? 'зм' : 'gp'}`)
  if (sp > 0) parts.push(`${sp} ${lang === 'ru' ? 'см' : 'sp'}`)
  if (remCp > 0) parts.push(`${remCp} ${lang === 'ru' ? 'мм' : 'cp'}`)
  return parts.join(', ')
}

export interface ItemBulkInfo {
  unitWornLight: number
  unitHeldLight: number
  per: number
  totalLight: number // 0 if dropped
  rawLight: number // ignoring dropped state (for display)
  priceCp: number
  totalPriceCp: number
  isInvestable: boolean
}

export function computeItemBulk(
  row: Pf2eInventoryItem,
  catalogItem: Pf2eItemIndex | undefined,
): ItemBulkInfo {
  const wornBulk = row.bulkOverride != null ? row.bulkOverride : (catalogItem?.bulk ?? 0)
  const heldBulk = row.bulkHeldOverride != null ? row.bulkHeldOverride : (catalogItem?.bulkHeld ?? wornBulk)
  const per = Math.max(1, row.bulkPerOverride != null ? row.bulkPerOverride : (catalogItem?.bulkPer ?? 1))
  const priceCp = row.priceCpOverride != null ? row.priceCpOverride : (catalogItem?.priceCp ?? 0)
  const pricePer = Math.max(1, catalogItem?.pricePer ?? 1)

  const unitWornLight = bulkToLight(wornBulk)
  const unitHeldLight = bulkToLight(heldBulk)
  const qty = Math.max(0, row.quantity || 0)

  const activeUnit = row.carryType === 'worn' ? unitWornLight : unitHeldLight
  let rawLight = 0
  if (qty > 0 && activeUnit > 0) {
    if (per >= 1000) {
      // Coin-style stack: 1000 coins = 1 Bulk (floored)
      rawLight = Math.floor(qty / per) * activeUnit
    } else if (per > 1) {
      // Ammo-style stack: 1..10 arrows = 1L, 11..20 = 2L
      rawLight = Math.ceil(qty / per) * activeUnit
    } else {
      rawLight = qty * activeUnit
    }
  }

  return {
    unitWornLight,
    unitHeldLight,
    per,
    rawLight,
    totalLight: row.carryType === 'dropped' ? 0 : rawLight,
    priceCp,
    totalPriceCp: Math.round((qty / pricePer) * priceCp),
    isInvestable: Boolean(catalogItem?.invested),
  }
}

export interface ContainerStats {
  id: string
  /** Own bulk of container (in Light units) */
  ownLight: number
  /** Sum of items + child containers inside (in Light units) */
  contentsLight: number
  /** Capacity in Light units (0 = unlimited) */
  capacityLight: number
  /** How much content bulk is actually ignored right now (in Light units) */
  ignoredLight: number
  /** Effective bulk contributed to parent/character (own + max(0, contents - ignored)), 0 if dropped */
  contributedLight: number
  /** True if container (or an ancestor) is dropped / not carried */
  effectivelyDropped: boolean
  overCapacity: boolean
  extraDimNestWarning: boolean
  secondBackpackWarning: boolean
  itemCount: number
}

export interface BulkSummary {
  /** Total carried Light units (items outside containers + carried containers + coins) */
  totalLight: number
  /** Whole effective Bulk for encumbrance (Math.floor(totalLight / 10)) */
  effectiveBulk: number
  /** Remainder Light units (totalLight % 10) */
  remainderLight: number
  /** Encumbered threshold: 5 + strMod + bulkBonus */
  encumberedAt: number
  /** Max carrying capacity: 10 + strMod + bulkBonus */
  maxBulk: number
  status: 'ok' | 'encumbered' | 'overloaded'
  /** Coins stats */
  totalCoinsCount: number
  coinsLight: number // whole Bulk * 10 (floor(coins / 1000) * 10)
  coinsValueCp: number
  /** Wealth */
  itemsValueCp: number
  totalWealthCp: number
  /** Invested */
  investedCount: number
  maxInvested: number
  overInvested: boolean
  /** Per-container stats */
  byContainer: Record<string, ContainerStats>
  /** Per-item computed info */
  byItem: Record<string, ItemBulkInfo>
  /** Active rule warnings */
  warnings: string[]
}

export function computeCharacterBulk(
  char: Pf2eCharacter,
  catalogById: Map<string, Pf2eItemIndex>,
): BulkSummary {
  const warnings: string[] = []
  const containersById = new Map<string, Pf2eContainer>(char.containers.map((c) => [c.id, c]))
  const byItem: Record<string, ItemBulkInfo> = {}

  let itemsValueCp = 0
  let investedCount = 0

  for (const row of char.inventory) {
    const cat = row.itemId ? catalogById.get(row.itemId) : undefined
    const info = computeItemBulk(row, cat)
    byItem[row.id] = info
    itemsValueCp += info.totalPriceCp
    if (row.invested) investedCount++
  }

  for (const c of char.containers) {
    if (c.priceCp) itemsValueCp += c.priceCp
    else if (c.itemId) {
      const cat = catalogById.get(c.itemId)
      if (cat) itemsValueCp += cat.priceCp
    }
    if (c.invested) investedCount++
  }

  // Coins
  const coins = char.coins ?? { pp: 0, gp: 0, sp: 0, cp: 0, containerId: null, dropped: false }
  const totalCoinsCount = Math.max(0, (coins.pp || 0) + (coins.gp || 0) + (coins.sp || 0) + (coins.cp || 0))
  const coinsLight = Math.floor(totalCoinsCount / 1000) * 10
  const coinsValueCp = (coins.pp || 0) * 1000 + (coins.gp || 0) * 100 + (coins.sp || 0) * 10 + (coins.cp || 0)

  // Determine which containers are effectively dropped (self or any ancestor dropped, cycle-safe)
  function isEffectivelyDropped(cid: string, seen = new Set<string>()): boolean {
    if (seen.has(cid)) return false
    seen.add(cid)
    const c = containersById.get(cid)
    if (!c) return false
    if (c.carryType === 'dropped') return true
    if (c.carryType === 'stowed' && c.parentContainerId && containersById.has(c.parentContainerId)) {
      return isEffectivelyDropped(c.parentContainerId, seen)
    }
    return false
  }

  function hasExtradimAncestor(cid: string, seen = new Set<string>()): boolean {
    if (seen.has(cid)) return false
    seen.add(cid)
    const c = containersById.get(cid)
    if (!c || c.carryType !== 'stowed' || !c.parentContainerId) return false
    const p = containersById.get(c.parentContainerId)
    if (!p) return false
    return p.extradimensional || hasExtradimAncestor(p.id, seen)
  }

  // Only one worn non-extradimensional backpack can grant its ignored-bulk benefit (PF2e Core rule)
  let usedWornBackpackBonus = false
  const wornBackpackWinner = new Set<string>()
  for (const c of char.containers) {
    if (!c.extradimensional && c.ignored > 0 && c.carryType === 'worn' && !isEffectivelyDropped(c.id)) {
      if (!usedWornBackpackBonus) {
        usedWornBackpackBonus = true
        wornBackpackWinner.add(c.id)
      }
    }
  }

  // Memoized recursive calculation of container bulk
  const byContainer: Record<string, ContainerStats> = {}
  const visiting = new Set<string>()

  function calcContainer(cid: string): ContainerStats {
    if (byContainer[cid]) return byContainer[cid]
    const c = containersById.get(cid)!
    const effDropped = isEffectivelyDropped(cid)
    if (visiting.has(cid)) {
      return {
        id: cid, ownLight: 0, contentsLight: 0, capacityLight: 0, ignoredLight: 0, contributedLight: 0,
        effectivelyDropped: effDropped, overCapacity: false, extraDimNestWarning: false, secondBackpackWarning: false, itemCount: 0,
      }
    }
    visiting.add(cid)

    let contentsLight = 0
    let itemCount = 0

    // Direct items stowed inside this container
    for (const row of char.inventory) {
      if (row.carryType === 'stowed' && row.containerId === cid) {
        contentsLight += byItem[row.id].rawLight
        itemCount++
      }
    }

    // Coins stowed inside this container
    if (!coins.dropped && coins.containerId === cid && coinsLight > 0) {
      contentsLight += coinsLight
    }

    // Nested child containers stowed inside this container
    for (const child of char.containers) {
      if (child.id !== cid && child.carryType === 'stowed' && child.parentContainerId === cid) {
        const childStats = calcContainer(child.id)
        // Inside a parent container, the child contributes its own held/stowed bulk + its non-ignored contents
        contentsLight += childStats.contributedLight
        itemCount++
      }
    }

    const ownLight = c.carryType === 'worn' ? bulkToLight(c.bulk) : bulkToLight(c.bulkHeld)
    const capacityLight = bulkToLight(c.capacity)
    const maxIgnoredLight = bulkToLight(c.ignored)

    let allowedIgnored = 0
    let secondBackpackWarning = false
    if (c.extradimensional) {
      allowedIgnored = maxIgnoredLight
    } else if (maxIgnoredLight > 0 && c.carryType === 'worn') {
      if (wornBackpackWinner.has(c.id)) allowedIgnored = maxIgnoredLight
      else secondBackpackWarning = true
    }

    const ignoredLight = Math.min(contentsLight, allowedIgnored)
    const extraDimNestWarning = c.extradimensional && hasExtradimAncestor(cid)
    const overCapacity = capacityLight > 0 && contentsLight > capacityLight

    const contributedLight = effDropped ? 0 : ownLight + Math.max(0, contentsLight - ignoredLight)

    const stats: ContainerStats = {
      id: cid,
      ownLight,
      contentsLight,
      capacityLight,
      ignoredLight,
      contributedLight,
      effectivelyDropped: effDropped,
      overCapacity,
      extraDimNestWarning,
      secondBackpackWarning,
      itemCount,
    }
    visiting.delete(cid)
    byContainer[cid] = stats
    return stats
  }

  for (const c of char.containers) calcContainer(c.id)

  // Sum top-level carried bulk
  let totalLight = 0

  // 1. Items NOT stowed in a valid container (worn / held / orphaned stowed)
  for (const row of char.inventory) {
    if (row.carryType === 'dropped') continue
    if (row.carryType === 'stowed' && row.containerId && containersById.has(row.containerId)) continue
    totalLight += byItem[row.id].totalLight
  }

  // 2. Top-level carried containers (not stowed inside another valid container)
  for (const c of char.containers) {
    const isNested = c.carryType === 'stowed' && c.parentContainerId && containersById.has(c.parentContainerId)
    if (isNested) continue
    const st = byContainer[c.id]
    totalLight += st.contributedLight
    if (st.overCapacity && !st.effectivelyDropped) {
      warnings.push(`Контейнер «${c.name}» переполнен (${formatLight(st.contentsLight)} из ${formatLight(st.capacityLight)})`)
    }
    if (st.secondBackpackWarning) {
      warnings.push(`«${c.name}»: по правилам PF2e снижение массы работает только от одного надетого рюкзака`)
    }
  }

  // Also check warnings on nested containers
  for (const c of char.containers) {
    const st = byContainer[c.id]
    if (st.extraDimNestWarning) {
      warnings.push(`«${c.name}» помещён в другой экстрапространственный контейнер — по правилам PF2e это опасно и нарушает работу обоих!`)
    }
    const isNested = c.carryType === 'stowed' && c.parentContainerId && containersById.has(c.parentContainerId)
    if (isNested && st.overCapacity && !st.effectivelyDropped) {
      warnings.push(`Контейнер «${c.name}» переполнен (${formatLight(st.contentsLight)} из ${formatLight(st.capacityLight)})`)
    }
  }

  // 3. Coins on person (not dropped and not in a valid container)
  if (!coins.dropped && (!coins.containerId || !containersById.has(coins.containerId))) {
    totalLight += coinsLight
  }

  const effectiveBulk = lightToWholeBulk(totalLight)
  const remainderLight = totalLight % 10
  const str = Number.isFinite(char.strMod) ? char.strMod : 0
  const bonus = Number.isFinite(char.bulkBonus) ? char.bulkBonus : 0
  const encumberedAt = Math.max(0, 5 + str + bonus)
  const maxBulk = Math.max(0, 10 + str + bonus)
  const status: BulkSummary['status'] =
    effectiveBulk > maxBulk ? 'overloaded' : effectiveBulk > encumberedAt ? 'encumbered' : 'ok'

  const maxInvested = Math.max(0, char.maxInvested ?? 10)
  const overInvested = investedCount > maxInvested
  if (overInvested) {
    warnings.push(`Превышен лимит инвестируемых предметов: ${investedCount} из ${maxInvested}`)
  }

  return {
    totalLight,
    effectiveBulk,
    remainderLight,
    encumberedAt,
    maxBulk,
    status,
    totalCoinsCount,
    coinsLight,
    coinsValueCp,
    itemsValueCp,
    totalWealthCp: itemsValueCp + coinsValueCp,
    investedCount,
    maxInvested,
    overInvested,
    byContainer,
    byItem,
    warnings,
  }
}
