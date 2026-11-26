"""Auth resilience & login UX checks:
   - Session stored in localStorage (browserLocalPersistence) survives IndexedDB hangs and broken IDB writes
   - Legacy sessions stored in IndexedDB (firebaseLocalStorageDb) transparently migrate to localStorage on load
   - Full localStorage falls back cleanly instead of blocking email/password sign-in
   - Blocked/hung Google popup/iframe never locks out the email/password form and offers redirect + cancel
   - ?next=/login never traps the user on the login screen
   - Clear Russian error messages for invalid credentials, disabled account, network failure, and empty redirect return
   - In-app browser (Telegram/Discord) and blocked-storage banners appear when relevant
   - Closed world does not lose access or cache on transient offline errors, and recovers automatically when back online

   EMULATORS ONLY:
   firebase emulators:start --only firestore,auth --project demo-dezremon
   MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
   python tests/e2e_auth.py"""
import sys, os, json, random, time, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
RUN = str(random.randint(10000, 99999))
EMAIL = f'auth-ok-{RUN}@example.com'
OWNER_EMAIL = f'auth-own-{RUN}@example.com'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'
AUTH_EMU = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon'


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


def put(path, data):
    rest('PATCH', f'{FS}/{path}', {'fields': {k: enc(x) for k, x in data.items()}})


def account(email, name, password='secret123'):
    return rest('POST', f'{AUTH_EMU}/accounts', {'email': email, 'password': password, 'displayName': name})['localId']


def disable_account(uid, disabled):
    rest('POST', f'{AUTH_EMU}/accounts:update', {'localId': uid, 'disableUser': disabled})


UID = account(EMAIL, 'Игрок Авторизация')
OWN_UID = account(OWNER_EMAIL, 'Мастер Мира')
T0 = int(time.time() * 1000) - 3600_000
W = 'e2eauth' + RUN
put(f'worlds/{W}', {'name': 'Мир проверки входа ' + RUN, 'description': '', 'ownerId': OWN_UID, 'isPublic': False,
                    'imageId': None, 'headerImageId': None, 'aclVersion': 0, 'createdAt': T0, 'updatedAt': T0,
                    'settings': {'disabledTypes': [], 'customTypes': [], 'playerCreateTypes': ['journal'],
                                 'playersCanPost': True, 'defaultVisibility': 'members', 'dashboardPins': [],
                                 'mainCalendarId': None, 'accent': None}})
put(f'worlds/{W}/members/{OWN_UID}', {'uid': OWN_UID, 'role': 'owner', 'displayName': 'Мастер Мира', 'email': OWNER_EMAIL, 'photoURL': None, 'joinedAt': T0})
put(f'worlds/{W}/members/{UID}', {'uid': UID, 'role': 'player', 'displayName': 'Игрок Авторизация', 'email': EMAIL, 'photoURL': None, 'joinedAt': T0})

FAILS = []


def check(cond, what):
    print('ok  ' if cond else 'FAIL', what, flush=True)
    if not cond: FAILS.append(what)


