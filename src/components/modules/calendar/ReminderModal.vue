<script setup lang="ts">
// Create / edit / view a calendar date ("reminder").
// - In a calendar: pass `calendarId` (fixed) — the linked entity is chosen with a picker.
// - On an entity page: pass `entityId` (fixed) — the calendar is chosen from the world's calendars.
import { computed, reactive, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import type { CalendarDate, Reminder, Visibility } from '@/model/types'
import {
  clampDate, formatDateRange, fromDayIndex, dayIndex, REMINDER_KIND_LABELS, type CalendarConfig,
} from '@/data/calendar'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { toast } from '@/components/common/toast'
import DateInput from './DateInput.vue'
import ColourInput from './ColourInput.vue'
import { calendarOf, canEditReminder, KIND_ICONS, KIND_OPTIONS, recurrenceLabel, reminderColour, reminderTitle } from './shared'

const props = withDefaults(defineProps<{
  /** Existing reminder (has `id`) or prefilled values for a new one. */
  reminder?: Partial<Reminder> | null
  /** Fixed calendar (hides the calendar selector). */
  calendarId?: string | null
  /** Fixed linked entity (hides the entity picker). */
  entityId?: string | null
  /** Force the read-only view. */
  readonly?: boolean
}>(), { reminder: null, calendarId: undefined, entityId: undefined, readonly: false })
const emit = defineEmits<{ close: []; saved: [id: string]; deleted: [] }>()
const world = useWorld()

const existing = computed(() => (props.reminder?.id ? (props.reminder as Reminder) : null))
const canEdit = computed(() => !props.readonly && (!existing.value || canEditReminder(world, existing.value)))
const calendars = computed(() => world.byType.get('calendar') ?? [])
const fixedCalendar = computed(() => props.calendarId !== undefined)
const fixedEntity = computed(() => props.entityId !== undefined)

function defaultCalendarId(): string | null {
  if (props.calendarId) return props.calendarId
  if (props.reminder?.calendarId) return props.reminder.calendarId
  const main = world.settings.mainCalendarId
  if (main && world.get(main)) return main
  return calendars.value[0]?.id ?? null
}

const r0 = props.reminder ?? {}
const draft = reactive({
  name: r0.name ?? '',
  calendarId: defaultCalendarId(),
  entityId: (props.entityId !== undefined ? props.entityId : r0.entityId) ?? null,
  kind: (r0.kind ?? 'event') as Reminder['kind'],
  length: Math.max(1, r0.length ?? 1),
  colour: r0.colour ?? '',
  comment: r0.comment ?? '',
  isRecurring: r0.isRecurring ?? false,
  recurPeriod: (r0.recurPeriod ?? 'year') as Reminder['recurPeriod'],
  recurUntil: (r0.recurUntil ?? null) as number | null,
})
const calendarEntity = computed(() => world.get(draft.calendarId))
const cfg = computed<CalendarConfig>(() => calendarOf(calendarEntity.value))
const date = ref<CalendarDate>(clampDate(cfg.value, {
  year: r0.year ?? cfg.value.current.year, month: r0.month ?? cfg.value.current.month, day: r0.day ?? cfg.value.current.day,
}))
const vis = ref<{ visibility: Visibility; allowedUids: string[] }>({
  visibility: r0.visibility ?? (world.isMaster ? world.settings.defaultVisibility : 'members'),
  allowedUids: r0.allowedUids ?? [],
})
const saving = ref(false)

// Another calendar may have fewer months / shorter months.
watch(cfg, (c) => { date.value = clampDate(c, date.value) })

const endDate = computed(() => fromDayIndex(cfg.value, dayIndex(cfg.value, date.value) + draft.length - 1))
const preview = computed(() => formatDateRange(cfg.value, date.value, endDate.value, { weekday: draft.length === 1 }))
const title = computed(() => {
  if (!canEdit.value) return reminderTitle({ name: draft.name, entityId: draft.entityId, kind: draft.kind }, world.get)
  return existing.value ? 'Изменить дату' : 'Новое событие'
})
const untilStr = computed({
  get: () => (draft.recurUntil === null ? '' : String(draft.recurUntil)),
  set: (v: string) => { const n = Math.trunc(Number(v)); draft.recurUntil = v.trim() === '' || !Number.isFinite(n) ? null : n },
})

async function save() {
  if (!draft.calendarId) { toast.error('Выберите календарь'); return }
  saving.value = true
  try {
    const d = clampDate(cfg.value, date.value)
    const data: Partial<Reminder> & Record<string, any> = {
      calendarId: draft.calendarId,
      entityId: draft.entityId || null,
      name: draft.name.trim(),
      year: d.year, month: d.month, day: d.day,
      length: Math.max(1, Math.trunc(draft.length) || 1),
      colour: draft.colour,
      comment: draft.comment.trim(),
      kind: draft.kind,
      isRecurring: draft.isRecurring,
      recurPeriod: draft.recurPeriod,
      recurUntil: draft.isRecurring ? draft.recurUntil : null,
      visibility: vis.value.visibility,
      allowedUids: vis.value.allowedUids,
    }
    if (existing.value) data.id = existing.value.id
    const id = await world.saveRow('reminders', data)
    emit('saved', id)
    emit('close')
  } catch {
    // toast already shown by the store
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!existing.value) return
  if (!window.confirm('Удалить эту дату?')) return
  saving.value = true
  try {
    await world.deleteRow('reminders', existing.value.id)
    emit('deleted')
    emit('close')
  } catch {
    // toast already shown by the store
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :title="title" width="560px" @close="emit('close')">
    <!-- read-only view -->
    <div v-if="!canEdit" class="stack rm-view">
      <div class="row gap-sm rm-head">
        <span class="rm-dot" :style="{ background: reminderColour(draft) }" />
        <Icon :name="KIND_ICONS[draft.kind]" :size="16" class="muted" />
        <span class="muted small">{{ REMINDER_KIND_LABELS[draft.kind] }}</span>
      </div>
      <div class="rm-date">{{ preview }}</div>
      <div v-if="draft.isRecurring" class="muted small row gap-sm"><Icon name="refresh-cw" :size="14" /> {{ recurrenceLabel(cfg, draft) }}</div>
      <div v-if="draft.entityId" class="row gap-sm"><span class="muted small">Статья:</span> <EntityLink :id="draft.entityId" /></div>
      <div v-if="!fixedCalendar && draft.calendarId" class="row gap-sm"><span class="muted small">Календарь:</span> <EntityLink :id="draft.calendarId" /></div>
      <p v-if="draft.comment" class="rm-comment">{{ draft.comment }}</p>
    </div>

    <!-- edit form -->
    <form v-else class="stack" @submit.prevent="save">
      <label class="field">
        <span>Название</span>
        <input v-model="draft.name" class="input" :placeholder="draft.entityId ? `${REMINDER_KIND_LABELS[draft.kind]} — по названию статьи` : 'Праздник урожая, битва при…'" autofocus />
      </label>

      <label v-if="!fixedCalendar" class="field">
        <span>Календарь</span>
        <select v-model="draft.calendarId" class="input">
          <option v-if="!calendars.length" :value="null" disabled>Нет календарей</option>
          <option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}{{ c.id === world.settings.mainCalendarId ? ' (основной)' : '' }}</option>
        </select>
      </label>

      <div class="field">
        <span>Дата</span>
        <DateInput v-model="date" :cfg="cfg" :small="false" />
        <span class="muted small rm-preview">{{ preview }}</span>
      </div>

      <div class="rm-grid">
        <label class="field">
          <span>Тип</span>
          <select v-model="draft.kind" class="input">
            <option v-for="o in KIND_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>Длительность, дней</span>
          <input v-model.number="draft.length" class="input" type="number" min="1" />
        </label>
      </div>

      <div v-if="!fixedEntity" class="field">
        <span>Связанная статья</span>
        <EntityPicker v-model="draft.entityId" placeholder="Не выбрана (необязательно)" :exclude="draft.calendarId ? [draft.calendarId] : []" />
      </div>

      <div class="field">
        <span>Цвет</span>
        <ColourInput v-model="draft.colour" />
      </div>

      <label class="field">
        <span>Комментарий</span>
        <textarea v-model="draft.comment" class="input" rows="2" />
      </label>

      <div class="field">
        <label class="check"><input v-model="draft.isRecurring" type="checkbox" /> Повторяется</label>
        <div v-if="draft.isRecurring" class="rm-grid">
          <label class="field">
            <span>Период</span>
            <select v-model="draft.recurPeriod" class="input input-sm">
              <option value="year">Каждый год</option>
              <option value="month">Каждый месяц</option>
            </select>
          </label>
          <label class="field">
            <span>До года (включительно)</span>
            <input v-model="untilStr" class="input input-sm" type="number" placeholder="без ограничения" />
          </label>
        </div>
        <span v-if="draft.isRecurring && existing" class="muted small">Изменяется исходная дата всех повторений.</span>
      </div>

      <div class="field">
        <span>Кто видит</span>
        <VisibilitySelect v-model="vis" compact />
      </div>
      <button type="submit" class="hidden" />
    </form>

    <template #footer>
      <button v-if="canEdit && existing" type="button" class="btn btn-danger" :disabled="saving" @click="remove"><Icon name="trash2" :size="15" /> Удалить</button>
      <span class="grow" />
      <button type="button" class="btn btn-ghost" @click="emit('close')">{{ canEdit ? 'Отмена' : 'Закрыть' }}</button>
      <button v-if="canEdit" type="button" class="btn btn-primary" :disabled="saving || !draft.calendarId" @click="save"><Icon name="check" :size="15" /> Сохранить</button>
    </template>
  </Modal>
</template>

<style scoped>
.rm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.rm-preview { margin-top: 2px; }
.rm-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.rm-date { font-family: var(--font-head); font-size: 20px; font-weight: 600; }
.rm-comment { margin: 0; white-space: pre-wrap; font-family: var(--font-text); }
@media (max-width: 520px) { .rm-grid { grid-template-columns: 1fr; } }
</style>
