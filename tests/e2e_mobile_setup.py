"""Mobile layout audit, step 1/3: fixture. Registers a fresh e2e-mobile-* account in a persistent browser profile
(<work_dir>/profile), creates the world "E2E мобильная …" and fills it through the app's own Pinia stores (long names,
avatar + cover, wide table, timeline, calendar, map, conversation, relations…). Ids go to <work_dir>/fixture.json.
Then: python tests/e2e_mobile.py <work_dir> <out_dir> [width]   — screenshots + automatic overflow checks
Finally:   python tests/e2e_mobile_setup.py <work_dir> --teardown   — deletes the world and the account.
Works against the live site or a local build (MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build && npx vite preview).
Usage: E2E_URL=<site url> python tests/e2e_mobile_setup.py <work_dir> [--teardown]"""
import os, sys, json, random, shutil
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
BASE = os.environ.get('E2E_URL', 'https://solarvonbro.github.io/dezremon-wiki/')
WORK = sys.argv[1]
TEARDOWN = '--teardown' in sys.argv
RUN = str(random.randint(10000, 99999))
EMAIL = f'e2e-mobile-{RUN}@example.com'

FIXTURE_JS = r"""
async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const world = pinia._s.get('world'), gallery = pinia._s.get('gallery')
  async function img(w, h, a, b, label) {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, w, h)
    x.fillStyle = '#fff'; x.font = `bold ${Math.round(h / 8)}px sans-serif`; x.fillText(label, w / 10, h / 2)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
    const [m] = await gallery.upload([new File([blob], label + '.jpg', { type: 'image/jpeg' })], { folder: 'E2E' })
    return m.id
  }
  const avatar = await img(600, 800, '#6b4f2a', '#1d2b3a', 'Аватар')
  const header = await img(1600, 500, '#2a4d6b', '#7a5d12', 'Обложка')
  const mapImg = await img(1200, 900, '#3f6b3a', '#a8c08a', 'Карта')
  const inline = await img(900, 500, '#5a2a6b', '#d4ad4a', 'Картинка')

  const tag = await world.createEntity('tag', '"Вторая Лавина"', { fields: { colour: '#3f9fb5' } })
  const tag2 = await world.createEntity('tag', 'Очень длинный тег про древнюю историю', {})
  const loc = await world.createEntity('location', 'Вельмор', { kind: 'Вольный город', imageId: avatar, headerImageId: header },
    '<p>Вольный город на побережье.</p>')
  const loc2 = await world.createEntity('location', 'Нижний квартал', { kind: 'Район', parentId: loc }, '<p>Трущобы.</p>')
  const race = await world.createEntity('race', 'Люди', {})
  const fam = await world.createEntity('family', 'Дом Геяль', { imageId: avatar })
  const org = await world.createEntity('organisation', 'Гильдия контрабандистов Северного побережья', { kind: 'Гильдия' })
  const longWord = await world.createEntity('character', 'Длинноимённыйперсонажбезединогопробела Второй', { imageId: avatar, fields: { title: 'Хранитель' } })
  const html = `
<h2>Биография</h2>
<p>Родился в <a class="mention" href="#e:${loc}" data-id="${loc}" data-label="Вельмор">Вельмор</a> и вырос среди контрабандистов.
Очень длинная ссылка: https://example.com/очень/длинный/путь/без/пробелов/который/не/должен/ломать/вёрстку/на/телефоне/совсем</p>
<h3>Юность</h3>
<p>${'Текст абзаца. '.repeat(40)}</p>
<table><tbody>
<tr><th>Сила</th><th>Ловкость</th><th>Телосложение</th><th>Интеллект</th><th>Мудрость</th><th>Харизма</th><th>Инициатива</th><th>Скорость</th></tr>
<tr><td>14</td><td>12</td><td>16</td><td>10</td><td>13</td><td>18</td><td>+1</td><td>30 футов</td></tr>
</tbody></table>
<blockquote><p>Цитата о герцоге, которая довольно длинная и должна переноситься нормально.</p></blockquote>
<pre><code>const veryLongLineOfCodeThatShouldScrollHorizontallyInsteadOfBreakingTheLayout = 'abcdefghijklmnopqrstuvwxyz0123456789'</code></pre>
<p><img data-image-id="${inline}" alt="Картинка"></p>
<ul><li>Первый пункт</li><li>Второй пункт с длинным текстом, который переносится на несколько строк на узком экране телефона</li></ul>
<h2>Секреты</h2>
<div data-secret="" class="secret-block"><p>Он тайный наследник.</p></div>
<h2>Итог</h2><p>Конец.</p>`
  const hero = await world.createEntity('character', 'Бранес Ам Геяль', {
    imageId: avatar, tagIds: [tag, tag2], aliases: ['Герцог Бранес', 'Лавинный'], parentId: null,
    fields: { title: 'герцог', age: '43', sex: 'мужской', locationId: loc, raceIds: [race], familyIds: [fam],
      appearance: [{ name: 'Глаза', value: 'серые' }, { name: 'Волосы', value: 'тёмные, длинные' }] },
    attributes: [
      { id: 'a1', name: 'Класс', value: 'Плут', kind: 'text', isPinned: true },
      { id: 'a2', name: 'Уровень', value: '7', kind: 'number', isPinned: true },
      { id: 'a3', name: 'Очень длинное название атрибута персонажа', value: 'Очень длинное значение атрибута, которое переносится', kind: 'text', isPinned: false },
    ],
    links: [{ id: 'l1', name: 'Лист персонажа', url: 'https://example.com/character-sheet/very-long-url-segment-0123456789' }],
  }, html)
  const wife = await world.createEntity('character', 'Илена Геяль', { imageId: avatar, fields: { title: 'герцогиня' } })
  const son = await world.createEntity('character', 'Тарен Геяль', {})
  await world.saveRelation({ sourceId: hero, targetId: wife, label: 'супруг', reverseLabel: 'супруга', kind: 'spouse', attitude: 2 })
  await world.saveRelation({ sourceId: hero, targetId: son, label: 'отец', reverseLabel: 'сын', kind: 'parent', attitude: 1 })
  await world.saveRelation({ sourceId: hero, targetId: org, label: 'тайный покровитель гильдии контрабандистов', attitude: -1 })
  await world.saveRow('posts', { entityId: hero, title: 'Дополнительный раздел', html: '<p>Текст раздела.</p>', position: 'after', order: 0, isCollapsed: false, deleted: false })
  await world.saveRow('inventory', { ownerId: hero, name: 'Меч с очень длинным названием из северной стали', amount: 1, group: 'Оружие', description: 'Острый', isEquipped: true, order: 0 })
  await world.saveRow('orgMembers', { organisationId: org, characterId: hero, role: 'Покровитель', status: 'active', isPinned: false, order: 0 })
  const item = await world.createEntity('item', 'Лавинный клинок', { imageId: inline, fields: { price: '500 зм', ownerId: hero } })
  const ability = await world.createEntity('ability', 'Теневой шаг', { fields: { charges: '3' } })
  await world.saveRow('entityAbilities', { entityId: hero, abilityId: ability, charges: 3, usedCharges: 1, note: '', order: 0 })
  const quest = await world.createEntity('quest', 'Найти пропавший груз', { fields: { giverId: hero } }, '<p>Квест.</p>')
  await world.saveRow('questElements', { questId: quest, entityId: hero, name: '', role: 'Квестодатель', html: '<p>Даёт задание.</p>', colour: '', order: 0 })
  const cal = await world.createEntity('calendar', 'Коллегианский календарь', {})
  await world.saveRow('reminders', { calendarId: cal, entityId: hero, name: 'День рождения Бранеса', year: 1, month: 1, day: 3, length: 1, colour: '', comment: '', kind: 'birth', isRecurring: true, recurPeriod: 'year', recurUntil: null })
  const tl = await world.createEntity('timeline', 'Хроника Дезремона', {})
  const era = await world.saveRow('timelineEras', { timelineId: tl, name: 'Эпоха Лавин', abbreviation: 'ЭЛ', startYear: 1, endYear: 300, html: '<p>Долгая эпоха.</p>', order: 0, isCollapsed: false })
  await world.saveRow('timelineElements', { timelineId: tl, eraId: era, entityId: hero, name: 'Рождение Бранеса Ам Геяля', date: '120', year: 120, html: '<p>Родился герцог.</p>', icon: '', colour: '', order: 0, isCollapsed: false })
  const map = await world.createEntity('map', 'Карта побережья', { fields: { mapImageId: mapImg } })
  const conv = await world.createEntity('conversation', 'Переговоры в таверне', { fields: { participantIds: [hero, wife] } })
  await world.saveRow('messages', { conversationId: conv, authorEntityId: hero, authorName: 'Бранес Ам Геяль', text: 'Длинная реплика в разговоре, чтобы проверить перенос строк на телефоне.', visibility: 'members', allowedUids: [] })
  const dice = await world.createEntity('dice_roll', 'Атака мечом', { fields: { formula: '1d20 + 5', characterId: hero } })
  const ev = await world.createEntity('event', 'Падение Вельмора', { fields: { date: '300 ЭЛ', locationId: loc } })
  const journal = await world.createEntity('journal', 'Сессия 1', { fields: { date: '01.01' } }, '<p>Журнал.</p>')
  const note = await world.createEntity('note', 'Заметка мастера', {}, '<p>Заметка.</p>')
  const creature = await world.createEntity('creature', 'Ледяной волк', {})
  await world.updateWorld({ isPublic: true })
  // wait for all pending writes
  for (let i = 0; i < 100 && world.pendingWrites > 0; i++) await new Promise((r) => setTimeout(r, 200))
  return { wid: world.wid, hero, wife, son, longWord, loc, loc2, org, fam, tag, item, ability, quest, cal, tl, map, conv, dice, ev, journal, note, creature, race, avatar }
}
"""

