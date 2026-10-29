/**
 * dsh-git4idea — services / changes (host half, plain JavaScript).
 */

import { badRequest } from './../core/errors.js'
import { runGit, git } from './../core/git.js'
import { requireRef, requireMessage, cwdOf, optionalPaths } from './../core/payload.js'
import { repoRootOf } from './../core/repo.js'
import { pushUndo, snapshotForUndo, snapshotState } from './../core/undo.js'


export async function stage(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const paths = optionalPaths(payload, 'paths')
  await git(root, ['add', '-A', '--', ...paths])
  return { staged: paths.length }
}


export async function unstage(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const paths = optionalPaths(payload, 'paths')
  const result = await runGit(root, ['reset', '-q', 'HEAD', '--', ...paths])
  if (result.code !== 0) await git(root, ['rm', '--cached', '-r', '-q', '--', ...paths])
  return { unstaged: paths.length }
}


export async function discard(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  // '.' would discard EVERYTHING in the repository in one go; the panel always
  // discards explicit paths, so the root itself is not a valid target here.
  const paths = optionalPaths(payload, 'paths').filter((entry) => entry !== '.' && entry !== './')
  if (paths.length === 0) throw badRequest('paths is required')
  const untracked = payload.untracked === true
  if (untracked && payload.confirm !== true) throw badRequest('discarding untracked files requires confirm: true')
  // Last chance to keep the bytes: the checkout/clean below is what destroys them.
  const files = snapshotForUndo(root, paths)
  if (untracked) await git(root, ['clean', '-f', '-d', '--', ...paths])
  else await git(root, ['checkout', '--', ...paths])
  // A snapshot the host cannot reproduce faithfully means no handle at all — the
  // panel says so instead of showing an undo that would fail later.
  if (files === null) return { discarded: paths.length, untracked: untracked, undoBlocked: true }
  const label = paths.length === 1 ? paths[0] : paths.length + ' paths'
  const undo = pushUndo(root, { kind: 'discard', label: label, files: files, after: snapshotState(root, files) })
  return { discarded: paths.length, untracked: untracked, undo: undo }
}


export async function commit(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const message = requireMessage(payload.message)
  const paths = (payload.paths === undefined || payload.paths === null) ? [] : optionalPaths(payload, 'paths')
  if (paths.length > 0) await git(root, ['add', '-A', '--', ...paths])
  const args = ['commit', '-m', message]
  if (payload.amend === true) args.push('--amend')
  if (payload.signoff === true) args.push('--signoff')
  const out = await git(root, args)
  const result = { output: out.trim() }
  if (payload.push === true) {
    // Commit-and-push is one gesture in the panel, so the commit is published in
    // the same request. A failed push must not hide the commit that did land.
    if (payload.confirm !== true) throw badRequest('pushing requires confirm: true')
    const pushed = await runGit(root, ['push'])
    result.pushed = pushed.code === 0
    if (pushed.code !== 0) result.pushError = (pushed.stderr.trim() || pushed.stdout.trim() || 'push failed')
  }
  return result
}


export async function checkout(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.create === true) {
    const name = requireRef(payload.branch, 'branch')
    const start = typeof payload.startPoint === 'string' && payload.startPoint.trim() !== '' ? requireRef(payload.startPoint, 'startPoint') : undefined
    const args = ['checkout', '-b', name]
    /* track (issue #18): "create a local branch from a remote one" must bind
       the upstream in the same breath — checkout -b alone never does. */
    if (payload.track === true && start !== undefined) args.push('--track')
    if (start !== undefined) args.push(start)
    await git(root, args)
    return { branch: name, created: true }
  }
  const target = requireRef(payload.branch, 'branch')
  await git(root, ['checkout', target])
  return { branch: target, created: false }
}
