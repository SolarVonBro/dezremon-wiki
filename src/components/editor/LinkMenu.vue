<script setup lang="ts">
import { computed } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import Icon from '@/components/common/Icon.vue'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ edit: [] }>()
const href = computed(() => props.editor.getAttributes('link').href as string | undefined)
function shouldShow({ editor, state }: any) {
  return editor.isEditable && editor.isActive('link') && state.selection.empty
}
</script>

<template>
  <BubbleMenu :editor="editor" plugin-key="linkMenu" :should-show="shouldShow" :options="{ placement: 'bottom', offset: 6 }">
    <div class="bubble" @mousedown.prevent>
      <a class="bubble-link" :href="href" target="_blank" rel="noopener noreferrer">{{ href }}</a>
      <button class="tb-btn" title="Изменить ссылку" @click="emit('edit')"><Icon name="pencil" /></button>
      <button class="tb-btn" title="Убрать ссылку" @click="editor.chain().focus().extendMarkRange('link').unsetLink().run()"><Icon name="unlink" /></button>
    </div>
  </BubbleMenu>
</template>
