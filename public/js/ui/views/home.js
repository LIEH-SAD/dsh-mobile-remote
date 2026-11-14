/**
 * DeepSeek-style home: greeting, a new-chat composer, and history grouped the
 * way chat.deepseek.com groups it (今天 / 昨天 / 7 天内 / 30 天内 / 更早).
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
import { formatTime } from '../../utils/time.js'
import { globalSettingsButton, todayButton } from '../theme.js'

const DAY = 24 * 60 * 60 * 1000

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
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function startOfToday() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function groupLabel(ms) {
  const base = startOfToday()
  if (ms >= base) return '今天'
  if (ms >= base - DAY) return '昨天'
  if (ms >= base - 7 * DAY) return '7 天内'
  if (ms >= base - 30 * DAY) return '30 天内'
  return '更早'
}

const GROUP_ORDER = ['今天', '昨天', '7 天内', '30 天内', '更早']

function sessionTitle(row) {
  const title = row?.projections?.values?.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  return '新对话'
}

export function groupedSessions(rows) {
  const groups = new Map()
  for (const row of rows || []) {
    const label = groupLabel(typeof row.updatedAt === 'number' ? row.updatedAt : 0)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(row)
  }
  return GROUP_ORDER
    .filter((label) => groups.has(label))
    .map((label) => ({ label, rows: groups.get(label) }))
}

function pickWorkspace() {
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
  if (home.loading) return
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
  } catch (err) {
    home.error = String(err.message || err)
  } finally {
    home.loading = false
    render()
  }
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
      el('img', { class: 'home-logo', src: './logo.svg', alt: '' }),
      el('span', { class: 'home-brand-name' }, ['DSH']),
    ]),
    el('div', { class: 'home-top-actions' }, [
      todayButton(),
      globalSettingsButton(),
    ]),
  ])
}

function renderHero() {
  const target = pickWorkspace()
  const targetLabel = target ? workspaceTitle(target) : '尚未选择工作区'
  const input = el('textarea', {
    class: 'home-input',
    rows: '2',
    placeholder: '给 DSH 发送消息…',
    value: home.draft,
    oninput: (ev) => {
      home.draft = ev.target.value
      autosize(ev.target)
      syncSendButton()
    },
    onkeydown: (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault()
        void startNewChat(home.draft)
      }
    },
  })
  if (home.draft) setTimeout(() => autosize(input), 0)

  const sendBtn = el('button', {
    type: 'button',
    class: 'home-send',
    'aria-label': '开始新对话',
    disabled: home.busy,
    onclick: () => void startNewChat(home.draft),
  }, [home.busy ? '…' : '↑'])

  return el('section', { class: 'home-hero' }, [
    el('h1', { class: 'home-greeting' }, ['欢迎回来，想从哪里开始？']),
    el('div', { class: 'home-composer' }, [
      input,
      el('div', { class: 'home-composer-tools' }, [
        el('span', { class: 'home-target' }, [targetLabel]),
        sendBtn,
      ]),
    ]),
    el('p', { class: 'home-hint' }, ['发送后会新建一个对话；也可以从下面的历史继续。']),
  ])
}

function autosize(node) {
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${Math.min(node.scrollHeight, 120)}px`
}

function syncSendButton() {
  // Only the affordance changes with the draft; re-rendering the composer would
  // steal the caret, so touch the button directly.
  const btn = document.querySelector('.home-send')
  if (!btn) return
  btn.disabled = home.busy
}

function renderHistory() {
  if (!home.loadedOnce && home.loading) {
    return el('section', { class: 'home-history' }, [
      el('div', { class: 'home-skeleton' }),
      el('div', { class: 'home-skeleton' }),
      el('div', { class: 'home-skeleton' }),
    ])
  }
  const groups = groupedSessions(home.sessions)
  const kids = []
  if (groups.length === 0) {
    kids.push(el('p', { class: 'home-empty' }, ['还没有对话，发一条消息开始吧。']))
  }
  for (const group of groups) {
    kids.push(el('div', { class: 'home-group' }, [
      el('div', { class: 'home-group-title' }, [group.label]),
      el('div', { class: 'home-rows' }, group.rows.map(renderRow)),
    ]))
  }
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

function renderRow(row) {
  const running = row?.running === true
  return el('button', {
    type: 'button',
    class: 'home-row',
    onclick: () => {
      if (row?.sessionId) void navigateToSession(row.sessionId)
    },
  }, [
    el('span', { class: 'home-row-main' }, [
      el('span', { class: 'home-row-title' }, [sessionTitle(row)]),
      el('span', { class: 'home-row-meta' }, [
        running ? el('span', { class: 'home-row-running' }, ['运行中']) : null,
        formatTime(row?.updatedAt),
      ].filter(Boolean)),
    ]),
  ])
}

export function renderHome() {
  const kids = [renderTopBar()]
  if (home.error) kids.push(el('p', { class: 'home-error mobile-pad', role: 'alert' }, [home.error]))
  kids.push(el('div', { class: 'home-scroll' }, [
    renderHero(),
    renderHistory(),
  ]))
  return el('main', { class: 'mobile home' }, kids)
}
