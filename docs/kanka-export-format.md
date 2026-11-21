# Формат экспорта Kanka (ZIP JSON) — справка для импортёра

Источник: исходники owlchester/kanka (ветка develop, 2026-11-20) — `app/Services/Campaign/ExportService.php`,
`app/Models/Entity.php::export()`, импортёр `app/Services/Campaign/Import/**`.

## Структура ZIP
- `info.json`, `campaign.json`, `settings/modules.json`, `settings/custom-modules.json`
- `{module}/{slug}_{entityId}.json` — по файлу на сущность (module во мн. числе: characters, locations, families,
  organisations, items, notes, events, calendars, races, creatures, quests, journals, abilities, maps, timelines, tags).
  Старые экспорты: `{module}/{slug}.json`. Имя файла не надёжно — id брать из `entity.id`.
- Кастомные модули: `{camelCase plural}_{typeId}/{slug}_{entityId}.json` (только `{"entity":{...}}`).
- `gallery/{uuid}.json` (метаданные) + `gallery/{uuid}.{ext}` (файл). Папки (`is_folder`) без файла.
- Легаси-картинки: по пути `entity.image_path` / `header_image` / `assets[].metadata.path` прямо в ZIP.
- Не экспортируются: conversations, dice_rolls, attribute_templates, bookmarks, семейные деревья, права.

## Запись
`{ <поля модуля>, "entity": {...}, <массивы> }`. Верхний `id` — id модуля (= `entity.entity_id`), `entity.id` — глобальный.
- По entity id: упоминания в тексте, `relationships.owner_id/target_id`, `entity.parent_id`, `journal.author_id`,
  `quest.instigator_id`, `itemCreators.creator_id`, `markers[].entity_id`, `elements[].entity_id`, `participants[].entity_id`.
- По child id: `entityTags[].tag_id`, `abilities[].ability_id`, `inventories[].item_id`, `entityLocations[].location_id`,
  `reminders[].calendar_id`, `map.location_id`, `timeline.calendar_id`, `characterFamilies.family_id`,
  `characterRaces.race_id`, `members[].character_id/organisation_id`, `pivotMembers.*`.
  → первым проходом строить карту (module, childId) → entityId.

entity: `id, entity_id, parent_id(entity id), type_id, name, type(подтип), entry(html), is_private, tooltip, is_template,
image_path, image_uuid, header_image, header_uuid, status_id, entityTags[{tag_id}], relationships[{id,owner_id,target_id,
relation,visibility_id,mirror_id,attitude,is_pinned,colour}], posts[{id,name,entry,visibility_id,position,...}],
abilities[{ability_id,visibility_id,charges,position,note}], reminders[{calendar_id,length,comment,is_recurring,
recurring_until,recurring_periodicity,colour,day,month,year,type_id,visibility_id}] (старые: entity.events),
entityAttributes[{type_id,name,value,is_private,default_order,is_pinned,is_hidden}], assets[{type_id(1 файл,2 ссылка,
3 алиас),name,metadata:{url|path},visibility_id,image_uuid}], inventories[{item_id,name,amount,position(группа),
description,visibility_id,is_equipped}], entityLocations[{location_id}]`.

type_id: 1 character, 2 family, 3 location, 4 organisation, 5 item, 6 note, 7 event, 8 calendar, 9 race, 10 quest,
11 journal, 12 tag, 16 ability, 17 map, 18 timeline, 20 creature.
status_id: 3 персонаж мёртв; 4 существо мертво, 5 вымерло; 7 раса вымерла; 10 квест завершён; 13 организация распущена.
Старые экспорты: булевы `is_dead`, `is_completed`, `is_extinct`, `is_defunct` на записи модуля; родитель на записи модуля
(child id): `location_id`/`parent_location_id`, `organisation_id`, `family_id`, `item_id`, `note_id`, … ; `name/type/entry`
на записи модуля; локация персонажа `location_id`, предмета `character_id/location_id`, `pivotLocations`.
attributes.type_id: 1 обычный, 2 многострочный, 3 флажок, 4 раздел, 5 случайный, 6 число, 7 список.
reminders.type_id: null событие, 2 рождение, 3 смерть, 4 дата квеста/журнала, 5 основание.

Поля модулей: abilities charges; characters title, age, sex, pronouns + characterTraits[{name,entry,section_id(1 внешн,
2 личн)}], characterFamilies[{family_id}], characterRaces[{race_id}]; events date; items price,size,weight,itemCreators;
journals author_id,date; locations title; maps location_id,grid,height,width,min/max/initial_zoom,center_x,center_y,
is_real + layers[{image_uuid,image_path,name,entry,position,visibility_id,type_id}], groups[{id,name,position,is_shown,
visibility_id}], markers[{entity_id,group_id,name,entry,latitude,longitude,shape_id(1 маркер,2 подпись,3 круг,5 полигон,
6 путь),icon,circle_radius,colour,font_colour,opacity,custom_shape("lat,lng lat,lng"),visibility_id,is_draggable}];
organisations members[{character_id,organisation_id,role,status_id(0 акт,1 неакт,2 неизв),pin_id}]; quests instigator_id,
date, elements[{entity_id,name,role,entry,colour,visibility_id}]; tags colour(hex без #),is_auto_applied,is_hidden;
timelines calendar_id, eras[{id,name,abbreviation,entry,start_year,end_year,is_collapsed,position}],
elements[{era_id,entity_id,name,entry,date,position,colour,icon,visibility_id,is_collapsed}].
Карта: базовая картинка — картинка сущности карты; координаты в пикселях изображения, bounds [[0,0],[height,width]].

Календарь (поля могут быть JSON-строками в старых экспортах): `date "Y-M-D"`, `months[{name,length,type}]`,
`weekdays[]`, `years{год:имя}`, `seasons[{name,month,day}]`, `moons[{name,fullmoon,offset,colour}]`, `suffix`,
`has_leap_year, leap_year_amount, leap_year_month, leap_year_offset, leap_year_start`, `calendarWeather[]`.

## Текст
Упоминания: `[character:812]`, `[location:77|Свой текст]`, опции после `|` (page:, anchor:, field:, alias: …).
Регулярка: `\[([a-z_-]+):(.*?)\]`; число — entity id. Картинки: `<img src="https://…/{uuid}.{ext}" data-gallery-id="{uuid}">`
→ брать `gallery/{uuid}.*`. Без data-gallery-id — внешние ссылки.

## Видимость
visibility_id: 1 все, 2 админ, 3 админ+автор, 4 только автор, 5 участники. `entity.is_private` = только админы.
Булевы бывают 0/1. Пустые словари — `[]`.
