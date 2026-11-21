import { Extension } from '@tiptap/core'
import { TableCell, TableHeader } from '@tiptap/extension-table'

/** Copy an element's inline style except properties owned by dedicated attributes. */
export function restStyle(el: HTMLElement, exclude: string[]): string | null {
  const out: string[] = []
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i]
    if (exclude.some((x) => prop === x || prop.startsWith(x + '-'))) continue
    out.push(`${prop}: ${el.style.getPropertyValue(prop)}`)
  }
  return out.length ? out.join('; ') : null
}

const BLOCK_OWNED = ['text-align', 'margin-left', 'line-height']
const INTERNAL_CLASSES = /\b(callout|secret-block|ProseMirror\S*|is-empty|is-editor-empty|selectedCell|column-resize-handle|tableWrapper|has-focus)\b/g

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockFormat: {
      indent: () => ReturnType
      outdent: () => ReturnType
      setBlockLineHeight: (v: string | null) => ReturnType
    }
  }
}

/**
 * Preserves `style` and `class` on common nodes (HTML mode round-trips any formatting),
 * plus block indent and block line-height.
 */
export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow', 'codeBlock', 'horizontalRule'],
        attributes: {
          style: {
            default: null,
            parseHTML: (el) => restStyle(el, BLOCK_OWNED),
            renderHTML: (a) => (a.style ? { style: a.style } : {}),
          },
          class: {
            default: null,
            parseHTML: (el) => (el.getAttribute('class') || '').replace(INTERNAL_CLASSES, '').trim() || null,
            renderHTML: (a) => (a.class ? { class: a.class } : {}),
          },
        },
      },
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || Math.round((parseFloat(el.style.marginLeft) || 0) / 2) || 0,
            renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `margin-left: ${a.indent * 2}em` } : {}),
          },
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
          },
        },
      },
    ]
  },
  addCommands() {
    const change = (delta: number) => ({ tr, state, dispatch }: any) => {
      let changed = false
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node: any, pos: number) => {
        if (node.type.name === 'paragraph' || node.type.name === 'heading') {
          const v = Math.max(0, Math.min(10, (node.attrs.indent || 0) + delta))
          if (v !== node.attrs.indent) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: v }); changed = true }
        }
      })
      if (changed && dispatch) dispatch(tr)
      return changed
    }
    return {
      indent: () => change(1),
      outdent: () => change(-1),
      setBlockLineHeight: (v) => ({ tr, state, dispatch }) => {
        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: v })
        })
        if (dispatch) dispatch(tr)
        return true
      },
    }
  },
  addKeyboardShortcuts() {
    const inside = (names: string[]) => names.some((n) => this.editor.isActive(n))
    return {
      Tab: () => (inside(['listItem', 'taskItem', 'table', 'codeBlock']) ? false : this.editor.commands.indent()),
      'Shift-Tab': () => (inside(['listItem', 'taskItem', 'table', 'codeBlock']) ? false : this.editor.commands.outdent()),
    }
  },
})

const cellAttrs = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: (a: any) => (a.backgroundColor ? { 'data-bg': a.backgroundColor, style: `background-color: ${a.backgroundColor}` } : {}),
  },
  verticalAlign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.verticalAlign || null,
    renderHTML: (a: any) => (a.verticalAlign ? { style: `vertical-align: ${a.verticalAlign}` } : {}),
  },
  cellStyle: {
    default: null,
    parseHTML: (el: HTMLElement) => restStyle(el, ['background-color', 'background', 'vertical-align', 'width', 'min-width']),
    renderHTML: (a: any) => (a.cellStyle ? { style: a.cellStyle } : {}),
  },
}

export const WikiTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), ...cellAttrs } },
})
export const WikiTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), ...cellAttrs } },
})
