/**
 * Connect-screen panels: LAN scan card and pairing card. Split out of
 * connect.js to keep that module inside the size budget.
 */
import { el } from '../../utils/dom.js'
import { conn, rescan, connectManual, bind } from './connect.js'
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


export { renderScanSection, renderPairSection }