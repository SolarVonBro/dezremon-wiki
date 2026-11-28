<script setup lang="ts">
// Unified image editor modal: upload / pick from gallery / URL, focal point + zoom framing, and removal in one place.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import { useWorld } from '@/stores/world'
import { useGallery } from '@/stores/gallery'
import { imageUrl } from '@/data/images'
import { DEFAULT_CROP, cropStyle, type ImageCrop } from '@/data/crop'

export type CropKind = 'entity' | 'header' | 'background' | 'cover' | 'avatar' | 'portrait' | 'emblem' | 'block'

export interface ImageSavePayload {
  /** Newly chosen local file (not yet uploaded), or null when keeping/picking from gallery. */
  file: File | null
  /** Gallery image id (new or unchanged), or null when uploading a local file or working without a gallery. */
  imageId: string | null
  /** True when the user chose a different image than the one initially shown. */
  changed: boolean
  /** Framing (null = default centred 1×). */
  crop: ImageCrop | null
}

const props = withDefaults(defineProps<{
  title?: string
  /** Current world gallery image id (when editing a world image slot). */
  imageId?: string | null
  /** Current direct image URL / data URL (for local avatars, PF2e portraits, draft previews, legacy covers). */
  src?: string | null
  /** Optional async loader for the current source + crop (e.g. account avatar source from Firestore). */
  loadSrc?: (() => Promise<{ src: string | null; crop?: ImageCrop | null } | null>) | null
  /** Explicit flag for whether an image currently exists (defaults to imageId or src being set). */
  hasImage?: boolean
  initialCrop?: ImageCrop | null
  kind?: CropKind
  allowCrop?: boolean
  allowGallery?: boolean
  allowUrl?: boolean
  allowDelete?: boolean
  multiple?: boolean
  removeLabel?: string
  busy?: boolean
  /** Optional informational/warning note shown inside the framing tab. */
  hint?: string
}>(), {
  title: 'Изображение',
  imageId: null,
  src: null,
  loadSrc: null,
  hasImage: undefined,
  initialCrop: null,
  kind: 'entity',
  allowCrop: true,
  allowGallery: true,
  allowUrl: false,
  allowDelete: true,
  multiple: false,
  removeLabel: 'Убрать',
  busy: false,
  hint: '',
})

const emit = defineEmits<{
  close: []
  save: [payload: ImageSavePayload]
  remove: []
  /** Immediate-pick events when allowCrop is false (rich editor, maps). */
  files: [files: File[]]
  pick: [imageId: string]
  url: [url: string]
}>()

const world = useWorld()
const gallery = useGallery()

const hasExisting = computed(() => props.hasImage ?? !!(props.imageId || props.src))
const pendingFile = ref<File | null>(null)
const pendingImageId = ref<string | null>(null)
const pendingObjectUrl = ref<string | null>(null)
const loadedUrl = ref<string | null>(null)
const loadingUrl = ref(false)
const missingSource = ref(false)
const crop = ref<ImageCrop>({ ...(props.initialCrop ?? DEFAULT_CROP) })

const hasActive = computed(() => !!(pendingFile.value || pendingImageId.value || hasExisting.value))
const activeGalleryId = computed(() => (pendingFile.value ? null : pendingImageId.value ?? props.imageId ?? null))
const previewUrl = computed(() => pendingObjectUrl.value || loadedUrl.value)

type Tab = 'crop' | 'upload' | 'gallery' | 'url'
const tab = ref<Tab>(props.allowCrop && hasExisting.value ? 'crop' : 'upload')

const q = ref('')
const folder = ref('')
const drag = ref(false)
const urlInput = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)

const shown = computed(() => gallery.list.filter((i) => (!folder.value || i.folder === folder.value) && (!q.value || i.name.toLowerCase().includes(q.value.toLowerCase()))))
const style = computed(() => cropStyle(crop.value))
const isDefaultCrop = computed(() => crop.value.x === 50 && crop.value.y === 50 && crop.value.zoom === 1)

