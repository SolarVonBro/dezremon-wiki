// Security rules tests against the Firestore emulator.
// Run: npm run emulators (in another terminal), then: node tests/rules.test.mjs
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc, setDoc, getDoc, updateDoc, writeBatch, collection, query, where, getDocs, collectionGroup, deleteDoc,
} from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'demo-dezremon',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
})
await env.clearFirestore()

let passed = 0, failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed++; console.log('  ✗', name, '\n     ', e?.message?.split('\n')[0]) }
}

const owner = env.authenticatedContext('owner', { email: 'o@x.ru' }).firestore()
const player = env.authenticatedContext('player', { email: 'p@x.ru' }).firestore()
const player2 = env.authenticatedContext('player2').firestore()
const stranger = env.authenticatedContext('stranger').firestore()
const guest = env.unauthenticatedContext().firestore()
const now = Date.now()
const V = (visibility, extra = {}) => ({ visibility, allowedUids: [], createdBy: 'owner', createdAt: now, updatedAt: now, updatedBy: 'owner', ...extra })
const settings = { disabledTypes: [], customTypes: [], playerCreateTypes: ['journal', 'note'], playersCanPost: true, defaultVisibility: 'members', dashboardPins: [], mainCalendarId: null, accent: null }

console.log('worlds & membership')
await t('owner creates world + owner member in one batch', async () => {
  for (const [id, isPublic] of [['w1', false], ['w2', true]]) {
    const b = writeBatch(owner)
    b.set(doc(owner, 'worlds', id), { name: id, description: '', ownerId: 'owner', isPublic, imageId: null, headerImageId: null, aclVersion: 0, settings, createdAt: now, updatedAt: now })
    b.set(doc(owner, 'worlds', id, 'members', 'owner'), { uid: 'owner', role: 'owner', displayName: 'O', email: '', photoURL: null, joinedAt: now })
    await assertSucceeds(b.commit())
  }
})
await t('stranger cannot claim ownership of a foreign world', () => assertFails(setDoc(doc(stranger, 'worlds', 'w1', 'members', 'stranger'), { uid: 'stranger', role: 'owner' })))
await t('stranger cannot read a closed world', () => assertFails(getDoc(doc(stranger, 'worlds', 'w1'))))
await t('guest can read a public world', () => assertSucceeds(getDoc(doc(guest, 'worlds', 'w2'))))
await t('master creates invites', async () => {
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'w1', 'invites', 'inv1'), { code: 'inv1', role: 'player', createdBy: 'owner', createdAt: now, expiresAt: now + 86400000, note: '', worldName: 'w1' }))
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'w1', 'invites', 'old'), { code: 'old', role: 'player', createdBy: 'owner', createdAt: now, expiresAt: now - 1000, note: '' }))
})
await t('player cannot join without invite', () => assertFails(setDoc(doc(player, 'worlds', 'w1', 'members', 'player'), { uid: 'player', role: 'player', inviteCode: 'nope' })))
await t('player cannot use a player invite to become master', () => assertFails(setDoc(doc(player, 'worlds', 'w1', 'members', 'player'), { uid: 'player', role: 'master', inviteCode: 'inv1' })))
await t('player cannot use an expired invite', () => assertFails(setDoc(doc(player, 'worlds', 'w1', 'members', 'player'), { uid: 'player', role: 'player', inviteCode: 'old' })))
await t('player can read the invite and join', async () => {
  await assertSucceeds(getDoc(doc(player, 'worlds', 'w1', 'invites', 'inv1')))
  await assertSucceeds(setDoc(doc(player, 'worlds', 'w1', 'members', 'player'), { uid: 'player', role: 'player', inviteCode: 'inv1', displayName: 'P', email: '', photoURL: null, joinedAt: now }))
  await assertSucceeds(setDoc(doc(player2, 'worlds', 'w1', 'members', 'player2'), { uid: 'player2', role: 'player', inviteCode: 'inv1', displayName: 'P2', email: '', photoURL: null, joinedAt: now }))
})
await t('player cannot promote himself', () => assertFails(updateDoc(doc(player, 'worlds', 'w1', 'members', 'player'), { role: 'master' })))
await t('player cannot list invites', () => assertFails(getDocs(collection(player, 'worlds', 'w1', 'invites'))))
await t('"my worlds" collection-group query works', async () => {
  const s = await assertSucceeds(getDocs(query(collectionGroup(player, 'members'), where('uid', '==', 'player'))))
  if (s.size !== 1) throw new Error('expected 1, got ' + s.size)
})

