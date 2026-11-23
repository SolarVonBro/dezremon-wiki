"""Characters of members: a member plays any number of characters, a character has one player. Masters assign a
   character on its page (block «Игрок») or in the member's card; the member finds them under «Мои персонажи» (world
   menu, overview block, world card). A member with the older single characterId keeps it. EMULATORS ONLY:
   firebase emulators:start --only firestore,auth --project demo-dezremon
   MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
   python tests/e2e_characters.py <screenshots dir>"""
import sys, os, json, random, time, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-characters'
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
GM, PL = f'gm{RUN}@example.com', f'pl{RUN}@example.com'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'


def rest(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read() or b'{}')


def account(email, name):
    return rest('POST', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts',
                {'email': email, 'password': 'secret123', 'displayName': name})['localId']


account(GM, 'Мастер Игры')
PL_UID = account(PL, 'Игрок Анна')
FAILS = []


def check(cond, what):
    print('ok  ' if cond else 'FAIL', what, flush=True)
    if not cond: FAILS.append(what)


def member(wid, uid):
    f = rest('GET', f'{FS}/worlds/{wid}/members/{uid}')['fields']
    ids = [v['stringValue'] for v in f.get('characterIds', {}).get('arrayValue', {}).get('values', [])]
    return ids, f.get('characterId', {}).get('stringValue')


def entity(wid, eid):
    f = rest('GET', f'{FS}/worlds/{wid}/entities/{eid}')['fields']
    return f['visibility']['stringValue'], [v['stringValue'] for v in f.get('allowedUids', {}).get('arrayValue', {}).get('values', [])]


def wait_for(fn, timeout=8):
    t = time.time()
    while time.time() - t < timeout:
        if fn(): return True
        time.sleep(0.3)
    return False


SEED = r"""async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const world = pinia._s.get('world')
  const ids = {}
  ids.arwen = await world.createEntity('character', 'Арвен Тихая', { visibility: 'members' }, '<p>Целительница.</p>')
  ids.kael = await world.createEntity('character', 'Кайл Ворон', { visibility: 'members' }, '<p>Наёмник.</p>')
  ids.secret = await world.createEntity('character', 'Тайный двойник', { visibility: 'master' }, '<p>Скрытый.</p>')
  ids.old = await world.createEntity('character', 'Старый герой', { visibility: 'members' }, '<p>Назначен по-старому.</p>')
  for (let i = 0; i < 50 && world.pendingWrites > 0; i++) await new Promise((r) => setTimeout(r, 200))
  return ids
}"""


def login(pg, email):
    pg.goto(BASE + '#/login')
    pg.locator('input[type=email]').fill(email); pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Войти', exact=True).click()
    pg.wait_for_url('**/#/worlds**', timeout=20000)


