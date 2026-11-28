<script setup lang="ts">
// Interactive map (Kanka "Maps" module) for entities of type `map`.
// Leaflet with L.CRS.Simple over the map image; markers / labels / circles / polygons come from `mapMarkers`,
// marker groups from `mapGroups`, extra image layers from `mapLayers`. Coordinates are image pixels with
// bounds [[0, 0], [height, width]] (y up, like Kanka).
//
// `editing` = the user may edit this map. Editors still start in view mode and switch the tools on with the
// "Правка" button, so they can use the map like everybody else.
//
// Entity fields used: mapImageId (gallery image, falls back to entity.imageId), mapWidth / mapHeight (size of
// the coordinate space; fallback width / height), mapDimsFor (image id the size was measured for),
// mapView { lat, lng, zoom } (optional saved initial view).
import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useWorld } from '@/stores/world'
import { useGallery } from '@/stores/gallery'
import { ensureImageAccess, imageUrl } from '@/data/images'
import { cropOf, isZoomedCrop } from '@/data/crop'
import { escapeHtml } from '@/data/util'
import { toast } from '@/components/common/toast'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import ImageModal from '@/components/common/ImageModal.vue'
import MarkerPopup from './map/MarkerPopup.vue'
import MarkerList from './map/MarkerList.vue'
import MarkerEditor from './map/MarkerEditor.vue'
import MapLegend from './map/MapLegend.vue'
import MapManageModal from './map/MapManageModal.vue'
import {
  AREA_OPACITY, DEFAULT_COLOUR, DEFAULT_FONT, DEFAULT_SIZE, DRAFT_ID, NO_GROUP, centroid, inheritVisibility, labelFontSize, labelSpec,
  markerTitle, normGroup, normLayer, normMarker, pinBox, pinSpec, resolveIcon, round2, safeColour, toData,
  type LegendGroup, type ListItem, type MarkerData, type MarkerShape,
} from './map/mapUtils'
import type { Entity, LatLng, MapGroup, MapLayer, MapMarker } from '@/model/types'

type Mode = 'select' | MarkerShape
type Dims = { w: number; h: number }
interface Ctx { entity: Entity | undefined; thumb: string | null; editable: boolean; active: boolean }

/** `embedded`: a map inside another page (an overview block) — fills its container, no marker list beside it. */
const props = defineProps<{ entity: Entity; editing: boolean; embedded?: boolean }>()
const world = useWorld()
const gallery = useGallery()
const route = useRoute()

const TOOLS: { mode: Mode; icon: string; label: string; title: string }[] = [
  { mode: 'select', icon: 'crosshair', label: 'Выбор', title: 'Выбор и перемещение меток' },
  { mode: 'marker', icon: 'map-pin', label: 'Маркер', title: 'Поставить маркер' },
  { mode: 'label', icon: 'type', label: 'Подпись', title: 'Добавить подпись' },
  { mode: 'circle', icon: 'circle', label: 'Круг', title: 'Нарисовать круг' },
  { mode: 'polygon', icon: 'hexagon', label: 'Область', title: 'Нарисовать область по точкам' },
]
const PLACE_HINT: Record<string, string> = {
  marker: 'Щёлкните по карте, чтобы поставить маркер.',
  label: 'Щёлкните по карте там, где должна быть подпись.',
  circle: 'Щёлкните по карте в центре круга.',
}

// ---------- rows ----------
const layers = ref<MapLayer[]>([])
const groups = ref<MapGroup[]>([])
const markers = ref<MapMarker[]>([])
const markersLoaded = ref(false)
let stopRows: Array<() => void> = []

// ---------- view state ----------
const editOn = ref(false)
/** Editing tools are active (rights + the "Правка" toggle). */
const isEditing = computed(() => props.editing && editOn.value)
const mode = ref<Mode>('select')
const activeId = ref<string | null>(null) // marker whose popup is open
const hiddenGroups = ref(new Set<string>())
const seenGroups = new Set<string>()
const layerOn = ref<Record<string, boolean>>({}) // viewer-local; missing = shown
const baseLayerId = ref<string | null>(null)
const fullscreen = ref(false)
const showLegend = ref(false)
const sideOpen = ref(!props.embedded)
const imageDialog = ref(false)
const manageTab = ref<'layers' | 'groups' | null>(null)
const busy = ref(false)
const imgState = ref<'idle' | 'loading' | 'ok' | 'error'>('idle')
const dims = ref<Dims | null>(null)
/** Map has a view (initial fit done) — layers may be drawn and focused. */
const ready = ref(false)
const thumbUrls = ref<Record<string, string>>({})
const drawPoints = ref<LatLng[]>([])

// ---------- marker editor ----------
const editDraft = ref<MarkerData | null>(null)
let editOriginal = '' // JSON of the draft when the editor opened ('' = new, unsaved marker)
const editHtmlDirty = ref(false)
const editKey = ref(0)
let lastGroupId: string | null = null
let focusedQuery = '' // ?marker=<id> already focused

// ---------- Leaflet objects (not reactive) ----------
const stageEl = ref<HTMLElement | null>(null)
const mapEl = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let baseOverlay: L.ImageOverlay | null = null
let handleGroup: L.LayerGroup | null = null
let drawGroup: L.LayerGroup | null = null
let rubber: L.Polyline | null = null
let popup: L.Popup | null = null
let ro: ResizeObserver | null = null
let popupRo: ResizeObserver | null = null
let viewFor: string | null = null // entity id the initial view was set for
let pendingView = false // initial view postponed until the container has a size
let handlesSig = ''
let handlesLayer: L.Layer | null = null
const markerLayers = new Map<string, { layer: L.Layer; sig: string }>()
const overlayLayers = new Map<string, { layer: L.ImageOverlay; imageId: string }>()
/** Element Leaflet shows inside its popup; MarkerPopup is teleported into it (keeps app context). */
const popupEl = document.createElement('div')
popupEl.className = 'dw-popup-body'

// ---------- derived ----------
const mainImageId = computed<string | null>(() => props.entity.fields?.mapImageId || props.entity.imageId || null)
const overlays = computed(() => layers.value.filter((l) => l.kind === 'overlay' && l.imageId))
const baseLayers = computed(() => layers.value.filter((l) => l.kind === 'base' && l.imageId))
const shownImageId = computed(() => baseLayers.value.find((l) => l.id === baseLayerId.value)?.imageId ?? mainImageId.value)
const canEditMap = computed(() => world.canEdit(props.entity))
const groupIds = computed(() => new Set(groups.value.map((g) => g.id)))
const groupKey = (m: { groupId: string | null }) => (m.groupId && groupIds.value.has(m.groupId) ? m.groupId : NO_GROUP)
const draftKey = computed(() => (editDraft.value ? editDraft.value.id ?? DRAFT_ID : null))
const activeMarker = computed(() => markers.value.find((m) => m.id === activeId.value) ?? null)
const defaultRadius = computed(() => (dims.value ? Math.max(5, Math.round(Math.min(dims.value.w, dims.value.h) * 0.04)) : 50))

/** Markers drawn on the map: visible groups, plus the draft being edited (replaces its saved version). */
const mapItems = computed<MapMarker[]>(() => {
  const d = editDraft.value
  const out = markers.value.filter((m) => m.id !== d?.id && !hiddenGroups.value.has(groupKey(m)))
  if (d) out.push({ ...(d as MapMarker), id: d.id ?? DRAFT_ID })
  return out
})

