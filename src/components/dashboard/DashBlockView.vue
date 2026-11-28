<script setup lang="ts">
// The content of one overview block (the frame, size and edit controls are drawn by DashboardView).
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { relativeTime, plural } from '@/data/util'
import { cropOf } from '@/data/crop'
import { imageUrl } from '@/data/images'
import { STATUS_LABELS } from '@/data/campaigns'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import RichView from '@/components/viewer/RichView.vue'
import { openLightbox } from '@/components/viewer/lightbox'
import { createRequest } from '@/components/layout/createRequest'
import { kindOf, titleOf } from './blocks'
import { hostOf, safeUrl } from './links'
import type { DashData } from './useDashData'
import type { DashBlock, Entity } from '@/model/types'

const CalendarWidget = defineAsyncComponent(() => import('@/components/modules/CalendarWidget.vue'))
const MapViewer = defineAsyncComponent(() => import('@/components/modules/MapViewer.vue'))

const props = defineProps<{ block: DashBlock; data: DashData; editing?: boolean }>()
const emit = defineEmits<{ setup: [] }>()
const world = useWorld()
const b = computed(() => props.block)
const wid = computed(() => world.wid ?? '')
const kind = computed(() => kindOf(b.value.type))
const showTitle = computed(() => !b.value.hideTitle && b.value.type !== 'hero')

// ---------- the "article" block in full-text mode loads the article body ----------
const fullHtml = ref('')
const fullLoading = ref(false)
watch(() => [b.value.type, b.value.view, b.value.entityId, world.get(b.value.entityId ?? null)?.bodyRev, world.canReadSecrets] as const, async ([type, view, id]) => {
  fullHtml.value = ''
  if (type !== 'entity' || view !== 'full' || !id || !world.get(id)) return
  fullLoading.value = true
  try { fullHtml.value = await world.loadText(id) } catch { fullHtml.value = '' } finally { fullLoading.value = false }
}, { immediate: true })

/** pins and list blocks: the articles and how to draw them */
const rows = computed(() => (b.value.type === 'pins' ? props.data.pins(b.value) : b.value.type === 'list' ? props.data.list(b.value) : []))
const view = computed(() => b.value.view ?? (b.value.type === 'pins' ? 'cards' : 'rows'))
const sub = (e: Entity) => e.kind || typeDef(e.type).label
const text = (e: Entity) => e.tooltip || e.excerpt
const to = (e: Entity) => ({ name: 'entity', params: { wid: wid.value, eid: e.id } })
/** A map block of automatic height takes the proportions of the map (within reason). */
const mapAspect = computed(() => {
  const f = props.data.entity(b.value)?.fields ?? {}
  const w = Number(f.mapWidth ?? f.width), h = Number(f.mapHeight ?? f.height)
  return w > 0 && h > 0 ? String(Math.min(2.2, Math.max(0.8, w / h))) : '4 / 3'
})
const heroHeight = computed(() => ({ sm: 120, md: 180, lg: 300 })[b.value.heroSize ?? 'md'])

async function zoomImage() {
  if (props.editing || !b.value.imageId) return
  try { openLightbox([{ src: await imageUrl(world.access, b.value.imageId), caption: b.value.caption || '' }]) } catch { /* not accessible */ }
}
const linkRows = computed(() => props.data.links(b.value).map((l) => {
  const e = l.entityId ? world.get(l.entityId) : null
  const url = e ? null : safeUrl(l.url)
  return { label: l.label?.trim() || e?.name || (url ? hostOf(url) : ''), e, url, sub: e ? sub(e) : url ? hostOf(url) : '' }
}))
</script>

