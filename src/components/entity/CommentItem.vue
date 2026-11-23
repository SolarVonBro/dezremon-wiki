<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { formatDate, relativeTime } from '@/data/util'
import { COMMENT_MAX } from '@/data/comments'
import Icon from '@/components/common/Icon.vue'
import type { Comment } from '@/model/types'

// One comment: author (→ their page), time, text with links, and the actions the viewer may take.
const props = defineProps<{ c: Comment; canWrite: boolean; articleAuthor: string; highlight: boolean }>()
const emit = defineEmits<{ reply: [c: Comment]; save: [c: Comment, text: string]; remove: [c: Comment]; like: [c: Comment]; link: [c: Comment] }>()
const world = useWorld()

const mine = computed(() => props.c.createdBy === world.uid && !world.preview)
const canDelete = computed(() => (mine.value || world.isMaster) && !props.c.removed)
const liked = computed(() => !!world.uid && props.c.likes.includes(world.uid))
const role = computed(() => {
  const m = world.members.find((x) => x.uid === props.c.createdBy)
  if (m?.role === 'owner') return 'владелец'
  if (m?.role === 'master') return 'мастер'
  return props.c.createdBy === props.articleAuthor ? 'автор статьи' : ''
})
// plain text: line breaks kept, web addresses become links (no HTML from the comment is ever rendered)
const parts = computed(() => props.c.text.split(/(https?:\/\/[^\s<>"]+)/g).map((v, i) => ({ v, link: i % 2 === 1 })))

const editing = ref(false)
const draft = ref('')
const box = ref<HTMLTextAreaElement | null>(null)
async function startEdit() {
  draft.value = props.c.text
  editing.value = true
  await nextTick()
  box.value?.focus()
}
function save() {
  if (!draft.value.trim()) return
  if (draft.value.trim() !== props.c.text) emit('save', props.c, draft.value)
  editing.value = false
}
</script>

<template>
  <div class="cm" :class="{ reply: !!c.parentId, hl: highlight }" :id="'comment-' + c.id">
    <span class="avatar round cm-ava"><img v-if="c.authorPhoto && !c.removed" :src="c.authorPhoto" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="14" /></span>
    <div class="cm-body">
      <template v-if="c.removed">
        <div class="cm-removed faint small"><Icon name="trash2" :size="13" /> Комментарий удалён</div>
      </template>
      <template v-else>
        <div class="cm-head">
          <RouterLink class="cm-author" :to="{ name: 'user', params: { uid: c.createdBy } }">{{ c.authorName }}</RouterLink>
          <span v-if="role" class="badge cm-role">{{ role }}</span>
          <span v-if="c.replyToName" class="faint small cm-to"><Icon name="corner-down-right" :size="12" /> {{ c.replyToName }}</span>
          <span class="faint small" :title="formatDate(c.createdAt)">{{ relativeTime(c.createdAt) }}</span>
          <span v-if="c.editedAt" class="faint small" :title="'Изменено ' + formatDate(c.editedAt)">· изменено</span>
        </div>
        <div v-if="editing" class="stack-sm cm-edit">
          <textarea ref="box" v-model="draft" class="input" rows="3" :maxlength="COMMENT_MAX" aria-label="Текст комментария"
            @keydown.ctrl.enter.prevent="save" @keydown.meta.enter.prevent="save" @keydown.esc.prevent="editing = false" />
          <div class="row gap-sm">
            <button class="btn btn-sm btn-primary" :disabled="!draft.trim()" @click="save">Сохранить</button>
            <button class="btn btn-sm btn-ghost" @click="editing = false">Отмена</button>
          </div>
        </div>
        <div v-else class="cm-text"><template v-for="(p, i) in parts" :key="i"><a v-if="p.link" :href="p.v" target="_blank" rel="noopener noreferrer nofollow">{{ p.v }}</a><template v-else>{{ p.v }}</template></template></div>
        <div v-if="!editing" class="cm-actions">
          <button v-if="canWrite" class="cm-act" :class="{ on: liked }" :title="liked ? 'Убрать отметку' : 'Нравится'" @click="emit('like', c)">
            <Icon name="heart" :size="14" /><span v-if="c.likes.length">{{ c.likes.length }}</span>
          </button>
          <span v-else-if="c.likes.length" class="cm-act static"><Icon name="heart" :size="14" />{{ c.likes.length }}</span>
          <button v-if="canWrite" class="cm-act" @click="emit('reply', c)"><Icon name="reply" :size="14" /> Ответить</button>
          <button v-if="mine" class="cm-act" @click="startEdit"><Icon name="pencil" :size="13" /> Изменить</button>
          <button v-if="canDelete" class="cm-act danger" @click="emit('remove', c)"><Icon name="trash2" :size="13" /> Удалить</button>
          <button class="cm-act" title="Скопировать ссылку на комментарий" @click="emit('link', c)"><Icon name="link" :size="13" /></button>
        </div>
      </template>
    </div>
  </div>
</template>