const listItems = computed<ListItem[]>(() => markers.value
  .map((m) => {
    const entity = world.get(m.entityId) ?? null
    return { marker: m, entity, name: markerTitle(m, entity), group: groupKey(m) }
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' })))

const legendGroups = computed<LegendGroup[]>(() => {
  const by = new Map<string, MapMarker[]>()
  for (const m of markers.value) {
    const k = groupKey(m)
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push(m)
  }
  const out: LegendGroup[] = groups.value.map((g) => ({ key: g.id, name: g.name || 'Без названия', items: by.get(g.id) ?? [] }))
  const none = by.get(NO_GROUP)
  if (none?.length) out.push({ key: NO_GROUP, name: groups.value.length ? 'Без группы' : 'Все метки', items: none })
  return out
})

const bounds = () => L.latLngBounds([0, 0], [dims.value?.h ?? 1, dims.value?.w ?? 1])

// ---------- subscriptions ----------
function subscribe() {
  stopRows.forEach((s) => s())
  stopRows = []
  layers.value = []
  groups.value = []
  markers.value = []
  markersLoaded.value = false
  if (!world.wid) return
  const id = props.entity.id
  stopRows = [
    world.watchRows<MapLayer>('mapLayers', 'mapId', id, (rows) => { layers.value = rows.map(normLayer) }),
    world.watchRows<MapGroup>('mapGroups', 'mapId', id, (rows) => { groups.value = rows.map(normGroup) }),
    world.watchRows<MapMarker>('mapMarkers', 'mapId', id, (rows) => { markers.value = rows.map(normMarker); markersLoaded.value = true }, null),
  ]
}

function resetUi() {
  closeEditor()
  popup?.close()
  activeId.value = null
  mode.value = 'select'
  hiddenGroups.value = new Set()
  seenGroups.clear()
  layerOn.value = {}
  baseLayerId.value = null
  focusedQuery = ''
}

// ---------- map lifecycle ----------
function initMap(el: HTMLElement) {
  const m = L.map(el, {
    crs: L.CRS.Simple, minZoom: -5, maxZoom: 5, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    attributionControl: false, zoomControl: false, maxBoundsViscosity: 0.8,
  })
  m.createPane('dwBase').style.zIndex = '150'
  m.createPane('dwOverlay').style.zIndex = '250'
  handleGroup = L.layerGroup().addTo(m)
  drawGroup = L.layerGroup().addTo(m)
  popup = L.popup({ className: 'dw-map-popup', minWidth: 250, maxWidth: 300, maxHeight: 400, closeOnClick: false, autoPanPadding: [30, 30] }).setContent(popupEl)
  m.on('click', onMapClick)
  m.on('dblclick', onMapDblClick)
  m.on('mousemove', onMapMove)
  m.on('popupclose', (e: L.PopupEvent) => { if (e.popup === popup) activeId.value = null })
  map = m
  if (props.embedded) embed(m)
  ro = new ResizeObserver(onResize)
  ro.observe(el)
  void loadBase()
}

/**
 * An embedded map must not trap the page: the wheel zooms only after a click inside the map (until the pointer
 * leaves it), and on touch screens one finger scrolls the page while two fingers zoom. Full screen = a normal map.
 */
const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
function embed(m: L.Map) {
  m.scrollWheelZoom.disable()
  if (coarsePointer) m.dragging.disable()
  m.on('click', () => { if (!fullscreen.value) m.scrollWheelZoom.enable() })
  m.on('mouseout', () => { if (!fullscreen.value) m.scrollWheelZoom.disable() })
  // until the viewer moves the map, it stays fitted when its box changes (the overview settles, edit mode ends…)
  m.on('dragstart', () => { autoFit = false })
  m.getContainer().addEventListener('wheel', () => { if (m.scrollWheelZoom.enabled()) autoFit = false }, { passive: true })
  m.getContainer().addEventListener('touchstart', (e) => { if (e.touches.length > 1) autoFit = false }, { passive: true })
}
/** Embedded: the map is still in its initial view (re-fitted on resize). */
let autoFit = true
/** Full screen on/off: the next resize keeps the centre of the view. */
let keepCentre = false
watch(fullscreen, (on) => {
  if (!map) return
  // the box changes a lot: keep what was in the middle of the map in the middle (other resizes keep the top-left
  // corner, so opening the marker list does not shift the picture) — applied by onResize once the size is known
  keepCentre = true
  setTimeout(() => { keepCentre = false }, 1500)
  if (!props.embedded) return
  if (on) { map.scrollWheelZoom.enable(); map.dragging.enable() }
  else { map.scrollWheelZoom.disable(); if (coarsePointer) map.dragging.disable() }
})

function destroyMap() {
  ro?.disconnect()
  ro = null
  if (map) { map.off(); map.remove() }
  map = null
  baseOverlay = null
  handleGroup = null
  drawGroup = null
  rubber = null
  popup = null
  handlesSig = ''
  handlesLayer = null
  markerLayers.clear()
  overlayLayers.clear()
  ready.value = false
  dims.value = null
  imgState.value = 'idle'
  viewFor = null
  pendingView = false
}

function onResize() {
  if (!map) return
  const refit = props.embedded && autoFit && !fullscreen.value && ready.value && !pendingView
  // Usually the top-left corner stays put (opening the marker list does not shift the picture). Full screen on/off
  // and a self-fitting embedded map keep the centre instead — set right here: moving the view afterwards would race
  // Leaflet's own animated pan back inside the map bounds.
  map.invalidateSize({ pan: keepCentre || refit })
  keepCentre = false
  if (!dims.value) return
  updateZoomLimits()
  if (pendingView || refit) initialView()
}

// ---------- base image & coordinate space ----------
function storedDims(): Dims | null {
  const f = props.entity.fields ?? {}
  const w = Number(f.mapWidth ?? f.width), h = Number(f.mapHeight ?? f.height)
  if (!(w > 0 && h > 0)) return null
  if (f.mapDimsFor && f.mapDimsFor !== mainImageId.value) return null // measured for a previous image
  return { w, h }
}

function naturalSize(url: string): Promise<Dims> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1000, h: img.naturalHeight || 1000 }) // SVG without size → 1000²
    img.onerror = () => reject(new Error('изображение не загрузилось'))
    img.src = url
  })
}

let loadToken = 0
async function loadBase() {
  const token = ++loadToken
  const mainId = mainImageId.value
  const shownId = shownImageId.value
  if (!map || !mainId || !shownId) return
  imgState.value = 'loading'
  const stored = storedDims()
  if (stored) applyDims(stored)
  // blurry thumbnail first: the full image may need several Firestore chunks
  if (stored && !baseOverlay) {
    imageUrl(world.access, shownId, 'thumb').then((u) => { if (token === loadToken && !baseOverlay) setBaseUrl(u) }).catch(() => {})
  }
  try {
    const url = await imageUrl(world.access, shownId, 'full')
    if (token !== loadToken || !map) return
    if (!stored) {
      // no stored size: the natural size of the main image defines the coordinate space
      const nat = await naturalSize(shownId === mainId ? url : await imageUrl(world.access, mainId, 'full'))
      if (token !== loadToken || !map) return
      applyDims(nat)
      if (canEditMap.value) void persistDims(nat, mainId)
    }
    setBaseUrl(url)
    imgState.value = 'ok'
  } catch (e) {
    if (token !== loadToken) return
    console.warn('map image', e)
    imgState.value = 'error'
  }
}

async function persistDims(d: Dims, imageId: string) {
  const f = props.entity.fields ?? {}
  if (f.mapWidth === d.w && f.mapHeight === d.h && f.mapDimsFor === imageId) return
  await world.updateEntity(props.entity.id, { fields: { ...f, mapWidth: d.w, mapHeight: d.h, mapDimsFor: imageId } }).catch(() => {})
}

