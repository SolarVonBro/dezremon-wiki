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
MAP_SETUP = r"""async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const world = pinia._s.get('world'), gallery = pinia._s.get('gallery')
  const c = document.createElement('canvas'); c.width = 1600; c.height = 1000
  const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1600, 1000); g.addColorStop(0, '#2f5d8a'); g.addColorStop(1, '#a8c08a')
  x.fillStyle = g; x.fillRect(0, 0, 1600, 1000); x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.fillText('Побережье', 420, 540)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
  const [m] = await gallery.upload([new File([blob], 'coast.jpg', { type: 'image/jpeg' })], { folder: 'maps' })
  const id = await world.createEntity('map', 'Карта побережья', { fields: { mapImageId: m.id } })
  for (let i = 0; i < 50 && world.pendingWrites > 0; i++) await new Promise((r) => setTimeout(r, 200))
  return id
}"""
MAP_FIT = """() => { const st = document.querySelector('.dbv-mapbox .dw-stage').getBoundingClientRect(), im = document.querySelector('.dbv-mapbox img.leaflet-image-layer').getBoundingClientRect();
  const cx = st.left + st.width / 2, cy = st.top + st.height / 2
  return { inside: im.left >= st.left - 2 && im.right <= st.right + 2 && im.top >= st.top - 2 && im.bottom <= st.bottom + 2,
    cover: Math.max(im.width / st.width, im.height / st.height), centre: im.left < cx && im.right > cx && im.top < cy && im.bottom > cy } }"""
BLOCKS = """() => [...document.querySelectorAll('.db-grid > [data-block]')].map((b) => ({ id: b.dataset.blockId, w: Number(b.style.getPropertyValue('--w')), h: b.style.height,
  title: b.querySelector('.db-eb-title')?.innerText ?? '', x: Math.round(b.getBoundingClientRect().left), width: Math.round(b.getBoundingClientRect().width) }))"""
OVERFLOW = "() => document.documentElement.scrollWidth - window.innerWidth"


def saved_layout(wid):
    d = rest('GET', f'{FS}/worlds/{wid}')
    dash = d['fields']['settings']['mapValue']['fields'].get('dashboard', {}).get('mapValue', {}).get('fields')
    if not dash: return None
    return [{k: (v.get('stringValue') or v.get('integerValue') or v.get('booleanValue')) for k, v in b['mapValue']['fields'].items()}
            for b in dash['blocks']['arrayValue'].get('values', [])]


def fs_value(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [fs_value(x) for x in v]}}
    return {'mapValue': {'fields': {k: fs_value(x) for k, x in v.items()}}}


def put_layout(wid, layout):
    d = rest('GET', f'{FS}/worlds/{wid}')
    settings = d['fields']['settings']['mapValue']['fields']
    settings['dashboard'] = fs_value(layout)
    rest('PATCH', f'{FS}/worlds/{wid}?updateMask.fieldPaths=settings', {'fields': {'settings': {'mapValue': {'fields': settings}}}})


POS = """() => Object.fromEntries([...document.querySelectorAll('.db-grid > [data-block]')].map((b) => { const r = b.getBoundingClientRect();
  return [b.dataset.blockId, { l: Math.round(r.left), t: Math.round(r.top + scrollY), b: Math.round(r.bottom + scrollY), r: Math.round(r.right), w: Math.round(r.width) }] }))"""


