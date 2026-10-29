/**
 * dsh-git4idea — services / stash (host half, plain JavaScript).
 */

import { PanelError, badRequest } from './../core/errors.js'
import { RECORD_SEP, FIELD_SEP, runGit, git } from './../core/git.js'
import { requireRef, cwdOf } from './../core/payload.js'
import { repoRootOf } from './../core/repo.js'
import { pushUndo } from './../core/undo.js'


export async function stashList(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const out = await git(root, ['stash', 'list', '--pretty=format:%gd' + FIELD_SEP + '%gs' + FIELD_SEP + '%aI' + RECORD_SEP])
  const stashes = []
  for (const record of out.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed.trim() === '') continue
    const parts = trimmed.split(FIELD_SEP)
    stashes.push({ ref: parts[0], subject: parts[1] === undefined ? '' : parts[1], date: parts[2] === undefined ? '' : parts[2] })
  }
  return { stashes }
}


export async function stashPush(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const args = ['stash', 'push']
  if (payload.includeUntracked === true) args.push('--include-untracked')
  if (payload.staged === true) args.push('--staged')
  if (typeof payload.message === 'string' && payload.message.trim() !== '') args.push('-m', payload.message)
  const out = await git(root, args)
  return { output: out.trim() }
}


export async function stashApply(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const ref = typeof payload.ref === 'string' && payload.ref.trim() !== '' ? requireRef(payload.ref, 'ref') : 'stash@{0}'
  const args = ['stash', payload.pop === true ? 'pop' : 'apply', ref]
  const result = await runGit(root, args)
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'stash apply failed' : combined, 409)
  return { ref, conflicted, output: combined }
}


export async function stashDrop(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const ref = typeof payload.ref === 'string' && payload.ref.trim() !== '' ? requireRef(payload.ref, 'ref') : 'stash@{0}'
  if (payload.confirm !== true) throw badRequest('dropping a stash requires confirm: true')
  const sha = (await git(root, ['rev-parse', '--verify', ref])).trim()
  await git(root, ['stash', 'drop', ref])
  const undo = pushUndo(root, { kind: 'stash-drop', label: ref, hash: sha })
  return { ref, hash: sha, undo: undo }
}


export async function tagCreate(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const tag = requireRef(payload.name, 'name')
  const args = ['tag']
  if (typeof payload.message === 'string' && payload.message.trim() !== '') args.push('-a', tag, '-m', payload.message)
  else args.push(tag)
  if (typeof payload.hash === 'string' && payload.hash.trim() !== '') args.push(requireRef(payload.hash, 'hash'))
  await git(root, args)
  return { tag }
}


export async function tagDelete(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Batch form (multi-select): `names` wins; the single `name` keeps working. */
  const names = Array.isArray(payload.names)
    ? payload.names.map((entry) => requireRef(entry, 'name'))
    : [requireRef(payload.name, 'name')]
  await git(root, ['tag', '-d', ...names])
  return { tag: names[0], names: names }
}

/* VS Code's SCM title "Clone..." — clone a URL into an absolute local path.
   The PARENT of the target must exist; git creates the last component itself
   and refuses a non-empty one, which is the safety net for typos. It writes a
   brand-new tree (never touches an existing repository), but it does write the
   filesystem, so it rides the write queue like everything else that mutates. */
