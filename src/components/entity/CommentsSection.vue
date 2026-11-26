<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { useSession } from '@/stores/session'
import { addComment, COMMENT_MAX, deleteComment, editComment, toggleLike } from '@/data/comments'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import CommentItem from './CommentItem.vue'
import { toast } from '@/components/common/toast'
import type { Comment, Entity } from '@/model/types'

// Comments under an article. Nothing is read until the reader opens them (the number comes with the article);
// while open they follow live. A link with ?c=<id> opens them and scrolls to that comment.
const props = defineProps<{ entity: Entity }>()
const world = useWorld()
const session = useSession()
const route = useRoute()
const router = useRouter()

const open = ref(false)
const loading = ref(false)
const rows = ref<Comment[]>([])
let stop: (() => void) | null = null

const live = computed(() => rows.value.filter((c) => !c.removed).length)
const count = computed(() => (open.value && !loading.value ? live.value : props.entity.commentCount ?? 0))
/** Members write (not guests, not preview or admin read-only view). */
const canWrite = computed(() => !!world.member && !world.preview && !world.adminReadOnly)
const target = computed(() => (typeof route.query.c === 'string' ? route.query.c : null))

// threads: top comments oldest first, replies under them; a reply whose thread is gone stands on its own
const threads = computed(() => {
  const ids = new Set(rows.value.map((c) => c.id))
  const tops = rows.value.filter((c) => !c.parentId || !ids.has(c.parentId))
  return tops.map((t) => ({ top: t, replies: rows.value.filter((c) => c.parentId === t.id) }))
})

function start() {
  if (stop) return
  loading.value = true
  stop = world.watchRows<Comment>('comments', 'entityId', props.entity.id, (r) => {
    rows.value = r.map((c) => ({ ...c, likes: c.likes ?? [] }))
    loading.value = false
  }, 'createdAt' as keyof Comment)
}
function toggle() {
  open.value = !open.value
  if (open.value) start()
  else { stop?.(); stop = null; rows.value = [] }
}
onBeforeUnmount(() => stop?.())

