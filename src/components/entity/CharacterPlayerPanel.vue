<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { VISIBILITY_SHORT } from '@/data/access'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import type { Entity, Role } from '@/model/types'

// A character's page: who plays this character. Masters give it to a member here (or in the member's card in
// «Участники и права»); everyone else sees the player's name. A character has one player, a member any number of
// characters — they are listed in the world menu under «Мои персонажи».
const props = defineProps<{ entity: Entity }>()
const world = useWorld()
const ROLE: Record<Role, string> = { owner: 'владелец', master: 'мастер', player: 'игрок' }
const player = computed(() => world.playerOf(props.entity.id))
const isMine = computed(() => !!player.value && player.value.uid === world.uid && !world.preview)
// players first, then masters (a master may play too)
const options = computed(() => [...world.members].sort((a, b) => Number(a.role !== 'player') - Number(b.role !== 'player') || a.displayName.localeCompare(b.displayName)))
const hidden = computed(() => !!player.value && !world.canMemberSee(player.value, props.entity))
const busy = ref(false)

async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true
  try { await fn(); toast.success(ok) } catch { /* the store shows the error */ } finally { busy.value = false }
}
function pick(uid: string) {
  const m = world.members.find((x) => x.uid === uid)
  void run(() => world.assignCharacter(props.entity.id, m?.uid ?? null), m ? `Персонаж закреплён: ${m.displayName}` : 'Персонаж ни за кем не закреплён')
}
function openToPlayer() {
  const m = player.value
  if (m) void run(() => world.openToMember(props.entity, m), `${m.displayName} теперь видит эту статью`)
}
</script>

<template>
  <div v-if="world.isMaster || player" class="card card-pad stack-sm char-player">
    <div class="section-title" style="margin: 0">Игрок</div>
    <template v-if="world.isMaster">
      <select class="input input-sm" :value="player?.uid ?? ''" :disabled="busy" aria-label="Игрок" @change="pick(($event.target as HTMLSelectElement).value)">
        <option value="">— ни за кем не закреплён —</option>
        <option v-for="m in options" :key="m.uid" :value="m.uid">{{ m.displayName }}{{ m.role !== 'player' ? ` (${ROLE[m.role]})` : '' }}</option>
      </select>
      <div v-if="hidden && player" class="cp-warn small">
        <Icon name="eye-off" :size="14" />
        <span class="grow">{{ player.displayName }} не может открыть эту статью (видимость «{{ VISIBILITY_SHORT[entity.visibility] }}»).</span>
        <button class="btn btn-sm" :disabled="busy" @click="openToPlayer">Открыть доступ</button>
      </div>
      <span v-else class="faint small">{{ player ? `${player.displayName} найдёт статью в меню мира: «Мои персонажи».` : 'Выбранный участник найдёт статью в меню мира: «Мои персонажи».' }}</span>
    </template>
    <div v-else-if="player" class="row gap-sm">
      <span class="avatar round" style="width: 26px; height: 26px"><img v-if="player.photoURL" :src="player.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="14" /></span>
      <b class="grow ellipsis">{{ player.displayName }}</b>
      <span v-if="isMine" class="badge badge-public">это вы</span>
    </div>
  </div>
</template>

<style scoped>
.cp-warn {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 9px; border-radius: var(--radius-sm);
  color: var(--text); background: color-mix(in srgb, var(--warning) 12%, transparent); border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
}
.cp-warn > .icon { color: var(--warning); }
</style>
