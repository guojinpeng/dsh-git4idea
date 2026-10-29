/**
 * dsh-git4idea — services / worktrees (host half, plain JavaScript).
 */

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { git } from './../core/git.js'
import { worktreesOf, sameDirectory, repoRootOf } from './../core/repo.js'
import { cwdOf, requireAbsolute, requireRef } from './../core/payload.js'
import { badRequest } from './../core/errors.js'


/* ============================== worktrees ============================== */

/**
 * The list the worktree tab draws. Every entry also says whether it is the
 * worktree the panel is using and whether it is the main one — those two flags
 * decide the check mark and which delete calls the host refuses.
 */
export async function worktreeList(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const trees = await worktreesOf(root)
  return {
    repoRoot: root,
    worktrees: trees.map((tree, index) => Object.assign({}, tree, {
      current: sameDirectory(tree.path, root),
      main: index === 0,
    })),
  }
}


/**
 * git worktree add, in both IDEA shapes: check out an existing branch, or make
 * a new branch from a start point (git worktree add -b <new> <path> <start>).
 * The client never switches to the new tree — it only reports where it landed.
 */
export async function worktreeAdd(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const target = requireAbsolute(payload.path, 'path')
  const branch = requireRef(payload.branch, 'branch')
  const create = payload.newBranch === true
  const base = create ? requireRef(payload.base, 'base') : ''
  const inside = path.relative(root, target)
  if (inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside)) {
    throw badRequest('worktree path must be outside the repository')
  }
  if (existsSync(target)) throw badRequest('target path already exists: ' + target)
  mkdirSync(path.dirname(target), { recursive: true })
  const args = create
    ? ['worktree', 'add', '-b', branch, target, base]
    : ['worktree', 'add', target, branch]
  await git(root, args)
  return { created: true, path: target, branch, repoRoot: root }
}


/**
 * git worktree remove. The worktree this panel is using is refused here with a
 * readable message; git would refuse it too, but with a less obvious one.
 */
export async function worktreeRemove(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const target = requireAbsolute(payload.path, 'path')
  if (sameDirectory(target, root)) throw badRequest('cannot remove the worktree this panel is using')
  await git(root, ['worktree', 'remove', target])
  return { removed: true, path: target, repoRoot: root }
}
