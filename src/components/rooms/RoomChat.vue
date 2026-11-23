<script setup lang="ts">
import { errorText } from '@/data/util'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/stores/session'
import { deleteMessage, sendMessage, watchMessages } from '@/data/rooms'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import type { RoomMessage } from '@/model/types'

const props = defineProps<{ rid: string; isHost: boolean }>()
const session = useSession()
const rows = ref<RoomMessage[]>([])
const text = ref('')
const box = ref<HTMLElement | null>(null)
const stop = watchMessages(props.rid, (r) => {
  const atBottom = !box.value || box.value.scrollHeight - box.value.scrollTop - box.value.clientHeight < 60
  rows.value = r
  if (atBottom) void nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight })
})
onBeforeUnmount(stop)
watch(box, (b) => { if (b) b.scrollTop = b.scrollHeight })

async function send() {
  const t = text.value.trim()
  if (!t || !session.user) return
  text.value = ''
  try { await sendMessage(props.rid, session.me!, t) } catch (e: any) { text.value = t; toast.error('Не отправилось: ' + errorText(e)) }
}
const time = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="chat">
    <div ref="box" class="msgs">
      <div v-if="!rows.length" class="faint small" style="padding: 8px">Сообщений пока нет.</div>
      <div v-for="m in rows" :key="m.id" class="msg" :class="{ mine: m.uid === session.user?.uid }">
        <div class="msg-head"><b class="small">{{ m.name }}</b><span class="faint small">{{ time(m.at) }}</span>
          <button v-if="isHost || m.uid === session.user?.uid" class="icon-btn del" title="Удалить" @click="deleteMessage(rid, m.id)"><Icon name="x" :size="11" /></button>
        </div>
        <div class="msg-text">{{ m.text }}</div>
      </div>
    </div>
    <form class="row gap-sm" @submit.prevent="send">
      <input v-model="text" class="input input-sm" maxlength="2000" placeholder="Сообщение…" />
      <button class="btn btn-sm btn-primary" :disabled="!text.trim()" title="Отправить"><Icon name="send" :size="14" /></button>
    </form>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.msgs { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 360px; min-height: 120px; padding-right: 2px; }
.msg { background: var(--surface-2); border-radius: 10px; padding: 5px 9px; max-width: 92%; align-self: flex-start; }
.msg.mine { align-self: flex-end; background: var(--accent-soft); }
.msg-head { display: flex; align-items: center; gap: 6px; }
.msg-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
.del { width: 18px; height: 18px; margin-left: auto; opacity: .5; }
.msg:hover .del { opacity: 1; }
</style>
