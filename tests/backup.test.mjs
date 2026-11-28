// Automated tests for backup-runner/backup.mjs (worlds + platform collections + idempotency).
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runBackup } from '../backup-runner/backup.mjs'
import { NON_CONTENT_COLLECTIONS } from '../src/data/backup/format.ts'

function mockDb(tree) {
  const makeSnap = (id, node, ref) => ({
    id,
    exists: node !== undefined,
    data: () => node?.data ?? {},
    get: (k) => node?.data?.[k],
    ref,
  })
  const makeDocRef = (p) => {
    const parts = p.split('/')
    let cur = tree
    for (let i = 0; i < parts.length; i += 2) {
      cur = (i === 0 ? cur : cur?.sub)?.[parts[i]]?.[parts[i + 1]]
    }
    const ref = {
      id: parts.at(-1),
      path: p,
      async get() { return makeSnap(parts.at(-1), cur, ref) },
      async listCollections() {
        const subs = cur?.sub ?? {}
        return Object.keys(subs).map((name) => makeCollRef(`${p}/${name}`))
      },
    }
    return ref
  }
  const makeCollRef = (p) => {
    const parts = p.split('/')
    let map
    if (parts.length === 1) map = tree[parts[0]] ?? {}
    else {
      let cur = tree
      for (let i = 0; i < parts.length - 1; i += 2) cur = cur?.[parts[i]]?.[parts[i + 1]]
      map = cur?.sub?.[parts.at(-1)] ?? {}
    }
    return {
      id: parts.at(-1),
      path: p,
      async get() {
        const docs = Object.entries(map).map(([id, node]) => makeSnap(id, node, makeDocRef(`${p}/${id}`)))
        return { size: docs.length, docs }
      },
    }
  }
  return {
    collection: (name) => makeCollRef(name),
    doc: (p) => makeDocRef(p),
    async getAll(...refs) { return Promise.all(refs.map((r) => r.get())) },
    async listCollections() { return Object.keys(tree).map((name) => makeCollRef(name)) },
  }
}

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.error('  ✗', name, '\n     ', e?.stack ?? e)
  }
}

const imgBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04])
const db = mockDb({
  worlds: {
    w1: {
      data: { name: 'Дезремон', ownerId: 'u1', isPublic: true },
      sub: {
        entities: { e1: { data: { name: 'Азар', visibility: 'public', backgroundImageId: 'img1' } } },
        comments: { c1: { data: { text: 'Привет' } } },
        joinRequests: { u2: { data: { uid: 'u2', status: 'pending' } } },
        members: { u1: { data: { uid: 'u1', role: 'owner' } } },
        images: { img1: { data: { mime: 'image/webp', size: imgBytes.length, chunkCount: 1 } } },
        imageChunks: { img1_0: { data: { data: imgBytes } } },
      },
    },
  },
  users: {
    u1: {
      data: { uid: 'u1', displayName: 'Админ' },
      sub: {
        statSets: { s1: { data: { name: 'Маг', scores: [15, 14, 13, 12, 10, 8] } } },
        pf2eCharacters: { p1: { data: { name: 'Диармад', level: 5 } } },
      },
    },
    u2: { data: { uid: 'u2', displayName: 'Игрок без мира' } },
  },
  campaigns: {
    camp1: {
      data: { name: 'Тёмные тропы', worldId: 'w1', ownerId: 'u1' },
      sub: {
        participants: { u1: { data: { uid: 'u1', role: 'gm' } } },
        sessions: { ses1: { data: { number: 1, title: 'Сессия 1' } } },
        invites: { inv1: { data: { code: 'inv1', role: 'player' } } },
      },
    },
  },
  rooms: {
    room1: {
      data: { name: 'Таверна', ownerId: 'u1' },
      sub: {
        tracks: { main: { data: { name: 'Музыка', queue: [] } } },
        playlists: { pl1: { data: { name: 'Бой', items: [] } } },
        messages: { m1: { data: { text: 'Добро пожаловать' } } },
        listeners: { u1: { data: { uid: 'u1', at: 123 } } },
      },
    },
  },
  profiles: { u1: { data: { uid: 'u1', displayName: 'Админ' } } },
  service: { config: { data: { youtubeApiKey: 'test-key' } } },
  serviceBans: {},
  usage: { w1: { data: { bytes: 100 } } },
})

const tmp = await mkdtemp(path.join(os.tmpdir(), 'dezremon-backup-test-'))
const out = path.join(tmp, 'backups')
const platformOut = path.join(tmp, 'platform')

try {
  await test('NON_CONTENT_COLLECTIONS excludes bans and joinRequests so restoreWorld never fails', () => {
    assert.equal(NON_CONTENT_COLLECTIONS.has('bans'), true)
    assert.equal(NON_CONTENT_COLLECTIONS.has('joinRequests'), true)
  })

  await test('runBackup dumps worlds, images, users+tools, campaigns, rooms (no listeners), and top-level collections', async () => {
    const r1 = await runBackup(db, { out, platformOut, log: () => {} })
    assert.ok(r1.changed > 0)
    assert.equal(r1.warnings.length, 0)

    const wManifest = JSON.parse(await readFile(path.join(out, 'w1', 'manifest.json'), 'utf8'))
    assert.equal(wManifest.world.name, 'Дезремон')
    assert.equal(wManifest.counts.entities, 1)
    assert.equal(wManifest.counts.comments, 1)
    assert.equal(wManifest.images.count, 1)
    const savedImg = await readFile(path.join(out, 'w1', 'images', 'img1.webp'))
    assert.equal(savedImg.equals(imgBytes), true)

    const pManifest = JSON.parse(await readFile(path.join(platformOut, 'manifest.json'), 'utf8'))
    assert.equal(pManifest.counts.users, 2)
    assert.equal(pManifest.counts.userSubcollections.statSets, 1)
    assert.equal(pManifest.counts.userSubcollections.pf2eCharacters, 1)
    assert.equal(pManifest.counts.campaigns, 1)
    assert.equal(pManifest.counts.campaignSubcollections.sessions, 1)
    assert.equal(pManifest.counts.rooms, 1)
    assert.equal(pManifest.counts.roomSubcollections.playlists, 1)
    assert.equal(pManifest.counts.roomSubcollections.listeners, undefined)
    assert.equal(pManifest.counts.topLevel.profiles, 1)
    assert.equal(pManifest.counts.topLevel.service, 1)
    assert.equal(pManifest.counts.topLevel.usage, undefined)

    const pf2e = JSON.parse(await readFile(path.join(platformOut, 'users', 'u1', 'pf2eCharacters.json'), 'utf8'))
    assert.equal(pf2e.docs.p1.name, 'Диармад')
    const ses = JSON.parse(await readFile(path.join(platformOut, 'campaigns', 'camp1', 'data', 'sessions.json'), 'utf8'))
    assert.equal(ses.docs.ses1.title, 'Сессия 1')
    const pl = JSON.parse(await readFile(path.join(platformOut, 'rooms', 'room1', 'data', 'playlists.json'), 'utf8'))
    assert.equal(pl.docs.pl1.name, 'Бой')
  })

  await test('second identical runBackup is 100% idempotent (0 changed files, 0 image re-downloads)', async () => {
    const r2 = await runBackup(db, { out, platformOut, log: () => {} })
    assert.equal(r2.changed, 0)
    assert.equal(r2.warnings.length, 0)
  })
} finally {
  await rm(tmp, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