<template>
  <div class="dbv" :class="'dbv--' + b.type">
    <h3 v-if="showTitle" class="panel-title dbv-title">
      <Icon :name="kind.icon" /> <span class="ellipsis grow">{{ titleOf(b) }}</span>
      <button v-if="b.type === 'random' && !editing" class="icon-btn" title="Другая статья" @click="data.reroll(b)"><Icon name="refresh-cw" :size="15" /></button>
      <RouterLink v-if="b.type === 'list' && b.types?.length === 1 && !b.tagId && !editing" class="icon-btn" title="Весь раздел" :to="{ name: 'list', params: { wid, type: b.types[0] } }"><Icon name="chevron-right" :size="16" /></RouterLink>
      <RouterLink v-if="b.type === 'map' && data.entity(b) && !editing" class="icon-btn" title="Открыть страницу карты" :to="to(data.entity(b)!)"><Icon name="external-link" :size="15" /></RouterLink>
    </h3>

    <!-- ============ hero ============ -->
    <section v-if="b.type === 'hero'" class="dash-hero dbv-hero" :class="['align-' + (b.align ?? 'left')]" :style="{ minHeight: heroHeight + 'px' }">
      <div v-if="world.world?.headerImageId" class="hero-img"><Thumb :id="world.world.headerImageId" variant="full" :crop="world.world.headerCrop ?? null" /></div>
      <div class="dash-hero-body" :style="{ paddingTop: Math.max(24, heroHeight - 110) + 'px' }">
        <h1>{{ world.world?.name }}</h1>
        <p v-if="b.showDescription !== false && world.world?.description" class="muted dbv-desc">{{ world.world.description }}</p>
      </div>
    </section>

    <!-- ============ stats ============ -->
    <template v-else-if="b.type === 'stats'">
      <div v-if="data.stats(b).length" class="stat-row">
        <RouterLink v-for="s in data.stats(b)" :key="s.t.key" class="stat" :to="{ name: 'list', params: { wid, type: s.t.key } }">
          <Icon :name="s.t.icon" :size="17" :style="{ color: s.t.color }" /> <b>{{ s.n }}</b> {{ s.t.plural.toLowerCase() }}
        </RouterLink>
      </div>
      <div v-else class="card card-pad">
        <template v-if="world.isMaster">
          <h3 style="margin-top: 0">Мир пока пуст</h3>
          <p class="muted">Начните с ключевых статей: регион, где начнётся игра, пара персонажей, главная фракция. Ссылки между статьями ставятся через «@» прямо в тексте.</p>
          <button class="btn btn-primary" :disabled="editing" @click="createRequest = { type: null }"><Icon name="plus" :size="16" /> Создать первую статью</button>
        </template>
        <template v-else>
          <h3 style="margin-top: 0">Здесь пока нет {{ world.isMember ? 'доступных вам' : 'открытых' }} статей</h3>
          <p class="muted" style="margin-bottom: 0">{{ world.isMember ? 'Мастер ещё не открыл статьи игрокам.' : 'Мастер ещё не опубликовал статьи для гостей. Если вы участник — войдите.' }}</p>
        </template>
      </div>
    </template>

    <!-- ============ text ============ -->
    <template v-else-if="b.type === 'text'">
      <RichView v-if="data.hasContent(b)" :html="b.html ?? ''" class="prose dbv-prose" />
      <p v-else class="dbv-empty">Пустой текст.</p>
    </template>

    <!-- ============ pins / list (cards, tiles or rows) ============ -->
    <template v-else-if="b.type === 'pins' || b.type === 'list'">
      <div v-if="view === 'cards'" class="card-grid">
          <RouterLink v-for="e in rows" :key="e.id" class="ecard" :to="to(e)">
            <div class="ecard-img"><Thumb :id="e.imageId" :crop="cropOf(e)"><Icon :name="typeDef(e.type).icon" :size="34" /></Thumb></div>
            <div class="ecard-body"><div class="ecard-name">{{ e.name }}</div><div class="ecard-sub">{{ sub(e) }}</div><div class="ecard-text">{{ text(e) }}</div></div>
          </RouterLink>
        </div>
        <div v-else-if="view === 'tiles'" class="dbv-tiles">
          <RouterLink v-for="e in rows" :key="e.id" class="dbv-tile" :to="to(e)" :title="e.name">
            <span class="dbv-tile-img"><Thumb :id="e.imageId" :crop="cropOf(e)"><Icon :name="typeDef(e.type).icon" :size="26" /></Thumb></span>
            <span class="dbv-tile-name">{{ e.name }}</span>
          </RouterLink>
        </div>
        <div v-else>
          <div v-for="e in rows" :key="e.id" class="recent-row">
            <EntityLink :id="e.id" avatar />
            <span class="faint small grow" style="text-align: right">{{ b.type === 'list' && b.sort === 'name' ? sub(e) : relativeTime(b.sort === 'created' ? e.createdAt : e.updatedAt) }}</span>
          </div>
        </div>
        <p v-if="!rows.length" class="dbv-empty">{{ b.type === 'pins' ? 'Статьи не выбраны.' : 'Под условия списка ничего не подходит.' }}</p>
    </template>

    <!-- ============ one article ============ -->
    <template v-else-if="b.type === 'entity'">
      <template v-if="data.entity(b)">
        <RouterLink v-if="b.view !== 'full'" class="dbv-entity" :to="to(data.entity(b)!)">
          <span class="dbv-entity-img"><Thumb :id="data.entity(b)!.imageId" :crop="cropOf(data.entity(b))"><Icon :name="typeDef(data.entity(b)!.type).icon" :size="40" /></Thumb></span>
          <span class="dbv-entity-body">
            <b class="dbv-entity-name">{{ data.entity(b)!.name }}</b>
            <span class="muted small">{{ sub(data.entity(b)!) }}</span>
            <span class="dbv-entity-text">{{ text(data.entity(b)!) || 'Без текста' }}</span>
            <span class="small dbv-more">Читать <Icon name="arrow-right" :size="13" /></span>
          </span>
        </RouterLink>
        <div v-else>
          <RouterLink class="dbv-entity-head" :to="to(data.entity(b)!)"><Icon :name="typeDef(data.entity(b)!.type).icon" :size="16" /> {{ data.entity(b)!.name }}</RouterLink>
          <div v-if="fullLoading" class="empty"><Icon name="refresh-cw" class="spin" :size="20" /></div>
          <RichView v-else-if="fullHtml" :html="fullHtml" class="prose dbv-prose" />
          <p v-else class="dbv-empty">{{ text(data.entity(b)!) || 'В статье пока нет текста.' }}</p>
        </div>
      </template>
      <p v-else class="dbv-empty">{{ b.entityId ? 'Статья недоступна или удалена.' : 'Статья не выбрана.' }}</p>
    </template>

    <!-- ============ recent ============ -->
    <template v-else-if="b.type === 'recent'">
      <div v-for="e in data.recent(b)" :key="e.id" class="recent-row">
        <EntityLink :id="e.id" avatar />
        <span class="faint small grow" style="text-align: right">{{ relativeTime(e.updatedAt) }}</span>
      </div>
      <p v-if="!data.recent(b).length" class="dbv-empty">Пока ничего.</p>
    </template>

    <!-- ============ calendar ============ -->
    <CalendarWidget v-else-if="b.type === 'calendar'" :calendar-id="b.calendarId ?? null" :limit="b.limit || 5" class="dbv-cal" />

    <!-- ============ map ============ -->
    <!-- the real map: zoom, markers with popups, layers, full screen (the full-size picture, not a thumbnail) -->
    <template v-else-if="b.type === 'map'">
      <div v-if="data.entity(b)" class="dbv-mapbox" :class="{ fill: b.h > 0 }" :style="b.h > 0 ? undefined : { aspectRatio: mapAspect }">
        <MapViewer :entity="data.entity(b)!" :editing="false" embedded />
      </div>
      <p v-else class="dbv-empty">{{ b.entityId ? 'Карта недоступна или удалена.' : 'Карта не выбрана.' }}</p>
    </template>

    <!-- ============ image ============ -->
    <figure v-else-if="b.type === 'image'" class="dbv-figure" :class="{ 'fit-contain': b.fit === 'contain', fixed: b.h > 0 }">
      <button v-if="b.imageId" type="button" class="dbv-img" title="Открыть крупно" @click="zoomImage"><Thumb :id="b.imageId" variant="full" :crop="b.fit === 'contain' ? null : (b.imageCrop ?? null)" :alt="b.caption || ''"><Icon name="image" :size="30" /></Thumb></button>
      <span v-else class="dbv-img dbv-img-empty"><Icon name="image" :size="30" /></span>
      <figcaption v-if="b.caption" class="muted small">{{ b.caption }}</figcaption>
    </figure>

    <!-- ============ quick links ============ -->
    <template v-else-if="b.type === 'links'">
      <div class="dbv-links">
        <template v-for="(l, i) in linkRows" :key="i">
          <RouterLink v-if="l.e" class="dbv-link" :to="to(l.e)"><Icon :name="typeDef(l.e.type).icon" :size="17" :style="{ color: typeDef(l.e.type).color }" /><span class="grow"><b>{{ l.label }}</b><span class="faint small">{{ l.sub }}</span></span><Icon name="chevron-right" :size="15" class="faint" /></RouterLink>
          <a v-else-if="l.url" class="dbv-link" :href="l.url" target="_blank" rel="noopener noreferrer"><Icon name="external-link" :size="17" /><span class="grow"><b>{{ l.label }}</b><span class="faint small">{{ l.sub }}</span></span></a>
        </template>
      </div>
      <p v-if="!linkRows.length" class="dbv-empty">Ссылок пока нет.</p>
    </template>

    <!-- ============ my characters ============ -->
    <template v-else-if="b.type === 'character'">
      <div v-if="data.characters.value.length" class="dbv-chars">
        <RouterLink v-for="c in data.characters.value" :key="c.id" class="row gap" style="align-items: flex-start; color: var(--text)" :to="to(c)">
          <span class="avatar avatar-lg"><Thumb :id="c.imageId" :crop="cropOf(c)"><Icon name="user" /></Thumb></span>
          <span><b style="font-family: var(--font-head); font-size: 22px">{{ c.name }}</b><br /><span class="muted small">{{ c.fields?.title || c.kind }}</span><br /><span class="faint small">{{ text(c) }}</span></span>
        </RouterLink>
      </div>
      <p v-else class="dbv-empty">Здесь участник увидит своих персонажей (их закрепляет мастер — на странице персонажа или в «Участниках»). У кого персонажей нет — блок не показывается.</p>
    </template>

    <!-- ============ campaigns ============ -->
    <template v-else-if="b.type === 'campaigns'">
      <RouterLink v-for="c in data.campaigns.rows" :key="c.id" class="dbv-link" :to="{ name: 'wcampaign', params: { wid, cid: c.id } }">
        <Icon name="swords" :size="17" /><span class="grow"><b>{{ c.name }}</b><span class="faint small">{{ STATUS_LABELS[c.status] }} · {{ c.memberUids.length }} {{ plural(c.memberUids.length, 'участник', 'участника', 'участников') }}</span></span><Icon name="chevron-right" :size="15" class="faint" />
      </RouterLink>
      <p v-if="!data.campaigns.rows.length" class="dbv-empty">Игр в этом мире пока нет<template v-if="!world.isMaster"> (или вы в них не участвуете)</template>.</p>
      <RouterLink v-if="world.isMaster && !world.adminView && !editing" class="btn btn-sm btn-ghost" style="margin-top: 6px" :to="{ name: 'wcampaigns', params: { wid }, query: { new: '1' } }"><Icon name="plus" :size="14" /> Новая игра</RouterLink>
    </template>

    <!-- ============ random ============ -->
    <template v-else-if="b.type === 'random'">
      <RouterLink v-if="data.random(b)" class="row gap" style="align-items: flex-start; color: var(--text)" :to="to(data.random(b)!)">
        <span class="avatar avatar-lg"><Thumb :id="data.random(b)!.imageId" :crop="cropOf(data.random(b))"><Icon :name="typeDef(data.random(b)!.type).icon" /></Thumb></span>
        <span><b style="font-family: var(--font-head); font-size: 20px">{{ data.random(b)!.name }}</b><br /><span class="muted small dbv-random-text">{{ text(data.random(b)!) }}</span></span>
      </RouterLink>
      <p v-else class="dbv-empty">Нет статей с картинкой и текстом{{ b.types?.length ? ' в выбранных разделах' : '' }} — блок появится, когда они будут.</p>
    </template>

    <!-- ============ waiting for text ============ -->
    <template v-else-if="b.type === 'waiting'">
      <p class="faint small" style="margin-top: -6px">Статьи без текста и без упоминаний.</p>
      <div class="stack-sm"><EntityLink v-for="e in data.waiting(b)" :key="e.id" :id="e.id" /></div>
      <p v-if="!data.waiting(b).length" class="dbv-empty">Все статьи с текстом.</p>
    </template>

    <button v-if="editing && kind.needsSetup && !data.hasContent(b)" class="btn btn-sm dbv-setup" @click="emit('setup')"><Icon name="settings" :size="14" /> Настроить блок</button>
  </div>
