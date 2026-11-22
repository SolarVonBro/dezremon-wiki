"""Overview page builder + the one top bar (AppBar) + the «Обзор» sidebar highlight. EMULATORS ONLY:
   firebase emulators (firestore, auth, project demo-dezremon) + `vite build --mode emulator` served on 4174.
   python tests/e2e_dashboard.py <screenshots dir>"""
import sys, os, json, random, re, time, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-dashboard'
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
EMAIL = f'dash{RUN}@example.com'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'


def rest(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read() or b'{}')


rest('POST', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts',
     {'email': EMAIL, 'password': 'secret123', 'displayName': 'Мастер Обзора'})

FAILS = []


def check(cond, what):
    print('ok  ' if cond else 'FAIL', what, flush=True)
    if not cond: FAILS.append(what)


SEED = r"""async () => {
  const world = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('world')
  const ids = []
  for (const [type, name] of [['character', 'Арвен Тихая'], ['character', 'Борис Гром'], ['location', 'Вельмор'], ['location', 'Серые холмы'], ['organization', 'Орден Пепла']])
    ids.push(await world.createEntity(type, name, {}))
  for (let i = 0; i < 50 && world.pendingWrites > 0; i++) await new Promise((r) => setTimeout(r, 200))
  return ids
}"""
BLOCKS = """() => [...document.querySelectorAll('.db-grid > [data-block]')].map((b) => ({ id: b.dataset.blockId, w: Number(b.style.getPropertyValue('--w')), h: b.style.height,
  title: b.querySelector('.db-eb-title')?.innerText ?? '', x: Math.round(b.getBoundingClientRect().left), width: Math.round(b.getBoundingClientRect().width) }))"""
OVERFLOW = "() => document.documentElement.scrollWidth - window.innerWidth"


def saved_layout(wid):
    d = rest('GET', f'{FS}/worlds/{wid}')
    dash = d['fields']['settings']['mapValue']['fields'].get('dashboard', {}).get('mapValue', {}).get('fields')
    if not dash: return None
    return [{k: (v.get('stringValue') or v.get('integerValue') or v.get('booleanValue')) for k, v in b['mapValue']['fields'].items()}
            for b in dash['blocks']['arrayValue'].get('values', [])]


