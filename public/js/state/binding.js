/**
 * Persistent host binding for the standalone app: which host, which device
 * credential. Written once when pairing succeeds, read on every launch, so the
 * user never pairs again. Kept in localStorage (survives app restarts and
 * WebView process death).
 */
const BINDING_KEY = 'dsh.mobile.binding.v1'
const HOSTS_KEY = 'dsh.mobile.hosts.v1'
const MAX_HOSTS = 8

function safeGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/**
 * Accepts "192.168.2.103:3088", "http://host/mp/", a pairing link, or a bare
 * origin. Returns "http://host:port" (or '' when unusable).
 */
export function normalizeOrigin(raw) {
  const text = String(raw || '').trim()
  if (text === '') return ''
  const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.pathname !== '/' && !/^\/mp\/?$/i.test(url.pathname)) return ''
    if (url.username || url.password) return ''
    return url.origin
  } catch {
    return ''
  }
}

export function loadBinding() {
  const raw = safeGet(BINDING_KEY)
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    const origin = normalizeOrigin(data?.origin)
    const token = typeof data?.token === 'string' ? data.token : ''
    if (origin === '' || token === '') return null
    return {
      origin,
      token,
      deviceId: typeof data.deviceId === 'string' ? data.deviceId : '',
      name: typeof data.name === 'string' ? data.name : '',
      boundAt: typeof data.boundAt === 'number' ? data.boundAt : 0,
    }
  } catch {
    return null
  }
}

export function saveBinding(binding) {
  const origin = normalizeOrigin(binding?.origin)
  const token = typeof binding?.token === 'string' ? binding.token : ''
  if (origin === '' || token === '') return false
  return safeSet(BINDING_KEY, JSON.stringify({
    origin,
    token,
    deviceId: typeof binding.deviceId === 'string' ? binding.deviceId : '',
    name: typeof binding.name === 'string' ? binding.name : '',
    boundAt: Date.now(),
  }))
}

export function clearBinding() {
  try {
    localStorage.removeItem(BINDING_KEY)
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export function loadRecentHosts() {
  const raw = safeGet(HOSTS_KEY)
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list
      .map((row) => ({ origin: normalizeOrigin(row?.origin), name: typeof row?.name === 'string' ? row.name : '' }))
      .filter((row) => row.origin !== '')
      .slice(0, MAX_HOSTS)
  } catch {
    return []
  }
}

export function rememberHost(host) {
  const origin = normalizeOrigin(host?.origin)
  if (origin === '') return
  const next = [{ origin, name: typeof host?.name === 'string' ? host.name : '' }]
    .concat(loadRecentHosts().filter((row) => row.origin !== origin))
    .slice(0, MAX_HOSTS)
  safeSet(HOSTS_KEY, JSON.stringify(next))
}

/**
 * Host-served page (the plugin's own /mp/ UI) versus a packaged/standalone app.
 * A packager usually serves the bundle from another origin or file://, so the
 * /mp path prefix is the reliable signal in the positive direction.
 */
export function isHostServed() {
  if (typeof window === 'undefined' || !window.location) return false
  if (window.__MP_STANDALONE__ === true) return false
  if (window.location.protocol === 'file:') return false
  return /^\/mp(\/|$)/.test(window.location.pathname)
}

export function isStandaloneMode() {
  if (typeof window === 'undefined' || !window.location) return false
  if (window.__MP_STANDALONE__ === true) return true
  if (window.location.protocol === 'file:') return true
  try {
    if (new URLSearchParams(window.location.search).has('standalone')) return true
  } catch {
    /* ignore */
  }
  return !isHostServed()
}
