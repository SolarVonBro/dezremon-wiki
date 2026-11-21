import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { popupRender } from './popup'
import SlashMenu from '../SlashMenu.vue'
import { CALLOUTS } from './blocks'

export interface SlashItem {
  title: string
  hint?: string
  icon: string
  keywords: string
  group: string
  run: (editor: Editor, range: Range) => void
}

export type EditorAction = 'image' | 'youtube' | 'link' | 'html'

export function slashItems(opts: { allowSecrets: boolean; onAction: (a: EditorAction) => void }): SlashItem[] {
  const c = (e: Editor, r: Range) => e.chain().focus().deleteRange(r)
  const items: SlashItem[] = [
    { group: 'Текст', title: 'Обычный текст', icon: 'pilcrow', keywords: 'text paragraph текст абзац', run: (e, r) => c(e, r).setParagraph().run() },
    { group: 'Текст', title: 'Заголовок 1', icon: 'heading1', keywords: 'h1 heading заголовок', run: (e, r) => c(e, r).setHeading({ level: 1 }).run() },
    { group: 'Текст', title: 'Заголовок 2', icon: 'heading2', keywords: 'h2 heading заголовок', run: (e, r) => c(e, r).setHeading({ level: 2 }).run() },
    { group: 'Текст', title: 'Заголовок 3', icon: 'heading3', keywords: 'h3 heading заголовок', run: (e, r) => c(e, r).setHeading({ level: 3 }).run() },
    { group: 'Текст', title: 'Заголовок 4', icon: 'heading4', keywords: 'h4 heading заголовок', run: (e, r) => c(e, r).setHeading({ level: 4 }).run() },
    { group: 'Списки', title: 'Маркированный список', icon: 'list', keywords: 'bullet list список маркер', run: (e, r) => c(e, r).toggleBulletList().run() },
    { group: 'Списки', title: 'Нумерованный список', icon: 'list-ordered', keywords: 'ordered numbered нумерованный', run: (e, r) => c(e, r).toggleOrderedList().run() },
    { group: 'Списки', title: 'Список задач', icon: 'list-todo', keywords: 'task todo чеклист задачи', run: (e, r) => c(e, r).toggleTaskList().run() },
    { group: 'Блоки', title: 'Цитата', icon: 'quote', keywords: 'quote blockquote цитата', run: (e, r) => c(e, r).toggleBlockquote().run() },
    { group: 'Блоки', title: 'Блок кода', icon: 'square-code', keywords: 'code код', run: (e, r) => c(e, r).toggleCodeBlock().run() },
    { group: 'Блоки', title: 'Разделитель', icon: 'minus', keywords: 'hr divider разделитель линия', run: (e, r) => c(e, r).setHorizontalRule().run() },
    { group: 'Блоки', title: 'Таблица', hint: '3 × 3 с заголовком', icon: 'table', keywords: 'table таблица', run: (e, r) => c(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { group: 'Блоки', title: 'Спойлер (раскрывающийся блок)', icon: 'chevron-right', keywords: 'details spoiler спойлер раскрыть', run: (e, r) => c(e, r).setDetails().run() },
    { group: 'Блоки', title: 'Две колонки', icon: 'columns2', keywords: 'columns колонки', run: (e, r) => c(e, r).insertColumns(2).run() },
    { group: 'Блоки', title: 'Три колонки', icon: 'columns3', keywords: 'columns колонки', run: (e, r) => c(e, r).insertColumns(3).run() },
    { group: 'Медиа', title: 'Изображение', hint: 'загрузить, галерея или ссылка', icon: 'image', keywords: 'image picture картинка изображение фото', run: (e, r) => { c(e, r).run(); opts.onAction('image') } },
    { group: 'Медиа', title: 'Видео YouTube', icon: 'square-play', keywords: 'youtube video видео', run: (e, r) => { c(e, r).run(); opts.onAction('youtube') } },
    { group: 'Медиа', title: 'Упоминание статьи', hint: '@имя', icon: 'link2', keywords: 'mention link ссылка упоминание', run: (e, r) => c(e, r).insertContent('@').run() },
    { group: 'Медиа', title: 'HTML-блок', hint: 'произвольная разметка', icon: 'file-code', keywords: 'html raw код разметка', run: (e, r) => c(e, r).insertRawHtml('<p style="text-align:center"><em>Свой HTML</em></p>').run() },
    ...CALLOUTS.map((k) => ({
      group: 'Врезки', title: `Врезка: ${k.label}`, icon: k.icon, keywords: `callout врезка ${k.kind} ${k.label.toLowerCase()}`,
      run: (e: Editor, r: Range) => c(e, r).setCallout(k.kind).run(),
    })),
  ]
  if (opts.allowSecrets) {
    items.splice(13, 0, { group: 'Блоки', title: 'Секрет мастера', hint: 'игроки не увидят', icon: 'lock', keywords: 'secret gm секрет мастер скрыть', run: (e, r) => c(e, r).toggleSecret().run() })
  }
  return items
}

export const SlashCommands = Extension.create<{ getItems: () => SlashItem[] }>({
  name: 'slashCommands',
  addOptions() { return { getItems: () => [] } },
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: new PluginKey('slash'),
        // spaces allowed so multi-word commands work: "/заголовок 2"
        allowSpaces: true,
        startOfLine: false,
        items: ({ query }) => {
          const q = query.toLowerCase().trim()
          const words = q.split(/\s+/).filter(Boolean)
          return this.options.getItems().filter((i) => {
            const hay = `${i.title.toLowerCase()} ${i.keywords}`
            return words.every((w) => hay.includes(w))
          }).slice(0, 40)
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: popupRender(SlashMenu, { hideWhenEmptyWithSpace: true }),
      }),
    ]
  },
})