watch(target, async (id) => {
  if (!id) return
  if (!open.value) toggle()
  // wait for the comment to arrive, then bring it into view
  for (let i = 0; i < 40 && !rows.value.some((c) => c.id === id); i++) await new Promise((r) => setTimeout(r, 150))
  await nextTick()
  document.getElementById('comment-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}, { immediate: true })

// ---------- writing ----------
const author = () => ({ uid: world.uid!, name: world.member?.displayName || session.displayName(), photo: session.photo })
const text = ref('')
const busy = ref(false)
const replyTo = ref<{ thread: string; c: Comment } | null>(null)
const replyText = ref('')
const replyBox = ref<HTMLTextAreaElement[] | HTMLTextAreaElement | null>(null)

async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
  busy.value = true
  try { await fn(); if (ok) toast.success(ok); return true } catch (e: any) {
    console.error(e)
    toast.error(e?.code === 'permission-denied' ? 'Нет прав на это действие' : 'Не получилось: ' + (e?.message ?? e))
    return false
  } finally { busy.value = false }
}
async function send() {
  if (!text.value.trim() || busy.value) return
  if (await run(() => addComment(world.wid!, props.entity, author(), text.value, null))) text.value = ''
}
async function startReply(c: Comment) {
  replyTo.value = { thread: c.parentId ?? c.id, c }
  replyText.value = ''
  await nextTick()
  const el = Array.isArray(replyBox.value) ? replyBox.value[0] : replyBox.value
  el?.focus()
}
async function sendReply() {
  const r = replyTo.value
  if (!r || !replyText.value.trim() || busy.value) return
  // answering the thread's own top comment needs no «→ name»; a reply inside the thread names whom it answers
  const to = r.c.parentId ? { toUid: r.c.createdBy, toName: nameOf(r.c) } : { toUid: '', toName: '' }
  const ok = await run(() => addComment(world.wid!, props.entity, author(), replyText.value, { parentId: r.thread, toUid: to.toUid, toName: to.toName }))
  if (ok) { replyTo.value = null; replyText.value = '' }
}
const nameOf = (c: Comment) => world.members.find((m) => m.uid === c.createdBy)?.displayName || c.authorName
function save(c: Comment, t: string) { void run(() => editComment(world.wid!, c, t, world.uid!)) }
function remove(c: Comment) {
  if (!confirm(c.createdBy === world.uid ? 'Удалить ваш комментарий?' : `Удалить комментарий «${nameOf(c)}»?`)) return
  void run(() => deleteComment(world.wid!, c, rows.value, world.uid!), 'Комментарий удалён')
}
function like(c: Comment) { if (world.uid) void run(() => toggleLike(world.wid!, c, world.uid!)) }
async function copyLink(c: Comment) {
  const href = router.resolve({ name: 'entity', params: { wid: world.wid!, eid: props.entity.id }, query: { c: c.id } }).href
  const url = location.origin + location.pathname + href
  try { await navigator.clipboard.writeText(url); toast.success('Ссылка на комментарий скопирована') } catch { prompt('Ссылка на комментарий', url) }
}
const label = computed(() => (count.value ? `${count.value} ${plural(count.value, 'комментарий', 'комментария', 'комментариев')}` : 'Комментариев пока нет'))
</script>

<template>
  <section class="card comments no-print" :class="{ open }">
    <button class="cm-toggle" :aria-expanded="open" @click="toggle">
      <Icon name="message-square" :size="17" />
      <span class="grow">Комментарии <span v-if="count" class="count">{{ count }}</span></span>
      <span class="faint small">{{ open ? 'Свернуть' : count ? 'Показать' : canWrite ? 'Написать' : '' }}</span>
      <Icon :name="open ? 'chevron-up' : 'chevron-down'" :size="16" />
    </button>

    <div v-if="open" class="cm-wrap">
      <div v-if="canWrite" class="cm-new">
        <textarea v-model="text" class="input" rows="2" :maxlength="COMMENT_MAX" placeholder="Написать комментарий…" aria-label="Новый комментарий"
          @keydown.ctrl.enter.prevent="send" @keydown.meta.enter.prevent="send" />
        <div class="row gap-sm">
          <span class="faint small grow">{{ text.length > COMMENT_MAX - 400 ? `${COMMENT_MAX - text.length} символов осталось · ` : '' }}Ctrl+Enter — отправить</span>
          <button class="btn btn-sm btn-primary" :disabled="!text.trim() || busy" @click="send"><Icon name="send" :size="14" /> Отправить</button>
        </div>
      </div>
      <p v-else class="faint small cm-note">
        <template v-if="world.preview || world.adminReadOnly">В режиме просмотра писать нельзя.</template>
        <template v-else-if="!session.user"><RouterLink :to="{ name: 'login', query: { next: route.fullPath } }">Войдите</RouterLink>, чтобы участвовать в обсуждении.</template>
        <template v-else>Комментировать могут участники мира.</template>
      </p>

      <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="20" /></div>
      <p v-else-if="!rows.length" class="faint small cm-note">{{ label }}{{ canWrite ? ' — будьте первым.' : '.' }}</p>
      <div v-else class="cm-list">
        <div v-for="t in threads" :key="t.top.id" class="cm-thread">
          <CommentItem :c="t.top" :can-write="canWrite" :article-author="entity.createdBy" :highlight="target === t.top.id"
            @reply="startReply" @save="save" @remove="remove" @like="like" @link="copyLink" />
          <div v-if="t.replies.length || replyTo?.thread === t.top.id" class="cm-replies">
            <CommentItem v-for="r in t.replies" :key="r.id" :c="r" :can-write="canWrite" :article-author="entity.createdBy" :highlight="target === r.id"
              @reply="startReply" @save="save" @remove="remove" @like="like" @link="copyLink" />
            <div v-if="replyTo?.thread === t.top.id" class="cm-reply-box stack-sm">
              <div class="faint small"><Icon name="reply" :size="13" /> Ответ {{ nameOf(replyTo.c) }}
                <button class="icon-btn" style="width: 20px; height: 20px" title="Отменить ответ" @click="replyTo = null"><Icon name="x" :size="12" /></button>
              </div>
              <textarea ref="replyBox" v-model="replyText" class="input" rows="2" :maxlength="COMMENT_MAX" placeholder="Ваш ответ…" aria-label="Ответ"
                @keydown.ctrl.enter.prevent="sendReply" @keydown.meta.enter.prevent="sendReply" @keydown.esc.prevent="replyTo = null" />
              <div class="row gap-sm">
                <button class="btn btn-sm btn-primary" :disabled="!replyText.trim() || busy" @click="sendReply"><Icon name="send" :size="14" /> Ответить</button>
                <button class="btn btn-sm btn-ghost" @click="replyTo = null">Отмена</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style>
.comments { padding: 0; overflow: hidden; }
.cm-toggle {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 13px 18px; border: 0; background: none; cursor: pointer;
  font: inherit; font-weight: 600; color: var(--text); text-align: left;
}
.cm-toggle:hover { background: var(--surface-2); }
.cm-toggle > .icon:first-child { color: var(--accent); }
.cm-toggle .count { margin-left: 4px; font-weight: 600; font-size: 12px; padding: 1px 7px; border-radius: 99px; background: var(--accent-soft); color: var(--text); }
.cm-wrap { padding: 4px 18px 18px; border-top: 1px solid var(--border); }
.cm-new { display: flex; flex-direction: column; gap: 6px; padding: 14px 0 6px; }
.cm-new textarea, .cm-reply-box textarea, .cm-edit textarea { resize: vertical; min-height: 56px; font: inherit; }
.cm-note { margin: 12px 0 4px; }
.cm-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.cm-thread + .cm-thread { border-top: 1px solid var(--border); }
.cm { display: flex; gap: 10px; padding: 12px 0 8px; border-radius: 8px; }
.cm.hl { background: color-mix(in srgb, var(--accent) 10%, transparent); box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 10%, transparent); }
.cm-ava { width: 32px; height: 32px; flex: none; }
.cm.reply .cm-ava { width: 26px; height: 26px; }
.cm-body { flex: 1; min-width: 0; }
.cm-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; }
.cm-author { font-weight: 600; color: var(--text); text-decoration: none; }
.cm-author:hover { color: var(--accent); text-decoration: underline; }
.cm-role { font-size: 11px; padding: 0 6px; }
.cm-to { display: inline-flex; align-items: center; gap: 3px; }
.cm-text { margin-top: 3px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
.cm-text a { color: var(--accent); }
.cm-removed { display: flex; align-items: center; gap: 6px; padding: 6px 0; font-style: italic; }
.cm-actions { display: flex; flex-wrap: wrap; gap: 2px 4px; margin: 4px 0 0 -6px; }
.cm-act {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px; border: 0; border-radius: 6px; background: none;
  cursor: pointer; font: inherit; font-size: 12.5px; color: var(--text-faint);
}
.cm-act:hover { background: var(--surface-2); color: var(--text); }
.cm-act.on { color: var(--danger); }
.cm-act.on .icon { fill: currentColor; }
.cm-act.danger:hover { color: var(--danger); }
.cm-act.static { cursor: default; }
.cm-act.static:hover { background: none; color: var(--text-faint); }
.cm-replies { margin-left: 42px; padding-left: 12px; border-left: 2px solid var(--border); margin-bottom: 8px; }
.cm-reply-box { padding: 8px 0 4px; }
@media (max-width: 640px) {
  .cm-wrap { padding: 4px 12px 14px; }
  .cm-toggle { padding: 12px; }
  .cm-replies { margin-left: 14px; padding-left: 10px; }
}
</style>
