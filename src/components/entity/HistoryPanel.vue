<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { formatDate, htmlToText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import RichView from '@/components/viewer/RichView.vue'
import { toast } from '@/components/common/toast'
import type { Entity, Revision } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const emit = defineEmits<{ restored: [] }>()
const world = useWorld()
const revs = ref<Revision[]>([])
const loading = ref(true)
const selected = ref<Revision | null>(null)
const current = ref('')

onMounted(async () => {
  try {
    revs.value = await world.revisionsOf(props.entity.id)
    current.value = await world.loadText(props.entity.id)
  } catch (e: any) { toast.error('Не удалось загрузить историю: ' + (e?.message ?? e)) }
  finally { loading.value = false }
})

function sizeDiff(r: Revision) {
  const a = htmlToText(r.html).length
  return a
}
async function restore(r: Revision) {
  if (!confirm(`Вернуть текст статьи к версии от ${formatDate(r.createdAt)}? Текущая версия сохранится в истории.`)) return
  await world.saveText(props.entity.id, current.value, { forceRevision: true })
  await world.saveText(props.entity.id, r.html, { forceRevision: true })
  toast.success('Версия восстановлена')
  emit('restored')
  revs.value = await world.revisionsOf(props.entity.id)
}
</script>

<template>
  <div class="entity-grid history-grid">
    <div class="card card-pad">
      <h3 class="panel-title"><Icon name="clock" /> Версии текста</h3>
      <p class="faint small">Снимок сохраняется не чаще раза в 10 минут при редактировании.</p>
      <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" /></div>
      <div v-else-if="!revs.length" class="empty">История пока пуста.</div>
      <button v-for="r in revs" :key="r.id" class="pick-row" :class="{ active: selected?.id === r.id }" style="width: 100%" @click="selected = r">
        <Icon name="clock" :size="14" />
        <span class="grow"><b>{{ formatDate(r.createdAt) }}</b><br /><span class="faint small">{{ r.createdByName }} · {{ sizeDiff(r) }} зн.</span></span>
      </button>
    </div>
    <div class="card card-pad">
      <template v-if="selected">
        <div class="row gap" style="margin-bottom: 12px">
          <b class="grow">Версия от {{ formatDate(selected.createdAt) }}</b>
          <button v-if="world.canEdit(entity)" class="btn btn-sm btn-primary" @click="restore(selected)"><Icon name="rotate-ccw" :size="14" /> Восстановить эту версию</button>
        </div>
        <RichView :html="selected.html" />
      </template>
      <div v-else class="empty">Выберите версию в списке, чтобы посмотреть её.</div>
    </div>
  </div>
</template>

<style scoped>
.pick-row.active { background: var(--accent-soft); }
.history-grid { grid-template-columns: 320px minmax(0, 1fr); }
@media (max-width: 1100px) { .history-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
