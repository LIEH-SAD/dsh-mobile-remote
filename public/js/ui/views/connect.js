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
import { renderScanSection, renderPairSection } from './connect-panels.js'

export const conn = {
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

export async function connectManual(raw) {
  const origin = normalizeOrigin(raw)
  if (origin === '') {
    conn.error = '地址格式不对，示例：192.168.2.103:3088'
    render()
    return
  }
  // Stop the background scan first: thousands of probes compete with this
  // deliberate one and made a live host look dead. Give the aborted sockets a
  // moment to drain, then try twice before blaming the address.
  abortScan()
  conn.status = 'idle'
  conn.busy = true
  conn.error = ''
  render()
  await new Promise((resolve) => setTimeout(resolve, 350))
  let host = await probeHost(origin, 6000)
  if (!host) {
    await new Promise((resolve) => setTimeout(resolve, 700))
    host = await probeHost(origin, 6000)
  }
  conn.busy = false
  if (!host) {
    conn.error = '这个地址上没有响应 DSH 宿主，请检查端口（默认 3088）和电脑是否在运行。'
    render()
    return
  }
  if (!conn.hosts.some((row) => row.origin === host.origin)) conn.hosts = [...conn.hosts, host]
  selectHost(host)
}

export async function bind() {
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