console.log('entities & visibility')
const base = { type: 'character', kind: '', parentId: null, tagIds: [], fields: {}, attributes: [], editorUids: [], hasSecrets: false, deleted: false }
await t('master writes entities of every visibility (+ bodies, secrets)', async () => {
  const b = writeBatch(owner)
  b.set(doc(owner, 'worlds', 'w1', 'entities', 'pub'), { ...base, name: 'Pub', ...V('public') })
  b.set(doc(owner, 'worlds', 'w1', 'entities', 'mem'), { ...base, name: 'Mem', ...V('members') })
  b.set(doc(owner, 'worlds', 'w1', 'entities', 'gm'), { ...base, name: 'Gm', hasSecrets: true, ...V('master') })
  b.set(doc(owner, 'worlds', 'w1', 'entities', 'cus'), { ...base, name: 'Cus', ...V('custom', { allowedUids: ['player'] }) })
  b.set(doc(owner, 'worlds', 'w1', 'bodies', 'mem'), { html: '<p>x</p>', rev: 1, ...V('members') })
  b.set(doc(owner, 'worlds', 'w1', 'bodies', 'gm'), { html: '<p>gm</p>', rev: 1, ...V('master') })
  b.set(doc(owner, 'worlds', 'w1', 'secrets', 'gm'), { html: '<div data-secret>s</div>', attributes: [], gmNotes: '', rev: 1 })
  for (const id of ['p2', 'm2']) b.set(doc(owner, 'worlds', 'w2', 'entities', id), { ...base, name: id, ...V(id === 'p2' ? 'public' : 'members') })
  await assertSucceeds(b.commit())
})
const ents = (db, w = 'w1') => collection(db, 'worlds', w, 'entities')
await t('player: visibility in [public, members] query', async () => {
  const s = await assertSucceeds(getDocs(query(ents(player), where('visibility', 'in', ['public', 'members']), where('updatedAt', '>', 0))))
  if (s.size !== 2) throw new Error('expected 2, got ' + s.size)
})
await t('player: allowedUids query returns the shared entity', async () => {
  const s = await assertSucceeds(getDocs(query(ents(player), where('allowedUids', 'array-contains', 'player'), where('updatedAt', '>', 0))))
  if (s.size !== 1) throw new Error('expected 1, got ' + s.size)
})
await t('player: createdBy query', () => assertSucceeds(getDocs(query(ents(player), where('createdBy', '==', 'player'), where('updatedAt', '>', 0)))))
await t('player: unconstrained query is rejected', () => assertFails(getDocs(query(ents(player), where('updatedAt', '>', 0)))))
await t('player cannot read master-only entity', () => assertFails(getDoc(doc(player, 'worlds', 'w1', 'entities', 'gm'))))
await t('player2 cannot read entity shared only with player', () => assertFails(getDoc(doc(player2, 'worlds', 'w1', 'entities', 'cus'))))
await t('player reads members body, not master body, never secrets', async () => {
  await assertSucceeds(getDoc(doc(player, 'worlds', 'w1', 'bodies', 'mem')))
  await assertFails(getDoc(doc(player, 'worlds', 'w1', 'bodies', 'gm')))
  await assertFails(getDoc(doc(player, 'worlds', 'w1', 'secrets', 'gm')))
})
await t('guest: closed world entities are hidden', () => assertFails(getDocs(query(ents(guest), where('visibility', '==', 'public'), where('updatedAt', '>', 0)))))
await t('guest: public world, public entities only', async () => {
  const s = await assertSucceeds(getDocs(query(ents(guest, 'w2'), where('visibility', '==', 'public'), where('updatedAt', '>', 0))))
  if (s.size !== 1) throw new Error('expected 1, got ' + s.size)
  await assertFails(getDoc(doc(guest, 'worlds', 'w2', 'entities', 'm2')))
})

