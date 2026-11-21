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

console.log('join requests')
const visitor = env.authenticatedContext('visitor', { email: 'v@x.ru' }).firestore()
const req = (u, extra = {}) => ({ uid: u, displayName: u, email: '', photoURL: null, message: 'Пустите', fromPath: '/e/x', status: 'pending', createdAt: now, updatedAt: now, ...extra })
await t('visitor sends a join request to a public world', () => assertSucceeds(setDoc(doc(visitor, 'worlds', 'w2', 'joinRequests', 'visitor'), req('visitor'))))
await t('visitor cannot file a request for someone else', () => assertFails(setDoc(doc(visitor, 'worlds', 'w2', 'joinRequests', 'player'), req('player'))))
await t('visitor cannot self-approve', () => assertFails(updateDoc(doc(visitor, 'worlds', 'w2', 'joinRequests', 'visitor'), { status: 'approved' })))
await t('visitor reads own request (also via collection group)', async () => {
  await assertSucceeds(getDoc(doc(visitor, 'worlds', 'w2', 'joinRequests', 'visitor')))
  await assertSucceeds(getDocs(query(collectionGroup(visitor, 'joinRequests'), where('uid', '==', 'visitor'))))
})
await t('members cannot file requests; other users cannot read them', async () => {
  await assertFails(setDoc(doc(owner, 'worlds', 'w2', 'joinRequests', 'owner'), req('owner')))
  await assertFails(getDoc(doc(stranger, 'worlds', 'w2', 'joinRequests', 'visitor')))
})
await t('master cannot add a user without a request', () => assertFails(setDoc(doc(owner, 'worlds', 'w2', 'members', 'stranger'), { uid: 'stranger', role: 'player', displayName: 'S', email: '', photoURL: null, joinedAt: now })))
await t('owner accepts the request (member + delete request in one batch)', async () => {
  await assertSucceeds(getDocs(collection(owner, 'worlds', 'w2', 'joinRequests')))
  const b = writeBatch(owner)
  b.set(doc(owner, 'worlds', 'w2', 'members', 'visitor'), { uid: 'visitor', role: 'player', displayName: 'visitor', email: '', photoURL: null, joinedAt: now })
  b.delete(doc(owner, 'worlds', 'w2', 'joinRequests', 'visitor'))
  await assertSucceeds(b.commit())
  await assertSucceeds(getDoc(doc(visitor, 'worlds', 'w2', 'entities', 'm2')))
})
await t('banned users cannot request', async () => {
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'w2', 'bans', 'stranger'), { uid: 'stranger', at: now }))
  await assertFails(setDoc(doc(stranger, 'worlds', 'w2', 'joinRequests', 'stranger'), req('stranger')))
})
await t('master rejects; requester sees status and may withdraw', async () => {
  await assertSucceeds(setDoc(doc(player2, 'worlds', 'w2', 'joinRequests', 'player2'), req('player2')))
  await assertSucceeds(updateDoc(doc(owner, 'worlds', 'w2', 'joinRequests', 'player2'), { status: 'rejected', decidedBy: 'owner' }))
  await assertFails(updateDoc(doc(player2, 'worlds', 'w2', 'joinRequests', 'player2'), { status: 'pending' }))
  await assertSucceeds(deleteDoc(doc(player2, 'worlds', 'w2', 'joinRequests', 'player2')))
})

console.log('project storage meter')
await t('owner publishes the world size; any signed-in user reads the totals', async () => {
  await assertSucceeds(setDoc(doc(owner, 'usage', 'w1'), { bytes: 1000, docs: 10, at: now }))
  await assertSucceeds(getDocs(collection(stranger, 'usage')))
})
await t('players, strangers and guests cannot write sizes; no extra fields', async () => {
  await assertFails(setDoc(doc(player, 'usage', 'w1'), { bytes: 1, docs: 1, at: now }))
  await assertFails(setDoc(doc(stranger, 'usage', 'w1'), { bytes: 1, docs: 1, at: now }))
  await assertFails(setDoc(doc(owner, 'usage', 'w1'), { bytes: 1, docs: 1, at: now, name: 'leak' }))
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'usage')))
})
await t('a new world gets its usage doc in the creation batch', async () => {
  const b = writeBatch(stranger)
  b.set(doc(stranger, 'worlds', 'wNew'), { name: 'N', ownerId: 'stranger', isPublic: false, aclVersion: 0, settings: {}, createdAt: now, updatedAt: now })
  b.set(doc(stranger, 'worlds', 'wNew', 'members', 'stranger'), { uid: 'stranger', role: 'owner', displayName: 'S', email: '', photoURL: null, joinedAt: now })
  b.set(doc(stranger, 'usage', 'wNew'), { bytes: 0, docs: 0, at: 0 })
  await assertSucceeds(b.commit())
  await assertFails(setDoc(doc(owner, 'usage', 'wNew'), { bytes: 5, docs: 1, at: now }))
})