</template>

<style scoped>
.dbv { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.dbv-title { margin-bottom: 10px; }
.dbv-empty { margin: 4px 0; color: var(--text-faint); font-size: 13.5px; }
.dbv-setup { align-self: flex-start; margin-top: 6px; }
.dbv-prose { font-size: 15px; }
.dbv-prose :deep(> :first-child) { margin-top: 0; }
.dbv-prose :deep(> :last-child) { margin-bottom: 0; }

/* hero: the block is the picture itself */
.dbv-hero { margin: 0; flex: 1; display: flex; flex-direction: column; justify-content: flex-end; border: 0; border-radius: 0; }
.dbv-hero .dash-hero-body { padding-bottom: 22px; }
.dbv-hero.align-center .dash-hero-body { text-align: center; }
.dbv-hero.align-center .dbv-desc { margin-left: auto !important; margin-right: auto !important; }
.dbv-desc { max-width: 760px; font-size: 16px; margin: 6px 0 0; }

.dbv-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
.dbv-tile { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--text); text-decoration: none !important; text-align: center; }
.dbv-tile-img { width: 100%; aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: var(--surface-3); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; color: var(--text-faint); transition: border-color .12s; }
.dbv-tile-img :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.dbv-tile:hover .dbv-tile-img { border-color: var(--accent); }
.dbv-tile-name { font-size: 13px; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.dbv-entity { display: flex; gap: 14px; align-items: flex-start; color: var(--text); text-decoration: none !important; }
.dbv-entity-img { width: 38%; max-width: 220px; aspect-ratio: 4 / 3; flex-shrink: 0; border-radius: 10px; overflow: hidden; background: var(--surface-3); display: flex; align-items: center; justify-content: center; color: var(--text-faint); }
.dbv-entity-img :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.dbv-entity-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dbv-entity-name { font: 700 22px var(--font-head); line-height: 1.15; }
.dbv-entity-text { font-size: 14px; color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.dbv-more { color: var(--accent); display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; }
.dbv-entity-head { display: inline-flex; align-items: center; gap: 6px; font: 700 20px var(--font-head); color: var(--text); margin-bottom: 8px; }

.dbv-cal { border: 0 !important; background: none !important; box-shadow: none !important; margin: -4px -6px; }
.dbv-mapbox { position: relative; width: 100%; min-height: 220px; max-height: 75vh; }
.dbv-mapbox.fill { flex: 1; min-height: 0; max-height: none; }

.dbv-figure { margin: 0; display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; }
.dbv-img { padding: 0; border: 0; background: var(--surface-3); border-radius: 10px; overflow: hidden; cursor: zoom-in; display: flex; align-items: center; justify-content: center; color: var(--text-faint); min-height: 120px; }
.dbv-img :deep(img) { width: 100%; height: auto; display: block; }
.fixed .dbv-img { flex: 1; min-height: 0; }
.fixed .dbv-img :deep(img) { height: 100%; object-fit: cover; }
.fit-contain .dbv-img :deep(img) { object-fit: contain; background: var(--surface-2); }
.dbv-img-empty { cursor: default; aspect-ratio: 4 / 3; }

.dbv-random-text { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.dbv-links { display: flex; flex-direction: column; gap: 6px; }
.dbv-chars { display: flex; flex-direction: column; gap: 14px; }
.dbv-link { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; color: var(--text); text-decoration: none !important; background: var(--surface); transition: border-color .12s, background .12s; }
.dbv-link:hover { border-color: var(--accent); background: var(--surface-2); }
.dbv-link > .grow { display: flex; flex-direction: column; min-width: 0; }
.dbv-link b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbv--campaigns .dbv-link + .dbv-link { margin-top: 6px; }
</style>