def pick_in_modal(pg, name):
    sec = pg.locator('.mm .card', has_text='Персонажи (')
    sec.locator('.picker-btn').click(); pg.locator('.picker-menu input').fill(name.split()[0])
    pg.locator('.picker-menu .menu-item', has_text=name).click(); pg.wait_for_timeout(1200)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    gm = b.new_context(viewport={'width': 1440, 'height': 960}).new_page()
    errs = []
    gm.on('console', lambda m: errs.append(f'gm {m.type}: {m.text[:300]}') if m.type == 'error' else None)
    gm.on('pageerror', lambda e: errs.append('gm pageerror: ' + str(e)[:400]))

    print('== a world with four characters and a player who has one the old way (characterId)')
    login(gm, GM)
    gm.get_by_role('button', name='Новый мир').first.click()
    gm.locator('input[placeholder="Дезремон"]').fill('Мир героев ' + RUN)
    gm.get_by_role('button', name='Создать мир').click()
    gm.wait_for_selector('.db-grid', timeout=20000)
    wid = gm.url.split('/w/')[1].split('/')[0].split('?')[0]
    ids = gm.evaluate(SEED)
    rest('POST', f'{FS}/worlds/{wid}/members?documentId={PL_UID}', {'fields': {
        'uid': {'stringValue': PL_UID}, 'role': {'stringValue': 'player'}, 'displayName': {'stringValue': 'Игрок Анна'},
        'email': {'stringValue': PL}, 'photoURL': {'nullValue': None}, 'joinedAt': {'integerValue': str(int(time.time() * 1000))},
        'characterId': {'stringValue': ids['old']}}})
    gm.wait_for_timeout(1000)

    print('== the character page: block «Игрок»')
    gm.goto(BASE + f'#/w/{wid}/e/{ids["arwen"]}'); gm.wait_for_selector('.char-player', timeout=15000)
    sel = gm.locator('.char-player select')
    opts = sel.locator('option').all_inner_texts()
    check(opts[0].startswith('—') and 'Игрок Анна' in opts[1] and any('Мастер Игры (владелец)' in o for o in opts), f'options: nobody, players, then masters ({opts})')
    sel.select_option(label='Игрок Анна')
    check(wait_for(lambda: member(wid, PL_UID)[0] == [ids['old'], ids['arwen']]), f'Arwen added next to the old one ({member(wid, PL_UID)})')
    check(member(wid, PL_UID)[1] is None, 'the old single characterId is folded into characterIds')
    check('Анна найдёт статью' in gm.locator('.char-player').inner_text(), 'hint: where the player finds it')
    gm.screenshot(path=os.path.join(OUT, 'c-1-character-page.png'))

    print('== a hidden character: a warning and «Открыть доступ»')
    gm.goto(BASE + f'#/w/{wid}/e/{ids["secret"]}'); gm.wait_for_selector('.char-player', timeout=15000)
    gm.locator('.char-player select').select_option(label='Игрок Анна'); gm.wait_for_timeout(1000)
    warn = gm.locator('.char-player .cp-warn')
    check(warn.count() == 1 and 'не может открыть' in warn.inner_text(), 'warning: the player cannot open it')
    gm.screenshot(path=os.path.join(OUT, 'c-2-hidden-warning.png'))
    warn.get_by_role('button', name='Открыть доступ').click()
    check(wait_for(lambda: entity(wid, ids['secret']) == ('custom', [PL_UID])), f'visibility custom with the player ({entity(wid, ids["secret"])})')
    check(gm.locator('.char-player .cp-warn').count() == 0, 'the warning is gone')

    print('== the member card: a list; adding a character takes it from its previous player')
    gm.goto(BASE + f'#/w/{wid}/e/{ids["kael"]}'); gm.wait_for_selector('.char-player', timeout=15000)
    gm.locator('.char-player select').select_option(label='Мастер Игры (владелец)'); gm.wait_for_timeout(1000)
    from_gm = member(wid, gm.evaluate("document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('world').uid"))[0]
    check(from_gm == [ids['kael']], f'Kael is the master\'s for now ({from_gm})')
    gm.goto(BASE + f'#/w/{wid}/settings/members'); gm.wait_for_selector('tr', timeout=15000)
    row = gm.locator('tr', has_text='Игрок Анна')
    check(all(n in row.inner_text() for n in ['Старый герой', 'Арвен Тихая', 'Тайный двойник']), 'members table: all of her characters')
    row.get_by_role('button', name='Права').click(); gm.wait_for_selector('.mm', timeout=10000)
    sec = gm.locator('.mm .card', has_text='Персонажи (')
    check('персонажи (3)' in sec.inner_text().lower() and sec.locator('.rel-row').count() == 3, f'card: three characters listed ({sec.locator(".rel-row").count()})')
    pick_in_modal(gm, 'Кайл Ворон')
    gm_uid = gm.evaluate("document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('world').uid")
    check(wait_for(lambda: len(member(wid, PL_UID)[0]) == 4 and member(wid, gm_uid)[0] == []), f'Kael moved from the master to Anna ({member(wid, PL_UID)[0]}, {member(wid, gm_uid)[0]})')
    check(sec.locator('.rel-row').count() == 4, 'card: four now')
    gm.screenshot(path=os.path.join(OUT, 'c-3-member-card.png'))
    gm.locator('.modal-head .icon-btn').first.click(); gm.wait_for_timeout(300)

    print('== «Глазами игрока»: her characters under «Мои персонажи»')
    gm.goto(BASE + f'#/w/{wid}'); gm.wait_for_selector('.db-grid', timeout=15000)
    sec = gm.locator('.sidebar .sb-chars')
    check(sec.count() == 1 and 'персонажей пока нет' in sec.inner_text().lower() and sec.locator('.sb-link').count() == 0, 'the master has no characters: the section is there, empty')
    check(sec.locator('button[title="Создать своего персонажа"]').count() == 1, 'the master may create one: «+»')
    gm.get_by_role('button', name='Глазами игрока').click()
    gm.locator('.menu .menu-item', has_text='Игрок Анна').click(); gm.wait_for_timeout(1200)
    names = gm.locator('.sidebar .sb-chars .sb-link').all_inner_texts()
    check([n.strip() for n in names] == ['Арвен Тихая', 'Кайл Ворон', 'Старый герой', 'Тайный двойник'], f'sidebar «Мои персонажи» ({names})')
    check(gm.locator('.sidebar .sb-section-title', has_text='Мои персонажи').count() == 1, 'section title «Мои персонажи»')
    gm.screenshot(path=os.path.join(OUT, 'c-4-preview-sidebar.png'))
    gm.locator('.sidebar .sb-chars .sb-link', has_text='Арвен').click(); gm.wait_for_selector('.char-player', timeout=10000)
    check(gm.locator('.char-player select').count() == 0 and 'Игрок Анна' in gm.locator('.char-player').inner_text(), 'in preview the block is read-only')
    gm.get_by_role('button', name='Выйти из просмотра').click(); gm.wait_for_timeout(600)

    print('== the player herself')
    pl = b.new_context(viewport={'width': 1440, 'height': 960}).new_page()
    pl.on('console', lambda m: errs.append(f'pl {m.type}: {m.text[:300]}') if m.type == 'error' else None)
    pl.on('pageerror', lambda e: errs.append('pl pageerror: ' + str(e)[:400]))
    login(pl, PL)
    card = pl.locator('.wcard', has_text='Мир героев ' + RUN)
    btn = card.get_by_role('button', name='Мои персонажи · 4')
    btn.wait_for(timeout=15000)
    check(btn.count() == 1, 'world card: «Мои персонажи · 4»')
    btn.click(); pl.wait_for_timeout(1500)
    items = [t.strip() for t in pl.locator('.menu .menu-item').all_inner_texts() if t.strip()]
    check(sorted(items) == sorted(['Арвен Тихая', 'Кайл Ворон', 'Тайный двойник', 'Старый герой']), f'its menu lists the names ({items})')
    pl.screenshot(path=os.path.join(OUT, 'c-5-world-card.png'))
    pl.locator('.menu .menu-item', has_text='Кайл').click(); pl.wait_for_selector('.char-player', timeout=20000); pl.wait_for_timeout(800)
    cp = pl.locator('.char-player').inner_text()
    check('Игрок Анна' in cp and 'это вы' in cp and pl.locator('.char-player select').count() == 0, f'her character\'s page: «Игрок Анна · это вы» ({cp!r})')
    check(len(pl.locator('.sidebar .sb-chars .sb-link').all_inner_texts()) == 4, 'her sidebar: four characters')
    check(pl.locator('.sidebar .sb-chars button[title="Создать своего персонажа"]').count() == 0, 'players may not create characters here: no «+»')
    pl.goto(BASE + f'#/w/{wid}'); pl.wait_for_selector('.db-grid', timeout=15000); pl.wait_for_timeout(1000)
    block = pl.locator('.dbv-chars a')
    check(block.count() == 4, f'overview block «Мои персонажи»: four ({block.count()})')
    pl.screenshot(path=os.path.join(OUT, 'c-6-player-overview.png'))

    print('== taking characters away')
    gm.goto(BASE + f'#/w/{wid}/settings/members'); gm.wait_for_selector('tr', timeout=15000)
    gm.locator('tr', has_text='Игрок Анна').get_by_role('button', name='Права').click(); gm.wait_for_selector('.mm', timeout=10000)
    sec = gm.locator('.mm .card', has_text='Персонажи (')
    sec.locator('.rel-row', has_text='Тайный двойник').locator('button[title="Снять персонажа"]').click()
    check(wait_for(lambda: ids['secret'] not in member(wid, PL_UID)[0]), 'removed in the member card')
    gm.locator('.modal-head .icon-btn').first.click(); gm.wait_for_timeout(300)
    gm.goto(BASE + f'#/w/{wid}/e/{ids["arwen"]}'); gm.wait_for_selector('.char-player', timeout=15000)
    gm.locator('.char-player select').select_option(value='')
    check(wait_for(lambda: member(wid, PL_UID)[0] == [ids['old'], ids['kael']] or sorted(member(wid, PL_UID)[0]) == sorted([ids['old'], ids['kael']])), f'«ни за кем» on the page ({member(wid, PL_UID)[0]})')
    pl.wait_for_timeout(1500)
    check(len(pl.locator('.sidebar .sb-chars .sb-link').all_inner_texts()) == 2, 'her sidebar follows live: two')

    real = [e for e in errs if 'favicon' not in e]
    check(not real, f'no console errors ({real[:5]})')
    b.close()

print('\nFAILED:' if FAILS else '\nALL OK', *FAILS, sep='\n  ')
sys.exit(1 if FAILS else 0)
