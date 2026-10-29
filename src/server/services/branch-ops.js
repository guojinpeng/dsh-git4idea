/**
 * dsh-git4idea — services / branch-ops (host half, plain JavaScript).
 */

import { PanelError, badRequest } from './../core/errors.js'
import { NETWORK_TIMEOUT_MS, runGit, git } from './../core/git.js'
import { requireRef, cwdOf, requireUrl } from './../core/payload.js'
import { repoRootOf, currentBranchOf } from './../core/repo.js'
import { PROTECTED_BRANCHES, pushUndo } from './../core/undo.js'
import { branches } from './history.js'


export async function branchCreate(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const name = requireRef(payload.name, 'name')
  const args = ['branch', name]
  if (typeof payload.startPoint === 'string' && payload.startPoint.trim() !== '') args.push(requireRef(payload.startPoint, 'startPoint'))
  await git(root, args)
  return { branch: name }
}

/* Upstream management (issue #18): rebind or drop a branch's tracking remote.
   git refuses --set-upstream-to with a ref it cannot resolve, so a typo dies
   here instead of silently writing branch.<name>.merge. */

export async function branchUpstream(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const branch = requireRef(payload.branch, 'branch')
  if (payload.unset === true) {
    /* --unset-upstream errors on a branch that has none; the client only
       offers the verb when the row shows an upstream, and git's own message
       is the right one to surface if they raced. */
    await git(root, ['branch', '--unset-upstream', branch])
    return { branch, upstream: null }
  }
  const upstream = requireRef(payload.upstream, 'upstream')
  await git(root, ['branch', '--set-upstream-to=' + upstream, branch])
  return { branch, upstream }
}


export async function branchRename(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const from = requireRef(payload.from, 'from')
  const to = requireRef(payload.to, 'to')
  await git(root, ['branch', '-m', from, to])
  return { from, to }
}


export async function branchDelete(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const force = payload.force === true
  if (force && payload.confirm !== true) throw badRequest('force delete requires confirm: true')
  /* Batch form (multi-select): `names` wins when present; the single `name`
     keeps working exactly as before. Every name goes through the same ref
     guard — an array never bypasses validation. */
  const names = Array.isArray(payload.names)
    ? payload.names.map((entry) => requireRef(entry, 'name'))
    : [requireRef(payload.name, 'name')]
  const current = await currentBranchOf(root)
  for (const name of names) {
    if (name === current) throw new PanelError('protected-branch', 'refusing to delete the checked-out branch "' + name + '"', 409)
    if (PROTECTED_BRANCHES.has(name) && payload.confirm !== true) throw badRequest('deleting "' + name + '" requires confirm: true')
  }
  const branches = []
  for (const name of names) {
    const head = (await git(root, ['rev-parse', '--verify', 'refs/heads/' + name])).trim()
    branches.push({ name: name, hash: head })
  }
  // -d (the default) refuses to drop an unmerged branch: git is the guard here.
  await git(root, ['branch', force ? '-D' : '-d', ...names])
  const label = names.length === 1 ? names[0] : names.length + ' branches'
  const undo = pushUndo(root, {
    kind: 'branch-delete', label: label,
    branches: branches,
    // Legacy single-branch fields stay so an in-flight old handle keeps working.
    name: names[0], hash: branches[0].hash,
  })
  return { branch: names[0], hash: branches[0].hash, names: names, branches: branches, force: force, undo: undo }
}


export async function merge(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const branch = requireRef(payload.branch, 'branch')
  const args = ['merge', '--no-edit']
  if (payload.ffOnly === true) args.push('--ff-only')
  if (payload.noFf === true) args.push('--no-ff')
  if (payload.squash === true) args.push('--squash')
  args.push(branch)
  const result = await runGit(root, args)
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT|Automatic merge failed/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'merge failed' : combined, 409)
  return { branch, conflicted, output: combined }
}


export async function rebase(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const onto = requireRef(payload.onto, 'onto')
  const result = await runGit(root, ['rebase', onto])
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT|could not apply/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'rebase failed' : combined, 409)
  return { onto, conflicted, output: combined }
}

/* VS Code's "Abort Rebase" (SCM ▸ Commit ▸ Abort Rebase). Only meaningful
   while a rebase is in progress — `operationOf` already surfaces that state,
   so the menu greys the entry out; the route still refuses honestly when
   there is nothing to abort. */

