<script setup lang="ts">
const logo = import.meta.env.BASE_URL + 'favicon.svg'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { createWorld, myWorlds } from '@/stores/world'
import { relativeTime } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import UserMenu from '@/components/layout/UserMenu.vue'
import { toast } from '@/components/common/toast'
import type { Role, World } from '@/model/types'

const session = useSession()
const router = useRouter()
const worlds = ref<Array<World & { role: Role }>>([])
const loading = ref(true)
const creating = ref(false)
const name = ref('')
const description = ref('')
const isPublic = ref(false)

watch(() => session.user, async (u) => {
  loading.value = true
  try { worlds.value = u ? await myWorlds(u.uid) : [] }
  catch (e: any) { toast.error('Не удалось загрузить миры: ' + (e?.message ?? e)) }
  finally { loading.value = false }
}, { immediate: true })

async function create() {
  if (!session.user || !name.value.trim()) return
  creating.value = true
  try {
    const id = await createWorld(session.user, name.value.trim(), description.value.trim(), isPublic.value)
    void router.push({ name: 'dashboard', params: { wid: id } })
  } catch (e: any) { toast.error('Не удалось создать мир: ' + (e?.message ?? e)) }
  finally { creating.value = false }
}
const ROLE: Record<Role, string> = { owner: 'Владелец', master: 'Мастер', player: 'Игрок' }
const FEATURES = [
  ['pencil', 'Редактор как в Word', 'Таблицы, шрифты, цвета, картинки в любом месте, режим HTML, автосохранение'],
  ['users', 'Персонажи и связи', 'Семьи, организации, родословные, граф отношений'],
  ['map', 'Карты с метками', 'Свои карты, слои, группы меток со ссылками на статьи'],
  ['calendar-days', 'Календари и хронологии', 'Свои месяцы, луны, високосные годы, эпохи и события'],
  ['lock', 'Секреты мастера', 'Скрытые блоки текста, статьи и атрибуты; доступ игрокам по выбору'],
  ['archive', 'Полный бэкап', 'Выгрузка всего мира в ZIP и восстановление; импорт из Kanka'],
]
</script>

<template>
  <div class="landing">
    <div class="landing-card stack" style="gap: 26px">
      <header class="row gap">
        <div class="brand grow"><img class="brand-mark" :src="logo" alt="" /> Вики сеттинга</div>
        <UserMenu v-if="session.user" />
        <RouterLink v-else class="btn btn-primary" to="/login"><Icon name="log-in" :size="16" /> Войти</RouterLink>
      </header>

      <template v-if="!session.ready || loading">
        <div class="empty"><Icon name="refresh-cw" class="spin" :size="26" /></div>
      </template>

      <template v-else-if="!session.user">
        <section class="card card-pad stack">
          <h1 style="font-size: 44px; margin: 0">Летопись вашего мира</h1>
          <p class="muted" style="font-size: 17px; max-width: 640px">Инструмент ворлдбилдинга для настольных ролевых игр: статьи о персонажах, локациях, фракциях и событиях, карты, календари, хронологии и связи — с удобным редактором и доступом для игроков.</p>
          <div><RouterLink class="btn btn-primary btn-lg" to="/login">Войти или зарегистрироваться</RouterLink></div>
        </section>
        <div class="dash-grid">
          <div v-for="f in FEATURES" :key="f[0]" class="card card-pad row gap" style="align-items: flex-start">
            <Icon :name="f[0]" :size="26" style="color: var(--accent)" />
            <div><b>{{ f[1] }}</b><div class="muted small">{{ f[2] }}</div></div>
          </div>
        </div>
      </template>

      <template v-else>
        <section>
          <h2 style="font-size: 30px">Мои миры</h2>
          <div class="world-tiles">
            <RouterLink v-for="w in worlds" :key="w.id" class="world-tile" :to="{ name: 'dashboard', params: { wid: w.id } }">
              <div class="world-tile-img"><Icon name="castle" :size="42" /></div>
              <div class="world-tile-body">
                <div class="world-tile-name">{{ w.name }}</div>
                <div class="muted small">{{ ROLE[w.role] }} · {{ w.isPublic ? 'открытый' : 'закрытый' }} · {{ relativeTime(w.updatedAt) }}</div>
              </div>
            </RouterLink>
            <p v-if="!worlds.length" class="muted">У вас пока нет миров. Создайте первый или попросите мастера прислать приглашение.</p>
          </div>
        </section>
        <section class="card card-pad">
          <h3 class="panel-title"><Icon name="plus" /> Новый мир</h3>
          <form class="stack" @submit.prevent="create">
            <label class="field"><span>Название</span><input v-model="name" class="input" placeholder="Дезремон" maxlength="120" /></label>
            <label class="field"><span>Короткое описание</span><textarea v-model="description" class="input" rows="2" placeholder="Мрачное фэнтези о…" /></label>
            <label class="check"><input v-model="isPublic" type="checkbox" /> Открытый мир: статьи с видимостью «всем» читаются без входа</label>
            <div><button class="btn btn-primary" :disabled="!name.trim() || creating">Создать мир</button></div>
          </form>
        </section>
      </template>
    </div>
  </div>
</template>
