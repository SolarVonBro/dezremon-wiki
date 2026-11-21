# Схема базы данных

База — Cloud Firestore (Google Cloud, Firebase-проект на бесплатном тарифе Spark). Документная БД, но данные
разложены нормализованно: каждая сущность и каждая связь — отдельный документ со ссылками по id.

```
users/{uid}                                  профиль пользователя (имя, почта, аватар)
worlds/{wid}                                 мир (сеттинг): название, описание, владелец, isPublic, settings, aclVersion
 ├─ members/{uid}                            участник: роль owner | master | player, имя, избранное
 ├─ invites/{code}                           ссылка-приглашение: роль, срок действия
 ├─ entities/{eid}                           статья любого типа (см. ниже)
 ├─ bodies/{eid}          1:1 с entities     читаемый HTML статьи (без секретных блоков мастера)
 ├─ secrets/{eid}         1:1, только мастер полный HTML с секретами, приватные атрибуты, заметки мастера
 ├─ revisions/{rid}       N:1 → entities     снимки текста (история версий)
 ├─ posts/{pid}           N:1 → entities     дополнительные разделы статьи со своей видимостью
 ├─ relations/{rid}       N:M entities       связи между статьями (label/reverseLabel, тип, отношение −100…100)
 ├─ orgMembers/{id}       N:M org × character участие в организации (роль, статус)
 ├─ inventory/{id}        N:1 → entities     строки инвентаря (ссылка на предмет или свободное название)
 ├─ entityAbilities/{id}  N:M entity × ability способности с зарядами
 ├─ questElements/{id}    N:1 → quest        участники/этапы квеста
 ├─ reminders/{id}        N:1 → calendar     события календаря и даты статей (рождение, смерть…), повторы
 ├─ timelineEras/{id}     N:1 → timeline     эпохи хронологии
 ├─ timelineElements/{id} N:1 → timeline     события хронологии (могут ссылаться на статью и эпоху)
 ├─ mapLayers/{id}        N:1 → map          слои карты
 ├─ mapGroups/{id}        N:1 → map          группы меток
 ├─ mapMarkers/{id}       N:1 → map          метки: точка, подпись, круг, многоугольник; ссылка на статью
 ├─ messages/{id}         N:1 → conversation реплики разговора
 ├─ bookmarks/{id}                           закладки в боковом меню
 ├─ images/{iid}                             метаданные изображения + миниатюра (галерея)
 └─ imageChunks/{iid}_{n} N:1 → images       байты изображения кусками ≤ 900 КБ (в Spark нет Cloud Storage)

campaigns/{cid}                              кампейн: живёт РЯДОМ с миром; worldId/worldName — в каком мире идёт игра
 │                                           (в модели может быть null — кампейн можно будет отвязать), ownerId,
 │                                           gmUids/memberUids (зеркало участников для правил и запроса «мои кампейны»),
 │                                           статус, расписание, nextSessionAt, cover (маленькая картинка data: URL)
 ├─ participants/{uid}                       участник кампейна: роль gm | player, персонаж (characterId в мире + имя)
 │                                           (не «members»: collection group members = членство в мирах)
 ├─ sessions/{sid}                           журнал: номер, название, дата, planned | done, HTML (без картинок)
 └─ invites/{code}                           приглашение; worldInviteCode — заодно приглашение в мир кампейна

rooms/{rid}                                  музыкальная комната (как Watch2Gether): ownerId, hostUids, memberUids
 │                                           («мои комнаты»), campaignId (необязательная привязка к кампейну),
 │                                           access link | campaign, controlMode hosts | everyone
 ├─ tracks/{tid}                             синхронный плеер YouTube: main — основная музыка (всегда идёт по плейлисту,
 │                                           playlistId), layer — доп. дорожки (своя маленькая queue[] или плейлист);
 │                                           current, playing, position@at (серверное время), volume, loop
 ├─ playlists/{pid}                          плейлисты комнаты; «main» = «Основной» создаётся с комнатой; музыка идёт
 │                                           по плейлисту напрямую (track.playlistId), отдельной очереди нет
 ├─ listeners/{uid}                          присутствие (пульс раз в минуту) + замер сдвига часов клиента
 └─ messages/{mid}                           чат комнаты

serviceBans/{uid}                            блокировка аккаунта администратором сервиса
service/config                               настройки сервиса (ключ YouTube Data API для поиска в комнатах)
usage/{wid | service}                        замеры объёма: по миру и служебных данных (админка → Ресурсы)
```

Администраторы сервиса заданы по uid в `firestore.rules` (`isAdmin()`) и `src/data/admin.ts` — списки держать
одинаковыми. Администратор в любом мире действует как владелец (видит всё, может удалить) и видит всех пользователей,
миры, кампейны и комнаты в админке (`/admin`).

## Статья (`entities`)

Общие поля всех типов: `type`, `name`, `kind` (подтип: «город», «гильдия»), `parentId` (иерархия внутри типа),
`imageId`, `headerImageId`, `tagIds[]` (ссылки на статьи-теги), `aliases[]`, `attributes[]` (произвольные
характеристики), `links[]`, `excerpt`/`tooltip` (для всплывающих карточек), `mentions[]` (на какие статьи ссылается
текст — из этого строятся обратные ссылки), `isTemplate`, `deleted`/`deletedAt` (корзина), `bodyRev`, `hasSecrets`.

Поля конкретного типа лежат в `fields` и описаны в `src/model/entityTypes.ts`. Ссылочные поля (`locationId`,
`raceIds`, `familyIds`, `ownerId`, `giverId`, …) хранят id других статей. Встроенные типы: персонаж, локация, семья,
организация, предмет, заметка, событие, календарь, раса, существо, квест, журнал, способность, карта, хронология,
тег, разговор, бросок кубов, шаблон атрибутов; мастер может добавить свои типы (`settings.customTypes`).

## Видимость и права

У каждой читаемой записи есть `visibility` (`public` | `members` | `master` | `custom`), `allowedUids[]` и
`createdBy`. Правила (`firestore.rules`) проверяют их на сервере:

- мастер/владелец видит и правит всё;
- игрок видит `public`, `members`, записи, где он в `allowedUids`, и свои; правит свои статьи и те, где он в `editorUids`;
- гость (без входа) видит только `public` и только если мир открыт (`isPublic`).

Секретные блоки текста (`<div data-secret>`) мастера хранятся только в `secrets/{eid}`; в `bodies/{eid}` попадает
копия без них — поэтому игроки не могут получить секрет даже через API.

## Синхронизация и квоты

`entities`, `relations` и `images` синхронизируются в браузер дельтами по `updatedAt` и кэшируются в IndexedDB —
повторное открытие сайта почти не тратит чтений. Остальные коллекции загружаются по требованию. При сужении
видимости мастер увеличивает `worlds/{wid}.aclVersion`, и клиенты игроков делают полную пересинхронизацию.

## Бэкап

- Кнопка «Скачать всё» (Настройки → Бэкап): ZIP с `manifest.json`, `world.json`, `data/<коллекция>.json`,
  `images/<id>.<ext>` и читаемой офлайн-копией `html/`. Тот же ZIP восстанавливается в новый мир или поверх текущего.
- Ежесуточно GitHub Actions выгружает все миры в приватный репозиторий (`backup-runner/`).
