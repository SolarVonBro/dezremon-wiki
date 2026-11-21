// Removes ONLY e2e test data: auth accounts e2e-*@example.com, their users/{uid} docs,
// worlds named "E2E …" (reports only), and joinRequests left under worlds that no longer exist.
// Usage: node tests/cleanup_e2e.mjs "$(node gtoken.mjs)" [--apply]   (token = OAuth access token of a project owner)
const [token, flag] = process.argv.slice(2)
const APPLY = flag === '--apply'
const P = 'dezremon-wiki-6118'
const H = { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': P, 'Content-Type': 'application/json' }
const FS = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`

async function j(url, opt = {}) {
  const r = await fetch(url, { headers: H, ...opt })
  const t = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${url}: ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : {}
}

// ---- auth accounts
const users = []
let next = ''
do {
  const r = await j(`https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:batchGet?maxResults=500${next ? `&nextPageToken=${next}` : ''}`)
  users.push(...(r.users ?? []))
  next = r.nextPageToken ?? ''
} while (next)
const e2e = users.filter((u) => /^e2e-[a-z0-9-]+@example\.com$/.test(u.email ?? ''))
console.log(`accounts: ${users.length} total, ${e2e.length} e2e:`, e2e.map((u) => u.email).join(', '))

// ---- worlds named E2E (should be none: tests delete their worlds)
const worlds = await j(`${FS}/worlds?pageSize=300&mask.fieldPaths=name`)
const allWorlds = (worlds.documents ?? []).map((d) => ({ id: d.name.split('/').pop(), name: d.fields?.name?.stringValue ?? '' }))
const e2eWorlds = allWorlds.filter((w) => w.name.startsWith('E2E'))
console.log(`worlds: ${allWorlds.length} total; E2E worlds left:`, e2eWorlds.map((w) => `${w.id} ${w.name}`).join(', ') || 'none')
const existing = new Set(allWorlds.map((w) => w.id))

// ---- orphan join requests (collection group)
const q = await j(`${FS}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'joinRequests', allDescendants: true }] } }) })
const reqs = q.filter((x) => x.document).map((x) => x.document.name)
const orphans = reqs.filter((n) => !existing.has(n.split('/worlds/')[1].split('/')[0]))
console.log(`joinRequests: ${reqs.length} total, ${orphans.length} orphaned`)

// ---- orphan subcollection docs of deleted e2e worlds that the old deleteWorld missed are only joinRequests
const e2eUids = new Set(e2e.map((u) => u.localId))
if (APPLY) {
  for (const n of orphans) await j(`https://firestore.googleapis.com/v1/${n}`, { method: 'DELETE' })
  for (const uid of e2eUids) await j(`${FS}/users/${uid}`, { method: 'DELETE' }).catch((e) => console.log('users doc', uid, e.message))
  for (let i = 0; i < e2e.length; i += 100) {
    await j(`https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:batchDelete`, { method: 'POST', body: JSON.stringify({ localIds: e2e.slice(i, i + 100).map((u) => u.localId), force: true }) })
  }
  console.log('deleted:', orphans.length, 'orphan requests,', e2eUids.size, 'users docs,', e2e.length, 'accounts')
} else {
  console.log('dry run; pass --apply to delete')
}