def wait_for(fn, timeout=12):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if fn(): return True
        except Exception:
            pass
        time.sleep(0.25)
    return False


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    errs = []

    def new_page(ctx):
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
        return pg

    def login(pg, email, password='secret123'):
        pg.goto(BASE + '#/login')
        pg.wait_for_selector('input[type=email]', timeout=15000)
        pg.locator('input[type=email]').fill(email)
        pg.locator('input[type=password]').fill(password)
        pg.get_by_role('button', name='Войти', exact=True).click()

    print('== 1. localStorage persistence survives hung IndexedDB on reload')
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = new_page(ctx)
    login(pg, EMAIL)
    pg.wait_for_url('**/#/worlds**', timeout=20000)
    ls_keys = pg.evaluate("() => Object.keys(localStorage).filter(k => k.startsWith('firebase:authUser:'))")
    check(len(ls_keys) == 1, f'session saved in localStorage ({ls_keys})')

    # Open another tab in the same context where IndexedDB hangs indefinitely
    pg2 = new_page(ctx)
    pg2.add_init_script("""
      const origOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = function(name) {
        if (name === 'firebaseLocalStorageDb') return { addEventListener() {}, removeEventListener() {} };
        return origOpen.apply(this, arguments);
      };
    """)
    pg2.goto(BASE + '#/worlds')
    check(wait_for(lambda: 'Миры' in pg2.locator('h1').inner_text() and '/worlds' in pg2.url, timeout=12),
          'user stays logged in on #/worlds even when IndexedDB hangs')
    ctx.close()

    print('== 2. Legacy IndexedDB session migrates seamlessly to localStorage without logging out')
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = new_page(ctx)
    login(pg, EMAIL)
    pg.wait_for_url('**/#/worlds**', timeout=20000)
    # Move the stored auth record from localStorage into IndexedDB (simulating an existing user before this update)
    pg.evaluate("""async () => {
      const k = Object.keys(localStorage).find(x => x.startsWith('firebase:authUser:'));
      const val = JSON.parse(localStorage.getItem(k));
      localStorage.removeItem(k);
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('firebaseLocalStorageDb', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction('firebaseLocalStorage', 'readwrite');
        tx.objectStore('firebaseLocalStorage').put({ fbase_key: k, value: val });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    }""")
    pg.reload()
    check(wait_for(lambda: '/worlds' in pg.url and 'Миры' in pg.locator('h1').inner_text(), timeout=15),
          'legacy IndexedDB user stays logged in after update')
    migrated = pg.evaluate("() => Object.keys(localStorage).filter(k => k.startsWith('firebase:authUser:'))")
    check(len(migrated) == 1, f'legacy IndexedDB session migrated to localStorage ({migrated})')
    ctx.close()

    print('== 3. Broken IndexedDB writes & full localStorage never block signing in')
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = new_page(ctx)
    pg.add_init_script("""
      const origPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(val, ...rest) {
        if (val && typeof val.fbase_key === 'string' && val.fbase_key.includes('authUser')) {
          throw new DOMException('The database connection is closing.', 'InvalidStateError');
        }
        return origPut.call(this, val, ...rest);
      };
    """)
    login(pg, EMAIL)
    err3a = lambda: pg.locator('.danger').inner_text() if pg.locator('.danger').count() else ''
    check(wait_for(lambda: '/worlds' in pg.evaluate('location.href'), timeout=15), f'sign-in succeeds even when IndexedDB writes fail (url={pg.evaluate("location.href")} err={err3a()})')
    ctx.close()

    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = new_page(ctx)
    pg.add_init_script("""
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) {
        if (this === window.localStorage && k.startsWith('firebase:authUser:')) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        return origSet.call(this, k, v);
      };
    """)
    login(pg, EMAIL)
    err3b = lambda: pg.locator('.danger').inner_text() if pg.locator('.danger').count() else ''
    check(wait_for(lambda: '/worlds' in pg.evaluate('location.href'), timeout=15), f'sign-in succeeds via fallback even when localStorage throws QuotaExceededError (url={pg.evaluate("location.href")} err={err3b()})')
    ss_keys = pg.evaluate("() => Object.keys(sessionStorage).filter(k => k.startsWith('firebase:authUser:'))")
    check(len(ss_keys) == 1, f'fallback persisted session in sessionStorage ({ss_keys})')
    ctx.close()

    print('== 4. ?next=/login does not trap user on login screen')
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = new_page(ctx)
    pg.goto(BASE + '#/login?next=/login')
    pg.wait_for_selector('input[type=email]', timeout=15000)
    pg.locator('input[type=email]').fill(EMAIL)
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Войти', exact=True).click()
    err4 = lambda: pg.locator('.danger').inner_text() if pg.locator('.danger').count() else ''
    check(wait_for(lambda: '/worlds' in pg.evaluate('location.href'), timeout=15), f'redirected past /login ({pg.evaluate("location.href")} err={err4()})')
    ctx.close()

    print('== 5. Clear Russian errors & non-blocking Google popup/redirect UX')
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = new_page(ctx)
    # Invalid password hint mentions Google sign-in
    login(pg, EMAIL, 'wrongpass123')
    pg.wait_for_selector('.danger', timeout=10000)
    err_txt = pg.locator('.danger').inner_text()
    check('Google' in err_txt and 'Firebase:' not in err_txt, f'invalid-credential error is Russian & helpful ({err_txt})')

    # Network error translated
    pg.route('**/*127.0.0.1:9099/**', lambda r: r.abort('failed'))
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Войти', exact=True).click()
    check(wait_for(lambda: 'Нет связи с сервером авторизации' in (pg.locator('.danger').inner_text() if pg.locator('.danger').count() else '')),
          'network-request-failed translated to Russian')
    pg.unroute('**/*127.0.0.1:9099/**')

    # Disabled user error translated
    disable_account(UID, True)
    pg.get_by_role('button', name='Войти', exact=True).click()
    check(wait_for(lambda: 'отключён администратором' in (pg.locator('.danger').inner_text() if pg.locator('.danger').count() else '')),
          'user-disabled translated to Russian')
    disable_account(UID, False)

    # Empty Google redirect return shows clear explanation
    pg.evaluate("sessionStorage.setItem('dw.googleRedirectAt', String(Date.now()))")
    pg.reload()
    pg.wait_for_selector('.danger', timeout=10000)
    redir_err = pg.locator('.danger').inner_text()
    check('сторонние cookies' in redir_err, f'empty Google redirect return explained ({redir_err[:80]})')
    ctx.close()

    print('== 6. In-app browser warning & email form stays usable while Google popup waits')
    ctx = b.new_context(
        user_agent='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Telegram',
        viewport={'width': 390, 'height': 844},
    )
    pg = new_page(ctx)
    pg.goto(BASE + '#/login')
    pg.wait_for_selector('.auth-hint', timeout=15000)
    check('встроенном браузере' in pg.locator('.auth-hint').inner_text(), 'in-app browser warning shown for Telegram UA')
    # Block emulator auth iframe so Google popup waits, confirm email login button stays enabled!
    pg.route('**/*127.0.0.1:9099/emulator/auth/iframe*', lambda r: None)  # never fulfills
    pg.get_by_role('button', name='Войти через Google').click()
    time.sleep(0.5)
    check(not pg.get_by_role('button', name='Войти', exact=True).is_disabled(),
          'email login button remains enabled while Google popup is waiting')
    check(wait_for(lambda: pg.get_by_text('Войти без всплывающего окна').count() > 0, timeout=7),
          'redirect fallback link appears when Google popup takes too long')
    pg.get_by_text('Отмена').click()
    check(wait_for(lambda: not pg.get_by_role('button', name='Войти через Google').is_disabled(), timeout=3),
          'cancel link unlocks Google button immediately')
    ctx.close()

    print('== 7. Closed world recovers automatically when connection returns')
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = new_page(ctx)
    login(pg, EMAIL)
    pg.wait_for_url('**/#/worlds**', timeout=15000)
    pg.goto(BASE + f'#/w/{W}')
    pg.wait_for_selector('.sb-world-name', timeout=15000)
    pg.route('**/*127.0.0.1:8080/**', lambda r: r.abort('failed'))
    pg.reload()
    check(wait_for(lambda: 'Ошибка загрузки' in pg.locator('body').inner_text(), timeout=12),
          'offline closed world shows error (not "Нет доступа")')
    pg.unroute('**/*127.0.0.1:8080/**')
    pg.evaluate("window.dispatchEvent(new Event('online'))")
    check(wait_for(lambda: pg.locator('.sb-world-name').count() > 0, timeout=15),
          'closed world recovers automatically on online event')
    ctx.close()

    check(not errs, f'no uncaught pageerrors ({errs[:5]})')
    b.close()

print('\nFAILED:' if FAILS else '\nALL OK', *FAILS, sep='\n  ')
sys.exit(1 if FAILS else 0)