TEARDOWN_JS = r"""async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const world = pinia._s.get('world'), session = pinia._s.get('session')
  const email = session.user?.email
  if (!/^e2e-[a-z0-9-]+@example\.com$/.test(email || '')) return 'refusing: not an e2e account: ' + email
  await world.deleteWorld()
  await new Promise((r) => setTimeout(r, 3000))   // let the membership query see the deletion
  await session.deleteAccount('secret123')
  return 'deleted world and account ' + email
}"""

with sync_playwright() as p:
    if not TEARDOWN and os.path.exists(os.path.join(WORK, 'profile')):
        shutil.rmtree(os.path.join(WORK, 'profile'))
    ctx = p.chromium.launch_persistent_context(os.path.join(WORK, 'profile'), channel='chrome',
        viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    if TEARDOWN:
        fx = json.load(open(os.path.join(WORK, 'fixture.json'), encoding='utf-8'))
        pg.goto(BASE + '#/w/' + fx['wid'])
        pg.wait_for_selector('.dash-hero h1', timeout=60000); pg.wait_for_timeout(1500)
        name = pg.locator('.dash-hero h1').inner_text()
        assert name.startswith('E2E'), 'refusing to delete world ' + name
        print(pg.evaluate(TEARDOWN_JS))
        ctx.close()
        sys.exit(0)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(BASE + '#/login')
    pg.get_by_text('Регистрация', exact=True).last.click()
    pg.locator('input[autocomplete=nickname]').fill('Мобильный Мастер')
    pg.locator('input[type=email]').fill(EMAIL)
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Зарегистрироваться').click()
    pg.wait_for_selector('.world-grid, input[placeholder="Дезремон"]', timeout=30000)
    if not pg.locator('input[placeholder="Дезремон"]').count():
        pg.get_by_role('button', name='Новый мир').first.click()
    pg.locator('input[placeholder="Дезремон"]').fill('E2E мобильная ' + RUN)
    pg.get_by_role('button', name='Создать мир').click()
    pg.wait_for_selector('.dash-hero h1', timeout=30000)
    wid = pg.url.split('/w/')[1].split('/')[0]
    pg.goto(BASE + '#/w/' + wid + '/gallery')   # instantiates the gallery store used by the fixture
    pg.wait_for_timeout(2500)
    fx = pg.evaluate(FIXTURE_JS)
    fx['email'] = EMAIL
    json.dump(fx, open(os.path.join(WORK, 'fixture.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('WORLD', fx['wid'], 'ACCOUNT', EMAIL)
    print('ERRORS', errs[:20])
    ctx.close()
