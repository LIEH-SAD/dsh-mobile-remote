import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './constants.js'
import { json, readBody, isLoopback } from './utils.js'
import { parseRelayToken, encodeRelayToken } from './relay-bridge.js'
import { provisionRemoteRelay } from './ssh-provisioner.js'

/**
 * Loopback-only relay configuration / provisioning / health-test handlers.
 * Extracted from routes.js to keep that file under the 300-line budget.
 */
export function createRelayHandlers(auth, getRelay) {
  const activeRelayOf = () => (getRelay ? getRelay() : null)

  const handleRelayConfig = async (req, res) => {
    if (!isLoopback(req)) return json(res, 403, { ok: false, code: 'forbidden' })
    const activeRelay = activeRelayOf()
    if (req.method === 'GET') {
      const cfg = activeRelay ? activeRelay.resolveRelayConfig() : {}
      const statusObj = activeRelay ? activeRelay.getStatus() : { enabled: false, status: 'disabled' }
      return json(res, 200, {
        ok: true,
        config: cfg,
        tokenStr: cfg.server && cfg.token ? encodeRelayToken(cfg) : '',
        connected: statusObj.status === 'connected',
        relay: statusObj,
      })
    }
    if (req.method === 'POST') {
      try {
        const parsed = await readBody(req, 16384)
        let newConfig
        if (parsed.tokenStr) {
          newConfig = parseRelayToken(parsed.tokenStr)
        } else {
          newConfig = {
            enabled: parsed.enabled !== false,
            server: (parsed.server || '').trim(),
            token: (parsed.token || '').trim(),
            publicBaseUrl: (parsed.publicBaseUrl || '').trim(),
            updatedAt: new Date().toISOString(),
          }
        }
        const file = join(dshHome(), 'remote-relay.json')
        writeFileSync(file, JSON.stringify(newConfig, null, 2) + '\n', 'utf8')
        if (newConfig.publicBaseUrl) {
          auth.publicBaseUrl = newConfig.publicBaseUrl
          try { auth.publicHost = new URL(auth.publicBaseUrl).host } catch {}
        }
        if (activeRelay) {
          activeRelay.server = newConfig.server
          activeRelay.token = newConfig.token
          activeRelay.enabled = newConfig.enabled
          activeRelay.publicBaseUrl = newConfig.publicBaseUrl
          activeRelay.connect()
        }
        return json(res, 200, {
          ok: true,
          config: newConfig,
          tokenStr: newConfig.server && newConfig.token ? encodeRelayToken(newConfig) : '',
        })
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message })
      }
    }
    res.writeHead(405).end()
  }

  const handleRelayProvision = async (req, res) => {
    if (!isLoopback(req)) return json(res, 403, { ok: false, code: 'forbidden' })
    if (req.method !== 'POST') return res.writeHead(405).end()
    try {
      const options = await readBody(req, 16384)
      const finalConfig = await provisionRemoteRelay(options)
      const file = join(dshHome(), 'remote-relay.json')
      writeFileSync(file, JSON.stringify(finalConfig, null, 2) + '\n', 'utf8')
      if (finalConfig.publicBaseUrl) {
        auth.publicBaseUrl = finalConfig.publicBaseUrl
        try { auth.publicHost = new URL(auth.publicBaseUrl).host } catch {}
      }
      const activeRelay = activeRelayOf()
      if (activeRelay) {
        activeRelay.server = finalConfig.server
        activeRelay.token = finalConfig.token
        activeRelay.enabled = true
        activeRelay.publicBaseUrl = finalConfig.publicBaseUrl
        activeRelay.connect()
      }
      return json(res, 200, {
        ok: true,
        config: finalConfig,
        tokenStr: encodeRelayToken(finalConfig),
      })
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message })
    }
  }

  const handleRelayTest = async (req, res) => {
    if (!isLoopback(req)) return json(res, 403, { ok: false, code: 'forbidden' })
    const activeRelay = activeRelayOf()
    if (!activeRelay) return json(res, 200, { ok: false, error: '公网中转服务未启动' })
    const result = await activeRelay.testHealth()
    return json(res, 200, result)
  }

  return { config: handleRelayConfig, provision: handleRelayProvision, test: handleRelayTest }
}
