/**
 * Where the host lives.
 *
 * A page served by the host itself uses relative /mp paths and the same-origin
 * device cookie. A packaged standalone app points at a bound origin and
 * authenticates with the device token obtained once at pairing time.
 * Everything that talks to the host must go through this module — never
 * hardcode /mp/... anywhere else.
 */
let baseOrigin = ''
let deviceToken = ''

export function configureEndpoint(origin, token) {
  baseOrigin = typeof origin === 'string' ? origin.replace(/\/+$/, '') : ''
  deviceToken = typeof token === 'string' ? token : ''
}

export function endpointOrigin() {
  return baseOrigin
}

export function hasDeviceToken() {
  return deviceToken !== ''
}

/** True when the app is not served by the host (standalone / packaged). */
export function isCrossOrigin() {
  return baseOrigin !== ''
}

/** Absolute URL for a path that already starts with /mp. */
export function mpUrl(path) {
  return `${baseOrigin}${path}`
}

/** Assets copied from the host (icons, logo). */
export function assetUrl(path) {
  return `${baseOrigin}${path}`
}

export function apiUrl(method) {
  return `${baseOrigin}/mp/api/${method}`
}

/**
 * EventSource and <img> cannot send an Authorization header, so the token
 * rides along in the query string for those two call sites only.
 */
export function tokenUrl(path) {
  const url = `${baseOrigin}${path}`
  if (deviceToken === '') return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(deviceToken)}`
}

export function authHeaders(headers) {
  const next = { ...(headers || {}) }
  if (deviceToken !== '') next.authorization = `Bearer ${deviceToken}`
  return next
}

export function credentialMode() {
  // Cookies are scoped to the host origin; cross-origin calls must not send
  // them (SameSite=Lax would drop them anyway) and use the token instead.
  return baseOrigin === '' ? 'same-origin' : 'omit'
}
