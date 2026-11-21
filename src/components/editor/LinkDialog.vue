<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import { useWorld } from '@/stores/world'
import { quickSearch } from '@/data/search'
import { typeDef } from '@/model/entityTypes'

const props = defineProps<{ href?: string; text?: string }>()
const emit = defineEmits<{ close: []; link: [href: string]; entity: [id: string, name: string] }>()
const world = useWorld()
const href = ref(props.href ?? '')
const q = ref(props.text ?? '')
const found = computed(() => quickSearch(world.list, q.value, 8))
function submit() {
  let h = href.value.trim()
  if (h && !/^(https?:|mailto:|#|\/)/.test(h)) h = 'https://' + h
  emit('link', h)
  emit('close')
}
</script>

<template>
  <Modal title="Ссылка" width="520px" @close="emit('close')">
    <form class="stack" @submit.prevent="submit">
      <label class="field"><span>Внешний адрес</span><input v-model="href" class="input" placeholder="https://…" autofocus /></label>
      <div class="row gap"><button class="btn btn-primary">{{ href ? 'Применить' : 'Убрать ссылку' }}</button></div>
    </form>
    <div class="divider-text">или ссылка на статью мира</div>
    <input v-model="q" class="input" placeholder="Название статьи…" />
    <div class="pick-list">
      <button v-for="e in found" :key="e.id" type="button" class="pick-row" @click="emit('entity', e.id, e.name); emit('close')">
        <Icon :name="typeDef(e.type).icon" :size="15" :style="{ color: typeDef(e.type).color }" />
        <span>{{ e.name }}</span><span class="muted">{{ e.kind || typeDef(e.type).label }}</span>
      </button>
    </div>
  </Modal>
</template>
