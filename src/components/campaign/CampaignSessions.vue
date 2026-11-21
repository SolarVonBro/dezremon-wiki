<script setup lang="ts">
// The campaign journal: one record per game session (planned or played), written by the GMs.
import { computed, ref } from 'vue'
import { useSession } from '@/stores/session'
import { saveSession, deleteSession } from '@/data/campaigns'
import { formatDate, errorText } from '@/data/util'
import { toLocalInput, fromLocalInput } from './dates'
import Icon from '@/components/common/Icon.vue'
import RichView from '@/components/viewer/RichView.vue'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignSession } from '@/model/types'

const props = defineProps<{ campaign: Campaign; sessions: CampaignSession[]; isGm: boolean; worldReady: boolean }>()
const session = useSession()
const editor = ref<RichEditorInstance | null>(null)
const form = ref<{ id?: string; number: number; title: string; date: string; status: 'planned' | 'done'; html: string } | null>(null)
const busy = ref(false)
const collapsed = ref(new Set<string>())

const nextNumber = computed(() => props.sessions.reduce((m, s) => Math.max(m, s.number), 0) + 1)

function openNew(status: 'planned' | 'done') {
  form.value = { number: nextNumber.value, title: '', date: toLocalInput(status === 'planned' ? props.campaign.nextSessionAt : Date.now()), status, html: '' }
}
function openEdit(s: CampaignSession) {
  form.value = { id: s.id, number: s.number, title: s.title, date: toLocalInput(s.date), status: s.status, html: s.html }
}
async function save() {
  const f = form.value
  if (!f || !session.user) return
  busy.value = true
  try {
    await saveSession(props.campaign.id, {
      id: f.id, number: Number(f.number) || nextNumber.value, title: f.title.trim(), date: fromLocalInput(f.date), status: f.status,
      html: editor.value?.getHTML() ?? f.html,
    }, session.user.uid)
    form.value = null
    toast.success('Сохранено')
  } catch (e: any) { toast.error('Не удалось сохранить: ' + errorText(e)) } finally { busy.value = false }
}
async function remove(s: CampaignSession) {
  if (!confirm(`Удалить запись «Сессия ${s.number}${s.title ? ' — ' + s.title : ''}»?`)) return
  await deleteSession(props.campaign.id, s.id).catch((e) => toast.error(errorText(e)))
}
function toggle(id: string) {
  const n = new Set(collapsed.value)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  collapsed.value = n
}
</script>

<template>
  <div class="stack" style="max-width: 900px">
    <div v-if="isGm && !form" class="row gap wrap">
      <button class="btn btn-primary" @click="openNew('done')"><Icon name="plus" :size="15" /> Записать сыгранную сессию</button>
      <button class="btn" @click="openNew('planned')"><Icon name="calendar-clock" :size="15" /> Запланировать</button>
    </div>

    <section v-if="form" class="card card-pad stack">
      <h3 class="panel-title" style="margin: 0">{{ form.id ? 'Сессия ' + form.number : 'Новая запись' }}</h3>
      <div class="row gap wrap">
        <label class="field" style="width: 90px"><span>Номер</span><input v-model.number="form.number" type="number" min="0" class="input" /></label>
        <label class="field grow" style="min-width: 200px"><span>Название</span><input v-model="form.title" class="input" placeholder="Засада у старой мельницы" /></label>
      </div>
      <div class="row gap wrap">
        <label class="field"><span>Дата и время</span><input v-model="form.date" type="datetime-local" class="input" /></label>
        <label class="field"><span>Статус</span>
          <select v-model="form.status" class="input"><option value="done">Сыграна</option><option value="planned">Запланирована</option></select>
        </label>
      </div>
      <div class="field"><span>{{ form.status === 'planned' ? 'План игры' : 'Что произошло' }}</span>
        <RichEditor ref="editor" :model-value="form.html" :allow-images="false" compact min-height="220px"
          :placeholder="worldReady ? 'Текст… «@» — ссылка на статью мира' : 'Текст…'" />
      </div>
      <div class="row gap">
        <button class="btn btn-primary" :disabled="busy" @click="save"><Icon name="check" :size="15" /> Сохранить</button>
        <button class="btn" :disabled="busy" @click="form = null">Отмена</button>
      </div>
    </section>

    <div v-if="!sessions.length && !form" class="card empty">
      <Icon name="book-open" :size="32" />
      <p>Журнал пуст.<template v-if="isGm"> Записывайте, что произошло на каждой игре, — игроки увидят это здесь.</template></p>
    </div>

    <article v-for="s in sessions" v-show="s.id !== form?.id" :key="s.id" class="card card-pad sess" :class="{ planned: s.status === 'planned' }">
      <header class="row gap wrap sess-head" @click="toggle(s.id)">
        <Icon :name="collapsed.has(s.id) ? 'chevron-right' : 'chevron-down'" :size="16" class="faint" />
        <h3 class="grow">Сессия {{ s.number }}<span v-if="s.title" class="muted"> — {{ s.title }}</span></h3>
        <span class="badge" :class="{ 'badge-public': s.status === 'done' }">{{ s.status === 'done' ? 'сыграна' : 'запланирована' }}</span>
        <span v-if="s.date" class="faint small">{{ formatDate(s.date) }}</span>
        <template v-if="isGm">
          <button class="icon-btn" title="Изменить" @click.stop="openEdit(s)"><Icon name="pencil" :size="15" /></button>
          <button class="icon-btn" title="Удалить" @click.stop="remove(s)"><Icon name="trash2" :size="15" /></button>
        </template>
      </header>
      <template v-if="!collapsed.has(s.id)">
        <RichView v-if="s.html" :html="s.html" class="prose sess-body" />
        <p v-else class="faint small" style="margin: 6px 0 0">Без описания.</p>
      </template>
    </article>
  </div>
</template>

<style scoped>
.sess-head { cursor: pointer; user-select: none; }
.sess-head h3 { margin: 0; font-size: 21px; min-width: 0; overflow-wrap: break-word; }
.sess.planned { border-style: dashed; }
.sess-body { margin-top: 10px; font-size: 16.5px; }
</style>
