/**
 * dsh-git4idea — core / git (host half, plain JavaScript).
 */

import { spawn } from 'node:child_process'
import { logError } from './home.js'
import { PanelError, messageOf } from './errors.js'

export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/* Ring buffer of the most recent git runs — the panel's "Git output" view
   (VS Code's scm showOutput equivalent). Bounded on both axes: entries and
   per-entry text, so a hostile `log -p` cannot grow it without limit. */

export const GIT_LOG_MAX_ENTRIES = 200

export const GIT_LOG_TEXT_MAX = 4000

export const gitLog = []

export function pushGitLog(entry) {
  gitLog.push(entry)
  if (gitLog.length > GIT_LOG_MAX_ENTRIES) gitLog.splice(0, gitLog.length - GIT_LOG_MAX_ENTRIES)
}

export function clipGitLogText(text) {
  if (typeof text !== 'string' || text.length <= GIT_LOG_TEXT_MAX) return text
  return text.slice(0, GIT_LOG_TEXT_MAX / 2) + '\n…[' + String(text.length - GIT_LOG_TEXT_MAX) + ' more chars]…\n' + text.slice(-GIT_LOG_TEXT_MAX / 2)
}

export const MAX_DIFF_CHARS = 400 * 1024

export const DEFAULT_TIMEOUT_MS = 30_000

export const NETWORK_TIMEOUT_MS = 180_000

export const RECORD_SEP = '\u001e'

export const FIELD_SEP = '\u001f'


/* ============================== argv git ============================== */

export function gitBinary() {
  const override = process.env.DSH_IDE_GIT_BIN
  return override !== undefined && override.trim() !== '' ? override.trim() : 'git'
}


/**
 * Run git with an argv array (no shell). Resolves for ANY exit code so callers
 * can decide whether a non-zero status is data (e.g. `git diff --quiet`) or an
 * error; `git()` below is the throwing form.
 */
export function runGit(cwd, args, options = {}) {
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(gitBinary(), args, { cwd, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } })
    } catch (error) {
      logError('git:start', error)
      reject(new PanelError('git-missing', 'cannot start git: ' + messageOf(error), 500))
      return
    }
    const out = []
    const err = []
    let outBytes = 0
    let errBytes = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      pushGitLog({ at: new Date(startedAt).toISOString(), argv: args.join(' '), code: 'timeout', ms: timeoutMs, out: '', err: 'timed out after ' + String(timeoutMs) + 'ms' })
      logError('git:timeout', 'git ' + args.join(' ') + ' timed out after ' + String(timeoutMs) + 'ms')
      reject(new PanelError('git-timeout', 'git ' + args[0] + ' timed out after ' + timeoutMs + 'ms', 504))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length
      if (outBytes <= MAX_OUTPUT_BYTES) out.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      errBytes += chunk.length
      if (errBytes <= MAX_OUTPUT_BYTES) err.push(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      logError('git:run', error)
      reject(new PanelError('git-missing', 'cannot run git: ' + messageOf(error), 500))
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pushGitLog({
        at: new Date(startedAt).toISOString(),
        argv: args.join(' '),
        code: code === null ? -1 : code,
        ms: Date.now() - startedAt,
        out: clipGitLogText(Buffer.concat(out).toString('utf8')),
        err: clipGitLogText(Buffer.concat(err).toString('utf8')),
      })
      resolve({
        code: code === null ? -1 : code,
        signal: signal === null ? undefined : signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        truncated: outBytes > MAX_OUTPUT_BYTES,
      })
    })
  })
}


export async function git(cwd, args, options = {}) {
  const result = await runGit(cwd, args, options)
  if (result.code !== 0) {
    const detail = result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim()
    throw new PanelError('git-failed', 'git ' + args.join(' ') + ' failed: ' + (detail === '' ? 'exit ' + result.code : detail), 409)
  }
  return result.stdout
}
