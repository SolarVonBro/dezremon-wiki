<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import { useGallery } from '@/stores/gallery'

const props = withDefaults(defineProps<{ title?: string; multiple?: boolean }>(), { title: 'Вставить изображение', multiple: true })
const emit = defineEmits<{ close: []; files: [files: File[]]; pick: [imageId: string]; url: [url: string] }>()
const gallery = useGallery()
const tab = ref<'upload' | 'gallery' | 'url'>('upload')
const url = ref('')
const q = ref('')
const folder = ref('')
const drag = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

onMounted(() => { void gallery.ensure() })

const shown = computed(() => gallery.list.filter((i) => (!folder.value || i.folder === folder.value) && (!q.value || i.name.toLowerCase().includes(q.value.toLowerCase()))))

function takeFiles(list: FileList | null | undefined) {
  const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
  if (files.length) { emit('files', props.multiple ? files : files.slice(0, 1)); emit('close') }
}
function onDrop(e: DragEvent) { drag.value = false; takeFiles(e.dataTransfer?.files) }
function onPaste(e: ClipboardEvent) { takeFiles(e.clipboardData?.files) }
</script>

<template>
  <Modal :title="title" width="760px" @close="emit('close')">
    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'upload' }" @click="tab = 'upload'"><Icon name="upload" :size="16" /> Загрузить</button>
      <button class="tab" :class="{ on: tab === 'gallery' }" @click="tab = 'gallery'"><Icon name="images" :size="16" /> Из галереи</button>
      <button class="tab" :class="{ on: tab === 'url' }" @click="tab = 'url'"><Icon name="link" :size="16" /> По ссылке</button>
    </div>

    <div v-if="tab === 'upload'" class="dropzone" :class="{ drag }" tabindex="0"
      @dragover.prevent="drag = true" @dragleave="drag = false" @drop.prevent="onDrop" @paste="onPaste" @click="fileInput?.click()">
      <Icon name="cloud-upload" :size="40" />
      <p><b>Перетащите файлы сюда</b>, нажмите, чтобы выбрать, или вставьте из буфера (Ctrl+V)</p>
      <p class="muted">JPG, PNG, WebP, GIF, SVG. Большие изображения автоматически сжимаются.</p>
      <input ref="fileInput" type="file" accept="image/*" :multiple="multiple" hidden @change="takeFiles(($event.target as HTMLInputElement).files)" />
    </div>

    <div v-else-if="tab === 'gallery'" class="gallery-pick">
      <div class="row gap">
        <input v-model="q" class="input" placeholder="Поиск по названию…" />
        <select v-model="folder" class="input" style="max-width: 220px">
          <option value="">Все папки</option>
          <option v-for="f in gallery.folders" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>
      <div class="thumb-grid">
        <button v-for="img in shown" :key="img.id" type="button" class="thumb-cell" :title="img.name" @click="emit('pick', img.id); emit('close')">
          <Thumb :id="img.id" />
          <span class="thumb-name">{{ img.name }}</span>
        </button>
        <p v-if="!shown.length" class="muted">В галерее пока нет изображений.</p>
      </div>
    </div>

    <form v-else class="stack" @submit.prevent="url && (emit('url', url), emit('close'))">
      <label class="field"><span>Адрес изображения</span><input v-model="url" class="input" placeholder="https://…/image.png" autofocus /></label>
      <p class="muted">Внешняя картинка не копируется в базу: если сайт-источник её удалит, она пропадёт. Для надёжности лучше скачать и загрузить файл.</p>
      <div><button class="btn btn-primary" :disabled="!url">Вставить</button></div>
    </form>
  </Modal>
</template>
