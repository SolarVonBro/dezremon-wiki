<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { allTypes, typeDef } from '@/model/entityTypes'
import { formatDate, relativeTime } from '@/data/util'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import MultiSelect from '@/components/common/MultiSelect.vue'
import { toast } from '@/components/common/toast'
import type { Member, Role } from '@/model/types'

const props = defineProps<{ member: Member }>()
const emit = defineEmits<{ close: [] }>()
const world = useWorld()
const router = useRouter()
const m = computed(() => world.members.find((x) => x.uid === props.member.uid) ?? props.member)
const isSelf = computed(() => m.value.uid === world.uid)
const busy = ref(false)
const ROLE: Record<Role, string> = { owner: 'Владелец', master: 'Мастер', player: 'Игрок' }

async function act(fn: () => Promise<unknown>, ok: string) {
  busy.value = true
  try { await fn(); toast.success(ok) } catch (e: any) { toast.error(e?.code === 'permission-denied' ? 'Недостаточно прав' : e?.message ?? String(e)) } finally { busy.value = false }
}

// ---------- role & ownership ----------
const canChangeRole = computed(() => world.isOwner && m.value.role !== 'owner')
function setRole(r: Role) { void act(() => world.setMemberRole(m.value.uid, r), `Роль: ${ROLE[r]}`) }
function transfer() {
  if (!confirm(`Передать владение миром «${world.world?.name}» участнику ${m.value.displayName}? Вы станете мастером, а управлять ролями и удалить мир сможет только новый владелец.`)) return
  void act(() => world.transferOwnership(m.value.uid), 'Владение передано')
}

// ---------- character & extra rights ----------
const character = computed(() => m.value.characterId ?? null)
function setCharacter(id: string | null) { void act(() => world.updateMember(m.value.uid, { characterId: id }), id ? 'Персонаж назначен' : 'Персонаж снят') }
const typeOptions = computed(() => allTypes().filter((t) => world.enabledTypes(t.key) && !world.settings.playerCreateTypes.includes(t.key)).map((t) => ({ value: t.key, label: t.plural, icon: t.icon, color: t.color })))
const defaultTypes = computed(() => world.settings.playerCreateTypes.map((k) => typeDef(k).plural).join(', ') || 'ничего')
function setCreateTypes(v: string[]) { void act(() => world.updateMember(m.value.uid, { createTypes: v }), 'Права обновлены') }

// ---------- per-article access ----------
const sharedWith = computed(() => [...world.entities.values()].filter((e) => !e.deleted && e.visibility === 'custom' && (e.allowedUids ?? []).includes(m.value.uid)))
const editableBy = computed(() => [...world.entities.values()].filter((e) => !e.deleted && (e.editorUids ?? []).includes(m.value.uid)))
const addShare = ref<string | null>(null)
const addEdit = ref<string | null>(null)
function grantRead(id: string | null) {
  addShare.value = null
  const e = id ? world.getAny(id) : null
  if (!e) return
  if (e.visibility === 'public' || e.visibility === 'members') { toast.info('Эту статью и так видят все участники'); return }
  void act(() => world.updateEntity(e.id, { visibility: 'custom', allowedUids: [...new Set([...(e.allowedUids ?? []), m.value.uid])] }), `Доступ к «${e.name}» открыт`)
}
function revokeRead(id: string) {
  const e = world.getAny(id)
  if (!e) return
  const rest = (e.allowedUids ?? []).filter((u) => u !== m.value.uid)
  void act(() => world.updateEntity(id, { allowedUids: rest, visibility: rest.length ? 'custom' : 'master' }), 'Доступ закрыт')
}
function grantEdit(id: string | null) {
  addEdit.value = null
  const e = id ? world.getAny(id) : null
  if (!e) return
  void act(() => world.updateEntity(e.id, { editorUids: [...new Set([...(e.editorUids ?? []), m.value.uid])] }), `Можно редактировать «${e.name}»`)
}
function revokeEdit(id: string) {
  const e = world.getAny(id)
  if (e) void act(() => world.updateEntity(id, { editorUids: (e.editorUids ?? []).filter((u) => u !== m.value.uid) }), 'Право редактирования снято')
}

// ---------- activity ----------
const authored = computed(() => [...world.entities.values()].filter((e) => !e.deleted && e.createdBy === m.value.uid).sort((a, b) => b.createdAt - a.createdAt))
const edited = computed(() => [...world.entities.values()].filter((e) => !e.deleted && e.updatedBy === m.value.uid).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10))

// ---------- removal ----------
const canRemove = computed(() => !isSelf.value && m.value.role !== 'owner' && (world.isOwner || m.value.role === 'player'))
function kick() {
  if (!confirm(`Исключить ${m.value.displayName} из мира? Вернуться можно будет по приглашению.`)) return
  void act(async () => { await world.removeMember(m.value.uid); emit('close') }, 'Участник исключён')
}
function ban() {
  if (!confirm(`Заблокировать ${m.value.displayName}? Участник будет исключён и не сможет вернуться даже по действующей ссылке-приглашению.`)) return
  void act(async () => { await world.banMember(m.value); emit('close') }, 'Участник заблокирован')
}
function viewAs() {
  world.startPreview({ uid: m.value.uid, name: m.value.displayName })
  emit('close')
  void router.push({ name: 'dashboard', params: { wid: world.wid! } })
}
</script>

