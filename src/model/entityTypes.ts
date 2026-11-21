import type { CustomType } from './types'

export type FieldKind = 'text' | 'textarea' | 'number' | 'bool' | 'entity' | 'entities' | 'pairs' | 'color' | 'select'

export interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  /** For entity/entities: allowed target types. */
  target?: string[]
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface EntityTypeDef {
  key: string
  label: string
  plural: string
  /** Accusative/genitive forms for buttons: "Создать персонажа". */
  acc: string
  icon: string
  color: string
  kindPlaceholder: string
  parentLabel: string | null
  fields: FieldDef[]
  /** Extra tabs/panels shown on the entity page. */
  features: Array<'members' | 'familyTree' | 'quest' | 'calendar' | 'timeline' | 'map' | 'conversation' | 'dice' | 'tagged' | 'templateAttrs'>
  custom?: boolean
}

const loc = (key = 'locationId', label = 'Местонахождение'): FieldDef => ({ key, label, kind: 'entity', target: ['location'] })
const locs = (): FieldDef => ({ key: 'locationIds', label: 'Локации', kind: 'entities', target: ['location'] })

export const BUILTIN_TYPES: EntityTypeDef[] = [
  {
    key: 'character', label: 'Персонаж', plural: 'Персонажи', acc: 'персонажа', icon: 'user', color: '#c9a227',
    kindPlaceholder: 'НПС, игровой персонаж, бог…', parentLabel: null,
    fields: [
      { key: 'title', label: 'Титул', kind: 'text', placeholder: 'Королева Севера' },
      { key: 'age', label: 'Возраст', kind: 'text' },
      { key: 'sex', label: 'Пол', kind: 'text' },
      { key: 'pronouns', label: 'Местоимения', kind: 'text' },
      { key: 'isDead', label: 'Мёртв(а)', kind: 'bool' },
      loc(),
      { key: 'raceIds', label: 'Расы', kind: 'entities', target: ['race'] },
      { key: 'familyIds', label: 'Семьи', kind: 'entities', target: ['family'] },
      { key: 'appearance', label: 'Внешность', kind: 'pairs', placeholder: 'Рост, глаза, волосы…' },
      { key: 'personality', label: 'Личность', kind: 'pairs', placeholder: 'Цели, страхи, черты…' },
    ],
    features: ['familyTree'],
  },
  {
    key: 'location', label: 'Локация', plural: 'Локации', acc: 'локацию', icon: 'map-pin', color: '#4f9d69',
    kindPlaceholder: 'Королевство, город, таверна…', parentLabel: 'Входит в',
    fields: [{ key: 'mapId', label: 'Карта', kind: 'entity', target: ['map'] }],
    features: [],
  },
  {
    key: 'family', label: 'Семья', plural: 'Семьи', acc: 'семью', icon: 'users', color: '#b5654a',
    kindPlaceholder: 'Династия, клан, род…', parentLabel: 'Ветвь рода',
    fields: [loc('locationId', 'Резиденция')],
    features: ['familyTree'],
  },
  {
    key: 'organisation', label: 'Организация', plural: 'Организации', acc: 'организацию', icon: 'landmark', color: '#6a7fc1',
    kindPlaceholder: 'Гильдия, орден, культ…', parentLabel: 'Входит в',
    fields: [locs(), { key: 'isDefunct', label: 'Распущена', kind: 'bool' }],
    features: ['members'],
  },
  {
    key: 'item', label: 'Предмет', plural: 'Предметы', acc: 'предмет', icon: 'gem', color: '#a86fc4',
    kindPlaceholder: 'Оружие, артефакт, книга…', parentLabel: 'Часть предмета',
    fields: [
      { key: 'price', label: 'Цена', kind: 'text' },
      { key: 'size', label: 'Размер', kind: 'text' },
      { key: 'weight', label: 'Вес', kind: 'text' },
      { key: 'ownerId', label: 'Владелец', kind: 'entity', target: ['character', 'organisation', 'family'] },
      loc(),
    ],
    features: [],
  },
  {
    key: 'note', label: 'Заметка', plural: 'Заметки', acc: 'заметку', icon: 'sticky-note', color: '#9a9a9a',
    kindPlaceholder: 'Правило, лор, идея…', parentLabel: 'Раздел',
    fields: [],
    features: [],
  },
  {
    key: 'event', label: 'Событие', plural: 'События', acc: 'событие', icon: 'flame', color: '#d0703c',
    kindPlaceholder: 'Битва, праздник, катастрофа…', parentLabel: 'Часть события',
    fields: [{ key: 'date', label: 'Дата', kind: 'text' }, loc()],
    features: [],
  },
  {
    key: 'calendar', label: 'Календарь', plural: 'Календари', acc: 'календарь', icon: 'calendar-days', color: '#3f9fb5',
    kindPlaceholder: 'Летоисчисление…', parentLabel: null,
    fields: [],
    features: ['calendar'],
  },
  {
    key: 'race', label: 'Раса', plural: 'Расы', acc: 'расу', icon: 'dna', color: '#7aa13d',
    kindPlaceholder: 'Народ, подраса…', parentLabel: 'Подвид расы',
    fields: [locs(), { key: 'isExtinct', label: 'Вымерла', kind: 'bool' }],
    features: [],
  },
  {
    key: 'creature', label: 'Существо', plural: 'Существа', acc: 'существо', icon: 'paw-print', color: '#8b6d3f',
    kindPlaceholder: 'Зверь, нежить, дух…', parentLabel: 'Подвид',
    fields: [locs(), { key: 'isExtinct', label: 'Вымерло', kind: 'bool' }, { key: 'isDead', label: 'Мёртво', kind: 'bool' }],
    features: [],
  },
  {
    key: 'quest', label: 'Квест', plural: 'Квесты', acc: 'квест', icon: 'scroll', color: '#c4a35a',
    kindPlaceholder: 'Основной, побочный…', parentLabel: 'Часть квеста',
    fields: [
      { key: 'giverId', label: 'Квестодатель', kind: 'entity', target: ['character', 'organisation'] },
      loc(),
      { key: 'date', label: 'Дата', kind: 'text' },
      { key: 'isCompleted', label: 'Завершён', kind: 'bool' },
    ],
    features: ['quest'],
  },
  {
    key: 'journal', label: 'Журнал', plural: 'Журналы', acc: 'запись журнала', icon: 'book-open', color: '#5f8fa8',
    kindPlaceholder: 'Отчёт о сессии, дневник…', parentLabel: 'Раздел',
    fields: [
      { key: 'date', label: 'Дата', kind: 'text' },
      { key: 'authorId', label: 'Автор', kind: 'entity', target: ['character', 'organisation'] },
      loc(),
    ],
    features: [],
  },
  {
    key: 'ability', label: 'Способность', plural: 'Способности', acc: 'способность', icon: 'sparkles', color: '#c25b8b',
    kindPlaceholder: 'Заклинание, умение, черта…', parentLabel: 'Школа / группа',
    fields: [{ key: 'charges', label: 'Заряды', kind: 'text' }],
    features: [],
  },
  {
    key: 'map', label: 'Карта', plural: 'Карты', acc: 'карту', icon: 'map', color: '#4a8f8a',
    kindPlaceholder: 'Мир, регион, город, подземелье…', parentLabel: 'Часть карты',
    fields: [loc()],
    features: ['map'],
  },
  {
    key: 'timeline', label: 'Хронология', plural: 'Хронологии', acc: 'хронологию', icon: 'history', color: '#9d7f4a',
    kindPlaceholder: 'История мира, летопись…', parentLabel: 'Часть хронологии',
    fields: [{ key: 'reverse', label: 'Новые сверху', kind: 'bool' }],
    features: ['timeline'],
  },
  {
    key: 'tag', label: 'Тег', plural: 'Теги', acc: 'тег', icon: 'tag', color: '#8c8c5a',
    kindPlaceholder: 'Категория…', parentLabel: 'Родительский тег',
    fields: [
      { key: 'colour', label: 'Цвет', kind: 'color' },
      { key: 'isAutoApplied', label: 'Добавлять к новым статьям', kind: 'bool' },
    ],
    features: ['tagged'],
  },
  {
    key: 'conversation', label: 'Разговор', plural: 'Разговоры', acc: 'разговор', icon: 'messages-square', color: '#6b8fd6',
    kindPlaceholder: 'Переписка, допрос…', parentLabel: null,
    fields: [{ key: 'participantIds', label: 'Участники', kind: 'entities', target: ['character', 'organisation', 'family'] }],
    features: ['conversation'],
  },
  {
    key: 'dice_roll', label: 'Бросок кубов', plural: 'Броски кубов', acc: 'бросок', icon: 'dices', color: '#b04a4a',
    kindPlaceholder: 'Атака, проверка…', parentLabel: null,
    fields: [
      { key: 'formula', label: 'Формула', kind: 'text', placeholder: '1d20 + {Сила} + 2' },
      { key: 'characterId', label: 'Персонаж (атрибуты)', kind: 'entity', target: ['character', 'creature'] },
    ],
    features: ['dice'],
  },
  {
    key: 'attribute_template', label: 'Шаблон атрибутов', plural: 'Шаблоны атрибутов', acc: 'шаблон', icon: 'list-checks', color: '#7d7d9c',
    kindPlaceholder: '', parentLabel: 'Наследует шаблон',
    fields: [],
    features: ['templateAttrs'],
  },
]

