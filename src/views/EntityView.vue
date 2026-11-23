<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { cache } from '@/data/cache'
import { useAutosave } from '@/composables/useAutosave'
import { relativeTime } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import RichView from '@/components/viewer/RichView.vue'
import type { Heading } from '@/components/viewer/types'
import EntityHero from '@/components/entity/EntityHero.vue'
import FactsPanel from '@/components/entity/FactsPanel.vue'
import CharacterPlayerPanel from '@/components/entity/CharacterPlayerPanel.vue'
import PostsList from '@/components/entity/PostsList.vue'
import ChildrenPanel from '@/components/entity/ChildrenPanel.vue'
import BacklinksPanel from '@/components/entity/BacklinksPanel.vue'
import PinnedAttributes from '@/components/entity/PinnedAttributes.vue'
import GmNotesPanel from '@/components/entity/GmNotesPanel.vue'
import { toast } from '@/components/common/toast'

const AttributesPanel = defineAsyncComponent(() => import('@/components/entity/AttributesPanel.vue'))
const RelationsPanel = defineAsyncComponent(() => import('@/components/entity/RelationsPanel.vue'))
const InventoryPanel = defineAsyncComponent(() => import('@/components/entity/InventoryPanel.vue'))
const AbilitiesPanel = defineAsyncComponent(() => import('@/components/entity/AbilitiesPanel.vue'))
const HistoryPanel = defineAsyncComponent(() => import('@/components/entity/HistoryPanel.vue'))
const LinksPanel = defineAsyncComponent(() => import('@/components/entity/LinksPanel.vue'))
const OrgMembers = defineAsyncComponent(() => import('@/components/entity/OrgMembers.vue'))
const QuestElements = defineAsyncComponent(() => import('@/components/entity/QuestElements.vue'))
const ConversationView = defineAsyncComponent(() => import('@/components/entity/ConversationView.vue'))
const DiceRoller = defineAsyncComponent(() => import('@/components/entity/DiceRoller.vue'))
const TaggedList = defineAsyncComponent(() => import('@/components/entity/TaggedList.vue'))
const MapViewer = defineAsyncComponent(() => import('@/components/modules/MapViewer.vue'))
const CalendarViewer = defineAsyncComponent(() => import('@/components/modules/CalendarViewer.vue'))
const RemindersPanel = defineAsyncComponent(() => import('@/components/modules/RemindersPanel.vue'))
const TimelineViewer = defineAsyncComponent(() => import('@/components/modules/TimelineViewer.vue'))
const FamilyTree = defineAsyncComponent(() => import('@/components/modules/FamilyTree.vue'))

const route = useRoute()
const router = useRouter()
const world = useWorld()

// The layout re-mounts this view for every article (keyed by eid), so the id is fixed for the
// lifetime of the instance. It must NOT follow the route: the final autosave runs on unmount,
// after the route already points at the next article.
const fixedEid = route.params.eid as string
const eid = computed(() => fixedEid)
const entity = computed(() => world.get(eid.value))
const raw = computed(() => world.getAny(eid.value))
const def = computed(() => typeDef(entity.value?.type ?? 'note'))
const canEdit = computed(() => world.canEdit(entity.value))
const editing = computed(() => route.query.edit === '1' && canEdit.value)

// ---------- tabs ----------
type TabKey = 'story' | 'feature' | 'relations' | 'attributes' | 'inventory' | 'abilities' | 'dates' | 'links' | 'history'
const FEATURE_LABEL: Record<string, { label: string; icon: string }> = {
  map: { label: 'Карта', icon: 'map' }, calendar: { label: 'Календарь', icon: 'calendar-days' }, timeline: { label: 'Хронология', icon: 'history' },
  familyTree: { label: 'Родословная', icon: 'git-branch' }, members: { label: 'Участники', icon: 'users' }, quest: { label: 'Элементы квеста', icon: 'scroll' },
  conversation: { label: 'Разговор', icon: 'messages-square' }, dice: { label: 'Броски', icon: 'dices' }, tagged: { label: 'Статьи с тегом', icon: 'tag' },
}
const feature = computed(() => def.value.features.find((f) => f !== 'templateAttrs') ?? null)
const tab = computed<TabKey>(() => (route.query.tab as TabKey) || (feature.value && ['map', 'calendar', 'timeline'].includes(feature.value) ? 'feature' : 'story'))
function setTab(t: TabKey) { void router.replace({ query: { ...route.query, tab: t === 'story' ? undefined : t } }) }
const relCount = computed(() => (entity.value ? world.relationsOf(entity.value.id).length : 0))
const attrCount = computed(() => entity.value?.attributes.filter((a) => a.kind !== 'section').length ?? 0)

