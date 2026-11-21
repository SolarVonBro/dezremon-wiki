<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useGallery } from '@/stores/gallery'
import { imageUrl } from '@/data/images'
import { formatDate } from '@/data/util'
import { VISIBILITY_SHORT } from '@/data/access'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import Modal from '@/components/common/Modal.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { openLightbox } from '@/components/viewer/lightbox'
import { toast } from '@/components/common/toast'
import type { ImageMeta, Visibility } from '@/model/types'

const world = useWorld()
const gallery = useGallery()
const q = ref('')
const folder = ref('')
const busy = ref(0)
const drag = ref(false)
const selected = ref<ImageMeta | null>(null)
const form = ref<{ name: string; folder: string; vis: { visibility: Visibility; allowedUids: string[] } }>({ name: '', folder: '', vis: { visibility: 'members', allowedUids: [] } })
const fileInput = ref<HTMLInputElement | null>(null)

onMounted(() => void gallery.ensure())
const shown = computed(() => gallery.list.filter((i) => (!folder.value || i.folder === folder.value) && (!q.value || i.name.toLowerCase().includes(q.value.toLowerCase()))))
const totalSize = computed(() => gallery.list.reduce((s, i) => s + (i.size || 0), 0))

async function upload(files: FileList | File[] | null | undefined) {
  const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'))
  if (!list.length) return
  busy.value += list.length
  try {
    for (const f of list) { await gallery.upload([f], { folder: folder.value, visibility: world.isMaster ? 'members' : 'members' }); busy.value-- }
    toast.success('Загружено')
  } catch (e: any) { toast.error('Ошибка загрузки: ' + (e?.message ?? e)); busy.value = 0 }
}
function select(i: ImageMeta) {
  selected.value = i
  form.value = { name: i.name, folder: i.folder, vis: { visibility: i.visibility, allowedUids: i.allowedUids ?? [] } }
}
async function save() {
  if (!selected.value) return
  await gallery.update(selected.value.id, { name: form.value.name, folder: form.value.folder.trim(), ...form.value.vis })
  selected.value = null
}
async function remove() {
  if (!selected.value || !confirm('Удалить изображение? Оно пропадёт из всех статей, где используется.')) return
  await gallery.remove(selected.value.id)
  selected.value = null
}
async function view(i: ImageMeta) { openLightbox([{ src: await imageUrl(world.access, i.id, 'full'), caption: i.name }]) }
const canManage = (i: ImageMeta) => world.isMaster || i.createdBy === world.uid
</script>

<template>
  <Teleport defer to="#crumbs"><span style="color: var(--text)">Галерея</span></Teleport>
  <div class="content" @dragover.prevent="drag = true" @dragleave.self="drag = false" @drop.prevent="drag = false; upload($event.dataTransfer?.files)">
    <div class="page-head">
      <Icon name="images" :size="28" /><h1 class="grow">Галерея</h1>
      <span class="muted small">{{ gallery.list.length }} изобр. · {{ (totalSize / 1024 / 1024).toFixed(1) }} МБ из ~1000 МБ бесплатной базы</span>
      <button v-if="world.isMember" class="btn btn-primary" @click="fileInput?.click()"><Icon name="upload" :size="16" /> Загрузить</button>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="upload(($event.target as HTMLInputElement).files)" />
    </div>
    <div class="list-toolbar">
      <input v-model="q" class="input" style="max-width: 280px" placeholder="Поиск по названию…" />
      <button class="chip" :class="{ on: !folder }" @click="folder = ''">Все</button>
      <button v-for="f in gallery.folders" :key="f" class="chip" :class="{ on: folder === f }" @click="folder = f"><Icon name="folder" :size="13" /> {{ f }}</button>
      <span v-if="busy" class="muted small pulse">Загрузка: {{ busy }}…</span>
    </div>
    <div v-if="drag" class="dropzone drag" style="margin-bottom: 14px">Отпустите файлы, чтобы загрузить{{ folder ? ` в папку «${folder}»` : '' }}</div>
    <div v-if="!shown.length" class="card empty"><Icon name="images" :size="36" /><p>Изображений нет. Перетащите файлы сюда.</p></div>
    <div class="thumb-grid" style="grid-template-columns: repeat(auto-fill, minmax(170px, 1fr))">
      <div v-for="i in shown" :key="i.id" class="thumb-cell" @click="view(i)">
        <Thumb :id="i.id" />
        <div class="row gap-sm" style="padding: 0 6px 6px">
          <span class="thumb-name grow" style="padding: 0">{{ i.name }}</span>
          <span v-if="i.visibility !== 'members'" class="badge" :title="VISIBILITY_SHORT[i.visibility]"><Icon :name="i.visibility === 'public' ? 'globe' : 'lock'" :size="10" /></span>
          <button v-if="canManage(i)" class="icon-btn" style="width: 24px; height: 24px" title="Свойства" @click.stop="select(i)"><Icon name="pencil" :size="13" /></button>
        </div>
      </div>
    </div>
    <Modal v-if="selected" title="Изображение" @close="selected = null">
      <div class="stack">
        <div style="max-height: 260px; overflow: hidden; border-radius: 8px; text-align: center; background: var(--surface-2)"><Thumb :id="selected.id" variant="full" /></div>
        <p class="faint small" style="margin: 0">{{ selected.width }}×{{ selected.height }} · {{ Math.round(selected.size / 1024) }} КБ · {{ formatDate(selected.createdAt) }} · {{ world.memberName(selected.createdBy) }}</p>
        <label class="field"><span>Название</span><input v-model="form.name" class="input" /></label>
        <label class="field"><span>Папка</span><input v-model="form.folder" class="input" list="gal-folders" /><datalist id="gal-folders"><option v-for="f in gallery.folders" :key="f" :value="f" /></datalist></label>
        <div class="field"><span>Кто видит</span><VisibilitySelect v-model="form.vis" compact /></div>
        <p class="faint small" style="margin: 0">Картинки, вставленные в открытые статьи, автоматически становятся видимыми их читателям.</p>
      </div>
      <template #footer>
        <button class="btn btn-danger" style="margin-right: auto" @click="remove">Удалить</button>
        <button class="btn" @click="selected = null">Отмена</button>
        <button class="btn btn-primary" @click="save">Сохранить</button>
      </template>
    </Modal>
  </div>
</template>
