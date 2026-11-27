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
  const magus = PF2E_CLASS_PRESETS.find((p) => p.id === 'magus')
  assert.deepEqual(magus.slotsForLevel(7), { 3: 2, 4: 2 })
})

console.log('\n4. Static PF2e Dataset Integrity (public/data/pf2e/)')
test('All 2,036 spells and 6,004 items exist with 100% RU + EN names & descriptions and full meta dictionaries', () => {
  const dir = path.join(process.cwd(), 'public/data/pf2e')
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

  const hasCyr = (s) => typeof s === 'string' && /[а-яёА-ЯЁ]/.test(s)
  const badSpells = spells.filter((s) => !hasCyr(s.ru) || (sEn[s.id]?.trim() && !hasCyr(sRu[s.id])))
  assert.equal(badSpells.length, 0, `Spells missing RU: ${badSpells.map((s) => s.en).slice(0, 5)}`)

  const badItems = items.filter((it) => !hasCyr(it.ru) || (iEn[it.id]?.trim() && !hasCyr(iRu[it.id])))
  assert.equal(badItems.length, 0, `Items missing RU: ${badItems.map((it) => it.en).slice(0, 5)}`)

  // Verify every trait on every spell & item is in meta.traits with RU label
  for (const s of spells) for (const t of s.traits) assert.ok(hasCyr(meta.traits[t]?.ru), `Missing RU trait: ${t}`)
  for (const it of items) for (const t of it.traits) assert.ok(hasCyr(meta.traits[t]?.ru), `Missing RU trait: ${t}`)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