function applyDims(d: Dims) {
  const changed = !dims.value || dims.value.w !== d.w || dims.value.h !== d.h
  dims.value = d
  if (!map) return
  if (changed) {
    const b = bounds()
    baseOverlay?.setBounds(b)
    for (const r of overlayLayers.values()) r.layer.setBounds(b)
    map.setMaxBounds(b.pad(0.5))
  }
  updateZoomLimits()
  if (changed || viewFor !== props.entity.id) initialView()
}

function setBaseUrl(url: string) {
  if (!map || !dims.value) return
  if (!baseOverlay) baseOverlay = L.imageOverlay(url, bounds(), { pane: 'dwBase', interactive: false, className: 'dw-base-img' }).addTo(map)
  else baseOverlay.setUrl(url)
}

/** Zoom that fits the whole image, or null while the container has no size. */
function fitZoom(): number | null {
  if (!map || !dims.value) return null
  const s = map.getSize()
  if (!s.x || !s.y) return null
  return map.getBoundsZoom(bounds(), false)
}

function updateZoomLimits() {
  const fz = fitZoom()
  if (fz === null || !map) return
  map.setMinZoom(Math.floor((fz - 1) * 4) / 4)
  map.setMaxZoom(Math.max(2, Math.ceil(fz + 5)))
}

function initialView() {
  if (!map || !dims.value) return
  const s = map.getSize()
  if (!s.x || !s.y) { pendingView = true; return }
  pendingView = false
  viewFor = props.entity.id
  const v = props.entity.fields?.mapView
  if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.zoom)) map.setView([v.lat, v.lng], v.zoom, { animate: false })
  else map.fitBounds(bounds(), { animate: false })
  ready.value = true
}

// ---------- overlay layers ----------
const overlayFailed = new Set<string>()
let overlayBusy = false
let overlayAgain = false

async function syncOverlays() {
  if (overlayBusy) { overlayAgain = true; return }
  overlayBusy = true
  try {
    do { overlayAgain = false; await syncOverlaysOnce() } while (overlayAgain)
  } finally {
    overlayBusy = false
  }
}

async function syncOverlaysOnce() {
  const m = map
  if (!m || !ready.value) return
  const want = overlays.value.filter((l) => layerOn.value[l.id] !== false)
  const ids = new Set(want.map((l) => l.id))
  for (const [id, rec] of overlayLayers) if (!ids.has(id)) { rec.layer.remove(); overlayLayers.delete(id) }
  for (const l of want) {
    const rec = overlayLayers.get(l.id)
    if (rec && rec.imageId === l.imageId) { rec.layer.setOpacity(l.opacity); rec.layer.setZIndex(10 + l.order); continue }
    const key = `${l.id}/${l.imageId}`
    if (overlayFailed.has(key)) continue
    try {
      const url = await imageUrl(world.access, l.imageId!, 'full')
      if (map !== m) return
      overlayLayers.get(l.id)?.layer.remove()
      const layer = L.imageOverlay(url, bounds(), { pane: 'dwOverlay', opacity: l.opacity, zIndex: 10 + l.order, interactive: false }).addTo(m)
      overlayLayers.set(l.id, { layer, imageId: l.imageId! })
    } catch (e) {
      overlayFailed.add(key)
      console.warn('map layer', e)
    }
  }
}

function toggleLayer(id: string) {
  layerOn.value = { ...layerOn.value, [id]: layerOn.value[id] === false }
}

// ---------- markers on the map ----------
const thumbLoading = new Set<string>()
function loadThumb(id: string, variant: 'thumb' | 'full') {
  const key = `${id}@${variant}`
  if (thumbLoading.has(key)) return
  thumbLoading.add(key)
  imageUrl(world.access, id, variant)
    .then((u) => { thumbUrls.value = { ...thumbUrls.value, [key]: u } })
    .catch(() => { thumbUrls.value = { ...thumbUrls.value, [key]: '' } })
}

/** Blob URL of the linked entity's picture for "entity picture" pins (null while loading / none). */
function thumbOf(m: MapMarker, entity = world.get(m.entityId)): string | null {
  if (m.shape !== 'marker' || resolveIcon(m.icon).kind !== 'entity' || !entity?.imageId) return null
  const variant = isZoomedCrop(cropOf(entity)) ? 'full' : 'thumb'
  const key = `${entity.imageId}@${variant}`
  if (!(key in thumbUrls.value)) loadThumb(entity.imageId, variant)
  return thumbUrls.value[key] || thumbUrls.value[`${entity.imageId}@thumb`] || null
}

function ctxOf(m: MapMarker): Ctx {
  const entity = world.get(m.entityId)
  return { entity, thumb: thumbOf(m, entity), editable: isEditing.value && mode.value === 'select', active: m.id === draftKey.value }
}

function buildLayer(m: MapMarker, c: Ctx): L.Layer {
  const title = markerTitle(m, c.entity)
  if (m.shape === 'circle' || m.shape === 'polygon') {
    const colour = safeColour(m.colour, DEFAULT_COLOUR)
    const style: L.PathOptions = {
      color: colour, weight: c.active ? 3 : 2, opacity: Math.min(1, m.opacity + 0.45), fillColor: colour, fillOpacity: m.opacity,
      dashArray: c.active ? '6 5' : undefined, className: 'dw-shape',
    }
    const layer = m.shape === 'circle'
      ? L.circle([m.lat, m.lng], { ...style, radius: Math.max(1, m.radius) })
      : L.polygon(m.points.map((p) => [p.lat, p.lng] as L.LatLngTuple), style)
    layer.bindTooltip(escapeHtml(title), { sticky: true, direction: 'top', className: 'dw-map-tip' })
    layer.on('click', (e: L.LeafletMouseEvent) => onLayerClick(m.id, e, true))
    return layer
  }
  const spec = m.shape === 'label'
    ? labelSpec({ text: title, colour: m.colour, fontColour: m.fontColour, size: m.size })
    : pinSpec({ colour: m.colour, fontColour: m.fontColour, size: m.size, icon: m.icon, imageUrl: c.thumb, crop: cropOf(c.entity) })
  const mk = L.marker([m.lat, m.lng], {
    icon: L.divIcon({ html: spec.html, className: 'dw-icon' + (c.active ? ' is-active' : ''), iconSize: spec.size, iconAnchor: spec.anchor }),
    draggable: c.editable, autoPan: true, keyboard: false, riseOnHover: true, opacity: Math.max(0.15, m.opacity),
  })
  if (m.shape === 'marker') mk.bindTooltip(escapeHtml(title), { direction: 'top', offset: [0, spec.top + 2], className: 'dw-map-tip' })
  mk.on('click', (e: L.LeafletMouseEvent) => onLayerClick(m.id, e, false))
  mk.on('dragstart', () => { if (activeId.value === m.id) popup?.close() })
  mk.on('dragend', () => onDragEnd(m.id, mk.getLatLng()))
  return mk
}

/** Diff the wanted markers against the Leaflet layers; a layer is rebuilt only when its look changed. */
function syncMarkers() {
  const m = map
  if (!m || !ready.value) return
  const want = new Map(mapItems.value.map((x) => [x.id, x]))
  for (const [id, rec] of markerLayers) {
    if (!want.has(id)) { rec.layer.remove(); markerLayers.delete(id) }
  }
  for (const mk of want.values()) {
    const c = ctxOf(mk)
    const sig = JSON.stringify([mk.shape, mk.lat, mk.lng, mk.points, mk.radius, mk.icon, mk.colour, mk.fontColour, mk.opacity, mk.size, mk.name,
      c.entity?.name ?? '', c.thumb, cropOf(c.entity), c.editable, c.active])
    const rec = markerLayers.get(mk.id)
    if (rec?.sig === sig) continue
    rec?.layer.remove()
    markerLayers.set(mk.id, { layer: buildLayer(mk, c).addTo(m), sig })
  }
  syncHandles()
  syncPopup()
}

