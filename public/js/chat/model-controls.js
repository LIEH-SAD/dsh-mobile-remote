/**
 * Composer model controls: 深度思考 toggle + model/effort selector.
 * Split out of composer.js so that file stays within the size budget.
 */
import { state, chat } from '../state/state.js'
import { el } from '../utils/dom.js'
import { call } from '../net/rpc.js'
import { render } from '../ui/views/render.js'
import { currentModelLabel } from '../ui/sheets/model-catalog.js'
import { openModelSheet } from '../ui/sheets/model-sheet.js'

const HIGH_EFFORTS = ['high', 'max', 'xhigh']

export function deepThinkActive() {
  if (chat.currentModel && typeof chat.currentModel.reasoningEffort === 'string') {
    return HIGH_EFFORTS.includes(chat.currentModel.reasoningEffort)
  }
  return chat.deepThink === true
}

/** 深度思考 toggle (DeepSeek-style pill). On = high reasoning effort. */
export function makeDeepThinkToggle() {
  const on = deepThinkActive()
  return el('button', {
    type: 'button',
    class: `chat-toggle${on ? ' is-on' : ''}`,
    'aria-pressed': on ? 'true' : 'false',
    'aria-label': '深度思考',
    onclick: () => void toggleDeepThink(),
  }, [
    el('span', {
      class: 'chat-toggle-icon',
      'aria-hidden': 'true',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .85 1.6l.05.6h5.4l.05-.6c.05-.6.35-1.2.85-1.6A6 6 0 0 0 12 3Z"/></svg>',
    }),
    el('span', { class: 'chat-toggle-label' }, ['深度思考']),
  ])
}

export async function toggleDeepThink() {
  const next = !deepThinkActive()
  chat.deepThink = next
  try { localStorage.setItem('dsh.mobile.deepThink', next ? '1' : '0') } catch { /* ignore */ }
  const sid = state.session?.sessionId
  const selection = chat.currentModel || state.defaultModel
  if (sid && selection?.provider && selection?.model) {
    try {
      const result = await call('session.selectModel', {
        sessionId: sid,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: next ? 'high' : 'off',
      })
      if (result && result.selected) chat.currentModel = result.selected
    } catch {
      /* host may not accept the effort: keep the visual toggle */
    }
  }
  render()
}

export function makeModelChip() {
  const selection = chat.currentModel
  const raw = currentModelLabel() || (selection && selection.model) || state.defaultModel?.model || '选择模型'
  // The reference shows a compact "DeepSeek-V3.2"-style label; the provider
  // prefix is redundant on a narrow control row.
  const label = raw.length > 16 ? raw.replace(/^DeepSeek[-\s]?/i, '') : raw
  const effortName = { off: '关', low: '低', medium: '中', high: '高', max: '最高', xhigh: '超高' }
  const effort = selection && selection.reasoningEffort
    ? ` · ${effortName[selection.reasoningEffort] || selection.reasoningEffort}`
    : ''
  return el('button', {
    type: 'button',
    class: 'chat-chip chat-chip-model',
    title: '模型与思考强度',
    'aria-haspopup': 'dialog',
    onclick: () => {
      state.sheetReturn = null
      openModelSheet()
    },
  }, [
    el('span', { class: 'chat-chip-label' }, ['模型']),
    el('span', { class: 'chat-chip-value' }, [`${label}${effort}`]),
    el('span', { class: 'chat-chip-chevron', 'aria-hidden': 'true' }, ['›']),
  ])
}
