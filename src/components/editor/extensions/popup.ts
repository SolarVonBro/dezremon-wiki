import { VueRenderer } from '@tiptap/vue-3'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Component } from 'vue'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

/** Suggestion `render` implementation: mounts a Vue list component next to the caret. */
export function popupRender(component: Component) {
  return () => {
    let renderer: VueRenderer | null = null
    let host: HTMLDivElement | null = null
    let rectFn: (() => DOMRect | null) | null | undefined = null

    const place = () => {
      if (!host || !rectFn) return
      const rect = rectFn()
      if (!rect) return
      void computePosition({ getBoundingClientRect: () => rect }, host, {
        placement: 'bottom-start', strategy: 'fixed', middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => { if (host) Object.assign(host.style, { left: `${x}px`, top: `${y}px` }) })
    }
    const destroy = () => {
      renderer?.destroy()
      host?.remove()
      renderer = null
      host = null
    }

    return {
      onStart(props: SuggestionProps) {
        renderer = new VueRenderer(component, { props, editor: props.editor })
        host = document.createElement('div')
        host.className = 'suggest-host'
        host.style.position = 'fixed'
        host.style.zIndex = '200'
        host.append(renderer.element as Node)
        document.body.append(host)
        rectFn = props.clientRect
        place()
      },
      onUpdate(props: SuggestionProps) {
        renderer?.updateProps(props)
        rectFn = props.clientRect
        place()
      },
      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') { destroy(); return true }
        return (renderer?.ref as any)?.onKeyDown?.(props.event) ?? false
      },
      onExit() { destroy() },
    }
  }
}
