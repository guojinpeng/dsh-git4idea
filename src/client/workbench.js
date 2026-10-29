/**
 * dsh-git4idea — client / workbench (log · console · worktree tabs).
 *
 * The detail column used to show only the picked commit. It now carries the
 * three IDEA tool-window tabs: the commit log (unchanged), the console (the
 * host's console.log, one block per git run, Beijing time), and the worktree
 * list. All three read through the same request() fence as the rest of the
 * panel; the console refreshes only after a git run, never on a timer.
 */

/* Paths arrive from the host already normalized for the running platform.
   The client only needs three tiny string helpers: parent, base name and a
   join that keeps the separator the host used. */
function worktreeParent(value) {
  if (typeof value !== 'string' || value === '') return ''
  const norm = value.replace(/[\\/]+$/, '')
  const cut = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return cut <= 0 ? norm : norm.slice(0, cut)
}

function worktreeBaseName(value) {
  if (typeof value !== 'string' || value === '') return ''
  const norm = value.replace(/[\\/]+$/, '')
  const cut = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return cut < 0 ? norm : norm.slice(cut + 1)
}

function worktreeJoin(dir, name) {
  const left = String(dir).replace(/[\\/]+$/, '')
  if (left === '') return name
  const sep = left.indexOf('\\') >= 0 && left.indexOf('/') < 0 ? '\\' : '/'
  return left + sep + name
}

function worktreeDefaultName(root, branch) {
  const project = worktreeBaseName(root)
  const suffix = typeof branch === 'string' && branch !== '' ? '-' + branch.replace(/[\\/:*?"<>|\s]+/g, '-') : ''
  return project + suffix
}

/* Console lines are the host's blocks: a header line with the timestamp and
   the command, then the output. Only the last 2000 lines are painted — the
   file tail is 256 KiB and a full repaint of it every run costs more than the
   view is worth. */
const CONSOLE_LINE_MAX = 2000

function consoleLineClass(line) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}: \[/.test(line)) {
    return /\[(timeout|spawn-error|\-?\d+)\]$/.test(line) ? 'git4idea-console-line git4idea-console-cmd git4idea-console-bad' : 'git4idea-console-line git4idea-console-cmd'
  }
  if (/^(fatal|error|warning|hint):/i.test(line)) return 'git4idea-console-line git4idea-console-bad'
  return 'git4idea-console-line'
}

