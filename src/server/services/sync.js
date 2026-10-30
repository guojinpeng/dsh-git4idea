/**
 * dsh-git4idea — services / sync (host half, plain JavaScript).
 */

import path from 'node:path'
import { badRequest } from './../core/errors.js'
import { NETWORK_TIMEOUT_MS, git } from './../core/git.js'
import { requireAbsolute, requireRef, cwdOf, requireUrl } from './../core/payload.js'
import { repoRootOf } from './../core/repo.js'


export async function fetch(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const args = ['fetch']
  if (typeof payload.remote === 'string' && payload.remote.trim() !== '') args.push(requireRef(payload.remote, 'remote'))
  // A refspec (`main:main`) fast-forwards a NON-checked-out branch in place —
  // this is how "pull a branch that is not HEAD" works without switching to
  // it (git pull would merge into HEAD instead). git refuses a non-ff update
  // here, which is exactly the safety we want.
  if (typeof payload.branch === 'string' && payload.branch.trim() !== '') args.push(requireRef(payload.branch, 'refspec'))
  if (payload.all === true) args.push('--all')
  // prune/--tags serve the repo-wide fetch; a refspec fetch is deliberately
  // narrow and must not drag every tag over the wire.
  if (payload.branch === undefined && payload.prune !== false) args.push('--prune')
  if (payload.branch === undefined) args.push('--tags')
  const out = await git(root, args, { timeoutMs: NETWORK_TIMEOUT_MS })
  return { output: (out + '\n').trim() }
}


export async function pull(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const mode = payload.mode === 'rebase' || payload.mode === 'merge' ? payload.mode : 'ff-only'
  const args = ['pull']
  if (mode === 'ff-only') args.push('--ff-only')
  if (mode === 'rebase') args.push('--rebase')
  if (mode === 'merge') args.push('--no-rebase')
  if (typeof payload.remote === 'string' && payload.remote.trim() !== '') args.push(requireRef(payload.remote, 'remote'))
  if (typeof payload.branch === 'string' && payload.branch.trim() !== '') args.push(requireRef(payload.branch, 'branch'))
  const out = await git(root, args, { timeoutMs: NETWORK_TIMEOUT_MS })
  return { mode, output: out.trim() }
}


export async function push(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.confirm !== true) throw badRequest('push requires confirm: true')
  const args = ['push']
  /* The push card names both ends explicitly (m00005): branch.<name>.merge is a
     stale hint after a rename, and a bare `git push` would follow it back to the
     old remote name. `--set-upstream` with a source:destination refspec records
     the destination that was actually pushed. */
  const remote = typeof payload.remote === 'string' && payload.remote.trim() !== '' ? requireRef(payload.remote, 'remote') : ''
  const localBranch = typeof payload.localBranch === 'string' && payload.localBranch.trim() !== '' ? requireRef(payload.localBranch, 'localBranch') : ''
  const remoteBranch = typeof payload.remoteBranch === 'string' && payload.remoteBranch.trim() !== ''
    ? requireRef(payload.remoteBranch, 'remoteBranch').replace(/^refs\/heads\//, '')
    : ''
  const explicit = remote !== '' && localBranch !== '' && remoteBranch !== ''
  if (payload.setUpstream === true) args.push('--set-upstream')
  if (payload.force === true) args.push('--force-with-lease')
  if (explicit === true) args.push(remote, localBranch + ':refs/heads/' + remoteBranch)
  else {
    if (remote !== '') args.push(remote)
    if (typeof payload.branch === 'string' && payload.branch.trim() !== '') args.push(requireRef(payload.branch, 'branch'))
  }
  const out = await git(root, args, { timeoutMs: NETWORK_TIMEOUT_MS })
  return { output: (out + '\n').trim() }
}

export const CLONE_TIMEOUT_MS = 10 * 60 * 1000

export async function clone(payload) {
  const url = requireUrl(payload.url, 'url')
  const dir = requireAbsolute(payload.dir, 'dir')
  await git(path.dirname(dir), ['clone', url, dir], { timeoutMs: CLONE_TIMEOUT_MS })
  return { dir }
}
