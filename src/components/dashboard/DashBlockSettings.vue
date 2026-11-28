<script setup lang="ts">
// Settings of one overview block: common ones (title, size, look, who sees it) and those of its kind.
import { computed, onMounted, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useGallery } from '@/stores/gallery'
import { allTypes } from '@/model/entityTypes'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import MultiSelect, { type MultiOption } from '@/components/common/MultiSelect.vue'
import ImageModal, { type ImageSavePayload } from '@/components/common/ImageModal.vue'
import { imageUrl } from '@/data/images'
import { openLightbox } from '@/components/viewer/lightbox'
import { toast } from '@/components/common/toast'
import { clean, errorText } from '@/data/util'
import { HEIGHTS, WIDTHS, clampH, kindOf } from './blocks'
import { safeUrl } from './links'
import type { DashBlock, Visibility } from '@/model/types'

const props = defineProps<{ block: DashBlock }>()
const emit = defineEmits<{ close: []; save: [b: DashBlock]; remove: [] }>()
const world = useWorld()
const gallery = useGallery()
// (a JSON copy: the block comes from a reactive draft, which structuredClone cannot copy)
const f = ref<DashBlock>(clean({ ...props.block, links: props.block.links ?? [], ids: props.block.ids ?? [], types: props.block.types ?? [] }))
const kind = computed(() => kindOf(f.value.type))
const editor = ref<RichEditorInstance | null>(null)
const t = computed(() => f.value.type)