// ======================= service administrator =======================
const ADMIN = 'TRLvfuNmFtR9TByopvMl8yIG1jG2'
const admin = env.authenticatedContext(ADMIN, { email: 'admin@x.ru' }).firestore()
const banned = env.authenticatedContext('banned').firestore()

console.log('service admin')
await t('setup: owner creates a closed world wA with a master-only article', async () => {
  const b = writeBatch(owner)
  b.set(doc(owner, 'worlds', 'wA'), { name: 'wA', description: '', ownerId: 'owner', isPublic: false, imageId: null, headerImageId: null, aclVersion: 0, settings, createdAt: now, updatedAt: now })
  b.set(doc(owner, 'worlds', 'wA', 'members', 'owner'), { uid: 'owner', role: 'owner', displayName: 'O', email: '', photoURL: null, joinedAt: now })
  b.set(doc(owner, 'usage', 'wA'), { bytes: 0, docs: 0, at: 0 })
  await assertSucceeds(b.commit())
  await assertSucceeds(setDoc(doc(owner, 'worlds', 'wA', 'entities', 'secret'), V('master', { type: 'note', name: 'S' })))
})
await t('users write their own profile; strangers cannot read or list it', async () => {
  await assertSucceeds(setDoc(doc(owner, 'users', 'owner'), { uid: 'owner', displayName: 'O', email: 'o@x.ru', photoURL: null, lastSeen: now }))
  await assertFails(getDoc(doc(stranger, 'users', 'owner')))
  await assertFails(getDocs(collection(stranger, 'users')))
})
await t('admin lists users and worlds, reads a closed world with its secrets and members', async () => {
  await assertSucceeds(getDocs(collection(admin, 'users')))
  await assertSucceeds(getDocs(collection(admin, 'worlds')))
  await assertSucceeds(getDoc(doc(admin, 'worlds', 'wA')))
  await assertSucceeds(getDocs(collection(admin, 'worlds', 'wA', 'members')))
  await assertSucceeds(getDocs(collection(admin, 'worlds', 'wA', 'entities')))
  await assertSucceeds(getDocs(collectionGroup(admin, 'members')))
})
await t('nobody else lists worlds or all memberships', async () => {
  await assertFails(getDocs(collection(owner, 'worlds')))
  await assertFails(getDocs(collectionGroup(owner, 'members')))
})
await t('admin edits a foreign world', () => assertSucceeds(updateDoc(doc(admin, 'worlds', 'wA'), { description: 'checked by admin' })))
await t('admin writes a usage row', () => assertSucceeds(setDoc(doc(admin, 'usage', 'wA'), { bytes: 1, docs: 1, at: now })))
await t('service config: everyone signed in reads, only admin writes', async () => {
  await assertSucceeds(setDoc(doc(admin, 'service', 'config'), { youtubeApiKey: 'k' }))
  await assertSucceeds(getDoc(doc(stranger, 'service', 'config')))
  await assertFails(setDoc(doc(owner, 'service', 'config'), { youtubeApiKey: 'x' }))
})
await t('only admin bans; the banned user sees his ban', async () => {
  await assertFails(setDoc(doc(owner, 'serviceBans', 'banned'), { uid: 'banned', reason: '', createdAt: now, createdBy: 'owner' }))
  await assertSucceeds(setDoc(doc(admin, 'serviceBans', 'banned'), { uid: 'banned', reason: 'spam', createdAt: now, createdBy: ADMIN }))
  await assertSucceeds(getDoc(doc(banned, 'serviceBans', 'banned')))
  await assertFails(getDoc(doc(stranger, 'serviceBans', 'banned')))
})
await t('a banned user cannot create worlds, campaigns or rooms', async () => {
  const b = writeBatch(banned)
  b.set(doc(banned, 'worlds', 'wBan'), { name: 'B', ownerId: 'banned', isPublic: false, aclVersion: 0, settings: {}, createdAt: now, updatedAt: now })
  b.set(doc(banned, 'worlds', 'wBan', 'members', 'banned'), { uid: 'banned', role: 'owner', displayName: 'B', email: '', photoURL: null, joinedAt: now })
  await assertFails(b.commit())
  await assertFails(setDoc(doc(banned, 'rooms', 'rBan'), room('banned')))
})

