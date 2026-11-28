<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { deletePf2eCharacter, exportPf2eCharacters, updatePf2eCharacter, watchPf2eCharacter } from '@/data/pf2eCharacters'
import { setActivePf2eChar } from '@/data/pf2eWorkspace'
import { fileToSource, renderAvatar } from '@/data/avatar'
import { errorText } from '@/data/util'
import type { Pf2eCharacter, Pf2eSpellList } from '@/model/pf2e'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import ImageModal, { type ImageSavePayload } from '@/components/common/ImageModal.vue'
import Pf2eTopNav from '@/components/pf2e/Pf2eTopNav.vue'
import Pf2eCharSpells from '@/components/pf2e/Pf2eCharSpells.vue'
import Pf2eCharInventory from '@/components/pf2e/Pf2eCharInventory.vue'
import { openLightbox } from '@/components/viewer/lightbox'
import { toast } from '@/components/common/toast'

const session = useSession()
const route = useRoute()
const router = useRouter()

const cid = computed(() => String(route.params.cid ?? ''))
const character = ref<Pf2eCharacter | null>(null)
const loading = ref(true)
const tab = ref<'spells' | 'inventory'>(route.query.tab === 'inventory' ? 'inventory' : 'spells')
watch(() => route.query.tab, (t) => {
  if (t === 'inventory') tab.value = 'inventory'
  else if (t === 'spells') tab.value = 'spells'
})
function setTab(next: 'spells' | 'inventory') {
  tab.value = next
  void router.replace({ name: 'toolPf2eChar', params: { cid: cid.value }, query: next === 'inventory' ? { tab: 'inventory' } : {} })
}
let stopWatch: (() => void) | null = null

watch(() => [session.ready, session.user?.uid, cid.value] as const, ([ready, u, id]) => {
  stopWatch?.()
  stopWatch = null
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u || !id) return
  setActivePf2eChar(id)
  loading.value = true
  stopWatch = watchPf2eCharacter(
    u,
    id,
    (row) => { character.value = row; loading.value = false },
    (e) => { loading.value = false; toast.error('Не удалось загрузить персонажа: ' + errorText(e)) },
  )
}, { immediate: true })
onBeforeUnmount(() => stopWatch?.())

async function patchChar(patch: Partial<Omit<Pf2eCharacter, 'id' | 'createdAt'>>) {
  if (!session.user?.uid || !character.value) return
  try {
    await updatePf2eCharacter(session.user.uid, character.value.id, patch)
  } catch (e) {
    toast.error('Не удалось сохранить изменения: ' + errorText(e))
  }
}

async function saveSpells(spellLists: Pf2eSpellList[]) {
  await patchChar({ spellLists })
}

// Profile edit modal + portrait modal
const editing = ref(false)
const editForm = ref({ name: '', description: '', level: 1, strMod: 0 })
const editingPortrait = ref(false)
const portraitBusy = ref(false)

function openEdit() {
  if (!character.value) return
  editForm.value = {
    name: character.value.name,
    description: character.value.description,
    level: character.value.level,
    strMod: character.value.strMod,
  }
  editing.value = true
}

async function submitEdit() {
  if (!editForm.value.name.trim()) return
  await patchChar({
    name: editForm.value.name.trim(),
    description: editForm.value.description.trim(),
    level: Math.min(20, Math.max(1, Math.round(Number(editForm.value.level) || 1))),
    strMod: Math.min(12, Math.max(-5, Math.round(Number(editForm.value.strMod) || 0))),
  })
  editing.value = false
  toast.success('Персонаж обновлён')
}

function onPortraitClick() {
  if (!character.value) return
  const src = character.value.portraitSource || character.value.portrait
  if (src) openLightbox([{ src, caption: character.value.name }])
  else editingPortrait.value = true
}

async function onPortraitSave(payload: ImageSavePayload) {
  if (!character.value) return
  portraitBusy.value = true
  try {
    const source = payload.file ? await fileToSource(payload.file) : (character.value.portraitSource || character.value.portrait)
    if (!source) return
    const portrait = await renderAvatar(source, payload.crop, 192)
    await patchChar({ portrait, portraitSource: source, portraitCrop: payload.crop })
    toast.success('Портрет обновлён')
    editingPortrait.value = false
  } catch (err: any) { toast.error(err?.message ?? String(err)) }
  finally { portraitBusy.value = false }
}

async function onPortraitRemove() {
  portraitBusy.value = true
  try {
    await patchChar({ portrait: null, portraitSource: null, portraitCrop: null })
    editingPortrait.value = false
  } finally { portraitBusy.value = false }
}

async function removeChar() {
  if (!session.user?.uid || !character.value) return
  if (!confirm(`Удалить персонажа «${character.value.name}»?`)) return
  try {
    await deletePf2eCharacter(session.user.uid, character.value.id)
    toast.success('Персонаж удалён')
    void router.push({ name: 'toolPf2e' })
  } catch (e) { toast.error('Не удалось удалить: ' + errorText(e)) }
}

const totalSpells = computed(() => character.value?.spellLists.reduce((s, l) => s + l.spells.length, 0) ?? 0)
</script>