/** `bubbles`: shapes pass their clicks on to the map; Leaflet markers (pins, labels) do not. */
function onLayerClick(id: string, e: L.LeafletMouseEvent, bubbles: boolean) {
  if (mode.value !== 'select') {
    // placing / drawing on top of an existing mark: put the new one there (shapes already reach the map; a pin
    // would swallow the click — with a finger it is easy to hit one)
    if (!bubbles) { L.DomEvent.stopPropagation(e as unknown as Event); onMapClick(e) }
    return
  }
  L.DomEvent.stopPropagation(e as unknown as Event)
  if (id === DRAFT_ID || id === draftKey.value) return
  if (isEditing.value) openEditor(id)
  else openPopup(id, e.latlng)
}

function clampToMap(p: { lat: number; lng: number }): LatLng {
  const d = dims.value
  if (!d) return { lat: round2(p.lat), lng: round2(p.lng) }
  return { lat: round2(Math.min(d.h, Math.max(0, p.lat))), lng: round2(Math.min(d.w, Math.max(0, p.lng))) }
}

function onDragEnd(id: string, ll: L.LatLng) {
  const p = clampToMap(ll)
  if (id === draftKey.value) { patchDraft(p); return }
  markers.value = markers.value.map((m) => (m.id === id ? { ...m, ...p } : m)) // optimistic, the snapshot follows
  void world.saveRow('mapMarkers', { id, ...p })
}

function patchDraft(p: Partial<MarkerData>) {
  if (editDraft.value) editDraft.value = { ...editDraft.value, ...p }
}

// ---------- edit handles of the draft circle / polygon ----------
function handleMarker(ll: L.LatLngExpression, kind: 'move' | 'vertex' | 'mid' | 'radius', title: string): L.Marker {
  const s = kind === 'mid' ? 10 : 14
  return L.marker(ll, {
    icon: L.divIcon({ className: `dw-handle dw-handle-${kind}`, iconSize: [s, s] }),
    draggable: true, keyboard: false, zIndexOffset: 2000, title,
  })
}

function commitPoints(pts: LatLng[]) {
  const points = pts.map((p) => clampToMap(p))
  const c = centroid(points)
  patchDraft({ points, lat: round2(c.lat), lng: round2(c.lng) })
}

function syncHandles() {
  const g = handleGroup
  const d = editDraft.value
  const key = draftKey.value
  const layer = key ? markerLayers.get(key)?.layer ?? null : null
  const on = !!(g && d && layer && isEditing.value && mode.value === 'select' && (d.shape === 'circle' || d.shape === 'polygon'))
  const sig = on && d ? JSON.stringify([key, d.shape, d.lat, d.lng, d.radius, d.points]) : ''
  // keep the handles (and an ongoing drag) when nothing relevant changed
  if (sig === handlesSig && layer === handlesLayer) return
  handlesSig = sig
  handlesLayer = layer
  g?.clearLayers()
  if (!on || !g || !d) return

  if (d.shape === 'circle' && layer instanceof L.Circle) {
    const circle = layer
    const center = handleMarker([d.lat, d.lng], 'move', 'Перетащите, чтобы переместить круг').addTo(g)
    const edge = handleMarker([d.lat, d.lng + d.radius], 'radius', 'Перетащите, чтобы изменить радиус').addTo(g)
    center.on('drag', () => {
      const c = center.getLatLng()
      circle.setLatLng(c)
      edge.setLatLng([c.lat, c.lng + circle.getRadius()])
    })
    center.on('dragend', () => patchDraft(clampToMap(center.getLatLng())))
    edge.on('drag', () => {
      const c = center.getLatLng(), p = edge.getLatLng()
      circle.setRadius(Math.max(1, Math.hypot(p.lat - c.lat, p.lng - c.lng)))
    })
    edge.on('dragend', () => patchDraft({ radius: round2(circle.getRadius()) }))
    return
  }

  if (d.shape === 'polygon' && layer instanceof L.Polygon && d.points.length >= 3) {
    const poly = layer
    const pts = d.points.map((p) => ({ ...p }))
    const redraw = (list: LatLng[]) => poly.setLatLngs(list.map((p) => [p.lat, p.lng] as L.LatLngTuple))
    const vertices: L.Marker[] = []
    const mids: L.Marker[] = []
    pts.forEach((p, i) => {
      const v = handleMarker([p.lat, p.lng], 'vertex', 'Перетащите вершину; правый щелчок — удалить').addTo(g)
      vertices.push(v)
      v.on('drag', () => { const ll = v.getLatLng(); pts[i] = { lat: ll.lat, lng: ll.lng }; redraw(pts) })
      v.on('dragend', () => commitPoints(pts))
      v.on('contextmenu', (e: L.LeafletMouseEvent) => {
        L.DomEvent.preventDefault(e.originalEvent)
        if (pts.length <= 3) { toast.info('У области должно быть не меньше трёх вершин'); return }
        commitPoints(pts.filter((_, j) => j !== i))
      })
    })
    // points in the middle of the edges: click or drag one to insert a vertex
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]
      const mid = handleMarker([(p.lat + q.lat) / 2, (p.lng + q.lng) / 2], 'mid', 'Щёлкните или потяните, чтобы добавить вершину').addTo(g)
      mids.push(mid)
      const insert = () => {
        const ll = mid.getLatLng()
        const next = [...pts]
        next.splice(i + 1, 0, { lat: ll.lat, lng: ll.lng })
        commitPoints(next)
      }
      mid.on('click', insert)
      mid.on('dragend', insert)
    })
    // whole-polygon move
    const c0 = centroid(pts)
    const mv = handleMarker([c0.lat, c0.lng], 'move', 'Перетащите, чтобы переместить область').addTo(g)
    const shifted = () => {
      const ll = mv.getLatLng()
      return pts.map((p) => ({ lat: p.lat + ll.lat - c0.lat, lng: p.lng + ll.lng - c0.lng }))
    }
    mv.on('drag', () => {
      const s = shifted()
      redraw(s)
      vertices.forEach((v, i) => v.setLatLng([s[i].lat, s[i].lng]))
      mids.forEach((h) => h.remove())
    })
    mv.on('dragend', () => commitPoints(shifted()))
  }
}

// ---------- popup ----------
function popupAnchor(m: MapMarker, at?: L.LatLng): { ll: L.LatLng; offsetY: number } {
  // the popup tip touches its point with offset y = 7 (Leaflet default)
  if (m.shape === 'marker') return { ll: L.latLng(m.lat, m.lng), offsetY: 7 - pinBox(m.size, !!thumbOf(m)).h }
  if (m.shape === 'label') return { ll: L.latLng(m.lat, m.lng), offsetY: 7 - Math.round(labelFontSize(m.size) * 0.8) }
  if (at) return { ll: at, offsetY: 7 }
  if (m.shape === 'polygon' && m.points.length >= 3) {
    const c = centroid(m.points)
    return { ll: L.latLng(c.lat, c.lng), offsetY: 7 }
  }
  return { ll: L.latLng(m.lat, m.lng), offsetY: 7 }
}

function openPopup(id: string, at?: L.LatLng) {
  const m = markers.value.find((x) => x.id === id)
  if (!m || !map || !popup) return
  const a = popupAnchor(m, at)
  activeId.value = id
  popup.options.offset = L.point(0, a.offsetY)
  popup.setLatLng(a.ll).openOn(map)
  markerLayers.get(id)?.layer.closeTooltip()
  // content is rendered by Vue on the next tick: re-measure the popup then
  void nextTick(() => { if (popup?.isOpen()) popup.update() })
}

