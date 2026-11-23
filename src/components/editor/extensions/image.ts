import { Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import ImageView from '../ImageView.vue'

export interface WikiImageAttrs {
  imageId: string | null
  src: string | null
  alt: string
  title: string
  width: string | null
  /** row: side by side with the other pictures of the same paragraph (centred, wrapping on narrow screens) */
  align: 'inline' | 'left' | 'right' | 'center' | 'full' | 'row'
  caption: string
  href: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiImage: {
      insertWikiImage: (attrs: Partial<WikiImageAttrs>) => ReturnType
      /** Pictures in a row: one paragraph, side by side, equal widths. */
      insertImageRow: (items: Array<Partial<WikiImageAttrs>>) => ReturnType
      /** The selected picture and the pictures standing on their own lines right before and after it: one row. */
      arrangeImagesInRow: () => ReturnType
    }
  }
}

/** Equal widths for n pictures side by side (a little room is left for the gaps). */
export const rowWidth = (n: number) => `${Math.max(15, Math.floor(94 / Math.max(1, Math.min(n, 4))))}%`
const AUTO_WIDTHS = new Set([1, 2, 3, 4].map(rowWidth))

/** A paragraph holding nothing but pictures (and blank space). */
function picturesOnly(n: PMNode | null | undefined): boolean {
  if (!n || n.type.name !== 'paragraph' || !n.childCount) return false
  let pics = 0, other = false
  n.forEach((c) => {
    if (c.type.name === 'image') pics++
    else if (c.type.name === 'hardBreak' || (c.isText && !c.text?.trim())) { /* blank */ } else other = true
  })
  return pics > 0 && !other
}

function attrsFromImg(img: HTMLImageElement, wrap?: HTMLElement): Partial<WikiImageAttrs> {
  const id = img.getAttribute('data-image-id')
  const floatSide = img.style.float || wrap?.style.float
  const widthAttr = img.getAttribute('width')
  return {
    imageId: id,
    src: id ? null : img.getAttribute('src'),
    alt: img.getAttribute('alt') ?? '',
    title: img.getAttribute('title') ?? '',
    width: wrap?.style.width || img.style.width || (widthAttr ? (widthAttr.endsWith('%') ? widthAttr : `${parseInt(widthAttr)}px`) : null),
    align: (wrap?.getAttribute('data-align') as WikiImageAttrs['align']) || (floatSide === 'left' ? 'left' : floatSide === 'right' ? 'right' : wrap ? 'center' : 'inline'),
    caption: wrap?.querySelector('.wiki-img-cap')?.textContent ?? '',
    href: img.closest('a')?.getAttribute('href') ?? null,
  }
}

/** Inline image node: can live in paragraphs, headings, lists and table cells; float/align/resize/caption. */
export const WikiImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  draggable: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      imageId: { default: null }, src: { default: null }, alt: { default: '' }, title: { default: '' },
      width: { default: null }, align: { default: 'center' }, caption: { default: '' }, href: { default: null },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span.wiki-img',
        priority: 70,
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector('img')
          return img ? attrsFromImg(img, el as HTMLElement) : false
        },
      },
      {
        tag: 'img[src], img[data-image-id]',
        getAttrs: (el) => {
          const a = attrsFromImg(el as HTMLImageElement)
          const src = a.src ?? ''
          if (!a.imageId && !src) return false
          return a
        },
      },
    ]
  },
  renderHTML({ node }) {
    const a = node.attrs as WikiImageAttrs
    const img: any = ['img', { 'data-image-id': a.imageId || null, src: a.imageId ? null : a.src, alt: a.alt || '', title: a.title || null }]
    const inner: any = a.href ? ['a', { href: a.href, target: '_blank', rel: 'noopener noreferrer' }, img] : img
    const parts: any[] = [inner]
    if (a.caption) parts.push(['span', { class: 'wiki-img-cap' }, a.caption])
    return ['span', { class: 'wiki-img', 'data-align': a.align, style: a.width ? `width: ${a.width}` : null }, ...parts]
  },
  renderText({ node }) { return node.attrs.alt ? `[${node.attrs.alt}]` : '' },
  addNodeView() { return VueNodeViewRenderer(ImageView as any) },
  addCommands() {
    return {
      insertWikiImage: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs }),
      insertImageRow: (items) => ({ commands }) => commands.insertContent({
        type: 'paragraph',
        content: items.map((a) => ({ type: this.name, attrs: { ...a, align: 'row', width: rowWidth(items.length) } })),
      }),
      arrangeImagesInRow: () => ({ state, tr, dispatch }) => {
        const sel = state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false
        const $pos = state.doc.resolve(sel.from)
        const para = $pos.parent
        const depth = $pos.depth
        // a picture inside text: it just goes into a row inside that paragraph
        if (!picturesOnly(para) || depth < 1) {
          if (dispatch) dispatch(tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, align: 'row' }))
          return true
        }
        const container = $pos.node(depth - 1)
        const index = $pos.index(depth - 1)
        let first = index, last = index
        while (first > 0 && picturesOnly(container.child(first - 1))) first--
        while (last < container.childCount - 1 && picturesOnly(container.child(last + 1))) last++
        const images: PMNode[] = []
        for (let i = first; i <= last; i++) container.child(i).forEach((c) => { if (c.type.name === 'image') images.push(c) })
        if (!dispatch) return true
        const w = rowWidth(images.length)
        const row = state.schema.nodes.paragraph.create(para.attrs, images.map((im) => im.type.create({ ...im.attrs, align: 'row', width: w })))
        const start = $pos.start(depth - 1)
        let from = start, to = start
        for (let i = 0; i < first; i++) from += container.child(i).nodeSize
        to = from
        for (let i = first; i <= last; i++) to += container.child(i).nodeSize
        tr.replaceWith(from, to, row)
        // keep the picture that was selected selected
        let off = from + 1
        const at = images.indexOf(sel.node)
        for (let i = 0; i < Math.max(0, at); i++) off += images[i].nodeSize
        try { tr.setSelection(NodeSelection.create(tr.doc, off)) } catch { /* keep the default selection */ }
        dispatch(tr.scrollIntoView())
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    // a picture dropped into a row (a paragraph of nothing but pictures, one of them in a row) joins the row
    return [new Plugin({
      key: new PluginKey('wikiImageRow'),
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null
        let tr = state.tr
        let changed = false
        state.doc.descendants((n, pos) => {
          if (n.type.name !== 'paragraph') return true
          if (!picturesOnly(n)) return false
          let rowed = false, others = false
          n.forEach((c) => { if (c.type.name === 'image') { if (c.attrs.align === 'row') rowed = true; else others = true } })
          if (rowed && others) {
            let count = 0
            const widths = new Set<string | null>()
            n.forEach((c) => { if (c.type.name === 'image') { count++; if (c.attrs.align === 'row') widths.add(c.attrs.width) } })
            // the row had equal automatic widths: everybody gets the new equal share; widths set by hand stay
            const equal = widths.size === 1 && AUTO_WIDTHS.has([...widths][0] as string)
            n.forEach((c, off) => {
              if (c.type.name !== 'image') return
              const width = equal ? rowWidth(count) : c.attrs.align === 'row' ? c.attrs.width : c.attrs.width && c.attrs.align !== 'full' ? c.attrs.width : rowWidth(count)
              if (c.attrs.align !== 'row' || c.attrs.width !== width) {
                tr = tr.setNodeMarkup(pos + 1 + off, undefined, { ...c.attrs, align: 'row', width })
                changed = true
              }
            })
          }
          return false
        })
        return changed ? tr : null
      },
    })]
  },
})
