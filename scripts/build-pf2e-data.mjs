#!/usr/bin/env node
// Compiles official Pathfinder 2e (Remaster) spells and equipment from foundryvtt/pf2e packs
// + community Russian translations (pf2r / pf2e-ru-translation) + scripts/pf2e-ru-overlay.json
// into compact static JSON files in public/data/pf2e/.
//
// Usage:
//   node scripts/build-pf2e-data.mjs <pf2e-src-dir> <pf2r-dir>
import fs from 'node:fs'
import path from 'node:path'

const pf2eSrc = process.argv[2]
const pf2rDir = process.argv[3]
if (!pf2eSrc || !pf2rDir) {
  console.error('Usage: node scripts/build-pf2e-data.mjs <pf2e-src-dir> <pf2r-dir>')
  process.exit(1)
}

const repoRoot = process.cwd()
const overlayPath = path.join(repoRoot, 'scripts', 'pf2e-ru-overlay.json')
const outDir = path.join(repoRoot, 'public', 'data', 'pf2e')
fs.mkdirSync(outDir, { recursive: true })

function walk(dir) {
  let out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(p))
    else if (e.name.endsWith('.json') && !e.name.startsWith('_')) out.push(p)
  }
  return out
}

function deepMerge(a, b) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

const enLang = deepMerge(
  JSON.parse(fs.readFileSync(path.join(pf2eSrc, 'static/lang/en.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(pf2eSrc, 'static/lang/re-en.json'), 'utf8')),
)
const ruLang = deepMerge(
  JSON.parse(fs.readFileSync(path.join(pf2rDir, 'pf2e.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(pf2rDir, 're-pf2e.json'), 'utf8')),
)

const ruSpells = JSON.parse(fs.readFileSync(path.join(pf2rDir, 'pf2e.spells-srd.json'), 'utf8')).entries || {}
const ruEquip = JSON.parse(fs.readFileSync(path.join(pf2rDir, 'pf2e.equipment-srd.json'), 'utf8')).entries || {}
const ruClassFeaturesPath = path.join(pf2rDir, 'pf2e.classfeatures.json')
const ruClassFeatures = fs.existsSync(ruClassFeaturesPath) ? (JSON.parse(fs.readFileSync(ruClassFeaturesPath, 'utf8')).entries || {}) : {}
const overlay = fs.existsSync(overlayPath) ? JSON.parse(fs.readFileSync(overlayPath, 'utf8')) : { spells: {}, equipment: {} }

// Index class-features by _id and name for @Embed[Compendium.pf2e.classfeatures.Item.<id|name> ...] inlining
const cfByKey = new Map()
const cfDir = path.join(pf2eSrc, 'packs/pf2e/class-features')
if (fs.existsSync(cfDir)) {
  for (const f of walk(cfDir)) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    const enDesc = (j.system?.description?.value || '').trim()
    const r = ruClassFeatures[j.name] || {}
    const ruDesc = (r.description || '').trim()
    const rec = { en: enDesc, ru: ruDesc || enDesc }
    if (j._id) cfByKey.set(j._id, rec)
    if (j.name) cfByKey.set(j.name, rec)
  }
}

function inlineEmbeds(html, lang) {
  if (!html || !html.includes('@Embed[')) return html
  return html.replace(/<p>\s*@Embed\[Compendium\.pf2e\.classfeatures\.Item\.([^\s\]]+)[^\]]*\]\s*<\/p>|@Embed\[Compendium\.pf2e\.classfeatures\.Item\.([^\s\]]+)[^\]]*\]/gi, (m, k1, k2) => {
    const key = k1 || k2
    const rec = cfByKey.get(key)
    if (!rec) return m
    return lang === 'ru' ? rec.ru : rec.en
  })
}

const hasCyr = (s) => typeof s === 'string' && /[а-яёА-ЯЁ]/.test(s)
function isRuText(s) {
  if (typeof s !== 'string' || !s.trim()) return false
  const plain = s.replace(/<[^>]+>/g, ' ').replace(/@\w+\[[^\]]+\](?:\{[^}]*\})?/g, ' ')
  const cyr = (plain.match(/[а-яёА-ЯЁ]/g) || []).length
  const lat = (plain.match(/[a-zA-Z]/g) || []).length
  return cyr > 0 && cyr >= lat * 0.35
}
const toPascal = (s) => String(s || '').split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1) : '')).join('')
const titleCase = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Extra manual RU labels for edge-case traits/usages/materials/categories missing in pf2r
const EXTRA_TRAITS_RU = {
  chaotic: 'Хаотичный',
  evil: 'Злой',
  good: 'Добрый',
  lawful: 'Принципиальный',
  'launching-dart': 'Запуск дротика',
}

