/**
 * Device credential resolution for the standalone H5 app.
 *
 * A paired device secret can arrive in three ways:
 *  - mp_device cookie (same-origin mobile page)
 *  - Authorization: Bearer <secret> (fetch/XHR uploads)
 *  - ?token=<secret> query (EventSource / <img>, which cannot send headers)
 *
 * These helpers are intentionally free functions so AuthManager can expose
 * thin methods without growing lib/auth.js past the file-size budget.
 */
import { COOKIE, IDLE_MS } from './constants.js'
import { cookieValue, isLoopback, sameSecret } from './utils.js'
import { deviceCookie } from './devices.js'

export function bearerSecret(req) {
  const raw = req.headers?.authorization
  if (typeof raw !== 'string') return ''
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return match ? match[1].trim() : ''
}

export function querySecret(req) {
  try {
    const url = new URL(req.url || '/', 'http://x')
    return (url.searchParams.get('token') || '').trim()
  } catch {
    return ''
  }
}

export function cookieSecret(req) {
  return cookieValue(req.headers?.cookie, COOKIE)
}

/**
 * Find a live device row whose secret matches `secret`, refresh lastSeenAt and
 * persist. Expired rows are dropped on the way. Returns { id, row } or undefined.
 */
export function findDeviceBySecret(manager, secret) {
  if (typeof secret !== 'string' || secret === '') return undefined
  const devices = manager.devices || {}
  for (const id of Object.keys(devices)) {
    const row = devices[id]
    if (!row || !sameSecret(deviceCookie(id, row), secret)) continue
    if (Date.now() - row.lastSeenAt > IDLE_MS) {
      delete devices[id]
      manager.persist()
      return undefined
    }
    row.lastSeenAt = Date.now()
    manager.persist()
    return { id, row }
  }
  return undefined
}

export function findByBearer(manager, req) {
  return findDeviceBySecret(manager, bearerSecret(req))
}

export function findByToken(manager, req) {
  return findDeviceBySecret(manager, querySecret(req))
}

export function findAnyDevice(manager, req) {
  return findDeviceBySecret(manager, cookieSecret(req))
    || findByBearer(manager, req)
    || findByToken(manager, req)
}

/**
 * Gate for /mp/api/* on non-loopback requests. Loopback keeps the existing
 * trusted-local behavior; when pairing is disabled the surface stays open
 * (same contract as the rest of the plugin). Otherwise a valid device
 * credential is mandatory.
 */
export function authorizeRequest(manager, req) {
  if (isLoopback(req)) return true
  if (!manager.requirePairing) return true
  return Boolean(findAnyDevice(manager, req))
}