<template>
  <Modal :title="m.displayName" width="820px" @close="emit('close')">
    <div class="mm">
      <section class="mm-head">
        <span class="avatar round avatar-lg"><img v-if="m.photoURL" :src="m.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" /></span>
        <div class="grow">
          <div class="muted small">{{ m.email || 'почта скрыта' }}</div>
          <div class="small faint">В мире с {{ formatDate(m.joinedAt) }} · {{ m.lastSeenAt ? 'был(а) ' + relativeTime(m.lastSeenAt) : 'ещё не заходил(а) после регистрации' }}</div>
        </div>
        <div class="stack-sm" style="align-items: flex-end">
          <select v-if="canChangeRole" class="input input-sm" style="width: auto" :value="m.role" :disabled="busy" @change="setRole(($event.target as HTMLSelectElement).value as Role)">
            <option value="master">Мастер</option><option value="player">Игрок</option>
          </select>
          <span v-else class="badge" :class="{ 'badge-public': m.role === 'owner', 'badge-secret': m.role === 'master' }">{{ ROLE[m.role] }}</span>
          <button v-if="world.isOwner && !isSelf" class="btn btn-ghost btn-sm" :disabled="busy" @click="transfer"><Icon name="crown" :size="14" /> Передать владение</button>
        </div>
      </section>

      <p v-if="m.role !== 'player'" class="muted small">{{ m.role === 'owner' ? 'Владелец' : 'Мастер' }} видит и правит всё в мире{{ m.role === 'owner' ? ', управляет ролями и может удалить мир' : '' }}. Ниже — то, что касается игроков.</p>

      <div class="mm-grid">
        <section class="card card-pad stack-sm">
          <div class="section-title">Персонаж игрока</div>
          <EntityPicker :model-value="character" :types="['character']" placeholder="Не назначен" @update:model-value="setCharacter" />
          <span class="faint small">Ссылка «Мой персонаж» появится у участника в меню мира и в кабинете.</span>
        </section>
        <section v-if="m.role === 'player'" class="card card-pad stack-sm">
          <div class="section-title">Может создавать</div>
          <MultiSelect :model-value="m.createTypes ?? []" :options="typeOptions" placeholder="Только общие разделы" @update:model-value="setCreateTypes" />
          <span class="faint small">Всем игрокам уже разрешено: {{ defaultTypes }} (Настройки → Разделы).</span>
        </section>
      </div>

      <template v-if="m.role === 'player'">
        <section class="card card-pad stack-sm">
          <div class="section-title row"><span class="grow">Доступ к закрытым статьям ({{ sharedWith.length }})</span></div>
          <div v-for="e in sharedWith" :key="e.id" class="rel-row">
            <EntityLink :id="e.id" avatar /><span class="faint small grow">{{ typeDef(e.type).label }} · видят: {{ (e.allowedUids ?? []).map((u) => world.memberName(u)).join(', ') }}</span>
            <button class="icon-btn" title="Закрыть доступ" :disabled="busy" @click="revokeRead(e.id)"><Icon name="x" :size="14" /></button>
          </div>
          <EntityPicker v-model="addShare" placeholder="Открыть статью, скрытую от остальных…" :allow-create="false" @update:model-value="grantRead" />
        </section>
        <section class="card card-pad stack-sm">
          <div class="section-title">Может редактировать ({{ editableBy.length }})</div>
          <div v-for="e in editableBy" :key="e.id" class="rel-row">
            <EntityLink :id="e.id" avatar /><span class="faint small grow">{{ typeDef(e.type).label }}</span>
            <button class="icon-btn" title="Снять право" :disabled="busy" @click="revokeEdit(e.id)"><Icon name="x" :size="14" /></button>
          </div>
          <EntityPicker v-model="addEdit" placeholder="Разрешить править статью…" :allow-create="false" @update:model-value="grantEdit" />
          <span class="faint small">Свои статьи участник правит всегда. Статьи с секретами мастера игрокам править нельзя.</span>
        </section>
      </template>

      <div class="mm-grid">
        <section class="card card-pad stack-sm">
          <div class="section-title">Создал(а) статей: {{ authored.length }}</div>
          <EntityLink v-for="e in authored.slice(0, 12)" :key="e.id" :id="e.id" />
          <span v-if="authored.length > 12" class="faint small">и ещё {{ authored.length - 12 }}</span>
          <span v-if="!authored.length" class="faint small">Пока нет.</span>
        </section>
        <section class="card card-pad stack-sm">
          <div class="section-title">Последние правки</div>
          <div v-for="e in edited" :key="e.id" class="row gap-sm"><EntityLink :id="e.id" /><span class="faint small grow" style="text-align: right">{{ relativeTime(e.updatedAt) }}</span></div>
          <span v-if="!edited.length" class="faint small">Пока нет.</span>
        </section>
      </div>
    </div>
    <template #footer>
      <button v-if="m.role === 'player'" class="btn btn-ghost" style="margin-right: auto" @click="viewAs"><Icon name="eye" :size="15" /> Глазами этого игрока</button>
      <button v-if="canRemove" class="btn btn-danger" :disabled="busy" @click="kick">Исключить</button>
      <button v-if="canRemove" class="btn btn-danger" :disabled="busy" @click="ban">Заблокировать</button>
      <button class="btn" @click="emit('close')">Готово</button>
    </template>
  </Modal>
</template>

<style scoped>
.mm { display: flex; flex-direction: column; gap: 14px; }
.mm-head { display: flex; align-items: center; gap: 14px; }
.mm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
</style>