const DAMAGE_RU = {
  acid: ['Acid', 'Кислота'],
  bleed: ['Bleed', 'Кровотечение'],
  bludgeoning: ['Bludgeoning', 'Дробящий'],
  cold: ['Cold', 'Холод'],
  electricity: ['Electricity', 'Электричество'],
  fire: ['Fire', 'Огонь'],
  force: ['Force', 'Сила (силовой)'],
  mental: ['Mental', 'Ментальный'],
  piercing: ['Piercing', 'Колющий'],
  poison: ['Poison', 'Яд'],
  slashing: ['Slashing', 'Рубящий'],
  sonic: ['Sonic', 'Звук'],
  spirit: ['Spirit', 'Духовный'],
  untyped: ['Untyped', 'Без типа'],
  vitality: ['Vitality', 'Витальность'],
  void: ['Void', 'Пустота'],
}

const CONDITIONS_MAP = {
  blinded: ['Blinded', 'Слепота'],
  broken: ['Broken', 'Сломан'],
  clumsy: ['Clumsy', 'Неуклюжий'],
  concealed: ['Concealed', 'Скрыт'],
  confused: ['Confused', 'Замешательство'],
  controlled: ['Controlled', 'Под контролем'],
  dazzled: ['Dazzled', 'Растерянный'],
  deafened: ['Deafened', 'Глухота'],
  doomed: ['Doomed', 'Обречённый'],
  drained: ['Drained', 'Истощённый'],
  dying: ['Dying', 'При смерти'],
  encumbered: ['Encumbered', 'Перегруженный'],
  enfeebled: ['Enfeebled', 'Ослабленный'],
  fascinated: ['Fascinated', 'Очарованный'],
  fatigued: ['Fatigued', 'Утомлённый'],
  fleeing: ['Fleeing', 'Бегущий'],
  frightened: ['Frightened', 'Напуган'],
  grabbed: ['Grabbed', 'Схвачен'],
  hidden: ['Hidden', 'Спрятан'],
  immobilized: ['Immobilized', 'Скован'],
  invisible: ['Invisible', 'Невидимый'],
  'off-guard': ['Off-Guard', 'Застигнут врасплох'],
  paralyzed: ['Paralyzed', 'Парализован'],
  petrified: ['Petrified', 'Окаменевший'],
  prone: ['Prone', 'Ничком'],
  quickened: ['Quickened', 'Ускорен'],
  restrained: ['Restrained', 'Обездвижен'],
  sickened: ['Sickened', 'Тошнота'],
  slowed: ['Slowed', 'Замедлен'],
  stunned: ['Stunned', 'Ошеломлён'],
  stupefied: ['Stupefied', 'Одурманенный'],
  unconscious: ['Unconscious', 'Без сознания'],
  undetected: ['Undetected', 'Необнаружен'],
  wounded: ['Wounded', 'Раненый'],
}

const CONSUMABLE_CATS_RU = {
  ammo: ['Ammunition', 'Боеприпасы'],
  catalyst: ['Catalyst', 'Катализатор'],
  drug: ['Drug', 'Наркотик / Вещество'],
  elixir: ['Elixir', 'Эликсир'],
  fulu: ['Fulu', 'Фулу'],
  gadget: ['Gadget', 'Гаджет'],
  mutagen: ['Mutagen', 'Мутаген'],
  oil: ['Oil', 'Масло'],
  other: ['Other', 'Прочий расходник'],
  poison: ['Poison', 'Яд'],
  potion: ['Potion', 'Зелье'],
  scroll: ['Scroll', 'Свиток'],
  snare: ['Snare', 'Силок'],
  talisman: ['Talisman', 'Талисман'],
  toolkit: ['Toolkit', 'Набор инструментов'],
  wand: ['Wand', 'Палочка'],
}

const WEAPON_GROUPS_RU = {
  axe: ['Axe', 'Топоры'],
  bomb: ['Bomb', 'Бомбы'],
  bow: ['Bow', 'Луки'],
  brawling: ['Brawling', 'Рукопашное'],
  club: ['Club', 'Дубины'],
  crossbow: ['Crossbow', 'Арбалеты'],
  dart: ['Dart', 'Дротики'],
  firearm: ['Firearm', 'Огнестрельное'],
  flail: ['Flail', 'Цепы'],
  hammer: ['Hammer', 'Молоты'],
  knife: ['Knife', 'Кинжалы'],
  pick: ['Pick', 'Кирки'],
  polearm: ['Polearm', 'Древковое'],
  shield: ['Shield', 'Щиты'],
  sling: ['Sling', 'Пращи'],
  spear: ['Spear', 'Копья'],
  sword: ['Sword', 'Мечи'],
}

