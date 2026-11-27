// Renders Foundry PF2e rich descriptions (@UUID, @Damage, @Check, @Template, @Condition, @Trait, @Glyph, @Unit, [[/r ...]])
// into clean, safe HTML badges + readable text in both RU and EN.
import DOMPurify from 'dompurify'
import type { Pf2eLang, Pf2eMeta, Pf2eRarity } from '@/model/pf2e'

const SAVE_LABELS: Record<string, { ru: string; en: string }> = {
  fortitude: { ru: 'Стойкость', en: 'Fortitude' },
  reflex: { ru: 'Реакция', en: 'Reflex' },
  will: { ru: 'Воля', en: 'Will' },
  perception: { ru: 'Восприятие', en: 'Perception' },
  acrobatics: { ru: 'Акробатика', en: 'Acrobatics' },
  arcana: { ru: 'Аркана', en: 'Arcana' },
  athletics: { ru: 'Атлетика', en: 'Athletics' },
  crafting: { ru: 'Ремесло', en: 'Crafting' },
  deception: { ru: 'Обман', en: 'Deception' },
  diplomacy: { ru: 'Дипломатия', en: 'Diplomacy' },
  intimidation: { ru: 'Запугивание', en: 'Intimidation' },
  medicine: { ru: 'Медицина', en: 'Medicine' },
  nature: { ru: 'Природа', en: 'Nature' },
  occultism: { ru: 'Оккультизм', en: 'Occultism' },
  performance: { ru: 'Выступление', en: 'Performance' },
  religion: { ru: 'Религия', en: 'Religion' },
  society: { ru: 'Общество', en: 'Society' },
  stealth: { ru: 'Скрытность', en: 'Stealth' },
  survival: { ru: 'Выживание', en: 'Survival' },
  thievery: { ru: 'Воровство', en: 'Thievery' },
  flat: { ru: 'Чистая проверка', en: 'Flat Check' },
}

const AREA_LABELS: Record<string, { ru: string; en: string }> = {
  burst: { ru: 'взрыв', en: 'burst' },
  cone: { ru: 'конус', en: 'cone' },
  emanation: { ru: 'эманация', en: 'emanation' },
  line: { ru: 'линия', en: 'line' },
  cube: { ru: 'куб', en: 'cube' },
  cylinder: { ru: 'цилиндр', en: 'cylinder' },
  square: { ru: 'квадрат', en: 'square' },
}

export const RARITY_LABEL: Record<Pf2eRarity, { ru: string; en: string }> = {
  common: { ru: 'Обычный', en: 'Common' },
  uncommon: { ru: 'Необычный', en: 'Uncommon' },
  rare: { ru: 'Редкий', en: 'Rare' },
  unique: { ru: 'Уникальный', en: 'Unique' },
}

export const ITEM_TYPE_LABEL: Record<string, { ru: string; en: string; icon: string }> = {
  weapon: { ru: 'Оружие', en: 'Weapon', icon: 'sword' },
  armor: { ru: 'Доспехи', en: 'Armor', icon: 'shield' },
  shield: { ru: 'Щиты', en: 'Shield', icon: 'shield-check' },
  equipment: { ru: 'Снаряжение', en: 'Equipment', icon: 'gem' },
  consumable: { ru: 'Расходники', en: 'Consumable', icon: 'flask-conical' },
  backpack: { ru: 'Контейнеры', en: 'Container', icon: 'backpack' },
  ammo: { ru: 'Боеприпасы', en: 'Ammunition', icon: 'target' },
  treasure: { ru: 'Сокровища', en: 'Treasure', icon: 'coins' },
  kit: { ru: 'Наборы', en: 'Kit', icon: 'package' },
}

export const SPELL_CAT_LABEL: Record<string, { ru: string; en: string }> = {
  spell: { ru: 'Заклинание', en: 'Spell' },
  cantrip: { ru: 'Заговор', en: 'Cantrip' },
  focus: { ru: 'Фокусное', en: 'Focus' },
  ritual: { ru: 'Ритуал', en: 'Ritual' },
  impossible: { ru: 'Особое', en: 'Impossible' },
}

