/**
 * Standalone connect view: discover a host on the LAN, then pair once and stay
 * bound forever. This view only exists in the packaged app (a page served by
 * the host is already bound by definition).
 */
import { state } from '../../state/state.js'
import { el } from '../../utils/dom.js'
import { render } from './render.js'
import { probeHost, scanLan } from '../../net/discovery.js'
import { acceptPairAt, parsePairInput } from '../../net/pair.js'
import { loadBinding, saveBinding, rememberHost, normalizeOrigin, clearBinding } from '../../state/binding.js'
import { configureEndpoint } from '../../utils/endpoint.js'

const conn = {
  reason: '',
  status: 'idle', // idle | scanning | ready | error
  hosts: [],
  progress: { done: 0, total: 0 },
  selected: null,
  code: '',
  manual: '',
  busy: false,
  error: '',
  onBound: null,
  scanAbort: null,
  firstScan: false,
}

let statusNode = null

export function enterConnect(options = {}) {
  abortScan()
  conn.reason = typeof options.reason === 'string' ? options.reason : ''
  conn.onBound = typeof options.onBound === 'function' ? options.onBound : conn.onBound
  conn.status = 'idle'
  conn.hosts = []
  conn.selected = null
  conn.code = ''
  conn.busy = false
  conn.error = ''
  conn.progress = { done: 0, total: 0 }
  state.view = 'connect'
  state.error = ''
  render()
  conn.firstScan = true
  void startScan()
}

function abortScan() {
  if (conn.scanAbort) {
    try {
      conn.scanAbort.abort()
    } catch {
      /* already aborted */
    }
    conn.scanAbort = null
  }
}

export async function startScan() {
  abortScan()
  const controller = new AbortController()
  conn.scanAbort = controller
  conn.status = 'scanning'
  conn.hosts = []
  conn.error = ''
  conn.selected = null
  render()
  try {
    await scanLan({
      signal: controller.signal,
      onHost: (host) => {
        if (controller.signal.aborted) return
        if (!conn.hosts.some((row) => row.origin === host.origin)) {
          conn.hosts = [...conn.hosts, host]
          render()
        }
      },
      onProgress: (done, total) => {
        conn.progress = { done, total }
        if (statusNode) {
          statusNode.textContent = `正在扫描局域网 ${done}/${total}…`
        }
      },
    })
    if (controller.signal.aborted) return
    conn.status = conn.hosts.length > 0 ? 'ready' : 'error'
    if (conn.hosts.length === 0) conn.error = '没有发现 DSH 主机。请确认手机和电脑在同一 Wi-Fi，或手动输入地址。'
    conn.scanAbort = null
    render()
  } catch {
    if (controller.signal.aborted) return
    conn.status = 'error'
    conn.error = '扫描失败，请手动输入电脑地址。'
    conn.scanAbort = null
    render()
  }
}

export function rescan() {
  void startScan()
}

function selectHost(host) {
  conn.selected = host
  conn.error = ''
  conn.code = ''
  render()
  setTimeout(() => {
    const input = document.querySelector('.connect-code-input')
    if (input) input.focus({ preventScroll: true })
  }, 30)
}

async function connectManual(raw) {
  const origin = normalizeOrigin(raw)
  if (origin === '') {
    conn.error = '地址格式不对，示例：192.168.2.103:3088'
    render()
    return
  }
  conn.busy = true
  conn.error = ''
  render()
  const host = await probeHost(origin, 2500)
  conn.busy = false
  if (!host) {
    conn.error = '这个地址上没有响应 DSH 宿主，请检查端口（默认 3088）和电脑是否在运行。'
    render()
    return
  }
  if (!conn.hosts.some((row) => row.origin === host.origin)) conn.hosts = [...conn.hosts, host]
  selectHost(host)
}

async function bind() {
  if (!conn.selected || conn.busy) return
  const token = parsePairInput(conn.code)
  if (!token) {
    conn.error = '粘贴配对链接，或输入 6 位配对码。'
    render()
    return
  }
  conn.busy = true
  conn.error = ''
  render()
  try {
    const result = await acceptPairAt(conn.selected.origin, token)
    if (!result.ok) {
      conn.busy = false
      conn.error = result.message || '配对失败。'
      render()
      return
    }
    if (!result.deviceToken) {
      conn.busy = false
      conn.error = '宿主返回的绑定凭据缺失，请重启电脑端 dsh 后重试。'
      render()
      return
    }
    saveBinding({
      origin: conn.selected.origin,
      token: result.deviceToken,
      deviceId: result.deviceId,
      name: conn.selected.name,
    })
    rememberHost({ origin: conn.selected.origin, name: conn.selected.name })
    configureEndpoint(conn.selected.origin, result.deviceToken)
    conn.busy = false
    conn.status = 'ready'
    const onBound = conn.onBound
    if (typeof onBound === 'function') await onBound()
    return
  } catch (err) {
    conn.busy = false
    conn.error = `绑定失败：${String(err.message || err)}`
    render()
  }
}

