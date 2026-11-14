/**
 * Data model and list rendering for the mobile session sidebar drawer.
 *
 * Kept out of sidebar.js so both files stay under the 300-line limit.
 * sidebar.js owns the drawer DOM, gestures and lifecycle; this module owns
 * session.list / session.pins loading, the calendar-day grouping and the
 * group/session row markup.
 */
import { state } from '../state/state.js'
import { el } from '../utils/dom.js'
import { call } from '../net/rpc.js'
import { headerIcon } from './theme.js'
import * as homeModule from './views/home.js'

// home.js exports groupLabel today. Resolve lazily: home.js and this module
// form an import cycle, so the export must not be read at module-init time.
const groupLabel = (ms) =>
  typeof homeModule.groupLabel === 'function' ? homeModule.groupLabel(ms) : '今天'
const FIXED_GROUPS = ['今天', '昨天', '7 天内', '30 天内']
const ICON_MORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/><circle cx="5" cy="12" r="1.4"/></svg>'
const ICON_CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>'

/** Drawer data. Owned here, read/written by sidebar.js. */
export const sidebarData = {
  loading: false,
  loadingMore: false,
  loaded: false,
  error: '',
  sessions: [],
  pins: [],
  nextCursor: undefined,
  hasMore: false,
  scrollTop: 0,
  collapsedPins: false,
  seq: 0,
}

export function sessionTitle(row) {
  const title = row?.projections?.values?.title
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : '新对话'
}

export function normalizeSessions(value) {
  const items = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []
  return { items, hasMore: value?.hasMore === true, nextCursor: value?.nextCursor }
}

export function normalizePins(value) {
  const list = Array.isArray(value?.pins) ? value.pins : Array.isArray(value) ? value : []
  const out = []
  const seen = new Set()
  for (const item of list) {
    const raw = typeof item === 'string' ? item : item?.sessionId || item?.id
    if (typeof raw !== 'string' || !raw.trim()) continue
    const id = raw.trim().toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ sessionId: id, pinnedAt: Number(item?.pinnedAt) || 0 })
  }
  return out
}

/** Split rows into pinned (in pin order) and unpinned history, de-duplicated. */
export function buildModel() {
  const byId = new Map()
  for (const row of sidebarData.sessions) if (row?.sessionId) byId.set(String(row.sessionId).toLowerCase(), row)
  const pinned = []
  const pinnedIds = new Set()
  for (const pin of sidebarData.pins) {
    if (!pin.sessionId || pinnedIds.has(pin.sessionId)) continue
    pinnedIds.add(pin.sessionId)
    // A pin may point at a session outside the first page; keep a stub row.
    pinned.push(byId.get(pin.sessionId) || { sessionId: pin.sessionId, updatedAt: pin.pinnedAt || 0 })
  }
  const history = sidebarData.sessions.filter((row) => !pinnedIds.has(String(row?.sessionId || '').toLowerCase()))
  return { pinned, history }
}

/** Same calendar-day grouping as views/home.js: 今天→昨天→7 天内→30 天内→YYYY-MM. */
function groupsOf(rows) {
  const map = new Map()
  for (const row of rows) {
    const label = groupLabel(typeof row.updatedAt === 'number' ? row.updatedAt : 0)
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(row)
  }
  const months = [...map.keys()].filter((label) => !FIXED_GROUPS.includes(label)).sort().reverse()
  return [...FIXED_GROUPS, ...months]
    .filter((label) => map.has(label))
    .map((label) => ({ label, rows: map.get(label) }))
}

function rowNode(row, handlers) {
  const id = typeof row?.sessionId === 'string' ? row.sessionId : ''
  const kids = [el('span', { class: 'sidebar-item-title' }, [sessionTitle(row)])]
  if (handlers.onActions) {
    kids.push(el('button', {
      type: 'button', class: 'sidebar-item-more', 'aria-label': '会话操作', title: '会话操作',
      onclick: (ev) => { ev.stopPropagation(); handlers.onActions(row) },
    }, [headerIcon(ICON_MORE)]))
  }
  const active = id !== '' && state.session?.sessionId === id
  return el('div', {
    class: `sidebar-item${active ? ' is-active' : ''}`, role: 'button', tabindex: '0',
    onclick: () => { if (id) handlers.onSelect(id) },
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click() }
    },
  }, kids)
}

function rowsNode(rows, handlers) {
  return el('div', { class: 'sidebar-rows' }, rows.map((row) => rowNode(row, handlers)))
}

function historyNode(history, handlers) {
  return groupsOf(history).map((group) => el('div', { class: 'sidebar-group' }, [
    el('div', { class: 'sidebar-group-title' }, [group.label]),
    rowsNode(group.rows, handlers),
  ]))
}

