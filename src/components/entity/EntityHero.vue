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
import ImageDialog from '@/components/editor/ImageDialog.vue'
import EntitySettingsModal from './EntitySettingsModal.vue'
import ImageCropModal from './ImageCropModal.vue'
import { cropOf, type CropField } from '@/data/crop'
import { useGallery } from '@/stores/gallery'
import { openLightbox } from '@/components/viewer/lightbox'
import { toast } from '@/components/common/toast'
import type { Entity } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean; canEdit: boolean }>()
const emit = defineEmits<{ 'toggle-edit': [] }>()
const world = useWorld()
const gallery = useGallery()
const router = useRouter()
const def = computed(() => typeDef(props.entity.type))
const name = ref(props.entity.name)
watch(() => props.entity.name, (n) => { if (document.activeElement?.classList.contains('hero-name-input')) return; name.value = n })
const imgDialog = ref<false | 'imageId' | 'headerImageId'>(false)
const settings = ref(false)
const cropping = ref<CropField | null>(null)
const isFav = computed(() => (world.member?.favorites ?? []).includes(props.entity.id))
const tags = computed(() => props.entity.tagIds.map((id) => world.get(id)).filter(Boolean) as Entity[])

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
async function setImage(field: 'imageId' | 'headerImageId', id: string | null) {
  const cropField: CropField = field === 'imageId' ? 'imageCrop' : 'headerCrop'
  // a new picture starts centred; the old framing belonged to the previous one
  const fields = props.entity.fields?.[cropField] ? { fields: { ...props.entity.fields, [cropField]: null } } : {}
  await world.updateEntity(props.entity.id, { [field]: id, ...fields })
  if (id) cropping.value = cropField
}
async function onFiles(files: File[]) {
  const field = imgDialog.value
  if (!field) return
  const [meta] = await gallery.upload(files.slice(0, 1), { folder: props.entity.name, visibility: props.entity.visibility, allowedUids: props.entity.allowedUids })
  await setImage(field, meta.id)
}
async function zoomAvatar() {
  if (props.editing) { imgDialog.value = 'imageId'; return }
  if (!props.entity.imageId) return
  openLightbox([{ src: await imageUrl(world.access, props.entity.imageId, 'full'), caption: props.entity.name }])
}
async function duplicate() {
  const e = props.entity
  const html = await world.loadText(e.id)
  const id = await world.createEntity(e.type, `${e.name} (копия)`, {
    kind: e.kind, parentId: e.parentId, imageId: e.imageId, headerImageId: e.headerImageId, tagIds: [...e.tagIds], aliases: [...e.aliases],
    fields: JSON.parse(JSON.stringify(e.fields)), attributes: JSON.parse(JSON.stringify(e.attributes)), links: [...e.links], visibility: e.visibility, allowedUids: [...e.allowedUids],
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
        <button type="button" class="hero-avatar" :title="editing ? 'Сменить изображение' : 'Открыть изображение'" @click="zoomAvatar">
          <Thumb :id="entity.imageId" variant="full" :crop="cropOf(entity)"><Icon :name="editing ? 'image' : def.icon" :size="34" /></Thumb>
        </button>
        <button v-if="editing && entity.imageId" type="button" class="hero-crop-btn" title="Кадр: центрирование и масштаб" @click="cropping = 'imageCrop'"><Icon name="crosshair" :size="15" /></button>
      </div>
      <div class="hero-text">
        <div class="hero-type" :style="{ color: def.color }">
          <Icon :name="def.icon" :size="14" /> {{ def.label }}<span v-if="entity.kind" class="muted">· {{ entity.kind }}</span>
          <span v-if="entity.visibility !== 'members'" class="badge" :class="{ 'badge-secret': entity.visibility === 'master' || entity.visibility === 'custom', 'badge-public': entity.visibility === 'public' }">
            <Icon :name="entity.visibility === 'public' ? 'globe' : 'lock'" :size="11" /> {{ VISIBILITY_SHORT[entity.visibility] }}
          </span>
          <span v-if="entity.hasSecrets && world.isMaster" class="badge badge-secret" title="В статье есть секреты мастера"><Icon name="eye-off" :size="11" /> секреты</span>
          <span v-if="entity.isTemplate" class="badge">шаблон</span>
          <span v-for="s in status" :key="s.text" class="badge" :class="s.cls">{{ s.text }}</span>
        </div>
        <input v-if="editing" v-model="name" class="hero-name-input" maxlength="200" @blur="saveName" @keydown.enter="($event.target as HTMLInputElement).blur()" />
        <h1 v-else class="hero-name">{{ entity.name }}</h1>
        <div v-if="entity.fields?.title || entity.aliases.length" class="hero-sub">
          {{ entity.fields?.title }}<span v-if="entity.aliases.length" class="faint"> {{ entity.fields?.title ? '·' : '' }} также: {{ entity.aliases.join(', ') }}</span>
        </div>
        <div v-if="tags.length" class="hero-tags">
          <RouterLink v-for="t in tags" :key="t.id" class="tag-chip" :style="{ '--tag-color': t.fields?.colour || undefined }" :to="{ name: 'entity', params: { wid: world.wid!, eid: t.id } }">{{ t.name }}</RouterLink>
        </div>
      </div>
      <div class="entity-actions no-print">
        <button v-if="canEdit" class="btn" :class="{ 'btn-primary': editing }" :title="editing ? 'Готово (выйти из редактирования)' : 'Редактировать (E)'" @click="emit('toggle-edit')">
          <Icon :name="editing ? 'check' : 'pencil'" :size="16" /> {{ editing ? 'Готово' : 'Редактировать' }}
        </button>
        <button v-if="world.isMember" class="icon-btn" :class="{ on: isFav }" :title="isFav ? 'Убрать из избранного' : 'В избранное'" @click="world.toggleFavorite(entity.id)"><Icon name="star" /></button>
        <Dropdown placement="bottom-end">
          <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" /></button></template>
          <div class="menu">
            <template v-if="canEdit">
              <button class="menu-item" @click="settings = true"><Icon name="shield" :size="15" /> Доступ и настройки</button>
              <button class="menu-item" @click="imgDialog = 'imageId'"><Icon name="image" :size="15" /> {{ entity.imageId ? 'Сменить' : 'Добавить' }} изображение</button>
              <button class="menu-item" @click="imgDialog = 'headerImageId'"><Icon name="panel-right-open" :size="15" /> {{ entity.headerImageId ? 'Сменить' : 'Добавить' }} обложку</button>
              <button v-if="entity.imageId" class="menu-item" @click="cropping = 'imageCrop'"><Icon name="crosshair" :size="15" /> Кадр изображения…</button>
              <button v-if="entity.headerImageId" class="menu-item" @click="cropping = 'headerCrop'"><Icon name="crosshair" :size="15" /> Кадр обложки…</button>
              <button v-if="entity.imageId" class="menu-item" @click="setImage('imageId', null)"><Icon name="x" :size="15" /> Убрать изображение</button>
              <button v-if="entity.headerImageId" class="menu-item" @click="setImage('headerImageId', null)"><Icon name="x" :size="15" /> Убрать обложку</button>
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
    <ImageDialog v-if="imgDialog" :title="imgDialog === 'imageId' ? 'Изображение статьи' : 'Обложка статьи'" :multiple="false"
      @close="imgDialog = false" @files="onFiles" @pick="(id) => setImage(imgDialog as any, id)" @url="() => toast.info('Для изображения статьи загрузите файл или выберите из галереи')" />
    <EntitySettingsModal v-if="settings" :entity="entity" @close="settings = false" />
    <ImageCropModal v-if="cropping" :entity="entity" :field="cropping" @close="cropping = null" />
  </section>
</template>
