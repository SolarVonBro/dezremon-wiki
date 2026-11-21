<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useWorld } from '@/stores/world'
import type { Entity, TimelineEra, Visibility } from '@/model/types'
import Modal from '@/components/common/Modal.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import { normalizeHtml } from './timelineUtil'

const props = defineProps<{ timeline: Entity; era?: TimelineEra | null; nextOrder: number }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()
const world = useWorld()

const src = props.era
const form = reactive({
  name: src?.name ?? '',
  abbreviation: src?.abbreviation ?? '',
  startYear: src?.startYear ?? null as number | null,
  endYear: src?.endYear ?? null as number | null,
  isCollapsed: src?.isCollapsed ?? false,
})
const vis = ref<{ visibility: Visibility; allowedUids: string[] }>({
  visibility: src?.visibility ?? props.timeline.visibility ?? 'members',
  allowedUids: [...(src?.allowedUids ?? props.timeline.allowedUids ?? [])],
})
const editor = ref<RichEditorInstance | null>(null)
const saving = ref(false)

const toNum = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))

async function save() {
  if (!form.name.trim() || saving.value) return
  saving.value = true
  try {
    const data: Record<string, any> = {
      timelineId: props.timeline.id,
      name: form.name.trim(),
      abbreviation: form.abbreviation.trim(),
      startYear: toNum(form.startYear),
      endYear: toNum(form.endYear),
      isCollapsed: form.isCollapsed,
      html: normalizeHtml(editor.value?.getHTML() ?? src?.html ?? ''),
      visibility: vis.value.visibility,
      allowedUids: vis.value.allowedUids,
    }
    if (src) data.id = src.id
    else data.order = props.nextOrder
    const id = await world.saveRow('timelineEras', data)
    emit('saved', id)
    emit('close')
  } catch {
    /* toast already shown by the store */
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :title="era ? 'Эпоха' : 'Новая эпоха'" width="720px" @close="emit('close')">
    <form class="stack" @submit.prevent="save">
      <div class="era-grid">
        <label class="field era-name">
          <span>Название</span>
          <input v-model="form.name" class="input" required autofocus placeholder="Эпоха Расколотых Корон" />
        </label>
        <label class="field">
          <span>Сокращение</span>
          <input v-model="form.abbreviation" class="input" maxlength="12" placeholder="Э.Р.К." />
        </label>
        <label class="field">
          <span>Начало (год)</span>
          <input v-model.number="form.startYear" class="input" type="number" step="1" />
        </label>
        <label class="field">
          <span>Конец (год)</span>
          <input v-model.number="form.endYear" class="input" type="number" step="1" />
        </label>
      </div>
      <div class="field">
        <span>Описание</span>
        <RichEditor ref="editor" :model-value="src?.html ?? ''" compact min-height="140px" :upload-visibility="vis" placeholder="Описание эпохи…" />
      </div>
      <label class="check small"><input v-model="form.isCollapsed" type="checkbox" /> Свёрнута по умолчанию</label>
      <div class="field">
        <span>Кто видит</span>
        <VisibilitySelect v-model="vis" compact />
      </div>
    </form>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="emit('close')">Отмена</button>
      <button type="button" class="btn btn-primary" :disabled="!form.name.trim() || saving" @click="save">Сохранить</button>
    </template>
  </Modal>
</template>

<style scoped>
.era-grid { display: grid; grid-template-columns: 1fr 140px; gap: 10px 12px; }
.era-name { grid-column: 1 / -1; }
@media (min-width: 640px) {
  .era-grid { grid-template-columns: 2fr 1fr 1fr 1fr; }
  .era-name { grid-column: auto; }
}
</style>
