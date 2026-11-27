// Pathfinder 2e (Remaster, updated through Nov 2026: Player Core 1 & 2, War of Immortals,
// Dark Archive Remastered, Impossible Magic, Feybound) spellcasting math & official class presets.
import type { Pf2eAttribute, Pf2eCastingType, Pf2eProficiency, Pf2eSpellList, Pf2eTradition } from '@/model/pf2e'

export const PF2E_TRADITIONS: Array<{ id: Pf2eTradition; ru: string; en: string; color: string }> = [
  { id: 'arcane', ru: 'Арканная', en: 'Arcane', color: '#3b82f6' },
  { id: 'divine', ru: 'Сакральная', en: 'Divine', color: '#eab308' },
  { id: 'occult', ru: 'Оккультная', en: 'Occult', color: '#a855f7' },
  { id: 'primal', ru: 'Первородная', en: 'Primal', color: '#22c55e' },
]

export const PF2E_ATTRIBUTES: Array<{ id: Pf2eAttribute; ru: string; shortRu: string; en: string }> = [
  { id: 'str', ru: 'Сила', shortRu: 'СИЛ', en: 'STR' },
  { id: 'dex', ru: 'Ловкость', shortRu: 'ЛОВ', en: 'DEX' },
  { id: 'con', ru: 'Телосложение', shortRu: 'ТЕЛ', en: 'CON' },
  { id: 'int', ru: 'Интеллект', shortRu: 'ИНТ', en: 'INT' },
  { id: 'wis', ru: 'Мудрость', shortRu: 'МДР', en: 'WIS' },
  { id: 'cha', ru: 'Харизма', shortRu: 'ХАР', en: 'CHA' },
]

export const PF2E_PROFICIENCIES: Array<{ rank: Pf2eProficiency; ru: string; shortRu: string; en: string; bonus: number }> = [
  { rank: 0, ru: 'Нетренирован', shortRu: 'Н', en: 'Untrained', bonus: 0 },
  { rank: 1, ru: 'Тренирован', shortRu: 'Т', en: 'Trained', bonus: 2 },
  { rank: 2, ru: 'Эксперт', shortRu: 'Э', en: 'Expert', bonus: 4 },
  { rank: 3, ru: 'Мастер', shortRu: 'М', en: 'Master', bonus: 6 },
  { rank: 4, ru: 'Легенда', shortRu: 'Л', en: 'Legendary', bonus: 8 },
]

export const PF2E_CASTING_TYPES: Array<{ id: Pf2eCastingType; ru: string; en: string; hint: string }> = [
  { id: 'prepared', ru: 'Подготавливаемые', en: 'Prepared', hint: 'Волшебник, Жрец, Друид, Ведьма, Анимист, Некромант, Магус' },
  { id: 'spontaneous', ru: 'Спонтанные', en: 'Spontaneous', hint: 'Чародей, Бард, Оракул, Псионик, Призыватель, Анимист (Явления)' },
  { id: 'focus', ru: 'Фокусные', en: 'Focus', hint: 'Очки фокуса (1–3), автоусиление до ⌈уровня/2⌉' },
  { id: 'innate', ru: 'Врождённые', en: 'Innate', hint: 'От родословной, черт или предметов (использования в день)' },
  { id: 'ritual', ru: 'Ритуалы', en: 'Rituals', hint: 'Внебоевые ритуалы с проверками навыков' },
]

/** PF2e Remaster proficiency bonus: Untrained = 0 (no level!), Trained..Legendary = level + 2*rank */
export function proficiencyBonus(level: number, rank: Pf2eProficiency): number {
  if (rank <= 0) return 0
  return Math.max(1, level) + rank * 2
}

/** Spell Attack modifier & Spell DC for a spellcasting entry at character level */
export function computeSpellStats(level: number, entry: Pf2eSpellList): { attack: number; dc: number; profBonus: number } {
  const profBonus = proficiencyBonus(level, entry.proficiency)
  const base = profBonus + (entry.keyMod || 0)
  return {
    profBonus,
    attack: base + (entry.bonusAttack || 0),
    dc: 10 + base + (entry.bonusDc || 0),
  }
}

