/**
 * dsh-git4idea — services / account (host half, plain JavaScript).
 */

import { PanelError, badRequest } from './../core/errors.js'
import { NETWORK_TIMEOUT_MS, runGit } from './../core/git.js'
import { cwdOf } from './../core/payload.js'
import { repoRootOf } from './../core/repo.js'


/* Who git says you are here, and how a sign-in can reach the Git host.

   The plugin stores nothing. A token goes straight to the configured
   credential helper through `git credential approve` on stdin, so it never
   appears in argv (which the console log records) and never in a file we own.
   The browser flow asks Git Credential Manager to do its own OAuth dance.

   The endpoint is editable because many repositories live on an intranet host.
   It defaults to the origin remote of the repository. */

const GCM_TIMEOUT_MS = 5000
const TOKEN_MAX = 512
const ENDPOINT_MAX = 2048
const DEFAULT_ENDPOINT = 'https://github.com'


/* Accept "git.example.com", "https://git.example.com" or a full remote URL.
   The credential helper is keyed by protocol and host only, so the path is
   dropped. HTTP is allowed for intranet hosts. */
export function endpointParts(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === '' || raw.length > ENDPOINT_MAX) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw
  let url
  try {
    url = new URL(withScheme)
  } catch (error) {
    void error
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname === '' || url.username !== '' || url.password !== '') return null
  return { url: url.protocol + '//' + url.host, protocol: url.protocol.slice(0, -1), host: url.host }
}


function endpointFromRemote(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return DEFAULT_ENDPOINT
  if (/^https?:\/\//i.test(text)) {
    const parts = endpointParts(text)
    if (parts !== null) return parts.url
  }
  /* git@github.com:owner/repo.git and ssh://git@host:22/owner/repo.git name
     an SSH host; the sign-in still goes over HTTPS on the same host. */
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)/.exec(text)
  if (scp !== null) return 'https://' + scp[1]
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(text)
  if (ssh !== null) return 'https://' + ssh[1]
  return DEFAULT_ENDPOINT
}


function endpointOfPayload(payload) {
  const provided = typeof payload.endpoint === 'string' ? payload.endpoint.trim() : ''
  if (provided === '') return endpointParts(DEFAULT_ENDPOINT)
  const parts = endpointParts(provided)
  if (parts === null) throw badRequest('endpoint must be an http or https URL')
  return parts
}


async function endpointOfRepo(root) {
  const remote = await valueOf(root, ['config', '--get', 'remote.origin.url'])
  return endpointFromRemote(remote)
}


async function valueOf(root, args) {
  const result = await runGit(root, args)
  return result.code === 0 ? result.stdout.trim() : ''
}


/* local overrides global, exactly the order git resolves user.name. */
async function identity(root) {
  const name = await valueOf(root, ['config', 'user.name'])
  const email = await valueOf(root, ['config', 'user.email'])
  const localName = await valueOf(root, ['config', '--local', '--get', 'user.name'])
  const globalName = await valueOf(root, ['config', '--global', '--get', 'user.name'])
  const scope = localName !== '' ? 'local' : globalName !== '' ? 'global' : 'none'
  return { name, email, scope }
}


async function onlineOf(root) {
  const version = await runGit(root, ['credential-manager', '--version'], { timeoutMs: GCM_TIMEOUT_MS })
  if (version.code === 0) return true
  /* Older Git for Windows calls the same helper manager-core. */
  const core = await runGit(root, ['credential-manager-core', '--version'], { timeoutMs: GCM_TIMEOUT_MS })
  return core.code === 0
}


async function accountOf(root) {
  const [who, online, endpoint] = await Promise.all([identity(root), onlineOf(root), endpointOfRepo(root)])
  return { repoRoot: root, name: who.name, email: who.email, scope: who.scope, online: online, endpoint: endpoint }
}


export async function account(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  return accountOf(root)
}


/* Online login: GCM opens the system browser and writes the credential itself.
   A missing GCM is a normal state the client turns into a disabled tab. */
export async function accountWeb(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const endpoint = endpointOfPayload(payload)
  if (await onlineOf(root) !== true) {
    throw new PanelError('auth-unavailable', 'Git Credential Manager is not available', 409)
  }
  const result = await runGit(root, ['credential-manager', 'github', 'login', '--web', '--url', endpoint.url], { timeoutMs: NETWORK_TIMEOUT_MS })
  if (result.code !== 0) {
    const detail = result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim()
    throw new PanelError('auth-failed', detail === '' ? 'Git authentication failed' : detail, 409)
  }
  return accountOf(root)
}


/* A pasted token: validated here, then handed to the helper over stdin. No
   argv entry and no console line carries it. */
export async function accountToken(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const token = typeof payload.token === 'string' ? payload.token.trim() : ''
  if (token === '') throw badRequest('token is required')
  if (token.length > TOKEN_MAX) throw badRequest('token is too long')
  if (/[\s\u0000-\u001f\u007f]/.test(token)) throw badRequest('token contains invalid characters')
  const endpoint = endpointOfPayload(payload)
  const helper = await valueOf(root, ['config', '--get-all', 'credential.helper'])
  if (helper === '') {
    throw new PanelError('auth-no-helper', 'no git credential helper is configured', 409)
  }
  const result = await runGit(root, ['credential', 'approve'], {
    input: 'protocol=' + endpoint.protocol + '\nhost=' + endpoint.host + '\nusername=x-access-token\npassword=' + token + '\n\n',
  })
  if (result.code !== 0) {
    /* A helper must not be able to echo the secret back into the panel. */
    const detail = (result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim()).split(token).join('***')
    throw new PanelError('auth-failed', detail === '' ? 'git credential approve failed' : detail, 409)
  }
  return accountOf(root)
}
