/**
 * Home list rows and date grouping (shared by the home view and, later, the
 * sidebar). Kept out of home.js so that file stays inside the size budget.
 */
import { el } from '../../utils/dom.js'
import { formatTime } from '../../utils/time.js'

const DAY = 24 * 60 * 60 * 1000
const FIXED_GROUPS = ['今天', '昨天', '7 天内', '30 天内']

function pad2(n) {
  return String(n).padStart(2, '0')
}

function startOfToday() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function groupLabel(ms) {
  // Reference logic: diff whole calendar days, not fixed 24h windows.
  const base = startOfToday()
  const day = new Date(ms)
  if (Number.isNaN(day.getTime())) return '今天'
  day.setHours(0, 0, 0, 0)
  const diff = Math.round((base - day.getTime()) / DAY)
  if (diff <= 0) return '今天'
  if (diff <= 1) return '昨天'
  if (diff < 7) return '7 天内'
  if (diff < 30) return '30 天内'
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}`
}

export function groupedSessions(rows) {
  const groups = new Map()
  for (const row of rows || []) {
    const label = groupLabel(typeof row.updatedAt === 'number' ? row.updatedAt : 0)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(row)
  }
  const months = [...groups.keys()]
    .filter((label) => !FIXED_GROUPS.includes(label))
    .sort()
    .reverse()
  return [...FIXED_GROUPS, ...months]
    .filter((label) => groups.has(label))
    .map((label) => ({ label, rows: groups.get(label) }))
}

export function sessionTitleOf(row) {
  const title = row?.title ?? row?.projections?.values?.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  return '新对话'
}

/**
 * One conversation row: tap opens, 「⋯」 opens the action sheet. Rendered as a
 * wrapper with two sibling buttons so no interactive element nests.
 */
export function renderSessionRow(row, options = {}) {
  const running = row?.running === true
  const onOpen = typeof options.onOpen === 'function' ? options.onOpen : () => {}
  const onActions = typeof options.onActions === 'function' ? options.onActions : null
  const kids = [
    el('button', {
      type: 'button',
      class: 'home-row',
      onclick: () => onOpen(row),
    }, [
      el('span', { class: 'home-row-main' }, [
        el('span', { class: 'home-row-title' }, [sessionTitleOf(row)]),
        el('span', { class: 'home-row-meta' }, [
          running ? el('span', { class: 'home-row-running' }, ['运行中']) : null,
          formatTime(row?.updatedAt),
        ].filter(Boolean)),
      ]),
    ]),
  ]
  if (onActions) {
    kids.push(el('button', {
      type: 'button',
      class: 'home-row-more',
      'aria-label': '会话操作',
      title: '会话操作',
      onclick: (event) => {
        event.stopPropagation()
        onActions(row, options.pinned === true)
      },
    }, ['⋯']))
  }
  return el('div', { class: 'home-row-wrap' }, kids)
}

export function renderSessionGroup(label, rows, options = {}) {
  return el('div', { class: 'home-group' }, [
    el('div', { class: 'home-group-title' }, [label]),
    el('div', { class: 'home-rows' }, rows.map((row) => renderSessionRow(row, options))),
  ])
}

/** Collapsible special group (置顶 / 已归档) with a sticky-looking title row. */
export function renderCollapsibleGroup(options = {}) {
  const {
    label,
    rows = [],
    collapsed = false,
    onToggle = null,
    groupClass = '',
    listClass = '',
    rowOptions = {},
  } = options
  const toggleable = typeof onToggle === 'function'
  const title = toggleable
    ? el('button', {
      type: 'button',
      class: 'home-group-title home-group-toggle',
      'aria-expanded': collapsed ? 'false' : 'true',
      onclick: () => onToggle(!collapsed),
    }, [
      el('span', { class: 'home-group-caret' }, [collapsed ? '›' : '⌄']),
      label,
    ])
    : el('div', { class: 'home-group-title' }, [label])
  return el('div', { class: `home-group ${groupClass}`.trim() }, [
    title,
    collapsed ? null : el('div', { class: `home-rows ${listClass}`.trim() }, rows.map((row) => renderSessionRow(row, rowOptions))),
  ])
}