/** Render PF2e action symbol (◆, ◆◆, ◆◆◆, ◇, ↺) or readable time text. */
export function formatActionSymbol(raw: string, lang: Pf2eLang = 'ru', ruFallback?: string): { glyph: string | null; text: string } {
  const s = String(raw || '').trim().toLowerCase()
  if (s === '1' || s === 'a') return { glyph: '◆', text: lang === 'ru' ? '1 действие' : '1 action' }
  if (s === '2' || s === 'd') return { glyph: '◆◆', text: lang === 'ru' ? '2 действия' : '2 actions' }
  if (s === '3' || s === 't') return { glyph: '◆◆◆', text: lang === 'ru' ? '3 действия' : '3 actions' }
  if (s === 'free' || s === 'f') return { glyph: '◇', text: lang === 'ru' ? 'Свободное' : 'Free' }
  if (s === 'reaction' || s === 'r') return { glyph: '↺', text: lang === 'ru' ? 'Реакция' : 'Reaction' }
  if (s === '1 to 3') return { glyph: '◆–◆◆◆', text: lang === 'ru' ? 'от 1 до 3 действий' : '1 to 3 actions' }
  if (s === '1 or 2' || s === '1 to 2') return { glyph: '◆–◆◆', text: lang === 'ru' ? '1 или 2 действия' : '1 or 2 actions' }
  if (s === '2 or 3' || s === '2 to 3') return { glyph: '◆◆–◆◆◆', text: lang === 'ru' ? '2 или 3 действия' : '2 or 3 actions' }
  return { glyph: null, text: (lang === 'ru' && ruFallback ? ruFallback : raw) || '—' }
}

