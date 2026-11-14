/**
 * CORS support for the /mp surface.
 *
 * The standalone H5 app lives on a different origin (http://localhost:8010,
 * file://, a public host, ...) and calls this server directly, so every /mp/*
 * response must carry cross-origin headers and OPTIONS preflights must be
 * answered before any handler-level method check (405).
 */

const ALLOW_METHODS = 'GET,POST,OPTIONS'
// content-type/authorization for JSON RPC + attachments; x-mp-* for the
// cross-origin multipart-ish upload XHR (/mp/api/mobile.upload).
const ALLOW_HEADERS = 'content-type,authorization,x-mp-filename,x-mp-session-id,x-mp-media-type'
const MAX_AGE = '86400'

export function requestOrigin(req) {
  const origin = req.headers?.origin
  return typeof origin === 'string' && origin !== '' ? origin : ''
}

/**
 * Set the CORS headers on the response. Safe to call for every /mp/* request;
 * Node merges headers set here with a later res.writeHead(status, headers).
 * Access-Control-Allow-Origin is only emitted when the request has an Origin
 * (same-origin / curl / mobile page requests get no ACAO, as required).
 */
export function applyCors(req, res) {
  if (!res || typeof res.setHeader !== 'function') return
  const origin = requestOrigin(req)
  if (origin !== '') res.setHeader('access-control-allow-origin', origin)
  res.setHeader('access-control-allow-credentials', 'true')
  res.setHeader('access-control-allow-methods', ALLOW_METHODS)
  res.setHeader('access-control-allow-headers', ALLOW_HEADERS)
  res.setHeader('access-control-max-age', MAX_AGE)
  res.setHeader('vary', 'Origin')
}

/**
 * Answer an OPTIONS preflight with 204. Returns true when the request was
 * consumed; callers must not continue into their handler in that case.
 */
export function handlePreflight(req, res) {
  if (req.method !== 'OPTIONS') return false
  res.writeHead(204)
  res.end()
  return true
}

/**
 * Wrap a route handler so CORS headers are present on every response
 * (including errors and SSE) and OPTIONS preflights short-circuit to 204.
 */
export function withCors(handler) {
  return async (req, res) => {
    applyCors(req, res)
    if (handlePreflight(req, res)) return undefined
    return handler(req, res)
  }
}