<template>
  <div class="page">
    <Pf2eTopNav active="chars" :current-char="character" />

    <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
    <div v-else-if="!character" class="card empty">
      <p>Персонаж не найден.</p>
      <RouterLink class="btn btn-primary" :to="{ name: 'toolPf2e' }">К списку персонажей</RouterLink>
    </div>

    <template v-else>
      <!-- Character Header Card -->
      <section class="card card-pad char-head">
        <div class="ch-ava-wrap">
          <button type="button" class="ch-ava" :class="{ zoomable: !!character.portrait }" :title="character.portrait ? 'Открыть портрет' : 'Добавить портрет'" @click="onPortraitClick">
            <img v-if="character.portrait" :src="character.portrait" alt="" />
            <Icon v-else name="user" :size="36" />
          </button>
          <button type="button" class="ch-crop" :title="character.portrait ? 'Изменить портрет и фокус' : 'Добавить портрет'" @click="editingPortrait = true">
            <Icon name="pencil" :size="13" />
          </button>
        </div>

        <div class="grow" style="min-width: 0">
          <div class="row gap-sm wrap" style="align-items: baseline">
            <h1 class="ch-name">{{ character.name }}</h1>
            <span class="badge">Уровень {{ character.level }}</span>
            <span class="badge">СИЛ {{ character.strMod >= 0 ? `+${character.strMod}` : character.strMod }}</span>
          </div>
          <p v-if="character.description" class="muted ch-desc">{{ character.description }}</p>
          <p v-else class="faint small" style="margin: 4px 0 0">Нет описания — нажмите «Изменить», чтобы добавить заметки о персонаже.</p>
        </div>

        <div class="row gap-sm wrap" style="align-self: flex-start">
          <button type="button" class="btn btn-sm" @click="openEdit"><Icon name="pencil" :size="14" /> Изменить</button>
          <button type="button" class="btn btn-sm" title="Экспорт в JSON" @click="exportPf2eCharacters([character], `pf2e-${character.name}.json`)"><Icon name="download" :size="14" /></button>
          <button type="button" class="btn btn-sm btn-danger" title="Удалить персонажа" @click="removeChar"><Icon name="trash2" :size="14" /></button>
        </div>
      </section>

      <!-- Main Character Tabs -->
      <div class="tabs" style="margin-top: 16px">
        <button type="button" class="tab" :class="{ on: tab === 'spells' }" @click="setTab('spells')">
          <Icon name="sparkles" :size="16" /> Заклинания
          <span class="count">{{ totalSpells }}</span>
        </button>
        <button type="button" class="tab" :class="{ on: tab === 'inventory' }" @click="setTab('inventory')">
          <Icon name="backpack" :size="16" /> Инвентарь и контейнеры
          <span class="count">{{ character.inventory.length }}</span>
        </button>
      </div>

      <Pf2eCharSpells v-if="tab === 'spells'" :character="character" @save="saveSpells" />
      <Pf2eCharInventory v-else :character="character" @patch="patchChar" />

      <!-- Edit Profile Modal -->
      <Modal v-if="editing" title="Профиль персонажа" width="520px" @close="editing = false">
        <form class="stack" @submit.prevent="submitEdit">
          <label class="field"><span>Имя *</span><input v-model="editForm.name" type="text" class="input" maxlength="80" autofocus /></label>
          <div class="row gap">
            <label class="field grow"><span>Уровень (1–20)</span><input v-model.number="editForm.level" type="number" min="1" max="20" class="input" /></label>
            <label class="field grow"><span>Модификатор Силы</span><input v-model.number="editForm.strMod" type="number" min="-5" max="10" class="input" /></label>
          </div>
          <label class="field"><span>Описание</span><textarea v-model="editForm.description" class="input" rows="4" maxlength="2000" /></label>
          <div class="row gap-sm">
            <button type="button" class="btn btn-sm" @click="editingPortrait = true"><Icon name="image" :size="13" /> {{ character.portrait ? 'Настроить портрет' : 'Загрузить портрет' }}</button>
          </div>
          <div class="row gap-sm" style="justify-content: flex-end">
            <button type="button" class="btn" @click="editing = false">Отмена</button>
            <button type="submit" class="btn btn-primary" :disabled="!editForm.name.trim()"><Icon name="check" :size="14" /> Сохранить</button>
          </div>
        </form>
      </Modal>

      <ImageModal
        v-if="editingPortrait"
        title="Портрет персонажа"
        :src="character.portraitSource || character.portrait"
        :has-image="!!character.portrait"
        :initial-crop="character.portraitCrop ?? null"
        kind="portrait"
        :allow-gallery="false"
        :allow-url="false"
        :allow-delete="!!character.portrait"
        remove-label="Убрать портрет"
        :busy="portraitBusy"
        @save="onPortraitSave"
        @remove="onPortraitRemove"
        @close="editingPortrait = false"
      />
    </template>
  </div>
</template>

<style scoped>
.page { max-width: 1320px; margin: 0 auto; padding: 18px 24px 60px; }
.crumbs-row { margin-bottom: 10px; font-size: 13.5px; }
.back-link { color: var(--text-muted); }
.back-link:hover { color: var(--accent); text-decoration: none; }

.char-head { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.ch-ava-wrap { position: relative; flex-shrink: 0; }
.ch-ava {
  width: 86px; height: 86px; border-radius: 16px; overflow: hidden; padding: 0; cursor: pointer;
  border: 2px solid var(--border-strong); background: var(--surface-3); color: var(--text-faint);
  display: flex; align-items: center; justify-content: center;
}
.ch-ava:hover { border-color: var(--accent); }
.ch-ava.zoomable { cursor: zoom-in; }
.ch-ava img { width: 100%; height: 100%; object-fit: cover; }
.ch-crop {
  position: absolute; right: -6px; bottom: -6px; width: 26px; height: 26px; border-radius: 50%;
  border: 2px solid var(--surface); background: var(--accent); color: var(--accent-fg);
  display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
}
.ch-name { font-size: 32px; margin: 0; line-height: 1.1; }
.ch-desc { margin: 6px 0 0; white-space: pre-wrap; max-width: 780px; }

@media (max-width: 720px) {
  .page { padding: 14px 12px 50px; }
  .ch-name { font-size: 26px; }
  .ch-ava { width: 68px; height: 68px; }
}
</style>