def drag(pg, handle, dx, dy, steps=14):
    handle.evaluate("(e) => e.scrollIntoView({ block: 'center' })"); pg.wait_for_timeout(150)
    box = handle.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    hit = pg.evaluate(f"() => {{ const e = document.elementFromPoint({x}, {y}); return e ? String(e.className) + ' @ ' + (e.closest('[data-block]')?.dataset.blockId ?? '-') : null }}")
    if 'db-rs' not in (hit or '') and 'db-grip' not in (hit or '') and 'icon' not in (hit or ''): print('   drag start hits:', hit, box)
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
    pg.wait_for_selector('.dbv--text .prose:has-text("Добро пожаловать")', timeout=5000)
    bl = pg.evaluate(BLOCKS)
    tb = [x for x in bl if x['title'] == 'Приветствие']
    check(len(bl) == n0 + 1 and len(tb) == 1 and tb[0]['w'] == 6, f'text block added (in the highest free place), half width ({tb})')

    print('== quick links')
    pg.locator('.db-add-bar').click()
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
    links_id = [x for x in pg.evaluate(BLOCKS) if x['title'] == 'Быстрые ссылки'][0]['id']
    blk = pg.locator(f'[data-block-id="{links_id}"]')
    # to the left edge first, so the block has room to grow
    for _ in range(12):
        blk.locator('button[title="Ещё"]').click()
        left = pg.locator('.menu-item', has_text='Левее')
        if left.is_disabled(): pg.locator('.db-tb-title b').click(); break   # a click elsewhere closes the menu
        left.click(); pg.wait_for_timeout(150)
    byid = lambda: {x['id']: x for x in pg.evaluate(BLOCKS)}
    w0 = byid()[links_id]['w']
    col = (pg.locator('.db-grid').bounding_box()['width']) / 12
    drag(pg, blk.locator('.db-rs-x'), col * 2.1, 0)
    w1 = byid()[links_id]['w']
    check(w1 == w0 + 2, f'dragging the right edge widened the block by two columns ({w0} -> {w1})')
    h_before = blk.bounding_box()['height']
    drag(pg, blk.locator('.db-rs-y'), 0, 150)
    h1 = byid()[links_id]['h']
    check(h1.endswith('px') and int(h1[:-2]) % 20 == 0 and int(h1[:-2]) >= h_before + 100, f'dragging the bottom edge set a fixed height snapped to 20 px ({h_before} -> {h1})')
    blk.locator('.db-rs-y').dblclick(); pg.wait_for_timeout(300)
    check(byid()[links_id]['h'] == '', 'double click on the bottom edge: back to content height')

    print('== move with the mouse')
    text_id = [x for x in pg.evaluate(BLOCKS) if x['title'] == 'Приветствие'][0]['id']
    first = pg.locator('.db-grid > [data-block]').nth(0).bounding_box()
    grip = pg.locator(f'[data-block-id="{text_id}"] [data-block-grip]')
    gb = grip.bounding_box()
    drag(pg, grip, first['x'] + first['width'] / 2 - gb['x'], first['y'] + 12 - gb['y'], steps=25)
    bl = pg.evaluate(BLOCKS)
    check(bl[0]['id'] == text_id, f'the text block was dragged to the top ({[x["title"] for x in bl]})')
    pg.locator(f'[data-block-id="{text_id}"] button[title="Ещё"]').click()
    pg.locator('.menu-item', has_text='Ниже').click()
    check(pg.evaluate(BLOCKS)[1]['id'] == text_id, '«Ниже» puts it under the block below')

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
    check(pg.locator('.dbv--text .prose', has_text='Добро пожаловать').count() == 1 and pg.locator('.dbv-links a').count() == 1, 'after reload: text and links are there')
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

    print('== free placement: an empty middle, two blocks next to one tall block')
    put_layout(wid, {'v': 1, 'gap': 'md', 'wide': False, 'blocks': [
        {'id': 'A', 'type': 'recent', 'w': 4, 'h': 600, 'x': 0, 'y': 0, 'limit': 14, 'types': []},
        {'id': 'B', 'type': 'random', 'w': 4, 'h': 0, 'x': 8, 'y': 0, 'types': []},
        {'id': 'C', 'type': 'waiting', 'w': 4, 'h': 0, 'x': 0, 'y': 200, 'show': 'masters', 'limit': 3},
        {'id': 'E', 'type': 'character', 'w': 4, 'h': 0, 'x': 4, 'y': 300},
        {'id': 'T', 'type': 'text', 'w': 12, 'h': 0, 'x': 0, 'y': 400, 'html': '<p>Подвал обзора</p>'},
    ]})
    pg.reload(); pg.wait_for_selector('[data-block-id="T"]', timeout=20000); pg.wait_for_timeout(800)
    p = pg.evaluate(POS)
    check(p['B']['l'] > p['A']['r'] + p['A']['w'] * 0.8 and abs(p['B']['t'] - p['A']['t']) <= 4, f'B stands in the right columns, level with A, the middle stays empty ({p["A"]}, {p["B"]})')
    check(p['C']['l'] == p['A']['l'] and p['C']['t'] >= p['A']['b'], 'C under A in its column')
    check(p['T']['t'] >= max(p['A']['b'], p['C']['b']), 'the full-width text goes under everything')
    pg.get_by_role('button', name='Настроить обзор').first.click(); pg.wait_for_selector('.db-toolbar', timeout=5000); pg.wait_for_timeout(500)
    p = pg.evaluate(POS)
    check('E' in p, 'the empty «Мой персонаж» block is there in edit mode (middle columns)')
    # drag C into the right column, under B
    grip = pg.locator('[data-block-id="C"] [data-block-grip]')
    grip.scroll_into_view_if_needed()
    gb = grip.bounding_box()
    cbox = pg.locator('[data-block-id="C"]').bounding_box()
    bbox = pg.locator('[data-block-id="B"]').bounding_box()
    off_x, off_y = gb['x'] - cbox['x'], gb['y'] - cbox['y']
    tx, ty = bbox['x'] + off_x + gb['width'] / 2, bbox['y'] + bbox['height'] + 30 + off_y + gb['height'] / 2
    pg.mouse.move(gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2); pg.mouse.down()
    pg.mouse.move(tx, ty, steps=30)
    check(pg.locator('.db-placeholder').count() == 1, 'while dragging, a frame shows where the block will stand')
    pg.mouse.up(); pg.wait_for_timeout(600)
    p = pg.evaluate(POS)
    check(p['C']['l'] == p['B']['l'] and p['C']['t'] > p['B']['t'] and p['C']['t'] < p['A']['b'], f'C now stands under B, next to the tall A ({p["A"]}, {p["B"]}, {p["C"]})')
    before = {k: v['l'] for k, v in p.items()}
    pg.locator('.db-toolbar').get_by_role('button', name='Готово').click()
    pg.wait_for_function("() => !document.querySelector('.db-toolbar')", timeout=5000); pg.wait_for_timeout(1500)
    p = pg.evaluate(POS)
    check('E' not in p, 'outside edit mode the empty block is hidden')
    after = {k: v['l'] for k, v in p.items()}
    check(all(after[k] == before[k] for k in after), f'after «Готово» every block keeps its column ({before} -> {after})')
    check(p['C']['l'] == p['B']['l'] and p['B']['t'] < p['C']['t'] < p['A']['b'], 'after «Готово»: still two blocks next to one')
    pg.reload(); pg.wait_for_selector('[data-block-id="T"]', timeout=20000); pg.wait_for_timeout(800)
    p2 = pg.evaluate(POS)
    check(all(p2[k]['l'] == p[k]['l'] and abs(p2[k]['t'] - p[k]['t']) <= 4 for k in p), 'after reload: the same places')
    pg.screenshot(path=os.path.join(OUT, 'd-4-placement.png'), full_page=True)

    print('== map block: the real map')
    pg.goto(BASE + f'#/w/{wid}/gallery'); pg.wait_for_timeout(1500)   # the gallery store comes to life there
    map_id = pg.evaluate(MAP_SETUP)
    pg.goto(BASE + f'#/w/{wid}'); pg.wait_for_selector('.db-grid [data-block]', timeout=20000); pg.wait_for_timeout(500)
    pg.get_by_role('button', name='Настроить обзор').first.click(); pg.wait_for_selector('.db-toolbar', timeout=5000)
    pg.locator('.db-toolbar').get_by_role('button', name='Блок').click()
    pg.locator('.dba-item:has(b:text-is("Карта"))').click()
    pg.wait_for_selector('.modal .picker-btn', timeout=5000)
    pg.locator('.modal .picker-btn').click()
    pg.locator('.picker-menu .menu-item', has_text='Карта побережья').click()
    pg.locator('.modal').get_by_role('button', name='½').click()
    pg.locator('.modal').get_by_role('button', name='Готово').click()
    pg.locator('.db-toolbar').get_by_role('button', name='Готово').click()
    pg.wait_for_selector('.dbv-mapbox .leaflet-container img.leaflet-image-layer', timeout=20000); pg.wait_for_timeout(1500)
    img = pg.evaluate("() => { const i = document.querySelector('.dbv-mapbox img.leaflet-image-layer'); return { nw: i.naturalWidth, w: Math.round(i.getBoundingClientRect().width) } }")
    check(img['nw'] >= 1200, f'the map block shows the full-size picture, not a thumbnail ({img})')
    fit = pg.evaluate(MAP_FIT)
    check(fit['inside'] and fit['cover'] > 0.6, f'the whole map is in view at first ({fit})')
    check(pg.locator('.dbv-mapbox .dw-ctrl button[title="Приблизить"]').count() == 1 and pg.locator('.dbv-mapbox .dw-side').count() == 0, 'zoom buttons, no marker list squeezing the block')
    w0 = img['w']
    pg.locator('.dbv-mapbox .dw-ctrl button[title="Приблизить"]').click(); pg.wait_for_timeout(900)
    w1 = pg.evaluate("() => Math.round(document.querySelector('.dbv-mapbox img.leaflet-image-layer').getBoundingClientRect().width)")
    check(w1 > w0 * 1.2, f'the map zooms ({w0} -> {w1})')
    mb = pg.locator('.dbv-mapbox').bounding_box()
    pg.mouse.move(mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2); pg.mouse.wheel(0, 300); pg.wait_for_timeout(600)
    w2 = pg.evaluate("() => Math.round(document.querySelector('.dbv-mapbox img.leaflet-image-layer').getBoundingClientRect().width)")
    check(w2 == w1, 'the mouse wheel over the map scrolls the page, it does not zoom the map by accident')
    pg.locator('.dbv-mapbox .dw-ctrl button[title="Во весь экран"]').click(); pg.wait_for_timeout(500)
    check(pg.locator('.dw-map.is-fs').count() == 1 and pg.locator('.dw-map.is-fs .dw-side').count() == 1, 'full screen: a normal map with the marker list')
    pg.screenshot(path=os.path.join(OUT, 'd-6-map-fs.png'))
    pg.locator('.dw-map.is-fs .dw-ctrl button[title="Выйти из полноэкранного режима"]').click(); pg.wait_for_timeout(600)
    fit = pg.evaluate(MAP_FIT)
    check(fit['centre'], f'after full screen the middle of the map stays in the middle ({fit})')
    pg.screenshot(path=os.path.join(OUT, 'd-5-map.png'), full_page=True)

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
