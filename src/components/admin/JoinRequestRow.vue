<script setup lang="ts">
import { ref } from 'vue'
import { useSession } from '@/stores/session'
import { acceptJoinRequest, banRequester, cancelJoinRequest, rejectJoinRequest } from '@/data/joinRequests'
import { formatDate, relativeTime } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { toast } from '@/components/common/toast'
import type { JoinRequest } from '@/model/types'

// One join request with the master's actions; used in world settings and in the personal cabinet.
const props = defineProps<{ wid: string; request: JoinRequest; canMaster: boolean; worldName?: string; showWorld?: boolean }>()
const emit = defineEmits<{ done: [] }>()
const session = useSession()
const busy = ref(false)
const r = props.request

function articleLink() { return `${location.origin}${location.pathname}#${r.fromPath}` }

async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true
  try { await fn(); toast.success(ok); emit('done') } catch (e: any) { toast.error(e?.message ?? String(e)) } finally { busy.value = false }
}
const accept = (role: 'player' | 'master') => run(() => acceptJoinRequest(props.wid, r, role), `${r.displayName} теперь ${role === 'master' ? 'мастер' : 'игрок'} мира`)
const reject = () => run(() => rejectJoinRequest(props.wid, r.uid, session.user!.uid, props.worldName ?? r.worldName ?? ''), 'Заявка отклонена')
const remove = () => run(() => cancelJoinRequest(props.wid, r.uid), 'Заявка удалена')
function ban() {
  if (!confirm(`Заблокировать ${r.displayName}? Он не сможет снова попросить доступ или войти по ссылке-приглашению.`)) return
  void run(() => banRequester(props.wid, r, session.user!.uid), 'Пользователь заблокирован')
}
</script>

<template>
  <div class="jr" :class="{ rejected: request.status === 'rejected' }">
    <span class="avatar round" style="width: 38px; height: 38px"><img v-if="request.photoURL" :src="request.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="17" /></span>
    <div class="grow jr-body">
      <div><b>{{ request.displayName }}</b> <span class="faint small">{{ request.email }}</span></div>
      <div class="faint small">
        <template v-if="showWorld">в мир <b>{{ worldName || request.worldName || 'без названия' }}</b> · </template>
        <span :title="formatDate(request.createdAt)">{{ relativeTime(request.createdAt) }}</span>
        <template v-if="request.fromPath && request.fromPath !== '/'"> · <a :href="articleLink()" target="_blank" rel="noopener">пришёл со страницы</a></template>
        <template v-if="request.status === 'rejected'"> · <span class="danger-text">отклонена {{ request.decidedAt ? formatDate(request.decidedAt) : '' }}</span></template>
      </div>
      <blockquote v-if="request.message" class="jr-msg">{{ request.message }}</blockquote>
    </div>
    <div class="jr-actions">
      <button class="btn btn-sm btn-primary" :disabled="busy" @click="accept('player')"><Icon name="check" :size="14" /> Принять</button>
      <Dropdown placement="bottom-end">
        <template #trigger><button class="icon-btn" title="Ещё" :disabled="busy"><Icon name="more-horizontal" /></button></template>
        <div class="menu">
          <button v-if="canMaster" class="menu-item" @click="accept('master')"><Icon name="shield" :size="15" /> Принять мастером</button>
          <button v-if="request.status === 'pending'" class="menu-item" @click="reject"><Icon name="x" :size="15" /> Отклонить</button>
          <button v-else class="menu-item" @click="remove"><Icon name="trash2" :size="15" /> Удалить заявку</button>
          <button class="menu-item danger" @click="ban"><Icon name="lock" :size="15" /> Отклонить и заблокировать</button>
        </div>
      </Dropdown>
      <button v-if="request.status === 'pending'" class="btn btn-sm" :disabled="busy" @click="reject">Отклонить</button>
    </div>
  </div>
</template>

<style scoped>
.jr { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--border); }
.jr:first-of-type { border-top: 0; }
.jr.rejected { opacity: .7; }
.jr-body { min-width: 0; }
.jr-msg { margin: 6px 0 0; padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--surface-2); border-radius: 0 6px 6px 0; white-space: pre-wrap; font-size: 14px; }
.jr-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.danger-text { color: var(--danger); }
@media (max-width: 640px) { .jr { flex-wrap: wrap; } .jr-actions { width: 100%; justify-content: flex-end; } }
</style>