const typeOptions = computed<MultiOption[]>(() => allTypes().filter((x) => world.enabledTypes(x.key)).map((x) => ({ value: x.key, label: x.plural, icon: x.icon, color: x.color, count: world.byType.get(x.key)?.length ?? 0 })))
const tags = computed(() => (world.byType.get('tag') ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru')))
const calendars = computed(() => world.byType.get('calendar') ?? [])
const customH = computed({
  get: () => f.value.h || '',
  set: (v: number | string) => { f.value.h = clampH(v) },
})

// ---------- pins ----------
const pinPick = ref<string | null>(null)
function addPin(id: string | null) { if (id && !f.value.ids!.includes(id)) f.value.ids = [...f.value.ids!, id]; pinPick.value = null }
function movePin(i: number, d: number) { const a = [...f.value.ids!]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; f.value.ids = a }

// ---------- links ----------
const linkPick = ref<string | null>(null)
function addEntityLink(id: string | null) { if (id) f.value.links = [...f.value.links!, { label: '', entityId: id }]; linkPick.value = null }
function addUrlLink() { f.value.links = [...f.value.links!, { label: '', url: '' }] }
function moveLink(i: number, d: number) { const a = [...f.value.links!]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; f.value.links = a }

// ---------- image ----------
const picking = ref(false)
const uploading = ref(false)
onMounted(() => { if (t.value === 'image') void gallery.ensure() })
const img = computed(() => (f.value.imageId ? gallery.images.get(f.value.imageId) ?? null : null))
/** Who may see the overview vs who may see the picture: warn when the picture is narrower. */
const imgNarrower = computed(() => {
  const v = img.value?.visibility
  if (!v) return false
  if (v === 'master' || v === 'custom') return f.value.show !== 'masters'
  return v === 'members' && (f.value.show ?? 'all') === 'all' && !!world.world?.isPublic
})
const openTo = computed<Visibility>(() => (world.world?.isPublic && (f.value.show ?? 'all') === 'all' ? 'public' : 'members'))
async function openImage() {
  if (!img.value) return
  try { await gallery.update(img.value.id, { visibility: openTo.value, allowedUids: [] }); toast.success('Картинка открыта') } catch (e) { toast.error(errorText(e)) }
}
async function saveImage(payload: ImageSavePayload) {
  uploading.value = true
  try {
    if (payload.file) {
      const [m] = await gallery.upload([payload.file], { folder: 'Обзор', visibility: openTo.value })
      if (m) f.value.imageId = m.id
    } else if (payload.changed) {
      f.value.imageId = payload.imageId
    }
    f.value.imageCrop = payload.crop
    picking.value = false
  } catch (e) { toast.error('Не удалось загрузить: ' + errorText(e)) } finally { uploading.value = false }
}
function removeImage() {
  f.value.imageId = null
  f.value.imageCrop = null
  picking.value = false
}
async function viewImage() {
  if (!f.value.imageId) { picking.value = true; return }
  const src = await imageUrl(world.access, f.value.imageId, 'full').catch(() => null)
  if (src) openLightbox([{ src, caption: f.value.caption || '' }])
}

function save() {
  const b = { ...f.value }
  if (b.type === 'text') b.html = editor.value?.getHTML() ?? b.html ?? ''
  if (b.links) b.links = b.links.filter((l) => l.entityId || (l.url && safeUrl(l.url)))
  emit('save', b)
}
const badUrls = computed(() => (f.value.links ?? []).some((l) => !l.entityId && l.url?.trim() && !safeUrl(l.url)))
</script>

<template>
  <Modal :title="`Блок «${kind.label}»`" width="680px" @close="emit('close')">
    <div class="stack dbs">
      <!-- ============ the kind's own settings ============ -->
      <template v-if="t === 'text'">
        <RichEditor ref="editor" :model-value="f.html ?? ''" :allow-images="false" compact min-height="200px" placeholder="Текст блока… «@» — ссылка на статью" />
        <p v-if="(f.show ?? 'all') !== 'all'" class="faint small" style="margin: 0"><Icon name="info" :size="13" /> Текст хранится в настройках мира: «кому показывать» прячет блок с обзора, но технически текст доступен всем, кто открывает мир. Секреты держите в статьях с закрытым доступом и показывайте блоком «Статья».</p>
      </template>

      <template v-else-if="t === 'pins'">
        <div class="field"><span>Статьи</span>
          <div v-for="(id, i) in f.ids" :key="id" class="dbs-row">
            <EntityLink :id="id" avatar class="grow" fallback="(удалена)" />
            <button class="icon-btn" title="Выше" :disabled="i === 0" @click="movePin(i, -1)"><Icon name="arrow-up" :size="14" /></button>
            <button class="icon-btn" title="Ниже" :disabled="i === f.ids!.length - 1" @click="movePin(i, 1)"><Icon name="arrow-down" :size="14" /></button>
            <button class="icon-btn" title="Убрать" @click="f.ids = f.ids!.filter((x) => x !== id)"><Icon name="x" :size="14" /></button>
          </div>
          <EntityPicker v-model="pinPick" :exclude="f.ids" :allow-create="false" placeholder="Добавить статью…" @update:model-value="addPin" />
        </div>
      </template>

      <template v-else-if="t === 'entity' || t === 'map'">
        <label class="field"><span>{{ t === 'map' ? 'Карта' : 'Статья' }}</span>
          <EntityPicker v-model="f.entityId" :types="t === 'map' ? ['map'] : undefined" :allow-create="false" :placeholder="t === 'map' ? 'Выберите карту…' : 'Выберите статью…'" />
        </label>
        <p v-if="f.entityId && world.get(f.entityId) && world.get(f.entityId)!.visibility !== 'public' && (f.show ?? 'all') === 'all'" class="faint small" style="margin: 0">
          <Icon name="info" :size="13" /> Блок увидят только те, кому открыта сама статья: доступ статьи действует и здесь.
        </p>
      </template>

      <template v-else-if="t === 'list'">
        <div class="row gap wrap">
          <label class="field grow"><span>Разделы</span><MultiSelect v-model="f.types!" :options="typeOptions" placeholder="Все разделы" /></label>
          <label class="field grow"><span>С тегом</span>
            <select v-model="f.tagId" class="input"><option :value="null">Любой</option><option v-for="x in tags" :key="x.id" :value="x.id">{{ x.name }}</option></select>
          </label>
        </div>
      </template>

      <template v-else-if="t === 'stats' || t === 'recent' || t === 'random'">
        <label class="field"><span>{{ t === 'stats' ? 'Какие разделы показывать' : 'Только из разделов' }}</span><MultiSelect v-model="f.types!" :options="typeOptions" placeholder="Все разделы" /></label>
      </template>

      <template v-else-if="t === 'calendar'">
        <label class="field"><span>Календарь</span>
          <select v-model="f.calendarId" class="input"><option :value="null">Основной календарь мира</option><option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        </label>
      </template>

      <template v-else-if="t === 'image'">
        <div class="row gap" style="align-items: flex-start">
          <button type="button" class="dbs-img" :class="{ zoomable: !!f.imageId }" :title="f.imageId ? 'Открыть крупно' : 'Выбрать картинку'" @click="viewImage">
            <Thumb v-if="f.imageId" :id="f.imageId" variant="full" :crop="f.fit === 'contain' ? null : (f.imageCrop ?? null)"><Icon name="image" :size="26" /></Thumb>
            <Icon v-else name="image" :size="26" />
          </button>
          <div class="stack-sm grow">
            <div class="row gap-sm wrap">
              <button class="btn btn-sm" :disabled="uploading" @click="picking = true">
                <Icon :name="uploading ? 'refresh-cw' : (f.imageId ? 'pencil' : 'images')" :size="14" :class="{ spin: uploading }" /> {{ f.imageId ? 'Настроить' : 'Выбрать или загрузить' }}
              </button>
            </div>
            <div v-if="imgNarrower" class="small dbs-warn"><Icon name="eye-off" :size="13" /> Картинка в галерее закрыта от части зрителей обзора — они увидят пустую рамку.
              <button class="btn btn-sm" @click="openImage">Открыть {{ openTo === 'public' ? 'всем' : 'участникам' }}</button>
            </div>
          </div>
        </div>
        <label class="field"><span>Подпись</span><input v-model="f.caption" class="input" maxlength="300" placeholder="Необязательно" /></label>
        <div class="field"><span>Если задана высота блока</span>
          <div class="row gap-sm wrap">
            <button class="chip" :class="{ on: f.fit !== 'contain' }" @click="f.fit = 'cover'">Заполнить рамку (обрезать)</button>
            <button class="chip" :class="{ on: f.fit === 'contain' }" @click="f.fit = 'contain'">Вписать целиком</button>
          </div>
        </div>
      </template>

      <template v-else-if="t === 'links'">
        <div class="field"><span>Ссылки</span>
          <div v-for="(l, i) in f.links" :key="i" class="dbs-row">
            <template v-if="l.entityId">
              <EntityLink :id="l.entityId" class="dbs-link-target" fallback="(удалена)" />
              <input v-model="l.label" class="input input-sm grow" maxlength="80" placeholder="Подпись (по умолчанию — название)" />
            </template>
            <template v-else>
              <input v-model="l.label" class="input input-sm" style="width: 34%" maxlength="80" placeholder="Подпись" />
              <input v-model="l.url" class="input input-sm grow" :class="{ bad: l.url && !safeUrl(l.url) }" maxlength="500" placeholder="https://…" />
            </template>
            <button class="icon-btn" title="Выше" :disabled="i === 0" @click="moveLink(i, -1)"><Icon name="arrow-up" :size="14" /></button>
            <button class="icon-btn" title="Убрать" @click="f.links = f.links!.filter((_, j) => j !== i)"><Icon name="x" :size="14" /></button>
          </div>
          <div class="row gap-sm wrap">
            <div class="grow" style="min-width: 200px"><EntityPicker v-model="linkPick" :allow-create="false" placeholder="+ Ссылка на статью…" @update:model-value="addEntityLink" /></div>
            <button class="btn btn-sm" @click="addUrlLink"><Icon name="external-link" :size="14" /> + Внешняя ссылка</button>
          </div>
          <p v-if="badUrls" class="small" style="margin: 0; color: var(--danger)">Внешние ссылки — только http(s):// или mailto:. Неверные не сохранятся.</p>
        </div>
      </template>

      <template v-else-if="t === 'hero'">
        <div class="field"><span>Высота шапки</span>
          <div class="row gap-sm wrap">
            <button v-for="o in ([['sm', 'Низкая'], ['md', 'Средняя'], ['lg', 'Высокая']] as const)" :key="o[0]" class="chip" :class="{ on: (f.heroSize ?? 'md') === o[0] }" @click="f.heroSize = o[0]">{{ o[1] }}</button>
          </div>
        </div>
        <div class="field"><span>Текст</span>
          <div class="row gap-sm wrap">
            <button class="chip" :class="{ on: (f.align ?? 'left') === 'left' }" @click="f.align = 'left'"><Icon name="align-left" :size="14" /> Слева</button>
            <button class="chip" :class="{ on: f.align === 'center' }" @click="f.align = 'center'"><Icon name="align-center" :size="14" /> По центру</button>
            <label class="check"><input v-model="f.showDescription" type="checkbox" /> Показывать описание мира</label>
          </div>
        </div>
        <p class="faint small" style="margin: 0">Название, описание и обложка меняются в настройках мира.</p>
      </template>

      <!-- how many / how to show -->
      <div v-if="['list', 'recent', 'waiting', 'calendar'].includes(t) || t === 'pins' || t === 'entity'" class="row gap wrap">
        <label v-if="['list', 'recent', 'waiting', 'calendar'].includes(t)" class="field" style="width: 150px"><span>{{ t === 'calendar' ? 'Событий' : 'Сколько статей' }}</span>
          <input v-model.number="f.limit" class="input" type="number" min="1" max="60" />
        </label>
        <div v-if="t === 'list'" class="field"><span>Порядок</span>
          <div class="row gap-sm wrap">
            <button v-for="o in ([['recent', 'Недавно изменённые'], ['created', 'Новые'], ['name', 'По алфавиту']] as const)" :key="o[0]" class="chip" :class="{ on: (f.sort ?? 'recent') === o[0] }" @click="f.sort = o[0]">{{ o[1] }}</button>
          </div>
        </div>
        <div v-if="t === 'list' || t === 'pins'" class="field"><span>Вид</span>
          <div class="row gap-sm wrap">
            <button v-for="o in ([['cards', 'Карточки', 'layout-grid'], ['tiles', 'Плитки', 'grid3x3'], ['rows', 'Список', 'layout-list']] as const)" :key="o[0]" class="chip" :class="{ on: (f.view ?? (t === 'pins' ? 'cards' : 'rows')) === o[0] }" @click="f.view = o[0]"><Icon :name="o[2]" :size="14" /> {{ o[1] }}</button>
          </div>
        </div>
        <div v-if="t === 'entity'" class="field"><span>Показывать</span>
          <div class="row gap-sm wrap">
            <button class="chip" :class="{ on: f.view !== 'full' }" @click="f.view = 'card'">Карточку</button>
            <button class="chip" :class="{ on: f.view === 'full' }" @click="f.view = 'full'">Весь текст</button>
          </div>
        </div>
      </div>

      <hr class="dbs-sep" />

      <!-- ============ common ============ -->
      <div v-if="t !== 'hero'" class="row gap wrap" style="align-items: flex-end">
        <label class="field grow"><span>Заголовок</span><input v-model="f.title" class="input" maxlength="80" :placeholder="kind.label" /></label>
        <label class="check" style="margin-bottom: 9px"><input v-model="f.hideTitle" type="checkbox" /> Скрыть заголовок</label>
      </div>
      <div class="field"><span>Ширина</span>
        <div class="row gap-sm wrap">
          <button v-for="o in WIDTHS" :key="o.w" class="chip" :class="{ on: f.w === o.w }" @click="f.w = o.w">{{ o.label }}</button>
          <span v-if="!WIDTHS.some((o) => o.w === f.w)" class="faint small">сейчас {{ f.w }}/12</span>
        </div>
      </div>
      <div class="field"><span>Высота</span>
        <div class="row gap-sm wrap">
          <button v-for="o in HEIGHTS" :key="o.h" class="chip" :class="{ on: f.h === o.h }" @click="f.h = o.h">{{ o.label }}</button>
          <span class="row gap-sm small faint"><input v-model.lazy="customH" class="input input-sm" type="number" min="120" max="1600" step="20" style="width: 86px" placeholder="авто" /> px</span>
        </div>
        <span class="faint small">Блоки одного ряда всегда одной высоты — по самому высокому. Если содержимое выше заданной высоты, внутри появится прокрутка. Ширину и высоту можно менять и мышью — за края блока.</span>
      </div>
      <div class="row gap wrap">
        <div class="field"><span>Оформление</span>
          <div class="row gap-sm wrap">
            <button v-for="o in ([['card', 'Карточка'], ['plain', 'Без рамки'], ['accent', 'Акцент']] as const)" :key="o[0]" class="chip" :class="{ on: (f.style ?? 'card') === o[0] }" @click="f.style = o[0]">{{ o[1] }}</button>
          </div>
        </div>
        <div class="field"><span>Кому показывать</span>
          <div class="row gap-sm wrap">
            <button v-for="o in ([['all', 'Всем', 'globe'], ['members', 'Участникам', 'users'], ['masters', 'Мастерам', 'crown']] as const)" :key="o[0]" class="chip" :class="{ on: (f.show ?? 'all') === o[0] }" @click="f.show = o[0]"><Icon :name="o[2]" :size="14" /> {{ o[1] }}</button>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="btn btn-ghost danger-text" style="margin-right: auto" @click="emit('remove')"><Icon name="trash2" :size="15" /> Убрать блок</button>
      <button class="btn" @click="emit('close')">Отмена</button>
      <button class="btn btn-primary" @click="save"><Icon name="check" :size="15" /> Готово</button>
    </template>
    <ImageModal
      v-if="picking"
      title="Картинка для обзора"
      :image-id="f.imageId ?? null"
      :initial-crop="f.imageCrop ?? null"
      kind="block"
      remove-label="Убрать картинку"
      :busy="uploading"
      @save="saveImage"
      @remove="removeImage"
      @close="picking = false"
    />
  </Modal>
</template>

<style scoped>
.dbs-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--border); min-width: 0; }
.dbs-row:last-of-type { margin-bottom: 6px; }
.dbs-link-target { max-width: 40%; flex-shrink: 0; }
.dbs-img { width: 120px; height: 90px; padding: 0; border: 0; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: var(--surface-3); display: flex; align-items: center; justify-content: center; color: var(--text-faint); cursor: pointer; }
.dbs-img.zoomable { cursor: zoom-in; }
.dbs-img :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.dbs-warn { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--warning); }
.dbs-sep { border: 0; border-top: 1px solid var(--border); margin: 2px 0; width: 100%; }
.input.bad { border-color: var(--danger); }
.danger-text { color: var(--danger); }
</style>