console.log('player writes')
const pv = (visibility) => ({ visibility, allowedUids: [], createdBy: 'player', createdAt: now, updatedAt: now, updatedBy: 'player' })
await t('player creates an allowed type (journal) + body', async () => {
  const b = writeBatch(player)
  b.set(doc(player, 'worlds', 'w1', 'entities', 'j1'), { ...base, type: 'journal', name: 'Дневник', ...pv('members') })
  b.set(doc(player, 'worlds', 'w1', 'bodies', 'j1'), { html: '<p>день 1</p>', rev: 1, ...pv('members') })
  await assertSucceeds(b.commit())
})
await t('player cannot create a character', () => assertFails(setDoc(doc(player, 'worlds', 'w1', 'entities', 'c1'), { ...base, type: 'character', name: 'X', ...pv('members') })))
await t('player cannot publish to guests', () => assertFails(setDoc(doc(player, 'worlds', 'w1', 'entities', 'j2'), { ...base, type: 'journal', name: 'X', ...pv('public') })))
await t('player edits own entity', () => assertSucceeds(updateDoc(doc(player, 'worlds', 'w1', 'entities', 'j1'), { name: 'Дневник 2', updatedAt: now + 1 })))
await t('player cannot grant editors', () => assertFails(updateDoc(doc(player, 'worlds', 'w1', 'entities', 'j1'), { editorUids: ['player2'] })))
await t('player cannot edit master entity', () => assertFails(updateDoc(doc(player, 'worlds', 'w1', 'entities', 'mem'), { name: 'hack' })))
await t('after master grants editing, player can edit it and its body', async () => {
  await assertSucceeds(updateDoc(doc(owner, 'worlds', 'w1', 'entities', 'mem'), { editorUids: ['player'] }))
  await assertSucceeds(updateDoc(doc(player, 'worlds', 'w1', 'entities', 'mem'), { name: 'Mem!', updatedAt: now + 2 }))
  await assertSucceeds(setDoc(doc(player, 'worlds', 'w1', 'bodies', 'mem'), { html: '<p>y</p>', rev: 2, ...V('members') }))
})
await t('player cannot edit an entity with master secrets', () => assertFails(updateDoc(doc(player, 'worlds', 'w1', 'entities', 'gm'), { name: 'x' })))
await t('player adds own post when posts are open', () => assertSucceeds(setDoc(doc(player, 'worlds', 'w1', 'posts', 'post1'), { entityId: 'pub', title: 'Заметка', html: '', order: 1, ...pv('members') })))
await t('player cannot edit master post', async () => {
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'w1', 'posts', 'post2'), { entityId: 'pub', title: 'M', html: '', order: 2, ...V('members') }))
  await assertFails(updateDoc(doc(player, 'worlds', 'w1', 'posts', 'post2'), { title: 'hack' }))
})
await t('player cannot add inventory to a foreign entity', () => assertFails(setDoc(doc(player, 'worlds', 'w1', 'inventory', 'i1'), { ownerId: 'pub', name: 'x', amount: 1, ...pv('members') })))
await t('player adds inventory to an entity he edits', () => assertSucceeds(setDoc(doc(player, 'worlds', 'w1', 'inventory', 'i2'), { ownerId: 'j1', name: 'x', amount: 1, ...pv('members') })))
await t('player relation from own entity', () => assertSucceeds(setDoc(doc(player, 'worlds', 'w1', 'relations', 'r1'), { sourceId: 'j1', targetId: 'pub', label: 'про', ...pv('members') })))
await t('player uploads image (members) but not public', async () => {
  await assertSucceeds(setDoc(doc(player, 'worlds', 'w1', 'images', 'img1'), { name: 'a', ...pv('members') }))
  await assertFails(setDoc(doc(player, 'worlds', 'w1', 'images', 'img2'), { name: 'a', ...pv('public') }))
})
await t('player cannot read secret revisions of others', async () => {
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'w1', 'revisions', 'rv1'), { entityId: 'gm', html: 's', createdBy: 'owner', createdAt: now }))
  await assertFails(getDoc(doc(player, 'worlds', 'w1', 'revisions', 'rv1')))
})
await t('player cannot delete entities', () => assertFails(deleteDoc(doc(player, 'worlds', 'w1', 'entities', 'j1'))))
await t('owner removes a player; player loses access', async () => {
  await assertSucceeds(deleteDoc(doc(owner, 'worlds', 'w1', 'members', 'player2')))
  await assertFails(getDoc(doc(player2, 'worlds', 'w1', 'entities', 'mem')))
})
await t('stranger cannot touch world settings', () => assertFails(updateDoc(doc(stranger, 'worlds', 'w1'), { isPublic: true })))
await t('player cannot change world settings', () => assertFails(updateDoc(doc(player, 'worlds', 'w1'), { isPublic: true })))