function pinnedNode(pinned, handlers) {
  if (pinned.length === 0) return []
  const collapsed = sidebarData.collapsedPins === true
  return [el('div', { class: 'sidebar-group sidebar-pinned-group' }, [
    el('button', {
      type: 'button', class: 'sidebar-group-title sidebar-group-toggle',
      'aria-expanded': collapsed ? 'false' : 'true',
      onclick: () => handlers.onTogglePins(),
    }, [
      el('span', {}, ['置顶']),
      el('span', {
        class: `sidebar-caret${collapsed ? ' is-collapsed' : ''}`,
        'aria-hidden': 'true',
        html: ICON_CARET,
      }),
    ]),
    collapsed ? null : rowsNode(pinned, handlers),
  ].filter(Boolean))]
}

/**
 * Rebuild the list inside `scroll`.
 * handlers: { onSelect(id), onActions(row)|null, onTogglePins(), onRetry(), onLoadMore() }
 */
export function renderSidebarBody(scroll, handlers) {
  if (!scroll) return
  const kids = []
  if (!sidebarData.loaded && sidebarData.loading) {
    kids.push(
      el('div', { class: 'sidebar-skeleton' }),
      el('div', { class: 'sidebar-skeleton' }),
      el('div', { class: 'sidebar-skeleton' }),
    )
  } else if (sidebarData.error && sidebarData.sessions.length === 0) {
    kids.push(el('div', { class: 'sidebar-error-block' }, [
      el('p', { class: 'sidebar-error', role: 'alert' }, [sidebarData.error]),
      el('button', { type: 'button', class: 'sidebar-retry', onclick: () => handlers.onRetry() }, ['重试']),
    ]))
  } else {
    const { pinned, history } = buildModel()
    if (pinned.length === 0 && history.length === 0) kids.push(el('p', { class: 'sidebar-empty' }, ['暂无历史对话']))
    kids.push(...pinnedNode(pinned, handlers), ...historyNode(history, handlers))
  }
  if (sidebarData.hasMore && sidebarData.loaded) {
    kids.push(el('button', {
      type: 'button', class: 'sidebar-more', disabled: sidebarData.loadingMore,
      onclick: () => handlers.onLoadMore(),
    }, [sidebarData.loadingMore ? '加载中…' : '加载更多']))
  }
  scroll.replaceChildren(...kids)
  if (sidebarData.scrollTop) scroll.scrollTop = sidebarData.scrollTop
}

/** First page of sessions + pins. Resolves once sidebarData is updated. */
export async function loadSidebarData() {
  const seq = ++sidebarData.seq
  sidebarData.loading = true
  sidebarData.error = ''
  const [listRes, pinsRes, workspaceRes] = await Promise.allSettled([
    call('session.list', {}),
    call('session.pins', {}),
    call('workspace.list', {}),
  ])
  if (seq !== sidebarData.seq) return
  // session.list does not filter archived sessions on this host; the archived
  // set comes from workspace.list (see README/backend note).
  const archived = workspaceRes.status === 'fulfilled'
    ? new Set(Array.isArray(workspaceRes.value?.archivedSessionIds) ? workspaceRes.value.archivedSessionIds : [])
    : new Set()
  if (listRes.status === 'fulfilled') {
    const page = normalizeSessions(listRes.value)
    sidebarData.sessions = page.items.filter((row) => !archived.has(row.sessionId))
    sidebarData.nextCursor = page.nextCursor
    sidebarData.hasMore = page.hasMore
    sidebarData.loaded = true
  } else {
    sidebarData.error = String(listRes.reason?.message || listRes.reason || '加载失败')
  }
  if (pinsRes.status === 'fulfilled') sidebarData.pins = normalizePins(pinsRes.value)
  else if (Array.isArray(state.pins) && state.pins.length > 0) sidebarData.pins = normalizePins(state.pins)
  sidebarData.loading = false
}

/** Append the next session.list page. No-op while busy or when exhausted. */
export async function loadMoreSidebarData() {
  if (sidebarData.loadingMore || !sidebarData.hasMore) return
  sidebarData.loadingMore = true
  const seq = sidebarData.seq
  try {
    const page = normalizeSessions(await call('session.list', { cursor: sidebarData.nextCursor }))
    if (seq !== sidebarData.seq) return
    sidebarData.sessions = [...sidebarData.sessions, ...page.items]
    sidebarData.nextCursor = page.nextCursor
    sidebarData.hasMore = page.hasMore
    sidebarData.error = ''
  } catch (err) {
    if (seq === sidebarData.seq) sidebarData.error = String(err?.message || err)
  } finally {
    sidebarData.loadingMore = false
  }
}
