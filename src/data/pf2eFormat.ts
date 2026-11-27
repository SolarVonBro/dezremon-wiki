// Renders Foundry PF2e rich descriptions (@UUID, @Damage, @Check, @Template, @Condition, @Trait,
// @Glyph, @Unit, [[/r ...]], plus plain-text dice like 6d6) into clean, safe interactive HTML
// with clickable roll buttons, average-damage hints, and cross-links opening in new tabs.
import DOMPurify from 'dompurify'
import type { Pf2eLang, Pf2eMeta, Pf2eRarity } from '@/model/pf2e'
import { compilePf2eFormula, formatAvgNumber, type Pf2eFormulaContext } from './pf2eRoll'

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

export function pf2eIconUrl(img?: string | null): string {
  if (!img) return ''
  return `${import.meta.env.BASE_URL}icons/pf2e/${img}`
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

export function localizeDamageType(type: string, lang: Pf2eLang, meta: Pf2eMeta | null): string {
  const k = type.trim().toLowerCase()
  if (k === 'persistent') return lang === 'ru' ? 'продолж.' : 'persistent'
  if (k === 'splash') return lang === 'ru' ? 'брызги' : 'splash'
  if (k === 'healing') return lang === 'ru' ? 'исцеление' : 'healing'
  if (k === 'negative') return meta?.damageTypes?.void?.[lang] || (lang === 'ru' ? 'Пустота' : 'Void')
  if (k === 'positive') return meta?.damageTypes?.vitality?.[lang] || (lang === 'ru' ? 'Витальность' : 'Vitality')
  return meta?.damageTypes?.[k]?.[lang] || k
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

/** Replace balanced @Tag[...]{optLabel} handling arbitrary nested [...] inside. */
function replaceBalancedTag(
  input: string,
  tagPrefix: string,
  replacer: (inner: string, label: string | undefined) => string,
): string {
  const lower = input.toLowerCase()
  const needle = tagPrefix.toLowerCase()
  let out = ''
  let pos = 0
  while (pos < input.length) {
    const idx = lower.indexOf(needle, pos)
    if (idx === -1) {
      out += input.slice(pos)
      break
    }
    out += input.slice(pos, idx)
    let i = idx + tagPrefix.length
    let depth = 1
    while (i < input.length && depth > 0) {
      if (input[i] === '[') depth++
      else if (input[i] === ']') depth--
      i++
    }
    if (depth !== 0) {
      out += input.slice(idx, idx + tagPrefix.length)
      pos = idx + tagPrefix.length
      continue
    }
    const inner = input.slice(idx + tagPrefix.length, i - 1)
    let label: string | undefined
    if (input[i] === '{') {
      const endBrace = input.indexOf('}', i + 1)
      if (endBrace !== -1) {
        label = input.slice(i + 1, endBrace)
        i = endBrace + 1
      }
    }
    out += replacer(inner, label)
    pos = i
  }
  return out
}

/** Replace balanced [[/r ...]] / [[/roll ...]] / [[/gmr ...]] / [[/br ...]] even when inner contains [...]. */
function replaceDoubleBracketRolls(
  input: string,
  replacer: (cmd: string, inner: string, label: string | undefined) => string,
): string {
  let out = ''
  let pos = 0
  while (pos < input.length) {
    const idx = input.indexOf('[[/', pos)
    if (idx === -1) {
      out += input.slice(pos)
      break
    }
    const mCmd = /^\[\[\/(r|roll|gmr|br|gr|act)\s+/i.exec(input.slice(idx))
    if (!mCmd) {
      out += input.slice(pos, idx + 3)
      pos = idx + 3
      continue
    }
    out += input.slice(pos, idx)
    const cmd = mCmd[1].toLowerCase()
    const startInner = idx + mCmd[0].length
    const closeIdx = input.indexOf(']]', startInner)
    if (closeIdx === -1) {
      out += input.slice(idx, startInner)
      pos = startInner
      continue
    }
    const inner = input.slice(startInner, closeIdx)
    let nextPos = closeIdx + 2
    let label: string | undefined
    if (input[nextPos] === '{') {
      const endBrace = input.indexOf('}', nextPos + 1)
      if (endBrace !== -1) {
        label = input.slice(nextPos + 1, endBrace)
        nextPos = endBrace + 1
      }
    }
    out += replacer(cmd, inner, label)
    pos = nextPos
  }
  return out
}

function renderRollButton(
  spec: string,
  lang: Pf2eLang,
  meta: Pf2eMeta | null,
  ctx: Pf2eFormulaContext | undefined,
  variant: 'dmg' | 'roll',
  explicitLabel?: string,
  isUpgraded = false,
): string {
  const compiled = compilePf2eFormula(spec, ctx)
  if (!compiled) {
    const fallbackText = explicitLabel || spec.split('|')[0].replace(/@item\.rank|@item\.level/gi, lang === 'ru' ? 'круг' : 'rank')
    return `<span class="${variant === 'dmg' ? 'pf-inline-dmg' : 'pf-inline-roll'}">${esc(fallbackText)}</span>`
  }

  const labelParts = compiled.components.map((c) => {
    const typeText = c.types.length ? ` (${c.types.map((t) => localizeDamageType(t, lang, meta)).join(', ')})` : ''
    return `${c.displayExpr}${typeText}`
  })
  const mainLabel = explicitLabel || labelParts.join(' + ')

  // Flat-only damage (no dice to roll) -> clean non-interactive damage badge
  if (!compiled.hasDice) {
    return `<span class="pf-inline-dmg">${esc(mainLabel)}</span>`
  }

  const avgStr = formatAvgNumber(compiled.avg)
  const avgHint = lang === 'ru' ? `ср. ${avgStr}` : `avg ${avgStr}`
  const title = lang === 'ru'
    ? `Нажмите, чтобы бросить ${compiled.displayExpr} · Среднее: ${avgStr} (${compiled.min}–${compiled.max})`
    : `Click to roll ${compiled.displayExpr} · Average: ${avgStr} (${compiled.min}–${compiled.max})`
  const noteAttr = compiled.note ? ` data-roll-note="${esc(compiled.note)}"` : ''
  const upCls = isUpgraded ? ' pf-heightened' : ''

  return `<button type="button" class="pf-roll-btn ${variant === 'dmg' ? 'pf-inline-dmg' : 'pf-inline-roll'}${upCls}" data-roll-spec="${esc(spec)}"${noteAttr} title="${esc(title)}"><span class="pf-roll-ic" aria-hidden="true">🎲</span><span>${esc(mainLabel)}</span><span class="pf-roll-avg">· ${esc(avgHint)}</span></button>`
}

/** Auto-enhance plain-text dice like "6d6" or "2d8+4" in text nodes outside HTML tags/buttons. */
function enhancePlainDice(
  html: string,
  lang: Pf2eLang,
  meta: Pf2eMeta | null,
  ctx?: Pf2eFormulaContext,
  heightenOverrides?: Record<string, string>,
): string {
  const tokens = html.split(/(<[^>]+>)/g)
  let inButton = 0
  let inLink = 0
  let inHeightenSection = false
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.startsWith('<')) {
      if (/^<button\b/i.test(tok)) inButton++
      else if (/^<\/button>/i.test(tok)) inButton = Math.max(0, inButton - 1)
      else if (/^<a\b/i.test(tok)) inLink++
      else if (/^<\/a>/i.test(tok)) inLink = Math.max(0, inLink - 1)
      continue
    }
    if (/\b(?:Heightened|Усиление)\s*\(/i.test(tok)) inHeightenSection = true
    if (inButton > 0 || inLink > 0 || !/\d+d\d+/i.test(tok)) continue
    tokens[i] = tok.replace(/(^|[^\w/])(\d{1,2}d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d{1,3})?)(?![\w\]])/gi, (m, lead, expr) => {
      const normalized = expr.replace(/\s+/g, '')
      const upgraded = !inHeightenSection && heightenOverrides?.[normalized.toLowerCase()]
      if (upgraded) {
        return lead + renderRollButton(upgraded, lang, meta, ctx, 'roll', undefined, true)
      }
      return lead + renderRollButton(normalized, lang, meta, ctx, 'roll')
    })
  }
  return tokens.join('')
}

/**
 * Transforms Foundry PF2e inline enrichers into clean, human-readable HTML badges
 * and interactive dice-roll buttons.
 */
export function renderPf2eHtml(
  raw: string,
  lang: Pf2eLang,
  meta: Pf2eMeta | null,
  ctx?: Pf2eFormulaContext,
  heightenOverrides?: Record<string, string>,
): string {
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

  // Pre-resolved spell & item cross-links (open standalone page in new tab!)
  html = html.replace(/@SpellLink\[([^\]]+)\]\{([^}]+)\}/g, (_, id, label) => {
    const title = lang === 'ru' ? 'Открыть заклинание в новой вкладке' : 'Open spell in new tab'
    return `<a href="#/tools/pf2e/spell/${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer" class="pf-uuid-link pf-spell-link" title="${title}">${esc(label)}</a>`
  })
  html = html.replace(/@ItemLink\[([^\]]+)\]\{([^}]+)\}/g, (_, id, label) => {
    const title = lang === 'ru' ? 'Открыть предмет в новой вкладке' : 'Open item in new tab'
    return `<a href="#/tools/pf2e/item/${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer" class="pf-uuid-link pf-item-link" title="${title}">${esc(label)}</a>`
  })
  html = html.replace(/@Ref\{([^}]+)\}/g, (_, label) => `<span class="pf-inline-ref">${esc(label)}</span>`)

  // Fallback for any raw @UUID[...]{Label}
  html = html.replace(/@UUID\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, target, label) => {
    let text = label
    if (!text) {
      const tail = target.split('.').pop() || target
      if (/^[A-Za-z0-9]{16}$/.test(tail)) return ''
      const slug = tail.toLowerCase().replace(/\s+/g, '-')
      text = meta?.conditions?.[slug]?.[lang] || tail
    }
    return `<span class="pf-inline-ref">${esc(text)}</span>`
  })

  // Balanced @Damage[...] (supports multi-bracket & multi-component formulas + heightened base upgrades!)
  const heightenSplitIdx = html.search(/(?:Heightened|Усиление)\s*\(/i)
  const replaceDmg = (segment: string, allowUpgrade: boolean) =>
    replaceBalancedTag(segment, '@Damage[', (inner, label) => {
      if (allowUpgrade && heightenOverrides && !inner.includes('@') && !inner.includes(',')) {
        const mBase = /^([^[\]|]+)(\[[^\]]*\])?(.*)$/.exec(inner.trim())
        if (mBase) {
          const norm = mBase[1].replace(/\s+/g, '').toLowerCase()
          if (heightenOverrides[norm]) {
            const upgradedSpec = `${heightenOverrides[norm]}${mBase[2] || ''}${mBase[3] || ''}`
            return renderRollButton(upgradedSpec, lang, meta, ctx, 'dmg', label, true)
          }
        }
      }
      return renderRollButton(inner, lang, meta, ctx, 'dmg', label)
    })
  html = heightenSplitIdx > 0
    ? replaceDmg(html.slice(0, heightenSplitIdx), true) + replaceDmg(html.slice(heightenSplitIdx), false)
    : replaceDmg(html, true)

  // @Check[type:reflex|dc:20|basic]{Optional} or @Check[reflex|basic]
  html = replaceBalancedTag(html, '@Check[', (inner, label) => {
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
  html = replaceBalancedTag(html, '@Template[', (inner, label) => {
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
  html = html.replace(/@(?:Embed|Table|Localize)\[([^\]]*)\](?:\{([^}]+)\})?/gi, (_, inner, label) => {
    if (label) return esc(label)
    const tail = (inner.split('.').pop() || '').trim()
    return /^[A-Za-z0-9]{16}(?:\s|$)/.test(tail) ? '' : esc(tail)
  })

  // Balanced [[/act ...]] and [[/r ...]] / [[/roll ...]] / [[/gmr ...]] / [[/br ...]]
  html = replaceDoubleBracketRolls(html, (cmd, inner, label) => {
    if (cmd === 'act') {
      const clean = label || inner.split(/\s+/)[0].replace(/-/g, ' ')
      return `<span class="pf-inline-check">${esc(clean)}</span>`
    }
    return renderRollButton(inner, lang, meta, ctx, 'roll', label)
  })

  // Make plain-text dice like "6d6" or "1d8" in descriptions clickable (and upgraded if heightened!)
  html = enhancePlainDice(html, lang, meta, ctx, heightenOverrides)

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['a', 'button', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'blockquote', 'sup', 'sub', 'code'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'title', 'type', 'aria-hidden', 'data-roll-spec', 'data-roll-note', 'colspan', 'rowspan'],
  })
}
