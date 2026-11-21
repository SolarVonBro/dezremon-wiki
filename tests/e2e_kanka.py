"""Import the Kanka archive into a fresh test world on the live site and dump the report.
Usage: python e2e_kanka.py <out_dir> <zip_path> [inspect-only]"""
import os, sys, random, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('E2E_URL', 'https://solarvonbro.github.io/dezremon-wiki/')
OUT, ZIP = sys.argv[1], sys.argv[2]
INSPECT_ONLY = len(sys.argv) > 3
RUN = str(random.randint(10000, 99999)); errors = []
os.makedirs(OUT, exist_ok=True)
log = open(os.path.join(OUT, 'kanka-report.txt'), 'w', encoding='utf-8')
def say(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); log.write(s + '\n'); log.flush()
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_page(viewport={'width': 1440, 'height': 1000})
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text[:500]}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {str(e)[:500]}'))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(BASE + '#/login'); pg.get_by_text('Регистрация', exact=True).last.click()
    pg.locator('input[autocomplete=nickname]').fill('Kanka Test'); pg.locator('input[type=email]').fill(f'e2e-kanka-{RUN}@example.com')
    pg.locator('input[type=password]').fill('secret123'); pg.get_by_role('button', name='Зарегистрироваться').click()
    pg.wait_for_selector('text=Новый мир', timeout=20000)
    pg.locator('input[placeholder="Дезремон"]').fill('E2E Kanka ' + RUN); pg.get_by_role('button', name='Создать мир').click()
    pg.wait_for_selector('.dash-hero h1', timeout=20000); world = pg.url.rstrip('/')
    say('WORLD', world, 'ACCOUNT', f'e2e-kanka-{RUN}@example.com')
    pg.goto(world + '/settings/backup'); pg.wait_for_selector('text=Импорт из Kanka', timeout=20000)
    pg.locator('input[type=file][accept^=".zip"]').last.set_input_files(ZIP)
    pg.wait_for_selector('.summary', timeout=180000)
    for d in pg.locator('.summary details').all(): d.evaluate('e => e.open = true')
    say('=== INSPECTION ===\n' + pg.locator('.summary').inner_text())
    if not INSPECT_ONLY:
        pg.locator('.summary input[type=checkbox]').last.check()
        pg.get_by_role('button', name='Импортировать в этот мир').click()
        pg.wait_for_selector('.result.ok, .result.err', timeout=1800000)
        for d in pg.locator('.result details').all(): d.evaluate('e => e.open = true')
        say('=== REPORT ===\n' + pg.locator('.result').first.inner_text())
        if pg.locator('.log').count(): say('=== LOG (tail) ===\n' + '\n'.join(pg.locator('.log').inner_text().splitlines()[-60:]))
        pg.screenshot(path=os.path.join(OUT, 'kanka-report.png'), full_page=True)
    b.close()
say('=== CONSOLE ===')
for e in list(dict.fromkeys(errors))[:60]: say('  ', e)
