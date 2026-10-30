    /* ============================== changes ============================== */

    /* Memoised with a hand-rolled comparison (issue #11): the callbacks are
       inline arrows and change identity on every parent render, so default
       shallow memo would never hit. Rows re-render only when their `item`
       reference changes — which is exactly what the two-phase stats merge
       produces (untouched rows keep their object). Stale-callback safety:
       every callback closes over `run`/`base`, and those only change together
       with a repo switch, which lands as a brand-new summary array — i.e.
       new `item` references, so the rows do re-render with fresh closures. */
    const ChangeRow = memo(function ChangeRow(props) {
      const t = props.t
      const item = props.item
      const raw = item.index === '?' ? '?' : (item.index + item.worktree).trim()
      // Ignored rows are informational: their status letter is their own, and the
      // stage/discard buttons below would silently do nothing (git needs -f).
      const readOnly = props.group === 'ignored'
      const status = readOnly ? 'I' : (raw === '' ? 'M' : raw.charAt(0))
      /* Tree depth in dir-grouped mode (-1 = flat): every level under a
         folder head indents one 12px step past the base 26px. */
      const depth = typeof props.depth === 'number' ? props.depth : -1
      return E('div', {
        className: 'git4idea-row git4idea-row-file' + (props.selected === true ? ' git4idea-row-selected' : '') + (depth >= 0 ? ' git4idea-row-nested' : ''),
        style: depth >= 0 ? { paddingLeft: (26 + depth * 12) + 'px' } : undefined,
        'data-tip': item.origPath === undefined ? item.path : item.origPath + ' → ' + item.path,
        /* The click is handled ONE level up (ChangesPanel): plain click only
           selects, DOUBLE-click opens the diff (v0.18.3 — one interaction model
           across every list). */
        onClick: (event) => props.onRowClick(event, item, props.group),
        onDoubleClick: () => props.onDblClick(item, props.group),
        onContextMenu: (event) => { event.preventDefault(); props.onMenu(event, item, props.group) },
      },
        /* Per-file commit pick (m01737 #1): the tick, not a stage button, is
           what decides which files the commit carries. Untracked rows start
           unpicked so a stray build artefact cannot slip into a commit. */
        readOnly ? null : E('input', {
          type: 'checkbox',
          className: 'git4idea-row-check',
          checked: props.checked === true,
          onClick: (event) => { event.stopPropagation() },
          onChange: () => props.onTogglePick(item, props.group),
        }),
        FileTypeGlyph({ path: item.path }),
        E('span', { className: 'git4idea-file-status git4idea-file-status-' + (status === '?' ? 'U' : status) }, status),
        // An ignored DIRECTORY comes back as "dist/" (ls-files --directory), whose
        // basename is empty — show the whole path instead of a blank label.
        E('span', { className: 'git4idea-row-label' }, item.path.slice(-1) === '/' ? item.path : baseName(item.path)),
        // In dir-grouped mode the folder head already names the directory —
        // repeating the full path at the end of every nested row is what made
        // the tree read as a flat list (v0.18.5). Flat modes keep it.
        depth >= 0 ? null : E('span', { className: 'git4idea-row-sub git4idea-row-dir' }, item.path.slice(-1) === '/' ? '' : dirName(item.path)),
        item.additions > 0 ? E('span', { className: 'git4idea-stat-add' }, '+' + item.additions) : null,
        item.deletions > 0 ? E('span', { className: 'git4idea-stat-del' }, '-' + item.deletions) : null,
        readOnly ? null : (props.group === 'staged'
          ? E('button', { type: 'button', className: 'git4idea-mini', 'data-tip': t('action.unstage'), onClick: (event) => { event.stopPropagation(); props.onUnstage(item) } }, E(Icon, { name: 'minus', size: 12 }))
          : E('button', { type: 'button', className: 'git4idea-mini', 'data-tip': t('action.stage'), onClick: (event) => { event.stopPropagation(); props.onStage(item) } }, E(Icon, { name: 'plus', size: 12 }))),
        readOnly ? null : E('button', { type: 'button', className: 'git4idea-mini', 'data-tip': t('action.discard'), onClick: (event) => { event.stopPropagation(); props.onDiscard(item, props.group) } }, E(Icon, { name: 'undo', size: 12 })))
    }, (prev, next) => prev.item === next.item && prev.group === next.group && prev.t === next.t && prev.selected === next.selected && prev.depth === next.depth && prev.checked === next.checked)

    function ChangesPanel(props) {
      const t = props.t
      const summary = props.summary
      const [message, setMessage] = useState('')
      const [amend, setAmend] = useState(false)
      /* m05308: the AI message language. It follows the DSH display language
         until the user picks one in the select box. */
      const [commitLang, setCommitLang] = useState(defaultCommitLanguage)
      const [collapsed, setCollapsed] = useState(() => {
        const stored = readTreeState()
        return stored !== null && typeof stored === 'object' && stored.changesCollapsed === true
      })
      /* Same remount-survival as the branch sections (v0.13.1). */
      useEffect(() => {
        const stored = readTreeState()
        writeTreeState(Object.assign({}, stored, { changesCollapsed: collapsed === true }))
      }, [collapsed])
      /* AI-written message (issue #6). The draft is kept so the write can be
         undone, and an existing draft is never overwritten without a word. */
      const [aiBusy, setAiBusy] = useState(false)
      const [aiNote, setAiNote] = useState(null)
      const [aiAsk, setAiAsk] = useState(false)
      const [aiUndo, setAiUndo] = useState(null)
      // 'flat' keeps git's own grouping (staged / changes / untracked); 'dir'
      // clusters each group's files under their folder, the way "Group by:
      // Directory" does in an IDE. Folders are addressed by <group>|<dir>, so a
      // refresh never loses which ones the user folded away.
      // Lifted to the panel (v0.15): the "..." menu drives the same state, so
      // the header toggle and the menu can never disagree. The alias pair keeps
      // the body reads below untouched.
      const groupBy = props.groupBy === 'dir' ? 'dir' : 'flat'
      const setGroupBy = props.onGroupBy
      const sortKey = props.sortKey === undefined ? 'git' : props.sortKey
      /* foldedDirs lifted too (v0.16.1): the header row lost its four buttons —
         everything they did lives in the ⋯ menu now, so the menu drives this
         state directly through props. */
      const foldedDirs = props.foldedDirs === undefined ? {} : props.foldedDirs
      const setFoldedDirs = props.onFoldedDirs
      /* ---- multi-select (issue #13): the state lives in Panel so the right-click
         menu and the keyboard shortcuts can act on it; this panel renders it,
         feeds it from clicks/drag, and mirrors it onto row classes. ---- */
      const selection = props.selection === undefined ? EMPTY_SELECTION : props.selection
      const setSelection = props.onSelectionChange
      const anchorRef = props.anchorRef
      const changeItemsRef = useRef(null)
      const changeOffsetsRef = useRef(null)
      /* The marquee lives in the shared useRubberBand hook (v0.19.3: history
         and the branch tree drag the same way). changesHostRef is the DRAW
         host — the hook comment explains why the paint rect must be the list
         wrapper's, not the scroll container's (v0.19.2 offset report). */
      const changesHostRef = useRef(null)
      /* Rows in their RENDER order (the order windowing flattens them into) —
         Shift-click spans follow what the eye sees, not the git order. */
      const orderedRowKeys = () => {
        const items = changeItemsRef.current
        const keys = []
        if (items === null) return keys
        for (const entry of items) {
          if (entry.kind === 'row' && entry.key.indexOf('ignored:') !== 0) keys.push(entry.key)
        }
        return keys
      }
      const handleRowClick = useCallback((event, item, group) => {
        const key = group + ':' + item.path
        /* Functional updates ONLY: the memoised rows may hold a stale closure
           of this handler (their memo compares item/group/t/selected, not the
           callback — same stale-callback trade-off as the stage buttons), so
           the selection must never be read from it. */
        if (event.shiftKey === true && anchorRef !== undefined) {
          const ordered = orderedRowKeys()
          /* Anchor falls back to the FIRST row (VS Code semantics): a Shift
             click on a fresh list must multi-select, not degrade to single. */
          const anchorKey = anchorRef.current !== null ? anchorRef.current : ordered[0]
          const from = ordered.indexOf(anchorKey)
          const to = ordered.indexOf(key)
          if (from >= 0 && to >= 0) {
            const low = Math.min(from, to)
            const high = Math.max(from, to)
            setSelection((previous) => {
              const next = new Set(previous)
              for (let index = low; index <= high; index += 1) next.add(ordered[index])
              return next
            })
            return
          }
        }
        if (isToggleModifier(event) === true) {
          anchorRef.current = key
          setSelection((previous) => {
            const next = new Set(previous)
            if (next.has(key) === true) next.delete(key)
            else next.add(key)
            return next
          })
          return
        }
        anchorRef.current = key
        /* Plain click only SELECTS (single-replace, the branch tree's model):
           the diff moved to DOUBLE-click — a stray click mid-multi-select must
           not yank the pane away (v0.18.3). */
        setSelection((previous) => previous.size === 1 && previous.has(key) === true ? previous : new Set([key]))
        /* m05307: the commit dialog previews the click's file in its right
           pane; every other host of this panel passes no onSelect. */
        if (typeof props.onSelect === 'function') props.onSelect(item, group)
      }, [setSelection, anchorRef, props.onDiff, props.onSelect])
      /* Rubber-band selection now comes from the shared useRubberBand hook
         (see its comment): the fixed row heights + the prefix-sum offsets
         still turn a pixel span back into row keys without any DOM rows —
         the rectsOf below is the exact former marqueeKeysAt, reshaped. */
      const changes = summary === null ? null : summary.changes
      const conflicted = changes === null ? [] : changes.conflicted
      const staged = changes === null ? [] : changes.staged
      const unstaged = changes === null ? [] : changes.unstaged
      const untracked = changes === null ? [] : changes.untracked
      const ignored = changes === null || changes.ignored === undefined ? [] : changes.ignored
      const total = conflicted.length + staged.length + unstaged.length + untracked.length
      /* ---- commit picks (m01737 #1) -------------------------------------
         A tick decides what the commit carries, replacing the "stage these
         first" choreography. The map holds EXPLICIT choices only, so the
         defaults stay live: tracked rows arrive picked, untracked ones do not,
         and a refresh never forgets what the user unticked. */
      const [picks, setPicks] = useState({})
      const pickOn = (group, item) => {
        const explicit = picks[group + ':' + item.path]
        if (explicit === true || explicit === false) return explicit
        return group === 'conflicted' || group === 'staged' || group === 'unstaged'
      }
      const pickCountOf = (group, entries) => {
        let count = 0
        for (const item of entries) { if (pickOn(group, item) === true) count += 1 }
        return count
      }
      const togglePick = (item, group) => {
        setPicks((previous) => Object.assign({}, previous, { [group + ':' + item.path]: pickOn(group, item) !== true }))
      }
      const setGroupPick = (group, entries, on) => {
        setPicks((previous) => {
          const next = Object.assign({}, previous)
          for (const item of entries) next[group + ':' + item.path] = on
          return next
        })
      }
      const pickedPaths = () => {
        const out = []
        const seen = new Set()
        const groups = [['conflicted', conflicted], ['staged', staged], ['unstaged', unstaged], ['untracked', untracked]]
        for (const [group, entries] of groups) {
          for (const item of entries) {
            if (pickOn(group, item) !== true || seen.has(item.path) === true) continue
            seen.add(item.path)
            out.push(item.path)
          }
        }
        return out
      }
      const pickedNow = pickedPaths().length
      const aiRun = async () => {
        setAiAsk(false)
        setAiBusy(true)
        setAiNote(null)
        try {
          /* m05301: the message rides the session's own model route. The host
             picks the provider and model (commitRouteOf), so this button sends
             no model, effort or prompt of its own.
             `base` carries the picked repository ({ cwd, repoRoot }) exactly like
             every other request: without it the host resolves the repository from
             the session cwd, which need not be one (several sibling repos). */
          const data = await props.request('commit-message', Object.assign(
            {},
            props.base === undefined ? { cwd: props.cwd } : props.base,
            { sessionId: props.sessionId, language: commitLang },
          ))
          setAiUndo(message === '' ? null : message)
          setMessage(typeof data.message === 'string' ? data.message : '')
          /* Say what the model did NOT see, instead of quietly sending less. */
          const input = data.input === undefined ? {} : data.input
          const incomplete = input.truncated === true || (typeof input.dropped === 'number' && input.dropped > 0) || data.promptTruncated === true
          setAiNote(incomplete === true ? t('changes.aiNotice') : null)
        } catch (error) {
          const code = error !== null && error !== undefined && typeof error.code === 'string' ? error.code : 'unknown'
          setAiNote(t('changes.aiFailed') + ' [' + code + '] ' + String(error && error.message ? error.message : error))
          notifyFail(error)
        } finally {
          setAiBusy(false)
        }
      }
      const submit = (push) => {
        const paths = pickedPaths()
        if (message.trim() === '' || props.busy === true || paths.length === 0) return false
        props.onCommit(message, amend, push === true, paths)
        setMessage('')
        setAmend(false)
        return true
      }
      const entryRow = (key, item, depth) => E(ChangeRow, {
        key: key + ':' + item.path, item: item, group: key, t: t,
        depth: typeof depth === 'number' ? depth : -1,
        selected: selection.has(key + ':' + item.path) === true,
        checked: pickOn(key, item),
        onTogglePick: togglePick,
        onRowClick: handleRowClick,
        onDblClick: props.onDiff,
        onStage: props.onStage, onUnstage: props.onUnstage, onDiscard: props.onDiscard, onDiff: props.onDiff, onMenu: props.onChangeMenu,
      })
      /* The "..." menu's sort orders (v0.15). 'git' keeps git's own status
         order; the others are pure client-side sorts of already-loaded
         entries — no extra git calls, no re-fetch. */
      const sortedOf = (entries) => {
        if (sortKey === 'path') return entries.slice().sort((a, b) => a.path.localeCompare(b.path))
        if (sortKey === 'name') return entries.slice().sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)) || a.path.localeCompare(b.path))
        if (sortKey === 'status') return entries.slice().sort((a, b) => (a.index + a.worktree).localeCompare(b.index + b.worktree) || a.path.localeCompare(b.path))
        return entries
      }
      /* Windowing: the change list is flattened into (group-head | folder-head
         | row) items with FIXED heights (see ITEM_HEIGHTS + the CSS pins), a
         prefix-sum index locates the visible window, and only that slice is
         mounted. A tree with thousands of files scrolls at frame rate. */
      const changesScrollRef = useRef(null)
      const changesViewport = useViewportBox(changesScrollRef)
      const changeMarquee = useRubberBand({
        scrollRef: changesScrollRef,
        drawRef: changesHostRef,
        rectsOf: () => {
          const items = changeItemsRef.current
          const offsets = changeOffsetsRef.current
          if (items === null || offsets === null || items.length === 0) return []
          const rects = []
          for (let index = 0; index < items.length; index += 1) {
            const entry = items[index]
            if (entry.kind === 'row' && entry.key.indexOf('ignored:') !== 0) rects.push({ key: entry.key, top: offsets[index], bottom: offsets[index + 1] })
          }
          return rects
        },
        onPick: (keys) => setSelection(new Set(keys)),
      })
      const changeItems = useMemo(() => {
        const out = []
        const groupHead = (key, title, entries) => {
          const on = key === 'ignored' ? 0 : pickCountOf(key, entries)
          const all = entries.length > 0 && on === entries.length
          return E('div', { className: 'git4idea-group-head' },
          key === 'ignored' ? null : E('input', {
            type: 'checkbox', className: 'git4idea-group-check',
            checked: all,
            /* The group tick has three states, like the IDE's commit tree: all,
               none, and the dash that says "some" — the dash is a DOM property
               React cannot express, so it is set on the node itself. */
            ref: (node) => { if (node !== null) node.indeterminate = on > 0 && all === false },
            onClick: (event) => { event.stopPropagation() },
            onChange: () => setGroupPick(key, entries, all === false),
          }),
          E('span', null, title),
          key === 'staged' ? E('button', { type: 'button', className: 'git4idea-link', onClick: () => props.onUnstageAll() }, t('changes.unstageAll')) : null,
          key === 'unstaged' || key === 'untracked' ? E('button', { type: 'button', className: 'git4idea-link', onClick: () => props.onStageAll(entries) }, t('changes.stageAll')) : null)
        }
        const emitRows = (key, entries) => {
          const sorted = sortedOf(entries)
          if (groupBy !== 'dir') {
            for (const item of sorted) out.push({ kind: 'row', key: key + ':' + item.path, h: ITEM_HEIGHTS.row, node: entryRow(key, item) })
            return
          }
          const forest = buildDirForest(sorted, key)
          /* The label is the chain THIS node adds below its parent (issue
             #18): a compressed "java/cn/com/pxwk/base" node repeats only the
             segments below "…/src/main", not the full path from the group
             root — same convention as the IDE commit tree. */
          const renderFolder = (node, depth, parentLen) => {
            const id = key + '|' + node.path.join('/')
            const open = foldedDirs[id] !== true
            out.push({
              kind: 'folder', key: 'folder:' + id, h: ITEM_HEIGHTS.folder,
              node: E('button', {
                type: 'button', className: 'git4idea-folder-head',
                style: { paddingLeft: (4 + depth * 12) + 'px' },
                onClick: () => setFoldedDirs((previous) => Object.assign({}, previous, { [id]: previous[id] !== true })),
              },
                E('span', { className: 'git4idea-chevron' + (open ? ' git4idea-chevron-open' : '') }, E(Icon, { name: 'chevron', size: 10 })),
                E('span', { className: 'git4idea-row-icon git4idea-tone-accent' }, E(Icon, { name: 'folder', size: 10 })),
                E('span', { className: 'git4idea-folder-name' }, node.path.slice(typeof parentLen === 'number' ? parentLen : 0).join('/')),
                E('span', { className: 'git4idea-count' }, String(forest.countOf(node)))),
            })
            if (open === true) {
              /* VS Code order inside a folder: subfolders first (recursively,
                 each indented one more level), then this folder's own files. */
              for (const child of forest.sortedChildren(node)) renderFolder(child, depth + 1, node.path.length)
              for (const item of sortedOf(node.files)) out.push({ kind: 'row', key: key + ':' + item.path, h: ITEM_HEIGHTS.row, node: entryRow(key, item, depth) })
            }
          }
          /* Files sitting at the group ROOT get their own (root) head, sorted
             first — the flat grouping used to give them a localized head too. */
          if (forest.rootFiles.length > 0) {
            const rootId = key + '|/'
            const rootOpen = foldedDirs[rootId] !== true
            out.push({
              kind: 'folder', key: 'folder:' + rootId, h: ITEM_HEIGHTS.folder,
              node: E('button', {
                type: 'button', className: 'git4idea-folder-head',
                onClick: () => setFoldedDirs((previous) => Object.assign({}, previous, { [rootId]: previous[rootId] !== true })),
              },
                E('span', { className: 'git4idea-chevron' + (rootOpen ? ' git4idea-chevron-open' : '') }, E(Icon, { name: 'chevron', size: 10 })),
                E('span', { className: 'git4idea-row-icon git4idea-tone-accent' }, E(Icon, { name: 'folder', size: 10 })),
                E('span', { className: 'git4idea-folder-name' }, t('changes.rootDir')),
                E('span', { className: 'git4idea-count' }, String(forest.rootFiles.length))),
            })
            if (rootOpen === true) for (const item of sortedOf(forest.rootFiles)) out.push({ kind: 'row', key: key + ':' + item.path, h: ITEM_HEIGHTS.row, node: entryRow(key, item, 0) })
          }
          for (const node of forest.roots) renderFolder(node, 0)
        }
        const emitGroup = (key, title, entries) => {
          if (entries.length === 0) return
          out.push({ kind: 'group', key: 'group:' + key, h: ITEM_HEIGHTS.group, node: groupHead(key, title, entries) })
          emitRows(key, entries)
        }
        emitGroup('conflicted', fill(t('counts.conflicted'), { n: conflicted.length }), conflicted)
        emitGroup('staged', fill(t('counts.staged'), { n: staged.length }), staged)
        emitGroup('unstaged', fill(t('counts.unstaged'), { n: unstaged.length }), unstaged)
        emitGroup('untracked', fill(t('counts.untracked'), { n: untracked.length }), untracked)
        emitGroup('ignored', fill(t('counts.ignored'), { n: ignored.length }), ignored)
        return out
      }, [conflicted, staged, unstaged, untracked, ignored, groupBy, foldedDirs, sortKey, t, selection, picks, handleRowClick, props.onUnstageAll, props.onStageAll])
      const changeOffsets = useMemo(() => {
        const sums = [0]
        for (const item of changeItems) sums.push(sums[sums.length - 1] + item.h)
        return sums
      }, [changeItems])
      /* Render-phase mirrors: the drag-select and Shift-range logic read these
         through refs, so their callbacks keep stable identities (invariant 12:
         a dep array is evaluated during render — no forward references). */
      changeItemsRef.current = changeItems
      changeOffsetsRef.current = changeOffsets
      /* Virtual window, VSCode-style (ListView.getVisibleRange): both ends are
         pixel→index conversions over the same prefix-sum array, so no "row
         count" ever enters the math (issue #12 — the old winLimit computed a
         row count while the loop accumulated pixels, stalling at 2 entries). */
      const winFirst = Math.max(0, windowStart(changeOffsets, changesViewport.scrollTop) - WINDOW_OVERSCAN)
      const winLast = Math.min(changeItems.length, windowStart(changeOffsets, changesViewport.scrollTop + changesViewport.viewH) + 1 + WINDOW_OVERSCAN)
      const visibleItems = changeItems.slice(winFirst, winLast)
      const aiConfirmDialog = aiAsk !== true ? null : E(ConfirmDialog, {
        t: t,
        'data-tip': t('changes.aiOverwriteTitle'),
        text: t('changes.aiOverwriteText'),
        okLabel: t('confirm.ok'),
        cancelLabel: t('confirm.cancel'),
        onConfirm: () => { void aiRun() },
        onCancel: () => setAiAsk(false),
      })
      /* m05308: the quota hint became the message-language picker. The AI
         message is written in this language, whatever the display language is. */
      const langSelect = E('select', {
        className: 'git4idea-select git4idea-commit-lang', value: commitLang,
        'aria-label': t('changes.language'), 'data-tip': t('changes.language'),
        onChange: (event) => setCommitLang(event.target.value),
      },
        E('option', { value: 'zh' }, t('changes.langZh')),
        E('option', { value: 'en' }, t('changes.langEn')))
      const composer = props.compact === true
        ? E('div', { className: 'git4idea-commit-box git4idea-commit-box-compact' },
            E('input', {
              className: 'git4idea-input git4idea-input-compact', value: message, spellCheck: false,
              placeholder: t('changes.commitPlaceholder'),
              onChange: (event) => setMessage(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); submit() }
              },
            }),
            E('button', {
              type: 'button', className: 'git4idea-btn git4idea-btn-small git4idea-btn-ai',
              disabled: aiBusy === true || props.busy === true,
              onClick: () => { if (message.trim() === '') void aiRun(); else setAiAsk(true) },
            }, aiBusy === true ? t('changes.aiBusy') : t('changes.aiWrite')),
            E('button', {
              type: 'button', className: 'git4idea-btn git4idea-btn-primary git4idea-btn-small',
              disabled: message.trim() === '' || props.busy === true || pickedNow === 0,
              onClick: () => { submit(false) },
            }, t('changes.commit')),
            langSelect)
        : E('div', { className: 'git4idea-commit-box' },
            /* m05307: the IDEA commit dialog keeps 修正 above the message box. */
            E('label', { className: 'git4idea-check git4idea-commit-amend' },
              E('input', { type: 'checkbox', checked: amend, onChange: (event) => setAmend(event.target.checked) }),
              E('span', null, t('changes.amend'))),
            E('textarea', {
              className: 'git4idea-textarea', value: message, spellCheck: false,
              placeholder: t('changes.commitPlaceholder'),
              onChange: (event) => setMessage(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() }
              },
            }),
            E('div', { className: 'git4idea-commit-ai' },
              E('button', {
                type: 'button', className: 'git4idea-btn git4idea-btn-small git4idea-btn-ai',
                disabled: aiBusy === true || props.busy === true,
                onClick: () => { if (message.trim() === '') void aiRun(); else setAiAsk(true) },
              }, aiBusy === true ? t('changes.aiBusy') : t('changes.aiWrite')),
              langSelect,
              aiUndo === null ? null : E('button', {
                type: 'button', className: 'git4idea-link',
                onClick: () => { setMessage(aiUndo); setAiUndo(null); setAiNote(null) },
              }, t('changes.aiUndo'))),
            aiNote === null ? null : E('div', { className: 'git4idea-commit-ai-note', 'data-ai-note': '' }, aiNote),
            E('div', { className: 'git4idea-commit-actions' },
              E('button', {
                type: 'button', className: 'git4idea-btn git4idea-btn-primary',
                disabled: message.trim() === '' || props.busy === true || pickedNow === 0,
                onClick: () => { submit(false) },
              }, t('changes.commit')),
              E('button', {
                type: 'button', className: 'git4idea-btn',
                disabled: message.trim() === '' || props.busy === true || pickedNow === 0,
                onClick: () => { submit(true) },
              }, t('changes.commitAndPush'))))
      // Folding hides the FILE LIST only. The commit box is the panel's primary
      // action and used to vanish together with the list, leaving an empty pane
      // with no way to commit anything (reported on v0.3.5).
      const head = props.hideHeader === true ? null : E('div', { className: 'git4idea-section-head git4idea-changes-head' },
        E('button', {
          type: 'button', className: 'git4idea-section-toggle',
          onClick: () => setCollapsed((value) => !value),
        },
          E('span', { className: 'git4idea-chevron' + (collapsed ? '' : ' git4idea-chevron-open') }, E(Icon, { name: 'chevron', size: 12 })),
          E('span', null, t('changes.title')),
          E('span', { className: 'git4idea-count' }, String(total))),
        E('span', { className: 'git4idea-topbar-spacer' }),
        /* The four header toggles (group-by / expand / fold / ignored) moved
           INTO the ⋯ menu (v0.16.1, user request): one consistent entry point
           instead of five small buttons, same actions, same state. */
        props.onMoreMenu === undefined ? null : E('button', {
          type: 'button',
          /* Same 24px footprint and 15px glyph as the rail buttons above — the
             user asked for one consistent size across both rows. */
          className: 'git4idea-icon-btn',
          'data-tip': t('toolbar.more'),
          'data-action': 'more',
          onClick: (event) => props.onMoreMenu(event),
        }, E(Icon, { name: 'more', size: 18 })))
      return E('div', { className: 'git4idea-changes', ref: changesHostRef },
        aiConfirmDialog,
        head,
        E('div', { className: 'git4idea-changes-body' },
          E('div', {
            className: 'git4idea-changes-list', ref: changesScrollRef,
            /* Focusable list: the keyboard shortcuts (Ctrl+C / Del / Ctrl+A /
               Esc) land on whichever list currently holds focus. */
            tabIndex: 0,
            onKeyDown: props.onKeyDown,
            onPointerDownCapture: (event) => {
              if (isTypingTarget(event.target) === false) event.currentTarget.focus({ preventScroll: true })
            },
            onPointerDown: changeMarquee.onPointerDown,
            onClickCapture: (event) => {
              if (changeMarquee.swallowRef.current === true) { event.preventDefault(); event.stopPropagation(); return }
              /* v0.19.4: blank click clears — the wrapped setter also bumps the
                 other lists' epochs, so this is a clear-everywhere gesture. */
              const target = event.target
              if (target instanceof Element && target.closest('.git4idea-row,.git4idea-group-head,button,input,textarea,select,a') === null) setSelection(new Set())
            },
          },
            collapsed ? null : [
              total === 0 && ignored.length === 0 ? E('div', { className: 'git4idea-empty', key: 'empty' }, t('changes.empty')) : null,
              /* Windowed slice: spacers above/below stand in for the unmounted
                 rows (fixed heights, see ITEM_HEIGHTS). */
              winFirst > 0 ? E('div', { key: 'pad-top', style: { height: String(changeOffsets[winFirst]) + 'px' } }) : null,
              visibleItems.map((item) => E(Fragment, { key: item.key }, item.node)),
              winLast < changeItems.length ? E('div', { key: 'pad-bottom', style: { height: String(changeOffsets[changeItems.length] - changeOffsets[winLast]) + 'px' } }) : null,
            ]),
          composer),
        E(MarqueeBox, { box: changeMarquee.box }))
    }

    /* ============================== history ============================== */

    const DAY_MS = 86400000

    /** Branches the panel treats as high risk: deleting one needs a typed confirm. */
    function isProtectedBranch(name) {
      return name === 'main' || name === 'master' || name === 'trunk'
    }

    /* A ref decoration as git prints it in %D, split into a display name and the
       kind that drives its badge colour. */
    function refInfo(raw) {
      const value = String(raw)
      if (value.indexOf('HEAD -> ') === 0) return { name: value.slice(8), kind: 'head' }
      if (value === 'HEAD') return { name: 'HEAD', kind: 'head' }
      if (value.indexOf('tag: ') === 0) return { name: value.slice(5), kind: 'tag' }
      return { name: value, kind: value.indexOf('/') >= 0 ? 'remote' : 'local' }
    }

    /* Decorations for display in the log row and the commit detail: "HEAD -> main"
       names TWO refs (HEAD and the branch), so it becomes two badges. Branches
       come before tags; the order is stable within a kind. */
    function refDecorations(refs) {
      const list = Array.isArray(refs) ? refs : []
      const out = []
      for (const raw of list) {
        const value = String(raw)
        if (value.indexOf('HEAD -> ') === 0) {
          out.push({ name: 'HEAD', kind: 'head' })
          const branch = value.slice(8)
          out.push({ name: branch, kind: branch.indexOf('/') >= 0 ? 'remote' : 'local' })
        } else if (value === 'HEAD') {
          out.push({ name: 'HEAD', kind: 'head' })
        } else if (value.indexOf('tag: ') === 0) {
          out.push({ name: value.slice(5), kind: 'tag' })
        } else {
          out.push({ name: value, kind: value.indexOf('/') >= 0 ? 'remote' : 'local' })
        }
      }
      const order = { head: 0, local: 1, remote: 2, tag: 3 }
      return out.sort((a, b) => order[a.kind] - order[b.kind])
    }

    /* ---- list windowing (issue #11 follow-up: hundreds of rows stay smooth) ----
       Both long lists (history rows, change rows) render only what the viewport
       can see plus an overscan skirt; spacer divs keep the scrollbar honest.
       Row heights are FIXED constants — the CSS pins each row kind to an exact
       height, so a prefix-sum index plus binary search locates the first
       visible item without measuring. */
    const HISTORY_ROW_H = 28 /* .git4idea-commit: height 26 + 2×1px padding */
    const ITEM_HEIGHTS = { group: 21, folder: 16, row: 24 }
    const WINDOW_OVERSCAN = 6

    /* Tracks a scroll container's scrollTop (rAF-throttled) and clientHeight
       (ResizeObserver). SSR-safe: the effect never runs on the server. */
    function useViewportBox(scrollRef) {
      const [scrollTop, setScrollTop] = useState(0)
      const [viewH, setViewH] = useState(360)
      useEffect(() => {
        const el = scrollRef.current
        if (el === null || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver(() => setViewH(el.clientHeight))
        observer.observe(el)
        setViewH(el.clientHeight)
        let frame = 0
        const onScroll = () => {
          if (frame !== 0) return
          frame = requestAnimationFrame(() => { frame = 0; setScrollTop(el.scrollTop) })
        }
        el.addEventListener('scroll', onScroll, { passive: true })
        return () => {
          observer.disconnect()
          el.removeEventListener('scroll', onScroll)
          if (frame !== 0) cancelAnimationFrame(frame)
        }
      }, [scrollRef])
      return { scrollTop: scrollTop, viewH: viewH }
    }

    /* ---- rubber-band (marquee) selection, shared by all three lists ----
       One hook, three wiring sites (changes, history, branch tree). The
       contract: `scrollRef` is the scrolling container the SELECTION math
       runs against, `drawRef` is the element the marquee box is PAINTED in
       (its own rect — v0.18.x painted from the scroll container's rect while
       the box lived inside the list wrapper, so the toolbar height above the
       list shifted every box visually upward; reported v0.19.2), `rectsOf`
       returns {key,top,bottom} rows in scroll-content coordinates (exact
       prefix-sums for the windowed lists, a live DOM measure for the
       variable-height tree), and `onPick` receives the intersecting keys.
       A 4px threshold keeps plain clicks clicky; pointerdown is preventDefault-ed
       so drags never start a native text selection; edge auto-scroll and the
       rAF-throttled sync carry over unchanged from v0.18.x. */
    function useRubberBand(options) {
      const [box, setBox] = useState(null)
      const stateRef = useRef(null)
      const frameRef = useRef(0)
      const swallowRef = useRef(false)
      const optionsRef = useRef(options)
      optionsRef.current = options
      const sync = () => {
        const opts = optionsRef.current
        const state = stateRef.current
        const host = opts.scrollRef.current
        const draw = opts.drawRef.current
        if (state === null || host === null || draw === null) return
        const hostRect = host.getBoundingClientRect()
        const drawRect = draw.getBoundingClientRect()
        const y0 = state.startY - hostRect.top + state.scrollY0
        const y1 = state.clientY - hostRect.top + host.scrollTop
        const low = Math.min(y0, y1)
        const high = Math.max(y0, y1)
        const keys = []
        for (const rect of opts.rectsOf()) {
          if (rect.top < high && rect.bottom > low) keys.push(rect.key)
        }
        opts.onPick(keys)
        setBox({
          x: Math.min(state.startX, state.clientX) - drawRect.left,
          y: Math.min(state.startY, state.clientY) - drawRect.top,
          w: Math.abs(state.clientX - state.startX),
          h: Math.abs(state.clientY - state.startY),
        })
        /* Auto-scroll when the pointer rides an edge; keep the loop alive while
           it does so the selection follows the content streaming past. */
        const EDGE = 28
        let speed = 0
        if (state.clientY - hostRect.top < EDGE) speed = -Math.ceil((EDGE - (state.clientY - hostRect.top)) / 3)
        else if (hostRect.bottom - state.clientY < EDGE) speed = Math.ceil((EDGE - (hostRect.bottom - state.clientY)) / 3)
        if (speed !== 0) {
          host.scrollTop += speed * 2
          cancelAnimationFrame(frameRef.current)
          frameRef.current = requestAnimationFrame(sync)
        }
      }
      const schedule = () => {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = requestAnimationFrame(sync)
      }
      useEffect(() => () => cancelAnimationFrame(frameRef.current), [])
      const onPointerDown = (event) => {
        if (event.button !== 0) return
        const opts = optionsRef.current
        const host = opts.scrollRef.current
        if (host === null) return
        if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a') !== null) return
        // Keep the browser from starting a text selection under the drag (the
        // history/tree lists dragged out blue text before); the real clicks
        // still fire — only the selection machinery is suppressed.
        event.preventDefault()
        stateRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          scrollY0: host.scrollTop,
          clientX: event.clientX,
          clientY: event.clientY,
          active: false,
        }
        const onMove = (moveEvent) => {
          const state = stateRef.current
          if (state === null) return
          state.clientX = moveEvent.clientX
          state.clientY = moveEvent.clientY
          if (state.active === false && Math.abs(moveEvent.clientX - state.startX) < 4 && Math.abs(moveEvent.clientY - state.startY) < 4) return
          state.active = true
          swallowRef.current = true
          schedule()
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          cancelAnimationFrame(frameRef.current)
          const wasActive = stateRef.current !== null && stateRef.current.active === true
          stateRef.current = null
          setBox(null)
          // The drag's pointerup is followed by a synthetic click on whatever
          // row is under it — swallow exactly that one click.
          if (wasActive === true) setTimeout(() => { swallowRef.current = false }, 0)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }
      return { box: box, onPointerDown: onPointerDown, swallowRef: swallowRef }
    }

    /* The marquee box itself: a viewport-anchored absolute div inside the
       draw host (invariant 13: never position:fixed inside the workbench's
       contain:layout). */
    function MarqueeBox(props) {
      if (props.box === null) return null
      return E('div', {
        className: 'git4idea-marquee',
        style: { left: props.box.x + 'px', top: props.box.y + 'px', width: props.box.w + 'px', height: props.box.h + 'px' },
      })
    }

    /* First index whose cumulative offset exceeds `at` (binary search over the
       prefix-sum array; offsets.length === items.length + 1). */
    function windowStart(offsets, at) {
      let low = 0
      let high = offsets.length - 1
      while (low < high) {
        const mid = (low + high) >> 1
        if (offsets[mid] <= at) low = mid + 1
        else high = mid
      }
      return Math.max(0, low - 1)
    }

    /* One history row, memoised on its data (commit + graph row + selection):
       filter keystrokes re-render the list shell without touching unchanged
       rows. Refs show as IDEA-style tag icons after the subject; their names
       live in the hover tooltip, so the subject keeps the room. */
    const MAX_ROW_REFS = 4
    const CommitRow = memo(function CommitRow(props) {
      const commit = props.commit
      const refs = refDecorations(commit.refs)
      const shownRefs = refs.slice(0, MAX_ROW_REFS)
      const hiddenRefs = refs.length - shownRefs.length
      return E('div', {
        className: 'git4idea-commit' + (props.selected === true ? ' git4idea-commit-selected' : ''),
        /* Modifier handling lives in HistoryList (it owns the rendered row
           order the Shift-range walks); a plain click opens the detail (m00356). */
        onClick: (event) => props.onRowClick(event, commit),
        onContextMenu: (event) => { event.preventDefault(); props.onMenu(event, commit) },
      },
        /* Column order (m01737 #4, mirroring the IDE log): graph, message,
           ref icons, author, then the absolute timestamp. The relative "4d"
           column is gone — it made every row read differently by the hour. */
        E(GraphCell, { row: props.row, height: 26 }),
        E('span', { className: 'git4idea-commit-subject', 'data-tip': commit.subject }, commit.subject),
        refs.length === 0 ? null : E('span', {
          className: 'git4idea-ref-stack',
          /* One tooltip for the whole cluster, names top-to-bottom in the same
             order the detail pane lists them. The icons are inert (m00717): a
             click bubbles to the row and opens the commit like anywhere else. */
          'data-tip': refs.map((decoration) => decoration.name).join('\n'),
        },
          /* Reversed on purpose: later icons paint on top, so HEAD sits on the
             right and reads as "where the branch is". */
          shownRefs.slice().reverse().map((decoration, index) => E('span', {
            key: decoration.kind + ':' + decoration.name + ':' + index,
            className: 'git4idea-ref-icon git4idea-ref-' + decoration.kind,
          }, E(Icon, { name: 'tagOutline', size: 14 }))),
          hiddenRefs > 0 ? E('span', { className: 'git4idea-ref-count' }, '+' + String(hiddenRefs)) : null),
        E('span', { className: 'git4idea-commit-fill' }),
        E('span', { className: 'git4idea-commit-author', 'data-tip': commit.author }, commit.author),
        E('span', { className: 'git4idea-commit-date' }, shortDate(commit.date)))
    }, (prev, next) => prev.commit === next.commit && prev.row === next.row && prev.selected === next.selected && prev.t === next.t)

    function sinceThreshold(key) {
      if (key === 'today') { const start = new Date(); start.setHours(0, 0, 0, 0); return start.getTime() }
      if (key === 'week') return Date.now() - 7 * DAY_MS
      if (key === 'month') return Date.now() - 30 * DAY_MS
      if (key === 'year') return new Date(new Date().getFullYear(), 0, 1).getTime()
      return 0
    }

    /* The author filter pins "me (name)" to the top (v0.19.3). The identity
       is resolved once per repo root and kept for the panel lifetime — git
       identities don't churn within a session — so re-opening the Git tab or
       hopping sessions never re-runs `git config`. */
    const gitMeCache = new Map()

    function HistoryList(props) {
      const t = props.t
      const commits = props.commits
      const historyScrollRef = useRef(null)
      const [me, setMe] = useState(() => (props.base !== undefined && gitMeCache.has(props.base.repoRoot) === true ? gitMeCache.get(props.base.repoRoot) : null))
      useEffect(() => {
        const base = props.base
        if (base === undefined || base.repoRoot === undefined) return
        if (gitMeCache.has(base.repoRoot) === true) { setMe(gitMeCache.get(base.repoRoot)); return }
        let alive = true
        props.request('me', Object.assign({}, base)).then((data) => {
          const who = data !== null && typeof data === 'object' && typeof data.name === 'string' && data.name !== ''
            ? { name: data.name, email: typeof data.email === 'string' ? data.email : '' }
            : null
          gitMeCache.set(base.repoRoot, who)
          if (alive === true) setMe(who)
        }).catch((error) => { void error })
        return () => { alive = false }
      }, [props.base])
      const viewport = useViewportBox(historyScrollRef)
      /* v0.19.3: the commit log rubber-bands exactly like the changes list —
         same hook, same gestures. Fixed HISTORY_ROW_H rows make the rects a
         pure index map, so even a windowed (mostly unmounted) list drags
         perfectly; picks land in the SAME pickedHashes set the Shift/Ctrl
         clicks and the commit context menu already share. */
      const historyHostRef = useRef(null)
      const historyMarquee = useRubberBand({
        scrollRef: historyScrollRef,
        drawRef: historyHostRef,
        rectsOf: () => rows.map((row, index) => ({ key: row.commit.hash, top: index * HISTORY_ROW_H, bottom: (index + 1) * HISTORY_ROW_H })),
        onPick: (keys) => { if (props.onPicksChange !== undefined) props.onPicksChange(new Set(keys)) },
      })
      const pickAnchor = useRef(null)
      const [text, setText] = useState('')
      const [author, setAuthor] = useState('')
      const [refName, setRefName] = useState('')
      const [since, setSince] = useState('')

      const authors = useMemo(() => {
        const found = []
        for (const commit of commits) {
          if (typeof commit.author === 'string' && commit.author !== '' && found.indexOf(commit.author) < 0) found.push(commit.author)
        }
        return found.sort()
      }, [commits])

      /* Fallback only: the filter normally lists the branches payload. These
         decorations cover the first paint before that payload arrives. HEAD is
         mapped to its branch, and a remote's HEAD pointer is skipped. */
      const refOptions = useMemo(() => {
        const found = []
        for (const commit of commits) {
          const list = Array.isArray(commit.refs) ? commit.refs : []
          for (const entry of list) {
            const raw = String(entry)
            const info = refInfo(raw)
            const name = info.kind === 'head' && raw.indexOf('HEAD -> ') === 0 ? raw.slice(8) : info.name
            if (name === '' || name === 'HEAD' || name.endsWith('/HEAD') === true) continue
            if (found.indexOf(name) < 0) found.push(name)
          }
        }
        return found.sort()
      }, [commits])

      /* v0.3.1 (#7): the branch filter groups its rows the way the branch tree
         does. The branches payload owns the list, so the checked-out branch and
         branches outside the loaded commit page still show up. */
      const refGroups = useMemo(() => {
        const namesOf = (entries) => (Array.isArray(entries) ? entries : [])
          .map((entry) => String(entry.name))
          .filter((name) => name !== '' && name !== 'HEAD' && name.endsWith('/HEAD') === false)
        const list = props.branches
        if (list !== null && list !== undefined && Array.isArray(list.local) === true) {
          return { local: namesOf(list.local), remote: namesOf(list.remote), tags: namesOf(list.tags) }
        }
        const remoteNames = new Set(namesOf(list === null || list === undefined ? [] : list.remote))
        const local = []
        const remote = []
        for (const name of refOptions) {
          if (remoteNames.has(name) === true) remote.push(name)
          else local.push(name)
        }
        return { local: local, remote: remote, tags: [] }
      }, [refOptions, props.branches])

      const filtered = useMemo(() => {
        const needle = text.trim().toLowerCase()
        const threshold = sinceThreshold(since)
        const kept = commits.filter((commit) => {
          if (needle !== '') {
            const hit = String(commit.subject).toLowerCase().indexOf(needle) >= 0 ||
              String(commit.hash).toLowerCase().indexOf(needle) === 0 ||
              String(commit.author).toLowerCase().indexOf(needle) >= 0
            if (hit === false) return false
          }
          if (author !== '' && commit.author !== author) return false
          if (refName !== '') {
            const list = (Array.isArray(commit.refs) ? commit.refs : []).map((entry) => refInfo(entry).name)
            if (list.indexOf(refName) < 0) return false
          }
          if (threshold > 0) {
            const at = Date.parse(commit.date)
            if (Number.isFinite(at) && at < threshold) return false
          }
          return true
        })
        return kept
      }, [commits, text, author, refName, since])

      const rows = useMemo(() => buildRows(filtered), [filtered])

      /* Weibo-style infinite scroll (v0.19.3): descending lists auto-load when
         the user scrolls near the bottom edge, ascending ones near the top
         edge — wheel and scrollbar drags both surface as scroll events, no
         extra clicks. The button stays as the visible affordance. The guard
         keeps one request in flight; it resets when busy settles. */
      const infiniteGuardRef = useRef(false)
      const mergeLocatedRef = useRef(false)
      const requestMore = () => {
        if (props.hasMore !== true || props.busy === true || infiniteGuardRef.current === true) return
        const host = historyScrollRef.current
        infiniteGuardRef.current = true
        props.onLoadMore()
      }
      /* The button itself is the trigger (weibo-style, v0.19.3): an
         IntersectionObserver on the load-more button fires wherever it sits —
         bottom while descending, top while ascending — covering wheel,
         scrollbar drags, first paint, and short pages alike. Re-created per
         page so a settled load re-evaluates: if the button is STILL visible
         (huge viewport / tiny page) the next page follows automatically. */
      const loadMoreRef = useRef(null)
      /* A scroll that lands on the button WHILE a guarded load is still in
         flight loses its one IO callback to the busy bail-out, and the
         observer is not re-created when that load finishes with the same
         page size (mount refresh). Re-check the button's geometry when busy
         settles: still within the rootMargin window → continue loading. */
      useEffect(() => {
        if (props.busy !== false) return
        infiniteGuardRef.current = false
        const node = loadMoreRef.current
        const root = historyScrollRef.current
        if (node === null || root === null || props.hasMore !== true) return
        const rect = node.getBoundingClientRect()
        const box = root.getBoundingClientRect()
        if (rect.bottom >= box.top - 240 && rect.top <= box.bottom + 240) requestMore()
      }, [props.busy])
      useEffect(() => {
        const node = loadMoreRef.current
        const root = historyScrollRef.current
        if (node === null || root === null || props.hasMore !== true) return
        let frame = 0
        const io = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting === true) === false) return
          if (frame === 0) {
            frame = requestAnimationFrame(() => { frame = 0; requestMore() })
          }
        }, { root: root, rootMargin: '240px 0px' })
        io.observe(node)
        return () => { if (frame !== 0) cancelAnimationFrame(frame); io.disconnect() }
      }, [props.hasMore, rows.length])
      /* v0.19.3 IDEA-style merge memory: when a browsed branch has a merge
         relationship with the PREVIOUSLY browsed one, its list opens scrolled
         to that merge commit ('merge-point' resolved it) — the "2 was merged
         here" moment is on screen immediately, while 1's newer commits stay
         one wheel-scroll away. Fires only on anchor CHANGE; null = no
         relationship (or first hop), leave the top alone. */
      useEffect(() => {
        const anchor = props.mergeAnchor
        if (anchor === undefined || anchor === null) { mergeLocatedRef.current = false; return }
        const index = rows.findIndex((row) => row.commit.hash === anchor)
        if (index < 0) {
          /* The merge point can sit below the first page on a long branch
             (real repos easily outrun LIMIT). Keep auto-loading — the same
             weibo path as the edge trigger — until it surfaces or the log
             is exhausted; one location per anchor, so later 'load more'
             never yanks the view back. */
          if (mergeLocatedRef.current === false && props.hasMore === true && props.busy !== true) requestMore()
          return
        }
        if (mergeLocatedRef.current === true) return
        mergeLocatedRef.current = true
        const host = historyScrollRef.current
        if (host !== null) host.scrollTop = Math.max(0, index * HISTORY_ROW_H - 8)
      }, [props.mergeAnchor, rows.length, props.busy])
      /* Multi-select gestures (issue #13): the rendered row order is what the
         Shift-range walks, and the range is computed over the FILTERED rows —
         the same list the eye sees. A plain click selects and opens the detail
         (m00356); Shift/Ctrl clicks only extend the set, so a range is never
         interrupted. The stale-callback risk is nil: rows change identity
         with the filters, and every row re-renders whenever its commit
         reference changes. */
      const handleRowClick = (event, commit) => {
        const pickedHashes = props.pickedHashes
        const setPicks = props.onPicksChange
        if (setPicks === undefined) { props.onSelect(commit); return }
        const ordered = rows.map((row) => row.commit.hash)
        const index = ordered.indexOf(commit.hash)
        /* Functional updates only — memoised CommitRows may hold a stale
           closure of this handler (their memo compares commit/row/selected),
           so the picked set is never read from it. */
        if (event.shiftKey === true) {
          /* Anchor falls back to the FIRST row (VS Code semantics): a Shift
             click on a fresh list must multi-select, not degrade to single. */
          const anchorHash = pickAnchor.current !== null ? pickAnchor.current : ordered[0]
          const from = ordered.indexOf(anchorHash)
          if (from >= 0 && index >= 0) {
            const low = Math.min(from, index)
            const high = Math.max(from, index)
            setPicks((previous) => {
              const next = new Set(previous)
              for (let at = low; at <= high; at += 1) next.add(ordered[at])
              return next
            })
            return
          }
        }
        if (isToggleModifier(event) === true) {
          pickAnchor.current = commit.hash
          setPicks((previous) => {
            const next = new Set(previous)
            if (next.has(commit.hash) === true) next.delete(commit.hash)
            else next.add(commit.hash)
            return next
          })
          return
        }
        pickAnchor.current = commit.hash
        /* Plain click selects AND opens the detail (m00356): a single click
           triggers, as the IDE log does. Shift/Ctrl still only extend the
           picked set, so a drag or range is never interrupted mid-flight. */
        setPicks((previous) => previous.size === 1 && previous.has(commit.hash) === true ? previous : new Set([commit.hash]))
        props.onSelect(commit)
      }
      /* Ctrl+A selects the whole filtered list; everything else (Ctrl+C, Esc)
         belongs to the Panel-level handler that owns the picked set. */
      const onListKeyDown = (event) => {
        if (isTypingTarget(event.target) === true) return
        if (isToggleModifier(event) === true && (event.key === 'a' || event.key === 'A')) {
          event.preventDefault()
          if (props.onSelectAll !== undefined) props.onSelectAll(rows.map((row) => row.commit.hash))
          return
        }
        if (props.onKeyDown !== undefined) props.onKeyDown(event)
      }
      /* Round 3 #2: the path filter is a LIST (the checkbox tree picks several
         rows); the chip shows one path verbatim and counts the rest. */
      const pathList = Array.isArray(props.pathFilter) === true
        ? props.pathFilter.filter((entry) => typeof entry === 'string' && entry !== '')
        : typeof props.pathFilter === 'string' && props.pathFilter !== '' ? [props.pathFilter] : []
      const pathValue = pathList.length === 0 ? '' : pathList.length === 1 ? pathList[0] : fill(t('filter.pathCount'), { n: String(pathList.length) })
      const pathTip = pathList.join('\n')
      const applyPath = (value) => { if (props.onPathFilter !== undefined) props.onPathFilter(value) }
      const dirtyFilter = text !== '' || author !== '' || refName !== '' || since !== '' || pathList.length > 0

      /* Every value filter opens the same in-panel menu; a checked row marks the
         active value, so the chip never has to spell the whole list out. */
      const openFilterMenu = (event, options, currentValue, onPick) => {
        if (props.openMenuAt === undefined) return
        props.openMenuAt(event, options.map((option) => ({
          id: 'filter:' + String(option.value),
          /* Only the checked row carries a mark (m04507); the unselected ones
             used to draw a decorative icon, which read as a tick column. */
          icon: option.value === currentValue ? 'check' : undefined,
          tone: 'accent',
          label: option.label,
          active: option.value === currentValue,
          run: () => onPick(option.value),
        })))
      }
      /* v0.3.1 (round 2 #1, #2): the branch filter groups its rows under 本地 /
         远程, the way the branch tree does. A name folds on every '/' into
         header rows plus indented leaves — a menu carries one submenu level
         only, so nesting lives inside the submenu card. Directories sort A→Z and
         a branch with no '/' sits at the BOTTOM of its group. */
      const openRefMenu = (event) => {
        if (props.openMenuAt === undefined) return
        const leafOf = (name, label, indent) => ({
          id: 'filter:' + name,
          icon: name === refName ? 'check' : undefined,
          tone: 'accent',
          label: label,
          indent: indent,
          active: name === refName,
          run: () => setRefName(name),
        })
        /* strip is the prefix a leaf label drops (the group dir, or the remote
           name), so a nested row shows only its own segment. */
        const subRows = (names, strip, idPrefix) => {
          const root = { dirs: new Map(), leaves: [] }
          for (const name of names) {
            const shown = strip !== '' && name.indexOf(strip + '/') === 0 ? name.slice(strip.length + 1) : name
            const parts = shown.split('/')
            let node = root
            for (let index = 0; index < parts.length - 1; index += 1) {
              const part = parts[index]
              if (node.dirs.has(part) !== true) node.dirs.set(part, { dirs: new Map(), leaves: [] })
              node = node.dirs.get(part)
            }
            node.leaves.push({ name: name, label: parts[parts.length - 1] })
          }
          const rows = []
          const walk = (node, depth) => {
            for (const dir of Array.from(node.dirs.keys()).sort()) {
              rows.push({ id: idPrefix + strip + '/' + dir + ':' + depth, header: true, label: dir, indent: depth })
              walk(node.dirs.get(dir), depth + 1)
            }
            for (const leaf of node.leaves) rows.push(leafOf(leaf.name, leaf.label, depth))
          }
          walk(root, 0)
          return rows
        }
        const groupRows = (names, idPrefix) => {
          const groups = new Map()
          const bare = []
          for (const name of names) {
            const cut = name.indexOf('/')
            if (cut <= 0) { bare.push(name); continue }
            const dir = name.slice(0, cut)
            if (groups.has(dir) !== true) groups.set(dir, [])
            groups.get(dir).push(name)
          }
          const rows = []
          for (const dir of Array.from(groups.keys()).sort()) {
            rows.push({ id: idPrefix + dir, icon: 'folder', tone: 'secondary', label: dir, items: subRows(groups.get(dir), dir, idPrefix) })
          }
          for (const name of bare.sort()) rows.push(leafOf(name, name, 0))
          return rows
        }
        const rows = []
        if (refName !== '') rows.push({ id: 'filter:none', icon: 'close', tone: 'secondary', label: t('filter.clearOne'), run: () => setRefName('') })
        if (refGroups.local.length > 0) {
          rows.push({ id: 'ref-head-local', header: true, label: t('branches.local') })
          for (const row of groupRows(refGroups.local, 'filter-dir:')) rows.push(row)
        }
        if (refGroups.remote.length > 0) {
          rows.push({ id: 'ref-head-remote', header: true, label: t('branches.remote') })
          for (const row of groupRows(refGroups.remote, 'filter-dir-remote:')) rows.push(row)
        }
        if (refGroups.tags.length > 0) {
          rows.push({ id: 'ref-head-tags', header: true, label: t('branches.tags') })
          for (const row of groupRows(refGroups.tags, 'filter-dir-tag:')) rows.push(row)
        }
        props.openMenuAt(event, rows)
      }
      /* The path filter is a menu too (#N2): typing a path and walking a tree
         are the two ways in, and the chip carries the picked one. */
      const openPathMenu = (event) => {
        if (props.openMenuAt === undefined) return
        const rows = [
          {
            id: 'path:type', icon: 'file', tone: 'secondary', label: t('filter.pathChoose'),
            run: () => { if (props.onPathPrompt !== undefined) props.onPathPrompt() },
          },
          {
            id: 'path:tree', icon: 'folder', tone: 'secondary', label: t('filter.pathTree'),
            run: () => { if (props.onPathTree !== undefined) props.onPathTree() },
          },
        ]
        if (pathList.length > 0) rows.push({ id: 'path:clear', icon: 'close', tone: 'secondary', label: t('filter.clearOne'), run: () => applyPath([]) })
        props.openMenuAt(event, rows)
      }
      const allOption = { value: '', label: t('filter.all') }
      const filterBar = props.hideSearch === true ? null : E('div', { className: 'git4idea-filters' },
        E('span', { className: 'git4idea-filter-textwrap' },
          E('input', {
            className: 'git4idea-input git4idea-input-compact git4idea-filter-text', value: text, spellCheck: false,
            placeholder: t('history.filter'),
            onChange: (event) => setText(event.target.value),
          }),
          text === '' ? null : E('button', {
            type: 'button', className: 'git4idea-filter-clear', 'data-tip': t('filter.clearOne'),
            onClick: () => setText(''),
          }, E(Icon, { name: 'close', size: 9 }))),
        E(FilterSelect, {
          label: t('filter.branch'), value: refName, hint: t('filter.branch'),
          clearHint: t('filter.clearOne'), options: [],
          onOpenMenu: openRefMenu,
          onClear: () => setRefName(''),
        }),
        E(FilterSelect, {
          label: t('filter.user'), value: author, hint: t('filter.user'),
          clearHint: t('filter.clearOne'),
          /* "Me" first (v0.19.3): resolved from git config and offered even
             when this branch has no commits of mine — selecting it over an
             empty list is the answer "I never committed here". */
          options: [allOption]
            .concat(me !== null && me.name !== '' ? [{ value: me.name, label: t('history.me') + ' (' + me.name + ')' }] : [])
            .concat(authors.map((name) => ({ value: name, label: name }))),
          onOpenMenu: (event, options) => openFilterMenu(event, options, author, setAuthor),
          onClear: () => setAuthor(''),
        }),
        E(FilterSelect, {
          label: t('filter.date'), value: since, hint: t('filter.date'),
          clearHint: t('filter.clearOne'),
          options: [allOption,
            { value: 'today', label: t('filter.today') },
            { value: 'week', label: t('filter.week') },
            { value: 'month', label: t('filter.month') },
            { value: 'year', label: t('filter.year') }],
          onOpenMenu: (event, options) => openFilterMenu(event, options, since, setSince),
          onClear: () => setSince(''),
        }),
        E(FilterSelect, {
          label: t('filter.path'), value: pathValue, hint: t('filter.path'),
          clearHint: t('filter.clearOne'), options: [],
          tip: pathList.length === 0 ? t('filter.path') : t('filter.path') + ':\n' + pathTip,
          onOpenMenu: openPathMenu,
          onClear: () => applyPath([]),
        }))

      /* Windowed rendering: only the visible slice (± overscan) is mounted —
         "load more" into the hundreds still scrolls at frame rate. Spacers
         keep the scrollbar and the load-more button at honest positions. */
      const winStart = Math.max(0, Math.floor(viewport.scrollTop / HISTORY_ROW_H) - WINDOW_OVERSCAN)
      const winEnd = Math.min(rows.length, winStart + Math.ceil(viewport.viewH / HISTORY_ROW_H) + WINDOW_OVERSCAN * 2)
      const visibleRows = rows.slice(winStart, winEnd)

      /* Older commits load at the bottom, where the list ends. */
      const loadMoreButton = props.hasMore === true
        ? E('button', { ref: loadMoreRef, type: 'button', className: 'git4idea-load-more', disabled: props.busy === true, onClick: requestMore }, t('history.loadMore'))
        : null

      return E('div', { className: 'git4idea-history', ref: historyHostRef }, filterBar,
        E('div', {
          className: 'git4idea-history-scroll',
          ref: historyScrollRef,
          tabIndex: 0,
          onKeyDown: onListKeyDown,
          onPointerDown: historyMarquee.onPointerDown,
          onClickCapture: (event) => {
            if (historyMarquee.swallowRef.current === true) { event.preventDefault(); event.stopPropagation(); return }
            /* v0.19.4: blank click clears — see the changes/tree twins. */
            const target = event.target
            if (target instanceof Element && target.closest('.git4idea-commit,button,input,textarea,select,a') === null) {
              if (props.onPicksChange !== undefined) props.onPicksChange(new Set())
            }
          },
          onPointerDownCapture: (event) => {
            if (isTypingTarget(event.target) === false) event.currentTarget.focus({ preventScroll: true })
          },
        },
          rows.length === 0 ? E('div', { className: 'git4idea-empty' }, dirtyFilter ? t('filter.none') : t('history.empty')) : null,

          winStart > 0 ? E('div', { key: 'pad-top', style: { height: String(winStart * HISTORY_ROW_H) + 'px' } }) : null,
          visibleRows.map((row) => E(CommitRow, {
            key: row.commit.hash,
            commit: row.commit, row: row, t: t,
            selected: props.selectedHash === row.commit.hash
              || (props.pickedHashes !== undefined && props.pickedHashes.has(row.commit.hash) === true),
            onRowClick: handleRowClick, onMenu: props.onMenu, openMenuAt: props.openMenuAt,
          })),
          winEnd < rows.length ? E('div', { key: 'pad-bottom', style: { height: String((rows.length - winEnd) * HISTORY_ROW_H) + 'px' } }) : null,
          loadMoreButton),
        E(MarqueeBox, { box: historyMarquee.box }))
    }

    /* One changed-file list for the commit detail pane AND the push dialog
       (m02986 follow-up): folders first, files indented under them — the IDE
       commit tree. The push dialog used a flat row without the capped path
       class, so a long path squeezed the file name to zero width and clipped
       the stat. Two renderers cannot drift back apart when there is one. */
    /* v0.3.1: fold-all needs every node id at once; the root folder row (files
       directly under the repository root) is a node too, so it joins the set. */
    function commitFileFoldState(files) {
      const forest = buildDirForest(files, 'commitFiles')
      const all = {}
      if (forest.rootFiles.length > 0) all['commitFiles|/'] = true
      for (const id of forest.ids) all[id] = true
      return all
    }

    /* The expand-all / collapse-all pair, shared by the commit detail pane and
       the push dialog. Both wear the rail's icon set and size. */
    function FileTreeFoldButtons(props) {
      const t = props.t
      const files = Array.isArray(props.files) ? props.files : []
      return E('span', { className: 'git4idea-fold-btns' },
        E('button', {
          type: 'button', className: 'git4idea-fold-btn', 'aria-label': t('changes.expandAll'), 'data-tip': t('changes.expandAll'),
          onClick: () => props.onFolded({}),
        }, E(Icon, { name: 'expand', size: 14 })),
        E('button', {
          type: 'button', className: 'git4idea-fold-btn', 'aria-label': t('changes.collapseAll'), 'data-tip': t('changes.collapseAll'),
          onClick: () => props.onFolded(commitFileFoldState(files)),
        }, E(Icon, { name: 'collapse', size: 14 })))
    }

    function CommitFileList(props) {
      const t = props.t
      const files = Array.isArray(props.files) ? props.files : []
      const byPath = (a, b) => a.path.localeCompare(b.path)
      /* Controlled when the caller owns the fold map (the fold buttons live in
         the caller's header row); internal otherwise. */
      const [innerFolded, setInnerFolded] = useState({})
      const folded = props.folded === undefined ? innerFolded : props.folded
      const setFolded = props.onFolded === undefined ? setInnerFolded : props.onFolded
      const forest = useMemo(() => buildDirForest(files, 'commitFiles'), [files])
      const toggle = (id) => setFolded((previous) => Object.assign({}, previous, { [id]: previous[id] !== true }))
      const rows = []
      const fileRow = (file, depth) => {
        rows.push(E('div', {
          key: 'file:' + file.path,
          className: 'git4idea-row git4idea-row-file' + (props.selectedPath === file.path ? ' git4idea-row-selected' : ''),
          style: { paddingLeft: (8 + depth * 12) + 'px' },
          'data-tip': file.path,
          tabIndex: 0,
          /* Same click model as everywhere else: click selects, double-click
             (or Enter) opens the diff. */
          onClick: props.onSelect === undefined ? undefined : () => props.onSelect(file),
          onDoubleClick: props.onOpen === undefined ? undefined : () => props.onOpen(file),
          onKeyDown: (event) => { if (event.key === 'Enter' && props.onOpen !== undefined) props.onOpen(file) },
          onContextMenu: props.onMenu === undefined ? undefined : (event) => { event.preventDefault(); props.onMenu(event, file) },
        },
          FileTypeGlyph({ path: file.path }),
          E('span', { className: 'git4idea-row-label' }, baseName(file.path)),
          file.additions > 0 ? E('span', { className: 'git4idea-stat-add' }, '+' + file.additions) : null,
          file.deletions > 0 ? E('span', { className: 'git4idea-stat-del' }, '-' + file.deletions) : null))
      }
      const folderRow = (id, label, count, depth) => {
        const open = folded[id] !== true
        rows.push(E('button', {
          key: 'folder:' + id,
          type: 'button',
          className: 'git4idea-folder-head',
          style: { paddingLeft: (4 + depth * 12) + 'px' },
          onClick: () => { toggle(id) },
        },
          E('span', { className: 'git4idea-chevron' + (open ? ' git4idea-chevron-open' : '') }, E(Icon, { name: 'chevron', size: 10 })),
          E('span', { className: 'git4idea-row-icon git4idea-tone-accent' }, E(Icon, { name: 'folder', size: 10 })),
          E('span', { className: 'git4idea-folder-name' }, label),
          E('span', { className: 'git4idea-count' }, String(count))))
        return open
      }
      /* Subfolders first, then the folder's own files — the IDE tree order.
         node.path carries the FULL path, so the label is only the chain this
         node adds below its parent (compressed chains stay one row). */
      const walk = (node, depth, parentLen) => {
        const open = folderRow('commitFiles|' + node.path.join('/'), node.path.slice(parentLen).join('/'), forest.countOf(node), depth)
        if (open !== true) return
        for (const child of forest.sortedChildren(node)) walk(child, depth + 1, node.path.length)
        for (const file of node.files.slice().sort(byPath)) fileRow(file, depth + 1)
      }
      if (forest.rootFiles.length > 0) {
        if (folderRow('commitFiles|/', t('changes.rootDir'), forest.rootFiles.length, 0) === true) {
          for (const file of forest.rootFiles.slice().sort(byPath)) fileRow(file, 1)
        }
      }
      for (const node of forest.roots) walk(node, 0, 0)
      return rows
    }

    function CommitDetail(props) {
      const t = props.t
      const detail = props.detail
      /* IDEA's "in N branches" (m00717) starts collapsed. The flag is keyed by
         commit hash, so picking another commit collapses it again without an
         effect (hooks run before the empty-state return below). */
      const [expandedHash, setExpandedHash] = useState(null)
      const [fileFolded, setFileFolded] = useState({})
      /* The right column (m01216): changed files on top (2/3 of the height), the
         commit message below (1/3). The parent folder rides in its own column so
         two files called index.js are told apart without a tooltip. */
      const fileRows = detail === null || detail === undefined
        ? null
        : detail.files.length === 0
          ? E('div', { className: 'git4idea-empty' }, t('detail.noFiles'))
          : E(CommitFileList, {
              t: t,
              files: detail.files,
              folded: fileFolded,
              onFolded: setFileFolded,
              selectedPath: props.selectedPath,
              onSelect: props.onSelectFile,
              onOpen: props.onOpenFile,
              onMenu: props.onFileMenu,
            })
      if (detail === null || detail === undefined) return E('div', { className: 'git4idea-empty git4idea-detail-empty' }, t('detail.pick'))
      /* The refs the row shows as icons, spelled out in IDEA's order: one tag
         icon and one name per ref, HEAD first, tags last. */
      const refBadges = refDecorations(detail.refs).map((decoration, index) => E('span', {
        key: decoration.kind + ':' + decoration.name + ':' + index,
        className: 'git4idea-detail-ref',
      },
        E('span', { className: 'git4idea-ref-icon git4idea-ref-' + decoration.kind }, E(Icon, { name: 'tagOutline', size: 14 })),
        E('span', { className: 'git4idea-detail-ref-name' }, decoration.name)))
      const refBlock = refBadges.length === 0 ? null : E('div', { className: 'git4idea-detail-refs' }, refBadges)
      /* Branches that contain the commit, as the host reports them: local heads
         first, then remotes, origin/HEAD dropped. Collapsed shows the first
         three names inline, expanded lists every one on its own line. */
      const branches = Array.isArray(detail.branches) ? detail.branches : []
      const expanded = expandedHash === detail.hash
      const branchBlock = branches.length === 0 ? null : E('div', { className: 'git4idea-detail-branches' },
        E('div', { className: 'git4idea-detail-branches-line' },
          E('span', { className: 'git4idea-detail-branches-label' }, fill(t('detail.branches'), { n: branches.length })),
          expanded
            ? null
            : E('span', { className: 'git4idea-detail-branches-names' }, branches.slice(0, 3).join(', ') + (branches.length > 3 ? ', …' : '')),
          E('button', {
            type: 'button',
            className: 'git4idea-link',
            onClick: () => { setExpandedHash(expanded ? null : detail.hash) },
          }, expanded ? t('detail.hide') : t('detail.showAll'))),
        expanded
          ? E('div', { className: 'git4idea-detail-branches-list' }, branches.map((name) => E('div', { key: name, className: 'git4idea-detail-branch' }, name)))
          : null)
      /* The header names the author the way git does, `name <email>`, so the
         address is visible without a hover (m01756). */
      const authorText = detail.email === undefined || detail.email === ''
        ? detail.author
        : detail.author + ' <' + detail.email + '>'
      if (props.pane === true) {
        return E('div', { className: 'git4idea-detail git4idea-detail-pane' },
          E('div', { className: 'git4idea-detail-files-head' },
            E('span', null, t('detail.files') + ' · ' + String(detail.files.length)),
            E(FileTreeFoldButtons, { t: t, files: detail.files, onFolded: setFileFolded })),
          E('div', { className: 'git4idea-detail-files' }, fileRows),
          E('div', { className: 'git4idea-detail-msg' },
            E('div', { className: 'git4idea-detail-head' },
              E('span', { className: 'git4idea-mono' }, detail.shortHash),
              E('span', { className: 'git4idea-detail-author', 'data-tip': authorText }, authorText),
              E('span', { className: 'git4idea-detail-date' }, shortDate(detail.date))),
            E('div', { className: 'git4idea-detail-subject' }, detail.subject),
            detail.body === undefined || detail.body.trim() === '' ? null : E('pre', { className: 'git4idea-detail-body' }, detail.body.trim()),
            refBlock,
            branchBlock))
      }
      return E('div', { className: 'git4idea-detail' },
        E('div', { className: 'git4idea-detail-head' },
          E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-small', onClick: props.onBack }, '← ' + t('detail.back')),
          E('span', { className: 'git4idea-mono' }, detail.shortHash),
          E('span', { className: 'git4idea-detail-author', 'data-tip': authorText }, authorText),
          E('span', { className: 'git4idea-detail-date' }, shortDate(detail.date))),
        E('div', { className: 'git4idea-detail-subject' }, detail.subject),
        detail.body === undefined || detail.body.trim() === '' ? null : E('pre', { className: 'git4idea-detail-body' }, detail.body.trim()),
        refBlock,
        branchBlock,
        E('div', { className: 'git4idea-detail-files-head' }, t('detail.files') + ' · ' + String(detail.files.length)),
        E('div', { className: 'git4idea-detail-files' }, fileRows))
    }

