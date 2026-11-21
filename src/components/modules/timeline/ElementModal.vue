<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import type { Entity, TimelineElement, TimelineEra, Visibility } from '@/model/types'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import { COLOUR_PRESETS, TIMELINE_ICONS, colourInputValue, normalizeHtml, parseYear, resolveIcon, safeColour, sortEras } from './timelineUtil'

const props = defineProps<{
  timeline: Entity
  eras: TimelineEra[]
  /** Existing element to edit; null = create. */
  element?: TimelineElement | null
  /** Defaults for a new element. */
  preset?: Partial<TimelineElement>
  /** "Create from article" mode: the article picker is shown first and fills the form. */
  fromEntity?: boolean
  /** order for a new element per era id ('' = no era). */
  nextOrder: (eraId: string | null) => number
}>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()
const world = useWorld()

const src = props.element ?? null
const init: Partial<TimelineElement> = { ...(props.preset ?? {}), ...(src ?? {}) }
const form = reactive({
  name: init.name ?? '',
  date: init.date ?? '',
  year: (init.year ?? null) as number | null | '',
  eraId: init.eraId ?? null as string | null,
  entityId: init.entityId ?? null as string | null,
  icon: src ? resolveIcon(init.icon) : (resolveIcon(init.icon) || 'circle-dot'),
  colour: safeColour(init.colour),
  isCollapsed: init.isCollapsed ?? false,
})
/** Unknown icon value from an import: kept as is until the user picks another icon. */
let rawIcon = init.icon && !resolveIcon(init.icon) ? init.icon : ''
const vis = ref<{ visibility: Visibility; allowedUids: string[] }>({
  visibility: init.visibility ?? props.timeline.visibility ?? 'members',
  allowedUids: [...(init.allowedUids ?? props.timeline.allowedUids ?? [])],
})
const editor = ref<RichEditorInstance | null>(null)
const saving = ref(false)
const yearTouched = ref(src?.year != null)
const iconsOpen = ref(false)

const sortedEras = computed(() => sortEras(props.eras))
const linked = computed(() => world.get(form.entityId))

// Suggest the year from the date text until the user types a year by hand.
watch(() => form.date, (d) => {
  if (yearTouched.value) return
  form.year = parseYear(d)
})
function onYearInput() { yearTouched.value = form.year !== '' && form.year !== null }

// Fill empty fields from the linked article.
let autoName = ''
watch(() => form.entityId, (id, prev) => {
  const e = world.get(id)
  if (!e || id === prev) return
  if (!form.name.trim() || form.name === autoName) { form.name = e.name; autoName = e.name }
  const d = typeof e.fields?.date === 'string' ? e.fields.date : ''
  if (d && !form.date.trim()) form.date = d
  if (props.fromEntity || form.icon === 'circle-dot' || !form.icon) {
    const ti = typeDef(e.type).icon
    if (TIMELINE_ICONS.includes(ti)) { form.icon = ti; rawIcon = '' }
  }
})

/** Era whose year range contains the year (for convenience when no era was chosen). */
watch(() => form.year, (y) => {
  if (src || form.eraId || typeof y !== 'number') return
  const hit = sortedEras.value.find((e) => (e.startYear == null || e.startYear <= y) && (e.endYear == null || y <= e.endYear) && (e.startYear != null || e.endYear != null))
  if (hit) form.eraId = hit.id
})

function pickIcon(name: string) { form.icon = name; rawIcon = ''; iconsOpen.value = false }
function clearIcon() { form.icon = ''; rawIcon = '' }