function WorktreeDialog(props) {
  const t = props.t
  const local = props.branches === null || props.branches === undefined ? [] : props.branches.local
  const fallback = props.branch === undefined ? '' : props.branch
  // IDEA preselects the branch the panel is on; a detached HEAD falls back to
  // the first local branch.
  const known = local.some((entry) => entry.name === fallback)
  const first = known === true ? fallback : (local.length > 0 ? local[0].name : fallback)
  const [base, setBase] = useState(first)
  const [create, setCreate] = useState(false)
  const [branch, setBranch] = useState('')
  const [name, setName] = useState(() => worktreeDefaultName(props.repoRoot, first))
  const [dir, setDir] = useState(() => worktreeParent(props.repoRoot))
  const [nameTouched, setNameTouched] = useState(false)
  const [dirPrompt, setDirPrompt] = useState(false)
  const target = name.trim() === '' ? '' : worktreeJoin(dir.trim(), name.trim())
  const ready = name.trim() !== '' && dir.trim() !== '' && base !== '' && (create === false || branch.trim() !== '')
  const pickBase = (value) => {
    setBase(value)
    if (nameTouched === false) setName(worktreeDefaultName(props.repoRoot, value))
  }
  const onName = (value) => { setNameTouched(true); setName(value) }
  const submit = () => {
    if (ready === false) return
    props.onSubmit({
      path: target,
      branch: create === true ? branch.trim() : base,
      newBranch: create === true,
      base: base,
    })
  }
  const onKey = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit() }
    if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
  }
  return E('div', { className: 'git4idea-overlay' },
    E('div', { className: 'git4idea-dialog git4idea-dialog-wide git4idea-wt-dialog' },
      E('div', { className: 'git4idea-dialog-title' }, t('worktree.title')),
      E('label', { className: 'git4idea-wt-label' }, t('worktree.from')),
      E('select', {
        className: 'git4idea-input', value: base, onChange: (event) => pickBase(event.target.value),
      }, local.length === 0 ? E('option', { value: '' }, fallback) : local.map((entry) => E('option', { key: entry.name, value: entry.name }, entry.name))),
      E('label', { className: 'git4idea-wt-toggle' },
        E('input', { type: 'checkbox', checked: create, onChange: (event) => setCreate(event.target.checked) }),
        E('span', null, t('worktree.newBranch'))),
      create === false ? null : E('input', {
        className: 'git4idea-input', value: branch, spellCheck: false,
        placeholder: t('worktree.newBranchName'),
        onChange: (event) => setBranch(event.target.value), onKeyDown: onKey,
      }),
      E('label', { className: 'git4idea-wt-label' }, t('worktree.projectName')),
      E('input', {
        className: 'git4idea-input', value: name, spellCheck: false,
        onChange: (event) => onName(event.target.value), onKeyDown: onKey,
      }),
      E('label', { className: 'git4idea-wt-label' }, t('worktree.location')),
      E('div', { className: 'git4idea-wt-pathrow' },
        E('input', {
          className: 'git4idea-input', value: dir, spellCheck: false,
          onChange: (event) => setDir(event.target.value), onKeyDown: onKey,
        }),
        E('button', {
          type: 'button', className: 'git4idea-icon-btn', 'data-tip': t('worktree.pickDir'),
          onClick: () => setDirPrompt(true),
        }, E(Icon, { name: 'folder', size: 13 }))),
      E('div', { className: 'git4idea-wt-hint' }, t('worktree.target') + ' ' + (target === '' ? '—' : target)),
      E('div', { className: 'git4idea-dialog-actions' },
        E('button', { type: 'button', className: 'git4idea-btn', onClick: props.onCancel }, t('confirm.cancel')),
        E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-primary', disabled: ready === false, onClick: submit }, t('worktree.create')))),
    dirPrompt === false ? null : E(PromptDialog, {
      title: t('worktree.dirPrompt'),
      placeholder: t('worktree.dirPrompt'),
      initialValue: dir,
      okLabel: t('confirm.ok'),
      cancelLabel: t('confirm.cancel'),
      onCancel: () => setDirPrompt(false),
      onSubmit: (value) => { setDir(value); setDirPrompt(false) },
    }))
}

function Workbench(props) {
  const t = props.t
  const request = props.request
  const base = props.base
  const [tab, setTab] = useState('log')
  const [consoleText, setConsoleText] = useState('')
  const [consoleMeta, setConsoleMeta] = useState(null)
  const [consoleError, setConsoleError] = useState(null)
  const [trees, setTrees] = useState(null)
  const [treeBusy, setTreeBusy] = useState(false)
  const [treeError, setTreeError] = useState(null)
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState(null)
  const consoleRef = useRef(null)

  const loadConsole = useCallback(async () => {
    try {
      const data = await request('consoleLog', base)
      setConsoleText(typeof data.text === 'string' ? data.text : '')
      setConsoleMeta(data)
      setConsoleError(null)
    } catch (caught) {
      setConsoleError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [request, base])

  /* Refresh only when the console is on screen, and only after a git run
     (props.consoleTick moves once per completed panel action). No interval. */
  useEffect(() => {
    if (tab !== 'console') return
    void loadConsole()
  }, [tab, props.consoleTick, loadConsole, props.showTabs])

  useEffect(() => {
    const element = consoleRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [consoleText])

  const clearConsole = useCallback(async () => {
    try {
      await request('consoleClear', base)
      setConsoleText('')
      setConsoleMeta(null)
      setConsoleError(null)
    } catch (caught) {
      setConsoleError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [request, base])

  const loadTrees = useCallback(async (options) => {
    setTreeBusy(true)
    try {
      /* Only the refresh button records its `git worktree list`; the first
         open of the tab and the reread after an add/remove are bookkeeping,
         and the add/remove request is already the recorded gesture. */
      const consoleFlag = options !== undefined && options.manual === true
      const data = await request('worktreeList', consoleFlag ? Object.assign({}, base, { console: true }) : base)
      const list = Array.isArray(data.worktrees) ? data.worktrees : []
      setTrees(list)
      setSelected((current) => {
        if (list.some((tree) => tree.path === current)) return current
        const here = list.find((tree) => tree.current === true)
        return here === undefined ? (list.length === 0 ? '' : list[0].path) : here.path
      })
      setTreeError(null)
    } catch (caught) {
      setTreeError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setTreeBusy(false)
    }
  }, [request, base])

  useEffect(() => {
    if (tab !== 'worktree' || trees !== null) return
    void loadTrees()
  }, [tab, trees, loadTrees])

  /* Picking a commit is a request for the log tab: without this, a click on
     the history while the console is open would change nothing on screen. */
  useEffect(() => {
    if (typeof props.selectedHash === 'string' && props.selectedHash !== '') setTab('log')
  }, [props.selectedHash])

  /* The tabs belong to the repository on screen, so switching repositories
     starts again on the log instead of leaving the console of the old one. */
  useEffect(() => {
    setTab('log')
  }, [props.repoRoot])

  const createWorktree = useCallback(async (payload) => {
    setCreating(false)
    try {
      await request('worktreeAdd', Object.assign({}, base, payload))
      await loadTrees()
      setSelected(payload.path)
      props.notifyOk(fill(t('worktree.created'), { path: payload.path }))
    } catch (caught) {
      setTreeError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [request, base, loadTrees, props, t])

  const removeWorktree = useCallback(async (tree) => {
    setRemoving(null)
    try {
      await request('worktreeRemove', Object.assign({}, base, { path: tree.path }))
      await loadTrees()
      props.notifyOk(fill(t('worktree.removed'), { path: tree.path }))
    } catch (caught) {
      setTreeError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [request, base, loadTrees, props, t])

  const selectedTree = trees === null ? undefined : trees.find((tree) => tree.path === selected)

  const openConsoleMenu = useCallback((event) => {
    event.preventDefault()
    props.openMenuAt(event, [{
      id: 'console-clear', icon: 'trash', tone: 'danger',
      label: t('console.clear'), run: () => { void clearConsole() },
    }])
  }, [props, t, clearConsole])

  /* Without a repository the panel shows its picker or a loading state; a tab
     strip there would offer views of nothing, so the log content fills it. */
  const showTabs = props.showTabs !== false
  const active = showTabs === false ? 'log' : tab
  const hiddenStyle = (which) => (active === which ? undefined : { display: 'none' })
  const lines = consoleText === '' ? [] : consoleText.replace(/\s+$/, '').split('\n')
  const shown = lines.length > CONSOLE_LINE_MAX ? lines.slice(-CONSOLE_LINE_MAX) : lines
  const branch = props.branch === undefined || props.branch === null || props.branch === '' ? '' : props.branch

  const consolePane = E('div', { className: 'git4idea-console' },
    consoleError === null ? null : E('div', { className: 'git4idea-console-note git4idea-console-bad' }, consoleError),
    consoleMeta !== null && consoleMeta.truncated === true ? E('div', { className: 'git4idea-console-note' }, fill(t('console.truncated'), { file: consoleMeta.file })) : null,
    shown.length === 0
      ? E('div', { className: 'git4idea-empty' }, t('console.empty'))
      : E('div', { className: 'git4idea-console-body', ref: consoleRef, onContextMenu: openConsoleMenu },
        shown.map((line, index) => E('div', { key: index, className: consoleLineClass(line) }, line === '' ? ' ' : line))))

  const worktreePane = E('div', { className: 'git4idea-worktrees' },
    E('div', { className: 'git4idea-wt-rail' },
      E('button', { type: 'button', className: 'git4idea-icon-btn', 'data-action': 'worktree-new', 'data-tip': t('worktree.new'), onClick: () => setCreating(true) }, E(Icon, { name: 'plus', size: 13 })),
      E('button', {
        type: 'button', className: 'git4idea-icon-btn', 'data-action': 'worktree-remove', 'data-tip': t('worktree.remove'),
        'aria-disabled': selectedTree === undefined || selectedTree.current === true ? 'true' : 'false',
        onClick: () => { if (selectedTree !== undefined && selectedTree.current !== true) setRemoving(selectedTree) },
      }, E(Icon, { name: 'trash', size: 13 })),
      E('button', { type: 'button', className: 'git4idea-icon-btn', 'data-action': 'worktree-refresh', 'data-tip': t('worktree.refresh'), onClick: () => { void loadTrees({ manual: true }) } }, E(Icon, { name: 'refresh', size: 13 }))),
    E('div', { className: 'git4idea-wt-main' },
      treeError === null ? null : E('div', { className: 'git4idea-wt-error' }, treeError),
      trees === null
        ? E('div', { className: 'git4idea-empty' }, treeBusy === true ? t('status.loading') : t('worktree.empty'))
        : trees.length === 0
          ? E('div', { className: 'git4idea-empty' }, t('worktree.empty'))
          : E('div', { className: 'git4idea-wt-list' },
            E('div', { className: 'git4idea-wt-head' },
              E('span', null, ''),
              E('span', null, t('worktree.name')),
              E('span', null, t('worktree.branch')),
              E('span', null, t('worktree.path'))),
            trees.map((tree) => E('div', {
              key: tree.path,
              className: 'git4idea-wt-row' + (tree.path === selected ? ' git4idea-wt-row-active' : ''),
              'data-action': 'worktree-row',
              onClick: () => setSelected(tree.path),
            },
              E('span', { className: 'git4idea-wt-check' }, tree.current === true ? E(Icon, { name: 'check', size: 12 }) : null),
              E('span', { className: 'git4idea-wt-name' }, worktreeBaseName(tree.path)),
              E('span', { className: 'git4idea-wt-branch' }, tree.detached === true ? t('worktree.detached') : (tree.branch === null || tree.branch === undefined ? '' : tree.branch)),
              E('span', { className: 'git4idea-wt-path', 'data-tip': tree.path }, tree.path))))))

  return E('div', { className: 'git4idea-workbench' },
    showTabs === false ? null : E('div', { className: 'git4idea-tabs', role: 'tablist' },
      E('button', {
        type: 'button', role: 'tab', className: 'git4idea-tab', 'data-action': 'tab-log',
        'data-active': tab === 'log' ? 'true' : 'false',
        onClick: () => setTab('log'),
      }, t('tab.log') + (branch === '' ? '' : ': ' + branch)),
      E('button', {
        type: 'button', role: 'tab', className: 'git4idea-tab', 'data-action': 'tab-console',
        'data-active': tab === 'console' ? 'true' : 'false',
        onClick: () => setTab('console'),
      }, t('tab.console')),
      E('button', {
        type: 'button', role: 'tab', className: 'git4idea-tab', 'data-action': 'tab-worktree',
        'data-active': tab === 'worktree' ? 'true' : 'false',
        onClick: () => setTab('worktree'),
      }, t('tab.worktree'))),
    /* The log tab is the whole Git view (tree, history, commit detail): the
       panel passes that body as children, so the tabs sit above every column
       instead of above the detail pane alone. Every pane stays mounted and the
       inactive ones are hidden: unmounting the log would reset the pane
       measurements that the drag dividers keep in panel state. */
    E('div', { className: 'git4idea-workbench-body', style: hiddenStyle('log') }, props.children),
    E('div', { className: 'git4idea-workbench-body', style: hiddenStyle('console') }, consolePane),
    E('div', { className: 'git4idea-workbench-body', style: hiddenStyle('worktree') }, worktreePane),
    creating === true ? E(WorktreeDialog, {
      t: t, branches: props.branches, branch: branch, repoRoot: props.repoRoot,
      onCancel: () => setCreating(false), onSubmit: (payload) => { void createWorktree(payload) },
    }) : null,
    removing === null ? null : E(ConfirmDialog, {
      t: t,
      title: t('worktree.removeTitle'),
      text: fill(t('worktree.removeText'), { path: removing.path }),
      okLabel: t('worktree.remove'),
      cancelLabel: t('confirm.cancel'),
      onCancel: () => setRemoving(null),
      onConfirm: () => { void removeWorktree(removing) },
    }))
}
