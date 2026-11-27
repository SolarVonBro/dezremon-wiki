#!/usr/bin/env node
// Compiles official Pathfinder 2e (Remaster, through Nov 2026: Impossible Magic, Dark Archive Rem., Feybound)
// spells & equipment from foundryvtt/pf2e packs + community Russian translations (pf2r) + scripts/pf2e-ru-overlay.json
// into compact static JSON files in public/data/pf2e/ AND bundles all referenced Foundry icons into public/icons/pf2e/.
//
// Usage:
//   node scripts/build-pf2e-data.mjs <pf2e-src-dir> <pf2r-dir> [foundry-core-icons-dir]
import fs from 'node:fs'
import path from 'node:path'

const pf2eSrc = process.argv[2]
const pf2rDir = process.argv[3]
const coreIconsDir = process.argv[4] || ''
if (!pf2eSrc || !pf2rDir) {
  console.error('Usage: node scripts/build-pf2e-data.mjs <pf2e-src-dir> <pf2r-dir> [foundry-core-icons-dir]')
  process.exit(1)
}

const repoRoot = process.cwd()
const overlayPath = path.join(repoRoot, 'scripts', 'pf2e-ru-overlay.json')
const outDir = path.join(repoRoot, 'public', 'data', 'pf2e')
const iconsOutDir = path.join(repoRoot, 'public', 'icons', 'pf2e')
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(iconsOutDir, { recursive: true })