/** Auto-heightened rank of cantrips and focus spells in PF2e: ceil(level / 2) */
export function autoRank(level: number): number {
  return Math.max(1, Math.min(10, Math.ceil(Math.max(1, level) / 2)))
}

/** Full spellcaster proficiency progression (Wizard, Cloistered Cleric, Druid, Witch, Animist, Sorcerer, Bard, Oracle, Psychic, Necromancer) */
export function fullCasterProficiency(level: number): Pf2eProficiency {
  if (level >= 19) return 4 // Legendary
  if (level >= 15) return 3 // Master
  if (level >= 7) return 2 // Expert
  return 1 // Trained
}

/** Martial/gish spellcaster proficiency progression (Magus, Summoner, Champion): Expert 9, Master 17 */
export function martialCasterProficiency(level: number): Pf2eProficiency {
  if (level >= 17) return 3 // Master
  if (level >= 9) return 2 // Expert
  return 1 // Trained
}

/** Warpriest Cleric proficiency progression (Player Core): Expert 11, Master 19 */
export function warpriestProficiency(level: number): Pf2eProficiency {
  if (level >= 19) return 3 // Master
  if (level >= 11) return 2 // Expert
  return 1 // Trained
}

/** Multiclass / Spellcasting Archetype proficiency progression (Player Core): Expert 12, Master 18 */
export function archetypeCasterProficiency(level: number): Pf2eProficiency {
  if (level >= 18) return 3 // Master
  if (level >= 12) return 2 // Expert
  return 1 // Trained
}

export interface ClassPreset {
  id: string
  ru: string
  castingType: Pf2eCastingType
  tradition: Pf2eTradition | ''
  keyAttr: Pf2eAttribute
  slotsForLevel: (level: number) => Record<number, number>
  proficiencyForLevel: (level: number) => Pf2eProficiency
  note?: string
}

function standardCasterSlots(level: number, perRank: 2 | 3 | 4, rank10At19 = 1, rank10At20 = rank10At19): Record<number, number> {
  const lvl = Math.max(1, Math.min(20, Math.floor(level)))
  const out: Record<number, number> = {}
  const maxRank = Math.min(rank10At19 > 0 || rank10At20 > 0 ? 10 : 9, Math.ceil(lvl / 2))
  for (let r = 1; r <= maxRank; r++) {
    if (r === 10) {
      const cnt = lvl >= 20 ? rank10At20 : lvl >= 19 ? rank10At19 : 0
      if (cnt > 0) out[10] = cnt
    } else if (r === maxRank && lvl % 2 === 1 && lvl < 19) {
      // Odd level (1..17) unlocks the new rank with (perRank - 1) slots (1 for 2-slot, 2 for 3-slot, 3 for 4-slot)
      out[r] = Math.max(1, perRank - 1)
    } else {
      out[r] = perRank
    }
  }
  return out
}

/** Animist Apparition Spontaneous slots (War of Immortals):
 * Lvl 1-9: 1 slot per available rank (1..5).
 * Lvl 10+: 2 slots for ranks 1..(maxRank - 2) [capped at 8], 1 slot for top 2 ranks (including 10th at lvl 19-20). */
function animistApparitionSlots(level: number): Record<number, number> {
  const lvl = Math.max(1, Math.min(20, Math.floor(level)))
  const out: Record<number, number> = {}
  const maxRank = Math.min(10, Math.ceil(lvl / 2))
  const twoUpTo = lvl >= 10 ? Math.min(8, maxRank - 2) : 0
  for (let r = 1; r <= maxRank; r++) {
    out[r] = r <= twoUpTo ? 2 : 1
  }
  return out
}

/** Cleric Divine Font (Player Core): 4 slots at lvl 1-4, 5 at lvl 5-14, 6 at lvl 15-20, all at highest spell rank */
function divineFontSlots(level: number): Record<number, number> {
  const lvl = Math.max(1, Math.min(20, Math.floor(level)))
  const topRank = Math.min(10, Math.ceil(lvl / 2))
  const count = lvl >= 15 ? 6 : lvl >= 5 ? 5 : 4
  return { [topRank]: count }
}

