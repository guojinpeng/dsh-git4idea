    /* The hunks to draw, cut at LINEDIFF_MAX_LINES lines in total. */
    const LINEDIFF_MAX_LINES = 5000
    /* m05306: a 5000-line diff mounted every row in one commit, which froze
       the page for seconds. The body now draws LINEDIFF_CHUNK_ROWS rows and
       appends the next chunk when the reader nears the bottom. Very large
       diffs also skip the Shiki pass: the colours are not worth a second
       freeze on a WASM grammar walking 5000 lines. */
    const LINEDIFF_CHUNK_ROWS = 200
    const LINEDIFF_HIGHLIGHT_MAX = 1500
    /* The first `limit` rows of the whole file, keeping each hunk's index so
       the deferred highlight maps still line up (they are indexed by hunk). */
    function rowWindow(sections, limit) {
      const out = []
      let left = limit
      sections.forEach((section, position) => {
        if (left <= 0) return
        out.push({ position: position, header: section.header, rows: section.rows.slice(0, left) })
        left -= section.rows.length
      })
      return out
    }
    function renderedHunks(hunks) {
      let budget = LINEDIFF_MAX_LINES
      const kept = []
      for (const hunk of hunks) {
        if (budget === 0) return { hunks: kept, truncated: true }
        kept.push(hunk.lines.length <= budget ? hunk : Object.assign({}, hunk, { lines: hunk.lines.slice(0, budget) }))
        budget -= Math.min(budget, hunk.lines.length)
      }
      return { hunks: kept, truncated: hunks.some((hunk, at) => kept[at] !== hunk) }
    }

    function hunkHeader(hunk) {
      return '@@ -' + String(hunk.oldStart) + ',' + String(hunk.oldLines) + ' +' + String(hunk.newStart) + ',' + String(hunk.newLines) + ' @@'
    }

    /* Per-hunk, per-side Shiki alignment (the FileDiff rule): each side's
       lines join into ONE fragment so multi-line grammars hold, and the
       per-line spans map back by line number. */
    function hunkSideSpans(rows, side, highlighter) {
      if (highlighter === undefined) return undefined
      const source = []
      for (const row of rows) {
        const no = row[side]
        if (no === undefined) continue
        source.push({ no: no, text: row.text })
      }
      if (source.length === 0) return new Map()
      const highlighted = highlighter(source.map((line) => line.text).join('\n'))
      if (highlighted === undefined) return undefined
      const map = new Map()
      source.forEach((line, index) => { map.set(line.no, highlighted[index] || []) })
      return map
    }

    function hunkHighlights(hunk, highlighter) {
      const rows = hunkRows(hunk)
      return { old: hunkSideSpans(rows, 'old', highlighter), new: hunkSideSpans(rows, 'new', highlighter) }
    }

    /* split/wrap preferences are habits, not tab state — one settings file
       home, the same policy as the tree folds. */
    const LINEDIFF_KEY = 'dsh-git4idea.linediff.v1'
    function readLineDiffPrefs() {
      try {
        const raw = readStored(LINEDIFF_KEY)
        const parsed = raw === null ? null : JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object'
          ? { split: parsed.split === true, wrap: parsed.wrap === true }
          : { split: false, wrap: false }
      } catch (error) { void error }
      return { split: false, wrap: false }
    }
    function writeLineDiffPrefs(prefs) {
      writeStored(LINEDIFF_KEY, JSON.stringify(prefs))
    }

    /* The seed blocks the official review uses, resolved once. Every consumer
       null-checks: a host whose primitives predate an export keeps working
       through the hand-drawn fallbacks (labels instead of icons, a plain
       select instead of Menu). */
    const SeedMenu = UIPrimitives !== null && typeof UIPrimitives.Menu === 'function' ? UIPrimitives.Menu : null
    const SeedPathLabel = UIPrimitives !== null && typeof UIPrimitives.PathLabel === 'function' ? UIPrimitives.PathLabel : null
    const SeedTooltip = UIPrimitives !== null && typeof UIPrimitives.Tooltip === 'function' ? UIPrimitives.Tooltip : null
    const SeedIcons = UIPrimitives !== null ? UIPrimitives : {}

    function DiffText(props) {
      return E('span', { className: 'git4idea-lf-text', 'data-diff-code': props.spans === undefined ? undefined : '' },
        props.spans === undefined || props.spans === null || props.spans.length === 0
          ? (props.text === '' ? ' ' : props.text)
          : props.spans.map((span, at) => E('span', { key: at, style: span.style }, span.text)))
    }

    /* The unified row: old number, new number, sign, text (FileDiff's .line). */
    function UnifiedLine(props) {
      const row = props.row
      /* m05308: the colours land one task after the rows, so the first frame
         has no maps at all. Reading spans.new then closed the card with
         "Cannot read properties of undefined (reading 'new')" — the one-sided
         diff the owner could never open. Empty maps mean plain text. */
      const spans = props.spans === undefined || props.spans === null ? {} : props.spans
      return E('div', { className: 'git4idea-lf-line git4idea-lf-' + row.kind, 'data-diff-line': row.kind },
        E('span', { className: 'git4idea-lf-number' }, row.old === undefined ? '' : String(row.old)),
        E('span', { className: 'git4idea-lf-number' }, row.new === undefined ? '' : String(row.new)),
        E('span', { className: 'git4idea-lf-sign' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '\u2212' : ' '),
        /* The guards are load-bearing (FileDiff.tsx uses `highlighted?.new?.get`):
           highlightLines returns undefined for unknown or not-yet-loaded
           grammars, so the first frame (and every plain-text file) renders
           with spans === undefined until the grammar store bumps a re-render.
           Without the guard the slot entry crashes and 0.2.x unmounts the
           whole preview pane (blank "Git 预览"). */
        E(DiffText, { text: row.text, spans: row.kind === 'add'
          ? (spans.new === undefined ? undefined : spans.new.get(row.new))
          : (spans.old === undefined ? undefined : spans.old.get(row.old)) }))
    }

    /* The wrapped split row: two cells, each its own number + text. */
    function SplitLine(props) {
      const row = props.row
      /* m05306: the highlight pass lands one task after the rows, so `spans`
         is undefined on the first frame. Reading spans.old at 2627 threw
         "Cannot read properties of undefined (reading 'old')" and closed the
         card in split mode. Empty maps mean plain text, never a crash. */
      const spans = props.spans === undefined || props.spans === null ? {} : props.spans
      const kind = row.left !== undefined && row.left.kind === 'del' ? 'del' : row.right !== undefined && row.right.kind === 'add' ? 'add' : 'context'
      return E('div', { className: 'git4idea-lf-splitLine', 'data-diff-line': kind },
        E('span', { className: 'git4idea-lf-cell ' + (row.left === undefined ? 'git4idea-lf-empty' : 'git4idea-lf-' + row.left.kind) },
          E('span', { className: 'git4idea-lf-number' }, row.left === undefined ? '' : String(row.left.no)),
          E(DiffText, { text: row.left === undefined ? '' : row.left.text, spans: row.left === undefined || spans.old === undefined ? undefined : spans.old.get(row.left.no) })),
        E('span', { className: 'git4idea-lf-cell ' + (row.right === undefined ? 'git4idea-lf-empty' : 'git4idea-lf-' + row.right.kind) },
          E('span', { className: 'git4idea-lf-number' }, row.right === undefined ? '' : String(row.right.no)),
          E(DiffText, { text: row.right === undefined ? '' : row.right.text, spans: row.right === undefined || spans.new === undefined ? undefined : spans.new.get(row.right.no) })))
    }

    /* The no-wrap split: two columns that scroll together (FileDiff's
       SplitColumns). The sync mirrors the source's offset-record loop. */
    function SplitColumns(props) {
      const sections = props.sections
      const highlights = props.highlights
      const leftRef = useRef(null)
      const rightRef = useRef(null)
      const offsets = useRef({ left: { x: 0, y: 0 }, right: { x: 0, y: 0 } })
      const follow = (side) => (event) => {
        const node = event.currentTarget
        const peer = side === 'left' ? rightRef : leftRef
        const other = peer.current
        if (other !== null) {
          for (const axis of ['scrollLeft', 'scrollTop']) {
            const value = node[axis]
            const key = axis === 'scrollLeft' ? 'x' : 'y'
            if (offsets.current[side][key] === value) continue
            offsets.current[side][key] = value
            other[axis] = value
            offsets.current[side === 'left' ? 'right' : 'left'][key] = other[axis]
          }
        }
        /* m05306: scroll loading in split mode — either column grows both. */
        if (typeof props.onNeedMore === 'function' && node.scrollTop + node.clientHeight >= node.scrollHeight - LINEDIFF_CHUNK_ROWS * 2) props.onNeedMore()
      }
      return E('div', { className: 'git4idea-lf-columns' },
        ['left', 'right'].map((side) => E('div', {
          key: side,
          className: 'git4idea-lf-column',
          'data-diff-side': side,
          ref: side === 'left' ? leftRef : rightRef,
          onScroll: follow(side),
        }, rowWindow(sections, props.shown).map((section) => E('section', { key: section.position, className: 'git4idea-lf-hunk' },
          E('div', { className: 'git4idea-lf-hunkHeader', 'data-diff-hunk-header': '' }, section.header),
          section.rows.map((row, at) => {
            const cell = row[side]
            /* m05305: the colours arrive one task after the rows, so a hunk can
               still have no highlight set here. */
            const set = highlights[section.position]
            const spans = cell === undefined || set === undefined ? undefined : set[side === 'left' ? 'old' : 'new']
            return E('div', {
              key: at,
              className: 'git4idea-lf-sideLine ' + (cell === undefined ? 'git4idea-lf-empty' : 'git4idea-lf-' + cell.kind),
            },
              E('span', { className: 'git4idea-lf-number' }, cell === undefined ? '' : String(cell.no)),
              E(DiffText, { text: cell === undefined ? '' : cell.text, spans: cell === undefined || spans === undefined ? undefined : spans.get(cell.no) }))
          }))))))
    }

    /* One toolbar button in the review's tool style; Tooltip-wrapped when the
       seed provides it, a title attribute otherwise. */
    function LineDiffTool(props) {
      const inner = E('button', {
        type: 'button',
        className: 'git4idea-lf-tool',
        'aria-pressed': props.pressed,
        'aria-label': props.label,
        'data-review-tool': props.tool,
        onClick: props.onClick,
      }, props.children)
      if (SeedTooltip === null) {
        return E('span', { 'data-tip': props.label }, inner)
      }
      return E(SeedTooltip, { label: props.label, side: 'bottom', delayMs: 500 }, inner)
    }

    /* Render boundary around the preview body (issue #16): a throw inside the
       diff rows used to bubble past every plugin component into the host's
       slot boundary, which unmounts the whole tab — the user sees a silently
       blank "Git 预览" pane. With the boundary the panel keeps its chrome and
       shows one line of explanation instead. React only supports error
       boundaries as classes; this stays a module-level pure class (no hooks,
       no context) so the no-build client rules are untouched. */
    class RenderBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        try { console.error('[dsh-git4idea] preview render failed:', error) } catch (_) { /* diagnostics must never rethrow */ }
        reportClientError('preview', error)
        if (typeof this.props.onError === 'function') {
          try { this.props.onError(error) } catch (_) { /* the report must never rethrow */ }
        }
      }
      render() {
        if (this.state.failed === true) {
          /* m04914: a card that guards a whole dialog reports through a toast
             instead of drawing a bar at the top of the page. */
          if (this.props.silent === true) return null
          return E('div', { className: 'git4idea-preview-boundary' },
            E('span', { className: 'git4idea-preview-boundary-text' }, this.props.message),
            this.props.onClose === undefined ? null : E('button', {
              type: 'button', className: 'git4idea-btn', onClick: this.props.onClose,
            }, this.props.closeLabel === undefined ? '×' : this.props.closeLabel))
        }
        return this.props.children
      }
    }

    /* The external preview's diff view: the official review's header (file
       selector + counts + split/wrap/open tools) over the official row
       anatomy, fed by the plugin's own patch text instead of the host's
       workspace-changes events. */
    function LineDiff(props) {
      const t = props.t
      const files = useMemo(() => splitPatchFiles(props.patch), [props.patch])
      const [active, setActive] = useState(0)
      const [prefs, setPrefs] = useState(readLineDiffPrefs)
      useEffect(() => { writeLineDiffPrefs(prefs) }, [prefs])
      const [menuOpen, setMenuOpen] = useState(false)
      const index = active < files.length ? active : 0
      const file = files[index]
      const language = useMemo(() => (languageForPathSeed === null || file === undefined || file.path === '') ? undefined : languageForPathSeed(file.path), [file])
      const highlighter = useCodeHighlighterSeed === null ? undefined : useCodeHighlighterSeed(language)
      const cut = useMemo(() => {
        if (file === undefined) return { hunks: [], truncated: false }
        return renderedHunks(file.hunks)
      }, [file])
      const hasAdditions = file !== undefined && file.hunks.some((hunk) => hunk.lines.some((line) => line.indexOf('+') === 0))
      const hasDeletions = file !== undefined && file.hunks.some((hunk) => hunk.lines.some((line) => line.indexOf('-') === 0))
      const oneSided = hasAdditions !== hasDeletions
      const split = prefs.split === true && oneSided !== true
      const wrap = prefs.wrap === true
      /* m05306: every kept hunk's rows, built once per file/view, so the
         window draw below never rebuilds the whole diff on each scroll step. */
      const sections = useMemo(() => cut.hunks.map((hunk) => ({
        header: hunkHeader(hunk),
        rows: split === true ? splitRows(hunk) : hunkRows(hunk),
      })), [cut, split])
      const totalRows = useMemo(() => sections.reduce((sum, section) => sum + section.rows.length, 0), [sections])
      const heavy = totalRows > LINEDIFF_HIGHLIGHT_MAX
      /* m05305: Shiki tokenises the kept hunks SYNCHRONOUSLY — up to
         LINEDIFF_MAX_LINES lines through a WASM grammar. Doing that inside the
         render froze the card before its first paint. The rows now paint as
         plain text, and the colours land one task later. m05306: a huge diff
         keeps the plain text; tokenising it would freeze the page again. */
      const [highlight, setHighlight] = useState(null)
      useEffect(() => {
        if (file === undefined || heavy === true) {
          setHighlight(null)
          return undefined
        }
        let alive = true
        const timer = setTimeout(() => {
          if (alive !== true) return
          setHighlight({ cut: cut, maps: cut.hunks.map((hunk) => hunkHighlights(hunk, highlighter)) })
        }, 0)
        return () => { alive = false; clearTimeout(timer) }
      }, [cut, file, highlighter, heavy])
      const maps = highlight !== null && highlight.cut === cut ? highlight.maps : []
      /* m05306: scroll loading. The window grows chunk by chunk; a new file
         starts again from the first chunk. */
      const [shownRows, setShownRows] = useState(LINEDIFF_CHUNK_ROWS)
      useEffect(() => { setShownRows(LINEDIFF_CHUNK_ROWS) }, [file, split])
      const growRows = useCallback(() => {
        setShownRows((limit) => (limit >= totalRows ? limit : limit + LINEDIFF_CHUNK_ROWS))
      }, [totalRows])
      if (props.loading === true) return E('div', { className: 'git4idea-lf-root' }, E('p', { className: 'git4idea-lf-status', role: 'status' }, t('diff.loading')))
      if (file === undefined) return E('div', { className: 'git4idea-lf-root' }, E('p', { className: 'git4idea-lf-status' }, t('diff.empty')))
      /* header: selector + counts + tools (ReviewTab anatomy) */
      const counts = file.binary === true
        ? E('span', { className: 'git4idea-lf-label' }, t('diff.binary'))
        : E('span', { className: 'git4idea-lf-counts' },
            E('span', { className: 'git4idea-lf-added' }, fill(t('lf.added'), { count: String(file.adds) })),
            E('span', { className: 'git4idea-lf-deleted' }, fill(t('lf.deleted'), { count: String(file.dels) })))
      const selectorButton = E('button', {
        type: 'button',
        className: 'git4idea-lf-selectorButton',
        'aria-haspopup': 'menu',
        'aria-expanded': menuOpen,
        'aria-label': t('lf.selectFile'),
        'data-tip': file.path,
        'data-review-file': file.path,
        onClick: () => { setMenuOpen((value) => !value) },
      },
        SeedPathLabel === null ? file.path : E(SeedPathLabel, { path: file.path }),
        SeedIcons.IconChevronDownOutlineRegular === undefined ? '\u25be' : E(SeedIcons.IconChevronDownOutlineRegular, { size: 12 }))
      const selector = files.length > 1
        ? (SeedMenu === null
            ? E('select', {
                className: 'git4idea-lf-selectorFallback',
                value: String(index),
                'aria-label': t('lf.selectFile'),
                onChange: (event) => { setActive(Number(event.target.value)) },
              }, files.map((entry, at) => E('option', { key: at, value: String(at) }, entry.path + '  +' + String(entry.adds) + ' -' + String(entry.dels))))
            : E(SeedMenu, {
                className: 'git4idea-lf-selector',
                open: menuOpen,
                autoFocus: true,
                portal: true,
                align: 'start',
                dense: true,
                onClose: () => { setMenuOpen(false) },
                anchor: selectorButton,
                items: files.map((entry, at) => ({
                  id: String(at),
                  label: E('span', { className: 'git4idea-lf-item' },
                    E('span', { className: 'git4idea-lf-itemPath' }, entry.path),
                    E('span', { className: 'git4idea-lf-itemCounts' },
                      E('span', { className: 'git4idea-lf-added' }, fill(t('lf.added'), { count: String(entry.adds) })),
                      E('span', { className: 'git4idea-lf-deleted' }, fill(t('lf.deleted'), { count: String(entry.dels) })))),
                })),
                selectedId: String(index),
                onSelect: (id) => { setActive(Number(id)); setMenuOpen(false) },
              }))
        : E('span', { className: 'git4idea-lf-selectorStatic', 'data-tip': file.path },
            SeedPathLabel === null ? file.path : E(SeedPathLabel, { path: file.path }))
      /* v0.3.1: the change kind rides the header as a tag in front of the file
         name; the old full-width note line ("新建的文件") pushed the first hunk
         down for no information the tag does not carry. */
      const fileTag = file.created === true
        ? E('span', { className: 'git4idea-lf-tag is-created' }, t('lf.tagCreated'))
        : (file.removed === true
          ? E('span', { className: 'git4idea-lf-tag is-deleted' }, t('lf.tagDeleted'))
          : E('span', { className: 'git4idea-lf-tag' }, t('lf.tagModified')))
      return E('div', { className: 'git4idea-lf-root' },
        E('div', { className: 'git4idea-lf-header' },
          fileTag,
          selector,
          counts,
          E('span', { className: 'git4idea-lf-tools' },
            E(LineDiffTool, {
              tool: 'split', pressed: split, label: t(split === true ? 'lf.unified' : 'lf.split'),
              onClick: () => { setPrefs((now) => Object.assign({}, now, { split: now.split !== true })) },
            }, SeedIcons.IconCompareSplitOutlineRegular === undefined ? E(Icon, { name: 'split', size: 13 }) : E(SeedIcons.IconCompareSplitOutlineRegular, { className: 'git4idea-lf-compareIcon' })),
            E(LineDiffTool, {
              tool: 'wrap', pressed: wrap, label: t(wrap === true ? 'lf.nowrap' : 'lf.wrap'),
              onClick: () => { setPrefs((now) => Object.assign({}, now, { wrap: now.wrap !== true })) },
            }, SeedIcons.IconWrapFillRegular === undefined || SeedIcons.IconNowrapFillRegular === undefined
              ? E(Icon, { name: 'wrap', size: 13 })
              : (wrap === true ? E(SeedIcons.IconNowrapFillRegular) : E(SeedIcons.IconWrapFillRegular))),
            props.onOpenFile === undefined ? null : E(LineDiffTool, {
              tool: 'open-file', label: t('preview.openFile'),
              onClick: props.onOpenFile,
            }, SeedIcons.IconInspectOutlineRegular === undefined ? E(Icon, { name: 'file', size: 13 }) : E(SeedIcons.IconInspectOutlineRegular)),
            /* Extra head actions merged into the SAME row (v0.3.1): the commit
               layer's copy/refresh used to sit on a strip of their own above
               this header, which read as a second, duplicated title row. */
            Array.isArray(props.extraTools) ? props.extraTools.map((node, index) => E('span', { key: 'extra-' + index, className: 'git4idea-lf-extra' }, node)) : null,
          )),
        file.binary === true
          ? E('p', { className: 'git4idea-lf-status' }, t('diff.binary'))
          : E('div', {
              className: 'git4idea-lf-body',
              'data-review-view': split === true ? 'split' : 'unified',
              'data-review-wrap': wrap === true ? '' : undefined,
              /* m05306: the split columns own their scrollers and grow
                 themselves; every other mode scrolls here. */
              onScroll: split === true && wrap !== true ? undefined : (event) => {
                const node = event.currentTarget
                if (node.scrollTop + node.clientHeight >= node.scrollHeight - LINEDIFF_CHUNK_ROWS * 2) growRows()
              },
            },
              cut.truncated === true ? E('p', { className: 'git4idea-lf-note' }, fill(t('lf.truncated'), { count: String(LINEDIFF_MAX_LINES) })) : null,
              split === true && wrap !== true
                ? E(SplitColumns, { sections: sections, highlights: maps, shown: shownRows, onNeedMore: growRows })
                : rowWindow(sections, shownRows).map((section) => E('section', { key: section.position, className: 'git4idea-lf-hunk' },
                    E('div', { className: 'git4idea-lf-hunkHeader', 'data-diff-hunk-header': '' }, section.header),
                    /* The wrapped branch iterates the SAME row list it indexes
                       (issue #16); SplitLine still receives the hunk's maps so
                       the deferred colours line up. */
                    section.rows.map((row, at) => split === true
                      ? E(SplitLine, { key: at, row: row, spans: maps[section.position] })
                      : E(UnifiedLine, { key: at, row: row, spans: maps[section.position] }))))))
    }

    /* The leading glyph of a change row (v0.14): the host's FileTypeIcon —
       classifyFileType runs inside when given a path. Directories (the
       trailing slash an `ls-files --directory` row carries) ask for the
       folder kind explicitly, since their basename is empty. A host without
       the seed module returns null and the row keeps its status letter as the
       only leading mark. Sizing follows the status letter's box (14px, the
       .git4idea-row line height). */
    function FileTypeGlyph(props) {
      if (UIPrimitives === null || typeof UIPrimitives.FileTypeIcon !== 'function') return null
      const path = typeof props.path === 'string' ? props.path : ''
      if (path === '') return null
      return E(UIPrimitives.FileTypeIcon, path.slice(-1) === '/'
        ? { kind: 'folder', size: 14, className: 'git4idea-file-icon' }
        : { path: path, size: 14, className: 'git4idea-file-icon' })
    }

    /* One hover label for the whole plugin (m04504). The browser's title
       bubble only appears while the pointer rests, so it misses re-rendered
       rows, and the rail clips it with overflow: hidden. Hints are now
       data-tip attributes and this layer draws them. The node lives on
       document.body: the anchors sit in the panel and in frame overlays
       alike, and body coordinates are the only ones both of them share. */
    const TIP_DELAY_MS = 350
    let tipNode = null
    function showTip(target) {
      const text = target.getAttribute('data-tip')
      if (text === null || text === '') return
      if (tipNode === null) {
        tipNode = document.createElement('div')
        tipNode.className = 'git4idea-tip'
        tipNode.setAttribute('role', 'tooltip')
      }
      tipNode.textContent = text
      tipNode.style.visibility = 'hidden'
      document.body.appendChild(tipNode)
      const rect = target.getBoundingClientRect()
      const box = tipNode.getBoundingClientRect()
      let left = rect.left + rect.width / 2 - box.width / 2
      let top = rect.bottom + 6
      if (top + box.height > window.innerHeight - 4) top = rect.top - box.height - 6
      if (top < 4) top = rect.bottom + 6
      left = Math.max(4, Math.min(left, window.innerWidth - box.width - 4))
      tipNode.style.left = Math.round(left) + 'px'
      tipNode.style.top = Math.round(top) + 'px'
      tipNode.style.visibility = 'visible'
    }
    let tipInstalled = false
    function installTipLayer() {
      if (tipInstalled === true) return
      tipInstalled = true
      let timer = 0
      let anchor = null
      const hide = () => {
        window.clearTimeout(timer)
        timer = 0
        anchor = null
        if (tipNode !== null) tipNode.style.visibility = 'hidden'
      }
      const over = (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null
        if (target === anchor) return
        hide()
        if (target === null) return
        anchor = target
        timer = window.setTimeout(() => { showTip(target) }, TIP_DELAY_MS)
      }
      const out = (event) => {
        if (anchor !== null && event.relatedTarget instanceof Element && anchor.contains(event.relatedTarget) === true) return
        hide()
      }
      document.addEventListener('pointerover', over, true)
      document.addEventListener('pointerout', out, true)
      document.addEventListener('focusin', over, true)
      document.addEventListener('focusout', out, true)
      document.addEventListener('pointerdown', hide, true)
      window.addEventListener('scroll', hide, true)
    }

    /* ============================== ui kit ============================== */

    /* Icon set (v3): the path data is copied verbatim from the IntelliJ
       Platform icons that Rebased ships (platform/icons/src/expui/**, plus
       vcs/branch.svg), so the rail and the tree read like the IDE instead of
       like a lookalike. Those files are Apache 2.0 — see
       THIRD_PARTY_NOTICES.md for the source list and the licence text.
       Fields: d (path), rect [w,h] with x/y/rx, circle [cx,cy,r], f = filled,
       sw = stroke width, eo = even-odd fill rule. */
    const ICONS = {
      branch: [
        {"d":"M12.1232 2.67714C11.7828 2.33692 11.3696 2.16676 10.8834 2.16676C10.3975 2.16676 9.98427 2.33682 9.64395 2.67714C9.30375 3.01737 9.13366 3.43051 9.13366 3.91672C9.13366 4.23268 9.21242 4.52588 9.37041 4.79626C9.52838 5.06666 9.74087 5.27787 10.0084 5.42971C10.0084 5.74567 9.98273 6.02377 9.93118 6.26375C9.87939 6.50373 9.79441 6.71478 9.67597 6.8972C9.55721 7.07953 9.43442 7.23436 9.30672 7.36203C9.17899 7.4897 8.99973 7.60961 8.76885 7.72208C8.538 7.83449 8.32366 7.92857 8.12624 8.00464C7.92881 8.08047 7.66288 8.17008 7.32869 8.27342C6.72097 8.46187 6.25317 8.63491 5.92501 8.793V4.26292C6.19238 4.11111 6.40507 3.89993 6.56303 3.62953C6.72097 3.35912 6.79995 3.06589 6.79995 2.74993C6.79995 2.26388 6.62988 1.85064 6.28956 1.51042C5.94937 1.17022 5.53623 1 5.05005 1C4.56383 1 4.15069 1.1701 3.81037 1.51042C3.47018 1.85064 3.29999 2.26388 3.29999 2.74993C3.29999 3.06589 3.37897 3.35912 3.5369 3.62953C3.69487 3.89993 3.90752 4.11111 4.17492 4.26292V11.7371C3.90752 11.8888 3.69487 12.1002 3.5369 12.3705C3.37897 12.641 3.29999 12.9343 3.29999 13.2501C3.29999 13.7362 3.47005 14.1494 3.81037 14.4896C4.15069 14.8298 4.56393 15 5.05005 15C5.53614 15 5.94937 14.8298 6.28956 14.4896C6.62979 14.1494 6.79995 13.7362 6.79995 13.2501C6.79995 12.9343 6.72097 12.641 6.56303 12.3705C6.40504 12.1002 6.19238 11.8888 5.92501 11.7371V11.5001C5.92501 11.0809 6.05109 10.7772 6.30323 10.5888C6.55537 10.4003 7.07035 10.1846 7.84823 9.94163C8.66867 9.68029 9.28553 9.43405 9.6987 9.20307C11.0598 8.43155 11.7464 7.17367 11.7585 5.42968C12.0261 5.27787 12.2386 5.06663 12.3965 4.79622C12.5544 4.52582 12.6335 4.23265 12.6335 3.91669C12.6336 3.4306 12.4634 3.01746 12.1232 2.67714Z","f":1},
      ],
      commit: [
        {"d":"M8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10ZM10.9585 7.5C10.7205 6.08114 9.4865 5 8 5C6.5135 5 5.27952 6.08114 5.04148 7.5H0.5C0.223858 7.5 0 7.72386 0 8C0 8.27614 0.223858 8.5 0.5 8.5H5.04148C5.27952 9.91886 6.5135 11 8 11C9.4865 11 10.7205 9.91886 10.9585 8.5H15.5C15.7761 8.5 16 8.27614 16 8C16 7.72386 15.7761 7.5 15.5 7.5H10.9585Z","f":1,"eo":1},
      ],
      refresh: [
        {"d":"M2.5 9V8C2.5 4.96243 4.96243 2.5 8 2.5C9.10679 2.5 10.1372 2.82692 11 3.38947","sw":1},
        {"d":"M5 12.6105C5.86278 13.1731 6.89321 13.5 8 13.5C11.0376 13.5 13.5 11.0376 13.5 8V7","sw":1},
        {"d":"M0.49997 7.50027L2.5 9.5L4.49998 7.50023","sw":1},
        {"d":"M11.5 8.49982L13.5 6.5L15.5 8.49982","sw":1},
      ],
      fetch: [
        {"d":"M12.8536 3.14645C13.0488 3.34171 13.0488 3.65829 12.8536 3.85355L11.4393 5.26777C11.2441 5.46303 10.9275 5.46303 10.7322 5.26777C10.537 5.0725 10.537 4.75592 10.7322 4.56066L12.1464 3.14645C12.3417 2.95118 12.6583 2.95118 12.8536 3.14645Z","f":1},
        {"d":"M10.0251 5.97487C10.2204 6.17014 10.2204 6.48672 10.0251 6.68198L8.61091 8.09619C8.41565 8.29146 8.09907 8.29146 7.90381 8.09619C7.70854 7.90093 7.70854 7.58435 7.90381 7.38909L9.31802 5.97487C9.51328 5.77961 9.82986 5.77961 10.0251 5.97487Z","f":1},
        {"d":"M7.1967 8.8033C7.39196 8.99856 7.39196 9.31515 7.1967 9.51041L5.78249 10.9246C5.58722 11.1199 5.27064 11.1199 5.07538 10.9246C4.88012 10.7294 4.88012 10.4128 5.07538 10.2175L6.48959 8.8033C6.68485 8.60804 7.00144 8.60804 7.1967 8.8033Z","f":1},
        {"d":"M3.5 5C3.77614 5 4 5.22386 4 5.5V7.5C4 7.77614 3.77614 8 3.5 8C3.22386 8 3 7.77614 3 7.5V5.5C3 5.22386 3.22386 5 3.5 5Z","f":1},
        {"d":"M3.5 9C3.77614 9 4 9.22386 4 9.5V12H6.5C6.77614 12 7 12.2239 7 12.5C7 12.7761 6.77614 13 6.5 13H3.5C3.22386 13 3 12.7761 3 12.5V9.5C3 9.22386 3.22386 9 3.5 9Z","f":1},
        {"d":"M8 12.5C8 12.2239 8.22386 12 8.5 12H10.5C10.7761 12 11 12.2239 11 12.5C11 12.7761 10.7761 13 10.5 13H8.5C8.22386 13 8 12.7761 8 12.5Z","f":1},
      ],
      pull: [
        {"d":"M12.8536 3.85355C13.0488 3.65829 13.0488 3.34171 12.8536 3.14645C12.6583 2.95118 12.3417 2.95118 12.1464 3.14645L4 11.2929V5.5C4 5.22386 3.77614 5 3.5 5C3.22386 5 3 5.22386 3 5.5V12.5C3 12.5683 3.01368 12.6333 3.03844 12.6926C3.06171 12.7484 3.09556 12.8009 3.13998 12.847C3.14425 12.8514 3.1486 12.8557 3.15303 12.86C3.24295 12.9467 3.36525 13 3.5 13H10.5C10.7761 13 11 12.7761 11 12.5C11 12.2239 10.7761 12 10.5 12H4.70711L12.8536 3.85355Z","f":1,"eo":1},
      ],
      push: [
        {"d":"M3.14646 12.1464C2.9512 12.3417 2.9512 12.6583 3.14646 12.8536C3.34172 13.0488 3.6583 13.0488 3.85357 12.8536L12 4.70715V10.5C12 10.7761 12.2238 11 12.5 11C12.7761 11 13 10.7761 13 10.5V3.5C13 3.22386 12.7761 3 12.5 3H5.49997C5.22383 3 4.99997 3.22386 4.99997 3.5C4.99997 3.77614 5.22383 4 5.49997 4H11.2929L3.14646 12.1464Z","f":1,"eo":1},
      ],
      plus: [
        {"d":"M7.5 1C7.77614 1 8 1.22386 8 1.5V7H13.5C13.7761 7 14 7.22386 14 7.5C14 7.77614 13.7761 8 13.5 8H8V13.5C8 13.7761 7.77614 14 7.5 14C7.22386 14 7 13.7761 7 13.5V8H1.5C1.22386 8 1 7.77614 1 7.5C1 7.22386 1.22386 7 1.5 7H7V1.5C7 1.22386 7.22386 1 7.5 1Z","f":1,"eo":1},
      ],
      minus: [
        {"d":"M1 7.5C1 7.77614 1.22386 8 1.5 8L13.5 8C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7L1.5 7C1.22386 7 1 7.22386 1 7.5Z","f":1,"eo":1},
      ],
      undo: [
        {"d":"M1.62632 9.66782C1.44286 9.87421 1.46145 10.1902 1.66785 10.3737C1.87424 10.5572 2.19027 10.5386 2.37373 10.3322L1.62632 9.66782ZM14 10.5C14 10.7761 14.2239 11 14.5 11C14.7761 11 15 10.7761 15 10.5H14ZM2 7.5C2 7.22386 1.77614 7 1.5 7C1.22386 7 1 7.22386 1 7.5H2ZM1.5 10.5H1V11H1.5V10.5ZM4.5 11C4.77614 11 5 10.7761 5 10.5C5 10.2239 4.77614 10 4.5 10V11ZM2.00003 10C2.37373 10.3322 2.37368 10.3322 2.37364 10.3323C2.37364 10.3323 2.37362 10.3323 2.37363 10.3323C2.37366 10.3323 2.37375 10.3322 2.37389 10.332C2.37419 10.3317 2.37473 10.3311 2.3755 10.3302C2.37705 10.3285 2.37955 10.3257 2.38299 10.3219C2.38987 10.3142 2.40049 10.3025 2.41472 10.287C2.44318 10.2558 2.48606 10.2094 2.54224 10.15C2.65466 10.0309 2.82016 9.85969 3.03001 9.65366C3.45029 9.24102 4.04545 8.69176 4.74568 8.14375C6.17384 7.02606 7.93178 6 9.50003 6V5C7.56827 5 5.57621 6.22394 4.12937 7.35625C3.39211 7.93324 2.76851 8.50898 2.32942 8.94009C2.10958 9.15594 1.93524 9.33626 1.81523 9.46333C1.75521 9.52688 1.70873 9.57717 1.67689 9.61197C1.66096 9.62938 1.6487 9.64292 1.64023 9.65231C1.63599 9.65701 1.6327 9.66068 1.63038 9.66327C1.62922 9.66457 1.6283 9.6656 1.62762 9.66636C1.62728 9.66674 1.627 9.66705 1.62679 9.66729C1.62668 9.66742 1.62656 9.66755 1.62651 9.66761C1.62641 9.66772 1.62632 9.66782 2.00003 10ZM9.50003 6C10.6625 6 11.5012 6.28919 12.1133 6.69727C12.7285 7.10745 13.1449 7.65792 13.4278 8.22361C13.7116 8.79125 13.856 9.36494 13.9287 9.80095C13.9648 10.0178 13.9827 10.1974 13.9915 10.3208C13.9959 10.3824 13.998 10.4298 13.9991 10.4605C13.9996 10.4759 13.9998 10.487 13.9999 10.4937C14 10.4971 14 10.4993 14 10.5003C14 10.5009 14 10.5011 14 10.5011C14 10.501 14 10.5009 14 10.5008C14 10.5007 14 10.5005 14 10.5004C14 10.5002 14 10.5 14.5 10.5C15 10.5 15 10.4997 15 10.4995C15 10.4993 15 10.499 15 10.4988C15 10.4983 15 10.4978 15 10.4971C15 10.4959 15 10.4943 15 10.4924C14.9999 10.4887 14.9999 10.4837 14.9998 10.4776C14.9996 10.4654 14.9992 10.4485 14.9985 10.4272C14.9971 10.3847 14.9943 10.3246 14.989 10.2495C14.9782 10.0995 14.9571 9.88848 14.9151 9.63655C14.8315 9.13506 14.6634 8.45875 14.3222 7.77639C13.9801 7.09208 13.459 6.39255 12.668 5.86523C11.8739 5.33581 10.8375 5 9.50003 5V6ZM1 7.5V10.5H2V7.5H1ZM1.5 11H4.5V10H1.5V11Z","f":1},
      ],
      chevron: [
        {"d":"M11.5 6.25L8 9.75L4.5 6.25","sw":1},
      ],
      close: [
        {"d":"M11.4939 4.48784C11.3002 4.28007 10.9724 4.27548 10.7729 4.47775L8.00074 7.28849L5.22871 4.47788C5.02922 4.27561 4.70143 4.2802 4.50768 4.48797C4.32506 4.68382 4.32933 4.98882 4.51736 5.17947L7.29908 7.99991L4.51756 10.8201C4.32953 11.0108 4.32526 11.3158 4.50788 11.5116C4.70163 11.7194 5.02942 11.724 5.22892 11.5217L8.00074 8.71133L10.7727 11.5219C10.9722 11.7241 11.3 11.7196 11.4937 11.5118C11.6764 11.3159 11.6721 11.0109 11.484 10.8203L8.7024 7.99991L11.4843 5.17934C11.6723 4.98869 11.6766 4.68368 11.4939 4.48784Z","f":1,"eo":1},
      ],
      star: [
        {"d":"M8.46197 2.38123C8.38441 2.19475 8.20227 2.07324 8.00031 2.07324C7.79834 2.07324 7.61621 2.19475 7.53865 2.38123L6.06891 5.9149L2.25401 6.22074C2.05269 6.23688 1.88085 6.37255 1.81844 6.56463C1.75603 6.75671 1.8153 6.96748 1.96869 7.09887L4.87524 9.58864L3.98724 13.3113C3.94038 13.5078 4.01631 13.7131 4.1797 13.8319C4.3431 13.9506 4.56186 13.9593 4.73422 13.854L8.00031 11.8591L11.2664 13.854C11.4387 13.9593 11.6575 13.9506 11.8209 13.8319C11.9843 13.7131 12.0602 13.5078 12.0134 13.3113L11.1254 9.58864L14.0319 7.09887C14.1853 6.96748 14.2446 6.75671 14.1822 6.56463C14.1198 6.37255 13.9479 6.23688 13.7466 6.22074L9.9317 5.9149L8.46197 2.38123Z","f":1,"eo":1},
      ],
      folder: [
        {"d":"M8.10584 4.34613L8.25344 4.5H8.46667H13C13.8284 4.5 14.5 5.17157 14.5 6V12.1333C14.5 12.9529 13.932 13.5 13.3667 13.5H2.63333C2.06804 13.5 1.5 12.9529 1.5 12.1333V3.86667C1.5 3.04707 2.06804 2.5 2.63333 2.5H6.1217C6.25792 2.5 6.38824 2.55557 6.48253 2.65387L8.10584 4.34613Z","sw":1},
      ],
      file: [
        {"x":2,"y":12,"rect":[8,1],"rx":0.5,"f":1},
        {"x":2,"y":6,"rect":[8,1],"rx":0.5,"f":1},
        {"x":2,"y":9,"rect":[12,1],"rx":0.5,"f":1},
        {"x":2,"y":3,"rect":[12,1],"rx":0.5,"f":1},
      ],
      diff: [
        {"d":"M5.85355 8.14645C5.65829 7.95118 5.34171 7.95118 5.14645 8.14645C4.95118 8.34171 4.95118 8.65829 5.14645 8.85355L7.29289 11H0.5C0.223858 11 0 11.2239 0 11.5C0 11.7761 0.223858 12 0.5 12H7.29289L5.14645 14.1464C4.95118 14.3417 4.95118 14.6583 5.14645 14.8536C5.34171 15.0488 5.65829 15.0488 5.85355 14.8536L8.85355 11.8536L9.20711 11.5L8.85355 11.1464L5.85355 8.14645Z","f":1,"eo":1},
        {"d":"M10.1464 1.14645C10.3417 0.951185 10.6583 0.951185 10.8536 1.14645C11.0488 1.34171 11.0488 1.65829 10.8536 1.85355L8.70711 4H15.5C15.7761 4 16 4.22386 16 4.5C16 4.77614 15.7761 5 15.5 5H8.70711L10.8536 7.14645C11.0488 7.34171 11.0488 7.65829 10.8536 7.85355C10.6583 8.04882 10.3417 8.04882 10.1464 7.85355L7.14645 4.85355L6.79289 4.5L7.14645 4.14645L10.1464 1.14645Z","f":1,"eo":1},
      ],
      trash: [
        {"d":"M7 2H9C9.55228 2 10 2.44772 10 3H6C6 2.44772 6.44772 2 7 2ZM5 3C5 1.89543 5.89543 1 7 1H9C10.1046 1 11 1.89543 11 3H13C13.5523 3 14 3.44772 14 4V5V6H13V13C13 14.1046 12.1046 15 11 15H5C3.89543 15 3 14.1046 3 13V6H2V5V4C2 3.44772 2.44772 3 3 3H5ZM11 4H10H6H5H3V5H4H12H13V4H11ZM4 6H12V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V6ZM6.5 7C6.22386 7 6 7.22386 6 7.5V11.5C6 11.7761 6.22386 12 6.5 12C6.77614 12 7 11.7761 7 11.5V7.5C7 7.22386 6.77614 7 6.5 7ZM9 7.5C9 7.22386 9.22386 7 9.5 7C9.77614 7 10 7.22386 10 7.5V11.5C10 11.7761 9.77614 12 9.5 12C9.22386 12 9 11.7761 9 11.5V7.5Z","f":1,"eo":1},
      ],
      tag: [
        {"d":"M6.36812 4.9736C6.62969 4.77016 6.67681 4.39319 6.47337 4.13163C6.26992 3.87006 5.89296 3.82294 5.63139 4.02638L0.522461 7.99999L5.63139 11.9736C5.89296 12.177 6.26992 12.1299 6.47337 11.8684C6.67681 11.6068 6.62969 11.2298 6.36812 11.0264L2.47705 7.99999L6.36812 4.9736Z","f":1},
        {"d":"M9.63139 4.9736C9.36983 4.77016 9.3227 4.39319 9.52615 4.13163C9.72959 3.87006 10.1066 3.82294 10.3681 4.02638L15.4771 7.99999L10.3681 11.9736C10.1066 12.177 9.72959 12.1299 9.52615 11.8684C9.3227 11.6068 9.36983 11.2298 9.63139 11.0264L13.5225 7.99999L9.63139 4.9736Z","f":1},
      ],
      /* The IDEA label glyph (TagPainter.kt): a 16-unit tag outline, used for
         ref badges in the log row and the commit detail. */
      tagOutline: [
        {"d":"M13.4495 7.5001L7.01028 13.9394C6.81502 14.1347 6.49843 14.1347 6.30317 13.9394L2.06053 9.69679C1.86527 9.50152 1.86527 9.18494 2.06053 8.98968L8.49978 2.55035C8.61106 2.43907 8.76824 2.38667 8.92404 2.40893L12.6363 2.93926C12.8563 2.97069 13.0292 3.14354 13.0606 3.36352L13.5909 7.07584C13.6132 7.23163 13.5608 7.38882 13.4495 7.5001Z","sw":1},
        {"circle":[10.5,5.5,1],"f":1},
      ],
      settings: [
        {"d":"M3.22655 4.36961C2.92233 4.76924 2.66735 5.20781 2.47037 5.67626L3.30992 7.0943C3.6406 7.65283 3.6406 8.34718 3.30992 8.9057L2.47037 10.3237C2.66736 10.7922 2.92233 11.2308 3.22656 11.6304L4.87261 11.6124C5.52165 11.6053 6.12297 11.9524 6.44133 12.5181L7.24899 13.953C7.49593 13.984 7.74792 14 8.00408 14C8.2602 14 8.51214 13.984 8.75904 13.9531L9.56671 12.5181C9.88507 11.9524 10.4864 11.6053 11.1354 11.6124L12.7816 11.6304C13.0858 11.2308 13.3408 10.7923 13.5377 10.3239L12.6981 8.9057C12.3674 8.34718 12.3674 7.65283 12.6981 7.0943L13.5377 5.67613C13.3408 5.20773 13.0858 4.76921 12.7816 4.36961L11.1354 4.38764C10.4864 4.39475 9.88507 4.04758 9.56671 3.48194L8.75904 2.04693C8.51214 2.01599 8.2602 2 8.00408 2C7.74792 2 7.49594 2.016 7.24899 2.04695L6.44133 3.48194C6.12297 4.04758 5.52165 4.39475 4.87261 4.38764L3.22655 4.36961ZM10.655 8.00001C10.655 9.46412 9.46811 10.651 8.004 10.651C6.5399 10.651 5.353 9.46412 5.353 8.00001C5.353 6.53591 6.5399 5.34902 8.004 5.34902C9.46811 5.34902 10.655 6.53591 10.655 8.00001ZM4.88356 3.3877C5.16752 3.39081 5.4306 3.23892 5.56988 2.99146L6.43817 1.44875C6.54914 1.25159 6.7401 1.1101 6.96387 1.07676C7.30327 1.0262 7.65062 1 8.00408 1C8.3575 1 8.7048 1.02619 9.04414 1.07674C9.26792 1.11007 9.45889 1.25157 9.56986 1.44873L10.4382 2.99146C10.5774 3.23892 10.8405 3.39081 11.1245 3.3877L12.8938 3.36832C13.1196 3.36585 13.3372 3.46012 13.4781 3.63661C13.9099 4.17766 14.2632 4.78416 14.5207 5.43884C14.6034 5.6491 14.5763 5.88489 14.4612 6.07931L13.5586 7.60376C13.4139 7.84811 13.4139 8.15189 13.5586 8.39625L14.4612 9.92069C14.5763 10.1151 14.6034 10.3509 14.5207 10.5612C14.2632 11.2158 13.9099 11.8223 13.4781 12.3634C13.3372 12.5399 13.1196 12.6342 12.8938 12.6317L11.1245 12.6123C10.8405 12.6092 10.5774 12.7611 10.4382 13.0085L9.56986 14.5513C9.45889 14.7484 9.26792 14.8899 9.04414 14.9233C8.7048 14.9738 8.3575 15 8.00408 15C7.65062 15 7.30327 14.9738 6.96387 14.9232C6.7401 14.8899 6.54914 14.7484 6.43817 14.5512L5.56988 13.0085C5.4306 12.7611 5.16752 12.6092 4.88356 12.6123L3.1144 12.6317C2.8886 12.6342 2.67096 12.5399 2.5301 12.3634C2.09822 11.8223 1.74489 11.2158 1.48738 10.561C1.40469 10.3508 1.43184 10.115 1.54695 9.92057L2.44942 8.39625C2.5941 8.15189 2.5941 7.84811 2.44942 7.60376L1.54695 6.07944C1.43184 5.88502 1.40469 5.64924 1.48738 5.43898C1.74489 4.78425 2.09822 4.1777 2.53009 3.63661C2.67096 3.46012 2.8886 3.36585 3.1144 3.36832L4.88356 3.3877ZM9.655 8.00001C9.655 8.91183 8.91582 9.65101 8.004 9.65101C7.09218 9.65101 6.353 8.91183 6.353 8.00001C6.353 7.08819 7.09218 6.34902 8.004 6.34902C8.91582 6.34902 9.655 7.08819 9.655 8.00001Z","f":1,"eo":1},
      ],
      more: [
        {"circle":[8,3,1],"f":1},
        {"circle":[8,8,1],"f":1},
        {"circle":[8,13,1],"f":1},
      ],
      eye: [
        {"circle":[8,8,2.5],"sw":1},
        {"d":"M3.34803 11.4645C2.03281 10.5496 1.01443 9.31863 0.529751 8C1.01443 6.68137 2.03281 5.45039 3.34803 4.53545C4.71396 3.58524 6.36604 3 8 3C9.63396 3 11.286 3.58524 12.652 4.53545C13.9672 5.45039 14.9856 6.68137 15.4702 8C14.9856 9.31863 13.9672 10.5496 12.652 11.4645C11.286 12.4148 9.63396 13 8 13C6.36604 13 4.71396 12.4148 3.34803 11.4645Z","sw":1},
      ],
      eyeOff: [
        {"d":"M2 8.5C1.72386 8.5 1.5 8.27614 1.5 8C1.5 7.72386 1.72386 7.5 2 7.5L2 8.5ZM14 7.5C14.2761 7.5 14.5 7.72386 14.5 8C14.5 8.27614 14.2761 8.5 14 8.5L14 7.5ZM2 7.5L14 7.5L14 8.5L2 8.5L2 7.5Z","f":1},
      ],
      up: [
        {"d":"M11.8536 5.85354C12.0488 6.0488 12.0488 6.36538 11.8536 6.56064C11.6583 6.75591 11.3417 6.75591 11.1464 6.56064L8.5 3.9142L8.5 11.5071C8.5 11.7832 8.27615 12.0071 8 12.0071C7.72386 12.0071 7.5 11.7832 7.5 11.5071L7.5 3.91419L4.85355 6.56064C4.65829 6.7559 4.34171 6.7559 4.14645 6.56064C3.95118 6.36538 3.95118 6.0488 4.14645 5.85353L7.64645 2.35354L8 1.99998L8.35355 2.35354L11.8536 5.85354Z","f":1,"eo":1},
        {"x":2,"y":13.0071,"rect":[12,1],"rx":0.5,"f":1},
      ],
      down: [
        {"x":2,"y":2,"rect":[12,1],"rx":0.5,"f":1},
        {"d":"M11.8536 10.1535C12.0488 9.95828 12.0488 9.6417 11.8536 9.44644C11.6583 9.25117 11.3417 9.25117 11.1464 9.44644L8.5 12.0929L8.5 4.5C8.5 4.22386 8.27615 4 8 4C7.72386 4 7.5 4.22386 7.5 4.5L7.5 12.0929L4.85355 9.44644C4.65829 9.25118 4.34171 9.25118 4.14645 9.44644C3.95118 9.6417 3.95118 9.95828 4.14645 10.1535L7.64645 13.6535L8 14.0071L8.35355 13.6535L11.8536 10.1535Z","f":1,"eo":1},
      ],
      grip: [
        {"circle":[5.5,2.5,1.5],"f":1},
        {"circle":[11.5,2.5,1.5],"f":1},
        {"circle":[5.5,7.5,1.5],"f":1},
        {"circle":[11.5,7.5,1.5],"f":1},
        {"circle":[5.5,12.5,1.5],"f":1},
        {"circle":[11.5,12.5,1.5],"f":1},
      ],
      filter: [
        {"d":"M13.5 2.5H2.5L6.5 7.5V14L9.5 12V7.5L13.5 2.5Z","sw":1},
      ],
      check: [
        {"d":"M2.5 8.25L6 11.75L13.5 4.25","sw":1.5},
      ],
      copy: [
        {"x":2.5,"y":3.5,"rect":[9,10],"rx":1.5,"sw":1},
        {"x":5,"y":6,"rect":[4,1],"rx":0.5,"f":1},
        {"x":5,"y":8,"rect":[4,1],"rx":0.5,"f":1},
        {"x":5,"y":10,"rect":[4,1],"rx":0.5,"f":1},
        {"d":"M11.0017 2H11.5998C12.373 2 12.9998 2.6268 12.9998 3.4V3.91081C13.0011 3.94038 13.0017 3.97011 13.0017 4V11.5482C13.6063 11.1124 13.9998 10.4021 13.9998 9.6V3.4C13.9998 2.07452 12.9253 1 11.5998 1H6.39978C5.59677 1 4.88587 1.39437 4.4502 2H6.39978H11.0017Z","f":1,"eo":1},
      ],
      float: [
        {"d":"M4 14C2.89543 14 2 13.1046 2 12L2 4C2 2.89543 2.89543 2 4 2L6.5 2C6.77614 2 7 2.22386 7 2.5C7 2.77614 6.77614 3 6.5 3L4 3C3.44772 3 3 3.44772 3 4L3 12C3 12.5523 3.44772 13 4 13H12C12.5523 13 13 12.5523 13 12V9.5C13 9.22386 13.2239 9 13.5 9C13.7761 9 14 9.22386 14 9.5V12C14 13.1046 13.1046 14 12 14H4Z","f":1,"eo":1},
        {"d":"M14 2V6.5C14 6.77614 13.7761 7 13.5 7C13.2239 7 13 6.77614 13 6.5V3.70711L8.85355 7.85355C8.65829 8.04882 8.34171 8.04882 8.14645 7.85355C7.95118 7.65829 7.95118 7.34171 8.14645 7.14645L12.2929 3L9.5 3C9.22386 3 9 2.77614 9 2.5C9 2.22386 9.22386 2 9.5 2L14 2Z","f":1,"eo":1},
      ],
      dock: [
        {"d":"M9 7L5.5 10.5","sw":1},
        {"d":"M8.5 10.5L5.5 10.5L5.5 7.5","sw":1},
        {"x":2.5,"y":2.5,"rect":[11,11],"rx":1.5,"sw":1},
      ],
      split: [
        {"d":"M8.5 3H12C12.5523 3 13 3.44772 13 4V12C13 12.5523 12.5523 13 12 13H8.5V3ZM7.5 2H8.5H12C13.1046 2 14 2.89543 14 4V12C14 13.1046 13.1046 14 12 14H8.5H7.5H4C2.89543 14 2 13.1046 2 12V4C2 2.89543 2.89543 2 4 2H7.5ZM7.5 13H4C3.44772 13 3 12.5523 3 12V4C3 3.44772 3.44772 3 4 3H7.5V13Z","f":1,"eo":1},
      ],
      expand: [
        {"d":"M4.5 5.5L8 2L11.5 5.5","sw":1},
        {"d":"M4.5 10.5L8 14L11.5 10.5","sw":1},
      ],
      collapse: [
        {"d":"M4.5 2.5L8 6L11.5 2.5","sw":1},
        {"d":"M4.5 13.5L8 10L11.5 13.5","sw":1},
      ],
      stash: [
        {"d":"M4.64645 5.14645C4.45118 5.34171 4.45118 5.65829 4.64645 5.85355L7.64645 8.85355C7.84171 9.04882 8.15829 9.04882 8.35355 8.85355L11.3536 5.85355C11.5488 5.65829 11.5488 5.34171 11.3536 5.14645C11.1583 4.95118 10.8417 4.95118 10.6464 5.14645L8.5 7.29289V1.5C8.5 1.22386 8.27614 1 8 1C7.72386 1 7.5 1.22386 7.5 1.5V7.29289L5.35355 5.14645C5.15829 4.95118 4.84171 4.95118 4.64645 5.14645Z","f":1},
        {"d":"M4.77639 8.55279L5.5 10H10.5L11.2236 8.55279C11.393 8.214 11.7393 8 12.118 8H14C14.5523 8 15 8.44772 15 9V13C15 13.5523 14.5523 14 14 14H2C1.44772 14 1 13.5523 1 13V9C1 8.44772 1.44772 8 2 8H3.88197C4.26074 8 4.607 8.214 4.77639 8.55279ZM3.88197 9L4.88197 11H11.118L12.118 9H14V13H2V9H3.88197Z","f":1,"eo":1},
      ],
      compare: [
        {"d":"M1.5 7.5H14.5M1.5 7.5L5.5 11.5M1.5 7.5L5.5 3.5M14.5 7.5L10.5 11.5M14.5 7.5L10.5 3.5","sw":1},
      ],
      checkout: [
        {"d":"M9.14535 3.14742C8.95009 3.34269 8.95009 3.65927 9.14535 3.85453L12.2916 7.00074L2.49805 7.00074C2.2219 7.00074 1.99805 7.2246 1.99805 7.50074C1.99805 7.77688 2.2219 8.00074 2.49805 8.00074L12.292 8.00074L9.14535 11.1474C8.95008 11.3427 8.95008 11.6593 9.14535 11.8545C9.34061 12.0498 9.65719 12.0498 9.85245 11.8545L13.8525 7.85453C13.9462 7.76076 13.9989 7.63359 13.9989 7.50098C13.9989 7.36837 13.9462 7.24119 13.8525 7.14742L9.85245 3.14742C9.65719 2.95216 9.34061 2.95216 9.14535 3.14742Z","f":1},
      ],
      toolWindow: [
        {"d":"M11.9091 3.50552L12.0543 3.66053H12.2667L14 3.66053C14.2818 3.66053 14.5102 3.88895 14.5102 4.17073V6.90732C14.5102 7.31554 14.2421 7.5102 14.0667 7.5102H8.93333C8.75795 7.5102 8.4898 7.31554 8.4898 6.90732V3.09268C8.4898 2.68446 8.75795 2.4898 8.93333 2.4898H10.9226C10.9452 2.4898 10.9668 2.49915 10.9822 2.51563L11.9091 3.50552Z","sw":0.979592},
        {"d":"M11.9091 11.5055L12.0543 11.6605H12.2667L14 11.6605C14.2818 11.6605 14.5102 11.889 14.5102 12.1707V14.9073C14.5102 15.3155 14.2421 15.5102 14.0667 15.5102H8.93333C8.75795 15.5102 8.4898 15.3155 8.4898 14.9073V11.0927C8.4898 10.6845 8.75795 10.4898 8.93333 10.4898H10.9226C10.9452 10.4898 10.9668 10.4991 10.9822 10.5156L11.9091 11.5055Z","sw":0.979592},
        {"d":"M1.5 1.5V4.5M1.5 4.5H6.5M1.5 4.5V12C1.5 12.2761 1.72386 12.5 2 12.5H6.5","sw":1},
      ],
      /* No warning glyph exists in the IDE set; the triangle carries the
         standard exclamation and reads at 13 px in the composer pill. */
      warning: [
        {"d":"M8.866 2.5C8.481 1.833 7.519 1.833 7.134 2.5L1.634 12C1.249 12.667 1.73 13.5 2.5 13.5H13.5C14.27 13.5 14.751 12.667 14.366 12L8.866 2.5Z","sw":1},
        {"d":"M8 6V9.5","sw":1.3},
        {"circle":[8,11.6,0.75],"f":1},
      ],
      chevronLeft: [
        {"d":"M9.5 11.5L6 8L9.5 4.5","sw":1},
      ],
      chevronRight: [
        {"d":"M6 11.5L9.5 8L6 4.5","sw":1},
      ],
    }

    /* No branch-plus glyph exists in the IDE set: the New Branch action wears
       the plain branch icon there, and the row label carries the rest. */
    ICONS.branchCreate = ICONS.branch
    /* The send-to-chat plane has no IDE counterpart; it keeps the drawn path. */
    ICONS.send = [
      { d: 'M14.3 1.7 1.7 7.4l4.9 1.9 1.9 4.9L14.3 1.7Z', sw: 1.1 },
      { d: 'M6.6 9.3 14.3 1.7', sw: 1.1 },
    ]

    function Icon(props) {
      const size = props.size === undefined ? 14 : props.size
      const shape = ICONS[props.name] === undefined ? ICONS.commit : ICONS[props.name]
      /* One <svg> per glyph; every shape carries its own paint, because the
         IDE set mixes filled silhouettes with 1px strokes inside one icon. */
      return E('svg', {
        className: 'git4idea-icon', width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round',
      }, shape.map((entry, index) => {
        const filled = entry.f === 1
        const common = {
          key: index,
          fill: filled ? 'currentColor' : 'none',
          stroke: filled ? 'none' : 'currentColor',
          strokeWidth: filled ? undefined : (entry.sw === undefined ? 1 : entry.sw),
          fillRule: entry.eo === 1 ? 'evenodd' : undefined,
        }
        if (entry.rect !== undefined) return E('rect', Object.assign({ x: entry.x, y: entry.y, width: entry.rect[0], height: entry.rect[1], rx: entry.rx }, common))
        if (entry.circle !== undefined) return E('circle', Object.assign({ cx: entry.circle[0], cy: entry.circle[1], r: entry.circle[2] }, common))
        return E('path', Object.assign({ d: entry.d }, common))
      }))
    }

    /* Menus are laid out INSIDE the panel on purpose: dock containers declare
       `contain: layout style` (the bottom workbench does, and containment is what
       keeps a docked pane from escaping its cell), and layout containment makes
       that element the containing block for position:fixed descendants. A viewport-
       anchored menu inside a 300px-tall panel is therefore laid out against the
       panel with viewport coordinates, lands outside it and looks exactly like
       'right click does nothing'. Anchors become panel-relative offsets clamped to
       the panel box, and the menu scrolls when it is taller than the room left. */
    function ContextMenu(props) {
      const ref = useRef(null)
      const cardRef = useRef(null)
      const closeRef = useRef(props.onClose)
      const [position, setPosition] = useState({ left: props.anchor.x, top: props.anchor.y })
      /* The open submenu: { items, top, flip } or null. Hover-driven — moving
         onto a different parent row swaps or closes it, so no timers are
         needed. Horizontal placement is pure CSS against the wrapper. */
      const [sub, setSub] = useState(null)
      useEffect(() => { closeRef.current = props.onClose })
      // Layout effect: the clamp below runs before the browser paints, so the menu
      // never flashes at its raw (possibly out-of-panel) anchor position.
      useLayoutEffect(() => {
        const element = cardRef.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        const width = props.boundsWidth === undefined ? 0 : props.boundsWidth
        const height = props.boundsHeight === undefined ? 0 : props.boundsHeight
        let left = props.anchor.x
        let top = props.anchor.y
        if (width > 0) left = Math.max(4, Math.min(left, width - rect.width - 4))
        if (height > 0 && top + rect.height > height - 4) top = Math.max(4, top - rect.height)
        setPosition({ left: left, top: top })
      }, [props.anchor.x, props.anchor.y, props.boundsWidth, props.boundsHeight])
      useEffect(() => {
        const onDown = (event) => {
          if (ref.current !== null && ref.current.contains(event.target)) return
          closeRef.current()
        }
        const onKey = (event) => { if (event.key === 'Escape') closeRef.current() }
        /* pointerdown, not mousedown: the list pointer-down handlers call
           preventDefault(), which suppresses the COMPATIBILITY mouse events
           (mousedown included) — a capture-phase mousedown listener then never
           fires and the menu stayed open when the next press landed on a list
           blank (user report). pointerdown always dispatches. */
        const timer = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
        document.addEventListener('keydown', onKey)
        return () => {
          clearTimeout(timer)
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [])
      /* Hover onto a parent row opens its submenu flush with the row's right
         edge (VS Code's SCM ▸ pattern); when the panel has no room to the
         right the submenu flips to the left edge. Only the TOP level opens
         submenus — hovering rows inside the submenu never re-enters here. */
      const openSub = (item, inSub, event) => {
        if (inSub === true || Array.isArray(item.items) !== true || item.items.length === 0) return
        const card = cardRef.current
        if (card === null) return
        const cardRect = card.getBoundingClientRect()
        const itemRect = event.currentTarget.getBoundingClientRect()
        /* The column edge wins over the panel edge: a wide branch submenu
           flips left instead of painting over the neighbouring pane. */
        const bounds = props.subBoundsWidth !== undefined && props.subBoundsWidth > 0
          ? props.subBoundsWidth
          : (props.boundsWidth === undefined ? 0 : props.boundsWidth)
        /* Round 3 #1: the submenu card took the PARENT card's width (it is
           absolutely positioned inside a shrink-to-fit wrapper), so long branch
           names were cut with an ellipsis. Its width is measured from the
           widest label and set inline; the flip test uses that same number. */
        let widest = 0
        for (const row of item.items) {
          if (row === null) continue
          const indent = row.indent === undefined ? 0 : row.indent
          const label = row.label === undefined ? '' : String(row.label)
          widest = Math.max(widest, indent * 12 + label.length * 6.8)
        }
        const subWidth = Math.max(240, Math.min(340, Math.round(24 + widest)))
        /* Direction only — the flush offset is CSS (`left:100%` / `right:100%`
           against the wrapper), so the seam is zero. */
        const flip = bounds > 0 && position.left + cardRect.width + subWidth > bounds - 4 && position.left - subWidth >= 4
        /* m04915: the folded branch list needs more rows than the parent card
           allows. The submenu takes its own height budget from the viewport
           instead of inheriting the parent's 320px cap, so a long branch list
           shows in one go and only then scrolls. */
        /* Round 2 #1: a fixed budget, not one that grows with the row count —
           a long branch group scrolls inside the card instead of tiling every
           entry down the panel. */
        const height = props.boundsHeight === undefined || props.boundsHeight <= 0 ? window.innerHeight : props.boundsHeight
        const room = Math.max(180, Math.min(320, height - itemRect.top - 16))
        setSub({ items: item.items, flip: flip, width: subWidth, top: Math.max(0, itemRect.top - cardRect.top - 4), maxHeight: room })
      }
      const renderItem = (item, index, inSub) => {
        if (item === null) return E('div', { key: 'sep-' + index, className: 'git4idea-menu-sep' })
        /* A header is a caption, not a verb: the branch filter groups its rows
           under 本地 / 远程 (v0.3.1 #7) and a disabled row would read as a
           broken entry. */
        if (item.header === true) return E('div', {
          key: 'head-' + index,
          className: 'git4idea-menu-header',
          style: item.indent === undefined || item.indent === 0 ? undefined : { paddingLeft: String(8 + item.indent * 12) + 'px' },
        }, item.label)
        const hasSub = inSub !== true && Array.isArray(item.items) === true && item.items.length > 0
        return E('button', {
          key: item.id + '-' + index + (inSub === true ? '-sub' : ''),
          type: 'button',
          'data-tip': item.disabled === true && item.reason !== undefined ? item.reason : '',
          className: 'git4idea-menu-item'
            + (item.danger === true ? ' git4idea-menu-danger' : '')
            + (item.disabled === true ? ' git4idea-menu-disabled' : '')
            + (item.active === true ? ' git4idea-menu-item-active' : ''),
          // The row keeps its id on the DOM so a `⋯ 更多` entry is addressable
          // (the rail's own buttons do the same; probes click through either).
          'data-action': item.id === undefined ? undefined : item.id,
          /* v0.3.1 (round 2 #1): a nested branch group indents inside the one
             submenu card, so depth travels as a row property. */
          style: item.indent === undefined || item.indent === 0 ? undefined : { paddingLeft: String(8 + item.indent * 12) + 'px' },
          disabled: item.disabled === true,
          onMouseEnter: (event) => openSub(item, inSub, event),
          onClick: (event) => {
            if (hasSub === true) return // a submenu parent opens on hover; the click must not close the menu
            closeRef.current(); item.run(event)
          },
        },
          item.icon === undefined ? null : E('span', { className: 'git4idea-menu-icon git4idea-tone-' + (item.tone === undefined ? 'secondary' : item.tone) }, E(Icon, { name: item.icon, size: 13 })),
          E('span', { className: 'git4idea-menu-label' }, item.label),
          hasSub === true ? E('span', { className: 'git4idea-menu-chevron' }, E(Icon, { name: 'chevron', size: 10 })) : null)
      }
      /* Two boxes on purpose (dsh 0.1.7-rc.2 menu-material contract): the outer
         card owns the material (a `::before` painted on its own layer, so the
         backdrop filter never becomes the containing block or backdrop root of
         the rows) and the inner box owns the scroll. `data-menu-material` is the
         theme's hook for the dark-menu stroke rebind — the same hook the shipped
         MenuSurface sets. Everything stays a plain `position: absolute` box
         inside `.git4idea-root`: panel-internal positioning is an invariant (13), and
         a portal to `document.body` would land outside the panel. The submenu is
         a second card inside the same wrapper, so outside-click and Escape cover
         both without extra wiring. */
      return E('div', { className: 'git4idea-menu-wrap', ref: ref, style: { left: position.left + 'px', top: position.top + 'px' } },
        E('div', { className: 'git4idea-menu', ref: cardRef, 'data-menu-material': 'translucent' },
          E('div', { className: 'git4idea-menu-scroll' },
            props.items.map((item, index) => renderItem(item, index, false)))),
        sub === null ? null : E('div', { className: 'git4idea-menu git4idea-menu-sub', 'data-menu-material': 'translucent', style: Object.assign({ maxHeight: sub.maxHeight === undefined ? undefined : sub.maxHeight + 'px', width: sub.width === undefined ? undefined : sub.width + 'px' }, sub.flip === true ? { right: '100%', top: sub.top + 'px' } : { left: '100%', top: sub.top + 'px' }) },
          E('div', { className: 'git4idea-menu-scroll' },
            sub.items.map((item, index) => renderItem(item, index, true)))))
    }


    /* ---- one bottom-right notification stack (m00761) ----
       Plain DOM on document.body, deliberately outside React and outside every
       app layer: shell.overlay and the composer are stacking contexts, so a
       node hosted in a slot paints UNDER the page chrome and the notice never
       shows. The stack owns its own element, mounts on the first push, and
       carries the highest z-index in the document.
       An entry closes itself after ttl; a pointer holds that count and leaving
       restarts a fresh five seconds. A long result folds to two lines — hover
       shows the whole text, a click pins it open. */
    const TOAST_TTL_MS = 5000
    const TOAST_TTL_ACTION_MS = 30000
    const TOAST_MIN_LEFT_MS = 1200

    /* Hosts that carry `shell.overlay` set this once the dialog seats are
       registered (m03471). It is set SYNCHRONOUSLY by the registration call, so
       an entry that is raised before React has mounted the host still lands in
       the store and is adopted on mount. */
    let overlaySeatReady = false

    const toastCenter = {
      items: [],
      nodes: new Map(),
      nextId: 0,
      closeLabel: 'Close',
      root: null,
      container() {
        if (this.root !== null && this.root.isConnected === true) return this.root
        let root = document.querySelector('[data-git4idea-toasts]')
        if (root !== null) {
          /* A previous instance left its element behind: start from an empty one. */
          root.textContent = ''
        } else {
          root = document.createElement('div')
          root.setAttribute('data-git4idea-toasts', '')
          root.className = 'git4idea-toasts'
          root.setAttribute('role', 'status')
          root.setAttribute('aria-live', 'polite')
          document.body.appendChild(root)
        }
        this.root = root
        return root
      },
      arm(item) {
        if (item.left <= 0) return
        item.since = Date.now()
        item.timer = setTimeout(() => {
          item.timer = null
          item.onClose()
        }, item.left)
      },
      hold(item) {
        if (item.timer === null) return
        clearTimeout(item.timer)
        item.timer = null
        item.left = Math.max(TOAST_MIN_LEFT_MS, item.left - (Date.now() - item.since))
      },
      node(item) {
        const row = document.createElement('div')
        row.className = 'git4idea-toast' + (item.tone === undefined ? '' : ' git4idea-toast-' + item.tone)
        const text = document.createElement('div')
        text.className = 'git4idea-toast-text'
        text.textContent = item.text
        text.title = item.text
        text.addEventListener('click', () => { row.classList.toggle('git4idea-toast-open') })
        row.appendChild(text)
        if (item.actionLabel !== undefined) {
          const action = document.createElement('button')
          action.type = 'button'
          action.className = 'git4idea-toast-action'
          action.textContent = item.actionLabel
          action.addEventListener('click', () => { item.onAction() })
          row.appendChild(action)
        }
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'git4idea-icon-btn git4idea-icon-btn-small git4idea-toast-close'
        close.setAttribute('aria-label', this.closeLabel)
        close.textContent = '×'
        close.addEventListener('click', () => { item.onClose() })
        row.appendChild(close)
        row.addEventListener('mouseenter', () => { this.hold(item) })
        row.addEventListener('mouseleave', () => { item.left = item.ttl; this.arm(item) })
        return row
      },
      render() {
        if (typeof document === 'undefined') return
        const root = this.container()
        const live = new Set(this.items.map((item) => item.id))
        for (const [id, node] of Array.from(this.nodes)) {
          if (live.has(id) === true) continue
          node.remove()
          this.nodes.delete(id)
        }
        for (const item of this.items) {
          if (this.nodes.has(item.id) === true) continue
          const node = this.node(item)
          this.nodes.set(item.id, node)
          root.appendChild(node)
          this.arm(item)
        }
      },
      push(toast) {
        this.nextId += 1
        const id = 'git4idea-toast-' + String(this.nextId)
        const ttl = toast.ttl === undefined ? (toast.actionLabel === undefined ? TOAST_TTL_MS : TOAST_TTL_ACTION_MS) : toast.ttl
        const item = Object.assign({ id: id, ttl: ttl, left: ttl, timer: null, since: 0, onClose: () => { toastCenter.drop(id) } }, toast)
        this.items = this.items.concat([item])
        this.render()
        return id
      },
      drop(id) {
        const gone = this.items.filter((item) => item.id === id)
        if (gone.length === 0) return
        for (const item of gone) {
          if (item.timer !== null) clearTimeout(item.timer)
        }
        this.items = this.items.filter((item) => item.id !== id)
        this.render()
      },
    }

    /* Every user gesture answers in that one stack (m05310): the panel routes
       its failures through notifySink; these two helpers give every other
       surface — the composer popover, the commit/push cards, the settings
       writes — the same path, so no outcome stays silent. */
    function notifyOk(text) {
      if (typeof text !== 'string' || text === '') return
      toastCenter.push({ text: text, tone: 'ok' })
    }
    function notifyFail(caught) {
      const text = caught instanceof Error && caught.message !== '' ? caught.message : String(caught)
      toastCenter.push({ text: text, tone: 'error' })
    }


    function PromptDialog(props) {
      const [value, setValue] = useState(props.initialValue === undefined ? '' : props.initialValue)
      const ref = useRef(null)
      useEffect(() => { if (ref.current !== null) ref.current.focus() }, [])
      const submit = () => { if (value.trim() !== '') props.onSubmit(value.trim()) }
      return E('div', { className: 'git4idea-overlay' },
        E('div', { className: 'git4idea-dialog' },
          E('div', { className: 'git4idea-dialog-title' }, props.title),
          props.text === undefined || props.text === '' ? null : E('div', { className: 'git4idea-dialog-text' }, props.text),
          E('input', {
            ref: ref, className: 'git4idea-input', value: value, spellCheck: false,
            placeholder: props.placeholder === undefined ? '' : props.placeholder,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); submit() }
              if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
            },
          }),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', { type: 'button', className: 'git4idea-btn', onClick: props.onCancel }, props.cancelLabel),
            E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-primary', onClick: submit }, props.okLabel))))
    }

    /* v0.3.1 (#N2, round 3 #2): the path filter's tree entry. Every directory
       AND file HEAD holds, folded by default, one checkbox per row. Checked rows
       become the git pathspec list (a folder covers its subtree), so several
       unrelated paths filter one log at once. The list itself is the tree —
       IDEA's picker has no search box either. */
    function PathTreeDialog(props) {
      const t = props.t
      const [entries, setEntries] = useState(null)
      const [checked, setChecked] = useState(() => new Set(Array.isArray(props.value) === true ? props.value : []))
      const [open, setOpen] = useState({})
      useEffect(() => {
        let live = true
        Promise.resolve(props.load()).then((list) => {
          if (live !== true) return
          setEntries(Array.isArray(list) === true ? list : [])
        }, () => { if (live === true) setEntries([]) })
        return () => { live = false }
      }, [])
      const tree = useMemo(() => {
        const nodes = (entries === null ? [] : entries).map((item) => ({
          path: String(item.path),
          dir: item.dir === true,
          children: [],
        })).filter((node) => node.path !== '')
        const byPath = new Map(nodes.map((node) => [node.path, node]))
        const roots = []
        for (const node of nodes) {
          const cut = node.path.lastIndexOf('/')
          const parent = cut > 0 ? byPath.get(node.path.slice(0, cut)) : undefined
          if (parent === undefined) roots.push(node)
          else parent.children.push(node)
        }
        const sort = (list) => {
          list.sort((a, b) => {
            if (a.dir !== b.dir) return a.dir === true ? -1 : 1
            return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
          })
          for (const node of list) sort(node.children)
        }
        sort(roots)
        return roots
      }, [entries])
      const flip = (path) => setOpen((previous) => {
        const next = Object.assign({}, previous)
        if (next[path] === true) delete next[path]
        else next[path] = true
        return next
      })
      /* Accessible from the checkbox and the row: a click anywhere but the
         twist toggles the pick. */
      const toggle = (path) => setChecked((previous) => {
        const next = new Set(previous)
        if (next.has(path) === true) next.delete(path)
        else next.add(path)
        return next
      })
      const rows = []
      const walk = (list, depth) => {
        for (const node of list) {
          rows.push({ node: node, depth: depth })
          if (node.dir === true && open[node.path] === true) walk(node.children, depth + 1)
        }
      }
      walk(tree, 0)
      /* A checked folder already covers its children: submitting both would
         pass a pathspec list git reads as redundant. */
      const submit = () => {
        const list = Array.from(checked).sort()
        const out = []
        for (const path of list) {
          let covered = false
          for (const kept of out) if (path.indexOf(kept + '/') === 0) { covered = true; break }
          if (covered !== true) out.push(path)
        }
        props.onSubmit(out)
      }
      const rowOf = (item) => {
        const node = item.node
        const hasChildren = node.dir === true && node.children.length > 0
        return E('div', {
          key: (node.dir ? 'd:' : 'f:') + node.path,
          className: 'git4idea-path-row',
          style: { paddingLeft: String(4 + item.depth * 12) + 'px' },
        },
          hasChildren === true
            ? E('button', {
                type: 'button', className: 'git4idea-path-twist' + (open[node.path] === true ? ' git4idea-path-twist-open' : ''),
                onClick: (event) => { event.stopPropagation(); flip(node.path) },
              }, E(Icon, { name: 'chevron', size: 10 }))
            : E('span', { className: 'git4idea-path-twist' }),
          E('label', { className: 'git4idea-path-pick' },
            E('input', {
              type: 'checkbox', className: 'git4idea-path-cb', checked: checked.has(node.path),
              onChange: () => toggle(node.path),
            }),
            E(Icon, { name: node.dir === true ? 'folder' : 'file', size: 11 }),
            E('span', { className: 'git4idea-path-name', title: node.path },
              node.path.slice(node.path.lastIndexOf('/') + 1))))
      }
      return E('div', { className: 'git4idea-overlay' },
        E('div', { className: 'git4idea-dialog git4idea-dialog-tree' },
          E('div', { className: 'git4idea-dialog-title' }, props.title),
          E('div', { className: 'git4idea-path-tree' },
            E('div', { className: 'git4idea-path-bar' },
              E('span', { className: 'git4idea-path-note' }, checked.size === 0 ? t('filter.all') : fill(t('filter.pathCount'), { n: String(checked.size) })),
              checked.size === 0 ? null : E('button', {
                type: 'button', className: 'git4idea-path-clear',
                onClick: () => setChecked(new Set()),
              }, t('filter.clearOne'))),
            entries === null
              ? E('div', { className: 'git4idea-path-note' }, '…')
              : rows.length === 0
                ? E('div', { className: 'git4idea-path-note' }, t('filter.none'))
                : rows.map(rowOf)),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', { type: 'button', className: 'git4idea-btn', onClick: props.onCancel }, props.cancelLabel),
            E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-primary', onClick: submit }, props.okLabel))))
    }

    /* VS Code's "Clone...": a URL plus an absolute target path. Two inputs in
       one dialog — chaining two single prompts would forget the URL by the
       time the directory is typed. */
    function CloneDialog(props) {
      const [url, setUrl] = useState('')
      const [dir, setDir] = useState('')
      const ref = useRef(null)
      useEffect(() => { if (ref.current !== null) ref.current.focus() }, [])
      const ready = url.trim() !== '' && dir.trim() !== ''
      const submit = () => { if (ready === true) props.onSubmit(url.trim(), dir.trim()) }
      const onKey = (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
      }
      return E('div', { className: 'git4idea-overlay' },
        E('div', { className: 'git4idea-dialog' },
          E('div', { className: 'git4idea-dialog-title' }, props.title),
          E('input', {
            ref: ref, className: 'git4idea-input', value: url, spellCheck: false,
            placeholder: props.urlPlaceholder === undefined ? '' : props.urlPlaceholder,
            onChange: (event) => setUrl(event.target.value), onKeyDown: onKey,
          }),
          E('input', {
            className: 'git4idea-input', value: dir, spellCheck: false,
            placeholder: props.dirPlaceholder === undefined ? '' : props.dirPlaceholder,
            onChange: (event) => setDir(event.target.value), onKeyDown: onKey,
          }),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', { type: 'button', className: 'git4idea-btn', onClick: props.onCancel }, props.cancelLabel),
            E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-primary', disabled: ready === false, onClick: submit }, props.okLabel))))
    }

    /* A destructive confirm: focus starts on Cancel (never on the red button), Enter
       only submits when the dialog asked for a typed confirmation, and passing
       requireText turns the dialog into a type-the-name gate. */
    function ConfirmDialog(props) {
      const t = props.t
      const [typed, setTyped] = useState('')
      const cancelRef = useRef(null)
      const needText = typeof props.requireText === 'string' && props.requireText !== ''
      const matches = needText === false || typed.trim() === props.requireText
      useEffect(() => { if (cancelRef.current !== null) cancelRef.current.focus() }, [])
      return E('div', { className: 'git4idea-overlay' },
        E('div', { className: 'git4idea-dialog' },
          E('div', { className: 'git4idea-dialog-title' }, props.title),
          E('div', { className: 'git4idea-dialog-text' }, props.text),
          needText === false ? null : E('input', {
            className: 'git4idea-input', value: typed, spellCheck: false,
            placeholder: fill(t('confirm.typeName'), { name: props.requireText }),
            onChange: (event) => setTyped(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter' && matches === true) props.onConfirm() },
          }),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', { ref: cancelRef, type: 'button', className: 'git4idea-btn', onClick: props.onCancel }, props.cancelLabel),
            E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-danger', disabled: matches === false, onClick: props.onConfirm }, props.okLabel))))
    }

    function Segmented(props) {
      return E('div', { className: 'git4idea-seg' },
        props.items.map((item) => E('button', {
          key: item.id,
          type: 'button',
          className: 'git4idea-seg-item',
          'data-active': props.value === item.id ? 'true' : 'false',
          onClick: () => props.onChange(item.id),
        }, item.label)))
    }

    /* A draggable divider between two panes. The pane it resizes is the sibling
       it is rendered against, and its size is MEASURED at pointerdown — so a pane
       still living on its stylesheet default (a percentage cap, or a diff pane
       sized by its own content) drags from exactly where it looks. Pointer capture
       keeps the drag alive once the pointer leaves the 8px hit area, and
       touch-action:none is what stops a phone from scrolling the panel instead of
       resizing it. Arrow keys nudge (Shift = 4x), double-click resets, and the
       whole thing is focusable so the divider is reachable without a mouse. */
    function Gutter(props) {
      const dragRef = useRef(null)
      const targetOf = (node) => (props.side === 'next' ? node.nextElementSibling : node.previousElementSibling)
      const extentOf = (node) => {
        if (node === null || typeof node.getBoundingClientRect !== 'function') return 0
        const rect = node.getBoundingClientRect()
        return props.vertical === true ? rect.width : rect.height
      }
      const sign = props.side === 'next' ? -1 : 1
      /* Pointermove arrives faster than frames can paint, and every dragPane
       * does a forced reflow (measurePanes) plus two setStates — handling each
       * event is layout thrashing, and the report (#16 follow-up) is exactly
       * that: a drag starts smooth, then feels glued to the cursor. The latest
       * px parks in a ref and ONE rAF per frame hands it to the clamp; pointerup
       * flushes the parked value first so a gesture never ends on a stale size. */
      const frameRef = useRef(0)
      const pendingRef = useRef(null)
      const flushRef = useRef(null)
      useEffect(() => () => { if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current) }, [])
      flushRef.current = () => {
        if (frameRef.current !== 0) { cancelAnimationFrame(frameRef.current); frameRef.current = 0 }
        const value = pendingRef.current
        pendingRef.current = null
        if (value !== null) props.onDrag(value)
      }
      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return
        dragRef.current = {
          id: event.pointerId,
          at: props.vertical === true ? event.clientX : event.clientY,
          size: extentOf(targetOf(event.currentTarget)),
        }
        if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
        if (typeof event.currentTarget.focus === 'function') event.currentTarget.focus()
        props.onStart()
      }
      const onPointerMove = (event) => {
        const drag = dragRef.current
        if (drag === null || drag.id !== event.pointerId) return
        const at = props.vertical === true ? event.clientX : event.clientY
        pendingRef.current = drag.size + sign * (at - drag.at)
        if (frameRef.current === 0) frameRef.current = requestAnimationFrame(() => flushRef.current())
      }
      const onPointerUp = () => {
        if (dragRef.current === null) return
        dragRef.current = null
        if (frameRef.current !== 0) flushRef.current()
        props.onEnd()
      }
      const onKeyDown = (event) => {
        const step = event.shiftKey === true ? 32 : 8
        const axis = props.vertical === true
          ? (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)
          : (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
        if (axis === 0) return
        event.preventDefault()
        props.onDrag(extentOf(targetOf(event.currentTarget)) + sign * axis * step)
        props.onEnd()
      }
      const label = fill(props.t('pane.resize'), { name: props.t(props.nameKey) })
      return E('div', {
        className: 'git4idea-gutter ' + (props.vertical === true ? 'git4idea-gutter-v' : 'git4idea-gutter-h')
          + (props.active === true ? ' git4idea-gutter-active' : ''),
        role: 'separator',
        tabIndex: 0,
        'aria-orientation': props.vertical === true ? 'vertical' : 'horizontal',
        'aria-label': label,
        'aria-valuenow': props.value,
        'aria-valuemin': props.min,
        'aria-valuemax': props.max,
        'data-tip': label,
        onPointerDown: onPointerDown,
        onPointerMove: onPointerMove,
        onPointerUp: onPointerUp,
        onPointerCancel: onPointerUp,
        onLostPointerCapture: onPointerUp,
        onDoubleClick: () => props.onReset(),
        onKeyDown: onKeyDown,
      })
    }

    function RepoSelect(props) {
      const t = props.t
      /* While the workspace is still being scanned the panel used to print "no
         repository found" — a verdict nobody had reached yet. A deep workspace
         scan takes seconds, so that premature verdict sat on screen long enough
         to look like the final answer. Loading shows loading; "not found" only
         shows once the scan came back empty. */
      if (props.loading === true) {
        return E('span', { className: 'git4idea-repo-static' },
          E(Icon, { name: 'folder', size: 12 }),
          E('span', { className: 'git4idea-repo-name' }, t('status.loading')))
      }
      if (props.repos.length <= 1) {
        const only = props.repos.length === 1 ? props.repos[0] : null
        return E('span', { className: 'git4idea-repo-static', 'data-tip': only === null ? '' : only.path },
          E(Icon, { name: 'folder', size: 12 }),
          E('span', { className: 'git4idea-repo-name' }, only === null ? t('repo.empty') : only.name))
      }
      /* The switcher is a button over a panel-internal menu, not a native
         <select>: the OS-drawn popup ignores the panel theme entirely (light
         system colours over a dark translucent panel) and was unreadable. */
      let current = null
      for (const repo of props.repos) { if (repo.path === props.value) { current = repo; break } }
      return E('span', { className: 'git4idea-select-wrap', 'data-tip': current === null ? t('repo.switch') : current.path },
        E(Icon, { name: 'folder', size: 12 }),
        E('button', {
          type: 'button',
          className: 'git4idea-select git4idea-select-btn git4idea-select-repo',
          onClick: props.onOpenMenu,
        },
          E('span', { className: 'git4idea-repo-name' },
            current === null ? t('repo.pick') : current.name + (current.branch === null || current.branch === undefined ? '' : ' · ' + current.branch)),
          E(Icon, { name: 'chevron', size: 12 })))
    }

    /* The history filters were the LAST native <select>s: their popup is drawn
       by the OS, so a dark translucent panel still got a light system list —
       reported on v0.5.4 ("only the one at the top was replaced"). Same
       treatment as the header switchers: a button over a panel-internal menu. */
    function FilterSelect(props) {
      const options = Array.isArray(props.options) ? props.options : []
      let current = options[0]
      for (const option of options) { if (option.value === props.value) { current = option; break } }
      /* v0.3.1 (#N1): an empty filter shows its label alone. "分支: 全部" told
         the user nothing and spent the width a long value needs. A set filter
         shows label and value on one ellipsized line; the whole text is the
         tooltip. Callers that own the wording pass 'tip' (the path chip prints
         the full path on a second line). */
      const empty = props.value === '' || props.value === undefined
      const label = empty === true ? props.label : props.label + ': ' + (current === undefined ? String(props.value) : current.label)
      const tip = props.tip !== undefined
        ? props.tip
        : (empty === true ? (props.hint === undefined ? props.label : props.hint) : label)
      return E('span', { className: 'git4idea-filter-select' + (empty === true ? '' : ' git4idea-filter-on'), 'data-tip': tip },
        E('button', {
          type: 'button',
          className: 'git4idea-filter-main',
          onClick: (event) => { if (props.onOpenMenu !== undefined) props.onOpenMenu(event, options) },
        },
          E('span', { className: 'git4idea-filter-label' }, label),
          E(Icon, { name: 'chevron', size: 11 })),
        /* The x clears THIS filter (#N3); the filter bar has no global reset. */
        empty === true || props.onClear === undefined ? null : E('button', {
          type: 'button', className: 'git4idea-filter-clear', 'data-tip': props.clearHint,
          onClick: (event) => { event.stopPropagation(); props.onClear() },
        }, E(Icon, { name: 'close', size: 9 })))
    }

    function RepoPicker(props) {
      const t = props.t
      const repos = props.repos
      return E('div', { className: 'git4idea-picker' },
        E('div', { className: 'git4idea-picker-title' }, repos.length === 0 ? t('repo.empty') : t('repo.pick')),
        E('div', { className: 'git4idea-picker-sub' }, props.cwd),
        repos.map((repo) => E('button', {
          key: repo.path,
          type: 'button',
          className: 'git4idea-picker-row',
          onClick: () => props.onPick(repo.path),
        },
          E('span', { className: 'git4idea-picker-icon' }, E(Icon, { name: 'folder', size: 13 })),
          E('span', { className: 'git4idea-picker-name' }, repo.name),
          repo.branch === null || repo.branch === undefined ? null : E('span', { className: 'git4idea-badge' }, repo.branch),
          E('span', { className: 'git4idea-picker-kind' }, repo.kind === 'workspace' ? t('repo.workspace') : t('repo.nested')),
          E('span', { className: 'git4idea-picker-path' }, repo.path))))
    }

