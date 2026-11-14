/**
 * DeepSeek-style home: greeting, a new-chat composer, and history grouped the
 * way chat.deepseek.com groups it (今天 / 昨天 / 7 天内 / 30 天内 / 月份).
 */
import { state } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { call } from '../../net/rpc.js'
import { render } from './render.js'
import { commitLocation, persistRoute, navigateToSession } from '../../state/route.js'
import { createSessionInWorkspace } from './session-create.js'
import { loadWorkspaces } from './ws-view.js'
import { setDraft } from '../../chat/composer.js'
import { send } from '../../chat/outbox.js'
import { globalSettingsButton, todayButton } from '../theme.js'
import { groupLabel, groupedSessions, sessionTitleOf, renderSessionGroup, renderCollapsibleGroup } from './home-rows.js'
import { renderHero as renderHomeHero } from './home-hero.js'
import { sidebarButton, refreshSidebar } from '../sidebar.js'
import '../session-actions.js'

export { groupLabel, groupedSessions }

export const home = {
  loading: false,
  busy: false,
  error: '',
  sessions: [],
  cursor: undefined,
  hasMore: false,
  loadedOnce: false,
  draft: '',
  workspaceId: '',
  pinnedIds: [],
  archivedIds: [],
  archivedCollapsed: (() => { try { return localStorage.getItem('dsh.mobile.archivedCollapsed') !== '0' } catch { return true } })(),
  pinnedCollapsed: (() => { try { return localStorage.getItem('dsh.mobile.pinnedCollapsed') === '1' } catch { return false } })(),
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function pickWorkspace() {
  const list = state.workspaces || []
  if (list.length === 0) return null
  const today = todayString()
  const hit = list.find((w) => {
    const title = workspaceTitle(w)
    return title === today || String(w.path || '').endsWith(today)
  })
  const chosen = hit || list[0]
  home.workspaceId = chosen.workspaceId
  return chosen
}

async function ensureWorkspaces() {
  if (Array.isArray(state.workspaces) && state.workspaces.length > 0) {
    pickWorkspace()
    return
  }
  try {
    await loadWorkspaces()
  } catch {
    /* offline: the composer still renders, sending reports the error */
  }
  pickWorkspace()
}

export async function loadHomeSessions(reset, opts = {}) {
  if (home.loading) {
    // A mutation (rename/pin/archive) can land while the first page is still
    // loading; queue one more refresh instead of silently dropping it.
    if (reset) home.pendingReset = true
    return
  }
  home.loading = true
  if (reset) {
    home.cursor = undefined
    home.hasMore = false
    if (!opts.silent) render()
  }
  try {
    const page = await call('session.list', home.cursor ? { cursor: home.cursor } : {})
    const items = Array.isArray(page?.items) ? page.items : []
    home.sessions = reset ? items : [...home.sessions, ...items]
    home.cursor = page?.nextCursor
    home.hasMore = page?.hasMore === true
    home.loadedOnce = true
    home.error = ''
    if (reset) {
      try {
        const [pins, workspaceView] = await Promise.all([
          call('session.pins', {}),
          call('workspace.list', {}),
        ])
        const rows = Array.isArray(pins?.pins) ? pins.pins : []
        home.pinnedIds = rows.map((row) => row?.sessionId).filter((id) => typeof id === 'string')
        home.archivedIds = Array.isArray(workspaceView?.archivedSessionIds) ? workspaceView.archivedSessionIds : []
      } catch {
        home.pinnedIds = []
        home.archivedIds = []
      }
    }
  } catch (err) {
    home.error = String(err.message || err)
  } finally {
    home.loading = false
    if (home.pendingReset) {
      home.pendingReset = false
      void loadHomeSessions(true, { silent: true })
      return
    }
    render()
  }
}

/** Re-fetch after rename/pin/delete from the action sheet. */
export async function refreshHome() {
  try {
    refreshSidebar()
  } catch {
    /* sidebar optional */
  }
  if (state.view !== 'home') return
  await loadHomeSessions(true, { silent: true })
}

export async function openHome(opts = {}) {
  state.view = 'home'
  state.error = ''
  state.session = null
  if (opts.locationMode && opts.locationMode !== 'none') {
    commitLocation({ view: 'home' }, opts.locationMode)
  } else {
    persistRoute({ view: 'home' })
  }
  home.error = ''
  render()
  void ensureWorkspaces().then(() => render())
  await loadHomeSessions(true)
}

async function startNewChat(text) {
  const value = String(text || '').trim()
  if (home.busy) return
  home.busy = true
  home.error = ''
  render()
  try {
    await ensureWorkspaces()
    const target = pickWorkspace()
    if (!target) {
      home.error = '还没有工作区，请先在「设置」里创建或打开一个。'
      return
    }
    await createSessionInWorkspace(target)
    if (state.view === 'chat') {
      home.draft = ''
      if (value !== '') {
        setDraft(value)
        await send()
      }
    }
  } catch (err) {
    home.error = String(err.message || err)
  } finally {
    home.busy = false
    if (state.view === 'home') render()
  }
}

function renderTopBar() {
  return el('header', { class: 'home-top' }, [
    el('div', { class: 'home-brand' }, [
      sidebarButton(),
      el('img', { class: 'home-logo', src: './logo.svg', alt: '' }),
      el('span', { class: 'home-brand-name' }, ['DSH']),
    ]),
    el('div', { class: 'home-top-actions' }, [
      todayButton(),
      globalSettingsButton(),
    ]),
  ])
}

function onRowOpen(row) {
  if (row?.sessionId) void navigateToSession(row.sessionId)
}

function onRowActions(row, pinned, archived) {
  if (typeof window.__mpOpenSessionActions === 'function') {
    window.__mpOpenSessionActions({ ...row, title: sessionTitleOf(row), pinned, archived })
  }
}

function isArchived(row) {
  return home.archivedIds.includes(row?.sessionId)
}

function renderArchivedSection() {
  const rows = home.sessions.filter(isArchived)
  if (rows.length === 0) return null
  const collapsed = home.archivedCollapsed !== false
  return renderCollapsibleGroup({
    label: `已归档 (${rows.length})`,
    rows,
    collapsed,
    groupClass: 'home-group-archived',
    listClass: 'is-archived',
    onToggle: (next) => {
      home.archivedCollapsed = next
      try { localStorage.setItem('dsh.mobile.archivedCollapsed', next ? '1' : '0') } catch { /* ignore */ }
      render()
    },
    rowOptions: {
      onOpen: onRowOpen,
      onActions: (target) => onRowActions(target, false, true),
      pinned: false,
    },
  })
}

function renderPinnedSection() {
  const byId = new Map(home.sessions.map((row) => [row.sessionId, row]))
  const rows = home.pinnedIds
    .map((id) => byId.get(id) || { sessionId: id, title: '已置顶对话' })
    .filter((row) => row.sessionId !== state.session?.sessionId)
    .filter((row) => !isArchived(row))
  if (rows.length === 0) return null
  const collapsed = home.pinnedCollapsed === true
  return renderCollapsibleGroup({
    label: '置顶',
    rows,
    collapsed,
    groupClass: 'home-group-pinned',
    onToggle: (next) => {
      home.pinnedCollapsed = next
      try { localStorage.setItem('dsh.mobile.pinnedCollapsed', next ? '1' : '0') } catch { /* ignore */ }
      render()
    },
    rowOptions: {
      onOpen: onRowOpen,
      onActions: (target) => onRowActions(target, true, false),
      pinned: true,
    },
  })
}

function renderHistory() {
  if (!home.loadedOnce && home.loading) {
    return el('section', { class: 'home-history' }, [
      el('div', { class: 'home-skeleton' }),
      el('div', { class: 'home-skeleton' }),
      el('div', { class: 'home-skeleton' }),
    ])
  }
  const groups = groupedSessions(home.sessions.filter((row) => !home.pinnedIds.includes(row.sessionId) && !isArchived(row)))
  const rowOptions = { onOpen: onRowOpen, onActions: (row) => onRowActions(row, false, false) }
  const kids = []
  const pinned = renderPinnedSection()
  if (pinned) kids.push(pinned)
  if (groups.length === 0 && !pinned) {
    kids.push(el('p', { class: 'home-empty' }, ['还没有对话，发一条消息开始吧。']))
  }
  for (const group of groups) {
    kids.push(renderSessionGroup(group.label, group.rows, rowOptions))
  }
  const archived = renderArchivedSection()
  if (archived) kids.push(archived)
  if (home.hasMore) {
    kids.push(el('button', {
      type: 'button',
      class: 'home-more',
      disabled: home.loading,
      onclick: () => void loadHomeSessions(false),
    }, [home.loading ? '加载中…' : '加载更多']))
  }
  return el('section', { class: 'home-history' }, kids)
}

export function renderHome() {
  const target = pickWorkspace()
  const kids = [renderTopBar()]
  if (home.error) kids.push(el('p', { class: 'home-error mobile-pad', role: 'alert' }, [home.error]))
  kids.push(el('div', { class: 'home-scroll' }, [
    renderHomeHero({
      draft: home.draft,
      busy: home.busy,
      targetLabel: target ? workspaceTitle(target) : '尚未选择工作区',
      onInput: (value) => { home.draft = value },
      onSend: (text) => void startNewChat(text),
    }),
    renderHistory(),
  ]))
  return el('main', { class: 'mobile home' }, kids)
}
