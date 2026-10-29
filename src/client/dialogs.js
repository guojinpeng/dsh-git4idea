    function GitDialogHost(props) {
      const [entry, setEntry] = useState(commitDialog.entry)
      const [pushEntry, setPushEntry] = useState(pushDialog.entry)
      useEffect(() => {
        const sync = () => setEntry(commitDialog.entry)
        const syncPush = () => setPushEntry(pushDialog.entry)
        sync()
        syncPush()
        const off = commitDialog.subscribe(sync)
        const offPush = pushDialog.subscribe(syncPush)
        commitDialog.hosted = true
        pushDialog.hosted = true
        return () => {
          commitDialog.hosted = false
          pushDialog.hosted = false
          off()
          offPush()
        }
      }, [])
      /* A throw inside either card used to unmount the overlay slot for the rest
         of the page load — the card vanished once and never came back (m04102).
         The boundary keeps the failure local, closes the card and reports it in
         the corner toast (m04914). The old fallback bar sat at the top of the
         page, far from the click, and read as a broken page. */
      const guard = (key, onClose, child) => E(RenderBoundary, {
        key: key,
        silent: true,
        onError: () => {
          toastCenter.push({ text: props.t('toast.dialogFailed'), tone: 'error', icon: 'close' })
          onClose()
        },
      }, child)
      return E(Fragment, null,
        entry === null ? null : guard('commit|' + entry.sessionId + '|' + entry.repoRoot, () => commitDialog.set(null), E(CommitDialogBody, {
          key: entry.sessionId + '|' + entry.repoRoot,
          entry: entry,
          t: props.t,
          onClose: () => commitDialog.set(null),
        })),
        pushEntry === null ? null : guard('push|' + pushEntry.sessionId + '|' + pushEntry.repoRoot, () => { pushDialog.set(null) }, E(PushDialogBody, {
          key: 'push|' + pushEntry.sessionId + '|' + pushEntry.repoRoot,
          entry: pushEntry,
          t: props.t,
          ctx: props.ctx,
          onClose: () => { pushDialog.set(null) },
        })),
        E(PromptDialogHost, null))
    }

    /* The card is the panel's commit layer, rebuilt without the panel: every
       mutation runs its own route call and reloads the summary, so the overlay
       never depends on a mounted Git tab. */
    function CommitDialogBody(props) {
      const t = props.t
      const entry = props.entry
      const [summary, setSummary] = useState(null)
      const [busy, setBusy] = useState(false)
      const [groupBy, setGroupBy] = useState('flat')
      const [foldedDirs, setFoldedDirs] = useState({})
      const [rowMenu, setRowMenu] = useState(null)
      const [discardAsk, setDiscardAsk] = useState(null)
      const anchorRef = useRef(null)
      /* m05307: the row click selects (and previews in the right pane); the
         checkbox still decides what the commit carries. */
      const [selection, setSelection] = useState(() => new Set())
      const [picked, setPicked] = useState(null)
      const base = { cwd: entry.cwd, repoRoot: entry.repoRoot }
      const messageOf = (caught) => (caught !== null && caught !== undefined && typeof caught.message === 'string' && caught.message !== ''
        ? caught.message
        : String(caught))
      const loadSummary = async () => {
        try {
          const data = await request('summary', Object.assign({}, base, { ignored: false, stats: true }))
          setSummary(data)
          return data
        } catch (caught) {
          notifyFail(caught)
          return null
        }
      }
      useEffect(() => { void loadSummary() }, [])
      /* One mutation at a time: staging, discarding and committing all reload
         the same summary, so overlapping calls would race their results. */
      const call = async (method, payload) => {
        setBusy(true)
        try {
          await request(method, Object.assign({}, base, payload))
          await loadSummary()
          notifyOk(successToastText(t, method, payload))
          return true
        } catch (caught) {
          notifyFail(caught)
          return false
        } finally {
          setBusy(false)
        }
      }
      /* m04916: the menu entry and the double click open the file card above
         this dialog. m05307: a plain row click previews the patch in this
         card's right pane, split 40/60 with the change list. */
      const openDiff = (item, group) => {
        fileDialog.set({
          path: item.path,
          staged: group === 'staged',
          untracked: group === 'untracked' ? true : undefined,
          cwd: entry.cwd,
          repoRoot: entry.repoRoot,
          sessionId: entry.sessionId,
        })
      }
      /* A landed commit closes the card and tells every branch readout to
         refresh; a rejected one reports in the bottom-right stack.
         ChangesPanel has already cleared its draft by the time this returns.
         m02986: the push is a second, explicit step — hand over to the push
         dialog only after the commit route reports success. */
      const commit = (message, amend, push, paths) => {
        void (async () => {
          setBusy(true)
          try {
            await request('commit', Object.assign({}, base, {
              message: message,
              amend: amend === true,
              paths: paths,
            }))
            try { notifyBranchSwitched(entry.sessionId, entry.repoRoot) } catch (caught) { void caught }
            toastCenter.push({ text: t('toast.committed'), tone: 'ok', icon: 'check' })
            if (push === true) pushDialog.set({ cwd: entry.cwd, repoRoot: entry.repoRoot, sessionId: entry.sessionId })
            props.onClose()
          } catch (caught) {
            notifyFail(caught)
            setBusy(false)
          }
        })()
      }
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (rowMenu !== null) { setRowMenu(null); return }
          if (discardAsk !== null) { setDiscardAsk(null); return }
          props.onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [rowMenu, discardAsk, props.onClose])
      const stagedPaths = () => (summary === null ? [] : summary.changes.staged.map((item) => item.path))
      const rowMenuItems = rowMenu === null ? [] : [
        rowMenu.group === 'staged'
          ? { id: 'unstage', icon: 'minus', label: t('action.unstage'), run: () => { void call('unstage', { paths: [rowMenu.item.path] }) } }
          : { id: 'stage', icon: 'plus', label: t('action.stage'), run: () => { void call('stage', { paths: [rowMenu.item.path] }) } },
        { id: 'diff', icon: 'diff', label: t('action.showDiff'), run: () => { void openDiff(rowMenu.item, rowMenu.group) } },
        null,
        {
          id: 'discard', icon: 'undo', danger: true, label: t('action.discard'),
          run: () => setDiscardAsk({ item: rowMenu.item, group: rowMenu.group }),
        },
      ]
      return E('div', {
        className: 'git4idea-commit-overlay',
        'data-git4idea-commit-dialog': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() },
      },
        E('div', { className: 'git4idea-commit-layer-card', 'data-git4idea-commit-card': '' },
          E('div', { className: 'git4idea-commit-layer-head' },
            E(Icon, { name: 'commit', size: 13 }),
            E('span', { className: 'git4idea-commit-layer-title' }, t('changes.title')),
            E('span', { className: 'git4idea-topbar-spacer' }),
            E('button', {
              type: 'button', className: 'git4idea-icon-btn', 'data-tip': t('confirm.cancel'),
              onClick: () => props.onClose(),
            }, E(Icon, { name: 'close', size: 12 }))),
          E('div', { className: 'git4idea-commit-layer-body' },
            E('div', { className: 'git4idea-commit-layer-left' },
              E(ChangesPanel, {
                t: t, summary: summary, busy: busy, compact: false, hideHeader: true,
                groupBy: groupBy, sortKey: 'git', onGroupBy: setGroupBy,
                foldedDirs: foldedDirs, onFoldedDirs: setFoldedDirs,
                request: request, cwd: entry.cwd, sessionId: entry.sessionId,
                base: base,
                onCommit: commit,
                onStage: (item) => { void call('stage', { paths: [item.path] }) },
                onUnstage: (item) => { void call('unstage', { paths: [item.path] }) },
                onStageAll: (entries) => { void call('stage', { paths: entries.map((item) => item.path) }) },
                onUnstageAll: () => { void call('unstage', { paths: stagedPaths() }) },
                onDiscard: (item, group) => setDiscardAsk({ item: item, group: group }),
                onDiff: (item, group) => { openDiff(item, group) },
                onChangeMenu: (event, item, group) => setRowMenu({ item: item, group: group, x: event.clientX, y: event.clientY }),
                /* The checkbox is the commit pick; the row click only
                   selects, and feeds the right-hand preview (m05307). */
                selection: selection,
                onSelectionChange: setSelection,
                onSelect: (item, group) => setPicked({ item: item, group: group }),
                anchorRef: anchorRef,
              })),
            E('div', { className: 'git4idea-commit-layer-right' },
              picked === null
                ? E('div', { className: 'git4idea-preview-root' },
                    E('div', { className: 'git4idea-preview-body' },
                      E('div', { className: 'git4idea-empty' }, t('changes.diffHint'))))
                : E(DiffPreview, {
                    key: picked.group + ':' + picked.item.path,
                    seed: {
                      path: picked.item.path,
                      staged: picked.group === 'staged',
                      untracked: picked.group === 'untracked' ? true : undefined,
                      cwd: entry.cwd,
                      repoRoot: entry.repoRoot,
                      sessionId: entry.sessionId,
                    },
                    t: t,
                  })))),
        discardAsk === null ? null : E(ConfirmDialog, {
          key: 'discard',
          t: t,
          title: t('confirm.title'),
          text: discardAsk.group === 'untracked'
            ? fill(t('discard.untracked.confirm'), { path: discardAsk.item.path })
            : fill(t('discard.confirm'), { path: discardAsk.item.path }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDiscardAsk(null),
          onConfirm: () => {
            const item = discardAsk.item
            const group = discardAsk.group
            setDiscardAsk(null)
            void call('discard', { paths: [item.path], confirm: true, untracked: group === 'untracked' })
          },
        }),
        rowMenu === null ? null : E(ContextMenu, {
          key: 'row-menu',
          anchor: { x: rowMenu.x, y: rowMenu.y },
          boundsWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
          boundsHeight: typeof window === 'undefined' ? 0 : window.innerHeight,
          items: rowMenuItems,
          onClose: () => setRowMenu(null),
        }))
    }

    function ComposerGitStatus(props) {
      const ctx = props.ctx
      const t = props.t
      const sessionId = typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : 'default'
      const [enabled] = useState(() => composerStatusEnabled())
      const [cwd, setCwd] = useState(() => sessionCwdOf(ctx, sessionId))
      /* Warm first paint: a workspace the panel, the pill or the prewarmer
         has already visited starts from the keep-warm cache, so a session
         switch swaps text instead of flashing through an empty pill. */
      const [repoState, setRepoState] = useState(() => {
        const cwd0 = sessionCwdOf(ctx, sessionId)
        if (cwd0 === undefined) return null
        const cached = readPaintRepos(cwd0)
        return cached === undefined ? null : cached
      })
      const [repoRoot, setRepoRoot] = useState(() => {
        const cwd0 = sessionCwdOf(ctx, sessionId)
        if (cwd0 === undefined) return null
        const cached = readPaintRepos(cwd0)
        return cached === undefined ? null : composerPickRepoOf(sessionId, cached)
      })
      const [summary, setSummary] = useState(null)
      const [menu, setMenu] = useState(null)
      const [branchList, setBranchList] = useState(null)
      const [branchLoading, setBranchLoading] = useState(false)
      const [checkingOut, setCheckingOut] = useState('')
      const [tick, setTick] = useState(0)
      /* Branch popover (m01216 #10): a searchable local/remote/tag tree, the
         fetch button beside the search box, and commit/push/new-branch at the
         bottom. Everything here runs on this pill's own API calls — it lives in
         the host composer and cannot reach the panel. */
      const [branchFilter, setBranchFilter] = useState('')
      /* Folded folders of the popover tree, keyed by slash path. Absent means
         open — the tree starts expanded like the IDE's branch chooser. */
      const [csFolded, setCsFolded] = useState({})
      /* Secondary menu for a row (m01737 #5): a click SELECTS, it never checks
         out. { entry, kind, x, y } — offsets inside the popover root. */
      const [csMenu, setCsMenu] = useState(null)
      const [csBusy, setCsBusy] = useState('')
      const rootRef = useRef(null)
      /* Measured to place the row flyout: the popover's right edge decides
         whether it opens to the right or flips to the left of the popover. */
      const popRef = useRef(null)
      /* Read by the fast `head` probe: it compares against the summary the
         pill currently shows, not a private baseline, so the first probe after
         a mount can already spot a checkout made while the page was closed. */
      const summaryRef = useRef(null)
      summaryRef.current = summary

      /* cwd follows the session list, exactly like ConversationPanel. */
      useEffect(() => {
        let alive = true
        const sync = () => { if (alive === true) setCwd(sessionCwdOf(ctx, sessionId)) }
        sync()
        let unsubscribe
        try {
          const sessions = ctx.get('sessions')
          const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
          if (list !== undefined && list !== null && typeof list.subscribe === 'function') unsubscribe = list.subscribe(sync)
        } catch (error) { void error }
        return () => {
          alive = false
          if (typeof unsubscribe === 'function') { try { unsubscribe() } catch (error) { void error } }
        }
      }, [ctx, sessionId])

      /* Discovery per workspace; the pick order matches the panel's (remembered
         repo → workspace root when it is a repository → first row). */
      useEffect(() => {
        if (cwd === undefined || enabled !== true) { setRepoState(null); setRepoRoot(null); setSummary(null); return undefined }
        let cancelled = false
        const applyRepos = (data) => {
          setRepoState(data)
          setRepoRoot(composerPickRepoOf(sessionId, data))
        }
        /* Warm seed first: a workspace the panel, the pill or the prewarmer
           already visited paints its labels this tick; the request below
           silently re-proves them. A failed refresh must not evict a good
           seed — only fall back to the empty state when nothing is on
           screen. */
        const seeded = readPaintRepos(cwd)
        if (seeded !== undefined) applyRepos(seeded)
        void (async () => {
          try {
            const data = await request('repos', { cwd: cwd })
            if (cancelled === true) return
            writePaintRepos(cwd, data)
            applyRepos(data)
          } catch (error) { void error; if (cancelled !== true && seeded === undefined) setRepoState({ repos: [], isRepo: false }) }
        })()
        return () => { cancelled = true }
      }, [cwd, sessionId, enabled])

      /* Summary on a slow poll: the branch name only. The panel keeps its own
         12s poll for its bigger surface; 30s here is only the ambient state,
         never a correctness dependency. */
      useEffect(() => {
        if (repoRoot === null || enabled !== true) { setSummary(null); return undefined }
        let cancelled = false
        const load = async () => {
          try {
            const data = await request('summary', { cwd: cwd, repoRoot: repoRoot, stats: false })
            if (cancelled === true) return
            setSummary(data)
            /* Stale-while-revalidate both ways: our poll keeps the warm page
               (panel / prewarm / seed) fresh, and a warm page seeds the NEXT
               mount with zero round trips. Merge only our field — a panel
               page keeps its commits. */
            mergePaintPage(repoRoot, { summary: data })
          } catch (error) { void error }
        }
        const seed = readPaintPage(repoRoot)
        if (seed !== undefined && seed.summary !== undefined && seed.summary !== null) setSummary(seed.summary)
        void load()
        const timer = setInterval(() => { void load() }, COMPOSER_POLL_MS)
        return () => { cancelled = true; clearInterval(timer) }
      }, [cwd, repoRoot, enabled, tick])

      /* A checkout made in a terminal or an IDE fires no watcher (m02856), and
         the summary poll is 30s by design. Probe branch + HEAD every couple of
         seconds and reload the summary only on a real move; waking on tab focus
         covers the moment the user is about to look at the pill. */
      useEffect(() => {
        if (repoRoot === null || enabled !== true) return undefined
        let cancelled = false
        const probe = async () => {
          /* A hidden tab needs no updates; the wake listeners above probe the
             moment it becomes visible again. */
          if (document.visibilityState === 'hidden') return
          try {
            const state = await request('head', { cwd: cwd, repoRoot: repoRoot })
            if (cancelled === true) return
            const current = summaryRef.current
            if (current === null) return
            const sig = String(state.head) + '|' + String(state.branch)
            const shown = String(current.head === undefined ? '' : current.head) + '|' + String(current.branch === undefined ? '' : current.branch)
            if (sig === shown) return
            setTick((value) => value + 1)
            /* The popover marks HEAD on one row; while it is open, keep that
               marker true too — a summary tick does not reload the tree. */
            if (menu === 'branch') void loadBranches()
          } catch (error) { void error }
        }
        const timer = setInterval(() => { void probe() }, COMPOSER_HEAD_POLL_MS)
        const wake = () => { if (document.visibilityState !== 'hidden') void probe() }
        document.addEventListener('visibilitychange', wake)
        window.addEventListener('focus', wake)
        void probe()
        return () => {
          cancelled = true
          clearInterval(timer)
          document.removeEventListener('visibilitychange', wake)
          window.removeEventListener('focus', wake)
        }
      }, [cwd, repoRoot, enabled, menu])

      /* The panel picking a repo (or this pill picking one in another seat)
         lands here: follow it so both seats always show the same repository. */
      useEffect(() => {
        const watcher = (sid, root) => {
          if (sid !== sessionId || typeof root !== 'string' || root === '') return
          setRepoRoot((current) => (current === root ? current : root))
          setSummary(seedSummaryOf(root))
          setBranchList(null)
          setTick((value) => value + 1)
        }
        composerRepoWatchers.add(watcher)
        return () => { composerRepoWatchers.delete(watcher) }
      }, [sessionId])

      /* A branch switched in the panel (or here) refreshes the summary now
         instead of at the next poll tick. */
      useEffect(() => {
        const watcher = () => { setTick((value) => value + 1) }
        composerBranchWatchers.add(watcher)
        return () => { composerBranchWatchers.delete(watcher) }
      }, [sessionId])

      /* Click-away closes the dropdown; nothing here is anchored to a panel
         (.git4idea-root) — the pill lives in the host's composer DOM, so the menu
         is positioned inside this relative root. */
      useEffect(() => {
        if (menu === null) return undefined
        const close = (event) => {
          const el = rootRef.current
          if (el !== null && el !== undefined && event.target !== null && event.target !== undefined
            && typeof Node === 'function' && event.target instanceof Node === true && el.contains(event.target) === true) return
          setMenu(null)
        }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [menu])

      if (enabled !== true) return null
      const data = repoState
      if (data === null || (data.isRepo !== true && (data.repos === undefined || data.repos.length === 0))) return null
      const branchName = summary !== null && typeof summary.branch === 'string' && summary.branch !== '' ? summary.branch : null
      const detached = summary !== null && summary.detached === true

      /* Split out of openBranchMenu so a fetch can refresh the refs WITHOUT
         closing the popover (m02697 #4). A warm page (panel or prewarm) fills the
         list this tick; the request below re-proves it. On failure keep whatever
         is showing. */
      const loadBranches = async () => {
        const seed = readPaintPage(repoRoot)
        const seeded = seed !== undefined && seed.branches !== undefined && seed.branches !== null ? seed.branches : null
        if (seeded !== null) setBranchList(seeded)
        setBranchLoading(seeded === null)
        try {
          const branchesData = await request('branches', { cwd: cwd, repoRoot: repoRoot })
          setBranchList(branchesData)
          mergePaintPage(repoRoot, { branches: branchesData })
        } catch (caught) { void caught } finally { setBranchLoading(false) }
      }
      const openBranchMenu = async () => {
        setMenu('branch')
        await loadBranches()
      }
      const checkoutBranch = async (name) => {
        if (repoRoot === null || checkingOut !== '') return
        setCheckingOut(name)
        try {
          await request('checkout', { cwd: cwd, repoRoot: repoRoot, branch: name, confirm: true })
          setMenu(null)
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
          notifyOk(fill(t('toast.checkedOut'), { name: name }))
        } catch (caught) {
          setMenu(null)
          notifyFail(caught)
        } finally { setCheckingOut('') }
      }
      /* Popover actions (m01216 #10). Nothing here may depend on panel state:
         the pill lives in the host composer, outside the panel's React tree. */
      /* Every popover verb answers in the frame notifications (m05310): the
         success line and the failure line both, whether the chooser closes or
         stays open. */
      const csSuccessText = (action, payload) => {
        const p = payload === null || payload === undefined ? {} : payload
        if (action === 'fetch') return t('toast.fetchDone')
        if (action === 'pull') return t('toast.pullDone')
        if (action === 'push') return t('toast.pushDone')
        if (action === 'merge') return fill(t('toast.merged'), { name: String(p.branch) })
        if (action === 'tagDelete') return fill(t('toast.tagDeleted'), { name: String(p.name) })
        if (action === 'branchDelete') return fill(t('toast.branchDeleted'), { name: String(p.name) })
        if (action === 'branchDeleteRemote') return t('toast.remoteBranchDeleted')
        if (action === 'stashDrop') return fill(t('toast.stashDropped'), { ref: String(p.ref) })
        return ''
      }
      const csCall = async (action, payload, options) => {
        if (repoRoot === null || csBusy !== '') return
        const keepOpen = options !== undefined && options.keepOpen === true
        const toastText = options !== undefined && typeof options.toast === 'string' ? options.toast : ''
        setCsBusy(action)
        try {
          const result = await request(action, Object.assign({ cwd: cwd, repoRoot: repoRoot }, payload))
          /* fetch keeps the chooser on screen (m02697 #4): it refreshes the same
             list the user is looking at, so closing it would undo the point. */
          if (keepOpen !== true) setMenu(null)
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
          /* A merge that stops on conflicts exits 0-as-data, not as a refusal:
             report it instead of closing as if it had succeeded cleanly. */
          if (action === 'merge' && result !== null && result !== undefined && result.conflicted === true) {
            const output = typeof result.output === 'string' ? result.output.trim() : ''
            const text = output === '' ? t('toast.mergedConflict') : output
            toastCenter.push({ text: text, tone: 'error' })
          } else {
            notifyOk(toastText !== '' ? toastText : csSuccessText(action, payload))
          }
        } catch (caught) {
          if (keepOpen !== true) setMenu(null)
          notifyFail(caught)
        } finally { setCsBusy('') }
      }
      const openPanelSeat = () => {
        try {
          const sidebarRight = ctx.get('sidebarRight')
          if (sidebarRight !== undefined && sidebarRight !== null && typeof sidebarRight.openTab === 'function') {
            sidebarRight.openTab(NATIVE_KIND)
            setMenu(null)
          }
        } catch (caught) { void caught }
      }
      /* 提交 raises the message card HERE (m02090). It used to open the sidebar
         seat, which then needed a second click on the tab's own 提交 button —
         two surfaces and two clicks for one verb. The frame-wide overlay is
         mounted by this module's shell.overlay seat; a host without that slot
         falls back to the seat so the verb never dies silently. */
      const openCommitDialog = () => {
        if (repoRoot === null) { openPanelSeat(); return }
        if (overlaySeatReady === true) {
          commitDialog.set({ sessionId: sessionId, cwd: cwd, repoRoot: repoRoot })
          setMenu(null)
          return
        }
        openPanelSeat()
      }
      /* Push followed the commit dialog (m02986): the popover verb previews
         the commits and files instead of publishing on a bare confirm. */
      const openPushDialog = () => {
        if (repoRoot === null) { openPanelSeat(); return }
        if (overlaySeatReady === true) {
          pushDialog.set({ sessionId: sessionId, cwd: cwd, repoRoot: repoRoot })
          setMenu(null)
          return
        }
        openPanelSeat()
      }
      /* Name prompts (new branch, rename) live in the FRAME overlay, centered on
         the window (m03873). The chooser closes first: the card is not part of
         its scroll body and must survive the popover closing. */
      const openBranchPrompt = (options) => {
        if (repoRoot === null) return
        if (overlaySeatReady !== true) { openPanelSeat(); return }
        promptDialog.set(Object.assign({}, options, {
          cancelLabel: t('confirm.cancel'),
          okLabel: t('confirm.ok'),
          onCancel: () => { promptDialog.set(null) },
        }))
        setMenu(null)
        setCsMenu(null)
      }
      /* 更新 works on the SELECTED branch (m03873). The checked-out branch is
         pulled ff-only; any other branch is fast-forwarded in place by a
         refspec fetch, which git refuses to move backwards. */
      const updateBranch = async (entry) => {
        if (repoRoot === null || csBusy !== '') return
        const toastText = fill(t('toast.branchUpdated'), { name: entry.name })
        if (entry.head === true) {
          await csCall('pull', { mode: 'ff-only' }, { toast: toastText })
          return
        }
        const upstream = entry.upstream === null || entry.upstream === undefined ? '' : String(entry.upstream)
        const slash = upstream.indexOf('/')
        const remote = slash > 0 ? upstream.slice(0, slash) : 'origin'
        const remoteBranch = slash > 0 ? upstream.slice(slash + 1) : entry.name
        await csCall('fetch', { remote: remote, branch: remoteBranch + ':' + entry.name }, { toast: toastText })
      }
      /* 推送 ships the SELECTED branch (m03873). The checked-out branch keeps
         the full push card, which previews the commits and files; any other
         branch has no preview route, so it pushes straight from the row. */
      const pushBranch = async (entry) => {
        if (repoRoot === null || csBusy !== '') return
        if (entry.head === true) { openPushDialog(); return }
        const upstream = entry.upstream === null || entry.upstream === undefined ? '' : String(entry.upstream)
        const slash = upstream.indexOf('/')
        const remote = slash > 0 ? upstream.slice(0, slash) : 'origin'
        const upstreamBranch = slash > 0 ? upstream.slice(slash + 1) : entry.name
        const refspec = upstreamBranch === entry.name ? entry.name : entry.name + ':' + upstreamBranch
        await csCall('push', {
          remote: remote, branch: refspec, confirm: true, setUpstream: slash <= 0,
        }, { toast: fill(t('toast.branchPushed'), { name: entry.name }) })
      }
      /* A remote row that has no local twin is checked out as a tracking branch
         in one step (the panel's row menu does the same). Only the secondary
         menu calls this: a row click never changes the working tree by itself. */
      const csCheckout = (entry, kind) => {
        if (kind !== 'remote') { void checkoutBranch(entry.name); return }
        const slash = entry.name.indexOf('/')
        const local = slash >= 0 ? entry.name.slice(slash + 1) : entry.name
        const exists = branchList !== null && branchList.local.some((item) => item.name === local)
        if (exists === true) { void checkoutBranch(local); return }
        void (async () => {
          if (repoRoot === null || checkingOut !== '') return
          setCheckingOut(entry.name)
          try {
            await request('checkout', {
              cwd: cwd, repoRoot: repoRoot, branch: local, create: true,
              startPoint: entry.name, track: true, confirm: true,
            })
            setMenu(null)
            setTick((value) => value + 1)
            notifyBranchSwitched(sessionId, repoRoot)
            notifyOk(fill(t('toast.branchCreated'), { name: local }))
          } catch (caught) {
            setMenu(null)
            notifyFail(caught)
          } finally { setCheckingOut('') }
        })()
      }
      const csDelete = (entry, kind) => {
        if (kind === 'tags') { void csCall('tagDelete', { name: entry.name }); return }
        if (kind === 'remote') {
          const slash = entry.name.indexOf('/')
          void csCall('branchDeleteRemote', {
            remote: slash >= 0 ? entry.name.slice(0, slash) : entry.name,
            branch: slash >= 0 ? entry.name.slice(slash + 1) : entry.name,
            confirm: true,
          })
          return
        }
        void csCall('branchDelete', { name: entry.name, confirm: true })
      }
      /* Row menu (m01737 #5, floated beside the popover since m02697 #2): a
         click SELECTS the row and shows the IDEA verb list next to the chooser,
         anchored on that row. The list cannot live inside the popover body —
         that box scrolls and clips — but it must not push the tree either, so
         it is a root-level floating layer. Offsets are root-relative because the
         composer seat is the containing block. */
      const openCsMenu = (entry, kind, event) => {
        if (csMenu !== null && csMenu.entry === entry && csMenu.kind === kind) { setCsMenu(null); return }
        const root = rootRef.current
        const pop = popRef.current
        const rootRect = root !== null && root !== undefined ? root.getBoundingClientRect() : { left: 0, top: 0 }
        const popRect = pop !== null && pop !== undefined ? pop.getBoundingClientRect() : null
        const rowRect = event !== undefined && event !== null && event.currentTarget !== null && event.currentTarget !== undefined
          ? event.currentTarget.getBoundingClientRect() : null
        /* Four verbs: 4 * 26 + 8 padding, plus the shadow gutter. The flyout
           itself is max-content (m03424): a long ref makes the card wider
           instead of truncating, so the flip estimate measures the longest
           label rather than assuming the 240px minimum. */
        const labelWidthOf = (text) => {
          let width = 0
          for (const character of String(text)) {
            width += character.codePointAt(0) > 0x2E80 ? 12 : 6.6
          }
          return width
        }
        const items = csMenuItems({ entry: entry, kind: kind })
        const widestLabel = items
          .reduce((widest, item) => Math.max(widest, labelWidthOf(item.label)), 0)
        const flyoutWidth = Math.max(240, Math.ceil(widestLabel) + 44)
        /* One 26px row per verb plus the 8px padding (m03873 grew the local
           list from four to seven, so the height can no longer be a constant). */
        const flyoutHeight = 8 + items.length * 26
        const gutter = 6
        const viewportWidth = typeof window === 'undefined' ? 0 : (window.innerWidth || 0)
        const viewportHeight = typeof window === 'undefined' ? 0 : (window.innerHeight || 0)
        let x = popRect === null ? 0 : popRect.right - rootRect.left + gutter
        /* Flip to the popover's left side when the right edge is too close to
           the viewport, the way the IDE keeps a submenu on screen. */
        if (popRect !== null && viewportWidth > 0 && popRect.right + gutter + flyoutWidth > viewportWidth - 8) {
          x = popRect.left - rootRect.left - flyoutWidth - gutter
        }
        if (x < 4) x = 4
        /* The chooser opens UPWARD from the composer, so a row's root-relative
           top is negative by design — clamping it to 0 would drop the menu onto
           the pill. Clamp against the viewport instead. */
        let y = rowRect === null ? 0 : rowRect.top - rootRect.top
        if (viewportHeight > 0) {
          const maxY = viewportHeight - rootRect.top - flyoutHeight - 8
          const minY = 8 - rootRect.top
          if (y > maxY) y = maxY
          if (y < minY) y = minY
        }
        setCsMenu({ entry: entry, kind: kind, x: x, y: y })
      }
      const csMenuItems = (sel) => {
        const entry = sel.entry
        const kind = sel.kind
        const local = kind === 'local'
        const blocked = entry.worktree !== null || checkingOut !== ''
        /* The four verbs the IDEA row menu offers (m02697 #3). Merge always runs
           in the direction IDEA words it: the SELECTED ref is merged INTO the
           branch checked out right now, never the other way round. */
        return [
          {
            id: 'checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout'),
            disabled: entry.head === true || blocked,
            run: () => { setCsMenu(null); csCheckout(entry, kind) },
          },
          {
            id: 'newBranch', icon: 'branchCreate', tone: 'success',
            label: t(kind === 'remote' ? 'action.createLocalBranch' : 'action.newBranchFrom'),
            run: () => {
              setCsMenu(null)
              openBranchPrompt({
                key: 'new|' + kind + '|' + entry.name,
                title: t('toolbar.newBranch'),
                text: entry.name,
                initialValue: kind === 'remote' ? entry.name.slice(entry.name.indexOf('/') + 1) : '',
                placeholder: t('prompt.newBranch'),
                onSubmit: async (name) => {
                  const payload = {
                    cwd: cwd, repoRoot: repoRoot, branch: name, create: true, confirm: true,
                    startPoint: entry.name,
                  }
                  /* Only a REMOTE start point may bind an upstream: `--track` on a
                     local name git cannot resolve as a tracking ref fails the
                     whole checkout. */
                  if (kind === 'remote') payload.track = true
                  await request('checkout', payload)
                  promptDialog.set(null)
                  setTick((value) => value + 1)
                  notifyBranchSwitched(sessionId, repoRoot)
                  notifyOk(fill(t('toast.branchCreated'), { name: name }))
                },
              })
            },
          },
          {
            id: 'merge', icon: 'compare', tone: 'violet',
            label: fill(t('action.mergeInto'), { from: entry.name, to: branchName === null ? '' : branchName }),
            disabled: entry.head === true || branchName === null || blocked,
            run: () => { setCsMenu(null); void csCall('merge', { branch: entry.name }) },
          },
          /* Local rows only (m03873): update and push act on the SELECTED ref,
             not on HEAD; rename needs a local branch to move. The checked-out
             row keeps working too — pull/push then mean what they say on it. */
          local ? {
            id: 'update', icon: 'fetch', label: t('action.updateBranch'),
            disabled: csBusy !== '',
            run: () => { setCsMenu(null); void updateBranch(entry) },
          } : null,
          local ? {
            id: 'push', icon: 'push', label: t('action.push'),
            disabled: csBusy !== '',
            run: () => { setCsMenu(null); void pushBranch(entry) },
          } : null,
          local ? {
            id: 'rename', icon: 'file', label: t('action.rename'),
            disabled: csBusy !== '',
            run: () => {
              setCsMenu(null)
              openBranchPrompt({
                key: 'rename|' + entry.name,
                title: t('action.rename'),
                text: entry.name,
                initialValue: entry.name,
                placeholder: t('prompt.renameBranch'),
                onSubmit: async (name) => {
                  if (name === entry.name) { promptDialog.set(null); return }
                  await request('branchRename', {
                    cwd: cwd, repoRoot: repoRoot, from: entry.name, to: name,
                  })
                  promptDialog.set(null)
                  setTick((value) => value + 1)
                  if (entry.head === true) notifyBranchSwitched(sessionId, repoRoot)
                  notifyOk(fill(t('toast.branchRenamed'), { from: entry.name, to: name }))
                },
              })
            },
          } : null,
          {
            id: 'delete', icon: 'trash', tone: 'danger', danger: true, label: t('action.delete'),
            disabled: entry.head === true && local,
            run: () => { setCsMenu(null); csDelete(entry, kind) },
          },
          /* Remote rows get no update/push/rename (m03873), so the list can
             carry holes — drop them once here; the caller measures and counts
             the same array. */
        ].filter((item) => item !== null)
      }
      const csFlyout = () => (csMenu === null ? null : E('div', {
        className: 'git4idea-cs-flyout',
        'data-cordis-panel': '',
        style: { left: String(csMenu.x) + 'px', top: String(csMenu.y) + 'px' },
      }, csMenuItems(csMenu).map((item) => E('button', {
        key: item.id,
        type: 'button',
        className: 'git4idea-cs-sub-item',
        'data-tone': item.danger === true ? 'danger' : (item.tone === undefined ? 'secondary' : item.tone),
        'aria-disabled': item.disabled === true ? 'true' : 'false',
        'data-tip': csMenu.entry.name,
        onClick: () => { if (item.disabled !== true) item.run() },
      }, E(Icon, { name: item.icon, size: 12 }), E('span', { className: 'git4idea-cs-sub-label' }, item.label)))))
      const csNeedle = branchFilter.trim().toLowerCase()
      const csEntries = (list) => (Array.isArray(list) ? list : []).filter((entry) => csNeedle === ''
        || String(entry.name).toLowerCase().indexOf(csNeedle) >= 0)
      /* Branch tree (m01737 #3): names are split on "/" into folders, the shape
         the IDEA chooser shows. A search hides nothing but forces every folder
         open, so a filtered tree never hides its own hits. */
      const csLeaf = (entry, kind, depth) => E('button', {
        key: kind + ':' + entry.name,
        type: 'button',
        className: 'git4idea-cs-item',
        'data-current': entry.head === true ? 'true' : 'false',
        'data-menu': csMenu !== null && csMenu.entry === entry ? 'true' : 'false',
        disabled: entry.worktree !== null || checkingOut !== '',
        style: { paddingLeft: String(6 + depth * 12) + 'px' },
        'data-tip': entry.worktree !== null ? t('composer.inWorktree') : (checkingOut !== '' ? t('composer.busy') : entry.name),
        onClick: (event) => { openCsMenu(entry, kind, event) },
      },
        E(Icon, { name: kind === 'tags' ? 'tag' : 'branch', size: 11 }),
        E('span', { className: 'git4idea-cs-item-name' }, entry.name.slice(entry.name.lastIndexOf('/') + 1)),
        entry.worktree !== null ? E('span', { className: 'git4idea-cs-item-note' }, t('composer.inWorktree')) : null,
        checkingOut === entry.name ? E('span', { className: 'git4idea-cs-item-note' }, '…') : null,
        /* Every row advertises the menu with a tail chevron (m02697 #2): the
           user should not have to click a row to discover the verbs. */
        E('span', { className: 'git4idea-cs-item-tail' },
          entry.ahead > 0 || entry.behind > 0
            ? E('span', { className: 'git4idea-cs-item-counts' },
              entry.ahead > 0 ? E('span', { className: 'git4idea-cs-ahead' }, E(Icon, { name: 'push', size: 10 }), String(entry.ahead)) : null,
              entry.behind > 0 ? E('span', { className: 'git4idea-cs-behind' }, E(Icon, { name: 'pull', size: 10 }), String(entry.behind)) : null)
            : null,
          E(Icon, { name: 'chevronRight', size: 10 })))
      const csTree = (key, label, entries, kind) => {
        if (entries.length === 0) return null
        const root = { folders: new Map(), leaves: [] }
        for (const entry of entries) {
          const parts = String(entry.name).split('/')
          let node = root
          for (let i = 0; i < parts.length - 1; i += 1) {
            const part = parts[i]
            if (node.folders.has(part) !== true) node.folders.set(part, { folders: new Map(), leaves: [] })
            node = node.folders.get(part)
          }
          node.leaves.push(entry)
        }
        const rows = [E('div', { key: key + '-head', className: 'git4idea-cs-head' }, label)]
        const walk = (node, prefix, depth) => {
          node.folders.forEach((child, name) => {
            const path = prefix === '' ? name : prefix + '/' + name
            /* Closed unless opened (m00324): a fresh chooser must not dump
               every remote's branches; a search still forces folders open. */
            const closed = csNeedle === '' && csFolded[path] !== true
            rows.push(E('button', {
              key: key + ':dir:' + path,
              type: 'button',
              className: 'git4idea-cs-item git4idea-cs-folder',
              style: { paddingLeft: String(6 + depth * 12) + 'px' },
              onClick: () => { setCsFolded((map) => Object.assign({}, map, { [path]: map[path] !== true })) },
            },
              E(Icon, { name: closed === true ? 'chevronRight' : 'chevron', size: 10 }),
              E(Icon, { name: 'folder', size: 11 }),
              E('span', { className: 'git4idea-cs-item-name' }, name)))
            if (closed !== true) walk(child, path, depth + 1)
          })
          for (const entry of node.leaves) {
            rows.push(csLeaf(entry, kind, depth))
          }
        }
        walk(root, '', 0)
        return rows
      }
      /* Swap to a warm summary synchronously when one exists — the null gap
         between pick and effect would paint one empty frame. */
      const seedSummaryOf = (root) => {
        if (typeof root !== 'string' || root === '') return null
        const seed = readPaintPage(root)
        return seed !== undefined && seed.summary !== undefined && seed.summary !== null ? seed.summary : null
      }

      return E('div', {
        ref: rootRef,
        className: 'git4idea-cs-root',
        'data-dsh-git4idea-status': '',
      },
        branchName !== null ? E('button', {
          type: 'button',
          className: 'git4idea-cs-pill',
          'data-tip': t('composer.branchHint'),
          'aria-expanded': menu === 'branch' ? 'true' : 'false',
          onClick: () => {
            setCsMenu(null)
            if (menu !== 'branch') { void openBranchMenu() } else { setMenu(null) }
          },
        },
          E(Icon, { name: 'branch', size: 14 }),
          E(ComposerMarqueeName, { text: detached === true ? t('composer.detached') : branchName }),
          /* The pill shows only the glyphs (m00312): the count stays in the
             tooltip, because digits made the narrow capsule jump per commit. */
          summary === null || summary.ahead === undefined || summary.ahead <= 0 ? null
            : E('span', { className: 'git4idea-cs-pill-count git4idea-tone-success', 'data-tip': t('track.push') + ' ' + summary.ahead },
              E(Icon, { name: 'push', size: 10 })),
          summary === null || summary.behind === undefined || summary.behind <= 0 ? null
            : E('span', { className: 'git4idea-cs-pill-count git4idea-tone-business', 'data-tip': t('track.pull') + ' ' + summary.behind },
              E(Icon, { name: 'pull', size: 10 })),
          E(Icon, { name: 'chevron', size: 10 })) : null,
        /* The old red "×" chip sat inside the composer and read as a failed
           switch even while the switch was still running (m01737 #5). Errors
           now live in the popover's own bar and in the pill tooltip. */
        menu === 'branch' ? (branchLoading === true || branchList === null
          ? E('div', { className: 'git4idea-cs-menu', 'data-cordis-panel': '' }, E('div', { className: 'git4idea-cs-item git4idea-cs-static' }, '…'))
          : (() => {
            const sections = [].concat(
              csTree('local', t('branches.local'), csEntries(branchList.local), 'local') || [],
              csTree('remote', t('branches.remote'), csEntries(branchList.remote), 'remote') || [],
            )
            return E('div', { ref: popRef, className: 'git4idea-cs-menu git4idea-cs-branches', 'data-cordis-panel': '' },
              E('div', { className: 'git4idea-cs-search' },
                E('input', {
                  className: 'git4idea-cs-input', value: branchFilter, spellCheck: false,
                  placeholder: t('branches.filter'),
                  onChange: (event) => setBranchFilter(event.target.value),
                }),
                E('button', {
                  type: 'button', className: 'git4idea-cs-tool',
                  'data-tip': t('toolbar.fetch'),
                  'aria-disabled': repoRoot === null || csBusy !== '' ? 'true' : 'false',
                  /* Fetch keeps the chooser open (m02697 #4): it refreshes the
                     refs the user is looking at, then reloads that same list. */
                  onClick: () => {
                    void (async () => {
                      await csCall('fetch', { prune: true }, { keepOpen: true })
                      await loadBranches()
                    })()
                  },
                }, E(Icon, { name: 'fetch', size: 13 }))),
              /* Actions sit under the search box and above the tree, one per row
                 (m01737 #6) — they read as verbs on the branch list below them,
                 not as a footer. */
              E('div', { className: 'git4idea-cs-actions' },
                E('button', { type: 'button', className: 'git4idea-cs-action', 'data-tip': t('changes.commit'), onClick: openCommitDialog },
                  E(Icon, { name: 'commit', size: 12 }), E('span', null, t('changes.commit'))),
                E('button', {
                  type: 'button', className: 'git4idea-cs-action', 'data-tip': t('toolbar.push'),
                  'aria-disabled': repoRoot === null || csBusy !== '' ? 'true' : 'false',
                  onClick: openPushDialog,
                }, E(Icon, { name: 'push', size: 12 }), E('span', null, t('toolbar.push'))),
                E('button', {
                  type: 'button', className: 'git4idea-cs-action', 'data-tip': t('toolbar.newBranch'),
                  onClick: () => {
                    openBranchPrompt({
                      key: 'new|head',
                      title: t('toolbar.newBranch'),
                      text: branchName === null ? '' : branchName,
                      initialValue: '',
                      placeholder: t('prompt.newBranch'),
                      onSubmit: async (name) => {
                        await request('checkout', {
                          cwd: cwd, repoRoot: repoRoot, branch: name, create: true, confirm: true,
                        })
                        promptDialog.set(null)
                        setTick((value) => value + 1)
                        notifyBranchSwitched(sessionId, repoRoot)
                        notifyOk(fill(t('toast.branchCreated'), { name: name }))
                      },
                    })
                  },
                }, E(Icon, { name: 'plus', size: 12 }), E('span', null, t('toolbar.newBranch')))),
              E('div', {
                className: 'git4idea-cs-sections',
                /* The flyout is anchored to a row: once the tree scrolls, that
                   anchor is stale, so the menu closes instead of drifting. */
                onScroll: () => { if (csMenu !== null) setCsMenu(null) },
              },
                sections.length === 0 ? E('div', { className: 'git4idea-cs-item git4idea-cs-static' }, t('filter.none')) : sections),
              )
          })())
          : null,
        /* Root-level sibling of the popover, not a child of it: the popover body
           clips and scrolls, which would cut the menu off. */
        menu === 'branch' ? csFlyout() : null,
      )
    }

    /* The conversation shell re-renders on EVERY keystroke (the composer owns
       the draft state), and the view area re-renders with it. Without a bail-out
       at this boundary that cascade dragged the ENTIRE Git panel tree — branch
       rows, graph lanes, changes — through a synchronous render per keypress
       while the Git view was the active one (typing lag, reported against
       v0.13.0). The component consumes exactly three stable props (sessionId,
       t, ctx); everything else the slot passes (inspectCall, viewRequest, …)
       changes identity per shell render and is deliberately ignored, so the
       comparator is: same session, same bindings → skip the subtree. cwd moves
       through the sessions subscription inside, not through props. */
    const ConversationPanel = memo(function ConversationPanel(props) {
      const ctx = props.ctx
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [cwd, setCwd] = useState(() => sessionCwdOf(ctx, sessionId))
      /* Immersive mode (issue #8 round 3): when on, the seat declares the
         host's composer-overlay contract (`data-conversation-composer-overlay`)
         and the conversation view area goes `flex: 1 1 0; min-height: 0;
         overflow: hidden` — the panel fills the WHOLE conversation height and
         scrolls inside itself, with the composer seat hidden away (CSS keeps
         the blocking approvals visible). The v0.13.2 pin-to-scrollport
         machinery below is the FALLBACK for immersive-off: it exists because
         the active view area is `flex: 1 0 auto` (content height) in the
         normal layout, which is exactly what the overlay contract replaces. */
      const [immersive] = useState(() => conversationImmersiveEnabled())
      /* The active conversation's view area is `flex: 1 0 auto; min-height:
         auto` — it GROWS with content and scrolls inside the shared
         conversation scrollport. An auto-height panel there measured
         content-tall (a 120-commit history, a long diff), so the width-vs-
         height chrome test flipped the wide seat into the stacked sidebar
         layout and everything shifted downward (v0.13.1 report). Pin the seat
         to the scrollport's VISIBLE height instead: the panel fills exactly
         the on-screen area and scrolls internally, the way the sidebar seats
         behave. */
      const seatRef = useRef(null)
      const [seatHeight, setSeatHeight] = useState(null)
      useEffect(() => {
        const el = seatRef.current
        if (el === null) return undefined
        /* Immersive ON: the host's overlay layout owns this seat's height
           (the view area is the flex child now) — no pinning, no convergence,
           none of the scrollport arithmetic below applies. Toggling the
           setting re-runs this effect through the dependency below, so the
           fallback machinery spins back up on the way off. */
        if (immersive === true) return undefined
        /* Leftover wheel scroll, root cause: the composer seat is sticky, but a
           sticky box still occupies FLOW space inside the scrollport, so even
           with the panel seat pinned to the visible height the scrollHeight
           stays clientHeight + that flow space — the wheel could still scroll
           the whole window by exactly that leftover (user report: the layout
           fits, yet the page keeps scrolling). v0.13.3 report: content mounts
           or changes AFTER the first pass (the composer, the hero, a diff), and
           a single feedback convergence is not enough. measure() therefore
           recomputes the UNCORRECTED base (base.current) and hands off to the
           CONTROLLED CONVERGER below, which is re-run by every trigger: the
           initial mount, rAF/timeout follow-ups, the scrollport's own resize
           (ResizeObserver) and window resizes, and — new — the scrollport's
           content mutations (MutationObserver, debounced), because content
           growing later re-opens the overflow without resizing the scrollport
           itself. */
        const leftover = { current: 0 }
        const base = { current: 0 }
        /* The converger: up to FOUR rAF-spaced rounds. Each round reads
           scroll.scrollHeight - scroll.clientHeight; anything over 1px shrinks
           the seat by exactly that amount and OVERWRITES the leftover record
           (never adds — every corrected height derives from the fresh base, so
           repeated rounds cannot compound), clamped at the same 240 floor.
           Shrink-only: nothing here grows the seat back. A host without the
           conversation scrollport never reaches this code — measure() skips it
           all, silently, and never throws. */
        const converge = (scroll) => {
          let rounds = 0
          const step = () => {
            rounds += 1
            if (el.isConnected !== true) return
            const overflow = scroll.scrollHeight - scroll.clientHeight
            if (overflow <= 1) return
            leftover.current = overflow
            setSeatHeight(Math.max(240, base.current - overflow))
            if (rounds < 4) requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }
        const measure = () => {
          let scroll = null
          try { scroll = el.closest('[data-conversation-scroll]') } catch (error) { void error }
          if (scroll === null || scroll === undefined) return
          const offset = Math.max(0, el.getBoundingClientRect().top - scroll.getBoundingClientRect().top)
          base.current = Math.round(scroll.clientHeight - offset - 8)
          const corrected = base.current - leftover.current
          if (corrected >= 240) setSeatHeight(corrected)
          converge(scroll)
        }
        measure()
        const raf = requestAnimationFrame(() => { measure() })
        const late = setTimeout(() => { measure() }, 400)
        let observer
        try {
          const scroll = el.closest('[data-conversation-scroll]')
          if (scroll !== null && scroll !== undefined && typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(() => { measure() })
            observer.observe(scroll)
          }
        } catch (error) { void error }
        /* Content that mounts or changes later does not resize the scrollport,
           so the ResizeObserver stays silent while the overflow re-opens; the
           mutation watcher re-measures for it. Debounced ~120ms so a mount
           burst converges once instead of once per node. */
        let mutationObserver
        let mutationTimer = null
        try {
          const scroll = el.closest('[data-conversation-scroll]')
          if (scroll !== null && scroll !== undefined && typeof MutationObserver === 'function') {
            mutationObserver = new MutationObserver(() => {
              if (mutationTimer !== null) clearTimeout(mutationTimer)
              mutationTimer = setTimeout(() => { mutationTimer = null; measure() }, 120)
            })
            mutationObserver.observe(scroll, { childList: true, subtree: true })
          }
        } catch (error) { void error }
        window.addEventListener('resize', measure)
        return () => {
          cancelAnimationFrame(raf)
          clearTimeout(late)
          if (mutationTimer !== null) clearTimeout(mutationTimer)
          if (mutationObserver !== undefined) mutationObserver.disconnect()
          if (observer !== undefined) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [immersive])
      useEffect(() => {
        let alive = true
        const sync = () => { if (alive === true) setCwd(sessionCwdOf(ctx, sessionId)) }
        sync()
        /* The session list is a live store; without a subscription a later
           start (first message in a blank session) would leave the tab on the
           no-repo chrome until the next remount. The notify walks are cheap:
           getSnapshot + a string compare, and setCwd with an identical string
           bails out without a render. */
        let unsubscribe
        try {
          const sessions = ctx.get('sessions')
          const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
          if (list !== undefined && typeof list.subscribe === 'function') unsubscribe = list.subscribe(sync)
        } catch (error) { void error }
        return () => {
          alive = false
          if (typeof unsubscribe === 'function') {
            try { unsubscribe() } catch (error) { void error }
          }
        }
      }, [ctx, sessionId])
      const scope = useMemo(() => ({ cwd: cwd, sessionId: sessionId }), [cwd, sessionId])
      /* The overlay marker rides the SEAT element (a viewArea descendant): the
         host's `.scrollBody:has([data-conversation-composer-overlay])` rules
         pick it up from anywhere inside, flipping the view area to
         `flex: 1 1 0; min-height: 0; overflow: hidden` (full-height, internal
         scrolling) and the composer seat to an overlay. `data-immersive`
         drives the plugin's own CSS (composer hide + width-handle hide). */
      const immersiveAttrs = immersive === true
        ? { 'data-conversation-composer-overlay': '', 'data-immersive': '1' }
        : {}
      return E('div', Object.assign({
        ref: seatRef,
        className: 'git4idea-conversation-seat',
        style: immersive === true ? { height: '100%' } : (seatHeight === null ? undefined : { height: seatHeight + 'px' }),
      }, immersiveAttrs), E(LocaleLive, { ctx: ctx, scope: scope, t: props.t, visible: true }))
    }, (prev, next) => prev.sessionId === next.sessionId && prev.t === next.t && prev.ctx === next.ctx)

    function NativePanel(props) {
      const workspaces = typeof props.useWorkspaces === 'function'
        ? props.useWorkspaces(NATIVE_WORKSPACE_ITEMS)
        : null
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : 'default'
      let cwd
      if (Array.isArray(workspaces)) {
        for (const item of workspaces) {
          if (item === null || typeof item !== 'object') continue
          if (!Array.isArray(item.sessionIds) || item.sessionIds.indexOf(sessionId) < 0) continue
          if (typeof item.path === 'string' && item.path !== '') cwd = item.path
          break
        }
      }
      const scope = useMemo(() => ({ cwd: cwd, sessionId: sessionId }), [cwd, sessionId])
      /* The dock actions need this tab's own identity, which only this seat
         binds; the conversation-area seat has no sidebarRight tab id and
         therefore wires nothing (a panel hosted elsewhere must not float a
         foreign tab). */
      const dock = readDockInfo(props.useTabInfo, props.ctx)
      return E(LocaleLive, { ctx: props.ctx, scope: scope, t: props.t, visible: true, dock: dock })
    }