/** Keep the open popup in sync with its marker (moved by drag / another user, deleted, hidden). */
function syncPopup() {
  if (!activeId.value || !popup?.isOpen()) return
  const m = markers.value.find((x) => x.id === activeId.value)
  if (!m || hiddenGroups.value.has(groupKey(m))) { popup.close(); return }
  if (m.shape !== 'marker' && m.shape !== 'label') return
  const a = popupAnchor(m)
  if (!popup.getLatLng()?.equals(a.ll)) {
    popup.options.offset = L.point(0, a.offsetY)
    popup.setLatLng(a.ll)
  }
}

// ---------- focusing ----------
function focusMarker(id: string, opts: { animate?: boolean; edit?: boolean } = {}) {
  const m = markers.value.find((x) => x.id === id)
  const lm = map
  if (!m || !lm || !ready.value) return
  const key = groupKey(m)
  if (hiddenGroups.value.has(key)) toggleGroup(key)
  const animate = opts.animate !== false
  const after = () => { if (opts.edit && isEditing.value) openEditor(id); else openPopup(id) }
  let target: L.LatLngBounds | null = null
  if (m.shape === 'polygon' && m.points.length >= 3) target = L.latLngBounds(m.points.map((p) => [p.lat, p.lng] as L.LatLngTuple))
  else if (m.shape === 'circle') target = L.latLngBounds([m.lat - m.radius, m.lng - m.radius], [m.lat + m.radius, m.lng + m.radius])
  const fz = fitZoom() ?? lm.getZoom()
  if (target) {
    const o = { padding: L.point(40, 40), maxZoom: fz + 3 }
    if (animate) lm.flyToBounds(target, { ...o, duration: 0.7 }); else lm.fitBounds(target, { ...o, animate: false })
  } else {
    const z = Math.min(lm.getMaxZoom(), Math.max(lm.getZoom(), fz + 1.5))
    if (animate) lm.flyTo([m.lat, m.lng], z, { duration: 0.7 }); else lm.setView([m.lat, m.lng], z, { animate: false })
  }
  if (animate) lm.once('moveend', () => { void nextTick(after) })
  else void nextTick(after)
}