const ARMOR_GROUPS_RU = {
  chain: ['Chain', 'Кольчуга'],
  cloth: ['Cloth', 'Ткань'],
  composite: ['Composite', 'Композит'],
  leather: ['Leather', 'Кожа'],
  plate: ['Plate', 'Латы'],
  skeletal: ['Skeletal', 'Костяные'],
  wood: ['Wood', 'Дерево'],
}

const MATERIALS_RU = {
  adamantine: ['Adamantine', 'Адамантин'],
  'cold-iron': ['Cold Iron', 'Холодное железо'],
  dawnsilver: ['Dawnsilver', 'Рассветное серебро (Мифрил)'],
  dragonhide: ['Dragonhide', 'Драконья шкура'],
  duskwood: ['Duskwood', 'Сумеречное дерево'],
  inubrix: ['Inubrix', 'Инубрикс'],
  orichalcum: ['Orichalcum', 'Орихалк'],
  peachwood: ['Peachwood', 'Персиковое дерево'],
  siccatite: ['Siccatite', 'Сиккатит'],
  silver: ['Silver', 'Серебро'],
  throneglass: ['Throneglass', 'Тронное стекло'],
}

// Helper to translate common EN range/duration/time values when pf2r didn't override them
function translateRangeFallback(v) {
  if (!v) return ''
  const s = v.trim()
  if (/^touch$/i.test(s)) return 'касание'
  if (/^planetary$/i.test(s)) return 'в пределах планеты'
  if (/^interplanar$/i.test(s)) return 'межпланарная'
  if (/^unlimited$/i.test(s)) return 'неограниченная'
  if (/^varies$/i.test(s)) return 'вар.'
  let out = s
    .replace(/\b(\d+)\s*feet\b/gi, '$1 футов')
    .replace(/\b(\d+)\s*foot\b/gi, '$1 фут')
    .replace(/\b(\d+)\s*miles?\b/gi, '$1 миль')
    .replace(/\btouch\b/gi, 'касание')
    .replace(/\bsee text\b/gi, 'см. текст')
  return out
}

function translateDurationFallback(v) {
  if (!v) return ''
  const s = v.trim()
  return s
    .replace(/^until the end of your next turn$/i, 'до конца вашего следующего хода')
    .replace(/^until the start of your next turn$/i, 'до начала вашего следующего хода')
    .replace(/^until the end of the current turn$/i, 'до конца текущего хода')
    .replace(/^until your next daily preparations$/i, 'до ваших следующих ежедневных приготовлений')
    .replace(/^until you leave the stance$/i, 'пока вы в стойке')
    .replace(/^unlimited$/i, 'неограниченно')
    .replace(/^varies$/i, 'вар.')
    .replace(/\b1 round\b/gi, '1 раунд')
    .replace(/\b(\d+)\s*rounds?\b/gi, '$1 раунд.')
    .replace(/\b1 minute\b/gi, '1 минута')
    .replace(/\b(\d+)\s*minutes?\b/gi, '$1 мин.')
    .replace(/\b1 hour\b/gi, '1 час')
    .replace(/\b(\d+)\s*hours?\b/gi, '$1 ч.')
    .replace(/\b1 day\b/gi, '1 день')
    .replace(/\b(\d+)\s*days?\b/gi, '$1 дн.')
    .replace(/\b1 week\b/gi, '1 неделя')
    .replace(/\b(\d+)\s*weeks?\b/gi, '$1 нед.')
}

function translateTimeFallback(v) {
  if (!v) return ''
  const s = v.trim()
  if (['1', '2', '3', 'reaction', 'free', '1 to 3', '1 or 2', '2 or 3', '1 to 2'].includes(s)) return s
  return translateDurationFallback(s)
}

function normalizeTimeBucket(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'free') return 'free'
  if (s === 'reaction') return 'reaction'
  if (s === '1') return '1'
  if (s === '2') return '2'
  if (s === '3') return '3'
  if (s.includes('to') || s.includes('or')) return 'var'
  if (/^1\s*minute/.test(s)) return '1m'
  if (/^10\s*minute/.test(s)) return '10m'
  if (/^1\s*hour/.test(s)) return '1h'
  return 'long'
}

