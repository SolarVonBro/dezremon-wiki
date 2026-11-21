import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import {
  collection, collectionGroup, deleteDoc, disableNetwork, doc, enableNetwork, getDoc, getDocs, increment, onSnapshot, orderBy, query, setDoc, updateDoc,
  where, writeBatch, limit as qlimit, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useSession } from './session'
import { cache } from '@/data/cache'
import { syncCollection, type SyncHandle } from '@/data/sync'
import { canSee, coll, docRef, isMasterRole, narrows, visibleQueries, type Access } from '@/data/access'
import { ensureImageAccess, imageIdsInHtml } from '@/data/images'
import { watchWorldRequests } from '@/data/joinRequests'
import { hasSecretBlocks, mentionIds, stripSecrets } from '@/data/html'
import { clean, excerptOf, htmlToText, now, randomId, sortByName } from '@/data/util'
import { setCustomTypes, typeDef } from '@/model/entityTypes'
import type {
  Attribute, Ban, Entity, Invite, JoinRequest, Member, Relation, Revision, Role, Secrets, Visibility, World, WorldSettings,
} from '@/model/types'
import { toast } from '@/components/common/toast'

export const DEFAULT_SETTINGS: WorldSettings = {
  disabledTypes: ['conversation', 'dice_roll'],
  customTypes: [],
  playerCreateTypes: ['journal', 'note'],
  playersCanPost: true,
  defaultVisibility: 'members',
  dashboardPins: [],
  mainCalendarId: null,
  accent: null,
}

type Status = 'idle' | 'loading' | 'ready' | 'denied' | 'error'

