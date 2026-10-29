/**
 * dsh-git4idea — controller / http (host half, plain JavaScript).
 */

import { logError } from './../core/home.js'
import { PanelError, badRequest, messageOf } from './../core/errors.js'
import { withRepoLock, WRITE_METHODS, lockKeyOf } from './../core/locks.js'
import { consoleRecording } from './../core/git.js'
import { METHODS } from './methods.js'


export const ROUTE_PREFIX = '/dsh-git4idea/api'


/* ============================== http plumbing ============================== */

export function headerOf(req, name) {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}


/** Loopback authority, or a same-origin browser request (desktop shell / remote UI). */
export function isTrusted(req) {
  const host = headerOf(req, 'host')
  if (host === undefined || host === '') return false
  /* A browser stamps where the request came from, and a cross-site page can POST
     to a loopback Host without a preflight (text/plain is a simple request), so
     this check runs BEFORE the Host allow-list: a loopback Host alone does not
     prove the caller is local. Same-origin is the only browser origin that may
     call this route; requests without the header (desktop shell, remote proxy)
     fall through to the Host check. */
  const site = headerOf(req, 'sec-fetch-site')
  if (site !== undefined && site !== '' && site !== 'same-origin') return false
  const hostname = host.replace(/^\[/, '').replace(/\]:\d+$/, '').replace(/:\d+$/, '')
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return true
  if (/^127\./.test(hostname)) return true
  return site === 'same-origin'
}


export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}


export function readJsonBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new PanelError('too-large', 'request body is too large', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') { resolve({}); return }
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(badRequest('request body must be JSON'))
      }
    })
    req.on('error', (error) => { reject(new PanelError('transport', messageOf(error), 500)) })
  })
}


export async function handle(req, res) {
  if (!isTrusted(req)) {
    sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'POST required' } })
    return
  }
  /* JSON only: a form or text/plain POST is a simple request the browser sends
     without a preflight, so the fence above must not be the only gate. */
  const type = headerOf(req, 'content-type')
  if (type !== undefined && type !== '' && type.toLowerCase().indexOf('application/json') !== 0) {
    sendJson(res, 415, { ok: false, error: { code: 'unsupported-media-type', message: 'application/json required' } })
    return
  }
  const pathname = new URL(req.url === undefined ? '/' : req.url, 'http://dsh.internal').pathname
  const method = pathname.startsWith(ROUTE_PREFIX + '/') ? pathname.slice(ROUTE_PREFIX.length + 1) : ''
  const handler = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : undefined
  if (handler === undefined || method.includes('/')) {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method "' + method + '"' } })
    return
  }
  try {
    const payload = await readJsonBody(req)
    /* Console scope (m00541): a write runs from a button press, so its git
       calls are what the user asked to see; a read only records when the
       caller marks it as a visible gesture (`console: true`). */
    const record = WRITE_METHODS.has(method) || payload.console === true
    const data = await consoleRecording.run(record, () => (
      WRITE_METHODS.has(method)
        ? withRepoLock(lockKeyOf(payload), () => handler(payload))
        : handler(payload)
    ))
    sendJson(res, 200, { ok: true, data: data })
  } catch (error) {
    if (error instanceof PanelError) {
      /* A rejected argument is the caller's mistake, not a fault to hunt; only
         a server-side status earns a line in the error log. */
      if (error.status >= 500) logError('api:' + method, error)
      sendJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
      return
    }
    logError('api:' + method, error)
    const message = messageOf(error)
    sendJson(res, 500, { ok: false, error: { code: 'internal', message } })
  }
}