export function forgetBinding() {
  clearBinding()
  conn.error = ''
  conn.reason = ''
  render()
}

function renderScanSection() {
  const kids = []
  const scanning = conn.status === 'scanning'
  if (conn.reason === 'stale') {
    kids.push(el('p', { class: 'connect-notice' }, ['上次绑定的主机已失效，请重新配对。']))
  }
  kids.push(el('div', { class: 'connect-scan-head' }, [
    el('span', {
      class: 'connect-scan-status',
      'data-state': conn.status,
    }, [
      scanning
        ? `正在扫描局域网 ${conn.progress.done}/${conn.progress.total}…`
        : (conn.hosts.length > 0 ? `发现 ${conn.hosts.length} 台主机` : '自动发现局域网内的 DSH 主机'),
    ]),
    el('button', {
      type: 'button',
      class: 'connect-rescan',
      disabled: scanning || conn.busy,
      onclick: () => rescan(),
    }, [scanning ? '扫描中…' : '重新扫描']),
  ]))

  if (conn.hosts.length > 0) {
    kids.push(el('div', { class: 'connect-hosts' }, conn.hosts.map((host) => el('button', {
      type: 'button',
      class: `connect-host${conn.selected && conn.selected.origin === host.origin ? ' is-selected' : ''}`,
      onclick: () => selectHost(host),
    }, [
      el('span', { class: 'connect-host-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>' }),
      el('span', { class: 'connect-host-main' }, [
        el('span', { class: 'connect-host-name' }, [host.name || 'DSH 宿主']),
        el('span', { class: 'connect-host-origin' }, [host.origin.replace(/^https?:\/\//, '')]),
      ]),
      el('span', { class: 'connect-host-meta' }, [host.version ? `v${host.version}` : '可连接']),
    ]))))
  }

  kids.push(el('div', { class: 'connect-manual' }, [
    el('input', {
      class: 'connect-manual-input',
      type: 'text',
      inputmode: 'url',
      placeholder: '手动输入地址，如 192.168.2.103:3088',
      value: conn.manual || '',
      oninput: (ev) => {
        conn.manual = ev.target.value
      },
      onkeydown: (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault()
          void connectManual(ev.target.value)
        }
      },
    }),
    el('button', {
      type: 'button',
      class: 'connect-manual-go',
      disabled: conn.busy,
      onclick: () => void connectManual(conn.manual || ''),
    }, [conn.busy ? '连接中…' : '连接']),
  ]))
  return kids
}

function renderPairSection() {
  if (!conn.selected) return []
  const host = conn.selected
  return [
    el('div', { class: 'connect-pair' }, [
      el('p', { class: 'connect-pair-title' }, [`配对到 ${host.name || 'DSH 宿主'}`]),
      el('p', { class: 'connect-pair-sub' }, [host.origin.replace(/^https?:\/\//, '')]),
      el('input', {
        class: 'connect-code-input',
        type: 'text',
        inputmode: 'numeric',
        autocomplete: 'off',
        placeholder: '粘贴配对链接或输入 6 位配对码',
        value: conn.code,
        oninput: (ev) => {
          conn.code = ev.target.value
        },
        onkeydown: (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault()
            void bind()
          }
        },
      }),
      el('button', {
        type: 'button',
        class: 'connect-bind',
        disabled: conn.busy || conn.code.trim() === '',
        onclick: () => void bind(),
      }, [conn.busy ? '正在绑定…' : '绑定并进入']),
      el('p', { class: 'connect-hint' }, [
        '配对码在电脑端打开 ',
        el('code', {}, ['http://127.0.0.1:57016/mp/setup']),
        ' 获取，2 小时内有效。绑定一次后永久有效。',
      ]),
    ]),
  ]
}

export function renderConnect() {
  const binding = loadBinding()
  const kids = [
    el('div', { class: 'connect-brand' }, [
      el('img', { class: 'connect-logo', src: './logo.svg', alt: '' }),
      el('h1', { class: 'connect-title' }, ['连接 DSH 主机']),
      el('p', { class: 'connect-sub' }, ['自动发现局域网内的宿主，配对一次后永久有效']),
    ]),
    el('section', { class: 'connect-card' }, renderScanSection()),
  ]
  kids.push(...renderPairSection())
  if (conn.error) kids.push(el('p', { class: 'connect-error', role: 'alert' }, [conn.error]))
  if (binding) {
    kids.push(el('button', {
      type: 'button',
      class: 'connect-forget',
      onclick: () => forgetBinding(),
    }, [`解除当前绑定（${binding.origin.replace(/^https?:\/\//, '')}）`]))
  }
  const main = el('main', { class: 'mobile mobile-connect' }, kids)
  statusNode = main.querySelector('.connect-scan-status')
  return main
}
