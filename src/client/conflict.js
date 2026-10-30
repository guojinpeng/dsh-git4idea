/**
 * dsh-git4idea — conflict editor (client fragment).
 *
 * A conflicted path opens as a card over the page: the current branch on the
 * left, the merged result in the middle, the incoming branch on the right. The
 * two side panes are read-only and settle a conflict block with their own
 * buttons; the middle pane is a plain editor from the start. Nothing here
 * stages a file behind the user's back: "mark resolved" is the explicit verb,
 * and the card closes once it lands.
 */
    /* One conflict card at a time, raised from a change row. The store matches
       the commit/push/file dialogs so the frame-level host can mount it. */
    const conflictDialog = {
      entry: null,
      hosted: false,
      listeners: new Set(),
      set(entry) {
        conflictDialog.entry = entry
        for (const listener of conflictDialog.listeners) {
          try { listener() } catch (error) { void error }
        }
      },
      subscribe(listener) {
        conflictDialog.listeners.add(listener)
        return () => { conflictDialog.listeners.delete(listener) }
      },
    }

    const CONFLICT_LF = String.fromCharCode(10)
    const CONFLICT_CRLF = String.fromCharCode(13) + CONFLICT_LF
    const CONFLICT_LINE_HEIGHT = 18
    const CONFLICT_BLANK = String.fromCharCode(160)

    /* The host writes a CRLF file back as CRLF; the editor works in LF only, so
       one conversion here keeps caret offsets equal to string offsets. */
    function conflictToLf(value) {
      return typeof value === 'string' ? value.split(CONFLICT_CRLF).join(CONFLICT_LF) : ''
    }

    /* ---- three-way merge model (m00849) ---------------------------------- */

    /* The patch of one stage pair as base ranges: [b0,b1) is the base slice a
       hunk replaces, and its '+' lines are that side's content there. The diff
       runs with -U0, so a hunk carries no context lines to strip. */
    function conflictHunks(patch) {
      const hunks = []
      for (const segment of splitPatchFiles(patch)) {
        for (const hunk of segment.hunks) {
          const lines = []
          for (const line of hunk.lines) {
            if (line.charAt(0) === '+') lines.push(line.slice(1))
          }
          const b0 = hunk.oldLines > 0 ? hunk.oldStart - 1 : hunk.oldStart
          hunks.push({ b0: b0, b1: b0 + hunk.oldLines, lines: lines })
        }
      }
      return hunks
    }

    /* One side's text for a base range: its hunks replace their slice, every
       other base line stays. */
    function conflictSideText(start, end, hunks, baseLines, sideLines) {
      const out = []
      let at = start
      for (const hunk of hunks) {
        if (hunk.b1 < start || hunk.b0 > end) continue
        for (let line = at; line < hunk.b0; line++) out.push(baseLines[line])
        for (const line of hunk.lines) out.push(line)
        at = Math.max(at, hunk.b1)
      }
      for (let line = at; line < end; line++) out.push(baseLines[line])
      return out
    }

    /* The blocks of a three-way merge: common runs, one-side changes, and the
       regions both sides touched (the conflicts). Hunks that touch merge into
       one cluster: git conflicts on adjacent lines too (measured), so touching
       counts as overlap here. */
    function conflictMergeModel(baseText, oursText, theirsText, oursHunks, theirsHunks) {
      const baseLines = conflictToLf(baseText).split(CONFLICT_LF)
      const oursLines = conflictToLf(oursText).split(CONFLICT_LF)
      const theirsLines = conflictToLf(theirsText).split(CONFLICT_LF)
      const all = []
      for (const hunk of oursHunks) all.push({ b0: hunk.b0, b1: hunk.b1, side: 'ours' })
      for (const hunk of theirsHunks) all.push({ b0: hunk.b0, b1: hunk.b1, side: 'theirs' })
      all.sort((left, right) => (left.b0 - right.b0) || (left.b1 - right.b1))
      const clusters = []
      for (const item of all) {
        const last = clusters.length === 0 ? null : clusters[clusters.length - 1]
        if (last !== null && item.b0 <= last.b1) {
          last.b1 = Math.max(last.b1, item.b1)
          last.ours = last.ours === true || item.side === 'ours'
          last.theirs = last.theirs === true || item.side === 'theirs'
        } else {
          clusters.push({ b0: item.b0, b1: item.b1, ours: item.side === 'ours', theirs: item.side === 'theirs' })
        }
      }
      const blocks = []
      let cursor = 0
      for (const cluster of clusters) {
        if (cluster.b0 > cursor) {
          const run = baseLines.slice(cursor, cluster.b0)
          blocks.push({ kind: 'common', base: run, ours: run, theirs: run })
        }
        const baseRun = baseLines.slice(cluster.b0, cluster.b1)
        const oursRun = conflictSideText(cluster.b0, cluster.b1, oursHunks, baseLines, oursLines)
        const theirsRun = conflictSideText(cluster.b0, cluster.b1, theirsHunks, baseLines, theirsLines)
        if (cluster.ours === true && cluster.theirs === true) {
          const same = oursRun.join(CONFLICT_LF) === theirsRun.join(CONFLICT_LF)
          blocks.push({ kind: same ? 'same' : 'conflict', base: baseRun, ours: oursRun, theirs: theirsRun })
        } else {
          blocks.push({ kind: cluster.ours === true ? 'ours' : 'theirs', base: baseRun, ours: oursRun, theirs: theirsRun })
        }
        cursor = cluster.b1
      }
      if (cursor < baseLines.length) {
        const run = baseLines.slice(cursor)
        blocks.push({ kind: 'common', base: run, ours: run, theirs: run })
      }
      /* Each block's first line on each side, for the pane highlight. */
      let baseAt = 0
      let oursAt = 0
      let theirsAt = 0
      for (const block of blocks) {
        block.baseStart = baseAt
        block.oursStart = oursAt
        block.theirsStart = theirsAt
        baseAt += block.base.length
        oursAt += block.ours.length
        theirsAt += block.theirs.length
      }
      return { blocks: blocks, oursLines: oursLines, theirsLines: theirsLines }
    }

    /* The lines of one block in the result column. An untouched conflict block
       keeps the base lines, so opening the card never loses code; the first
       decision on either side replaces the base. "adopt" adds that side's
       lines, and adopting both keeps both — left first, then right, the order
       the IDE shows. "discard" adds nothing, because discarding abandons that
       side's text. */
    function conflictResultBlockLines(block, index, auto, decisions) {
      if (block.kind === 'conflict') {
        const decision = decisions[index]
        const picked = decision !== undefined && (decision.ours !== undefined || decision.theirs !== undefined)
        if (picked !== true) return block.base.slice()
        const lines = []
        if (decision.ours === 'adopt') for (const line of block.ours) lines.push(line)
        if (decision.theirs === 'adopt') for (const line of block.theirs) lines.push(line)
        return lines
      }
      if (block.kind === 'ours') return auto === 'theirs' ? block.base : block.ours
      if (block.kind === 'theirs') return auto === 'ours' ? block.base : block.theirs
      return block.ours
    }

    /* The whole result: the toolbar mode settles the one-sided blocks, the block
       buttons settle the conflicts. */
    function conflictResultLines(model, auto, decisions) {
      const out = []
      for (let index = 0; index < model.blocks.length; index++) {
        for (const line of conflictResultBlockLines(model.blocks[index], index, auto, decisions)) out.push(line)
      }
      return out
    }

    function conflictResultText(model, auto, decisions) {
      return conflictResultLines(model, auto, decisions).join(CONFLICT_LF)
    }

    /* One side's pane: every line of that file, numbered, tinted where the block
       is not common, with the block's own buttons on its first line. */
    function conflictSideRows(model, side) {
      const rows = []
      let number = 1
      for (let index = 0; index < model.blocks.length; index++) {
        const block = model.blocks[index]
        const lines = side === 'ours' ? block.ours : block.theirs
        const changed = block.kind === 'conflict'
          || (side === 'ours' ? block.kind === 'ours' : block.kind === 'theirs')
        for (let at = 0; at < lines.length; at++) {
          rows.push({
            block: index,
            text: lines[at],
            num: number++,
            first: at === 0,
            changed: changed,
            conflict: block.kind === 'conflict',
          })
        }
      }
      return rows
    }

    /* How many result lines sit above a block: the jump buttons need it to put
       the result column on the same block as the side panes. */
    function conflictResultRowsBefore(model, auto, decisions, index) {
      let total = 0
      for (let at = 0; at < index; at++) {
        total += conflictResultBlockLines(model.blocks[at], at, auto, decisions).length
      }
      return total
    }

    /* A block is settled when both sides carry a decision. Discard counts:
       dropping both sides is a real choice, so it raises no "still open" note. */
    function conflictSettled(decisions, index) {
      const decision = decisions[index]
      return decision !== undefined && decision.ours !== undefined && decision.theirs !== undefined
    }

    /* The conflict card of m01041: three panes side by side. The two side panes
       are read-only and settle a conflict block with their own adopt/discard
       pair; the result pane is an editor from the start. Changed regions carry a
       tint instead of the <<<<<<< / ======= / >>>>>>> lines. Block picks, side
       adoption and the toolbar verbs are undoable; Ctrl+Z / Ctrl+Y also work
       (Cmd on macOS). */
    function ConflictDialogBody(props) {
      const t = props.t
      const entry = props.entry
      const base = { cwd: entry.cwd, repoRoot: entry.repoRoot }
      const [detail, setDetail] = useState(null)
      const [model, setModel] = useState(null)
      const [auto, setAuto] = useState('both')
      const [decisions, setDecisions] = useState({})
      const [text, setText] = useState('')
      const [dirty, setDirty] = useState(false)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const [, bumpHistory] = useState(0)
      const [active, setActive] = useState(-1)
      const undoRef = useRef([])
      const redoRef = useRef([])
      const leftRef = useRef(null)
      const midRef = useRef(null)
      const rightRef = useRef(null)
      const midGutterRef = useRef(null)
      const menuRef = useRef(null)
      const typingRef = useRef(0)
      const typingOpenRef = useRef(false)
      /* Echo window: a programmatic scroll assignment fires the target's own
         onScroll. Without the mute a clamped pane would push its shorter offset
         back into the pane the user is dragging. */
      const syncLockRef = useRef(0)
      const [blame, setBlame] = useState(null)
      const [menu, setMenu] = useState(null)
      const fail = (caught) => {
        const message = caught instanceof Error ? caught.message : String(caught)
        setNote(message)
        toastCenter.push({ text: message, tone: 'error', icon: 'close' })
      }

      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const next = await request('conflictDetail', Object.assign({}, base, { path: entry.path }))
            if (alive !== true) return
            setDetail(next)
            setModel(null)
            setAuto('both')
            setDecisions({})
            setText('')
            setDirty(false)
            setNote('')
            setActive(-1)
            undoRef.current = []
            redoRef.current = []
            if (next.binary === true || next.editable !== true) return
            if (typeof next.base !== 'string' || typeof next.ours !== 'string' || typeof next.theirs !== 'string') return
            try {
              const patches = await Promise.all([
                request('diff', Object.assign({}, base, { path: entry.path, stageA: 1, stageB: 2, context: 0 })),
                request('diff', Object.assign({}, base, { path: entry.path, stageA: 1, stageB: 3, context: 0 })),
              ])
              if (alive !== true) return
              const built = conflictMergeModel(next.base, next.ours, next.theirs, conflictHunks(patches[0].patch), conflictHunks(patches[1].patch))
              setModel(built)
              setText(conflictResultText(built, 'both', {}))
            } catch (caught) {
              /* A side that deletes the file has no stage to diff against: the
                 card still edits and saves, only the columns stay off. */
              void caught
              if (alive === true) setModel(null)
            }
          } catch (caught) {
            if (alive === true) fail(caught)
          }
        })()
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [entry.path, entry.repoRoot])

      const editable = detail !== null && detail.binary !== true && detail.editable === true
      const conflictBlocks = []
      const unresolved = []
      if (model !== null) {
        for (let index = 0; index < model.blocks.length; index++) {
          if (model.blocks[index].kind !== 'conflict') continue
          conflictBlocks.push(index)
          if (conflictSettled(decisions, index) !== true) unresolved.push(index)
        }
      }
      const leftRows = useMemo(() => (model === null ? [] : conflictSideRows(model, 'ours')), [model])
      const rightRows = useMemo(() => (model === null ? [] : conflictSideRows(model, 'theirs')), [model])

      const snapshot = () => ({ auto: auto, decisions: decisions, text: text })
      const restore = (state) => {
        setAuto(state.auto)
        setDecisions(state.decisions)
        setText(state.text)
        /* The result annotations belong to the text that was just replaced. */
        setBlame((now) => (now !== null && now.side === 'result' ? null : now))
        setDirty(true)
        setNote('')
        bumpHistory((value) => value + 1)
      }
      const pushHistory = () => {
        typingOpenRef.current = false
        undoRef.current.push(snapshot())
        if (undoRef.current.length > 80) undoRef.current.shift()
        redoRef.current = []
        bumpHistory((value) => value + 1)
      }
      const undo = () => {
        const previous = undoRef.current.pop()
        if (previous === undefined) return
        redoRef.current.push(snapshot())
        restore(previous)
      }
      const redo = () => {
        const next = redoRef.current.pop()
        if (next === undefined) return
        undoRef.current.push(snapshot())
        restore(next)
      }

      /* Annotations of the result text follow its line numbers: a new result
         text makes them stale, so they go. The side panes do not move. */
      const dropResultBlame = () => {
        setBlame((now) => (now !== null && now.side === 'result' ? null : now))
      }
      /* Typing lands in the same undo stack as a block pick, grouped so one
         Ctrl+Z does not walk back one character at a time. The snapshot pushed
         on the first keystroke of a group holds the text before it. */
      const editText = (next) => {
        const now = Date.now()
        if (typingOpenRef.current !== true || now - typingRef.current > 800) pushHistory()
        typingOpenRef.current = true
        typingRef.current = now
        setText(next)
        setDirty(true)
        dropResultBlame()
      }

      /* The three panes follow each other on BOTH axes (v0.3.1): a wheel or a
         drag in one moves all three, so the same block and the same column stay
         on screen. Left and right panes scroll horizontally on their own, the
         result textarea does too; syncing scrollLeft keeps the columns lined up
         when a long line is read. */
      const syncScroll = (source) => {
        const from = source.current
        if (from === null) return
        const now = Date.now()
        if (now < syncLockRef.current) return
        syncLockRef.current = now + 80
        for (const other of [leftRef, midRef, rightRef]) {
          if (other === source || other.current === null) continue
          if (Math.abs(other.current.scrollTop - from.scrollTop) > 1) other.current.scrollTop = from.scrollTop
          if (Math.abs(other.current.scrollLeft - from.scrollLeft) > 1) other.current.scrollLeft = from.scrollLeft
        }
        syncGutter()
      }
      /* The result editor scrolls inside itself; its number gutter is a plain
         column beside it and must follow the same offset. */
      const syncGutter = () => {
        const area = midRef.current
        const gutter = midGutterRef.current
        if (area === null || gutter === null) return
        if (Math.abs(gutter.scrollTop - area.scrollTop) > 1) gutter.scrollTop = area.scrollTop
      }
      const scrollToRows = (leftRow, resultRow, rightRow) => {
        const line = CONFLICT_LINE_HEIGHT
        for (const [ref, row] of [[leftRef, leftRow], [midRef, resultRow], [rightRef, rightRow]]) {
          if (ref.current === null || row === undefined) continue
          ref.current.scrollTop = Math.max(0, row * line - Math.round(ref.current.clientHeight / 3))
        }
        syncGutter()
      }
      const scrollToBlock = (index) => {
        if (model === null) return
        let leftRow = 0
        let rightRow = 0
        for (let at = 0; at < index; at++) {
          leftRow += model.blocks[at].ours.length
          rightRow += model.blocks[at].theirs.length
        }
        scrollToRows(leftRow, conflictResultRowsBefore(model, auto, decisions, index), rightRow)
      }
      const jump = (step) => {
        if (conflictBlocks.length === 0) return
        const list = unresolved.length > 0 ? unresolved : conflictBlocks
        const at = list.indexOf(active)
        const next = at < 0
          ? (step > 0 ? list[0] : list[list.length - 1])
          : list[(at + step + list.length) % list.length]
        setActive(next)
        scrollToBlock(next)
      }
      /* One button on one side of one conflict: keep that side's text in the
         result, or drop it. Once either verb runs the block's two buttons go
         away, so a block never wears a button it can no longer use. */
      const decide = (index, side, action) => {
        if (model === null) return
        pushHistory()
        dropResultBlame()
        const next = Object.assign({}, decisions)
        const block = Object.assign({}, undefined === next[index] ? {} : next[index])
        block[side] = action
        next[index] = block
        const regenerated = text !== conflictResultText(model, auto, decisions)
        setDecisions(next)
        setText(conflictResultText(model, auto, next))
        setDirty(true)
        setActive(index)
        setNote((action === 'adopt' ? t('conflict.blockApplied') : t('conflict.blockDropped'))
          + (regenerated === true ? ' \u00b7 ' + t('conflict.regenerated') : ''))
        const all = conflictBlocks.every((at) => conflictSettled(next, at))
        if (all === true) toastCenter.push({ text: t('conflict.allApplied'), tone: 'ok', icon: 'check' })
      }
      /* The toolbar verbs: keep one side's non-conflicting changes, drop the
         other side's, or keep both. Open conflicts keep their own buttons. */
      const applyNonConflicting = (nextAuto) => {
        if (model === null) { setNote(t('conflict.noModel')); return }
        pushHistory()
        dropResultBlame()
        const regenerated = text !== conflictResultText(model, auto, decisions)
        setAuto(nextAuto)
        setText(conflictResultText(model, nextAuto, decisions))
        setActive(-1)
        setDirty(true)
        setNote((nextAuto === 'ours' ? t('conflict.appliedOurs') : nextAuto === 'theirs' ? t('conflict.appliedTheirs') : t('conflict.appliedBoth'))
          + (regenerated === true ? ' \u00b7 ' + t('conflict.regenerated') : ''))
      }
      const adoptFile = (side) => {
        if (detail === null) return
        const sideText = side === 'ours' ? detail.ours : detail.theirs
        if (typeof sideText !== 'string') { setNote(t('conflict.sideMissing')); return }
        pushHistory()
        dropResultBlame()
        setText(conflictToLf(sideText))
        setDirty(true)
        setNote(t('conflict.adoptedFile'))
      }
      /* The gutter menu: annotate a pane with the commit that last touched each
         of its lines, or take the annotations away again. */
      const openMenu = (event, side) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ x: event.clientX, y: event.clientY, side: side })
      }
      const toggleBlame = async (side) => {
        setMenu(null)
        if (blame !== null && blame.side === side) { setBlame(null); return }
        try {
          const result = await request('conflictBlame', Object.assign({}, base, {
            path: entry.path,
            side: side,
            text: side === 'result' ? text : undefined,
          }))
          setBlame({ side: side, lines: result.lines === undefined ? [] : result.lines })
        } catch (caught) {
          fail(caught)
        }
      }
      const save = async () => {
        if (detail === null || busy === true) return false
        setBusy(true)
        try {
          const result = await request('conflictSave', Object.assign({}, base, { path: entry.path, text: text, expectSha1: detail.sha1 }))
          setDirty(false)
          setDetail((now) => (now === null ? now : Object.assign({}, now, { sha1: result.sha1, hasMarkers: result.hasMarkers, working: text })))
          setNote(result.hasMarkers === true ? t('conflict.savedMarkers') : t('conflict.saved'))
          return true
        } catch (caught) {
          fail(caught)
          return false
        } finally {
          setBusy(false)
        }
      }
      /* Marking a file resolved stages what is on disk, so an edited result is
         written first: staging text nobody chose would be a bug. */
      const resolve = async (side) => {
        if (busy === true) return
        setBusy(true)
        try {
          if (editable === true && text !== (detail === null ? '' : conflictToLf(detail.working))) {
            await request('conflictSave', Object.assign({}, base, { path: entry.path, text: text, expectSha1: detail.sha1 }))
            setDirty(false)
          }
          const result = await request('conflictResolve', Object.assign({}, base, { path: entry.path, side: side }))
          toastCenter.push({
            text: result.removed === true ? t('conflict.resolvedRemoved') : t('conflict.resolved'),
            tone: 'ok',
            icon: 'check',
          })
          props.onClose()
        } catch (caught) {
          fail(caught)
        } finally {
          setBusy(false)
        }
      }

      /* Esc closes a clean card only; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (Ctrl+Y
         too) undo and redo a block pick, a toolbar verb or a side adoption. The
         result editor keeps its own native history: the handler steps aside. */
      useEffect(() => {
        const onKey = (event) => {
          const tag = event.target === null || event.target === undefined ? '' : event.target.tagName
          const inResult = midRef.current !== null && event.target === midRef.current
          if (tag === 'TEXTAREA' || tag === 'INPUT') {
            /* The result editor shares the card's undo stack: Ctrl+Z must walk
               back a block pick, which native undo cannot see. */
            if (inResult !== true || event.key === 'Escape') return
          }
          if (event.key === 'Escape') {
            if (dirty !== true) props.onClose()
            return
          }
          if (event.ctrlKey !== true && event.metaKey !== true) return
          const key = String(event.key).toLowerCase()
          if (key === 'z') {
            event.preventDefault()
            if (event.shiftKey === true) redo(); else undo()
          } else if (key === 'y') {
            event.preventDefault()
            redo()
          }
        }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [dirty, props.onClose, auto, decisions, text])

      /* A click anywhere but the menu closes it. */
      useEffect(() => {
        if (menu === null) return undefined
        const onDown = (event) => {
          if (menuRef.current !== null && menuRef.current.contains(event.target)) return
          setMenu(null)
        }
        const onKey = (event) => { if (event.key === 'Escape') setMenu(null) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [menu])

      const readOnlyNote = detail === null
        ? t('diff.loading')
        : detail.binary === true ? t('conflict.binary')
          : detail.editable === false ? t('conflict.tooLarge')
            : ''
      const eyebrow = detail === null
        ? ''
        : t('conflict.eolLabel') + ' ' + (detail.eol === 'crlf' ? 'CRLF' : 'LF')
          + ' · ' + String(detail.size) + ' B'
          + (unresolved.length > 0 ? ' · ' + fill(t('conflict.unresolvedBlocks'), { n: String(unresolved.length) }) : '')

      const railButton = (block, side, action) => {
        const adopt = action === 'adopt'
        const label = adopt
          ? (side === 'ours' ? t('conflict.blockOurs') : t('conflict.blockTheirs'))
          : t('conflict.blockDrop')
        const icon = adopt ? (side === 'ours' ? 'chevronRight' : 'chevronLeft') : 'close'
        return E('button', {
          type: 'button',
          className: 'git4idea-conflict-mark'
            + (adopt ? (side === 'ours' ? ' git4idea-conflict-mark-ours' : ' git4idea-conflict-mark-theirs') : ' git4idea-conflict-mark-drop'),
          'data-tip': label,
          'aria-label': label,
          onMouseDown: (event) => { event.preventDefault() },
          onClick: (event) => { event.stopPropagation(); decide(block, side, action) },
        }, E(Icon, { name: icon, size: 9 }))
      }
      /* The buttons sit on the block's first line, on the edge that faces the
         result column: the side tells them apart, and one decision hides both. */
      const paneActions = (row, side) => {
        if (row.first !== true || row.conflict !== true) return null
        const decision = decisions[row.block]
        if (decision !== undefined && decision[side] !== undefined) return null
        const buttons = side === 'ours'
          ? [railButton(row.block, side, 'discard'), railButton(row.block, side, 'adopt')]
          : [railButton(row.block, side, 'adopt'), railButton(row.block, side, 'discard')]
        return E('span', { key: 'acts', className: 'git4idea-conflict-acts is-' + (side === 'ours' ? 'right' : 'left') }, buttons)
      }
      /* The hover detail of one annotation: the commit, the author with the
         full e-mail address, the timestamp and the subject — the IDE tooltip
         (m01756). The column itself shows only the short name. */
      const blameTip = (line) => {
        const rows = [
          t('conflict.blameCommit') + ': ' + (line.uncommitted === true ? t('conflict.blameNone') : line.short),
          t('conflict.blameAuthor') + ': ' + line.author + (line.email === '' ? '' : ' <' + line.email + '>'),
          t('conflict.blameDate') + ': ' + (line.uncommitted === true ? t('conflict.blameToday') : line.stamp),
        ]
        if (line.subject !== '') rows.push('', line.subject)
        return rows.join('\n')
      }
      /* Annotation cells of one pane line: the date and the author of the
         commit that last touched it. The side panes keep them on the outer
         edge, away from the buttons. */
      const blameCells = (side, column) => {
        if (blame === null || blame.side !== side) return []
        const line = blame.lines[column]
        if (line === undefined || line === null) return []
        return [
          E('span', { key: 'date', className: 'git4idea-conflict-blame' },
            line.uncommitted === true ? t('conflict.blameToday') : line.date),
          E('span', {
            key: 'author', className: 'git4idea-conflict-blame is-author',
            'data-tip': blameTip(line),
          }, shortAuthorName(line.author)),
        ]
      }
      /* The line numbers sit on the edge that faces the result column: right
         for the left pane, left for the right pane. */
      const paneRow = (row, side) => {
        const acts = paneActions(row, side)
        /* The annotation sits beside the line number, on the side facing the
           result column. A row that wears the adopt/discard pair has no space
           there, so it shows no annotation. */
        const annotated = acts === null ? blameCells(side, row.num - 1) : []
        const cells = side === 'ours'
          ? [].concat([
            E('span', { key: 'code', className: 'git4idea-conflict-code' }, row.text === '' ? CONFLICT_BLANK : row.text),
          ], annotated, [
            E('span', { key: 'num', className: 'git4idea-conflict-num' }, String(row.num)),
          ])
          : [
            E('span', { key: 'num', className: 'git4idea-conflict-num' }, String(row.num)),
          ].concat(annotated, [
            E('span', { key: 'code', className: 'git4idea-conflict-code' }, row.text === '' ? CONFLICT_BLANK : row.text),
          ])
        if (acts !== null) cells.push(acts)
        return E('div', {
          key: side + ':' + row.block + ':' + row.num,
          className: 'git4idea-conflict-row'
            + (row.changed === true ? ' is-' + (side === 'ours' ? 'ours' : 'theirs') : '')
            + (row.conflict === true ? ' is-conflict' : ''),
        }, cells)
      }

      const heads = E('div', { className: 'git4idea-conflict-heads' },
        E('span', { className: 'git4idea-conflict-head' }, t('conflict.paneOurs')),
        E('span', { className: 'git4idea-conflict-head is-mid' },
          E('span', {}, t('conflict.paneResult')),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('span', { className: 'git4idea-conflict-dim' }, eyebrow)),
        E('span', { className: 'git4idea-conflict-head' }, t('conflict.paneTheirs')))

      /* The result gutter: one number per result line, plus annotations when
         the user asked for them. It is not part of the textarea, so it follows
         the editor's scrollTop by hand. */
      const resultLineCount = text === '' ? 1 : text.split(CONFLICT_LF).length
      const gutterRow = (index) => {
        const cells = [E('span', { key: 'num', className: 'git4idea-conflict-num' }, String(index + 1))]
        const line = blame !== null && blame.side === 'result' ? blame.lines[index] : null
        if (line !== null && line !== undefined) {
          cells.push(E('span', { key: 'date', className: 'git4idea-conflict-blame' },
            line.uncommitted === true ? t('conflict.blameToday') : line.date))
          cells.push(E('span', {
            key: 'author', className: 'git4idea-conflict-blame is-author',
            'data-tip': blameTip(line),
          }, shortAuthorName(line.author)))
        }
        return E('div', { key: index, className: 'git4idea-conflict-gutter-row' }, cells)
      }
      const gutterRows = []
      for (let index = 0; index < resultLineCount; index++) gutterRows.push(gutterRow(index))

      const panes = model === null ? null : E('div', { className: 'git4idea-conflict-cols' },
        E('div', {
          ref: leftRef, className: 'git4idea-conflict-pane is-left',
          onScroll: () => { syncScroll(leftRef) },
          onContextMenu: (event) => { openMenu(event, 'ours') },
        }, leftRows.map((row) => paneRow(row, 'ours'))),
        E('div', { className: 'git4idea-conflict-mid' },
          E('div', {
            ref: midGutterRef, className: 'git4idea-conflict-gutter',
            onContextMenu: (event) => { openMenu(event, 'result') },
          }, gutterRows),
          E('textarea', {
            ref: midRef,
            className: 'git4idea-conflict-result',
            spellCheck: false,
            wrap: 'off',
            'aria-label': t('conflict.paneResult'),
            value: text,
            onChange: (event) => { editText(event.target.value) },
            onScroll: () => { syncScroll(midRef); syncGutter() },
          })),
        E('div', {
          ref: rightRef, className: 'git4idea-conflict-pane is-right',
          onScroll: () => { syncScroll(rightRef) },
          onContextMenu: (event) => { openMenu(event, 'theirs') },
        }, rightRows.map((row) => paneRow(row, 'theirs'))))

      const applyButton = (nextAuto, icons, labelKey, hintKey) => E('button', {
        type: 'button',
        className: 'git4idea-btn git4idea-btn-small' + (auto === nextAuto ? ' is-on' : ''),
        disabled: model === null,
        'data-tip': t(hintKey),
        onClick: () => { applyNonConflicting(nextAuto) },
      }, icons.map((name, index) => E(Icon, { key: index, name: name, size: 10 })), t(labelKey))

      return E('div', {
        className: 'git4idea-commit-overlay git4idea-conflict-overlay',
        'data-git4idea-conflict-dialog': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget && dirty !== true) props.onClose() },
      }, E('div', { className: 'git4idea-conflict-card' },
        E('div', { className: 'git4idea-commit-layer-head' },
          E(Icon, { name: 'compare', size: 14 }),
          E('span', { className: 'git4idea-commit-layer-title' }, t('conflict.title')),
          E('span', { className: 'git4idea-conflict-path git4idea-mono', 'data-tip': entry.path }, entry.path),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn', 'aria-label': t('toast.close'), 'data-tip': t('toast.close'),
            onClick: () => { props.onClose() },
          }, E(Icon, { name: 'close', size: 13 }))),
        E('div', { className: 'git4idea-conflict-toolbar' },
          E('span', { className: 'git4idea-conflict-toolbar-label' }, t('conflict.applyLabel')),
          applyButton('ours', ['chevronRight'], 'conflict.applyLeft', 'conflict.applyLeftHint'),
          applyButton('both', ['chevronRight', 'chevronLeft'], 'conflict.applyBoth', 'conflict.applyBothHint'),
          applyButton('theirs', ['chevronLeft'], 'conflict.applyRight', 'conflict.applyRightHint'),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small',
            disabled: undoRef.current.length === 0, 'data-tip': t('conflict.undo'), 'aria-label': t('conflict.undo'),
            onClick: undo,
          }, E(Icon, { name: 'undo', size: 12 })),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small',
            disabled: redoRef.current.length === 0, 'data-tip': t('conflict.redo'), 'aria-label': t('conflict.redo'),
            onClick: redo,
          }, E('span', { className: 'git4idea-conflict-flip' }, E(Icon, { name: 'undo', size: 12 }))),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', {
            type: 'button', className: 'git4idea-btn git4idea-btn-small', disabled: model === null,
            'data-tip': t('conflict.prev'), onClick: () => { jump(-1) },
          }, E(Icon, { name: 'up', size: 11 }), t('conflict.prev')),
          E('button', {
            type: 'button', className: 'git4idea-btn git4idea-btn-small', disabled: model === null,
            'data-tip': t('conflict.next'), onClick: () => { jump(1) },
          }, E(Icon, { name: 'down', size: 11 }), t('conflict.next'))),
        editable !== true
          ? E('div', { className: 'git4idea-conflict-body' }, E('div', { className: 'git4idea-conflict-void' }, E('p', {}, readOnlyNote)))
          : model === null
            ? E('div', { className: 'git4idea-conflict-body is-text' },
                E('textarea', {
                  ref: midRef,
                  className: 'git4idea-conflict-editor',
                  spellCheck: false,
                  'aria-label': entry.path,
                  value: text,
                  onChange: (event) => { editText(event.target.value) },
                }))
            : E('div', { className: 'git4idea-conflict-body' }, heads, panes),
        E('div', { className: 'git4idea-push-foot' },
          E('span', { className: 'git4idea-push-footnote' }, note !== '' ? note : (editable === true && model === null ? t('conflict.noBase') : t('conflict.hint'))),
          E('span', { className: 'git4idea-topbar-spacer' }),
          /* Without a model (binary, oversize) the whole-file buttons must act
             on the index directly: adopting text nobody can save would strand
             the user on a disabled Save button. */
          E('button', { type: 'button', className: 'git4idea-btn', disabled: busy === true, onClick: () => { if (editable === true) adoptFile('ours'); else void resolve('ours') } }, t('conflict.takeOursFile')),
          E('button', { type: 'button', className: 'git4idea-btn', disabled: busy === true, onClick: () => { if (editable === true) adoptFile('theirs'); else void resolve('theirs') } }, t('conflict.takeTheirsFile')),
          E('button', { type: 'button', className: 'git4idea-btn', disabled: busy === true || editable !== true || dirty !== true, onClick: () => { void save() } }, t('conflict.save')),
          E('button', {
            type: 'button', className: 'git4idea-btn git4idea-btn-primary',
            disabled: busy === true || editable !== true,
            onClick: () => { void resolve('worktree') },
          }, t('conflict.markResolved'))),
        menu === null ? null : E('div', {
          ref: menuRef,
          className: 'git4idea-conflict-menu',
          role: 'menu',
          style: { left: String(menu.x) + 'px', top: String(menu.y) + 'px' },
        }, E('button', {
          type: 'button',
          className: 'git4idea-conflict-menu-item',
          role: 'menuitem',
          onClick: () => { void toggleBlame(menu.side) },
        }, E(Icon, { name: 'compare', size: 11 }),
          E('span', {}, blame !== null && blame.side === menu.side ? t('conflict.annotateHide') : t('conflict.annotate')))),
      ))
    }

    /* One overview card at a time, raised from the operation chip and the
       composer pill: the unresolved files, one accept button per side, and the
       verb that ends the operation. It polls the summary itself, so a file
       resolved in the editor card above it leaves the list without a callback. */
    const conflictOverviewDialog = {
      entry: null,
      hosted: false,
      listeners: new Set(),
      set(entry) {
        conflictOverviewDialog.entry = entry
        for (const listener of conflictOverviewDialog.listeners) {
          try { listener() } catch (error) { void error }
        }
      },
      subscribe(listener) {
        conflictOverviewDialog.listeners.add(listener)
        return () => { conflictOverviewDialog.listeners.delete(listener) }
      },
    }

    const CONFLICT_OVERVIEW_POLL_MS = 2000

    /* The operation in one verb phrase: a merge names the ref it brings in, the
       other operations name only themselves. */
    function conflictOperationLine(t, summary) {
      if (summary === null || summary.operation === undefined || summary.operation === null) return ''
      const operation = summary.operation
      const source = summary.operationSource === undefined ? null : summary.operationSource
      const target = typeof summary.branch === 'string' && summary.branch !== '' ? summary.branch : ''
      if (operation === 'merge' && source !== null && target !== '') return fill(t('conflict.mergingInto'), { source: source, target: target })
      const label = t('operation.' + operation)
      return target === '' ? label : label + ' · ' + target
    }

    /* The two side labels of the overview: with a named ref they read like the
       IDE ("your changes (target)"), without one they stay generic. */
    function conflictSideLabel(t, key, plainKey, name) {
      return name === '' ? t(plainKey) : fill(t(key), { name: name })
    }

    function ConflictOverviewBody(props) {
      const t = props.t
      const entry = props.entry
      const base = { cwd: entry.cwd, repoRoot: entry.repoRoot }
      const [summary, setSummary] = useState(null)
      const [selected, setSelected] = useState('')
      const [busy, setBusy] = useState('')
      const [note, setNote] = useState('')
      const fail = (caught) => {
        const message = caught instanceof Error ? caught.message : String(caught)
        setNote(message)
        toastCenter.push({ text: message, tone: 'error', icon: 'close' })
      }

      /* 2 s is enough to follow the editor card and the panel: every accept
         already reloads, this tick only catches the other surfaces. */
      const load = useCallback(async () => {
        const next = await request('summary', Object.assign({}, base, { stats: false }))
        setSummary(next)
      }, [entry.cwd, entry.repoRoot])

      useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            await load()
          } catch (caught) { if (alive === true) fail(caught) }
        }
        setSummary(null)
        void tick()
        const timer = setInterval(() => { void tick() }, CONFLICT_OVERVIEW_POLL_MS)
        return () => { alive = false; clearInterval(timer) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [load])

      const operation = summary === null || summary.operation === undefined ? null : summary.operation
      const conflicts = summary === null || summary.changes === undefined ? [] : summary.changes.conflicted
      const source = summary === null || summary.operationSource === undefined || summary.operationSource === null ? '' : summary.operationSource
      const target = summary === null || typeof summary.branch !== 'string' ? '' : summary.branch
      const oursLabel = conflictSideLabel(t, 'conflict.oursSide', 'conflict.oursPlain', target)
      const theirsLabel = source === '' ? t('conflict.theirsPlain') : fill(t('conflict.theirsSide'), { name: source })

      /* The selection is a path, not a row: the poll rebuilds the entries. */
      useEffect(() => {
        if (conflicts.length === 0) { if (selected !== '') setSelected(''); return }
        if (conflicts.some((item) => item.path === selected)) return
        setSelected(conflicts[0].path)
      }, [summary])

      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape' && busy === '') props.onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [busy, props.onClose])

      const openEditor = (filePath) => {
        if (conflictDialog.hosted !== true) return
        conflictDialog.set({ path: filePath, cwd: entry.cwd, repoRoot: entry.repoRoot, sessionId: entry.sessionId })
      }

      const accept = async (filePath, side) => {
        if (busy !== '') return
        setBusy(filePath + ':' + side)
        setNote('')
        try {
          await request('conflictResolve', Object.assign({}, base, { path: filePath, side: side }))
          await load()
        } catch (caught) {
          fail(caught)
        } finally {
          setBusy('')
        }
      }

      const finish = async () => {
        if (busy !== '' || operation === null || conflicts.length > 0) return
        setBusy('finish')
        setNote('')
        try {
          await request('operationFinish', Object.assign({}, base, { operation: operation, action: 'continue' }))
          toastCenter.push({ text: t('toast.operationFinished'), tone: 'ok', icon: 'check' })
          /* The panel lives in another React tree: tell it the operation ended
             so its own summary drops the chip without waiting for a poll. */
          notifyBranchSwitched(entry.sessionId, entry.repoRoot)
          props.onClose()
        } catch (caught) {
          fail(caught)
        } finally {
          setBusy('')
        }
      }

      const subtitle = conflictOperationLine(t, summary)
      const pending = conflicts.length
      return E('div', {
        className: 'git4idea-commit-overlay git4idea-conflict-overview-overlay',
        'data-git4idea-conflict-overview': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget && busy === '') props.onClose() },
      }, E('div', { className: 'git4idea-push-card git4idea-conflict-overview-card' },
        E('div', { className: 'git4idea-commit-layer-head' },
          E(Icon, { name: 'warning', size: 14 }),
          E('span', { className: 'git4idea-commit-layer-title' }, t('conflict.overviewTitle')),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn', 'aria-label': t('conflict.close'), 'data-tip': t('conflict.close'),
            onClick: () => { if (busy === '') props.onClose() },
          }, E(Icon, { name: 'close', size: 13 }))),
        E('div', { className: 'git4idea-conflict-overview-body' },
          subtitle === '' ? null : E('div', { className: 'git4idea-conflict-overview-sub' }, subtitle),
          E('div', { className: 'git4idea-conflict-overview-head' },
            E('span', { className: 'git4idea-conflict-overview-file-col' }, pending === 0 ? t('conflict.allResolved') : fill(t('conflict.fileCount'), { n: String(pending) })),
            E('span', { className: 'git4idea-conflict-overview-side' }, oursLabel),
            E('span', { className: 'git4idea-conflict-overview-side' }, theirsLabel)),
          pending === 0
            ? E('div', { className: 'git4idea-conflict-void' }, E('p', {}, operation === null ? t('conflict.noOperation') : t('conflict.allResolved')))
            : E('div', { className: 'git4idea-conflict-overview-list' }, conflicts.map((item) => E('div', {
                key: item.path,
                className: 'git4idea-row git4idea-conflict-overview-row' + (item.path === selected ? ' is-selected' : ''),
                tabIndex: 0,
                onClick: () => { setSelected(item.path) },
                onDoubleClick: () => { openEditor(item.path) },
                onKeyDown: (event) => { if (event.key === 'Enter') openEditor(item.path) },
              },
                E(Icon, { name: 'file', size: 12 }),
                E('span', { className: 'git4idea-conflict-overview-path git4idea-mono', 'data-tip': item.path }, item.path),
                E('button', {
                  type: 'button', className: 'git4idea-btn git4idea-btn-small git4idea-conflict-accept', 'data-tip': t('conflict.acceptHint'),
                  disabled: busy !== '',
                  onClick: (event) => { event.stopPropagation(); void accept(item.path, 'ours') },
                }, E(Icon, { name: 'check', size: 11 }), t('conflict.accept')),
                E('button', {
                  type: 'button', className: 'git4idea-btn git4idea-btn-small git4idea-conflict-accept', 'data-tip': t('conflict.acceptHint'),
                  disabled: busy !== '',
                  onClick: (event) => { event.stopPropagation(); void accept(item.path, 'theirs') },
                }, E(Icon, { name: 'check', size: 11 }), t('conflict.accept'))))),
        E('div', { className: 'git4idea-push-foot' },
          E('span', { className: 'git4idea-push-footnote' }, note !== '' ? note : t('conflict.overviewHint')),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', { type: 'button', className: 'git4idea-btn', disabled: busy !== '', onClick: () => { props.onClose() } }, t('conflict.close')),
          E('button', {
            type: 'button', className: 'git4idea-btn', disabled: busy !== '' || pending === 0,
            onClick: () => { openEditor(selected) },
          }, t('conflict.manualResolve')),
          E('button', {
            type: 'button', className: 'git4idea-btn git4idea-btn-primary',
            disabled: busy !== '' || pending !== 0 || operation === null,
            'data-tip': t('conflict.finishHint'),
            onClick: () => { void finish() },
          }, t('conflict.finish')))),
      ))
    }