function parseRange(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return { ft: -1, bucket: 'self' }
  if (s.includes('touch')) return { ft: 0, bucket: 'touch' }
  const mFt = /(\d[\d,]*)\s*(?:feet|foot|ft)/.exec(s)
  if (mFt) {
    const ft = Number(mFt[1].replace(/,/g, ''))
    const bucket = ft <= 30 ? 'short' : ft <= 60 ? 'med' : ft <= 120 ? 'long' : 'far'
    return { ft, bucket }
  }
  const mMi = /(\d[\d,]*)\s*mile/.exec(s)
  if (mMi) {
    const ft = Number(mMi[1].replace(/,/g, '')) * 5280
    return { ft, bucket: 'far' }
  }
  return { ft: null, bucket: 'special' }
}

function parseDurationBucket(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return 'instant'
  if (s.includes('unlimited') || s.includes('permanent')) return 'unlimited'
  if (s === '1 round' || s.includes('next turn') || s.includes('current turn') || s.includes('start of your') || s.includes('end of your')) return 'round'
  if (/round/.test(s)) return 'rounds'
  if (/^1\s*minute/.test(s)) return '1m'
  if (/^(?:10|5)\s*minute/.test(s)) return '10m'
  if (/^(?:1|2|3|4)\s*hour/.test(s)) return '1h'
  if (/8\s*hour|daily prep/.test(s)) return '8h'
  if (/day|week|month|year|24\s*hour/.test(s)) return 'day'
  return 'other'
}

function extractConditions(enDesc) {
  const found = new Set()
  const s = String(enDesc || '')
  // Match @UUID[Compendium.pf2e.conditionitems.Item.<Name>] and @Condition[<slug>]
  for (const m of s.matchAll(/@UUID\[Compendium\.pf2e\.conditionitems\.Item\.([^\]]+)\]/gi)) {
    let slug = m[1].toLowerCase().trim().replace(/\s+/g, '-')
    if (slug === 'flat-footed') slug = 'off-guard'
    if (CONDITIONS_MAP[slug]) found.add(slug)
  }
  for (const m of s.matchAll(/@Condition\[([a-z-]+)(?:\|[^\]]*)?\]/gi)) {
    let slug = m[1].toLowerCase()
    if (slug === 'flat-footed') slug = 'off-guard'
    if (CONDITIONS_MAP[slug]) found.add(slug)
  }
  return [...found].sort()
}

function usageToGroup(u) {
  const s = String(u || '')
  if (!s) return 'other'
  if (s === 'held-in-one-hand' || s === 'held-in-one-hand-or-free-standing' || s === 'held-in-1-hand-hung-on-a-cord-or-attached-to-clothing') return 'held1'
  if (s === 'held-in-two-hands' || s === 'held-in-one-or-two-hands' || s === 'held-in-one-plus-hands') return 'held2'
  if (s.startsWith('etched-onto')) return 'etched'
  if (s.startsWith('affixed-to') || s.startsWith('affixed-or') || s.startsWith('attached-to')) return 'affixed'
  if (s.startsWith('applied-to')) return 'applied'
  if (s === 'carried') return 'carried'
  if (s === 'worn' || s === 'worn-under-armor' || s === 'worn-and-attached-to-two-weapons') return 'worn'
  if (s.startsWith('worn')) return 'worn-slot'
  if (s === 'tattooed-on-the-body' || s === 'implanted' || s === 'bonded' || s === 'sewn-into-clothing') return 'worn-slot'
  return 'other'
}

function handsFromUsage(u, type) {
  const s = String(u || '')
  if (s === 'held-in-one-hand' || s === 'held-in-one-hand-or-free-standing' || s === 'affixed-or-held-in-one-hand' || s === 'held-in-1-hand-hung-on-a-cord-or-attached-to-clothing') return 1
  if (s === 'held-in-two-hands' || s === 'held-in-one-or-two-hands' || s === 'held-in-one-plus-hands') return 2
  if (type === 'shield') return 1
  return null
}

function priceToCp(val) {
  if (!val || typeof val !== 'object') return 0
  return (Number(val.pp) || 0) * 1000 + (Number(val.gp) || 0) * 100 + (Number(val.sp) || 0) * 10 + (Number(val.cp) || 0)
}

