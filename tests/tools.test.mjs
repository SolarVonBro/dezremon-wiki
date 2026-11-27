// Automated verification tests for:
// 1. Ability Score Calculator (dice parser, point buy, standard array, rolls, optional Sanity/Honor, bonuses)
// 2. PF2e Remaster Bulk, Container, Coins, Encumbrance, and Invested engine
// 3. PF2e Remaster Spellcasting proficiency, DC/Attack, auto-rank, and class slot presets
// 4. Compiled static PF2e dataset integrity (100% EN+RU coverage, traits, metadata)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      if (!path.extname(specifier) && context.parentURL) {
        const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier + '.ts')
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})

const { FormulaError, parseFormula, rollFormula } = await import('../src/data/statDice.ts')
const {
  active, arrayPool, baseScores, bonusParts, emptyData, finalScores, mod, pbBudget, pbSpent,
  pointBuyCost, restoreAttempt, rollMissing, rollSet, scoreIssue, scoresLine, swap, toggleOptional,
} = await import('../src/data/statCalc.ts')
const { computeCharacterBulk, formatLight, formatPriceCp } = await import('../src/data/pf2eBulk.ts')
const { autoRank, computeSpellStats, PF2E_CLASS_PRESETS, proficiencyBonus } = await import('../src/data/pf2eSpellcasting.ts')
const { compilePf2eFormula, computeHeightenedSpell, evalPf2eMath, executePf2eRoll } = await import('../src/data/pf2eRoll.ts')

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.error('  ✗', name, '\n     ', e?.message ?? e)
  }
}

console.log('1. Ability Score Calculator (dice & stats)')
test('parseFormula handles 4d6kh3, Russian 4к6, reroll, explode, +/-', () => {
  const f1 = parseFormula('4d6kh3')
  assert.equal(f1.min, 3)
  assert.equal(f1.max, 18)
  const f2 = parseFormula('4к6dl1')
  assert.equal(f2.min, 3)
  assert.equal(f2.max, 18)
  const f3 = parseFormula('2d6+6')
  assert.equal(f3.min, 8)
  assert.equal(f3.max, 18)
  const f4 = parseFormula('4d6r1kh3')
  assert.equal(f4.min, 6)
  assert.equal(f4.max, 18)
  const f5 = parseFormula('1d6!')
  assert.equal(f5.max, Infinity)
  assert.throws(() => parseFormula('4d6r<6'), FormulaError)
  assert.throws(() => parseFormula(''), FormulaError)
})

test('rollFormula deterministic keep-highest and reroll', () => {
  const seq = [2, 6, 4, 5]
  let idx = 0
  const rng = () => seq[idx++]
  const r = rollFormula(parseFormula('4d6kh3'), rng)
  assert.equal(r.total, 15) // drops 2, keeps 6+4+5
  assert.equal(r.parts[0].dice.filter((d) => d.dropped).length, 1)
  assert.equal(r.parts[0].dice[0].dropped, true)
})