function onListFocus(id: string) {
  focusMarker(id)
  if (window.matchMedia('(max-width: 860px)').matches) stageEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function onListEdit(id: string) {
  focusMarker(id, { edit: true })
}

function toggleGroup(key: string) {
  const s = new Set(hiddenGroups.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  hiddenGroups.value = s
}

// ---------- placing & drawing ----------
function setMode(m: Mode) {
  mode.value = mode.value === m && m !== 'select' ? 'select' : m
}

function onMapClick(e: L.LeafletMouseEvent) {
  if (mode.value === 'select') { popup?.close(); return }
  if (!isEditing.value) return
  const p = clampToMap(e.latlng)
  if (mode.value === 'polygon') addDrawPoint(p)
  else startNew(mode.value, p)
}

function addDrawPoint(p: LatLng) {
  const pts = drawPoints.value
  const lm = map
  if (lm && pts.length) {
    const px = lm.latLngToContainerPoint([p.lat, p.lng])
    const near = (q: LatLng, r: number) => lm.latLngToContainerPoint([q.lat, q.lng]).distanceTo(px) <= r
    if (pts.length >= 3 && near(pts[0], 10)) { finishPolygon(); return }
    if (near(pts[pts.length - 1], 4)) return // second click of a double click / jitter
  }
  drawPoints.value = [...pts, p]
}

function onMapDblClick() {
  if (mode.value === 'polygon') finishPolygon()
}

function onMapMove(e: L.LeafletMouseEvent) {
  if (mode.value !== 'polygon' || !rubber || !drawPoints.value.length) return
  const last = drawPoints.value[drawPoints.value.length - 1]
  rubber.setLatLngs([[last.lat, last.lng], e.latlng])
}

function renderDraw() {
  const g = drawGroup
  if (!g) return
  g.clearLayers()
  rubber = null
  const pts = drawPoints.value
  if (mode.value !== 'polygon' || !pts.length) return
  const lls = pts.map((p) => [p.lat, p.lng] as L.LatLngTuple)
  L.polyline(lls, { color: '#d4ad4a', weight: 2, className: 'dw-draw', interactive: false }).addTo(g)
  const last = lls[lls.length - 1]
  rubber = L.polyline([last, last], { color: '#d4ad4a', weight: 1.5, dashArray: '5 5', className: 'dw-draw', interactive: false }).addTo(g)
  pts.forEach((p, i) => {
    const first = i === 0
    const v = L.circleMarker([p.lat, p.lng], {
      radius: first ? 7 : 5, weight: 2, color: '#d4ad4a', fillColor: '#ffffff', fillOpacity: 1,
      className: first ? 'dw-draw-vertex is-first' : 'dw-draw-vertex', interactive: first, bubblingMouseEvents: false,
    }).addTo(g)
    if (first) v.on('click', () => { if (drawPoints.value.length >= 3) finishPolygon() })
  })
}

function finishPolygon() {
  const pts = drawPoints.value
  if (pts.length < 3) { toast.info('Поставьте хотя бы три точки'); return }
  drawPoints.value = []
  startNew('polygon', centroid(pts), pts)
}

function undoPoint() {
  drawPoints.value = drawPoints.value.slice(0, -1)
}

// ---------- editor ----------
function startNew(shape: MarkerShape, at: LatLng, points: LatLng[] = []) {
  mode.value = 'select'
  if (!confirmDiscard()) return
  editDraft.value = {
    mapId: props.entity.id,
    groupId: lastGroupId && groupIds.value.has(lastGroupId) ? lastGroupId : null,
    entityId: null, name: '', lat: round2(at.lat), lng: round2(at.lng), shape, icon: '',
    colour: DEFAULT_COLOUR, fontColour: DEFAULT_FONT, opacity: shape === 'circle' || shape === 'polygon' ? AREA_OPACITY : 1,
    size: DEFAULT_SIZE, radius: defaultRadius.value, points, html: '', isDraggable: true,
    ...inheritVisibility(props.entity, world.isMaster),
  }
  editOriginal = ''
  editHtmlDirty.value = false
  editKey.value++
  sideOpen.value = true
  popup?.close()
}

function openEditor(id: string) {
  if (draftKey.value === id) return
  const m = markers.value.find((x) => x.id === id)
  if (!m || !confirmDiscard()) return
  const d = toData(m)
  editDraft.value = d
  editOriginal = JSON.stringify(d)
  editHtmlDirty.value = false
  editKey.value++
  sideOpen.value = true
  popup?.close()
}

function isDirty() {
  return !!editDraft.value && (editHtmlDirty.value || JSON.stringify(editDraft.value) !== editOriginal)
}
function confirmDiscard() {
  return !isDirty() || window.confirm('Отменить несохранённые изменения метки?')
}
function closeEditor() {
  editDraft.value = null
  editOriginal = ''
  editHtmlDirty.value = false
}
function onEditorSaved() {
  lastGroupId = editDraft.value?.groupId ?? null
  closeEditor()
}

function toggleEdit() {
  if (editOn.value && isDirty() && !window.confirm('Отменить несохранённые изменения метки?')) return
  editOn.value = !editOn.value
}

// ---------- toolbar actions ----------
// (an embedded map stops re-fitting itself on resize once the viewer zooms; «Показать всю карту» brings that back)
function zoomIn() { autoFit = false; map?.zoomIn() }
function zoomOut() { autoFit = false; map?.zoomOut() }
function fitAll() {
  autoFit = true
  if (map && dims.value) map.flyToBounds(bounds(), { duration: 0.5 })
}

async function onBaseFiles(files: File[]) {
  if (!files.length) return
  busy.value = true
  try {
    const [meta] = await gallery.upload(files.slice(0, 1), { folder: 'Карты' })
    if (meta) await setBaseImage(meta.id)
  } catch (e: any) {
    toast.error('Не удалось загрузить изображение: ' + (e?.message ?? e))
  } finally {
    busy.value = false
  }
}
async function onBasePick(id: string) {
  busy.value = true
  try {
    await setBaseImage(id)
  } catch (e: any) {
    toast.error('Не удалось применить изображение: ' + (e?.message ?? e))
  } finally {
    busy.value = false
  }
}
async function clearBaseImage() {
  if (markers.value.length && !window.confirm('Убрать изображение карты? Метки останутся и снова появятся, когда вы выберете новое изображение.')) return
  const f = { ...(props.entity.fields ?? {}) }
  delete f.mapImageId
  delete f.mapDimsFor
  const patch: Partial<Entity> = { fields: f }
  if (props.entity.imageId && props.entity.imageId === mainImageId.value && !props.entity.fields?.mapImageId) patch.imageId = null
  await world.updateEntity(props.entity.id, patch)
  imageDialog.value = false
}

/** Make an image the map's base; its natural size becomes the coordinate space. */
async function setBaseImage(id: string) {
  const nat = await naturalSize(await imageUrl(world.access, id, 'full'))
  const prev = storedDims()
  let d = nat
  if (prev && markers.value.length) {
    if (Math.abs(prev.w / prev.h - nat.w / nat.h) < 0.01) d = prev // same proportions: keep coordinates, markers stay in place
    else if (!window.confirm('Пропорции нового изображения отличаются от прежнего — метки могут оказаться не на своих местах. Продолжить?')) return
  }
  const f = props.entity.fields ?? {}
  await world.updateEntity(props.entity.id, {
    fields: { ...f, mapImageId: id, mapWidth: d.w, mapHeight: d.h, mapDimsFor: id },
    ...(props.entity.imageId ? {} : { imageId: id }),
  })
  // the store widens imageId only: make the map image as visible as the map
  void ensureImageAccess(world.access, [id], props.entity)
  toast.success('Изображение карты обновлено')
}

async function saveView() {
  if (!map) return
  const c = map.getCenter()
  await world.updateEntity(props.entity.id, {
    fields: { ...(props.entity.fields ?? {}), mapView: { lat: round2(c.lat), lng: round2(c.lng), zoom: round2(map.getZoom()) } },
  })
  toast.success('Карта будет открываться в текущем виде')
}

async function resetView() {
  const { mapView: _omit, ...rest } = props.entity.fields ?? {}
  await world.updateEntity(props.entity.id, { fields: rest })
  fitAll()
  toast.info('Сохранённый вид сброшен')
}

// ---------- keyboard ----------
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  if (document.querySelector('.modal-backdrop')) return
  if (e.key === 'Escape') {
    if (mode.value !== 'select') { mode.value = 'select'; e.preventDefault() }
    else if (fullscreen.value) { fullscreen.value = false; e.preventDefault() }
    else if (showLegend.value) showLegend.value = false
    return
  }
  if (mode.value === 'polygon') {
    if (e.key === 'Enter') { e.preventDefault(); finishPolygon() }
    else if (e.key === 'Backspace' || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undoPoint() }
  }
}

// ---------- watchers ----------
watch(() => props.entity.id, resetUi)
watch(() => [props.entity.id, world.wid, world.uid, world.role], subscribe, { immediate: true })

watch(mapEl, (el, old) => {
  if (old) destroyMap()
  if (el) initMap(el)
}, { flush: 'post' })

watch(() => [shownImageId.value, mainImageId.value, props.entity.fields?.mapWidth, props.entity.fields?.mapHeight, props.entity.fields?.mapDimsFor], () => {
  if (map) void loadBase()
})

watch(groups, (gs) => {
  // groups with "isShown = false" start hidden (once per viewer session)
  const next = new Set(hiddenGroups.value)
  let changed = false
  for (const g of gs) {
    if (seenGroups.has(g.id)) continue
    seenGroups.add(g.id)
    if (!g.isShown) { next.add(g.id); changed = true }
  }
  if (changed) hiddenGroups.value = next
})

watch(baseLayers, (bl) => {
  if (baseLayerId.value && !bl.some((l) => l.id === baseLayerId.value)) baseLayerId.value = null
})

watch([mapItems, ready, isEditing, mode, thumbUrls, () => world.entities], syncMarkers)
watch([overlays, layerOn, ready], () => { void syncOverlays() })
watch([drawPoints, mode], renderDraw)

watch(mode, (m, old) => {
  if (old === 'polygon') drawPoints.value = []
  if (map) { if (m === 'polygon') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable() }
  if (m !== 'select') popup?.close()
})

watch(isEditing, (on) => {
  if (on) {
    const id = props.entity.fields?.mapImageId
    if (id && canEditMap.value) void ensureImageAccess(world.access, [id], props.entity)
    return
  }
  if (isDirty()) toast.info('Несохранённые изменения метки отменены')
  closeEditor()
  mode.value = 'select'
})

watch([() => route.query.marker, ready, markersLoaded], () => {
  const q = typeof route.query.marker === 'string' ? route.query.marker : ''
  if (!q || q === focusedQuery || !ready.value || !markersLoaded.value) return
  focusedQuery = q
  focusMarker(q, { animate: false })
}, { immediate: true })

watch(fullscreen, (on) => { document.documentElement.classList.toggle('dw-map-noscroll', on) })

onMounted(() => {
  document.addEventListener('keydown', onKey)
  // async content (thumbnails, rich text) changes the popup height: re-run Leaflet's layout / auto-pan
  let lastH = 0
  popupRo = new ResizeObserver(() => {
    const h = popupEl.offsetHeight
    if (Math.abs(h - lastH) > 1 && popup?.isOpen()) popup.update()
    lastH = h
  })
  popupRo.observe(popupEl)
})

onBeforeUnmount(() => {
  stopRows.forEach((s) => s())
  stopRows = []
  document.removeEventListener('keydown', onKey)
  document.documentElement.classList.remove('dw-map-noscroll')
  popupRo?.disconnect()
  destroyMap()
})
</script>

<template>
  <div class="dw-map" :class="{ 'is-fs': fullscreen, 'is-embedded': embedded && !fullscreen }">
    <!-- no image yet -->
    <div v-if="!mainImageId" class="dw-empty">
      <Icon name="map" :size="44" />
      <p class="dw-empty-title">У карты пока нет изображения</p>
      <template v-if="editing">
        <p class="muted small">Загрузите рисунок карты (JPG, PNG, WebP) или выберите его из галереи. Метки ставятся в координатах его пикселей.</p>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="imageDialog = true">
          <Icon :name="busy ? 'refresh-cw' : 'upload'" :size="16" :class="{ spin: busy }" /> {{ busy ? 'Загрузка…' : 'Загрузить изображение карты' }}
        </button>
      </template>
    </div>

    <template v-else>
      <div v-if="editing" class="dw-tools" role="toolbar" aria-label="Инструменты карты">
        <button type="button" class="dw-tool dw-edit-toggle" :class="{ on: editOn }" :aria-pressed="editOn" title="Включить или выключить правку карты" @click="toggleEdit">
          <Icon name="pencil" :size="16" /> <span class="dw-tool-label">{{ editOn ? 'Правка включена' : 'Правка' }}</span>
        </button>
        <template v-if="editOn">
          <span class="dw-sep" />
          <button v-for="t in TOOLS" :key="t.mode" type="button" class="dw-tool" :class="{ on: mode === t.mode }" :title="t.title" @click="setMode(t.mode)">
            <Icon :name="t.icon" :size="16" /> <span class="dw-tool-label">{{ t.label }}</span>
          </button>
          <span class="dw-sep" />
          <button type="button" class="dw-tool" title="Слои карты" @click="manageTab = 'layers'"><Icon name="layers" :size="16" /> <span class="dw-tool-label">Слои</span></button>
          <button type="button" class="dw-tool" title="Группы меток" @click="manageTab = 'groups'"><Icon name="folder" :size="16" /> <span class="dw-tool-label">Группы</span></button>
          <span class="grow" />
          <Dropdown placement="bottom-end">
            <template #trigger>
              <button type="button" class="dw-tool" title="Ещё"><Icon name="more-horizontal" :size="16" /></button>
            </template>
            <div class="menu">
              <button type="button" class="menu-item" @click="imageDialog = true"><Icon name="image" :size="16" /> Сменить изображение карты…</button>
              <button type="button" class="menu-item" @click="saveView"><Icon name="eye" :size="16" /> Открывать карту в текущем виде</button>
              <button v-if="entity.fields?.mapView" type="button" class="menu-item" @click="resetView"><Icon name="rotate-ccw" :size="16" /> Сбросить сохранённый вид</button>
            </div>
          </Dropdown>
        </template>
        <span v-else class="muted small dw-tools-hint">Включите правку, чтобы ставить и двигать метки, рисовать области и управлять слоями.</span>
      </div>

      <div class="dw-body">
        <!-- the placing class lives on the stage: Vue rewrites the whole className of an element with :class, and
             Leaflet keeps its own classes (leaflet-container…) on mapEl — losing them collapsed the map image -->
        <div ref="stageEl" class="dw-stage" :class="{ 'is-placing': mode !== 'select' }">
          <div ref="mapEl" class="dw-canvas" />

          <div class="dw-ctrl">
            <button type="button" title="Приблизить" @click="zoomIn"><Icon name="zoom-in" :size="17" /></button>
            <button type="button" title="Отдалить" @click="zoomOut"><Icon name="zoom-out" :size="17" /></button>
            <button type="button" title="Показать всю карту" @click="fitAll"><Icon name="locate" :size="17" /></button>
            <span class="dw-ctrl-gap" />
            <button type="button" :class="{ on: showLegend }" title="Легенда: группы и слои" @click="showLegend = !showLegend"><Icon name="layers" :size="17" /></button>
            <button type="button" :class="{ on: fullscreen }" :title="fullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'" @click="fullscreen = !fullscreen">
              <Icon :name="fullscreen ? 'minimize2' : 'maximize2'" :size="17" />
            </button>
            <button v-if="!embedded || fullscreen" type="button" class="dw-ctrl-side" :class="{ on: sideOpen || !!editDraft }" title="Список меток" @click="sideOpen = !sideOpen">
              <Icon name="panel-right-open" :size="17" />
            </button>
          </div>

          <MapLegend v-if="showLegend" class="dw-legend" :groups="legendGroups" :overlays="overlays" :bases="baseLayers" :hidden="hiddenGroups"
            :layer-on="layerOn" :base-layer-id="baseLayerId" :editing="isEditing"
            @toggle-group="toggleGroup" @toggle-layer="toggleLayer" @set-base="baseLayerId = $event" @manage="manageTab = $event" @close="showLegend = false" />

          <div v-if="mode !== 'select'" class="dw-hint">
            <template v-if="mode === 'polygon'">
              <span>Точек: {{ drawPoints.length }}. Щёлкайте по карте, чтобы ставить вершины; завершить — щелчок по первой точке, двойной щелчок или Enter.</span>
              <span class="row gap-sm">
                <button type="button" class="btn btn-sm btn-primary" :disabled="drawPoints.length < 3" @click="finishPolygon"><Icon name="check" :size="15" /> Готово</button>
                <button type="button" class="btn btn-sm" title="Убрать последнюю точку" :disabled="!drawPoints.length" @click="undoPoint"><Icon name="undo2" :size="15" /></button>
                <button type="button" class="btn btn-sm btn-ghost" @click="mode = 'select'">Отмена</button>
              </span>
            </template>
            <template v-else>
              <span>{{ PLACE_HINT[mode] }}</span>
              <button type="button" class="btn btn-sm btn-ghost" @click="mode = 'select'">Отмена</button>
            </template>
          </div>

          <div v-if="imgState === 'loading'" class="dw-status"><Icon name="refresh-cw" :size="14" class="spin" /> Загрузка карты…</div>
          <div v-else-if="imgState === 'error'" class="dw-status is-error">
            <Icon name="triangle-alert" :size="14" /> Изображение карты недоступно
            <button v-if="isEditing" type="button" class="btn btn-sm" @click="imageDialog = true">Заменить</button>
          </div>
        </div>

        <aside v-if="!embedded || fullscreen" class="dw-side" :class="{ wide: !!editDraft, collapsed: !sideOpen && !editDraft }">
          <button type="button" class="dw-side-head" :aria-expanded="sideOpen || !!editDraft" @click="sideOpen = !sideOpen">
            <Icon name="map-pin" :size="15" />
            <span class="grow">Метки <span class="faint">({{ markers.length }})</span></span>
            <Icon :name="sideOpen || editDraft ? 'chevron-up' : 'chevron-down'" :size="16" />
          </button>
          <div class="dw-side-main">
            <MarkerEditor v-if="editDraft" :key="editKey" :draft="editDraft" :groups="groups" :default-radius="defaultRadius"
              @update:draft="editDraft = $event" @dirty="editHtmlDirty = true" @close="closeEditor" @saved="onEditorSaved" @deleted="closeEditor" />
            <MarkerList v-else :items="listItems" :groups="groups" :hidden="hiddenGroups" :editing="isEditing" :active-id="activeId"
              @focus="onListFocus" @edit="onListEdit" @toggle="toggleGroup" />
          </div>
        </aside>
      </div>
    </template>

    <Teleport :to="popupEl">
      <MarkerPopup v-if="activeMarker" :marker="activeMarker" :map-id="entity.id" :editing="isEditing" @edit="openEditor" />
    </Teleport>

    <ImageModal
      v-if="imageDialog"
      title="Изображение карты"
      :image-id="mainImageId"
      :has-image="!!mainImageId"
      :allow-crop="false"
      :allow-url="false"
      :allow-delete="!!mainImageId"
      remove-label="Убрать изображение карты"
      @close="imageDialog = false"
      @files="onBaseFiles"
      @pick="onBasePick"
      @remove="clearBaseImage"
    />
    <MapManageModal v-if="manageTab" :entity="entity" :layers="layers" :groups="groups" :markers="markers" :tab="manageTab" @close="manageTab = null" />
  </div>
</template>

<style scoped>
.dw-map { display: flex; flex-direction: column; gap: 8px; }
.dw-map.is-fs { position: fixed; inset: 0; z-index: 150; padding: 8px; background: var(--bg); }

.dw-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; text-align: center;
  border: 2px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface); color: var(--text-muted); }