function formatPriceText(val, per) {
  if (!val || typeof val !== 'object') return ''
  const parts = []
  if (val.pp) parts.push(`${val.pp} pp`)
  if (val.gp) parts.push(`${val.gp} gp`)
  if (val.sp) parts.push(`${val.sp} sp`)
  if (val.cp) parts.push(`${val.cp} cp`)
  if (!parts.length) return ''
  const base = parts.join(', ')
  return per && per > 1 ? `${base} / ${per}` : base
}

function extractActivations(enDesc) {
  const s = String(enDesc || '')
  const acts = new Set()
  // Look for Activate— or Activate @Glyph[...] or [one-action] etc.
  const hasAct = /\bActivate\b|@Glyph\[|action-glyph/i.test(s)
  if (!hasAct) return { hasActivation: false, actActions: [] }
  for (const m of s.matchAll(/<span class="action-glyph">([^<]+)<\/span>|@Glyph\[([^\]]+)\]/gi)) {
    const g = (m[1] || m[2] || '').trim().toLowerCase()
    if (g === '1' || g === 'a') acts.add('1')
    else if (g === '2' || g === 'd') acts.add('2')
    else if (g === '3' || g === 't') acts.add('3')
    else if (g === 'f' || g === 'free') acts.add('free')
    else if (g === 'r' || g === 'reaction') acts.add('reaction')
  }
  if (/Activate[^<]{0,60}(?:minute|hour|day)/i.test(s)) acts.add('long')
  return { hasActivation: true, actActions: [...acts].sort() }
}

// 1. Build Deity -> Spell UUID/Name map
const deitySpellMap = new Map() // spell slug/name/id -> Set<deityName>
const allDeities = new Set()
for (const f of walk(path.join(pf2eSrc, 'packs/pf2e/deities'))) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (j.type !== 'deity') continue
  const dName = j.name
  const spellsObj = j.system?.spells || {}
  let grantedAny = false
  for (const uuid of Object.values(spellsObj)) {
    if (typeof uuid !== 'string') continue
    const ref = uuid.split('.').pop() // item ID or name
    if (!ref) continue
    grantedAny = true
    if (!deitySpellMap.has(ref)) deitySpellMap.set(ref, new Set())
    deitySpellMap.get(ref).add(dName)
  }
  if (grantedAny) allDeities.add(dName)
}

// 2. Process all Spells
const spellsIndex = []
const spellsDescEn = {}
const spellsDescRu = {}
const allTraitsUsed = new Set()
const spellPubs = new Set()
const missingRuSpells = []