test('point buy standard, extended, and optional Sanity/Honor (+3 pts, +11 array, Honor bonus rule)', () => {
  let d = emptyData()
  assert.equal(pbBudget(d), 27)
  assert.equal(pbSpent(d), 0)
  d.pb = { ...d.pb, str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
  assert.equal(pbSpent(d), 27)
  assert.equal(pointBuyCost([15, 14, 13, 12, 10, 8]), 27)
  assert.equal(pointBuyCost([16, 8, 8, 8, 8, 8], false), null)
  assert.equal(pointBuyCost([16, 8, 8, 8, 8, 8], true), 12)

  d = toggleOptional(d, 'san', true)
  d = toggleOptional(d, 'hon', true)
  assert.equal(active(d).length, 8)
  assert.equal(pbBudget(d), 33)
  assert.equal(arrayPool(d).length, 8)
  assert.equal(arrayPool(d)[6].value, 11)
  assert.equal(arrayPool(d)[7].value, 11)

  // Standard bonuses cannot raise Honor, only custom can
  d.bonuses = [
    { id: 'b1', source: 'Раса', kind: 'p21', picks: ['str', 'hon'], custom: {} },
    { id: 'b2', source: 'Мастер', kind: 'custom', picks: [], custom: { hon: 13 } },
  ]
  const bp = bonusParts(d)
  assert.equal(bp.str[0].value, 2)
  assert.equal(bp.hon.length, 1) // only custom
  assert.equal(bp.hon[0].value, 13)
  const fin = finalScores(d)
  assert.equal(fin.str, 17)
  assert.equal(fin.hon, 21)
  assert.ok(scoreIssue('hon', 21)?.includes('Честь'))
  assert.equal(mod(17), 3)
  assert.equal(scoresLine(d, 'values'), '17 14 13 12 10 8 8 21')
})

test('array swap, rollSet with extra drop-lowest, rollMissing & restoreAttempt', () => {
  let d = emptyData()
  d.method = 'array'
  const swapped = swap(d.arrayAssign, 'str', 'a5') // swap 15 (str) and 8 (cha)
  assert.equal(swapped.str, 'a5')
  assert.equal(swapped.cha, 'a0')

  d.method = 'roll'
  d.count = 7
  const fixedRng = () => 4 // every die = 4 => 4d6kh3 = 12
  d = rollSet(d, fixedRng)
  assert.equal(d.rolls.length, 7)
  assert.equal(d.rolls.filter((r) => r.dropped).length, 1)
  assert.equal(baseScores(d).str, 12)

  d = toggleOptional(d, 'san', true)
  assert.equal(d.rollAssign.san, null)
  d = rollMissing(d, fixedRng)
  assert.ok(d.rollAssign.san)

  const prev = d.rolls.length
  d = rollSet(d, () => 5) // 15s, pushes previous to history
  assert.equal(d.history.length, 1)
  assert.equal(baseScores(d).str, 15)
  d = restoreAttempt(d, 0)
  assert.equal(d.rolls.length, prev)
  assert.equal(baseScores(d).str, 12)
})

console.log('\n2. PF2e Remaster Bulk, Containers & Encumbrance')
const mockCatalog = new Map([
  ['sword', { id: 'sword', type: 'weapon', bulk: 1, bulkHeld: 1, bulkPer: 1, priceCp: 100, pricePer: 1, invested: false }],
  ['potion', { id: 'potion', type: 'consumable', bulk: 0.1, bulkHeld: 0.1, bulkPer: 1, priceCp: 400, pricePer: 1, invested: false }],
  ['arrows', { id: 'arrows', type: 'ammo', bulk: 0.1, bulkHeld: 0.1, bulkPer: 10, priceCp: 10, pricePer: 10, invested: false }],
  ['ring', { id: 'ring', type: 'equipment', bulk: 0, bulkHeld: 0, bulkPer: 1, priceCp: 5000, pricePer: 1, invested: true }],
  ['plate', { id: 'plate', type: 'armor', bulk: 4, bulkHeld: 5, bulkPer: 1, priceCp: 3000, pricePer: 1, invested: false }],
])

const baseChar = (overrides = {}) => ({
  id: 'c1', name: 'Test', description: '', portrait: null, level: 5, strMod: 2, bulkBonus: 0, maxInvested: 10,
  coins: { pp: 0, gp: 0, sp: 0, cp: 0, containerId: null, dropped: false },
  containers: [], inventory: [], spellLists: [], customGroups: [], createdAt: 0, updatedAt: 0,
  ...overrides,
})

test('Light bulk flooring (9L = 0B, 10L = 1B) & ammo per-10 stacking & worn vs held bulk', () => {
  const c9 = baseChar({
    inventory: [{ id: 'i1', itemId: 'potion', name: '', quantity: 9, carryType: 'worn', containerId: null, group: '', invested: false, notes: '', order: 0 }],
  })
  let s = computeCharacterBulk(c9, mockCatalog)
  assert.equal(s.totalLight, 9)
  assert.equal(s.effectiveBulk, 0)
  assert.equal(formatLight(s.totalLight, 'ru'), '9 Л')

  const c10 = baseChar({
    inventory: [
      { id: 'i1', itemId: 'potion', name: '', quantity: 9, carryType: 'worn', containerId: null, group: '', invested: false, notes: '', order: 0 },
      { id: 'i2', itemId: 'arrows', name: '', quantity: 11, carryType: 'worn', containerId: null, group: '', invested: false, notes: '', order: 1 }, // 2L!
      { id: 'i3', itemId: 'plate', name: '', quantity: 1, carryType: 'worn', containerId: null, group: '', invested: false, notes: '', order: 2 }, // 4B worn
    ],
  })
  s = computeCharacterBulk(c10, mockCatalog)
  assert.equal(s.totalLight, 51) // 9L + 2L + 40L
  assert.equal(s.effectiveBulk, 5)
  assert.equal(s.encumberedAt, 7) // 5 + STR 2
  assert.equal(s.maxBulk, 12) // 10 + STR 2
  assert.equal(s.status, 'ok')

  // Same plate held instead of worn => 5B instead of 4B!
  c10.inventory[2].carryType = 'held'
  s = computeCharacterBulk(c10, mockCatalog)
  assert.equal(s.totalLight, 61)
  assert.equal(s.effectiveBulk, 6)
})

test('Backpack ignores 2B only when worn, max 1 worn backpack, Spacious Pouch ignores 25B even held, extradim nesting warns', () => {
  const c = baseChar({
    containers: [
      { id: 'bp1', itemId: null, name: 'Backpack', carryType: 'worn', parentContainerId: null, bulk: 0, bulkHeld: 0.1, capacity: 4, ignored: 2, extradimensional: false, order: 0 },
      { id: 'sp1', itemId: null, name: 'Spacious Pouch I', carryType: 'held', parentContainerId: null, bulk: 1, bulkHeld: 1, capacity: 25, ignored: 25, extradimensional: true, order: 1 },
      { id: 'camp', itemId: null, name: 'Camp Chest', carryType: 'dropped', parentContainerId: null, bulk: 2, bulkHeld: 2, capacity: 8, ignored: 0, extradimensional: false, order: 2 },
    ],
    inventory: [
      { id: 's1', itemId: 'sword', name: '', quantity: 3, carryType: 'stowed', containerId: 'bp1', group: '', invested: false, notes: '', order: 0 }, // 3B in bp1 -> 2B ignored -> +1B
      { id: 's2', itemId: 'sword', name: '', quantity: 20, carryType: 'stowed', containerId: 'sp1', group: '', invested: false, notes: '', order: 1 }, // 20B in sp1 -> 20B ignored -> +1B (own)
      { id: 's3', itemId: 'sword', name: '', quantity: 8, carryType: 'stowed', containerId: 'camp', group: '', invested: false, notes: '', order: 2 }, // dropped -> 0B!
    ],
  })
  let s = computeCharacterBulk(c, mockCatalog)
  assert.equal(s.byContainer.bp1.contributedLight, 10) // 0 own + (30 - 20)
  assert.equal(s.byContainer.sp1.contributedLight, 10) // 10 own + (200 - 200)
  assert.equal(s.byContainer.camp.contributedLight, 0)
  assert.equal(s.effectiveBulk, 2)
  assert.equal(s.warnings.length, 0)

  // If backpack is held instead of worn, it does NOT ignore 2B and adds its 0.1 held bulk!
  c.containers[0].carryType = 'held'
  s = computeCharacterBulk(c, mockCatalog)
  assert.equal(s.byContainer.bp1.contributedLight, 31) // 1 own + 30 contents

  // Extradimensional inside extradimensional warns!
  c.containers.push({ id: 'sp2', itemId: null, name: 'Spacious Pouch II', carryType: 'stowed', parentContainerId: 'sp1', bulk: 1, bulkHeld: 1, capacity: 50, ignored: 50, extradimensional: true, order: 3 })
  s = computeCharacterBulk(c, mockCatalog)
  assert.equal(s.byContainer.sp2.extraDimNestWarning, true)
  assert.ok(s.warnings.some((w) => w.includes('экстрапространственный')))
})

test('Coins bulk (1000 coins = 1B floored) and wealth calculation', () => {
  const c = baseChar({ coins: { pp: 10, gp: 990, sp: 0, cp: 0, containerId: null, dropped: false } })
  const s = computeCharacterBulk(c, mockCatalog)
  assert.equal(s.totalCoinsCount, 1000)
  assert.equal(s.coinsLight, 10)
  assert.equal(s.effectiveBulk, 1)
  assert.equal(formatPriceCp(s.coinsValueCp, 'ru'), '1\u00A0090 зм')
})

console.log('\n3. PF2e Remaster Spellcasting')
test('Spell attack, DC, proficiency (Untrained = 0 no level!), auto-heighten, and class slot presets', () => {
  assert.equal(proficiencyBonus(5, 0), 0)
  assert.equal(proficiencyBonus(5, 1), 7)
  assert.equal(proficiencyBonus(7, 2), 11)
  assert.equal(proficiencyBonus(19, 4), 27)
  assert.equal(autoRank(1), 1)
  assert.equal(autoRank(2), 1)
  assert.equal(autoRank(3), 2)
  assert.equal(autoRank(19), 10)

  const st = computeSpellStats(7, {
    id: 'e1', name: 'Wiz', castingType: 'prepared', tradition: 'arcane', keyAttr: 'int', keyMod: 4,
    proficiency: 2, bonusAttack: 1, bonusDc: 0, slotsMax: {}, slotsUsed: {}, spells: [],
  })
  assert.equal(st.attack, 16) // 7+4 + 4 + 1
  assert.equal(st.dc, 25) // 10 + 7+4 + 4

  const wiz = PF2E_CLASS_PRESETS.find((p) => p.id === 'wizard')
  assert.deepEqual(wiz.slotsForLevel(5), { 1: 4, 2: 4, 3: 3 })
  assert.deepEqual(wiz.slotsForLevel(20), { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 10: 1 })
  assert.equal(wiz.proficiencyForLevel(19), 4)

  // Impossible Magic (2026): Magus & Summoner keep ALL lower-rank slots (1-9) and scale Expert 9 / Master 17
  const magus = PF2E_CLASS_PRESETS.find((p) => p.id === 'magus')
  assert.deepEqual(magus.slotsForLevel(1), { 1: 1 })
  assert.deepEqual(magus.slotsForLevel(7), { 1: 2, 2: 2, 3: 2, 4: 1 })
  assert.deepEqual(magus.slotsForLevel(20), { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2 })
  assert.equal(magus.proficiencyForLevel(8), 1)
  assert.equal(magus.proficiencyForLevel(9), 2)
  assert.equal(magus.proficiencyForLevel(17), 3)
  assert.equal(magus.proficiencyForLevel(20), 3)

  const summoner = PF2E_CLASS_PRESETS.find((p) => p.id === 'summoner')
  assert.deepEqual(summoner.slotsForLevel(8), { 1: 2, 2: 2, 3: 2, 4: 2 })
  assert.equal(summoner.proficiencyForLevel(17), 3)

  // Necromancer (Impossible Magic 2026) & Psychic (Dark Archive Remastered 2026)
  const necro = PF2E_CLASS_PRESETS.find((p) => p.id === 'necromancer')
  assert.deepEqual(necro.slotsForLevel(19), { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 1 })
  assert.equal(necro.proficiencyForLevel(19), 4)
  const psychic = PF2E_CLASS_PRESETS.find((p) => p.id === 'psychic')
  assert.equal(psychic.slotsForLevel(19)[10], 1)
  assert.equal(psychic.slotsForLevel(20)[10], 2)

  // Animist dual slots (War of Immortals)
  const animPrep = PF2E_CLASS_PRESETS.find((p) => p.id === 'animist-prep')
  const animApp = PF2E_CLASS_PRESETS.find((p) => p.id === 'animist-apparition')
  assert.equal(animPrep.slotsForLevel(19)[10], undefined)
  assert.deepEqual(animApp.slotsForLevel(10), { 1: 2, 2: 2, 3: 2, 4: 1, 5: 1 })
  assert.deepEqual(animApp.slotsForLevel(19), { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1, 10: 1 })

  // Cleric Warpriest, Divine Font & Archetype Breadth
  const warpriest = PF2E_CLASS_PRESETS.find((p) => p.id === 'cleric-warpriest')
  assert.equal(warpriest.proficiencyForLevel(10), 1)
  assert.equal(warpriest.proficiencyForLevel(11), 2)
  assert.equal(warpriest.proficiencyForLevel(19), 3)
  const font = PF2E_CLASS_PRESETS.find((p) => p.id === 'cleric-font')
  assert.deepEqual(font.slotsForLevel(1), { 1: 4 })
  assert.deepEqual(font.slotsForLevel(5), { 3: 5 })
  assert.deepEqual(font.slotsForLevel(15), { 8: 6 })
  const archB = PF2E_CLASS_PRESETS.find((p) => p.id === 'archetype-prep-breadth')
  assert.deepEqual(archB.slotsForLevel(12), { 1: 2, 2: 2, 3: 1, 4: 1 })
  assert.equal(archB.proficiencyForLevel(12), 2)
  assert.equal(archB.proficiencyForLevel(18), 3)
})

console.log('\n4. Static PF2e Dataset Integrity (public/data/pf2e/ & public/icons/pf2e/)')
test('All spells & items exist with 100% RU+EN, Feybound+Impossible Magic, clean UUID cross-links, and Foundry icons', () => {
  const dir = path.join(process.cwd(), 'public/data/pf2e')
  const iconsDir = path.join(process.cwd(), 'public/icons/pf2e')
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
  const spells = JSON.parse(fs.readFileSync(path.join(dir, 'spells-index.json'), 'utf8'))
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'items-index.json'), 'utf8'))
  const sRu = JSON.parse(fs.readFileSync(path.join(dir, 'spells-desc-ru.json'), 'utf8'))
  const sEn = JSON.parse(fs.readFileSync(path.join(dir, 'spells-desc-en.json'), 'utf8'))
  const iRu = JSON.parse(fs.readFileSync(path.join(dir, 'items-desc-ru.json'), 'utf8'))
  const iEn = JSON.parse(fs.readFileSync(path.join(dir, 'items-desc-en.json'), 'utf8'))

  assert.equal(spells.length, meta.spellCount)
  assert.equal(items.length, meta.itemCount)
  assert.ok(spells.length >= 2000, 'Expected >= 2000 spells')
  assert.ok(items.length >= 6000, 'Expected >= 6000 items')

  // Verify Nov 2026 Pathfinder Feybound & Impossible Magic content is included
  assert.ok(spells.filter((s) => s.pub === 'Pathfinder Feybound').length >= 18, 'Expected >= 18 Feybound spells')
  assert.ok(items.filter((i) => i.pub === 'Pathfinder Feybound').length >= 45, 'Expected >= 45 Feybound items')
  assert.ok(spells.filter((s) => s.pub === 'Pathfinder Impossible Magic').length >= 300, 'Expected >= 300 Impossible Magic spells')
  assert.ok(items.filter((i) => i.pub === 'Pathfinder Impossible Magic').length >= 300, 'Expected >= 300 Impossible Magic items')

  const hasCyr = (s) => typeof s === 'string' && /[а-яёА-ЯЁ]/.test(s)
  const badSpells = spells.filter((s) => !hasCyr(s.ru) || (sEn[s.id]?.trim() && !hasCyr(sRu[s.id])))
  assert.equal(badSpells.length, 0, `Spells missing RU: ${badSpells.map((s) => s.en).slice(0, 5)}`)

  const badItems = items.filter((it) => !hasCyr(it.ru) || (iEn[it.id]?.trim() && !hasCyr(iRu[it.id])))
  assert.equal(badItems.length, 0, `Items missing RU: ${badItems.map((it) => it.en).slice(0, 5)}`)

  // Verify every trait on every spell & item is in meta.traits with RU label
  for (const s of spells) for (const t of s.traits) assert.ok(hasCyr(meta.traits[t]?.ru), `Missing RU trait: ${t}`)
  for (const it of items) for (const t of it.traits) assert.ok(hasCyr(meta.traits[t]?.ru), `Missing RU trait: ${t}`)

  // Verify ZERO raw @UUID[...] remain and all @SpellLink/@ItemLink point to valid IDs
  const spellIdSet = new Set(spells.map((s) => s.id))
  const itemIdSet = new Set(items.map((i) => i.id))
  let spellLinksCount = 0
  let itemLinksCount = 0
  for (const [label, dict] of [['sEn', sEn], ['sRu', sRu], ['iEn', iEn], ['iRu', iRu]]) {
    for (const [id, text] of Object.entries(dict)) {
      assert.ok(!/@UUID\[/i.test(text), `Raw @UUID remained in ${label}:${id}`)
      assert.ok(!/@Embed\[/i.test(text), `Raw @Embed remained in ${label}:${id}`)
      for (const m of text.matchAll(/@SpellLink\[([^\]]+)\]\{[^}]+\}/g)) {
        assert.ok(spellIdSet.has(m[1]), `Broken @SpellLink[${m[1]}] in ${label}:${id}`)
        spellLinksCount++
      }
      for (const m of text.matchAll(/@ItemLink\[([^\]]+)\]\{[^}]+\}/g)) {
        assert.ok(itemIdSet.has(m[1]), `Broken @ItemLink[${m[1]}] in ${label}:${id}`)
        itemLinksCount++
      }
    }
  }
  assert.ok(spellLinksCount > 5000, `Expected > 5000 resolved spell cross-links, got ${spellLinksCount}`)
  assert.ok(itemLinksCount > 500, `Expected > 500 resolved item cross-links, got ${itemLinksCount}`)

  // Explicitly verify Shield (Щит) has no raw Foundry effect IDs
  const shield = spells.find((s) => s.en === 'Shield')
  assert.ok(shield, 'Shield spell must exist')
  assert.ok(!sRu[shield.id].includes('Jemq5UknGdMO7b73'), 'Shield RU must not contain Jemq5UknGdMO7b73')
  assert.ok(!sRu[shield.id].includes('QF6RDlCoTvkVHRo4'), 'Shield RU must not contain QF6RDlCoTvkVHRo4')

  // Verify every spell and item has a valid icon file on disk under public/icons/pf2e/
  const checkedImgs = new Set()
  for (const s of spells) {
    assert.ok(s.img, `Spell missing img: ${s.en}`)
    if (!checkedImgs.has(s.img)) {
      assert.ok(fs.existsSync(path.join(iconsDir, s.img)), `Missing spell icon file: ${s.img}`)
      checkedImgs.add(s.img)
    }
  }
  for (const it of items) {
    assert.ok(it.img, `Item missing img: ${it.en}`)
    if (!checkedImgs.has(it.img)) {
      assert.ok(fs.existsSync(path.join(iconsDir, it.img)), `Missing item icon file: ${it.img}`)
      checkedImgs.add(it.img)
    }
  }
})