export const useWorld = defineStore('world', () => {
  const session = useSession()
  const wid = ref<string | null>(null)
  const world = ref<World | null>(null)
  const member = ref<Member | null>(null)
  const members = ref<Member[]>([])
  const entities = shallowRef(new Map<string, Entity>())
  const relations = shallowRef(new Map<string, Relation>())
  const status = ref<Status>('idle')
  const errorText = ref('')
  const pendingWrites = ref(0)
  const lastSavedAt = ref(0)
  /** Master-only private attributes / GM notes, loaded with the secrets doc. */
  const secretsState = ref<Record<string, { attributes: Attribute[]; gmNotes: string }>>({})

  let unsubs: Unsubscribe[] = []
  let syncs: SyncHandle[] = []
  let openToken = 0

  const uid = computed(() => session.user?.uid ?? null)
  const role = computed<Role | null>(() => member.value?.role ?? null)
  /**
   * "View as player": a master sees the world exactly as a player (or one specific member) would —
   * hidden articles, rows and master secrets disappear, editing is off. Purely client-side.
   */
  const preview = ref<{ uid: string | null; name: string; guest?: boolean } | null>(null)
  const realMaster = computed(() => isMasterRole(role.value))
  const isMaster = computed(() => realMaster.value && !preview.value)
  const isOwner = computed(() => role.value === 'owner' && !preview.value)
  const isMember = computed(() => !!role.value)
  const access = computed<Access>(() => ({ wid: wid.value ?? '', uid: uid.value, role: role.value }))
  /** Access used to decide what is shown (differs from `access` only in preview mode). */
  const viewAccess = computed<Access>(() => (!preview.value ? access.value
    : preview.value.guest ? { wid: wid.value ?? '', uid: null, role: null }
      : { wid: wid.value ?? '', uid: preview.value.uid ?? '__preview__', role: 'player' }))
  /** The member whose eyes we look through (self, or the previewed player). */
  const viewMember = computed<Member | null>(() => (preview.value?.uid ? members.value.find((m) => m.uid === preview.value!.uid) ?? null : preview.value ? null : member.value))
  const settings = computed<WorldSettings>(() => ({ ...DEFAULT_SETTINGS, ...(world.value?.settings ?? {}) }))

  // ---------- derived views ----------
  const list = computed(() => {
    const a = viewAccess.value
    const pub = !!world.value?.isPublic
    return [...entities.value.values()].filter((e) => !e.deleted && canSee(a, e, pub))
  })
  const trash = computed(() => [...entities.value.values()].filter((e) => e.deleted).sort((x, y) => (y.deletedAt ?? 0) - (x.deletedAt ?? 0)))
  const byType = computed(() => {
    const m = new Map<string, Entity[]>()
    for (const e of list.value) {
      if (!m.has(e.type)) m.set(e.type, [])
      m.get(e.type)!.push(e)
    }
    for (const arr of m.values()) sortByName(arr)
    return m
  })
  const children = computed(() => {
    const m = new Map<string, Entity[]>()
    for (const e of list.value) {
      if (!e.parentId) continue
      if (!m.has(e.parentId)) m.set(e.parentId, [])
      m.get(e.parentId)!.push(e)
    }
    for (const arr of m.values()) sortByName(arr)
    return m
  })
  const tags = computed(() => byType.value.get('tag') ?? [])
  const recent = computed(() => [...list.value].sort((a, b) => b.updatedAt - a.updatedAt))
  const visibleRelations = computed(() => {
    const a = viewAccess.value
    const pub = !!world.value?.isPublic
    return [...relations.value.values()].filter((r) => !r.deleted && canSee(a, r, pub) && get(r.sourceId) && get(r.targetId))
  })
  const backlinks = computed(() => {
    const m = new Map<string, Entity[]>()
    for (const e of list.value) for (const id of e.mentions ?? []) {
      if (id === e.id) continue
      if (!m.has(id)) m.set(id, [])
      m.get(id)!.push(e)
    }
    return m
  })
  const enabledTypes = computed(() => {
    const dis = new Set(settings.value.disabledTypes)
    return (key: string) => !dis.has(key)
  })

  function get(id: string | null | undefined): Entity | undefined {
    if (!id) return undefined
    const e = entities.value.get(id)
    if (!e || e.deleted) return undefined
    return canSee(viewAccess.value, e, !!world.value?.isPublic) ? e : undefined
  }
  function getAny(id: string) { return entities.value.get(id) }

  function canEdit(e: Entity | undefined | null): boolean {
    if (!e || !uid.value || !role.value || preview.value) return false
    if (isMaster.value) return true
    if (e.hasSecrets) return false
    return e.createdBy === uid.value || (e.editorUids ?? []).includes(uid.value)
  }
  function canCreate(type: string): boolean {
    if (preview.value) return false
    if (isMaster.value) return true
    return !!role.value && (settings.value.playerCreateTypes.includes(type) || (member.value?.createTypes ?? []).includes(type))
  }

  // ---------- open / close ----------
  // The world is loaded for a particular user (guest = null): signing in or out from inside the world reloads it,
  // otherwise a guest who just signed in would keep seeing the guest view and never notice being let in.
  let openedFor: string | null = null
  watch(() => session.user?.uid ?? null, (u) => {
    const id = wid.value
    if (!id || u === openedFor || (status.value !== 'ready' && status.value !== 'denied' && status.value !== 'error')) return
    close()
    void open(id)
  })

  function close() {
    unsubs.forEach((u) => u())
    syncs.forEach((s) => s.stop())
    unsubs = []
    syncs = []
    world.value = null
    member.value = null
    members.value = []
    entities.value = new Map()
    relations.value = new Map()
    secretsState.value = {}
    preview.value = null
    status.value = 'idle'
    wid.value = null
  }

  async function open(id: string) {
    if (wid.value === id && openedFor === (session.user?.uid ?? null) && (status.value === 'ready' || status.value === 'loading')) return
    close()
    const token = ++openToken
    wid.value = id
    status.value = 'loading'
    await session.whenReady
    if (token !== openToken) return
    openedFor = session.user?.uid ?? null
    try {
      const u = session.user
      const [ws, ms] = await Promise.all([
        getDoc(doc(db, 'worlds', id)),
        u ? getDoc(doc(db, 'worlds', id, 'members', u.uid)) : Promise.resolve(null),
      ])
      if (token !== openToken) return
      if (!ws.exists()) { deny(id, token); return }
      world.value = { ...(ws.data() as World), id }
      member.value = ms?.exists() ? (ms.data() as Member) : null
      setCustomTypes(settings.value.customTypes)
      if (!member.value && !world.value.isPublic) { deny(id, token); return }
      startLive(id, token)
      await startSync(token)
      if (token !== openToken) return
      status.value = 'ready'
      void touchLastSeen()
    } catch (e: any) {
      if (token !== openToken) return
      if (e?.code !== 'permission-denied') console.error(e)
      if (e?.code === 'permission-denied') deny(id, token)
      else status.value = 'error'
      errorText.value = e?.message ?? String(e)
    }
  }

  /**
   * No access to a closed world. A signed-in visitor may have a join request pending: listen to our own
   * member doc and re-open the world as soon as a master lets us in.
   */
  function deny(id: string, token: number) {
    status.value = 'denied'
    const u = session.user
    if (!u) return
    unsubs.push(onSnapshot(doc(db, 'worlds', id, 'members', u.uid), (s) => {
      if (token !== openToken || !s.exists()) return
      close()
      void open(id)
    }, () => {}))
  }

  /**
   * Losing access makes the server drop a pile of listen targets at once; afterwards the SDK sometimes stops
   * delivering updates for new listeners in the same tab (seen with join requests after being kicked).
   * Restarting the streams re-subscribes everything cleanly; pending writes are kept.
   */
  function resetStreams() {
    void disableNetwork(db).then(() => enableNetwork(db)).catch(() => {})
  }

  function startLive(id: string, token: number) {
    unsubs.push(onSnapshot(doc(db, 'worlds', id), (s) => {
      if (!s.exists() || token !== openToken) return
      const prevAcl = world.value?.aclVersion
      world.value = { ...(s.data() as World), id }
      setCustomTypes(settings.value.customTypes)
      if (prevAcl !== undefined && prevAcl !== world.value.aclVersion && !isMaster.value) void restartSync()
    }, () => {}))
    const u = session.user
    if (u) {
      unsubs.push(onSnapshot(doc(db, 'worlds', id, 'members', u.uid), (s) => {
        if (token !== openToken) return
        const prevRole = member.value?.role
        member.value = s.exists() ? (s.data() as Member) : null
        if (!prevRole && member.value) {
          // a guest of a public world was just let in (join request accepted): reopen with member access
          close()
          void open(id)
          return
        }
        if (prevRole && !member.value && !world.value?.isPublic) {
          // removed, banned or left a closed world: drop everything we had, including the local cache
          syncs.forEach((x) => x.stop())
          syncs = []
          entities.value = new Map()
          relations.value = new Map()
          status.value = 'denied'
          void cache.clearWorld(id)
          resetStreams()
          return
        }
        if (prevRole !== member.value?.role && status.value === 'ready') void restartSync()
      }, () => {}))
      unsubs.push(onSnapshot(collection(db, 'worlds', id, 'members'), (s) => {
        members.value = s.docs.map((d) => d.data() as Member).sort((a, b) => a.displayName.localeCompare(b.displayName))
      }, () => { members.value = [] }))
    }
  }

  async function startSync(token: number) {
    const a = access.value
    const acl = world.value?.aclVersion ?? 0
    const onErr = (e: unknown) => {
      // Access changed under us (removed from the world, role lowered…): re-check instead of alarming the user.
      if ((e as any)?.code === 'permission-denied') { void revalidateAccess(token); return }
      console.error('sync error', e)
      toast.error('Ошибка синхронизации: ' + ((e as any)?.message ?? e))
    }
    const s1 = await syncCollection<Entity>(a, 'entities', acl, (ups, rem) => {
      if (token !== openToken) return
      const m = new Map(entities.value)
      for (const u of ups) m.set(u.id, normalizeEntity(u))
      for (const r of rem) m.delete(r)
      entities.value = m
    }, onErr)
    const s2 = await syncCollection<Relation>(a, 'relations', acl, (ups, rem) => {
      if (token !== openToken) return
      const m = new Map(relations.value)
      for (const u of ups) m.set(u.id, u)
      for (const r of rem) m.delete(r)
      relations.value = m
    }, onErr)
    syncs.push(s1, s2)
    await Promise.all([s1.ready, s2.ready])
  }

  let revalidating = false
  async function revalidateAccess(token: number) {
    if (revalidating || token !== openToken || !wid.value) return
    revalidating = true
    try {
      const u = session.user
      const ms = u ? await getDoc(doc(db, 'worlds', wid.value, 'members', u.uid)).catch(() => null) : null
      if (token !== openToken) return
      member.value = ms?.exists() ? (ms.data() as Member) : null
      if (!member.value && !world.value?.isPublic) {
        syncs.forEach((x) => x.stop())
        syncs = []
        entities.value = new Map()
        relations.value = new Map()
        status.value = 'denied'
        void cache.clearWorld(wid.value)
        resetStreams()
        return
      }
      await restartSync()
    } finally { revalidating = false }
  }

  async function restartSync() {
    syncs.forEach((s) => s.stop())
    syncs = []
    entities.value = new Map()
    relations.value = new Map()
    await startSync(openToken)
  }

  function normalizeEntity(e: any): Entity {
    return {
      kind: '', parentId: null, imageId: null, headerImageId: null, tagIds: [], aliases: [], fields: {}, attributes: [], links: [],
      excerpt: '', tooltip: '', mentions: [], editorUids: [], allowedUids: [], hasSecrets: false, bodyRev: 0, isTemplate: false,
      deleted: false, deletedAt: null, ...e,
    }
  }

  // ---------- writes ----------
  function track<T>(p: Promise<T>, what = 'Сохранение'): Promise<T> {
    pendingWrites.value++
    return p.then((r) => { lastSavedAt.value = now(); return r })
      .catch((e) => { console.error(e); toast.error(`${what}: ${e?.code === 'permission-denied' ? 'нет прав' : e?.message ?? e}`); throw e })
      .finally(() => { pendingWrites.value-- })
  }

  function stamp(createdBy?: string) {
    const t = now()
    return { createdAt: t, updatedAt: t, createdBy: createdBy ?? uid.value!, updatedBy: uid.value! }
  }

  function defaultVisibility(): Visibility {
    return isMaster.value ? settings.value.defaultVisibility : 'members'
  }

  function newEntityData(type: string, name: string, extra: Partial<Entity> = {}): Entity {
    const autoTags = tags.value.filter((t) => t.fields?.isAutoApplied).map((t) => t.id)
    const tmplAttrs: Attribute[] = []
    for (const t of byType.value.get('attribute_template') ?? []) {
      if (t.fields?.autoType === type) for (const at of t.attributes) tmplAttrs.push({ ...at, id: randomId(8) })
    }
    return normalizeEntity({
      id: doc(coll(wid.value!, 'entities')).id, type, name: name.trim() || 'Без названия',
      tagIds: autoTags, attributes: tmplAttrs, visibility: defaultVisibility(), allowedUids: [],
      ...stamp(), ...extra,
    })
  }

  async function createEntity(type: string, name: string, extra: Partial<Entity> = {}, html = ''): Promise<string> {
    const e = newEntityData(type, name, extra)
    const readable = stripSecrets(html)
    const secret = isMaster.value && hasSecretBlocks(html)
    e.excerpt = excerptOf(readable)
    e.mentions = mentionIds(readable)
    e.hasSecrets = secret
    e.bodyRev = html ? 1 : 0
    const batch = writeBatch(db)
    batch.set(docRef(wid.value!, 'entities', e.id), clean(e))
    batch.set(docRef(wid.value!, 'bodies', e.id), bodyDoc(e, readable, e.bodyRev))
    if (secret) batch.set(docRef(wid.value!, 'secrets', e.id), { html, attributes: [], gmNotes: '', rev: e.bodyRev, updatedAt: now(), updatedBy: uid.value })
    entities.value = new Map(entities.value).set(e.id, e)
    void track(batch.commit(), 'Создание')
    const imgs = [e.imageId, e.headerImageId, ...imageIdsInHtml(readable)].filter(Boolean) as string[]
    if (imgs.length) void ensureImageAccess(access.value, imgs, e)
    return e.id
  }

  function bodyDoc(e: Entity, html: string, rev: number) {
    return { html, rev, visibility: e.visibility, allowedUids: e.allowedUids ?? [], createdBy: e.createdBy, updatedAt: now(), updatedBy: uid.value }
  }

  async function updateEntity(id: string, patch: Partial<Entity>) {
    const prev = entities.value.get(id)
    if (!prev) return
    const next = normalizeEntity({ ...prev, ...patch, updatedAt: now(), updatedBy: uid.value })
    entities.value = new Map(entities.value).set(id, next)
    const batch = writeBatch(db)
    batch.update(docRef(wid.value!, 'entities', id), clean({ ...patch, updatedAt: next.updatedAt, updatedBy: next.updatedBy }))
    const visChanged = 'visibility' in patch || 'allowedUids' in patch
    if (visChanged) {
      batch.set(docRef(wid.value!, 'bodies', id), { visibility: next.visibility, allowedUids: next.allowedUids, createdBy: next.createdBy }, { merge: true })
      if (narrows(prev, next)) batch.update(doc(db, 'worlds', wid.value!), { aclVersion: increment(1) })
    }
    await track(batch.commit())
    if (visChanged || 'imageId' in patch || 'headerImageId' in patch || 'fields' in patch) void widenEntityImages(next, visChanged && !narrows(prev, next))
  }

  /**
   * Images shown with the entity (avatar, cover, map base image and — when the entity became more visible —
   * the images inside its readable text) must be at least as visible as the entity.
   */
  async function widenEntityImages(e: Entity, includeText: boolean) {
    const imgs = [e.imageId, e.headerImageId, e.fields?.mapImageId].filter((x) => typeof x === 'string' && x) as string[]
    if (includeText && e.bodyRev) {
      const html = await loadText(e.id).catch(() => '')
      imgs.push(...imageIdsInHtml(stripSecrets(html)))
    }
    if (imgs.length) await ensureImageAccess(access.value, imgs, e)
  }

  /** Same patch logic as updateEntity for many entities at once (batched). Returns the number updated. */
  async function bulkUpdateEntities(ids: string[], patchFor: (e: Entity) => Partial<Entity> | null, onProgress: (done: number, total: number) => void = () => {}) {
    const w = wid.value!
    const todo = ids.map((id) => entities.value.get(id)).filter(Boolean) as Entity[]
    let done = 0, narrowed = false
    const widened: Entity[] = []
    for (let i = 0; i < todo.length; i += 200) {
      const batch = writeBatch(db)
      const m = new Map(entities.value)
      let n = 0
      for (const prev of todo.slice(i, i + 200)) {
        const patch = patchFor(prev)
        if (!patch) continue
        const next = normalizeEntity({ ...prev, ...patch, updatedAt: now(), updatedBy: uid.value })
        m.set(prev.id, next)
        batch.update(docRef(w, 'entities', prev.id), clean({ ...patch, updatedAt: next.updatedAt, updatedBy: next.updatedBy }))
        if ('visibility' in patch || 'allowedUids' in patch) {
          batch.set(docRef(w, 'bodies', prev.id), { visibility: next.visibility, allowedUids: next.allowedUids, createdBy: next.createdBy }, { merge: true })
          if (narrows(prev, next)) narrowed = true
          else widened.push(next)
        }
        n++
      }
      if (n) { entities.value = m; await track(batch.commit()) }
      done += Math.min(200, todo.length - i)
      onProgress(done, todo.length)
    }
    if (narrowed) await bumpAcl()
    for (const e of widened) await widenEntityImages(e, true)
    return todo.length
  }

  /**
   * Changes visibility `from` → `to` on every record of the world (articles, texts, posts, relations, map marks,
   * timelines, images…). Used to publish a world to guests ("members" → "public") or hide it again.
   */
  async function setWorldVisibility(from: Visibility, to: Visibility, onProgress: (done: number, name: string) => void = () => {}) {
    const w = wid.value!
    const names = ['entities', 'bodies', 'posts', 'relations', 'orgMembers', 'inventory', 'entityAbilities', 'questElements', 'reminders',
      'timelineEras', 'timelineElements', 'mapLayers', 'mapGroups', 'mapMarkers', 'messages', 'images', 'imageChunks', 'bookmarks']
    let done = 0
    for (const name of names) {
      const snap = await getDocs(query(coll(w, name), where('visibility', '==', from)))
      for (let i = 0; i < snap.docs.length; i += 450) {
        const batch = writeBatch(db)
        const t = now()
        snap.docs.slice(i, i + 450).forEach((d) => batch.update(d.ref, name === 'imageChunks' ? { visibility: to } : { visibility: to, updatedAt: t }))
        await track(batch.commit())
        done += Math.min(450, snap.docs.length - i)
        onProgress(done, name)
      }
    }
    if (narrows({ visibility: from, allowedUids: [], createdBy: '' }, { visibility: to, allowedUids: [], createdBy: '' })) await bumpAcl()
    return done
  }

  async function deleteEntity(id: string) {
    await updateEntity(id, { deleted: true, deletedAt: now() })
  }
  async function restoreEntity(id: string) {
    await updateEntity(id, { deleted: false, deletedAt: null })
  }
  /** Permanent removal: the entity, its texts and every row hanging off it. */
  async function purgeEntity(id: string) {
    const w = wid.value!
    const refs = [docRef(w, 'entities', id), docRef(w, 'bodies', id), docRef(w, 'secrets', id)]
    const childQueries: Array<[string, string]> = [
      ['posts', 'entityId'], ['orgMembers', 'organisationId'], ['orgMembers', 'characterId'], ['inventory', 'ownerId'],
      ['entityAbilities', 'entityId'], ['questElements', 'questId'], ['reminders', 'entityId'], ['reminders', 'calendarId'],
      ['timelineEras', 'timelineId'], ['timelineElements', 'timelineId'], ['mapLayers', 'mapId'], ['mapGroups', 'mapId'],
      ['mapMarkers', 'mapId'], ['messages', 'conversationId'], ['relations', 'sourceId'], ['relations', 'targetId'], ['revisions', 'entityId'],
    ]
    const found = await Promise.all(childQueries.map(([c, f]) => getDocs(query(coll(w, c), where(f, '==', id))).then((s) => s.docs.map((d) => d.ref)).catch(() => [])))
    const all = [...refs, ...found.flat()]
    for (let i = 0; i < all.length; i += 450) {
      const b = writeBatch(db)
      all.slice(i, i + 450).forEach((r) => b.delete(r))
      await track(b.commit(), 'Удаление')
    }
    const m = new Map(entities.value); m.delete(id); entities.value = m
    void cache.deleteDocs(w, 'entities', [id])
  }

  // ---------- article text ----------
  async function loadText(id: string): Promise<string> {
    const e = entities.value.get(id)
    if (!e) return ''
    const wantSecret = isMaster.value && e.hasSecrets
    // No text was ever saved (bodyRev 0): there may be no bodies doc at all (e.g. imported articles without
    // text), and reading a missing doc is denied to players by the rules — so don't read.
    if (!e.bodyRev && !wantSecret) return ''
    const cached = await cache.getBody(wid.value!, id)
    if (cached && cached.rev === e.bodyRev && cached.secret === wantSecret && (!wantSecret || secretsState.value[id])) return cached.html
    let html = ''
    if (wantSecret) {
      const s = await getDoc(docRef(wid.value!, 'secrets', id))
      const d = (s.data() ?? {}) as Partial<Secrets>
      html = d.html ?? ''
      secretsState.value = { ...secretsState.value, [id]: { attributes: d.attributes ?? [], gmNotes: d.gmNotes ?? '' } }
    } else {
      const s = await getDoc(docRef(wid.value!, 'bodies', id))
      html = (s.data()?.html as string) ?? ''
    }
    void cache.putBody(wid.value!, id, { rev: e.bodyRev, html, text: htmlToText(html), secret: wantSecret })
    return html
  }

  const lastRevision = new Map<string, number>()

  /** Autosave target for the main article text. */
  async function saveText(id: string, fullHtml: string, opts: { forceRevision?: boolean } = {}) {
    const e = entities.value.get(id)
    if (!e) return
    const w = wid.value!
    const readable = stripSecrets(fullHtml)
    const priv = secretsState.value[id]
    const needSecrets = isMaster.value && (hasSecretBlocks(fullHtml) || !!priv?.attributes.length || !!priv?.gmNotes)
    const rev = (e.bodyRev ?? 0) + 1
    const batch = writeBatch(db)
    batch.set(docRef(w, 'bodies', id), bodyDoc(e, readable, rev))
    if (needSecrets) {
      batch.set(docRef(w, 'secrets', id), { html: fullHtml, attributes: priv?.attributes ?? [], gmNotes: priv?.gmNotes ?? '', rev, updatedAt: now(), updatedBy: uid.value })
    } else if (e.hasSecrets && isMaster.value) {
      batch.delete(docRef(w, 'secrets', id))
    }
    const patch: Partial<Entity> = { bodyRev: rev, excerpt: excerptOf(readable), mentions: mentionIds(readable), hasSecrets: needSecrets, updatedAt: now(), updatedBy: uid.value! }
    batch.update(docRef(w, 'entities', id), patch)
    const t = now()
    if (opts.forceRevision || t - (lastRevision.get(id) ?? 0) > 10 * 60 * 1000) {
      lastRevision.set(id, t)
      const rid = randomId()
      batch.set(docRef(w, 'revisions', rid), { id: rid, entityId: id, postId: null, name: e.name, html: fullHtml, createdAt: t, createdBy: uid.value!, createdByName: session.displayName() } satisfies Revision)
    }
    entities.value = new Map(entities.value).set(id, { ...e, ...patch })
    void cache.putBody(w, id, { rev, html: needSecrets ? fullHtml : readable, text: htmlToText(fullHtml), secret: needSecrets })
    await track(batch.commit())
    const imgs = imageIdsInHtml(readable)
    if (imgs.length) void ensureImageAccess(access.value, imgs, e)
  }

  /** Private attributes / GM notes (master only). Needs the current full text to keep secrets consistent. */
  async function saveSecretsMeta(id: string, patch: { attributes?: Attribute[]; gmNotes?: string }) {
    const e = entities.value.get(id)
    if (!e || !isMaster.value) return
    const cur = secretsState.value[id] ?? { attributes: [], gmNotes: '' }
    const next = { ...cur, ...patch }
    secretsState.value = { ...secretsState.value, [id]: next }
    const html = await loadText(id)
    await saveText(id, html)
  }

  // ---------- child rows (posts, inventory, map markers, …) ----------
  function watchRows<T extends { id: string }>(name: string, field: string, value: string, cb: (rows: T[]) => void, sortKey: keyof T | null = 'order' as keyof T): Unsubscribe {
    const a = access.value
    const view = preview.value ? viewAccess.value : null
    const pub = !!world.value?.isPublic
    const qs = visibleQueries(a, name, [where(field, '==', value)])
    const parts: Array<Map<string, T>> = qs.map(() => new Map())
    const emit = () => {
      const merged = new Map<string, T>()
      for (const p of parts) for (const [k, v] of p) merged.set(k, v)
      let rows = [...merged.values()].filter((r: any) => !r.deleted && (!view || canSee(view, r, pub)))
      if (sortKey) rows = rows.sort((x: any, y: any) => (x[sortKey] ?? 0) - (y[sortKey] ?? 0) || String(x.name ?? '').localeCompare(String(y.name ?? '')))
      cb(rows)
    }
    const us = qs.map((q, i) => onSnapshot(q, (s) => {
      const m = new Map<string, T>()
      s.docs.forEach((d) => m.set(d.id, { ...(d.data() as T), id: d.id }))
      parts[i] = m
      emit()
    }, (e) => console.warn('watchRows', name, e)))
    return () => us.forEach((u) => u())
  }

  async function fetchRows<T extends { id: string }>(name: string, field: string, value: string): Promise<T[]> {
    const qs = visibleQueries(access.value, name, [where(field, '==', value)])
    const res = await Promise.all(qs.map((q) => getDocs(q).catch(() => null)))
    const m = new Map<string, T>()
    for (const r of res) r?.docs.forEach((d) => m.set(d.id, { ...(d.data() as T), id: d.id }))
    return [...m.values()]
  }

  async function saveRow<T extends Record<string, any>>(name: string, data: T & { id?: string }, visDefaults?: { visibility: Visibility; allowedUids: string[] }): Promise<string> {
    const id = data.id || randomId()
    const t = now()
    const isNew = !data.id
    const row: Record<string, any> = { ...data, id, updatedAt: t, updatedBy: uid.value }
    if (isNew) {
      row.createdAt = t
      row.createdBy = uid.value
      row.visibility = data.visibility ?? visDefaults?.visibility ?? defaultVisibility()
      row.allowedUids = data.allowedUids ?? visDefaults?.allowedUids ?? []
    }
    await track(setDoc(docRef(wid.value!, name, id), clean(row), { merge: true }))
    if (typeof row.html === 'string') {
      const imgs = imageIdsInHtml(row.html)
      if (imgs.length) void ensureImageAccess(access.value, imgs, { visibility: row.visibility ?? 'members', allowedUids: row.allowedUids ?? [] })
    }
    return id
  }
  async function deleteRow(name: string, id: string) {
    await track(deleteDoc(docRef(wid.value!, name, id)), 'Удаление')
  }

  // ---------- relations (synced) ----------
  async function saveRelation(r: Partial<Relation> & { sourceId: string; targetId: string }) {
    const prev = r.id ? relations.value.get(r.id) : undefined
    const id = r.id || randomId()
    const base: Relation = prev ?? {
      id, sourceId: r.sourceId, targetId: r.targetId, label: '', reverseLabel: '', kind: 'generic', attitude: 0, colour: '', isPinned: false,
      visibility: defaultVisibility(), allowedUids: [], deleted: false, ...stamp(),
    }
    const next: Relation = { ...base, ...r, id, updatedAt: now(), updatedBy: uid.value! }
    relations.value = new Map(relations.value).set(id, next)
    const batch = writeBatch(db)
    batch.set(docRef(wid.value!, 'relations', id), clean(next))
    if (prev && narrows(prev, next)) batch.update(doc(db, 'worlds', wid.value!), { aclVersion: increment(1) })
    await track(batch.commit())
    return id
  }
  async function deleteRelation(id: string) {
    const prev = relations.value.get(id)
    if (!prev) return
    await saveRelation({ ...prev, deleted: true })
  }
  function relationsOf(id: string) {
    return visibleRelations.value.filter((r) => r.sourceId === id || r.targetId === id)
  }

  // ---------- revisions ----------
  async function revisionsOf(entityId: string): Promise<Revision[]> {
    const qs = isMaster.value
      ? [query(coll(wid.value!, 'revisions'), where('entityId', '==', entityId), orderBy('createdAt', 'desc'), qlimit(80))]
      : [query(coll(wid.value!, 'revisions'), where('entityId', '==', entityId), where('createdBy', '==', uid.value), orderBy('createdAt', 'desc'), qlimit(80))]
    const s = await getDocs(qs[0])
    return s.docs.map((d) => d.data() as Revision)
  }

  // ---------- world / members / invites ----------
  async function updateWorld(patch: Partial<World>) {
    if (!world.value) return
    world.value = { ...world.value, ...patch }
    if (patch.settings) setCustomTypes(settings.value.customTypes)
    await track(updateDoc(doc(db, 'worlds', wid.value!), clean({ ...patch, updatedAt: now() })))
  }
  async function updateSettings(patch: Partial<WorldSettings>) {
    await updateWorld({ settings: { ...settings.value, ...patch } })
  }
  async function bumpAcl() {
    await updateDoc(doc(db, 'worlds', wid.value!), { aclVersion: increment(1) })
  }

  async function createInvite(roleName: Exclude<Role, 'owner'>, days: number | null, note: string) {
    const code = randomId(12)
    const inv: Invite = { code, role: roleName, createdBy: uid.value!, createdAt: now(), expiresAt: days ? now() + days * 86400000 : null, note, worldName: world.value?.name ?? '' }
    await track(setDoc(docRef(wid.value!, 'invites', code), inv))
    return code
  }
  function watchInvites(cb: (rows: Invite[]) => void) {
    return onSnapshot(coll(wid.value!, 'invites'), (s) => cb(s.docs.map((d) => d.data() as Invite)), () => cb([]))
  }
  async function deleteInvite(code: string) {
    await track(deleteDoc(docRef(wid.value!, 'invites', code)))
  }
  async function setMemberRole(memberUid: string, r: Role) {
    await track(updateDoc(docRef(wid.value!, 'members', memberUid), { role: r }))
    if (r === 'player') await bumpAcl()
  }
  async function removeMember(memberUid: string) {
    await track(deleteDoc(docRef(wid.value!, 'members', memberUid)))
    await bumpAcl()
  }
  /** Masters: non-role fields of a member (player character, extra create rights). */
  async function updateMember(memberUid: string, patch: Partial<Member>) {
    await track(updateDoc(docRef(wid.value!, 'members', memberUid), clean(patch)))
  }
  /** Removes a member and blocks re-joining through invite links. */
  async function banMember(m: Member) {
    const b: Ban = { uid: m.uid, displayName: m.displayName, email: m.email, at: now(), by: uid.value! }
    const batch = writeBatch(db)
    batch.set(docRef(wid.value!, 'bans', m.uid), b)
    batch.delete(docRef(wid.value!, 'members', m.uid))
    await track(batch.commit())
    await bumpAcl()
  }
  async function unban(banUid: string) {
    await track(deleteDoc(docRef(wid.value!, 'bans', banUid)))
  }
  function watchBans(cb: (rows: Ban[]) => void) {
    return onSnapshot(coll(wid.value!, 'bans'), (s) => cb(s.docs.map((d) => d.data() as Ban)), () => cb([]))
  }
  /** Owner hands the world over to another member and becomes a master. */
  async function transferOwnership(toUid: string) {
    const batch = writeBatch(db)
    batch.update(doc(db, 'worlds', wid.value!), { ownerId: toUid, updatedAt: now() })
    batch.update(docRef(wid.value!, 'members', toUid), { role: 'owner' })
    batch.update(docRef(wid.value!, 'members', uid.value!), { role: 'master' })
    await track(batch.commit(), 'Передача владения')
  }
  async function leaveWorld() {
    await track(deleteDoc(docRef(wid.value!, 'members', uid.value!)), 'Выход из мира')
  }
  /** Owner: deletes every document of the world (content, images, members), then the world itself. */
  async function deleteWorld(onProgress: (done: number, what: string) => void = () => {}) {
    const w = wid.value!
    const me = uid.value!
    const names = ['entities', 'bodies', 'secrets', 'posts', 'relations', 'orgMembers', 'inventory', 'entityAbilities', 'questElements', 'reminders',
      'timelineEras', 'timelineElements', 'mapLayers', 'mapGroups', 'mapMarkers', 'messages', 'images', 'imageChunks', 'revisions', 'bookmarks',
      'invites', 'bans', 'members']
    let done = 0
    for (const name of names) {
      const snap = await getDocs(coll(w, name))
      const refs = snap.docs.filter((d) => !(name === 'members' && d.id === me)).map((d) => d.ref)
      for (let i = 0; i < refs.length; i += 450) {
        const b = writeBatch(db)
        refs.slice(i, i + 450).forEach((r) => b.delete(r))
        await b.commit()
        done += Math.min(450, refs.length - i)
        onProgress(done, name)
      }
    }
    await deleteDoc(doc(db, 'worlds', w))
    await deleteDoc(docRef(w, 'members', me))
    void cache.clearWorld(w)
  }
  /** Remembers when the member last opened the world (one write per few hours per device). */
  async function touchLastSeen() {
    if (!member.value || !wid.value) return
    const key = `dw.seen.${wid.value}.${uid.value}`
    try {
      const last = Number(localStorage.getItem(key) ?? 0)
      if (Date.now() - last < 6 * 3600 * 1000) return
      localStorage.setItem(key, String(Date.now()))
    } catch { /* private mode: still update */ }
    await updateDoc(docRef(wid.value, 'members', uid.value!), { lastSeenAt: now() }).catch(() => {})
  }
  function startPreview(target: { uid: string | null; name: string; guest?: boolean }) {
    if (!realMaster.value) return
    preview.value = target
  }
  function stopPreview() { preview.value = null }
  async function updateMyMember(patch: Partial<Member>) {
    await track(updateDoc(docRef(wid.value!, 'members', uid.value!), clean(patch)))
  }
  function memberName(u: string) {
    return members.value.find((m) => m.uid === u)?.displayName ?? 'участник'
  }
  const players = computed(() => members.value.filter((m) => m.role === 'player'))

  // ---------- join requests (masters see them live: sidebar badge, admin list) ----------
  const joinRequests = ref<JoinRequest[]>([])
  let stopRequests: Unsubscribe | null = null
  watch(() => [wid.value, realMaster.value, status.value] as const, ([w, m, st]) => {
    stopRequests?.()
    stopRequests = null
    joinRequests.value = []
    if (w && m && st === 'ready') stopRequests = watchWorldRequests(w, (rows) => (joinRequests.value = rows))
  })
  const pendingRequestCount = computed(() => joinRequests.value.filter((r) => r.status === 'pending').length)

  function toggleFavorite(id: string) {
    const fav = new Set(member.value?.favorites ?? [])
    if (fav.has(id)) fav.delete(id); else fav.add(id)
    void updateMyMember({ favorites: [...fav] })
  }

  return {
    wid, world, member, members, players, entities, relations, status, errorText, pendingWrites, lastSavedAt, secretsState,
    uid, role, isMaster, isOwner, isMember, access, settings, preview, realMaster, viewAccess, viewMember, startPreview, stopPreview, list, trash, byType, children, tags, recent, visibleRelations, backlinks, enabledTypes,
    get, getAny, canEdit, canCreate, open, close, restartSync,
    createEntity, updateEntity, deleteEntity, restoreEntity, purgeEntity, newEntityData, bulkUpdateEntities, setWorldVisibility,
    loadText, saveText, saveSecretsMeta,
    watchRows, fetchRows, saveRow, deleteRow,
    saveRelation, deleteRelation, relationsOf, revisionsOf,
    updateWorld, updateSettings, bumpAcl, createInvite, watchInvites, deleteInvite, setMemberRole, removeMember, updateMyMember, memberName, toggleFavorite,
    updateMember, banMember, unban, watchBans, transferOwnership, leaveWorld, deleteWorld, joinRequests, pendingRequestCount,
    typeDef,
  }
})

