<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// CodeMirror is loaded lazily: it is only needed when someone opens the HTML mode.
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
const host = ref<HTMLElement | null>(null)
let view: any = null

onMounted(async () => {
  const [{ EditorView, basicSetup }, { html }, { EditorState }] = await Promise.all([
    import('codemirror'), import('@codemirror/lang-html'), import('@codemirror/state'),
  ])
  const theme = EditorView.theme({
    '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--code-bg)', color: 'var(--text)' },
    '.cm-content': { fontFamily: '"JetBrains Mono", Consolas, monospace', caretColor: 'var(--accent)' },
    '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent) !important' },
  })
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [basicSetup, html(), theme, EditorView.lineWrapping, EditorView.updateListener.of((u: any) => {
        if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
      })],
    }),
  })
  view.focus()
})
onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="host" class="html-source" />
</template>
