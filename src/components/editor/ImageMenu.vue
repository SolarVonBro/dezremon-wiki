<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { NodeSelection } from '@tiptap/pm/state'
import Icon from '@/components/common/Icon.vue'
import { useWorld } from '@/stores/world'
import { imageUrl } from '@/data/images'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ replace: [] }>()
const world = useWorld()

const attrs = computed(() => {
  const sel = props.editor.state.selection
  return sel instanceof NodeSelection && sel.node.type.name === 'image' ? (sel.node.attrs as any) : null
})
const caption = ref('')
const alt = ref('')
const href = ref('')
const panel = ref<'' | 'caption' | 'alt' | 'link'>('')
watch(attrs, (a) => { caption.value = a?.caption ?? ''; alt.value = a?.alt ?? ''; href.value = a?.href ?? '' }, { immediate: true })

function set(patch: Record<string, any>) { props.editor.chain().focus().updateAttributes('image', patch).run() }
function shouldShow({ editor, state }: any) {
  return editor.isEditable && state.selection instanceof NodeSelection && state.selection.node.type.name === 'image'
}
async function openOriginal() {
  const a = attrs.value
  if (!a) return
  const url = a.imageId ? await imageUrl(world.access, a.imageId) : a.src
  if (url) window.open(url, '_blank')
}
const ALIGNS = [
  { v: 'inline', icon: 'type', t: 'В строке с текстом' },
  { v: 'left', icon: 'align-left', t: 'Слева, текст обтекает справа' },
  { v: 'center', icon: 'align-center', t: 'По центру отдельной строкой' },
  { v: 'right', icon: 'align-right', t: 'Справа, текст обтекает слева' },
  { v: 'full', icon: 'maximize2', t: 'На всю ширину' },
]
</script>

<template>
  <BubbleMenu :editor="editor" plugin-key="imageMenu" :should-show="shouldShow" :options="{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }">
    <div v-if="attrs" class="bubble bubble-col" @mousedown.self.prevent>
      <div class="bubble-row" @mousedown.prevent>
        <button v-for="a in ALIGNS" :key="a.v" class="tb-btn" :class="{ on: attrs.align === a.v }" :title="a.t" @click="set({ align: a.v, width: a.v === 'full' ? null : attrs.width })"><Icon :name="a.icon" /></button>
        <span class="bubble-sep" />
        <button v-for="w in ['25%', '33%', '50%', '75%', '100%']" :key="w" class="chip" :class="{ on: attrs.width === w }" @click="set({ width: w })">{{ w }}</button>
        <button class="chip" :class="{ on: !attrs.width }" title="Исходный размер" @click="set({ width: null })">авто</button>
        <span class="bubble-sep" />
        <button class="tb-btn" :class="{ on: panel === 'caption' || !!attrs.caption }" title="Подпись" @click="panel = panel === 'caption' ? '' : 'caption'"><Icon name="text-quote" /></button>
        <button class="tb-btn" :class="{ on: panel === 'alt' }" title="Альтернативный текст" @click="panel = panel === 'alt' ? '' : 'alt'"><Icon name="type" /></button>
        <button class="tb-btn" :class="{ on: panel === 'link' || !!attrs.href }" title="Ссылка с картинки" @click="panel = panel === 'link' ? '' : 'link'"><Icon name="link" /></button>
        <button class="tb-btn" title="Заменить изображение" @click="emit('replace')"><Icon name="refresh-cw" /></button>
        <button class="tb-btn" title="Открыть оригинал" @click="openOriginal"><Icon name="external-link" /></button>
        <button class="tb-btn danger" title="Удалить" @click="editor.chain().focus().deleteSelection().run()"><Icon name="trash2" /></button>
      </div>
      <form v-if="panel === 'caption'" class="bubble-form" @submit.prevent="set({ caption }); panel = ''">
        <input v-model="caption" class="input input-sm" placeholder="Подпись под изображением" autofocus />
        <button class="btn btn-sm btn-primary">OK</button>
      </form>
      <form v-if="panel === 'alt'" class="bubble-form" @submit.prevent="set({ alt, title: alt }); panel = ''">
        <input v-model="alt" class="input input-sm" placeholder="Описание (всплывающая подсказка)" autofocus />
        <button class="btn btn-sm btn-primary">OK</button>
      </form>
      <form v-if="panel === 'link'" class="bubble-form" @submit.prevent="set({ href: href || null }); panel = ''">
        <input v-model="href" class="input input-sm" placeholder="https://…" autofocus />
        <button class="btn btn-sm btn-primary">OK</button>
      </form>
    </div>
  </BubbleMenu>
</template>
