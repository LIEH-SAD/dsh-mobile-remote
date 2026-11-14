/**
 * Home hero: greeting + new-chat composer card. Extracted from home.js to keep
 * that file inside the size budget; all state stays owned by home.js.
 */
import { el } from '../../utils/dom.js'

function autosize(node) {
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${Math.min(node.scrollHeight, 120)}px`
}

export function syncHomeSendButton(busy) {
  const btn = document.querySelector('.home-send')
  if (btn) btn.disabled = Boolean(busy)
}

export function renderHero(options = {}) {
  const {
    draft = '',
    busy = false,
    targetLabel = '',
    placeholder = '给 DSH 发送消息…',
    onInput = () => {},
    onSend = () => {},
  } = options

  const input = el('textarea', {
    class: 'home-input',
    rows: '2',
    placeholder,
    value: draft,
    oninput: (ev) => {
      onInput(ev.target.value)
      autosize(ev.target)
      syncHomeSendButton(busy)
    },
    onkeydown: (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault()
        onSend(ev.target.value)
      }
    },
  })
  if (draft) setTimeout(() => autosize(input), 0)

  const sendBtn = el('button', {
    type: 'button',
    class: 'home-send',
    'aria-label': '开始新对话',
    disabled: busy,
    onclick: () => onSend(input.value),
  }, [busy ? '…' : '↑'])

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
