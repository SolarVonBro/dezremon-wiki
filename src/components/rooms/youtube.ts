// YouTube helpers for music rooms: the IFrame player API, link parsing, titles (oEmbed, no key needed),
// playlist expansion and search (search needs a YouTube Data API key — service/config, set in the admin panel).

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<any> | null = null

/** Loads https://www.youtube.com/iframe_api once and resolves with window.YT. */
export function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT) }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.async = true
      s.onerror = () => { apiPromise = null; reject(new Error('Не удалось загрузить плеер YouTube')) }
      document.head.appendChild(s)
    })
  }
  return apiPromise
}

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const

const ID_RE = /^[A-Za-z0-9_-]{11}$/

/** Video id and/or playlist id from any YouTube link (watch, youtu.be, shorts, embed, music.youtube.com) or a bare id. */
export function parseYouTube(input: string): { videoId?: string; listId?: string } | null {
  const s = input.trim()
  if (!s) return null
  if (ID_RE.test(s)) return { videoId: s }
  let u: URL
  try { u = new URL(s.startsWith('http') ? s : 'https://' + s) } catch { return null }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '')
  let videoId: string | undefined
  if (host === 'youtu.be') videoId = u.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = u.searchParams.get('v') ?? undefined
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/)
    if (!videoId && m) videoId = m[1]
  } else return null
  const listId = u.searchParams.get('list') ?? undefined
  if (videoId && !ID_RE.test(videoId)) videoId = undefined
  if (!videoId && !listId) return null
  return { videoId, listId: listId && /^[A-Za-z0-9_-]{10,64}$/.test(listId) ? listId : undefined }
}

export const thumbUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`

/** Title through YouTube's oEmbed endpoint (CORS-enabled, no key). */
export async function fetchTitle(videoId: string): Promise<string> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`)
    if (!r.ok) return ''
    const j = await r.json()
    return String(j.title ?? '')
  } catch { return '' }
}

export async function fetchTitles(ids: string[], concurrency = 6): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let i = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (i < ids.length) { const id = ids[i++]; out.set(id, await fetchTitle(id)) }
  }))
  return out
}

/** Video ids of a playlist without an API key: a hidden player loads the list and reports it (up to ~200). */
export async function playlistIdsViaPlayer(listId: string): Promise<string[]> {
  const YT = await loadYouTubeApi()
  return new Promise((resolve, reject) => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:120px'
    const inner = document.createElement('div')
    host.appendChild(inner)
    document.body.appendChild(host)
    let done = false
    const finish = (ids: string[] | null, err?: Error) => {
      if (done) return
      done = true
      try { player?.destroy() } catch { /* already gone */ }
      host.remove()
      if (ids) resolve(ids)
      else reject(err ?? new Error('Плейлист не загрузился'))
    }
    const timer = setTimeout(() => finish(null, new Error('Плейлист не загрузился (закрытый или удалённый?)')), 15000)
    const poll = () => {
      const ids: string[] | undefined = player?.getPlaylist?.()
      if (ids?.length) { clearTimeout(timer); finish(ids) } else setTimeout(poll, 400)
    }
    const player = new YT.Player(inner, {
      width: 200, height: 120,
      playerVars: { listType: 'playlist', list: listId, autoplay: 0, mute: 1 },
      events: { onReady: () => poll(), onError: () => { clearTimeout(timer); finish(null) } },
    })
  })
}

export interface SearchResult { videoId: string; title: string; channel: string; duration: number }

/** ISO 8601 duration (PT1H2M3S) → seconds. */
export function isoDuration(s: string): number {
  const m = s.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0))
}

const API = 'https://www.googleapis.com/youtube/v3'
async function api(path: string, key: string) {
  const r = await fetch(`${API}/${path}&key=${encodeURIComponent(key)}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message ?? `YouTube API: ${r.status}`)
  return j
}
async function durations(ids: string[], key: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 50) {
    const j = await api(`videos?part=contentDetails&id=${ids.slice(i, i + 50).join(',')}`, key)
    for (const v of j.items ?? []) out.set(v.id, isoDuration(v.contentDetails?.duration ?? ''))
  }
  return out
}
const decode = (s: string) => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value }

/** YouTube search (100 quota units per call) + durations (1 unit). */
export async function searchYouTube(q: string, key: string): Promise<SearchResult[]> {
  const j = await api(`search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(q)}`, key)
  const items: any[] = (j.items ?? []).filter((x: any) => x.id?.videoId)
  const d = await durations(items.map((x) => x.id.videoId), key).catch(() => new Map<string, number>())
  return items.map((x) => ({ videoId: x.id.videoId, title: decode(x.snippet?.title ?? ''), channel: decode(x.snippet?.channelTitle ?? ''), duration: d.get(x.id.videoId) ?? 0 }))
}

/** Playlist items through the Data API (1 unit per 50 items), with titles and durations. */
export async function playlistViaApi(listId: string, key: string): Promise<SearchResult[]> {
  const out: SearchResult[] = []
  let page = ''
  do {
    const j = await api(`playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(listId)}${page ? `&pageToken=${page}` : ''}`, key)
    for (const x of j.items ?? []) {
      const id = x.snippet?.resourceId?.videoId
      if (id) out.push({ videoId: id, title: decode(x.snippet?.title ?? ''), channel: decode(x.snippet?.videoOwnerChannelTitle ?? ''), duration: 0 })
    }
    page = j.nextPageToken ?? ''
  } while (page && out.length < 500)
  const d = await durations(out.map((x) => x.videoId), key).catch(() => new Map<string, number>())
  out.forEach((x) => { x.duration = d.get(x.videoId) ?? 0 })
  return out
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec % 60), m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
