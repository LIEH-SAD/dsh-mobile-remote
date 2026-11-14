/**
 * dsh-mobile-plus — mobile application entry point.
 * Only dependency wiring and lifecycle initialization live here.
 */
import { state, runtime } from './state/state.js'
import { pairStatus, acceptPair, parsePairInput, checkPairStatus, cleanPairUrl } from './net/pair.js'
import { loadQuota } from './net/quota.js'
import { refreshPending } from './net/pending.js'
import { refreshLiveSnapshot } from './ui/views/session-view.js'
import { enterApp, render } from './ui/views/render.js'
import { applyTheme } from './ui/theme.js'
import { installOverscrollLock, pinViewport, installChatGestureWatch } from './utils/scroll.js'
import { installKeyboardFitBar } from './chat/keyboard-fit-bar.js'
import { installKeyboardHideWatch } from './chat/keyboard-hide-watch.js'
import { installKeyboardGapStrip } from './chat/keyboard-gap-strip.js'
import { autosizeInput, flushComposerRender } from './chat/composer.js'
import { reloadPaired, applyRoute, parseRoute, navigateToSession } from './state/route.js'
import { setupPinsSync } from './net/pins.js'
import { installAudioUnlockOnGesture, syncPushSubscription } from './utils/notify.js'
import { enterConnect } from './ui/views/connect.js'
import { isStandaloneMode, loadBinding } from './state/binding.js'
import { configureEndpoint } from './utils/endpoint.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** boot() is re-runnable: after a successful standalone pairing we land here again. */
function retryBoot() {
  void boot()
}

async function bootStandalone() {
  const binding = loadBinding()
  if (!binding) {
    enterConnect({ reason: 'welcome', onBound: retryBoot })
    return
  }
  configureEndpoint(binding.origin, binding.token)
  state.bootMessage = '正在连接主机…'
  render()
  let check = await checkPairStatus()
  if (check.offline) {
    for (let i = 0; i < 3; i++) {
      await sleep(1200)
      check = await checkPairStatus()
      if (!check.offline) break
    }
  }
  if (check.offline) {
    state.bootMessage = ''
    enterConnect({ reason: 'offline', onBound: retryBoot })
    return
  }
  if (check.ok && check.paired !== true) {
    state.bootMessage = ''
    enterConnect({ reason: 'stale', onBound: retryBoot })
    return
  }
  state.bootMessage = ''
  await enterApp()
}

async function bootHostServed() {
  configureEndpoint('', '')
  let check = await checkPairStatus()
  // 若服务刚重启中（offline），进行短暂自动重试，平滑等待主机就绪，避免误判未配对
  if (check.offline) {
    state.bootMessage = '正在连接主机…'
    render()
    for (let i = 0; i < 3; i++) {
      await sleep(1200)
      check = await checkPairStatus()
      if (!check.offline) break
    }
  }

  if (check.offline) {
    state.bootMessage = ''
    state.error = '无法连接到 DSH 主机，主机可能正在重启或离线。'
    state.view = 'error'
    render()
    return
  }

  state.bootMessage = ''
  if (check.paired) {
    cleanPairUrl()
    await enterApp()
    return
  }

  const token = parsePairInput(window.location.href)
  if (token) {
    const message = await acceptPair(token)
    if (!message) {
      cleanPairUrl()
      reloadPaired()
      return
    }
    // A double load (reload, restored tab, WebView re-entry) can consume the
    // one-time token in the first load; if this browser is already paired,
    // do not show a bogus "invalid link" error.
    const recheck = await checkPairStatus(2500)
    if (recheck.ok && recheck.paired === true) {
      cleanPairUrl()
      await enterApp()
      return
    }
    state.dirError = message
  }
  state.view = 'pair'
  render()
}

export async function boot() {
  runtime.bootEntered = false
  state.view = 'boot'
  state.bootMessage = ''
  // If an earlier render failed, boot must still be able to take the screen
  // back instead of staying on the error page.
  state.error = ''
  render()
  try {
    if (isStandaloneMode()) {
      await bootStandalone()
      return
    }
    await bootHostServed()
  } catch (err) {
    state.bootMessage = ''
    state.error = String(err.message || err)
    state.view = 'error'
    render()
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function isSecurePage() {
  return window.isSecureContext === true
}

export function isAppleMobile() {
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
}

export function registerPwa() {
  // A packaged standalone app is not served by the host: no /mp service
  // worker scope and no push registration there.
  if (isStandaloneMode()) return
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register('/mp/sw.js', { scope: '/mp/', updateViaCache: 'none' }).catch(() => {})
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'dsh-open-session' && event.data.sessionId) {
        void navigateToSession(event.data.sessionId)
      }
    })
    void syncPushSubscription()
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    runtime.deferredInstallPrompt = event
  })
  window.addEventListener('appinstalled', () => {
    runtime.deferredInstallPrompt = null
    if (state.sheet === 'pwa') {
      state.sheet = null
      render()
    }
  })
}

export function onForeground() {
  if (runtime.mux) runtime.mux.wake()
  if (runtime.host) runtime.host.wake()
  void loadQuota(false)
  void refreshLiveSnapshot()
  if (state.view === 'chat' && state.session) {
    if (runtime.mux) runtime.mux.nudge(state.session.sessionId)
    void refreshPending()
  }
}

if (typeof window !== 'undefined') {
  // Each of these only decorates the shell. A throw here used to abort the
  // module before render()/boot(), leaving #root empty with no explanation.
  const optional = (install, label) => {
    try {
      install()
    } catch (err) {
      console.error(`[boot] ${label} failed`, err)
    }
  }
  optional(applyTheme, 'theme')
  optional(pinViewport, 'viewport')
  optional(installOverscrollLock, 'overscroll')
  optional(installKeyboardFitBar, 'keyboard fit bar')
  optional(installKeyboardHideWatch, 'keyboard hide watch')
  optional(installChatGestureWatch, 'chat gesture')
  optional(installKeyboardGapStrip, 'keyboard gap strip')
  optional(installAudioUnlockOnGesture, 'audio unlock')
  optional(registerPwa, 'pwa')
  optional(setupPinsSync, 'pins')

  window.addEventListener('popstate', () => {
    if (runtime.ignoringPop) return
    if (state.view === 'boot' || state.view === 'pair' || state.view === 'connect') return
    const route = (history.state && history.state.mp) || parseRoute(window.location.hash)
    void applyRoute(route, { fromPopstate: true })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onForeground()
  })
  window.addEventListener('focus', onForeground)
  window.addEventListener('pageshow', onForeground)
  window.addEventListener('online', () => onForeground())

  document.addEventListener('compositionstart', (ev) => {
    const tag = ev.target && ev.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') runtime.imeComposing = true
  }, true)
  document.addEventListener('compositionend', (ev) => {
    const tag = ev.target && ev.target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
    runtime.imeComposing = false
    if (ev.target.classList && ev.target.classList.contains('chat-input')) {
      state.draft = ev.target.value
      autosizeInput(ev.target)
    }
    flushComposerRender()
  }, true)
  document.addEventListener('focusout', (ev) => {
    const tag = ev.target && ev.target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
    if (!runtime.imeComposing) return
    setTimeout(() => {
      if (!runtime.imeComposing) return
      runtime.imeComposing = false
      if (runtime.composerNode) state.draft = runtime.composerNode.value
      flushComposerRender()
    }, 0)
  }, true)

  try {
    render()
  } catch (err) {
    // Last line of defence: render() normally contains its own errors, but a
    // broken import-time state must still leave the static fallback usable.
    console.error('[boot] initial render failed', err)
  }
  void boot()
}