// ---------- article text ----------
const html = ref('')
const loadedFor = ref<string | null>(null)
const loadingText = ref(false)
const headings = ref<Heading[]>([])
const editorRef = ref<RichEditorInstance | null>(null)
const draftOffer = ref<string | null>(null)
let lastSavedHtml = ''
/** Set after an image upload: save even if the text is unchanged so the image becomes visible to readers. */
let forceSave = false
let expectedRev = -1

async function loadText(force = false) {
  const e = raw.value
  if (!e) return
  if (!force && loadedFor.value === `${e.id}:${e.bodyRev}:${world.isMaster}`) return
  loadingText.value = true
  try {
    html.value = await world.loadText(e.id)
    lastSavedHtml = html.value
    expectedRev = e.bodyRev
    loadedFor.value = `${e.id}:${e.bodyRev}:${world.isMaster}`
  } catch (err: any) {
    toast.error('Не удалось загрузить текст: ' + (err?.message ?? err))
  } finally { loadingText.value = false }
}

const draftKey = computed(() => `${world.wid}/${eid.value}`)
const autosave = useAutosave(async () => {
  const ed = editorRef.value
  const e = raw.value
  if (!ed || !e) return
  if (ed.pendingUploads > 0) return false
  const next = ed.getHTML()
  if (next === lastSavedHtml && !forceSave) return
  forceSave = false
  expectedRev = (e.bodyRev ?? 0) + 1
  await world.saveText(e.id, next)
  lastSavedHtml = next
  loadedFor.value = `${e.id}:${expectedRev}:${world.isMaster}`
  void cache.deleteDraft(draftKey.value)
})

let draftTimer: ReturnType<typeof setTimeout> | null = null
function onDirty() {
  autosave.touch()
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => { const h = editorRef.value?.getHTML(); if (h) void cache.putDraft(draftKey.value, h) }, 500)
}

watch(() => [raw.value?.id, raw.value?.bodyRev], async (_n, old) => {
  const e = raw.value
  if (!e) return
  // Someone else saved while we are editing: do not clobber, tell the user.
  if (editing.value && old && old[0] === e.id && e.bodyRev !== expectedRev && e.updatedBy !== world.uid) {
    toast.info('Статью только что изменил другой участник. Ваши правки сохранятся поверх; чтобы увидеть чужие — выйдите из редактирования.')
    return
  }
  if (!editing.value) await loadText()
}, { immediate: true })

watch(editing, async (on) => {
  if (on) {
    await loadText(true)
    const d = await cache.getDraft(draftKey.value)
    if (d && d.html !== html.value && d.at > (raw.value?.updatedAt ?? 0) - 1000) draftOffer.value = d.html
  } else {
    await autosave.flush()
    html.value = lastSavedHtml
    draftOffer.value = null
  }
}, { immediate: true })

function restoreDraft() {
  if (!draftOffer.value) return
  editorRef.value?.setHTML(draftOffer.value)
  html.value = draftOffer.value
  draftOffer.value = null
  autosave.touch()
}
function dropDraft() { draftOffer.value = null; void cache.deleteDraft(draftKey.value) }

function scrollToHeading(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }
function toggleEdit() {
  void router.replace({ query: { ...route.query, edit: editing.value ? undefined : '1', tab: editing.value ? route.query.tab : undefined } })
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'e' && !e.ctrlKey && !e.metaKey && canEdit.value && !editing.value) { e.preventDefault(); toggleEdit() }
}
document.addEventListener('keydown', onKey)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