const PREVIEWS = computed(() => {
  switch (props.kind) {
    case 'avatar':
      return [{ label: 'Кабинет', w: 120, h: 120, round: true }, { label: 'Списки', w: 64, h: 64, round: true }, { label: 'Меню и чат', w: 40, h: 40, round: true }]
    case 'portrait':
      return [{ label: 'Профиль', w: 112, h: 112, round: false }, { label: 'Карточка', w: 64, h: 64, round: false }, { label: 'Значок', w: 40, h: 40, round: true }]
    case 'cover':
      return [{ label: 'Страница игры', w: 260, h: 146, round: false }, { label: 'Карточка в списке', w: 280, h: 120, round: false }, { label: 'Строка', w: 72, h: 44, round: false }]
    case 'background':
      return [{ label: 'Широкий экран', w: 320, h: 180, round: false }, { label: 'Телефон', w: 104, h: 190, round: false }]
    case 'header':
      return [{ label: 'Обложка', w: 340, h: 104, round: false }, { label: 'Высокая обложка', w: 340, h: 170, round: false }]
    case 'emblem':
      return [{ label: 'Боковая панель', w: 64, h: 64, round: false }, { label: 'Настройки', w: 112, h: 112, round: false }, { label: 'Карточка мира', w: 260, h: 120, round: false }]
    case 'block':
      return [{ label: 'Широкий блок', w: 320, h: 160, round: false }, { label: 'Квадратный блок', w: 140, h: 140, round: false }]
    default:
      return [{ label: 'Аватар', w: 132, h: 132, round: false }, { label: 'Карточка в списке', w: 176, h: 132, round: false }, { label: 'Значок', w: 56, h: 56, round: true }, { label: 'Портрет', w: 100, h: 132, round: false }]
  }
})

let loadSeq = 0
async function loadGalleryImage(id: string) {
  const token = ++loadSeq
  loadingUrl.value = true
  missingSource.value = false
  try {
    const u = await imageUrl(world.access, id, 'full')
    if (token === loadSeq) loadedUrl.value = u
  } catch {
    if (token === loadSeq) { loadedUrl.value = props.src ?? null; if (!loadedUrl.value) missingSource.value = true }
  } finally {
    if (token === loadSeq) loadingUrl.value = false
  }
}

onMounted(async () => {
  if (props.allowGallery) void gallery.ensure()
  window.addEventListener('paste', onWindowPaste)
  if (!props.allowCrop || !hasExisting.value) return
  if (props.imageId) {
    await loadGalleryImage(props.imageId)
  } else if (props.loadSrc) {
    loadingUrl.value = true
    try {
      const res = await props.loadSrc()
      if (res?.src) {
        loadedUrl.value = res.src
        if (res.crop !== undefined) crop.value = { ...(res.crop ?? DEFAULT_CROP) }
      } else if (props.src) {
        loadedUrl.value = props.src
      } else {
        missingSource.value = true
      }
    } catch {
      loadedUrl.value = props.src ?? null
      if (!loadedUrl.value) missingSource.value = true
    } finally { loadingUrl.value = false }
  } else if (props.src) {
    loadedUrl.value = props.src
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', onWindowPaste)
  if (pendingObjectUrl.value) URL.revokeObjectURL(pendingObjectUrl.value)
})

watch(tab, (t) => {
  if (t === 'gallery' && props.allowGallery) void gallery.ensure()
})

function revokePending() {
  if (pendingObjectUrl.value) { URL.revokeObjectURL(pendingObjectUrl.value); pendingObjectUrl.value = null }
}

function takeFiles(list: FileList | null | undefined) {
  const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
  if (!files.length) return
  if (!props.allowCrop) {
    emit('files', props.multiple ? files : files.slice(0, 1))
    emit('close')
    return
  }
  const file = files[0]
  revokePending()
  pendingObjectUrl.value = URL.createObjectURL(file)
  pendingFile.value = file
  pendingImageId.value = null
  missingSource.value = false
  crop.value = { ...DEFAULT_CROP }
  tab.value = 'crop'
}

function pickFromGallery(id: string) {
  if (!props.allowCrop) {
    emit('pick', id)
    emit('close')
    return
  }
  revokePending()
  pendingFile.value = null
  pendingImageId.value = id
  crop.value = id === props.imageId ? { ...(props.initialCrop ?? DEFAULT_CROP) } : { ...DEFAULT_CROP }
  tab.value = 'crop'
  void loadGalleryImage(id)
}

function onDrop(e: DragEvent) { drag.value = false; takeFiles(e.dataTransfer?.files) }
function onWindowPaste(e: ClipboardEvent) {
  if (props.busy) return
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, select')) return
  const files = e.clipboardData?.files
  if (files?.length) takeFiles(files)
}

// ---------- focal point & zoom ----------
function setFrom(e: PointerEvent) {
  const r = imgEl.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return
  crop.value = {
    ...crop.value,
    x: Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10,
    y: Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10,
  }
}
function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  setFrom(e)
}
function move(e: PointerEvent) { if (e.buttons & 1) setFrom(e) }
function wheel(e: WheelEvent) {
  e.preventDefault()
  crop.value = { ...crop.value, zoom: Math.round(Math.min(4, Math.max(1, crop.value.zoom * Math.exp(-e.deltaY * 0.0015))) * 100) / 100 }
}
function key(e: KeyboardEvent) {
  const step = e.shiftKey ? 5 : 1
  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  if (!d[e.key]) return
  e.preventDefault()
  crop.value = { ...crop.value, x: Math.min(100, Math.max(0, crop.value.x + d[e.key][0])), y: Math.min(100, Math.max(0, crop.value.y + d[e.key][1])) }
}
function resetCrop() { crop.value = { ...DEFAULT_CROP } }

