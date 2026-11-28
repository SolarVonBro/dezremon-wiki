<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { VISIBILITY_SHORT } from '@/data/access'
import { imageUrl } from '@/data/images'
import { downloadBlob, slugify } from '@/data/util'
import { sanitize } from '@/data/html'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import ImageModal, { type CropKind, type ImageSavePayload } from '@/components/common/ImageModal.vue'
import EntitySettingsModal from './EntitySettingsModal.vue'
import { cropOf, type CropField } from '@/data/crop'
import { useGallery } from '@/stores/gallery'
import { openLightbox } from '@/components/viewer/lightbox'
import { toast } from '@/components/common/toast'
import type { Entity } from '@/model/types'

type ImageSlot = 'imageId' | 'headerImageId' | 'backgroundImageId'
const SLOT_META: Record<ImageSlot, { title: string; cropField: CropField; kind: CropKind; removeLabel: string }> = {
  imageId: { title: 'Изображение статьи', cropField: 'imageCrop', kind: 'entity', removeLabel: 'Убрать изображение' },
  headerImageId: { title: 'Обложка статьи', cropField: 'headerCrop', kind: 'header', removeLabel: 'Убрать обложку' },
  backgroundImageId: { title: 'Фон страницы', cropField: 'backgroundCrop', kind: 'background', removeLabel: 'Убрать фон' },
}

const props = defineProps<{ entity: Entity; editing: boolean; canEdit: boolean }>()
const emit = defineEmits<{ 'toggle-edit': [] }>()
const world = useWorld()
const gallery = useGallery()
const router = useRouter()
const def = computed(() => typeDef(props.entity.type))
const name = ref(props.entity.name)
watch(() => props.entity.name, (n) => { if (document.activeElement?.classList.contains('hero-name-input')) return; name.value = n })
const imgModal = ref<ImageSlot | null>(null)
const imgBusy = ref(false)
const settings = ref(false)
const isFav = computed(() => (world.member?.favorites ?? []).includes(props.entity.id))
const tags = computed(() => props.entity.tagIds.map((id) => world.get(id)).filter(Boolean) as Entity[])
const activeMeta = computed(() => (imgModal.value ? SLOT_META[imgModal.value] : null))

const status = computed(() => {
  const f = props.entity.fields ?? {}
  const out: Array<{ text: string; cls: string }> = []
  if (f.isDead) out.push({ text: props.entity.type === 'character' ? 'мёртв(а)' : 'мертво', cls: 'badge-dead' })
  if (f.isExtinct) out.push({ text: 'вымерли', cls: 'badge-dead' })
  if (f.isDefunct) out.push({ text: 'распущена', cls: 'badge-dead' })
  if (f.isCompleted) out.push({ text: 'завершён', cls: 'badge-public' })
  return out
})

