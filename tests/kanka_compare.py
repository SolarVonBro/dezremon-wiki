"""Compare a Kanka export with what landed in Firestore after an import.
Usage: python tests/kanka_compare.py <kanka.zip> <worldId> <file with a Google OAuth access token of a project owner> <report.txt>
Reports per-article differences: kind, parent, tags, images, visibility, text length, mentions, families, races,
locations, map markers, org members, posts, links/aliases. Read-only."""
import sys, json, zipfile, urllib.request, re, html, collections
ZIP, WID, TOKF, OUT = sys.argv[1:5]
TOKEN = open(TOKF).read().strip()
P = 'dezremon-wiki-6118'


def fsval(v):
    k, x = next(iter(v.items()))
    if k == 'mapValue':
        return {kk: fsval(vv) for kk, vv in x.get('fields', {}).items()}
    if k == 'arrayValue':
        return [fsval(e) for e in x.get('values', [])]
    if k == 'integerValue':
        return int(x)
    if k == 'nullValue':
        return None
    return x


def listcol(name):
    out, tok = {}, ''
    while True:
        url = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents/worlds/{WID}/{name}?pageSize=300' + (f'&pageToken={tok}' if tok else '')
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOKEN, 'X-Goog-User-Project': P})
        d = json.load(urllib.request.urlopen(req))
        for doc in d.get('documents', []):
            out[doc['name'].split('/')[-1]] = {k: fsval(v) for k, v in doc.get('fields', {}).items()}
        tok = d.get('nextPageToken')
        if not tok:
            return out


C = {n: listcol(n) for n in ['entities', 'bodies', 'secrets', 'relations', 'posts', 'images', 'mapMarkers', 'mapLayers', 'mapGroups', 'orgMembers', 'timelineEras', 'timelineElements', 'reminders']}
ents, bodies, secrets = C['entities'], C['bodies'], C['secrets']
z = zipfile.ZipFile(ZIP)
recs = []
for n in z.namelist():
    if n.endswith('.json') and '/' in n and not n.startswith(('gallery/', 'settings/')):
        recs.append((n.split('/')[0], json.loads(z.read(n))))
TYPE = {'characters': 'character', 'locations': 'location', 'families': 'family', 'organisations': 'organisation', 'items': 'item', 'notes': 'note',
        'events': 'event', 'calendars': 'calendar', 'races': 'race', 'creatures': 'creature', 'quests': 'quest', 'journals': 'journal',
        'abilities': 'ability', 'maps': 'map', 'timelines': 'timeline', 'tags': 'tag'}
byname = collections.defaultdict(list)
for i, e in ents.items():
    byname[(e['name'].strip(), e['type'])].append(i)
kid2ours = {}
for mod, r in recs:
    e = r['entity']
    c = byname.get((e['name'].strip(), TYPE.get(mod)), [])
    if c:
        kid2ours[e['id']] = c[0]
issues = collections.Counter()
samples = collections.defaultdict(list)


def issue(kind, msg):
    issues[kind] += 1
    if len(samples[kind]) < 8:
        samples[kind].append(msg)


def txt(h):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h or ''))).strip()


