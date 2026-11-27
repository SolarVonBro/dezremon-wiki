// Data models for Pathfinder 2e (Remaster) static catalogs (spells & equipment) and user characters.

export type Pf2eLang = 'ru' | 'en'
export type Pf2eTradition = 'arcane' | 'divine' | 'occult' | 'primal'
export type Pf2eRarity = 'common' | 'uncommon' | 'rare' | 'unique'
export type Pf2eAttribute = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
export type Pf2eProficiency = 0 | 1 | 2 | 3 | 4 // Untrained, Trained, Expert, Master, Legendary
export type Pf2eSpellCategory = 'spell' | 'cantrip' | 'focus' | 'ritual' | 'impossible'
export type Pf2eSaveType = 'fortitude' | 'reflex' | 'will'
export type Pf2eAreaType = 'burst' | 'cone' | 'emanation' | 'line' | 'cube' | 'cylinder' | 'square'
export type Pf2eItemType = 'weapon' | 'armor' | 'shield' | 'equipment' | 'consumable' | 'backpack' | 'ammo' | 'treasure' | 'kit'
export type Pf2eCarryType = 'worn' | 'held' | 'stowed' | 'dropped'

// ======================= Static Catalog (Index + Details) =======================

export interface Pf2eSpellIndex {
  id: string
  slug: string
  en: string
  ru: string
  img: string
  rank: number // 0 = cantrip, 1..10 = spell rank
  baseRank: number // original Foundry rank (1..10 even for cantrips)
  cat: Pf2eSpellCategory
  traditions: Pf2eTradition[]
  rarity: Pf2eRarity
  traits: string[]
  time: string // raw Foundry time ('1','2','3','reaction','free','1 to 3','1 minute',...)
  timeBucket: string // normalized bucket ('free','reaction','1','2','3','var','1m','10m','1h','long')
  timeRu: string
  range: string
  rangeRu: string
  rangeFt: number | null // numeric feet, 0 = touch, -1 = self/personal, null = special/unlimited
  rangeBucket: string // 'self' | 'touch' | 'short' (<=30) | 'med' (35-60) | 'long' (65-120) | 'far' (>120) | 'special'
  target: string
  targetRu: string
  areaType: Pf2eAreaType | null
  areaVal: number | null
  duration: string
  durationRu: string
  durationBucket: string // 'instant' | 'round' | 'rounds' | '1m' | '10m' | '1h' | '8h' | 'day' | 'unlimited' | 'other'
  sustained: boolean
  defenseKind: 'none' | 'attack' | 'save' | 'both'
  save: Pf2eSaveType | null
  basicSave: boolean
  damageTypes: string[]
  hasPersistent: boolean
  hasHealing: boolean
  conditions: string[] // normalized condition slugs mentioned in description
  heightenType: 'none' | 'interval' | 'fixed'
  heightenStep: number | null // e.g., 1, 2, 3 for interval
  heightenLevels: number[] // e.g., [3, 5, 7] for fixed
  hasCost: boolean
  cost: string
  costRu: string
  hasReq: boolean
  req: string
  reqRu: string
  counteract: boolean
  ritual: { primaryCheck: string; secondaryCasters: number; secondaryChecks: string } | null
  deities: string[] // deity names that grant this spell
  pub: string
  remaster: boolean
}

export interface Pf2eSpellDetail {
  desc: string // HTML (with Foundry enrichers preserved for rich rendering)
}

export interface Pf2eItemIndex {
  id: string
  slug: string
  en: string
  ru: string
  img: string
  type: Pf2eItemType
  level: number
  rarity: Pf2eRarity
  traits: string[]
  priceCp: number // price converted to copper pieces (0 = free / no price)
  pricePer: number // e.g., 10 for arrows
  priceText: string // e.g., "15 gp", "1 sp (за 10)"
  bulk: number // worn bulk: 0 = negligible, 0.1 = L, 1, 2...
  bulkHeld: number // held/stowed bulk (often same as bulk, higher for armor/backpacks)
  bulkPer: number // items per unit of bulk (1 for normal, 10 for arrows, 1000 for coins)
  capacity: number // container capacity in Bulk (0 if not a container)
  ignored: number // container ignored Bulk (e.g., 2 for backpack, 25..150 for spacious pouch)
  stowing: boolean // true if items can be stowed in it
  extradimensional: boolean
  usage: string // raw Foundry usage key
  usageGroup: string // normalized slot group ('held1','held2','worn','worn-slot','affixed','etched','applied','carried','other')
  hands: number | null // 0, 1, 2 for held/weapons
  category: string // weapon/armor/consumable/treasure category
  group: string // weapon/armor group
  baseItem: string
  material: string // precious material slug or ''
  grade: string // 'low' | 'standard' | 'high' | ''
  size: string // 'sm' | 'med' | 'lg' | 'huge'
  // Weapon fields
  die: string // 'd4'..'d12' or ''
  diceNum: number
  dmgType: string
  wRange: number | null // feet
  reload: string // '-', '0', '1', '2', '10'
  isRanged: boolean
  isThrown: boolean
  isSpecific: boolean
  isStaff: boolean
  // Armor / Shield fields
  acBonus: number | null
  dexCap: number | null
  checkPenalty: number | null
  speedPenalty: number | null
  strReq: number | null
  hardness: number | null
  hp: number | null
  // Magic / Mechanics
  apex: Pf2eAttribute | ''
  invested: boolean
  magical: boolean
  alchemical: boolean
  cursed: boolean
  artifact: boolean
  hasActivation: boolean
  actActions: string[] // '1','2','3','free','reaction','long'
  isRune: boolean
  pub: string
  remaster: boolean
}