.dw-empty > .icon { color: var(--text-faint); }
.dw-empty p { margin: 0; max-width: 480px; }
.dw-empty-title { font-family: var(--font-head); font-size: 21px; font-weight: 600; color: var(--text); }

.dw-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.dw-tool { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid transparent; border-radius: 6px; background: none;
  color: var(--text-muted); cursor: pointer; font-size: 13.5px; white-space: nowrap; }
.dw-tool:hover { background: var(--surface-2); color: var(--text); }
.dw-tool.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.dw-edit-toggle.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.dw-sep { width: 1px; align-self: stretch; margin: 2px 4px; background: var(--border); }
.dw-tools-hint { padding: 0 8px; }

.dw-body { display: flex; gap: 10px; align-items: stretch; }
/* embedded: the map takes the whole box it is given */
.dw-map.is-embedded { height: 100%; gap: 0; }
.dw-map.is-embedded .dw-body { flex: 1 1 auto; min-height: 0; height: 100%; }
.dw-map.is-embedded .dw-stage { height: 100%; min-height: 160px; }
.is-fs .dw-body { flex: 1 1 auto; min-height: 0; }
.dw-stage { position: relative; flex: 1 1 auto; min-width: 0; height: 70vh; min-height: 380px; overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.is-fs .dw-stage { height: auto; min-height: 0; }
/* own stacking context: Leaflet's z-indexes stay below the controls drawn over the map */
.dw-canvas { position: absolute; inset: 0; z-index: 0; }
.dw-stage.is-placing .dw-canvas, .dw-stage.is-placing .dw-canvas :deep(.leaflet-interactive) { cursor: crosshair; }

.dw-ctrl { position: absolute; left: 10px; top: 10px; z-index: 2; display: flex; flex-direction: column; gap: 4px; }
.dw-ctrl button { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;
  border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
.dw-ctrl button:hover { border-color: var(--accent); color: var(--accent); }
.dw-ctrl button.on { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
.dw-ctrl-gap { height: 4px; }

.dw-legend { position: absolute; right: 10px; top: 10px; z-index: 3; width: 280px; max-width: calc(100% - 64px); max-height: calc(100% - 20px); }

.dw-hint { position: absolute; left: 50%; bottom: 14px; z-index: 3; transform: translateX(-50%); width: max-content; max-width: calc(100% - 24px);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 12px; padding: 8px 12px; font-size: 13px;
  background: var(--surface); border: 1px solid var(--accent); border-radius: var(--radius); box-shadow: var(--shadow-lg);
  /* the hint covers the bottom of the map: clicks on its text still reach the map (only its buttons are buttons) */
  pointer-events: none; opacity: .94; }
.dw-hint button { pointer-events: auto; }

.dw-status { position: absolute; left: 50%; top: 12px; z-index: 2; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 12px; border-radius: 999px; font-size: 13px; color: var(--text-muted); background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
.dw-status.is-error { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 50%, transparent); }

.dw-side { flex: 0 0 300px; width: 300px; height: 70vh; min-height: 380px; display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.dw-side.wide { flex-basis: 360px; width: 360px; }
.dw-side.collapsed { display: none; }
.is-fs .dw-side { height: auto; min-height: 0; }
.dw-side-head { display: none; }
.dw-side-main { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }

@media (max-width: 860px) {
  .dw-body { flex-direction: column; }
  .dw-stage { height: 62vh; min-height: 300px; }
  .is-fs .dw-stage { flex: 1 1 auto; }
  .dw-side, .dw-side.wide { flex: none; width: auto; height: auto; min-height: 0; }
  .is-fs .dw-side { max-height: 45vh; }
  .dw-side.collapsed { display: flex; }
  .dw-side.collapsed .dw-side-main { display: none; }
  .dw-side-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--border);
    background: none; color: var(--text); font-weight: 600; text-align: left; cursor: pointer; }
  .dw-side-main :deep(.ml-scroll) { max-height: 50vh; }
  .dw-ctrl-side { display: none !important; }
  .dw-tool-label, .dw-tools-hint { display: none; }
}
</style>

<style>
/* Leaflet internals and div-icon HTML are created outside Vue, so these rules are global, prefixed with .dw-map. */
html.dw-map-noscroll { overflow: hidden; }
.dw-map .leaflet-container { background: var(--surface-2); font-family: var(--font-ui); font-size: 14px; outline: none; }
.dw-map .leaflet-container a { color: var(--link); }
.dw-map .dw-base-img { box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-lg); }

.dw-map .leaflet-popup-content-wrapper { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-lg); }
.dw-map .leaflet-popup-tip { background: var(--surface); box-shadow: 0 0 0 1px var(--border); }
.dw-map .leaflet-popup-content { margin: 12px 14px 10px; line-height: 1.45; }
.dw-map .leaflet-popup-content p { margin: 0 0 .5em; }
.dw-map .leaflet-container a.leaflet-popup-close-button { color: var(--text-faint); top: 4px; right: 4px; }
.dw-map .leaflet-container a.leaflet-popup-close-button:hover { color: var(--text); }