for (const f of walk(path.join(pf2eSrc, 'packs/pf2e/spells'))) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (j.type !== 'spell') continue
  const s = j.system || {}
  const folder = path.relative(path.join(pf2eSrc, 'packs/pf2e/spells'), f).split(path.sep)[0]
  const traits = Array.isArray(s.traits?.value) ? s.traits.value : []
  for (const t of traits) allTraitsUsed.add(t)

  const isCantrip = traits.includes('cantrip')
  const isFocus = folder === 'focus' || traits.includes('focus')
  const isRitual = Boolean(s.ritual) || folder === 'rituals'
  const isImpossible = folder === 'impossible-spells'
  const cat = isRitual ? 'ritual' : isImpossible ? 'impossible' : isFocus ? 'focus' : isCantrip ? 'cantrip' : 'spell'
  const baseRank = Number(s.level?.value) || 1
  const rank = isCantrip && !isFocus ? 0 : baseRank

  const rBase = ruSpells[j.name] || {}
  const rOv = overlay.spells?.[j.name] || {}
  const ruName = (hasCyr(rOv.name) ? rOv.name : hasCyr(rBase.name) ? rBase.name : j.name).trim()
  const enDesc = (s.description?.value || '').trim()
  const ruDescRaw = isRuText(rOv.description) ? rOv.description : isRuText(rBase.description) ? rBase.description : ''
  if (!hasCyr(ruName) || (enDesc && !isRuText(ruDescRaw))) {
    missingRuSpells.push(j.name)
  }

  const timeRaw = String(s.time?.value || '').trim()
  const timeRu = (rOv.time || rBase.time || translateTimeFallback(timeRaw)).trim()
  const rangeRaw = String(s.range?.value || '').trim()
  const rangeRu = (hasCyr(rOv.range) ? rOv.range : hasCyr(rBase.range) ? rBase.range : translateRangeFallback(rangeRaw)).trim()
  const { ft: rangeFt, bucket: rangeBucket } = parseRange(rangeRaw)
  const targetRaw = String(s.target?.value || '').trim()
  const targetRu = (rOv.target || rBase.target || targetRaw).trim()
  const durRaw = String(s.duration?.value || '').trim()
  const durationRu = (rOv.duration || rBase.duration || translateDurationFallback(durRaw)).trim()
  const costRaw = String(s.cost?.value || '').trim()
  const costRu = (rOv.cost || rBase.cost || costRaw).trim()
  const reqRaw = String(s.requirements || '').trim()
  const reqRu = (rOv.requirements || rBase.requirements || reqRaw).trim()

  // Defense
  const hasAttack = traits.includes('attack') || s.defense?.passive?.statistic === 'ac'
  const saveStat = s.defense?.save?.statistic || null
  const basicSave = Boolean(s.defense?.save?.basic)
  const defenseKind = hasAttack && saveStat ? 'both' : hasAttack ? 'attack' : saveStat ? 'save' : 'none'

  // Damage & healing
  const dmgTypes = new Set()
  let hasPersistent = false
  let hasHealing = traits.includes('healing')
  for (const d of Object.values(s.damage || {})) {
    if (!d || typeof d !== 'object') continue
    if (d.type) dmgTypes.add(d.type)
    if (d.category === 'persistent') hasPersistent = true
    if (d.kinds && Array.isArray(d.kinds) && d.kinds.includes('healing')) hasHealing = true
  }
  // Also catch persistent damage in description if structured field missed it
  if (!hasPersistent && /persistent/i.test(enDesc) && /@Damage\[[^\]]*persistent/i.test(enDesc)) hasPersistent = true

  // Heightening
  let heightenType = 'none'
  let heightenStep = null
  let heightenLevels = []
  if (s.heightening?.type === 'interval') {
    heightenType = 'interval'
    heightenStep = Number(s.heightening.interval) || 1
  } else if (s.heightening?.type === 'fixed' && s.heightening.levels) {
    heightenType = 'fixed'
    heightenLevels = Object.keys(s.heightening.levels).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  } else if (/Heightened\s*\(\+(\d+)\)/i.test(enDesc)) {
    heightenType = 'interval'
    heightenStep = Number(/Heightened\s*\(\+(\d+)\)/i.exec(enDesc)[1]) || 1
  } else if (/Heightened\s*\(\d+(?:st|nd|rd|th)\)/i.test(enDesc)) {
    heightenType = 'fixed'
    const lvls = new Set()
    for (const m of enDesc.matchAll(/Heightened\s*\((\d+)(?:st|nd|rd|th)\)/gi)) lvls.add(Number(m[1]))
    heightenLevels = [...lvls].sort((a, b) => a - b)
  }

  // Deities granting this spell
  const deities = new Set([
    ...(deitySpellMap.get(j._id) || []),
    ...(deitySpellMap.get(j.name) || []),
  ])

  const pub = String(s.publication?.title || '').trim()
  if (pub) spellPubs.add(pub)

  const id = j._id
  spellsIndex.push({
    id,
    slug: slugify(j.name),
    en: j.name,
    ru: ruName,
    rank,
    baseRank,
    cat,
    traditions: Array.isArray(s.traits?.traditions) ? s.traits.traditions : [],
    rarity: s.traits?.rarity || 'common',
    traits,
    time: timeRaw,
    timeBucket: normalizeTimeBucket(timeRaw),
    timeRu,
    range: rangeRaw,
    rangeRu,
    rangeFt,
    rangeBucket,
    target: targetRaw,
    targetRu,
    areaType: s.area?.type || null,
    areaVal: s.area?.value != null ? Number(s.area.value) : null,
    duration: durRaw,
    durationRu,
    durationBucket: parseDurationBucket(durRaw),
    sustained: Boolean(s.duration?.sustained),
    defenseKind,
    save: saveStat,
    basicSave,
    damageTypes: [...dmgTypes].sort(),
    hasPersistent,
    hasHealing,
    conditions: extractConditions(enDesc),
    heightenType,
    heightenStep,
    heightenLevels,
    hasCost: Boolean(costRaw),
    cost: costRaw,
    costRu,
    hasReq: Boolean(reqRaw),
    req: reqRaw,
    reqRu,
    counteract: Boolean(s.counteraction) || /\bcounteract\b/i.test(enDesc),
    ritual: s.ritual
      ? {
          primaryCheck: s.ritual.primary?.check || '',
          secondaryCasters: Number(s.ritual.secondary?.casters) || 0,
          secondaryChecks: s.ritual.secondary?.checks || '',
        }
      : null,
    deities: [...deities].sort(),
    pub,
    remaster: Boolean(s.publication?.remaster),
  })

  spellsDescEn[id] = enDesc
  spellsDescRu[id] = ruDescRaw || enDesc
}

