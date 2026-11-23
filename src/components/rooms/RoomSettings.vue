<script setup lang="ts">
import { errorText } from '@/data/util'
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { watchMyCampaigns } from '@/data/campaigns'
import { deleteRoom, updateRoom } from '@/data/rooms'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, Room, RoomAccess } from '@/model/types'

const props = defineProps<{ room: Room; isOwner: boolean }>()
const emit = defineEmits<{ close: [] }>()
const session = useSession()
const router = useRouter()
const campaigns = ref<Campaign[]>([])
const stop = watchMyCampaigns(session.user!.uid, (r) => { campaigns.value = r })
onBeforeUnmount(stop)
const form = ref({ name: props.room.name, campaignId: props.room.campaignId ?? '', access: props.room.access as RoomAccess, controlMode: props.room.controlMode })
const busy = ref(false)

async function save() {
  if (!form.value.name.trim()) return
  busy.value = true
  const c = campaigns.value.find((x) => x.id === form.value.campaignId) ?? null
  try {
    await updateRoom(props.room.id, {
      name: form.value.name.trim(), campaignId: c?.id ?? null, campaignName: c?.name ?? (form.value.campaignId === props.room.campaignId ? props.room.campaignName : ''),
      access: c ? form.value.access : 'link', controlMode: form.value.controlMode,
    })
    emit('close')
  } catch (e: any) { toast.error('Не удалось сохранить: ' + errorText(e)) } finally { busy.value = false }
}
async function remove() {
  if (!confirm(`Удалить комнату «${props.room.name}» вместе с очередью и чатом?`)) return
  busy.value = true
  try { await deleteRoom(props.room.id); emit('close'); void router.replace({ name: 'rooms' }) } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) } finally { busy.value = false }
}
</script>

<template>
  <Modal title="Настройки комнаты" width="520px" @close="emit('close')">
    <div class="stack">
      <label class="field"><span>Название</span><input v-model="form.name" class="input" maxlength="80" /></label>
      <label class="field"><span>Игра</span>
        <select v-model="form.campaignId" class="input">
          <option value="">— не привязана —</option>
          <option v-if="room.campaignId && !campaigns.some((c) => c.id === room.campaignId)" :value="room.campaignId">{{ room.campaignName || 'текущая игра' }}</option>
          <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <div class="field"><span>Кто может зайти</span>
        <label class="check"><input v-model="form.access" type="radio" value="link" /> Все, у кого есть ссылка (нужен вход в аккаунт)</label>
        <label class="check" :class="{ faint: !form.campaignId }"><input v-model="form.access" type="radio" value="campaign" :disabled="!form.campaignId" /> Только участники игры</label>
      </div>
      <div class="field"><span>Кто управляет музыкой</span>
        <label class="check"><input v-model="form.controlMode" type="radio" value="hosts" /> Владелец и ведущие</label>
        <label class="check"><input v-model="form.controlMode" type="radio" value="everyone" /> Все слушатели</label>
      </div>
      <p class="faint small" style="margin: 0">Ведущих назначают в списке слушателей. Даже без управления слушатели не дают очереди застрять: когда трек кончается, следующий включается сам.</p>
    </div>
    <template #footer>
      <button v-if="isOwner" class="btn btn-danger" style="margin-right: auto" :disabled="busy" @click="remove"><Icon name="trash2" :size="14" /> Удалить</button>
      <button class="btn" @click="emit('close')">Отмена</button>
      <button class="btn btn-primary" :disabled="busy || !form.name.trim()" @click="save">Сохранить</button>
    </template>
  </Modal>
</template>
