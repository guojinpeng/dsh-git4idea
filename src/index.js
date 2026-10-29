/**
 * dsh-git4idea — host half (plain JavaScript, no build step).
 *
 * One HTTP surface backs the browser panel:
 *
 *   POST /dsh-git4idea/api/<method>   -> { ok: true, data } | { ok: false, error }
 *
 * Every method is a thin, argv-array wrapper around the local `git` binary
 * (never a shell string), executed with the working directory the client sent
 * (the session scope cwd). Read methods are cheap; write methods are explicit
 * and the destructive ones require an explicit `confirm: true` from the caller.
 *
 * Trust fence: the routes are mounted on DSH's own web server, so they are
 * same-origin by construction. A request is served only when the Host header
 * names a loopback authority or the browser marks the request as same-origin
 * (Sec-Fetch-Site) — a cross-site page cannot forge that header, which is the
 * same posture DSH's own web routes take.
 */

import { ROUTE_PREFIX, handle } from './server/controller/http.js'
import { installCommitServices } from './server/services/ai.js'

export { repoScanCache, REPOS_CACHE_TTL_MS } from './server/services/workspace.js'

export const name = 'dsh-git4idea'

export const inject = ['webServer']

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: handle }),
    'dsh-git4idea: /dsh-git4idea/api git routes',
  )
  /* AI commit message (issue #6). `llm` and `sessions` are injected HERE and not
     in `export const inject`: a host without them must still load the whole
     plugin, it just answers commit-message with no-host-service. */
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['llm', 'sessions'], (injected) => {
    const llm = injected.get('llm')
    const sessions = injected.get('sessions')
    if (llm === undefined || llm === null || sessions === undefined || sessions === null) return
    injected.effect(() => {
      installCommitServices({ llm: llm, sessions: sessions })
      return () => { installCommitServices(null) }
    }, 'dsh-git4idea: ai commit message')
  })
}
