<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TextStyle, Color, FontFamily, FontSize, BackgroundColor } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Placeholder, CharacterCount } from '@tiptap/extensions'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Youtube from '@tiptap/extension-youtube'
import Typography from '@tiptap/extension-typography'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import lua from 'highlight.js/lib/languages/lua'
import csharp from 'highlight.js/lib/languages/csharp'
import beautify from 'js-beautify'

import EditorToolbar from './EditorToolbar.vue'
import TableMenu from './TableMenu.vue'
import ImageMenu from './ImageMenu.vue'
import LinkMenu from './LinkMenu.vue'
import TextMenu from './TextMenu.vue'
import FindBar from './FindBar.vue'
import HtmlSource from './HtmlSource.vue'
import ImageDialog from './ImageDialog.vue'
import LinkDialog from './LinkDialog.vue'
import { WikiImage } from './extensions/image'
import { EntityMention } from './extensions/mention'
import { SlashCommands, slashItems, type EditorAction } from './extensions/slash'
import { Callout, Secret, Columns, Column, GenericDiv, RawHtml } from './extensions/blocks'
import { BlockFormat, WikiTableCell, WikiTableHeader } from './extensions/attrs'
import { FindReplace } from './extensions/findReplace'
import { cleanPastedHtml, dataUrlToFile } from './extensions/paste'
import { useWorld } from '@/stores/world'
import { pendingImages, uploadImage } from '@/data/images'
import { randomId } from '@/data/util'
import { toast } from '@/components/common/toast'
import type { Visibility } from '@/model/types'

const props = withDefaults(defineProps<{
  modelValue: string
  allowSecrets?: boolean
  placeholder?: string
  compact?: boolean
  /** Visibility for images uploaded by players (masters upload as master-only; saving widens what is shown). */
  uploadVisibility?: { visibility: Visibility; allowedUids: string[] }
  folder?: string
  autofocus?: boolean
  minHeight?: string
}>(), { allowSecrets: false, placeholder: 'Начните писать… «/» — команды, «@» — ссылка на статью', compact: false, folder: '', autofocus: false, minHeight: '320px' })

const emit = defineEmits<{ dirty: []; 'save-now': []; uploaded: [] }>()
const world = useWorld()

const source = ref(false)
const sourceText = ref('')
const fullscreen = ref(false)
const finding = ref(false)
const imageDialog = ref<false | 'insert' | 'replace'>(false)
const linkDialog = ref(false)
const pendingUploads = ref(0)
const lowlight = createLowlight({ javascript, typescript, json, xml, html: xml, css, python, bash, markdown, yaml, sql, lua, csharp })

function onAction(a: EditorAction | 'find' | 'fullscreen' | 'rawhtml') {
  if (a === 'image') imageDialog.value = 'insert'
  else if (a === 'link') linkDialog.value = true
  else if (a === 'youtube') insertYoutube()
  else if (a === 'html') toggleSource()
  else if (a === 'find') finding.value = !finding.value
  else if (a === 'fullscreen') fullscreen.value = !fullscreen.value
  else if (a === 'rawhtml') editor.value?.chain().focus().insertRawHtml('<p style="text-align:center"><em>Свой HTML</em></p>').run()
}

const editor = useEditor({
  content: props.modelValue || '',
  autofocus: props.autofocus ? 'end' : false,
  extensions: [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    TextStyle, Color, FontFamily, FontSize, BackgroundColor,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    Subscript, Superscript,
    TaskList, TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true, cellMinWidth: 40 }, tableCell: false, tableHeader: false }),
    WikiTableCell, WikiTableHeader,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Youtube.configure({ nocookie: true, width: 640, height: 360, HTMLAttributes: { class: 'embed-video' } }),
    Typography.configure({ openDoubleQuote: '«', closeDoubleQuote: '»', openSingleQuote: '„', closeSingleQuote: '“' }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }), DetailsSummary, DetailsContent,
    Placeholder.configure({ placeholder: props.placeholder, includeChildren: false }),
    CharacterCount,
    WikiImage, EntityMention, Callout, Secret, Columns, Column, GenericDiv, RawHtml, BlockFormat, FindReplace,
    SlashCommands.configure({ getItems: () => slashItems({ allowSecrets: props.allowSecrets, onAction }) }),
  ],
  editorProps: {
    attributes: { class: 'prose wiki-editor', spellcheck: 'true' },
    transformPastedHTML: cleanPastedHtml,
    handlePaste: (view, event) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      const html = event.clipboardData?.getData('text/html')
      if (files.length && !html) { void insertFiles(files); return true }
      return false
    },
    handleDrop: (view, event, _slice, moved) => {
      if (moved) return false
      const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return false
      event.preventDefault()
      const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      void insertFiles(files, pos)
      return true
    },
    handleKeyDown: (_view, event) => {
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); emit('save-now'); return true }
      if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); linkDialog.value = true; return true }
      if (mod && event.key.toLowerCase() === 'f' && !event.shiftKey) { event.preventDefault(); finding.value = true; return true }
      if (event.key === 'Escape' && fullscreen.value) { fullscreen.value = false; return true }
      return false
    },
  },
  onUpdate: () => {
    emit('dirty')
    queueDataImages()
  },
})