spellsIndex.sort((a, b) => a.rank - b.rank || a.ru.localeCompare(b.ru, 'ru'))

// 3. Process all Equipment
const itemsIndex = []
const itemsDescEn = {}
const itemsDescRu = {}
const itemPubs = new Set()
const usagesUsed = new Set()
const missingRuItems = []

for (const f of walk(path.join(pf2eSrc, 'packs/pf2e/equipment'))) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (!j.type) continue
  const s = j.system || {}
  const traits = Array.isArray(s.traits?.value) ? s.traits.value : []
  for (const t of traits) allTraitsUsed.add(t)

  const rBase = ruEquip[j.name] || {}
  const rOv = overlay.equipment?.[j.name] || {}
  const ruName = (hasCyr(rOv.name) ? rOv.name : hasCyr(rBase.name) ? rBase.name : j.name).trim()
  const enDesc = inlineEmbeds((s.description?.value || '').trim(), 'en')
  const ruDescCandidate = inlineEmbeds((rOv.description || '').trim(), 'ru')
  const ruBaseCandidate = inlineEmbeds((rBase.description || '').trim(), 'ru')
  const ruDescRaw = isRuText(ruDescCandidate) ? ruDescCandidate : isRuText(ruBaseCandidate) ? ruBaseCandidate : ''
  if (!hasCyr(ruName) || (enDesc && !isRuText(ruDescRaw))) {
    missingRuItems.push(j.name)
  }

  const pricePer = Math.max(1, Number(s.price?.per) || 1)
  const priceCp = priceToCp(s.price?.value)
  const priceText = formatPriceText(s.price?.value, pricePer)

  // Bulk
  const bulkWorn = Number(s.bulk?.value) || 0
  const bulkHeld = s.bulk?.heldOrStowed != null ? Number(s.bulk.heldOrStowed) : bulkWorn
  let bulkPer = 1
  if (j.type === 'treasure' && s.category === 'coin') bulkPer = 1000
  else if (j.type === 'ammo' && pricePer > 1) bulkPer = pricePer
  else if (Number(s.quantity) > 1 && pricePer > 1 && bulkWorn > 0 && bulkWorn <= 0.1) bulkPer = pricePer

  const capacity = Number(s.bulk?.capacity) || 0
  const ignored = Number(s.bulk?.ignored) || 0
  const stowing = Boolean(s.stowing) || j.type === 'backpack'
  const extradimensional = traits.includes('extradimensional')

  const usage = String(s.usage?.value || '')
  if (usage) usagesUsed.add(usage)

  const isWeapon = j.type === 'weapon'
  const isArmor = j.type === 'armor'
  const isShield = j.type === 'shield'
  const wRange = isWeapon && s.range != null ? Number(s.range) : null
  const isThrown = isWeapon && traits.some((t) => t === 'thrown' || t.startsWith('thrown-'))
  const isRanged = isWeapon && (wRange != null && wRange > 0)

  const { hasActivation, actActions } = extractActivations(enDesc)
  const isRune = usage.startsWith('etched-onto') || /\brune\b/i.test(j.name)

  const pub = String(s.publication?.title || '').trim()
  if (pub) itemPubs.add(pub)

  const id = j._id
  itemsIndex.push({
    id,
    slug: slugify(j.name),
    en: j.name,
    ru: ruName,
    type: j.type,
    level: Number(s.level?.value) || 0,
    rarity: s.traits?.rarity || 'common',
    traits,
    priceCp,
    pricePer,
    priceText,
    bulk: bulkWorn,
    bulkHeld,
    bulkPer,
    capacity,
    ignored,
    stowing,
    extradimensional,
    usage,
    usageGroup: usageToGroup(usage),
    hands: handsFromUsage(usage, j.type),
    category: String(s.category || ''),
    group: String(s.group || ''),
    baseItem: String(s.baseItem || ''),
    material: String(s.material?.type || ''),
    grade: String(s.material?.grade || ''),
    size: String(s.size || 'med'),
    die: isWeapon ? String(s.damage?.die || '') : '',
    diceNum: isWeapon ? Number(s.damage?.dice) || 0 : 0,
    dmgType: isWeapon ? String(s.damage?.damageType || '') : '',
    wRange,
    reload: isWeapon && s.reload?.value != null ? String(s.reload.value) : '',
    isRanged,
    isThrown,
    isSpecific: Boolean(s.specific),
    isStaff: traits.includes('staff') || Boolean(s.staff),
    acBonus: isArmor || isShield ? (s.acBonus != null ? Number(s.acBonus) : null) : null,
    dexCap: isArmor && s.dexCap != null ? Number(s.dexCap) : null,
    checkPenalty: isArmor && s.checkPenalty != null ? Number(s.checkPenalty) : null,
    speedPenalty: (isArmor || isShield) && s.speedPenalty != null ? Number(s.speedPenalty) : null,
    strReq: isArmor && s.strength != null ? Number(s.strength) : null,
    hardness: s.hardness != null && (isShield || Number(s.hardness) > 0) ? Number(s.hardness) : null,
    hp: s.hp?.max != null && (isShield || Number(s.hp.max) > 0) ? Number(s.hp.max) : null,
    apex: s.apex?.attribute || '',
    invested: traits.includes('invested'),
    magical: traits.includes('magical') || traits.includes('arcane') || traits.includes('divine') || traits.includes('occult') || traits.includes('primal'),
    alchemical: traits.includes('alchemical'),
    cursed: traits.includes('cursed'),
    artifact: traits.includes('artifact'),
    hasActivation,
    actActions,
    isRune,
    pub,
    remaster: Boolean(s.publication?.remaster),
  })

  itemsDescEn[id] = enDesc
  itemsDescRu[id] = ruDescRaw || enDesc
}