function saveName() {
  const n = name.value.trim()
  if (n && n !== props.entity.name) void world.updateEntity(props.entity.id, { name: n })
  else name.value = props.entity.name
}
async function saveImage(payload: ImageSavePayload) {
  const slot = imgModal.value
  if (!slot) return
  const { cropField } = SLOT_META[slot]
  imgBusy.value = true
  try {
    let nextId = props.entity[slot] ?? null
    if (payload.file) {
      const [meta] = await gallery.upload([payload.file], { folder: props.entity.name, visibility: props.entity.visibility, allowedUids: props.entity.allowedUids })
      nextId = meta.id
    } else if (payload.changed) {
      nextId = payload.imageId
    }
    const patch: Partial<Entity> = { fields: { ...props.entity.fields, [cropField]: payload.crop } }
    if (nextId !== (props.entity[slot] ?? null)) patch[slot] = nextId
    await world.updateEntity(props.entity.id, patch)
    imgModal.value = null
  } catch (e: any) {
    toast.error('Не удалось сохранить изображение: ' + (e?.message ?? e))
  } finally { imgBusy.value = false }
}
async function removeImage() {
  const slot = imgModal.value
  if (!slot) return
  const { cropField } = SLOT_META[slot]
  imgBusy.value = true
  try {
    const fields = props.entity.fields?.[cropField] ? { fields: { ...props.entity.fields, [cropField]: null } } : {}
    await world.updateEntity(props.entity.id, { [slot]: null, ...fields })
    imgModal.value = null
  } catch (e: any) {
    toast.error('Не удалось убрать изображение: ' + (e?.message ?? e))
  } finally { imgBusy.value = false }
}
// Clicking the portrait always opens the full-size viewer when a picture is set (both in view and edit modes).
async function onAvatarClick() {
  if (props.entity.imageId) {
    openLightbox([{ src: await imageUrl(world.access, props.entity.imageId, 'full'), caption: props.entity.name }])
  } else if (props.editing) {
    imgModal.value = 'imageId'
  }
}
async function duplicate() {
  const e = props.entity
  const html = await world.loadText(e.id)
  const id = await world.createEntity(e.type, `${e.name} (копия)`, {
    kind: e.kind, parentId: e.parentId, imageId: e.imageId, headerImageId: e.headerImageId, backgroundImageId: e.backgroundImageId ?? null,
    tagIds: [...e.tagIds], aliases: [...e.aliases], fields: JSON.parse(JSON.stringify(e.fields)),
    attributes: JSON.parse(JSON.stringify(e.attributes)), links: [...e.links], visibility: e.visibility, allowedUids: [...e.allowedUids],
  }, html)
  void router.push({ name: 'entity', params: { wid: world.wid!, eid: id } })
}
async function exportHtml() {
  const e = props.entity
  const body = sanitize(await world.loadText(e.id))
  const doc = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${e.name}</title><style>body{font:17px/1.7 Georgia,serif;max-width:820px;margin:40px auto;padding:0 20px;color:#222}h1,h2,h3{font-family:Georgia,serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6px}.secret-block{border:1px dashed #7c3aed;padding:8px}.callout{border:1px solid #ccc;padding:8px 12px;border-radius:6px}</style><h1>${e.name}</h1><p><i>${def.value.label}${e.kind ? ' · ' + e.kind : ''}</i></p>${body}</html>`
  downloadBlob(new Blob([doc], { type: 'text/html' }), `${slugify(e.name)}.html`)
}
function copyLink() {
  void navigator.clipboard.writeText(location.href).then(() => toast.success('Ссылка скопирована'))
}
async function remove() {
  if (!confirm(`Переместить «${props.entity.name}» в корзину?`)) return
  await world.deleteEntity(props.entity.id)
  toast.success('Статья перемещена в корзину')
  void router.push({ name: 'list', params: { wid: world.wid!, type: props.entity.type } })
}
</script>

<template>
  <section class="entity-hero" :class="{ 'has-header': !!entity.headerImageId }">
    <div v-if="entity.headerImageId" class="hero-img"><Thumb :id="entity.headerImageId" variant="full" :crop="cropOf(entity, 'headerCrop')" /></div>
    <div class="hero-body">
      <div v-if="entity.imageId || editing" class="hero-avatar-wrap">
        <button type="button" class="hero-avatar" :class="{ zoomable: !!entity.imageId }" :title="entity.imageId ? 'Открыть изображение' : 'Добавить изображение'" @click="onAvatarClick">
          <Thumb :id="entity.imageId" variant="full" :crop="cropOf(entity)"><Icon :name="editing ? 'image' : def.icon" :size="34" /></Thumb>
        </button>
        <button v-if="editing" type="button" class="hero-img-btn" :title="entity.imageId ? 'Изменить изображение и фокус' : 'Добавить изображение'" @click="imgModal = 'imageId'">
          <Icon name="pencil" :size="15" />
        </button>
      </div>
      <div class="hero-text">
        <div class="hero-type" :style="{ color: def.color }">
          <Icon :name="def.icon" :size="14" /> {{ def.label }}<span v-if="entity.kind" class="muted">· {{ entity.kind }}</span>
          <span v-if="entity.visibility !== 'members'" class="badge" :class="{ 'badge-secret': entity.visibility === 'master' || entity.visibility === 'custom', 'badge-public': entity.visibility === 'public' }">
            <Icon :name="entity.visibility === 'public' ? 'globe' : 'lock'" :size="11" /> {{ VISIBILITY_SHORT[entity.visibility] }}
          </span>
          <span v-if="entity.hasSecrets && world.canReadSecrets" class="badge badge-secret" title="В статье есть секреты мастера"><Icon name="eye-off" :size="11" /> секреты</span>
          <span v-if="entity.isTemplate" class="badge">шаблон</span>
          <span v-for="s in status" :key="s.text" class="badge" :class="s.cls">{{ s.text }}</span>
        </div>
        <input v-if="editing" v-model="name" class="hero-name-input" maxlength="200" @blur="saveName" @keydown.enter="($event.target as HTMLInputElement).blur()" />
        <h1 v-else class="hero-name">{{ entity.name }}</h1>
        <div v-if="entity.fields?.title || entity.aliases.length" class="hero-sub">
          {{ entity.fields?.title }}<span v-if="entity.aliases.length" class="faint"> {{ entity.fields?.title ? '·' : '' }} также: {{ entity.aliases.join(', ') }}</span>
        </div>
        <div v-if="tags.length" class="hero-tags">
          <RouterLink v-for="t in tags" :key="t.id" class="tag-chip" :style="{ '--tag-color': t.fields?.colour || undefined }" :to="{ name: 'entity', params: { wid: world.wid!, eid: t.id } }" :title="t.name"><span class="ellipsis">{{ t.name }}</span></RouterLink>
        </div>
      </div>
      <div class="entity-actions no-print">
        <button v-if="canEdit" class="btn" :class="{ 'btn-primary': editing }" :title="editing ? 'Готово (выйти из редактирования)' : 'Редактировать (E)'" @click="emit('toggle-edit')">
          <Icon :name="editing ? 'check' : 'pencil'" :size="16" /> {{ editing ? 'Готово' : 'Редактировать' }}
        </button>
        <button v-if="world.member && !world.preview && !world.adminReadOnly" class="icon-btn" :class="{ on: isFav }" :title="isFav ? 'Убрать из избранного' : 'В избранное'" @click="world.toggleFavorite(entity.id)"><Icon name="star" /></button>
        <Dropdown placement="bottom-end">
          <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" /></button></template>
          <div class="menu">
            <template v-if="canEdit">
              <button class="menu-item" @click="settings = true"><Icon name="shield" :size="15" /> Доступ и настройки</button>
              <button class="menu-item" @click="imgModal = 'imageId'"><Icon name="image" :size="15" /> Изображение…</button>
              <button class="menu-item" @click="imgModal = 'headerImageId'"><Icon name="panel-right-open" :size="15" /> Обложка…</button>
              <button class="menu-item" @click="imgModal = 'backgroundImageId'"><Icon name="layers" :size="15" /> Фон страницы…</button>
              <div class="menu-sep" />
            </template>
            <button v-if="world.canCreate(entity.type)" class="menu-item" @click="duplicate"><Icon name="copy" :size="15" /> Дублировать</button>
            <button class="menu-item" @click="copyLink"><Icon name="link2" :size="15" /> Копировать ссылку</button>
            <button class="menu-item" @click="exportHtml"><Icon name="file-down" :size="15" /> Скачать как HTML</button>
            <button class="menu-item" onclick="window.print()"><Icon name="printer" :size="15" /> Печать / PDF</button>
            <template v-if="world.isMaster">
              <div class="menu-sep" />
              <button class="menu-item danger" @click="remove"><Icon name="trash2" :size="15" /> В корзину</button>
            </template>
          </div>
        </Dropdown>
      </div>
    </div>
    <ImageModal
      v-if="imgModal && activeMeta"
      :title="activeMeta.title"
      :image-id="entity[imgModal] ?? null"
      :initial-crop="cropOf(entity, activeMeta.cropField)"
      :kind="activeMeta.kind"
      :remove-label="activeMeta.removeLabel"
      :busy="imgBusy"
      @save="saveImage"
      @remove="removeImage"
      @close="imgModal = null"
    />
    <EntitySettingsModal v-if="settings" :entity="entity" @close="settings = false" />
  </section>
</template>
