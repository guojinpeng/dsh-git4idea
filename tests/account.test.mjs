/**
 * dsh-git4idea — account service test.
 *
 * The identity read and the token hand-off are the two paths that touch user
 * data. Git runs for real in a throwaway repository; the token is stored by
 * git's own store helper, which proves the service writes it through stdin.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { account, accountToken, endpointParts } from '../src/server/services/account.js'

let repo = ''
let logDir = ''
let storeFile = ''

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

before(() => {
  logDir = mkdtempSync(join(tmpdir(), 'dsh-git4idea-account-log-'))
  process.env.DSH_GIT4IDEA_LOG_DIR = logDir
  /* The host's global git config may add another credential helper next to the
     store helper below; that helper can open a browser and hang the test.
     Isolate this repository from global and system config. */
  const emptyConfig = join(logDir, 'empty-gitconfig')
  writeFileSync(emptyConfig, '')
  process.env.GIT_CONFIG_GLOBAL = emptyConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  repo = mkdtempSync(join(tmpdir(), 'dsh-git4idea-account-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Account Check')
  git('config', 'user.email', 'account@example.com')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'first')
  // Git's helper line is parsed shell-style, so a Windows path must use forward
  // slashes; backslashes would be read as escapes.
  storeFile = join(repo, 'credentials.txt').replace(/\\/g, '/')
  git('config', 'credential.helper', 'store --file ' + storeFile)
})

after(() => {
  if (repo !== '') rmSync(repo, { recursive: true, force: true })
  if (logDir !== '') rmSync(logDir, { recursive: true, force: true })
  delete process.env.DSH_GIT4IDEA_LOG_DIR
  delete process.env.GIT_CONFIG_GLOBAL
  delete process.env.GIT_CONFIG_NOSYSTEM
})

test('account reads the local identity and reports its scope', async () => {
  const data = await account({ cwd: repo })
  assert.equal(data.repoRoot, repo)
  assert.equal(data.name, 'Account Check')
  assert.equal(data.email, 'account@example.com')
  assert.equal(data.scope, 'local')
  assert.equal(typeof data.online, 'boolean')
  assert.equal(data.endpoint, 'https://github.com')
})

test('an endpoint accepts a host, a URL, or a full remote URL', () => {
  assert.equal(endpointParts('git.internal:8443').url, 'https://git.internal:8443')
  assert.equal(endpointParts('http://git.internal:8080/team/repo.git').url, 'http://git.internal:8080')
  assert.equal(endpointParts('https://github.example.com/org/repo').url, 'https://github.example.com')
  assert.equal(endpointParts('ftp://git.internal'), null)
  assert.equal(endpointParts('https://user:secret@git.internal'), null)
  assert.equal(endpointParts('   '), null)
})

test('the origin remote supplies the default endpoint', async () => {
  git('remote', 'add', 'origin', 'git@git.internal:team/repo.git')
  const data = await account({ cwd: repo })
  assert.equal(data.endpoint, 'https://git.internal')
})

test('a token is validated before it reaches git', async () => {
  await assert.rejects(() => accountToken({ cwd: repo, token: '   ' }), /token is required/)
  await assert.rejects(() => accountToken({ cwd: repo, token: 'a'.repeat(513) }), /token is too long/)
  await assert.rejects(() => accountToken({ cwd: repo, token: 'ghp one' }), /invalid characters/)
  await assert.rejects(() => accountToken({ cwd: repo, token: 'ghp\none' }), /invalid characters/)
})

test('a valid token reaches the configured helper through stdin, not argv', async () => {
  const token = 'ghp_account_test_token'
  const data = await accountToken({ cwd: repo, token: token })
  assert.equal(data.scope, 'local')
  const stored = readFileSync(storeFile, 'utf8')
  assert.match(stored, /@github\.com/)
  assert.match(stored, new RegExp(token))
})

test('an intranet endpoint keys the token for that host and port', async () => {
  const token = 'intranet_test_token'
  const data = await accountToken({ cwd: repo, token: token, endpoint: 'http://git.internal:8080/team/repo.git' })
  assert.equal(data.endpoint, 'https://git.internal')
  const stored = readFileSync(storeFile, 'utf8')
  assert.match(stored, /@git\.internal(%3a|:)8080/)
})

test('an invalid endpoint is rejected before the helper sees the token', async () => {
  await assert.rejects(
    () => accountToken({ cwd: repo, token: 'some_token', endpoint: 'ftp://git.internal' }),
    /endpoint must be an http or https URL/)
})