export function formatArea(type: string | null, val: number | null, lang: Pf2eLang = 'ru'): string {
  if (!type) return ''
  const lbl = AREA_LABELS[type]?.[lang] ?? type
  if (val == null) return lbl
  return `${val} ${lang === 'ru' ? 'фт.' : 'ft'} ${lbl}`
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function glyphInline(g: string): string {
  const k = g.trim().toLowerCase()
  if (k === '1' || k === 'a' || k === 'one-action') return '<span class="pf-act" title="1 действие">◆</span>'
  if (k === '2' || k === 'd' || k === 'two-actions') return '<span class="pf-act" title="2 действия">◆◆</span>'
  if (k === '3' || k === 't' || k === 'three-actions') return '<span class="pf-act" title="3 действия">◆◆◆</span>'
  if (k === 'f' || k === 'free' || k === 'free-action') return '<span class="pf-act" title="Свободное действие">◇</span>'
  if (k === 'r' || k === 'reaction') return '<span class="pf-act" title="Реакция">↺</span>'
  return `<span class="pf-act">${esc(g)}</span>`
}

/**
 * Transforms Foundry PF2e inline enrichers into clean, human-readable HTML badges.
 */
export function renderPf2eHtml(raw: string, lang: Pf2eLang, meta: Pf2eMeta | null): string {
  if (!raw) return ''
  let html = raw

  // Replace Foundry <span class="action-glyph">1</span>
  html = html.replace(/<span class="action-glyph">([^<]+)<\/span>/gi, (_, g) => glyphInline(g))

  // @Glyph[1|...]
  html = html.replace(/@Glyph\[([^\]]+)\]/gi, (_, inner) => glyphInline(inner.split('|')[0]))

  // @Trait[slug]{Optional}
  html = html.replace(/@Trait\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, inner, label) => {
    const slug = inner.split('|')[0].trim().toLowerCase()
    const text = label || meta?.traits?.[slug]?.[lang] || slug
    return `<span class="pf-inline-trait">${esc(text)}</span>`
  })

  // @Condition[slug|...]{Optional}
  html = html.replace(/@Condition\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, inner, label) => {
    const parts = inner.split('|')
    const slug = parts[0].trim().toLowerCase()
    const base = label || meta?.conditions?.[slug]?.[lang] || slug
    return `<span class="pf-inline-ref">${esc(base)}</span>`
  })

  // @UUID[...]{Label}
  html = html.replace(/@UUID\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, target, label) => {
    let text = label
    if (!text) {
      const tail = target.split('.').pop() || target
      const slug = tail.toLowerCase().replace(/\s+/g, '-')
      text = meta?.conditions?.[slug]?.[lang] || tail
    }
    return `<span class="pf-inline-ref">${esc(text)}</span>`
  })

  // @Damage[expr[type,type]|options]{Optional}
  html = html.replace(/@Damage\[([^\]]+(?:\[[^\]]*\])?[^\]]*)\](?:\{([^}]+)\})?/gi, (_, inner, label) => {
    if (label) return `<span class="pf-inline-dmg">${esc(label)}</span>`
    const main = inner.split('|')[0].trim()
    // Parse "4d6[fire]" or "(2d6+4)[slashing,persistent]"
    const m = /^(.+?)\[([^\]]+)\]$/.exec(main)
    if (m) {
      const expr = m[1].replace(/^\(|\)$/g, '').replace(/@item\.rank|@item\.level/gi, lang === 'ru' ? 'круг' : 'rank')
      const types = m[2]
        .split(',')
        .map((t: string) => {
          const k = t.trim().toLowerCase()
          if (k === 'persistent') return lang === 'ru' ? 'продолж.' : 'persistent'
          if (k === 'splash') return lang === 'ru' ? 'брызги' : 'splash'
          if (k === 'healing') return lang === 'ru' ? 'исцеление' : 'healing'
          return meta?.damageTypes?.[k]?.[lang] || k
        })
        .join(', ')
      return `<span class="pf-inline-dmg">${esc(expr)} (${esc(types)})</span>`
    }
    return `<span class="pf-inline-dmg">${esc(main)}</span>`
  })

  // @Check[type:reflex|dc:20|basic]{Optional} or @Check[reflex|basic]
  html = html.replace(/@Check\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, inner, label) => {
    if (label) return `<span class="pf-inline-check">${esc(label)}</span>`
    const parts = inner.split('|')
    let type = ''
    let dc = ''
    let basic = false
    for (const p of parts) {
      const kv = p.split(':')
      if (kv.length === 1) {
        if (kv[0].trim().toLowerCase() === 'basic') basic = true
        else if (!type) type = kv[0].trim().toLowerCase()
      } else {
        const k = kv[0].trim().toLowerCase()
        const v = kv.slice(1).join(':').trim()
        if (k === 'type') type = v.toLowerCase()
        else if (k === 'dc') dc = v
        else if (k === 'basic') basic = v !== 'false'
      }
    }
    const lbl = SAVE_LABELS[type]?.[lang] || type
    const prefix = basic ? (lang === 'ru' ? 'простой ' : 'basic ') : ''
    const dcStr = dc && /^\d+$/.test(dc) ? (lang === 'ru' ? `КС ${dc} ` : `DC ${dc} `) : ''
    return `<span class="pf-inline-check">${esc(`${dcStr}${prefix}${lbl}`.trim())}</span>`
  })

  // @Template[type:cone|distance:30]{Optional} or @Template[cone|distance:30]
  html = html.replace(/@Template\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, inner, label) => {
    if (label) return `<span class="pf-inline-tpl">${esc(label)}</span>`
    const parts = inner.split('|')
    let type = ''
    let dist = ''
    for (const p of parts) {
      const kv = p.split(':')
      if (kv.length === 1 && !type) type = kv[0].trim().toLowerCase()
      else if (kv[0].trim().toLowerCase() === 'type') type = kv[1].trim().toLowerCase()
      else if (kv[0].trim().toLowerCase() === 'distance') dist = kv[1].trim()
    }
    const lbl = AREA_LABELS[type]?.[lang] || type
    const unit = lang === 'ru' ? 'фт.' : 'ft'
    return `<span class="pf-inline-tpl">${esc(dist ? `${dist} ${unit} ${lbl}` : lbl)}</span>`
  })

  // @Unit[...]{Label}
  html = html.replace(/@Unit\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, inner, label) => esc(label || inner.replace(/\|/g, ' ')))

  // @Counteract / @Embed / @Table / @Localize
  html = html.replace(/@Counteract\[([^\]]*)\](?:\{([^}]+)\})?/gi, (_, _i, label) =>
    `<span class="pf-inline-check">${esc(label || (lang === 'ru' ? 'Противодействие' : 'Counteract'))}</span>`)
  html = html.replace(/@(?:Embed|Table|Localize)\[([^\]]*)\](?:\{([^}]+)\})?/gi, (_, inner, label) =>
    esc(label || inner.split('.').pop() || ''))

  // Inline actions [[/act grapple ...]]{label}
  html = html.replace(/\[\[\/act\s+([^\]]+)\]\](?:\{([^}]+)\})?/gi, (_, expr, label) => {
    const clean = label || expr.split(/\s+/)[0].replace(/-/g, ' ')
    return `<span class="pf-inline-check">${esc(clean)}</span>`
  })

  // Inline dice rolls [[/r 1d4 #rounds]]{label} or [[/r 1d4]]
  html = html.replace(/\[\[\/(?:r|roll|gmr|br)\s+([^\]]+)\]\](?:\{([^}]+)\})?/gi, (_, expr, label) => {
    const clean = label || expr.split('#')[0].replace(/\{[^}]*\}/g, '').trim()
    return `<span class="pf-inline-roll">${esc(clean)}</span>`
  })

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'blockquote', 'sup', 'sub', 'code'],
    ALLOWED_ATTR: ['class', 'title', 'colspan', 'rowspan'],
  })
}
