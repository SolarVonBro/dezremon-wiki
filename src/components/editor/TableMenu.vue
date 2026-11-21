<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { NodeSelection } from '@tiptap/pm/state'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import ColorPalette from './ColorPalette.vue'

const props = defineProps<{ editor: Editor }>()
const chain = () => props.editor.chain().focus()

function shouldShow({ editor, state }: any) {
  if (!editor.isEditable || !editor.isActive('table')) return false
  if (state.selection instanceof NodeSelection && state.selection.node.type.name === 'image') return false
  return true
}
function tableRect() {
  const { view, state } = props.editor
  const dom = view.domAtPos(state.selection.from).node as HTMLElement
  const el = (dom.nodeType === 1 ? dom : dom.parentElement)?.closest('table')
  return el ? { getBoundingClientRect: () => el.getBoundingClientRect() } : null
}
function bg(c: string | null) { chain().setCellAttribute('backgroundColor', c).run() }
function valign(v: string | null) { chain().setCellAttribute('verticalAlign', v).run() }
</script>

<template>
  <BubbleMenu :editor="editor" plugin-key="tableMenu" :should-show="shouldShow" :get-referenced-virtual-element="tableRect" :options="{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }">
    <div class="bubble" @mousedown.prevent>
      <button class="tb-btn" title="Строка выше" @click="chain().addRowBefore().run()"><Icon name="between-horizontal-start" /></button>
      <button class="tb-btn" title="Строка ниже" @click="chain().addRowAfter().run()"><Icon name="rows3" /></button>
      <button class="tb-btn danger" title="Удалить строку" @click="chain().deleteRow().run()"><Icon name="rows2" /><Icon name="x" :size="11" /></button>
      <span class="bubble-sep" />
      <button class="tb-btn" title="Колонка слева" @click="chain().addColumnBefore().run()"><Icon name="between-vertical-start" /></button>
      <button class="tb-btn" title="Колонка справа" @click="chain().addColumnAfter().run()"><Icon name="columns3" /></button>
      <button class="tb-btn danger" title="Удалить колонку" @click="chain().deleteColumn().run()"><Icon name="columns2" /><Icon name="x" :size="11" /></button>
      <span class="bubble-sep" />
      <button class="tb-btn" title="Объединить ячейки" :disabled="!editor.can().mergeCells()" @click="chain().mergeCells().run()"><Icon name="table-cells-merge" /></button>
      <button class="tb-btn" title="Разделить ячейку" :disabled="!editor.can().splitCell()" @click="chain().splitCell().run()"><Icon name="table-cells-split" /></button>
      <Dropdown keep-open>
        <template #trigger><button class="tb-btn" title="Заливка ячейки"><Icon name="paint-bucket" /></button></template>
        <template #default="{ close }"><ColorPalette reset-label="Без заливки" @pick="(c) => { bg(c); close() }" /></template>
      </Dropdown>
      <Dropdown>
        <template #trigger><button class="tb-btn" title="Ещё"><Icon name="more-horizontal" /></button></template>
        <div class="menu">
          <button class="menu-item" @click="chain().toggleHeaderRow().run()">Строка-заголовок вкл/выкл</button>
          <button class="menu-item" @click="chain().toggleHeaderColumn().run()">Колонка-заголовок вкл/выкл</button>
          <button class="menu-item" @click="chain().toggleHeaderCell().run()">Ячейка-заголовок вкл/выкл</button>
          <div class="menu-sep" />
          <div class="menu-label">Вертикальное выравнивание</div>
          <div class="menu-row">
            <button class="chip" @click="valign('top')">Верх</button>
            <button class="chip" @click="valign('middle')">Центр</button>
            <button class="chip" @click="valign('bottom')">Низ</button>
            <button class="chip" @click="valign(null)">Авто</button>
          </div>
          <div class="menu-sep" />
          <button class="menu-item" @click="chain().fixTables().run()">Исправить структуру таблицы</button>
          <button class="menu-item danger" @click="chain().deleteTable().run()"><Icon name="trash2" :size="15" /> Удалить таблицу</button>
        </div>
      </Dropdown>
    </div>
  </BubbleMenu>
</template>