console.log('members admin')
await t('master edits a player\'s character link', () => assertSucceeds(updateDoc(doc(owner, 'worlds', 'w1', 'members', 'player'), { characterId: 'pub' })))
await t('player edits own profile fields', () => assertSucceeds(updateDoc(doc(player, 'worlds', 'w1', 'members', 'player'), { displayName: 'Соня', lastSeenAt: now })))
await t('player cannot grant himself extra create rights', () => assertFails(updateDoc(doc(player, 'worlds', 'w1', 'members', 'player'), { createTypes: ['character'] })))
await t('per-member create rights: master grants characters, player creates one', async () => {
  await assertSucceeds(updateDoc(doc(owner, 'worlds', 'w1', 'members', 'player'), { createTypes: ['character'] }))
  await assertSucceeds(setDoc(doc(player, 'worlds', 'w1', 'entities', 'pc1'), { ...base, type: 'character', name: 'Мой герой', ...pv('members') }))
})
await t('banned user cannot rejoin with a valid invite', async () => {
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'w1', 'bans', 'player2'), { uid: 'player2', at: now }))
  await assertFails(setDoc(doc(player2, 'worlds', 'w1', 'members', 'player2'), { uid: 'player2', role: 'player', inviteCode: 'inv1' }))
})
await t('player cannot read the ban list', () => assertFails(getDoc(doc(player, 'worlds', 'w1', 'bans', 'player2'))))
await t('player cannot take ownership', async () => {
  const b = writeBatch(player)
  b.update(doc(player, 'worlds', 'w1'), { ownerId: 'player' })
  b.update(doc(player, 'worlds', 'w1', 'members', 'player'), { role: 'owner' })
  await assertFails(b.commit())
})
await t('owner transfers ownership in one batch', async () => {
  await assertSucceeds(updateDoc(doc(owner, 'worlds', 'w1', 'members', 'player'), { role: 'master' }))
  const b = writeBatch(owner)
  b.update(doc(owner, 'worlds', 'w1'), { ownerId: 'player' })
  b.update(doc(owner, 'worlds', 'w1', 'members', 'player'), { role: 'owner' })
  b.update(doc(owner, 'worlds', 'w1', 'members', 'owner'), { role: 'master' })
  await assertSucceeds(b.commit())
})
await t('former owner (now master) cannot change roles; new owner can', async () => {
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'w1', 'invites', 'inv3'), { code: 'inv3', role: 'player', createdBy: 'owner', createdAt: now, expiresAt: null, note: '' }))
  await assertSucceeds(setDoc(doc(stranger, 'worlds', 'w1', 'members', 'stranger'), { uid: 'stranger', role: 'player', inviteCode: 'inv3', displayName: 'S', email: '', photoURL: null, joinedAt: now }))
  await assertFails(updateDoc(doc(owner, 'worlds', 'w1', 'members', 'stranger'), { role: 'master' }))
  await assertSucceeds(updateDoc(doc(player, 'worlds', 'w1', 'members', 'stranger'), { role: 'master' }))
})
await t('master removes a player, not another master', async () => {
  await assertSucceeds(updateDoc(doc(player, 'worlds', 'w1', 'members', 'stranger'), { role: 'player' }))
  await assertFails(deleteDoc(doc(stranger, 'worlds', 'w1', 'members', 'owner')))
  await assertSucceeds(deleteDoc(doc(owner, 'worlds', 'w1', 'members', 'stranger')))
})
await t('owner deletes the world, then his own membership', async () => {
  await assertFails(deleteDoc(doc(player, 'worlds', 'w1', 'members', 'player')))
  await assertSucceeds(deleteDoc(doc(player, 'worlds', 'w1')))
  await assertSucceeds(deleteDoc(doc(player, 'worlds', 'w1', 'members', 'player')))
})

await env.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
