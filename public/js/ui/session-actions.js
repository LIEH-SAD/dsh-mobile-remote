/**
 * Session action sheet: rename / pin / archive, reference-page style.
 *
 * Kept separate from the generic sheet portal so the home list can own its own
 * overlay without touching the shared sheet dispatcher.
 */
import { el } from '../utils/dom.js'
import { call } from '../net/rpc.js'
import { showToast } from '../utils/toast.js'

const HOST_ID = 'mp-session-actions'

let panel = null
let current = null

function rowTitle(row) {
  const title = row?.title ?? row?.projections?.values?.title
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : '新对话'
}

function mount() {
  closeSessionActions()
  if (!current) return
  const overlay = el('div', { class: 'sx-overlay', id: HOST_ID }, [
    el('div', { class: 'sx-backdrop', onclick: () => closeSessionActions() }),
    el('div', { class: 'sx-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '会话操作' }, [
      el('div', { class: 'sx-handle' }),
      el('p', { class: 'sx-title', title: rowTitle(current.row) }, [rowTitle(current.row)]),
      renderBody(),
    ]),
  ])
  panel = overlay
  document.body.appendChild(overlay)
}

function renderBody() {
  if (!current) return el('div')
  if (current.error) {
    return el('div', { class: 'sx-body' }, [
      el('p', { class: 'sx-error', role: 'alert' }, [current.error]),
      el('button', { type: 'button', class: 'sx-option', onclick: () => { current.error = ''; mount() } }, ['返回']),
    ])
  }
  if (current.mode === 'rename') {
    const input = el('input', {
      class: 'sx-input',
      type: 'text',
      value: current.input,
      placeholder: '会话名称',
      oninput: (ev) => { current.input = ev.target.value },
      onkeydown: (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault()
          void submitRename()
        }
      },
    })
    setTimeout(() => input.focus({ preventScroll: true }), 30)
    return el('div', { class: 'sx-body' }, [
      input,
      el('div', { class: 'sx-row' }, [
        el('button', { type: 'button', class: 'sx-secondary', disabled: current.busy, onclick: () => { current.mode = 'menu'; mount() } }, ['取消']),
        el('button', { type: 'button', class: 'sx-primary', disabled: current.busy || current.input.trim() === '', onclick: () => void submitRename() }, [current.busy ? '保存中…' : '保存']),
      ]),
    ])
  }
  if (current.mode === 'delete') {
    return el('div', { class: 'sx-body' }, [
      el('p', { class: 'sx-confirm' }, ['删除这个会话？此操作不可恢复。']),
      el('div', { class: 'sx-row' }, [
        el('button', { type: 'button', class: 'sx-secondary', disabled: current.busy, onclick: () => { current.mode = 'menu'; mount() } }, ['取消']),
        el('button', { type: 'button', class: 'sx-danger', disabled: current.busy, onclick: () => void submitDelete() }, [current.busy ? '删除中…' : '删除']),
      ]),
    ])
  }
  const pinned = current.pinned === true
  const archived = current.archived === true
  const options = [
    el('button', { type: 'button', class: 'sx-option', onclick: () => {
      current.mode = 'rename'
      current.input = rowTitle(current.row)
      current.busy = false
      mount()
    } }, ['重命名']),
  ]
  if (!archived) {
    options.push(el('button', { type: 'button', class: 'sx-option', disabled: current.busy, onclick: () => void submitPin(!pinned) }, [
      current.busy ? '处理中…' : (pinned ? '取消置顶' : '置顶对话'),
    ]))
  }
  if (archived) {
    options.push(el('button', { type: 'button', class: 'sx-option', disabled: current.busy, onclick: () => void submitRestore() }, [
      current.busy ? '恢复中…' : '恢复会话',
    ]))
  } else {
    options.push(el('button', { type: 'button', class: 'sx-option is-danger', onclick: () => {
      current.mode = 'delete'
      mount()
    } }, ['删除会话']))
  }
  return el('div', { class: 'sx-body' }, options)
}

function rerender() {
  if (!panel) {
    mount()
    return
  }
  const sheet = panel.querySelector('.sx-sheet')
  if (!sheet) {
    mount()
    return
  }
  const body = sheet.querySelector('.sx-body')
  const next = renderBody()
  if (body) body.replaceWith(next)
  else sheet.append(next)
}

export async function refreshAfterMutation() {
  try {
    window.__mpRefreshSidebar?.()
  } catch {
    /* sidebar may not be mounted yet */
  }
  try {
    const home = await import('./home.js')
    if (typeof home.refreshHome === 'function') await home.refreshHome()
  } catch {
    /* home may be unavailable (e.g. inside chat) */
  }
}

async function submitRename() {
  if (!current || current.busy) return
  const title = String(current.input || '').trim()
  if (title === '') return
  current.busy = true
  current.error = ''
  rerender()
  try {
    await call('session.rename', { sessionId: current.row.sessionId, title })
    showToast('已重命名')
    await refreshAfterMutation()
    closeSessionActions()
  } catch (err) {
    current.busy = false
    current.error = `重命名失败：${String(err.message || err)}`
    rerender()
  }
}

async function submitPin(pinned) {
  if (!current || current.busy) return
  current.busy = true
  current.error = ''
  rerender()
  try {
    await call('session.pin', { sessionId: current.row.sessionId, pinned })
    showToast(pinned ? '已置顶' : '已取消置顶')
    await refreshAfterMutation()
    closeSessionActions()
  } catch (err) {
    current.busy = false
    current.error = `操作失败：${String(err.message || err)}`
    rerender()
  }
}

async function submitDelete() {
  if (!current || current.busy) return
  current.busy = true
  current.error = ''
  rerender()
  try {
    await call('session.archive', { sessionId: current.row.sessionId })
    showToast('已删除')
    await refreshAfterMutation()
    closeSessionActions()
  } catch (err) {
    current.busy = false
    current.error = `删除失败：${String(err.message || err)}`
    rerender()
  }
}

async function submitRestore() {
  if (!current || current.busy) return
  current.busy = true
  current.error = ''
  rerender()
  try {
    await call('session.unarchive', { sessionId: current.row.sessionId })
    showToast('已恢复')
    await refreshAfterMutation()
    closeSessionActions()
  } catch (err) {
    current.busy = false
    current.error = `恢复失败：${String(err.message || err)}`
    rerender()
  }
}

export function openSessionActions(row) {
  if (!row || typeof row.sessionId !== 'string') return
  current = {
    row,
    mode: 'menu',
    busy: false,
    error: '',
    input: '',
    pinned: row.pinned === true,
    archived: row.archived === true,
  }
  mount()
}

export function closeSessionActions() {
  if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
  panel = null
}

// Sidebar and home rows call this hook without importing the module.
if (typeof window !== 'undefined') {
  window.__mpOpenSessionActions = openSessionActions
}
