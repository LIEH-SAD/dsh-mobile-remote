/**
 * "Back to the newest" button for a reader who is up in the history.
 *
 * Streaming replies never pull the viewport back while somebody is reading
 * (the scroll lock already guarantees that), so that reader needs a way home.
 * The button appears once they leave the bottom, counts what arrived meanwhile
 * (for the `has-unseen` accent), and disappears as soon as they are back at the
 * newest message.
 */
import { el } from '../utils/dom.js'
import { scrollToLatest } from './timeline.js'

/** Far enough from the bottom that incidental jitter cannot flip it. */
const AWAY_PX = 200

const ARROW_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3.6v8.8"/><path d="M4.1 8.6 8 12.5l3.9-3.9"/></svg>'

let chip = null
let unseen = 0
let lastCount = 0
let away = false

function paint() {
  if (!chip) return
  chip.classList.toggle('is-visible', away)
  chip.classList.toggle('has-unseen', unseen > 0)
}

export function ensureLatestChip() {
  if (chip) return chip
  chip = el('button', {
    type: 'button',
    class: 'chat-scroll-bottom',
    'aria-label': '回到底部',
    title: '回到底部',
    onclick: () => {
      unseen = 0
      away = false
      scrollToLatest()
      paint()
    },
  }, [
    el('span', { class: 'chat-scroll-bottom-icon', 'aria-hidden': 'true', html: ARROW_ICON }),
  ])
  return chip
}

function distanceFromBottom(scroller) {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
}

/**
 * Called on every reader scroll. Only the pane's own metrics decide this, so
 * a render that writes `scrollTop` cannot leave the button showing.
 */
export function noteReaderScroll(scroller) {
  if (!scroller) return
  const next = distanceFromBottom(scroller) > AWAY_PX
  if (next === away) return
  away = next
  if (!away) unseen = 0
  paint()
}

/** Count messages that landed while the reader was away. */
export function noteMessageCount(count) {
  if (typeof count !== 'number') return
  if (away && count > lastCount) unseen += count - lastCount
  lastCount = count
  paint()
}

/** Re-evaluate after a render changed the pane's height or the message count. */
export function syncLatestChip(scroller, count) {
  if (scroller) {
    away = distanceFromBottom(scroller) > AWAY_PX
    if (!away) unseen = 0
  }
  if (typeof count === 'number') {
    if (away && count > lastCount) unseen += count - lastCount
    lastCount = count
  }
  paint()
}

/** A session switch drops the counter and hides the button. */
export function resetLatestChip(count) {
  unseen = 0
  away = false
  lastCount = typeof count === 'number' ? count : 0
  paint()
}
