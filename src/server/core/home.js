/**
 * dsh-git4idea — core / home (host half, plain JavaScript).
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/* ============================== plugin home ============================== */

/* One home for everything this plugin keeps on disk (m04917). It follows the
   user's home directory, so the same code works on every host and user:
   <home>/.dsh/guojinpeng/dsh-git4idea/{config,log}. The config folder holds the
   settings the panel would keep locally; the log folder holds the error log. */
export const PLUGIN_HOME = path.join(homedir(), '.dsh', 'guojinpeng', 'dsh-git4idea')

export const PLUGIN_CONFIG_DIR = path.join(PLUGIN_HOME, 'config')

export const PLUGIN_LOG_DIR = path.join(PLUGIN_HOME, 'log')

export const PLUGIN_LOG_FILE = path.join(PLUGIN_LOG_DIR, 'error.log')

/* Every failure path reports here. The call never throws: a full disk or a
   missing home must not turn a git error into a second error. */

export function logError(scope, error) {
  try {
    mkdirSync(PLUGIN_LOG_DIR, { recursive: true })
    const detail = error instanceof Error
      ? (typeof error.stack === 'string' && error.stack !== '' ? error.stack : error.message)
      : String(error)
    appendFileSync(PLUGIN_LOG_FILE, new Date().toISOString() + ' [' + scope + '] ' + detail + '\n')
  } catch (_) { /* logging must never throw */ }
}

/* The panel's own settings live in one file under the plugin home (m04919), so
   every browser that opens this DSH sees the same rail, pane and starred-repo
   state, and the owner has one folder to back up or copy. Values are opaque
   strings — the panel owns their format. */

export const PLUGIN_SETTINGS_FILE = path.join(PLUGIN_CONFIG_DIR, 'settings.json')


export function readPluginSettings() {
  try {
    const parsed = JSON.parse(readFileSync(PLUGIN_SETTINGS_FILE, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const state = {}
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === 'string') state[key] = parsed[key]
    }
    return state
  } catch (error) {
    if (error.code !== 'ENOENT') logError('config:read', error)
    return {}
  }
}


export function writePluginSettings(state) {
  mkdirSync(PLUGIN_CONFIG_DIR, { recursive: true })
  writeFileSync(PLUGIN_SETTINGS_FILE, JSON.stringify(state, null, 2) + '\n')
}

/* A settings key is one of the panel's own constants; anything else is a bug
   or a stray caller, and neither may grow the file without bound. */

export function isSettingsKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value)
}
