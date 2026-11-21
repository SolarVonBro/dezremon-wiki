import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import {
  collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, increment, onSnapshot, orderBy, query, setDoc, updateDoc,
  where, writeBatch, limit as qlimit, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useSession } from './session'
import { cache } from '@/data/cache'
import { syncCollection, type SyncHandle } from '@/data/sync'
import { canSee, coll, docRef, isMasterRole, narrows, visibleQueries, type Access } from '@/data/access'
import { ensureImageAccess, imageIdsInHtml } from '@/data/images'
import { hasSecretBlocks, mentionIds, stripSecrets } from '@/data/html'
import { clean, excerptOf, htmlToText, now, randomId, sortByName } from '@/data/util'
import { setCustomTypes, typeDef } from '@/model/entityTypes'
import type {
  Attribute, Entity, Invite, Member, Relation, Revision, Role, Secrets, Visibility, World, WorldSettings,
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
  const isMaster = computed(() => isMasterRole(role.value))
  const isOwner = computed(() => role.value === 'owner')
  const isMember = computed(() => !!role.value)
  const access = computed<Access>(() => ({ wid: wid.value ?? '', uid: uid.value, role: role.value }))
  const settings = computed<WorldSettings>(() => ({ ...DEFAULT_SETTINGS, ...(world.value?.settings ?? {}) }))

  // ---------- derived views ----------
  const list = computed(() => {
    const a = access.value
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
    const a = access.value
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
    return canSee(access.value, e, !!world.value?.isPublic) ? e : undefined
  }
  function getAny(id: string) { return entities.value.get(id) }

  function canEdit(e: Entity | undefined | null): boolean {
    if (!e || !uid.value || !role.value) return false
    if (isMaster.value) return true
    if (e.hasSecrets) return false
    return e.createdBy === uid.value || (e.editorUids ?? []).includes(uid.value)
  }
  function canCreate(type: string): boolean {
    if (isMaster.value) return true
    return !!role.value && settings.value.playerCreateTypes.includes(type)
  }

  // ---------- open / close ----------
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
    status.value = 'idle'
    wid.value = null
  }

  async function open(id: string) {
    if (wid.value === id && (status.value === 'ready' || status.value === 'loading')) return
    close()
    const token = ++openToken
    wid.value = id
    status.value = 'loading'
    await session.whenReady
    try {
      const u = session.user
      const [ws, ms] = await Promise.all([
        getDoc(doc(db, 'worlds', id)),
        u ? getDoc(doc(db, 'worlds', id, 'members', u.uid)) : Promise.resolve(null),
      ])
      if (token !== openToken) return
      if (!ws.exists()) { status.value = 'denied'; return }
      world.value = { ...(ws.data() as World), id }
      member.value = ms?.exists() ? (ms.data() as Member) : null
      setCustomTypes(settings.value.customTypes)
      if (!member.value && !world.value.isPublic) { status.value = 'denied'; return }
      startLive(id, token)
      await startSync(token)
      if (token !== openToken) return
      status.value = 'ready'
    } catch (e: any) {
      if (token !== openToken) return
      console.error(e)
      status.value = e?.code === 'permission-denied' ? 'denied' : 'error'
      errorText.value = e?.message ?? String(e)
    }
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
    const onErr = (e: unknown) => { console.error('sync error', e); toast.error('Ошибка синхронизации: ' + ((e as any)?.message ?? e)) }
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
    // Images shown with the entity (avatar, cover, map base image) must be at least as visible as the entity.
    const imgs = [next.imageId, next.headerImageId, next.fields?.mapImageId].filter((x) => typeof x === 'string' && x) as string[]
    if (imgs.length && (visChanged || 'imageId' in patch || 'headerImageId' in patch || 'fields' in patch)) void ensureImageAccess(access.value, imgs, next)
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
    const qs = visibleQueries(a, name, [where(field, '==', value)])
    const parts: Array<Map<string, T>> = qs.map(() => new Map())
    const emit = () => {
      const merged = new Map<string, T>()
      for (const p of parts) for (const [k, v] of p) merged.set(k, v)
      let rows = [...merged.values()].filter((r: any) => !r.deleted)
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
  async function updateMyMember(patch: Partial<Member>) {
    await track(updateDoc(docRef(wid.value!, 'members', uid.value!), clean(patch)))
  }
  function memberName(u: string) {
    return members.value.find((m) => m.uid === u)?.displayName ?? 'участник'
  }
  const players = computed(() => members.value.filter((m) => m.role === 'player'))

  function toggleFavorite(id: string) {
    const fav = new Set(member.value?.favorites ?? [])
    if (fav.has(id)) fav.delete(id); else fav.add(id)
    void updateMyMember({ favorites: [...fav] })
  }

  return {
    wid, world, member, members, players, entities, relations, status, errorText, pendingWrites, lastSavedAt, secretsState,
    uid, role, isMaster, isOwner, isMember, access, settings, list, trash, byType, children, tags, recent, visibleRelations, backlinks, enabledTypes,
    get, getAny, canEdit, canCreate, open, close, restartSync,
    createEntity, updateEntity, deleteEntity, restoreEntity, purgeEntity, newEntityData,
    loadText, saveText, saveSecretsMeta,
    watchRows, fetchRows, saveRow, deleteRow,
    saveRelation, deleteRelation, relationsOf, revisionsOf,
    updateWorld, updateSettings, bumpAcl, createInvite, watchInvites, deleteInvite, setMemberRole, removeMember, updateMyMember, memberName, toggleFavorite,
    typeDef,
  }
})

// ---------- functions that do not need an open world ----------

export async function myWorlds(uid: string): Promise<Array<World & { role: Role }>> {
  const s = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)))
  const out: Array<World & { role: Role }> = []
  await Promise.all(s.docs.map(async (m) => {
    const wref = m.ref.parent.parent
    if (!wref) return
    const w = await getDoc(wref).catch(() => null)
    if (w?.exists()) out.push({ ...(w.data() as World), id: w.id, role: (m.data() as Member).role })
  }))
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
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
  await setDoc(doc(db, 'worlds', wid, 'members', user.uid), m)
}
