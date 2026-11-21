<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSession } from '@/stores/session'
import { useWorld } from '@/stores/world'
import { sendJoinRequest, cancelJoinRequest, fetchMyRequest, watchMyRequest } from '@/data/joinRequests'
import { formatDate } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import { toast } from '@/components/common/toast'
import type { JoinRequest } from '@/model/types'

// Shown to everyone who is not a member of the world: guests are invited to sign in,
// signed-in visitors can ask the masters to let them in (the dialog opens by itself once per world).
const props = withDefaults(defineProps<{ wid: string; closed?: boolean }>(), { closed: false })
const session = useSession()
const world = useWorld()
const route = useRoute()
const request = ref<JoinRequest | null | undefined>(undefined)
const asking = ref(false)
const message = ref('')
const busy = ref(false)
const hidden = ref(false)
let cancelling = false
let stop: (() => void) | null = null
let poll: number | undefined

const worldName = computed(() => (world.wid === props.wid ? world.world?.name ?? null : null))
const askedKey = computed(() => `dw.joinAsk.${props.wid}`)

function apply(r: JoinRequest | null) {
  const was = request.value
  request.value = r
  // A pending request vanished without us cancelling it: a master accepted (or dismissed) it. Reload the
  // world so an accepted visitor gets in right away; the store's own membership listener usually beats us.
  if (was?.status === 'pending' && !r && !cancelling && world.status !== 'loading' && !world.isMember) {
    world.close()
    void world.open(props.wid)
  }
}

watch(() => [props.wid, session.user?.uid], ([w, u]) => {
  stop?.()
  stop = null
  request.value = undefined
  if (!w || !u) return
  stop = watchMyRequest(w as string, u as string, (r) => {
    const first = request.value === undefined
    apply(r)
    // first visit after signing in: offer the request right away (once per world in this browser)
    if (first && !r) {
      try {
        if (!localStorage.getItem(askedKey.value)) { localStorage.setItem(askedKey.value, '1'); asking.value = true }
      } catch { asking.value = true }
    }
  })
}, { immediate: true })

// Safety net: a snapshot listener can go quiet after access changes under it (seen after being removed from
// a world), so while waiting for an answer re-read the request from the server every 20 s.
watch(() => request.value?.status, (st) => {
  window.clearInterval(poll)
  poll = undefined
  if (st !== 'pending') return
  poll = window.setInterval(async () => {
    if (document.visibilityState !== 'visible' || !session.user) return
    const r = await fetchMyRequest(props.wid, session.user.uid).catch(() => undefined)
    if (r !== undefined && (r?.status ?? null) !== (request.value?.status ?? null)) apply(r)
  }, 20000)
})
onBeforeUnmount(() => { stop?.(); window.clearInterval(poll) })

async function send() {
  if (!session.user) return
  busy.value = true
  try {
    request.value = await sendJoinRequest(props.wid, session.user, message.value, route.fullPath, worldName.value)
    asking.value = false
    toast.success('Заявка отправлена — мастер увидит её в настройках мира')
  } catch (e: any) { toast.error(e?.message ?? String(e)) } finally { busy.value = false }
}
async function cancel() {
  if (!session.user) return
  const wasRejected = request.value?.status === 'rejected'
  cancelling = true
  try {
    await cancelJoinRequest(props.wid, session.user.uid)
    request.value = null
    toast.info(wasRejected ? 'Заявка удалена — можно отправить новую' : 'Заявка отменена')
  } catch (e: any) { toast.error(e?.message ?? String(e)) } finally { cancelling = false }
}
const fromArticle = computed(() => {
  const eid = route.params.eid as string | undefined
  return eid ? world.get(eid)?.name ?? null : null
})
</script>

<template>
  <div v-if="!session.user && !hidden && !closed" class="join-banner">
    <Icon name="eye" :size="16" />
    <span class="grow">Вы смотрите мир как гость — видны только открытые статьи. Войдите, чтобы попросить у мастера доступ.</span>
    <RouterLink class="btn btn-sm btn-primary" :to="{ name: 'login', query: { next: route.fullPath } }">Войти</RouterLink>
    <button class="icon-btn" title="Скрыть" @click="hidden = true"><Icon name="x" :size="14" /></button>
  </div>
  <div v-else-if="session.user && request !== undefined" class="join-banner" :class="{ inline: closed }">
    <template v-if="!request">
      <Icon name="user-plus" :size="16" />
      <span class="grow">{{ closed ? 'Это закрытый мир.' : 'Вы не участник этого мира — видны только открытые статьи.' }} Попросите мастера впустить вас.</span>
      <button class="btn btn-sm btn-primary" @click="asking = true"><Icon name="mail" :size="14" /> Попросить доступ</button>
    </template>
    <template v-else-if="request.status === 'pending'">
      <Icon name="clock" :size="16" />
      <span class="grow">Заявка на вступление отправлена {{ formatDate(request.createdAt) }}. Как только мастер её примет, мир откроется — обновлять страницу не нужно.</span>
      <button class="btn btn-sm btn-ghost" @click="cancel">Отменить заявку</button>
    </template>
    <template v-else>
      <Icon name="x" :size="16" />
      <span class="grow">Мастер отклонил вашу заявку.</span>
      <button class="btn btn-sm btn-ghost" @click="cancel">Удалить заявку</button>
    </template>
  </div>

  <Modal v-if="asking" title="Попросить доступ к миру" width="520px" @close="asking = false">
    <div class="stack">
      <p style="margin: 0">Мастер мира{{ worldName ? ` «${worldName}»` : '' }} получит вашу заявку и сможет принять вас игроком. Вы увидите статьи, открытые участникам{{ fromArticle ? `, в том числе «${fromArticle}»` : '' }}.</p>
      <label class="field"><span>Сообщение мастеру (необязательно)</span>
        <textarea v-model="message" class="input" rows="3" maxlength="1000" placeholder="Например: я Соня, играю у тебя по пятницам — персонаж Аэлин" />
      </label>
      <p class="faint small" style="margin: 0">Мастер увидит ваше имя «{{ session.displayName() }}» и почту {{ session.user?.email }}.</p>
    </div>
    <template #footer>
      <button class="btn" @click="asking = false">Не сейчас</button>
      <button class="btn btn-primary" :disabled="busy" @click="send"><Icon name="mail" :size="15" /> Отправить заявку</button>
    </template>
  </Modal>
</template>

<style scoped>
.join-banner { position: sticky; top: var(--topbar-h); z-index: 28; display: flex; align-items: center; gap: 10px; padding: 8px 20px; background: color-mix(in srgb, var(--accent) 14%, var(--surface)); border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); font-size: 14px; flex-wrap: wrap; }
.join-banner > .icon { color: var(--accent); }
.join-banner.inline { position: static; display: grid; grid-template-columns: auto 1fr; align-items: start; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 10px; text-align: left; padding: 12px 14px; }
.join-banner.inline > .icon { margin-top: 2px; }
.join-banner.inline > .btn { grid-column: 2; justify-self: start; }
@media (max-width: 860px) { .join-banner { padding: 8px 12px; } }
</style>