function commit() {
  if (props.busy || !previewUrl.value) return
  const value = isDefaultCrop.value ? null : { ...crop.value }
  const changed = !!pendingFile.value || (!!pendingImageId.value && pendingImageId.value !== props.imageId)
  emit('save', {
    file: pendingFile.value,
    imageId: pendingFile.value ? null : (pendingImageId.value ?? props.imageId ?? null),
    changed,
    crop: value,
  })
}

function submitUrl() {
  const u = urlInput.value.trim()
  if (!u) return
  emit('url', u)
  emit('close')
}
</script>

<template>
  <Modal :title="title" :width="allowCrop ? '960px' : '760px'" :closable="!busy" @close="emit('close')">
    <div class="tabs">
      <button v-if="allowCrop && hasActive" type="button" class="tab" :class="{ on: tab === 'crop' }" @click="tab = 'crop'">
        <Icon name="crosshair" :size="16" /> Фокус и масштаб
      </button>
      <button type="button" class="tab" :class="{ on: tab === 'upload' }" @click="tab = 'upload'">
        <Icon name="upload" :size="16" /> {{ hasExisting ? 'Загрузить новое' : 'Загрузить' }}
      </button>
      <button v-if="allowGallery" type="button" class="tab" :class="{ on: tab === 'gallery' }" @click="tab = 'gallery'">
        <Icon name="images" :size="16" /> Из галереи
      </button>
      <button v-if="allowUrl" type="button" class="tab" :class="{ on: tab === 'url' }" @click="tab = 'url'">
        <Icon name="link" :size="16" /> По ссылке
      </button>
    </div>

    <!-- ============ focus & zoom ============ -->
    <div v-if="tab === 'crop' && allowCrop" class="crop-wrap">
      <div class="crop-stage" tabindex="0" @keydown="key">
        <span v-if="previewUrl && !loadingUrl" class="crop-img" @pointerdown.prevent="down" @pointermove="move" @wheel="wheel">
          <img ref="imgEl" :src="previewUrl" alt="" draggable="false" />
          <span class="crop-dot" :style="{ left: crop.x + '%', top: crop.y + '%' }" />
        </span>
        <div v-else-if="missingSource" class="empty stack-sm" style="max-width: 320px">
          <Icon name="image" :size="30" />
          <p class="muted small" style="margin: 0">Исходник изображения не сохранился — загрузите новое во вкладке «Загрузить новое».</p>
          <div><button type="button" class="btn btn-sm" @click="tab = 'upload'"><Icon name="upload" :size="14" /> Загрузить новое</button></div>
        </div>
        <div v-else class="empty"><Icon name="refresh-cw" class="spin" /></div>
      </div>
      <aside class="crop-side">
        <div v-if="pendingFile" class="im-staged small">
          <Icon name="check" :size="14" /> Выбран файл: <b class="ellipsis">{{ pendingFile.name }}</b>
        </div>
        <div v-else-if="hint" class="im-hint small">
          <Icon name="triangle-alert" :size="14" /> <span>{{ hint }}</span>
        </div>
        <p class="muted small" style="margin: 0">Щёлкните или потяните по картинке, чтобы выбрать главный фокус — он останется видимым во всех рамках. Стрелки двигают точку, колесо мыши меняет масштаб.</p>
        <div class="field">
          <span class="row gap-sm">
            <span class="grow">Масштаб: {{ crop.zoom.toFixed(2) }}×</span>
            <button v-if="!isDefaultCrop" type="button" class="btn btn-sm btn-ghost im-reset" @click="resetCrop"><Icon name="rotate-ccw" :size="13" /> По центру</button>
          </span>
          <input v-model.number="crop.zoom" type="range" min="1" max="4" step="0.01" />
        </div>
        <div class="crop-previews">
          <div v-for="p in PREVIEWS" :key="p.label" class="crop-prev">
            <div class="crop-frame" :class="{ round: p.round }" :style="{ width: p.w + 'px', height: p.h + 'px' }">
              <img v-if="previewUrl" :src="previewUrl" alt="" :style="style" draggable="false" />
            </div>
            <span class="faint small">{{ p.label }}</span>
          </div>
        </div>
      </aside>
    </div>

    <!-- ============ upload ============ -->
    <div v-else-if="tab === 'upload'" class="dropzone" :class="{ drag }" tabindex="0"
      @dragover.prevent="drag = true" @dragleave="drag = false" @drop.prevent="onDrop" @click="fileInput?.click()">
      <Icon name="cloud-upload" :size="40" />
      <p><b>Перетащите {{ multiple ? 'файлы' : 'файл' }} сюда</b>, нажмите, чтобы выбрать, или вставьте из буфера (Ctrl+V)</p>
      <p class="muted">JPG, PNG, WebP, GIF, SVG. Большие изображения автоматически сжимаются.</p>
      <input ref="fileInput" type="file" accept="image/*" :multiple="multiple" hidden @change="takeFiles(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />
    </div>

    <!-- ============ world gallery ============ -->
    <div v-else-if="tab === 'gallery'" class="gallery-pick">
      <div class="row gap">
        <input v-model="q" class="input" placeholder="Поиск по названию…" />
        <select v-model="folder" class="input" style="max-width: 220px">
          <option value="">Все папки</option>
          <option v-for="f in gallery.folders" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>
      <div class="thumb-grid">
        <button v-for="img in shown" :key="img.id" type="button" class="thumb-cell" :class="{ on: activeGalleryId === img.id }" :title="img.name" @click="pickFromGallery(img.id)">
          <Thumb :id="img.id" />
          <span class="thumb-name">{{ img.name }}</span>
        </button>
        <p v-if="!shown.length" class="muted">В галерее пока нет изображений.</p>
      </div>
    </div>

    <!-- ============ external url ============ -->
    <form v-else class="stack" @submit.prevent="submitUrl">
      <label class="field"><span>Адрес изображения</span><input v-model="urlInput" class="input" placeholder="https://…/image.png" autofocus /></label>
      <p class="muted">Внешняя картинка не копируется в базу: если сайт-источник её удалит, она пропадёт. Для надёжности лучше скачать и загрузить файл.</p>
      <div><button class="btn btn-primary" :disabled="!urlInput.trim()">Вставить</button></div>
    </form>

    <template v-if="(allowDelete && hasExisting) || (allowCrop && hasActive)" #footer>
      <button v-if="allowDelete && hasExisting" type="button" class="btn btn-danger" style="margin-right: auto" :disabled="busy" @click="emit('remove')">
        <Icon name="trash2" :size="14" /> {{ removeLabel }}
      </button>
      <button type="button" class="btn" :disabled="busy" @click="emit('close')">Отмена</button>
      <button v-if="allowCrop && hasActive" type="button" class="btn btn-primary" :disabled="busy || !previewUrl || loadingUrl" @click="commit">
        <Icon v-if="busy" name="refresh-cw" :size="14" class="spin" /> {{ busy ? 'Сохранение…' : 'Сохранить' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.crop-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
.crop-stage { display: flex; align-items: center; justify-content: center; background: var(--surface-3); border-radius: 10px; padding: 10px; min-height: 260px; outline: none; }
.crop-stage:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
.crop-img { position: relative; display: inline-block; cursor: crosshair; touch-action: none; line-height: 0; }
.crop-img img { max-width: 100%; max-height: 58vh; display: block; border-radius: 4px; user-select: none; }
.crop-dot { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 2px rgb(0 0 0 / 55%), 0 2px 8px rgb(0 0 0 / 40%); pointer-events: none; }
.crop-dot::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: var(--accent); }
.crop-side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.crop-previews { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.crop-prev { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.crop-frame { overflow: hidden; border-radius: 10px; background: var(--surface-3); border: 1px solid var(--border); }
.crop-frame.round { border-radius: 50%; }
.crop-frame img { display: block; }
.im-reset { padding: 2px 8px; font-size: 12px; }
.im-staged { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; background: var(--accent-soft); color: var(--text); min-width: 0; }
.im-staged > .icon { color: var(--accent); flex: none; }
.im-hint { display: flex; align-items: flex-start; gap: 6px; padding: 7px 10px; border-radius: 8px; background: color-mix(in srgb, var(--warning) 14%, transparent); color: var(--text); }
.im-hint > .icon { color: var(--warning); flex: none; margin-top: 2px; }
.thumb-cell.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
@media (max-width: 860px) { .crop-wrap { grid-template-columns: 1fr; } }
</style>