console.log('\n5. PF2e Formula Parser, Dice Roller & Expected-Average Indicator')
test('Evaluates complex Foundry PF2e math, multi-component damage, average & deviation verdict', () => {
  // User-reported formula: (@item.rank -2)d6[void]
  const c4 = compilePf2eFormula('(@item.rank -2)d6[void]', { rank: 4, baseRank: 4 })
  assert.ok(c4)
  assert.equal(c4.displayExpr, '2d6')
  assert.deepEqual(c4.components[0].types, ['void'])
  assert.equal(c4.min, 2)
  assert.equal(c4.max, 12)
  assert.equal(c4.avg, 7)

  const c6 = compilePf2eFormula('(@item.rank -2)d6[void]', { rank: 6, baseRank: 4 })
  assert.equal(c6.displayExpr, '4d6')
  assert.equal(c6.avg, 14)

  // Nested floor / ternary / multi-component / scaled flat
  const fw = compilePf2eFormula('(1+(floor((@item.rank -2)/2)))d4[persistent,fire]', { rank: 6, baseRank: 2 })
  assert.equal(fw.displayExpr, '3d4')
  assert.equal(fw.avg, 7.5)

  const multi = compilePf2eFormula('2d8[piercing],2d4[slashing]|options:area-damage')
  assert.equal(multi.components.length, 2)
  assert.equal(multi.min, 4)
  assert.equal(multi.max, 24)
  assert.equal(multi.avg, 14)

  const tern = compilePf2eFormula('(ternary(gte(@item.level,8),3,ternary(gte(@item.level,6),2,1)))d6[persistent,spirit]', { level: 8 })
  assert.equal(tern.displayExpr, '3d6')
  assert.equal(tern.avg, 10.5)

  const flatScaled = compilePf2eFormula('(@item.rank -2)*2[electricity]', { rank: 5, baseRank: 3 })
  assert.equal(flatScaled.hasDice, false)
  assert.equal(flatScaled.avg, 6)

  const heal = compilePf2eFormula('((@item.level)d6+(@item.level)*4)[vitality,healing]', { level: 3 })
  assert.equal(heal.displayExpr, '3d6 + 12')
  assert.equal(heal.avg, 22.5)

  // Roll deviation verdicts (deterministic RNG)
  const rMax = executePf2eRoll(c6, () => 6) // 24 vs avg 14
  assert.equal(rMax.total, 24)
  assert.equal(rMax.diff, 10)
  assert.equal(rMax.verdict, 'great')

  const rAvg = executePf2eRoll(c6, () => 3.5) // rounds to 4 -> 16 vs 14 -> high; test exact 2d6 = 7
  const rExact = executePf2eRoll(c4, (() => { let i = 0; return () => [3, 4][i++] })())
  assert.equal(rExact.total, 7)
  assert.equal(rExact.diff, 0)
  assert.equal(rExact.verdict, 'avg')

  const rMin = executePf2eRoll(c6, () => 1) // 4 vs avg 14
  assert.equal(rMin.total, 4)
  assert.equal(rMin.verdict, 'poor')
  assert.ok(rAvg.total > 0)
  assert.equal(evalPf2eMath('ceil(5/2) + max(2, 4)'), 7)
})

