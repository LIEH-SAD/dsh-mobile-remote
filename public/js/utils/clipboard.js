/**
 * Clipboard helper: the Clipboard API needs a secure context, which a LAN
 * http:// page is not — fall back to the legacy execCommand path.
 */
export async function copyText(text) {
  const value = String(text == null ? '' : text)
  if (value === '') return false
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const node = document.createElement('textarea')
    node.value = value
    node.setAttribute('readonly', '')
    node.style.position = 'fixed'
    node.style.top = '-1000px'
    node.style.opacity = '0'
    document.body.appendChild(node)
    node.select()
    const ok = document.execCommand('copy')
    node.remove()
    return ok
  } catch {
    return false
  }
}