async function save() {
  if (!form.name.trim() || saving.value) return
  saving.value = true
  try {
    const eraId = form.eraId && props.eras.some((e) => e.id === form.eraId) ? form.eraId : null
    const year = form.year === '' || form.year === null || !Number.isFinite(Number(form.year)) ? null : Math.trunc(Number(form.year))
    const data: Record<string, any> = {
      timelineId: props.timeline.id,
      eraId,
      entityId: form.entityId || null,
      name: form.name.trim(),
      date: form.date.trim(),
      year,
      icon: form.icon || rawIcon,
      colour: safeColour(form.colour),
      isCollapsed: form.isCollapsed,
      html: normalizeHtml(editor.value?.getHTML() ?? init.html ?? ''),
      visibility: vis.value.visibility,
      allowedUids: vis.value.allowedUids,
    }
    if (src) {
      data.id = src.id
      if ((src.eraId ?? null) !== eraId) data.order = props.nextOrder(eraId)
    } else {
      data.order = props.nextOrder(eraId)
    }
    const id = await world.saveRow('timelineElements', data)
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
  <Modal :title="src ? 'Событие хронологии' : fromEntity ? 'Событие из статьи' : 'Новое событие'" width="760px" @close="emit('close')">
    <form class="stack" @submit.prevent="save">
      <div v-if="fromEntity && !src" class="field from-entity">
        <span>Статья</span>
        <EntityPicker v-model="form.entityId" placeholder="Выберите статью — название, дата и значок подставятся сами" :allow-create="false" />
      </div>

      <div class="el-grid">
        <label class="field el-name">
          <span>Название</span>
          <input v-model="form.name" class="input" required :autofocus="!fromEntity" placeholder="Падение Белой Башни" />
        </label>
        <label class="field">
          <span>Дата (как показывать)</span>
          <input v-model="form.date" class="input" placeholder="12 мая 1250 г." />
        </label>
        <label class="field">
          <span>Год (для сортировки)</span>
          <input v-model.number="form.year" class="input" type="number" step="1" placeholder="—" @input="onYearInput" />
        </label>
        <label class="field">
          <span>Эпоха</span>
          <select v-model="form.eraId" class="input">
            <option :value="null">— без эпохи —</option>
            <option v-for="e in sortedEras" :key="e.id" :value="e.id">{{ e.name }}{{ e.abbreviation ? ` (${e.abbreviation})` : '' }}</option>
          </select>
        </label>
        <div v-if="!fromEntity || src" class="field">
          <span>Связанная статья</span>
          <EntityPicker v-model="form.entityId" placeholder="Не выбрана" />
        </div>
      </div>

      <div class="el-look">
        <div class="field">
          <span>Значок</span>
          <div class="row gap-sm">
            <button type="button" class="icon-preview" :style="{ '--c': form.colour || 'var(--accent)' }" :title="iconsOpen ? 'Скрыть значки' : 'Выбрать значок'" @click="iconsOpen = !iconsOpen">
              <Icon v-if="form.icon" :name="form.icon" :size="18" />
              <span v-else class="faint small">—</span>
            </button>
            <button type="button" class="btn btn-sm btn-ghost" @click="iconsOpen = !iconsOpen">
              {{ iconsOpen ? 'Скрыть' : 'Выбрать…' }}
            </button>
            <button v-if="form.icon" type="button" class="btn btn-sm btn-ghost" title="Без значка" @click="clearIcon">Без значка</button>
          </div>
        </div>
        <div class="field">
          <span>Цвет</span>
          <div class="row gap-sm wrap">
            <input class="colour-input" type="color" :value="colourInputValue(form.colour)" title="Свой цвет" @input="form.colour = ($event.target as HTMLInputElement).value" />
            <button v-for="c in COLOUR_PRESETS" :key="c" type="button" class="swatch" :class="{ on: form.colour.toLowerCase() === c }" :style="{ background: c }" :title="c" @click="form.colour = c" />
            <button type="button" class="btn btn-sm btn-ghost" :class="{ on: !form.colour }" @click="form.colour = ''">По умолчанию</button>
          </div>
        </div>
      </div>
      <div v-if="iconsOpen" class="icon-grid">
        <button v-for="n in TIMELINE_ICONS" :key="n" type="button" class="icon-cell" :class="{ on: form.icon === n }" :title="n" @click="pickIcon(n)">
          <Icon :name="n" :size="18" />
        </button>
      </div>

      <div class="field">
        <span>Описание</span>
        <RichEditor ref="editor" :model-value="init.html ?? ''" compact min-height="150px" :upload-visibility="vis" placeholder="Что произошло…" />
      </div>
      <div v-if="linked" class="muted small">Связано со статьёй «{{ linked.name }}» ({{ typeDef(linked.type).label.toLowerCase() }}).</div>
      <label class="check small"><input v-model="form.isCollapsed" type="checkbox" /> Свёрнуто по умолчанию (показывать только заголовок)</label>
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
.el-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.el-name { grid-column: 1 / -1; }
.from-entity { padding: 10px 12px; border: 1px dashed var(--accent); border-radius: var(--radius); background: var(--accent-soft); }
.el-look { display: grid; grid-template-columns: auto 1fr; gap: 10px 24px; align-items: start; }
.icon-preview {
  width: 36px; height: 36px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  border: 2px solid var(--c); background: color-mix(in srgb, var(--c) 18%, var(--surface)); color: var(--c);
}
.icon-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 4px; padding: 8px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); max-height: 200px; overflow-y: auto;
}
.icon-cell {
  height: 36px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 8px;
  background: none; cursor: pointer; color: var(--text-muted);
}
.icon-cell:hover { background: var(--surface); color: var(--text); border-color: var(--border); }
.icon-cell.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.colour-input { width: 34px; height: 28px; padding: 0 2px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); cursor: pointer; }
.swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; padding: 0; }
.swatch.on { box-shadow: 0 0 0 2px var(--text); }
.btn.on { color: var(--accent); }
@media (max-width: 640px) {
  .el-grid, .el-look { grid-template-columns: 1fr; }
}
</style>
