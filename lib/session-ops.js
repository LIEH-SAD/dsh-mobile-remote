/**
 * Session operations for the mobile app: rename + archive.
 *
 * Host contract (confirmed via cordis Service inspection):
 * - sessionController.rename({ sessionId, title }) -> { title, seq }
 * - workspaceController.archiveSession({ sessionId, stopActivity? }) -> { archivedSessionIds }
 *
 * Both prefer the generated apiProxy Remote namespace and fall back to the
 * controller Service directly, so the plugin keeps working when one seam is
 * unavailable in a given DSH build.
 */
import { svc, wrap } from './utils.js'

export const MAX_SESSION_TITLE_LENGTH = 80

export function normalizeSessionId(raw) {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function normalizeSessionTitle(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text.length > MAX_SESSION_TITLE_LENGTH ? text.slice(0, MAX_SESSION_TITLE_LENGTH) : text
}

function ok(rpcId, value) {
  return { type: 'server-response', rpcId, result: { ok: true, value } }
}

function fail(rpcId, err) {
  const reason = err?.details?.reason || err?.reason
  const message = reason ? `${err?.message || '请求失败'}: ${reason}` : (err?.message || String(err))
  return {
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code: err?.code || 'error', message, details: err?.details } },
  }
}

function badRequest(rpcId, message) {
  return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'bad-request', message } } }
}

function unavailable(rpcId, message) {
  return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'unavailable', message } } }
}

function renameValue(raw, fallbackTitle) {
  const title = typeof raw?.title === 'string' && raw.title !== '' ? raw.title : fallbackTitle
  const seq = typeof raw?.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : undefined
  return seq === undefined ? { title } : { title, seq }
}

function archiveValue(raw) {
  return { ok: true, archivedSessionIds: Array.isArray(raw?.archivedSessionIds) ? raw.archivedSessionIds : [] }
}

// Returns the apiProxy response envelope when it gave a definitive answer, or
// null when the caller should fall back to the controller Service.
async function tryProxyRename(ctx, sessionId, title, rpcId, signal) {
  const api = svc(ctx, 'apiProxy')
  if (typeof api?.sessions?.rename !== 'function') return null
  try {
    const envelope = await api.sessions.rename({ rpcId, payload: { sessionId, title } }, signal)
    const result = envelope?.result
    if (result?.ok) return ok(rpcId, renameValue(result.value, title))
    if (result && result.error?.code !== 'unavailable') return wrap(rpcId, envelope)
  } catch {
    // proxy seam unavailable for this build; use the controller Service
  }
  return null
}

const ARCHIVE_METHOD = { archive: 'archiveSession', unarchive: 'unarchiveSession' }

async function tryProxyArchiveOps(ctx, sessionId, stopActivity, action, rpcId, signal) {
  const api = svc(ctx, 'apiProxy')
  const method = ARCHIVE_METHOD[action]
  if (!api?.workspace || typeof api.workspace[method] !== 'function') return null
  try {
    const request = action === 'archive' && stopActivity ? { sessionId, stopActivity: true } : { sessionId }
    const envelope = await api.workspace[method]({ rpcId, payload: request }, signal)
    const result = envelope?.result
    if (result?.ok) return ok(rpcId, archiveValue(result.value))
    if (result && result.error?.code !== 'unavailable') return wrap(rpcId, envelope)
  } catch {
    // proxy seam unavailable for this build; use the controller Service
  }
  return null
}

async function handleArchiveOps(ctx, payload, rpcId, signal, action) {
  const sessionId = normalizeSessionId(payload?.sessionId)
  if (sessionId === '') return badRequest(rpcId, 'missing sessionId')
  const stopActivity = payload?.stopActivity === true

  const viaProxy = await tryProxyArchiveOps(ctx, sessionId, stopActivity, action, rpcId, signal)
  if (viaProxy) return viaProxy

  const wsCtrl = svc(ctx, 'workspaceController')
  const method = ARCHIVE_METHOD[action]
  if (typeof wsCtrl?.[method] !== 'function') {
    return unavailable(rpcId, action === 'archive' ? '归档会话服务不可用' : '恢复会话服务不可用')
  }
  try {
    const request = action === 'archive' && stopActivity ? { sessionId, stopActivity: true } : { sessionId }
    return ok(rpcId, archiveValue(await wsCtrl[method](request)))
  } catch (err) {
    return fail(rpcId, err)
  }
}

export function handleSessionArchive(ctx, payload, rpcId, signal) {
  return handleArchiveOps(ctx, payload, rpcId, signal, 'archive')
}

export function handleSessionUnarchive(ctx, payload, rpcId, signal) {
  return handleArchiveOps(ctx, payload, rpcId, signal, 'unarchive')
}

export async function handleSessionRename(ctx, payload, rpcId, signal) {
  const sessionId = normalizeSessionId(payload?.sessionId)
  if (sessionId === '') return badRequest(rpcId, 'missing sessionId')
  const title = normalizeSessionTitle(payload?.title)
  if (title === '') return badRequest(rpcId, '会话标题不能为空')

  const viaProxy = await tryProxyRename(ctx, sessionId, title, rpcId, signal)
  if (viaProxy) return viaProxy

  const sessionCtrl = svc(ctx, 'sessionController')
  if (typeof sessionCtrl?.rename !== 'function') return unavailable(rpcId, '重命名会话服务不可用')
  try {
    return ok(rpcId, renameValue(await sessionCtrl.rename({ sessionId, title }), title))
  } catch (err) {
    return fail(rpcId, err)
  }
}
