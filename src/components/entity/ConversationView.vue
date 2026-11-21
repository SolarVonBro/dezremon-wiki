<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { useSession } from '@/stores/session'
import { useRows } from '@/composables/useRows'
import { formatDate } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import type { ConversationMessage, Entity } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const session = useSession()
const msgs = useRows<ConversationMessage>('messages', 'conversationId', () => props.entity.id, 'createdAt')
const participants = computed<string[]>(() => props.entity.fields?.participantIds ?? [])
const author = ref<string>('')
const text = ref('')
const box = ref<HTMLElement | null>(null)
watch(() => msgs.value.length, async () => { await nextTick(); box.value?.scrollTo({ top: box.value.scrollHeight }) })

async function send() {
  const t = text.value.trim()
  if (!t) return
  const e = author.value ? world.get(author.value) : null
  await world.saveRow('messages', { conversationId: props.entity.id, authorEntityId: e?.id ?? null, authorName: e?.name ?? session.displayName(), text: t, visibility: props.entity.visibility, allowedUids: props.entity.allowedUids ?? [] })
  text.value = ''
}
async function remove(m: ConversationMessage) { if (confirm('Удалить реплику?')) await world.deleteRow('messages', m.id) }
</script>

<template>
  <div class="card card-pad" style="max-width: 820px">
    <h3 class="panel-title"><Icon name="messages-square" /> Разговор</h3>
    <div ref="box" class="chat">
      <div v-if="!msgs.length" class="empty">Реплик пока нет. Запишите диалог, переписку или допрос от лица персонажей.</div>
      <div v-for="m in msgs" :key="m.id" class="msg" :class="{ mine: m.createdBy === world.uid }">
        <div class="msg-head">
          <EntityLink v-if="m.authorEntityId" :id="m.authorEntityId" avatar :fallback="m.authorName" />
          <b v-else>{{ m.authorName }}</b>
          <span class="faint small">{{ formatDate(m.createdAt) }}</span>
          <button v-if="world.isMaster || m.createdBy === world.uid" class="icon-btn" style="width: 22px; height: 22px; margin-left: auto" @click="remove(m)"><Icon name="x" :size="12" /></button>
        </div>
        <div class="msg-text">{{ m.text }}</div>
      </div>
    </div>
    <form v-if="world.isMember" class="stack-sm" style="margin-top: 12px" @submit.prevent="send">
      <div class="row gap-sm">
        <select v-model="author" class="input input-sm" style="max-width: 240px">
          <option value="">От своего имени</option>
          <option v-for="id in participants" :key="id" :value="id">{{ world.get(id)?.name ?? 'скрыто' }}</option>
        </select>
        <span class="faint small">Участники задаются в поле «Участники» статьи.</span>
      </div>
      <div class="row gap-sm">
        <textarea v-model="text" class="input grow" rows="2" placeholder="Реплика…" @keydown.enter.exact.prevent="send" />
        <button class="btn btn-primary" :disabled="!text.trim()"><Icon name="arrow-right" :size="16" /></button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow-y: auto; padding: 4px; }
.msg { background: var(--surface-2); border-radius: 12px; padding: 8px 12px; max-width: 80%; border: 1px solid var(--border); }
.msg.mine { align-self: flex-end; background: var(--accent-soft); }
.msg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.msg-text { white-space: pre-wrap; font-family: var(--font-text); }
</style>