// ======================= campaigns =======================
const camp = (ownerUid, extra = {}) => ({ name: 'C', description: '', cover: null, worldId: 'wA', worldName: 'wA', ownerId: ownerUid, gmUids: [ownerUid], memberUids: [ownerUid], status: 'active', schedule: '', nextSessionAt: null, createdAt: now, updatedAt: now, ...extra })
const part = (u, role, extra = {}) => ({ uid: u, role, displayName: u, photoURL: null, characterId: null, characterName: '', joinedAt: now, ...extra })
async function join(ctx, u, cid, code, role = 'player') {
  const b = writeBatch(ctx)
  b.set(doc(ctx, 'campaigns', cid, 'participants', u), part(u, role, { inviteCode: code }))
  const c = (await getDoc(doc(owner, 'campaigns', cid))).data()
  b.update(doc(ctx, 'campaigns', cid), { memberUids: [...c.memberUids, u], gmUids: role === 'gm' ? [...c.gmUids, u] : c.gmUids, updatedAt: now })
  return b.commit()
}

console.log('campaigns')
await t('a world master creates a campaign bound to his world (campaign + own participant in one batch)', async () => {
  for (const id of ['c1', 'c2']) {
    const b = writeBatch(owner)
    b.set(doc(owner, 'campaigns', id), camp('owner'))
    b.set(doc(owner, 'campaigns', id, 'participants', 'owner'), part('owner', 'gm'))
    await assertSucceeds(b.commit())
  }
})
await t('nobody binds a campaign to a world he does not run', async () => {
  const b = writeBatch(player)
  b.set(doc(player, 'campaigns', 'cBad'), camp('player'))
  b.set(doc(player, 'campaigns', 'cBad', 'participants', 'player'), part('player', 'gm'))
  await assertFails(b.commit())
})
await t('a campaign without a world is allowed by the model (detaching later)', async () => {
  const b = writeBatch(stranger)
  b.set(doc(stranger, 'campaigns', 'cFree'), camp('stranger', { worldId: null, worldName: '' }))
  b.set(doc(stranger, 'campaigns', 'cFree', 'participants', 'stranger'), part('stranger', 'gm'))
  await assertSucceeds(b.commit())
})
await t('strangers cannot read a campaign; "my campaigns" query works', async () => {
  await assertFails(getDoc(doc(stranger, 'campaigns', 'c1')))
  await assertFails(getDocs(collection(stranger, 'campaigns')))
  const s = await assertSucceeds(getDocs(query(collection(owner, 'campaigns'), where('memberUids', 'array-contains', 'owner'))))
  if (s.size !== 2) throw new Error('expected 2, got ' + s.size)
})
await t('GM creates invites; a player joins by invite', async () => {
  await assertSucceeds(setDoc(doc(owner, 'campaigns', 'c1', 'invites', 'ci1'), { code: 'ci1', role: 'player', createdBy: 'owner', createdAt: now, expiresAt: null, campaignName: 'C', worldId: 'wA', worldInviteCode: null }))
  await assertSucceeds(setDoc(doc(owner, 'campaigns', 'c2', 'invites', 'ci2'), { code: 'ci2', role: 'player', createdBy: 'owner', createdAt: now, expiresAt: null, campaignName: 'C', worldId: 'wA', worldInviteCode: null }))
  await assertSucceeds(getDoc(doc(stranger, 'campaigns', 'c1', 'invites', 'ci1')))
  await assertSucceeds(join(stranger, 'stranger', 'c1', 'ci1'))
  await assertSucceeds(getDoc(doc(stranger, 'campaigns', 'c1')))
  await assertSucceeds(getDocs(collection(stranger, 'campaigns', 'c1', 'participants')))
  await assertSucceeds(join(player, 'player', 'c2', 'ci2'))
})
await t('a player invite does not make a GM; no joining without a participant doc', async () => {
  await assertFails(join(player2, 'player2', 'c1', 'ci1', 'gm'))
  await assertFails(updateDoc(doc(player2, 'campaigns', 'c1'), { memberUids: ['owner', 'stranger', 'player2'], updatedAt: now }))
  await assertFails(join(player2, 'player2', 'c1', 'nope'))
})
await t('players edit their character, not their role or the campaign', async () => {
  await assertSucceeds(updateDoc(doc(stranger, 'campaigns', 'c1', 'participants', 'stranger'), { characterName: 'Аэлин' }))
  await assertFails(updateDoc(doc(stranger, 'campaigns', 'c1', 'participants', 'stranger'), { role: 'gm' }))
  await assertFails(updateDoc(doc(stranger, 'campaigns', 'c1'), { name: 'Мой кампейн' }))
})
await t('GM writes sessions; players read them', async () => {
  await assertSucceeds(setDoc(doc(owner, 'campaigns', 'c1', 'sessions', 's1'), { number: 1, title: 'Начало', date: now, status: 'done', html: '<p>x</p>', createdBy: 'owner', createdAt: now, updatedAt: now }))
  await assertSucceeds(getDocs(collection(stranger, 'campaigns', 'c1', 'sessions')))
  await assertFails(setDoc(doc(stranger, 'campaigns', 'c1', 'sessions', 's2'), { number: 2, title: 'x' }))
})
await t('GM promotes a player to GM (participant role + gmUids)', async () => {
  const b = writeBatch(owner)
  b.update(doc(owner, 'campaigns', 'c2', 'participants', 'player'), { role: 'gm' })
  b.update(doc(owner, 'campaigns', 'c2'), { gmUids: ['owner', 'player'], updatedAt: now })
  await assertSucceeds(b.commit())
})
await t('GMs cannot take the campaign from its owner', async () => {
  await assertFails(updateDoc(doc(player, 'campaigns', 'c2'), { ownerId: 'player' }))
  await assertFails(updateDoc(doc(player, 'campaigns', 'c2'), { gmUids: ['player'] }))
})