const parents = computed(() => {
  const out = []
  let p = entity.value?.parentId ? world.get(entity.value.parentId) : undefined
  const seen = new Set<string>()
  while (p && !seen.has(p.id) && out.length < 6) { seen.add(p.id); out.unshift(p); p = p.parentId ? world.get(p.parentId) : undefined }
  return out
})
const uploadVis = computed(() => ({ visibility: entity.value?.visibility ?? 'members', allowedUids: entity.value?.allowedUids ?? [] }))
watch(() => entity.value?.name, (n) => { if (n) document.title = `${n} — ${world.world?.name ?? 'вики'}` }, { immediate: true })
</script>

<template>
  <Teleport defer to="#crumbs">
    <RouterLink :to="{ name: 'dashboard', params: { wid: world.wid! } }">{{ world.world?.name }}</RouterLink>
    <template v-if="entity">
      <Icon name="chevron-right" :size="13" />
      <RouterLink :to="{ name: 'list', params: { wid: world.wid!, type: entity.type } }">{{ def.plural }}</RouterLink>
      <template v-for="p in parents" :key="p.id"><Icon name="chevron-right" :size="13" /><RouterLink :to="{ name: 'entity', params: { wid: world.wid!, eid: p.id } }">{{ p.name }}</RouterLink></template>
      <Icon name="chevron-right" :size="13" /><span class="ellipsis" style="color: var(--text)">{{ entity.name }}</span>
    </template>
  </Teleport>

  <div v-if="!entity" class="content empty">
    <Icon :name="raw?.deleted ? 'trash2' : 'eye-off'" :size="36" />
    <h2>{{ raw?.deleted ? 'Статья в корзине' : 'Статья не найдена' }}</h2>
    <p class="muted">{{ raw?.deleted ? 'Её можно восстановить в настройках мира → Корзина.' : 'Возможно, она удалена или скрыта от вас.' }}</p>
    <button v-if="raw?.deleted && world.isMaster" class="btn btn-primary" @click="world.restoreEntity(raw.id)">Восстановить</button>
  </div>

  <div v-else class="content">
    <EntityHero :entity="entity" :editing="editing" :can-edit="canEdit" @toggle-edit="toggleEdit" />

    <div class="tabs no-print">
      <button class="tab" :class="{ on: tab === 'story' }" @click="setTab('story')"><Icon name="book-open" :size="16" /> Статья</button>
      <button v-if="feature" class="tab" :class="{ on: tab === 'feature' }" @click="setTab('feature')"><Icon :name="FEATURE_LABEL[feature].icon" :size="16" /> {{ FEATURE_LABEL[feature].label }}</button>
      <button class="tab" :class="{ on: tab === 'relations' }" @click="setTab('relations')"><Icon name="network" :size="16" /> Связи <span v-if="relCount" class="count">{{ relCount }}</span></button>
      <button class="tab" :class="{ on: tab === 'attributes' }" @click="setTab('attributes')"><Icon name="list-checks" :size="16" /> Атрибуты <span v-if="attrCount" class="count">{{ attrCount }}</span></button>
      <button v-if="['character', 'creature', 'organisation', 'family', 'location', 'item'].includes(entity.type) || def.custom" class="tab" :class="{ on: tab === 'inventory' }" @click="setTab('inventory')"><Icon name="archive" :size="16" /> Инвентарь</button>
      <button class="tab" :class="{ on: tab === 'abilities' }" @click="setTab('abilities')"><Icon name="sparkles" :size="16" /> Способности</button>
      <button class="tab" :class="{ on: tab === 'dates' }" @click="setTab('dates')"><Icon name="calendar" :size="16" /> Даты</button>
      <button class="tab" :class="{ on: tab === 'links' }" @click="setTab('links')"><Icon name="link" :size="16" /> Ссылки</button>
      <button v-if="world.isMember" class="tab" :class="{ on: tab === 'history' }" @click="setTab('history')"><Icon name="clock" :size="16" /> История</button>
    </div>

    <div v-if="tab === 'story'" class="entity-grid">
      <div class="entity-main">
        <PostsList :entity="entity" position="before" :editing="editing" />
        <div v-if="draftOffer" class="card card-pad row gap wrap" style="border-color: var(--warning)">
          <Icon name="triangle-alert" style="color: var(--warning)" />
          <span class="grow">Найден несохранённый черновик этой статьи (из прошлой сессии).</span>
          <button class="btn btn-sm btn-primary" @click="restoreDraft">Восстановить</button>
          <button class="btn btn-sm" @click="dropDraft">Удалить черновик</button>
        </div>
        <RichEditor
          v-if="editing && !loadingText" ref="editorRef" :model-value="html" :allow-secrets="world.isMaster" :upload-visibility="uploadVis"
          :folder="entity.name" min-height="420px" autofocus @dirty="onDirty" @save-now="autosave.flush()" @uploaded="forceSave = true; autosave.touch()"
        />
        <div v-else-if="editing" class="card empty"><Icon name="refresh-cw" class="spin" /></div>
        <article v-else class="card article-card">
          <RichView v-if="html" :html="html" @headings="headings = $event" />
          <div v-else-if="loadingText" class="empty"><Icon name="refresh-cw" class="spin" /></div>
          <div v-else class="empty">
            <Icon name="feather" :size="32" />
            <p>Здесь пока нет текста.</p>
            <button v-if="canEdit" class="btn btn-primary" @click="toggleEdit"><Icon name="pencil" :size="15" /> Написать статью</button>
          </div>
          <div v-if="entity.updatedAt" class="faint small" style="margin-top: 18px">Изменено {{ relativeTime(entity.updatedAt) }} · {{ world.memberName(entity.updatedBy) }}</div>
        </article>
        <PostsList :entity="entity" position="after" :editing="editing" />
      </div>
      <aside class="entity-side">
        <FactsPanel :entity="entity" :editing="editing" />
        <CharacterPlayerPanel v-if="entity.type === 'character'" :entity="entity" />
        <GmNotesPanel :entity="entity" :editing="editing" />
        <PinnedAttributes :entity="entity" />
        <div v-if="headings.length > 2 && !editing" class="card card-pad toc">
          <div class="section-title">Содержание</div>
          <a v-for="h in headings" :key="h.id" :href="'#' + h.id" :style="{ '--lvl': h.level }" @click.prevent="scrollToHeading(h.id)">{{ h.text }}</a>
        </div>
        <ChildrenPanel :entity="entity" />
        <BacklinksPanel :entity="entity" />
      </aside>
    </div>

    <template v-else-if="tab === 'feature' && feature">
      <MapViewer v-if="feature === 'map'" :entity="entity" :editing="canEdit" />
      <CalendarViewer v-else-if="feature === 'calendar'" :entity="entity" :editing="canEdit" />
      <TimelineViewer v-else-if="feature === 'timeline'" :entity="entity" :editing="canEdit" />
      <FamilyTree v-else-if="feature === 'familyTree'" :entity="entity" :editing="canEdit" />
      <OrgMembers v-else-if="feature === 'members'" :entity="entity" :editing="canEdit" />
      <QuestElements v-else-if="feature === 'quest'" :entity="entity" :editing="canEdit" />
      <ConversationView v-else-if="feature === 'conversation'" :entity="entity" :editing="canEdit" />
      <DiceRoller v-else-if="feature === 'dice'" :entity="entity" :editing="canEdit" />
      <TaggedList v-else-if="feature === 'tagged'" :entity="entity" :editing="canEdit" />
    </template>
    <RelationsPanel v-else-if="tab === 'relations'" :entity="entity" :editing="canEdit" />
    <AttributesPanel v-else-if="tab === 'attributes'" :entity="entity" :editing="canEdit" />
    <InventoryPanel v-else-if="tab === 'inventory'" :entity="entity" :editing="canEdit" />
    <AbilitiesPanel v-else-if="tab === 'abilities'" :entity="entity" :editing="canEdit" />
    <RemindersPanel v-else-if="tab === 'dates'" :entity="entity" :editing="canEdit" />
    <LinksPanel v-else-if="tab === 'links'" :entity="entity" :editing="canEdit" />
    <HistoryPanel v-else-if="tab === 'history'" :entity="entity" :editing="canEdit" @restored="loadText(true)" />
  </div>
</template>