// ---------- functions that do not need an open world ----------

export type MyWorld = World & { role: Role; membership: Member }

export async function myWorlds(uid: string): Promise<MyWorld[]> {
  const s = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)))
  const out: MyWorld[] = []
  await Promise.all(s.docs.map(async (m) => {
    const wref = m.ref.parent.parent
    if (!wref) return
    const w = await getDoc(wref).catch(() => null)
    const mem = m.data() as Member
    if (w?.exists()) out.push({ ...(w.data() as World), id: w.id, role: mem.role, membership: mem })
  }))
  return out.sort((a, b) => (b.membership.lastSeenAt ?? b.updatedAt) - (a.membership.lastSeenAt ?? a.updatedAt))
}

/** Leave a world from outside of it (personal cabinet). Owners cannot leave. */
export async function leaveWorldById(wid: string, uid: string) {
  await deleteDoc(doc(db, 'worlds', wid, 'members', uid))
}

export async function createWorld(user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null }, name: string, description: string, isPublic: boolean): Promise<string> {
  const ref = doc(collection(db, 'worlds'))
  const t = now()
  const w: Omit<World, 'id'> = { name, description, ownerId: user.uid, isPublic, imageId: null, headerImageId: null, aclVersion: 0, settings: DEFAULT_SETTINGS, createdAt: t, updatedAt: t }
  const m: Member = { uid: user.uid, role: 'owner', displayName: user.displayName || user.email || 'Мастер', email: user.email ?? '', photoURL: user.photoURL ?? null, joinedAt: t, favorites: [] }
  const batch = writeBatch(db)
  batch.set(ref, w)
  batch.set(doc(db, 'worlds', ref.id, 'members', user.uid), m)
  await batch.commit()
  return ref.id
}

export async function readInvite(wid: string, code: string): Promise<{ invite: Invite | null; worldName: string | null }> {
  const s = await getDoc(doc(db, 'worlds', wid, 'invites', code)).catch(() => null)
  const invite = s?.exists() ? (s.data() as Invite) : null
  return { invite, worldName: invite?.worldName ?? null }
}

export async function acceptInvite(wid: string, code: string, user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null }) {
  const { invite } = await readInvite(wid, code)
  if (!invite) throw new Error('Приглашение не найдено или отозвано')
  if (invite.expiresAt && invite.expiresAt < now()) throw new Error('Срок приглашения истёк')
  const existing = await getDoc(doc(db, 'worlds', wid, 'members', user.uid))
  if (existing.exists()) return
  const m: Member = { uid: user.uid, role: invite.role, inviteCode: code, displayName: user.displayName || user.email || 'Игрок', email: user.email ?? '', photoURL: user.photoURL ?? null, joinedAt: now(), favorites: [] }
  try {
    await setDoc(doc(db, 'worlds', wid, 'members', user.uid), m)
  } catch (e: any) {
    if (e?.code === 'permission-denied') throw new Error('Не удалось вступить: приглашение недействительно или вход в этот мир для вас закрыт мастером')
    throw e
  }
}
