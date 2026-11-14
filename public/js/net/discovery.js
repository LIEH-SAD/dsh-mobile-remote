/**
 * LAN discovery for the standalone app: find the DSH host without typing an IP.
 *
 * Browsers cannot broadcast UDP or mDNS, so discovery is a bounded HTTP probe
 * of the local /24 (plus a few common prefixes) against /mp/api/hello. The
 * probe is cheap: a 204-byte JSON, ~500ms timeout per address, and it stops
 * early once enough hosts answered.
 */
import { loadRecentHosts } from '../state/binding.js'

export const DEFAULT_PORT = 3088
const HELLO_PATH = '/mp/api/hello'
const FALLBACK_PREFIXES = [
  '192.168.1',
  '192.168.0',
  '192.168.2',
  '192.168.43',
  '10.0.0',
]

/** Probe one origin. Resolves to a host record or null. */
export async function probeHost(origin, timeoutMs = 600, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      return null
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(`${origin}${HELLO_PATH}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || data.service !== 'dsh-mobile-plus') return null
    return {
      origin,
      name: typeof data.name === 'string' && data.name !== '' ? data.name : 'DSH 宿主',
      version: typeof data.version === 'string' ? data.version : '',
      requirePairing: data.requirePairing !== false,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/** 254 candidate origins from an IPv4 like "192.168.2.103". */
export function candidatesFromIp(ip) {
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(String(ip || ''))
  if (!match) return []
  return Array.from({ length: 254 }, (_, index) => `http://${match[1]}.${index + 1}:${DEFAULT_PORT}`)
}

export function fallbackCandidates() {
  const list = []
  for (const prefix of FALLBACK_PREFIXES) {
    for (let host = 1; host <= 254; host++) list.push(`http://${prefix}.${host}:${DEFAULT_PORT}`)
  }
  return list
}

/**
 * Best-effort LAN IP via WebRTC ICE candidates. Modern Chrome replaces host
 * candidates with mDNS names, so this often returns '' — callers must treat
 * that as "unknown subnet" rather than an error.
 */
export function guessLocalIp(timeoutMs = 900) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.RTCPeerConnection !== 'function') {
      resolve('')
      return
    }
    let done = false
    let pc
    const finish = (ip) => {
      if (done) return
      done = true
      try {
        if (pc) pc.close()
      } catch {
        /* already closed */
      }
      resolve(ip || '')
    }
    const timer = setTimeout(() => finish(''), timeoutMs)
    try {
      pc = new window.RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('mp-probe')
      pc.onicecandidate = (event) => {
        const candidate = event && event.candidate && event.candidate.candidate
        if (typeof candidate !== 'string') return
        const match = /(?:^|\s)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\s|$)/.exec(candidate)
        if (!match) return
        const ip = match[1]
        if (ip === '0.0.0.0' || ip.startsWith('127.')) return
        clearTimeout(timer)
        finish(ip)
      }
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => finish(''))
    } catch {
      clearTimeout(timer)
      finish('')
    }
  })
}

async function pool(items, worker, concurrency, shouldStop) {
  let index = 0
  // Chunked instead of one huge fan-out: hundreds of simultaneous connects to
  // unreachable LAN addresses exhaust the browser socket pool and make a
  // deliberate request (manual connect) queue until it times out.
  while (index < items.length) {
    if (shouldStop()) return
    const batch = items.slice(index, index + concurrency)
    index += batch.length
    await Promise.all(batch.map(worker))
    await new Promise((resolve) => setTimeout(resolve, 35))
  }
}

/**
 * Scan for hosts. Calls onHost as soon as one answers, onProgress roughly every
 * batch, and resolves with the full list.
 */
export async function scanLan(options = {}) {
  const {
    onHost = () => {},
    onProgress = () => {},
    timeoutMs = 420,
    concurrency = 12,
    maxHosts = 2,
    signal,
  } = options

  const found = new Map()
  const seen = new Set()
  const report = (host) => {
    if (!host || seen.has(host.origin)) return
    seen.add(host.origin)
    found.set(host.origin, host)
    onHost(host)
  }

  // Phase 1: hosts bound/seen before answer fastest.
  for (const recent of loadRecentHosts()) {
    if (signal && signal.aborted) return [...found.values()]
    const hit = await probeHost(recent.origin, timeoutMs, signal)
    if (hit) report(hit)
  }
  if (found.size > 0) return [...found.values()]

  // Phase 2: the local /24 when WebRTC revealed it.
  const localIp = await guessLocalIp()
  const local = candidatesFromIp(localIp)
  if (local.length > 0) {
    await scanList(local, report, onProgress, { timeoutMs, concurrency, maxHosts, signal, found })
    if (found.size > 0) return [...found.values()]
  }

  // Phase 3: common prefixes as a last resort.
  await scanList(fallbackCandidates(), report, onProgress, { timeoutMs, concurrency, maxHosts, signal, found })
  return [...found.values()]
}

async function scanList(list, report, onProgress, options) {
  const { timeoutMs, concurrency, maxHosts, signal, found } = options
  let done = 0
  const total = list.length
  const stop = () => Boolean(signal && signal.aborted) || found.size >= maxHosts
  await pool(list, async (origin) => {
    const hit = await probeHost(origin, timeoutMs, signal)
    done += 1
    if (hit) report(hit)
    if (done % 12 === 0 || hit) onProgress(done, total, origin)
  }, concurrency, stop)
  onProgress(done, total, '')
}
