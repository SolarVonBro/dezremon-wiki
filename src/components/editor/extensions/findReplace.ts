import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

interface FindState { query: string; caseSensitive: boolean; matches: Array<{ from: number; to: number }>; index: number }

export const findKey = new PluginKey<FindState>('findReplace')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setFindQuery: (query: string, caseSensitive?: boolean) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceCurrent: (text: string) => ReturnType
      replaceAll: (text: string) => ReturnType
      clearFind: () => ReturnType
    }
  }
}

function search(doc: PMNode, query: string, cs: boolean) {
  const out: Array<{ from: number; to: number }> = []
  if (!query) return out
  const q = cs ? query : query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = cs ? node.text : node.text.toLowerCase()
    let i = text.indexOf(q)
    while (i >= 0) {
      out.push({ from: pos + i, to: pos + i + q.length })
      i = text.indexOf(q, i + q.length)
    }
  })
  return out
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addCommands() {
    const meta = (patch: Partial<FindState>) => ({ tr, dispatch }: any) => { if (dispatch) dispatch(tr.setMeta(findKey, patch)); return true }
    const go = (dir: 1 | -1) => ({ state, tr, dispatch, view }: any) => {
      const st = findKey.getState(state)
      if (!st || !st.matches.length) return false
      const index = (st.index + dir + st.matches.length) % st.matches.length
      const m = st.matches[index]
      if (dispatch) {
        tr.setMeta(findKey, { index }).setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
        dispatch(tr)
        view?.focus()
      }
      return true
    }
    return {
      setFindQuery: (query, caseSensitive = false) => meta({ query, caseSensitive, index: 0 }),
      clearFind: () => meta({ query: '', index: 0 }),
      findNext: () => go(1),
      findPrev: () => go(-1),
      replaceCurrent: (text) => ({ state, tr, dispatch }) => {
        const st = findKey.getState(state)
        if (!st || !st.matches.length) return false
        const m = st.matches[Math.min(st.index, st.matches.length - 1)]
        if (dispatch) { tr.insertText(text, m.from, m.to); dispatch(tr) }
        return true
      },
      replaceAll: (text) => ({ state, tr, dispatch }) => {
        const st = findKey.getState(state)
        if (!st || !st.matches.length) return false
        if (dispatch) {
          for (let i = st.matches.length - 1; i >= 0; i--) tr.insertText(text, st.matches[i].from, st.matches[i].to)
          dispatch(tr)
        }
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, matches: [], index: 0 }),
          apply(tr, prev) {
            const patch = tr.getMeta(findKey) as Partial<FindState> | undefined
            const next = { ...prev, ...(patch ?? {}) }
            if (patch || tr.docChanged) next.matches = search(tr.doc, next.query, next.caseSensitive)
            if (next.index >= next.matches.length) next.index = 0
            return next
          },
        },
        props: {
          decorations(state) {
            const st = findKey.getState(state)
            if (!st?.query || !st.matches.length) return null
            return DecorationSet.create(state.doc, st.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === st.index ? 'find-hit find-current' : 'find-hit' })))
          },
        },
      }),
    ]
  },
})
