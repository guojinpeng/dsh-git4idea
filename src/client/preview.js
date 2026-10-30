    /* The native preview tab's body (external diff preview): shows exactly one
       diff — whatever the store holds — fetched fresh from the host route on
       every seed. The seed carries cwd + repoRoot so a multi-root workspace
       lands on the right repository (the route requires cwd; repoRoot skips
       the rev-parse). Rendered through the SAME DiffBody the inline pane uses,
       so host DiffBlock reuse, the hand-drawn fallback and the binary/empty
       states are all identical. */
    function DiffPreview(props) {
      const t = props.t
      const seed = props.seed
      const seedKey = seed === null
        ? ''
        : (seed.hash !== undefined && seed.hash !== null
          ? 'c:' + String(seed.hash) + ':' + String(seed.path !== undefined && seed.path !== null ? seed.path : '')
          : 'w:' + String(seed.staged === true) + ':' + String(seed.untracked === true) + ':' + String(seed.path))
      const [state, setState] = useState({ loading: false, patch: '', error: null })
      const [refreshTick, setRefreshTick] = useState(0)
      const [copied, setCopied] = useState(false)
      const copyTimer = useRef(null)
      useEffect(() => () => { if (copyTimer.current !== null) clearTimeout(copyTimer.current) }, [])
      useEffect(() => {
        if (seed === null) return undefined
        let alive = true
        setState({ loading: true, patch: '', error: null })
        void (async () => {
          try {
            const payload = { cwd: seed.cwd }
            if (seed.repoRoot !== undefined && seed.repoRoot !== null && seed.repoRoot !== '') payload.repoRoot = seed.repoRoot
            if (seed.hash !== undefined && seed.hash !== null && seed.hash !== '') {
              payload.hash = seed.hash
              /* hash+path rides `git show <hash> -- <path>` (host-supported
                 since the route exists): the preview follows the exact file
                 the user clicked instead of the commit's first file. */
              if (seed.path !== undefined && seed.path !== null && seed.path !== '') payload.path = seed.path
            } else {
              payload.path = seed.path; payload.staged = seed.staged === true
              /* untracked files never ride `git diff -- path` (no index entry):
                 the host switches to a --no-index /dev/null new-file patch. */
              if (seed.untracked === true) payload.untracked = true
            }
            const data = await request('diff', payload)
            if (alive === true) setState({ loading: false, patch: data === undefined || data === null || typeof data.patch !== 'string' ? '' : data.patch, error: null })
          } catch (error) {
            if (alive === true) setState({ loading: false, patch: '', error: error instanceof Error ? error.message : String(error) })
          }
        })()
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [seedKey, refreshTick])
      const title = seed === null
        ? ''
        : (seed.hash !== undefined && seed.hash !== null
          ? String(seed.hash).slice(0, 7) + (seed.subject ? ' ' + seed.subject : '')
          : String(seed.path))
      /* Header controls mirror the base's own diff tab: a refresh button
         (worktree diffs change under staging/discard), plus a copy button —
         the official card's toolbar already covers wrap/copy inside the body;
         these two act on the WHOLE preview. */
      const copyPatch = () => {
        try {
          void navigator.clipboard.writeText(state.patch).then(() => {
            setCopied(true)
            if (copyTimer.current !== null) clearTimeout(copyTimer.current)
            copyTimer.current = setTimeout(() => { setCopied(false); copyTimer.current = null }, 1600)
          })
        } catch (error) { void error }
      }
      /* Hand the file to the HOST'S own file preview (ReadBlock chrome: path
         banner, line numbers, syntax colors) — the official openResource
         channel, the same one every @-mention file click rides. The diff stays
         the place to read the CHANGE; this jumps to the whole file with the
         product's line-numbered reader. Address grammar (workspace-path):
         `dsh-resource://file/session/<sessionId>/<per-segment encoded rel>`. */
      const openInFilePreview = () => {
        if (seed === null || seed.path === undefined || seed.path === null || seed.path === '') return
        let sidebarRight = undefined
        try { sidebarRight = props.ctx === undefined || props.ctx === null ? undefined : props.ctx.get('sidebarRight') } catch (error) { void error }
        if (sidebarRight === undefined || sidebarRight === null || typeof sidebarRight.openResource !== 'function') return
        try {
          const relative = String(seed.path)
          const address = 'dsh-resource://file/session/' + encodeURIComponent(String(seed.sessionId || '')) + '/' + relative.split('/').map((segment) => encodeURIComponent(segment)).join('/')
          sidebarRight.openResource(address)
        } catch (error) { void error }
      }
      return E('div', { className: 'git4idea-preview-root' },
        E('div', { className: 'git4idea-preview-head' },
          E('span', { className: 'git4idea-preview-title', 'data-tip': title }, title === '' ? t('preview.title') : title),
          /* m04913: the close button rides the action row, so the × sits on the
             same line as copy/refresh at the far right of the head. */
          E('div', { className: 'git4idea-preview-actions' },
            seed === null ? null : E('button', { type: 'button', className: 'git4idea-preview-btn', 'aria-label': t('diff.copy'), 'data-tip': t('diff.copy'), onClick: copyPatch },
              E(Icon, { name: copied === true ? 'check' : 'copy', size: 13 })),
            seed === null ? null : E('button', { type: 'button', className: 'git4idea-preview-btn', 'aria-label': t('toolbar.refresh'), 'data-tip': t('toolbar.refresh'), onClick: () => { setRefreshTick((n) => n + 1) } },
              E(Icon, { name: 'refresh', size: 13 })),
            props.onClose === undefined ? null : E('button', {
              type: 'button', className: 'git4idea-preview-btn', 'aria-label': t('toast.close'), 'data-tip': t('toast.close'),
              onClick: props.onClose,
            }, E(Icon, { name: 'close', size: 13 })))),
        seed === null
          ? E('div', { className: 'git4idea-preview-body' }, E('div', { className: 'git4idea-empty' }, t('preview.hint')))
          : state.error !== null
            ? E('div', { className: 'git4idea-preview-body' }, E('div', { className: 'git4idea-empty' }, state.error))
            : E('div', { className: 'git4idea-preview-body' }, E(RenderBoundary, { message: t('preview.boundary') }, E(LineDiff, {
                patch: state.patch,
                loading: state.loading,
                t: t,
                /* worktree seeds carry the file path: the review's open-file
                   tool jumps to the host's whole-file preview. */
                onOpenFile: seed.path !== undefined && seed.path !== null && seed.path !== '' ? openInFilePreview : undefined,
              }))))
    }
    /* The sidebar preview tab keeps its store contract: the shell below feeds
       DiffPreview the seed the panel published. */
    function NativePreviewPanel(props) {
      const [seed, setSeed] = useState(() => previewStore.seed)
      useEffect(() => previewStore.subscribe(() => { setSeed(previewStore.seed) }), [])
      return E(DiffPreview, { seed: seed, t: props.t, ctx: props.ctx })
    }

    /* One diff card, floated (m02986). The panel used to push every diff into
       the right sidebar; the user wants the change to open over the page, and
       the push dialog reuses the same card for its file list. */
    const fileDialog = {
      entry: null,
      hosted: false,
      listeners: new Set(),
      set(entry) {
        fileDialog.entry = entry
        for (const listener of fileDialog.listeners) {
          try { listener() } catch (error) { void error }
        }
      },
      subscribe(listener) {
        fileDialog.listeners.add(listener)
        return () => { fileDialog.listeners.delete(listener) }
      },
    }

    function FileDialogHost(props) {
      const [entry, setEntry] = useState(fileDialog.entry)
      useEffect(() => {
        const off = fileDialog.subscribe(() => { setEntry(fileDialog.entry) })
        fileDialog.hosted = true
        return () => { fileDialog.hosted = false; off() }
      }, [])
      useEffect(() => {
        if (entry === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') fileDialog.set(null) }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [entry])
      if (entry === null) return null
      return E('div', {
        className: 'git4idea-commit-overlay git4idea-file-overlay',
        'data-git4idea-file-dialog': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget) fileDialog.set(null) },
      }, E('div', { className: 'git4idea-file-card' },
        E(DiffPreview, {
          seed: entry,
          t: props.t,
          ctx: props.ctx,
          onClose: () => { fileDialog.set(null) },
        })))
    }

    /* The push dialog (m02986): the commits about to leave, and the files of
       the selected commit. Pushing runs the same host route as before; the
       result lands in the bottom-right notifications. */
    const pushDialog = {
      entry: null,
      hosted: false,
      listeners: new Set(),
      set(entry) {
        pushDialog.entry = entry
        for (const listener of pushDialog.listeners) {
          try { listener() } catch (error) { void error }
        }
      },
      subscribe(listener) {
        pushDialog.listeners.add(listener)
        return () => { pushDialog.listeners.delete(listener) }
      },
    }

    /* m04102: the frame-level push card vanished on its first open and never
       came back. A throw while rendering an overlay is fatal for that slot for
       the rest of the page load, and the card read the payload as if every
       field existed — a host that answered without the newer `remotes` /
       `detached` keys threw on `data.remotes.length` before the first paint.
       Normalise once here so an older host still renders a usable card. */
    function pushPreviewOf(raw) {
      const bag = raw === null || typeof raw !== 'object' ? {} : raw
      return {
        branch: typeof bag.branch === 'string' ? bag.branch : '',
        detached: bag.detached === true,
        upstream: typeof bag.upstream === 'string' && bag.upstream !== '' ? bag.upstream : null,
        upstreamGone: typeof bag.upstreamGone === 'string' && bag.upstreamGone !== '' ? bag.upstreamGone : null,
        remote: typeof bag.remote === 'string' ? bag.remote : '',
        remoteBranch: typeof bag.remoteBranch === 'string' ? bag.remoteBranch : '',
        remoteBranches: Array.isArray(bag.remoteBranches) ? bag.remoteBranches : [],
        remoteChecked: bag.remoteChecked === true,
        remoteExists: bag.remoteExists === true,
        target: typeof bag.target === 'string' ? bag.target : '',
        remotes: Array.isArray(bag.remotes) ? bag.remotes : [],
        commits: Array.isArray(bag.commits) ? bag.commits : [],
        truncated: bag.truncated === true,
      }
    }

    function PushDialogBody(props) {
      const t = props.t
      const entry = props.entry
      const base = { cwd: entry.cwd, repoRoot: entry.repoRoot }
      const force = entry.force === true
      /* Every push entry opens this card (m00005), including a branch row that
         is not HEAD and a forced push. The seed only preselects the branch and,
         when a menu named one, its remote; the preview still decides the
         destination and whether it exists. */
      const initialBranch = typeof entry.branch === 'string' ? entry.branch : ''
      const initialRemote = typeof entry.remote === 'string' ? entry.remote : ''
      const [data, setData] = useState(null)
      const [selected, setSelected] = useState(null)
      const [files, setFiles] = useState([])
      const [filesLoading, setFilesLoading] = useState(false)
      const [selectedPath, setSelectedPath] = useState(null)
      const [busy, setBusy] = useState(false)
      const [remote, setRemote] = useState('')
      const [destination, setDestination] = useState('')
      const [checking, setChecking] = useState(false)
      /* The state flag alone cannot stop two clicks in the same frame (setBusy
         lands after the render), so the in-flight check is synchronous. */
      const pushing = useRef(false)
      const loadSeq = useRef(0)
      const messageOf = (caught) => (caught instanceof Error ? caught.message : String(caught))
      const loadPreview = async (branch, remoteName, remoteBranch) => {
        const seq = loadSeq.current + 1
        loadSeq.current = seq
        setChecking(true)
        try {
          const payload = Object.assign({}, base)
          if (branch !== '') payload.branch = branch
          if (remoteName !== '') payload.remote = remoteName
          if (remoteBranch !== '') payload.remoteBranch = remoteBranch
          const next = pushPreviewOf(await request('push-preview', payload))
          if (seq !== loadSeq.current) return
          setData(next)
          setRemote(next.remote)
          setDestination(next.remoteBranch)
          setSelected((previous) => (previous !== null && next.commits.some((item) => item.hash === previous)
            ? previous
            : (next.commits.length === 0 ? null : next.commits[0].hash)))
          setSelectedPath(null)
        } catch (caught) {
          if (seq === loadSeq.current) { notifyFail(caught) }
        } finally {
          if (seq === loadSeq.current) setChecking(false)
        }
      }
      useEffect(() => {
        void loadPreview(initialBranch, initialRemote, '')
        return () => { loadSeq.current += 1 }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      useEffect(() => {
        if (selected === null) { setFiles([]); return undefined }
        let alive = true
        setFilesLoading(true)
        void (async () => {
          try {
            const detail = await request('commitDetail', Object.assign({}, base, { hash: selected }))
            if (alive === true) setFiles(Array.isArray(detail.files) ? detail.files : [])
          } catch (caught) {
            if (alive === true) { setFiles([]); notifyFail(caught) }
          } finally {
            if (alive === true) setFilesLoading(false)
          }
        })()
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [selected])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') props.onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [])
      /* m05303: `find` returns undefined for a hash that left the list (the
         branch moved between two previews). The card guards on null, so
         undefined fell through and the header read commit.shortHash — the
         boundary then closed the whole push dialog (the reported flash). */
      const commit = data === null ? null : (data.commits.find((item) => item.hash === selected) || null)
      const openFile = (file) => {
        if (commit === null) return
        fileDialog.set({
          hash: commit.hash,
          subject: commit.subject,
          path: file.path,
          cwd: entry.cwd,
          repoRoot: entry.repoRoot,
          sessionId: entry.sessionId,
        })
      }
      const settleDestination = () => {
        if (data === null) return
        const typed = destination.trim()
        if (typed === '') { setDestination(data.remoteBranch); return }
        if (typed === data.remoteBranch && remote === data.remote) return
        void loadPreview(data.branch, remote, typed)
      }
      const changeRemote = (event) => {
        const next = event.target.value
        setRemote(next)
        if (data !== null) void loadPreview(data.branch, next, '')
      }
      const destinationKnown = data !== null && checking === false && remote === data.remote && destination === data.remoteBranch
      const destinationState = destinationKnown !== true
        ? ''
        : data.remoteChecked !== true
          ? t('push.remoteUnknown')
          : data.remoteExists === true ? t('push.existingBranch') : t('push.newBranch')
      const runPush = async () => {
        if (pushing.current === true || data === null || destinationKnown !== true) return
        pushing.current = true
        setBusy(true)
        try {
          /* Both ends are explicit: a bare push would follow the stale
             branch.<name>.merge after a rename and re-create the old remote
             branch. The host builds <local>:refs/heads/<remote> and records the
             tracking reference that was actually pushed. */
          const payload = Object.assign({}, base, {
            confirm: true,
            remote: remote,
            localBranch: data.branch,
            remoteBranch: destination,
            setUpstream: true,
          })
          if (force === true) payload.force = true
          await request('push', payload)
          toastCenter.push({
            text: fill(t('toast.pushed'), { n: data.commits.length, target: remote + '/' + destination }),
            tone: 'ok',
            icon: 'check',
          })
          props.onClose()
        } catch (caught) {
          toastCenter.push({ text: messageOf(caught), tone: 'error', icon: 'close' })
        } finally {
          pushing.current = false
          setBusy(false)
        }
      }
      const canPush = data !== null && data.detached === false && data.remotes.length > 0
        && destinationKnown === true && (data.commits.length > 0 || data.remoteExists === false) && busy === false
      const emptyNote = data === null
        ? t('status.busy')
        : data.detached === true
          ? t('push.detached')
          : data.remotes.length === 0
            ? t('push.noRemote')
            : data.commits.length === 0
              ? t('push.none')
              : ''
      return E('div', {
        className: 'git4idea-commit-overlay',
        'data-git4idea-push-dialog': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() },
      }, E('div', { className: 'git4idea-push-card' },
        E('div', { className: 'git4idea-commit-layer-head' },
          E(Icon, { name: 'push', size: 14 }),
          E('span', { className: 'git4idea-commit-layer-title' }, data === null ? t('toolbar.push') : fill(t('push.title'), { branch: data.branch })),
          data === null || data.target === '' ? null : E('span', { className: 'git4idea-push-target git4idea-mono' }, data.target),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn', 'aria-label': t('toast.close'), 'data-tip': t('toast.close'),
            onClick: () => { props.onClose() },
          }, E(Icon, { name: 'close', size: 13 }))),
        /* The mapping line answers "where does this go?" before the push: local
           branch, remote, remote branch, and whether that remote branch exists.
           The host checks the REMOTE (ls-remote), not the stale local cache. */
        data === null ? null : E('div', { className: 'git4idea-push-map' },
          E('span', { className: 'git4idea-push-map-label' }, t('push.localBranch')),
          E('span', { className: 'git4idea-push-map-branch git4idea-mono' }, data.branch),
          E('span', { className: 'git4idea-push-map-arrow' }, '→'),
          E('select', {
            className: 'git4idea-select git4idea-push-map-remote',
            value: remote,
            disabled: data.remotes.length === 0,
            'aria-label': t('push.remote'),
            'data-git4idea-push-remote': '',
            onChange: changeRemote,
          }, data.remotes.map((name) => E('option', { key: name, value: name }, name))),
          E('span', { className: 'git4idea-push-map-arrow' }, ':'),
          E('input', {
            className: 'git4idea-input git4idea-push-map-dest',
            value: destination,
            list: 'git4idea-push-destinations',
            placeholder: t('push.remoteBranch'),
            'aria-label': t('push.remoteBranch'),
            'data-git4idea-push-dest': '',
            disabled: data.remotes.length === 0,
            onChange: (event) => { setDestination(event.target.value) },
            onBlur: settleDestination,
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
            },
          }),
          E('datalist', { id: 'git4idea-push-destinations' }, data.remoteBranches.map((name) => E('option', { key: name, value: name }))),
          destinationState === '' ? null : E('span', { className: 'git4idea-push-map-state' }, destinationState),
          force === true ? E('span', { className: 'git4idea-push-map-state git4idea-push-map-force' }, t('push.force')) : null),
        E('div', { className: 'git4idea-push-body' },
          E('div', { className: 'git4idea-push-commits' },
            data === null || data.commits.length === 0
              ? E('div', { className: 'git4idea-empty' }, emptyNote)
              : data.commits.map((item) => E('button', {
                  key: item.hash,
                  type: 'button',
                  className: 'git4idea-push-commit' + (item.hash === selected ? ' git4idea-push-commit-on' : ''),
                  'data-tip': item.subject,
                  onClick: () => { setSelected(item.hash); setSelectedPath(null) },
                },
                E(Icon, { name: 'commit', size: 12 }),
                E('span', { className: 'git4idea-push-subject' }, item.subject),
                E('span', { className: 'git4idea-push-hash git4idea-mono' }, item.shortHash))),
            data === null || data.truncated !== true ? null : E('div', { className: 'git4idea-push-note' }, fill(t('push.truncated'), { n: data.commits.length }))),
          E('div', { className: 'git4idea-push-files' },
            commit === null
              ? E('div', { className: 'git4idea-empty' }, t('detail.pick'))
              : E('div', { className: 'git4idea-push-files-head' },
                  E('span', { className: 'git4idea-mono' }, commit.shortHash),
                  E('span', { className: 'git4idea-push-files-subject' }, commit.subject),
                  E('span', { className: 'git4idea-push-files-count' }, t('detail.files') + ' · ' + String(files.length))),
            commit === null ? null : E('div', { className: 'git4idea-push-file-list' },
              filesLoading === true
                ? E('div', { className: 'git4idea-empty' }, t('diff.loading'))
                : files.length === 0
                  ? E('div', { className: 'git4idea-empty' }, t('detail.noFiles'))
                  : E(CommitFileList, {
                      t: t,
                      files: files,
                      selectedPath: selectedPath,
                      onSelect: (file) => { setSelectedPath(file.path) },
                      onOpen: openFile,
                    })))),
        E('div', { className: 'git4idea-push-foot' },
          E('span', { className: 'git4idea-push-footnote' }, emptyNote !== '' ? emptyNote : (force === true ? t('push.forceHint') : t('push.hint'))),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', { type: 'button', className: 'git4idea-btn', onClick: () => { props.onClose() } }, t('confirm.cancel')),
          E('button', {
            type: 'button',
            className: 'git4idea-btn git4idea-btn-primary',
            disabled: canPush !== true,
            onClick: () => { void runPush() },
          }, t('toolbar.push')))))
    }

