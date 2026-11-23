"""Comments under articles and the user's page. Comments are read only after «Комментарии» is opened (the number comes
   with the article), follow live, support replies (one level, «→ name» inside a thread), likes, editing, deleting
   (a comment with replies stays as «Комментарий удалён» until its last reply goes), links to a comment (?c=id); they
   mirror the article's visibility. The author's name leads to the user's page: the public card plus shared worlds,
   characters and campaigns. EMULATORS ONLY:
   firebase emulators:start --only firestore,auth --project demo-dezremon
   MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
   python tests/e2e_comments.py <screenshots dir>"""
import sys, os, json, random, time, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-comments'
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
GM, PL = f'gm{RUN}@example.com', f'pl{RUN}@example.com'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'


def rest(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read() or b'{}')


def enc(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [enc(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: enc(x) for k, x in v.items()}}}
    raise TypeError(v)


def dec(v):
    if 'stringValue' in v: return v['stringValue']
    if 'integerValue' in v: return int(v['integerValue'])
    if 'booleanValue' in v: return v['booleanValue']
    if 'nullValue' in v: return None
    if 'arrayValue' in v: return [dec(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v: return {k: dec(x) for k, x in v['mapValue'].get('fields', {}).items()}
    return v


def put(path, data): rest('PATCH', f'{FS}/{path}', {'fields': {k: enc(x) for k, x in data.items()}})


def get(path):
    try:
        return {k: dec(x) for k, x in rest('GET', f'{FS}/{path}')['fields'].items()}
    except urllib.error.HTTPError:
        return None


def comments(wid, eid):
    res = rest('POST', f'{FS}/worlds/{wid}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'comments'}], 'where': {
        'fieldFilter': {'field': {'fieldPath': 'entityId'}, 'op': 'EQUAL', 'value': {'stringValue': eid}}}}})
    out = [{**{k: dec(x) for k, x in r['document']['fields'].items()}, '_id': r['document']['name'].split('/')[-1]} for r in res if 'document' in r]
    return sorted(out, key=lambda c: c['createdAt'])


def account(email, name):
    return rest('POST', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts',
                {'email': email, 'password': 'secret123', 'displayName': name})['localId']


GM_UID = account(GM, 'Мастер Игры')
PL_UID = account(PL, 'Игрок Анна')
FAILS = []


def check(cond, what):
    print('ok  ' if cond else 'FAIL', what, flush=True)
    if not cond: FAILS.append(what)


def wait_for(fn, timeout=10):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if fn(): return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


T0 = int(time.time() * 1000) - 3600_000
W = 'comments' + RUN
put(f'worlds/{W}', {'name': 'Мир бесед ' + RUN, 'description': '', 'ownerId': GM_UID, 'isPublic': False, 'imageId': None, 'headerImageId': None,
                    'aclVersion': 0, 'createdAt': T0, 'updatedAt': T0,
                    'settings': {'disabledTypes': [], 'customTypes': [], 'playerCreateTypes': ['journal', 'note'], 'playersCanPost': True,
                                 'defaultVisibility': 'members', 'dashboardPins': [], 'mainCalendarId': None, 'accent': None}})
put(f'worlds/{W}/members/{GM_UID}', {'uid': GM_UID, 'role': 'owner', 'displayName': 'Мастер Игры', 'email': GM, 'photoURL': None, 'joinedAt': T0})
put(f'worlds/{W}/members/{PL_UID}', {'uid': PL_UID, 'role': 'player', 'displayName': 'Игрок Анна', 'email': PL, 'photoURL': None, 'joinedAt': T0,
                                     'characterIds': ['hero']})


def ent(eid, typ, name, **extra):
    put(f'worlds/{W}/entities/{eid}', {'id': eid, 'type': typ, 'name': name, 'kind': '', 'tagIds': [], 'visibility': 'members', 'allowedUids': [],
                                       'createdBy': GM_UID, 'updatedBy': GM_UID, 'createdAt': T0, 'updatedAt': T0, 'deleted': False, 'bodyRev': 0, **extra})