export async function rebaseAbort(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const result = await runGit(root, ['rebase', '--abort'])
  if (result.code !== 0) {
    const detail = (result.stdout + '\n' + result.stderr).trim()
    throw new PanelError('git-failed', detail === '' ? 'no rebase to abort' : detail, 409)
  }
  return { output: (result.stdout + '\n' + result.stderr).trim() }
}

/* VS Code's SCM ▸ Remote ▸ Add Remote.... The name is a ref, the URL the same
   grammar `clone` already accepts. */

export async function remoteAdd(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const name = requireRef(payload.name, 'name')
  const url = requireUrl(payload.url, 'url')
  await git(root, ['remote', 'add', name, url])
  return { name, url }
}


export async function remoteRemove(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const name = requireRef(payload.name, 'name')
  if (typeof payload.confirm !== 'boolean' || payload.confirm !== true) throw badRequest('removing a remote requires confirm: true')
  await git(root, ['remote', 'remove', name])
  return { name }
}

/* SCM ▸ Branch ▸ Delete Remote Branch...: `git push <remote> --delete <branch>`.
   Genuinely destructive on the OTHER side, so it keeps the typed-confirm
   posture of a local protected-branch delete: confirm is mandatory. */

export async function branchDeleteRemote(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const remote = requireRef(payload.remote, 'remote')
  /* Batch form (multi-select): `branches` wins; the single `branch` keeps
     working. `git push --delete` accepts several names in one go. */
  const branches = Array.isArray(payload.branches)
    ? payload.branches.map((entry) => requireRef(entry, 'branch'))
    : [requireRef(payload.branch, 'branch')]
  if (payload.confirm !== true) throw badRequest('deleting a remote branch requires confirm: true')
  const out = await git(root, ['push', remote, '--delete', ...branches], { timeoutMs: NETWORK_TIMEOUT_MS })
  return { remote: remote, branch: branches[0], branches: branches, output: out.trim() }
}


/* SCM ▸ Tags ▸ Delete Remote Tag... / Push Tags. */
export async function tagDeleteRemote(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const remote = requireRef(payload.remote, 'remote')
  const tag = requireRef(payload.name, 'name')
  if (payload.confirm !== true) throw badRequest('deleting a remote tag requires confirm: true')
  const out = await git(root, ['push', remote, '--delete', tag], { timeoutMs: NETWORK_TIMEOUT_MS })
  return { remote, tag, output: out.trim() }
}


export async function pushTags(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.confirm !== true) throw badRequest('pushing tags requires confirm: true')
  const remote = typeof payload.remote === 'string' && payload.remote.trim() !== '' ? requireRef(payload.remote, 'remote') : 'origin'
  const out = await git(root, ['push', remote, '--tags'], { timeoutMs: NETWORK_TIMEOUT_MS })
  return { output: out.trim() }
}

/* SCM ▸ Stash ▸ Drop All Stashes...: one `git stash clear`. No undo handle is
   possible (the stash reflog is gone with the clear), hence the mandatory
   confirm on top of the dialog. */

export async function stashClear(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  if (payload.confirm !== true) throw badRequest('dropping all stashes requires confirm: true')
  await git(root, ['stash', 'clear'])
  return { cleared: true }
}


export async function cherryPick(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Batch form (multi-select): `hashes` are applied in the order given — the
     client sends them oldest-first so the sequence replays topologically. The
     single `hash` keeps working. */
  const hashes = Array.isArray(payload.hashes)
    ? payload.hashes.map((entry) => requireRef(entry, 'hash'))
    : [requireRef(payload.hash, 'hash')]
  const result = await runGit(root, ['cherry-pick', ...hashes])
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'cherry-pick failed' : combined, 409)
  return { hash: hashes[0], hashes: hashes, conflicted: conflicted, output: combined }
}


export async function revert(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const hash = requireRef(payload.hash, 'hash')
  const result = await runGit(root, ['revert', '--no-edit', hash])
  const combined = (result.stdout + '\n' + result.stderr).trim()
  const conflicted = /CONFLICT/.test(combined)
  if (result.code !== 0 && !conflicted) throw new PanelError('git-failed', combined === '' ? 'revert failed' : combined, 409)
  return { hash, conflicted, output: combined }
}


export async function reset(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const hash = requireRef(payload.hash, 'hash')
  const mode = payload.mode === 'soft' || payload.mode === 'hard' ? payload.mode : 'mixed'
  if (mode === 'hard' && payload.confirm !== true) throw badRequest('hard reset requires confirm: true')
  await git(root, ['reset', '--' + mode, hash])
  return { hash, mode }
}
