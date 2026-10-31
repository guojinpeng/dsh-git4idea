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
      /* Drop every notice that offered an undo for this handle: the action
         happened, so the same button must not stay clickable. */
      dropUndo(undoId) {
        for (const item of this.items.slice()) {
          if (item.undoId === undoId) this.drop(item.id)
        }
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
      const multiline = props.multiline === true
      useEffect(() => { if (ref.current !== null) ref.current.focus() }, [])
      const submit = () => { if (value.trim() !== '') props.onSubmit(value.trim()) }
      return E('div', { className: 'git4idea-overlay' },
        E('div', { className: 'git4idea-dialog' + (multiline === true ? ' git4idea-dialog-wide' : '') },
          E('div', { className: 'git4idea-dialog-title' }, props.title),
          props.text === undefined || props.text === '' ? null : E('div', { className: 'git4idea-dialog-text' }, props.text),
          multiline === true ? E('textarea', {
            ref: ref, className: 'git4idea-input git4idea-input-area', value: value, rows: 4, spellCheck: false,
            placeholder: props.placeholder === undefined ? '' : props.placeholder,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey === true || event.metaKey === true)) { event.preventDefault(); submit() }
              if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
            },
          }) : E('input', {
            ref: ref, className: 'git4idea-input', value: value, spellCheck: false,
            placeholder: props.placeholder === undefined ? '' : props.placeholder,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); submit() }
              if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
            },
          }),
          props.hint === undefined || props.hint === '' ? null : E('div', { className: 'git4idea-dialog-hint' }, props.hint),
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
       requireText turns the dialog into a type-the-name gate. An optional checkbox
       hands its state to onConfirm — used for "force delete"; defaultChecked starts
       it ticked. */
    function ConfirmDialog(props) {
      const t = props.t
      const [typed, setTyped] = useState('')
      const [checked, setChecked] = useState(props.checkbox !== undefined && props.checkbox.defaultChecked === true)
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
            onKeyDown: (event) => { if (event.key === 'Enter' && matches === true) props.onConfirm(checked) },
          }),
          props.checkbox === undefined ? null : E('label', { className: 'git4idea-dialog-check' },
            E('input', { type: 'checkbox', checked: checked, onChange: (event) => setChecked(event.target.checked) }),
            E('span', null, props.checkbox.label)),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', { ref: cancelRef, type: 'button', className: 'git4idea-btn', onClick: props.onCancel }, props.cancelLabel),
            E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-danger', disabled: matches === false, onClick: () => props.onConfirm(checked) }, props.okLabel))))
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

