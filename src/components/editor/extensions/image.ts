import { Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ImageView from '../ImageView.vue'

export interface WikiImageAttrs {
  imageId: string | null
  src: string | null
  alt: string
  title: string
  width: string | null
  align: 'inline' | 'left' | 'right' | 'center' | 'full'
  caption: string
  href: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiImage: { insertWikiImage: (attrs: Partial<WikiImageAttrs>) => ReturnType }
  }
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
    return { insertWikiImage: (attrs) => ({ commands }) => commands.insertContent({ type: this.name, attrs }) }
  },
})