ent('art', 'note', 'Летопись войны')
ent('hero', 'character', 'Сир Анвар', kind='PC')
ent('tag-pc', 'tag', 'PC', fields={'charType': 'pc'})
ent('tag-npc', 'tag', 'NPC', fields={'charType': 'npc'})

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    errs = []

    def page():
        pg = b.new_context(viewport={'width': 1440, 'height': 960}).new_page()
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text[:300]}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:400]))
        pg.on('dialog', lambda d: d.accept())
        return pg

    def login(pg, email):
        pg.goto(BASE + '#/login')
        pg.locator('input[type=email]').fill(email); pg.locator('input[type=password]').fill('secret123')
        pg.get_by_role('button', name='Войти', exact=True).click()
        pg.wait_for_url('**/#/worlds**', timeout=20000)

    gm, pl = page(), page()
    login(gm, GM); login(pl, PL)
    ART = f'#/w/{W}/e/art'

    print('== closed until opened; the first comment')
    gm.goto(BASE + ART); gm.wait_for_selector('.comments .cm-toggle', timeout=20000)
    check(gm.locator('.comments .cm-wrap').count() == 0 and gm.locator('.comments .count').count() == 0, 'closed, no number yet, nothing loaded')
    gm.locator('.comments .cm-toggle').click()
    check(wait_for(lambda: 'будьте первым' in gm.locator('.comments').inner_text()), 'empty: «будьте первым»')
    gm.locator('.cm-new textarea').fill('Первый! Подробности: https://example.com/war')
    gm.locator('.cm-new textarea').press('Control+Enter')
    check(wait_for(lambda: len(comments(W, 'art')) == 1), 'Ctrl+Enter sends')
    c1 = comments(W, 'art')[0]
    check(c1['visibility'] == 'members' and c1['allowedUids'] == [GM_UID] and c1['authorName'] == 'Мастер Игры' and c1['parentId'] is None, f'the comment mirrors the article ({c1["visibility"]}, {c1["allowedUids"]})')
    e = get(f'worlds/{W}/entities/art')
    check(e.get('commentCount') == 1 and e.get('commentedAt') == e['updatedAt'], f'the article counts it ({e.get("commentCount")})')
    check(gm.locator('.cm-text a[href="https://example.com/war"]').count() == 1, 'web addresses become links')
    check(wait_for(lambda: gm.locator('.cm-head .cm-role').first.inner_text() == 'владелец'), 'role badge')
    check(gm.locator('.article-card', has_text='Изменено').count() == 0, 'a comment is not shown as an edit of the article')
    gm.screenshot(path=os.path.join(OUT, 'm-1-first.png'))

    print('== the player: the number before opening, a like, a reply')
    pl.goto(BASE + ART); pl.wait_for_selector('.comments .cm-toggle', timeout=20000)
    check(wait_for(lambda: pl.locator('.comments .cm-toggle .count').inner_text() == '1'), 'the number comes with the article')
    check(pl.locator('.comments .cm').count() == 0, 'and nothing is loaded yet')
    pl.locator('.comments .cm-toggle').click(); pl.wait_for_selector('.cm', timeout=10000)
    pl.locator('.cm-act[title="Нравится"]').first.click()
    check(wait_for(lambda: comments(W, 'art')[0]['likes'] == [PL_UID]), 'liked')
    check(wait_for(lambda: pl.locator('.cm-act.on').count() == 1 and '1' in pl.locator('.cm-act.on').inner_text()), 'the heart shows it')
    pl.locator('.cm-act', has_text='Ответить').first.click()
    pl.locator('.cm-reply-box textarea').fill('Согласна, но армия была меньше.')
    pl.locator('.cm-reply-box .btn-primary').click()
    check(wait_for(lambda: len(comments(W, 'art')) == 2), 'reply sent')
    r1 = comments(W, 'art')[1]
    check(r1['parentId'] == c1['_id'] and r1['replyToName'] == '', 'a reply to the top comment: in its thread, no «→ name»')
    check(wait_for(lambda: pl.locator('.cm-replies .cm').count() == 1), 'shown under the comment')
    check(wait_for(lambda: gm.locator('.cm-replies .cm').count() == 1), 'the master sees it live')

    print('== the master answers inside the thread; the player edits')
    gm.locator('.cm-replies .cm .cm-act', has_text='Ответить').click()
    gm.locator('.cm-reply-box textarea').fill('Источники расходятся.')
    gm.locator('.cm-reply-box textarea').press('Control+Enter')
    check(wait_for(lambda: len(comments(W, 'art')) == 3), 'second reply')
    r2 = comments(W, 'art')[2]
    check(r2['parentId'] == c1['_id'] and r2['replyToName'] == 'Игрок Анна' and r2['replyToUid'] == PL_UID, 'inside the thread it names whom it answers')
    check(wait_for(lambda: 'Игрок Анна' in pl.locator('.cm-replies .cm').nth(1).locator('.cm-to').inner_text()), '«→ Игрок Анна» shown')
    pl.locator('.cm-replies .cm').first.locator('.cm-act', has_text='Изменить').click()
    pl.locator('.cm-edit textarea').fill('Согласна, но армия была вдвое меньше.')
    pl.locator('.cm-edit .btn-primary').click()
    check(wait_for(lambda: comments(W, 'art')[1]['text'].endswith('вдвое меньше.') and comments(W, 'art')[1]['editedAt']), 'edited')
    check(wait_for(lambda: 'изменено' in pl.locator('.cm-replies .cm').first.inner_text()), '«изменено» shown')
    check(pl.locator('.cm-act', has_text='Изменить').count() == 1, 'only her own comment can be edited by her')
    check(pl.locator('.cm-act', has_text='Удалить').count() == 1, 'only her own can be deleted by her')
    check(wait_for(lambda: get(f'worlds/{W}/entities/art').get('commentCount') == 3), 'three counted')
    pl.screenshot(path=os.path.join(OUT, 'm-2-thread.png'))

    print('== a link to a comment')
    pl.goto(BASE + f'#/w/{W}/e/hero'); pl.wait_for_selector('.comments', timeout=15000)
    pl.goto(BASE + ART + f'?c={r2["_id"]}')
    check(wait_for(lambda: pl.locator(f'#comment-{r2["_id"]}.hl').count() == 1), 'opens the discussion and marks the comment')

    print('== deleting: a comment with replies stays as a placeholder until its last reply goes')
    gm.locator('.cm-thread > .cm').first.locator('.cm-act', has_text='Удалить').click()
    check(wait_for(lambda: comments(W, 'art')[0].get('removed') is True and comments(W, 'art')[0]['text'] == ''), 'soft-deleted, text wiped')
    check(wait_for(lambda: 'Комментарий удалён' in pl.locator('.comments').inner_text()), 'the player sees «Комментарий удалён»')
    check(wait_for(lambda: get(f'worlds/{W}/entities/art').get('commentCount') == 2), 'two left')
    gm.locator('.cm-replies .cm').nth(1).locator('.cm-act', has_text='Удалить').click()
    check(wait_for(lambda: len(comments(W, 'art')) == 2), 'the master\'s reply is gone')
    pl.locator('.cm-replies .cm').first.locator('.cm-act', has_text='Удалить').click()
    check(wait_for(lambda: len(comments(W, 'art')) == 0), 'her last reply takes the placeholder with it')
    check(wait_for(lambda: get(f'worlds/{W}/entities/art').get('commentCount') == 0), 'none counted')
    check(wait_for(lambda: 'будьте первым' in gm.locator('.comments').inner_text()), 'empty again for the master')

    print('== visibility follows the article')
    pl.locator('.cm-new textarea').fill('Остаётся.'); pl.locator('.cm-new .btn-primary').click()
    check(wait_for(lambda: len(comments(W, 'art')) == 1), 'a new comment')
    gm.evaluate(f"""async () => {{ const w = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('world')
      await w.updateEntity('art', {{ visibility: 'custom', allowedUids: ['{PL_UID}'] }}) }}""")
    check(wait_for(lambda: comments(W, 'art')[0]['visibility'] == 'custom' and sorted(comments(W, 'art')[0]['allowedUids']) == sorted([PL_UID, GM_UID])), f'custom for her and the author ({comments(W, "art")[0]["allowedUids"]})')

    print('== the user\'s page')
    gm.locator('.cm-author').first.click()
    gm.wait_for_url('**/#/u/**', timeout=10000)
    check(gm.url.endswith(f'/u/{PL_UID}'), 'the author\'s name leads to the user\'s page')
    gm.wait_for_selector('.u-head', timeout=15000)
    check('Игрок Анна' in gm.locator('.u-name').inner_text() and 'В сервисе с' in gm.locator('.u-head').inner_text(), 'the public card: name, since')
    check('Сир Анвар' in gm.locator('.u-grid').inner_text() and 'Мир бесед' in gm.locator('.u-char').first.inner_text(), 'her characters with their world')
    check(gm.locator('.u-world', has_text='Мир бесед').count() == 1 and 'Игрок' in gm.locator('.u-world').first.inner_text(), 'shared world with her role')
    check('Общие миры' in gm.locator('.user-page').inner_text(), 'titled «Общие миры» for somebody else')
    gm.screenshot(path=os.path.join(OUT, 'm-3-user-page.png'))
    gm.locator('.u-char').first.click(); gm.wait_for_url('**/e/hero', timeout=10000)
    check(True, 'a character card opens the character')
    prof = get(f'profiles/{PL_UID}')
    check(prof and prof['displayName'] == 'Игрок Анна' and 'email' not in prof and prof['uid'] == PL_UID, f'the card is public without e-mail ({prof and list(prof)})')

    print('== one\'s own page from the account menu; the player block links there too')
    pl.locator('.app-bar .user-btn').click()
    pl.locator('.menu .menu-item', has_text='Личный кабинет').click()
    pl.wait_for_selector('.u-head', timeout=15000)
    check('это вы' in pl.locator('.u-head').inner_text() and 'Миры' in pl.locator('.user-page').inner_text(), 'own page: «это вы», «Миры»')
    pl.goto(BASE + f'#/w/{W}/e/hero'); pl.wait_for_selector('.char-player', timeout=15000)
    pl.locator('.char-player .cp-name').click()
    check(wait_for(lambda: pl.url.endswith(f'/u/{PL_UID}')), 'the «Игрок» block links to the user\'s page')

    print('== phone width')
    gm.set_viewport_size({'width': 390, 'height': 844})
    gm.goto(BASE + ART); gm.wait_for_selector('.comments .cm-toggle', timeout=15000)
    gm.locator('.comments .cm-toggle').click(); gm.wait_for_selector('.cm', timeout=10000)
    gm.locator('.comments').scroll_into_view_if_needed()
    check(gm.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'comments: no sideways scroll on a phone')
    gm.screenshot(path=os.path.join(OUT, 'm-4-phone-comments.png'))
    gm.goto(BASE + f'#/u/{PL_UID}'); gm.wait_for_selector('.u-head', timeout=15000)
    check(gm.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'user page: no sideways scroll on a phone')
    gm.screenshot(path=os.path.join(OUT, 'm-5-phone-user.png'))

    real = [x for x in errs if 'favicon' not in x]
    check(not real, f'no console errors ({real[:5]})')
    b.close()

print('\nFAILED:' if FAILS else '\nALL OK', *FAILS, sep='\n  ')
sys.exit(1 if FAILS else 0)