def drag(pg, handle, dx, dy, steps=14):
    box = handle.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    pg.mouse.move(x, y); pg.mouse.down()
    pg.mouse.move(x + dx, y + dy, steps=steps)
    pg.mouse.up(); pg.wait_for_timeout(400)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_context(viewport={'width': 1440, 'height': 960}).new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:400]))

    print('== the top bar on the hub level')
    pg.goto(BASE + '#/login')
    pg.locator('input[type=email]').fill(EMAIL); pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Войти', exact=True).click()
    pg.wait_for_url('**/#/worlds**', timeout=20000)
    check(pg.locator('.app-bar .app-nav a.on', has_text='Миры').count() == 1, 'after sign-in: «Миры» page, the section is lit in the bar')
    check(pg.locator('.app-bar .app-nav a', has_text='Кампейны').count() == 1 and pg.locator('.app-bar .app-nav a', has_text='Комнаты').count() == 1, 'bar: Кампейны and Комнаты')
    check(pg.locator('.app-bar .user-btn').count() == 1, 'portrait at the right of the bar')
    pg.get_by_role('button', name='Новый мир').first.click()
    pg.locator('input[placeholder="Дезремон"]').fill('Обзорный мир ' + RUN)
    pg.get_by_role('button', name='Создать мир').click()
    pg.wait_for_selector('.db-grid', timeout=20000)
    wid = pg.url.split('/w/')[1].split('/')[0].split('?')[0]

    print('== the same bar inside a world')
    check(pg.locator('.app-bar .app-nav a', has_text='Кампейны').count() == 1, 'inside a world the bar still has Кампейны')
    check(pg.locator('.app-bar .app-nav a.on', has_text='Миры').count() == 1, 'inside a world «Миры» is the lit section')
    check(pg.locator('.app-bar #crumbs').count() == 1 and 'Обзор' in pg.locator('#crumbs').inner_text(), 'breadcrumbs live in the bar')
    check(pg.locator('.topbar').count() == 1, 'one top bar, not two')
    pg.screenshot(path=os.path.join(OUT, 'd-1-world.png'))
    pg.locator('.app-bar .app-nav a', has_text='Кампейны').click(); pg.wait_for_url('**/#/campaigns**', timeout=10000)
    check(pg.locator('.app-bar .app-nav a.on', has_text='Кампейны').count() == 1, 'Кампейны opens from inside a world in one click')
    pg.go_back(); pg.wait_for_selector('.db-grid', timeout=20000)
    eids = pg.evaluate(SEED)

    print('== «Обзор» in the sidebar is lit only on the overview')
    ov = pg.locator('.sidebar .sb-link', has_text='Обзор')
    check('active' in (ov.get_attribute('class') or ''), 'on the overview: «Обзор» lit')
    for name, url in [('gallery', f'#/w/{wid}/gallery'), ('list', f'#/w/{wid}/t/character'), ('entity', f'#/w/{wid}/e/{eids[0]}'), ('graph', f'#/w/{wid}/graph')]:
        pg.goto(BASE + url); pg.wait_for_timeout(900)
        cls = ov.get_attribute('class') or ''
        bg = ov.evaluate('(e) => getComputedStyle(e).backgroundColor')
        check('active' not in cls and bg in ('rgba(0, 0, 0, 0)', 'transparent'), f'on {name}: «Обзор» not lit ({cls!r}, {bg})')
    check('active' in (pg.locator('.sidebar .sb-link', has_text='Граф связей').get_attribute('class') or ''), 'the current page is lit instead')

    print('== the standard overview')
    pg.goto(BASE + f'#/w/{wid}'); pg.wait_for_selector('.db-grid [data-block]', timeout=20000); pg.wait_for_timeout(600)
    titles = pg.locator('.db-grid .panel-title').all_inner_texts()
    check(any('Последние изменения' in t for t in titles), f'standard blocks shown ({titles})')
    check(pg.locator('.dash-hero h1', has_text='Обзорный мир').count() == 1, 'hero with the world name')

    print('== edit mode: add a text block')
    pg.get_by_role('button', name='Настроить обзор').first.click()
    pg.wait_for_selector('.db-toolbar', timeout=5000)
    n0 = len(pg.evaluate(BLOCKS))
    check(n0 >= 5 and pg.locator('.db-edit-bar').count() == n0, f'every block has edit controls ({n0})')
    pg.locator('.db-toolbar').get_by_role('button', name='Блок').click()
    pg.locator('.dba-item:has(b:text-is("Текст"))').click()
    pg.wait_for_selector('.modal .ProseMirror', timeout=15000)
    pg.locator('.modal .ProseMirror').click()
    pg.keyboard.type('Добро пожаловать в Вельмор! Сессии по пятницам.')
    pg.locator('.modal input[placeholder="Текст"]').fill('Приветствие')
    pg.locator('.modal').get_by_role('button', name='½').click()
    pg.locator('.modal').get_by_role('button', name='Готово').click()
    pg.wait_for_selector('.dbv-text .prose:has-text("Добро пожаловать")', timeout=5000)
    bl = pg.evaluate(BLOCKS)
    check(len(bl) == n0 + 1 and bl[-1]['w'] == 6 and bl[-1]['title'] == 'Приветствие', f'text block added at the end, half width ({bl[-1]})')

    print('== quick links')
    pg.locator('.db-add-tile').click()
    pg.locator('.dba-item', has_text='Быстрые ссылки').click()
    try:
        pg.wait_for_selector('.modal', timeout=5000)
    except Exception:
        pg.screenshot(path=os.path.join(OUT, 'FAIL-links.png'), full_page=True); print('errors:', errs); raise
    pg.locator('.modal').get_by_role('button', name='+ Внешняя ссылка').click()
    pg.locator('.modal input[placeholder="Подпись"]').fill('Discord стола')
    pg.locator('.modal input[placeholder="https://…"]').fill('discord.gg/velmor')
    pg.locator('.modal').get_by_role('button', name='+ Внешняя ссылка').click()
    pg.locator('.modal input[placeholder="https://…"]').nth(1).fill('javascript:alert(1)')
    check(pg.locator('.modal').get_by_text('Неверные не сохранятся').count() == 1, 'a javascript: link is flagged')
    pg.locator('.modal').get_by_role('button', name='Готово').click()
    pg.wait_for_selector('.dbv-links a.dbv-link', timeout=5000)
    href = pg.locator('.dbv-links a.dbv-link').first.get_attribute('href')
    check(href == 'https://discord.gg/velmor' and pg.locator('.dbv-links a.dbv-link').count() == 1, f'only the web link kept, scheme added ({href})')

    print('== resize with the mouse')
    bl = pg.evaluate(BLOCKS)
    i_links = len(bl) - 1
    blk = pg.locator('.db-grid > [data-block]').nth(i_links)
    w0 = bl[i_links]['w']
    col = (pg.locator('.db-grid').bounding_box()['width']) / 12
    drag(pg, blk.locator('.db-rs-x'), col * 2.1, 0)
    w1 = pg.evaluate(BLOCKS)[i_links]['w']
    check(w1 == w0 + 2, f'dragging the right edge widened the block by two columns ({w0} -> {w1})')
    h_before = blk.bounding_box()['height']
    drag(pg, blk.locator('.db-rs-y'), 0, 150)
    h1 = pg.evaluate(BLOCKS)[i_links]['h']
    check(h1.endswith('px') and int(h1[:-2]) % 20 == 0 and int(h1[:-2]) >= h_before + 100, f'dragging the bottom edge set a fixed height snapped to 20 px ({h_before} -> {h1})')
    blk.locator('.db-rs-y').dblclick(); pg.wait_for_timeout(300)
    check(pg.evaluate(BLOCKS)[i_links]['h'] == '', 'double click on the bottom edge: back to content height')

    print('== move with the mouse')
    bl = pg.evaluate(BLOCKS)
    text_id = bl[-2]['id']
    first = pg.locator('.db-grid > [data-block]').nth(0).bounding_box()
    grip = pg.locator(f'[data-block-id="{text_id}"] [data-block-grip]')
    gb = grip.bounding_box()
    drag(pg, grip, first['x'] + first['width'] / 2 - gb['x'], first['y'] + 12 - gb['y'], steps=25)
    bl = pg.evaluate(BLOCKS)
    check(bl[0]['id'] == text_id, f'the text block was dragged to the top ({[x["title"] for x in bl]})')
    pg.locator(f'[data-block-id="{text_id}"] button[title="Ещё"]').click()
    pg.locator('.menu-item', has_text='Правее / ниже').click()
    check(pg.evaluate(BLOCKS)[1]['id'] == text_id, 'the arrow button moves it one place')

    print('== visibility, copy, remove, undo')
    rid = pg.evaluate(BLOCKS)[[x['title'] for x in pg.evaluate(BLOCKS)].index('Последние изменения')]['id']
    pg.locator(f'[data-block-id="{rid}"] button[title="Настройки блока"]').click()
    pg.locator('.modal').get_by_role('button', name='Мастерам').click()
    pg.locator('.modal input[placeholder="Последние изменения"]').fill('Правки (для мастера)')
    pg.locator('.modal').get_by_role('button', name='Акцент').click()
    pg.locator('.modal').get_by_role('button', name='Готово').click()
    check(pg.locator(f'[data-block-id="{rid}"] .badge', has_text='мастерам').count() == 1, 'masters-only badge')
    check('db-accent' in (pg.locator(f'[data-block-id="{rid}"]').get_attribute('class') or ''), 'accent look')
    n = len(pg.evaluate(BLOCKS))
    pg.locator(f'[data-block-id="{rid}"] button[title="Ещё"]').click()
    pg.locator('.menu-item', has_text='Копия блока').click()
    check(len(pg.evaluate(BLOCKS)) == n + 1, 'copy of a block')
    rnd = [x for x in pg.evaluate(BLOCKS) if x['title'] == 'Случайная статья'][0]['id']
    pg.locator(f'[data-block-id="{rnd}"] button[title="Убрать блок"]').click()
    check(pg.locator(f'[data-block-id="{rnd}"]').count() == 0, 'block removed')
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(200)
    check(pg.locator(f'[data-block-id="{rnd}"]').count() == 1, 'Ctrl+Z brings it back')
    pg.locator(f'[data-block-id="{rnd}"] button[title="Убрать блок"]').click()
    pg.locator('.db-toolbar .chip', has_text='L').click()
    pg.locator('.db-toolbar .chip', has_text='Во всю ширину').click()
    pg.screenshot(path=os.path.join(OUT, 'd-2-editing.png'), full_page=True)
    order = [x['id'] for x in pg.evaluate(BLOCKS)]
    pg.locator('.db-toolbar').get_by_role('button', name='Готово').click()
    pg.wait_for_function("() => !document.querySelector('.db-toolbar')", timeout=5000)
    pg.wait_for_timeout(1500)

    print('== saved for everybody')
    lay = saved_layout(wid)
    check(lay is not None and [x['id'] for x in lay] == order, 'layout saved to the world in the same order')
    pg.reload(); pg.wait_for_selector('.db-grid [data-block]', timeout=20000); pg.wait_for_timeout(800)
    check(pg.locator('.dbv-text .prose', has_text='Добро пожаловать').count() == 1 and pg.locator('.dbv-links a').count() == 1, 'after reload: text and links are there')
    check(pg.locator('.content.content-wide').count() == 1, 'wide page kept')
    check(pg.locator('.db-edit-bar').count() == 0 and pg.locator('.db-rs').count() == 0, 'no edit controls outside edit mode')
    pg.screenshot(path=os.path.join(OUT, 'd-3-custom.png'), full_page=True)

    print('== a player does not see the masters-only block')
    pg.get_by_role('button', name='Глазами игрока').click()
    pg.locator('.menu-item', has_text='Любой игрок').click()
    pg.wait_for_selector('.preview-banner', timeout=5000); pg.wait_for_timeout(500)
    check(pg.locator('.panel-title', has_text='Правки (для мастера)').count() == 0, 'player preview: masters-only block hidden')
    check(pg.get_by_role('button', name='Настроить обзор').count() == 0, 'player preview: no «Настроить обзор»')
    pg.get_by_role('button', name='Выйти из просмотра').click(); pg.wait_for_timeout(500)
    check(pg.locator('.panel-title', has_text='Правки (для мастера)').count() >= 1, 'back as master: block visible')

    print('== reset to the standard layout')
    pg.get_by_role('button', name='Настроить обзор').first.click()
    pg.once('dialog', lambda d: d.accept())
    pg.locator('.db-toolbar').get_by_role('button', name='Стандартный вид').click()
    pg.wait_for_timeout(300)
    check(not any(x['title'] == 'Приветствие' for x in pg.evaluate(BLOCKS)), 'standard layout back')
    pg.locator('.db-toolbar').get_by_role('button', name='Отменить').click()
    check(any(x['title'] == 'Приветствие' for x in pg.evaluate(BLOCKS)), 'and undone')
    pg.locator('.db-toolbar').get_by_role('button', name='Готово').click()

    print('== old cabinet links')
    pg.goto(BASE + '#/account?tab=requests'); pg.wait_for_timeout(1200)
    check('#/worlds?tab=requests' in pg.url and pg.locator('h2', has_text='Заявки в мои миры').count() == 1, f'old «Заявки» link lands in Миры ({pg.url})')
    pg.goto(BASE + '#/account'); pg.wait_for_timeout(1200)
    check(pg.locator('.tab.on', has_text='Профиль').count() == 1 and pg.locator('.app-nav a.on').count() == 0, 'personal cabinet: profile, no section lit')

    print('== phone')
    ph = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2).new_page()
    ph.on('pageerror', lambda e: errs.append('phone pageerror: ' + str(e)[:400]))
    ph.goto(BASE + '#/login')
    ph.locator('input[type=email]').fill(EMAIL); ph.locator('input[type=password]').fill('secret123')
    ph.get_by_role('button', name='Войти', exact=True).click(); ph.wait_for_url('**/#/worlds**', timeout=20000)
    check(ph.evaluate(OVERFLOW) <= 0, 'phone, worlds page: no sideways scroll')
    ph.goto(BASE + f'#/w/{wid}'); ph.wait_for_selector('.db-grid [data-block]', timeout=20000); ph.wait_for_timeout(1000)
    check(ph.evaluate(OVERFLOW) <= 0, 'phone, overview: no sideways scroll')
    check(ph.locator('.app-bar .app-nav a').count() >= 3 and ph.locator('.app-bar .app-nav a').first.is_visible(), 'phone, world: the sections are in the bar')
    widths = [x['width'] for x in ph.evaluate(BLOCKS)]
    check(len(set(widths)) == 1, f'phone: blocks take the full width ({set(widths)})')
    ph.screenshot(path=os.path.join(OUT, 'p-1-overview.png'), full_page=True)
    ph.locator('.app-bar button[title="Меню мира"]').tap(); ph.wait_for_timeout(500)
    check(ph.locator('.sidebar.open').count() == 1, 'phone: the world menu opens from the bar')
    ph.screenshot(path=os.path.join(OUT, 'p-2-menu.png'))
    ph.locator('.sb-backdrop').tap(position={'x': 370, 'y': 400}); ph.wait_for_timeout(400)
    ph.get_by_role('button', name='Настроить обзор').tap()
    ph.wait_for_selector('.db-toolbar', timeout=5000)
    check(ph.evaluate(OVERFLOW) <= 0, 'phone, edit mode: no sideways scroll')
    # move by touch: the second block goes first
    bl = ph.evaluate(BLOCKS)
    sec = ph.locator(f'[data-block-id="{bl[1]["id"]}"] [data-block-grip]')
    sec.scroll_into_view_if_needed()
    gb = sec.bounding_box(); fb = ph.locator('.db-grid > [data-block]').first.bounding_box()
    cdp = ph.context.new_cdp_session(ph)
    def touch(kind, x, y):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})
    x0, y0 = gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2
    touch('touchStart', x0, y0)
    for k in range(1, 16): touch('touchMove', x0, y0 + (fb['y'] + 10 - y0) * k / 15); ph.wait_for_timeout(16)
    touch('touchEnd', 0, 0); ph.wait_for_timeout(500)
    check(ph.evaluate(BLOCKS)[0]['id'] == bl[1]['id'], 'phone: a block moved by touch')
    ph.screenshot(path=os.path.join(OUT, 'p-3-editing.png'), full_page=True)
    ph.get_by_role('button', name='Готово').tap(); ph.wait_for_timeout(1200)

    # the edit bar fits into the narrowest blocks
    ph.close()
    pg.goto(BASE + f'#/w/{wid}'); pg.wait_for_selector('.db-grid [data-block]', timeout=20000)
    pg.get_by_role('button', name='Настроить обзор').first.click(); pg.wait_for_selector('.db-toolbar', timeout=5000)
    sticking = pg.evaluate("""() => [...document.querySelectorAll('.db-edit-bar')].filter((bar) => { const r = bar.getBoundingClientRect(); return [...bar.querySelectorAll('button')].some((x) => x.getBoundingClientRect().right > r.right + 1) }).length""")
    check(sticking == 0, f'edit bar buttons stay inside their blocks ({sticking} bars overflow)')
    pg.locator('.db-toolbar').get_by_role('button', name='Готово').click()

    print('errors:', errs[:20])
    check(not errs, 'no console errors')
    b.close()

print('FAILS:', FAILS)
sys.exit(1 if FAILS else 0)
