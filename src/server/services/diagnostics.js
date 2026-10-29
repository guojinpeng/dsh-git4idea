/**
 * dsh-git4idea — services / diagnostics (host half, plain JavaScript).
 */

import { closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { errorLogFile, logError, PLUGIN_SETTINGS_FILE, readPluginSettings, writePluginSettings, isSettingsKey, consoleLogFile } from './../core/home.js'
import { PanelError } from './../core/errors.js'
import { GIT_LOG_MAX_ENTRIES, gitLog } from './../core/git.js'
import { log } from './history.js'


/* The tail of the git run ring buffer (see runGit). Read-only, global. */
export async function gitLogs() {
  return { entries: gitLog.slice(-GIT_LOG_MAX_ENTRIES) }
}

/* The console tab's data: the last 256 KiB of console.log, so the answer stays
   bounded even when the head of the file is old. A byte cut may land inside a
   UTF-8 sequence or a line; the decode then drops the partial first line. */
export const CONSOLE_TAIL_BYTES = 256 * 1024


export async function consoleLog() {
  const file = consoleLogFile()
  let size = 0
  try {
    size = statSync(file).size
  } catch (error) {
    if (error.code !== 'ENOENT') logError('console:read', error)
    return { text: '', size: 0, truncated: false, file }
  }
  const start = Math.max(0, size - CONSOLE_TAIL_BYTES)
  let text = ''
  if (size > 0) {
    let fd
    try {
      fd = openSync(file, 'r')
      const buffer = Buffer.alloc(size - start)
      const read = readSync(fd, buffer, 0, buffer.length, start)
      text = buffer.subarray(0, read).toString('utf8')
    } catch (error) {
      logError('console:read', error)
      return { text: '', size, truncated: false, file }
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  if (start > 0) {
    const cut = text.indexOf('\n')
    if (cut >= 0) text = text.slice(cut + 1)
  }
  return { text, size, truncated: start > 0, file }
}


/* The console context menu's only entry: empty the file, no confirmation. */
export async function consoleClear() {
  const file = consoleLogFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '')
  return { cleared: true, file }
}

export async function clientError(payload) {
  const scope = typeof payload.scope === 'string' ? payload.scope.slice(0, 64) : 'unknown'
  const message = typeof payload.message === 'string' ? payload.message.slice(0, 4000) : 'client error'
  const stack = typeof payload.stack === 'string' ? '\n' + payload.stack.slice(0, 12000) : ''
  logError('client:' + scope, message + stack)
  return { logged: true, log: errorLogFile() }
}

/* First paint needs the settings synchronously, so the panel reads them in one
   call before it mounts. A missing file is an empty object, never an error. */

export async function configGet() {
  return { state: readPluginSettings(), file: PLUGIN_SETTINGS_FILE }
}

/* One key per call: the panel writes a setting the moment the user changes it,
   and a whole-file write would let two tabs drop each other's values. A null
   value removes the key. */

export async function configSet(payload) {
  if (isSettingsKey(payload.key) !== true) throw new PanelError('bad-key', 'invalid settings key', 400)
  const state = readPluginSettings()
  if (payload.value === null || payload.value === undefined) delete state[payload.key]
  else if (typeof payload.value === 'string') state[payload.key] = payload.value
  else throw new PanelError('bad-value', 'invalid settings value', 400)
  writePluginSettings(state)
  return { saved: true, file: PLUGIN_SETTINGS_FILE }
}