// ======================= music rooms =======================
function room(ownerUid, extra = {}) {
  return { name: 'R', ownerId: ownerUid, ownerName: ownerUid, hostUids: [], memberUids: [ownerUid], campaignId: null, campaignName: '', access: 'link', controlMode: 'hosts', createdAt: now, updatedAt: now, lastActiveAt: now, ...extra }
}
const track = (extra = {}) => ({ name: 'Музыка', kind: 'main', order: 0, queue: [], current: null, playing: false, position: 0, at: now, volume: 100, loop: 'all', shuffle: false, rev: 0, updatedAt: now, updatedBy: 'owner', ...extra })

console.log('music rooms')
await t('anyone signed in creates a room with its main track in one batch; a link room opens for anyone signed in', async () => {
  const b = writeBatch(owner)
  b.set(doc(owner, 'rooms', 'rLink'), room('owner'))
  b.set(doc(owner, 'rooms', 'rLink', 'tracks', 'main'), track({ queue: [{ id: 'q1', videoId: 'a' }, { id: 'q2', videoId: 'b' }], current: 'q1' }))
  await assertSucceeds(b.commit())
  await assertSucceeds(getDoc(doc(player2, 'rooms', 'rLink')))
  await assertFails(getDoc(doc(guest, 'rooms', 'rLink')))
})
await t('a listener adds himself to the room, not anybody else; cannot rename it', async () => {
  await assertSucceeds(updateDoc(doc(player2, 'rooms', 'rLink'), { memberUids: ['owner', 'player2'], lastActiveAt: now }))
  await assertFails(updateDoc(doc(stranger, 'rooms', 'rLink'), { memberUids: ['owner', 'player2', 'stranger', 'player'] }))
  await assertFails(updateDoc(doc(player2, 'rooms', 'rLink'), { name: 'Моя' }))
  const s = await assertSucceeds(getDocs(query(collection(player2, 'rooms'), where('memberUids', 'array-contains', 'player2'))))
  if (s.size !== 1) throw new Error('expected 1, got ' + s.size)
})
await t('hosts-only control: a listener cannot pause or seek, but may advance to the next item', async () => {
  await assertFails(updateDoc(doc(player2, 'rooms', 'rLink', 'tracks', 'main'), { playing: true, position: 30, at: now, rev: 1 }))
  await assertSucceeds(updateDoc(doc(player2, 'rooms', 'rLink', 'tracks', 'main'), { current: 'q2', position: 0, at: now, playing: true, rev: 1, updatedAt: now, updatedBy: 'player2' }))
  await assertFails(setDoc(doc(player2, 'rooms', 'rLink', 'tracks', 'rain'), track({ kind: 'layer' })))
})
await t('"everyone" mode: listeners control and add layers', async () => {
  await assertSucceeds(updateDoc(doc(owner, 'rooms', 'rLink'), { controlMode: 'everyone' }))
  await assertSucceeds(updateDoc(doc(player2, 'rooms', 'rLink', 'tracks', 'main'), { playing: false, position: 12, at: now, rev: 2 }))
  await assertSucceeds(setDoc(doc(player2, 'rooms', 'rLink', 'tracks', 'rain'), track({ kind: 'layer', name: 'Дождь' })))
})
await t('presence and chat: own listener doc only; messages signed by the author', async () => {
  await assertSucceeds(setDoc(doc(player2, 'rooms', 'rLink', 'listeners', 'player2'), { uid: 'player2', displayName: 'P2', photoURL: null, at: now, joinedAt: now }))
  await assertFails(setDoc(doc(player2, 'rooms', 'rLink', 'listeners', 'owner'), { uid: 'owner', displayName: 'O', photoURL: null, at: now, joinedAt: now }))
  await assertSucceeds(setDoc(doc(player2, 'rooms', 'rLink', 'messages', 'm1'), { uid: 'player2', name: 'P2', text: 'привет', at: now }))
  await assertFails(setDoc(doc(player2, 'rooms', 'rLink', 'messages', 'm2'), { uid: 'owner', name: 'O', text: 'фейк', at: now }))
  await assertFails(getDocs(collection(guest, 'rooms', 'rLink', 'messages')))
})
await t('a campaign room is only for the campaign members', async () => {
  await assertSucceeds(setDoc(doc(owner, 'rooms', 'rCamp'), room('owner', { campaignId: 'c1', campaignName: 'C', access: 'campaign' })))
  await assertSucceeds(getDoc(doc(stranger, 'rooms', 'rCamp')))   // joined c1 above
  await assertFails(getDoc(doc(player2, 'rooms', 'rCamp')))
  await assertFails(getDocs(collection(player2, 'rooms', 'rCamp', 'tracks')))
})
await t('campaign members list the rooms of their campaign', async () => {
  const s = await assertSucceeds(getDocs(query(collection(stranger, 'rooms'), where('campaignId', '==', 'c1'))))
  if (s.size !== 1) throw new Error('expected 1, got ' + s.size)
  await assertFails(getDocs(query(collection(player2, 'rooms'), where('campaignId', '==', 'c1'))))
})
await t('nobody binds a room to a campaign he is not in', async () => {
  await assertFails(setDoc(doc(player2, 'rooms', 'rBad'), room('player2', { campaignId: 'c1', access: 'campaign' })))
  await assertFails(updateDoc(doc(player2, 'rooms', 'rLink'), { campaignId: 'c1' }))
})
await t('admin lists all rooms and campaigns', async () => {
  await assertSucceeds(getDocs(collection(admin, 'rooms')))
  await assertSucceeds(getDocs(collection(admin, 'campaigns')))
  await assertSucceeds(getDocs(collection(admin, 'rooms', 'rCamp', 'tracks')))
})
await t('the owner deletes his room (subcollections first)', async () => {
  for (const [c, id] of [['tracks', 'main'], ['tracks', 'rain'], ['listeners', 'player2'], ['messages', 'm1']]) await assertSucceeds(deleteDoc(doc(owner, 'rooms', 'rLink', c, id)))
  await assertFails(deleteDoc(doc(player2, 'rooms', 'rLink')))
  await assertSucceeds(deleteDoc(doc(owner, 'rooms', 'rLink')))
})
await t('a player leaves a campaign: participant doc + memberUids in one batch', async () => {
  const b = writeBatch(stranger)
  b.delete(doc(stranger, 'campaigns', 'c1', 'participants', 'stranger'))
  b.update(doc(stranger, 'campaigns', 'c1'), { memberUids: ['owner'], gmUids: ['owner'], updatedAt: now })
  await assertSucceeds(b.commit())
  await assertFails(getDoc(doc(stranger, 'campaigns', 'c1')))
  await assertFails(getDoc(doc(stranger, 'rooms', 'rCamp')))
})
await t('the owner deletes his campaign; admin deletes anyone\'s', async () => {
  await assertSucceeds(deleteDoc(doc(owner, 'campaigns', 'c1', 'sessions', 's1')))
  await assertSucceeds(deleteDoc(doc(owner, 'campaigns', 'c1')))
  await assertFails(deleteDoc(doc(owner, 'campaigns', 'cFree')))
  await assertSucceeds(deleteDoc(doc(admin, 'campaigns', 'cFree')))
})

await env.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