for mod, r in recs:
    e = r['entity']
    oid = kid2ours.get(e['id'])
    if not oid:
        issue('missing entity', f"{mod}:{e['name']}")
        continue
    o = ents[oid]
    f = o.get('fields') or {}
    if (e.get('type') or '') != (o.get('kind') or ''):
        issue('kind', f"{e['name']}: {repr(e.get('type'))} vs {repr(o.get('kind'))}")
    if e.get('parent_id') and kid2ours.get(e['parent_id']) != o.get('parentId'):
        issue('parent', e['name'])
    if bool(e.get('image_uuid') or e.get('image_path')) != bool(o.get('imageId')):
        issue('image', f"{e['name']}: kanka={e.get('image_uuid') or e.get('image_path')} ours={o.get('imageId')}")
    if bool(e.get('header_uuid') or e.get('header_image')) != bool(o.get('headerImageId')):
        issue('header image', e['name'])
    tags = [t['tag_id'] for t in e.get('entityTags', [])]
    if len(tags) != len(o.get('tagIds') or []):
        issue('tags', f"{e['name']}: {len(tags)} vs {len(o.get('tagIds') or [])}")
    if bool(e.get('is_private')) != (o.get('visibility') == 'master'):
        issue('visibility', f"{e['name']}: private={e.get('is_private')} vis={o.get('visibility')}")
    src = e.get('entry') or r.get('entry') or ''
    body = (secrets.get(oid) or {}).get('html') or (bodies.get(oid) or {}).get('html') or ''
    ls = len(txt(re.sub(r'\[[a-z_]+:\d+(\|[^\]]*)?\]', 'X', src)))
    lo = len(txt(body))
    if ls and abs(ls - lo) > max(40, ls * 0.08):
        issue('text length', f"{e['name']}: kanka {ls} vs ours {lo}")
    km = len(re.findall(r'\[[a-z_]+:\d+', src))
    om = body.count('data-entity-id')
    if km != om:
        issue('mentions', f"{e['name']}: {km} vs {om}")
    if len(re.findall(r'<img', src)) != body.count('<img'):
        issue('inline images', f"{e['name']}: {len(re.findall('<img', src))} vs {body.count('<img')}")
    if src and not body:
        issue('empty body', e['name'])
    if mod == 'characters':
        fams = [x['family_id'] for x in r.get('characterFamilies', [])]
        if len(fams) != len(f.get('familyIds') or []):
            issue('char families', f"{e['name']}: {len(fams)} vs {len(f.get('familyIds') or [])}")
        races = set([x['race_id'] for x in r.get('characterRaces', [])] + ([r['race_id']] if r.get('race_id') else []))
        if len(races) != len(f.get('raceIds') or []):
            issue('char races', f"{e['name']}: {races} vs {f.get('raceIds')}")
        locs = [x['location_id'] for x in e.get('entityLocations', [])]
        if bool(locs) != bool(f.get('locationId')):
            issue('char location', f"{e['name']}: {locs} vs {f.get('locationId')}")
        if len(locs) > 1:
            issue('char multi-location (only first kept)', f"{e['name']}: {len(locs)}")
        traits = r.get('characterTraits', [])
        if len(traits) != len(f.get('appearance') or []) + len(f.get('personality') or []):
            issue('traits', f"{e['name']}: {len(traits)}")
        for k in ('title', 'age', 'sex', 'pronouns'):
            if (r.get(k) or '') != (f.get(k) or ''):
                issue('char field ' + k, f"{e['name']}: {repr(r.get(k))} vs {repr(f.get(k))}")
        if r.get('organisationMemberships'):
            pass
    if mod in ('families', 'organisations', 'races', 'creatures', 'items', 'locations', 'journals', 'notes', 'maps'):
        locs = [x['location_id'] for x in e.get('entityLocations', [])]
        have = f.get('locationIds') or ([f['locationId']] if f.get('locationId') else [])
        if len(locs) != len(have):
            issue(f'{mod} locations', f"{e['name']}: {len(locs)} vs {len(have)}")
    if mod == 'families':
        pm = r.get('pivotMembers', [])
        ours = [i for i, x in ents.items() if x['type'] == 'character' and oid in ((x.get('fields') or {}).get('familyIds') or [])]
        if len(pm) != len(ours):
            issue('family members', f"{e['name']}: {len(pm)} vs {len(ours)}")
    if mod == 'journals':
        if bool(r.get('author_id')) != bool(f.get('authorId')):
            issue('journal author', e['name'])
        if (r.get('date') or '') != (f.get('date') or ''):
            issue('journal date', f"{e['name']}: {repr(r.get('date'))} vs {repr(f.get('date'))}")
    if mod == 'maps':
        if not (f.get('mapImageId') or o.get('imageId')):
            issue('map image', e['name'])
        if r.get('width') and int(f.get('mapWidth') or 0) != int(r['width']):
            issue('map size', f"{e['name']}: {r.get('width')}x{r.get('height')} vs {f.get('mapWidth')}x{f.get('mapHeight')}")
        for kind, col in (('markers', 'mapMarkers'), ('layers', 'mapLayers'), ('groups', 'mapGroups')):
            k = len(r.get(kind, []))
            ourn = len([m for m in C[col].values() if m.get('mapId') == oid])
            if k != ourn:
                issue('map ' + kind, f"{e['name']}: {k} vs {ourn}")
    if mod == 'organisations':
        k = len(r.get('members', []))
        ourn = len([m for m in C['orgMembers'].values() if m.get('organisationId') == oid])
        if k != ourn:
            issue('org members', f"{e['name']}: {k} vs {ourn}")
    k = len(e.get('posts', []))
    ourn = len([p for p in C['posts'].values() if p.get('entityId') == oid])
    if k != ourn:
        issue('posts', f"{e['name']}: {k} vs {ourn}")
    links = [a for a in e.get('assets', []) if a.get('type_id') == 2]
    aliases = [a for a in e.get('assets', []) if a.get('type_id') == 3]
    if len(links) != len(o.get('links') or []):
        issue('links', f"{e['name']}: {len(links)} vs {len(o.get('links') or [])}")
    if len(aliases) != len(o.get('aliases') or []):
        issue('aliases', f"{e['name']}: {len(aliases)} vs {len(o.get('aliases') or [])}")
with open(OUT, 'w', encoding='utf-8') as fo:
    fo.write(' '.join(f'{k}={len(v)}' for k, v in C.items()) + '\n')
    fo.write(f'matched {len(kid2ours)} of {len(recs)}\n')
    for k, v in issues.most_common():
        fo.write(f'\n[{k}] x{v}\n' + '\n'.join('   ' + s for s in samples[k]) + '\n')
print('done')
