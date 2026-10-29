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
      // A single click only SELECTS (now with Shift/Ctrl+click multi-select —
      // the modifiers are resolved one level up in BranchTree): checking a
      // branch out is a real change of working tree, and a stray click in a
      // long list must not do that (reported on v0.3.7). Since v0.19.3 a
      // double-click BROWSES that branch's commit history (checkout moved into
      // the right-click menu), right-click has the whole menu.
      return E('div', {
        className: 'git4idea-row git4idea-row-' + kind + (props.selected === true ? ' git4idea-row-selected' : ''),
        style: { paddingLeft: (BRANCH_INDENT_BASE + (props.depth === undefined ? 0 : props.depth) * BRANCH_INDENT_STEP) + 'px' },
        /* Rubber-band anchor: the marquee intersects [data-mkey] rows to
           rebuild the picked set (selKey = local:/remote:/tag: prefixed). */
        'data-mkey': props.selKey,
        'data-tip': where + ' · ' + t('branches.pickHint'),
        onClick: (event) => props.onPick(event, entry, props.selKey),
        onDoubleClick: () => { if (props.onBrowse !== undefined) props.onBrowse(entry) },
        onContextMenu: (event) => { event.preventDefault(); props.onMenu(event, entry) },
      },
        E('span', { className: 'git4idea-row-icon git4idea-tone-' + tone + (starred === true ? ' git4idea-star-filled' : '') }, E(Icon, { name: glyph, size: 12 })),
        E('span', { className: 'git4idea-row-label' }, props.label === undefined ? entry.name : props.label),
        // Inline tracking target (issue #18): the title already said "name →
        // upstream", but nobody hovers a tree to learn a binding. Local rows
        // show it as muted small text; remote rows ARE the upstream.
        kind !== 'remote' && kind !== 'tag' && entry.upstream !== null && entry.upstream !== undefined ? E('span', { className: 'git4idea-row-upstream' }, '→ ' + entry.upstream) : null,
        // A bare 'W' told nobody anything (reported right after the section counts):
        // it means this branch is checked out in ANOTHER working tree, which is why
        // git refuses to check it out here. An icon plus a spelled-out tooltip says so.
        entry.worktree === null || entry.worktree === undefined ? null : E('span', {
          className: 'git4idea-badge git4idea-badge-muted git4idea-badge-worktree',
          'data-tip': t('branches.worktree') + ': ' + entry.worktree,
        }, E(Icon, { name: 'folder', size: 10 })),
        entry.ahead > 0 ? E('span', { className: 'git4idea-badge git4idea-badge-ahead' }, '↑' + entry.ahead) : null,
        entry.behind > 0 ? E('span', { className: 'git4idea-badge git4idea-badge-behind' }, '↓' + entry.behind) : null)
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
      }, [picks])
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
            onDoubleClick: () => { if (props.onBrowse !== undefined) props.onBrowse(headEntry) },
            onContextMenu: (event) => { event.preventDefault(); onRowMenu(event, headEntry) },
          }, t('branches.head')),
          favorites.length === 0 ? null : section('favorites', t('branches.favorites'), locals.filter((entry) => favorites.indexOf(entry.name) >= 0), (entry) => entry),
          section('local', t('branches.local'), locals, (entry) => entry, true),
          section('remote', t('branches.remote'), remotes, (entry) => Object.assign({}, entry, { remote: true }), true, 'remote', remoteNameOf),
          section('tags', t('branches.tags'), tags, (entry) => Object.assign({}, entry, { tag: true }))),
        E(MarqueeBox, { box: treeMarquee.box }))
    }

