<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import ColorPalette from './ColorPalette.vue'
import { CALLOUTS } from './extensions/blocks'

const props = withDefaults(defineProps<{ editor: Editor; allowSecrets: boolean; allowImages?: boolean; source: boolean; fullscreen: boolean; compact?: boolean }>(), { allowImages: true })
const emit = defineEmits<{ action: [name: 'image' | 'youtube' | 'link' | 'html' | 'find' | 'fullscreen' | 'rawhtml'] }>()

const e = computed(() => props.editor)
const chain = () => e.value.chain().focus()

interface FontOpt { label: string; value: string | null }
const FONTS: FontOpt[] = [
  { label: 'По умолчанию', value: null },
  { label: 'Lora', value: 'Lora, serif' },
  { label: 'PT Serif', value: '"PT Serif", serif' },
  { label: 'Cormorant Garamond', value: '"Cormorant Garamond", serif' },
  { label: 'Alegreya', value: 'Alegreya, serif' },
  { label: 'Old Standard', value: '"Old Standard TT", serif' },
  { label: 'Kurale', value: 'Kurale, serif' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'PT Sans', value: '"PT Sans", sans-serif' },
  { label: 'Philosopher', value: 'Philosopher, sans-serif' },
  { label: 'Ruslan Display', value: '"Ruslan Display", serif' },
  { label: 'Marck Script', value: '"Marck Script", cursive' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
]
const SIZES = ['10px', '11px', '12px', '13px', '14px', '15px', '16px', '17px', '18px', '20px', '22px', '24px', '28px', '32px', '36px', '42px', '48px', '60px', '72px']
const LINE_HEIGHTS = ['1', '1.15', '1.3', '1.5', '1.75', '2', '2.5']

const blockLabel = computed(() => {
  const ed = e.value
  for (let l = 1; l <= 4; l++) if (ed.isActive('heading', { level: l })) return `Заголовок ${l}`
  if (ed.isActive('codeBlock')) return 'Код'
  if (ed.isActive('blockquote')) return 'Цитата'
  return 'Текст'
})
const fontLabel = computed(() => {
  const ff = e.value.getAttributes('textStyle').fontFamily as string | undefined
  return FONTS.find((f) => f.value === ff)?.label ?? (ff ? ff.split(',')[0].replace(/"/g, '') : 'Шрифт')
})
// the size set on the text, or else the size the text under the cursor actually has (paragraph, heading…)
const sizeLabel = computed(() => {
  const ed = e.value
  const set = ed.getAttributes('textStyle').fontSize as string | undefined
  if (set) return set.replace('px', '')
  try {
    const { node } = ed.view.domAtPos(ed.state.selection.from)
    const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement
    const px = el ? parseFloat(getComputedStyle(el).fontSize) : NaN
    return Number.isFinite(px) ? String(Math.round(px)) : '—'
  } catch { return '—' }
})
const textColor = computed(() => e.value.getAttributes('textStyle').color as string | undefined)
const hlColor = computed(() => e.value.getAttributes('highlight').color as string | undefined)

// table size picker
const hover = ref<[number, number]>([0, 0])
function insertTable(r: number, c: number) { chain().insertTable({ rows: r, cols: c, withHeaderRow: true }).run() }

const align = computed(() => (['left', 'center', 'right', 'justify'] as const).find((a) => e.value.isActive({ textAlign: a })) ?? 'left')
const ALIGN_ICON = { left: 'align-left', center: 'align-center', right: 'align-right', justify: 'align-justify' }
</script>

<template>
  <div class="tb" :class="{ 'tb-compact': compact }" @mousedown.prevent>
    <div class="tb-group">
      <button class="tb-btn" title="Отменить (Ctrl+Z)" :disabled="source || !e.can().undo()" @click="chain().undo().run()"><Icon name="undo2" /></button>
      <button class="tb-btn" title="Повторить (Ctrl+Y)" :disabled="source || !e.can().redo()" @click="chain().redo().run()"><Icon name="redo2" /></button>
    </div>

    <template v-if="!source">
      <div class="tb-group">
        <Dropdown>
          <template #trigger><button class="tb-btn tb-select" title="Стиль абзаца">{{ blockLabel }}<Icon name="chevron-down" :size="14" /></button></template>
          <div class="menu">
            <button class="menu-item" @click="chain().setParagraph().run()">Обычный текст</button>
            <button v-for="l in [1, 2, 3, 4]" :key="l" class="menu-item" :class="'menu-h' + l" @click="chain().toggleHeading({ level: l as 1 | 2 | 3 | 4 }).run()">Заголовок {{ l }}</button>
            <button class="menu-item" @click="chain().toggleBlockquote().run()"><Icon name="quote" :size="15" /> Цитата</button>
            <button class="menu-item" @click="chain().toggleCodeBlock().run()"><Icon name="square-code" :size="15" /> Блок кода</button>
          </div>
        </Dropdown>
        <Dropdown v-if="!compact">
          <template #trigger><button class="tb-btn tb-select tb-font" title="Шрифт">{{ fontLabel }}<Icon name="chevron-down" :size="14" /></button></template>
          <div class="menu menu-scroll">
            <button v-for="f in FONTS" :key="f.label" class="menu-item" :style="{ fontFamily: f.value ?? undefined }"
              @click="f.value ? chain().setFontFamily(f.value).run() : chain().unsetFontFamily().run()">{{ f.label }}</button>
          </div>
        </Dropdown>
        <Dropdown>
          <template #trigger><button class="tb-btn tb-select tb-size" title="Размер шрифта">{{ sizeLabel }}<Icon name="chevron-down" :size="14" /></button></template>
          <div class="menu menu-scroll">
            <button class="menu-item" @click="chain().unsetFontSize().run()">Обычный</button>
            <button v-for="s in SIZES" :key="s" class="menu-item" @click="chain().setFontSize(s).run()">{{ s.replace('px', '') }}</button>
          </div>
        </Dropdown>
      </div>

      <div class="tb-group">
        <button class="tb-btn" :class="{ on: e.isActive('bold') }" title="Жирный (Ctrl+B)" @click="chain().toggleBold().run()"><Icon name="bold" /></button>
        <button class="tb-btn" :class="{ on: e.isActive('italic') }" title="Курсив (Ctrl+I)" @click="chain().toggleItalic().run()"><Icon name="italic" /></button>
        <button class="tb-btn" :class="{ on: e.isActive('underline') }" title="Подчёркнутый (Ctrl+U)" @click="chain().toggleUnderline().run()"><Icon name="underline" /></button>
        <button class="tb-btn" :class="{ on: e.isActive('strike') }" title="Зачёркнутый (Ctrl+Shift+S)" @click="chain().toggleStrike().run()"><Icon name="strikethrough" /></button>
        <Dropdown>
          <template #trigger><button class="tb-btn" title="Ещё форматирование"><Icon name="type" /><Icon name="chevron-down" :size="12" /></button></template>
          <div class="menu">
            <button class="menu-item" :class="{ on: e.isActive('superscript') }" @click="chain().toggleSuperscript().run()"><Icon name="superscript" :size="15" /> Надстрочный</button>
            <button class="menu-item" :class="{ on: e.isActive('subscript') }" @click="chain().toggleSubscript().run()"><Icon name="subscript" :size="15" /> Подстрочный</button>
            <button class="menu-item" :class="{ on: e.isActive('code') }" @click="chain().toggleCode().run()"><Icon name="code" :size="15" /> Моноширинный код</button>
            <div class="menu-sep" />
            <div class="menu-label">Межстрочный интервал</div>
            <div class="menu-row">
              <button v-for="lh in LINE_HEIGHTS" :key="lh" class="chip" @click="chain().setBlockLineHeight(lh).run()">{{ lh }}</button>
              <button class="chip" @click="chain().setBlockLineHeight(null).run()">авто</button>
            </div>
            <div class="menu-sep" />
            <button class="menu-item" @click="chain().unsetAllMarks().clearNodes().run()"><Icon name="remove-formatting" :size="15" /> Очистить форматирование</button>
          </div>
        </Dropdown>
        <Dropdown keep-open>
          <template #trigger>
            <button class="tb-btn tb-color" title="Цвет текста"><Icon name="baseline" /><span class="tb-color-bar" :style="{ background: textColor || 'currentColor' }" /></button>
          </template>
          <template #default="{ close }">
            <ColorPalette :value="textColor" reset-label="Цвет по умолчанию" @pick="(c) => { c ? chain().setColor(c).run() : chain().unsetColor().run(); close() }" />
          </template>
        </Dropdown>
        <Dropdown keep-open>
          <template #trigger>
            <button class="tb-btn tb-color" title="Выделение цветом"><Icon name="highlighter" /><span class="tb-color-bar" :style="{ background: hlColor || '#ffd966' }" /></button>
          </template>
          <template #default="{ close }">
            <ColorPalette :value="hlColor" reset-label="Без выделения" @pick="(c) => { c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run(); close() }" />
          </template>
        </Dropdown>
      </div>

      <div class="tb-group">
        <Dropdown>
          <template #trigger><button class="tb-btn" title="Выравнивание"><Icon :name="ALIGN_ICON[align]" /><Icon name="chevron-down" :size="12" /></button></template>
          <div class="menu menu-icons">
            <button class="tb-btn" :class="{ on: align === 'left' }" title="По левому краю (Ctrl+Shift+L)" @click="chain().setTextAlign('left').run()"><Icon name="align-left" /></button>
            <button class="tb-btn" :class="{ on: align === 'center' }" title="По центру (Ctrl+Shift+E)" @click="chain().setTextAlign('center').run()"><Icon name="align-center" /></button>
            <button class="tb-btn" :class="{ on: align === 'right' }" title="По правому краю (Ctrl+Shift+R)" @click="chain().setTextAlign('right').run()"><Icon name="align-right" /></button>
            <button class="tb-btn" :class="{ on: align === 'justify' }" title="По ширине (Ctrl+Shift+J)" @click="chain().setTextAlign('justify').run()"><Icon name="align-justify" /></button>
          </div>
        </Dropdown>
        <button class="tb-btn" :class="{ on: e.isActive('bulletList') }" title="Маркированный список" @click="chain().toggleBulletList().run()"><Icon name="list" /></button>
        <button class="tb-btn" :class="{ on: e.isActive('orderedList') }" title="Нумерованный список" @click="chain().toggleOrderedList().run()"><Icon name="list-ordered" /></button>
        <button class="tb-btn" :class="{ on: e.isActive('taskList') }" title="Список задач" @click="chain().toggleTaskList().run()"><Icon name="list-todo" /></button>
        <button v-if="!compact" class="tb-btn" title="Уменьшить отступ (Shift+Tab)" @click="e.isActive('listItem') ? chain().liftListItem('listItem').run() : chain().outdent().run()"><Icon name="indent-decrease" /></button>
        <button v-if="!compact" class="tb-btn" title="Увеличить отступ (Tab)" @click="e.isActive('listItem') ? chain().sinkListItem('listItem').run() : chain().indent().run()"><Icon name="indent-increase" /></button>
      </div>

      <div class="tb-group">
        <button class="tb-btn" :class="{ on: e.isActive('link') }" title="Ссылка (Ctrl+K)" @click="emit('action', 'link')"><Icon name="link" /></button>
        <button v-if="allowImages" class="tb-btn" title="Изображение: загрузить, вставить из галереи или по ссылке" @click="emit('action', 'image')"><Icon name="image" /></button>
        <Dropdown>
          <template #trigger><button class="tb-btn" :class="{ on: e.isActive('table') }" title="Таблица"><Icon name="table" /><Icon name="chevron-down" :size="12" /></button></template>
          <div class="table-picker" @mouseleave="hover = [0, 0]">
            <div class="menu-label">{{ hover[0] ? `${hover[0]} × ${hover[1]}` : 'Вставить таблицу' }}</div>
            <div class="table-grid">
              <template v-for="r in 8" :key="r">
                <span v-for="c in 10" :key="c" class="tg-cell" :class="{ on: r <= hover[0] && c <= hover[1] }" @mouseenter="hover = [r, c]" @click="insertTable(r, c)" />
              </template>
            </div>
          </div>
        </Dropdown>
        <Dropdown>
          <template #trigger><button class="tb-btn" title="Вставить блок"><Icon name="plus" /><Icon name="chevron-down" :size="12" /></button></template>
          <div class="menu">
            <button class="menu-item" @click="chain().setHorizontalRule().run()"><Icon name="minus" :size="15" /> Разделитель</button>
            <button class="menu-item" @click="chain().setDetails().run()"><Icon name="chevron-right" :size="15" /> Спойлер (раскрывающийся блок)</button>
            <button class="menu-item" @click="chain().insertColumns(2).run()"><Icon name="columns2" :size="15" /> Две колонки</button>
            <button class="menu-item" @click="chain().insertColumns(3).run()"><Icon name="columns3" :size="15" /> Три колонки</button>
            <button class="menu-item" @click="emit('action', 'youtube')"><Icon name="square-play" :size="15" /> Видео YouTube</button>
            <button class="menu-item" @click="emit('action', 'rawhtml')"><Icon name="file-code" :size="15" /> HTML-блок</button>
            <div class="menu-sep" />
            <div class="menu-label">Врезки</div>
            <button v-for="c in CALLOUTS" :key="c.kind" class="menu-item" @click="chain().setCallout(c.kind).run()"><span class="callout-dot" :data-callout="c.kind" /> {{ c.label }}</button>
            <button v-if="e.isActive('callout')" class="menu-item" @click="chain().unsetCallout().run()"><Icon name="x" :size="15" /> Убрать врезку</button>
          </div>
        </Dropdown>
        <button v-if="allowSecrets" class="tb-btn tb-secret" :class="{ on: e.isActive('secret') }" title="Секрет мастера: игроки и гости этот блок не получат" @click="chain().toggleSecret().run()"><Icon name="lock" /></button>
      </div>
    </template>

    <div class="tb-spacer" />
    <div class="tb-group">
      <button v-if="!source" class="tb-btn" title="Найти и заменить (Ctrl+F)" @click="emit('action', 'find')"><Icon name="search" /></button>
      <button class="tb-btn tb-html" :class="{ on: source }" title="Режим HTML-кода" @click="emit('action', 'html')"><Icon name="file-code" /><span>HTML</span></button>
      <button class="tb-btn" :title="fullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'" @click="emit('action', 'fullscreen')"><Icon :name="fullscreen ? 'minimize2' : 'maximize2'" /></button>
    </div>
  </div>
</template>
