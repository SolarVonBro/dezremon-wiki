# Заметки для разработки

Стек: Vue 3 (`<script setup lang="ts">`) + Pinia + vue-router (hash) + Vite, Firebase JS SDK (Firestore + Auth),
TipTap 3, Leaflet, d3-force, MiniSearch, JSZip, DOMPurify. Алиас `@/` → `src/`. Интерфейс на русском.

## Данные (Firestore)
Всё лежит в `worlds/{wid}/<collection>/{id}`. Типы — `src/model/types.ts`, типы сущностей и их поля — `src/model/entityTypes.ts`.

- `entities` — статьи (персонажи, локации, …). Тип в `type`, подтип в `kind`, иерархия `parentId`,
  поля типа в `fields` (см. entityTypes.ts), атрибуты `attributes[]`, теги `tagIds[]`, картинка `imageId`.
  Синхронизируются целиком в память: `useWorld().list / byType / get(id)`.
- `bodies/{entityId}` — читаемый HTML статьи; `secrets/{entityId}` — полный HTML мастера (с секретными блоками).
  Читать/писать только через `world.loadText(id)` / `world.saveText(id, html)`.
- `relations` — связи между статьями (тоже синхронизируются: `world.visibleRelations`, `world.relationsOf(id)`,
  `world.saveRelation(...)`, `world.deleteRelation(id)`). `kind`: 'generic' | 'parent' (source — родитель target) | 'spouse' | 'sibling'.
- Дочерние коллекции (грузятся по требованию): `posts, orgMembers, inventory, entityAbilities, questElements, reminders,
  timelineEras, timelineElements, mapLayers, mapGroups, mapMarkers, messages`. API:
  - `const stop = world.watchRows<T>(collection, field, value, rows => …, sortKey='order')` — живая подписка
    (учитывает права: для игроков сама делает несколько запросов). Вызывать `stop()` в `onBeforeUnmount`.
  - `world.fetchRows<T>(collection, field, value)` — разовое чтение.
  - `await world.saveRow(collection, data)` — создать (без `id`) или обновить (с `id`, merge). Ставит
    `createdAt/updatedAt/createdBy/visibility/allowedUids` для новых. Возвращает id.
  - `await world.deleteRow(collection, id)`.
- `images` (метаданные + миниатюра) и `imageChunks` (байты). Загрузка: `useGallery().upload(files, {folder})`
  или `uploadImage(world.access, file, {...})` из `@/data/images`. Показ: компонент `<Thumb :id variant="thumb|full" />`
  или `await imageUrl(world.access, id, 'full')` → blob URL.

Видимость любой записи: `visibility: 'public'|'members'|'master'|'custom'` + `allowedUids[]` + `createdBy`.
Компонент выбора — `src/components/common/VisibilitySelect.vue` (v-model: `{visibility, allowedUids}`).
Права: `world.isMaster`, `world.canEdit(entity)`, `world.isMember`, `world.uid`.

## Общие компоненты
- `Icon` (`@/components/common/Icon.vue`, `name` в kebab-case из `src/components/common/icons.ts`, напр. `map-pin`, `trash2`, `plus`).
- `Modal` (title, width, `@close`, слоты default/footer), `Dropdown` (слот `trigger` + содержимое, `keep-open`),
  `Thumb`, `toast` (`import { toast } from '@/components/common/toast'`: `toast.success/error/info`).
- `EntityPicker` (`@/components/common/EntityPicker.vue`): `v-model` = id | null, `types?: string[]`, `placeholder`.
- `EntityLink` (`@/components/common/EntityLink.vue`): `:id` — ссылка на статью с иконкой типа и подсказкой.
- `RichEditor` (`@/components/editor/RichEditor.vue`): `:model-value` (начальный HTML), `compact`, `min-height`,
  события `dirty`/`save-now`; через ref: `getHTML()`. `RichView` (`@/components/viewer/RichView.vue`): `:html`.
- Модули на странице статьи получают props `{ entity: Entity; editing: boolean }` (editing = режим правки и есть права).

## CSS
Глобальные классы в `src/styles/base.css` и `prose.css`: `btn btn-primary btn-ghost btn-sm btn-danger`, `icon-btn`,
`input input-sm`, `field` (label > span + input), `row gap stack grow muted small`, `card card-pad`, `chip on`,
`tag-chip`, `badge`, `tabs/tab on`, `menu/menu-item/menu-sep/menu-label`, `table`, `empty`, `panel-title`,
`section-title`, `avatar`. Цвета только через переменные: `--bg --surface --surface-2 --surface-3 --border
--border-strong --text --text-muted --text-faint --accent --accent-fg --accent-soft --danger --success --warning --info
--secret`. Шрифты: `--font-ui`, `--font-text`, `--font-head`, `--font-mono`. Свои стили — в `<style scoped>`.
Темы: тёмная/светлая/пергамент — не хардкодить цвета фона/текста.

## Проверка
`npx vue-tsc -b` (типы), `npm run build`. Эмулятор Firebase: `npm run emulators` + `VITE_EMULATOR=1 npm run dev`.
