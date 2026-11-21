<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import ColorPalette from './ColorPalette.vue'

const props = defineProps<{ editor: Editor; allowSecrets: boolean }>()
const emit = defineEmits<{ link: [] }>()
const chain = () => props.editor.chain().focus()

function shouldShow({ editor, state, from, to }: any) {
  if (!editor.isEditable || from === to) return false
  if (state.selection instanceof NodeSelection) return false
  if (!(state.selection instanceof TextSelection)) return false
  if (editor.isActive('codeBlock')) return false
  return state.doc.textBetween(from, to).trim().length > 0
}
</script>

<template>
  <BubbleMenu :editor="editor" plugin-key="textMenu" :should-show="shouldShow" :update-delay="120" :options="{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }">
    <div class="bubble" @mousedown.prevent>
      <button class="tb-btn" :class="{ on: editor.isActive('bold') }" title="Жирный" @click="chain().toggleBold().run()"><Icon name="bold" /></button>
      <button class="tb-btn" :class="{ on: editor.isActive('italic') }" title="Курсив" @click="chain().toggleItalic().run()"><Icon name="italic" /></button>
      <button class="tb-btn" :class="{ on: editor.isActive('underline') }" title="Подчёркнутый" @click="chain().toggleUnderline().run()"><Icon name="underline" /></button>
      <button class="tb-btn" :class="{ on: editor.isActive('strike') }" title="Зачёркнутый" @click="chain().toggleStrike().run()"><Icon name="strikethrough" /></button>
      <span class="bubble-sep" />
      <Dropdown keep-open>
        <template #trigger><button class="tb-btn" title="Цвет текста"><Icon name="baseline" /></button></template>
        <template #default="{ close }"><ColorPalette @pick="(c) => { c ? chain().setColor(c).run() : chain().unsetColor().run(); close() }" /></template>
      </Dropdown>
      <Dropdown keep-open>
        <template #trigger><button class="tb-btn" title="Выделение"><Icon name="highlighter" /></button></template>
        <template #default="{ close }"><ColorPalette reset-label="Без выделения" @pick="(c) => { c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run(); close() }" /></template>
      </Dropdown>
      <button class="tb-btn" :class="{ on: editor.isActive('link') }" title="Ссылка" @click="emit('link')"><Icon name="link" /></button>
      <button class="tb-btn" :class="{ on: editor.isActive('code') }" title="Код" @click="chain().toggleCode().run()"><Icon name="code" /></button>
      <button v-if="allowSecrets" class="tb-btn tb-secret" :class="{ on: editor.isActive('secret') }" title="В секрет мастера" @click="chain().toggleSecret().run()"><Icon name="lock" /></button>
      <button class="tb-btn" title="Очистить форматирование" @click="chain().unsetAllMarks().run()"><Icon name="remove-formatting" /></button>
    </div>
  </BubbleMenu>
</template>