export const TYPE_ORDER = BUILTIN_TYPES.map((t) => t.key)

const builtinMap = new Map(BUILTIN_TYPES.map((t) => [t.key, t]))

export function customTypeDef(c: CustomType): EntityTypeDef {
  return {
    key: c.key, label: c.label, plural: c.plural, acc: c.label.toLowerCase(), icon: c.icon || 'file-text', color: '#8a8aa8',
    kindPlaceholder: 'Подтип…', parentLabel: 'Родитель', fields: [], features: [], custom: true,
  }
}

let customMap = new Map<string, EntityTypeDef>()

export function setCustomTypes(list: CustomType[]) {
  customMap = new Map(list.map((c) => [c.key, customTypeDef(c)]))
}

export function typeDef(key: string): EntityTypeDef {
  return builtinMap.get(key) ?? customMap.get(key) ?? {
    key, label: key, plural: key, acc: key, icon: 'file-text', color: '#888', kindPlaceholder: '', parentLabel: 'Родитель', fields: [], features: [],
  }
}

export function allTypes(): EntityTypeDef[] {
  return [...BUILTIN_TYPES, ...customMap.values()]
}

/** Entity reference fields of a type: used for "linked from" panels and cleanup. */
export function refFields(typeKey: string): FieldDef[] {
  return typeDef(typeKey).fields.filter((f) => f.kind === 'entity' || f.kind === 'entities')
}