function walk(dir) {
  let out = []
  if (!fs.existsSync(dir)) return out
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

const enLang = deepMerge(
  JSON.parse(fs.readFileSync(path.join(pf2eSrc, 'static/lang/en.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(pf2eSrc, 'static/lang/re-en.json'), 'utf8')),
)
const ruLang = deepMerge(
  JSON.parse(fs.readFileSync(path.join(pf2rDir, 'pf2e.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(pf2rDir, 're-pf2e.json'), 'utf8')),
)

function loadPf2r(filename) {
  const p = path.join(pf2rDir, filename)
  if (!fs.existsSync(p)) return {}
  return JSON.parse(fs.readFileSync(p, 'utf8')).entries || {}
}

const ruSpells = loadPf2r('pf2e.spells-srd.json')
const ruEquip = loadPf2r('pf2e.equipment-srd.json')
const ruClassFeatures = loadPf2r('pf2e.classfeatures.json')
const overlay = fs.existsSync(overlayPath) ? JSON.parse(fs.readFileSync(overlayPath, 'utf8')) : { spells: {}, equipment: {} }

// ==================== 0. Index ALL compendiums for @UUID & @Embed resolution ====================
// Maps packId (as used in Compendium.pf2e.<packId>) -> { dir, pf2rFile }
const PACK_SOURCES = [
  ['spells-srd', 'spells', 'pf2e.spells-srd.json'],
  ['equipment-srd', 'equipment', 'pf2e.equipment-srd.json'],
  ['actionspf2e', 'actions', 'pf2e.actionspf2e.json'],
  ['conditionitems', 'conditions', 'pf2e.conditionitems.json'],
  ['feats-srd', 'feats', 'pf2e.feats-srd.json'],
  ['classfeatures', 'class-features', 'pf2e.classfeatures.json'],
  ['ancestryfeatures', 'ancestry-features', 'pf2e.ancestryfeatures.json'],
  ['deities', 'deities', 'pf2e.deities.json'],
  ['heritages', 'heritages', 'pf2e.heritages.json'],
  ['familiar-abilities', 'familiar-abilities', 'pf2e.familiar-abilities.json'],
  ['hazards', 'hazards', 'pf2e.hazards.json'],
  ['vehicles', 'vehicles', 'pf2e.vehicles.json'],
  ['rollable-tables', 'rollable-tables', 'pf2e.rollable-tables.json'],
  ['spell-effects', 'spell-effects', 'pf2e.spell-effects.json'],
  ['equipment-effects', 'equipment-effects', 'pf2e.equipment-effects.json'],
  ['feat-effects', 'feat-effects', 'pf2e.feat-effects.json'],
  ['other-effects', 'other-effects', 'pf2e.other-effects.json'],
  ['bestiary-ability-glossary-srd', 'bestiary-ability-glossary-srd', 'pf2e.bestiary-ability-glossary-srd.json'],
  ['bestiary-family-ability-glossary', 'bestiary-family-ability-glossary', null],
  ['bestiary-effects', 'bestiary-effects', null],
  ['action-macros', 'action-macros', null],
  ['pathfinder-monster-core', 'pathfinder-monster-core', 'pf2e.pathfinder-monster-core.json'],
  ['pathfinder-monster-core-2', 'pathfinder-monster-core-2', 'pf2e.pathfinder-monster-core-2.json'],
  ['pathfinder-bestiary', 'pathfinder-bestiary', null],
  ['pathfinder-bestiary-2', 'pathfinder-bestiary-2', null],
  ['pathfinder-bestiary-3', 'pathfinder-bestiary-3', null],
  ['book-of-the-dead-bestiary', 'book-of-the-dead-bestiary', null],
  ['howl-of-the-wild-bestiary', 'howl-of-the-wild-bestiary', null],
  ['rage-of-elements-bestiary', 'rage-of-elements-bestiary', null],
  ['lost-omens-bestiary', 'lost-omens-bestiary', null],
  ['kingmaker-bestiary', 'kingmaker-bestiary', null],
  ['night-of-the-gray-death-bestiary', 'night-of-the-gray-death-bestiary', null],
  ['pathfinder-npc-core', 'pathfinder-npc-core', null],
  ['wardens-of-wildwood-bestiary', 'wardens-of-wildwood-bestiary', null],
  ['age-of-ashes-bestiary', 'age-of-ashes-bestiary', null],
]

// packIndex: Map<packId, Map<idOrNameOrSlug, { id, en, ru }>>
const packIndex = new Map()
const globalById = new Map()
const spellLookup = new Map() // id | en | lower(en) | slug -> { id, en, ru }
const itemLookup = new Map()  // id | en | lower(en) | slug -> { id, en, ru }

// Legacy pre-Remaster spell/item name aliases for older pf2r @UUID links
const SPELL_ALIASES = {
  'magic-missile': 'force-barrage',
  'true-strike': 'sure-strike',
  'dimension-door': 'translocate',
  'feather-fall': 'gentle-landing',
  'glitterdust': 'revealing-light',
  'mage-armor': 'mystic-armor',
  'mage-hand': 'telekinetic-hand',
  'produce-flame': 'ignition',
  'ray-of-frost': 'frostbite',
  'dancing-lights': 'light',
  'neutralize-poison': 'cleanse-affliction',
  'remove-disease': 'cleanse-affliction',
  'remove-curse': 'cleanse-affliction',
  'remove-fear': 'clear-mind',
  'remove-paralysis': 'sure-footing',
  'restoration': 'sound-body',
  'restore-senses': 'sound-body',
  'freedom-of-movement': 'unfettered-movement',
  'crushing-despair': 'wave-of-despair',
  'hideous-laughter': 'laughing-fit',
  'comprehend-language': 'translate',
  'tongues': 'truespeech',
  'true-seeing': 'truesight',
  'see-invisibility': 'see-the-unseen',
  'entangle': 'entangling-flora',
  'barkskin': 'oaken-resilience',
  'stone-skin': 'mountain-resilience',
  'stoneskin': 'mountain-resilience',
  'pass-without-trace': 'vanishing-tracks',
  'obscuring-mist': 'mist',
  'solid-fog': 'stagnate-time',
  'cloudkill': 'toxic-cloud',
  'flaming-sphere': 'floating-flame',
  'burning-hands': 'breathe-fire',
  'chill-touch': 'void-warp',
  'disrupt-undead': 'vitality-lash',
  'positive-luminance': 'vital-beacon',
  'calm-emotions': 'calm',
  'charm': 'charm',
  'command': 'command',
  'enfeeble': 'enfeeble',
  'fear': 'fear',
  'globe-of-invulnerability': 'dispelling-globe',
  'longstrider': 'tailwind',
  'magic-weapon': 'runic-weapon',
  'magic-fang': 'runic-body',
  'nondetection': 'veil-of-privacy',
  'plane-shift': 'interplanar-teleport',
  'prying-eye': 'scouting-eye',
  'scorching-ray': 'blazing-bolt',
  'shapechange': 'avatar',
  'shield-other': 'share-life',
  'spiritual-weapon': 'spiritual-armament',
  'tree-stride': 'nature-s-pathway',
  'unseen-servant': 'phantasmal-minion',
  'vampiric-touch': 'vampiric-feast',
  'wall-of-thorns': 'wall-of-shrubs',
  'animate-dead': 'summon-undead',
  'gentle-repose': 'peaceful-rest',
  'ghoul-touch': 'ghoulish-cravings',
  'locate': 'locate',
  'detect-alignment': 'detect-magic',
  'protection': 'protection',
  'detect-poison': 'detect-poison',
  'purify-food-and-drink': 'clean-cuisine',
  'know-direction': 'know-the-way',
  'color-spray': 'dizzying-colors',
  'grease': 'grease',
  'gust-of-wind': 'gust-of-wind',
  'shocking-grasp': 'thunderstrike',
  'spider-climb': 'gecko-grip',
  'touch-of-idiocy': 'stupefy',
  'vampiric-exanguination': 'vampiric-exsanguination',
  'gaseous-form': 'vapor-form',
  'flesh-to-stone': 'petrify',
  'baleful-polymorph': 'cursed-metamorphosis',
  'maze': 'quandary',
  'mind-blank': 'hidden-mind',
  'power-word-blind': 'blindness',
  'power-word-stun': 'stun',
  'wail-of-the-banshee': 'wails-of-the-damned',
  'wish': 'wish',
}

// Manual fallbacks for 2 legacy upstream UUIDs (pf2e-ru private journal & legacy Bestiary 1 Horse)
const MANUAL_UUID_LABELS = {
  Vu0ZL4Lp4mxLAZHJ: { en: 'Special Materials', ru: 'Особые материалы' },
  In2nNwo3JL1RXQhj: { en: 'Riding Horse', ru: 'Верховая лошадь' },
}

// Explicit high-quality icon overrides for 4 Foundry v14 core folders absent in older local Foundry installs
const MANUAL_CORE_ICON_MAP = {
  'environment/cosmos/planet-moon-blue.webp': { src: 'core', rel: 'commodities/currency/coin-engraved-moon-silver.webp' },
  'environment/cosmos/astronomy-planetary-orbits.webp': { src: 'core', rel: 'skills/trades/academics-astronomy-navigation-blue.webp' },
  'environment/vehicles/boat-fishing-masted.webp': { src: 'core', rel: 'environment/settlement/ship.webp' },
  'tools/medical/toolkit-surgical-pink.webp': { src: 'pf2e', rel: 'equipment/adventuring-gear/healers-tools.webp' },
}

// Also index full descriptions of actions, feats, spells, equipment, class-features, journals for @Embed[...] inlining
const embedDescByPackId = new Map() // `${packId}:${idOrName}` -> { en, ru }
const embedDescById = new Map() // id -> { en, ru }

for (const [packId, dirName, pf2rFile] of PACK_SOURCES) {
  const dirPath = path.join(pf2eSrc, 'packs/pf2e', dirName)
  if (!fs.existsSync(dirPath)) continue
  const ruDict = pf2rFile ? loadPf2r(pf2rFile) : {}
  const map = new Map()
  packIndex.set(packId, map)
  for (const f of walk(dirPath)) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!j.name) continue
    const ov = packId === 'spells-srd' ? overlay.spells?.[j.name] : packId === 'equipment-srd' ? overlay.equipment?.[j.name] : null
    const rb = ruDict[j.name] || {}
    const ruName = (hasCyr(ov?.name) ? ov.name : hasCyr(rb.name) ? rb.name : j.name).trim()
    const rec = { id: j._id, en: j.name, ru: ruName }
    if (j._id) {
      map.set(j._id, rec)
      globalById.set(j._id, { packId, ...rec })
    }
    map.set(j.name, rec)
    map.set(j.name.toLowerCase(), rec)
    const sl = j.system?.slug || slugify(j.name)
    if (sl) map.set(sl, rec)

    if (['classfeatures', 'actionspf2e', 'feats-srd', 'equipment-srd', 'spells-srd', 'bestiary-ability-glossary-srd'].includes(packId)) {
      const enD = (j.system?.description?.value || '').trim()
      const ruD = (isRuText(ov?.description) ? ov.description : isRuText(rb.description) ? rb.description : '').trim()
      if (enD) {
        const dRec = { en: enD, ru: ruD || enD }
        if (j._id) {
          embedDescByPackId.set(`${packId}:${j._id}`, dRec)
          embedDescById.set(j._id, dRec)
        }
        embedDescByPackId.set(`${packId}:${j.name}`, dRec)
      }
    }

    if (packId === 'spells-srd' && j.type === 'spell') {
      if (j._id) spellLookup.set(j._id, rec)
      spellLookup.set(j.name, rec)
      spellLookup.set(j.name.toLowerCase(), rec)
      spellLookup.set(slugify(j.name), rec)
      if (sl) spellLookup.set(sl, rec)
    } else if (packId === 'equipment-srd' && j.type) {
      if (j._id) itemLookup.set(j._id, rec)
      itemLookup.set(j.name, rec)
      itemLookup.set(j.name.toLowerCase(), rec)
      itemLookup.set(slugify(j.name), rec)
      if (sl) itemLookup.set(sl, rec)
    }
  }
}

// Index journals and journal pages (EN + RU)
const journalPageIndex = new Map() // pageId | journalId.pageId | pageName -> { en, ru }
const journalPageContent = new Map() // pageId -> { en, ru }
const ruJournals = loadPf2r('pf2e.journals.json')
for (const f of walk(path.join(pf2eSrc, 'packs/pf2e/journals'))) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  const rj = ruJournals[j.name] || {}
  const jRu = hasCyr(rj.name) ? rj.name : j.name
  if (j._id) journalPageIndex.set(j._id, { en: j.name, ru: jRu })
  journalPageIndex.set(j.name, { en: j.name, ru: jRu })
  for (const p of j.pages || []) {
    const rp = rj.pages?.[p.name] || {}
    const pRu = hasCyr(rp.name) ? rp.name : p.name
    const rec = { en: p.name, ru: pRu }
    if (p._id) {
      journalPageIndex.set(p._id, rec)
      if (j._id) journalPageIndex.set(`${j._id}.${p._id}`, rec)
      const enHtml = (p.text?.content || '').trim()
      const ruHtml = (rp.text || '').trim()
      if (enHtml) journalPageContent.set(p._id, { en: enHtml, ru: isRuText(ruHtml) ? ruHtml : enHtml })
    }
    journalPageIndex.set(p.name, rec)
  }
}

function inlineEmbeds(html, lang) {
  if (!html || !html.includes('@Embed[')) return html
  let out = html
  for (let pass = 0; pass < 4 && out.includes('@Embed['); pass++) {
    const next = out.replace(/<p>\s*@Embed\[([^\]]+)\]\s*<\/p>|@Embed\[([^\]]+)\]/gi, (m, i1, i2) => {
      const inner = (i1 || i2 || '').trim()
      const uuidPart = inner.split(/\s+/)[0]
      const parts = uuidPart.split('.')
      const packId = parts[0] === 'Compendium' ? parts[2] : ''
      const tail = parts[parts.length - 1] || ''
      if (packId === 'journals') {
        const jp = journalPageContent.get(tail)
        if (jp) return lang === 'ru' ? jp.ru : jp.en
        const jMeta = journalPageIndex.get(tail)
        if (jMeta) return `<p><em>${lang === 'ru' ? jMeta.ru : jMeta.en}</em></p>`
      }
      const rec = embedDescByPackId.get(`${packId}:${tail}`) || embedDescById.get(tail)
      if (rec) return lang === 'ru' ? rec.ru : rec.en
      const itemRec = packIndex.get(packId)?.get(tail) || globalById.get(tail)
      if (itemRec) return `@Ref{${lang === 'ru' ? itemRec.ru : itemRec.en}}`
      return ''
    })
    if (next === out) break
    out = next
  }
  return out
}

// Resolve all @UUID[...] references cleanly into @SpellLink[id]{label}, @ItemLink[id]{label}, @Ref{label}
// and remove Foundry-only drag-effect paragraphs.
const EFFECT_PACKS = new Set([
  'spell-effects',
  'equipment-effects',
  'feat-effects',
  'other-effects',
  'bestiary-effects',
  'action-macros',
])

const uuidStats = {
  strippedEffects: 0,
  spellLinks: 0,
  itemLinks: 0,
  refs: 0,
  unresolvedBare: [],
}

function findInSpellLookup(ref) {
  if (!ref) return null
  let hit = spellLookup.get(ref) || spellLookup.get(ref.toLowerCase()) || spellLookup.get(slugify(ref))
  if (!hit) {
    const alias = SPELL_ALIASES[slugify(ref)]
    if (alias) hit = spellLookup.get(alias)
  }
  return hit || null
}

function findInItemLookup(ref) {
  if (!ref) return null
  return itemLookup.get(ref) || itemLookup.get(ref.toLowerCase()) || itemLookup.get(slugify(ref)) || null
}

function resolveUuids(html, lang, ctxName) {
  if (!html) return ''
  let out = html

  // Fix occasional upstream double-wrapped @UUID[@UUID[...
  out = out.replace(/@UUID\[@UUID\[/g, '@UUID[')

  // 1. Strip standalone Foundry VTT drag-to-token effect paragraphs (like Shield's Spell Effect pills)
  out = out.replace(
    /<p>\s*(?:<(?:em|strong|b|i)>\s*)*@UUID\[Compendium\.pf2e\.(?:spell-effects|equipment-effects|feat-effects|other-effects|bestiary-effects|action-macros)\.[^\]]+\](?:\{[^}]*\})?(?:\s*<\/(?:em|strong|b|i)>)*\s*<\/p>/gi,
    () => {
      uuidStats.strippedEffects++
      return ''
    },
  )

  // 2. Replace all remaining @UUID[target]{optLabel}
  out = out.replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g, (match, rawTarget, rawLabel) => {
    const target = String(rawTarget || '').trim()
    const explicitLabel = (rawLabel || '').trim()
    const parts = target.split('.')
    // Standard format: Compendium.<ns>.<packId>.<docType>.<idOrName>(.JournalEntryPage.<pageId>)?
    const ns = parts[0] === 'Compendium' ? parts[1] : ''
    const packId = parts[0] === 'Compendium' ? parts[2] : ''
    const tail = parts[parts.length - 1] || ''

    // Spell links -> clickable @SpellLink[id]{label}
    if (packId === 'spells-srd') {
      const hit = findInSpellLookup(tail) || (explicitLabel ? findInSpellLookup(explicitLabel) : null)
      if (hit) {
        const lbl = explicitLabel || (lang === 'ru' ? hit.ru : hit.en)
        uuidStats.spellLinks++
        return `@SpellLink[${hit.id}]{${lbl}}`
      }
      if (explicitLabel) {
        uuidStats.refs++
        return `@Ref{${explicitLabel}}`
      }
    }

    // Equipment links -> clickable @ItemLink[id]{label}
    if (packId === 'equipment-srd') {
      const hit = findInItemLookup(tail) || (explicitLabel ? findInItemLookup(explicitLabel) : null)
      if (hit) {
        const lbl = explicitLabel || (lang === 'ru' ? hit.ru : hit.en)
        uuidStats.itemLinks++
        return `@ItemLink[${hit.id}]{${lbl}}`
      }
      if (explicitLabel) {
        uuidStats.refs++
        return `@Ref{${explicitLabel}}`
      }
    }

    // Journal links
    if (packId === 'journals' || ns === 'pf2e-ru') {
      if (explicitLabel) {
        uuidStats.refs++
        return `@Ref{${explicitLabel}}`
      }
      const pageHit = journalPageIndex.get(tail) || (parts.length >= 6 ? journalPageIndex.get(`${parts[4]}.${parts[6]}`) : null)
      if (pageHit) {
        uuidStats.refs++
        return `@Ref{${lang === 'ru' ? pageHit.ru : pageHit.en}}`
      }
    }

    // Any other indexed PF2e pack (conditions, actions, feats, deities, bestiaries, inline effects, etc.)
    const pMap = packIndex.get(packId)
    let rec = pMap?.get(tail) || pMap?.get(tail.toLowerCase()) || pMap?.get(slugify(tail))
    if (!rec && tail === 'Flat-Footed') rec = packIndex.get('conditionitems')?.get('off-guard')
    if (!rec) rec = globalById.get(tail)

    if (rec) {
      // If an inline ref happens to point to a spell or equipment via globalById
      if (rec.packId === 'spells-srd') {
        uuidStats.spellLinks++
        return `@SpellLink[${rec.id}]{${explicitLabel || (lang === 'ru' ? rec.ru : rec.en)}}`
      }
      if (rec.packId === 'equipment-srd') {
        uuidStats.itemLinks++
        return `@ItemLink[${rec.id}]{${explicitLabel || (lang === 'ru' ? rec.ru : rec.en)}}`
      }
      let name = explicitLabel || (lang === 'ru' ? rec.ru : rec.en)
      if (!explicitLabel && EFFECT_PACKS.has(packId)) {
        name = name.replace(/^(?:Spell Effect|Effect|Эффект заклинания|Эффект):\s*/i, '')
      }
      uuidStats.refs++
      return `@Ref{${name}}`
    }

    // Fallback: manual override for legacy/private upstream UUIDs
    if (MANUAL_UUID_LABELS[tail]) {
      uuidStats.refs++
      return `@Ref{${lang === 'ru' ? MANUAL_UUID_LABELS[tail].ru : MANUAL_UUID_LABELS[tail].en}}`
    }

    // Fallback: if we have an explicit label, always keep it
    if (explicitLabel) {
      uuidStats.refs++
      return `@Ref{${explicitLabel}}`
    }

    // If tail is a human-readable name (not a 16-char Foundry ID), keep it nicely
    if (tail && !/^[A-Za-z0-9]{16}$/.test(tail)) {
      const slug = slugify(tail)
      const condHit = CONDITIONS_MAP[slug === 'flat-footed' ? 'off-guard' : slug]
      uuidStats.refs++
      return `@Ref{${condHit ? (lang === 'ru' ? condHit[1] : condHit[0]) : tail}}`
    }

    uuidStats.unresolvedBare.push({ ctxName, lang, target })
    return ''
  })

  // Clean up empty paragraphs or trailing <hr /> left behind by stripped effect pills
  out = out.replace(/<p>\s*<\/p>/g, '').replace(/(?:<hr\s*\/?>\s*)+$/i, '').trim()
  return out
}

// ==================== 0.5 Icon Bundler (Foundry PF2e system + Foundry Core icons) ====================
const sysIconsSrc = path.join(pf2eSrc, 'static/icons')
const copiedIcons = new Map() // rawImg -> relative out path (e.g. "pf2e/spells/..." or "core/magic/...")
const coreFolderCache = new Map() // dirPath -> string[] of filenames
const fallbackIconLog = []
let copiedBytes = 0

function listWebpInDir(dirPath) {
  if (coreFolderCache.has(dirPath)) return coreFolderCache.get(dirPath)
  let files = []
  if (fs.existsSync(dirPath)) {
    files = fs.readdirSync(dirPath).filter((f) => /\.(?:webp|png|svg)$/i.test(f))
  }
  coreFolderCache.set(dirPath, files)
  return files
}

function findClosestCoreIcon(relPath) {
  if (!coreIconsDir) return null
  const dirRel = path.dirname(relPath)
  const targetBase = path.basename(relPath, path.extname(relPath)).toLowerCase()
  const targetTokens = new Set(targetBase.split(/[-_]+/).filter(Boolean))

  // Search target folder first, then parent folder's subdirectories
  const candidates = []
  const directDir = path.join(coreIconsDir, dirRel)
  for (const f of listWebpInDir(directDir)) {
    candidates.push({ rel: path.posix.join(dirRel.replace(/\\/g, '/'), f), base: path.basename(f, path.extname(f)).toLowerCase() })
  }
  if (!candidates.length) {
    const parentRel = path.dirname(dirRel)
    const parentDir = path.join(coreIconsDir, parentRel)
    if (fs.existsSync(parentDir)) {
      for (const e of fs.readdirSync(parentDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        for (const f of listWebpInDir(path.join(parentDir, e.name))) {
          candidates.push({
            rel: path.posix.join(parentRel.replace(/\\/g, '/'), e.name, f),
            base: path.basename(f, path.extname(f)).toLowerCase(),
          })
        }
      }
    }
  }
  if (!candidates.length) return null

  let best = candidates[0]
  let bestScore = -1
  for (const c of candidates) {
    const tokens = c.base.split(/[-_]+/).filter(Boolean)
    let score = 0
    for (let i = 0; i < tokens.length; i++) {
      if (targetTokens.has(tokens[i])) score += i === 0 ? 5 : 2
    }
    if (tokens[0] && targetBase.startsWith(tokens[0])) score += 3
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best.rel
}

function copyIconFile(srcFull, relOut) {
  const destFull = path.join(iconsOutDir, relOut)
  if (!fs.existsSync(destFull)) {
    fs.mkdirSync(path.dirname(destFull), { recursive: true })
    fs.copyFileSync(srcFull, destFull)
    copiedBytes += fs.statSync(srcFull).size
  }
  return relOut.replace(/\\/g, '/')
}

function resolveAndCopyIcon(rawImg, fallbackType = 'equipment') {
  const key = String(rawImg || '').trim()
  if (copiedIcons.has(key)) return copiedIcons.get(key)

  let outRel = ''
  if (key.startsWith('systems/pf2e/icons/')) {
    const rel = decodeURIComponent(key.slice('systems/pf2e/icons/'.length))
    const srcFull = path.join(sysIconsSrc, rel)
    if (fs.existsSync(srcFull)) {
      outRel = copyIconFile(srcFull, path.posix.join('pf2e', rel.replace(/\\/g, '/')))
    }
  } else if (key.startsWith('icons/') && coreIconsDir) {
    const rel = decodeURIComponent(key.slice('icons/'.length))
    const override = MANUAL_CORE_ICON_MAP[rel]
    if (override) {
      const srcBase = override.src === 'pf2e' ? sysIconsSrc : coreIconsDir
      const srcFull = path.join(srcBase, override.rel)
      if (fs.existsSync(srcFull)) {
        outRel = copyIconFile(srcFull, path.posix.join(override.src, override.rel.replace(/\\/g, '/')))
        fallbackIconLog.push(`${key} -> ${override.src}/${override.rel}`)
      }
    }
    if (!outRel) {
      const srcFull = path.join(coreIconsDir, rel)
      if (fs.existsSync(srcFull)) {
        outRel = copyIconFile(srcFull, path.posix.join('core', rel.replace(/\\/g, '/')))
      } else {
        const closest = findClosestCoreIcon(rel)
        if (closest) {
          const closeFull = path.join(coreIconsDir, closest)
          outRel = copyIconFile(closeFull, path.posix.join('core', closest.replace(/\\/g, '/')))
          fallbackIconLog.push(`${key} -> core/${closest}`)
        }
      }
    }
  }

  // Final guaranteed fallback: official PF2e default icon for item/spell type
  if (!outRel) {
    const defMap = {
      spell: 'default-icons/spell.svg',
      weapon: 'default-icons/weapon.svg',
      armor: 'default-icons/armor.svg',
      shield: 'default-icons/shield.svg',
      consumable: 'default-icons/consumable.svg',
      backpack: 'default-icons/backpack.svg',
      ammo: 'default-icons/ammo.svg',
      treasure: 'default-icons/treasure.svg',
      kit: 'default-icons/kit.svg',
    }
    const defRel = defMap[fallbackType] || 'default-icons/equipment.svg'
    const defSrc = path.join(sysIconsSrc, defRel)
    if (fs.existsSync(defSrc)) {
      outRel = copyIconFile(defSrc, path.posix.join('pf2e', defRel))
      fallbackIconLog.push(`${key || '(empty)'} -> pf2e/${defRel}`)
    }
  }

  copiedIcons.set(key, outRel)
  return outRel
}

// ==================== Static Dictionaries & Helpers ====================
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

function translateRangeFallback(v) {
  if (!v) return ''
  const s = v.trim()
  if (/^touch$/i.test(s)) return 'касание'
  if (/^planetary$/i.test(s)) return 'в пределах планеты'
  if (/^interplanar$/i.test(s)) return 'межпланарная'
  if (/^unlimited$/i.test(s)) return 'неограниченная'
  if (/^varies$/i.test(s)) return 'вар.'
  return s
    .replace(/\b(\d+)\s*feet\b/gi, '$1 футов')
    .replace(/\b(\d+)\s*foot\b/gi, '$1 фут')
    .replace(/\b(\d+)\s*miles?\b/gi, '$1 миль')
    .replace(/\btouch\b/gi, 'касание')
    .replace(/\bsee text\b/gi, 'см. текст')
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
  const condMap = packIndex.get('conditionitems')
  for (const m of s.matchAll(/@UUID\[Compendium\.pf2e\.conditionitems\.Item\.([^\]]+)\]/gi)) {
    const ref = m[1].trim()
    const resolved = condMap?.get(ref)?.en || ref
    let slug = resolved.toLowerCase().trim().replace(/\s+/g, '-')
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
const deitySpellMap = new Map()
const allDeities = new Set()
for (const f of walk(path.join(pf2eSrc, 'packs/pf2e/deities'))) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (j.type !== 'deity') continue
  const dName = j.name
  const spellsObj = j.system?.spells || {}
  let grantedAny = false
  for (const uuid of Object.values(spellsObj)) {
    if (typeof uuid !== 'string') continue
    const ref = uuid.split('.').pop()
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
  const rawEnDesc = inlineEmbeds((s.description?.value || '').trim(), 'en')
  const rawRuCandidate = inlineEmbeds((rOv.description || '').trim(), 'ru')
  const rawRuBase = inlineEmbeds((rBase.description || '').trim(), 'ru')
  const ruDescRaw = isRuText(rawRuCandidate) ? rawRuCandidate : isRuText(rawRuBase) ? rawRuBase : ''
  if (!hasCyr(ruName) || (rawEnDesc && !isRuText(ruDescRaw))) {
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

  const hasAttack = traits.includes('attack') || s.defense?.passive?.statistic === 'ac'
  const saveStat = s.defense?.save?.statistic || null
  const basicSave = Boolean(s.defense?.save?.basic)
  const defenseKind = hasAttack && saveStat ? 'both' : hasAttack ? 'attack' : saveStat ? 'save' : 'none'

  const dmgTypes = new Set()
  let hasPersistent = false
  let hasHealing = traits.includes('healing')
  const baseDamage = []
  for (const [dKey, d] of Object.entries(s.damage || {})) {
    if (!d || typeof d !== 'object') continue
    if (d.type) dmgTypes.add(d.type)
    if (d.category === 'persistent') hasPersistent = true
    const isHeal = Boolean(d.kinds && Array.isArray(d.kinds) && d.kinds.includes('healing'))
    if (isHeal) hasHealing = true
    if (d.formula && String(d.formula).trim()) {
      const entry = { key: dKey, formula: String(d.formula).trim(), type: String(d.type || 'untyped') }
      if (d.category) entry.category = d.category
      if (isHeal) entry.healing = true
      baseDamage.push(entry)
    }
  }
  if (!hasPersistent && /persistent/i.test(rawEnDesc) && /@Damage\[[^\]]*persistent/i.test(rawEnDesc)) hasPersistent = true

  let heightenType = 'none'
  let heightenStep = null
  let heightenLevels = []
  let scaling = undefined
  const scObj = {}
  if (baseDamage.length) scObj.baseDamage = baseDamage

  if (s.heightening?.type === 'interval') {
    heightenType = 'interval'
    heightenStep = Number(s.heightening.interval) || 1
    scObj.interval = heightenStep
    const intDmg = {}
    for (const [k, v] of Object.entries(s.heightening.damage || {})) {
      if (v && String(v).trim()) intDmg[k] = String(v).trim()
    }
    if (Object.keys(intDmg).length) scObj.intervalDamage = intDmg
    if (Number(s.heightening.area) > 0) scObj.intervalArea = Number(s.heightening.area)
  } else if (s.heightening?.type === 'fixed' && s.heightening.levels) {
    heightenType = 'fixed'
    heightenLevels = Object.keys(s.heightening.levels).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    const fixedMap = {}
    for (const lvl of heightenLevels) {
      const ld = s.heightening.levels[String(lvl)] || {}
      const fEntry = {}
      if (ld.damage && typeof ld.damage === 'object') {
        const arr = []
        for (const [dk, dv] of Object.entries(ld.damage)) {
          if (!dv || typeof dv !== 'object' || !dv.formula) continue
          const e = { key: dk, formula: String(dv.formula).trim(), type: String(dv.type || 'untyped') }
          if (dv.category) e.category = dv.category
          if (dv.kinds && Array.isArray(dv.kinds) && dv.kinds.includes('healing')) e.healing = true
          arr.push(e)
        }
        if (arr.length) fEntry.damage = arr
      }
      if (ld.area?.value != null) fEntry.areaVal = Number(ld.area.value)
      if (ld.area?.type) fEntry.areaType = ld.area.type
      if (ld.range?.value) fEntry.range = String(ld.range.value).trim()
      if (ld.target?.value) fEntry.target = String(ld.target.value).trim()
      if (Object.keys(fEntry).length) fixedMap[lvl] = fEntry
    }
    if (Object.keys(fixedMap).length) scObj.fixed = fixedMap
  } else if (/Heightened\s*\(\+(\d+)\)/i.test(rawEnDesc)) {
    heightenType = 'interval'
    heightenStep = Number(/Heightened\s*\(\+(\d+)\)/i.exec(rawEnDesc)[1]) || 1
  } else if (/Heightened\s*\(\d+(?:st|nd|rd|th)\)/i.test(rawEnDesc)) {
    heightenType = 'fixed'
    const lvls = new Set()
    for (const m of rawEnDesc.matchAll(/Heightened\s*\((\d+)(?:st|nd|rd|th)\)/gi)) lvls.add(Number(m[1]))
    heightenLevels = [...lvls].sort((a, b) => a - b)
  }
  if (Object.keys(scObj).length) scaling = scObj

  const deities = new Set([
    ...(deitySpellMap.get(j._id) || []),
    ...(deitySpellMap.get(j.name) || []),
  ])

  const pub = String(s.publication?.title || '').trim()
  if (pub) spellPubs.add(pub)

  const conditions = extractConditions(rawEnDesc)
  const enDesc = resolveUuids(rawEnDesc, 'en', `spell:${j.name}`)
  const ruDesc = resolveUuids(ruDescRaw || rawEnDesc, 'ru', `spell:${j.name}`)
  const img = resolveAndCopyIcon(j.img, 'spell')

  const id = j._id
  spellsIndex.push({
    id,
    slug: slugify(j.name),
    en: j.name,
    ru: ruName,
    img,
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
    conditions,
    heightenType,
    heightenStep,
    heightenLevels,
    ...(scaling ? { scaling } : {}),
    hasCost: Boolean(costRaw),
    cost: costRaw,
    costRu,
    hasReq: Boolean(reqRaw),
    req: reqRaw,
    reqRu,
    counteract: Boolean(s.counteraction) || /\bcounteract\b/i.test(rawEnDesc),
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
  spellsDescRu[id] = ruDesc
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
  const rawEnDesc = inlineEmbeds((s.description?.value || '').trim(), 'en')
  const ruDescCandidate = inlineEmbeds((rOv.description || '').trim(), 'ru')
  const ruBaseCandidate = inlineEmbeds((rBase.description || '').trim(), 'ru')
  const ruDescRaw = isRuText(ruDescCandidate) ? ruDescCandidate : isRuText(ruBaseCandidate) ? ruBaseCandidate : ''
  if (!hasCyr(ruName) || (rawEnDesc && !isRuText(ruDescRaw))) {
    missingRuItems.push(j.name)
  }

  const pricePer = Math.max(1, Number(s.price?.per) || 1)
  const priceCp = priceToCp(s.price?.value)
  const priceText = formatPriceText(s.price?.value, pricePer)

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

  const { hasActivation, actActions } = extractActivations(rawEnDesc)
  const isRune = usage.startsWith('etched-onto') || /\brune\b/i.test(j.name)

  const pub = String(s.publication?.title || '').trim()
  if (pub) itemPubs.add(pub)

  const enDesc = resolveUuids(rawEnDesc, 'en', `item:${j.name}`)
  const ruDesc = resolveUuids(ruDescRaw || rawEnDesc, 'ru', `item:${j.name}`)
  const img = resolveAndCopyIcon(j.img, j.type)

  const id = j._id
  itemsIndex.push({
    id,
    slug: slugify(j.name),
    en: j.name,
    ru: ruName,
    img,
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
  itemsDescRu[id] = ruDesc
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
  const enVal = enLang.PF2E?.Item?.Physical?.Usage?.[u] || titleCase(u)
  const ruVal = ruLang.PF2E?.Item?.Physical?.Usage?.[u] || enVal
  usagesDict[u] = { en: enVal, ru: ruVal }
}

const mapPairs = (obj) => Object.fromEntries(Object.entries(obj).map(([k, [en, ru]]) => [k, { en, ru }]))

const meta = {
  version: 'pf2e-v14-2026-11',
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

// Prune any orphan icon files in public/icons/pf2e/ no longer referenced by spells or items
const usedIconSet = new Set([...spellsIndex.map((s) => s.img), ...itemsIndex.map((i) => i.img)].filter(Boolean))
let pruned = 0
function pruneIcons(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      pruneIcons(p)
      if (fs.readdirSync(p).length === 0) fs.rmdirSync(p)
    } else {
      const rel = path.relative(iconsOutDir, p).replace(/\\/g, '/')
      if (!usedIconSet.has(rel)) {
        fs.unlinkSync(p)
        pruned++
      }
    }
  }
}
pruneIcons(iconsOutDir)

console.log('\n=== SUMMARY ===')
console.log(`Spells: ${spellsIndex.length} (missing RU: ${missingRuSpells.length})`)
console.log(`Items:  ${itemsIndex.length} (missing RU: ${missingRuItems.length})`)
console.log(`UUIDs:  strippedEffects=${uuidStats.strippedEffects}, spellLinks=${uuidStats.spellLinks}, itemLinks=${uuidStats.itemLinks}, refs=${uuidStats.refs}, unresolvedBare=${uuidStats.unresolvedBare.length}`)
if (uuidStats.unresolvedBare.length) console.log('Unresolved bare UUIDs:', uuidStats.unresolvedBare.slice(0, 20))
console.log(`Icons:  unique=${usedIconSet.size}, prunedOrphans=${pruned}, fallbacks=${fallbackIconLog.length}`)
if (fallbackIconLog.length) console.log('Fallback icons:', fallbackIconLog.slice(0, 15))
if (missingRuSpells.length) console.log('Missing RU spells:', missingRuSpells.slice(0, 20))
if (missingRuItems.length) console.log('Missing RU items:', missingRuItems.slice(0, 20))
