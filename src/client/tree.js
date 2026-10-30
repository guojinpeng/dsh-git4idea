    /* ============================== branch tree ============================== */

    function BranchRow(props) {
      const t = props.t
      const entry = props.entry
      const isHead = entry.head === true
      const kind = entry.tag === true ? 'tag' : entry.remote === true ? 'remote' : isHead ? 'head' : 'local'
      // A favorited branch wears a SOLID amber star everywhere it appears
      // (favorites section AND its home section) — before this the row kept
      // its plain kind glyph, so a starred branch read as "not favorited".
      const starred = props.starred === true
      const tone = starred ? 'warn' : kind === 'tag' ? 'warn' : kind === 'remote' ? 'violet' : kind === 'head' ? 'success' : 'accent'
      const glyph = kind === 'tag' ? 'tag' : kind === 'remote' ? 'fetch' : kind === 'head' ? 'star' : 'branch'
      const where = entry.upstream === null || entry.upstream === undefined ? entry.name : entry.name + ' → ' + entry.upstream
      // A single click SELECTS the branch and browses its commit history
      // (m00356); Shift/Ctrl+click only extends the selection, so a range is
      // never interrupted. Checkout stays in the right-click menu: it rewrites
      // the working tree, which a stray click must not do.
      return E('div', {
        className: 'git4idea-row git4idea-row-' + kind + (props.selected === true ? ' git4idea-row-selected' : ''),
        style: { paddingLeft: (BRANCH_INDENT_BASE + (props.depth === undefined ? 0 : props.depth) * BRANCH_INDENT_STEP) + 'px' },
        /* Rubber-band anchor: the marquee intersects [data-mkey] rows to
           rebuild the picked set (selKey = local:/remote:/tag: prefixed). */
        'data-mkey': props.selKey,
        'data-tip': where + ' · ' + t('branches.pickHint'),
        onClick: (event) => props.onPick(event, entry, props.selKey),
        onContextMenu: (event) => { event.preventDefault(); props.onMenu(event, entry) },
      },
        E('span', { className: 'git4idea-row-icon git4idea-tone-' + tone + (starred === true ? ' git4idea-star-filled' : '') }, E(Icon, { name: glyph, size: 12 })),
        E('span', { className: 'git4idea-row-label' }, props.label === undefined ? entry.name : props.label),
        // Tracking target (issue #18): the old inline "→ origin/feature/…"
        // text took up to 180px and pushed the branch name into an ellipsis in
        // the narrow panel. It is now the same tag-outline glyph the log rows
        // use for refs: the name lives in the hover tooltip, the label keeps
        // the room. Remote rows ARE the upstream and tags never track.
        kind !== 'remote' && kind !== 'tag' && entry.upstream !== null && entry.upstream !== undefined ? E('span', {
          className: 'git4idea-row-upstream',
          'data-tip': entry.name + ' → ' + entry.upstream,
        }, E(Icon, { name: 'tagOutline', size: 12 })) : null,
        // A bare 'W' told nobody anything (reported right after the section counts):
        // it means this branch is checked out in ANOTHER working tree, which is why
        // git refuses to check it out here. An icon plus a spelled-out tooltip says so.
        entry.worktree === null || entry.worktree === undefined ? null : E('span', {
          className: 'git4idea-badge git4idea-badge-muted git4idea-badge-worktree',
          'data-tip': t('branches.worktree') + ': ' + entry.worktree,
        }, E(Icon, { name: 'folder', size: 10 })),
        // Same green push / blue pull glyphs as the panel bars (m00246): the
        // bare ↑12 told only half the story and read as a badge, not a count.
        entry.ahead > 0 ? E('span', { className: 'git4idea-cs-ahead' }, E(Icon, { name: 'push', size: 10 }), String(entry.ahead)) : null,
        entry.behind > 0 ? E('span', { className: 'git4idea-cs-behind' }, E(Icon, { name: 'pull', size: 10 }), String(entry.behind)) : null)
    }

    function BranchTree(props) {
      const t = props.t
      const [filter, setFilter] = useState('')
      const [collapsed, setCollapsed] = useState(() => treeSectionsOf(readTreeState()))
      /* Multi-select (issue #13): the old single `picked` name becomes a Set of
         selKeys (`local:name` / `remote:name` / `tag:name` — the prefix keeps a
         branch and a tag that share a name from colliding). */
      const [picks, setPicks] = useState(() => new Set())
      /* v0.19.4: the Panel bumps clearSignal when ANOTHER list gains the
         selection (or a blank click clears everywhere) — drop ours. Monotonic
         epochs start at 0, so the mount pass never clears. */
      const treeClearSignal = props.clearSignal === undefined ? 0 : props.clearSignal
      const seenTreeClear = useRef(treeClearSignal)
      /* v0.19.4 echo guard: only USER gestures may flow up to the Panel — the
         mirror effect below reports picks exactly once per gesture. Reactive
         setPicks calls (the clear-signal effect above, the survival filter)
         must NOT re-enter the forwarder, or the epoch it bumps clears the
         selection the OTHER list just made (the T1b echo bug). */
      const reportGestureRef = useRef(false)
      useEffect(() => {
        if (seenTreeClear.current !== treeClearSignal) {
          seenTreeClear.current = treeClearSignal
          reportGestureRef.current = false
          setPicks(new Set())
        }
      }, [treeClearSignal])
      const pickAnchor = useRef(null)
      const visibleRef = useRef([])
      const [foldedFolders, setFoldedFolders] = useState(() => {
        const stored = readTreeState()
        return stored !== null && typeof stored === 'object' && stored.folders !== null && typeof stored.folders === 'object'
          ? stored.folders
          : {}
      })
      /* Survive the remount a session switch performs (v0.13.1). */
      useEffect(() => {
        const stored = readTreeState()
        writeTreeState(Object.assign({}, stored, { sections: collapsed }))
      }, [collapsed])
      useEffect(() => {
        const stored = readTreeState()
        writeTreeState(Object.assign({}, stored, { folders: foldedFolders }))
      }, [foldedFolders])
      /* v0.3.1: the rail's expand-all / collapse-all buttons reach the tree as a
         stamped signal. Applying it writes the SAME persisted state a click on a
         section head writes, so the choice survives a remount. Collapse keeps
         the section heads (only their bodies fold). */
      const foldSignal = props.foldSignal === undefined ? null : props.foldSignal
      const seenFoldSignal = useRef(foldSignal === null ? 0 : foldSignal.at)
      useEffect(() => {
        if (foldSignal === null || seenFoldSignal.current === foldSignal.at) return
        seenFoldSignal.current = foldSignal.at
        const fold = foldSignal.mode === 'collapse'
        const next = {}
        for (const key of ['favorites', 'local', 'remote', 'tags']) next[key] = fold
        setCollapsed(next)
        /* Round 2: 全部收起 must fold EVERY nested folder too, so opening a
           section head afterwards still shows closed subdirectories. The ids use
           the same scheme rowsOf renders with ('' for local/favorites, 'remote'
           for the remote section). 全部展开 clears them all. */
        const dirs = {}
        if (fold === true) {
          const collect = (node, prefix) => {
            for (const name of node.folders.keys()) {
              const id = prefix === '' ? name : prefix + '/' + name
              dirs[id] = true
              collect(node.folders.get(name), id)
            }
          }
          collect(forestOf(locals), '')
          collect(forestOf(remotes.map((entry) => Object.assign({}, entry, { remote: true })), remoteNameOf), 'remote')
        }
        setFoldedFolders(dirs)
      }, [foldSignal])
      const branches = props.branches
      const needle = filter.trim().toLowerCase()
      const match = (name) => needle === '' || String(name).toLowerCase().indexOf(needle) >= 0
      const remotes = (branches === null ? [] : branches.remote).filter((entry) => match(entry.name))
      const tags = (branches === null ? [] : branches.tags).filter((entry) => match(entry.name))
      const favorites = Array.isArray(props.favorites) ? props.favorites : []
      // Favorited branches float to the top of the local list; the stable sort
      // keeps the alphabetical order inside each of the two groups, so both the
      // favorites section and the local tree show the starred rows first.
      const locals = (branches === null ? [] : branches.local).filter((entry) => match(entry.name))
        .sort((a, b) => (favorites.indexOf(a.name) >= 0 ? 0 : 1) - (favorites.indexOf(b.name) >= 0 ? 0 : 1))
      /* The HEAD row acts like a branch row since v0.19.3: click selects,
         double-click browses the current branch's history, right-click opens
         the same row menu (quick jump back to HEAD lives there). */
      const headEntry = locals.find((entry) => entry.head === true) || null
      /* v0.19.9: remote rows group by their path BELOW the "<remote>/" prefix;
         the full name still drives every selKey/menu/checkout path. */
      const remoteStrip = remoteTreeStripOf(remotes.map((entry) => entry.name))
      const remoteNameOf = (entry) => {
        const name = String(entry.name)
        return remoteStrip !== '' && name.startsWith(remoteStrip) === true ? name.slice(remoteStrip.length) : name
      }
      /* A refresh that makes a picked ref disappear must not keep it selected. */
      useEffect(() => {
        reportGestureRef.current = false
        setPicks((previous) => {
          if (previous.size === 0) return previous
          const alive = new Set()
          for (const entry of locals) alive.add(branchSelKeyOf(entry))
          for (const entry of remotes) alive.add(branchSelKeyOf(entry))
          for (const entry of tags) alive.add(branchSelKeyOf(entry))
          const next = new Set()
          for (const key of previous) {
            if (alive.has(key) === true) next.add(key)
          }
          return next.size === previous.size ? previous : next
        })
      }, [branches])
      /* Report the picks up to the Panel on every change (a plain effect — a
         render-time call would trip the hooks rules): the rail reads them so
         its buttons can act on the selection instead of only on HEAD. */
      useEffect(() => {
        if (reportGestureRef.current !== true) return
        reportGestureRef.current = false
        if (props.onPicksChange !== undefined) props.onPicksChange(picks)
      }, [picks])
      /**
       * Branch names nest on '/', the way an IDE shows a branch namespace: clicking a
       * row only SELECTS it (checking out rewrites the working tree), so the row
       * carries the selection and a double-click does the checkout.
       */
      /* nameOf (v0.19.9) lets the remote section group by its name WITHOUT the
         "<remote>/" prefix (see remoteTreeStripOf) while every row keeps its
         full entry.name for selection, menus and checkout. */
      const forestOf = (entries, nameOf) => {
        const labelOf = nameOf === undefined ? (entry) => entry.name : nameOf
        const root = { folders: new Map(), leaves: [] }
        for (const entry of entries) {
          const parts = String(labelOf(entry)).split('/')
          let node = root
          for (let index = 0; index < parts.length - 1; index += 1) {
            const key = parts[index]
            if (node.folders.has(key) === false) node.folders.set(key, { folders: new Map(), leaves: [] })
            node = node.folders.get(key)
          }
          node.leaves.push({ entry: entry, label: parts[parts.length - 1] })
        }
        return root
      }
      const countLeaves = (node) => node.leaves.length + Array.from(node.folders.values()).reduce((sum, child) => sum + countLeaves(child), 0)
      /* Depth-first flatten in the EXACT order the tree renders them: expanded
         folders before their leaves. Shift-ranges and Ctrl+A walk this one
         order; folded folders contribute nothing (their rows are not shown). */
      const flatLeaves = (node, prefix, depth, out) => {
        for (const name of Array.from(node.folders.keys()).sort()) {
          const id = prefix === '' ? name : prefix + '/' + name
          if (foldedFolders[id] !== true) flatLeaves(node.folders.get(name), id, depth + 1, out)
        }
        for (const leaf of node.leaves) out.push({ entry: leaf.entry, label: leaf.label, depth: depth })
        return out
      }
      const handlePick = useCallback((event, entry, selKey) => {
        reportGestureRef.current = true
        const ordered = visibleRef.current.map((leaf) => branchSelKeyOf(leaf.entry))
        if (event.shiftKey === true) {
          /* No anchor yet (fresh tree, nothing clicked): VS Code semantics —
             the range starts at the FIRST visible row, so a first-click Shift
             still multi-selects instead of silently degrading to single. */
          const anchorKey = pickAnchor.current !== null ? pickAnchor.current : ordered[0]
          const from = ordered.indexOf(anchorKey)
          const to = ordered.indexOf(selKey)
          if (from >= 0 && to >= 0) {
            const low = Math.min(from, to)
            const high = Math.max(from, to)
            const next = new Set(picks)
            for (let index = low; index <= high; index += 1) next.add(ordered[index])
            setPicks(next)
            return
          }
        }
        if (isToggleModifier(event) === true) {
          const next = new Set(picks)
          if (next.has(selKey) === true) next.delete(selKey)
          else next.add(selKey)
          pickAnchor.current = selKey
          setPicks(next)
          return
        }
        pickAnchor.current = selKey
        setPicks(new Set([selKey]))
        /* The plain click also browses that branch (m00356): its commit list
           replaces the history, so one click triggers the action. */
        if (props.onBrowse !== undefined) props.onBrowse(entry)
      }, [picks, props.onBrowse])
      const branchRow = (entry, label, depth) => E(BranchRow, {
        key: 'row:' + branchSelKeyOf(entry), entry: entry, label: label, depth: depth, t: t,
        selKey: branchSelKeyOf(entry),
        selected: picks.has(branchSelKeyOf(entry)) === true,
        starred: entry.tag !== true && entry.remote !== true && favorites.indexOf(entry.name) >= 0,
        onPick: handlePick,
        onBrowse: props.onBrowse, onMenu: onRowMenu,
      })
      const rowsOf = (node, prefix, depth) => {
        const out = []
        for (const name of Array.from(node.folders.keys()).sort()) {
          const id = prefix === '' ? name : prefix + '/' + name
          const open = foldedFolders[id] !== true
          const child = node.folders.get(name)
          out.push(E('div', { className: 'git4idea-branch-folder', key: 'dir:' + id },
            E('button', {
              type: 'button', className: 'git4idea-folder-head',
              style: { paddingLeft: (BRANCH_INDENT_BASE + depth * BRANCH_INDENT_STEP) + 'px' },
              onClick: () => setFoldedFolders((previous) => Object.assign({}, previous, { [id]: previous[id] !== true })),
            },
              E('span', { className: 'git4idea-chevron' + (open ? ' git4idea-chevron-open' : '') }, E(Icon, { name: 'chevron', size: 10 })),
              E('span', { className: 'git4idea-folder-name' }, name),
              E('span', { className: 'git4idea-count' }, String(countLeaves(child)))),
            open ? rowsOf(child, id, depth + 1) : null))
        }
        for (const leaf of node.leaves) out.push(branchRow(leaf.entry, leaf.label, depth))
        return out
      }
      /* ns (v0.19.9) namespaces the fold ids of a grouped section ("remote/…")
         so its folders remember their state independently of the local ones. */
      const section = (key, title, entries, decorate, grouped, ns, nameOf) => E('div', { className: 'git4idea-section', key: key },
        E('button', {
          type: 'button', className: 'git4idea-section-head',
          onClick: () => setCollapsed((previous) => Object.assign({}, previous, { [key]: !previous[key] })),
        },
          E('span', { className: 'git4idea-chevron' + (collapsed[key] === true ? '' : ' git4idea-chevron-open') }, E(Icon, { name: 'chevron', size: 12 })),
          // No count here: a bare digit next to the section name read as another
          // column instead of a total (reported on v0.3.10).
          E('span', null, title)),
        collapsed[key] === true ? null : E('div', { className: 'git4idea-section-body' },
          grouped === true
            ? rowsOf(forestOf(entries.map((entry) => decorate(entry)), nameOf), ns || '', 0)
            : entries.map((entry) => branchRow(decorate(entry), undefined, 0))))
      /* Render-order mirror for Shift-ranges and Ctrl+A, plus the selKey→entry
         lookup the right-click menu and the Delete key resolve through. */
      const visibleLeaves = []
      if (favorites.length > 0) flatLeaves(forestOf(locals.filter((entry) => favorites.indexOf(entry.name) >= 0)), '', 0, visibleLeaves)
      flatLeaves(forestOf(locals), '', 0, visibleLeaves)
      /* Same tree, same prefix namespace the section renders with — Shift-ranges
         and Ctrl+A must walk the EXACT order rows are shown in. */
      flatLeaves(forestOf(remotes.map((entry) => Object.assign({}, entry, { remote: true })), remoteNameOf), 'remote', 0, visibleLeaves)
      for (const entry of tags) visibleLeaves.push({ entry: entry, label: undefined, depth: 0 })
      visibleRef.current = visibleLeaves
      const entryBySelKey = new Map()
      for (const entry of locals) entryBySelKey.set(branchSelKeyOf(entry), { selKey: branchSelKeyOf(entry), kind: 'local', name: entry.name, entry: entry })
      for (const entry of remotes) entryBySelKey.set(branchSelKeyOf(entry), { selKey: branchSelKeyOf(entry), kind: 'remote', name: entry.name, entry: entry })
      for (const entry of tags) entryBySelKey.set(branchSelKeyOf(entry), { selKey: branchSelKeyOf(entry), kind: 'tag', name: entry.name, entry: entry })
      const pickedEntries = () => {
        const entries = []
        for (const key of picks) {
          const found = entryBySelKey.get(key)
          if (found !== undefined) entries.push(found)
        }
        return entries
      }
      const onRowMenu = (event, entry) => {
        const selKey = branchSelKeyOf(entry)
        // Right-clicking a row that is part of a multi-select acts on the WHOLE
        // selection; anything else collapses to the ordinary single-row menu.
        if (picks.has(selKey) === true && picks.size > 1 && props.onBranchMenu !== undefined) {
          props.onBranchMenu(event, entry, pickedEntries())
          return
        }
        props.onBranchMenu(event, entry, null)
      }
      /* v0.19.3: the tree rubber-bands like the other two lists (shared hook).
         Tree rows have no fixed height and render unfolded-only, so the row
         rects are a LIVE DOM measure over the [data-mkey] rows BranchRow
         carries; section/folder headers are buttons and never start a drag.
         Favorited branches render twice (favorites + local sections) — both
         map to one selKey, so a Set dedupes them for free. */
      const treeHostRef = useRef(null)
      const treeScrollRef = useRef(null)
      const treeMarquee = useRubberBand({
        scrollRef: treeScrollRef,
        drawRef: treeHostRef,
        rectsOf: () => {
          const host = treeScrollRef.current
          if (host === null) return []
          const hostRect = host.getBoundingClientRect()
          const rects = []
          host.querySelectorAll('[data-mkey]').forEach((row) => {
            const rect = row.getBoundingClientRect()
            rects.push({ key: row.getAttribute('data-mkey'), top: rect.top - hostRect.top + host.scrollTop, bottom: rect.bottom - hostRect.top + host.scrollTop })
          })
          return rects
        },
        onPick: (keys) => { reportGestureRef.current = true; setPicks(new Set(keys)) },
      })
      /* List-scope keyboard: Ctrl/Cmd+C copies the picked names, Delete asks
         Panel for a grouped delete (head branches are skipped — git refuses
         them anyway), Ctrl+A selects every visible row, Esc clears. */
      const onTreeKeyDown = (event) => {
        if (isTypingTarget(event.target) === true) return
        const mod = isToggleModifier(event)
        if (mod === true && (event.key === 'c' || event.key === 'C')) {
          if (picks.size === 0 || props.onCopyValues === undefined) return
          event.preventDefault()
          props.onCopyValues(pickedEntries().map((item) => item.name))
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (picks.size === 0 || props.onDeleteEntries === undefined) return
          const entries = pickedEntries().filter((item) => item.kind !== 'local' || item.entry.head !== true)
          if (entries.length === 0) return
          event.preventDefault()
          props.onDeleteEntries(entries)
          return
        }
        if (mod === true && (event.key === 'a' || event.key === 'A')) {
          event.preventDefault()
          setPicks(new Set(visibleLeaves.map((leaf) => branchSelKeyOf(leaf.entry))))
          return
        }
        if (event.key === 'Escape') setPicks(new Set())
      }
      return E('div', {
        className: 'git4idea-tree',
        ref: treeHostRef,
        tabIndex: 0,
        onKeyDown: onTreeKeyDown,
        onPointerDownCapture: (event) => {
          if (isTypingTarget(event.target) === false) event.currentTarget.focus({ preventScroll: true })
        },
      },
        E('div', { className: 'git4idea-search' },
          E('input', {
            className: 'git4idea-input git4idea-input-compact', value: filter, spellCheck: false,
            placeholder: t('branches.filter'),
            onChange: (event) => setFilter(event.target.value),
          })),
        E('div', {
          className: 'git4idea-tree-scroll',
          ref: treeScrollRef,
          onPointerDown: treeMarquee.onPointerDown,
          onClickCapture: (event) => {
            if (treeMarquee.swallowRef.current === true) { event.preventDefault(); event.stopPropagation(); return }
            /* v0.19.4: a blank click (not on a branch row or a control) clears
               the picks here AND everywhere else — "selection follows the last
               gesture". The Set goes up through the same forwarder a row click
               uses, so the other two lists reset as well. */
            const target = event.target
            if (target instanceof Element && target.closest('[data-mkey],button,input,textarea,select,a') === null) {
              reportGestureRef.current = true
              setPicks(new Set())
            }
          },
        },
          headEntry === null ? E('div', { className: 'git4idea-section-head git4idea-section-head-static' }, t('branches.head')) : E('div', {
            className: 'git4idea-section-head git4idea-section-head-static git4idea-head-branch',
            'data-tip': headEntry.name + ' · ' + t('branches.headHint'),
            onClick: (event) => { event.stopPropagation(); handlePick(event, headEntry, branchSelKeyOf(headEntry)) },
            onContextMenu: (event) => { event.preventDefault(); onRowMenu(event, headEntry) },
          }, t('branches.head')),
          favorites.length === 0 ? null : section('favorites', t('branches.favorites'), locals.filter((entry) => favorites.indexOf(entry.name) >= 0), (entry) => entry),
          section('local', t('branches.local'), locals, (entry) => entry, true),
          section('remote', t('branches.remote'), remotes, (entry) => Object.assign({}, entry, { remote: true }), true, 'remote', remoteNameOf),
          section('tags', t('branches.tags'), tags, (entry) => Object.assign({}, entry, { tag: true }))),
        E(MarqueeBox, { box: treeMarquee.box }))
    }

    /* v0.3.1 (#6): the Git detail page names a branch with the composer's own
       chooser — same search box, same 提交/推送/新建分支 verbs, same 本地/远程
       tree, same row flyout. The old flat "switch branch" menu is gone, so the
       two pages read as one control. */
    function BranchChooser(props) {
      const t = props.t
      const [needle, setNeedle] = useState('')
      const [folded, setFolded] = useState({})
      const [row, setRow] = useState(null)
      const inputRef = useRef(null)
      useEffect(() => { if (inputRef.current !== null) inputRef.current.focus() }, [])
      const list = props.branches
      const locals = list !== null && list !== undefined && Array.isArray(list.local) === true ? list.local : []
      const remotes = list !== null && list !== undefined && Array.isArray(list.remote) === true ? list.remote : []
      const search = needle.trim().toLowerCase()
      const entriesOf = (entries) => search === '' ? entries : entries.filter((entry) => String(entry.name).toLowerCase().indexOf(search) >= 0)

      const menuFor = (entry, kind) => {
        const items = [
          /* A branch checked out in another worktree keeps a working row
             (m00043): only 签出 is refused, the other verbs act on the ref. */
          entry.head === true ? null : {
            id: 'checkout', icon: 'branch', tone: 'accent', label: t('action.checkout'),
            disabled: entry.worktree !== null && entry.worktree !== undefined,
            run: () => props.onCheckout(entry, kind),
          },
          {
            id: 'newBranch', icon: 'plus', tone: 'success', label: t('action.newBranchFrom'),
            run: () => props.onNewBranch(entry, kind),
          },
          entry.head === true ? null : {
            id: 'merge', icon: 'merge', tone: 'business', label: t('action.mergeIntoCurrent'),
            run: () => props.onMerge(entry),
          },
          kind === 'remote' ? null : {
            id: 'rename', icon: 'edit', tone: 'secondary', label: t('action.rename'),
            run: () => props.onRename(entry),
          },
          kind === 'remote' ? null : {
            id: 'delete', icon: 'trash', tone: 'danger', danger: true, label: t('action.delete'),
            disabled: entry.head === true,
            run: () => props.onDelete(entry),
          },
        ]
        return items.filter((item) => item !== null)
      }

      const leaf = (entry, kind, depth) => E('button', {
        key: kind + ':' + entry.name,
        type: 'button',
        className: 'git4idea-cs-item',
        'data-current': entry.head === true ? 'true' : 'false',
        'data-menu': row !== null && row.entry === entry ? 'true' : 'false',
        style: { paddingLeft: String(6 + depth * 12) + 'px' },
        onClick: (event) => {
          event.stopPropagation()
          /* Round 2 #5: the flyout opens flush against the ROW's right edge, not
             at the pointer — a pointer anchor put it a card's width away. The
             seat is the containing block (position:fixed), so the offsets are
             measured against the seat: the workbench sets contain:layout on the
             panel body, and that would offset viewport coordinates. */
          const seatEl = event.currentTarget.closest('.git4idea-chooser-seat')
          const seat = seatEl === null ? { left: 0, top: 0, width: 0 } : seatEl.getBoundingClientRect()
          const rect = event.currentTarget.getBoundingClientRect()
          const width = 240
          const right = rect.right - seat.left + 4
          const x = seat.left + right + width > window.innerWidth - 4
            ? Math.max(4, rect.left - seat.left - width - 4)
            : right
          setRow({ entry: entry, kind: kind, x: x, y: Math.max(4, rect.top - seat.top) })
        },
      },
        E(Icon, { name: 'branch', size: 11 }),
        E('span', { className: 'git4idea-cs-item-name' }, entry.name.slice(entry.name.lastIndexOf('/') + 1)),
        entry.worktree === null || entry.worktree === undefined ? null : E('span', { className: 'git4idea-cs-item-note' }, t('composer.inWorktree')),
        E('span', { className: 'git4idea-cs-item-tail' },
          entry.ahead > 0 || entry.behind > 0
            ? E('span', { className: 'git4idea-cs-item-counts' },
              entry.ahead > 0 ? E('span', { className: 'git4idea-cs-ahead' }, E(Icon, { name: 'push', size: 10 }), String(entry.ahead)) : null,
              entry.behind > 0 ? E('span', { className: 'git4idea-cs-behind' }, E(Icon, { name: 'pull', size: 10 }), String(entry.behind)) : null)
            : null,
          E(Icon, { name: 'chevronRight', size: 10 })))

      const tree = (key, label, entries, kind) => {
        if (entries.length === 0) return null
        const root = { folders: new Map(), leaves: [] }
        for (const entry of entries) {
          const parts = String(entry.name).split('/')
          let node = root
          for (let i = 0; i < parts.length - 1; i += 1) {
            if (node.folders.has(parts[i]) !== true) node.folders.set(parts[i], { folders: new Map(), leaves: [] })
            node = node.folders.get(parts[i])
          }
          node.leaves.push(entry)
        }
        const rows = [E('div', { key: key + '-head', className: 'git4idea-cs-head' }, label)]
        const walk = (node, prefix, depth) => {
          /* Round 2 #2: directories sort A→Z in every branch menu; the
             ungrouped leaves already come after them at each level. */
          for (const name of Array.from(node.folders.keys()).sort()) {
            const child = node.folders.get(name)
            const path = prefix === '' ? name : prefix + '/' + name
            const closed = search === '' && folded[path] !== true
            rows.push(E('button', {
              key: key + ':dir:' + path,
              type: 'button',
              className: 'git4idea-cs-item git4idea-cs-folder',
              style: { paddingLeft: String(6 + depth * 12) + 'px' },
              onClick: () => setFolded((map) => Object.assign({}, map, { [path]: map[path] !== true })),
            },
              E(Icon, { name: closed === true ? 'chevronRight' : 'chevron', size: 10 }),
              E(Icon, { name: 'folder', size: 11 }),
              E('span', { className: 'git4idea-cs-item-name' }, name)))
            if (closed !== true) walk(child, path, depth + 1)
          }
          for (const entry of node.leaves) rows.push(leaf(entry, kind, depth))
        }
        walk(root, '', 0)
        return rows
      }

      const sections = [].concat(
        tree('local', t('branches.local'), entriesOf(locals), 'local') || [],
        tree('remote', t('branches.remote'), entriesOf(remotes), 'remote') || [])

      return E('div', { className: 'git4idea-branch-chooser', onMouseDown: (event) => event.stopPropagation() },
        E('div', { className: 'git4idea-cs-menu git4idea-cs-branches', 'data-cordis-panel': '' },
          E('div', { className: 'git4idea-cs-search' },
            E('input', {
              ref: inputRef, className: 'git4idea-cs-input', value: needle, spellCheck: false,
              placeholder: t('branches.filter'),
              onChange: (event) => setNeedle(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Escape') props.onClose() },
            }),
            E('button', {
              type: 'button',
              className: 'git4idea-cs-tool' + (props.fetching === true ? ' git4idea-cs-tool-busy' : ''),
              'data-tip': t('toolbar.fetch'),
              'aria-busy': props.fetching === true ? 'true' : 'false',
              onClick: () => { if (props.onFetch !== undefined && props.fetching !== true) props.onFetch() },
            }, E(Icon, { name: 'fetch', size: 13 }))),
          E('div', { className: 'git4idea-cs-actions' },
            E('button', { type: 'button', className: 'git4idea-cs-action', 'data-tip': t('changes.commit'), onClick: () => props.onCommit() },
              E(Icon, { name: 'commit', size: 12 }), E('span', null, t('changes.commit'))),
            E('button', { type: 'button', className: 'git4idea-cs-action', 'data-tip': t('toolbar.push'), onClick: () => props.onPush() },
              E(Icon, { name: 'push', size: 12 }), E('span', null, t('toolbar.push'))),
            E('button', { type: 'button', className: 'git4idea-cs-action', 'data-tip': t('toolbar.newBranch'), onClick: () => props.onNewBranchAtHead() },
              E(Icon, { name: 'plus', size: 12 }), E('span', null, t('toolbar.newBranch')))),
          E('div', { className: 'git4idea-cs-sections', onScroll: () => { if (row !== null) setRow(null) } },
            /* Round 3 #4: an empty repository must still show the CARD, with a
               centred note — the card used to collapse to a bare row. */
            sections.length === 0
              ? E('div', { className: 'git4idea-cs-empty' },
                list === null || list === undefined
                  ? t('status.busy')
                  : locals.length + remotes.length === 0 ? t('branches.empty') : t('filter.none'))
              : sections)),
        row === null ? null : E('div', {
          className: 'git4idea-cs-flyout',
          'data-cordis-panel': '',
          style: { left: String(row.x) + 'px', top: String(row.y) + 'px' },
        }, menuFor(row.entry, row.kind).map((item) => E('button', {
          key: item.id,
          type: 'button',
          className: 'git4idea-cs-sub-item',
          'data-tone': item.danger === true ? 'danger' : (item.tone === undefined ? 'secondary' : item.tone),
          'aria-disabled': item.disabled === true ? 'true' : 'false',
          onClick: () => { if (item.disabled !== true) { setRow(null); item.run() } },
        }, E('span', { className: 'git4idea-cs-sub-label' }, item.label)))))
    }