function archetypeSlots(level: number, breadth = false): Record<number, number> {
  // Basic (4/6/8) -> Expert (12/14/16) -> Master (18/20); Breadth (lvl 8+) adds +1 to every rank except top 2
  const out: Record<number, number> = {}
  const thresholds: Array<[number, number]> = [[4, 1], [6, 2], [8, 3], [12, 4], [14, 5], [16, 6], [18, 7], [20, 8]]
  let highest = 0
  for (const [reqLvl, rank] of thresholds) {
    if (level >= reqLvl) {
      out[rank] = 1
      highest = rank
    }
  }
  if (breadth && level >= 8 && highest >= 3) {
    for (let r = 1; r <= highest - 2; r++) {
      if (out[r]) out[r] += 1
    }
  }
  return out
}

export const PF2E_CLASS_PRESETS: ClassPreset[] = [
  {
    id: 'wizard',
    ru: 'Волшебник (со школой: 3–4 слота/круг)',
    castingType: 'prepared',
    tradition: 'arcane',
    keyAttr: 'int',
    slotsForLevel: (l) => standardCasterSlots(l, 4, 1),
    proficiencyForLevel: fullCasterProficiency,
    note: 'Включая +1 слот школы магии на круги 1–9',
  },
  {
    id: 'wizard-unified',
    ru: 'Волшебник (Единая теория: 2–3 слота/круг)',
    castingType: 'prepared',
    tradition: 'arcane',
    keyAttr: 'int',
    slotsForLevel: (l) => standardCasterSlots(l, 3, 1),
    proficiencyForLevel: fullCasterProficiency,
  },
  {
    id: 'cleric',
    ru: 'Жрец — Келейник (3 слота/круг)',
    castingType: 'prepared',
    tradition: 'divine',
    keyAttr: 'wis',
    slotsForLevel: (l) => standardCasterSlots(l, 3, 1),
    proficiencyForLevel: fullCasterProficiency,
    note: 'Без учёта Божественного источника (добавьте отдельным списком)',
  },
  {
    id: 'cleric-warpriest',
    ru: 'Жрец — Боевой жрец (3 слота/круг)',
    castingType: 'prepared',
    tradition: 'divine',
    keyAttr: 'wis',
    slotsForLevel: (l) => standardCasterSlots(l, 3, 1),
    proficiencyForLevel: warpriestProficiency,
    note: 'Эксперт на 11 ур., Мастер на 19 ур.',
  },
  {
    id: 'cleric-font',
    ru: 'Жрец — Божественный источник (Исцеление/Вред)',
    castingType: 'prepared',
    tradition: 'divine',
    keyAttr: 'wis',
    slotsForLevel: divineFontSlots,
    proficiencyForLevel: fullCasterProficiency,
    note: '4 слота (1–4 ур.), 5 (5–14 ур.), 6 (15–20 ур.) высшего круга',
  },
  {
    id: 'druid',
    ru: 'Друид (3 слота/круг)',
    castingType: 'prepared',
    tradition: 'primal',
    keyAttr: 'wis',
    slotsForLevel: (l) => standardCasterSlots(l, 3, 1),
    proficiencyForLevel: fullCasterProficiency,
  },
  {
    id: 'witch',
    ru: 'Ведьма (3 слота/круг)',
    castingType: 'prepared',
    tradition: 'occult',
    keyAttr: 'int',
    slotsForLevel: (l) => standardCasterSlots(l, 3, 1),
    proficiencyForLevel: fullCasterProficiency,
  },
  {
    id: 'animist-prep',
    ru: 'Анимист — подготавливаемые (1–2 слота/круг, 1–9)',
    castingType: 'prepared',
    tradition: 'divine',
    keyAttr: 'wis',
    slotsForLevel: (l) => standardCasterSlots(l, 2, 0),
    proficiencyForLevel: fullCasterProficiency,
    note: 'War of Immortals: дополняются спонтанными слотами Явлений',
  },
  {
    id: 'animist-apparition',
    ru: 'Анимист — Явления (спонтанные, 1–2 слота + 10 круг)',
    castingType: 'spontaneous',
    tradition: '',
    keyAttr: 'wis',
    slotsForLevel: animistApparitionSlots,
    proficiencyForLevel: fullCasterProficiency,
    note: 'War of Immortals: заклинания настроенных Явлений (Apparitions)',
  },
  {
    id: 'necromancer',
    ru: 'Некромант (1–2 слота/круг + 10 круг, Impossible Magic)',
    castingType: 'prepared',
    tradition: 'occult',
    keyAttr: 'int',
    slotsForLevel: (l) => standardCasterSlots(l, 2, 1),
    proficiencyForLevel: fullCasterProficiency,
    note: 'Pathfinder Impossible Magic (2026)',
  },
  {
    id: 'sorcerer',
    ru: 'Чародей (4 слота/круг)',
    castingType: 'spontaneous',
    tradition: 'arcane',
    keyAttr: 'cha',
    slotsForLevel: (l) => standardCasterSlots(l, 4, 1),
    proficiencyForLevel: fullCasterProficiency,
  },
  {
    id: 'bard',
    ru: 'Бард (3 слота/круг)',
    castingType: 'spontaneous',
    tradition: 'occult',
    keyAttr: 'cha',
    slotsForLevel: (l) => standardCasterSlots(l, 3, 1),
    proficiencyForLevel: fullCasterProficiency,
  },
  {
    id: 'oracle',
    ru: 'Оракул (4 слота/круг, Remaster)',
    castingType: 'spontaneous',
    tradition: 'divine',
    keyAttr: 'cha',
    slotsForLevel: (l) => standardCasterSlots(l, 4, 1),
    proficiencyForLevel: fullCasterProficiency,
  },
  {
    id: 'psychic',
    ru: 'Псионик (1–2 слота/круг + до 2×10 круга, Dark Archive Rem.)',
    castingType: 'spontaneous',
    tradition: 'occult',
    keyAttr: 'int',
    slotsForLevel: (l) => standardCasterSlots(l, 2, 1, 2),
    proficiencyForLevel: fullCasterProficiency,
    note: 'Ключевая хар.: ИНТ или ХАР по подсознанию; 2 слота 10 круга на 20 ур.',
  },
  {
    id: 'magus',
    ru: 'Магус (1–2 слота/круг, 1–9 круги, Impossible Magic)',
    castingType: 'prepared',
    tradition: 'arcane',
    keyAttr: 'int',
    slotsForLevel: (l) => standardCasterSlots(l, 2, 0),
    proficiencyForLevel: martialCasterProficiency,
    note: 'Impossible Magic (2026): нижние круги сохраняются! Эксперт 9 ур., Мастер 17 ур. (+2 Studious Spells с 7 ур.)',
  },
  {
    id: 'summoner',
    ru: 'Призыватель (1–2 слота/круг, 1–9 круги, Impossible Magic)',
    castingType: 'spontaneous',
    tradition: 'arcane',
    keyAttr: 'cha',
    slotsForLevel: (l) => standardCasterSlots(l, 2, 0),
    proficiencyForLevel: martialCasterProficiency,
    note: 'Impossible Magic (2026): нижние круги сохраняются! Традиция зависит от эйдолона; Эксперт 9 ур., Мастер 17 ур.',
  },
  {
    id: 'archetype-prep',
    ru: 'Архетип заклинателя (подгот., 1 слот/круг)',
    castingType: 'prepared',
    tradition: 'arcane',
    keyAttr: 'int',
    slotsForLevel: (l) => archetypeSlots(l, false),
    proficiencyForLevel: archetypeCasterProficiency,
  },
  {
    id: 'archetype-prep-breadth',
    ru: 'Архетип заклинателя + Широта (подгот.)',
    castingType: 'prepared',
    tradition: 'arcane',
    keyAttr: 'int',
    slotsForLevel: (l) => archetypeSlots(l, true),
    proficiencyForLevel: archetypeCasterProficiency,
  },
  {
    id: 'archetype-spon',
    ru: 'Архетип заклинателя (спонт., 1 слот/круг)',
    castingType: 'spontaneous',
    tradition: 'arcane',
    keyAttr: 'cha',
    slotsForLevel: (l) => archetypeSlots(l, false),
    proficiencyForLevel: archetypeCasterProficiency,
  },
  {
    id: 'archetype-spon-breadth',
    ru: 'Архетип заклинателя + Широта (спонт.)',
    castingType: 'spontaneous',
    tradition: 'arcane',
    keyAttr: 'cha',
    slotsForLevel: (l) => archetypeSlots(l, true),
    proficiencyForLevel: archetypeCasterProficiency,
  },
]
