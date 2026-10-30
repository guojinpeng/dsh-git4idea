    /* ============================== panel ============================== */

    function Panel(props) {
      const scope = props.scope
      const t = props.t
      const hostRef = useRef(null)
      const railHostRef = useRef(null)
      const [size, setSize] = useState({ width: 0, height: 0 })
      const [repoState, setRepoState] = useState(null)
      const [repoRoot, setRepoRoot] = useState(null)
      const [summary, setSummary] = useState(null)
      // Ignored files are opt-in: --ignored walks the ignore rules, and nobody
      // needs node_modules listed while they are writing a commit message.
      const [showIgnored, setShowIgnored] = useState(false)
      const [branches, setBranches] = useState(null)
      const [commits, setCommits] = useState([])
      const [hasMore, setHasMore] = useState(false)
      /* m02407 #3: the result strip above the body is gone. Failures and the
         outcome of a background git command become notifications in the
         bottom-right stack instead. The sink is a ref because the callbacks that
         report (the guard, the loaders) are declared above the toast plumbing. */
      const notifySink = useRef(null)
      const setError = useCallback((text) => {
        if (text === undefined || text === null || String(text) === '') return
        if (notifySink.current !== null) notifySink.current(String(text), 'error')
      }, [])
      const setNote = useCallback((text) => {
        if (text === undefined || text === null || String(text) === '') return
        if (notifySink.current !== null) notifySink.current(String(text), 'info')
      }, [])
      const [busy, setBusy] = useState(false)
      const [view, setView] = useState('history')
      /* Pane sizes are remembered per surface (see the pane sizing core). The ref
         is the value the pointer handlers write through: a drag updates state for
         the preview and the ref for the single write that pointerup performs. */
      const [panes, setPanes] = useState(readPanes)
      const panesRef = useRef(panes)
      const [treeOpen, setTreeOpen] = useState(panes.treeOpen)
      const [paneDragging, setPaneDragging] = useState(null)
      const [paneSizes, setPaneSizes] = useState({})
      /* The float pane this panel is drawn in, or null while it is docked. The
         dock face exposes operations only, so the state comes from the float
         layer's own marker around this panel — the same marker carries the pane
         id dock() needs to put it back. */
      const [floatPaneId, setFloatPaneId] = useState(null)
      const bodyRef = useRef(null)
      const [bodyBox, setBodyBox] = useState({ width: 0, height: 0 })
      const [detail, setDetail] = useState(null)
      const [selectedHash, setSelectedHash] = useState(null)
      const [selectedPath, setSelectedPath] = useState(null)
      const [patch, setPatch] = useState('')
      const [patchLoading, setPatchLoading] = useState(false)
      /* What the open diff pane shows (v0.13.5): the pane is shared by the
         commit detail (hash + subject) and the working tree (staged or not),
         and the selection menu's payload must say which. Cleared everywhere
         the patch is cleared. */
      const [diffContext, setDiffContext] = useState(null)
      /* ---- multi-select (issue #13): the change list's selection lives here
         so the right-click menu, the keyboard and the selection bar act on one
         set; the branch tree and the history keep theirs closer to their rows
         (BranchTree-internal / pickedCommits below). ---- */
      const [changeSelection, setChangeSelection] = useState(() => new Set())
      const changeAnchor = useRef(null)
      const [pickedCommits, setPickedCommits] = useState(() => new Set())
      /* The branch tree reports its picks up (onPicksChange) so the rail can act
         on the selection: "select main, press pull" must pull main, not HEAD. */
      const [branchPicks, setBranchPicks] = useState(() => new Set())
      /* v0.19.4: the three lists' selections are mutually exclusive — a pick in
         one list (row click or rubber band) clears the other two, and a blank
         click inside a list clears everything too. Each interaction bumps the
         OTHER lists' epoch counters; the effects below (and a clearSignal prop
         into BranchTree, whose picks live inside it) reset on change. Epochs
         are monotonic and start at 0, so the mount pass clears nothing. */
      const [pickEpochs, setPickEpochs] = useState(() => ({ changes: 0, history: 0, tree: 0 }))
      const clearPicksExcept = useCallback((owner) => {
        setPickEpochs((previous) => ({
          changes: owner === 'changes' ? previous.changes : previous.changes + 1,
          history: owner === 'history' ? previous.history : previous.history + 1,
          tree: owner === 'tree' ? previous.tree : previous.tree + 1,
        }))
      }, [])
      useEffect(() => { if (pickEpochs.changes > 0) setChangeSelection(new Set()) }, [pickEpochs.changes])
      useEffect(() => { if (pickEpochs.history > 0) setPickedCommits(new Set()) }, [pickEpochs.history])
      /* Forwarders: the raw setters wrapped so EVERY selection gesture reports
         an owner. The updates arrive either as a Set or as a functional
         updater (the memoised rows hold stale closures) — forwarded as-is. */
      const onBranchPicks = useCallback((update) => { setBranchPicks(update); clearPicksExcept('tree') }, [clearPicksExcept])
      const onChangeSelection = useCallback((update) => { setChangeSelection(update); clearPicksExcept('changes') }, [clearPicksExcept])
      const onCommitPicks = useCallback((update) => { setPickedCommits(update); clearPicksExcept('history') }, [clearPicksExcept])
      const [menu, setMenu] = useState(null)
      const [dialog, setDialog] = useState(null)
      const [tick, setTick] = useState(0)
      const [favTick, setFavTick] = useState(0)
      const [pathFilter, setPathFilter] = useState('')
      const [railConfig] = useState(readRailConfig)
      const [railBox, setRailBox] = useState({ width: 0, height: 0 })

      /* ---------- toast plumbing ---------- */
      /* Declared early on purpose: the guard, the loaders and every menu builder
         close over pushToast, and a hooks dependency array is evaluated during
         render (invariant 12) — the plumbing has to exist before them, and the
         sink effect has to run before the first load reports a failure. The
         queue itself is the frame-wide store (m02986), so the same five-second
         rule covers notifications raised by the overlay dialogs too. */
      const dropToast = useCallback((id) => { toastCenter.drop(id) }, [])

      const pushToast = useCallback((toast) => toastCenter.push(toast), [])

      /* The guard and the loaders report through setError/setNote; both feed
         this sink so every failure and every background result lands in the
         bottom-right stack instead of a strip above the panes. */
      useEffect(() => {
        notifySink.current = (text, tone) => {
          pushToast({ text: text, tone: tone, icon: tone === 'error' ? 'close' : 'check' })
        }
        return () => { notifySink.current = null }
      }, [pushToast])
      const cwd = typeof scope.cwd === 'string' && scope.cwd !== '' ? scope.cwd : undefined
      const sessionId = typeof scope.sessionId === 'string' ? scope.sessionId : 'default'
      const base = useMemo(() => ({ cwd: cwd, repoRoot: repoRoot === null ? undefined : repoRoot }), [cwd, repoRoot])

      /* Layout effect ON PURPOSE: the chrome (compact/columns/stack) and the
         rail capacity derive from these numbers, and a paint-then-correct
         cycle showed up on every seat switch as buttons lighting up one by
         one (v0.13.1 report). Measuring in the commit phase keeps the first
         paint on the final chrome. */
      useMeasureLayoutEffect(() => {
        const element = hostRef.current
        if (element === null) return undefined
        const measure = () => {
          const rect = element.getBoundingClientRect()
          setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [])

      // Width decides: a wide container is a three-column workbench even when it is
      // short (the bottom panel is 1500x300 and still wants tree | graph | changes).
      // Only a genuinely tiny container (very narrow or very short) falls back to
      // the compact one-header chrome.
      // Width alone decides WHICH SURFACE this is: the native right sidebar is
      // narrow (< 400) whatever its height, the bottom workbench is wide
      // whatever its height. Height must never select the tall-narrow chrome on
      // its own — v0.1.3 already made that mistake with a height < 330 test (a
      // 1500x300 workbench came out single-column) and v0.3.5 still let
      // height < 200 flip a 1320x180 workbench into the right-sidebar chrome.
      /* The immersive conversation seat (v0.14) hands the panel a SQUARE-ish
         box by construction: the conversation column clamps content width
         (~920px) while the seat fills the view's whole height, so the
         bottom-workbench-vs-sidebar ratio (`width >= height * 1.15`) can never
         hold there and the panel would flip to the stacked layout. The seat is
         a tool window — neither a horizontal dock nor a narrow rail — so it
         always takes the columns chrome (compact still wins: a truly narrow
         viewport keeps the single-row layout). */
      const [immersiveSeat, setImmersiveSeat] = useState(false)
      useMeasureLayoutEffect(() => {
        const node = hostRef.current
        const holder = node === null || typeof node.closest !== 'function' ? null : node.closest('.git4idea-conversation-seat[data-immersive="1"]')
        if (gateNestedLoop() === false) return
        setImmersiveSeat(holder !== null)
      })
      const compact = size.width > 0 && size.width < COMPACT_MAX_WIDTH
      const columns = (immersiveSeat === true && compact === false)
        || (!compact && size.width >= 600 && size.width >= size.height * 1.15)

      /* ---------- draggable panes (issue #5) ---------- */

      // Like the rail, the panes measure the box that actually holds them instead
      // of trusting the root probe: the column chrome keeps a vertical rail
      // beside the body, and the header sits above it.
      useMeasureLayoutEffect(() => {
        const element = bodyRef.current
        if (element === null) { setBodyBox({ width: 0, height: 0 }); return undefined }
        const measure = () => {
          const rect = element.getBoundingClientRect()
          setBodyBox({ width: Math.round(rect.width), height: Math.round(rect.height) })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [])

      const chrome = compact ? 'compact' : columns ? 'columns' : 'stack'
      const measured = bodyBox.width > 0 || bodyBox.height > 0
      const paneBox = measured ? bodyBox : size
      /* The column chrome's dividers are vertical LINES, and the panes they move
         are sized by width; the stacked chromes move heights. One name for that
         switch: it decides the divider's orientation, the inline size, the ratio
         reference and the drag cursor, and getting it half-right is how a height
         drag ends up writing a width. */
      const paneByWidth = PANE_HEIGHT_CHROME[chrome] !== true
      /* What the panes actually measure right now. The clamp needs the real box of
         the pane it is NOT moving: a content-sized pane is usually shorter than
         its own percentage cap, and reserving the cap would block the drag (or
         snap a stored size back on the next render). The markers are data
         attributes rather than class sniffing so the diff pane, nested inside the
         middle pane, is found the same way. */
      const measurePanes = () => {
        const found = {}
        const element = bodyRef.current
        if (element === null) return found
        for (const node of element.querySelectorAll('[data-pane]')) {
          const rect = node.getBoundingClientRect()
          // The diff pane is measured in HEIGHT under every chrome — it is
          // carved out of the middle pane, whose siblings may run sideways.
          const key = node.getAttribute('data-pane')
          found[key] = Math.round(key === 'diff' || paneByWidth === false ? rect.height : rect.width)
        }
        return found
      }
      /* Kept in state, not in a ref: a pane's box changes without the panel
         re-rendering (content arrives, a dock resizes), and the render that
         re-clamps a stored size has to see the same numbers the drag did — a drag
         allowed further than the render allows snaps back under the cursor. The
         bail-out comparison is what keeps this from looping. */
      /* A LAYOUT effect: on mount this runs before the first paint, so the
         fallback layout (paneGeometry's stylesheet/literal defaults) is
         replaced by the live one inside the same frame instead of being
         painted and then jumped a frame later. Painting both is the "height
         animation" on tab switches from issue #16 — two visible layouts ~80px
         apart read as a smooth resize in a low-fps screen recording. Later
         runs still track content arrival; the layout-phase cost is one
         querySelectorAll over the 3-4 panes the post-paint run already paid. */
      /* ---------- measurement loop fuse (issue #17) ---------- */

      /* Every effect below runs on EVERY render and feeds a state update.
         In a steady UI the bail-out comparisons stop the chain, but when the
         realized layout disagrees with the just-measured one — a float pane
         being created/resized on the desktop client hit exactly this — each
         render re-measures a DIFFERENT box, the update nests synchronously
         and React aborts at depth 50 with #185, leaving the pane white
         behind the host's slot boundary. The gate detects that nesting
         directly: runs are counted in a 40 ms window and a nested render
         loop (50 commits inside one task) trips it long before React's
         limit, while legitimate per-event work (a pointermove drag renders
         at most twice in 40 ms) never comes close. Skipping a measurement
         during a pathological burst only freezes the affected number until
         the next window — degraded ratios for a frame, never a white pane. */
      const measureGate = useRef({ n: 0, at: 0 })
      const gateNestedLoop = () => {
        const slot = measureGate.current
        const now = Date.now()
        if (now - slot.at > 40) { slot.at = now; slot.n = 0 }
        slot.n += 1
        return slot.n <= 6
      }

      useMeasureLayoutEffect(() => {
        const found = measurePanes()
        if (gateNestedLoop() === false) return
        setPaneSizes((current) => (samePaneSizes(current, found) ? current : found))
      })
      useEffect(() => {
        const node = hostRef.current
        const holder = node === null || typeof node.closest !== 'function' ? null : node.closest('[data-dockkit-float]')
        const next = holder === null ? null : holder.getAttribute('data-dockkit-float')
        if (gateNestedLoop() === false) return
        setFloatPaneId((current) => (current === next ? current : next))
      })
      const dock = props.dock === undefined ? null : props.dock
      const dockState = dockActionState(dock, floatPaneId)
      const paneLayout = paneGeometry(chrome, paneBox, panes, paneSizes)

      const commitPanes = (next) => {
        panesRef.current = next
        setPanes(next)
      }

      /* The gutter hands back the px it wants; the clamp lives here, and what
         gets stored is the ratio that reproduces it on this container. The live
         measurement is pushed into state alongside the new ratio, so the render
         that follows this gesture clamps with the very same box. */
      const dragPane = (key, rawPx) => {
        const live = measurePanes()
        setPaneSizes((current) => (samePaneSizes(current, live) ? current : live))
        const layout = paneGeometry(chrome, paneBox, panesRef.current, live)
        const limit = layout.limits[key]
        // The diff divides the body HEIGHT in every chrome (see paneGeometry).
        const reference = key === 'diff' ? paneBox.height : (paneByWidth ? paneBox.width : paneBox.height)
        if (limit === undefined || !(reference > 0)) return
        const px = Math.round(Math.min(Math.max(rawPx, limit.min), limit.max))
        commitPanes(withPaneRatio(panesRef.current, layout.bucket, key, px / reference))
      }

      /* One write per gesture (pointerup / keyboard nudge / double-click), not one
         per pointermove. */
      const endPaneDrag = () => {
        setPaneDragging(null)
        writePanes(panesRef.current)
      }

      const resetPane = (key) => {
        commitPanes(withPaneRatio(panesRef.current, paneLayout.bucket, key, null))
        writePanes(panesRef.current)
      }

      const foldTree = (open) => {
        setTreeOpen(open)
        commitPanes({ treeOpen: open, panes: panesRef.current.panes })
        writePanes(panesRef.current)
      }

      /* Only a pane the user actually dragged gets an inline size; everything
         else keeps the stylesheet default (200px tree, 290px changes, the
         percentage caps) — which is also what a double-click returns to. */
      const paneStyle = (key) => {
        const px = paneLayout.overrides[key]
        if (px === undefined) return null
        // The diff always takes its size as a height, in every chrome.
        const vertical = key === 'diff' ? true : paneByWidth === false
        return vertical ? { height: px + 'px', maxHeight: px + 'px' } : { width: px + 'px', maxWidth: px + 'px' }
      }

      /* A divider is a control, so it only exists when it can actually move
         something: no pane of that key in this chrome, or a window with no travel
         at all, means no element — and therefore no tab stop either (v0.8.0 shipped
         a 0x0 focusable separator in the columns chrome that way). */
      const gutter = (key, side) => {
        const limit = paneLayout.limits[key]
        if (limit === undefined || limit.max <= limit.min) return null
        return E(Gutter, {
        key: 'gutter-' + key,
        t: t,
        nameKey: PANE_NAME_KEYS[key],
        // The diff divider is a horizontal bar in every chrome: it moves a
        // window that lives BELOW it, even where tree/changes are dragged
        // sideways (columns).
        vertical: key === 'diff' ? false : paneByWidth,
        side: side,
        active: paneDragging === key,
        // Now is clamped into [min, max]: an aria window the panel contradicts is
        // worse than no window at all.
        value: Math.min(Math.max(Math.round(paneLayout.effective[key] === undefined ? 0 : paneLayout.effective[key]), limit.min), limit.max),
        min: limit.min,
        max: limit.max,
        onStart: () => setPaneDragging(key),
        onDrag: (px) => dragPane(key, px),
        onEnd: endPaneDrag,
        onReset: () => resetPane(key),
        })
      }

// The action rail measures ITSELF, not the panel: how many buttons fit is a
      // function of the strip that holds them (a 1200x300 workbench and a 300x900
      // sidebar disagree about that). railBox keeps the last measured span; until
      // the first measurement lands, every action is rendered.
      // Layout effect (see the host measure above): the button count derives
      // from this box, and a late measure reads as the rail lighting up late.
      useMeasureLayoutEffect(() => {
        const element = railHostRef.current
        if (element === null) { setRailBox({ width: 0, height: 0 }); return undefined }
        const measure = () => {
          const rect = element.getBoundingClientRect()
          setRailBox({ width: Math.round(rect.width), height: Math.round(rect.height) })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [repoRoot, columns, compact])

      const guard = useCallback(async (work) => {
        setBusy(true)
        setError(null)
        try {
          return await work()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
          return undefined
        } finally {
          setBusy(false)
        }
      }, [])

      const favorites = useMemo(() => (repoRoot === null ? [] : readFavorites(repoRoot)), [repoRoot, favTick])
      const toggleFavoriteBranch = useCallback((name) => {
        if (repoRoot === null || name === '') return
        toggleFavorite(repoRoot, name)
        setFavTick((value) => value + 1)
      }, [repoRoot])

      useEffect(() => {
        /* No workspace attached: there is nothing to scan, so land the empty
           result straight away instead of leaving repoState null (which reads
           as "still loading" and would spin forever). */
        if (cwd === undefined) { setRepoState({ repos: [], isRepo: false }); return undefined }
        let cancelled = false
        /* First-paint cache: a session switch through the same workspace
           reuses the previous discovery synchronously (repo bar and pick land
           with the first paint), then the background scan re-proves it. */
        const apply = (data, cachedPick) => {
          setRepoState(data)
          const paths = data.repos.map((repo) => repo.path)
          const remembered = readRememberedRepo(sessionId)
          let pick = null
          if (remembered !== undefined && paths.indexOf(remembered) >= 0) pick = remembered
          else if (cachedPick !== undefined && paths.indexOf(cachedPick) >= 0) pick = cachedPick
          else if (data.isRepo === true) pick = data.cwd
          else if (paths.length > 0) pick = paths[0]
          setRepoRoot(pick)
          rememberPaintRoot(cwd, pick)
          return pick
        }
        const cached = readPaintRepos(cwd)
        if (cached !== undefined) apply(cached, readPaintRoot(cwd))
        void (async () => {
          try {
            const data = await request('repos', { cwd: cwd })
            if (cancelled) return
            writePaintRepos(cwd, data)
            apply(data, readPaintRoot(cwd))
          } catch (caught) {
            if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
          }
        })()
        return () => { cancelled = true }
      }, [cwd, sessionId, tick])

      /* Changes view state, lifted out of ChangesPanel so the "..." menu (a
         rail action, invariant 14) can drive the same groupBy and the sort
         order it introduces — one source of truth, wherever the click came
         from. sortKey 'git' keeps git's own status order. */
      const [groupBy, setGroupBy] = useState('flat')
      const [sortKey, setSortKey] = useState('git')
      /* The console tab reads the host's console.log. It refreshes only after a
         git run (consoleTick), never on the summary poll — the file is the
         record, and a timer would re-read it while nothing new lands. */
      const [consoleTick, setConsoleTick] = useState(0)


      /* Phase-two merge (issue #11): fold the [path, additions, deletions,
         binary] rows from the `stats` method into a deferred summary. Pure and
         immutable — untouched rows keep their object reference so the memoised
         ChangeRow skips them, and a group with no numeric change keeps its
         array reference so React reconciles nothing. Declared before use
         (hooks dependency TDZ rule). */
      const applyStats = (data, statsPayload) => {
        if (data === null || typeof data !== 'object' || statsPayload === null || typeof statsPayload !== 'object') return data
        const build = (entries, rows) => {
          if (Array.isArray(entries) !== true || entries.length === 0 || Array.isArray(rows) !== true) return entries
          const map = new Map()
          for (const row of rows) {
            if (Array.isArray(row) === true && row.length >= 4 && typeof row[0] === 'string') {
              map.set(row[0], { additions: row[1] | 0, deletions: row[2] | 0, binary: row[3] === true })
            }
          }
          let touched = false
          const next = entries.map((entry) => {
            const stat = map.get(entry.path)
            if (stat === undefined) {
              if (entry.additions === 0 && entry.deletions === 0 && entry.binary !== true) return entry
              touched = true
              return Object.assign({}, entry, { additions: 0, deletions: 0, binary: false })
            }
            if (entry.additions === stat.additions && entry.deletions === stat.deletions && entry.binary === stat.binary) return entry
            touched = true
            return Object.assign({}, entry, stat)
          })
          return touched ? next : entries
        }
        const changes = data.changes
        const staged = build(changes.staged, statsPayload.staged)
        const unstaged = build(changes.unstaged, statsPayload.unstaged)
        if (staged === changes.staged && unstaged === changes.unstaged) return data
        return Object.assign({}, data, {
          statsDeferred: false,
          changes: Object.assign({}, changes, { staged: staged, unstaged: unstaged }),
        })
      }

      const loadSummary = useCallback(async () => {
        /* Two-phase (issue #11): the rows land first (`stats: false` skips the
           two numstat passes), then the +/- numbers merge in behind them. The
           panel is usable the moment the rows arrive; the numbers are exact
           when they arrive — nothing is approximated or dropped. */
        const data = await request('summary', Object.assign({}, base, { ignored: showIgnored, stats: false }))
        setSummary(data)
        if (data.statsDeferred === true) {
          const merged = applyStats(data, await request('stats', base))
          setSummary(merged)
          return merged
        }
        return data
      }, [base, showIgnored])

      const loadBranches = useCallback(async () => {
        const data = await request('branches', base)
        setBranches(data)
        return data
      }, [base])

      /* ---- branch browsing (v0.19.3, IDEA-style) ----
         Double-clicking a tree branch no longer checks it out: it walks THAT
         branch's log (browseRev = '' keeps the HEAD view). The LAST browsed
         branch is remembered, so 2-then-1 lands 1's list on the merge commit
         that carried 2 into 1 ('merge-point') — 1's newer commits stay one
         wheel-scroll away, nothing is truncated. */
      const [browseRev, setBrowseRev] = useState('')
      const [mergeAnchor, setMergeAnchor] = useState(null)
      const lastBrowseRef = useRef(null)
      const loadCommits = useCallback(async (skip, overridePath) => {
        const activePath = overridePath === undefined ? pathFilter : overridePath
        const payload = Object.assign({}, base, { skip: skip === undefined ? 0 : skip, limit: 120 })
        if (browseRev !== '') payload.rev = browseRev
        if (activePath !== undefined && activePath !== '') payload.path = activePath
        const data = await request('log', payload)
        setCommits((previous) => (skip === undefined || skip === 0 ? data.commits : previous.concat(data.commits)))
        setHasMore(data.hasMore)
        return data
      }, [base, pathFilter, browseRev])

      /* `fetchRemote` turns the refresh into what the rail button means: "see
         whether the remote has anything new to pull" — a `git fetch --prune`
         runs first so ahead/behind land with the fresh summary. Only the
         MANUAL refresh passes it: the network call is the slow part, so the
         automatic refreshes (12s poll, post-action, mount) stay off it, and a
         failed fetch degrades silently — a refresh must not turn into an
         error notification just because the network is down. While it runs the rail
         icon spins: fetching is allowed to take a moment, and the spin says
         the wait is real while blocking a second click. */
      /* Declared before refresh (hooks dep TDZ rule): the manual refresh
         fetches only when a remote exists. */
      const remoteReady = branches !== null && Array.isArray(branches.remotes) && branches.remotes.length > 0
      const [refreshSpinning, setRefreshSpinning] = useState(false)
      /* Fold state of the per-directory groups, lifted from ChangesPanel so the
         ⋯ menu's 展开全部/折叠全部 entries drive the same map the folder
         headers toggle. */
      const [foldedDirs, setFoldedDirs] = useState({})
      /* Last-seen "HEAD hash|branch" signature, from the poll summaries
         (v0.18.7). A ref, not state: a change triggers a data reload, not a
         render. null until the first poll tick records the baseline. */
      const headRef = useRef(null)
      const refresh = useCallback(async (opts) => {
        if (repoRoot === null) return
        const withFetch = opts !== null && typeof opts === 'object' && opts.fetchRemote === true && remoteReady === true
        if (withFetch === true) setRefreshSpinning(true)
        try {
          await guard(async () => {
            if (withFetch === true) {
              try { await request('fetch', Object.assign({}, base, { prune: true })) } catch (error) { notifyFail(error) }
            }
            const [summaryData, branchesData, page] = await Promise.all([loadSummary(), loadBranches(), loadCommits(0)])
            /* Keep the poll's HEAD signature in step (v0.18.7): after an
               in-panel commit/checkout the next tick must not re-pull
               branches + history all over again. */
            if (summaryData !== null && typeof summaryData === 'object' && typeof summaryData.head === 'string') {
              headRef.current = summaryData.head + '|' + (summaryData.branch === undefined ? '' : summaryData.branch)
            }
            /* The write side of the first-paint cache: exactly the FIRST page
               (a paged fetch never reaches this path), replaced on every
               refresh — the auto-refresh included — so a session switch through
               the same workspace seeds fresh data, not the mount-time
               snapshot. A branch-browsing page (browseRev) must not evict the
               HEAD page: the next mount opens on HEAD and would otherwise be
               seeded with another branch's log. */
            if (browseRev === '') writePaintPage(repoRoot, { summary: summaryData, branches: branchesData, commits: page.commits, hasMore: page.hasMore })
          })
        } finally {
          if (withFetch === true) setRefreshSpinning(false)
        }
      }, [guard, loadSummary, loadBranches, loadCommits, repoRoot, remoteReady, base, browseRev])

      /* Double-click a branch (or the HEAD row): browse its history. The merge
         anchor comes from the PREVIOUSLY browsed branch — 'merge-point' finds
         the newest merge that carried it into the one now opened, and the
         history list scrolls there once (null = no relationship, top). */
      const browseBranch = useCallback(async (entry) => {
        const name = String(entry.name)
        const previous = lastBrowseRef.current
        if (previous === name) return
        lastBrowseRef.current = name
        setMergeAnchor(null)
        setBrowseRev(name)
        if (previous !== null) {
          try {
            const data = await request('merge-point', Object.assign({}, base, { from: previous, to: name }))
            if (data !== null && typeof data === 'object' && typeof data.hash === 'string' && data.hash !== '') setMergeAnchor(data.hash)
          } catch (error) { void error }
        }
      }, [base, request])
      /* A repository switch forgets the browsing context entirely. */
      useEffect(() => {
        lastBrowseRef.current = null
        setBrowseRev('')
        setMergeAnchor(null)
      }, [repoRoot])

      useEffect(() => {
        if (repoRoot === null) return undefined
        /* First-paint cache: seed the first page synchronously so a session
           switch through the same workspace paints the full chrome (rail,
           branch bar, history) at once instead of re-growing it piece by
           piece; the refresh below re-proves every field right after. Only a
           cold mount seeds — a later effect run (tick / repo switch) must not
           roll live state back to a stale snapshot. */
        const cachedPage = readPaintPage(repoRoot)
        if (cachedPage !== undefined) {
          /* Field-wise: a pill may have painted only its summary (the pill
             merges its own two fields alone), so branches/commits can be
             absent from the page. Seeding undefined into state would crash
             the branch-tree render (undefined.remotes) — skip that field
             and let refresh() fetch it as usual. */
          if (summary === null && cachedPage.summary !== undefined) setSummary(cachedPage.summary)
          if (branches === null && cachedPage.branches !== undefined) setBranches(cachedPage.branches)
          if (commits.length === 0 && Array.isArray(cachedPage.commits)) { setCommits(cachedPage.commits); setHasMore(cachedPage.hasMore === true) }
        }
        void refresh()
        return undefined
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [repoRoot, refresh, tick])

      useEffect(() => {
        if (props.visible !== true || repoRoot === null) return undefined
        /* In-flight gate (issue #11): a summary over a tree with thousands of
           changes can outlast AUTO_REFRESH_MS, and re-entering just piles
           queued scans behind the repo lock (the interval deliberately does
           not run through `guard` — a background refresh must not flash the
           busy UI). Skip while the previous round is still running; the next
           tick re-checks. */
        let inFlight = false
        const timer = setInterval(() => {
          if (inFlight === true) return
          inFlight = true
          void (async () => {
            try {
              const data = await loadSummary()
              /* v0.18.7: the poll used to be summary-only, so commits and
                 checkouts made OUTSIDE the panel (terminal, another tool)
                 never reached the history and branch lists until a manual
                 refresh. Each summary now carries HEAD + branch; when that
                 signature moves, re-pull branches + history. The panel's own
                 actions already refresh everything through run() → refresh()
                 (which also re-records the signature), so this stays quiet
                 for in-panel work. The null baseline (first tick) only
                 records — the mount refresh already pulled everything. */
              const sig = data !== null && typeof data === 'object' && typeof data.head === 'string'
                ? data.head + '|' + (data.branch === undefined ? '' : data.branch)
                : null
              if (sig !== null && headRef.current !== null && sig !== headRef.current) {
                await Promise.all([loadBranches(), loadCommits(0)])
              }
              if (sig !== null) headRef.current = sig
            } catch (error) { void error } finally { inFlight = false }
          })()
        }, AUTO_REFRESH_MS)
        return () => clearInterval(timer)
      }, [props.visible, repoRoot, loadSummary, loadBranches, loadCommits])

      /* A merge, rebase, cherry-pick or revert that stops on conflicts exits
         as data, not as a refusal: the overview is the next step, and a toast
         alone leaves the user without one. */
      const openConflictOverview = useCallback(() => {
        if (repoRoot === null || conflictOverviewDialog.hosted !== true) return false
        const scopeObject = scope || {}
        conflictOverviewDialog.set({ cwd: cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId })
        return true
      }, [cwd, repoRoot, scope])

      /* The failure path already reports through setError; the success half of
         every gesture lands in the same stack (m05310). A call site that pushes a
         richer toast of its own passes { quiet: true }. */
      const runSuccessText = useCallback((method, payload) => successToastText(t, method, payload), [t])
      const run = useCallback(async (method, payload, options) => {
        const result = await guard(() => request(method, Object.assign({}, base, payload)))
        /* A git run just happened — failed or not, the console has a new block. */
        setConsoleTick((value) => value + 1)
        if (result === undefined) return undefined
        await refresh()
        /* refresh itself runs git (status/log); the console gets those blocks
           too, so the second tick keeps the tab on the newest line. */
        setConsoleTick((value) => value + 1)
        /* An operation that started or ended here must reach the composer pill
           now: the pill polls, so waiting for the poll looks like a stale
           "merging" banner after an abort from this tab. */
        notifyBranchSwitched(sessionId, base.repoRoot)
        if (options === undefined || options.quiet !== true) notifyOk(runSuccessText(method, payload))
        if (result !== null && result !== undefined && result.conflicted === true) openConflictOverview()
        return result
      }, [base, sessionId, runSuccessText, guard, refresh, openConflictOverview])

      const pickRepo = useCallback((path) => {
        setRepoRoot(path)
        /* Shared write: the composer status pill watches this store and
           follows, so both seats always name the same repository. */
        rememberRepoShared(sessionId, path)
        setSummary(null)
        setBranches(null)
        setCommits([])
        /* The signature is per-repo: force a fresh baseline for the new one
           so the first poll tick doesn't mistake the repo switch for an
           outside HEAD move. */
        headRef.current = null
        setDetail(null)
        setSelectedHash(null)
        setPatch('')
        setDiffContext(null)
        setView('history')
        setPathFilter('')
      }, [sessionId])

      /* The composer status pill and this panel are separate trees; when the
         pill (or any other seat) switches the repository or the branch, this
         subscription lands the same selection here — pickRepo for a repo move
         (full state reset, same as an in-panel pick), refresh() for a branch
         move (the panel's own post-action path). Declared AFTER pickRepo and
         refresh: hooks dependency arrays evaluate during render (invariant 12). */
      useEffect(() => {
        const onRepo = (sid, root) => {
          if (sid !== sessionId || typeof root !== 'string' || root === '') return
          setRepoRoot((current) => (current === root ? current : pickRepo(root)))
        }
        const onBranch = () => {
          if (repoRoot === null) return
          void refresh()
        }
        composerRepoWatchers.add(onRepo)
        composerBranchWatchers.add(onBranch)
        return () => {
          composerRepoWatchers.delete(onRepo)
          composerBranchWatchers.delete(onBranch)
        }
      }, [sessionId, repoRoot, pickRepo, refresh])

      const openDiff = useCallback(async (seed) => {
        setPatchLoading(true)
        setPatch('')
        try {
          const data = await request('diff', Object.assign({}, base, seed))
          setPatch(data.patch)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setPatchLoading(false)
        }
      }, [base])

      /* ---------- external diff preview ---------- */
      /* m02986: a diff opens as a card over the page, not a sidebar tab. The
         same card serves the push dialog's file list. The sidebar preview type
         stays registered as the fallback for a host without shell.overlay, and
         the inline pane remains the last resort (no right sidebar either). */
      const previewDiff = useCallback((seed) => {
        if (repoRoot === null) return false
        const commitHash = seed.hash !== undefined && seed.hash !== null ? String(seed.hash) : null
        const scopeObject = scope || {}
        const dialogSeed = commitHash !== null
          ? { hash: commitHash, subject: seed.subject || '', path: seed.path !== undefined && seed.path !== null ? seed.path : '', cwd: scopeObject.cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId }
          : { path: seed.path, staged: seed.staged === true, untracked: seed.untracked === true ? true : undefined, cwd: scopeObject.cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId }
        if (fileDialog.hosted === true) {
          fileDialog.set(dialogSeed)
          return true
        }
        let sidebarRight = undefined
        try { sidebarRight = props.ctx === undefined || props.ctx === null ? undefined : props.ctx.get('sidebarRight') } catch (error) { void error }
        if (sidebarRight === undefined || sidebarRight === null || typeof sidebarRight.openTab !== 'function') return false
        try {
          previewStore.set(dialogSeed)
          sidebarRight.openTab(NATIVE_PREVIEW_KIND)
          return true
        } catch (error) { return false }
      }, [repoRoot, scope, props.ctx])

      /* The one diff verb every surface calls (row click, row menu, detail
         file menu, working-diff shortcut): external first, inline fallback. */
      const showDiff = useCallback((seed) => {
        if (previewDiff(seed) === true) return
        if (seed.hash !== undefined && seed.hash !== null) {
          setDiffContext({ kind: 'commit', hash: seed.hash, subject: seed.subject || '' })
          void openDiff({ hash: seed.hash, path: seed.path })
          return
        }
        setDiffContext({ kind: 'worktree', staged: seed.staged === true })
        /* m04495: an untracked path has no index entry, so the route needs the
           flag to run `git diff --no-index` against /dev/null. Dropping it here
           left the inline fallback with an empty patch. */
        void openDiff({ path: seed.path, staged: seed.staged === true, untracked: seed.untracked === true ? true : undefined })
      }, [previewDiff, openDiff])

      /* A conflicted row opens the conflict card. git prints a combined diff
         for an unmerged path, which the diff view cannot parse, so the card is
         the only surface that can show all three versions. Without an overlay
         slot the inline pane stays the fallback: it shows the comparison, not
         the editor. */
      const openConflict = useCallback((path) => {
        if (repoRoot === null) return
        if (conflictDialog.hosted !== true) { showDiff({ path: path }); return }
        const scopeObject = scope || {}
        conflictDialog.set({ path: path, cwd: cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId })
      }, [cwd, repoRoot, scope, showDiff])

      /* m04920: the Git tab raises the SAME frame dialogs as the composer pill.
         The panel used to draw its own inline push card and commit layer, so the
         two surfaces drifted apart: the layer kept a right-hand diff that could
         not fit the card, and a file card opened from the panel could not cover
         the inline card. */
      const openPushDialog = useCallback((seed) => {
        const scopeObject = scope || {}
        if (repoRoot === null) return
        pushDialog.set(Object.assign({ cwd: cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId }, seed || {}))
      }, [cwd, repoRoot, scope])


      const selectCommit = useCallback(async (commit) => {
        setSelectedHash(commit.hash)
        setSelectedPath(null)
        setPatch('')
        setDiffContext(null)
        /* Wide seats keep the log in the middle and open the commit in the
           right-hand column (m01216); a single-row seat has no third column, so
           there the detail takes the main one. */
        if (compact === true) setView('detail')
        setDetail(null)
        try {
          setDetail(await request('commitDetail', Object.assign({}, base, { hash: commit.hash })))
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }, [base, compact])

      const checkout = useCallback(async (entry) => {
        if (entry.tag === true) { void run('checkout', { branch: entry.name }); return }
        if (entry.remote === true) { void run('checkout', { branch: entry.name.slice(entry.name.indexOf('/') + 1) }); return }
        void run('checkout', { branch: entry.name })
      }, [run])

      const compareWith = useCallback(async (baseRef, headRef) => {
        const data = await run('compare', { base: baseRef, head: headRef })
        if (data === undefined) return
        setNote(baseRef + ' ... ' + headRef + ' · ' + String(data.files.length) + ' files / ' + String(data.commits.length) + ' commits')
      }, [run])

      /* Menu anchors are stored as offsets inside the panel, not as viewport
         coordinates: the bottom workbench is a containing block for fixed
         descendants (contain: layout), so viewport coordinates would place the
         menu outside the panel. See ContextMenu. */
      // A merge / rebase / cherry-pick / revert / bisect that has not finished yet
      // makes branch-level actions dangerous: git refuses most of them anyway, so
      // the panel greys them out and says why instead of letting them fail.
      const operation = summary === null || summary.operation === undefined ? null : summary.operation
      const blocked = operation !== null

      const openMenuAt = useCallback((event, items) => {
        const element = hostRef.current
        const rect = element === null ? null : element.getBoundingClientRect()
        setMenu({
          x: event.clientX - (rect === null ? 0 : rect.left),
          y: event.clientY - (rect === null ? 0 : rect.top),
          boundsWidth: rect === null ? 0 : Math.round(rect.width),
          boundsHeight: rect === null ? 0 : Math.round(rect.height),
          items: items,
        })
      }, [])


      /* Send-to-chat (v0.14): one funnel for the three context menus. The
         insertion target is the CURRENT session's composer (scope.sessionId);
         a miss — service absent, no retained session, phase busy, CAS raced
         twice — still gives feedback: the payload is copied to the clipboard
         and a toast says so. */
      const sendToComposer = useCallback((payload) => {
        const applied = insertIntoComposer(props.ctx, sessionId, (actx, input, span) => {
          if (payload.mention !== undefined && payload.text !== undefined) {
            // Chip + trailing sentence (v0.13.5 diff line refs): the @file chip
            // first, then the line-range text at the NEW draft tail (the chip
            // changed both the draft and its rev). The facade appends a
            // separating space after a chip when none follows, so the text leg
            // goes in verbatim. If the text leg loses its CAS race twice the
            // chip still stands — the reference made it, that reads as sent.
            let chipApplied = false
            try {
              chipApplied = input.insertReference({
                source: 'reference',
                ref: payload.mention,
                label: payload.label,
                appearance: payload.appearance,
                clipboardText: payload.mention,
              }, span) === true
            } catch (error) { void error; chipApplied = false }
            if (chipApplied === false) return false
            try {
              let state = input.state.getSnapshot()
              for (let attempt = 0; attempt < 2; attempt += 1) {
                // The chip changed BOTH projections; the tail must be rebuilt
                // in detect coordinates (see detectTailSpanOf), or selectSpan
                // rejects it and the sentence silently vanishes.
                const tail = detectTailSpanOf(state)
                if (tail !== null) {
                  let textApplied = false
                  try { textApplied = actx.bail(actx, 'slash/input-insert-text', { text: payload.text, span: tail }) === true } catch (error) { void error; textApplied = false }
                  if (textApplied === true) return true
                }
                try { state = input.state.getSnapshot() } catch (error) { void error; return true }
              }
            } catch (error) { void error }
            return true
          }
          if (payload.appearance !== undefined) {
            return input.insertReference({
              source: 'reference',
              ref: payload.mention,
              label: payload.label,
              appearance: payload.appearance,
              clipboardText: payload.mention,
            }, span)
          }
          // Plain text rides the scoped insert-text event (bail value IS the
          // answer); a trailing space keeps the next keystroke off the token.
          return actx.bail(actx, 'slash/input-insert-text', { text: payload.text + ' ', span: span }) === true
        })
        if (applied === true) {
          pushToast({ text: t('toast.sentToChat'), icon: 'send', tone: 'ok', ttl: 6000 })
          return
        }
        copyText(payload.fallback)
        pushToast({ text: t('toast.sendCopied'), icon: 'tag', tone: 'warn', ttl: 6000 })
      }, [props.ctx, sessionId, pushToast, t])

      const sendFileReferenceToChat = useCallback((path) => {
        const mention = fileMentionOf(path)
        if (mention === null) { sendToComposer({ text: path, fallback: path }); return }
        sendToComposer({
          mention: mention,
          label: path.slice(-1) === '/' ? path.slice(0, -1) : baseName(path),
          appearance: path.slice(-1) === '/' ? 'folder' : 'file',
          fallback: path,
        })
      }, [sendToComposer])

      /* Self-describing text payloads for the commit/branch sends (v0.13.3 user
         feedback): a bare short hash or branch name is noise out of context —
         the text must say WHAT it is and WHERE from. The wording rides the
         fill() templates send.commitText / send.branchText; `repo` is the repo
         root's basename. An unknown root degrades to a neutral dash — fill()
         leaves unknown keys verbatim, so the callers must never let an
         undefined repo reach the template. The file @-chip is already
         self-describing and stays untouched. */
      const repoLabel = repoRoot === null ? '' : baseName(repoRoot)
      const sendGitSummaryToChat = useCallback((key, values) => {
        const repo = values.repo === undefined || values.repo === '' ? '—' : values.repo
        const text = fill(t(key), Object.assign({}, values, { repo: repo }))
        sendToComposer({ text: text, fallback: text })
      }, [t, sendToComposer])

      /* ---------- multi-select actions (issue #13) ---------- */

      /* Copy with feedback: plain copyText stays silent, which reads as "did
         nothing" the moment the paste target is in another app. */
      const copyValues = useCallback((values) => {
        if (values === null || values === undefined || values.length === 0) return
        copyText(clipboardLines(values))
        pushToast({ text: fill(t('selection.copied'), { n: values.length }), icon: 'tag', tone: 'ok', ttl: 2500 })
      }, [pushToast, t])

      /* Resolve the change selection against the CURRENT summary: paths move
         between groups on every stage/unstage, so the key ('group:path') is
         the only stable handle and the entry lookup must be fresh. */
      const changeSelectionGroups = () => {
        const changes = summary === null ? null : summary.changes
        const groups = { staged: [], other: [], tracked: [], untracked: [] }
        if (changes === null) return groups
        const byKey = new Map()
        for (const entry of changes.staged) byKey.set('staged:' + entry.path, entry)
        for (const entry of changes.unstaged) byKey.set('unstaged:' + entry.path, entry)
        for (const entry of changes.untracked) byKey.set('untracked:' + entry.path, entry)
        for (const entry of changes.conflicted) byKey.set('conflicted:' + entry.path, entry)
        for (const key of changeSelection) {
          const entry = byKey.get(key)
          if (entry === undefined) continue
          if (key.indexOf('staged:') === 0) groups.staged.push(entry.path)
          else groups.other.push(entry.path)
          // Conflicted rides the tracked lane, like the single-file discard does.
          if (key.indexOf('untracked:') === 0) groups.untracked.push(entry.path)
          else groups.tracked.push(entry.path)
        }
        return groups
      }
      const bulkStageChanges = () => {
        const groups = changeSelectionGroups()
        if (groups.other.length === 0) return
        void run('stage', { paths: groups.other })
      }
      const bulkUnstageChanges = () => {
        const groups = changeSelectionGroups()
        if (groups.staged.length === 0) return
        void run('unstage', { paths: groups.staged })
      }
      const openDiscardManyDialog = () => {
        const groups = changeSelectionGroups()
        if (groups.tracked.length === 0 && groups.untracked.length === 0) return
        setDialog({ kind: 'discardMany', tracked: groups.tracked, untracked: groups.untracked })
      }
      const copyChangeSelection = () => {
        const groups = changeSelectionGroups()
        copyValues(groups.staged.concat(groups.other))
      }
      /* A refresh that resolves a selected key away (file staged, discarded,
         renamed) must not keep it selected. */
      useEffect(() => {
        setChangeSelection((previous) => {
          if (previous.size === 0) return previous
          const changes = summary === null ? null : summary.changes
          if (changes === null) return previous
          const alive = new Set()
          for (const entry of changes.conflicted) alive.add('conflicted:' + entry.path)
          for (const entry of changes.staged) alive.add('staged:' + entry.path)
          for (const entry of changes.unstaged) alive.add('unstaged:' + entry.path)
          for (const entry of changes.untracked) alive.add('untracked:' + entry.path)
          const next = new Set()
          for (const key of previous) {
            if (alive.has(key) === true) next.add(key)
          }
          return next.size === previous.size ? previous : next
        })
      }, [summary])
      /* Changes-list keyboard scope: Ctrl/Cmd+C copies paths, Delete opens the
         grouped discard confirm, Ctrl+A selects everything but ignored, Esc
         clears. Typing targets keep their native behaviour. */
      const onChangesKeyDown = (event) => {
        if (isTypingTarget(event.target) === true) return
        const mod = isToggleModifier(event)
        if (mod === true && (event.key === 'c' || event.key === 'C')) {
          const groups = changeSelectionGroups()
          const paths = groups.staged.concat(groups.other)
          if (paths.length === 0) return
          event.preventDefault()
          copyValues(paths)
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (changeSelection.size === 0) return
          event.preventDefault()
          openDiscardManyDialog()
          return
        }
        if (mod === true && (event.key === 'a' || event.key === 'A')) {
          const changes = summary === null ? null : summary.changes
          if (changes === null) return
          event.preventDefault()
          const next = new Set()
          for (const entry of changes.conflicted) next.add('conflicted:' + entry.path)
          for (const entry of changes.staged) next.add('staged:' + entry.path)
          for (const entry of changes.unstaged) next.add('unstaged:' + entry.path)
          for (const entry of changes.untracked) next.add('untracked:' + entry.path)
          setChangeSelection(next)
          return
        }
        if (event.key === 'Escape') setChangeSelection(new Set())
      }
      /* History keyboard scope: Ctrl/Cmd+C copies full hashes, Esc clears.
         Delete has no commit analogue — deliberately unmapped. */
      const onHistoryKeyDown = (event) => {
        if (isTypingTarget(event.target) === true) return
        if (isToggleModifier(event) === true && (event.key === 'c' || event.key === 'C')) {
          if (pickedCommits.size === 0) return
          event.preventDefault()
          copyValues(Array.from(pickedCommits))
          return
        }
        /* Enter = the keyboard twin of the double-click: open the picked
           commit's detail. Exactly one pick — with several, the intent is
           ambiguous, so Enter does nothing. */
        if (event.key === 'Enter' && pickedCommits.size === 1) {
          event.preventDefault()
          const hash = pickedCommits.values().next().value
          const commit = commits.find((entry) => entry.hash === hash)
          if (commit !== undefined) { void selectCommit(commit); return }
        }
        if (event.key === 'Escape') setPickedCommits(new Set())
      }
      /* Branch-tree Delete: group the picked refs by kind and hand them to ONE
         confirm dialog (head branches never get here — BranchTree filters). */
      const deleteBranchEntries = (entries) => {
        const locals = []
        const remotes = []
        const tags = []
        for (const item of entries) {
          if (item.kind === 'local') locals.push(item.name)
          else if (item.kind === 'tag') tags.push(item.name)
          else {
            const slash = item.name.indexOf('/')
            remotes.push({
              remote: slash >= 0 ? item.name.slice(0, slash) : item.name,
              branch: slash >= 0 ? item.name.slice(slash + 1) : item.name,
            })
          }
        }
        if (locals.length === 0 && remotes.length === 0 && tags.length === 0) return
        setDialog({ kind: 'deleteRefs', locals: locals, remotes: remotes, tags: tags })
      }
      /* Batch local delete with the same undo toast the single delete has.
         Plain function on purpose (invariant 12): a useCallback here would
         evaluate `undoAction` in its dep array — declared further below. */
      const deleteBranches = async (names) => {
        const data = await run('branchDelete', { names: names, confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) return
        pushToast({
          text: fill(t('toast.branchesDeleted'), { n: names.length }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }

      const branchMenu = useCallback((event, entry, picked) => {
        const current = branches === null ? '' : branches.branch
        const isLocal = entry.remote !== true && entry.tag !== true
        const reason = t('action.unavailable')
        /* Multi-select menu: the verbs that only make sense for one ref
           (checkout, merge, rebase, rename…) are dropped, not greyed — the
           selection itself already says what the user is going for. */
        if (picked !== null && picked !== undefined && picked.length > 1) {
          const locals = picked.filter((item) => item.kind === 'local' && item.entry.head !== true)
          const remotes = picked.filter((item) => item.kind === 'remote')
          const tags = picked.filter((item) => item.kind === 'tag')
          openMenuAt(event, withoutIcons([
            { id: 'copyNames', icon: 'tag', tone: 'secondary', label: fill(t('menu.copyNamesN'), { n: picked.length }), run: () => copyValues(picked.map((item) => item.name)) },
            null,
            locals.length > 0 ? { id: 'deleteLocal', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteLocalN'), { n: locals.length }), run: () => setDialog({ kind: 'deleteRefs', locals: locals.map((item) => item.name), remotes: [], tags: [] }) } : null,
            remotes.length > 0 ? { id: 'deleteRemote', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteRemoteN'), { n: remotes.length }), run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: remotes.map((item) => { const slash = item.name.indexOf('/'); return { remote: slash >= 0 ? item.name.slice(0, slash) : item.name, branch: slash >= 0 ? item.name.slice(slash + 1) : item.name } }), tags: [] }) } : null,
            tags.length > 0 ? { id: 'deleteTags', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteTagsN'), { n: tags.length }), run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: [], tags: tags.map((item) => item.name) }) } : null,
          ].filter((item) => item !== null)))
          return
        }
        const items = [
          { id: 'checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout'), disabled: entry.head === true || entry.tag === true || blocked, reason: blocked ? t('operation.hint') : reason, run: () => { void checkout(entry) } },
          isLocal ? { id: 'rebase', icon: 'compare', tone: 'violet', label: t('action.rebaseCurrentOnto'), disabled: entry.head === true || blocked, reason: blocked ? t('operation.hint') : reason, run: () => { void run('rebase', { onto: entry.name }) } } : null,
          isLocal ? { id: 'merge', icon: 'compare', tone: 'accent', label: t('action.mergeIntoCurrent'), disabled: entry.head === true || blocked, reason: blocked ? t('operation.hint') : reason, run: () => { void run('merge', { branch: entry.name }) } } : null,
          { id: 'compare', icon: 'filter', tone: 'violet', label: t('action.compare'), disabled: entry.head === true || current === '', reason: reason, run: () => { void compareWith(current, entry.name) } },
          { id: 'send', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => sendGitSummaryToChat('send.branchText', { name: entry.name, repo: repoLabel }) },
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyName'), run: () => copyValues([entry.name]) },
          null,
          { id: 'favorite', icon: 'star', tone: 'warn', label: t('action.favorite'), active: favorites.indexOf(entry.name) >= 0, run: () => toggleFavoriteBranch(entry.name) },
          /* Upstream management (issue #18). The remote-picker submenu is
             built INSIDE run() — branches.remote is read at click time, not
             render time, so branchMenu's useCallback deps stay untouched
             (remoteBranches is defined AFTER this callback; a render-time
             reference would be the classic hooks TDZ trap). */
          isLocal ? { id: 'setUpstream', icon: 'fetch', tone: 'cyan', label: t('action.setUpstream'), disabled: branches === null || branches.remote.length === 0, reason: reason, run: (event) => openMenuAt(event, withoutIcons(branches.remote.map((remoteEntry) => ({
            id: 'upstream:' + remoteEntry.name,
            icon: 'fetch', tone: 'cyan',
            label: remoteEntry.name,
            active: entry.upstream === remoteEntry.name,
            run: () => { void run('branch-upstream', { branch: entry.name, upstream: remoteEntry.name }) },
          })))) } : null,
          isLocal && entry.upstream !== null && entry.upstream !== undefined ? { id: 'unsetUpstream', icon: 'undo', tone: 'secondary', label: t('action.unsetUpstream'), run: () => { void run('branch-upstream', { branch: entry.name, unset: true }) } } : null,
          /* Remote rows get the tracking form: the local branch is created
             FROM the remote ref with --track in one step (issue #18 item 5),
             replacing the plain "new branch from" which could not bind. */
          entry.remote === true
            ? { id: 'createTracking', icon: 'branchCreate', tone: 'success', label: t('action.newBranchFrom'), run: () => setDialog({ kind: 'createTracking', from: entry.name, name: entry.name.slice(entry.name.indexOf('/') + 1) }) }
            : { id: 'newBranch', icon: 'plus', tone: 'success', label: t('action.newBranchFrom'), run: () => setDialog({ kind: 'newBranch', from: entry.name }) },
          isLocal ? { id: 'rename', icon: 'file', tone: 'primary', label: t('action.rename'), run: () => setDialog({ kind: 'renameBranch', from: entry.name }) } : null,
          isLocal ? { id: 'delete', icon: 'trash', tone: 'danger', label: t('action.delete'), danger: true, disabled: entry.head === true, reason: reason, run: () => setDialog({ kind: 'deleteBranch', name: entry.name }) } : null,
          entry.tag === true
            ? { id: 'delete', icon: 'trash', tone: 'danger', label: t('action.delete'), danger: true, run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: [], tags: [entry.name] }) }
            : (isLocal ? null : {
                id: 'delete', icon: 'trash', tone: 'danger', label: t('action.delete'), danger: true,
                run: () => {
                  const slash = entry.name.indexOf('/')
                  setDialog({
                    kind: 'deleteRefs', locals: [], tags: [],
                    remotes: [{ remote: slash >= 0 ? entry.name.slice(0, slash) : entry.name, branch: entry.name.slice(slash + 1) }],
                  })
                },
              }),
          null,
          { id: 'update', icon: 'fetch', tone: 'cyan', label: t('action.update'), run: () => { void run('fetch', { prune: true }) } },
          { id: 'push', icon: 'push', tone: 'success', label: t('action.push'), disabled: blocked, reason: t('operation.hint'), run: () => openPushDialog({ branch: entry.name }) },
        ].filter((item) => item !== null)
        openMenuAt(event, withoutIcons(items))
      }, [branches, checkout, run, t, compareWith, toggleFavoriteBranch, openMenuAt, favorites, blocked, sendGitSummaryToChat, repoLabel, copyValues])

      const commitMenu = useCallback((event, commit) => {
        const shortHash = commit.hash.slice(0, 7)
        /* Multi-select: copy every picked hash and cherry-pick them as ONE
           sequence, oldest first (the graph lists newest first, so the walk
           order reverses). Verbs that only make sense against one commit
           (checkout, branch, tag, reset, revert) drop out entirely. */
        if (pickedCommits.has(commit.hash) === true && pickedCommits.size > 1) {
          const ordered = []
          for (const entry of commits) {
            if (pickedCommits.has(entry.hash) === true) ordered.push(entry.hash)
          }
          const oldestFirst = ordered.slice().reverse()
          openMenuAt(event, [
            { id: 'copyHashes', icon: 'tag', tone: 'secondary', label: fill(t('menu.copyHashesN'), { n: pickedCommits.size }), run: () => copyValues(Array.from(pickedCommits)) },
            null,
            { id: 'cherry', icon: 'commit', tone: 'accent', label: fill(t('menu.cherryN'), { n: pickedCommits.size }), disabled: blocked, reason: t('operation.hint'), run: () => { void run('cherryPick', { hashes: oldestFirst }) } },
          ])
          return
        }
        const items = [
          { id: 'details', icon: 'file', tone: 'primary', label: t('action.details'), run: () => { void selectCommit(commit) } },
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyHash'), run: () => { copyText(commit.hash) } },
          { id: 'send', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => {
            // A commit whose subject is empty (git tolerates empty messages)
            // degrades to the old bare-hash payload instead of faking one.
            const subject = typeof commit.subject === 'string' ? commit.subject.trim() : ''
            if (subject === '') { sendToComposer({ text: shortHash, fallback: shortHash }); return }
            sendGitSummaryToChat('send.commitText', { hash: shortHash, subject: subject, repo: repoLabel })
          } },
          null,
          { id: 'checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout'), run: () => setDialog({ kind: 'checkoutCommit', hash: commit.hash }) },
          { id: 'branch', icon: 'plus', tone: 'success', label: t('action.newBranchHere'), run: () => setDialog({ kind: 'newBranch', from: commit.hash }) },
          { id: 'tag', icon: 'tag', tone: 'warn', label: t('action.newTag'), run: () => setDialog({ kind: 'newTag', hash: commit.hash }) },
          null,
          { id: 'cherry', icon: 'commit', tone: 'accent', label: t('action.cherryPick'), disabled: blocked, reason: t('operation.hint'), run: () => { void run('cherryPick', { hash: commit.hash }) } },
          { id: 'revert', icon: 'undo', tone: 'danger', label: t('action.revert'), disabled: blocked, reason: t('operation.hint'), run: () => { void run('revert', { hash: commit.hash }) } },
          null,
          { id: 'resetSoft', icon: 'undo', tone: 'warn', label: t('action.resetSoft'), disabled: blocked, reason: t('operation.hint'), run: () => setDialog({ kind: 'reset', hash: commit.hash, mode: 'mixed' }) },
          { id: 'resetHard', icon: 'trash', tone: 'danger', label: t('action.resetHard'), danger: true, disabled: blocked, reason: t('operation.hint'), run: () => setDialog({ kind: 'reset', hash: commit.hash, mode: 'hard' }) },
        ]
        openMenuAt(event, items)
      }, [run, selectCommit, t, openMenuAt, blocked, sendToComposer, sendGitSummaryToChat, repoLabel, pickedCommits, commits, copyValues])

      const changeMenu = useCallback((event, item, group) => {
        /* Multi-select: right-clicking a row that belongs to the selection
           acts on the WHOLE selection (stage N / unstage N / discard N). */
        if (changeSelection.has(group + ':' + item.path) === true && changeSelection.size > 1) {
          const groups = changeSelectionGroups()
          const allPaths = groups.staged.concat(groups.other)
          openMenuAt(event, [
            groups.other.length > 0 ? { id: 'stage', icon: 'plus', tone: 'success', label: fill(t('menu.stageN'), { n: groups.other.length }), run: () => { void run('stage', { paths: groups.other }) } } : null,
            groups.staged.length > 0 ? { id: 'unstage', icon: 'minus', tone: 'warn', label: fill(t('menu.unstageN'), { n: groups.staged.length }), run: () => { void run('unstage', { paths: groups.staged }) } } : null,
            { id: 'discard', icon: 'undo', tone: 'danger', danger: true, label: fill(t('menu.discardN'), { n: groups.tracked.length + groups.untracked.length }), run: () => openDiscardManyDialog() },
            null,
            { id: 'copy', icon: 'tag', tone: 'secondary', label: fill(t('menu.copyPathsN'), { n: allPaths.length }), run: () => copyValues(allPaths) },
          ].filter((entry) => entry !== null))
          return
        }
        /* An unmerged path has no ordinary diff and "stage" alone would not
           say what landed. The conflict verbs live here so a row can be settled
           without opening the card. */
        if (group === 'conflicted') {
          openMenuAt(event, [
            { id: 'conflict', icon: 'compare', tone: 'accent', label: t('conflict.open'), run: () => openConflict(item.path) },
            null,
            { id: 'conflict-ours', icon: 'check', tone: 'success', label: t('conflict.takeOursFile'), run: () => { void run('conflictResolve', { path: item.path, side: 'ours' }) } },
            { id: 'conflict-theirs', icon: 'check', tone: 'warn', label: t('conflict.takeTheirsFile'), run: () => { void run('conflictResolve', { path: item.path, side: 'theirs' }) } },
            { id: 'conflict-mark', icon: 'check', tone: 'success', label: t('conflict.markResolved'), run: () => { void run('conflictResolve', { path: item.path, side: 'worktree' }) } },
            null,
            { id: 'sendRef', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => sendFileReferenceToChat(item.path) },
            { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyPath'), run: () => { copyText(item.path) } },
          ])
          return
        }
        const items = [
          { id: 'diff', icon: 'file', tone: 'primary', label: t('action.showDiff'), run: () => { showDiff({ path: item.path, staged: group === 'staged', untracked: group === 'untracked' }) } },
          { id: 'sendRef', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => sendFileReferenceToChat(item.path) },
          null,
          group === 'staged'
            ? { id: 'unstage', icon: 'minus', tone: 'warn', label: t('action.unstage'), run: () => { void run('unstage', { paths: [item.path] }) } }
            : { id: 'stage', icon: 'plus', tone: 'success', label: t('action.stage'), run: () => { void run('stage', { paths: [item.path] }) } },
          { id: 'discard', icon: 'undo', tone: 'danger', label: t('action.discard'), danger: true, disabled: group === 'untracked', reason: t('action.unavailable'), run: () => setDialog({ kind: 'discard', item: item, group: group }) },
          null,
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyPath'), run: () => { copyText(item.path) } },
        ]
        openMenuAt(event, items)
      }, [showDiff, run, t, openMenuAt, openConflict, sendFileReferenceToChat, sendToComposer, changeSelection, changeSelectionGroups, openDiscardManyDialog, copyValues])

      /* The commit-detail file list shares the working-tree row menu, minus the
         staging verbs: a committed file's diff replays against its commit. */
      const detailFileMenu = useCallback((event, file) => {
        openMenuAt(event, [
          { id: 'diff', icon: 'file', tone: 'primary', label: t('action.showDiff'), run: () => {
            setSelectedPath(file.path)
            showDiff({
              hash: detail === null || detail === undefined ? undefined : detail.hash,
              subject: detail === null || detail === undefined ? '' : detail.subject,
              path: file.path,
            })
          } },
          null,
          { id: 'sendRef', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => sendFileReferenceToChat(file.path) },
          null,
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyPath'), run: () => { copyText(file.path) } },
        ])
      }, [detail, showDiff, openMenuAt, sendFileReferenceToChat, sendToComposer, t])

      /* The diff pane's own context menu (v0.13.5): select text in the diff,
         right-click, send a self-describing line reference to the composer.
         The window selection is read BEFORE the menu opens — some platforms
         clear it the moment a context menu shows — and the whole payload is
         computed right here, so the menu items run from captured values and
         never depend on a selection that may no longer exist. A selection
         outside the diff rows keeps the browser's own menu: preventDefault is
         skipped and no item appears (the old behaviour).

         LAST-RESORT SEMANTICS (v0.13.5 forward compat): the rows under this
         pane may be HOST-rendered (ui-primitives DiffBlock), and a future DSH
         is free to add its own context-menu surface to that component. React
         dispatches synthetic contextmenu handlers in bubble order — innermost
         first — so an inner handler that claimed the event (opened its menu
         or called preventDefault) has already set defaultPrevented by the
         time this container handler runs. That check is the FIRST statement:
         if the host handled it we return and the host menu stands alone —
         never two menus at once, never an override. An unusable selection
         also returns without preventDefault (browser menu preserved). Only a
         valid diff selection that NOTHING else handled reaches our menu.
         UPGRADE MEMO (diff-右键向前兼容): DiffBlock today exposes NO menu
         surface and NO extension prop — DiffBlockProps is exactly
         { diffs, labels, maxLines, className } (ui-primitives DiffBlock.tsx);
         its only stable hook is the `data-diff` marker on the root div, which
         this pane already keys on. When upstream ships a menu surface (most
         likely an onRowContextMenu / items prop mounted on the row div or the
         body container), MIGRATE to that prop — feed it our line-reference
         items and RETIRE this container-level handler — the absorption
         pattern dsh-better-workspace uses (host menu surface + host
         dictionary, own entries appended last), not an event race. Until
         then this handler stays deliberately last-resort. */
      const onDiffPaneContextMenu = useCallback((event) => {
        if (event.defaultPrevented === true) return // an inner (host DiffBlock) handler already owns this event
        const saved = savedSelectionOf()
        const resolved = saved === null ? null : resolveDiffSelection(patch, saved)
        if (saved === null || resolved === null) return
        event.preventDefault()
        const path = selectedPath
        const hasFile = typeof path === 'string' && path !== ''
        const branchName = branches === null ? '' : branches.branch
        const mention = hasFile === true ? fileMentionOf(path) : null
        const snippet = resolved.text.length > DIFF_SNIPPET_MAX ? resolved.text.slice(0, DIFF_SNIPPET_MAX) : resolved.text
        const text = resolved.kind === 'lines' && hasFile === true
          ? diffSpanTextOf(t, diffContext, resolved.span, branchName)
          : snippet
        const plain = (mention === null ? (hasFile === true ? path : '') : mention) + ' ' + text
        const sendChip = () => {
          if (mention === null || hasFile === false) { sendToComposer({ text: text, fallback: text }); return }
          sendToComposer({ mention: mention, label: baseName(path), appearance: 'file', text: text, fallback: plain })
        }
        const items = [
          hasFile === true && resolved.kind === 'lines'
            ? { id: 'sendDiffLines', icon: 'send', tone: 'accent', label: t('menu.sendDiffLinesToChat'), run: sendChip }
            : { id: 'sendDiffSnippet', icon: 'send', tone: 'accent', label: t(resolved.kind === 'lines' ? 'menu.sendDiffLinesToChat' : 'menu.sendDiffSnippetToChat'), run: sendChip },
          null,
          { id: 'copyDiffRef', icon: 'tag', tone: 'secondary', label: t('menu.copyDiffRef'), run: () => { copyText(plain) } },
        ]
        openMenuAt(event, items)
      }, [patch, selectedPath, diffContext, branches, openMenuAt, sendToComposer, t])

      const submitDialog = useCallback(async (state, value) => {
        setDialog(null)
        if (state.kind === 'newBranch') { await run('checkout', { branch: value, create: true, startPoint: state.from }); return }
        /* From a remote ref (issue #18): --track binds the upstream in the
           same checkout -b, so "create" and "set upstream" are one motion. */
        if (state.kind === 'createTracking') { await run('checkout', { branch: value, create: true, startPoint: state.from, track: true }); return }
        if (state.kind === 'renameBranch') { await run('branchRename', { from: state.from, to: value }); return }
        if (state.kind === 'newTag') { await run('tagCreate', { name: value, hash: state.hash }); return }
        if (state.kind === 'deleteTag') { await run('tagDelete', { name: value }); return }
        /* SCM ▸ Commit ▸ variants: one dialog, four (all/staged × amend/sign)
           shapes. `all` stages every visible change first — the paths go in
           explicitly, never '.', so the host's root guard stays shut. */
        if (state.kind === 'commitMsg') {
          const paths = state.all === true
            ? summary === null ? [] : summary.changes.staged.concat(summary.changes.unstaged, summary.changes.untracked).map((entry) => entry.path)
            : undefined
          await run('commit', { message: value, paths: paths, amend: state.amend === true, signoff: state.sign === true })
          return
        }
      }, [run])

      /* ---------- toasts + undo ---------- */

      // The delete really happened; the host kept an object id for a while, and this
      // asks it to recreate the branch / stash entry from that id.
      const undoAction = useCallback(async (id) => {
        const data = await guard(() => request('undoApply', Object.assign({}, base, { id: id })))
        if (data === undefined) return
        setToasts((list) => list.filter((item) => item.undoId !== id))
        await refresh()
        pushToast({ text: t('toast.restored') + ' · ' + data.label, icon: 'check', tone: 'ok', ttl: 6000 })
      }, [base, guard, refresh, pushToast, t])

      const deleteBranch = useCallback(async (name) => {
        const data = await run('branchDelete', { name: name, confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) return
        pushToast({
          text: fill(t('toast.branchDeleted'), { name: name }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }, [run, pushToast, undoAction, t])

      const dropStash = useCallback(async (ref) => {
        const data = await run('stashDrop', { ref: ref, confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) return
        pushToast({
          text: fill(t('toast.stashDropped'), { ref: ref }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }, [run, pushToast, undoAction, t])

      /* SCM ▸ Changes ▸ Discard All Changes: tracked paths go through
         `checkout --`, untracked through `clean -fd`. Conflicted entries are
         deliberately NOT touched — a merge conflict needs a decision, not a
         silent side-taking; the dialog says so. */
      const discardAllChanges = useCallback(async () => {
        const changes = summary === null ? null : summary.changes
        if (changes === null) return
        const tracked = changes.unstaged.map((entry) => entry.path)
        const untracked = changes.untracked.map((entry) => entry.path)
        if (tracked.length > 0) await run('discard', { paths: tracked, confirm: true })
        if (untracked.length > 0) await run('discard', { paths: untracked, untracked: true, confirm: true })
      }, [run, summary])

      /* SCM ▸ Commit ▸ Undo Last Commit: a soft reset to HEAD~1 keeps the
         commit's work staged, exactly like VS Code's undo. The commit leaves
         the branch but stays in the reflog — no undo handle needed. */
      const undoLastCommit = useCallback(async () => {
        await run('reset', { hash: 'HEAD~1', mode: 'soft', confirm: true })
      }, [run])

      // A discard really overwrote the working tree, so it hands back the same
      // kind of handle a delete does: the host snapshotted the bytes first.
      const discardChanges = useCallback(async (item, group) => {
        const data = await run('discard', { paths: [item.path], untracked: group === 'untracked', confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) {
          // The host declined to snapshot (too big / not faithfully reproducible);
          // say so instead of letting the toast promise an undo that is not there.
          if (data.undoBlocked === true) {
            pushToast({ text: fill(t('toast.discardNoUndo'), { path: item.path }), icon: 'trash', tone: 'warn' })
          }
          return
        }
        pushToast({
          text: fill(t('toast.discarded'), { path: item.path }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }, [run, pushToast, undoAction, t])

      // A toast is transient; this keeps the same handles reachable afterwards, so
      // undoing a delete never depends on catching a floating chip in time.
      const openUndoMenu = useCallback(async (event) => {
        const data = await guard(() => request('undoList', base))
        if (data === undefined) return
        const entries = Array.isArray(data.items) ? data.items.slice().reverse() : []
        if (entries.length === 0) {
          pushToast({ text: t('undo.empty'), icon: 'undo', ttl: 6000 })
          return
        }
        openMenuAt(event, entries.map((entry) => ({
          id: 'undo:' + entry.id,
          icon: 'undo',
          tone: 'warn',
          label: (entry.kind === 'branch-delete' ? t('undo.branch') : entry.kind === 'stash-drop' ? t('undo.stash') : entry.kind === 'discard' ? t('undo.discard') : entry.kind) + ' · ' + entry.label,
          run: () => { void undoAction(entry.id) },
        })))
      }, [base, guard, openMenuAt, pushToast, t, undoAction])

      /* ---------- shared pieces ---------- */

      const repoOptions = repoState === null ? [] : repoState.repos
      const dirty = summary === null ? 0 : summary.changes.staged.length + summary.changes.unstaged.length + summary.changes.untracked.length + summary.changes.conflicted.length
      const conflictedCount = summary === null ? 0 : summary.changes.conflicted.length

      /* Both header switchers are menu-driven now (see RepoSelect): the
         popovers reuse openMenuAt, so they clamp to the panel box and share
         the opaque, frosted menu surface instead of the OS select popup. */
      const openRepoMenu = useCallback((event) => {
        openMenuAt(event, repoOptions.map((repo) => ({
          id: 'repo:' + repo.path,
          icon: 'folder',
          tone: 'accent',
          label: repo.name + (repo.branch === null || repo.branch === undefined ? '' : ' · ' + repo.branch),
          active: repo.path === repoRoot,
          run: () => { if (repo.path !== repoRoot) pickRepo(repo.path) },
        })))
      }, [openMenuAt, repoOptions, repoRoot, pickRepo])

      const openBranchSwitchMenu = useCallback((event) => {
        const local = branches === null ? [] : branches.local
        openMenuAt(event, local.map((entry) => ({
          id: 'switch:' + entry.name,
          icon: entry.head === true ? 'star' : 'branch',
          tone: entry.head === true ? 'warn' : 'accent',
          label: entry.name,
          active: entry.head === true,
          run: () => { if (entry.head !== true) void checkout(entry) },
        })))
      }, [openMenuAt, branches, checkout])

      const topBar = E('div', { className: 'git4idea-topbar' },
        E(RepoSelect, {
          t: t, repos: repoOptions, value: repoRoot,
          loading: repoState === null,
          onOpenMenu: openRepoMenu,
        }),
        branches === null || branches.local.length === 0 ? null : E('span', { className: 'git4idea-select-wrap', 'data-tip': branches.branch },
          E(Icon, { name: 'branch', size: 12 }),
          E('button', {
            type: 'button',
            className: 'git4idea-select git4idea-select-btn git4idea-select-branch',
            onClick: openBranchSwitchMenu,
          },
            E('span', { className: 'git4idea-repo-name' }, branches.branch),
            E(Icon, { name: 'chevron', size: 12 }))),
        /* Push, pull and commit sit right of the branch name (m00174): each
           appears only while it has work to do, in IDEA's order — green push
           with the ahead count, blue pull with the behind count, white commit
           with the dirty count. */
        summary === null || summary.ahead === undefined || summary.ahead <= 0 ? null : E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small git4idea-track-btn',
          'data-tip': t('toolbar.push'),
          'aria-disabled': remoteReady !== true || blocked === true ? 'true' : 'false',
          onClick: () => {
            if (remoteReady !== true || blocked === true) return
            openPushDialog()
          },
        }, E('span', { className: 'git4idea-tone-success' },
          E(Icon, { name: 'push', size: 11 }),
          E('span', { className: 'git4idea-track-label' }, t('track.push')),
          E('span', { className: 'git4idea-track-num' }, String(summary.ahead)))),
        summary === null || summary.behind === undefined || summary.behind <= 0 ? null : E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small git4idea-track-btn',
          'data-tip': t('toolbar.pull'),
          'aria-disabled': remoteReady !== true || blocked === true ? 'true' : 'false',
          onClick: () => {
            if (remoteReady !== true || blocked === true) return
            void run('pull', { mode: 'ff-only' })
          },
        }, E('span', { className: 'git4idea-tone-business' },
          E(Icon, { name: 'pull', size: 11 }),
          E('span', { className: 'git4idea-track-label' }, t('track.pull')),
          E('span', { className: 'git4idea-track-num' }, String(summary.behind)))),
        dirty <= 0 ? null : E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small git4idea-track-btn',
          'data-tip': t('changes.commit'),
          onClick: () => {
            if (repoRoot === null) return
            const scopeObject = scope || {}
            commitDialog.set({ sessionId: scopeObject.sessionId, cwd: cwd, repoRoot: repoRoot })
          },
        }, E('span', { className: 'git4idea-track-commit' },
          E(Icon, { name: 'commit', size: 12 }),
          E('span', { className: 'git4idea-track-label' }, t('track.commit')),
          E('span', { className: 'git4idea-track-num' }, String(dirty)))),
        operation === null ? null : E('span', { className: 'git4idea-opgroup' },
          E('button', {
            type: 'button',
            className: 'git4idea-opchip git4idea-opchip-btn',
            'data-tip': conflictedCount > 0 ? fill(t('conflict.openCount'), { n: String(conflictedCount) }) : t('operation.hint'),
            onClick: () => { openConflictOverview() },
          }, t('operation.' + operation) + (conflictedCount > 0 ? ' · ' + String(conflictedCount) : '')),
          E('button', {
            type: 'button', className: 'git4idea-opbtn', 'data-tip': t('operation.continueHint'),
            onClick: () => {
              if (conflictedCount > 0 && openConflictOverview() === true) return
              void run('operationFinish', { operation: operation, action: 'continue' })
            },
          }, t('operation.continue')),
          operation === 'rebase' || operation === 'cherry-pick' || operation === 'revert'
            ? E('button', {
                type: 'button', className: 'git4idea-opbtn', 'data-tip': t('operation.skipHint'),
                onClick: () => { void run('operationFinish', { operation: operation, action: 'skip' }) },
              }, t('operation.skip'))
            : null,
          E('button', {
            type: 'button', className: 'git4idea-opbtn', 'data-tip': t('operation.abortHint'),
            onClick: () => { void run('operationFinish', { operation: operation, action: 'abort' }) },
          }, t('operation.abort'))),
        E('span', { className: 'git4idea-topbar-spacer' }))

      /* The log never leaves the middle column any more: the picked commit
         renders beside it (m01216), so the list stays put while the detail loads. */
      const historyPane = E(HistoryList, {
        t: t, commits: commits, hasMore: hasMore, busy: busy, selectedHash: selectedHash,
        hideSearch: compact, pathFilter: pathFilter, openMenuAt: openMenuAt,
        onPathFilter: (value) => setPathFilter(value),
        onSelect: (commit) => { void selectCommit(commit) },
        onMenu: commitMenu,
        onLoadMore: () => { void guard(() => loadCommits(commits.length)) },
        /* ---- multi-select (issue #13) ---- */
        pickedHashes: pickedCommits,
        onPicksChange: onCommitPicks,
        onSelectAll: (hashes) => onCommitPicks(new Set(hashes)),
        onKeyDown: onHistoryKeyDown,
        mergeAnchor: mergeAnchor,
        base: base,
        request: request,
      })

      const commitDetail = E(CommitDetail, {
        t: t, detail: detail, selectedPath: selectedPath, pane: true,
        onBack: () => { setSelectedPath(null); setPatch(''); setDiffContext(null) },
        /* Plain click only highlights the file; the DOUBLE-click opens its
           diff (v0.18.3, one click model across every list). */
        onSelectFile: (file) => { setSelectedPath(file.path) },
        onOpenFile: (file) => {
          setSelectedPath(file.path)
          showDiff({
            hash: detail === null || detail === undefined ? undefined : detail.hash,
            subject: detail === null || detail === undefined ? '' : detail.subject,
            path: file.path,
          })
        },
        onFileMenu: detailFileMenu,
      })

      /* The commit detail keeps its pane; the tab strip lives on the panel
         root, above every column, so the "日志" tab is the whole Git view. */
      const detailPane = commitDetail

      const diffPane = patch === '' && patchLoading === false ? null : E('div', { className: 'git4idea-diff-pane', 'data-pane': 'diff', style: paneStyle('diff'), onContextMenu: onDiffPaneContextMenu },
        E('div', { className: 'git4idea-diff-head' },
          E('span', { className: 'git4idea-mono git4idea-diff-path' }, selectedPath === null ? '' : selectedPath),
          E('button', { type: 'button', className: 'git4idea-icon-btn', onClick: () => { setPatch(''); setSelectedPath(null); setDiffContext(null) } }, E(Icon, { name: 'close', size: 12 }))),
        E(DiffBody, { patch: patch, loading: patchLoading, t: t }))

      /* ---------- rail (IDE-style left action strip) ---------- */

      const otherBranches = (branches === null ? [] : branches.local).filter((entry) => entry.head !== true)

      const pickBranchMenu = (event, kind) => {
        if (otherBranches.length === 0) { setNote(t('note.noBranches')); return }
        const current = branches === null ? '' : branches.branch
        const icon = kind === 'checkout' ? 'checkout' : kind === 'delete' ? 'trash' : 'compare'
        const tone = kind === 'delete' ? 'danger' : kind === 'compare' ? 'violet' : 'accent'
        openMenuAt(event, otherBranches.map((entry) => ({
          id: kind + ':' + entry.name,
          icon: icon,
          tone: tone,
          label: entry.name,
          run: () => {
            if (kind === 'checkout') { void run('checkout', { branch: entry.name }); return }
            if (kind === 'delete') { setDialog({ kind: 'deleteBranch', name: entry.name }); return }
            if (kind === 'merge') { void run('merge', { branch: entry.name }); return }
            if (kind === 'rebase') { void run('rebase', { onto: entry.name }); return }
            void compareWith(current, entry.name)
          },
        })))
      }

      /* Remote branches (origin/main…): a flat menu, each entry pre-split into
         its remote and branch halves for the destructive confirm. */
      const remoteBranches = branches === null ? [] : branches.remote
      const pickRemoteBranchMenu = (event) => {
        if (remoteBranches.length === 0) { setNote(t('note.noBranches')); return }
        openMenuAt(event, remoteBranches.map((entry) => {
          const slash = entry.name.indexOf('/')
          const remote = slash >= 0 ? entry.name.slice(0, slash) : entry.name
          const branch = slash >= 0 ? entry.name.slice(slash + 1) : entry.name
          return {
            id: 'remote-delete:' + entry.name,
            icon: 'trash', tone: 'danger', danger: true,
            label: entry.name,
            run: () => setDialog({ kind: 'deleteRemoteBranch', remote: remote, branch: branch }),
          }
        }))
      }

      /* Remotes themselves, for "pull from" / "push to" style entries. */
      const remoteNames = branches == null ? [] : branches.remotes.map((entry) => entry.name === undefined ? String(entry) : entry.name)

      const showWorkingDiff = () => {
        const changes = summary === null ? null : summary.changes
        if (changes === null) return
        const order = [
          ['unstaged', changes.unstaged, false],
          ['staged', changes.staged, true],
          ['conflicted', changes.conflicted, false],
          ['untracked', changes.untracked, false],
        ]
        for (const entry of order) {
          if (entry[1].length > 0) { showDiff({ path: entry[1][0].path, staged: entry[2], untracked: entry[0] === 'untracked' }); return }
        }
        setNote(t('note.noChanges'))
      }

      const stashMenu = (event) => {
        const count = summary === null ? 0 : summary.stashCount
        openMenuAt(event, [
          { id: 'stash-push', icon: 'stash', tone: 'violet', label: t('stash.push'), disabled: dirty === 0, reason: t('action.unavailable'), run: () => { void run('stashPush', { includeUntracked: true }) } },
          { id: 'stash-apply', icon: 'checkout', tone: 'accent', label: t('stash.apply'), disabled: count === 0, reason: t('action.unavailable'), run: () => { void run('stashApply', {}) } },
          { id: 'stash-drop', icon: 'trash', tone: 'danger', label: t('stash.drop'), danger: true, disabled: count === 0, reason: t('action.unavailable'), run: () => setDialog({ kind: 'stashDrop', ref: 'stash@{0}' }) },
          null,
          { id: 'stash-count', icon: 'tag', tone: 'secondary', label: fill(t('stash.count'), { n: count }), disabled: true, run: () => {} },
        ])
      }

      /* favorites/toggleFavoriteBranch live above branchMenu: a useCallback dep array is evaluated during render. */
      const headBranch = branches === null ? '' : branches.branch
      const tracked = summary !== null && summary.upstream !== null
      const stashCount = summary === null ? 0 : summary.stashCount
      const reason = t('action.unavailable')

      /* VS Code-style "..." menu — the SCM title menu: view mode, sort, sync,
         changes, branch/stash/tag shortcuts, and the Git-output view at the
         bottom. Every entry reuses the very handlers the rail rows and group
         heads already run, so the menu can never disagree with them. */
      /* The ⋯ menu, restructured to the FULL VS Code SCM ▸ tree (issue: the
         flat 22-item list ignored the submenu anatomy the user asked for).
         Groups are real submenus now (ContextMenu.items[]); every entry maps
         onto an action that already exists elsewhere in the panel, and the
         few new backend verbs (rebaseAbort / remoteAdd / remoteRemove /
         branchDeleteRemote / tagDeleteRemote / pushTags / stashClear) back
         their VS Code counterparts one-to-one. */
      const moreMenu = (event) => {
        const tagCount = branches === null || Array.isArray(branches.tags) !== true ? 0 : branches.tags.length
        const stageable = summary === null ? [] : summary.changes.unstaged.concat(summary.changes.untracked)
        const stagedPaths = summary === null ? [] : summary.changes.staged.map((entry) => entry.path)
        const allChangePaths = stagedPaths.concat(stageable.map((entry) => entry.path))
        const sort = (key) => () => setSortKey(key)
        const operation = summary === null ? null : summary.operation
        const pickRemote = (run) => (ev) => openMenuAt(ev, remoteNames.map((name) => ({
          id: 'remote:' + name, icon: 'fetch', tone: 'violet', label: name,
          run: () => run(name),
        })))
        const pickStash = (verb) => async (ev) => {
          try {
            const data = await request('stashList', base)
            const list = Array.isArray(data.stashes) ? data.stashes : []
            if (list.length === 0) { setNote(t('stash.none')); return }
            openMenuAt(ev, list.map((entry) => ({
              id: 'stash:' + entry.ref, icon: 'stash', tone: 'violet',
              label: entry.ref + ' · ' + entry.subject,
              run: () => { void run('stashApply', { ref: entry.ref, pop: verb === 'pop' }) },
            })))
          } catch (error) { void error }
        }
        openMenuAt(event, [
          /* —— view (VS Code: 以列表形式查看 / 查看和排序 ▸) —— */
          { id: 'view-flat', icon: 'commit', tone: 'secondary', label: t('changes.groupFlat'), active: groupBy === 'flat', run: () => setGroupBy('flat') },
          { id: 'view-dir', icon: 'folder', tone: 'secondary', label: t('changes.groupDir'), active: groupBy === 'dir', run: () => setGroupBy('dir') },
          { id: 'view-sort', icon: 'compare', tone: 'secondary', label: t('more.sort'), items: [
            { id: 'sort-git', label: t('more.sortGit'), active: sortKey === 'git', run: sort('git') },
            { id: 'sort-path', label: t('more.sortPath'), active: sortKey === 'path', run: sort('path') },
            { id: 'sort-name', label: t('more.sortName'), active: sortKey === 'name', run: sort('name') },
            { id: 'sort-status', label: t('more.sortStatus'), active: sortKey === 'status', run: sort('status') },
            null,
            /* The old header toggles live here now (v0.16.1): fold/unfold need
               the directory map, which only exists when grouping is on. */
            { id: 'view-expand', label: t('changes.expandAll'), disabled: groupBy !== 'dir', reason, run: () => setFoldedDirs({}) },
            { id: 'view-fold', label: t('changes.foldAll'), disabled: groupBy !== 'dir', reason, run: () => {
              const next = {}
              const changes = summary === null ? null : summary.changes
              if (changes !== null) {
                const groups = [['conflicted', changes.conflicted], ['staged', changes.staged], ['unstaged', changes.unstaged], ['untracked', changes.untracked], ['ignored', changes.ignored === undefined ? [] : changes.ignored]]
                for (const pair of groups) {
                  /* Fold every node of the compressed tree — the ids come from
                     the same builder the renderer uses, so single-chain nodes
                     ("a/b/c") fold exactly where they render (v0.18.6). */
                  const forest = buildDirForest(pair[1], pair[0])
                  if (forest.rootFiles.length > 0) next[pair[0] + '|/'] = true
                  for (const id of forest.ids) next[id] = true
                }
              }
              setFoldedDirs(next)
            } },
            null,
            { id: 'view-ignored', label: t('changes.showIgnored'), active: showIgnored === true, run: () => setShowIgnored(showIgnored !== true) },
          ] },
          null,
          /* —— top-level sync (VS Code header row) —— */
          { id: 'mm-pull', icon: 'pull', tone: 'accent', label: t('toolbar.pull'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void run('pull', { mode: 'ff-only' }) } },
          { id: 'mm-push', icon: 'push', tone: 'success', label: t('toolbar.push'), disabled: remoteReady !== true || blocked, reason, run: () => openPushDialog() },
          { id: 'mm-clone', icon: 'plus', tone: 'secondary', label: t('more.clone'), run: () => setDialog({ kind: 'clone' }) },
          { id: 'mm-checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout') + '...', disabled: otherBranches.length === 0 || blocked, reason, run: (ev) => pickBranchMenu(ev, 'checkout') },
          { id: 'mm-fetch', icon: 'fetch', tone: 'cyan', label: t('toolbar.fetch'), disabled: remoteReady !== true, reason, run: () => { void run('fetch', { prune: true }) } },
          null,
          /* —— SCM ▸ Commit ▸ —— */
          { id: 'sub-commit', icon: 'commit', tone: 'accent', label: t('more.commitGroup'), items: [
            { id: 'c-staged', label: t('more.commitStaged'), disabled: stagedPaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: false, amend: false, sign: false }) },
            { id: 'c-all', label: t('more.commitAll'), disabled: allChangePaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: true, amend: false, sign: false }) },
            null,
            { id: 'c-undo', label: t('more.undoCommit'), disabled: commits.length === 0 || blocked, reason, run: () => setDialog({ kind: 'undoCommit' }) },
            { id: 'c-abort', label: t('more.abortOperation'), disabled: operation === null, reason, run: () => { void run('operationFinish', { operation: operation, action: 'abort' }) } },
            null,
            { id: 'c-staged-amend', label: t('more.commitStagedAmend'), disabled: stagedPaths.length === 0 || commits.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: false, amend: true, sign: false }) },
            { id: 'c-all-amend', label: t('more.commitAllAmend'), disabled: allChangePaths.length === 0 || commits.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: true, amend: true, sign: false }) },
            null,
            { id: 'c-staged-sign', label: t('more.commitStagedSign'), disabled: stagedPaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: false, amend: false, sign: true }) },
            { id: 'c-all-sign', label: t('more.commitAllSign'), disabled: allChangePaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: true, amend: false, sign: true }) },
          ] },
          /* —— SCM ▸ Changes ▸ —— */
          { id: 'sub-changes', icon: 'file', tone: 'secondary', label: t('more.changesGroup'), items: [
            { id: 'ch-stage', label: t('changes.stageAll'), disabled: stageable.length === 0, reason, run: () => { void run('stage', { paths: stageable.map((entry) => entry.path) }) } },
            { id: 'ch-unstage', label: t('changes.unstageAll'), disabled: stagedPaths.length === 0, reason, run: () => { void run('unstage', { paths: stagedPaths }) } },
            null,
            { id: 'ch-discard', label: t('more.discardAll'), danger: true, disabled: dirty === 0, reason, run: () => setDialog({ kind: 'discardAll' }) },
          ] },
          /* —— SCM ▸ Pull, Push ▸ —— */
          { id: 'sub-pullpush', icon: 'pull', tone: 'accent', label: t('more.pullpushGroup'), items: [
            { id: 'pp-sync', label: t('more.sync'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void (async () => { await run('pull', { mode: 'ff-only' }); await run('push', { confirm: true }) })() } },
            { id: 'pp-sync-rebase', label: t('more.syncRebase'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void (async () => { await run('pull', { mode: 'rebase' }); await run('push', { confirm: true }) })() } },
            null,
            { id: 'pp-pull', label: t('toolbar.pull'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void run('pull', { mode: 'ff-only' }) } },
            { id: 'pp-pull-rebase', label: t('more.pullRebase'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void run('pull', { mode: 'rebase' }) } },
            { id: 'pp-pull-from', label: t('more.pullFrom'), disabled: remoteNames.length === 0, reason, run: pickRemote((name) => { void run('pull', { mode: 'ff-only', remote: name }) }) },
            null,
            { id: 'pp-push', label: t('toolbar.push'), disabled: remoteReady !== true || blocked, reason, run: () => openPushDialog() },
            { id: 'pp-push-force', label: t('more.pushForce'), danger: true, disabled: remoteReady !== true || blocked, reason, run: () => setDialog({ kind: 'pushForce' }) },
            { id: 'pp-push-to', label: t('more.pushTo'), disabled: remoteNames.length === 0 || blocked, reason, run: pickRemote((name) => openPushDialog({ remote: name })) },
            null,
            { id: 'pp-fetch', label: t('toolbar.fetch'), disabled: remoteReady !== true, reason, run: () => { void run('fetch', { prune: true }) } },
            { id: 'pp-fetch-all', label: t('more.fetchAll'), disabled: remoteNames.length === 0, reason, run: () => { void run('fetch', { all: true, prune: true }) } },
          ] },
          /* —— SCM ▸ Branch ▸ —— */
          { id: 'sub-branch', icon: 'branch', tone: 'secondary', label: t('more.branchGroup'), items: [
            { id: 'br-merge', label: t('action.mergeIntoCurrent'), disabled: otherBranches.length === 0 || blocked, reason, run: (ev) => pickBranchMenu(ev, 'merge') },
            { id: 'br-rebase', label: t('action.rebaseCurrentOnto'), disabled: otherBranches.length === 0 || blocked, reason, run: (ev) => pickBranchMenu(ev, 'rebase') },
            null,
            { id: 'br-new', label: t('toolbar.newBranch'), disabled: blocked, reason, run: () => setDialog({ kind: 'newBranch' }) },
            null,
            { id: 'br-rename', label: t('action.rename'), disabled: headBranch === '' || blocked, reason, run: () => setDialog({ kind: 'renameBranch', from: headBranch }) },
            { id: 'br-delete', label: t('action.delete'), danger: true, disabled: otherBranches.length === 0, reason, run: (ev) => pickBranchMenu(ev, 'delete') },
            { id: 'br-delete-remote', label: t('more.deleteRemoteBranch'), danger: true, disabled: remoteBranches.length === 0 || blocked, reason, run: (ev) => pickRemoteBranchMenu(ev) },
            null,
            { id: 'br-publish', label: t('more.publish'), disabled: remoteReady !== true || tracked === true || blocked, reason, run: () => openPushDialog() },
            /* Upstream management for the CURRENT branch (issue #18): same
               verbs as the branch-row menu, reachable without selecting a
               branch first. Submenu built inside run() like rm-remove. */
            { id: 'br-upstream', label: t('more.setUpstreamHead'), icon: 'fetch', tone: 'cyan', disabled: headBranch === '' || remoteBranches.length === 0 || blocked, reason, run: (ev) => openMenuAt(ev, remoteBranches.map((remoteEntry) => ({
              id: 'head-upstream:' + remoteEntry.name,
              icon: 'fetch', tone: 'cyan',
              label: remoteEntry.name,
              active: summary.upstream === remoteEntry.name,
              run: () => { void run('branch-upstream', { branch: headBranch, upstream: remoteEntry.name }) },
            }))) },
            { id: 'br-unset-upstream', label: t('more.unsetUpstreamHead'), icon: 'undo', tone: 'secondary', disabled: headBranch === '' || tracked !== true || blocked, reason, run: () => { void run('branch-upstream', { branch: headBranch, unset: true }) } },
          ] },
          /* —— SCM ▸ Remote ▸ —— */
          { id: 'sub-remote', icon: 'fetch', tone: 'violet', label: t('more.remoteGroup'), items: [
            { id: 'rm-add', label: t('more.addRemote'), run: () => setDialog({ kind: 'remoteAdd' }) },
            { id: 'rm-remove', label: t('more.removeRemote'), danger: true, disabled: remoteNames.length === 0, reason, run: (ev) => openMenuAt(ev, remoteNames.map((name) => ({
              id: 'rm-del:' + name, icon: 'trash', tone: 'danger', danger: true, label: name,
              run: () => setDialog({ kind: 'remoteRemove', name: name }),
            }))) },
          ] },
          /* —— SCM ▸ Stash ▸ —— */
          { id: 'sub-stash', icon: 'stash', tone: 'violet', label: t('more.stashGroup'), items: [
            { id: 'st-push', label: t('more.stashTracked'), disabled: dirty === 0, reason, run: () => { void run('stashPush', {}) } },
            { id: 'st-push-all', label: t('stash.push'), disabled: dirty === 0, reason, run: () => { void run('stashPush', { includeUntracked: true }) } },
            { id: 'st-push-staged', label: t('more.stashStaged'), disabled: stagedPaths.length === 0, reason, run: () => { void run('stashPush', { staged: true }) } },
            null,
            { id: 'st-apply', label: t('stash.apply'), disabled: stashCount === 0, reason, run: () => { void run('stashApply', {}) } },
            { id: 'st-apply-pick', label: t('more.stashApplyPick'), disabled: stashCount === 0, reason, run: pickStash('apply') },
            null,
            { id: 'st-pop', label: t('more.stashPop'), disabled: stashCount === 0, reason, run: () => { void run('stashApply', { pop: true }) } },
            { id: 'st-pop-pick', label: t('more.stashPopPick'), disabled: stashCount === 0, reason, run: pickStash('pop') },
            null,
            { id: 'st-drop', label: t('more.stashDropAny'), danger: true, disabled: stashCount === 0, reason, run: (ev) => pickStash('drop')(ev) },
            { id: 'st-clear', label: t('more.stashClear'), danger: true, disabled: stashCount === 0, reason, run: () => setDialog({ kind: 'stashClear' }) },
          ] },
          /* —— SCM ▸ Tags ▸ —— */
          { id: 'sub-tags', icon: 'tag', tone: 'warn', label: t('more.tagGroup'), items: [
            { id: 'tg-new', label: t('action.newTagHere'), disabled: commits.length === 0, reason, run: () => setDialog({ kind: 'newTag' }) },
            { id: 'tg-delete', label: t('more.deleteTag'), danger: true, disabled: tagCount === 0, reason, run: () => setDialog({ kind: 'deleteTag' }) },
            { id: 'tg-delete-remote', label: t('more.tagDeleteRemote'), danger: true, disabled: tagCount === 0 || remoteNames.length === 0 || blocked, reason, run: () => setDialog({ kind: 'deleteRemoteTag' }) },
            null,
            { id: 'tg-push', label: t('more.pushTags'), disabled: tagCount === 0 || remoteNames.length === 0 || blocked, reason, run: () => setDialog({ kind: 'pushTags' }) },
          ] },
          null,
        ])
      }
      /* One panel spec, two hosts: the compact chrome renders it inline, the
         commit layer renders it as the left half of the overlay (m01216). The
         only difference between the two is where a file click sends its diff. */
      const renderChanges = (onDiff) => E(ChangesPanel, {
        t: t, summary: summary, busy: busy, compact: compact, hideHeader: compact,
        groupBy: groupBy, sortKey: sortKey, onGroupBy: setGroupBy,
        foldedDirs: foldedDirs, onFoldedDirs: setFoldedDirs,
        onMoreMenu: moreMenu,
        request: request, cwd: cwd, sessionId: sessionId, base: base,
        showIgnored: showIgnored,
        onToggleIgnored: () => setShowIgnored((value) => !value),
        // Commit and push are two steps now (m02986): the commit lands, the
        // layer closes, and only then does the push dialog open with the fresh
        // commits. Failures stay in the layer; results go to notifications.
        onCommit: (message, amend, push, paths) => {
          void (async () => {
            /* paths: the ticked set; the host stages exactly these before it
               commits, so an unticked file is never swept in by `git add -A`. */
            const result = await run('commit', { message: message, amend: amend, paths: paths }, { quiet: true })
            /* Only a landed commit closes the layer; a rejected one keeps the
               message on screen while the failure surfaces as a notification. */
            if (result === undefined) return
            pushToast({ text: t('toast.committed'), tone: 'ok', icon: 'check' })
            if (push === true) openPushDialog()
          })()
        },
        onStage: (item) => { void run('stage', { paths: [item.path] }) },
        onUnstage: (item) => { void run('unstage', { paths: [item.path] }) },
        onStageAll: (entries) => { void run('stage', { paths: entries.map((entry) => entry.path) }) },
        onUnstageAll: () => { void run('unstage', { paths: (summary === null ? [] : summary.changes.staged).map((entry) => entry.path) }) },
        onDiscard: (item, group) => setDialog({ kind: 'discard', item: item, group: group }),
        onDiff: onDiff,
        onChangeMenu: changeMenu,
        /* ---- multi-select (issue #13) ---- */
        selection: changeSelection,
        onSelectionChange: onChangeSelection,
        anchorRef: changeAnchor,
        onBulkStage: bulkStageChanges,
        onBulkUnstage: bulkUnstageChanges,
        onBulkDiscard: openDiscardManyDialog,
        onCopySelection: copyChangeSelection,
        onKeyDown: onChangesKeyDown,
      })

      const changesPane = renderChanges((item, group) => {
        if (group === 'conflicted') { openConflict(item.path); return }
        showDiff({ path: item.path, staged: group === 'staged', untracked: group === 'untracked' })
      })

      /* --- Rail acts on the branch-tree selection (v0.18.5) -------------------
         The tree reports its picks up; the rail resolves them back to live
         entries so "select main, press pull" pulls MAIN, not HEAD. With no
         selection every button keeps its old HEAD-oriented behaviour. */
      const pickedBranchEntries = () => {
        const out = []
        if (branches === null || branchPicks.size === 0) return out
        for (const key of branchPicks) {
          const colon = key.indexOf(':')
          const kind = key.slice(0, colon)
          const name = key.slice(colon + 1)
          if (kind === 'local') { const entry = branches.local.find((x) => x.name === name); if (entry !== undefined) out.push({ kind: 'local', name: name, entry: entry }) }
          else if (kind === 'remote') { const entry = branches.remote.find((x) => x.name === name); if (entry !== undefined) out.push({ kind: 'remote', name: name, entry: entry }) }
          else { const entry = branches.tags.find((x) => x.name === name); if (entry !== undefined) out.push({ kind: 'tag', name: name, entry: entry }) }
        }
        return out
      }
      /* "Pull" a branch that is NOT checked out: git pull would merge into
         HEAD, so a non-HEAD branch is fast-forwarded in place via a refspec
         fetch (`git fetch origin name:name` — git refuses a non-ff update,
         which is exactly the safety we want). run() never throws (the guard
         turns failures into a notification), so one bad branch does not
         abort the rest of the batch. */
      const pullPickedBranches = async (picked) => {
        for (const item of picked) {
          if (item.kind !== 'local') continue
          if (item.entry.head === true) { await run('pull', { mode: 'ff-only' }); continue }
          const upstream = item.entry.upstream
          if (upstream === null || upstream === undefined || upstream === '') continue
          const slash = upstream.indexOf('/')
          const remote = slash >= 0 ? upstream.slice(0, slash) : upstream
          await run('fetch', { remote: remote, branch: item.name + ':' + item.name })
        }
      }
      const fetchPickedRefs = async (picked) => {
        for (const item of picked) {
          if (item.kind === 'remote') { await run('fetch', { remote: item.name, prune: true }); continue }
          if (item.kind !== 'local') continue
          const upstream = item.entry.upstream
          if (upstream === null || upstream === undefined || upstream === '') continue
          const slash = upstream.indexOf('/')
          const remote = slash >= 0 ? upstream.slice(0, slash) : upstream
          await run('fetch', { remote: remote, branch: item.name + ':' + item.name })
        }
      }
      const railPicked = pickedBranchEntries()
      const railPickedLocals = railPicked.filter((item) => item.kind === 'local')

      /* One descriptor per action, with the availability IDEA would use: delete /
         checkout / compare need another local branch, fetch and push need a remote,
         pull needs an upstream, diff needs pending changes, tag needs a commit.
         The rail renders a user-chosen subset in a user-chosen order. */
      const railActions = RAIL_SPECS.map((spec) => {
        const entry = { id: spec.id, icon: spec.icon, tone: spec.tone, label: t(spec.key), disabled: false, active: false, run: () => {} }
        if (spec.id === 'tree') {
          // The chevron points at what the click does: right opens a closed
          // branch pane, left closes an open one (m01216 #3).
          entry.active = treeOpen
          entry.icon = treeOpen === true ? 'chevronLeft' : 'chevronRight'
          entry.run = () => foldTree(!treeOpen)
        }
        else if (spec.id === 'newBranch') entry.run = () => setDialog({ kind: 'newBranch' })
        else if (spec.id === 'delete') {
          if (railPicked.length > 0) { entry.label = fill(t('toolbar.deletePicked'), { n: railPicked.length }); entry.disabled = blocked; entry.run = () => deleteBranchEntries(railPicked) }
          else { entry.disabled = otherBranches.length === 0; entry.run = (event) => pickBranchMenu(event, 'delete') }
        }
        else if (spec.id === 'compare') { entry.disabled = otherBranches.length === 0; entry.run = (event) => pickBranchMenu(event, 'compare') }
        else if (spec.id === 'fetch') {
          if (railPicked.length > 0) { entry.label = fill(t('toolbar.fetchPicked'), { n: railPicked.length }); entry.disabled = blocked; entry.run = () => { void fetchPickedRefs(railPicked) } }
          else { entry.disabled = remoteReady !== true; entry.run = () => { void run('fetch', { prune: true }) } }
        }
        else if (spec.id === 'pull') {
          if (railPickedLocals.length > 0) { entry.label = fill(t('toolbar.pullPicked'), { n: railPickedLocals.length }); entry.disabled = blocked; entry.run = () => { void pullPickedBranches(railPickedLocals) } }
          else { entry.disabled = remoteReady !== true || tracked !== true || blocked; entry.run = () => { void run('pull', { mode: 'ff-only' }) } }
        }
        else if (spec.id === 'favorite') {
          // One picked LOCAL branch stars/unstars THAT branch; with no selection
          // it keeps starring the current one. Multi-select stays disabled —
          // favorites are per-branch and the toggle model does not batch well.
          const target = railPickedLocals.length === 1 ? railPickedLocals[0].name : headBranch
          entry.disabled = target === ''
          entry.active = favorites.indexOf(target) >= 0
          entry.run = () => toggleFavoriteBranch(target)
        }
        // A running git command greys out the repository actions, never the view.
        if (busy === true && RAIL_VIEW_IDS.indexOf(spec.id) < 0) entry.disabled = true
        return entry
      })

      const railOrdered = railConfig.order
        .map((id) => railActions.find((action) => action.id === id))
        // An action this mount cannot perform is not rendered at all — hidden, not
        // disabled: a greyed button for a service the host does not have is noise.
        .filter((action) => action !== undefined && action.available !== false)
      const railVisible = railOrdered.filter((action) => railConfig.hidden.indexOf(action.id) < 0)


      const RAIL_SLOT = 26
      const railCapacityOf = (vertical) => {
        const span = vertical ? railBox.height : railBox.width
        if (span <= 0) return railVisible.length + 1
        return Math.max(1, Math.floor((span - (vertical ? 10 : 12)) / RAIL_SLOT))
      }

      /* Renders the rail for one orientation: as many buttons as fit, then a more
         menu that lists EVERY action, then the settings button pinned to the end. */
      const renderRail = (vertical) => {
        const capacity = railCapacityOf(vertical)
        // The settings button is never dropped and never pushed out: the more
        // button only appears when there is room for it AND for settings.
        const overflow = railVisible.length + 1 > capacity && capacity >= 3
        const slots = overflow
          ? Math.max(1, capacity - 2)
          : Math.min(railVisible.length, Math.max(0, capacity - 1))
        // Disabled buttons keep their tooltip: a real `disabled` attribute
        // swallows hover events in the browser, which is exactly why the
        // explanation went missing on a busy repository. aria-disabled only
        // changes the look, the click is guarded below.
        const children = railVisible.slice(0, slots).flatMap((action, index) => [
          // The pane-collapse chevron sits in this same column, above a hairline
          // (IDEA draws it that way); it is never a column of its own.
          index === 1 && vertical === true ? E('span', { key: 'rail-sep', className: 'git4idea-rail-sep' }) : null,
          E('button', {
            key: action.id,
            type: 'button',
            className: 'git4idea-rail-btn'
              + (action.id === 'favorite' ? ' git4idea-rail-star' : '')
              + (action.active === true ? ' git4idea-rail-btn-active' : '')
              + (action.spinning === true ? ' git4idea-spin' : ''),
            'data-action': action.id,
            'aria-pressed': action.active === true ? 'true' : 'false',
            'aria-disabled': action.disabled === true ? 'true' : 'false',
            'data-tip': action.disabled === true ? action.label + ' · ' + reason : action.label,
            onClick: (event) => { if (action.disabled === true) return; action.run(event) },
          }, E(Icon, { name: action.icon, size: 18 })),
        ].filter((node) => node !== null))
        if (overflow === true) {
          children.push(E('button', {
            key: 'more',
            type: 'button',
            className: 'git4idea-rail-btn git4idea-rail-more',
            'data-tip': t('rail.more'),
            onClick: (event) => openMenuAt(event, railActions.map((action) => ({
              id: 'rail:' + action.id,
              icon: action.icon,
              tone: action.tone,
              label: action.label,
              disabled: action.disabled,
              active: action.active,
              reason: reason,
              run: (inner) => action.run(inner === undefined ? event : inner),
            }))),
          }, E(Icon, { name: 'more', size: 18 })))
        }
        return E('div', { className: vertical ? 'git4idea-rail' : 'git4idea-rail-row', ref: railHostRef }, children)
      }

      /* ---------- body per chrome ---------- */

      /* ---------- body per chrome ---------- */

      /* The history↔diff separator only exists while a diff is on screen, and it
         lives inside the middle pane — the diff is the pane below it. */
      const diffGutter = diffPane === null ? null : gutter('diff', 'next')

      let body
      if (repoState === null) {
        /* The scan is still running: a neutral loading state, never the
           "no repository found" verdict (that text is reserved for a scan
           that actually came back empty). */
        body = E('div', { className: 'git4idea-body', ref: bodyRef }, E('div', { className: 'git4idea-empty' }, t('status.loading')))
      } else if (repoRoot === null) {
        body = E('div', { className: 'git4idea-body', ref: bodyRef }, E(RepoPicker, {
          t: t, cwd: cwd === undefined ? '' : cwd, repos: repoOptions, onPick: pickRepo,
        }))
      } else if (compact) {
        body = E('div', { className: 'git4idea-body git4idea-body-compact', ref: bodyRef },
          E('div', { className: 'git4idea-compact-bar' },
            E(Segmented, {
              value: view === 'detail' ? 'history' : view,
              onChange: (next) => { setView(next); setPatch(''); setDiffContext(null) },
              items: [
                { id: 'changes', label: fill(t('seg.changes'), { n: dirty }) },
                { id: 'history', label: t('seg.history') },
              ],
            }),
            E('span', { className: 'git4idea-topbar-spacer' }),
            // Two-way on purpose: treeOpen is persisted, so a header button that
            // only rendered while the tree was OPEN left a folded tree with no way
            // back on this chrome (the rail now carries one too, for the others).
            E('button', {
              type: 'button',
              className: 'git4idea-icon-btn' + (treeOpen ? ' git4idea-icon-btn-active' : ''),
              'data-action': 'tree',
              'aria-pressed': treeOpen ? 'true' : 'false',
              'data-tip': t('toolbar.tree'),
              onClick: () => foldTree(!treeOpen),
            }, E(Icon, { name: treeOpen ? 'chevronLeft' : 'chevronRight' }))),
          treeOpen ? E('div', { className: 'git4idea-compact-tree', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          view === 'changes' ? changesPane : view === 'detail'
            ? E('div', { className: 'git4idea-pane git4idea-pane-main git4idea-pane-detail' }, detailPane)
            : E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane))
      } else if (columns) {
        // The collapse chevron lives in the action rail, in the same column as the
        // other buttons (m01216 #3), so a folded tree needs no strip of its own.
        body = E('div', { className: 'git4idea-body git4idea-body-columns', ref: bodyRef },
          treeOpen ? E('div', { className: 'git4idea-pane git4idea-pane-tree', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane),
          gutter('changes', 'next'),
          /* Third column = the picked commit (m01216): changed files over the
             message. It keeps the 'changes' pane key so stored widths survive. */
          E('div', { className: 'git4idea-pane git4idea-pane-changes git4idea-pane-detail', 'data-pane': 'changes', style: paneStyle('changes') }, detailPane))
      } else {
        body = E('div', { className: 'git4idea-body git4idea-body-stack', ref: bodyRef },
          treeOpen ? E('div', { className: 'git4idea-pane git4idea-pane-tree-stack', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          E('div', { className: 'git4idea-pane git4idea-pane-changes-stack git4idea-pane-detail', 'data-pane': 'changes', style: paneStyle('changes') }, detailPane),
          gutter('changes', 'prev'),
          E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane))
      }

      /* ---------- overlays ---------- */

      const overlays = []
      if (menu !== null) {
        overlays.push(E(ContextMenu, {
          key: 'menu',
          anchor: { x: menu.x, y: menu.y },
          boundsWidth: menu.boundsWidth,
          boundsHeight: menu.boundsHeight,
          items: menu.items,
          onClose: () => setMenu(null),
        }))
      }
      if (dialog !== null && (dialog.kind === 'newBranch' || dialog.kind === 'createTracking' || dialog.kind === 'renameBranch' || dialog.kind === 'newTag' || dialog.kind === 'deleteTag' || dialog.kind === 'commitMsg')) {
        const titles = { newBranch: t('prompt.newBranch'), createTracking: t('prompt.createTracking'), renameBranch: t('prompt.renameBranch'), newTag: t('prompt.newTag'), deleteTag: t('prompt.deleteTag'), commitMsg: t('prompt.commitMessage') }
        overlays.push(E(PromptDialog, {
          key: 'prompt',
          title: titles[dialog.kind],
          placeholder: dialog.from === undefined ? t('prompt.fromHead') : dialog.from,
          initialValue: dialog.kind === 'renameBranch' ? dialog.from : (dialog.kind === 'createTracking' ? dialog.name : ''),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (value) => { void submitDialog(dialog, value) },
        }))
      }
      if (dialog !== null && dialog.kind === 'clone') {
        overlays.push(E(CloneDialog, {
          key: 'clone',
          title: t('clone.title'),
          urlPlaceholder: t('clone.url'),
          dirPlaceholder: t('clone.dir'),
          okLabel: t('clone.run'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (url, dir) => { setDialog(null); void run('clone', { url: url, dir: dir }) },
        }))
      }
      /* SCM ▸ additions (v0.15): each destructive one is a ConfirmDialog whose
         text names the exact target; the tag/remote ones carry the picked
         remote through. */
      if (dialog !== null && dialog.kind === 'undoCommit') {
        overlays.push(E(ConfirmDialog, {
          key: 'undoCommit', t: t,
          title: t('confirm.title'),
          text: t('confirm.undoCommit'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void undoLastCommit() },
        }))
      }
      if (dialog !== null && dialog.kind === 'discardAll') {
        overlays.push(E(ConfirmDialog, {
          key: 'discardAll', t: t,
          title: t('confirm.title'),
          text: t('confirm.discardAll'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void discardAllChanges() },
        }))
      }
      if (dialog !== null && dialog.kind === 'pushForce') {
        overlays.push(E(ConfirmDialog, {
          key: 'pushForce', t: t,
          title: t('confirm.title'),
          text: t('confirm.pushForce'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); openPushDialog({ force: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'deleteRemoteBranch') {
        overlays.push(E(ConfirmDialog, {
          key: 'deleteRemoteBranch', t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.deleteRemoteBranch'), { remote: dialog.remote, branch: dialog.branch }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const r = dialog.remote; const b = dialog.branch; setDialog(null); void run('branchDeleteRemote', { remote: r, branch: b, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'remoteAdd') {
        overlays.push(E(CloneDialog, {
          key: 'remoteAdd',
          title: t('more.addRemote'),
          urlPlaceholder: t('prompt.remoteName'),
          dirPlaceholder: t('prompt.remoteUrl'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (name, url) => { setDialog(null); void run('remoteAdd', { name: name, url: url }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'remoteRemove') {
        overlays.push(E(ConfirmDialog, {
          key: 'remoteRemove', t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.remoteRemove'), { name: dialog.name }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const n = dialog.name; setDialog(null); void run('remoteRemove', { name: n, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'stashClear') {
        overlays.push(E(ConfirmDialog, {
          key: 'stashClear', t: t,
          title: t('confirm.title'),
          text: t('confirm.stashClear'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('stashClear', { confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'deleteRemoteTag') {
        overlays.push(E(PromptDialog, {
          key: 'deleteRemoteTag',
          title: t('more.tagDeleteRemote'),
          placeholder: fill(t('prompt.deleteRemoteTag'), { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0] }),
          initialValue: '',
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (name) => { setDialog(null); void run('tagDeleteRemote', { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0], name: name, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'pushTags') {
        overlays.push(E(ConfirmDialog, {
          key: 'pushTags', t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.pushTags'), { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0] }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('pushTags', { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0], confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'deleteBranch') {
        const guarded = isProtectedBranch(dialog.name)
        overlays.push(E(ConfirmDialog, {
          key: 'delete',
          t: t,
          title: t('confirm.title'),
          text: fill(guarded ? t('confirm.protected') : t('delete.confirm'), { name: dialog.name }),
          requireText: guarded ? dialog.name : undefined,
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const name = dialog.name; setDialog(null); void deleteBranch(name) },
        }))
      }
      if (dialog !== null && dialog.kind === 'stashDrop') {
        overlays.push(E(ConfirmDialog, {
          key: 'stashDrop',
          t: t,
          title: t('confirm.title'),
          text: fill(t('stashDrop.confirm'), { ref: dialog.ref }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const ref = dialog.ref; setDialog(null); void dropStash(ref) },
        }))
      }
      /* Multi-select delete (issue #13): local branches / remote branches / tags
         in ONE confirm — each rides its existing destructive host method, and a
         protected local branch keeps the type-the-name gate. */
      if (dialog !== null && dialog.kind === 'deleteRefs') {
        const guardedName = dialog.locals.find((name) => isProtectedBranch(name) === true)
        const listed = dialog.locals
          .concat(dialog.tags)
          .concat(dialog.remotes.map((item) => item.remote + '/' + item.branch))
        const listText = listed.length <= 8 ? listed.join('、') : listed.slice(0, 8).join('、') + ' …'
        overlays.push(E(ConfirmDialog, {
          key: 'deleteRefs',
          t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.deleteRefs'), { b: dialog.locals.length, r: dialog.remotes.length, g: dialog.tags.length })
            + (listText === '' ? '' : ' ' + listText),
          requireText: guardedName === undefined ? undefined : guardedName,
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            const locals = dialog.locals
            const tags = dialog.tags
            const remotes = dialog.remotes
            setDialog(null)
            if (locals.length > 0) void deleteBranches(locals)
            if (tags.length > 0) void run('tagDelete', { names: tags })
            const byRemote = new Map()
            for (const item of remotes) {
              if (byRemote.has(item.remote) === false) byRemote.set(item.remote, [])
              byRemote.get(item.remote).push(item.branch)
            }
            for (const pair of byRemote) void run('branchDeleteRemote', { remote: pair[0], branches: pair[1], confirm: true })
          },
        }))
      }
      /* Multi-select discard: tracked paths go through `checkout --`, untracked
         through `clean -fd` — the same two-lane split as Discard All. */
      if (dialog !== null && dialog.kind === 'discardMany') {
        overlays.push(E(ConfirmDialog, {
          key: 'discardMany',
          t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.discardMany'), { n: dialog.tracked.length + dialog.untracked.length })
            + (dialog.untracked.length > 0 ? ' ' + fill(t('confirm.discardManyUntracked'), { m: dialog.untracked.length }) : ''),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            const tracked = dialog.tracked
            const untracked = dialog.untracked
            setDialog(null)
            if (tracked.length > 0) void run('discard', { paths: tracked, confirm: true })
            if (untracked.length > 0) void run('discard', { paths: untracked, untracked: true, confirm: true })
          },
        }))
      }
      if (dialog !== null && dialog.kind === 'discard') {
        overlays.push(E(ConfirmDialog, {
          key: 'discard',
          t: t,
          title: t('confirm.title'),
          text: dialog.group === 'untracked'
            ? fill(t('discard.untracked.confirm'), { path: dialog.item.path })
            : fill(t('discard.confirm'), { path: dialog.item.path }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            const item = dialog.item
            const group = dialog.group
            setDialog(null)
            void discardChanges(item, group)
          },
        }))
      }
      if (dialog !== null && dialog.kind === 'reset') {
        overlays.push(E(ConfirmDialog, {
          key: 'reset', t: t,
          title: t('confirm.title'),
          text: dialog.mode === 'hard' ? fill(t('resetHard.confirm'), { hash: dialog.hash.slice(0, 8) }) : fill(t('resetSoft.confirm'), { hash: dialog.hash.slice(0, 8) }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('reset', { hash: dialog.hash, mode: dialog.mode, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'checkoutCommit') {
        overlays.push(E(ConfirmDialog, {
          key: 'checkoutCommit', t: t,
          title: t('confirm.title'), text: fill(t('checkoutCommit.confirm'), { hash: dialog.hash.slice(0, 8) }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('checkout', { branch: dialog.hash }) },
        }))
      }
      // Batch push of the picked local branches — one confirmation naming every
      // branch, then a plain `git push origin name` per branch (each sets its
      // own upstream when it does not track one yet).
      if (dialog !== null && dialog.kind === 'pushMany') {
        overlays.push(E(ConfirmDialog, {
          key: 'pushMany', t: t,
          title: t('confirm.title'), text: fill(t('push.confirmMany'), { n: dialog.items.length, names: dialog.items.map((item) => item.name).join(', ') }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            setDialog(null)
            void (async () => {
              for (const item of dialog.items) {
                await run('push', { branch: item.name, confirm: true, setUpstream: item.upstream === null || item.upstream === undefined })
              }
            })()
          },
        }))
      }

      // Wide chromes (the bottom workbench) get the vertical IDE rail on the left;
      // narrow ones (the native right sidebar) get the same actions as one
      // horizontal row under the repo/branch bar, and every action lives in
      // exactly one place.
      // While a divider is being dragged the whole panel stops selecting text and
      // keeps the resize cursor, even though the pointer has left the 8px gutter.
      /* 日志 / 控制台 / 工作树 wrap the whole view, not only the detail pane:
         IDEA puts its tab strip above the tree and the log alike. The log tab
         receives the current chrome (rail + shell) as children. */
      const logBody = E(Fragment, null,
        columns === true || repoRoot === null ? null : renderRail(false),
        E('div', { className: 'git4idea-shell' },
          columns === true && repoRoot !== null ? renderRail(true) : null,
          body))

      return E('div', {
        className: 'git4idea-root'
          + (compact ? ' git4idea-root-narrow' : '')
          + (paneDragging === null ? '' : ' git4idea-pane-dragging' + (paneByWidth ? '-v' : '-h')),
        ref: hostRef,
      },
        E(Workbench, {
          t: t, base: base, request: request,
          /* The tab strip sits above the branch row (m00174), so the branch
             bar travels with the workbench and paints under the tabs. */
          topBar: topBar,
          branch: summary === null ? '' : summary.branch,
          selectedHash: selectedHash,
          branches: branches, repoRoot: repoRoot,
          consoleTick: consoleTick,
          showTabs: repoState !== null && repoRoot !== null,
          openMenuAt: openMenuAt,
          notifyOk: notifyOk,
        }, logBody),
        overlays)
    }

    function copyText(text) {
      try {
        void navigator.clipboard.writeText(text)
      } catch (error) { void error }
    }

    /* The branch context menu is text-only (user request): IDEA's glyph column
       is noise there, so the rows carry labels only. Submenu rows are flattened
       the same way before they reach the shared ContextMenu. */
    function withoutIcons(items) {
      return items.map((item) => (item === null ? null : Object.assign({}, item, { icon: undefined })))
    }