// Images pasted as data: URLs (from Word etc.) are uploaded into the gallery after the paste.
let dataTimer: ReturnType<typeof setTimeout> | null = null
function queueDataImages() {
  if (dataTimer) clearTimeout(dataTimer)
  dataTimer = setTimeout(() => {
    const ed = editor.value
    if (!ed) return
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && !node.attrs.imageId && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('data:')) {
        const file = dataUrlToFile(node.attrs.src, 'pasted')
        if (!file) return
        const id = randomId()
        pendingImages.set(id, node.attrs.src)
        ed.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, imageId: id, src: null }); return true }).run()
        void startUpload(file, id)
      }
    })
  }, 300)
}

function uploadVis() {
  if (world.isMaster) return { visibility: 'master' as Visibility, allowedUids: [] }
  return props.uploadVisibility ?? { visibility: 'members' as Visibility, allowedUids: [] }
}

async function startUpload(file: File, id: string) {
  pendingUploads.value++
  try {
    await uploadImage(world.access, file, { id, name: file.name || 'image', folder: props.folder, ...uploadVis() })
    emit('uploaded')
  } catch (e: any) {
    toast.error('Не удалось загрузить изображение: ' + (e?.message ?? e))
  } finally {
    pendingUploads.value--
  }
}

async function insertFiles(files: File[], pos?: number) {
  const ed = editor.value
  if (!ed) return
  for (const f of files) {
    const id = randomId()
    pendingImages.set(id, URL.createObjectURL(f))
    const attrs = { imageId: id, alt: f.name.replace(/\.[^.]+$/, ''), align: 'center', width: null }
    if (typeof pos === 'number') { ed.chain().focus().insertContentAt(pos, { type: 'image', attrs }).run(); pos += 1 }
    else ed.chain().focus().insertWikiImage(attrs as any).run()
    void startUpload(f, id)
  }
}

function onImageFiles(files: File[]) {
  if (imageDialog.value === 'replace') {
    const f = files[0]
    const id = randomId()
    pendingImages.set(id, URL.createObjectURL(f))
    editor.value?.chain().focus().updateAttributes('image', { imageId: id, src: null }).run()
    void startUpload(f, id)
  } else void insertFiles(files)
}
function onImagePick(id: string) {
  if (imageDialog.value === 'replace') editor.value?.chain().focus().updateAttributes('image', { imageId: id, src: null }).run()
  else editor.value?.chain().focus().insertWikiImage({ imageId: id, align: 'center' }).run()
}
function onImageUrl(url: string) {
  if (imageDialog.value === 'replace') editor.value?.chain().focus().updateAttributes('image', { imageId: null, src: url }).run()
  else editor.value?.chain().focus().insertWikiImage({ src: url, align: 'center' }).run()
}

function insertYoutube() {
  const url = window.prompt('Ссылка на видео YouTube:')
  if (url) editor.value?.chain().focus().setYoutubeVideo({ src: url }).run()
}

