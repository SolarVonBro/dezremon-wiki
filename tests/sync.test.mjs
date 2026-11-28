// Unit tests for collection delta/full sync cache policy (src/data/syncPolicy.ts).
import assert from 'node:assert/strict'
import {
  SYNC_FULL_EVERY_MS,
  SYNC_OVERLAP_MS,
  SYNC_VERSION,
  deltaSince,
  needsFullSync,
  syncScope,
} from '../src/data/syncPolicy.ts'

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

console.log('syncScope')
test('owner and master/admin share the master scope', () => {
  assert.equal(syncScope({ uid: 'u1', role: 'owner' }), 'master')
  assert.equal(syncScope({ uid: 'u1', role: 'master' }), 'master')
  assert.equal(syncScope({ uid: 'admin', role: 'master' }), 'master')
})
test('players are scoped per uid and distinct from guest/master', () => {
  assert.equal(syncScope({ uid: 'p1', role: 'player' }), 'member:p1')
  assert.equal(syncScope({ uid: 'p2', role: 'player' }), 'member:p2')
  assert.notEqual(syncScope({ uid: 'p1', role: 'player' }), syncScope({ uid: 'p2', role: 'player' }))
  assert.equal(syncScope({ uid: null, role: null }), 'guest')
  assert.equal(syncScope({ uid: 'stranger', role: null }), 'guest')
})

console.log('needsFullSync')
const NOW = 1_800_000_000_000
const freshMasterMeta = {
  v: SYNC_VERSION,
  scope: 'master',
  since: NOW - 60_000,
  aclVersion: 3,
  fullAt: NOW - 3_600_000,
  count: 200,
}

test('steady master delta sync skips full resync when cache is intact', () => {
  assert.equal(needsFullSync(freshMasterMeta, { scope: 'master', aclVersion: 3, cachedCount: 200, nowMs: NOW }), false)
  assert.equal(needsFullSync(freshMasterMeta, { scope: 'master', aclVersion: 3, cachedCount: 205, nowMs: NOW }), false)
})
test('missing or legacy meta forces full sync (auto-heals old per-role caches)', () => {
  assert.equal(needsFullSync(null, { scope: 'master', aclVersion: 3, cachedCount: 10, nowMs: NOW }), true)
  assert.equal(needsFullSync({ since: NOW - 1000, aclVersion: 3, fullAt: NOW - 1000 }, { scope: 'master', aclVersion: 3, cachedCount: 10, nowMs: NOW }), true)
})
test('cross-role switch (guest -> master, player -> master, playerA -> playerB) forces full sync', () => {
  const guestMeta = { v: SYNC_VERSION, scope: 'guest', since: NOW - 5_000, aclVersion: 3, fullAt: NOW - 5_000, count: 9 }
  assert.equal(needsFullSync(guestMeta, { scope: 'master', aclVersion: 3, cachedCount: 9, nowMs: NOW }), true)
  const playerAMeta = { v: SYNC_VERSION, scope: 'member:p1', since: NOW - 5_000, aclVersion: 3, fullAt: NOW - 5_000, count: 50 }
  assert.equal(needsFullSync(playerAMeta, { scope: 'master', aclVersion: 3, cachedCount: 50, nowMs: NOW }), true)
  assert.equal(needsFullSync(playerAMeta, { scope: 'member:p2', aclVersion: 3, cachedCount: 50, nowMs: NOW }), true)
})
test('truncated IndexedDB cache (cachedCount < meta.count) forces full sync', () => {
  assert.equal(needsFullSync(freshMasterMeta, { scope: 'master', aclVersion: 3, cachedCount: 10, nowMs: NOW }), true)
  const emptyMeta = { ...freshMasterMeta, count: 0 }
  assert.equal(needsFullSync(emptyMeta, { scope: 'master', aclVersion: 3, cachedCount: 0, nowMs: NOW }), false)
})
test('aclVersion change, 24h expiry, and backwards clock jump force full sync', () => {
  assert.equal(needsFullSync(freshMasterMeta, { scope: 'master', aclVersion: 4, cachedCount: 200, nowMs: NOW }), true)
  assert.equal(needsFullSync(freshMasterMeta, { scope: 'master', aclVersion: 3, cachedCount: 200, nowMs: freshMasterMeta.fullAt + SYNC_FULL_EVERY_MS + 1 }), true)
  assert.equal(needsFullSync(freshMasterMeta, { scope: 'master', aclVersion: 3, cachedCount: 200, nowMs: freshMasterMeta.fullAt - 1 }), true)
})

console.log('deltaSince')
test('subtracts overlap and clamps to 0 and nowMs (future-clock writer cannot blind delta sync)', () => {
  assert.equal(deltaSince(NOW - 60_000, NOW), NOW - 60_000 - SYNC_OVERLAP_MS)
  assert.equal(deltaSince(1000, NOW), 0)
  assert.equal(deltaSince(undefined, NOW), 0)
  assert.equal(deltaSince(NOW + 2 * 3_600_000, NOW), NOW - SYNC_OVERLAP_MS)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
