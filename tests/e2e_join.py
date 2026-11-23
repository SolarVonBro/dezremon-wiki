"""Join requests on the live site: a visitor opens an article link, registers, asks for access; the owner accepts / rejects / bans."""
import os, sys, random, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:5173/')
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(10000, 99999))
errors, fails = [], []
state = {}
PAGES = {}


def step(name, fn):
    print('->', name, flush=True)
    try:
        fn()
    except Exception as e:
        msg = (str(e) or repr(e)).splitlines()[0]
        fails.append(f'{name}: {msg[:240]}')
        print('   FAILED:', msg[:200], flush=True)
        for nm, pg_ in list(PAGES.items()):
            try:
                pg_.screenshot(path=os.path.join(OUT, f'FAIL-{len(fails)}-{nm}.png'))
                print('     ', nm, 'url:', pg_.url)
            except Exception:
                pass


def shot(pg, name, full=False):
    pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


def fill_register(pg, nick, email):
    pg.get_by_text('Регистрация', exact=True).last.click()
    pg.locator('input[autocomplete=nickname]').fill(nick)
    pg.locator('input[type=email]').fill(email)
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Зарегистрироваться').click()


def watch(pg, label):
    pg.on('console', lambda m: errors.append(f'[{label}] {m.text[:300]} @ {m.location.get("url", "")[-40:]}:{m.location.get("lineNumber")}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'[{label}] pageerror {str(e)[:300]}'))
    pg.on('dialog', lambda d: d.accept())


def create(pg, typ, name, vis):
    pg.locator('.sidebar').get_by_role('button', name='Создать', exact=True).click()
    pg.locator('.type-tile', has_text=typ).click()
    pg.locator('.modal input.input').first.fill(name)
    pg.locator('.modal .vis-opt', has_text=vis).click()
    pg.get_by_role('button', name='Создать и редактировать').click()
    pg.wait_for_selector('.hero-name-input', timeout=20000)
    url = pg.url
    pg.get_by_role('button', name='Готово').click()
    pg.wait_for_timeout(800)
    return url


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    oc = b.new_context(viewport={'width': 1440, 'height': 950})
    own = oc.new_page(); watch(own, 'owner')
    vc = b.new_context(viewport={'width': 1440, 'height': 950})
    vis = vc.new_page(); watch(vis, 'visitor')
    FSLOG = []
    if os.environ.get('DBG_FS'):
        vc.add_init_script("localStorage.setItem('dw.fsdebug','1')")
        vis.on('console', lambda m: FSLOG.append(m.text[:600]) if 'Firestore' in m.text else None)
    PAGES.update(owner=own, visitor=vis)

    def owner_setup():
        own.goto(BASE + '#/login')
        fill_register(own, 'Владелец Заявок', f'e2e-jown-{RUN}@example.com')
        own.wait_for_selector('text=Мои миры', timeout=20000)
        own.get_by_role('button', name='Новый мир').click()
        own.locator('.modal input.input').first.fill('E2E заявки ' + RUN)
        own.locator('.modal label.check', has_text='Открыт').locator('input').check()
        own.get_by_role('button', name='Создать мир').click()
        own.wait_for_selector('.dash-hero h1', timeout=20000)
        state['world'] = own.url.rstrip('/')
        print('   WORLD', state['world'].split('/w/')[1])
        state['article'] = create(own, 'Локация', 'Открытый город', 'Всем')
        create(own, 'Персонаж', 'Тайный союзник', 'Участникам мира')
        print('   article', state['article'])

    def visitor_link_register():
        vis.goto(state['article']); vis.wait_for_selector('.join-banner', timeout=20000)
        assert vis.locator('text=Открытый город').count() >= 1, 'guest does not see the public article'
        shot(vis, 'j1-guest-banner')
        vis.locator('.join-banner').get_by_role('link', name='Войти').click()
        vis.wait_for_selector('input[type=email]', timeout=15000)
        fill_register(vis, 'Гость Просящий', f'e2e-jvis-{RUN}@example.com')
        # back on the same article, the request dialog opens by itself
        vis.wait_for_selector('.modal >> text=Попросить доступ к миру', timeout=25000)
        assert state['article'].split('#')[1] in vis.url, f'not returned to the article: {vis.url}'
        assert 'Открытый город' in vis.locator('.modal').inner_text(), 'dialog does not mention the article'
        shot(vis, 'j2-auto-dialog')
        vis.locator('.modal textarea').fill('Я играю у вас по пятницам, пустите пожалуйста')
        vis.get_by_role('button', name='Отправить заявку').click()
        vis.wait_for_selector('.join-banner >> text=Заявка на вступление отправлена', timeout=15000)
        shot(vis, 'j3-pending')

    def owner_sees():
        own.goto(state['world']); own.wait_for_selector('.sb-badge', timeout=20000)
        assert own.locator('.sb-badge').inner_text().strip() == '1', 'badge count'
        own.goto(BASE + '#/worlds?tab=requests'); own.wait_for_selector('text=Гость Просящий', timeout=20000)
        assert own.locator('text=пустите пожалуйста').count() == 1, 'message not shown in cabinet'
        shot(own, 'j4-cabinet-requests')
        own.goto(state['world'] + '/settings/members'); own.wait_for_selector('text=Заявки на вступление', timeout=20000)
        assert own.locator('.jr', has_text='Гость Просящий').count() == 1
        shot(own, 'j5-settings-requests')

    def accept():
        assert vis.locator('.ecard, a', has_text='Тайный союзник').count() == 0, 'visitor sees members-only before accept'
        own.locator('.jr', has_text='Гость Просящий').get_by_role('button', name='Принять').click()
        own.wait_for_selector('tr:has-text("Гость Просящий")', timeout=15000)
        assert own.locator('.sb-badge').count() == 0, 'badge still shown'
        # the visitor's open page picks the membership up without a reload
        vis.wait_for_selector('.join-banner', state='detached', timeout=25000)
        vis.goto(state['world'] + '/t/character'); vis.wait_for_selector('.ecard', timeout=20000)
        assert vis.locator('.ecard', has_text='Тайный союзник').count() == 1, 'accepted visitor does not see members article'
        shot(vis, 'j6-member-now')
        vis.goto(BASE + '#/worlds'); vis.wait_for_selector('text=Миры, где я участвую', timeout=20000)
        assert vis.locator('.wcard', has_text='E2E заявки').count() == 1, 'world not in cabinet'

    def reject_and_ban():
        # closed world path: owner removes the member and closes the world; the user asks again from the denied page
        own.goto(state['world'] + '/settings/general'); own.wait_for_selector('text=Открытый мир', timeout=15000)
        own.locator('label.check', has_text='Открытый мир').locator('input').uncheck(); own.wait_for_timeout(1500)
        own.goto(state['world'] + '/settings/members'); own.wait_for_selector('tr:has-text("Гость Просящий")', timeout=20000)
        FSLOG.append('=========== KICK'); own.locator('tr', has_text='Гость Просящий').get_by_role('button', name='Права').click()
        own.wait_for_selector('.mm', timeout=10000)
        own.get_by_role('button', name='Исключить').click(); own.wait_for_timeout(2500)
        vis.goto(state['article']); vis.wait_for_selector('text=Нет доступа к миру', timeout=25000)
        vis.wait_for_selector('.join-banner >> text=Попросить доступ', timeout=15000)
        shot(vis, 'j7-denied-ask')
        vis.locator('.join-banner').get_by_role('button', name='Попросить доступ').click()
        vis.get_by_role('button', name='Отправить заявку').click()
        vis.wait_for_selector('text=Заявка на вступление отправлена', timeout=15000)
        print('   . request sent from denied page', flush=True); FSLOG.append('=========== SENT FROM DENIED PAGE')
        own.wait_for_selector('.jr:has-text("Гость Просящий")', timeout=20000)
        print('   . owner sees it', flush=True)
        own.locator('.jr', has_text='Гость Просящий').get_by_role('button', name='Отклонить').last.click()
        t0 = time.time()
        vis.wait_for_selector('text=Мастер отклонил вашу заявку', timeout=35000)
        print(f'   . visitor sees rejection after {time.time() - t0:.1f}s', flush=True)
        shot(vis, 'j8-rejected')
        vis.get_by_role('button', name='Удалить заявку').click()
        vis.wait_for_selector('.join-banner >> text=Попросить доступ', timeout=15000)
        print('   . visitor deleted rejected request', flush=True)
        vis.locator('.join-banner').get_by_role('button', name='Попросить доступ').click()
        vis.get_by_role('button', name='Отправить заявку').click()
        vis.wait_for_selector('text=Заявка на вступление отправлена', timeout=15000)
        own.wait_for_selector('.jr:has-text("Гость Просящий")', timeout=20000)
        jr = own.locator('.jr', has_text='Гость Просящий')
        jr.locator('.icon-btn[title="Ещё"]').click()
        own.locator('.menu-item', has_text='Отклонить и заблокировать').click(); own.wait_for_timeout(2500)
        assert own.locator('.card', has_text='Заблокированные').count() == 1, 'ban list missing'
        vis.wait_for_timeout(2500)
        vis.reload(); vis.wait_for_selector('text=Нет доступа к миру', timeout=25000); vis.wait_for_timeout(2000)
        vis.locator('.join-banner').get_by_role('button', name='Попросить доступ').click()
        vis.get_by_role('button', name='Отправить заявку').click(); vis.wait_for_timeout(2500)
        assert vis.locator('.toast.error', has_text='закрыл вам доступ').count() == 1, 'banned user could send request'
        shot(vis, 'j9-banned')

    def newcomer_closed():
        nc = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        np_ = nc.new_page(); watch(np_, 'newcomer'); PAGES['newcomer'] = np_
        np_.goto(state['article']); np_.wait_for_selector('text=Нет доступа к миру', timeout=25000)
        np_.get_by_role('link', name='Войти').click(); np_.wait_for_selector('input[type=email]', timeout=15000)
        fill_register(np_, 'Новичок Закрытого', f'e2e-jnew-{RUN}@example.com')
        np_.wait_for_selector('.modal >> text=Попросить доступ к миру', timeout=25000)
        shot(np_, 'j10-closed-auto-dialog')
        np_.get_by_role('button', name='Отправить заявку').click()
        np_.wait_for_selector('text=Заявка на вступление отправлена', timeout=15000)
        shot(np_, 'j11-closed-pending')
        own.goto(state['world'] + '/settings/members'); own.wait_for_selector('.jr:has-text("Новичок Закрытого")', timeout=20000)
        own.locator('.jr', has_text='Новичок Закрытого').get_by_role('button', name='Принять').click()
        t0 = time.time()
        np_.wait_for_selector('.hero-body h1', timeout=35000)
        print(f'   . newcomer let in after {time.time() - t0:.1f}s', flush=True)
        np_.wait_for_timeout(1500)
        assert np_.locator('text=Нет доступа к миру').count() == 0
        shot(np_, 'j12-closed-member')
        nc.close(); PAGES.pop('newcomer', None)

    def dump_fs():
        with open(os.path.join(OUT, 'fslog.txt'), 'w', encoding='utf-8') as f:
            f.write(chr(10).join(FSLOG))

    def delete_world():
        own.goto(state['world'] + '/settings/general'); own.wait_for_selector('text=Опасная зона', timeout=15000)
        own.get_by_role('button', name='Удалить мир…').click()
        own.locator('.modal input.input').fill('E2E заявки ' + RUN)
        own.get_by_role('button', name='Удалить навсегда').click()
        own.wait_for_selector('text=Мои миры', timeout=60000)

    step('owner: public world with public + members articles', owner_setup)
    step('visitor: article link -> login -> auto dialog -> request', visitor_link_register)
    step('owner: badge, cabinet and settings show the request', owner_sees)
    step('owner accepts; visitor gets access live', accept)
    step('closed world: request from denied page, reject, ban', reject_and_ban)
    step('closed world: newcomer from a link is let in live', newcomer_closed)
    step('owner: delete world', delete_world)
    dump_fs()
    b.close()

print('\nFAILS:' if fails else '\nno step failures')
for f in fails: print('  ', f)
u = list(dict.fromkeys(errors))
print('console errors:' if u else 'no console errors')
for e in u[:20]: print('  ', e)
