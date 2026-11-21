"""End-to-end smoke test: registration, world, rich article (table, image, secret, mention), HTML mode,
persistence after reload, invite, player view without secrets.
Usage: E2E_URL=<site url> python tests/e2e_smoke.py <screenshots_dir>
Default URL is the local dev server against the emulators (npm run emulators + npm run dev:emu).
Against the live site it creates test accounts/worlds that must be deleted afterwards.
"""
import sys, os, re, time, base64, zlib, struct
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('E2E_URL', 'http://localhost:5173/')
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
errors = []
import random
RUN = str(random.randint(10000, 99999))
GM_EMAIL = f'e2e-gm-{RUN}@example.com'
PL_EMAIL = f'e2e-player-{RUN}@example.com'


def png(path, w=320, h=200):
    raw = b''.join(b'\x00' + bytes((x * 255 // w, y * 255 // h, 140)) * 1 for y in range(h) for x in range(1)) if False else None
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
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', data) + chunk(b'IEND', b''))


def step(name):
    print('->', name, flush=True)


def shot(pg, name, full=True):
    pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


def watch(pg, label):
    pg.on('console', lambda m: errors.append(f'[{label}] {m.type}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'[{label}] pageerror: {e}'))


img_path = os.path.join(OUT, 'test.png')
png(img_path)

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    gm = b.new_context(viewport={'width': 1440, 'height': 950})
    pg = gm.new_page()
    watch(pg, 'gm')

    step('register master')
    pg.goto(BASE + '#/login')
    pg.get_by_text('Регистрация', exact=True).last.click()
    pg.locator('input[autocomplete=nickname]').fill('Мастер Роман')
    pg.locator('input[type=email]').fill(GM_EMAIL)
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Зарегистрироваться').click()
    pg.wait_for_selector('text=Новый мир', timeout=20000)

    step('create world')
    if not pg.locator('input[placeholder="Дезремон"]').count():
        pg.get_by_role('button', name='Новый мир').first.click()
    pg.locator('input[placeholder="Дезремон"]').fill('E2E проверка ' + RUN)
    pg.locator('textarea').first.fill('Тестовый мир для проверки вики.')
    pg.get_by_role('button', name='Создать мир').click()
    pg.wait_for_selector('.dash-hero h1', timeout=20000)
    shot(pg, '01-dashboard-empty')
    world_url = pg.url
    print('   WORLD', world_url.split('/w/')[1].split('/')[0], flush=True)

    step('create a location via modal')
    pg.locator('.sidebar').get_by_role('button', name='Создать').click()
    pg.locator('.type-tile', has_text='Локация').click()
    pg.locator('.modal input.input').first.fill('Вельмор')
    pg.get_by_role('button', name='Создать и редактировать').click()
    pg.wait_for_selector('.wiki-editor', timeout=20000)
    pg.locator('.wiki-editor').click()
    pg.keyboard.type('Вольный город на побережье.')
    pg.wait_for_selector('.save-state:has-text("Сохранено")', timeout=20000)

    step('create a character and write a rich article')
    pg.locator('.sidebar').get_by_role('button', name='Создать').click()
    pg.locator('.type-tile', has_text='Персонаж').click()
    pg.locator('.modal input.input').first.fill('Аэлин Тарн')
    pg.get_by_role('button', name='Создать и редактировать').click()
    ed = pg.locator('.wiki-editor')
    ed.wait_for(timeout=20000)
    ed.click()
    pg.keyboard.type('/заголовок 2')
    pg.keyboard.press('Enter')
    pg.keyboard.type('Биография')
    pg.keyboard.press('Enter')
    pg.keyboard.type('Родилась в ')
    pg.keyboard.type('@Вельм')
    pg.wait_for_selector('.suggest-item', timeout=5000)
    pg.keyboard.press('Enter')
    pg.keyboard.type('и выросла среди контрабандистов. ')
    pg.keyboard.press('Control+b')
    pg.keyboard.type('Жирный текст')
    pg.keyboard.press('Control+b')
    pg.keyboard.press('Enter')
    pg.keyboard.type('/таблица')
    pg.keyboard.press('Enter')
    pg.keyboard.type('Сила')
    pg.keyboard.press('Tab')
    pg.keyboard.type('14')
    # leave the table: click at the end of the doc
    pg.keyboard.press('Control+End')
    pg.keyboard.type('/секрет')
    pg.keyboard.press('Enter')
    pg.keyboard.type('Она дочь короля — игроки не должны знать.')
    pg.keyboard.press('Control+End')
    step('insert an image through the dialog')
    pg.locator('.tb-btn[title^="Изображение"]').click()
    with pg.expect_file_chooser() as fc:
        pg.locator('.dropzone').click()
    fc.value.set_files(img_path)
    pg.wait_for_selector('.wiki-editor .wiki-img img', timeout=20000)
    pg.wait_for_selector('.rich-status:not(:has-text("Загрузка изображений"))', timeout=30000)
    pg.wait_for_timeout(2500)
    pg.wait_for_selector('.save-state:has-text("Сохранено")', timeout=30000)
    shot(pg, '02-editor', full=False)

    step('HTML mode round-trip')
    pg.locator('.tb-html').click()
    pg.wait_for_selector('.cm-editor', timeout=15000)
    shot(pg, '03-html-mode', full=False)
    pg.locator('.tb-html').click()
    pg.wait_for_selector('.wiki-editor table', timeout=10000)

    step('leave edit mode, reload, check persistence')
    pg.get_by_role('button', name='Готово').click()
    pg.wait_for_selector('.wiki-view', timeout=15000)
    entity_url = pg.url
    pg.reload()
    pg.wait_for_selector('.wiki-view table', timeout=20000)
    view = pg.locator('.wiki-view')
    assert view.locator('a.mention').count() >= 1, 'mention missing after reload'
    assert view.locator('.secret-block').count() == 1, 'secret block missing for master'
    pg.wait_for_selector('.wiki-view .wiki-img img[src^="blob:"]', timeout=20000)
    assert 'Жирный текст' in view.inner_text()
    shot(pg, '04-entity-view')

    step('theme screenshots')
    for theme in ['light', 'parchment']:
        pg.evaluate(f"document.documentElement.setAttribute('data-theme', '{theme}')")
        pg.wait_for_timeout(300)
        shot(pg, f'05-entity-{theme}', full=False)
    pg.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")

    step('relations tab + attributes')
    pg.locator('.tab', has_text='Атрибуты').click()
    pg.get_by_role('button', name='Изменить', exact=True).click()
    pg.get_by_role('button', name='Атрибут', exact=True).click()
    pg.locator('.attr-edit-row input').nth(0).fill('Уровень')
    pg.locator('.attr-edit-row input').nth(1).fill('5')
    pg.get_by_role('button', name='Сохранить', exact=True).click()
    pg.wait_for_selector('.attr-grid:has-text("Уровень")', timeout=10000)

    step('invite a player')
    pg.goto(world_url.split('#')[0] + '#' + world_url.split('#')[1].rstrip('/') + '/settings/members')
    pg.wait_for_selector('h3:has-text("Приглашения")', timeout=15000)
    gm.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg.get_by_role('button', name='Создать ссылку').click()
    pg.wait_for_selector('.rel-row:has-text("Игрок")', timeout=10000)
    invite = pg.locator('.invite-url').first.input_value()
    print('   invite:', invite)
    shot(pg, '06-settings-members')

    step('dashboard with content')
    pg.goto(world_url)
    pg.wait_for_selector('.recent-row', timeout=15000)
    shot(pg, '07-dashboard')

    pl = b.new_context(viewport={'width': 1280, 'height': 900})
    pp = pl.new_page()
    watch(pp, 'player')
    step('player registers and accepts invite')
    pp.goto(BASE + '#/login')
    pp.get_by_text('Регистрация', exact=True).last.click()
    pp.locator('input[autocomplete=nickname]').fill('Игрок Соня')
    pp.locator('input[type=email]').fill(PL_EMAIL)
    pp.locator('input[type=password]').fill('secret123')
    pp.get_by_role('button', name='Зарегистрироваться').click()
    pp.wait_for_selector('text=Мои миры', timeout=20000)
    pp.goto(invite)
    pp.get_by_role('button', name='Принять приглашение').click()
    pp.wait_for_selector('.dash-hero h1', timeout=20000)

    step('player views the character: no secret')
    pp.goto(entity_url.split('?')[0])
    pp.wait_for_selector('.wiki-view', timeout=20000)
    pp.wait_for_timeout(1500)
    pv = pp.locator('.wiki-view')
    assert pv.locator('.secret-block').count() == 0, 'SECRET LEAKED TO PLAYER'
    assert 'дочь короля' not in pv.inner_text(), 'SECRET TEXT LEAKED'
    assert pv.locator('table').count() == 1
    pp.wait_for_selector('.wiki-view .wiki-img img[src^="blob:"]', timeout=20000)
    shot(pp, '08-player-view')

    step('mobile layout')
    mob = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = mob.new_page()
    mp.goto(BASE + '#/')
    mp.wait_for_timeout(1500)
    shot(mp, '09-mobile-landing', full=False)
    b.close()

print('\nconsole errors:' if errors else '\nno console errors')
for e in errors[:40]:
    print('  ', e[:300])
print('E2E OK')
