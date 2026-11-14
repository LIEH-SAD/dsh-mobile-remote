/**
 * DeepSeek-style session sidebar drawer for the mobile surface.
 *
 * Lives on document.body with its own root, so a view re-render can never
 * steal its scroll position or its open state. Data loading, calendar-day
 * grouping and row markup live in sidebar-data.js.
 * Styles: public/css/sidebar.css (the @import is wired by the integrator).
 */
import { state } from '../state/state.js'
import { el } from '../utils/dom.js'
import { navigateToSession } from '../state/route.js'
import { createSessionInWorkspace } from './views/session-create.js'
import { render } from './views/render.js'
import { headerIcon } from './theme.js'
import * as homeModule from './views/home.js'
import {
  sidebarData,
  renderSidebarBody,
  loadSidebarData,
  loadMoreSidebarData,
} from './sidebar-data.js'

const svg = (body, width = 1.8) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const ICON_MENU = svg('<path d="M4 7h16M4 12h16M4 17h16"/>')
const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6 6 18"/>')
const ICON_SETTINGS = svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>')

const sidebar = { open: false, mounted: false }
const nodes = { root: null, panel: null, scroll: null }
let savedOverflow = ''
let escHandler = null

function rowHandlers() {
  const hook = typeof window !== 'undefined' ? window.__mpOpenSessionActions : null
  return {
    onSelect: (sessionId) => {
      closeSidebar()
      void navigateToSession(sessionId)
    },
    onActions: typeof hook === 'function' ? (row) => hook(row) : null,
    onTogglePins: () => {
      sidebarData.collapsedPins = !sidebarData.collapsedPins
      renderBody()
    },
    onRetry: () => void refreshSidebar(),
    onLoadMore: () => void loadMore(),
  }
}

function renderBody() {
  renderSidebarBody(nodes.scroll, rowHandlers())
}

function newChat() {
  closeSidebar()
  // pickWorkspace is exported by views/home.js (Lead-owned). Fall back to the
  // first known workspace so the button still does something if not wired.
  const pick = typeof homeModule.pickWorkspace === 'function'
    ? homeModule.pickWorkspace
    : () => (state.workspaces || [])[0] || null
  void createSessionInWorkspace(pick())
}

function ensureMounted() {
  if (nodes.root && document.body.contains(nodes.root)) return
  const root = el('div', { id: 'mp-sidebar', class: 'mp-sidebar-root', 'aria-hidden': 'true' })
  const scroll = el('div', { class: 'sidebar-scroll', role: 'navigation', 'aria-label': '对话历史' })
  scroll.addEventListener('scroll', () => { sidebarData.scrollTop = scroll.scrollTop }, { passive: true })
  const panel = el('aside', {
    class: 'sidebar', role: 'dialog', 'aria-modal': 'true', 'aria-label': '对话历史', tabindex: '-1',
  }, [
    el('div', { class: 'sidebar-head' }, [
      el('img', { class: 'sidebar-logo', src: './logo.svg', alt: '' }),
      el('span', { class: 'sidebar-brand' }, ['DSH']),
      el('button', { type: 'button', class: 'sidebar-close', 'aria-label': '关闭侧栏', onclick: () => closeSidebar() }, [
        headerIcon(ICON_CLOSE),
      ]),
    ]),
    el('button', { type: 'button', class: 'sidebar-new', onclick: () => newChat() }, ['开启新对话']),
    scroll,
    el('div', { class: 'sidebar-foot' }, [
      el('button', {
        type: 'button', class: 'sidebar-settings',
        onclick: () => { closeSidebar(); state.sheetReturn = null; state.sheet = 'settings'; render() },
      }, [headerIcon(ICON_SETTINGS), el('span', { class: 'sidebar-foot-label' }, ['设置'])]),
    ]),
  ])
  // Swipe left on the drawer to dismiss it.
  let startX = 0
  let startY = 0
  let tracking = false
  panel.addEventListener('touchstart', (ev) => {
    const touch = ev.touches[0]
    if (!touch) return
    startX = touch.clientX
    startY = touch.clientY
    tracking = true
  }, { passive: true })
  panel.addEventListener('touchend', (ev) => {
    if (!tracking) return
    tracking = false
    const touch = ev.changedTouches[0]
    if (!touch || !sidebar.open) return
    if (startX - touch.clientX > 56 && Math.abs(startY - touch.clientY) < 60) closeSidebar()
  }, { passive: true })
  root.append(el('div', { class: 'sidebar-backdrop', onclick: () => closeSidebar() }), panel)
  document.body.appendChild(root)
  nodes.root = root
  nodes.panel = panel
  nodes.scroll = scroll
  sidebar.mounted = true
}

export function openSidebar() {
  ensureMounted()
  if (sidebar.open) { void refreshSidebar(); return }
  sidebar.open = true
  savedOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  nodes.root.classList.add('is-open')
  nodes.root.setAttribute('aria-hidden', 'false')
  try { nodes.panel.focus({ preventScroll: true }) } catch { /* older WebView */ }
  escHandler = (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Esc') { ev.preventDefault(); closeSidebar() }
  }
  document.addEventListener('keydown', escHandler)
  renderBody()
  void refreshSidebar()
}

export function closeSidebar() {
  if (!sidebar.open) return
  sidebar.open = false
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null }
  if (nodes.root) {
    nodes.root.classList.remove('is-open')
    nodes.root.setAttribute('aria-hidden', 'true')
  }
  document.body.style.overflow = savedOverflow || ''
  savedOverflow = ''
}

export function toggleSidebar() {
  if (sidebar.open) closeSidebar()
  else openSidebar()
}

export function sidebarButton() {
  return el('button', {
    type: 'button', class: 'mobile-theme-toggle sidebar-trigger',
    'aria-label': '对话历史', 'aria-haspopup': 'dialog', title: '对话历史',
    onclick: () => toggleSidebar(),
  }, [headerIcon(ICON_MENU)])
}

/**
 * Pull sessions + pins again and repaint. Safe to call when closed (the Lead
 * calls it synchronously after pin/rename changes); it never opens the drawer.
 */
export async function refreshSidebar() {
  ensureMounted()
  sidebarData.loading = true
  sidebarData.error = ''
  renderBody()
  await loadSidebarData()
  if (sidebar.open) renderBody()
}

async function loadMore() {
  await loadMoreSidebarData()
  if (sidebar.open) renderBody()
}

// Bridge used by session-actions.js after rename/pin/delete:
// `window.__mpRefreshSidebar?.()`. Optional chaining there, so it is safe
// for this module to own the hook (it never opens the drawer).
if (typeof window !== 'undefined') {
  window.__mpRefreshSidebar = () => { void refreshSidebar() }
}