.dw-map .leaflet-tooltip.dw-map-tip { background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); border-radius: 6px;
  box-shadow: var(--shadow); font: 600 13px/1.3 var(--font-ui); padding: 3px 8px; }
.dw-map .leaflet-tooltip-top.dw-map-tip::before { border-top-color: var(--border-strong); }
.dw-map .leaflet-tooltip-bottom.dw-map-tip::before { border-bottom-color: var(--border-strong); }
.dw-map .leaflet-tooltip-left.dw-map-tip::before { border-left-color: var(--border-strong); }
.dw-map .leaflet-tooltip-right.dw-map-tip::before { border-right-color: var(--border-strong); }

/* pins (never transform the .leaflet-marker-icon element itself: Leaflet positions it with transforms) */
.dw-map .dw-icon { background: none; border: 0; }
.dw-map .dw-pin { position: relative; transform-origin: 50% 100%; transition: transform .12s ease; filter: drop-shadow(0 2px 2px rgb(0 0 0 / 45%)); }
.dw-map .dw-icon:hover .dw-pin { transform: scale(1.1); }
.dw-map .dw-icon.is-active .dw-pin, .dw-map .dw-icon.is-active .dw-label { filter: drop-shadow(0 0 3px var(--accent)) drop-shadow(0 0 6px var(--accent)); }
.dw-map .dw-pin-shape { display: block; width: 100%; height: 100%; overflow: visible; }
.dw-map .dw-pin-shape path { fill: var(--pin); stroke: rgb(0 0 0 / 35%); stroke-width: 1.4; }
.dw-map .dw-pin-glyph { position: absolute; left: 50%; top: 36%; width: 56%; aspect-ratio: 1; transform: translate(-50%, -50%);
  display: flex; align-items: center; justify-content: center; color: var(--pin-fg); pointer-events: none; }
.dw-map .dw-pin-glyph svg { width: 100%; height: 100%; display: block; }
.dw-map .dw-pin-dot { width: 40%; height: 40%; border-radius: 50%; background: var(--pin-fg); }
.dw-map .dw-pin-img { position: absolute; left: 0; top: 0; width: 100%; aspect-ratio: 1; border-radius: 50%; border: 3px solid var(--pin); background: var(--pin); overflow: hidden; }
.dw-map .dw-pin-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dw-map .dw-pin-avatar::after { content: ''; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 10px solid var(--pin); }

/* text labels */
.dw-map .dw-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); white-space: nowrap; padding: .12em .5em; border-radius: 4px;
  background: var(--lbl-bg); color: var(--lbl-fg); font-family: var(--font-head); font-weight: 700; line-height: 1.2; letter-spacing: .02em;
  box-shadow: 0 1px 3px rgb(0 0 0 / 35%); cursor: pointer; }
.dw-map .dw-label.no-bg { background: none; box-shadow: none; text-shadow: 0 0 3px rgb(0 0 0 / 85%), 0 0 1px rgb(0 0 0 / 90%); }

/* edit handles and polygon drawing */
.dw-map .dw-handle { background: var(--surface); border: 2px solid var(--accent); border-radius: 50%; box-shadow: 0 1px 3px rgb(0 0 0 / 45%); cursor: grab; }
.dw-map .dw-handle-move { background: var(--accent); border-color: var(--surface); border-radius: 3px; cursor: move; }
.dw-map .dw-handle-radius { background: var(--accent); }
.dw-map .dw-handle-mid { opacity: .75; border-width: 1.5px; }
.dw-map path.dw-draw { stroke: var(--accent); }
.dw-map path.dw-draw-vertex { stroke: var(--accent); fill: var(--surface); }
.dw-map path.dw-draw-vertex.is-first { fill: var(--accent); cursor: pointer; }
</style>
