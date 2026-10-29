    function translatorOf(ctx) {
      let cachedTag = null
      let cachedDict = null
      return (key) => {
        const tag = activeLocaleOf(ctx)
        seenLocaleTag = tag
        if (tag !== cachedTag) { cachedTag = tag; cachedDict = dictionaryFor(tag) }
        if (hasOwnKey(cachedDict, key)) return cachedDict[key]
        return hasOwnKey(EN, key) ? EN[key] : key
      }
    }

    function fill(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = values[key]
        return value === undefined ? match : String(value)
      })
    }

    /* One success line per write route (m05310). Every gesture that mutates the
       repository answers in the bottom-right stack; the panel run() and the commit
       card share this table so the same verb never words itself two ways. A route
       that returns '' reports nothing (compare is a read). */
    function successToastText(t, method, payload) {
      const p = payload === null || payload === undefined ? {} : payload
      const count = (value) => (Array.isArray(value) ? value.length : 0)
      const names = (value) => (Array.isArray(value) ? value.join(', ') : '')
      if (method === 'stage') return fill(t('toast.staged'), { n: count(p.paths) })
      if (method === 'unstage') return fill(t('toast.unstaged'), { n: count(p.paths) })
      if (method === 'checkout') return fill(t(p.create === true ? 'toast.branchCreated' : 'toast.checkedOut'), { name: String(p.branch) })
      if (method === 'branchRename') return fill(t('toast.branchRenamed'), { from: String(p.from), to: String(p.to) })
      if (method === 'branch-upstream') return p.unset === true ? fill(t('toast.upstreamUnset'), { name: String(p.branch) }) : fill(t('toast.upstreamSet'), { name: String(p.branch), upstream: String(p.upstream) })
      if (method === 'branchDelete') return fill(t('toast.branchDeleted'), { name: p.name === undefined ? names(p.names) : String(p.name) })
      if (method === 'branchDeleteRemote') return t('toast.remoteBranchDeleted')
      if (method === 'commit') return t('toast.committed')
      if (method === 'tagCreate') return fill(t('toast.tagCreated'), { name: String(p.name) })
      if (method === 'tagDelete') return fill(t('toast.tagDeleted'), { name: p.name === undefined ? names(p.names) : String(p.name) })
      if (method === 'tagDeleteRemote') return fill(t('toast.tagDeletedRemote'), { name: String(p.name) })
      if (method === 'pushTags') return t('toast.tagsPushed')
      if (method === 'push') return t('toast.pushDone')
      if (method === 'pull') return t('toast.pullDone')
      if (method === 'fetch') return t('toast.fetchDone')
      if (method === 'merge') return fill(t('toast.merged'), { name: String(p.branch) })
      if (method === 'rebase') return fill(t('toast.rebased'), { onto: String(p.onto) })
      if (method === 'rebaseAbort') return t('toast.rebaseAborted')
      if (method === 'cherryPick') return fill(t('toast.cherryPicked'), { n: p.hashes === undefined ? 1 : count(p.hashes) })
      if (method === 'revert') return fill(t('toast.reverted'), { hash: String(p.hash).slice(0, 8) })
      if (method === 'reset') return fill(t(p.mode === 'hard' ? 'toast.resetHard' : 'toast.resetSoft'), { hash: String(p.hash).slice(0, 8) })
      if (method === 'discard') return fill(t('toast.discardedN'), { n: count(p.paths) })
      if (method === 'stashPush') return t('toast.stashed')
      if (method === 'stashApply') return p.pop === true ? t('toast.stashPopped') : t('toast.stashApplied')
      if (method === 'stashClear') return t('toast.stashCleared')
      if (method === 'remoteAdd') return fill(t('toast.remoteAdded'), { name: String(p.name) })
      if (method === 'remoteRemove') return fill(t('toast.remoteRemoved'), { name: String(p.name) })
      if (method === 'clone') return t('toast.cloned')
      return ''
    }

    /* ---- multi-select shared helpers (selection episode, issue #13) ---- */

    /* Keyboard shortcuts (Ctrl+C / Del / Ctrl+A / Esc) must never hijack the
       user's own typing or the browser's native copy inside a field. */
    function isTypingTarget(target) {
      if (target === null || target === undefined || (target instanceof Element) === false) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
    }

    /* The modifier that toggles selection: Cmd on macOS, Ctrl everywhere else
       (VS Code's list convention). Plain Shift is always the range modifier. */
    function isToggleModifier(event) {
      return event.metaKey === true || event.ctrlKey === true
    }

    /* A branch entry's selection key: the kind prefix keeps the (rare) case of
       a branch and a tag sharing one name from colliding inside one Set. */
    function branchSelKeyOf(entry) {
      const kind = entry.tag === true ? 'tag' : entry.remote === true ? 'remote' : 'local'
      return kind + ':' + entry.name
    }

    /* v0.19.9: the REMOTE section folds by path exactly like the local one. In
       the common single-remote repo every row starts with the same "<remote>/"
       prefix, which would nest every tree under one folder named after the
       remote — noise, not grouping — so the strip applies only when EVERY name
       shares that first segment AND carries it (a bare "main" beside
       "origin/main" means mixed shapes and keeps full names). */
    function remoteTreeStripOf(names) {
      if (names.length === 0) return ''
      const first = names.map((name) => String(name).split('/')[0])
      if (new Set(first).size !== 1) return ''
      const prefix = first[0] + '/'
      return names.every((name) => String(name).startsWith(prefix) === true) ? prefix : ''
    }

    /* Join selected values for the clipboard — one per line, the shape a
       terminal or an editor expects when pasting a list. */
    function clipboardLines(values) {
      return values.join('\n')
    }

    /* Shared frozen-by-convention empty selection: selection Sets are never
       mutated in place, so one instance is safe to hand around. */
    const EMPTY_SELECTION = new Set()

    /* ============================== api ============================== */

    /* ---- remote channel fallback core (pure: tests/smoke.mjs slices this
       block) ---- */
    /* dsh-remote-web-ui's browser channel rewrites only the host's own /api/,
       /sidebar/, /git/ and /pet/ prefixes onto its /remote/ proxy; a
       plugin-owned route like ours is not on that list, so from a paired
       remote client the direct call reaches the harness browser-auth gate and
       comes back 401/403 "forbidden" (issue #9: both sidebar and dock panels
       refused to open remotely). The proxy itself serves any loopback path
       under /remote/<full pathname> with the paired device's credentials, so
       the fallback is to retry the very same request through it — the exact
       URL shape the boot patch produces for the host prefixes ('/remote' +
       the request's full pathname, mount prefix included, query preserved). */
    function remoteFallbackUrl(ofPath) {
      /* Resolve through the SAME base the direct fetch used — document.baseURI
         (which honours <base href>; dsh 0.1.7 mounts the shell with one), so
         the retry lands on the proxy copy of the very URL that was rejected. */
      let resolved = null
      try {
        let base
        if (typeof document === 'object' && document !== null && typeof document.baseURI === 'string' && document.baseURI !== '') {
          base = document.baseURI
        } else if (typeof window === 'object' && window !== null && window.location !== undefined && window.location !== null) {
          base = window.location.href
        }
        if (base !== undefined) resolved = new URL(ofPath, base)
      } catch (error) { resolved = null }
      if (resolved === null) return '/remote/' + String(ofPath).replace(/^\//, '')
      return '/remote' + resolved.pathname + resolved.search
    }

    /* A rejection worth retrying through the remote channel: the auth gate
       answers 401 (unauthenticated) or 403 (forbidden); every other status —
       including this route's own JSON errors, which answer 200/4xx with a
       parsed body — is a real answer, not a transport fence. */
    function isAuthRejection(status) {
      return status === 401 || status === 403
    }
    /* ---- end remote channel fallback core ---- */

    /* Sticky remote-channel mode: once the proxy has answered, later calls go
       there directly — otherwise every call from a remote client pays the
       401/403 round trip first. Loopback desktop browsing never trips the
       fallback at all (same-origin requests are always admitted). */
    let viaRemoteChannel = false

    /* ---- the "working" notice (m00761) ----
       A long git verb answers in the one bottom-right stack, not in the page
       layout. The notice waits 400 ms first, so a fast call never flashes it,
       and it leaves the stack when the last busy call settles. */
    const BUSY_TOAST_METHODS = new Set([
      'fetch', 'pull', 'push', 'commit', 'merge', 'rebase', 'cherryPick', 'revert',
      'reset', 'checkout', 'clone', 'stashPush', 'stashApply', 'worktreeAdd',
      'worktreeRemove', 'branchDelete', 'tagDelete', 'tagDeleteRemote', 'pushTags',
    ])
    const BUSY_TOAST_DELAY_MS = 400
    let busyToastText = ''
    let busyToastId = null
    let busyToastTimer = null
    let busyToastCount = 0

    function setBusyToast(text) { busyToastText = typeof text === 'string' ? text : '' }

    function busyBegin() {
      busyToastCount += 1
      if (busyToastText === '' || busyToastTimer !== null || busyToastId !== null) return
      busyToastTimer = setTimeout(() => {
        busyToastTimer = null
        busyToastId = toastCenter.push({ text: busyToastText, ttl: 0 })
      }, BUSY_TOAST_DELAY_MS)
    }

    function busyEnd() {
      busyToastCount = Math.max(0, busyToastCount - 1)
      if (busyToastCount > 0) return
      if (busyToastTimer !== null) { clearTimeout(busyToastTimer); busyToastTimer = null }
      if (busyToastId !== null) { const id = busyToastId; busyToastId = null; toastCenter.drop(id) }
    }

    async function request(method, payload) {
      if (BUSY_TOAST_METHODS.has(method) !== true) return requestOnce(method, payload)
      busyBegin()
      try {
        return await requestOnce(method, payload)
      } finally {
        busyEnd()
      }
    }

    async function requestOnce(method, payload) {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      }
      const direct = API_BASE + '/' + method
      let response = null
      if (viaRemoteChannel === true) {
        response = await fetch(remoteFallbackUrl(direct), init)
      } else {
        response = await fetch(direct, init)
        if (isAuthRejection(response.status) === true) {
          /* Off the origin's trust path: try the pairing proxy once. With no
             remote-web-ui installed the proxy path 404s — the retry then also
             fails, and the ORIGINAL rejection is what the caller sees (a
             proxy answer that is itself an auth rejection is discarded the
             same way, so a genuine cross-site refusal can never be masked). */
          const retried = await fetch(remoteFallbackUrl(direct), init)
          if (isAuthRejection(retried.status) !== true) {
            viaRemoteChannel = true
            response = retried
          }
        }
      }
      let body = null
      try { body = await response.json() } catch (error) { void error }
      if (body === null || typeof body !== 'object') throw new Error('HTTP ' + response.status)
      if (body.ok !== true) {
        const error = body.error === undefined || body.error === null ? {} : body.error
        const failure = new Error(typeof error.message === 'string' && error.message !== '' ? error.message : 'HTTP ' + response.status)
        failure.code = typeof error.code === 'string' ? error.code : 'unknown'
        throw failure
      }
      return body.data
    }

    /* Every failure the panel cannot fix itself is copied to the host's error
       log (m04918), so a user report can be read from one file instead of a
       console that is already gone. Best effort: a failed report is dropped. */
    function reportClientError(scope, error) {
      try {
        const message = error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : ''
        void request('client-error', { scope: scope, message: message, stack: stack }).catch(() => undefined)
      } catch (_) { /* reporting must never throw */ }
    }
    /* Window-level faults (a throw outside React, an unhandled promise) reach
       the same file. The listeners attach once per page load. */
    let clientErrorHooked = false
    function installClientErrorHook() {
      if (clientErrorHooked === true) return
      clientErrorHooked = true
      window.addEventListener('error', (event) => {
        const error = event.error === undefined || event.error === null ? event.message : event.error
        reportClientError('window', error)
      })
      window.addEventListener('unhandledrejection', (event) => {
        reportClientError('promise', event.reason)
      })
    }

    /* ============================== first-paint cache ============================== */

    /* Session-scoped seats (the conversation view, and every sidebar seat that
       follows the active session) REMOUNT their panel on each session switch:
       the slot subtree belongs to the session. Re-running the whole discovery
       (repos scan) + first page (summary / branches / log — three git spawns)
       on every switch made the chrome re-appear piece by piece (reported
       against v0.13.0). Same workspace ⇒ same repository ⇒ the previous paint
       is still essentially correct, so it seeds the states and a background
       refresh lands the fresh data a moment later. Pure functions; the panel
       only ever reads them at effect time and writes after a fetch. */
    /* Two seeds age very differently. The repos scan is the SLOW part (a
       multi-repo workspace walks directories) and its result barely changes,
       so its seed keeps a 10-minute TTL: freshness is the background refresh's
       job — every mount refreshes anyway — the TTL only decides how old a seed
       may be to still paint the first screen. The page seed (summary /
       branches / log) used to expire after 30s, which is exactly the user
       complaint this queue answers ("come back to the panel after a while and
       everything re-loads"): it is a KEEP-WARM QUEUE now — no expiry at all,
       an LRU of three workspaces. Every page in the queue paints instantly no
       matter how long the panel stayed closed; the mount refresh re-proves
       every field silently right after, so freshness never regresses. */
    const PAINT_REPOS_TTL_MS = 600_000
    const PAINT_PAGE_KEEP_WARM = 3
    const paintRepos = new Map()   /* cwd -> { at, data } */
    const paintPage = new Map()    /* repoRoot -> { at, summary, branches, commits, hasMore } */
    const paintRoot = new Map()    /* cwd -> last repoRoot the user was looking at */

    /* The seed also survives a FULL PAGE RELOAD: sessionStorage holds the same
       maps for the lifetime of the tab, so reloading the page (the other way
       users "come back") paints from the seed instead of re-running the slow
       discovery. Hydrate runs once, lazily before the first read; every write
       mirrors the in-memory state back. All of it is best-effort: private
       mode, quota errors and corrupted payloads degrade to "no seed", never to
       an error — and never to a rollback of live state (seeding still only
       fills cold state, see the panel side below). */
    const PAINT_KEY = 'dsh-git4idea.paint.v1'
    let paintHydrated = false

    function hydratePaint() {
      if (paintHydrated === true) return
      paintHydrated = true
      let parsed = null
      try {
        const raw = window.sessionStorage.getItem(PAINT_KEY)
        if (typeof raw === 'string' && raw !== '') parsed = JSON.parse(raw)
      } catch (error) { void error; return }
      if (parsed === null || typeof parsed !== 'object') return
      /* Entries already in memory stay untouched: a write that happened before
         the first read is always fresher than what the storage holds. */
      const feed = (map, stored) => {
        if (stored === null || typeof stored !== 'object') return
        let count = 0
        for (const key of Object.keys(stored)) {
          const entry = stored[key]
          if (map.has(key) || entry === null || typeof entry !== 'object' || typeof entry.at !== 'number') continue
          if (count >= 16) break
          map.set(key, entry)
          count += 1
        }
      }
      feed(paintRepos, parsed.repos)
      feed(paintPage, parsed.page)
      /* The queue cap applies to restored pages too: storage may hold more
         than the live queue does (an older build wrote 16), trim to the same
         three — restored insertion order mirrors the order that was in
         memory, so the survivors are the most recent pages. */
      while (paintPage.size > PAINT_PAGE_KEEP_WARM) {
        paintPage.delete(paintPage.keys().next().value)
      }
    }

    function persistPaint() {
      try {
        const pack = (map) => {
          const out = {}
          for (const [key, entry] of map) out[key] = entry
          return out
        }
        window.sessionStorage.setItem(PAINT_KEY, JSON.stringify({ repos: pack(paintRepos), page: pack(paintPage) }))
      } catch (error) { void error }
    }

    function readPaintRepos(cwd) {
      hydratePaint()
      const entry = paintRepos.get(cwd)
      if (entry === undefined || Date.now() - entry.at > PAINT_REPOS_TTL_MS) return undefined
      return entry.data
    }

    function writePaintRepos(cwd, data) {
      paintRepos.set(cwd, { at: Date.now(), data: data })
      if (paintRepos.size > 16) paintRepos.delete(paintRepos.keys().next().value)
      persistPaint()
    }

    function readPaintPage(repoRoot) {
      hydratePaint()
      const entry = paintPage.get(repoRoot)
      if (entry === undefined) return undefined
      /* A read is a USE: re-insert at the tail so eviction tracks what the
         user actually visits, not which page happened to be written last. */
      paintPage.delete(repoRoot)
      paintPage.set(repoRoot, entry)
      return entry
    }

    function writePaintPage(repoRoot, page) {
      paintPage.set(repoRoot, Object.assign({ at: Date.now() }, page))
      /* The keep-warm queue cap: three workspaces stay painted, the fourth
         evicts the least-recently-used one. Pure LRU over insertion order —
         reads re-tail themselves (readPaintPage), so the survivor set is the
         three repo pages the user actually keeps coming back to. */
      while (paintPage.size > PAINT_PAGE_KEEP_WARM) {
        const oldest = paintPage.keys().next().value
        paintPage.delete(oldest)
      }
      persistPaint()
    }

    function rememberPaintRoot(cwd, repoRoot) {
      if (typeof cwd === 'string' && cwd !== '' && repoRoot !== null) paintRoot.set(cwd, repoRoot)
    }

    function readPaintRoot(cwd) {
      return paintRoot.get(cwd)
    }

    /* ============================== session-switch prewarm ============================== */

    /* Everything above only fills when a PANEL MOUNTS. A session whose
       workspace the panel has never seen still paid the full cold start
       (repos discovery + summary + branches + first log page) the moment the
       user opened the Git tab from the rail or the right sidebar. The
       prewarmer closes that gap: it watches the session list — the same store
       and the same main-view criterion (retainedBy.mainView) the host itself
       uses to decide the active session — and whenever the active session's
       workspace changes, it runs exactly the READS the panel's first paint
       would run and writes them into the same cache. Opening the panel
       afterwards seeds from the warm cache and paints instantly; the mount
       refresh re-proves every field, exactly as before. Read routes only,
       always silent: any failure just means that panel opens cold, never an
       error surface. Hosts without the sessions service never arm it. */

    const PREWARM_DEBOUNCE_MS = 300
    let prewarmTimer = null
    let prewarmGeneration = 0

    /* The panel's own repo pick order (see the repos effect in Panel): the
       session's remembered repo, the workspace's last-viewed root, the
       workspace itself when it is a repository, then the first row. Picking
       identically is what makes the warmed page THE page the panel shows. */
    function prewarmPickOf(sessionId, cwd, data) {
      const paths = data.repos.map((repo) => repo.path)
      const remembered = readRememberedRepo(sessionId)
      if (remembered !== undefined && paths.indexOf(remembered) >= 0) return remembered
      const painted = readPaintRoot(cwd)
      if (painted !== undefined && paths.indexOf(painted) >= 0) return painted
      if (data.isRepo === true) return data.cwd
      if (paths.length > 0) return paths[0]
      return null
    }

    async function prewarmWorkspace(sessionId, cwd) {
      const generation = ++prewarmGeneration
      try {
        let data = readPaintRepos(cwd)
        if (data === undefined) {
          data = await request('repos', { cwd: cwd })
          /* A newer switch arrived while this scan ran: drop the stale
             result on the floor instead of writing and fetching on. */
          if (generation !== prewarmGeneration) return
          writePaintRepos(cwd, data)
        }
        const pick = prewarmPickOf(sessionId, cwd, data)
        if (pick === null || readPaintPage(pick) !== undefined) return
        const base = { cwd: cwd, repoRoot: pick }
        const pages = await Promise.all([
          request('summary', Object.assign({}, base, { ignored: false, stats: false })),
          request('branches', base),
          request('log', Object.assign({}, base, { skip: 0, limit: 120 })),
        ])
        if (generation !== prewarmGeneration) return
        writePaintPage(pick, { summary: pages[0], branches: pages[1], commits: pages[2].commits, hasMore: pages[2].hasMore })
      } catch (error) { void error }
    }

    /* The active session, by the host's own rule: whoever the main view
       retains (retainedBy.mainView > 0). A switch can briefly retain BOTH
       sides; the freshest updatedAt wins. Null when no session is active. */
    /* The LIVE counts come from retainInfo(id).getSnapshot(), not from the
       list row: the row's retainedBy field only refreshes with the next host
       list sync, so right after a click it still names the PREVIOUS session
       (the same reason the host's own ui-session reads retainInfo in its
       publishMain). cwd and updatedAt still come from the row. */
    function activeSessionOf(ctx) {
      try {
        const sessions = ctx.get('sessions')
        const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
        if (list === undefined || typeof list.getSnapshot !== 'function') return null
        if (typeof sessions.retainInfo !== 'function') return null
        const snapshot = list.getSnapshot()
        if (snapshot === null || typeof snapshot !== 'object' || snapshot.byId === undefined || snapshot.byId === null) return null
        let active = null
        for (const key of Object.keys(snapshot.byId)) {
          const entry = snapshot.byId[key]
          if (entry === null || typeof entry !== 'object') continue
          let main = 0
          try {
            const info = sessions.retainInfo(key)
            const counted = info !== undefined && info !== null && typeof info.getSnapshot === 'function' ? info.getSnapshot() : null
            const retained = counted !== null && typeof counted === 'object' ? counted.retainedBy : null
            main = retained !== undefined && retained !== null && typeof retained === 'object'
              ? (typeof retained.mainView === 'number' ? retained.mainView : 0)
              : 0
          } catch (error) { void error }
          if (main <= 0) continue
          if (active === null || entry.updatedAt > active.updatedAt) active = entry
        }
        return active
      } catch (error) { void error; return null }
    }

    function schedulePrewarm(ctx) {
      if (prewarmTimer !== null) clearTimeout(prewarmTimer)
      prewarmTimer = setTimeout(() => {
        prewarmTimer = null
        const active = activeSessionOf(ctx)
        if (active === null) return
        if (typeof active.cwd !== 'string' || active.cwd === '') return
        const sessionId = typeof active.id === 'string' ? active.id : 'default'
        /* Skip everything when BOTH cache layers already cover what the panel
           would paint: repos fresh AND the pick's page kept warm. */
        const cachedRepos = readPaintRepos(active.cwd)
        if (cachedRepos !== undefined) {
          const pick = prewarmPickOf(sessionId, active.cwd, cachedRepos)
          if (pick !== null && readPaintPage(pick) !== undefined) return
        }
        void prewarmWorkspace(sessionId, active.cwd)
      }, PREWARM_DEBOUNCE_MS)
    }

    /* ============================== storage ============================== */

    /* ---- tree UI state (v0.13.1): the session-scoped seats remount on every
       session switch, and component state died with them — branch sections
       snapped back to defaults and folders re-folded. One settings file home,
       GLOBAL by design: which sections you keep folded is a habit, not a
       property of the repository. ---- */
    const TREE_KEY = 'dsh-git4idea.tree.v1'

    function readTreeState() {
      try {
        const raw = readStored(TREE_KEY)
        if (raw === null || raw === '') return null
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : null
      } catch (error) { void error }
      return null
    }

    function writeTreeState(state) {
      writeStored(TREE_KEY, JSON.stringify(state))
    }

    function treeSectionDefaults() {
      return { favorites: false, remote: false, tags: true }
    }

    function treeSectionsOf(stored) {
      const sections = stored !== null && typeof stored === 'object' && stored.sections !== null && typeof stored.sections === 'object'
        ? stored.sections
        : {}
      return Object.assign(treeSectionDefaults(), sections)
    }

    function readRememberedRepo(sessionId) {
      try {
        const raw = readStored(REPO_KEY)
        if (raw === null || raw === '') return undefined
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return undefined
        const value = parsed[sessionId]
        return typeof value === 'string' && value !== '' ? value : undefined
      } catch (error) { void error }
      return undefined
    }

    function rememberRepo(sessionId, repoPath) {
      try {
        const raw = readStored(REPO_KEY)
        const parsed = raw === null || raw === '' ? {} : JSON.parse(raw)
        const next = parsed !== null && typeof parsed === 'object' ? parsed : {}
        next[sessionId] = repoPath
        writeStored(REPO_KEY, JSON.stringify(next))
      } catch (error) { void error }
    }

    const FAV_KEY = 'dsh-git4idea.favorites.v1'

    function readFavorites(repoPath) {
      try {
        const raw = readStored(FAV_KEY)
        if (raw === null || raw === '') return []
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return []
        const list = parsed[repoPath]
        return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : []
      } catch (error) { void error }
      return []
    }

    function toggleFavorite(repoPath, branch) {
      const current = readFavorites(repoPath)
      const next = current.indexOf(branch) >= 0 ? current.filter((entry) => entry !== branch) : current.concat([branch])
      try {
        const raw = readStored(FAV_KEY)
        const parsed = raw === null || raw === '' ? {} : JSON.parse(raw)
        const all = parsed !== null && typeof parsed === 'object' ? parsed : {}
        all[repoPath] = next
        writeStored(FAV_KEY, JSON.stringify(all))
      } catch (error) { void error }
      return next
    }

    const RAIL_KEY = 'dsh-git4idea.rail.v1'

    /* The action rail is user-composed. RAIL_SPECS is the canonical set AND the
       default order; a stored config only holds a permutation plus the ids the
       user hid, and normalizeRail() drops unknown ids and appends missing ones —
       so a version that adds an action never breaks a stored config. */
    /* The rail is the IDEA *Git* strip, top to bottom: the branch-pane
       collapse chevron (drawn by renderRail itself, above a divider), new
       branch, update-from-remote, delete branch, compare, fetch, favorite.
       Everything else left the rail — push and pull now sit right of the
       branch name in the top bar, and the rest was noise for this plugin. */
    const RAIL_SPECS = [
      { id: 'tree', icon: 'chevronLeft', key: 'toolbar.tree', tone: 'secondary' },
      { id: 'newBranch', icon: 'plus', key: 'toolbar.newBranch', tone: 'secondary' },
      { id: 'pull', icon: 'pull', key: 'toolbar.pull', tone: 'secondary' },
      { id: 'delete', icon: 'trash', key: 'action.delete', tone: 'secondary' },
      { id: 'compare', icon: 'compare', key: 'action.compare', tone: 'secondary' },
      { id: 'fetch', icon: 'fetch', key: 'toolbar.fetch', tone: 'secondary' },
      { id: 'favorite', icon: 'star', key: 'action.favorite', tone: 'warn' },
    ]
    const RAIL_IDS = RAIL_SPECS.map((spec) => spec.id)
    /* Actions that arrange the view rather than touch the repository, so a running
       git command never greys them out. */
    const RAIL_VIEW_IDS = ['tree']

    function normalizeRail(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const order = []
      const storedOrder = Array.isArray(source.order) ? source.order : []
      for (const id of storedOrder) {
        if (typeof id === 'string' && RAIL_IDS.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id)
      }
      for (const id of RAIL_IDS) { if (order.indexOf(id) < 0) order.push(id) }
      const hidden = []
      const storedHidden = Array.isArray(source.hidden) ? source.hidden : []
      for (const id of storedHidden) {
        if (typeof id === 'string' && RAIL_IDS.indexOf(id) >= 0 && hidden.indexOf(id) < 0) hidden.push(id)
      }
      return { order, hidden }
    }

    /* m04492: the plugin has no row Config any more. Every value that surface
       carried comes from the constants below, and the rail's own arrangement
       stays where the panel editor has always kept it. */

    /* The conversation view fills the whole height — its only placement. */
    function conversationImmersiveEnabled() {
      return true
    }

    function readRailConfig() {
      try {
        const raw = readStored(RAIL_KEY)
        if (raw === null || raw === '') return normalizeRail(null)
        return normalizeRail(JSON.parse(raw))
      } catch (error) { void error }
      return normalizeRail(null)
    }

    function writeRailConfig(config) {
      writeStored(RAIL_KEY, JSON.stringify(config))
    }

    /* ============================== pane sizes ============================== */

    /* ---- pane sizing core (pure: tests/smoke.mjs slices this block and drives
       it through new Function, so it must stay free of window/DOM/React) ---- */

    /* Every fixed pane size in the layout became draggable (issue #5), and the
       result is remembered PER SURFACE. The same registration renders in the
       bottom workbench (wide and flat) and in the native right sidebar (narrow
       and tall), and a 290px changes column that is right in one is half the
       panel in the other. The bucket is therefore `chrome:wide|tall`, and what
       is stored is a RATIO of the measured container: resizing the dock or the
       window rescales the panes instead of breaking the layout. */
    const PANES_KEY = 'dsh-git4idea.panes.v1'
    /* Every chrome can now move all three panes (the detail diff window used to
       be a fixed max-height:55% in the columns chrome — user report: it could
       not be resized). The DIFF pane is special: it is carved out of the middle
       pane, so it is sized by HEIGHT in every chrome, even where the other
       panes measure width (columns). */
    const PANE_CHROME_KEYS = {
      columns: ['tree', 'changes', 'diff'],
      stack: ['tree', 'changes', 'diff'],
      compact: ['tree', 'diff'],
    }
    /* Whether a key measures a height (stacked chromes) or a width (columns).
       This is the chrome's DEFAULT for the tree/changes panes; the diff pane
       overrides it to height unconditionally (see paneGeometry). */
    const PANE_HEIGHT_CHROME = { columns: false, stack: true, compact: true }
    /* The pane a separator resizes, and the key its label is translated from. */
    const PANE_NAME_KEYS = { tree: 'toolbar.tree', changes: 'changes.title', diff: 'pane.diff' }
    /* Hard limits in px: a gutter moves a pane between these and nothing else,
       so no pane can ever be dragged down to zero. */
    const PANE_LIMITS = {
      'columns:tree': { min: 140, max: 560 },
      'columns:changes': { min: 200, max: 640 },
      'columns:diff': { min: 120, max: 900 },
      'stack:tree': { min: 100, max: 420 },
      'stack:changes': { min: 120, max: 460 },
      'stack:diff': { min: 120, max: 900 },
      'compact:tree': { min: 100, max: 420 },
      'compact:diff': { min: 120, max: 900 },
    }
    /* Today's fixed sizes stay the default — and stay in the stylesheet: a pane
       the user never dragged keeps exactly the look it had before, while a
       dragged one is remembered as a ratio. The diff's 0.55 IS the stylesheet's
       max-height:55%, so an undragged window renders identically to before. */
    const PANE_DEFAULTS = {
      'columns:tree': { ratio: 0.2 },
      'columns:changes': { ratio: 0.4 },
      'columns:diff': { ratio: 0.55 },
      'stack:tree': { ratio: 0.36 },
      'stack:changes': { ratio: 0.46 },
      'compact:tree': { ratio: 0.42 },
    }
    const PANE_MAIN_MIN_W = 240
    const PANE_MAIN_MIN_H = 150
    /* The reserve above is the IDEAL the clamp aims for. When the panel is simply
       too small for every default at once, aiming for it would put a pane's
       ceiling BELOW the box that pane already occupies — and the first drag would
       then shrink it instead of growing it. Below that point the middle pane
       keeps this hard floor instead, and the pane's own current size always wins
       (see paneGeometry). */
    const PANE_MAIN_FLOOR_PX = 120
    const PANE_HISTORY_MIN_H = 120
    /* Hit area of one gutter, and how many of them sit in the body. The
       history↔diff separator lives inside the middle pane, so it is not counted
       against the body's own budget. */
    const PANE_GUTTER_PX = 8
    const PANE_BODY_GUTTERS = { columns: 2, stack: 2, compact: 1 }
    const PANE_BUCKETS = Object.keys(PANE_CHROME_KEYS).reduce(
      (all, chrome) => all.concat([chrome + ':wide', chrome + ':tall']), [])

    /* Two measurements are the same when every pane they know about is. */
    function samePaneSizes(current, next) {
      const keys = Object.keys(current)
      if (keys.length !== Object.keys(next).length) return false
      for (const key of keys) { if (current[key] !== next[key]) return false }
      return true
    }

    function panBucket(chrome, box) {
      return chrome + (box.height > box.width ? ':tall' : ':wide')
    }

    /* Storage is untrusted, so this keeps normalizeRail()'s discipline: unknown
       buckets, unknown keys, non-finite numbers and out-of-range ratios are all
       dropped. A ratio is a fraction of the container, so it lives in (0, 1]. */
    function normalizePanes(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const stored = source.panes !== null && typeof source.panes === 'object' ? source.panes : {}
      const panes = {}
      for (const bucket of PANE_BUCKETS) {
        const entry = stored[bucket]
        if (entry === null || typeof entry !== 'object') continue
        const keys = PANE_CHROME_KEYS[bucket.slice(0, bucket.indexOf(':'))]
        const clean = {}
        for (const key of keys) {
          const value = entry[key]
          if (typeof value !== 'number' || Number.isFinite(value) === false) continue
          if (value <= 0 || value > 1) continue
          clean[key] = value
        }
        if (Object.keys(clean).length > 0) panes[bucket] = clean
      }
      return { treeOpen: source.treeOpen !== false, panes: panes }
    }

    /* Immutable single-key update. ratio === null removes the override, which is
       exactly what the double-click reset does. */
    function withPaneRatio(config, bucket, key, ratio) {
      const panes = {}
      for (const name of PANE_BUCKETS) {
        if (config.panes[name] !== undefined) panes[name] = config.panes[name]
      }
      const entry = {}
      const current = panes[bucket] === undefined ? {} : panes[bucket]
      for (const name of PANE_CHROME_KEYS[bucket.slice(0, bucket.indexOf(':'))]) {
        if (current[name] !== undefined) entry[name] = current[name]
      }
      if (ratio === null) delete entry[key]
      else entry[key] = ratio
      if (Object.keys(entry).length === 0) delete panes[bucket]
      else panes[bucket] = entry
      return { treeOpen: config.treeOpen, panes: panes }
    }

    /* Stored ratios (or today's defaults) → concrete px for the current chrome,
       clamped against the measured container. `overrides` holds only the panes
       the user actually dragged (absent = leave the stylesheet default alone);
       `effective` is what the clamp math used; `limits` is the range each gutter
       is allowed to hand back. `laidOut` is what the panes actually measure right
       now, which beats the stylesheet default when a pane is content-sized: the
       stacked chrome caps the changes pane at 46%, but a three-file summary only
       takes 30%, and reserving the cap would freeze the tree above it. */
    function paneGeometry(chrome, box, config, laidOut) {
      const height = PANE_HEIGHT_CHROME[chrome] === true
      const reference = height ? box.height : box.width
      const bucket = panBucket(chrome, box)
      const ready = config !== null && typeof config === 'object'
      const source = ready && config.panes !== null && typeof config.panes === 'object' ? config.panes : {}
      const ratios = source[bucket] !== null && typeof source[bucket] === 'object' ? source[bucket] : {}
      const measured = laidOut !== null && typeof laidOut === 'object' ? laidOut : {}
      const keys = PANE_CHROME_KEYS[chrome].slice()
      /* A folded tree has no pane and no gutter, so it must not reserve room. */
      if (ready && config.treeOpen === false) {
        const at = keys.indexOf('tree')
        if (at >= 0) keys.splice(at, 1)
      }
      const overrides = {}
      const effective = {}
      const limits = {}
      const sizeOf = (key) => (effective[key] === undefined ? 0 : effective[key])
      /* The diff is carved out of the middle pane, so it measures HEIGHT in
         every chrome — even in columns, where tree/changes run sideways and
         the chrome's own dimension is width. Its ratios therefore divide the
         body HEIGHT, whatever `reference` says. */
      const referenceOf = (key) => (key === 'diff' ? box.height : reference)
      for (const key of keys) {
        const spec = PANE_DEFAULTS[chrome + ':' + key]
        const fallback = spec === undefined ? 0 : (spec.px === undefined ? spec.ratio * referenceOf(key) : spec.px)
        const live = measured[key]
        effective[key] = typeof live === 'number' && Number.isFinite(live) && live > 0 ? live : fallback
      }
      const space = Math.max(0, reference - PANE_BODY_GUTTERS[chrome] * PANE_GUTTER_PX)
      const reserve = height ? PANE_MAIN_MIN_H : PANE_MAIN_MIN_W
      /* Deterministic order: changes, then tree, then diff. The diff is carved
         out of the middle pane, so it is clamped last — against whatever the
         first two left behind, minus the history list's own minimum. */
      for (const key of ['changes', 'tree', 'diff']) {
        if (keys.indexOf(key) < 0) continue
        const spec = PANE_LIMITS[chrome + ':' + key]
        const current = sizeOf(key)
        let ceiling = spec.max
        if (key === 'diff') {
          /* The diff lives INSIDE the main pane, so its height budget is the
             main pane's height: the full body height in the columns chrome
             (the other panes run sideways there and share none of it), the
             body height minus the stacked siblings otherwise. Either way the
             history list keeps its own minimum. */
          const main = height
            ? space - sizeOf('changes') - sizeOf('tree') - PANE_GUTTER_PX
            : box.height
          ceiling = Math.min(ceiling, main - PANE_HISTORY_MIN_H)
        } else {
          let taken = 0
          for (const other of keys) { if (other !== key && other !== 'diff') taken += sizeOf(other) }
          /* Two tiers, because one number cannot serve both jobs. The IDEAL keeps
             the middle pane at its reserve — that is what a roomy panel gets. The
             relaxed tier only kicks in when the ideal would land BELOW the box
             this pane already occupies (a 674px column cannot hold 200 + 290 + 240
             at once), and it exists so the clamp degrades to "you may not grow
             much" instead of "the first drag to the right shrinks you". */
          const ideal = space - reserve - taken
          ceiling = Math.min(ceiling, current > ideal ? space - PANE_MAIN_FLOOR_PX - taken : ideal)
        }
        /* The clamp may refuse to GROW a pane; it may never shrink one the user
           did not touch — so the ceiling is never below the pane's current box,
           and the aria window says exactly that. */
        const cap = Math.max(spec.max, Math.round(current))
        const high = Math.min(cap, Math.max(spec.min, Math.round(ceiling), Math.round(current)))
        limits[key] = { min: spec.min, max: high }
        const ratio = ratios[key]
        if (typeof ratio === 'number' && Number.isFinite(ratio)) {
          const px = Math.round(Math.min(Math.max(ratio * referenceOf(key), spec.min), high))
          overrides[key] = px
          effective[key] = px
        }
      }
      return { bucket: bucket, overrides: overrides, effective: effective, limits: limits }
    }
    /* ---- end pane sizing core ---- */

    function readPanes() {
      try {
        const raw = readStored(PANES_KEY)
        if (raw === null || raw === '') return normalizePanes(null)
        return normalizePanes(JSON.parse(raw))
      } catch (error) { void error }
      return normalizePanes(null)
    }

    function writePanes(config) {
      writeStored(PANES_KEY, JSON.stringify(normalizePanes(config)))
    }

    /* ============================== dock actions ============================== */

    /* ---- dock action core (pure: tests/smoke.mjs slices this block) ---- */

    /* The official right sidebar (ui-sidebar-right) is the only surface that can
       float a tab out, dock it back, split its pane or take it full screen, and it
       is NOT there on every host: an old host has no sidebarRight at all, and even
       on a host that ships it the service is only provided once
       ui-sidebar-right has mounted —
       reading it during apply() returns undefined (measured on 0.1.7-rc.2). So the
       service is read at render time, and a missing one means these actions do not
       exist for this mount: no button, no error, no console noise. */
    function dockFaceOf(ctx) {
      if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return null
      let service
      try { service = ctx.get('sidebarRight') } catch (error) { return null }
      if (service === null || service === undefined || typeof service !== 'object') return null
      if (typeof service.float !== 'function' || typeof service.dock !== 'function') return null
      return service
    }

    /* What this mount can offer. `dock` is the wiring handed down to the panel
       (null when nothing is wired, e.g. the conversation-area seat), `floatPaneId` is
       the floating pane the panel is currently drawn in, read from the float
       layer's own marker. The face publishes operations only — no layout snapshot —
       so the float state has to come from there. */
    function dockActionState(dock, floatPaneId) {
      const wired = dock !== null && typeof dock === 'object' && typeof dock.tabId === 'string'
        && dock.tabId !== '' && dock.service !== null && typeof dock.service === 'object'
      const floating = typeof floatPaneId === 'string' && floatPaneId !== ''
      return {
        wired: wired,
        floating: floating,
        float: wired,
        /* A float panel hosts exactly one tab: splitting it is not a thing. */
        split: wired && floating === false,
        fullscreen: wired && typeof dock.service.toggleFullscreen === 'function',
      }
    }
    /* ---- end dock action core ---- */

    /* The slot hands every tab body its own reader; it THROWS while the tab is not
       committed in the session, so an unreadable tab means no dock actions rather
       than a broken panel. Called from the component that owns the hook. */
    function readDockInfo(useTabInfo, ctx) {
      if (typeof useTabInfo !== 'function') return null
      const service = dockFaceOf(ctx)
      if (service === null) return null
      let info = null
      try { info = useTabInfo() } catch (error) { void error }
      if (info === null || typeof info !== 'object' || info.tab === undefined || info.panel === undefined) return null
      if (typeof info.tab.id !== 'string') return null
      return {
        service: service,
        tabId: info.tab.id,
        paneId: typeof info.panel.id === 'string' ? info.panel.id : '',
        fullscreen: info.sidebar !== undefined && info.sidebar !== null && info.sidebar.fullscreen === true,
      }
    }

    /* ============================== formatting ============================== */

    function shortDate(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return ''
      const pad = (value) => (value < 10 ? '0' + value : String(value))
      return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes())
    }

    function baseName(filePath) {
      if (typeof filePath !== 'string') return ''
      const parts = filePath.split('/')
      return parts[parts.length - 1]
    }

    function dirName(filePath) {
      if (typeof filePath !== 'string') return ''
      const index = filePath.lastIndexOf('/')
      return index < 0 ? '' : filePath.slice(0, index)
    }

    /* A REAL directory tree for the "by directory" grouping (v0.18.6): files
       are inserted by path segments, then a folder that has no direct files
       and exactly one child is COMPRESSED into that child ("a/b/c" as one
       node, VS Code source-control style) — the flat per-directory heads the
       user rejected rendered every folder of a chain side by side, so
       `pkg/service` and `pkg/service/impl` looked like unrelated siblings.
       Returns the compressed roots (sorted), every foldable node id (for
       fold-all), the files sitting at the group root, and the two recursive
       helpers the renderer needs. */
    function buildDirForest(items, groupKey) {
      const root = { dirs: new Map(), files: [], path: [] }
      for (const item of items) {
        const dir = dirName(item.path)
        const parts = dir === '' ? [] : dir.split('/')
        let node = root
        for (const part of parts) {
          let child = node.dirs.get(part)
          if (child === undefined) {
            child = { dirs: new Map(), files: [], path: node.path.concat([part]) }
            node.dirs.set(part, child)
          }
          node = child
        }
        node.files.push(item)
      }
      const compress = (node) => {
        let merged = node
        while (merged.files.length === 0 && merged.dirs.size === 1) {
          const only = merged.dirs.values().next().value
          merged = { dirs: only.dirs, files: only.files, path: only.path }
        }
        return merged
      }
      const countOf = (node) => {
        let total = node.files.length
        for (const child of node.dirs.values()) total += countOf(child)
        return total
      }
      /* Compress at EVERY level, not just the roots (issue #18): the roots
         were condensed into "a/b/c" chains, but renderFolder's recursion and
         the fold-all id walk both read this function — which used to hand
         back the raw single-child chains below the first level, so a deep
         package path repeated its full prefix on every row. Each returned
         child is the deepest node of its single-child, file-less chain. */
      const sortedChildren = (node) => Array.from(node.dirs.values()).map(compress).sort((a, b) => a.path[a.path.length - 1].localeCompare(b.path[b.path.length - 1]))
      const ids = []
      const collect = (node) => {
        ids.push(groupKey + '|' + node.path.join('/'))
        for (const child of sortedChildren(node)) collect(child)
      }
      const roots = sortedChildren(root)
      for (const node of roots) collect(node)
      return { roots: roots, rootFiles: root.files, ids: ids, countOf: countOf, sortedChildren: sortedChildren }
    }

    /* ============================== commit graph ============================== */

    /* IDEA's log layout ("plan A"), ported from the permanent-graph sources:
       - every commit gets a layout index from a DFS that starts at the branch
         heads ordered by branch importance (origin/master, remote branch,
         master, local branch, tag, current branch, HEAD). The DFS walks first
         parents first and bumps the index at each chain end, so the most
         important branch ends up leftmost even when a newer merge commit was
         loaded first.
       - the columns of a row are the RANKS of the elements visible in it: the
         commit node plus every edge that CROSSES the row (child above, parent
         below). Elements sort with GraphElementComparatorByLayoutIndex, so a
         wire lands between the columns its ends demand and the columns compact
         as soon as a wire dies.
       - an edge between adjacent rows is not a row element: its end column is
         the node of the neighbour row (PrintElementGeneratorImpl's end
         position function). Only a long edge is ranked on its own.
       Every row then draws the halves of the lines that touch its centre; two
       halves meet on the row border at the midpoint of their ranks, so one
       straight diagonal continues into the next row (IDEA's cell painter).
       The log is a WINDOW: a parent that was never loaded contributes no edge,
       the lane simply ends at its commit. */
    function buildRows(commits) {
      const indexOf = new Map()
      commits.forEach((commit, index) => indexOf.set(commit.hash, index))

      /* The current branch comes from the HEAD decoration, and it ranks behind
         every other ref class in IDEA's branch layout. */
      let currentBranch = null
      for (const commit of commits) {
        const refs = Array.isArray(commit.refs) ? commit.refs : []
        for (const ref of refs) {
          const name = String(ref)
          if (name.indexOf('HEAD -> ') === 0) currentBranch = name.slice(8)
        }
      }

      /* GitRefManager.getBranchLayoutComparator's classes: lower lays out
         further left. */
      const refPower = (token) => {
        const name = String(token)
        if (name === 'HEAD') return 6
        if (name.indexOf('tag: ') === 0) return 4
        const remote = name.indexOf('origin/') === 0
        const short = remote ? name.slice(7) : name
        if (short === 'master' || short === 'main') return remote ? 0 : 2
        if (remote) return 1
        if (currentBranch !== null && name === currentBranch) return 5
        return 3
      }
      const headRank = (commit) => {
        const refs = Array.isArray(commit.refs) ? commit.refs : []
        let power = 7
        let name = ''
        for (const ref of refs) {
          const token = String(ref)
          /* 'HEAD -> X' decorates the CURRENT BRANCH, not the HEAD symref. */
          const value = token.indexOf('HEAD -> ') === 0 ? 5 : refPower(token)
          if (value < power) { power = value; name = token }
        }
        return { power: power, name: name }
      }
      const compareHeads = (a, b) => {
        const first = headRank(commits[a])
        const second = headRank(commits[b])
        if (first.power !== second.power) return first.power - second.power
        if (first.name === second.name) return 0
        return first.name < second.name ? -1 : 1
      }

      const edges = []
      const downEdges = commits.map(() => [])
      const upEdges = commits.map(() => [])
      commits.forEach((commit, u) => {
        const parents = Array.isArray(commit.parents) ? commit.parents : []
        for (const parent of parents) {
          if (!indexOf.has(parent)) continue
          const d = indexOf.get(parent)
          if (d <= u) continue
          const edge = { u: u, d: d, color: 0 }
          edges.push(edge)
          downEdges[u].push(edge)
          upEdges[d].push(edge)
        }
      })
      edges.forEach((edge, index) => { edge.id = index })

      /* Heads are the branch tips plus every commit with no child in the
         window; IDEA walks them in branch-importance order. */
      const heads = []
      commits.forEach((commit, index) => {
        const refs = Array.isArray(commit.refs) ? commit.refs : []
        if (refs.length > 0 || upEdges[index].length === 0) heads.push(index)
      })
      heads.sort(compareHeads)

      const layoutIndex = new Array(commits.length).fill(0)
      let currentLayoutIndex = 1
      for (const head of heads) {
        if (layoutIndex[head] !== 0) continue
        const stack = [head]
        while (stack.length > 0) {
          const node = stack[stack.length - 1]
          const firstVisit = layoutIndex[node] === 0
          if (firstVisit) layoutIndex[node] = currentLayoutIndex
          let child = -1
          for (const edge of downEdges[node]) {
            if (layoutIndex[edge.d] === 0) { child = edge.d; break }
          }
          if (child === -1) {
            if (firstVisit) currentLayoutIndex += 1
            stack.pop()
          } else {
            stack.push(child)
          }
        }
      }

      const compare2 = (edge, node) => {
        const top = Math.max(layoutIndex[edge.u], layoutIndex[edge.d])
        return top !== layoutIndex[node] ? top - layoutIndex[node] : edge.u - node
      }
      /* GraphElementComparatorByLayoutIndex: an edge is ordered against a node
         (or against the other edge's other end) by the larger layout index. */
      const compareElements = (a, b) => {
        const first = a.edge
        const second = b.edge
        if (first !== undefined && second !== undefined) {
          if (first.u === second.u) {
            return first.d < second.d ? -compare2(second, first.d) : compare2(first, second.d)
          }
          return first.u < second.u ? compare2(first, second.u) : -compare2(second, first.u)
        }
        if (first !== undefined) return compare2(first, b.node)
        if (second !== undefined) return -compare2(second, a.node)
        return 0
      }

      const nodePos = new Array(commits.length).fill(0)
      const edgePos = commits.map(() => new Array(edges.length).fill(-1))
      let columnCount = 1
      for (let row = 0; row < commits.length; row += 1) {
        const elements = [{ node: row }]
        for (const edge of edges) {
          if (edge.u < row && row < edge.d) elements.push({ edge: edge })
        }
        elements.sort(compareElements)
        for (let position = 0; position < elements.length; position += 1) {
          const element = elements[position]
          if (element.edge !== undefined) edgePos[row][element.edge.id] = position
          else nodePos[row] = position
        }
        columnCount = Math.max(columnCount, elements.length)
      }
      /* IDEA paints an edge in the colour of its up (child) commit. */
      for (const edge of edges) edge.color = nodePos[edge.u]

      const rows = []
      for (let row = 0; row < commits.length; row += 1) {
        const top = []
        const bottom = []
        const node = nodePos[row]
        const crossing = []
        for (const edge of edges) {
          if (edge.u < row && row < edge.d) crossing.push(edge)
        }
        for (const edge of upEdges[row]) {
          const above = row - 1 === edge.u ? nodePos[row - 1] : edgePos[row - 1][edge.id]
          top.push({ wire: edge.id, from: (above + node) / 2, to: node, color: edge.color })
        }
        for (const edge of crossing) {
          const here = edgePos[row][edge.id]
          const above = row - 1 === edge.u ? nodePos[row - 1] : edgePos[row - 1][edge.id]
          const below = row + 1 === edge.d ? nodePos[row + 1] : edgePos[row + 1][edge.id]
          top.push({ wire: edge.id, from: (above + here) / 2, to: here, color: edge.color })
          bottom.push({ wire: edge.id, from: here, to: (here + below) / 2, color: edge.color })
        }
        for (const edge of downEdges[row]) {
          const below = row + 1 === edge.d ? nodePos[row + 1] : edgePos[row + 1][edge.id]
          bottom.push({ wire: edge.id, from: node, to: (node + below) / 2, color: edge.color })
        }
        rows.push({ commit: commits[row], lane: node, top: top, bottom: bottom, width: columnCount })
      }
      return rows
    }

    /* Coordinate half-segments of one row: a top piece enters the node centre
       from the row border, a bottom piece leaves it for the border. Both ends
       are ranks; the border end is the midpoint of the two ranks, so the next
       row's half continues the same straight line (IDEA's SimpleGraphCellPainter
       paints one full segment from a node centre to the next node centre and
       clips it to the cell). */
    function edgeSegments(row, x, middle, height) {
      const segments = []
      const top = Array.isArray(row.top) ? row.top : []
      const bottom = Array.isArray(row.bottom) ? row.bottom : []
      for (let index = 0; index < top.length; index += 1) {
        const piece = top[index]
        segments.push({
          key: 'top-' + String(index) + '-' + String(piece.wire),
          wire: piece.wire, color: piece.color, lane: piece.to,
          x1: x(piece.from), y1: 0, x2: x(piece.to), y2: middle,
        })
      }
      for (let index = 0; index < bottom.length; index += 1) {
        const piece = bottom[index]
        segments.push({
          key: 'bottom-' + String(index) + '-' + String(piece.wire),
          wire: piece.wire, color: piece.color, lane: piece.from,
          x1: x(piece.from), y1: middle, x2: x(piece.to), y2: height,
        })
      }
      return segments
    }


    /* Memoised: rows come from a useMemo, so a row object is referentially
       stable across re-renders unless the commit list actually changed — the
       26px graph cells then skip re-rendering on every filter keystroke. */
    /* IDEA paints no curves: a lane is a vertical stem, and a branch edge is a
       straight diagonal from the child node to the parent node one row below.
       The node always paints last, so it covers the wire ends. */
    const GraphCell = memo(function GraphCell(props) {
      const row = props.row
      const height = props.height
      const scale = height / GRAPH_ROW_UNIT
      const laneWidth = GRAPH_NODE_WIDTH * scale
      const stem = GRAPH_STEM * scale
      const radius = GRAPH_NODE_RADIUS * scale
      const width = Math.min(Math.max(1, row.width), GRAPH_MAX_LANES) * laneWidth + 8
      const middle = height / 2
      const children = []
      /* Lanes beyond the cap share the last column: the geometry stays bounded
         and the subject column keeps its room. */
      const x = (lane) => 8 + Math.min(lane, GRAPH_MAX_LANES - 1) * laneWidth
      const color = (lane) => LANE_COLORS[lane % LANE_COLORS.length]
      for (const segment of edgeSegments(row, x, middle, height)) {
        children.push(E('line', {
          key: segment.key,
          'data-lane': String(segment.lane),
          x1: segment.x1, y1: segment.y1, x2: segment.x2, y2: segment.y2,
          stroke: color(segment.color), strokeWidth: stem, strokeLinecap: 'round',
        }))
      }
      const isHead = Array.isArray(row.commit.refs) && row.commit.refs.some((ref) => String(ref).indexOf('HEAD') >= 0)
      /* HeadNodePainter draws three circles on the lane colour: a filled disc of
         r+2, a background disc of r, and a core dot of r/2. Painted as one ring
         stroke instead, the same silhouette costs two elements and needs no
         background colour: the ring spans r..r+2, the core sits at r/2. */
      children.push(isHead
        ? E('g', { key: 'dot' },
          E('circle', { 'data-lane': String(row.lane), cx: x(row.lane), cy: middle, r: radius * 1.25, fill: 'none', stroke: color(row.lane), strokeWidth: radius * 0.5 }),
          E('circle', { cx: x(row.lane), cy: middle, r: radius * 0.5, fill: color(row.lane) }))
        : E('circle', { key: 'dot', 'data-lane': String(row.lane), cx: x(row.lane), cy: middle, r: radius, fill: color(row.lane) }))
      return E('svg', { className: 'git4idea-graph', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height }, children)
    }, (prev, next) => prev.row === next.row && prev.height === next.height)

    /* ============================== composer send ============================== */
    /* "Send to chat": drop a reference chip / short text into the CURRENT
       session's composer, the way typing `@file` there would. The host channel
       is ui-conversation's SessionInput facade (research brief 2026-10-07):
       `ctx.get('conversation').input.for(ctx.get('sessions').scope(id))`. Every
       hop is probed — the services may be absent (a trimmed host) and `for`
       THROWS on a scope without a retained session generation — so a miss
       degrades to a clipboard copy with a toast, never a dead click.

       Two spellings:
       - file/folder → insertReference(): a structured Lexical chip whose model
         serialization is the plain `@path` text (the same thing the @ menu
         inserts; source 'reference', appearance 'file'/'folder').
       - text (short hash, branch name, raw path) → the scoped
         `slash/input-insert-text` bail event, the machine entrance of the same
         pipeline. NOT `inputTriggers...openReference` — that one opens a
         preview and never touches the draft. */

    /* `formatFileMention` (@deepseek-ai/dsh-file-reference/grammar) without the
       require: that package is not on the seed table, so the plugin inlines the
       grammar — trailing `/` for a directory, `@"path"` when whitespace is
       present (a quoted directory keeps its quote open), and `null` for paths
       the editor grammar cannot represent (control characters, quotes). */
    function fileMentionOf(relPath) {
      const isDir = relPath.slice(-1) === '/'
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(relPath) === true) return null
      if (/\s/u.test(relPath) === false) return '@' + relPath
      return isDir === true ? '@"' + relPath : '@"' + relPath + '"'
    }

    /* Resolve { actx, input } for the current session, or null. `input.for`
       requires a RETAINED Session scope and throws otherwise — that is part of
       its contract (contract/input.ts), so the whole probe rides a try/catch. */
    function composerTargetOf(ctx, sessionId) {
      try {
        if (ctx === undefined || ctx === null || ctx.get === undefined) return null
        if (typeof sessionId !== 'string' || sessionId === '' || sessionId === 'default') return null
        const sessions = ctx.get('sessions')
        const conversation = ctx.get('conversation')
        if (sessions === undefined || sessions === null || conversation === undefined || conversation === null) return null
        if (typeof sessions.scope !== 'function' || conversation.input === undefined || conversation.input === null) return null
        const actx = sessions.scope(sessionId)
        if (actx === undefined || actx === null) return null
        const input = conversation.input.for(actx)
        if (input === undefined || input === null) return null
        return { actx: actx, input: input }
      } catch (error) { void error; return null }
    }

    /* The composer carries TWO text projections (ui-conversation projection.ts):
       detectText feeds TokenSpan coordinates — every chip counts as ONE U+FFFC
       there — while the published InputState.draft is the clipboard projection,
       where a chip expands to its full `@path`. The insert verbs take DETECT
       spans, and selectSpan rejects `end > detectLength` outright (span-map.ts),
       so a tail span built from draft.length is correct only while the draft has
       NO chips. With one in the draft it points past the document end and the
       edit silently fails — exactly the "chip landed, the line-range sentence
       never did" real-machine report against v0.13.5 (and any plain-text send
       into a draft that already holds a chip). Convert instead: subtract every
       occurrence's (clipboard length - 1). */
    function detectTailSpanOf(state) {
      if (state === undefined || state === null || typeof state.draft !== 'string' || typeof state.draftRev !== 'number') return null
      let at = state.draft.length
      const occurrences = Array.isArray(state.occurrences) ? state.occurrences : []
      for (const occ of occurrences) {
        if (occ === null || typeof occ !== 'object') continue
        const width = typeof occ.length === 'number' && occ.length >= 0
          ? occ.length
          : (typeof occ.clipboardText === 'string' ? occ.clipboardText.length : 1)
        at -= Math.max(0, width - 1)
      }
      if (at < 0) return null
      return { start: at, end: at, draftRev: state.draftRev }
    }

    /* apply(actx, input, span) → boolean. The span is an EMPTY span at the draft
       tail in DETECT coordinates (the coordinates the CAS and selectSpan
       compare — see detectTailSpanOf). A false answer is the user typing
       between our read and write — re-read once and retry (the brief's advice:
       one retry, no spinning). The busy phases (adjudicating/submitting) also
       answer false; that lands on the same clipboard fallback, which is the
       honest outcome. */
    function insertIntoComposer(ctx, sessionId, apply) {
      const target = composerTargetOf(ctx, sessionId)
      if (target === null) return false
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let state
        try { state = target.input.state.getSnapshot() } catch (error) { void error; return false }
        const span = detectTailSpanOf(state)
        if (span === null) return false
        let applied = false
        try { applied = apply(target.actx, target.input, span) === true } catch (error) { void error; applied = false }
        if (applied === true) {
          try { target.input.focus() } catch (error) { void error }
          return true
        }
      }
      return false
    }

    /* One single-file unified diff (what the host `diff` method returns) → the
       one DiffHunk DiffBlock renders, by replaying ` `/`-`/`+` lines back into
       the two sides. No `@@` at all (binary patches, mode-only changes) or a
       pathless header → null, and the caller keeps the hand-drawn rows. */
    function patchToHunk(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text === '' || text.indexOf('@@') < 0) return null
      const lines = text.split('\n')
      let path = null
      /* The `--- `/`+++ ` file headers only exist above the first hunk; after
         it, such a line is a removed/added body line (`-- comment` renders as
         `--- comment`) and must be replayed, not dropped. */
      let inBody = false
      const oldText = []
      const newText = []
      for (const line of lines) {
        if (inBody === false && line.indexOf('+++ ') === 0) {
          const name = line.slice(4).split('\t')[0]
          if (name !== '/dev/null') path = name.replace(/^b\//, '')
          continue
        }
        if (inBody === false && line.indexOf('--- ') === 0) {
          if (path === null) {
            const name = line.slice(4).split('\t')[0]
            if (name !== '/dev/null') path = name.replace(/^a\//, '')
          }
          continue
        }
        if (line.indexOf('@@') === 0) { inBody = true; continue }
        if (line.indexOf('+') === 0) { newText.push(line.slice(1)); continue }
        if (line.indexOf('-') === 0) { oldText.push(line.slice(1)); continue }
        if (line.indexOf('\\') === 0) continue
        if (line.indexOf(' ') === 0) { oldText.push(line.slice(1)); newText.push(line.slice(1)); continue }
        // diff --git / index / new file mode / rename from ...: metadata above
        // the first hunk; anything else after it would be malformed.
        continue
      }
      if (path === null || path === '') return null
      // A patch without body lines (mode-only, bare metadata) replays into an
      // empty hunk that DiffBlock draws as nothing at all — keep the hand-drawn
      // rows for those, they at least show what happened.
      if (oldText.length === 0 && newText.length === 0) return null
      return { path: path, oldText: oldText.length === 0 ? null : oldText.join('\n'), newText: newText.join('\n') }
    }

    /* ============================== diff ============================== */

    function diffLines(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text.trim() === '') return []
      const raw = text.split('\n')
      const out = []
      let oldLine = 0
      let newLine = 0
      for (const line of raw) {
        let kind = 'ctx'
        if (line.indexOf('diff --git') === 0 || line.indexOf('index ') === 0 || line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0 || line.indexOf('new file') === 0 || line.indexOf('deleted file') === 0 || line.indexOf('similarity index') === 0 || line.indexOf('rename ') === 0) {
          kind = 'meta'
        } else if (line.indexOf('@@') === 0) {
          kind = 'hunk'
          const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
          // The @@ header names the FIRST content line (git semantics), but the
          // counters below are PRE-INCREMENTED before they land in a row — so
          // seed one less. Off by one otherwise: v0.13.3's hand-drawn gutter
          // numbered every line one too high (surfaced by the selection core).
          if (match !== null) { oldLine = Number.parseInt(match[1], 10) - 1; newLine = Number.parseInt(match[2], 10) - 1 }
        } else if (line.indexOf('+') === 0) { kind = 'add'; newLine += 1 }
        else if (line.indexOf('-') === 0) { kind = 'del'; oldLine += 1 }
        else if (line.indexOf('\\') === 0) { kind = 'meta' }
        else { oldLine += 1; newLine += 1 }
        out.push({
          kind, text: line,
          oldLine: kind === 'add' || kind === 'meta' || kind === 'hunk' ? null : oldLine,
          newLine: kind === 'del' || kind === 'meta' || kind === 'hunk' ? null : newLine,
        })
      }
      return out
    }

    /* ---- diff selection core
       Pure line-number plumbing for the diff-pane context menu (v0.13.5).
       The host DiffBlock draws rows WITHOUT line-number attributes — a row is
       `<div class={line + kindClass}>{row.text}</div>` (DiffBlock.tsx:204) and
       the `+`/`-`/two-space prefixes live in CSS `::before` content — so the
       menu reconstructs numbers by replaying the ROW KINDS in document order
       from the patch's first hunk header. The hand-drawn rows already carry
       parsed numbers (diffLines above). Kept DOM-free between the markers so
       tests/smoke.mjs can slice the block and drive the real implementation. */

    const DIFF_SNIPPET_MAX = 600

    /* First hunk header of a single-file patch → the absolute numbers the
       replay starts from (`@@ -a,b +c,d @@`: a/c are the sides' first lines).
       A patch without any header (binary, mode-only) has no coordinates. */
    function hunkStartOf(patch) {
      const headers = hunkHeadersOf(patch)
      return headers === null ? null : headers[0]
    }

    /* Every hunk header in patch order: a multi-hunk diff restarts BOTH
       counters at each `@@` line, so the replay needs one seed per hunk. */
    function hunkHeadersOf(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text.indexOf('@@') < 0) return null
      const headers = []
      const pattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm
      let match = pattern.exec(text)
      while (match !== null) {
        headers.push({ oldLine: Number.parseInt(match[1], 10), newLine: Number.parseInt(match[2], 10) })
        match = pattern.exec(text)
      }
      return headers.length === 0 ? null : headers
    }

    /* getComputedStyle(el, '::before').content → the row kind DiffBlock
       paints: `- ` del, `+ ` add, two spaces context, nothing for path/gap
       chrome. Browsers quote the value ("+ "); strip quotes before comparing. */
    function beforeContentKind(content) {
      if (typeof content !== 'string') return null
      const value = content.length >= 2 && content.charAt(0) === '"' && content.charAt(content.length - 1) === '"'
        ? content.slice(1, -1)
        : content
      if (value === '- ') return 'del'
      if (value === '+ ') return 'add'
      if (value === '  ') return 'ctx'
      return null
    }

    /* Replay kinds[0..to] (document order), collecting the span covered by
       kinds[from..to]. Each hunk restarts BOTH counters from its own header:
       a chrome row (path/gap, kind null) marks the boundary, and the next
       content row consumes the NEXT header in patch order — the path row at
       the top then the gap rows between hunks. New-side numbers win; a purely
       deleted span reports the OLD numbers with old: true — deleted rows
       exist on that side only. */
    function lineSpanFromKinds(kinds, from, to, headers) {
      if (Array.isArray(kinds) === false || Array.isArray(headers) === false || headers.length === 0) return null
      if (!(from >= 0 && to >= from && to < kinds.length)) return null
      let headerIndex = 0
      let oldLine = 0
      let newLine = 0
      let started = false
      let newFrom = null
      let newTo = null
      let oldFrom = null
      let oldTo = null
      for (let index = 0; index <= to; index += 1) {
        const kind = kinds[index]
        if (kind !== 'del' && kind !== 'add' && kind !== 'ctx') {
          started = false // chrome row: the next content row starts a new hunk
          continue
        }
        if (started === false) {
          if (headerIndex >= headers.length) break // more hunks than headers: stop, don't guess
          const header = headers[headerIndex]
          headerIndex += 1
          oldLine = header.oldLine
          newLine = header.newLine
          started = true
        }
        let oldHit = null
        let newHit = null
        if (kind === 'del') { oldHit = oldLine; oldLine += 1 }
        else if (kind === 'add') { newHit = newLine; newLine += 1 }
        else { oldHit = oldLine; newHit = newLine; oldLine += 1; newLine += 1 }
        if (index >= from) {
          if (oldHit !== null) { oldFrom = oldFrom === null ? oldHit : oldFrom; oldTo = oldHit }
          if (newHit !== null) { newFrom = newFrom === null ? newHit : newFrom; newTo = newHit }
        }
      }
      if (newFrom !== null) return { start: newFrom, end: newTo === null ? newFrom : newTo, old: false }
      if (oldFrom !== null) return { start: oldFrom, end: oldTo === null ? oldFrom : oldTo, old: true }
      return null
    }

    /* The hand-drawn rows already carry parsed numbers: reduce the selected
       row range exactly like lineSpanFromKinds reduces replayed kinds. */
    function rowSpanOfRows(rows, from, to) {
      if (Array.isArray(rows) === false) return null
      if (!(from >= 0 && to >= from && to < rows.length)) return null
      let newFrom = null
      let newTo = null
      let oldFrom = null
      let oldTo = null
      for (let index = from; index <= to; index += 1) {
        const row = rows[index]
        if (row === undefined || row === null) continue
        const newHit = typeof row.newLine === 'number' ? row.newLine : null
        const oldHit = typeof row.oldLine === 'number' ? row.oldLine : null
        if (newHit !== null) { newFrom = newFrom === null ? newHit : newFrom; newTo = newHit }
        if (oldHit !== null) { oldFrom = oldFrom === null ? oldHit : oldFrom; oldTo = oldHit }
      }
      if (newFrom !== null) return { start: newFrom, end: newTo === null ? newFrom : newTo, old: false }
      if (oldFrom !== null) return { start: oldFrom, end: oldTo === null ? oldFrom : oldTo, old: true }
      return null
    }

    /* '7' or '7–9' — the {lines} value the payload templates receive. */
    function linesLabelOf(start, end) {
      return start === end ? String(start) : String(start) + '–' + String(end)
    }

    /* The localized line-span fragment the payload templates embed: new-side
       numbers read plain, old-side numbers say so instead of pretending. */
    function lineSpanLabelOf(t, span) {
      const lines = linesLabelOf(span.start, span.end)
      return fill(t(span.old === true ? 'send.diffOldLines' : 'send.diffNewLines'), { lines: lines })
    }

    /* The self-describing line reference text for one resolved span.
       Commit context carries hash + subject (truncated like the commit send)
       and the HEAD branch; the worktree pane says staged or uncommitted. */
    function diffSpanTextOf(t, context, span, branchName) {
      const lines = lineSpanLabelOf(t, span)
      if (context === null || context === undefined || context.kind !== 'commit') {
        return fill(t('send.diffLinesWorktree'), {
          lines: lines,
          state: t(context !== null && context !== undefined && context.staged === true ? 'send.diffStaged' : 'send.diffUnstaged'),
        })
      }
      const subject = typeof context.subject === 'string' ? context.subject.trim().slice(0, 60) : ''
      return fill(t('send.diffLinesCommit'), {
        lines: lines,
        hash: typeof context.hash === 'string' && context.hash !== '' ? context.hash.slice(0, 7) : '—',
        subject: subject === '' ? '—' : subject,
        branch: typeof branchName === 'string' && branchName !== '' ? branchName : '—',
      })
    }

    /* ---- end diff selection core */

    /* ---------- DOM side of the diff-pane context menu (browser only) ----------
       SSR never calls these: they run inside the pane's onContextMenu, after
       the selection has been captured. The row element under a selection
       endpoint is either a hand-drawn `.git4idea-diff-line`, or a DiffBlock row —
       a div child of the body whose OWN parent carries the `data-diff`
       marker. `data-diff` is a component attribute (DiffBlock.tsx:199), not a
       hashed CSS-module class, so the lookup does not bet on build-time class
       renaming; the row KIND comes from the `::before` content the kinds are
       painted with, for the same reason. */

    function savedSelectionOf() {
      try {
        const selection = window.getSelection()
        if (selection === null || selection.rangeCount === 0) return null
        const text = String(selection)
        if (text === '') return null
        return { text: text, range: selection.getRangeAt(0).cloneRange() }
      } catch (error) { void error; return null }
    }

    function selectionRowOf(node) {
      let element = node === null || node === undefined ? null
        : node.nodeType === 3 ? (node.parentElement === null ? null : node.parentElement)
        : node.nodeType === 1 ? node
        : null
      for (let hop = 0; element !== null && element !== undefined && hop < 8; hop += 1) {
        if (element.classList !== undefined && element.classList.contains('git4idea-diff-line') === true) {
          return { kind: 'drawn', row: element, body: element.parentElement }
        }
        const parent = element.parentElement
        if (parent !== null && parent.getAttribute !== undefined && parent.hasAttribute('data-diff') === false) {
          const root = parent.parentElement
          if (root !== null && root.getAttribute !== undefined && root.hasAttribute('data-diff') === true) {
            return { kind: 'host', row: element, body: parent }
          }
        }
        element = parent
      }
      return null
    }

    /* The rendered rows of a DiffBlock body, with the kind each one paints.
       The (never-rendered at this panel's maxLines) fold toggle is a button,
       not a div — skipped so it cannot shift the row indexes. */
    function hostRowKinds(body) {
      const children = body === null || body === undefined ? [] : body.children
      const rows = []
      const kinds = []
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (child === null || child === undefined || child.tagName === 'BUTTON') continue
        rows.push(child)
        let kind = null
        try { kind = beforeContentKind(window.getComputedStyle(child, '::before').content) } catch (error) { void error; kind = null }
        kinds.push(kind)
      }
      return { rows: rows, kinds: kinds }
    }

    /* { kind: 'lines', span } for a selection inside ONE diff body, or
       { kind: 'snippet' } when the rows are there but the numbers cannot be
       reconstructed. null (rows missing entirely) means "not a diff
       selection": the menu keeps its old behaviour. */
    function resolveDiffSelection(patch, saved) {
      if (saved === null || saved === undefined || saved.text === '' || saved.range === null || saved.range === undefined) return null
      const from = selectionRowOf(saved.range.startContainer)
      const to = selectionRowOf(saved.range.endContainer)
      if (from === null || to === null) return null
      if (from.kind !== to.kind || from.body !== to.body) return { kind: 'snippet', text: saved.text }
      let span = null
      if (from.kind === 'drawn') {
        const rows = diffLines(patch)
        const all = from.body === null || from.body === undefined ? [] : Array.prototype.slice.call(from.body.querySelectorAll('.git4idea-diff-line'))
        const fromIndex = all.indexOf(from.row)
        const toIndex = all.indexOf(to.row)
        if (fromIndex >= 0 && toIndex >= 0) span = rowSpanOfRows(rows, Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex))
      } else {
        const headers = hunkHeadersOf(patch)
        if (headers !== null) {
          const collected = hostRowKinds(from.body)
          const fromIndex = collected.rows.indexOf(from.row)
          const toIndex = collected.rows.indexOf(to.row)
          if (fromIndex >= 0 && toIndex >= 0) {
            span = lineSpanFromKinds(collected.kinds, Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex), headers)
          }
        }
      }
      if (span === null) return { kind: 'snippet', text: saved.text }
      return { kind: 'lines', span: span, text: saved.text }
    }


    /* DiffBlock's own 16-line cap would REPLACE scrolling with a fold button;
       this panel keeps the old contract (render everything, scroll inside the
       .git4idea-diff-pane max-height), so the cap is pushed out of reach and the
       fold labels below are placeholders that never render at this size. */
    const DIFF_BLOCK_MAX_LINES = 1000000

    function diffLabelsOf(t) {
      return {
        codeLabel: t('diff.codeLabel'),
        wrapLabel: t('diff.wrapLabel'),
        unwrapLabel: t('diff.unwrapLabel'),
        copy: t('diff.copy'),
        copied: t('diff.copied'),
        collapseAria: 'Collapse diff',
        expandAria: (hidden) => 'Show ' + String(hidden) + ' more diff lines',
        collapse: 'Show less',
        expand: (hidden) => 'Show ' + String(hidden) + ' more',
      }
    }

    function DiffBody(props) {
      const rows = useMemo(() => diffLines(props.patch), [props.patch])
      if (props.loading === true) return E('div', { className: 'git4idea-empty' }, props.t('diff.loading'))
      if (props.binary === true) return E('div', { className: 'git4idea-empty' }, props.t('diff.binary'))
      if (rows.length === 0) return E('div', { className: 'git4idea-empty' }, props.t('diff.empty'))
      /* Host-rendered first (v0.14): the ui-primitives diff card brings the
         shared toolbar (copy / wrap / language) and the product's diff colors.
         A patch we cannot replay into a hunk (binary, mode-only) or a host
         without the seed module falls back to the hand-drawn rows below. This
         IS the official diff renderer (the platform seed table ships it, the
         host's own surfaces render diffs through it) — the external preview
         tab uses the same one, so every diff in the product reads alike. */
      if (UIPrimitives !== null && typeof UIPrimitives.DiffBlock === 'function') {
        const hunk = patchToHunk(props.patch)
        if (hunk !== null) {
          return E('div', { className: 'git4idea-diff-host' },
            E(UIPrimitives.DiffBlock, {
              diffs: [hunk],
              labels: diffLabelsOf(props.t),
              maxLines: DIFF_BLOCK_MAX_LINES,
              className: 'git4idea-diff-card',
            }))
        }
      }
      return E('div', { className: 'git4idea-diff' }, rows.map((row, index) => E('div', { key: index, className: 'git4idea-diff-line git4idea-diff-' + row.kind },
        E('span', { className: 'git4idea-diff-gutter' }, row.oldLine === null ? '' : String(row.oldLine)),
        E('span', { className: 'git4idea-diff-gutter' }, row.newLine === null ? '' : String(row.newLine)),
        E('span', { className: 'git4idea-diff-text' }, row.text === '' ? ' ' : row.text),
      )))
    }

    /* ---- external preview diff (v0.14.3): a faithful port of the review view ----
       ReviewTab + FileDiff (ui-deliverables) are the reference; every building
       block that package imports from the platform seed is reused here
       verbatim: Menu / PathLabel / Tooltip / the split, wrap, inspect and
       chevron icons, useCodeHighlighter, languageForPath, and the file-diff
       alias tokens. Only the layer the official bundle boundary hides — the
       row layout, the hunk parser, the review-store-free state — lives in
       this file, and it follows the source file by file: header anatomy and
       CSS from ReviewTab.tsx + ReviewTab.module.css, rows/hunks/highlights
       from FileDiff.tsx + FileDiff.module.css. When ui-deliverables
       re-exports FileDiff (see the host-follow note in AGENTS.md), this whole
       block retires in favor of a plain import of the deliverables
       package's re-exported FileDiff. */

    /* One hunk in the shape FileDiff consumes: {oldStart, oldLines, newStart,
       newLines, lines[]} where lines keep their +/-/space prefix. oldLines and
       newLines are COUNTED from content (git omits the count when it is 1),
       exactly what the reconstructed @@ header needs. */
    function parseHunks(body) {
      const text = typeof body === 'string' ? body : ''
      const out = []
      let current = null
      for (const line of text.split('\n')) {
        if (line.indexOf('@@') === 0) {
          const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
          if (match !== null) {
            if (current !== null && current.lines.length > 0) out.push(current)
            current = { oldStart: Number.parseInt(match[1], 10), newStart: Number.parseInt(match[3], 10), oldLines: 0, newLines: 0, lines: [] }
            continue
          }
        }
        if (current === null) continue
        const marker = line.charAt(0)
        if (marker === '+' || marker === '-' || marker === ' ' || line === '') {
          current.lines.push(line)
          if (marker === '+') current.newLines += 1
          else if (marker === '-') current.oldLines += 1
          else { current.oldLines += 1; current.newLines += 1 }
        } else if (line.indexOf('\\') === 0) {
          current.lines.push(line)
        }
      }
      if (current !== null && current.lines.length > 0) out.push(current)
      /* The patch's trailing newline parses as one empty context line; the
         review drops it, and so does this. */
      for (const hunk of out) {
        const last = hunk.lines[hunk.lines.length - 1]
        if (last === '' && hunk.lines.length > 1) {
          hunk.lines.pop()
          hunk.oldLines -= 1
          hunk.newLines -= 1
        }
      }
      return out
    }

    /* One file segment of a (possibly multi-file) patch: path, hunks, ±
       counts, and the file-level facts FileDiff's notes need. */
    function splitPatchFiles(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text.trim() === '') return []
      const segments = []
      let current = null
      for (const line of text.split('\n')) {
        if (line.indexOf('diff --git ') === 0) {
          if (current !== null) segments.push(current)
          current = { path: '', meta: [], body: [], binary: false, created: false, removed: false }
          continue
        }
        if (current === null) continue
        if (line.indexOf('+++ ') === 0) current.path = line.slice(4) === '/dev/null' ? current.path : line.slice(4).replace(/^b\//, '')
        else if (current.path === '' && line.indexOf('--- a/') === 0) current.path = line.slice(6)
        if (line.indexOf('Binary files') === 0 || line.indexOf('Binary file') === 0) current.binary = true
        if (line.indexOf('new file mode') === 0) current.created = true
        if (line.indexOf('deleted file mode') === 0) current.removed = true
        if (line.indexOf('diff --git ') === 0 || line.indexOf('index ') === 0 || line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0 || line.indexOf('new file') === 0 || line.indexOf('deleted file') === 0 || line.indexOf('similarity index') === 0 || line.indexOf('rename ') === 0 || line.indexOf('old mode') === 0 || line.indexOf('new mode') === 0) current.meta.push(line)
        else current.body.push(line)
      }
      if (current !== null) segments.push(current)
      const out = []
      for (const segment of segments) {
        const hunks = parseHunks(segment.body.join('\n'))
        let adds = 0
        let dels = 0
        for (const hunk of hunks) {
          for (const line of hunk.lines) {
            if (line.indexOf('+') === 0) adds += 1
            else if (line.indexOf('-') === 0) dels += 1
          }
        }
        if (segment.path === '' && hunks.length === 0 && segment.binary === false) continue
        out.push({ path: segment.path, binary: segment.binary, created: segment.created, removed: segment.removed, hunks: hunks, adds: adds, dels: dels })
      }
      return out
    }

    /* ---- pure ports of FileDiff.tsx's exported row functions ---- */

    /* Number a hunk's lines: context lines count on both sides, deletions on
       the old side, additions on the new side. */
    function hunkRows(hunk) {
      let oldNo = hunk.oldStart
      let newNo = hunk.newStart
      return hunk.lines.map((line) => {
        const body = line.slice(1)
        if (line.indexOf('+') === 0) return { kind: 'add', old: undefined, new: newNo++, text: body }
        if (line.indexOf('-') === 0) return { kind: 'del', old: oldNo++, new: undefined, text: body }
        return { kind: 'context', old: oldNo++, new: newNo++, text: body }
      })
    }

    /* Pair a hunk's lines for the side-by-side view: each run of deletions is
       aligned with the run of additions that follows it, row by row, and
       context lines sit on both sides. */
    function splitRows(hunk) {
      const rows = []
      let dels = []
      let adds = []
      const flush = () => {
        for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
          const left = dels[at]
          const right = adds[at]
          rows.push(Object.assign(left === undefined ? {} : { left: left }, right === undefined ? {} : { right: right }))
        }
        dels = []
        adds = []
      }
      for (const row of hunkRows(hunk)) {
        if (row.kind === 'del') dels.push({ no: row.old, text: row.text, kind: 'del' })
        else if (row.kind === 'add') adds.push({ no: row.new, text: row.text, kind: 'add' })
        else {
          flush()
          rows.push({ left: { no: row.old, text: row.text, kind: 'context' }, right: { no: row.new, text: row.text, kind: 'context' } })
        }
      }
      flush()
      return rows
    }