test('100% of all @Damage[...] and [[/r ...]] formulas across all 8,041 spells & items compile cleanly', () => {
  const dir = path.join(process.cwd(), 'public/data/pf2e')
  const spells = JSON.parse(fs.readFileSync(path.join(dir, 'spells-index.json'), 'utf8'))
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'items-index.json'), 'utf8'))
  const spMap = new Map(spells.map((s) => [s.id, s]))
  const itMap = new Map(items.map((i) => [i.id, i]))
  let total = 0
  const failed = []

  for (const [f, isSpell] of [['spells-desc-en.json', true], ['spells-desc-ru.json', true], ['items-desc-en.json', false], ['items-desc-ru.json', false]]) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    for (const [id, txt] of Object.entries(d)) {
      const m = isSpell ? spMap.get(id) : itMap.get(id)
      const ctx = isSpell
        ? { rank: Math.max(1, m?.baseRank || 1), baseRank: Math.max(1, m?.baseRank || 1), level: Math.max(1, m?.baseRank || 1), actorLevel: Math.max(1, (m?.baseRank || 1) * 2 - 1) }
        : { level: m?.level || 1, rank: Math.max(1, Math.ceil((m?.level || 1) / 2)), actorLevel: Math.max(1, m?.level || 1), diceNum: m?.diceNum || 1, dmgType: m?.dmgType || undefined }

      let idx = 0
      while ((idx = txt.indexOf('@Damage[', idx)) !== -1) {
        let i = idx + 8
        let depth = 1
        while (i < txt.length && depth > 0) {
          if (txt[i] === '[') depth++
          else if (txt[i] === ']') depth--
          i++
        }
        const inner = txt.slice(idx + 8, i - 1)
        total++
        if (!compilePf2eFormula(inner, ctx)) failed.push(`${f}:${m?.en}:${inner}`)
        idx = i
      }

      let ridx = 0
      while ((ridx = txt.indexOf('[[/', ridx)) !== -1) {
        const mc = /^\[\[\/(r|roll|gmr|br|gr)\s+/i.exec(txt.slice(ridx))
        if (!mc) { ridx += 3; continue }
        const close = txt.indexOf(']]', ridx + mc[0].length)
        if (close === -1) break
        const inner = txt.slice(ridx + mc[0].length, close)
        total++
        if (!compilePf2eFormula(inner, ctx)) failed.push(`${f}:${m?.en}:[[/r ${inner}]]`)
        ridx = close + 2
      }
    }
  }
  assert.ok(total > 5000, `Expected > 5000 formulas, got ${total}`)
  assert.equal(failed.length, 0, `Uncompiled formulas (${failed.length}): ${failed.slice(0, 10).join(' | ')}`)
})

