import { Node, mergeAttributes } from '@tiptap/core'
import { sanitize } from '@/data/html'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { setCallout: (kind: string) => ReturnType; unsetCallout: () => ReturnType }
    secret: { toggleSecret: () => ReturnType }
    columns: { insertColumns: (n: number) => ReturnType }
    rawHtml: { insertRawHtml: (html: string) => ReturnType }
  }
}

export const CALLOUTS = [
  { kind: 'info', label: 'Информация', icon: 'info' },
  { kind: 'note', label: 'Заметка', icon: 'pencil' },
  { kind: 'success', label: 'Совет', icon: 'check-circle' },
  { kind: 'warning', label: 'Внимание', icon: 'alert-triangle' },
  { kind: 'danger', label: 'Опасность', icon: 'flame' },
  { kind: 'quote', label: 'Цитата из мира', icon: 'quote' },
  { kind: 'parchment', label: 'Пергамент', icon: 'scroll' },
]

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { kind: { default: 'info', parseHTML: (el) => el.getAttribute('data-callout') || 'info', renderHTML: (a) => ({ 'data-callout': a.kind }) } }
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0] },
  addCommands() {
    return {
      setCallout: (kind) => ({ commands, editor }) => {
        if (editor.isActive('callout')) return commands.updateAttributes('callout', { kind })
        return commands.wrapIn(this.name, { kind })
      },
      unsetCallout: () => ({ commands }) => commands.lift(this.name),
    }
  },
})

/** Master-only block: removed from the copy of the article that players and guests can read. */
export const Secret = Node.create({
  name: 'secret',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-secret]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-secret': '', class: 'secret-block' }), 0] },
  addCommands() {
    return {
      toggleSecret: () => ({ commands, editor }) => (editor.isActive('secret') ? commands.lift(this.name) : commands.wrapIn(this.name)),
    }
  },
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-column]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '' }), 0] },
})

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  addAttributes() {
    return { count: { default: 2, parseHTML: (el) => Number(el.getAttribute('data-columns')) || 2, renderHTML: (a) => ({ 'data-columns': a.count }) } }
  },
  parseHTML() { return [{ tag: 'div[data-columns]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', HTMLAttributes, 0] },
  addCommands() {
    return {
      insertColumns: (n) => ({ commands }) => commands.insertContent({
        type: this.name, attrs: { count: n },
        content: Array.from({ length: n }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })),
      }),
    }
  },
})

const SEMANTIC = ['section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'figure', 'figcaption', 'center']

/** Keeps arbitrary <div style/class> and semantic containers written in HTML mode. */
export const GenericDiv = Node.create({
  name: 'genericDiv',
  group: 'block',
  content: 'block+',
  priority: 20,
  addAttributes() {
    return {
      tag: { default: 'div', parseHTML: (el) => el.tagName.toLowerCase(), renderHTML: () => ({}) },
      style: { default: null, parseHTML: (el) => el.getAttribute('style'), renderHTML: (a) => (a.style ? { style: a.style } : {}) },
      class: { default: null, parseHTML: (el) => el.getAttribute('class'), renderHTML: (a) => (a.class ? { class: a.class } : {}) },
    }
  },
  parseHTML() {
    return [
      { tag: 'div', priority: 20, getAttrs: (el) => ((el as HTMLElement).getAttribute('style') || (el as HTMLElement).getAttribute('class') ? null : false) },
      ...SEMANTIC.map((tag) => ({ tag, priority: 20 })),
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    const tag = node.attrs.tag === 'center' ? 'div' : node.attrs.tag
    return [tag, HTMLAttributes, 0]
  },
})

/** Raw sanitized HTML (anything the schema cannot express). Edited through the source dialog. */
export const RawHtml = Node.create({
  name: 'rawHtml',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { html: { default: '', parseHTML: (el) => el.innerHTML, renderHTML: () => ({}) } }
  },
  parseHTML() { return [{ tag: 'div[data-raw-html]', priority: 60 }] },
  renderHTML({ node }) {
    const el = document.createElement('div')
    el.setAttribute('data-raw-html', '')
    el.innerHTML = sanitize(node.attrs.html)
    return el
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div')
      dom.setAttribute('data-raw-html', '')
      dom.className = 'raw-html-view'
      const body = document.createElement('div')
      body.innerHTML = sanitize(node.attrs.html) || '<em>Пустой HTML-блок</em>'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'raw-html-edit'
      btn.textContent = 'HTML'
      btn.title = 'Редактировать HTML блока'
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        if (!editor.isEditable) return
        const next = window.prompt('HTML блока:', node.attrs.html)
        if (next === null || typeof getPos !== 'function') return
        const pos = getPos()
        if (typeof pos !== 'number') return
        editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { html: next }); return true }).run()
      })
      dom.append(btn, body)
      return { dom }
    }
  },
  addCommands() {
    return { insertRawHtml: (html) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { html } }) }
  },
})
