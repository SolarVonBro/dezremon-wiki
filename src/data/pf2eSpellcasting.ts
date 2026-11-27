// Pathfinder 2e (Remaster) spellcasting math & official class slot progression presets.
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
  { id: 'prepared', ru: 'Подготавливаемые', en: 'Prepared', hint: 'Волшебник, Жрец, Друид, Ведьма, Магус, Анимист' },
  { id: 'spontaneous', ru: 'Спонтанные', en: 'Spontaneous', hint: 'Чародей, Бард, Оракул, Псионик, Призыватель' },
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

export interface ClassPreset {
  id: string
  ru: string
  castingType: Pf2eCastingType
  tradition: Pf2eTradition | ''
  keyAttr: Pf2eAttribute
  slotsForLevel: (level: number) => Record<number, number>
}

function fullCasterSlots(level: number, perRank: 2 | 3 | 4, include10At19 = true): Record<number, number> {
  const out: Record<number, number> = {}
  const maxRank = Math.min(include10At19 ? 10 : 9, Math.ceil(level / 2))
  for (let r = 1; r <= maxRank; r++) {
    if (r === 10) {
      out[10] = level >= 19 ? 1 : 0
    } else if (r === maxRank && level % 2 === 1) {
      // Odd level unlocks the new rank with (perRank - 1) slots (e.g., 2 for 3-slot, 3 for 4-slot, 1 for 2-slot)
      out[r] = Math.max(1, perRank - 1)
    } else {
      out[r] = perRank
    }
  }
  return out
}

function boundedCasterSlots(level: number): Record<number, number> {
  // Magus / Summoner (PF2e Remaster): 2 slots of top 2 ranks (rank 1 at lvl 1 -> 1 slot; lvl 2 -> 2; lvl 3 -> 2 r1 + 1 r2; lvl 4 -> 2 r1 + 2 r2; lvl 5+ -> 2 of rMax-1 and 2 of rMax up to rank 9)
  if (level <= 1) return { 1: 1 }
  if (level === 2) return { 1: 2 }
  if (level === 3) return { 1: 2, 2: 1 }
  if (level === 4) return { 1: 2, 2: 2 }
  const top = Math.min(9, Math.ceil(level / 2))
  return { [top - 1]: 2, [top]: 2 }
}

function archetypeSlots(level: number): Record<number, number> {
  // Basic (4/6/8) -> Expert (12/14/16) -> Master (18/20) Spellcasting Benefits
  const out: Record<number, number> = {}
  if (level >= 4) out[1] = 1
  if (level >= 6) out[2] = 1
  if (level >= 8) out[3] = 1
  if (level >= 12) out[4] = 1
  if (level >= 14) out[5] = 1
  if (level >= 16) out[6] = 1
  if (level >= 18) out[7] = 1
  if (level >= 20) out[8] = 1
  return out
}

export const PF2E_CLASS_PRESETS: ClassPreset[] = [
  { id: 'wizard', ru: 'Волшебник (3 + 1 школы)', castingType: 'prepared', tradition: 'arcane', keyAttr: 'int', slotsForLevel: (l) => fullCasterSlots(l, 4) },
  { id: 'cleric', ru: 'Жрец (3 слота/круг)', castingType: 'prepared', tradition: 'divine', keyAttr: 'wis', slotsForLevel: (l) => fullCasterSlots(l, 3) },
  { id: 'druid', ru: 'Друид (3 слота/круг)', castingType: 'prepared', tradition: 'primal', keyAttr: 'wis', slotsForLevel: (l) => fullCasterSlots(l, 3) },
  { id: 'witch', ru: 'Ведьма (3 слота/круг)', castingType: 'prepared', tradition: 'occult', keyAttr: 'int', slotsForLevel: (l) => fullCasterSlots(l, 3) },
  { id: 'animist', ru: 'Анимист (2–3 слота/круг)', castingType: 'prepared', tradition: 'divine', keyAttr: 'wis', slotsForLevel: (l) => fullCasterSlots(l, 3) },
  { id: 'sorcerer', ru: 'Чародей (4 слота/круг)', castingType: 'spontaneous', tradition: 'arcane', keyAttr: 'cha', slotsForLevel: (l) => fullCasterSlots(l, 4) },
  { id: 'bard', ru: 'Бард (3 слота/круг)', castingType: 'spontaneous', tradition: 'occult', keyAttr: 'cha', slotsForLevel: (l) => fullCasterSlots(l, 3) },
  { id: 'oracle', ru: 'Оракул (4 слота/круг, Remaster)', castingType: 'spontaneous', tradition: 'divine', keyAttr: 'cha', slotsForLevel: (l) => fullCasterSlots(l, 4) },
  { id: 'psychic', ru: 'Псионик (2 слота/круг)', castingType: 'spontaneous', tradition: 'occult', keyAttr: 'int', slotsForLevel: (l) => fullCasterSlots(l, 2) },
  { id: 'magus', ru: 'Магус (ограниченное колдовство)', castingType: 'prepared', tradition: 'arcane', keyAttr: 'int', slotsForLevel: boundedCasterSlots },
  { id: 'summoner', ru: 'Призыватель (ограниченное)', castingType: 'spontaneous', tradition: 'arcane', keyAttr: 'cha', slotsForLevel: boundedCasterSlots },
  { id: 'archetype-prep', ru: 'Архетип заклинателя (подгот.)', castingType: 'prepared', tradition: 'arcane', keyAttr: 'int', slotsForLevel: archetypeSlots },
  { id: 'archetype-spon', ru: 'Архетип заклинателя (спонт.)', castingType: 'spontaneous', tradition: 'arcane', keyAttr: 'cha', slotsForLevel: archetypeSlots },
]

/** Recommended standard spellcasting proficiency for a full caster at character level (PF2e Remaster) */
export function fullCasterProficiency(level: number): Pf2eProficiency {
  if (level >= 19) return 4 // Legendary
  if (level >= 15) return 3 // Master
  if (level >= 7) return 2 // Expert
  return 1 // Trained
}
