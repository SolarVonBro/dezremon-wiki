"""Storage meter on the live site: project-wide total, this world's share, recount, cleanup on world deletion."""
import os, sys, random
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:5173/')
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(10000, 99999))
errors = []

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_context(viewport={'width': 1440, 'height': 950}).new_page()
    pg.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(BASE + '#/login')
    pg.get_by_text('Регистрация', exact=True).last.click()
    pg.locator('input[autocomplete=nickname]').fill('Мастер Места')
    pg.locator('input[type=email]').fill(f'e2e-usage-{RUN}@example.com')
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Зарегистрироваться').click()
    pg.wait_for_selector('text=Мои миры', timeout=20000)
    pg.get_by_role('button', name='Новый мир').click()
    pg.locator('.modal input.input').first.fill('E2E место ' + RUN)
    pg.get_by_role('button', name='Создать мир').click()
    pg.wait_for_selector('.dash-hero h1', timeout=20000)
    wurl = pg.url.rstrip('/')
    print('WORLD', wurl.split('/w/')[1])

    pg.goto(wurl + '/settings/usage')
    pg.wait_for_selector('text=на весь проект', timeout=20000)
    pg.wait_for_selector('text=Другие миры', timeout=15000)
    print('before :', pg.locator('.legend').inner_text().replace('\n', ' | '))
    assert 'ещё не посчитан' in pg.locator('.legend').inner_text()
    pg.screenshot(path=os.path.join(OUT, 'u1-before.png'))
    pg.get_by_role('button', name='Пересчитать этот мир').click()
    pg.wait_for_selector('text=Из чего состоит этот мир', timeout=60000)
    pg.wait_for_timeout(1000)
    print('head   :', pg.locator('.meter-head').inner_text().replace('\n', ' '))
    print('after  :', pg.locator('.legend').inner_text().replace('\n', ' | '))
    assert 'ещё не посчитан' not in pg.locator('.legend').inner_text()
    pg.screenshot(path=os.path.join(OUT, 'u2-after.png'), full_page=True)

    pg.goto(wurl + '/settings/general'); pg.wait_for_selector('text=Опасная зона', timeout=15000)
    pg.get_by_role('button', name='Удалить мир…').click()
    pg.locator('.modal input.input').fill('E2E место ' + RUN)
    pg.get_by_role('button', name='Удалить навсегда').click()
    pg.wait_for_selector('text=Мои миры', timeout=60000)
    b.close()

print('console errors:', errors or 'none')