test('Heightened spell calculator scales interval damage, fixed tiers, area, and prose overrides accurately', () => {
  const spells = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/pf2e/spells-index.json'), 'utf8'))

  const fb = spells.find((s) => s.en === 'Fireball')
  assert.ok(fb?.scaling?.baseDamage?.length)
  const fb3 = computeHeightenedSpell(fb, 3)
  assert.equal(fb3.compiled.displayExpr, '6d6')
  assert.equal(fb3.compiled.avg, 21)
  const fb5 = computeHeightenedSpell(fb, 5)
  assert.equal(fb5.compiled.displayExpr, '10d6')
  assert.equal(fb5.compiled.avg, 35)
  assert.equal(fb5.baseOverrides['6d6'], '10d6')

  const ea = spells.find((s) => s.en === 'Electric Arc')
  const ea4 = computeHeightenedSpell(ea, 4)
  assert.equal(ea4.compiled.displayExpr, '5d4')
  assert.equal(ea4.compiled.avg, 12.5)
  assert.equal(ea4.baseOverrides['2d4'], '5d4')

  const dl = spells.find((s) => s.en === 'Darklight')
  const dl10 = computeHeightenedSpell(dl, 10)
  assert.equal(dl10.compiled.displayExpr, '3d6 + 3d6')
  assert.equal(dl10.compiled.avg, 21)

  const ew = spells.find((s) => s.en === 'Establish Ward')
  const ewBase = computeHeightenedSpell(ew, ew.baseRank)
  const ewPlus2 = computeHeightenedSpell(ew, ew.baseRank + 2)
  assert.equal(ewPlus2.areaVal, (ewBase.areaVal ?? 0) + 5)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