export interface Pf2eItemDetail {
  desc: string
}

export interface Pf2eMeta {
  version: string
  builtAt: string
  spellCount: number
  itemCount: number
  traits: Record<string, { en: string; ru: string }>
  conditions: Record<string, { en: string; ru: string }>
  damageTypes: Record<string, { en: string; ru: string }>
  weaponGroups: Record<string, { en: string; ru: string }>
  armorGroups: Record<string, { en: string; ru: string }>
  consumableCats: Record<string, { en: string; ru: string }>
  materials: Record<string, { en: string; ru: string }>
  usages: Record<string, { en: string; ru: string }>
  deities: string[]
  spellPubs: string[]
  itemPubs: string[]
}

// ======================= User PF2e Character =======================

export type Pf2eCastingType = 'prepared' | 'spontaneous' | 'focus' | 'innate' | 'ritual'

export interface Pf2eSpellEntryItem {
  id: string // unique row id in this spell list
  spellId: string | null // null for custom/homebrew spells
  customName?: string
  customNote?: string
  rank: number // 0 = cantrip, 1..10 = rank in this list (can be heightened!)
  signature?: boolean // spontaneous signature spell
  preparedCount?: number // how many times prepared in this rank (prepared casters)
  expendedCount?: number // how many times cast today
  usesMax?: number // for innate spells (e.g., 1/day, 0 = at will)
  usesLeft?: number
  atWill?: boolean
  notes?: string
}

export interface Pf2eSpellList {
  id: string
  name: string
  castingType: Pf2eCastingType
  tradition: Pf2eTradition | ''
  keyAttr: Pf2eAttribute
  keyMod: number // character's modifier for keyAttr (-5..+10)
  proficiency: Pf2eProficiency // 0=U, 1=T, 2=E, 3=M, 4=L
  bonusAttack: number // misc item/status bonus to spell attack
  bonusDc: number // misc item/status bonus to spell DC
  flexible?: boolean // Flexible Spellcaster archetype for prepared casters
  /** Max slots per rank "1".."10" */
  slotsMax: Record<number, number>
  /** Expended slots per rank "1".."10" (for spontaneous / flexible) */
  slotsUsed: Record<number, number>
  /** Focus pool (for focus entry) */
  focusMax?: number
  focusCurrent?: number
  classPreset?: string
  notes?: string
  spells: Pf2eSpellEntryItem[]
}

export interface Pf2eContainer {
  id: string
  itemId: string | null // catalog backpack item id, or null for custom container
  name: string
  carryType: Pf2eCarryType // 'worn' | 'held' | 'stowed' | 'dropped'
  parentContainerId: string | null // nested container support
  /** Container's own bulk when worn vs held/stowed */
  bulk: number
  bulkHeld: number
  /** Max bulk of items it can hold (0 = unlimited/custom) */
  capacity: number
  /** How much Bulk inside is ignored (e.g., 2 for worn backpack, 25..150 for spacious pouch) */
  ignored: number
  /** Extradimensional containers ignore bulk regardless of worn/held; regular backpacks only when worn */
  extradimensional: boolean
  /** Ignore all contents & own bulk (e.g., left in camp / on mount / wagon) — same as carryType === 'dropped' */
  collapsed?: boolean
  invested?: boolean
  priceCp?: number
  notes?: string
  order: number
}

export interface Pf2eInventoryItem {
  id: string
  itemId: string | null // null for custom homebrew item
  name: string // custom override or custom item name (empty = use catalog name in current language)
  customType?: Pf2eItemType
  quantity: number
  carryType: Pf2eCarryType // 'worn' | 'held' | 'stowed' | 'dropped'
  containerId: string | null // when carryType === 'stowed'
  group: string // user-defined group/tag ("Алхимия", "Квестовое", ...)
  invested: boolean
  /** Overrides (null/undefined = take from catalog) */
  bulkOverride?: number | null // worn bulk override
  bulkHeldOverride?: number | null // held/stowed bulk override
  bulkPerOverride?: number | null
  priceCpOverride?: number | null
  levelOverride?: number | null
  notes: string
  order: number
}

export interface Pf2eCoins {
  pp: number
  gp: number
  sp: number
  cp: number
  /** Where coins are kept: null = on person (counts toward bulk), containerId = inside that container, 'dropped' = in stash/bank */
  containerId: string | null
  dropped?: boolean
}

export interface Pf2eCharacter {
  id: string
  name: string
  description: string
  portrait: string | null // 192px WebP data URL
  portraitSource?: string | null // 512px source for re-framing
  portraitCrop?: { x: number; y: number; zoom: number } | null
  level: number // 1..20
  strMod: number // -5..+10 for Bulk Encumbrance (5 + STR / 10 + STR)
  bulkBonus: number // e.g., +2 for Hefty Hauler, +3 for Ant Haul, etc.
  maxInvested: number // default 10 (12 for Incredible Investiture / Thaumaturge)
  coins: Pf2eCoins
  containers: Pf2eContainer[]
  inventory: Pf2eInventoryItem[]
  spellLists: Pf2eSpellList[]
  customGroups: string[]
  createdAt: number
  updatedAt: number
}
