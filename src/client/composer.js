    /* ============================== composer git status ============================== */

    /* The composer-dock Git pill: the current BRANCH only, living in the host's
       'conversation.composer.dock' list to the LEFT of the session statistics
       (activity / usage pills, order 0 and 1 — this entry registers at -10).
       The pill and the panel are SEPARATE React trees, so cross-seat selection
       travels through this tiny module store; rememberRepo() keeps the choice
       across reloads and is the first thing the panel reads on mount, which is
       what makes "switch in the composer, open the panel later" land on the
       right repository without any extra wiring. */

    const composerRepoWatchers = new Set()   /* (sessionId, repoRoot) */
    const composerBranchWatchers = new Set() /* (sessionId, repoRoot) */

    function rememberRepoShared(sessionId, repoRoot) {
      rememberRepo(sessionId, repoRoot)
      for (const watcher of composerRepoWatchers) {
        try { watcher(sessionId, repoRoot) } catch (error) { void error }
      }
    }

    function notifyBranchSwitched(sessionId, repoRoot) {
      for (const watcher of composerBranchWatchers) {
        try { watcher(sessionId, repoRoot) } catch (error) { void error }
      }
    }

    /* The pill has no switch any more (m04492): it is always on. */
    function composerStatusEnabled() {
      return true
    }

    const COMPOSER_POLL_MS = 30000
    /* The branch name itself has to move as soon as the user checks out in a
       terminal or an IDE (m02856). The summary poll above is too expensive for
       that (it scans status); `head` is two git calls, so the pill probes it
       quickly and reloads the summary only when branch or HEAD actually
       moved. */
    const COMPOSER_HEAD_POLL_MS = 2500
    /* Line counts re-run at most this often without a real change: the two
       numstat passes are the expensive step on a big dirty tree (issue #11),
       so the pill keeps its cheap stats:false poll and refreshes lines only
       when the change set or HEAD moves — plus this slow floor for edits
       that rewrite lines in already-dirty files (nothing else in the
       fingerprint moves then). */

    /* The pill feeds the SAME keep-warm cache the panel and the prewarmer
       use (paintRepos / paintPage): a workspace the user has visited — by
       panel, by pill, or by the session-switch prewarm — re-paints the pill
       on mount with zero round trips, so switching sessions swaps the text
       instead of tearing the whole component down and back. The pill only
       ever MERGES its two fields into an existing page; a panel page with
       commits must not lose them to a pill poll. */
    function mergePaintPage(repoRoot, patch) {
      const entry = readPaintPage(repoRoot)
      const page = {}
      if (entry !== undefined) {
        if (entry.summary !== undefined) page.summary = entry.summary
        if (entry.branches !== undefined) page.branches = entry.branches
        if (entry.commits !== undefined) page.commits = entry.commits
        if (entry.hasMore !== undefined) page.hasMore = entry.hasMore
      }
      Object.assign(page, patch)
      writePaintPage(repoRoot, page)
    }

    /* The pill's repo pick order (remembered → workspace root when it is a
       repository → first row), factored out so the cached seed and the fresh
       discovery apply identically. */
    function composerPickRepoOf(sessionId, data) {
      const remembered = readRememberedRepo(sessionId)
      const paths = data.repos.map((repo) => repo.path)
      if (remembered !== undefined && paths.indexOf(remembered) >= 0) return remembered
      if (data.isRepo === true) return data.cwd
      if (paths.length > 0) return paths[0]
      return null
    }

    /* Long repository/branch names: widen the label cap and, past it, run a
       hover-only seamless marquee (the official sidebar rows scroll hovered
       titles via useTitleMarquee, which this surface cannot require — this is
       the CSS twin). The label is measured after paint; only overflowing text
       switches to the duplicated-chunk structure, so short names keep the
       plain ellipsis and never animate. Duration follows the text width so a
       slightly-long name does not crawl. */
    const COMPOSER_NAME_MAX_PX = 260
    const MARQUEE_PX_PER_S = 28

    function ComposerMarqueeName(props) {
      const text = typeof props.text === 'string' ? props.text : ''
      const boxRef = useRef(null)
      const [run, setRun] = useState(false)
      const [dur, setDur] = useState('')
      useEffect(() => {
        const box = boxRef.current
        if (box === null) return undefined
        const measure = () => {
          if (boxRef.current !== box) return /* replaced or unmounted */
          const overflow = box.scrollWidth > box.clientWidth + 1
          setRun(overflow)
          /* In the running structure scrollWidth covers BOTH chunks, so one
             chunk is half of it; the plain structure measures the text alone. */
          const unit = overflow === true && run === true ? box.scrollWidth / 2 : box.scrollWidth
          setDur(overflow === true ? (unit / MARQUEE_PX_PER_S).toFixed(2) + 's' : '')
        }
        measure()
        /* Webfonts land after paint and change text metrics — re-measure once. */
        let frame = 0
        const fonts = document.fonts
        if (fonts !== undefined && fonts !== null && fonts.ready !== undefined && typeof fonts.ready.then === 'function') {
          fonts.ready.then(() => { frame = requestAnimationFrame(measure) }, () => {})
        }
        return () => { if (frame !== 0) cancelAnimationFrame(frame) }
      }, [text, run])
      if (run !== true) {
        return E('span', { ref: boxRef, className: 'git4idea-cs-name' }, text)
      }
      return E('span', { ref: boxRef, className: 'git4idea-cs-name git4idea-cs-mrun', style: dur !== '' ? { '--git4idea-cs-marquee-dur': dur } : undefined },
        E('span', { className: 'git4idea-cs-run' },
          E('span', { className: 'git4idea-cs-chunk' }, text),
          E('span', { className: 'git4idea-cs-chunk', 'aria-hidden': 'true' }, text)))
    }

    /* ---- the commit dialog on the conversation page (m02090) ----
       The composer's 提交 verb used to open the right-sidebar seat and then ask
       for a SECOND click on that tab's own 提交 button. It now raises this card
       straight over the conversation: the panel's change list, diff and message
       box, lifted into the frame-wide `shell.overlay` slot. A composer lives in
       a dock container with `contain: layout`, so a viewport-anchored overlay
       CANNOT be mounted there (invariant 13) — the slot is the only honest way
       for a pill to cover the whole frame. The store is module-level because the
       pill (composer) and the host (shell.overlay) are separate React roots. */
    const commitDialog = {
      entry: null,
      hosted: false,
      listeners: new Set(),
      set(entry) {
        this.entry = entry
        for (const listener of Array.from(this.listeners)) {
          try { listener() } catch (error) { void error }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }

    /* Mounted once by the overlay slot, it renders nothing until a seat raises a
       card. One host carries both cards (m03471): the push seat used to be a
       second registration, and its mount could lag the click - which is exactly
       the flash-then-vanish the user reported. The bodies are keyed by
       repository, so no summary, ticked file or diff survives a new dialog. */
    /* Branch verbs that need a name render HERE, in the middle of the window
       (m03873). A card inside the composer popover would be clipped by its
       scroll box and would read as anchored to a row; the frame overlay keeps
       the same shape as the commit card. */
    const promptDialog = {
      entry: null,
      hosted: false,
      listeners: new Set(),
      set(entry) {
        promptDialog.entry = entry
        for (const listener of promptDialog.listeners) {
          try { listener() } catch (error) { void error }
        }
      },
      subscribe(listener) {
        promptDialog.listeners.add(listener)
        return () => { promptDialog.listeners.delete(listener) }
      },
    }

    function CenteredPrompt(props) {
      const [value, setValue] = useState(props.initialValue === undefined ? '' : props.initialValue)
      const [busy, setBusy] = useState(false)
      const alive = useRef(true)
      const ref = useRef(null)
      useEffect(() => { if (ref.current !== null) ref.current.focus() }, [])
      useEffect(() => () => { alive.current = false }, [])
      const ready = value.trim() !== '' && busy === false
      const submit = () => {
        if (ready !== true) return
        const name = value.trim()
        setBusy(true)
        Promise.resolve(props.onSubmit(name)).catch((caught) => {
          notifyFail(caught)
        }).then(() => {
          if (alive.current === true) setBusy(false)
        })
      }
      const onKey = (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); if (busy !== true) props.onCancel() }
      }
      return E('div', {
        className: 'git4idea-commit-overlay git4idea-prompt-overlay',
        'data-git4idea-prompt': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget && busy !== true) props.onCancel() },
      },
        E('div', { className: 'git4idea-dialog git4idea-prompt-card' },
          E('div', { className: 'git4idea-dialog-title' }, props.title),
          props.text === undefined || props.text === '' ? null : E('div', { className: 'git4idea-dialog-text' }, props.text),
          E('input', {
            ref: ref, className: 'git4idea-input', value: value, spellCheck: false,
            placeholder: props.placeholder === undefined ? '' : props.placeholder,
            onChange: (event) => setValue(event.target.value), onKeyDown: onKey,
          }),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', {
              type: 'button', className: 'git4idea-btn',
              onClick: () => { if (busy !== true) props.onCancel() },
            }, props.cancelLabel),
            E('button', {
              type: 'button', className: 'git4idea-btn git4idea-btn-primary',
              disabled: ready === false, onClick: submit,
            }, props.okLabel))))
    }

    function PromptDialogHost(props) {
      const [entry, setEntry] = useState(promptDialog.entry)
      useEffect(() => {
        const sync = () => setEntry(promptDialog.entry)
        sync()
        const off = promptDialog.subscribe(sync)
        promptDialog.hosted = true
        return () => { promptDialog.hosted = false; off() }
      }, [])
      if (entry === null) return null
      return E(CenteredPrompt, {
        key: entry.key === undefined ? 'prompt' : entry.key,
        title: entry.title,
        text: entry.text,
        initialValue: entry.initialValue,
        placeholder: entry.placeholder,
        okLabel: entry.okLabel,
        cancelLabel: entry.cancelLabel,
        onSubmit: entry.onSubmit,
        onCancel: entry.onCancel === undefined ? () => { promptDialog.set(null) } : entry.onCancel,
      })
    }

