<script setup lang="ts">
import { ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useAutosave } from '@/composables/useAutosave'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { VISIBILITY_SHORT } from '@/data/access'
import type { Entity, Post, Visibility } from '@/model/types'

const props = defineProps<{ post: Post; entity: Entity }>()
const emit = defineEmits<{ done: [] }>()
const world = useWorld()
const title = ref(props.post.title)
const editor = ref<RichEditorInstance | null>(null)
const vis = ref<{ visibility: Visibility; allowedUids: string[] }>({ visibility: props.post.visibility, allowedUids: props.post.allowedUids ?? [] })
const position = ref(props.post.position ?? 'after')
const collapsedDefault = ref(!!props.post.isCollapsed)
let last = props.post.html

const autosave = useAutosave(async () => {
  const ed = editor.value
  if (!ed) return
  if (ed.pendingUploads > 0) return false
  const html = ed.getHTML()
  const patch: Partial<Post> & { id: string } = { id: props.post.id, title: title.value.trim(), position: position.value, isCollapsed: collapsedDefault.value, ...vis.value }
  if (html !== last) patch.html = html
  await world.saveRow('posts', patch)
  last = html
}, { delay: 1500 })

async function setVis(v: { visibility: Visibility; allowedUids: string[] }) { vis.value = v; autosave.touch() }
async function remove() {
  if (!confirm(`Удалить раздел «${props.post.title}»?`)) return
  await world.deleteRow('posts', props.post.id)
  emit('done')
}
async function done() { autosave.touch(); await autosave.flush(); emit('done') }
</script>

<template>
  <section class="card post-card stack-sm">
    <div class="row gap-sm wrap">
      <input v-model="title" class="input grow" style="font-family: var(--font-head); font-size: 20px; font-weight: 700" placeholder="Название раздела" @input="autosave.touch()" />
      <Dropdown keep-open placement="bottom-end">
        <template #trigger><button class="btn btn-sm"><Icon name="shield" :size="14" /> {{ VISIBILITY_SHORT[vis.visibility] }}</button></template>
        <div class="menu" style="width: 320px; padding: 10px"><VisibilitySelect :model-value="vis" @update:model-value="setVis" /></div>
      </Dropdown>
      <select v-model="position" class="input input-sm" style="width: auto" @change="autosave.touch()"><option value="before">Над статьёй</option><option value="after">Под статьёй</option></select>
      <label class="check small"><input v-model="collapsedDefault" type="checkbox" @change="autosave.touch()" /> свёрнут</label>
      <button class="icon-btn danger" title="Удалить раздел" @click="remove"><Icon name="trash2" :size="16" /></button>
      <button class="btn btn-sm btn-primary" @click="done"><Icon name="check" :size="14" /> Готово</button>
    </div>
    <RichEditor ref="editor" :model-value="post.html" compact min-height="180px" :upload-visibility="vis" :folder="entity.name" @dirty="autosave.touch()" @save-now="autosave.flush()" @uploaded="autosave.touch()" />
  </section>
</template>
