<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import Icon from '@/components/common/Icon.vue'
import { findKey } from './extensions/findReplace'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ close: [] }>()
const query = ref('')
const replace = ref('')
const cs = ref(false)
const input = ref<HTMLInputElement | null>(null)

const st = computed(() => {
  void props.editor.state // reactive dependency on transactions
  return findKey.getState(props.editor.state)
})
watch([query, cs], () => props.editor.commands.setFindQuery(query.value, cs.value))
onMounted(() => {
  const { from, to } = props.editor.state.selection
  const sel = props.editor.state.doc.textBetween(from, to)
  if (sel && sel.length < 80) query.value = sel
  input.value?.focus()
  input.value?.select()
})
function close() { props.editor.commands.clearFind(); emit('close') }
function key(e: KeyboardEvent) {
  if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? props.editor.commands.findPrev() : props.editor.commands.findNext() }
  if (e.key === 'Escape') close()
}
</script>

<template>
  <div class="findbar">
    <Icon name="search" :size="16" />
    <input ref="input" v-model="query" class="input input-sm" placeholder="Найти…" @keydown="key" />
    <span class="find-count">{{ st?.matches.length ? `${st.index + 1} из ${st.matches.length}` : query ? 'нет' : '' }}</span>
    <button class="tb-btn" title="Предыдущее (Shift+Enter)" @click="editor.commands.findPrev()"><Icon name="chevron-up" /></button>
    <button class="tb-btn" title="Следующее (Enter)" @click="editor.commands.findNext()"><Icon name="chevron-down" /></button>
    <button class="tb-btn" :class="{ on: cs }" title="Учитывать регистр" @click="cs = !cs"><Icon name="case-sensitive" /></button>
    <input v-model="replace" class="input input-sm" placeholder="Заменить на…" @keydown.esc="close" />
    <button class="btn btn-sm" :disabled="!st?.matches.length" @click="editor.commands.replaceCurrent(replace)">Заменить</button>
    <button class="btn btn-sm" :disabled="!st?.matches.length" @click="editor.commands.replaceAll(replace)">Все</button>
    <button class="tb-btn" title="Закрыть" @click="close"><Icon name="x" /></button>
  </div>
</template>
