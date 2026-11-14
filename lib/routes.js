import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PREFIX, PUBLIC, ALLOW, MAX_BODY, PLUGIN_ROOT } from './constants.js'
import { json, readBody, isLoopback, svc } from './utils.js'
import { handleUpload } from './upload.js'
import { pipeSse } from './events.js'
import { createLiveMuxStream, createLiveHostStream } from './live-stream.js'
import { handleAttachmentRequest } from './media.js'
import { getVapidPublicKey, addSubscription, removeSubscription } from './web-push.js'
import { handleStaticFile, renderAppHtml, renderManifestJson, getPwaConfig } from './pwa.js'
import { withCors } from './http-cors.js'
import { createRelayHandlers } from './relay-routes.js'

export { handleStaticFile }

const SERVICE = 'dsh-mobile-plus'
const PKG = (() => {
  try {
    return JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
})()

// Paths that require a device credential on non-loopback requests. /mp/api/hello
// is a discovery endpoint and deliberately stays public.
function needsDeviceAuth(req) {
  let pathname = '/'
  try {
    pathname = new URL(req.url || '/', 'http://x').pathname
  } catch {
    return true
  }
  if (!pathname.startsWith(`${PREFIX}/api`)) return false
  return pathname !== `${PREFIX}/api/hello`
}

export function setupRoutes(ctx, auth, pendingTracker, dispatch, getRelay) {
  const handleHello = (req, res) => {
    json(res, 200, {
      ok: true,
      service: SERVICE,
      version: typeof PKG.version === 'string' ? PKG.version : '0.0.0',
      name: getPwaConfig(req).appName,
      requirePairing: auth.requirePairing !== false,
    })
  }

  const handleSetup = (req, res) => {
    if (!isLoopback(req)) {
      res.writeHead(403)
      res.end('setup is loopback only')
      return
    }
    handleStaticFile(join(PUBLIC, 'setup.html'), req, res)
  }

  const handleApp = (req, res) => {
    const extra = auth.requirePairing && auth.touch(req) ? auth.cookieHeadersIfPaired(req) : {}
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    })
    res.end(renderAppHtml(req))
  }

  const handleEvents = async (req, res) => {
    await pipeSse(
      req,
      res,
      (signal) => {
        const proxy = svc(ctx, 'apiProxy')
        if (proxy?.events?.mux) {
          return proxy.events.mux({ rpcId: `mp-mux-${Date.now().toString(36)}`, payload: {} }, signal)
        }
        return createLiveMuxStream(ctx, signal)
      },
      auth,
      pendingTracker,
    )
  }

  const handleHostEvents = async (req, res) => {
    const proxyHost = svc(ctx, 'apiProxy')
    if (proxyHost?.events?.host && typeof proxyHost.events.host === 'function') {
      await pipeSse(
        req,
        res,
        (signal) => proxyHost.events.host({ rpcId: `mp-host-${Date.now().toString(36)}`, payload: {} }, signal),
        auth,
        pendingTracker,
      )
      return
    }
    await pipeSse(
      req,
      res,
      (signal) => createLiveHostStream(ctx, signal),
      auth,
      pendingTracker,
    )
  }

  const handleApi = async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://x').pathname
    if (pathname === `${PREFIX}/api/hello`) {
      handleHello(req, res)
      return
    }
    if (pathname === `${PREFIX}/api/events.mux`) {
      await handleEvents(req, res)
      return
    }
    if (pathname === `${PREFIX}/api/events.host`) {
      await handleHostEvents(req, res)
      return
    }
    if (pathname === `${PREFIX}/api/mobile.upload`) {
      await handleUpload(ctx, req, res)
      return
    }
    if (pathname === `${PREFIX}/api/attachment`) {
      await handleAttachmentRequest(ctx, auth, req, res)
      return
    }
    if (pathname === `${PREFIX}/api/push/key`) {
      json(res, 200, { ok: true, publicKey: getVapidPublicKey() })
      return
    }
    if (pathname === `${PREFIX}/api/push/subscribe` && req.method === 'POST') {
      try {
        const body = await readBody(req, 64 * 1024)
        const sub = body.subscription || body
        const ok = addSubscription(sub)
        json(res, 200, { ok })
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message || err) })
      }
      return
    }
    if (pathname === `${PREFIX}/api/push/unsubscribe` && req.method === 'POST') {
      try {
        const body = await readBody(req, 64 * 1024)
        const ok = removeSubscription(body.endpoint)
        json(res, 200, { ok })
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message || err) })
      }
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const method = pathname.slice(`${PREFIX}/api/`.length)
    if (!ALLOW.has(method)) {
      json(res, 403, { ok: false, error: { code: 'forbidden', message: method } })
      return
    }
    let envelope
    try {
      envelope = await readBody(req, method === 'session.prompt' ? MAX_BODY : 256 * 1024)
    } catch (error) {
      json(res, 400, { ok: false, error: { code: 'bad-request', message: String(error.message || error) } })
      return
    }
    const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : ''
    if (rpcId === '') {
      json(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing rpcId' } })
      return
    }
    try {
      const abort = new AbortController()
      res.on('close', () => { if (!res.writableEnded) abort.abort() })
      json(res, 200, await dispatch(method, envelope.payload, rpcId, abort.signal))
    } catch (error) {
      json(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } },
      })
    }
  }

  const handleStaticRoute = (req, res) => {
    let pathname = new URL(req.url || '/', 'http://x').pathname
    if (pathname.startsWith(`${PREFIX}/`)) {
      pathname = pathname.slice(`${PREFIX}/`.length)
    } else if (pathname.startsWith(PREFIX)) {
      pathname = pathname.slice(PREFIX.length)
    }
    if (pathname.startsWith('/')) {
      pathname = pathname.slice(1)
    }
    if (pathname === '' || pathname === 'index.html' || pathname === 'app.html') {
      handleApp(req, res)
      return
    }
    if (pathname === 'manifest.webmanifest') {
      res.writeHead(200, {
        'content-type': 'application/manifest+json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(renderManifestJson(req))
      return
    }
    const target = resolve(PUBLIC, pathname)
    if (target.startsWith(PUBLIC) && existsSync(target)) {
      handleStaticFile(target, req, res)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }

  const relayHandlers = createRelayHandlers(auth, getRelay)

  // Uniform /mp surface wrapper: CORS headers on every response, OPTIONS
  // preflight => 204, and device auth for /mp/api/* before handler logic.
  const guard = (handler) => withCors(async (req, res) => {
    if (needsDeviceAuth(req) && !auth.authorizeRequest(req)) {
      json(res, 401, { ok: false, error: { code: 'unauthorized' } })
      return undefined
    }
    return handler(req, res)
  })

  const routes = [
    { kind: 'exact', path: `${PREFIX}/api/hello`, handler: handleHello },
    { kind: 'exact', path: `${PREFIX}/setup`, handler: handleSetup },
    { kind: 'exact', path: PREFIX, handler: handleApp },
    { kind: 'exact', path: `${PREFIX}/`, handler: handleApp },
    { kind: 'exact', path: `${PREFIX}/pair/issue`, handler: (req, res) => auth.handleIssue(ctx.webServer.port, req, res, getRelay ? getRelay() : null) },
    { kind: 'exact', path: `${PREFIX}/pair/accept`, handler: auth.handleAccept },
    { kind: 'exact', path: `${PREFIX}/pair/status`, handler: (req, res) => auth.handleStatus(req, res, getRelay ? getRelay() : null) },
    { kind: 'exact', path: `${PREFIX}/pair/stop`, handler: auth.handleStop },
    { kind: 'exact', path: `${PREFIX}/pair/revoke`, handler: auth.handleRevoke },
    { kind: 'exact', path: `${PREFIX}/relay/config`, handler: relayHandlers.config },
    { kind: 'exact', path: `${PREFIX}/relay/provision`, handler: relayHandlers.provision },
    { kind: 'exact', path: `${PREFIX}/relay/test`, handler: relayHandlers.test },
    { kind: 'exact', path: `${PREFIX}/api/events.mux`, handler: handleEvents },
    { kind: 'exact', path: `${PREFIX}/api/events.host`, handler: handleHostEvents },
    { kind: 'exact', path: `${PREFIX}/api/attachment`, handler: (req, res) => handleAttachmentRequest(ctx, auth, req, res) },
    { kind: 'prefix', path: `${PREFIX}/api`, handler: handleApi },
    { kind: 'prefix', path: PREFIX, handler: handleStaticRoute },
  ].map((route) => ({ ...route, handler: guard(route.handler) }))

  const stop = routes.map((route) => ctx.webServer.register(route))
  return () => { for (const dispose of stop) dispose() }
}