const currentHref = computed(() => (editor.value?.getAttributes('link').href as string | undefined) ?? '')
const selectedText = computed(() => {
  const ed = editor.value
  if (!ed) return ''
  const { from, to } = ed.state.selection
  return ed.state.doc.textBetween(from, to, ' ')
})
function applyLink(href: string) {
  const ch = editor.value!.chain().focus().extendMarkRange('link')
  if (!href) ch.unsetLink().run()
  else ch.setLink({ href }).run()
}
function linkEntity(id: string, name: string) {
  const ed = editor.value!
  const { from, to } = ed.state.selection
  const label = from !== to ? ed.state.doc.textBetween(from, to, ' ') : name
  ed.chain().focus().insertContentAt({ from, to }, [{ type: 'mention', attrs: { id, label, custom: label !== name } }, { type: 'text', text: ' ' }]).run()
}

// ---------- HTML source mode ----------
function pretty(html: string) {
  return beautify.html(html, { indent_size: 2, wrap_line_length: 120, inline: ['a', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'mark', 'sub', 'sup', 'img'], unformatted: ['pre', 'code'] })
}
let srcTimer: ReturnType<typeof setTimeout> | null = null
function toggleSource() {
  const ed = editor.value
  if (!ed) return
  if (!source.value) {
    sourceText.value = pretty(ed.getHTML())
    source.value = true
    finding.value = false
  } else {
    applySource()
    source.value = false
  }
}
function applySource() {
  if (srcTimer) { clearTimeout(srcTimer); srcTimer = null }
  editor.value?.commands.setContent(sourceText.value, { emitUpdate: false })
}
watch(sourceText, () => {
  if (!source.value) return
  if (srcTimer) clearTimeout(srcTimer)
  srcTimer = setTimeout(() => { applySource(); emit('dirty') }, 700)
})

// `modelValue` is only the initial content: later changes are applied explicitly via setHTML()
// so that a background save/snapshot can never overwrite what the user is typing.

const stats = computed(() => {
  const ed = editor.value
  if (!ed) return null
  const words = ed.storage.characterCount?.words?.() ?? 0
  const chars = ed.storage.characterCount?.characters?.() ?? 0
  return { words, chars, minutes: Math.max(1, Math.round(words / 180)) }
})

onBeforeUnmount(() => {
  if (dataTimer) clearTimeout(dataTimer)
  if (source.value) applySource()
  editor.value?.destroy()
})

defineExpose({
  getHTML: () => {
    if (source.value) applySource()
    return editor.value?.getHTML() ?? ''
  },
  setHTML: (html: string) => editor.value?.commands.setContent(html, { emitUpdate: false }),
  pendingUploads,
  focus: () => editor.value?.commands.focus(),
  editor,
})
</script>

<template>
  <div class="rich" :class="{ fullscreen, compact, 'is-source': source }">
    <template v-if="editor">
      <EditorToolbar :editor="editor" :allow-secrets="allowSecrets" :source="source" :fullscreen="fullscreen" :compact="compact" @action="onAction" />
      <FindBar v-if="finding && !source" :editor="editor" @close="finding = false" />
      <TableMenu :editor="editor" />
      <ImageMenu :editor="editor" @replace="imageDialog = 'replace'" />
      <LinkMenu :editor="editor" @edit="linkDialog = true" />
      <TextMenu :editor="editor" :allow-secrets="allowSecrets" @link="linkDialog = true" />
    </template>
    <div class="rich-body" :style="{ minHeight }">
      <HtmlSource v-if="source" v-model="sourceText" />
      <EditorContent v-show="!source" :editor="editor" class="rich-content" />
    </div>
    <div class="rich-status">
      <span v-if="pendingUploads" class="pulse">Загрузка изображений: {{ pendingUploads }}…</span>
      <span v-if="source" class="muted">Режим HTML: правки применяются автоматически. Неподдерживаемые теги сохраняйте в «HTML-блоке».</span>
      <span class="grow" />
      <span v-if="stats" class="muted">{{ stats.words }} слов · {{ stats.chars }} знаков · ~{{ stats.minutes }} мин чтения</span>
    </div>
    <ImageDialog v-if="imageDialog" :title="imageDialog === 'replace' ? 'Заменить изображение' : 'Вставить изображение'" :multiple="imageDialog === 'insert'"
      @close="imageDialog = false" @files="onImageFiles" @pick="onImagePick" @url="onImageUrl" />
    <LinkDialog v-if="linkDialog" :href="currentHref" :text="selectedText" @close="linkDialog = false" @link="applyLink" @entity="linkEntity" />
  </div>
</template>
