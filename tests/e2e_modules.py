"""Module tour on the live site: calendar, map, timeline, family tree, graph, gallery, search, backup.
Each step is isolated; console errors and failures are collected. Usage: python e2e2.py <out_dir>"""
import sys, os, random, zipfile, json, traceback
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:5173/')
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(10000, 99999))
errors, fails = [], []
import zlib, struct


def png(path, w=320, h=200):
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            row += bytes(((x * 255) // w, (y * 255) // h, 150))
        rows.append(bytes(row))
    data = zlib.compress(b''.join(rows))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(bytes([0x89]) + b'PNG' + bytes([13, 10, 26, 10]) + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', data) + chunk(b'IEND', b''))


def step(name, fn):
    print('->', name, flush=True)
    try:
        fn()
    except Exception as e:  # keep going, report at the end
        fails.append(f'{name}: {str(e).splitlines()[0][:300]}')
        print('   FAILED:', str(e).splitlines()[0][:200], flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    ctx = b.new_context(viewport={'width': 1440, 'height': 950}, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text[:400]}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {str(e)[:400]}'))
    img = os.path.join(OUT, 'map.png')
    png(img, 900, 600)
    state = {}

    def register():
        pg.goto(BASE + '#/login')
        pg.get_by_text('Регистрация', exact=True).last.click()
        pg.locator('input[autocomplete=nickname]').fill('Мастер Тур')
        pg.locator('input[type=email]').fill(f'e2e-tour-{RUN}@example.com')
        pg.locator('input[type=password]').fill('secret123')
        pg.get_by_role('button', name='Зарегистрироваться').click()
        pg.wait_for_selector('text=Новый мир', timeout=20000)
        if not pg.locator('input[placeholder="Дезремон"]').count():
            pg.get_by_role('button', name='Новый мир').first.click()
        pg.locator('input[placeholder="Дезремон"]').fill('E2E модули ' + RUN)
        pg.get_by_role('button', name='Создать мир').click()
        pg.wait_for_selector('.dash-hero h1', timeout=20000)
        state['world'] = pg.url
        print('   WORLD', pg.url.split('/w/')[1].split('/')[0])

    def create(type_label, name):
        pg.locator('.sidebar').get_by_role('button', name='Создать').click()
        pg.locator('.type-tile', has_text=type_label).click()
        pg.locator('.modal input.input').first.fill(name)
        pg.get_by_role('button', name='Создать и редактировать').click()
        pg.wait_for_selector('.hero-name-input, .hero-name', timeout=20000)
        pg.wait_for_timeout(800)
        return pg.url.split('?')[0]

    def calendar():
        url = create('Календарь', 'Летоисчисление Дезремона')
        pg.get_by_role('button', name='Готово').click()
        pg.goto(url)
        pg.wait_for_timeout(2500)
        pg.screenshot(path=os.path.join(OUT, 'm1-calendar.png'))
        tabs = pg.locator('.tab, button', has_text='Настройка')
        if tabs.count():
            tabs.first.click()
            pg.wait_for_timeout(1200)
            pg.screenshot(path=os.path.join(OUT, 'm2-calendar-settings.png'))

    def map_():
        url = create('Карта', 'Карта Вельмора')
        pg.get_by_role('button', name='Готово').click()
        pg.goto(url)
        pg.wait_for_selector('text=Загрузить изображение карты', timeout=15000)
        btn = pg.get_by_role('button', name='Загрузить изображение карты')
        try:
            with pg.expect_file_chooser(timeout=4000) as fc:
                btn.click()
            fc.value.set_files(img)
        except Exception:
            with pg.expect_file_chooser() as fc:
                pg.locator('.dropzone').click()
            fc.value.set_files(img)
        pg.wait_for_selector('.leaflet-container', timeout=30000)
        pg.wait_for_timeout(2500)
        pg.screenshot(path=os.path.join(OUT, 'm3-map.png'))

    def timeline():
        url = create('Хронология', 'История мира')
        pg.get_by_role('button', name='Готово').click()
        pg.goto(url)
        pg.wait_for_timeout(2000)
        pg.get_by_role('button', name='Эпоха', exact=True).click()
        pg.wait_for_selector('.modal', timeout=8000)
        pg.locator('.modal input.input').first.fill('Эпоха Пепла')
        pg.locator('.modal .btn-primary').last.click()
        pg.wait_for_timeout(1500)
        pg.get_by_role('button', name='Событие', exact=True).click()
        pg.wait_for_selector('.modal', timeout=8000)
        pg.locator('.modal input.input').first.fill('Падение Старой Короны')
        pg.locator('.modal .btn-primary').last.click()
        pg.wait_for_timeout(2000)
        pg.screenshot(path=os.path.join(OUT, 'm4-timeline.png'))

    def family():
        a = create('Персонаж', 'Тарн Старший')
        pg.get_by_role('button', name='Готово').click()
        c = create('Персонаж', 'Аэлин Тарн')
        pg.get_by_role('button', name='Готово').click()
        pg.goto(c + '?tab=relations')
        pg.get_by_role('button', name='Новая связь').click()
        pg.locator('.modal .picker-btn').first.click()
        pg.locator('.picker-menu input').fill('Тарн Ст')
        pg.locator('.picker-menu .menu-item', has_text='Тарн Старший').click()
        pg.locator('.modal select').first.select_option('generic')
        pg.locator('.modal input[placeholder^="наставник"]').fill('отец')
        pg.locator('.modal input[placeholder^="ученик"]').fill('дочь')
        pg.get_by_role('button', name='Сохранить').click()
        pg.wait_for_selector('.rel-row', timeout=10000)
        pg.goto(c + '?tab=feature')
        pg.wait_for_timeout(2500)
        pg.screenshot(path=os.path.join(OUT, 'm5-family.png'))
        pg.goto(c + '?tab=relations')
        pg.locator('.chip', has_text='Граф').click()
        pg.wait_for_timeout(3000)
        pg.screenshot(path=os.path.join(OUT, 'm6-relations-graph.png'))

    def pages():
        base = state['world'].rstrip('/')
        for name, path in [('graph', '/graph'), ('gallery', '/gallery'), ('search', '/search?q=Тарн'), ('list', '/t/character'), ('dashboard', '')]:
            pg.goto(base + path)
            pg.wait_for_timeout(3000)
            pg.screenshot(path=os.path.join(OUT, f'm7-{name}.png'))

    def backup():
        base = state['world'].rstrip('/')
        pg.goto(base + '/settings/backup')
        pg.wait_for_selector('text=Скачать ZIP', timeout=15000)
        with pg.expect_download(timeout=120000) as dl:
            pg.get_by_role('button', name='Скачать ZIP').click()
        path = os.path.join(OUT, 'backup.zip')
        dl.value.save_as(path)
        z = zipfile.ZipFile(path)
        names = z.namelist()
        man = json.loads(z.read('manifest.json'))
        print('   zip files:', len(names), 'counts:', man.get('counts'))
        assert any(n.startswith('html/') for n in names), 'no offline html'
        assert any(n.startswith('images/') for n in names), 'no images'
        pg.screenshot(path=os.path.join(OUT, 'm8-backup.png'))

    step('register', register)
    step('calendar', calendar)
    step('map', map_)
    step('timeline', timeline)
    step('family + relation + graph', family)
    step('other pages', pages)
    step('backup download', backup)
    b.close()

print('\nFAILS:' if fails else '\nno step failures')
for f in fails:
    print('  ', f)
uniq = list(dict.fromkeys(errors))
print('\nconsole errors:' if uniq else '\nno console errors')
for e in uniq[:30]:
    print('  ', e)