itemsIndex.sort((a, b) => a.level - b.level || a.ru.localeCompare(b.ru, 'ru'))

// 4. Build localized Meta dictionary
const traitsDict = {}
for (const t of [...allTraitsUsed].sort()) {
  const k = 'Trait' + toPascal(t)
  const enVal = enLang.PF2E?.[k] || titleCase(t)
  const ruVal = ruLang.PF2E?.[k] || EXTRA_TRAITS_RU[t] || enVal
  traitsDict[t] = { en: enVal, ru: ruVal }
}

const usagesDict = {}
for (const u of [...usagesUsed].sort()) {
  const k = 'Item.Physical.Usage.' + u
  const enVal = enLang.PF2E?.Item?.Physical?.Usage?.[u] || titleCase(u)
  const ruVal = ruLang.PF2E?.Item?.Physical?.Usage?.[u] || enVal
  usagesDict[u] = { en: enVal, ru: ruVal }
}

const mapPairs = (obj) => Object.fromEntries(Object.entries(obj).map(([k, [en, ru]]) => [k, { en, ru }]))

const meta = {
  version: 'pf2e-8.7.1',
  builtAt: new Date().toISOString(),
  spellCount: spellsIndex.length,
  itemCount: itemsIndex.length,
  traits: traitsDict,
  conditions: mapPairs(CONDITIONS_MAP),
  damageTypes: mapPairs(DAMAGE_RU),
  weaponGroups: mapPairs(WEAPON_GROUPS_RU),
  armorGroups: mapPairs(ARMOR_GROUPS_RU),
  consumableCats: mapPairs(CONSUMABLE_CATS_RU),
  materials: mapPairs(MATERIALS_RU),
  usages: usagesDict,
  deities: [...allDeities].sort((a, b) => a.localeCompare(b)),
  spellPubs: [...spellPubs].sort((a, b) => a.localeCompare(b)),
  itemPubs: [...itemPubs].sort((a, b) => a.localeCompare(b)),
}

const writeJson = (name, obj) => {
  const p = path.join(outDir, name)
  const str = JSON.stringify(obj)
  fs.writeFileSync(p, str, 'utf8')
  console.log(`Wrote ${name}: ${(str.length / 1024 / 1024).toFixed(2)} MB`)
}

writeJson('meta.json', meta)
writeJson('spells-index.json', spellsIndex)
writeJson('spells-desc-en.json', spellsDescEn)
writeJson('spells-desc-ru.json', spellsDescRu)
writeJson('items-index.json', itemsIndex)
writeJson('items-desc-en.json', itemsDescEn)
writeJson('items-desc-ru.json', itemsDescRu)

console.log('\n=== SUMMARY ===')
console.log(`Spells: ${spellsIndex.length} (missing RU: ${missingRuSpells.length})`)
console.log(`Items:  ${itemsIndex.length} (missing RU: ${missingRuItems.length})`)
if (missingRuSpells.length) console.log('Missing RU spells:', missingRuSpells.slice(0, 20))
if (missingRuItems.length) console.log('Missing RU items:', missingRuItems.slice(0, 20))
