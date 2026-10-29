/**
 * dsh-git4idea — client half (plain JavaScript, no build step).
 *
 * An IDE-style Git tool window in DSH's own right sidebar
 * (@deepseek-ai/dsh-client-ui-sidebar-right), plus an optional tab beside
 * 对话/轨迹 in the conversation area.
 *
 * One panel, two seats: the DSH native right sidebar (narrow, tall) and the
 * conversation-area view (wide, tall). The panel never asks which one it is in
 * — it measures its container and picks a chrome:
 *
 *   columns  wide and tall enough : repo/branch bar | tree | graph | changes
 *   stack    narrow and tall      : changes over graph, collapsible tree
 *   compact  short or very narrow : one header row + a Changes/History switch
 *
 * Theming: no hard-coded surfaces. Every surface is a --dsw-alias-* token, so
 * transparent themes and background plugins (dsh-any-background) show through,
 * exactly like the host's own panels do.
 */
window.__ModuleLoader__.load({
  id: '@guojinpeng/dsh-git4idea',
  factory: (require) => {
    const React = require('react')
    const E = React.createElement
    const Fragment = React.Fragment
    const useState = React.useState
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useRef = React.useRef
    const useCallback = React.useCallback
    const useLayoutEffect = React.useLayoutEffect
    const memo = React.memo
    /* Measure-and-derive effects run here for the layout timing (the chrome and
       the rail capacity derive from these numbers — a paint-then-correct cycle
       read as buttons lighting up one by one on every seat switch). Environments
       without a frame loop (the SSR self-check's shims) get the plain effect —
       there is no paint to sync with there, and no server warning either. */
    const useMeasureLayoutEffect = typeof requestAnimationFrame === 'function' ? useLayoutEffect : useEffect
    /* Host-rendering reuse (v0.14): the file-type glyphs and the diff block come
       from the platform seed table, so a plain require always hits — but a host
       that predates the seed entry must degrade to the hand-drawn rows instead
       of throwing at load time. Every consumer checks for null first. */
    let UIPrimitives = null
    try { UIPrimitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch (error) { void error }
    /* The shared lazy Shiki highlighter, bound once (v0.14.1): FileDiff in
       ui-deliverables rides this same hook for its line highlighting. A stable
       module-level reference keeps the LineDiff hook call unconditional. */
    const useCodeHighlighterSeed = UIPrimitives !== null && typeof UIPrimitives.useCodeHighlighter === 'function' ? UIPrimitives.useCodeHighlighter : null
    const languageForPathSeed = UIPrimitives !== null && typeof UIPrimitives.languageForPath === 'function' ? UIPrimitives.languageForPath : null

    /* API base is MOUNT-RELATIVE (no leading slash). dsh 0.1.7 serves the
       shell with <base href="./">, so document.baseURI is the mount the page
       was loaded from — the origin root, or a prefix-stripping proxy's sub-path
       (issue #4). fetch() resolves this relative path against the document
       base, so the panel's calls land on /dsh-git4idea/api at the origin root
       and on <mount>/dsh-git4idea/api under a sub-path, both matching the route
       the host half registered at its upstream path. An origin-absolute base
       would escape the mount and 404 behind any strict proxy. */
    const API_BASE = 'dsh-git4idea/api'

    /* ---- panel settings home (m04919) ----
       The host keeps the panel's settings in <home>/.dsh/guojinpeng/
       dsh-git4idea/config/settings.json, not in browser storage: a new browser,
       an update and a second machine then show the same rail, pane sizes,
       starred branches and last repository. The file is read ONCE, before the
       factory returns, with a synchronous request: the first paint already has
       the real values, so no seat flashes a default size and no star pops in
       late. A missing file, an unauthenticated proxy or a blocked browser all
       fall back to defaults — the panel keeps working, it just forgets. */
    const panelSettings = new Map()
    let panelSettingsLoaded = false
    function loadPanelSettings() {
      if (panelSettingsLoaded === true) return
      panelSettingsLoaded = true
      if (typeof XMLHttpRequest !== 'function') return
      try {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', API_BASE + '/config-get', false)
        xhr.setRequestHeader('content-type', 'application/json')
        xhr.send('{}')
        const body = JSON.parse(xhr.responseText)
        if (body === null || typeof body !== 'object' || body.ok !== true) return
        const data = body.data
        if (data === null || typeof data !== 'object') return
        const state = data.state
        if (state === null || typeof state !== 'object') return
        for (const key of Object.keys(state)) {
          if (typeof state[key] === 'string') panelSettings.set(key, state[key])
        }
      } catch (error) { void error }
    }
    function readStored(key) {
      const value = panelSettings.get(key)
      return typeof value === 'string' ? value : null
    }
    function writeStored(key, value) {
      panelSettings.set(key, value)
      /* The toggle already shows the new state, so success needs no toast; a failure must not vanish (m05310). */
      void request('config-set', { key: key, value: value }).catch((caught) => notifyFail(caught))
    }
    /* The bundle's package name: the key the Plugins page uses for a bundle's own
       page and its `plugins.bundle.config` slot. */
    /* The namespace this plugin's dictionaries are published under in the DSH
       locale registry. */
    const LOCALE_NS = 'dsh-git4idea'
    /* IDEA log metrics (platform/vcs-log/.../paint/PaintParameters.java): a
       22px row carries a 16px lane pitch, a 1.5px stem and a 4px node radius,
       and the painter scales all three by the row height it actually gets. The
       history rows here are 26px tall, so GraphCell derives its geometry from
       the height it is handed instead of hard-coding a lane width. */
    const GRAPH_ROW_UNIT = 22
    const GRAPH_NODE_WIDTH = 16
    const GRAPH_STEM = 1.5
    const GRAPH_NODE_RADIUS = 4
    /* Hard cap on the drawn lane columns. Lanes beyond the cap collapse into
       the last column: without the cap a branchy repository pushed the graph
       wider than the panel and shoved the subject column out of view. */
    const GRAPH_MAX_LANES = 7
    /* IDEA's DefaultColorGenerator seeds a hue from the lane index and then
       forces the theme's saturation/brightness; Rebased runs the log at
       0.6/0.6, the muted olive/teal/purple sequence of the IDE. */
    const LANE_COLORS = buildLaneColors()

    function buildLaneColors() {
      const colors = []
      for (let index = 0; index < 12; index += 1) {
        const r = (Math.abs((index * 200 + 30) % 100) + 70) / 255
        const g = (Math.abs((index * 130 + 50) % 100) + 70) / 255
        const b = (Math.abs((index * 90 + 100) % 100) + 70) / 255
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const delta = max - min
        let hue = 0
        if (delta > 0) {
          if (max === r) hue = ((g - b) / delta) % 6
          else if (max === g) hue = (b - r) / delta + 2
          else hue = (r - g) / delta + 4
          hue = (hue * 60 + 360) % 360
        }
        colors.push(hsbToCss(hue, 0.6, 0.6))
      }
      return colors
    }

    function hsbToCss(hue, saturation, brightness) {
      const chroma = brightness * saturation
      const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
      const m = brightness - chroma
      const sector = Math.floor(hue / 60) % 6
      const rgb = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector]
      const hex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')
      return '#' + hex(rgb[0]) + hex(rgb[1]) + hex(rgb[2])
    }
    const AUTO_REFRESH_MS = 12000
    const REPO_KEY = 'dsh-git4idea.repo.v1'
    const COMPACT_MAX_WIDTH = 400
    /* Branch rows sit one step right of their SECTION header, and each namespace
       folder adds another step. Without the base step the rows started at 8px —
       left of the section title, which reads as "no indentation at all".
       Folder headers use the same formula, so a folder's chevron lines up with the
       icon of a branch on the same level. */
    const BRANCH_INDENT_BASE = 34
    const BRANCH_INDENT_STEP = 14

    /* ============================== i18n ============================== */

    /* i18n:generated:zh — locale/zh.json is the source of truth;
       regenerate with `node src/utils/i18n.js sync`. */
    const ZH = {
      'title': 'Git',
      'description': '会话标签行中的 IDE 风格 Git 工具窗口:分支树、提交图谱、变更与提交、提交详情、差异视图、控制台和工作树。',
      'repo.label': '仓库',
      'repo.workspace': '工作区',
      'repo.nested': '子仓库',
      'repo.none': '当前工作区不是 Git 仓库',
      'repo.pick': '选择要查看的仓库',
      'repo.empty': '这个工作区下没有找到 Git 仓库',
      'repo.switch': '切换仓库',
      'branch.switch': '切换分支',
      'seg.changes': '变更 {n}',
      'seg.history': '历史',
      'branches.local': '本地',
      'branches.remote': '远程',
      'branches.tags': '标签',
      'branches.head': 'HEAD(当前分支)',
      'branches.favorites': '收藏',
      'branches.starHint': '已收藏',
      'branches.pickHint': '单击选中,双击查看提交历史',
      'branches.headHint': '双击查看当前分支的提交历史',
      'branches.worktree': '已在另一工作区检出',
      'action.stash': '贮藏',
      'action.favorite': '收藏/取消收藏当前分支',
      'action.newTagHere': '在当前提交新建标签...',
      'stash.push': '贮藏当前更改',
      'stash.apply': '应用最近贮藏',
      'stash.drop': '删除最近贮藏',
      'stash.count': '共 {n} 条贮藏',
      'note.noChanges': '没有可显示的变更',
      'note.noBranches': '没有其他分支',
      'branches.filter': '分支或标签',
      'changes.title': '变更',
      'changes.staged': '已暂存',
      'changes.unstaged': '更改',
      'changes.untracked': '未跟踪',
      'changes.conflicted': '冲突',
      'changes.empty': '没有未提交的变更',
      'changes.commitPlaceholder': '提交信息',
      'changes.commit': '提交',
      'changes.amend': '修正',
      'changes.diffHint': '选择左侧文件以预览差异',
      'changes.stageAll': '全部暂存',
      'selection.count': '已选 {n} 项',
      'selection.copied': '已复制 {n} 项',
      'selection.copyPaths': '复制路径',
      'selection.clear': '清除选择',
      'action.copyName': '复制名称',
      'menu.copyNamesN': '复制 {n} 个名称',
      'menu.copyHashesN': '复制 {n} 个哈希',
      'menu.copyPathsN': '复制 {n} 个路径',
      'menu.stageN': '暂存 {n} 项',
      'menu.unstageN': '取消暂存 {n} 项',
      'menu.discardN': '还原 {n} 项…',
      'menu.cherryN': 'Cherry-pick {n} 个提交',
      'menu.deleteLocalN': '删除 {n} 个本地分支…',
      'menu.deleteRemoteN': '删除 {n} 个远程分支…',
      'menu.deleteTagsN': '删除 {n} 个标签…',
      'confirm.deleteRefs': '删除所选引用?本地分支 {b} 个、远程分支 {r} 个、标签 {g} 个。',
      'confirm.discardMany': '还原 {n} 个文件的未提交改动?',
      'confirm.discardManyUntracked': '其中 {m} 个未跟踪文件将被彻底删除。',
      'toast.branchesDeleted': '已删除 {n} 个分支',
      'changes.unstageAll': '全部取消暂存',
      'changes.groupBy': '分组依据',
      'changes.groupFlat': '平铺',
      'changes.groupDir': '按目录',
      'changes.expandAll': '全部展开',
      'changes.foldAll': '全部折叠',
      'changes.showIgnored': '显示忽略的文件',
      'changes.rootDir': '(根目录)',
      'changes.commitAndPush': '提交并推送',
      'action.stage': '暂存',
      'action.unstage': '取消暂存',
      'action.discard': '丢弃更改',
      'action.showDiff': '显示差异',
      'action.copyPath': '复制路径',
      'action.checkout': '签出',
      'action.float': '浮动本页',
      'action.dock': '收回停靠',
      'action.split': '分栏',
      'action.fullscreen': '全屏',
      'action.exitFullscreen': '退出全屏',
      'action.newBranchFrom': '从该分支新建分支...',
      'action.setUpstream': '设置上游…',
      'action.unsetUpstream': '取消上游',
      'action.newBranchHere': '在此新建分支...',
      'action.rename': '重命名...',
      'action.delete': '删除',
      'action.mergeIntoCurrent': '合并到当前分支',
      'action.mergeInto': '将 ‘{from}’ 合并到 ‘{to}’ 中',
      'action.rebaseCurrentOnto': '将当前分支变基到此',
      'action.compare': '与当前分支比较',
      'action.update': '提取(Fetch)',
      'action.updateBranch': '更新',
      'action.push': '推送',
      'action.newTag': '新建标签...',
      'action.cherryPick': '优选(Cherry-Pick)',
      'action.revert': '还原提交',
      'action.resetSoft': '重置到此(保留更改)',
      'action.resetHard': '重置到此(丢弃更改)',
      'action.copyHash': '复制修订号',
      'action.details': '提交详情',
      'menu.sendToChat': '发送到对话',
      'send.commitText': 'git 提交 {hash}「{subject}」(仓库 {repo})',
      'send.branchText': 'git 分支 {name}(仓库 {repo})',
      'menu.sendDiffLinesToChat': '发送选中行到对话',
      'menu.sendDiffSnippetToChat': '发送选中片段到对话',
      'menu.copyDiffRef': '复制选中引用',
      'send.diffLinesCommit': '{lines}(提交 {hash}「{subject}」@ {branch})',
      'send.diffLinesWorktree': '{lines}(工作区{state})',
      'send.diffStaged': '已暂存',
      'send.diffUnstaged': '未提交',
      'send.diffNewLines': '第 {lines} 行',
      'send.diffOldLines': '第 {lines} 行(旧行号)',
      'history.empty': '这个仓库还没有提交',
      'history.loadMore': '加载更多',
      'history.filter': '文本或哈希',
      'detail.files': '变更文件',
      'detail.pick': '选择一个提交',
      'detail.back': '返回历史',
      'detail.noFiles': '没有文件变更',
      'detail.branches': '在 {n} 个分支中:',
      'detail.showAll': '全部显示',
      'detail.hide': '隐藏',
      'diff.empty': '没有可显示的文本差异',
      'pane.diff': '差异视图',
      'pane.resize': '拖动调整{name}尺寸,双击复位,方向键微调',
      'diff.binary': '二进制文件',
      'diff.loading': '正在加载差异...',
      'diff.codeLabel': '差异',
      'diff.wrapLabel': '自动换行',
      'diff.unwrapLabel': '按源列宽显示',
      'diff.copy': '复制',
      'diff.copied': '已复制',
      'toolbar.refresh': '刷新',
      'more.sort': '查看和排序',
      'more.commitGroup': '提交',
      'more.changesGroup': '更改',
      'more.pullpushGroup': '更新，推送',
      'more.branchGroup': '分支',
      'more.remoteGroup': '远程',
      'more.stashGroup': '存储',
      'more.tagGroup': '标记',
      'more.commitStaged': '提交已暂存文件...',
      'more.commitAll': '全部提交...',
      'more.undoCommit': '撤销上次提交',
      'more.rebaseAbort': '中止变基',
      'more.commitStagedAmend': '提交已暂存文件(修改)...',
      'more.commitAllAmend': '全部提交(修改)...',
      'more.commitStagedSign': '提交已暂存文件(已签收)...',
      'more.commitAllSign': '全部提交(已签收)...',
      'prompt.commitMessage': '提交信息',
      'more.discardAll': '放弃所有更改...',
      'more.sync': '同步(更新并推送)',
      'more.syncRebase': '同步(变基并推送)',
      'more.pullRebase': '更新(变基)',
      'more.pullFrom': '从远程更新',
      'more.pushForce': '推送(强制)...',
      'more.pushTo': '推送到远程',
      'more.fetchAll': '从所有远程提取',
      'more.deleteRemoteBranch': '删除远程分支...',
      'more.publish': '发布分支...',
      'more.setUpstreamHead': '设置当前分支上游…',
      'more.unsetUpstreamHead': '取消当前分支上游',
      'more.addRemote': '添加远程...',
      'more.removeRemote': '删除远程...',
      'more.stashTracked': '贮藏(仅已跟踪)',
      'more.stashStaged': '贮藏已暂存文件',
      'more.stashApplyPick': '应用贮藏...',
      'more.stashPopPick': '弹出贮藏...',
      'more.stashDropAny': '删除贮藏...',
      'more.stashClear': '删除全部贮藏...',
      'stash.none': '没有可用的贮藏',
      'more.tagDeleteRemote': '删除远程标签...',
      'more.pushTags': '推送标签...',
      'confirm.undoCommit': '撤销上次提交?提交的改动会保留在暂存区。',
      'confirm.discardAll': '放弃全部未暂存与未跟踪的更改?可通过撤回浮窗恢复(冲突文件除外)。',
      'confirm.pushForce': '强制推送会用本地分支覆盖远程(--force-with-lease,他人有新提交时会被拒绝)。继续?',
      'confirm.deleteRemoteBranch': '删除远程 {remote} 上的分支 {branch}?',
      'confirm.remoteRemove': '删除远程 {name}?其跟踪配置一并移除。',
      'confirm.stashClear': '删除全部贮藏?此操作不可撤回。',
      'confirm.pushTags': '推送全部标签到 {remote}?',
      'prompt.remoteName': '远程名称',
      'prompt.remoteUrl': '远程 URL',
      'prompt.deleteRemoteTag': '要删除的远程标签(将推送到 {remote})',
      'toolbar.more': '更多操作',
      'more.sortGit': 'Git 顺序',
      'more.sortPath': '按路径',
      'more.sortName': '按名称',
      'more.sortStatus': '按状态',
      'more.clone': '克隆...',
      'more.stashPop': '弹出最近贮藏',
      'more.deleteTag': '删除标签...',
      'tab.log': '日志',
      'tab.console': '控制台',
      'tab.worktree': '工作树',
      'console.empty': '暂无 Git 命令记录',
      'console.truncated': '只显示最近 256 KiB,更早的记录在 {file}',
      'console.clear': '全部清空日志',
      'worktree.new': '新建工作树',
      'worktree.remove': '删除工作树',
      'worktree.refresh': '刷新',
      'worktree.empty': '没有工作树',
      'worktree.detached': '游离 HEAD',
      'worktree.name': '名称',
      'worktree.branch': '分支',
      'worktree.path': '路径',
      'worktree.title': '新建工作树',
      'worktree.from': '从分支',
      'worktree.newBranch': '新建分支',
      'worktree.newBranchName': '新分支名称',
      'worktree.projectName': '项目名称',
      'worktree.location': '位置',
      'worktree.target': '工作树将在以下位置创建:',
      'worktree.create': '创建工作树',
      'worktree.created': '已创建工作树 {path}',
      'worktree.removed': '已删除工作树 {path}',
      'worktree.removeTitle': '删除工作树',
      'worktree.removeText': '删除工作树 {path}?未提交的改动会丢失。',
      'worktree.pickDir': '选择目录',
      'worktree.dirPrompt': '父目录(绝对路径)',
      'clone.title': '克隆仓库',
      'clone.url': '仓库 URL',
      'clone.dir': '目标目录(绝对路径)',
      'clone.run': '克隆',
      'prompt.deleteTag': '要删除的标签名',
      'toolbar.newBranch': '新建分支',
      'toolbar.fetch': '提取(Fetch)',
      'toolbar.pull': '更新(Pull)',
      'toolbar.pullPicked': '更新选中的 {n} 个分支',
      'toolbar.fetchPicked': '提取选中的 {n} 个引用',
      'toolbar.pushPicked': '推送选中的 {n} 个分支',
      'toolbar.checkoutPicked': '签出选中的分支',
      'toolbar.deletePicked': '删除选中的 {n} 个引用',
      'toolbar.push': '推送(Push)',
      'track.push': '推送',
      'track.pull': '更新',
      'track.commit': '提交',
      'toolbar.tree': '分支栏',
      'rail.more': '更多操作',
      'composer.branchHint': '切换分支',
      'composer.detached': 'HEAD(游离)',
      'composer.inWorktree': '已被其他工作树签出',
      'composer.busy': 'Git 操作进行中…',
      'preview.openFile': '打开文件预览',
      'lf.added': '+{count}',
      'lf.deleted': '-{count}',
      'lf.selectFile': '选择要查看的文件',
      'lf.split': '切换为左右对比',
      'lf.unified': '切换为单栏对比',
      'lf.wrap': '开启自动换行',
      'lf.nowrap': '关闭自动换行',
      'lf.created': '新建的文件',
      'lf.removedFile': '删除的文件',
      'lf.truncated': '只显示前 {count} 行',
      'preview.title': 'Git 预览',
      'preview.hint': '点击文件或提交的「显示差异」,差异会在侧边栏这里打开。',
      'preview.boundary': '预览渲染出错——请重载页面,或反馈这个问题。',
      'toast.dialogFailed': '弹窗渲染出错,已关闭,请重试。',
      'changes.aiWrite': 'AI 写提交信息',
      'changes.aiBusy': '正在生成…',
      'changes.language': '生成语言',
      'changes.langZh': '中文',
      'changes.langEn': 'English',
      'changes.aiOverwriteTitle': '覆盖当前草稿?',
      'changes.aiOverwriteText': 'AI 生成的内容会替换你已经输入的提交信息(可以撤销)。',
      'changes.aiUndo': '撤销,恢复我的草稿',
      'changes.aiFailed': '生成失败:',
      'changes.aiNotice': '部分变更没有发给模型(已截断或丢弃),信息可能不完整。',
      'action.unavailable': '当前状态不可用',
      'filter.branch': '分支',
      'filter.user': '用户',
      'history.me': '我',
      'filter.date': '日期',
      'filter.path': '路径',
      'filter.all': '全部',
      'filter.today': '今天',
      'filter.week': '最近 7 天',
      'filter.month': '最近 30 天',
      'filter.year': '今年',
      'filter.pathPlaceholder': '过滤路径(回车应用)',
      'filter.sortDesc': '新→旧',
      'filter.sortAsc': '旧→新',
      'filter.clear': '清除筛选',
      'filter.none': '没有匹配的提交',
      'toast.undo': '撤回',
      'toast.close': '关闭',
      'toast.branchDeleted': '已删除分支 {name}',
      'toast.stashDropped': '已删除贮藏 {ref}',
      'toast.discarded': '已丢弃 {path} 的更改',
      'toast.discardNoUndo': '已丢弃 {path} 的更改(文件过大或过多,未保留撤回)',
      'toast.restored': '已恢复',
      'toast.sentToChat': '已发送到对话框',
      'toast.sendCopied': '无法发送,已复制到剪贴板',
      'undo.menu': '最近可撤回的操作',
      'undo.empty': '现在没有可撤回的操作',
      'undo.branch': '分支',
      'undo.stash': '贮藏',
      'undo.discard': '丢弃',
      'confirm.typeName': '输入 {name} 以确认',
      'confirm.protected': '{name} 是主分支。删除是不可逆的高风险操作,请输入分支名确认。删除后仍可从浮窗撤回。',
      'discard.untracked.confirm': '删除未跟踪文件 {path}?文件内容会被删除,删除后浮窗里可以撤回。',
      'stashDrop.confirm': '删除贮藏 {ref}?删除后浮窗里可以撤回。',
      'operation.merge': '合并进行中',
      'operation.rebase': '变基进行中',
      'operation.cherry-pick': '优选进行中',
      'operation.revert': '还原进行中',
      'operation.bisect': '二分定位进行中',
      'operation.hint': '该仓库还有一个多步操作没有结束,先完成或中止它再执行分支级操作',
      'confirm.title': '确认操作',
      'confirm.cancel': '取消',
      'confirm.ok': '确定',
      'prompt.newBranch': '新分支名(将创建并签出)',
      'prompt.createTracking': '从远程分支创建本地分支',
      'prompt.renameBranch': '重命名分支',
      'prompt.newTag': '新标签名',
      'prompt.fromHead': '当前 HEAD',
      'status.loading': '正在读取...',
      'status.busy': '处理中...',
      'counts.staged': '已暂存 {n}',
      'counts.ignored': '忽略 {n}',
      'counts.unstaged': '更改 {n}',
      'counts.untracked': '未跟踪 {n}',
      'counts.conflicted': '冲突 {n}',
      'push.confirm': '将 {branch} 推送到 {upstream}?',
      'push.confirmMany': '将推送 {n} 个分支:{names}。确定?',
      'push.title': '将提交推送到 {branch}',
      'push.none': '没有可推送的提交',
      'push.detached': 'HEAD 处于游离状态，无法推送',
      'push.noRemote': '未配置远程仓库',
      'push.truncated': '只显示最近 {n} 个提交',
      'push.hint': '双击文件查看变更',
      'toast.committed': '提交成功',
      'toast.pushed': '已将 {n} 个提交推送到 {target}',
      'toast.branchUpdated': '已更新 {name}',
      'toast.branchPushed': '已推送 {name}',
      'delete.confirm': '删除分支 {name}?删除后浮窗里可以撤回(未合并的分支 git 会拒绝删除)。',
      'discard.confirm': '丢弃 {path} 的更改?工作区内容会被覆盖,丢弃后浮窗里可以撤回。',
      'resetHard.confirm': '硬重置到 {hash}?未提交的更改会丢失。',
      'resetSoft.confirm': '将 HEAD 重置到 {hash}(保留工作区更改)?',
      'checkoutCommit.confirm': '签出提交 {hash}?(分离头指针)',
      'toast.staged': '已暂存 {n} 个文件',
      'toast.unstaged': '已取消暂存 {n} 个文件',
      'toast.checkedOut': '已切换到 {name}',
      'toast.branchCreated': '已创建并切换到 {name}',
      'toast.branchRenamed': '已将 {from} 重命名为 {to}',
      'toast.upstreamSet': '已将 {name} 的上游设为 {upstream}',
      'toast.upstreamUnset': '已取消 {name} 的上游',
      'toast.remoteBranchDeleted': '已删除远程分支',
      'toast.tagCreated': '已创建标签 {name}',
      'toast.tagDeleted': '已删除标签 {name}',
      'toast.tagDeletedRemote': '已删除远程标签 {name}',
      'toast.tagsPushed': '已推送标签到远程',
      'toast.pushDone': '已推送',
      'toast.pullDone': '更新完成',
      'toast.fetchDone': '已从远程提取',
      'toast.merged': '已合并 {name}',
      'toast.mergedConflict': '合并停在冲突上,请解决冲突后继续',
      'toast.rebased': '已变基到 {onto}',
      'toast.rebaseAborted': '已中止变基',
      'toast.cherryPicked': '已拣选 {n} 个提交',
      'toast.reverted': '已还原提交 {hash}',
      'toast.resetSoft': '已软重置到 {hash},提交内容仍在暂存区',
      'toast.resetHard': '已硬重置到 {hash}',
      'toast.discardedN': '已丢弃 {n} 个文件的更改',
      'toast.stashed': '已把工作区改动存入贮藏',
      'toast.stashPopped': '已弹出贮藏',
      'toast.stashApplied': '已应用贮藏',
      'toast.stashCleared': '已清空贮藏列表',
      'toast.remoteAdded': '已添加远程 {name}',
      'toast.remoteRemoved': '已删除远程 {name}',
      'toast.cloned': '已克隆仓库',
    }
    /* /i18n:generated:zh */

    /* i18n:generated:en — locale/en.json is the source of truth;
       regenerate with `node src/utils/i18n.js sync`. */
    const EN = {
      'title': 'Git',
      'description': 'An IDE-style Git tool window in the conversation tab row: branch tree, commit graph, changes and commits, commit details, diffs, console, and worktrees.',
      'repo.label': 'Repository',
      'repo.workspace': 'workspace',
      'repo.nested': 'nested',
      'repo.none': 'This workspace is not a Git repository',
      'repo.pick': 'Pick a repository to inspect',
      'repo.empty': 'No Git repository found in this workspace',
      'repo.switch': 'Switch repository',
      'branch.switch': 'Switch branch',
      'seg.changes': 'Changes {n}',
      'seg.history': 'History',
      'branches.local': 'Local',
      'branches.remote': 'Remote',
      'branches.tags': 'Tags',
      'branches.head': 'HEAD (current branch)',
      'branches.favorites': 'Favorites',
      'branches.starHint': 'Favorited',
      'branches.pickHint': 'Click to select, double-click to browse its history',
      'branches.headHint': "Double-click to browse the current branch's history",
      'branches.worktree': 'Checked out in another working tree',
      'action.stash': 'Stash',
      'action.favorite': 'Favorite / unfavorite current branch',
      'action.newTagHere': 'New tag on current commit...',
      'stash.push': 'Stash current changes',
      'stash.apply': 'Apply latest stash',
      'stash.drop': 'Drop latest stash',
      'stash.count': '{n} stash entries',
      'note.noChanges': 'No pending changes',
      'note.noBranches': 'No other branches',
      'branches.filter': 'Branch or tag',
      'changes.title': 'Changes',
      'changes.staged': 'Staged',
      'changes.unstaged': 'Changes',
      'changes.untracked': 'Untracked',
      'changes.conflicted': 'Conflicts',
      'changes.empty': 'No pending changes',
      'changes.commitPlaceholder': 'Commit message',
      'changes.commit': 'Commit',
      'changes.amend': 'Amend',
      'changes.diffHint': 'Select a file to preview its diff',
      'changes.stageAll': 'Stage all',
      'selection.count': '{n} selected',
      'selection.copied': 'Copied {n} item(s)',
      'selection.copyPaths': 'Copy paths',
      'selection.clear': 'Clear selection',
      'action.copyName': 'Copy name',
      'menu.copyNamesN': 'Copy {n} names',
      'menu.copyHashesN': 'Copy {n} hashes',
      'menu.copyPathsN': 'Copy {n} paths',
      'menu.stageN': 'Stage {n} items',
      'menu.unstageN': 'Unstage {n} items',
      'menu.discardN': 'Discard {n} items…',
      'menu.cherryN': 'Cherry-pick {n} commits',
      'menu.deleteLocalN': 'Delete {n} local branches…',
      'menu.deleteRemoteN': 'Delete {n} remote branches…',
      'menu.deleteTagsN': 'Delete {n} tags…',
      'confirm.deleteRefs': 'Delete the selected refs? {b} local, {r} remote, {g} tag(s).',
      'confirm.discardMany': 'Discard uncommitted changes of {n} files?',
      'confirm.discardManyUntracked': '{m} untracked file(s) will be deleted for good.',
      'toast.branchesDeleted': '{n} branch(es) deleted',
      'changes.unstageAll': 'Unstage all',
      'changes.groupBy': 'Group by',
      'changes.groupFlat': 'Flat list',
      'changes.groupDir': 'By directory',
      'changes.expandAll': 'Expand all',
      'changes.foldAll': 'Collapse all',
      'changes.showIgnored': 'Show ignored files',
      'changes.rootDir': '(root)',
      'changes.commitAndPush': 'Commit and push',
      'action.stage': 'Stage',
      'action.unstage': 'Unstage',
      'action.discard': 'Discard changes',
      'action.showDiff': 'Show diff',
      'action.copyPath': 'Copy path',
      'action.checkout': 'Checkout',
      'action.float': 'Float this page',
      'action.dock': 'Dock back',
      'action.split': 'Split pane',
      'action.fullscreen': 'Full screen',
      'action.exitFullscreen': 'Exit full screen',
      'action.newBranchFrom': 'New branch from here...',
      'action.setUpstream': 'Set Upstream…',
      'action.unsetUpstream': 'Unset Upstream',
      'action.newBranchHere': 'New branch here...',
      'action.rename': 'Rename...',
      'action.delete': 'Delete',
      'action.mergeIntoCurrent': 'Merge into current branch',
      'action.mergeInto': 'Merge ‘{from}’ into ‘{to}’',
      'action.rebaseCurrentOnto': 'Rebase current branch onto this',
      'action.compare': 'Compare with current branch',
      'action.update': 'Fetch',
      'action.updateBranch': 'Update branch',
      'action.push': 'Push',
      'action.newTag': 'New tag...',
      'action.cherryPick': 'Cherry-pick',
      'action.revert': 'Revert commit',
      'action.resetSoft': 'Reset here (keep changes)',
      'action.resetHard': 'Reset here (discard changes)',
      'action.copyHash': 'Copy revision number',
      'action.details': 'Commit details',
      'menu.sendToChat': 'Send to chat',
      'send.commitText': 'git commit {hash} "{subject}" (repo {repo})',
      'send.branchText': 'git branch {name} (repo {repo})',
      'menu.sendDiffLinesToChat': 'Send selected lines to chat',
      'menu.sendDiffSnippetToChat': 'Send selected snippet to chat',
      'menu.copyDiffRef': 'Copy the selection reference',
      'send.diffLinesCommit': '{lines} (commit {hash} "{subject}" @ {branch})',
      'send.diffLinesWorktree': '{lines} (worktree, {state})',
      'send.diffStaged': 'staged',
      'send.diffUnstaged': 'uncommitted',
      'send.diffNewLines': 'lines {lines}',
      'send.diffOldLines': 'lines {lines} (old numbering)',
      'history.empty': 'This repository has no commits yet',
      'history.loadMore': 'Load more',
      'history.filter': 'Text or hash',
      'detail.files': 'Changed files',
      'detail.pick': 'Select a commit',
      'detail.back': 'Back to history',
      'detail.noFiles': 'No file changes',
      'detail.branches': 'In {n} branches:',
      'detail.showAll': 'Show all',
      'detail.hide': 'Hide',
      'diff.empty': 'No textual diff to show',
      'pane.diff': 'diff view',
      'pane.resize': 'Drag to resize {name}: double-click resets, arrow keys nudge',
      'diff.binary': 'Binary file',
      'diff.loading': 'Loading diff...',
      'diff.codeLabel': 'Diff',
      'diff.wrapLabel': 'Wrap lines',
      'diff.unwrapLabel': 'Keep source columns',
      'diff.copy': 'Copy',
      'diff.copied': 'Copied',
      'toolbar.refresh': 'Refresh',
      'more.sort': 'View & Sort',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Changes',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Branch',
      'more.remoteGroup': 'Remote',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Tags',
      'more.commitStaged': 'Commit Staged...',
      'more.commitAll': 'Commit All...',
      'more.undoCommit': 'Undo Last Commit',
      'more.rebaseAbort': 'Abort Rebase',
      'more.commitStagedAmend': 'Commit Staged (Amend)...',
      'more.commitAllAmend': 'Commit All (Amend)...',
      'more.commitStagedSign': 'Commit Staged (Signed Off)...',
      'more.commitAllSign': 'Commit All (Signed Off)...',
      'prompt.commitMessage': 'Commit message',
      'more.discardAll': 'Discard All Changes...',
      'more.sync': 'Sync (Pull then Push)',
      'more.syncRebase': 'Sync (Rebase then Push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Pull from Remote',
      'more.pushForce': 'Push (Force)...',
      'more.pushTo': 'Push to Remote',
      'more.fetchAll': 'Fetch from All Remotes',
      'more.deleteRemoteBranch': 'Delete Remote Branch...',
      'more.publish': 'Publish Branch...',
      'more.setUpstreamHead': 'Set Upstream for Current Branch…',
      'more.unsetUpstreamHead': 'Unset Upstream of Current Branch',
      'more.addRemote': 'Add Remote...',
      'more.removeRemote': 'Remove Remote...',
      'more.stashTracked': 'Stash (Tracked Only)',
      'more.stashStaged': 'Stash Staged',
      'more.stashApplyPick': 'Apply Stash...',
      'more.stashPopPick': 'Pop Stash...',
      'more.stashDropAny': 'Drop Stash...',
      'more.stashClear': 'Drop All Stashes...',
      'stash.none': 'No stashes available',
      'more.tagDeleteRemote': 'Delete Remote Tag...',
      'more.pushTags': 'Push Tags...',
      'confirm.undoCommit': 'Undo the last commit? Its changes stay staged.',
      'confirm.discardAll': 'Discard ALL unstaged and untracked changes? Recoverable via undo toasts (conflicted files excluded).',
      'confirm.pushForce': 'Force push overwrites the remote with this branch (--force-with-lease refuses when others pushed). Continue?',
      'confirm.deleteRemoteBranch': 'Delete branch {branch} on {remote}?',
      'confirm.remoteRemove': 'Remove remote {name}? Its tracking config goes with it.',
      'confirm.stashClear': 'Drop ALL stashes? This cannot be undone.',
      'confirm.pushTags': 'Push all tags to {remote}?',
      'prompt.remoteName': 'Remote name',
      'prompt.remoteUrl': 'Remote URL',
      'prompt.deleteRemoteTag': 'Remote tag to delete (pushed to {remote})',
      'toolbar.more': 'More actions',
      'more.sortGit': 'Git order',
      'more.sortPath': 'By path',
      'more.sortName': 'By name',
      'more.sortStatus': 'By status',
      'more.clone': 'Clone...',
      'more.stashPop': 'Pop latest stash',
      'more.deleteTag': 'Delete tag...',
      'tab.log': 'Log',
      'tab.console': 'Console',
      'tab.worktree': 'Worktrees',
      'console.empty': 'No git commands yet',
      'console.truncated': 'Showing the last 256 KiB; older records are in {file}',
      'console.clear': 'Clear all log',
      'worktree.new': 'New worktree',
      'worktree.remove': 'Remove worktree',
      'worktree.refresh': 'Refresh',
      'worktree.empty': 'No worktrees',
      'worktree.detached': 'Detached HEAD',
      'worktree.name': 'Name',
      'worktree.branch': 'Branch',
      'worktree.path': 'Path',
      'worktree.title': 'New Worktree',
      'worktree.from': 'From branch',
      'worktree.newBranch': 'New branch',
      'worktree.newBranchName': 'New branch name',
      'worktree.projectName': 'Project name',
      'worktree.location': 'Location',
      'worktree.target': 'The worktree will be created at:',
      'worktree.create': 'Create worktree',
      'worktree.created': 'Created worktree {path}',
      'worktree.removed': 'Removed worktree {path}',
      'worktree.removeTitle': 'Remove Worktree',
      'worktree.removeText': 'Remove worktree {path}? Uncommitted changes will be lost.',
      'worktree.pickDir': 'Choose directory',
      'worktree.dirPrompt': 'Parent directory (absolute path)',
      'clone.title': 'Clone repository',
      'clone.url': 'Repository URL',
      'clone.dir': 'Target directory (absolute path)',
      'clone.run': 'Clone',
      'prompt.deleteTag': 'Tag name to delete',
      'toolbar.newBranch': 'New branch',
      'toolbar.fetch': 'Fetch',
      'toolbar.pull': 'Pull',
      'toolbar.pullPicked': 'Pull {n} picked branch(es)',
      'toolbar.fetchPicked': 'Fetch {n} picked ref(s)',
      'toolbar.pushPicked': 'Push {n} picked branch(es)',
      'toolbar.checkoutPicked': 'Check out the picked branch',
      'toolbar.deletePicked': 'Delete {n} picked ref(s)',
      'toolbar.push': 'Push',
      'track.push': 'Push',
      'track.pull': 'Pull',
      'track.commit': 'Commit',
      'toolbar.tree': 'Branch pane',
      'rail.more': 'More actions',
      'composer.branchHint': 'Switch branch',
      'composer.detached': 'HEAD (detached)',
      'composer.inWorktree': 'Checked out in another worktree',
      'composer.busy': 'Git operation in progress…',
      'preview.openFile': 'Open in the file preview',
      'lf.added': '+{count}',
      'lf.deleted': '-{count}',
      'lf.selectFile': 'Choose the file to review',
      'lf.split': 'Switch to split view',
      'lf.unified': 'Switch to unified view',
      'lf.wrap': 'Enable line wrap',
      'lf.nowrap': 'Disable line wrap',
      'lf.created': 'Created file',
      'lf.removedFile': 'Deleted file',
      'lf.truncated': 'Showing the first {count} lines',
      'preview.title': 'Git Preview',
      'preview.hint': 'Click “Show diff” on a file or commit — the diff opens here in the sidebar.',
      'preview.boundary': 'The preview failed to render — reload the page, or report an issue.',
      'toast.dialogFailed': 'The dialog failed to render. Close and retry.',
      'changes.aiWrite': 'Write with AI',
      'changes.aiBusy': 'Writing…',
      'changes.language': 'Message language',
      'changes.langZh': '中文',
      'changes.langEn': 'English',
      'changes.aiOverwriteTitle': 'Replace the current draft?',
      'changes.aiOverwriteText': 'The AI text will replace the commit message you typed (you can undo it).',
      'changes.aiUndo': 'Undo, bring my draft back',
      'changes.aiFailed': 'Could not write it:',
      'changes.aiNotice': 'Some changes were not sent to the model (truncated or dropped); the message may be incomplete.',
      'action.unavailable': 'Not available in the current state',
      'filter.branch': 'Branch',
      'filter.user': 'User',
      'history.me': 'Me',
      'filter.date': 'Date',
      'filter.path': 'Path',
      'filter.all': 'All',
      'filter.today': 'Today',
      'filter.week': 'Last 7 days',
      'filter.month': 'Last 30 days',
      'filter.year': 'This year',
      'filter.pathPlaceholder': 'Filter by path (Enter)',
      'filter.sortDesc': 'Newest first',
      'filter.sortAsc': 'Oldest first',
      'filter.clear': 'Clear filters',
      'filter.none': 'No matching commits',
      'toast.undo': 'Undo',
      'toast.close': 'Close',
      'toast.branchDeleted': 'Deleted branch {name}',
      'toast.stashDropped': 'Dropped stash {ref}',
      'toast.discarded': 'Discarded changes in {path}',
      'toast.discardNoUndo': 'Discarded changes in {path} (too large to keep an undo)',
      'toast.restored': 'Restored',
      'toast.sentToChat': 'Sent to the chat box',
      'toast.sendCopied': 'Could not send — copied to the clipboard instead',
      'undo.menu': 'Recently deleted (undo)',
      'undo.empty': 'Nothing to undo right now',
      'undo.branch': 'Branch',
      'undo.stash': 'Stash',
      'undo.discard': 'Discard',
      'confirm.typeName': 'Type {name} to confirm',
      'confirm.protected': '{name} is a main branch. Deleting it is high risk, so type the branch name to confirm — a toast can still bring it back afterwards.',
      'discard.untracked.confirm': 'Delete the untracked file {path}? Its content is removed — a toast will offer to bring it back.',
      'stashDrop.confirm': 'Drop stash {ref}? A toast will offer to bring it back.',
      'operation.merge': 'Merge in progress',
      'operation.rebase': 'Rebase in progress',
      'operation.cherry-pick': 'Cherry-pick in progress',
      'operation.revert': 'Revert in progress',
      'operation.bisect': 'Bisect in progress',
      'operation.hint': 'This repository still has a multi-step operation open — finish or abort it before branch-level actions',
      'confirm.title': 'Confirm',
      'confirm.cancel': 'Cancel',
      'confirm.ok': 'OK',
      'prompt.newBranch': 'New branch name (created and checked out)',
      'prompt.createTracking': 'Create a local branch from the remote one',
      'prompt.renameBranch': 'Rename branch',
      'prompt.newTag': 'New tag name',
      'prompt.fromHead': 'current HEAD',
      'status.loading': 'Reading...',
      'status.busy': 'Working...',
      'counts.staged': 'Staged {n}',
      'counts.ignored': 'Ignored {n}',
      'counts.unstaged': 'Changes {n}',
      'counts.untracked': 'Untracked {n}',
      'counts.conflicted': 'Conflicts {n}',
      'push.confirm': 'Push {branch} to {upstream}?',
      'push.confirmMany': 'Push {n} branch(es): {names}?',
      'push.title': 'Push commits to {branch}',
      'push.none': 'Nothing to push',
      'push.detached': 'HEAD is detached, nothing can be pushed',
      'push.noRemote': 'No remote is configured',
      'push.truncated': 'Showing the latest {n} commits only',
      'push.hint': 'Double-click a file to see its change',
      'toast.committed': 'Committed',
      'toast.pushed': 'Pushed {n} commits to {target}',
      'toast.branchUpdated': 'Updated {name}',
      'toast.branchPushed': 'Pushed {name}',
      'delete.confirm': 'Delete branch {name}? A toast will offer to bring it back (git still refuses unmerged branches).',
      'discard.confirm': 'Discard changes in {path}? The working-tree content is overwritten — a toast will offer to bring it back.',
      'resetHard.confirm': 'Hard reset to {hash}? Uncommitted changes are lost.',
      'resetSoft.confirm': 'Move HEAD to {hash} (working tree kept)?',
      'checkoutCommit.confirm': 'Check out commit {hash}? (detached HEAD)',
      'toast.staged': 'Staged {n} file(s)',
      'toast.unstaged': 'Unstaged {n} file(s)',
      'toast.checkedOut': 'Checked out {name}',
      'toast.branchCreated': 'Created and checked out {name}',
      'toast.branchRenamed': 'Renamed {from} to {to}',
      'toast.upstreamSet': 'Set the upstream of {name} to {upstream}',
      'toast.upstreamUnset': 'Unset the upstream of {name}',
      'toast.remoteBranchDeleted': 'Deleted the remote branch',
      'toast.tagCreated': 'Created tag {name}',
      'toast.tagDeleted': 'Deleted tag {name}',
      'toast.tagDeletedRemote': 'Deleted remote tag {name}',
      'toast.tagsPushed': 'Pushed the tags',
      'toast.pushDone': 'Pushed',
      'toast.pullDone': 'Pull finished',
      'toast.fetchDone': 'Fetched from the remote',
      'toast.merged': 'Merged {name}',
      'toast.mergedConflict': 'The merge stopped on conflicts — resolve them to continue',
      'toast.rebased': 'Rebased onto {onto}',
      'toast.rebaseAborted': 'Rebase aborted',
      'toast.cherryPicked': 'Cherry-picked {n} commit(s)',
      'toast.reverted': 'Reverted commit {hash}',
      'toast.resetSoft': "Soft reset to {hash} — the commit's work stays staged",
      'toast.resetHard': 'Hard reset to {hash}',
      'toast.discardedN': 'Discarded changes in {n} file(s)',
      'toast.stashed': 'Stashed the working tree',
      'toast.stashPopped': 'Popped the stash',
      'toast.stashApplied': 'Applied the stash',
      'toast.stashCleared': 'Cleared the stash list',
      'toast.remoteAdded': 'Added remote {name}',
      'toast.remoteRemoved': 'Removed remote {name}',
      'toast.cloned': 'Cloned the repository',
    }
    /* /i18n:generated:en */


    /* Two languages ship (m04501): locale/zh.json and locale/en.json own the
       copy, src/utils/i18n.js resolves the tag at authoring time and the generated
       blocks above carry the result into the bundle. Any zh-* tag reads the
       Chinese table; everything else reads English, which is key-complete by
       design, so an unsupported language never shows a raw key. */
    function dictionaryFor(active) {
      const raw = active === undefined || active === null || active === '' ? 'en' : String(active)
      const tag = raw.toLowerCase().replace(/_/g, '-')
      return tag.split('-')[0] === 'zh' ? ZH : EN
    }

    function hasOwnKey(bag, key) {
      return Object.prototype.hasOwnProperty.call(bag, key)
    }

    /* The active locale tag, read fresh every time: DSH's language preference
       switches live (the host-backed preference wins over the browser), so a
       value captured once at activation would keep answering in the language
       that happened to be active when the plugin loaded. */
    function activeLocaleOf(ctx) {
      let active = ''
      try {
        const locale = ctx.get('locale')
        if (locale !== undefined && typeof locale.getSnapshot === 'function') {
          const snapshot = locale.getSnapshot()
          if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.active === 'string') active = snapshot.active
        }
      } catch (error) { void error }
      if (active === '' && typeof navigator === 'object' && navigator !== null && typeof navigator.language === 'string') active = navigator.language
      return active
    }

    function dictionaryOf(ctx) {
      return dictionaryFor(activeLocaleOf(ctx))
    }

    /* A live lookup: the dictionary is picked per call and cached under the tag
       it was picked for, so a language switch costs one string compare per
       string. Falling back to EN — which is kept key-complete on purpose —
       means an unsupported language shows English, never a raw key. */
    /* m05308: the language the last translated string came from. The commit
       message language defaults to the DSH display language, and the panel
       already asks the translator for a string on every paint. */
    let seenLocaleTag = 'en'
    function defaultCommitLanguage() {
      return String(seenLocaleTag === null || seenLocaleTag === undefined ? '' : seenLocaleTag).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    }

    function translatorOf(ctx) {
      let cachedTag = null
      let cachedDict = null
      return (key) => {
        const tag = activeLocaleOf(ctx)
        seenLocaleTag = tag
        if (tag !== cachedTag) { cachedTag = tag; cachedDict = dictionaryFor(tag) }
        if (hasOwnKey(cachedDict, key)) return cachedDict[key]
        return hasOwnKey(EN, key) ? EN[key] : key
      }
    }

    function fill(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = values[key]
        return value === undefined ? match : String(value)
      })
    }

    /* One success line per write route (m05310). Every gesture that mutates the
       repository answers in the bottom-right stack; the panel run() and the commit
       card share this table so the same verb never words itself two ways. A route
       that returns '' reports nothing (compare is a read). */
    function successToastText(t, method, payload) {
      const p = payload === null || payload === undefined ? {} : payload
      const count = (value) => (Array.isArray(value) ? value.length : 0)
      const names = (value) => (Array.isArray(value) ? value.join(', ') : '')
      if (method === 'stage') return fill(t('toast.staged'), { n: count(p.paths) })
      if (method === 'unstage') return fill(t('toast.unstaged'), { n: count(p.paths) })
      if (method === 'checkout') return fill(t(p.create === true ? 'toast.branchCreated' : 'toast.checkedOut'), { name: String(p.branch) })
      if (method === 'branchRename') return fill(t('toast.branchRenamed'), { from: String(p.from), to: String(p.to) })
      if (method === 'branch-upstream') return p.unset === true ? fill(t('toast.upstreamUnset'), { name: String(p.branch) }) : fill(t('toast.upstreamSet'), { name: String(p.branch), upstream: String(p.upstream) })
      if (method === 'branchDelete') return fill(t('toast.branchDeleted'), { name: p.name === undefined ? names(p.names) : String(p.name) })
      if (method === 'branchDeleteRemote') return t('toast.remoteBranchDeleted')
      if (method === 'commit') return t('toast.committed')
      if (method === 'tagCreate') return fill(t('toast.tagCreated'), { name: String(p.name) })
      if (method === 'tagDelete') return fill(t('toast.tagDeleted'), { name: p.name === undefined ? names(p.names) : String(p.name) })
      if (method === 'tagDeleteRemote') return fill(t('toast.tagDeletedRemote'), { name: String(p.name) })
      if (method === 'pushTags') return t('toast.tagsPushed')
      if (method === 'push') return t('toast.pushDone')
      if (method === 'pull') return t('toast.pullDone')
      if (method === 'fetch') return t('toast.fetchDone')
      if (method === 'merge') return fill(t('toast.merged'), { name: String(p.branch) })
      if (method === 'rebase') return fill(t('toast.rebased'), { onto: String(p.onto) })
      if (method === 'rebaseAbort') return t('toast.rebaseAborted')
      if (method === 'cherryPick') return fill(t('toast.cherryPicked'), { n: p.hashes === undefined ? 1 : count(p.hashes) })
      if (method === 'revert') return fill(t('toast.reverted'), { hash: String(p.hash).slice(0, 8) })
      if (method === 'reset') return fill(t(p.mode === 'hard' ? 'toast.resetHard' : 'toast.resetSoft'), { hash: String(p.hash).slice(0, 8) })
      if (method === 'discard') return fill(t('toast.discardedN'), { n: count(p.paths) })
      if (method === 'stashPush') return t('toast.stashed')
      if (method === 'stashApply') return p.pop === true ? t('toast.stashPopped') : t('toast.stashApplied')
      if (method === 'stashClear') return t('toast.stashCleared')
      if (method === 'remoteAdd') return fill(t('toast.remoteAdded'), { name: String(p.name) })
      if (method === 'remoteRemove') return fill(t('toast.remoteRemoved'), { name: String(p.name) })
      if (method === 'clone') return t('toast.cloned')
      return ''
    }

    /* ---- multi-select shared helpers (selection episode, issue #13) ---- */

    /* Keyboard shortcuts (Ctrl+C / Del / Ctrl+A / Esc) must never hijack the
       user's own typing or the browser's native copy inside a field. */
    function isTypingTarget(target) {
      if (target === null || target === undefined || (target instanceof Element) === false) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
    }

    /* The modifier that toggles selection: Cmd on macOS, Ctrl everywhere else
       (VS Code's list convention). Plain Shift is always the range modifier. */
    function isToggleModifier(event) {
      return event.metaKey === true || event.ctrlKey === true
    }

    /* A branch entry's selection key: the kind prefix keeps the (rare) case of
       a branch and a tag sharing one name from colliding inside one Set. */
    function branchSelKeyOf(entry) {
      const kind = entry.tag === true ? 'tag' : entry.remote === true ? 'remote' : 'local'
      return kind + ':' + entry.name
    }

    /* v0.19.9: the REMOTE section folds by path exactly like the local one. In
       the common single-remote repo every row starts with the same "<remote>/"
       prefix, which would nest every tree under one folder named after the
       remote — noise, not grouping — so the strip applies only when EVERY name
       shares that first segment AND carries it (a bare "main" beside
       "origin/main" means mixed shapes and keeps full names). */
    function remoteTreeStripOf(names) {
      if (names.length === 0) return ''
      const first = names.map((name) => String(name).split('/')[0])
      if (new Set(first).size !== 1) return ''
      const prefix = first[0] + '/'
      return names.every((name) => String(name).startsWith(prefix) === true) ? prefix : ''
    }

    /* Join selected values for the clipboard — one per line, the shape a
       terminal or an editor expects when pasting a list. */
    function clipboardLines(values) {
      return values.join('\n')
    }

    /* Shared frozen-by-convention empty selection: selection Sets are never
       mutated in place, so one instance is safe to hand around. */
    const EMPTY_SELECTION = new Set()

    /* ============================== api ============================== */

    /* ---- remote channel fallback core (pure: tests/smoke.mjs slices this
       block) ---- */
    /* dsh-remote-web-ui's browser channel rewrites only the host's own /api/,
       /sidebar/, /git/ and /pet/ prefixes onto its /remote/ proxy; a
       plugin-owned route like ours is not on that list, so from a paired
       remote client the direct call reaches the harness browser-auth gate and
       comes back 401/403 "forbidden" (issue #9: both sidebar and dock panels
       refused to open remotely). The proxy itself serves any loopback path
       under /remote/<full pathname> with the paired device's credentials, so
       the fallback is to retry the very same request through it — the exact
       URL shape the boot patch produces for the host prefixes ('/remote' +
       the request's full pathname, mount prefix included, query preserved). */
    function remoteFallbackUrl(ofPath) {
      /* Resolve through the SAME base the direct fetch used — document.baseURI
         (which honours <base href>; dsh 0.1.7 mounts the shell with one), so
         the retry lands on the proxy copy of the very URL that was rejected. */
      let resolved = null
      try {
        let base
        if (typeof document === 'object' && document !== null && typeof document.baseURI === 'string' && document.baseURI !== '') {
          base = document.baseURI
        } else if (typeof window === 'object' && window !== null && window.location !== undefined && window.location !== null) {
          base = window.location.href
        }
        if (base !== undefined) resolved = new URL(ofPath, base)
      } catch (error) { resolved = null }
      if (resolved === null) return '/remote/' + String(ofPath).replace(/^\//, '')
      return '/remote' + resolved.pathname + resolved.search
    }

    /* A rejection worth retrying through the remote channel: the auth gate
       answers 401 (unauthenticated) or 403 (forbidden); every other status —
       including this route's own JSON errors, which answer 200/4xx with a
       parsed body — is a real answer, not a transport fence. */
    function isAuthRejection(status) {
      return status === 401 || status === 403
    }
    /* ---- end remote channel fallback core ---- */

    /* Sticky remote-channel mode: once the proxy has answered, later calls go
       there directly — otherwise every call from a remote client pays the
       401/403 round trip first. Loopback desktop browsing never trips the
       fallback at all (same-origin requests are always admitted). */
    let viaRemoteChannel = false

    /* ---- the "working" notice (m00761) ----
       A long git verb answers in the one bottom-right stack, not in the page
       layout. The notice waits 400 ms first, so a fast call never flashes it,
       and it leaves the stack when the last busy call settles. */
    const BUSY_TOAST_METHODS = new Set([
      'fetch', 'pull', 'push', 'commit', 'merge', 'rebase', 'cherryPick', 'revert',
      'reset', 'checkout', 'clone', 'stashPush', 'stashApply', 'worktreeAdd',
      'worktreeRemove', 'branchDelete', 'tagDelete', 'tagDeleteRemote', 'pushTags',
    ])
    const BUSY_TOAST_DELAY_MS = 400
    let busyToastText = ''
    let busyToastId = null
    let busyToastTimer = null
    let busyToastCount = 0

    function setBusyToast(text) { busyToastText = typeof text === 'string' ? text : '' }

    function busyBegin() {
      busyToastCount += 1
      if (busyToastText === '' || busyToastTimer !== null || busyToastId !== null) return
      busyToastTimer = setTimeout(() => {
        busyToastTimer = null
        busyToastId = toastCenter.push({ text: busyToastText, ttl: 0 })
      }, BUSY_TOAST_DELAY_MS)
    }

    function busyEnd() {
      busyToastCount = Math.max(0, busyToastCount - 1)
      if (busyToastCount > 0) return
      if (busyToastTimer !== null) { clearTimeout(busyToastTimer); busyToastTimer = null }
      if (busyToastId !== null) { const id = busyToastId; busyToastId = null; toastCenter.drop(id) }
    }

    async function request(method, payload) {
      if (BUSY_TOAST_METHODS.has(method) !== true) return requestOnce(method, payload)
      busyBegin()
      try {
        return await requestOnce(method, payload)
      } finally {
        busyEnd()
      }
    }

    async function requestOnce(method, payload) {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      }
      const direct = API_BASE + '/' + method
      let response = null
      if (viaRemoteChannel === true) {
        response = await fetch(remoteFallbackUrl(direct), init)
      } else {
        response = await fetch(direct, init)
        if (isAuthRejection(response.status) === true) {
          /* Off the origin's trust path: try the pairing proxy once. With no
             remote-web-ui installed the proxy path 404s — the retry then also
             fails, and the ORIGINAL rejection is what the caller sees (a
             proxy answer that is itself an auth rejection is discarded the
             same way, so a genuine cross-site refusal can never be masked). */
          const retried = await fetch(remoteFallbackUrl(direct), init)
          if (isAuthRejection(retried.status) !== true) {
            viaRemoteChannel = true
            response = retried
          }
        }
      }
      let body = null
      try { body = await response.json() } catch (error) { void error }
      if (body === null || typeof body !== 'object') throw new Error('HTTP ' + response.status)
      if (body.ok !== true) {
        const error = body.error === undefined || body.error === null ? {} : body.error
        const failure = new Error(typeof error.message === 'string' && error.message !== '' ? error.message : 'HTTP ' + response.status)
        failure.code = typeof error.code === 'string' ? error.code : 'unknown'
        throw failure
      }
      return body.data
    }

    /* Every failure the panel cannot fix itself is copied to the host's error
       log (m04918), so a user report can be read from one file instead of a
       console that is already gone. Best effort: a failed report is dropped. */
    function reportClientError(scope, error) {
      try {
        const message = error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : ''
        void request('client-error', { scope: scope, message: message, stack: stack }).catch(() => undefined)
      } catch (_) { /* reporting must never throw */ }
    }
    /* Window-level faults (a throw outside React, an unhandled promise) reach
       the same file. The listeners attach once per page load. */
    let clientErrorHooked = false
    function installClientErrorHook() {
      if (clientErrorHooked === true) return
      clientErrorHooked = true
      window.addEventListener('error', (event) => {
        const error = event.error === undefined || event.error === null ? event.message : event.error
        reportClientError('window', error)
      })
      window.addEventListener('unhandledrejection', (event) => {
        reportClientError('promise', event.reason)
      })
    }

    /* ============================== first-paint cache ============================== */

    /* Session-scoped seats (the conversation view, and every sidebar seat that
       follows the active session) REMOUNT their panel on each session switch:
       the slot subtree belongs to the session. Re-running the whole discovery
       (repos scan) + first page (summary / branches / log — three git spawns)
       on every switch made the chrome re-appear piece by piece (reported
       against v0.13.0). Same workspace ⇒ same repository ⇒ the previous paint
       is still essentially correct, so it seeds the states and a background
       refresh lands the fresh data a moment later. Pure functions; the panel
       only ever reads them at effect time and writes after a fetch. */
    /* Two seeds age very differently. The repos scan is the SLOW part (a
       multi-repo workspace walks directories) and its result barely changes,
       so its seed keeps a 10-minute TTL: freshness is the background refresh's
       job — every mount refreshes anyway — the TTL only decides how old a seed
       may be to still paint the first screen. The page seed (summary /
       branches / log) used to expire after 30s, which is exactly the user
       complaint this queue answers ("come back to the panel after a while and
       everything re-loads"): it is a KEEP-WARM QUEUE now — no expiry at all,
       an LRU of three workspaces. Every page in the queue paints instantly no
       matter how long the panel stayed closed; the mount refresh re-proves
       every field silently right after, so freshness never regresses. */
    const PAINT_REPOS_TTL_MS = 600_000
    const PAINT_PAGE_KEEP_WARM = 3
    const paintRepos = new Map()   /* cwd -> { at, data } */
    const paintPage = new Map()    /* repoRoot -> { at, summary, branches, commits, hasMore } */
    const paintRoot = new Map()    /* cwd -> last repoRoot the user was looking at */

    /* The seed also survives a FULL PAGE RELOAD: sessionStorage holds the same
       maps for the lifetime of the tab, so reloading the page (the other way
       users "come back") paints from the seed instead of re-running the slow
       discovery. Hydrate runs once, lazily before the first read; every write
       mirrors the in-memory state back. All of it is best-effort: private
       mode, quota errors and corrupted payloads degrade to "no seed", never to
       an error — and never to a rollback of live state (seeding still only
       fills cold state, see the panel side below). */
    const PAINT_KEY = 'dsh-git4idea.paint.v1'
    let paintHydrated = false

    function hydratePaint() {
      if (paintHydrated === true) return
      paintHydrated = true
      let parsed = null
      try {
        const raw = window.sessionStorage.getItem(PAINT_KEY)
        if (typeof raw === 'string' && raw !== '') parsed = JSON.parse(raw)
      } catch (error) { void error; return }
      if (parsed === null || typeof parsed !== 'object') return
      /* Entries already in memory stay untouched: a write that happened before
         the first read is always fresher than what the storage holds. */
      const feed = (map, stored) => {
        if (stored === null || typeof stored !== 'object') return
        let count = 0
        for (const key of Object.keys(stored)) {
          const entry = stored[key]
          if (map.has(key) || entry === null || typeof entry !== 'object' || typeof entry.at !== 'number') continue
          if (count >= 16) break
          map.set(key, entry)
          count += 1
        }
      }
      feed(paintRepos, parsed.repos)
      feed(paintPage, parsed.page)
      /* The queue cap applies to restored pages too: storage may hold more
         than the live queue does (an older build wrote 16), trim to the same
         three — restored insertion order mirrors the order that was in
         memory, so the survivors are the most recent pages. */
      while (paintPage.size > PAINT_PAGE_KEEP_WARM) {
        paintPage.delete(paintPage.keys().next().value)
      }
    }

    function persistPaint() {
      try {
        const pack = (map) => {
          const out = {}
          for (const [key, entry] of map) out[key] = entry
          return out
        }
        window.sessionStorage.setItem(PAINT_KEY, JSON.stringify({ repos: pack(paintRepos), page: pack(paintPage) }))
      } catch (error) { void error }
    }

    function readPaintRepos(cwd) {
      hydratePaint()
      const entry = paintRepos.get(cwd)
      if (entry === undefined || Date.now() - entry.at > PAINT_REPOS_TTL_MS) return undefined
      return entry.data
    }

    function writePaintRepos(cwd, data) {
      paintRepos.set(cwd, { at: Date.now(), data: data })
      if (paintRepos.size > 16) paintRepos.delete(paintRepos.keys().next().value)
      persistPaint()
    }

    function readPaintPage(repoRoot) {
      hydratePaint()
      const entry = paintPage.get(repoRoot)
      if (entry === undefined) return undefined
      /* A read is a USE: re-insert at the tail so eviction tracks what the
         user actually visits, not which page happened to be written last. */
      paintPage.delete(repoRoot)
      paintPage.set(repoRoot, entry)
      return entry
    }

    function writePaintPage(repoRoot, page) {
      paintPage.set(repoRoot, Object.assign({ at: Date.now() }, page))
      /* The keep-warm queue cap: three workspaces stay painted, the fourth
         evicts the least-recently-used one. Pure LRU over insertion order —
         reads re-tail themselves (readPaintPage), so the survivor set is the
         three repo pages the user actually keeps coming back to. */
      while (paintPage.size > PAINT_PAGE_KEEP_WARM) {
        const oldest = paintPage.keys().next().value
        paintPage.delete(oldest)
      }
      persistPaint()
    }

    function rememberPaintRoot(cwd, repoRoot) {
      if (typeof cwd === 'string' && cwd !== '' && repoRoot !== null) paintRoot.set(cwd, repoRoot)
    }

    function readPaintRoot(cwd) {
      return paintRoot.get(cwd)
    }

    /* ============================== session-switch prewarm ============================== */

    /* Everything above only fills when a PANEL MOUNTS. A session whose
       workspace the panel has never seen still paid the full cold start
       (repos discovery + summary + branches + first log page) the moment the
       user opened the Git tab from the rail or the right sidebar. The
       prewarmer closes that gap: it watches the session list — the same store
       and the same main-view criterion (retainedBy.mainView) the host itself
       uses to decide the active session — and whenever the active session's
       workspace changes, it runs exactly the READS the panel's first paint
       would run and writes them into the same cache. Opening the panel
       afterwards seeds from the warm cache and paints instantly; the mount
       refresh re-proves every field, exactly as before. Read routes only,
       always silent: any failure just means that panel opens cold, never an
       error surface. Hosts without the sessions service never arm it. */

    const PREWARM_DEBOUNCE_MS = 300
    let prewarmTimer = null
    let prewarmGeneration = 0

    /* The panel's own repo pick order (see the repos effect in Panel): the
       session's remembered repo, the workspace's last-viewed root, the
       workspace itself when it is a repository, then the first row. Picking
       identically is what makes the warmed page THE page the panel shows. */
    function prewarmPickOf(sessionId, cwd, data) {
      const paths = data.repos.map((repo) => repo.path)
      const remembered = readRememberedRepo(sessionId)
      if (remembered !== undefined && paths.indexOf(remembered) >= 0) return remembered
      const painted = readPaintRoot(cwd)
      if (painted !== undefined && paths.indexOf(painted) >= 0) return painted
      if (data.isRepo === true) return data.cwd
      if (paths.length > 0) return paths[0]
      return null
    }

    async function prewarmWorkspace(sessionId, cwd) {
      const generation = ++prewarmGeneration
      try {
        let data = readPaintRepos(cwd)
        if (data === undefined) {
          data = await request('repos', { cwd: cwd })
          /* A newer switch arrived while this scan ran: drop the stale
             result on the floor instead of writing and fetching on. */
          if (generation !== prewarmGeneration) return
          writePaintRepos(cwd, data)
        }
        const pick = prewarmPickOf(sessionId, cwd, data)
        if (pick === null || readPaintPage(pick) !== undefined) return
        const base = { cwd: cwd, repoRoot: pick }
        const pages = await Promise.all([
          request('summary', Object.assign({}, base, { ignored: false, stats: false })),
          request('branches', base),
          request('log', Object.assign({}, base, { skip: 0, limit: 120 })),
        ])
        if (generation !== prewarmGeneration) return
        writePaintPage(pick, { summary: pages[0], branches: pages[1], commits: pages[2].commits, hasMore: pages[2].hasMore })
      } catch (error) { void error }
    }

    /* The active session, by the host's own rule: whoever the main view
       retains (retainedBy.mainView > 0). A switch can briefly retain BOTH
       sides; the freshest updatedAt wins. Null when no session is active. */
    /* The LIVE counts come from retainInfo(id).getSnapshot(), not from the
       list row: the row's retainedBy field only refreshes with the next host
       list sync, so right after a click it still names the PREVIOUS session
       (the same reason the host's own ui-session reads retainInfo in its
       publishMain). cwd and updatedAt still come from the row. */
    function activeSessionOf(ctx) {
      try {
        const sessions = ctx.get('sessions')
        const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
        if (list === undefined || typeof list.getSnapshot !== 'function') return null
        if (typeof sessions.retainInfo !== 'function') return null
        const snapshot = list.getSnapshot()
        if (snapshot === null || typeof snapshot !== 'object' || snapshot.byId === undefined || snapshot.byId === null) return null
        let active = null
        for (const key of Object.keys(snapshot.byId)) {
          const entry = snapshot.byId[key]
          if (entry === null || typeof entry !== 'object') continue
          let main = 0
          try {
            const info = sessions.retainInfo(key)
            const counted = info !== undefined && info !== null && typeof info.getSnapshot === 'function' ? info.getSnapshot() : null
            const retained = counted !== null && typeof counted === 'object' ? counted.retainedBy : null
            main = retained !== undefined && retained !== null && typeof retained === 'object'
              ? (typeof retained.mainView === 'number' ? retained.mainView : 0)
              : 0
          } catch (error) { void error }
          if (main <= 0) continue
          if (active === null || entry.updatedAt > active.updatedAt) active = entry
        }
        return active
      } catch (error) { void error; return null }
    }

    function schedulePrewarm(ctx) {
      if (prewarmTimer !== null) clearTimeout(prewarmTimer)
      prewarmTimer = setTimeout(() => {
        prewarmTimer = null
        const active = activeSessionOf(ctx)
        if (active === null) return
        if (typeof active.cwd !== 'string' || active.cwd === '') return
        const sessionId = typeof active.id === 'string' ? active.id : 'default'
        /* Skip everything when BOTH cache layers already cover what the panel
           would paint: repos fresh AND the pick's page kept warm. */
        const cachedRepos = readPaintRepos(active.cwd)
        if (cachedRepos !== undefined) {
          const pick = prewarmPickOf(sessionId, active.cwd, cachedRepos)
          if (pick !== null && readPaintPage(pick) !== undefined) return
        }
        void prewarmWorkspace(sessionId, active.cwd)
      }, PREWARM_DEBOUNCE_MS)
    }

    /* ============================== storage ============================== */

    /* ---- tree UI state (v0.13.1): the session-scoped seats remount on every
       session switch, and component state died with them — branch sections
       snapped back to defaults and folders re-folded. One settings file home,
       GLOBAL by design: which sections you keep folded is a habit, not a
       property of the repository. ---- */
    const TREE_KEY = 'dsh-git4idea.tree.v1'

    function readTreeState() {
      try {
        const raw = readStored(TREE_KEY)
        if (raw === null || raw === '') return null
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : null
      } catch (error) { void error }
      return null
    }

    function writeTreeState(state) {
      writeStored(TREE_KEY, JSON.stringify(state))
    }

    function treeSectionDefaults() {
      return { favorites: false, remote: false, tags: true }
    }

    function treeSectionsOf(stored) {
      const sections = stored !== null && typeof stored === 'object' && stored.sections !== null && typeof stored.sections === 'object'
        ? stored.sections
        : {}
      return Object.assign(treeSectionDefaults(), sections)
    }

    function readRememberedRepo(sessionId) {
      try {
        const raw = readStored(REPO_KEY)
        if (raw === null || raw === '') return undefined
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return undefined
        const value = parsed[sessionId]
        return typeof value === 'string' && value !== '' ? value : undefined
      } catch (error) { void error }
      return undefined
    }

    function rememberRepo(sessionId, repoPath) {
      try {
        const raw = readStored(REPO_KEY)
        const parsed = raw === null || raw === '' ? {} : JSON.parse(raw)
        const next = parsed !== null && typeof parsed === 'object' ? parsed : {}
        next[sessionId] = repoPath
        writeStored(REPO_KEY, JSON.stringify(next))
      } catch (error) { void error }
    }

    const FAV_KEY = 'dsh-git4idea.favorites.v1'

    function readFavorites(repoPath) {
      try {
        const raw = readStored(FAV_KEY)
        if (raw === null || raw === '') return []
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return []
        const list = parsed[repoPath]
        return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : []
      } catch (error) { void error }
      return []
    }

    function toggleFavorite(repoPath, branch) {
      const current = readFavorites(repoPath)
      const next = current.indexOf(branch) >= 0 ? current.filter((entry) => entry !== branch) : current.concat([branch])
      try {
        const raw = readStored(FAV_KEY)
        const parsed = raw === null || raw === '' ? {} : JSON.parse(raw)
        const all = parsed !== null && typeof parsed === 'object' ? parsed : {}
        all[repoPath] = next
        writeStored(FAV_KEY, JSON.stringify(all))
      } catch (error) { void error }
      return next
    }

    const RAIL_KEY = 'dsh-git4idea.rail.v1'

    /* The action rail is user-composed. RAIL_SPECS is the canonical set AND the
       default order; a stored config only holds a permutation plus the ids the
       user hid, and normalizeRail() drops unknown ids and appends missing ones —
       so a version that adds an action never breaks a stored config. */
    /* The rail is the IDEA *Git* strip, top to bottom: the branch-pane
       collapse chevron (drawn by renderRail itself, above a divider), new
       branch, update-from-remote, delete branch, compare, fetch, favorite.
       Everything else left the rail — push and pull now sit right of the
       branch name in the top bar, and the rest was noise for this plugin. */
    const RAIL_SPECS = [
      { id: 'tree', icon: 'chevronLeft', key: 'toolbar.tree', tone: 'secondary' },
      { id: 'newBranch', icon: 'plus', key: 'toolbar.newBranch', tone: 'secondary' },
      { id: 'pull', icon: 'pull', key: 'toolbar.pull', tone: 'secondary' },
      { id: 'delete', icon: 'trash', key: 'action.delete', tone: 'secondary' },
      { id: 'compare', icon: 'compare', key: 'action.compare', tone: 'secondary' },
      { id: 'fetch', icon: 'fetch', key: 'toolbar.fetch', tone: 'secondary' },
      { id: 'favorite', icon: 'star', key: 'action.favorite', tone: 'warn' },
    ]
    const RAIL_IDS = RAIL_SPECS.map((spec) => spec.id)
    /* Actions that arrange the view rather than touch the repository, so a running
       git command never greys them out. */
    const RAIL_VIEW_IDS = ['tree']

    function normalizeRail(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const order = []
      const storedOrder = Array.isArray(source.order) ? source.order : []
      for (const id of storedOrder) {
        if (typeof id === 'string' && RAIL_IDS.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id)
      }
      for (const id of RAIL_IDS) { if (order.indexOf(id) < 0) order.push(id) }
      const hidden = []
      const storedHidden = Array.isArray(source.hidden) ? source.hidden : []
      for (const id of storedHidden) {
        if (typeof id === 'string' && RAIL_IDS.indexOf(id) >= 0 && hidden.indexOf(id) < 0) hidden.push(id)
      }
      return { order, hidden }
    }

    /* m04492: the plugin has no row Config any more. Every value that surface
       carried comes from the constants below, and the rail's own arrangement
       stays where the panel editor has always kept it. */

    /* The conversation view fills the whole height — its only placement. */
    function conversationImmersiveEnabled() {
      return true
    }

    function readRailConfig() {
      try {
        const raw = readStored(RAIL_KEY)
        if (raw === null || raw === '') return normalizeRail(null)
        return normalizeRail(JSON.parse(raw))
      } catch (error) { void error }
      return normalizeRail(null)
    }

    function writeRailConfig(config) {
      writeStored(RAIL_KEY, JSON.stringify(config))
    }

    /* ============================== pane sizes ============================== */

    /* ---- pane sizing core (pure: tests/smoke.mjs slices this block and drives
       it through new Function, so it must stay free of window/DOM/React) ---- */

    /* Every fixed pane size in the layout became draggable (issue #5), and the
       result is remembered PER SURFACE. The same registration renders in the
       bottom workbench (wide and flat) and in the native right sidebar (narrow
       and tall), and a 290px changes column that is right in one is half the
       panel in the other. The bucket is therefore `chrome:wide|tall`, and what
       is stored is a RATIO of the measured container: resizing the dock or the
       window rescales the panes instead of breaking the layout. */
    const PANES_KEY = 'dsh-git4idea.panes.v1'
    /* Every chrome can now move all three panes (the detail diff window used to
       be a fixed max-height:55% in the columns chrome — user report: it could
       not be resized). The DIFF pane is special: it is carved out of the middle
       pane, so it is sized by HEIGHT in every chrome, even where the other
       panes measure width (columns). */
    const PANE_CHROME_KEYS = {
      columns: ['tree', 'changes', 'diff'],
      stack: ['tree', 'changes', 'diff'],
      compact: ['tree', 'diff'],
    }
    /* Whether a key measures a height (stacked chromes) or a width (columns).
       This is the chrome's DEFAULT for the tree/changes panes; the diff pane
       overrides it to height unconditionally (see paneGeometry). */
    const PANE_HEIGHT_CHROME = { columns: false, stack: true, compact: true }
    /* The pane a separator resizes, and the key its label is translated from. */
    const PANE_NAME_KEYS = { tree: 'toolbar.tree', changes: 'changes.title', diff: 'pane.diff' }
    /* Hard limits in px: a gutter moves a pane between these and nothing else,
       so no pane can ever be dragged down to zero. */
    const PANE_LIMITS = {
      'columns:tree': { min: 140, max: 560 },
      'columns:changes': { min: 200, max: 640 },
      'columns:diff': { min: 120, max: 900 },
      'stack:tree': { min: 100, max: 420 },
      'stack:changes': { min: 120, max: 460 },
      'stack:diff': { min: 120, max: 900 },
      'compact:tree': { min: 100, max: 420 },
      'compact:diff': { min: 120, max: 900 },
    }
    /* Today's fixed sizes stay the default — and stay in the stylesheet: a pane
       the user never dragged keeps exactly the look it had before, while a
       dragged one is remembered as a ratio. The diff's 0.55 IS the stylesheet's
       max-height:55%, so an undragged window renders identically to before. */
    const PANE_DEFAULTS = {
      'columns:tree': { ratio: 0.2 },
      'columns:changes': { ratio: 0.4 },
      'columns:diff': { ratio: 0.55 },
      'stack:tree': { ratio: 0.36 },
      'stack:changes': { ratio: 0.46 },
      'compact:tree': { ratio: 0.42 },
    }
    const PANE_MAIN_MIN_W = 240
    const PANE_MAIN_MIN_H = 150
    /* The reserve above is the IDEAL the clamp aims for. When the panel is simply
       too small for every default at once, aiming for it would put a pane's
       ceiling BELOW the box that pane already occupies — and the first drag would
       then shrink it instead of growing it. Below that point the middle pane
       keeps this hard floor instead, and the pane's own current size always wins
       (see paneGeometry). */
    const PANE_MAIN_FLOOR_PX = 120
    const PANE_HISTORY_MIN_H = 120
    /* Hit area of one gutter, and how many of them sit in the body. The
       history↔diff separator lives inside the middle pane, so it is not counted
       against the body's own budget. */
    const PANE_GUTTER_PX = 8
    const PANE_BODY_GUTTERS = { columns: 2, stack: 2, compact: 1 }
    const PANE_BUCKETS = Object.keys(PANE_CHROME_KEYS).reduce(
      (all, chrome) => all.concat([chrome + ':wide', chrome + ':tall']), [])

    /* Two measurements are the same when every pane they know about is. */
    function samePaneSizes(current, next) {
      const keys = Object.keys(current)
      if (keys.length !== Object.keys(next).length) return false
      for (const key of keys) { if (current[key] !== next[key]) return false }
      return true
    }

    function panBucket(chrome, box) {
      return chrome + (box.height > box.width ? ':tall' : ':wide')
    }

    /* Storage is untrusted, so this keeps normalizeRail()'s discipline: unknown
       buckets, unknown keys, non-finite numbers and out-of-range ratios are all
       dropped. A ratio is a fraction of the container, so it lives in (0, 1]. */
    function normalizePanes(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const stored = source.panes !== null && typeof source.panes === 'object' ? source.panes : {}
      const panes = {}
      for (const bucket of PANE_BUCKETS) {
        const entry = stored[bucket]
        if (entry === null || typeof entry !== 'object') continue
        const keys = PANE_CHROME_KEYS[bucket.slice(0, bucket.indexOf(':'))]
        const clean = {}
        for (const key of keys) {
          const value = entry[key]
          if (typeof value !== 'number' || Number.isFinite(value) === false) continue
          if (value <= 0 || value > 1) continue
          clean[key] = value
        }
        if (Object.keys(clean).length > 0) panes[bucket] = clean
      }
      return { treeOpen: source.treeOpen !== false, panes: panes }
    }

    /* Immutable single-key update. ratio === null removes the override, which is
       exactly what the double-click reset does. */
    function withPaneRatio(config, bucket, key, ratio) {
      const panes = {}
      for (const name of PANE_BUCKETS) {
        if (config.panes[name] !== undefined) panes[name] = config.panes[name]
      }
      const entry = {}
      const current = panes[bucket] === undefined ? {} : panes[bucket]
      for (const name of PANE_CHROME_KEYS[bucket.slice(0, bucket.indexOf(':'))]) {
        if (current[name] !== undefined) entry[name] = current[name]
      }
      if (ratio === null) delete entry[key]
      else entry[key] = ratio
      if (Object.keys(entry).length === 0) delete panes[bucket]
      else panes[bucket] = entry
      return { treeOpen: config.treeOpen, panes: panes }
    }

    /* Stored ratios (or today's defaults) → concrete px for the current chrome,
       clamped against the measured container. `overrides` holds only the panes
       the user actually dragged (absent = leave the stylesheet default alone);
       `effective` is what the clamp math used; `limits` is the range each gutter
       is allowed to hand back. `laidOut` is what the panes actually measure right
       now, which beats the stylesheet default when a pane is content-sized: the
       stacked chrome caps the changes pane at 46%, but a three-file summary only
       takes 30%, and reserving the cap would freeze the tree above it. */
    function paneGeometry(chrome, box, config, laidOut) {
      const height = PANE_HEIGHT_CHROME[chrome] === true
      const reference = height ? box.height : box.width
      const bucket = panBucket(chrome, box)
      const ready = config !== null && typeof config === 'object'
      const source = ready && config.panes !== null && typeof config.panes === 'object' ? config.panes : {}
      const ratios = source[bucket] !== null && typeof source[bucket] === 'object' ? source[bucket] : {}
      const measured = laidOut !== null && typeof laidOut === 'object' ? laidOut : {}
      const keys = PANE_CHROME_KEYS[chrome].slice()
      /* A folded tree has no pane and no gutter, so it must not reserve room. */
      if (ready && config.treeOpen === false) {
        const at = keys.indexOf('tree')
        if (at >= 0) keys.splice(at, 1)
      }
      const overrides = {}
      const effective = {}
      const limits = {}
      const sizeOf = (key) => (effective[key] === undefined ? 0 : effective[key])
      /* The diff is carved out of the middle pane, so it measures HEIGHT in
         every chrome — even in columns, where tree/changes run sideways and
         the chrome's own dimension is width. Its ratios therefore divide the
         body HEIGHT, whatever `reference` says. */
      const referenceOf = (key) => (key === 'diff' ? box.height : reference)
      for (const key of keys) {
        const spec = PANE_DEFAULTS[chrome + ':' + key]
        const fallback = spec === undefined ? 0 : (spec.px === undefined ? spec.ratio * referenceOf(key) : spec.px)
        const live = measured[key]
        effective[key] = typeof live === 'number' && Number.isFinite(live) && live > 0 ? live : fallback
      }
      const space = Math.max(0, reference - PANE_BODY_GUTTERS[chrome] * PANE_GUTTER_PX)
      const reserve = height ? PANE_MAIN_MIN_H : PANE_MAIN_MIN_W
      /* Deterministic order: changes, then tree, then diff. The diff is carved
         out of the middle pane, so it is clamped last — against whatever the
         first two left behind, minus the history list's own minimum. */
      for (const key of ['changes', 'tree', 'diff']) {
        if (keys.indexOf(key) < 0) continue
        const spec = PANE_LIMITS[chrome + ':' + key]
        const current = sizeOf(key)
        let ceiling = spec.max
        if (key === 'diff') {
          /* The diff lives INSIDE the main pane, so its height budget is the
             main pane's height: the full body height in the columns chrome
             (the other panes run sideways there and share none of it), the
             body height minus the stacked siblings otherwise. Either way the
             history list keeps its own minimum. */
          const main = height
            ? space - sizeOf('changes') - sizeOf('tree') - PANE_GUTTER_PX
            : box.height
          ceiling = Math.min(ceiling, main - PANE_HISTORY_MIN_H)
        } else {
          let taken = 0
          for (const other of keys) { if (other !== key && other !== 'diff') taken += sizeOf(other) }
          /* Two tiers, because one number cannot serve both jobs. The IDEAL keeps
             the middle pane at its reserve — that is what a roomy panel gets. The
             relaxed tier only kicks in when the ideal would land BELOW the box
             this pane already occupies (a 674px column cannot hold 200 + 290 + 240
             at once), and it exists so the clamp degrades to "you may not grow
             much" instead of "the first drag to the right shrinks you". */
          const ideal = space - reserve - taken
          ceiling = Math.min(ceiling, current > ideal ? space - PANE_MAIN_FLOOR_PX - taken : ideal)
        }
        /* The clamp may refuse to GROW a pane; it may never shrink one the user
           did not touch — so the ceiling is never below the pane's current box,
           and the aria window says exactly that. */
        const cap = Math.max(spec.max, Math.round(current))
        const high = Math.min(cap, Math.max(spec.min, Math.round(ceiling), Math.round(current)))
        limits[key] = { min: spec.min, max: high }
        const ratio = ratios[key]
        if (typeof ratio === 'number' && Number.isFinite(ratio)) {
          const px = Math.round(Math.min(Math.max(ratio * referenceOf(key), spec.min), high))
          overrides[key] = px
          effective[key] = px
        }
      }
      return { bucket: bucket, overrides: overrides, effective: effective, limits: limits }
    }
    /* ---- end pane sizing core ---- */

    function readPanes() {
      try {
        const raw = readStored(PANES_KEY)
        if (raw === null || raw === '') return normalizePanes(null)
        return normalizePanes(JSON.parse(raw))
      } catch (error) { void error }
      return normalizePanes(null)
    }

    function writePanes(config) {
      writeStored(PANES_KEY, JSON.stringify(normalizePanes(config)))
    }

    /* ============================== dock actions ============================== */

    /* ---- dock action core (pure: tests/smoke.mjs slices this block) ---- */

    /* The official right sidebar (ui-sidebar-right) is the only surface that can
       float a tab out, dock it back, split its pane or take it full screen, and it
       is NOT there on every host: an old host has no sidebarRight at all, and even
       on a host that ships it the service is only provided once
       ui-sidebar-right has mounted —
       reading it during apply() returns undefined (measured on 0.1.7-rc.2). So the
       service is read at render time, and a missing one means these actions do not
       exist for this mount: no button, no error, no console noise. */
    function dockFaceOf(ctx) {
      if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return null
      let service
      try { service = ctx.get('sidebarRight') } catch (error) { return null }
      if (service === null || service === undefined || typeof service !== 'object') return null
      if (typeof service.float !== 'function' || typeof service.dock !== 'function') return null
      return service
    }

    /* What this mount can offer. `dock` is the wiring handed down to the panel
       (null when nothing is wired, e.g. the conversation-area seat), `floatPaneId` is
       the floating pane the panel is currently drawn in, read from the float
       layer's own marker. The face publishes operations only — no layout snapshot —
       so the float state has to come from there. */
    function dockActionState(dock, floatPaneId) {
      const wired = dock !== null && typeof dock === 'object' && typeof dock.tabId === 'string'
        && dock.tabId !== '' && dock.service !== null && typeof dock.service === 'object'
      const floating = typeof floatPaneId === 'string' && floatPaneId !== ''
      return {
        wired: wired,
        floating: floating,
        float: wired,
        /* A float panel hosts exactly one tab: splitting it is not a thing. */
        split: wired && floating === false,
        fullscreen: wired && typeof dock.service.toggleFullscreen === 'function',
      }
    }
    /* ---- end dock action core ---- */

    /* The slot hands every tab body its own reader; it THROWS while the tab is not
       committed in the session, so an unreadable tab means no dock actions rather
       than a broken panel. Called from the component that owns the hook. */
    function readDockInfo(useTabInfo, ctx) {
      if (typeof useTabInfo !== 'function') return null
      const service = dockFaceOf(ctx)
      if (service === null) return null
      let info = null
      try { info = useTabInfo() } catch (error) { void error }
      if (info === null || typeof info !== 'object' || info.tab === undefined || info.panel === undefined) return null
      if (typeof info.tab.id !== 'string') return null
      return {
        service: service,
        tabId: info.tab.id,
        paneId: typeof info.panel.id === 'string' ? info.panel.id : '',
        fullscreen: info.sidebar !== undefined && info.sidebar !== null && info.sidebar.fullscreen === true,
      }
    }

    /* ============================== formatting ============================== */

    function shortDate(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return ''
      const pad = (value) => (value < 10 ? '0' + value : String(value))
      return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes())
    }

    function baseName(filePath) {
      if (typeof filePath !== 'string') return ''
      const parts = filePath.split('/')
      return parts[parts.length - 1]
    }

    function dirName(filePath) {
      if (typeof filePath !== 'string') return ''
      const index = filePath.lastIndexOf('/')
      return index < 0 ? '' : filePath.slice(0, index)
    }

    /* A REAL directory tree for the "by directory" grouping (v0.18.6): files
       are inserted by path segments, then a folder that has no direct files
       and exactly one child is COMPRESSED into that child ("a/b/c" as one
       node, VS Code source-control style) — the flat per-directory heads the
       user rejected rendered every folder of a chain side by side, so
       `pkg/service` and `pkg/service/impl` looked like unrelated siblings.
       Returns the compressed roots (sorted), every foldable node id (for
       fold-all), the files sitting at the group root, and the two recursive
       helpers the renderer needs. */
    function buildDirForest(items, groupKey) {
      const root = { dirs: new Map(), files: [], path: [] }
      for (const item of items) {
        const dir = dirName(item.path)
        const parts = dir === '' ? [] : dir.split('/')
        let node = root
        for (const part of parts) {
          let child = node.dirs.get(part)
          if (child === undefined) {
            child = { dirs: new Map(), files: [], path: node.path.concat([part]) }
            node.dirs.set(part, child)
          }
          node = child
        }
        node.files.push(item)
      }
      const compress = (node) => {
        let merged = node
        while (merged.files.length === 0 && merged.dirs.size === 1) {
          const only = merged.dirs.values().next().value
          merged = { dirs: only.dirs, files: only.files, path: only.path }
        }
        return merged
      }
      const countOf = (node) => {
        let total = node.files.length
        for (const child of node.dirs.values()) total += countOf(child)
        return total
      }
      /* Compress at EVERY level, not just the roots (issue #18): the roots
         were condensed into "a/b/c" chains, but renderFolder's recursion and
         the fold-all id walk both read this function — which used to hand
         back the raw single-child chains below the first level, so a deep
         package path repeated its full prefix on every row. Each returned
         child is the deepest node of its single-child, file-less chain. */
      const sortedChildren = (node) => Array.from(node.dirs.values()).map(compress).sort((a, b) => a.path[a.path.length - 1].localeCompare(b.path[b.path.length - 1]))
      const ids = []
      const collect = (node) => {
        ids.push(groupKey + '|' + node.path.join('/'))
        for (const child of sortedChildren(node)) collect(child)
      }
      const roots = sortedChildren(root)
      for (const node of roots) collect(node)
      return { roots: roots, rootFiles: root.files, ids: ids, countOf: countOf, sortedChildren: sortedChildren }
    }

    /* ============================== commit graph ============================== */

    /* IDEA's log layout ("plan A"), ported from the permanent-graph sources:
       - every commit gets a layout index from a DFS that starts at the branch
         heads ordered by branch importance (origin/master, remote branch,
         master, local branch, tag, current branch, HEAD). The DFS walks first
         parents first and bumps the index at each chain end, so the most
         important branch ends up leftmost even when a newer merge commit was
         loaded first.
       - the columns of a row are the RANKS of the elements visible in it: the
         commit node plus every edge that CROSSES the row (child above, parent
         below). Elements sort with GraphElementComparatorByLayoutIndex, so a
         wire lands between the columns its ends demand and the columns compact
         as soon as a wire dies.
       - an edge between adjacent rows is not a row element: its end column is
         the node of the neighbour row (PrintElementGeneratorImpl's end
         position function). Only a long edge is ranked on its own.
       Every row then draws the halves of the lines that touch its centre; two
       halves meet on the row border at the midpoint of their ranks, so one
       straight diagonal continues into the next row (IDEA's cell painter).
       The log is a WINDOW: a parent that was never loaded contributes no edge,
       the lane simply ends at its commit. */
    function buildRows(commits) {
      const indexOf = new Map()
      commits.forEach((commit, index) => indexOf.set(commit.hash, index))

      /* The current branch comes from the HEAD decoration, and it ranks behind
         every other ref class in IDEA's branch layout. */
      let currentBranch = null
      for (const commit of commits) {
        const refs = Array.isArray(commit.refs) ? commit.refs : []
        for (const ref of refs) {
          const name = String(ref)
          if (name.indexOf('HEAD -> ') === 0) currentBranch = name.slice(8)
        }
      }

      /* GitRefManager.getBranchLayoutComparator's classes: lower lays out
         further left. */
      const refPower = (token) => {
        const name = String(token)
        if (name === 'HEAD') return 6
        if (name.indexOf('tag: ') === 0) return 4
        const remote = name.indexOf('origin/') === 0
        const short = remote ? name.slice(7) : name
        if (short === 'master' || short === 'main') return remote ? 0 : 2
        if (remote) return 1
        if (currentBranch !== null && name === currentBranch) return 5
        return 3
      }
      const headRank = (commit) => {
        const refs = Array.isArray(commit.refs) ? commit.refs : []
        let power = 7
        let name = ''
        for (const ref of refs) {
          const token = String(ref)
          /* 'HEAD -> X' decorates the CURRENT BRANCH, not the HEAD symref. */
          const value = token.indexOf('HEAD -> ') === 0 ? 5 : refPower(token)
          if (value < power) { power = value; name = token }
        }
        return { power: power, name: name }
      }
      const compareHeads = (a, b) => {
        const first = headRank(commits[a])
        const second = headRank(commits[b])
        if (first.power !== second.power) return first.power - second.power
        if (first.name === second.name) return 0
        return first.name < second.name ? -1 : 1
      }

      const edges = []
      const downEdges = commits.map(() => [])
      const upEdges = commits.map(() => [])
      commits.forEach((commit, u) => {
        const parents = Array.isArray(commit.parents) ? commit.parents : []
        for (const parent of parents) {
          if (!indexOf.has(parent)) continue
          const d = indexOf.get(parent)
          if (d <= u) continue
          const edge = { u: u, d: d, color: 0 }
          edges.push(edge)
          downEdges[u].push(edge)
          upEdges[d].push(edge)
        }
      })
      edges.forEach((edge, index) => { edge.id = index })

      /* Heads are the branch tips plus every commit with no child in the
         window; IDEA walks them in branch-importance order. */
      const heads = []
      commits.forEach((commit, index) => {
        const refs = Array.isArray(commit.refs) ? commit.refs : []
        if (refs.length > 0 || upEdges[index].length === 0) heads.push(index)
      })
      heads.sort(compareHeads)

      const layoutIndex = new Array(commits.length).fill(0)
      let currentLayoutIndex = 1
      for (const head of heads) {
        if (layoutIndex[head] !== 0) continue
        const stack = [head]
        while (stack.length > 0) {
          const node = stack[stack.length - 1]
          const firstVisit = layoutIndex[node] === 0
          if (firstVisit) layoutIndex[node] = currentLayoutIndex
          let child = -1
          for (const edge of downEdges[node]) {
            if (layoutIndex[edge.d] === 0) { child = edge.d; break }
          }
          if (child === -1) {
            if (firstVisit) currentLayoutIndex += 1
            stack.pop()
          } else {
            stack.push(child)
          }
        }
      }

      const compare2 = (edge, node) => {
        const top = Math.max(layoutIndex[edge.u], layoutIndex[edge.d])
        return top !== layoutIndex[node] ? top - layoutIndex[node] : edge.u - node
      }
      /* GraphElementComparatorByLayoutIndex: an edge is ordered against a node
         (or against the other edge's other end) by the larger layout index. */
      const compareElements = (a, b) => {
        const first = a.edge
        const second = b.edge
        if (first !== undefined && second !== undefined) {
          if (first.u === second.u) {
            return first.d < second.d ? -compare2(second, first.d) : compare2(first, second.d)
          }
          return first.u < second.u ? compare2(first, second.u) : -compare2(second, first.u)
        }
        if (first !== undefined) return compare2(first, b.node)
        if (second !== undefined) return -compare2(second, a.node)
        return 0
      }

      const nodePos = new Array(commits.length).fill(0)
      const edgePos = commits.map(() => new Array(edges.length).fill(-1))
      let columnCount = 1
      for (let row = 0; row < commits.length; row += 1) {
        const elements = [{ node: row }]
        for (const edge of edges) {
          if (edge.u < row && row < edge.d) elements.push({ edge: edge })
        }
        elements.sort(compareElements)
        for (let position = 0; position < elements.length; position += 1) {
          const element = elements[position]
          if (element.edge !== undefined) edgePos[row][element.edge.id] = position
          else nodePos[row] = position
        }
        columnCount = Math.max(columnCount, elements.length)
      }
      /* IDEA paints an edge in the colour of its up (child) commit. */
      for (const edge of edges) edge.color = nodePos[edge.u]

      const rows = []
      for (let row = 0; row < commits.length; row += 1) {
        const top = []
        const bottom = []
        const node = nodePos[row]
        const crossing = []
        for (const edge of edges) {
          if (edge.u < row && row < edge.d) crossing.push(edge)
        }
        for (const edge of upEdges[row]) {
          const above = row - 1 === edge.u ? nodePos[row - 1] : edgePos[row - 1][edge.id]
          top.push({ wire: edge.id, from: (above + node) / 2, to: node, color: edge.color })
        }
        for (const edge of crossing) {
          const here = edgePos[row][edge.id]
          const above = row - 1 === edge.u ? nodePos[row - 1] : edgePos[row - 1][edge.id]
          const below = row + 1 === edge.d ? nodePos[row + 1] : edgePos[row + 1][edge.id]
          top.push({ wire: edge.id, from: (above + here) / 2, to: here, color: edge.color })
          bottom.push({ wire: edge.id, from: here, to: (here + below) / 2, color: edge.color })
        }
        for (const edge of downEdges[row]) {
          const below = row + 1 === edge.d ? nodePos[row + 1] : edgePos[row + 1][edge.id]
          bottom.push({ wire: edge.id, from: node, to: (node + below) / 2, color: edge.color })
        }
        rows.push({ commit: commits[row], lane: node, top: top, bottom: bottom, width: columnCount })
      }
      return rows
    }

    /* Coordinate half-segments of one row: a top piece enters the node centre
       from the row border, a bottom piece leaves it for the border. Both ends
       are ranks; the border end is the midpoint of the two ranks, so the next
       row's half continues the same straight line (IDEA's SimpleGraphCellPainter
       paints one full segment from a node centre to the next node centre and
       clips it to the cell). */
    function edgeSegments(row, x, middle, height) {
      const segments = []
      const top = Array.isArray(row.top) ? row.top : []
      const bottom = Array.isArray(row.bottom) ? row.bottom : []
      for (let index = 0; index < top.length; index += 1) {
        const piece = top[index]
        segments.push({
          key: 'top-' + String(index) + '-' + String(piece.wire),
          wire: piece.wire, color: piece.color, lane: piece.to,
          x1: x(piece.from), y1: 0, x2: x(piece.to), y2: middle,
        })
      }
      for (let index = 0; index < bottom.length; index += 1) {
        const piece = bottom[index]
        segments.push({
          key: 'bottom-' + String(index) + '-' + String(piece.wire),
          wire: piece.wire, color: piece.color, lane: piece.from,
          x1: x(piece.from), y1: middle, x2: x(piece.to), y2: height,
        })
      }
      return segments
    }


    /* Memoised: rows come from a useMemo, so a row object is referentially
       stable across re-renders unless the commit list actually changed — the
       26px graph cells then skip re-rendering on every filter keystroke. */
    /* IDEA paints no curves: a lane is a vertical stem, and a branch edge is a
       straight diagonal from the child node to the parent node one row below.
       The node always paints last, so it covers the wire ends. */
    const GraphCell = memo(function GraphCell(props) {
      const row = props.row
      const height = props.height
      const scale = height / GRAPH_ROW_UNIT
      const laneWidth = GRAPH_NODE_WIDTH * scale
      const stem = GRAPH_STEM * scale
      const radius = GRAPH_NODE_RADIUS * scale
      const width = Math.min(Math.max(1, row.width), GRAPH_MAX_LANES) * laneWidth + 8
      const middle = height / 2
      const children = []
      /* Lanes beyond the cap share the last column: the geometry stays bounded
         and the subject column keeps its room. */
      const x = (lane) => 8 + Math.min(lane, GRAPH_MAX_LANES - 1) * laneWidth
      const color = (lane) => LANE_COLORS[lane % LANE_COLORS.length]
      for (const segment of edgeSegments(row, x, middle, height)) {
        children.push(E('line', {
          key: segment.key,
          'data-lane': String(segment.lane),
          x1: segment.x1, y1: segment.y1, x2: segment.x2, y2: segment.y2,
          stroke: color(segment.color), strokeWidth: stem, strokeLinecap: 'round',
        }))
      }
      const isHead = Array.isArray(row.commit.refs) && row.commit.refs.some((ref) => String(ref).indexOf('HEAD') >= 0)
      /* HeadNodePainter draws three circles on the lane colour: a filled disc of
         r+2, a background disc of r, and a core dot of r/2. Painted as one ring
         stroke instead, the same silhouette costs two elements and needs no
         background colour: the ring spans r..r+2, the core sits at r/2. */
      children.push(isHead
        ? E('g', { key: 'dot' },
          E('circle', { 'data-lane': String(row.lane), cx: x(row.lane), cy: middle, r: radius * 1.25, fill: 'none', stroke: color(row.lane), strokeWidth: radius * 0.5 }),
          E('circle', { cx: x(row.lane), cy: middle, r: radius * 0.5, fill: color(row.lane) }))
        : E('circle', { key: 'dot', 'data-lane': String(row.lane), cx: x(row.lane), cy: middle, r: radius, fill: color(row.lane) }))
      return E('svg', { className: 'git4idea-graph', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height }, children)
    }, (prev, next) => prev.row === next.row && prev.height === next.height)

    /* ============================== composer send ============================== */
    /* "Send to chat": drop a reference chip / short text into the CURRENT
       session's composer, the way typing `@file` there would. The host channel
       is ui-conversation's SessionInput facade (research brief 2026-10-07):
       `ctx.get('conversation').input.for(ctx.get('sessions').scope(id))`. Every
       hop is probed — the services may be absent (a trimmed host) and `for`
       THROWS on a scope without a retained session generation — so a miss
       degrades to a clipboard copy with a toast, never a dead click.

       Two spellings:
       - file/folder → insertReference(): a structured Lexical chip whose model
         serialization is the plain `@path` text (the same thing the @ menu
         inserts; source 'reference', appearance 'file'/'folder').
       - text (short hash, branch name, raw path) → the scoped
         `slash/input-insert-text` bail event, the machine entrance of the same
         pipeline. NOT `inputTriggers...openReference` — that one opens a
         preview and never touches the draft. */

    /* `formatFileMention` (@deepseek-ai/dsh-file-reference/grammar) without the
       require: that package is not on the seed table, so the plugin inlines the
       grammar — trailing `/` for a directory, `@"path"` when whitespace is
       present (a quoted directory keeps its quote open), and `null` for paths
       the editor grammar cannot represent (control characters, quotes). */
    function fileMentionOf(relPath) {
      const isDir = relPath.slice(-1) === '/'
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(relPath) === true) return null
      if (/\s/u.test(relPath) === false) return '@' + relPath
      return isDir === true ? '@"' + relPath : '@"' + relPath + '"'
    }

    /* Resolve { actx, input } for the current session, or null. `input.for`
       requires a RETAINED Session scope and throws otherwise — that is part of
       its contract (contract/input.ts), so the whole probe rides a try/catch. */
    function composerTargetOf(ctx, sessionId) {
      try {
        if (ctx === undefined || ctx === null || ctx.get === undefined) return null
        if (typeof sessionId !== 'string' || sessionId === '' || sessionId === 'default') return null
        const sessions = ctx.get('sessions')
        const conversation = ctx.get('conversation')
        if (sessions === undefined || sessions === null || conversation === undefined || conversation === null) return null
        if (typeof sessions.scope !== 'function' || conversation.input === undefined || conversation.input === null) return null
        const actx = sessions.scope(sessionId)
        if (actx === undefined || actx === null) return null
        const input = conversation.input.for(actx)
        if (input === undefined || input === null) return null
        return { actx: actx, input: input }
      } catch (error) { void error; return null }
    }

    /* The composer carries TWO text projections (ui-conversation projection.ts):
       detectText feeds TokenSpan coordinates — every chip counts as ONE U+FFFC
       there — while the published InputState.draft is the clipboard projection,
       where a chip expands to its full `@path`. The insert verbs take DETECT
       spans, and selectSpan rejects `end > detectLength` outright (span-map.ts),
       so a tail span built from draft.length is correct only while the draft has
       NO chips. With one in the draft it points past the document end and the
       edit silently fails — exactly the "chip landed, the line-range sentence
       never did" real-machine report against v0.13.5 (and any plain-text send
       into a draft that already holds a chip). Convert instead: subtract every
       occurrence's (clipboard length - 1). */
    function detectTailSpanOf(state) {
      if (state === undefined || state === null || typeof state.draft !== 'string' || typeof state.draftRev !== 'number') return null
      let at = state.draft.length
      const occurrences = Array.isArray(state.occurrences) ? state.occurrences : []
      for (const occ of occurrences) {
        if (occ === null || typeof occ !== 'object') continue
        const width = typeof occ.length === 'number' && occ.length >= 0
          ? occ.length
          : (typeof occ.clipboardText === 'string' ? occ.clipboardText.length : 1)
        at -= Math.max(0, width - 1)
      }
      if (at < 0) return null
      return { start: at, end: at, draftRev: state.draftRev }
    }

    /* apply(actx, input, span) → boolean. The span is an EMPTY span at the draft
       tail in DETECT coordinates (the coordinates the CAS and selectSpan
       compare — see detectTailSpanOf). A false answer is the user typing
       between our read and write — re-read once and retry (the brief's advice:
       one retry, no spinning). The busy phases (adjudicating/submitting) also
       answer false; that lands on the same clipboard fallback, which is the
       honest outcome. */
    function insertIntoComposer(ctx, sessionId, apply) {
      const target = composerTargetOf(ctx, sessionId)
      if (target === null) return false
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let state
        try { state = target.input.state.getSnapshot() } catch (error) { void error; return false }
        const span = detectTailSpanOf(state)
        if (span === null) return false
        let applied = false
        try { applied = apply(target.actx, target.input, span) === true } catch (error) { void error; applied = false }
        if (applied === true) {
          try { target.input.focus() } catch (error) { void error }
          return true
        }
      }
      return false
    }

    /* One single-file unified diff (what the host `diff` method returns) → the
       one DiffHunk DiffBlock renders, by replaying ` `/`-`/`+` lines back into
       the two sides. No `@@` at all (binary patches, mode-only changes) or a
       pathless header → null, and the caller keeps the hand-drawn rows. */
    function patchToHunk(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text === '' || text.indexOf('@@') < 0) return null
      const lines = text.split('\n')
      let path = null
      /* The `--- `/`+++ ` file headers only exist above the first hunk; after
         it, such a line is a removed/added body line (`-- comment` renders as
         `--- comment`) and must be replayed, not dropped. */
      let inBody = false
      const oldText = []
      const newText = []
      for (const line of lines) {
        if (inBody === false && line.indexOf('+++ ') === 0) {
          const name = line.slice(4).split('\t')[0]
          if (name !== '/dev/null') path = name.replace(/^b\//, '')
          continue
        }
        if (inBody === false && line.indexOf('--- ') === 0) {
          if (path === null) {
            const name = line.slice(4).split('\t')[0]
            if (name !== '/dev/null') path = name.replace(/^a\//, '')
          }
          continue
        }
        if (line.indexOf('@@') === 0) { inBody = true; continue }
        if (line.indexOf('+') === 0) { newText.push(line.slice(1)); continue }
        if (line.indexOf('-') === 0) { oldText.push(line.slice(1)); continue }
        if (line.indexOf('\\') === 0) continue
        if (line.indexOf(' ') === 0) { oldText.push(line.slice(1)); newText.push(line.slice(1)); continue }
        // diff --git / index / new file mode / rename from ...: metadata above
        // the first hunk; anything else after it would be malformed.
        continue
      }
      if (path === null || path === '') return null
      // A patch without body lines (mode-only, bare metadata) replays into an
      // empty hunk that DiffBlock draws as nothing at all — keep the hand-drawn
      // rows for those, they at least show what happened.
      if (oldText.length === 0 && newText.length === 0) return null
      return { path: path, oldText: oldText.length === 0 ? null : oldText.join('\n'), newText: newText.join('\n') }
    }

    /* ============================== diff ============================== */

    function diffLines(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text.trim() === '') return []
      const raw = text.split('\n')
      const out = []
      let oldLine = 0
      let newLine = 0
      for (const line of raw) {
        let kind = 'ctx'
        if (line.indexOf('diff --git') === 0 || line.indexOf('index ') === 0 || line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0 || line.indexOf('new file') === 0 || line.indexOf('deleted file') === 0 || line.indexOf('similarity index') === 0 || line.indexOf('rename ') === 0) {
          kind = 'meta'
        } else if (line.indexOf('@@') === 0) {
          kind = 'hunk'
          const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
          // The @@ header names the FIRST content line (git semantics), but the
          // counters below are PRE-INCREMENTED before they land in a row — so
          // seed one less. Off by one otherwise: v0.13.3's hand-drawn gutter
          // numbered every line one too high (surfaced by the selection core).
          if (match !== null) { oldLine = Number.parseInt(match[1], 10) - 1; newLine = Number.parseInt(match[2], 10) - 1 }
        } else if (line.indexOf('+') === 0) { kind = 'add'; newLine += 1 }
        else if (line.indexOf('-') === 0) { kind = 'del'; oldLine += 1 }
        else if (line.indexOf('\\') === 0) { kind = 'meta' }
        else { oldLine += 1; newLine += 1 }
        out.push({
          kind, text: line,
          oldLine: kind === 'add' || kind === 'meta' || kind === 'hunk' ? null : oldLine,
          newLine: kind === 'del' || kind === 'meta' || kind === 'hunk' ? null : newLine,
        })
      }
      return out
    }

    /* ---- diff selection core
       Pure line-number plumbing for the diff-pane context menu (v0.13.5).
       The host DiffBlock draws rows WITHOUT line-number attributes — a row is
       `<div class={line + kindClass}>{row.text}</div>` (DiffBlock.tsx:204) and
       the `+`/`-`/two-space prefixes live in CSS `::before` content — so the
       menu reconstructs numbers by replaying the ROW KINDS in document order
       from the patch's first hunk header. The hand-drawn rows already carry
       parsed numbers (diffLines above). Kept DOM-free between the markers so
       tests/smoke.mjs can slice the block and drive the real implementation. */

    const DIFF_SNIPPET_MAX = 600

    /* First hunk header of a single-file patch → the absolute numbers the
       replay starts from (`@@ -a,b +c,d @@`: a/c are the sides' first lines).
       A patch without any header (binary, mode-only) has no coordinates. */
    function hunkStartOf(patch) {
      const headers = hunkHeadersOf(patch)
      return headers === null ? null : headers[0]
    }

    /* Every hunk header in patch order: a multi-hunk diff restarts BOTH
       counters at each `@@` line, so the replay needs one seed per hunk. */
    function hunkHeadersOf(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text.indexOf('@@') < 0) return null
      const headers = []
      const pattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm
      let match = pattern.exec(text)
      while (match !== null) {
        headers.push({ oldLine: Number.parseInt(match[1], 10), newLine: Number.parseInt(match[2], 10) })
        match = pattern.exec(text)
      }
      return headers.length === 0 ? null : headers
    }

    /* getComputedStyle(el, '::before').content → the row kind DiffBlock
       paints: `- ` del, `+ ` add, two spaces context, nothing for path/gap
       chrome. Browsers quote the value ("+ "); strip quotes before comparing. */
    function beforeContentKind(content) {
      if (typeof content !== 'string') return null
      const value = content.length >= 2 && content.charAt(0) === '"' && content.charAt(content.length - 1) === '"'
        ? content.slice(1, -1)
        : content
      if (value === '- ') return 'del'
      if (value === '+ ') return 'add'
      if (value === '  ') return 'ctx'
      return null
    }

    /* Replay kinds[0..to] (document order), collecting the span covered by
       kinds[from..to]. Each hunk restarts BOTH counters from its own header:
       a chrome row (path/gap, kind null) marks the boundary, and the next
       content row consumes the NEXT header in patch order — the path row at
       the top then the gap rows between hunks. New-side numbers win; a purely
       deleted span reports the OLD numbers with old: true — deleted rows
       exist on that side only. */
    function lineSpanFromKinds(kinds, from, to, headers) {
      if (Array.isArray(kinds) === false || Array.isArray(headers) === false || headers.length === 0) return null
      if (!(from >= 0 && to >= from && to < kinds.length)) return null
      let headerIndex = 0
      let oldLine = 0
      let newLine = 0
      let started = false
      let newFrom = null
      let newTo = null
      let oldFrom = null
      let oldTo = null
      for (let index = 0; index <= to; index += 1) {
        const kind = kinds[index]
        if (kind !== 'del' && kind !== 'add' && kind !== 'ctx') {
          started = false // chrome row: the next content row starts a new hunk
          continue
        }
        if (started === false) {
          if (headerIndex >= headers.length) break // more hunks than headers: stop, don't guess
          const header = headers[headerIndex]
          headerIndex += 1
          oldLine = header.oldLine
          newLine = header.newLine
          started = true
        }
        let oldHit = null
        let newHit = null
        if (kind === 'del') { oldHit = oldLine; oldLine += 1 }
        else if (kind === 'add') { newHit = newLine; newLine += 1 }
        else { oldHit = oldLine; newHit = newLine; oldLine += 1; newLine += 1 }
        if (index >= from) {
          if (oldHit !== null) { oldFrom = oldFrom === null ? oldHit : oldFrom; oldTo = oldHit }
          if (newHit !== null) { newFrom = newFrom === null ? newHit : newFrom; newTo = newHit }
        }
      }
      if (newFrom !== null) return { start: newFrom, end: newTo === null ? newFrom : newTo, old: false }
      if (oldFrom !== null) return { start: oldFrom, end: oldTo === null ? oldFrom : oldTo, old: true }
      return null
    }

    /* The hand-drawn rows already carry parsed numbers: reduce the selected
       row range exactly like lineSpanFromKinds reduces replayed kinds. */
    function rowSpanOfRows(rows, from, to) {
      if (Array.isArray(rows) === false) return null
      if (!(from >= 0 && to >= from && to < rows.length)) return null
      let newFrom = null
      let newTo = null
      let oldFrom = null
      let oldTo = null
      for (let index = from; index <= to; index += 1) {
        const row = rows[index]
        if (row === undefined || row === null) continue
        const newHit = typeof row.newLine === 'number' ? row.newLine : null
        const oldHit = typeof row.oldLine === 'number' ? row.oldLine : null
        if (newHit !== null) { newFrom = newFrom === null ? newHit : newFrom; newTo = newHit }
        if (oldHit !== null) { oldFrom = oldFrom === null ? oldHit : oldFrom; oldTo = oldHit }
      }
      if (newFrom !== null) return { start: newFrom, end: newTo === null ? newFrom : newTo, old: false }
      if (oldFrom !== null) return { start: oldFrom, end: oldTo === null ? oldFrom : oldTo, old: true }
      return null
    }

    /* '7' or '7–9' — the {lines} value the payload templates receive. */
    function linesLabelOf(start, end) {
      return start === end ? String(start) : String(start) + '–' + String(end)
    }

    /* The localized line-span fragment the payload templates embed: new-side
       numbers read plain, old-side numbers say so instead of pretending. */
    function lineSpanLabelOf(t, span) {
      const lines = linesLabelOf(span.start, span.end)
      return fill(t(span.old === true ? 'send.diffOldLines' : 'send.diffNewLines'), { lines: lines })
    }

    /* The self-describing line reference text for one resolved span.
       Commit context carries hash + subject (truncated like the commit send)
       and the HEAD branch; the worktree pane says staged or uncommitted. */
    function diffSpanTextOf(t, context, span, branchName) {
      const lines = lineSpanLabelOf(t, span)
      if (context === null || context === undefined || context.kind !== 'commit') {
        return fill(t('send.diffLinesWorktree'), {
          lines: lines,
          state: t(context !== null && context !== undefined && context.staged === true ? 'send.diffStaged' : 'send.diffUnstaged'),
        })
      }
      const subject = typeof context.subject === 'string' ? context.subject.trim().slice(0, 60) : ''
      return fill(t('send.diffLinesCommit'), {
        lines: lines,
        hash: typeof context.hash === 'string' && context.hash !== '' ? context.hash.slice(0, 7) : '—',
        subject: subject === '' ? '—' : subject,
        branch: typeof branchName === 'string' && branchName !== '' ? branchName : '—',
      })
    }

    /* ---- end diff selection core */

    /* ---------- DOM side of the diff-pane context menu (browser only) ----------
       SSR never calls these: they run inside the pane's onContextMenu, after
       the selection has been captured. The row element under a selection
       endpoint is either a hand-drawn `.git4idea-diff-line`, or a DiffBlock row —
       a div child of the body whose OWN parent carries the `data-diff`
       marker. `data-diff` is a component attribute (DiffBlock.tsx:199), not a
       hashed CSS-module class, so the lookup does not bet on build-time class
       renaming; the row KIND comes from the `::before` content the kinds are
       painted with, for the same reason. */

    function savedSelectionOf() {
      try {
        const selection = window.getSelection()
        if (selection === null || selection.rangeCount === 0) return null
        const text = String(selection)
        if (text === '') return null
        return { text: text, range: selection.getRangeAt(0).cloneRange() }
      } catch (error) { void error; return null }
    }

    function selectionRowOf(node) {
      let element = node === null || node === undefined ? null
        : node.nodeType === 3 ? (node.parentElement === null ? null : node.parentElement)
        : node.nodeType === 1 ? node
        : null
      for (let hop = 0; element !== null && element !== undefined && hop < 8; hop += 1) {
        if (element.classList !== undefined && element.classList.contains('git4idea-diff-line') === true) {
          return { kind: 'drawn', row: element, body: element.parentElement }
        }
        const parent = element.parentElement
        if (parent !== null && parent.getAttribute !== undefined && parent.hasAttribute('data-diff') === false) {
          const root = parent.parentElement
          if (root !== null && root.getAttribute !== undefined && root.hasAttribute('data-diff') === true) {
            return { kind: 'host', row: element, body: parent }
          }
        }
        element = parent
      }
      return null
    }

    /* The rendered rows of a DiffBlock body, with the kind each one paints.
       The (never-rendered at this panel's maxLines) fold toggle is a button,
       not a div — skipped so it cannot shift the row indexes. */
    function hostRowKinds(body) {
      const children = body === null || body === undefined ? [] : body.children
      const rows = []
      const kinds = []
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (child === null || child === undefined || child.tagName === 'BUTTON') continue
        rows.push(child)
        let kind = null
        try { kind = beforeContentKind(window.getComputedStyle(child, '::before').content) } catch (error) { void error; kind = null }
        kinds.push(kind)
      }
      return { rows: rows, kinds: kinds }
    }

    /* { kind: 'lines', span } for a selection inside ONE diff body, or
       { kind: 'snippet' } when the rows are there but the numbers cannot be
       reconstructed. null (rows missing entirely) means "not a diff
       selection": the menu keeps its old behaviour. */
    function resolveDiffSelection(patch, saved) {
      if (saved === null || saved === undefined || saved.text === '' || saved.range === null || saved.range === undefined) return null
      const from = selectionRowOf(saved.range.startContainer)
      const to = selectionRowOf(saved.range.endContainer)
      if (from === null || to === null) return null
      if (from.kind !== to.kind || from.body !== to.body) return { kind: 'snippet', text: saved.text }
      let span = null
      if (from.kind === 'drawn') {
        const rows = diffLines(patch)
        const all = from.body === null || from.body === undefined ? [] : Array.prototype.slice.call(from.body.querySelectorAll('.git4idea-diff-line'))
        const fromIndex = all.indexOf(from.row)
        const toIndex = all.indexOf(to.row)
        if (fromIndex >= 0 && toIndex >= 0) span = rowSpanOfRows(rows, Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex))
      } else {
        const headers = hunkHeadersOf(patch)
        if (headers !== null) {
          const collected = hostRowKinds(from.body)
          const fromIndex = collected.rows.indexOf(from.row)
          const toIndex = collected.rows.indexOf(to.row)
          if (fromIndex >= 0 && toIndex >= 0) {
            span = lineSpanFromKinds(collected.kinds, Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex), headers)
          }
        }
      }
      if (span === null) return { kind: 'snippet', text: saved.text }
      return { kind: 'lines', span: span, text: saved.text }
    }


    /* DiffBlock's own 16-line cap would REPLACE scrolling with a fold button;
       this panel keeps the old contract (render everything, scroll inside the
       .git4idea-diff-pane max-height), so the cap is pushed out of reach and the
       fold labels below are placeholders that never render at this size. */
    const DIFF_BLOCK_MAX_LINES = 1000000

    function diffLabelsOf(t) {
      return {
        codeLabel: t('diff.codeLabel'),
        wrapLabel: t('diff.wrapLabel'),
        unwrapLabel: t('diff.unwrapLabel'),
        copy: t('diff.copy'),
        copied: t('diff.copied'),
        collapseAria: 'Collapse diff',
        expandAria: (hidden) => 'Show ' + String(hidden) + ' more diff lines',
        collapse: 'Show less',
        expand: (hidden) => 'Show ' + String(hidden) + ' more',
      }
    }

    function DiffBody(props) {
      const rows = useMemo(() => diffLines(props.patch), [props.patch])
      if (props.loading === true) return E('div', { className: 'git4idea-empty' }, props.t('diff.loading'))
      if (props.binary === true) return E('div', { className: 'git4idea-empty' }, props.t('diff.binary'))
      if (rows.length === 0) return E('div', { className: 'git4idea-empty' }, props.t('diff.empty'))
      /* Host-rendered first (v0.14): the ui-primitives diff card brings the
         shared toolbar (copy / wrap / language) and the product's diff colors.
         A patch we cannot replay into a hunk (binary, mode-only) or a host
         without the seed module falls back to the hand-drawn rows below. This
         IS the official diff renderer (the platform seed table ships it, the
         host's own surfaces render diffs through it) — the external preview
         tab uses the same one, so every diff in the product reads alike. */
      if (UIPrimitives !== null && typeof UIPrimitives.DiffBlock === 'function') {
        const hunk = patchToHunk(props.patch)
        if (hunk !== null) {
          return E('div', { className: 'git4idea-diff-host' },
            E(UIPrimitives.DiffBlock, {
              diffs: [hunk],
              labels: diffLabelsOf(props.t),
              maxLines: DIFF_BLOCK_MAX_LINES,
              className: 'git4idea-diff-card',
            }))
        }
      }
      return E('div', { className: 'git4idea-diff' }, rows.map((row, index) => E('div', { key: index, className: 'git4idea-diff-line git4idea-diff-' + row.kind },
        E('span', { className: 'git4idea-diff-gutter' }, row.oldLine === null ? '' : String(row.oldLine)),
        E('span', { className: 'git4idea-diff-gutter' }, row.newLine === null ? '' : String(row.newLine)),
        E('span', { className: 'git4idea-diff-text' }, row.text === '' ? ' ' : row.text),
      )))
    }

    /* ---- external preview diff (v0.14.3): a faithful port of the review view ----
       ReviewTab + FileDiff (ui-deliverables) are the reference; every building
       block that package imports from the platform seed is reused here
       verbatim: Menu / PathLabel / Tooltip / the split, wrap, inspect and
       chevron icons, useCodeHighlighter, languageForPath, and the file-diff
       alias tokens. Only the layer the official bundle boundary hides — the
       row layout, the hunk parser, the review-store-free state — lives in
       this file, and it follows the source file by file: header anatomy and
       CSS from ReviewTab.tsx + ReviewTab.module.css, rows/hunks/highlights
       from FileDiff.tsx + FileDiff.module.css. When ui-deliverables
       re-exports FileDiff (see the host-follow note in AGENTS.md), this whole
       block retires in favor of a plain import of the deliverables
       package's re-exported FileDiff. */

    /* One hunk in the shape FileDiff consumes: {oldStart, oldLines, newStart,
       newLines, lines[]} where lines keep their +/-/space prefix. oldLines and
       newLines are COUNTED from content (git omits the count when it is 1),
       exactly what the reconstructed @@ header needs. */
    function parseHunks(body) {
      const text = typeof body === 'string' ? body : ''
      const out = []
      let current = null
      for (const line of text.split('\n')) {
        if (line.indexOf('@@') === 0) {
          const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
          if (match !== null) {
            if (current !== null && current.lines.length > 0) out.push(current)
            current = { oldStart: Number.parseInt(match[1], 10), newStart: Number.parseInt(match[3], 10), oldLines: 0, newLines: 0, lines: [] }
            continue
          }
        }
        if (current === null) continue
        const marker = line.charAt(0)
        if (marker === '+' || marker === '-' || marker === ' ' || line === '') {
          current.lines.push(line)
          if (marker === '+') current.newLines += 1
          else if (marker === '-') current.oldLines += 1
          else { current.oldLines += 1; current.newLines += 1 }
        } else if (line.indexOf('\\') === 0) {
          current.lines.push(line)
        }
      }
      if (current !== null && current.lines.length > 0) out.push(current)
      /* The patch's trailing newline parses as one empty context line; the
         review drops it, and so does this. */
      for (const hunk of out) {
        const last = hunk.lines[hunk.lines.length - 1]
        if (last === '' && hunk.lines.length > 1) {
          hunk.lines.pop()
          hunk.oldLines -= 1
          hunk.newLines -= 1
        }
      }
      return out
    }

    /* One file segment of a (possibly multi-file) patch: path, hunks, ±
       counts, and the file-level facts FileDiff's notes need. */
    function splitPatchFiles(patch) {
      const text = typeof patch === 'string' ? patch : ''
      if (text.trim() === '') return []
      const segments = []
      let current = null
      for (const line of text.split('\n')) {
        if (line.indexOf('diff --git ') === 0) {
          if (current !== null) segments.push(current)
          current = { path: '', meta: [], body: [], binary: false, created: false, removed: false }
          continue
        }
        if (current === null) continue
        if (line.indexOf('+++ ') === 0) current.path = line.slice(4) === '/dev/null' ? current.path : line.slice(4).replace(/^b\//, '')
        else if (current.path === '' && line.indexOf('--- a/') === 0) current.path = line.slice(6)
        if (line.indexOf('Binary files') === 0 || line.indexOf('Binary file') === 0) current.binary = true
        if (line.indexOf('new file mode') === 0) current.created = true
        if (line.indexOf('deleted file mode') === 0) current.removed = true
        if (line.indexOf('diff --git ') === 0 || line.indexOf('index ') === 0 || line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0 || line.indexOf('new file') === 0 || line.indexOf('deleted file') === 0 || line.indexOf('similarity index') === 0 || line.indexOf('rename ') === 0 || line.indexOf('old mode') === 0 || line.indexOf('new mode') === 0) current.meta.push(line)
        else current.body.push(line)
      }
      if (current !== null) segments.push(current)
      const out = []
      for (const segment of segments) {
        const hunks = parseHunks(segment.body.join('\n'))
        let adds = 0
        let dels = 0
        for (const hunk of hunks) {
          for (const line of hunk.lines) {
            if (line.indexOf('+') === 0) adds += 1
            else if (line.indexOf('-') === 0) dels += 1
          }
        }
        if (segment.path === '' && hunks.length === 0 && segment.binary === false) continue
        out.push({ path: segment.path, binary: segment.binary, created: segment.created, removed: segment.removed, hunks: hunks, adds: adds, dels: dels })
      }
      return out
    }

    /* ---- pure ports of FileDiff.tsx's exported row functions ---- */

    /* Number a hunk's lines: context lines count on both sides, deletions on
       the old side, additions on the new side. */
    function hunkRows(hunk) {
      let oldNo = hunk.oldStart
      let newNo = hunk.newStart
      return hunk.lines.map((line) => {
        const body = line.slice(1)
        if (line.indexOf('+') === 0) return { kind: 'add', old: undefined, new: newNo++, text: body }
        if (line.indexOf('-') === 0) return { kind: 'del', old: oldNo++, new: undefined, text: body }
        return { kind: 'context', old: oldNo++, new: newNo++, text: body }
      })
    }

    /* Pair a hunk's lines for the side-by-side view: each run of deletions is
       aligned with the run of additions that follows it, row by row, and
       context lines sit on both sides. */
    function splitRows(hunk) {
      const rows = []
      let dels = []
      let adds = []
      const flush = () => {
        for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
          const left = dels[at]
          const right = adds[at]
          rows.push(Object.assign(left === undefined ? {} : { left: left }, right === undefined ? {} : { right: right }))
        }
        dels = []
        adds = []
      }
      for (const row of hunkRows(hunk)) {
        if (row.kind === 'del') dels.push({ no: row.old, text: row.text, kind: 'del' })
        else if (row.kind === 'add') adds.push({ no: row.new, text: row.text, kind: 'add' })
        else {
          flush()
          rows.push({ left: { no: row.old, text: row.text, kind: 'context' }, right: { no: row.new, text: row.text, kind: 'context' } })
        }
      }
      flush()
      return rows
    }

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
      return E('div', { className: 'git4idea-lf-root' },
        E('div', { className: 'git4idea-lf-header' },
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
              file.created === true ? E('p', { className: 'git4idea-lf-note' }, t('lf.created')) : null,
              file.removed === true ? E('p', { className: 'git4idea-lf-note' }, t('lf.removedFile')) : null,
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
        const bounds = props.boundsWidth === undefined ? 0 : props.boundsWidth
        /* Direction only — the flush offset is CSS (`left:100%` / `right:100%`
           against the wrapper, whose width IS the parent card), so the seam is
           zero no matter how wide the submenu actually renders. */
        const flip = bounds > 0 && position.left + cardRect.width + 220 > bounds - 4
        /* m04915: the folded branch list needs more rows than the parent card
           allows. The submenu takes its own height budget from the viewport
           instead of inheriting the parent's 320px cap, so a long branch list
           shows in one go and only then scrolls. */
        const height = props.boundsHeight === undefined || props.boundsHeight <= 0 ? window.innerHeight : props.boundsHeight
        const room = Math.max(180, Math.min(440, height - itemRect.top - 16))
        setSub({ items: item.items, flip: flip, top: Math.max(0, itemRect.top - cardRect.top - 4), maxHeight: room })
      }
      const renderItem = (item, index, inSub) => {
        if (item === null) return E('div', { key: 'sep-' + index, className: 'git4idea-menu-sep' })
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
        sub === null ? null : E('div', { className: 'git4idea-menu git4idea-menu-sub', 'data-menu-material': 'translucent', style: Object.assign({ maxHeight: sub.maxHeight === undefined ? undefined : sub.maxHeight + 'px' }, sub.flip === true ? { right: '100%', top: sub.top + 'px' } : { left: '100%', top: sub.top + 'px' }) },
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
      const label = props.label + ': ' + (current === undefined ? '' : current.label)
      return E('button', {
        type: 'button',
        className: 'git4idea-filter-select' + (props.value === '' ? '' : ' git4idea-filter-on'),
        'data-tip': props.hint === undefined ? label : props.hint,
        onClick: (event) => { if (props.onOpenMenu !== undefined) props.onOpenMenu(event, options) },
      },
        E('span', { className: 'git4idea-filter-label' }, label),
        E(Icon, { name: 'chevron', size: 11 }))
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
        /* data-lane feeds the hover highlight: the scroll container copies the
           hovered row's lane into data-hover-lane, and generated CSS dims every
           graph stroke whose data-lane differs — zero React re-renders. */
        'data-lane': String(props.row.lane),
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
      const [order, setOrder] = useState('desc')
      const [pathDraft, setPathDraft] = useState(props.pathFilter === undefined ? '' : props.pathFilter)

      useEffect(() => { setPathDraft(props.pathFilter === undefined ? '' : props.pathFilter) }, [props.pathFilter])

      const authors = useMemo(() => {
        const found = []
        for (const commit of commits) {
          if (typeof commit.author === 'string' && commit.author !== '' && found.indexOf(commit.author) < 0) found.push(commit.author)
        }
        return found.sort()
      }, [commits])

      const refOptions = useMemo(() => {
        const found = []
        for (const commit of commits) {
          const list = Array.isArray(commit.refs) ? commit.refs : []
          for (const entry of list) {
            const info = refInfo(entry)
            if (info.kind !== 'head' && found.indexOf(info.name) < 0) found.push(info.name)
          }
        }
        return found.sort()
      }, [commits])

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
        return order === 'asc' ? kept.slice().reverse() : kept
      }, [commits, text, author, refName, since, order])

      const rows = useMemo(() => buildRows(filtered), [filtered])

      /* Weibo-style infinite scroll (v0.19.3): descending lists auto-load when
         the user scrolls near the bottom edge, ascending ones near the top
         edge — wheel and scrollbar drags both surface as scroll events, no
         extra clicks. The button stays as the visible affordance. The guard
         keeps one request in flight; it resets when busy settles. */
      const infiniteGuardRef = useRef(false)
      const growAnchorRef = useRef(null)
      const mergeLocatedRef = useRef(false)
      const requestMore = () => {
        if (props.hasMore !== true || props.busy === true || infiniteGuardRef.current === true) return
        const host = historyScrollRef.current
        growAnchorRef.current = { length: rows.length, height: host === null ? 0 : host.scrollHeight }
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
      }, [props.hasMore, order, rows.length])
      /* Ascending growth inserts rows above the viewport: re-anchor by the
         height delta so the rows the user was reading stay put. */
      useEffect(() => {
        const anchor = growAnchorRef.current
        if (anchor === null || rows.length <= anchor.length) return
        growAnchorRef.current = null
        const host = historyScrollRef.current
        if (order !== 'asc' || host === null) return
        host.scrollTop = host.scrollTop + (host.scrollHeight - anchor.height)
      }, [rows.length, order])
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
      const dirtyFilter = text !== '' || author !== '' || refName !== '' || since !== '' || (props.pathFilter !== undefined && props.pathFilter !== '')
      const applyPath = (value) => { if (props.onPathFilter !== undefined) props.onPathFilter(value) }
      const clearAll = () => {
        setText('')
        setAuthor('')
        setRefName('')
        setSince('')
        setPathDraft('')
        applyPath('')
      }

      /* Every filter opens the same in-panel menu; a checked row marks the active
        value, so the button never has to spell the whole list out. */
        const openFilterMenu = (event, options, currentValue, onPick, fold) => {
          if (props.openMenuAt === undefined) return
          const leafOf = (option, label) => ({
            id: 'filter:' + String(option.value),
            /* Only the checked row carries a mark (m04507); the unselected ones
               used to draw a decorative icon, which read as a tick column. */
            icon: option.value === currentValue ? 'check' : undefined,
            tone: 'accent',
            label: label === undefined ? option.label : label,
            active: option.value === currentValue,
            run: () => onPick(option.value),
          })
          if (fold !== true) {
            props.openMenuAt(event, options.map((option) => leafOf(option)))
            return
          }
          /* Branch names fold on their first '/' so a long remote list does not
             run off the menu (m04510). A folder row opens the rest of the name
             in a submenu; a name without '/' stays a plain row. */
          const rows = []
          const dirs = new Map()
          for (const option of options) {
            const value = String(option.value)
            const cut = value.indexOf('/')
            if (cut <= 0) {
              rows.push(leafOf(option))
              continue
            }
            const dir = value.slice(0, cut)
            let row = dirs.get(dir)
            if (row === undefined) {
              row = { id: 'filter-dir:' + dir, icon: 'folder', tone: 'secondary', label: dir, items: [] }
              dirs.set(dir, row)
              rows.push(row)
            }
            row.items.push(leafOf(option, value.slice(cut + 1)))
          }
          props.openMenuAt(event, rows)
        }
        const allOption = { value: '', label: t('filter.all') }
        const filterBar = props.hideSearch === true ? null : E('div', { className: 'git4idea-filters' },
        E('input', {
          className: 'git4idea-input git4idea-input-compact git4idea-filter-text', value: text, spellCheck: false,
          placeholder: t('history.filter'),
          onChange: (event) => setText(event.target.value),
        }),
        E(FilterSelect, {
          label: t('filter.branch'), value: refName, hint: t('filter.branch'),
          options: [allOption].concat(refOptions.map((name) => ({ value: name, label: name }))),
          onOpenMenu: (event, options) => openFilterMenu(event, options, refName, setRefName, true),
        }),
        E(FilterSelect, {
          label: t('filter.user'), value: author, hint: t('filter.user'),
          /* "Me" first (v0.19.3): resolved from git config and offered even
             when this branch has no commits of mine — selecting it over an
             empty list is the answer "I never committed here". */
          options: [allOption]
            .concat(me !== null && me.name !== '' ? [{ value: me.name, label: t('history.me') + ' (' + me.name + ')' }] : [])
            .concat(authors.map((name) => ({ value: name, label: name }))),
          onOpenMenu: (event, options) => openFilterMenu(event, options, author, setAuthor),
        }),
        E(FilterSelect, {
          label: t('filter.date'), value: since, hint: t('filter.date'),
          options: [allOption,
            { value: 'today', label: t('filter.today') },
            { value: 'week', label: t('filter.week') },
            { value: 'month', label: t('filter.month') },
            { value: 'year', label: t('filter.year') }],
          onOpenMenu: (event, options) => openFilterMenu(event, options, since, setSince),
        }),
        E('form', {
          className: 'git4idea-filter-path',
          onSubmit: (event) => { event.preventDefault(); applyPath(pathDraft.trim()) },
        }, E('input', {
          className: 'git4idea-input git4idea-input-compact', value: pathDraft, spellCheck: false,
          placeholder: t('filter.pathPlaceholder'),
          onChange: (event) => setPathDraft(event.target.value),
        })),
        E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small',
          'data-tip': order === 'desc' ? t('filter.sortDesc') : t('filter.sortAsc'),
          onClick: () => setOrder(order === 'desc' ? 'asc' : 'desc'),
        }, E(Icon, { name: order === 'desc' ? 'down' : 'up', size: 12 })),
        dirtyFilter ? E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small', 'data-tip': t('filter.clear'),
          onClick: clearAll,
        }, E(Icon, { name: 'close', size: 12 })) : null)

      /* Windowed rendering: only the visible slice (± overscan) is mounted —
         "load more" into the hundreds still scrolls at frame rate. Spacers
         keep the scrollbar and the load-more button at honest positions. */
      const winStart = Math.max(0, Math.floor(viewport.scrollTop / HISTORY_ROW_H) - WINDOW_OVERSCAN)
      const winEnd = Math.min(rows.length, winStart + Math.ceil(viewport.viewH / HISTORY_ROW_H) + WINDOW_OVERSCAN * 2)
      const visibleRows = rows.slice(winStart, winEnd)

      /* Ascending renders oldest-first, so load-more (older commits) lives
         at the TOP; descending keeps it at the bottom where it always was. */
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
          /* Lane hover highlight (GitLens-style trace): copy the hovered row's
             lane into data-hover-lane; generated CSS dims every stroke whose
             data-lane differs. Direct DOM dataset writes on purpose — the
             alternative is re-rendering every row on each hover change. */
          onMouseOver: (event) => {
            const host = event.currentTarget
            const row = event.target instanceof Element ? event.target.closest('.git4idea-commit') : null
            const lane = row === null ? null : row.getAttribute('data-lane')
            if (lane === host.getAttribute('data-hover-lane')) return
            if (lane === null) host.removeAttribute('data-hover-lane')
            else host.setAttribute('data-hover-lane', lane)
          },
          onMouseLeave: (event) => event.currentTarget.removeAttribute('data-hover-lane'),
        },
          rows.length === 0 ? E('div', { className: 'git4idea-empty' }, dirtyFilter ? t('filter.none') : t('history.empty')) : null,
          order === 'asc' ? loadMoreButton : null,
          winStart > 0 ? E('div', { key: 'pad-top', style: { height: String(winStart * HISTORY_ROW_H) + 'px' } }) : null,
          visibleRows.map((row) => E(CommitRow, {
            key: row.commit.hash,
            commit: row.commit, row: row, t: t,
            selected: props.selectedHash === row.commit.hash
              || (props.pickedHashes !== undefined && props.pickedHashes.has(row.commit.hash) === true),
            onRowClick: handleRowClick, onMenu: props.onMenu, openMenuAt: props.openMenuAt,
          })),
          winEnd < rows.length ? E('div', { key: 'pad-bottom', style: { height: String((rows.length - winEnd) * HISTORY_ROW_H) + 'px' } }) : null,
          order === 'desc' ? loadMoreButton : null),
        E(MarqueeBox, { box: historyMarquee.box }))
    }

    /* One changed-file list for the commit detail pane AND the push dialog
       (m02986 follow-up): folders first, files indented under them — the IDE
       commit tree. The push dialog used a flat row without the capped path
       class, so a long path squeezed the file name to zero width and clipped
       the stat. Two renderers cannot drift back apart when there is one. */
    function CommitFileList(props) {
      const t = props.t
      const files = Array.isArray(props.files) ? props.files : []
      const byPath = (a, b) => a.path.localeCompare(b.path)
      const [folded, setFolded] = useState({})
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
      if (props.pane === true) {
        return E('div', { className: 'git4idea-detail git4idea-detail-pane' },
          E('div', { className: 'git4idea-detail-files-head' }, t('detail.files') + ' · ' + String(detail.files.length)),
          E('div', { className: 'git4idea-detail-files' }, fileRows),
          E('div', { className: 'git4idea-detail-msg' },
            E('div', { className: 'git4idea-detail-head' },
              E('span', { className: 'git4idea-mono' }, detail.shortHash),
              E('span', { className: 'git4idea-detail-author' }, detail.author),
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
          E('span', { className: 'git4idea-detail-author' }, detail.author),
          E('span', { className: 'git4idea-detail-date' }, shortDate(detail.date))),
        E('div', { className: 'git4idea-detail-subject' }, detail.subject),
        detail.body === undefined || detail.body.trim() === '' ? null : E('pre', { className: 'git4idea-detail-body' }, detail.body.trim()),
        refBlock,
        branchBlock,
        E('div', { className: 'git4idea-detail-files-head' }, t('detail.files') + ' · ' + String(detail.files.length)),
        E('div', { className: 'git4idea-detail-files' }, fileRows))
    }

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
    /* The branch bar rides below the tab strip (m00174); the panel hands it in
       so the two rows keep one React owner. */
    props.topBar === undefined ? null : props.topBar,
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
    /* ============================== panel ============================== */

    function Panel(props) {
      const scope = props.scope
      const t = props.t
      const hostRef = useRef(null)
      const railHostRef = useRef(null)
      const [size, setSize] = useState({ width: 0, height: 0 })
      const [repoState, setRepoState] = useState(null)
      const [repoRoot, setRepoRoot] = useState(null)
      const [summary, setSummary] = useState(null)
      // Ignored files are opt-in: --ignored walks the ignore rules, and nobody
      // needs node_modules listed while they are writing a commit message.
      const [showIgnored, setShowIgnored] = useState(false)
      const [branches, setBranches] = useState(null)
      const [commits, setCommits] = useState([])
      const [hasMore, setHasMore] = useState(false)
      /* m02407 #3: the result strip above the body is gone. Failures and the
         outcome of a background git command become notifications in the
         bottom-right stack instead. The sink is a ref because the callbacks that
         report (the guard, the loaders) are declared above the toast plumbing. */
      const notifySink = useRef(null)
      const setError = useCallback((text) => {
        if (text === undefined || text === null || String(text) === '') return
        if (notifySink.current !== null) notifySink.current(String(text), 'error')
      }, [])
      const setNote = useCallback((text) => {
        if (text === undefined || text === null || String(text) === '') return
        if (notifySink.current !== null) notifySink.current(String(text), 'info')
      }, [])
      const [busy, setBusy] = useState(false)
      const [view, setView] = useState('history')
      /* Pane sizes are remembered per surface (see the pane sizing core). The ref
         is the value the pointer handlers write through: a drag updates state for
         the preview and the ref for the single write that pointerup performs. */
      const [panes, setPanes] = useState(readPanes)
      const panesRef = useRef(panes)
      const [treeOpen, setTreeOpen] = useState(panes.treeOpen)
      const [paneDragging, setPaneDragging] = useState(null)
      const [paneSizes, setPaneSizes] = useState({})
      /* The float pane this panel is drawn in, or null while it is docked. The
         dock face exposes operations only, so the state comes from the float
         layer's own marker around this panel — the same marker carries the pane
         id dock() needs to put it back. */
      const [floatPaneId, setFloatPaneId] = useState(null)
      const bodyRef = useRef(null)
      const [bodyBox, setBodyBox] = useState({ width: 0, height: 0 })
      const [detail, setDetail] = useState(null)
      const [selectedHash, setSelectedHash] = useState(null)
      const [selectedPath, setSelectedPath] = useState(null)
      const [patch, setPatch] = useState('')
      const [patchLoading, setPatchLoading] = useState(false)
      /* What the open diff pane shows (v0.13.5): the pane is shared by the
         commit detail (hash + subject) and the working tree (staged or not),
         and the selection menu's payload must say which. Cleared everywhere
         the patch is cleared. */
      const [diffContext, setDiffContext] = useState(null)
      /* ---- multi-select (issue #13): the change list's selection lives here
         so the right-click menu, the keyboard and the selection bar act on one
         set; the branch tree and the history keep theirs closer to their rows
         (BranchTree-internal / pickedCommits below). ---- */
      const [changeSelection, setChangeSelection] = useState(() => new Set())
      const changeAnchor = useRef(null)
      const [pickedCommits, setPickedCommits] = useState(() => new Set())
      /* The branch tree reports its picks up (onPicksChange) so the rail can act
         on the selection: "select main, press pull" must pull main, not HEAD. */
      const [branchPicks, setBranchPicks] = useState(() => new Set())
      /* v0.19.4: the three lists' selections are mutually exclusive — a pick in
         one list (row click or rubber band) clears the other two, and a blank
         click inside a list clears everything too. Each interaction bumps the
         OTHER lists' epoch counters; the effects below (and a clearSignal prop
         into BranchTree, whose picks live inside it) reset on change. Epochs
         are monotonic and start at 0, so the mount pass clears nothing. */
      const [pickEpochs, setPickEpochs] = useState(() => ({ changes: 0, history: 0, tree: 0 }))
      const clearPicksExcept = useCallback((owner) => {
        setPickEpochs((previous) => ({
          changes: owner === 'changes' ? previous.changes : previous.changes + 1,
          history: owner === 'history' ? previous.history : previous.history + 1,
          tree: owner === 'tree' ? previous.tree : previous.tree + 1,
        }))
      }, [])
      useEffect(() => { if (pickEpochs.changes > 0) setChangeSelection(new Set()) }, [pickEpochs.changes])
      useEffect(() => { if (pickEpochs.history > 0) setPickedCommits(new Set()) }, [pickEpochs.history])
      /* Forwarders: the raw setters wrapped so EVERY selection gesture reports
         an owner. The updates arrive either as a Set or as a functional
         updater (the memoised rows hold stale closures) — forwarded as-is. */
      const onBranchPicks = useCallback((update) => { setBranchPicks(update); clearPicksExcept('tree') }, [clearPicksExcept])
      const onChangeSelection = useCallback((update) => { setChangeSelection(update); clearPicksExcept('changes') }, [clearPicksExcept])
      const onCommitPicks = useCallback((update) => { setPickedCommits(update); clearPicksExcept('history') }, [clearPicksExcept])
      const [menu, setMenu] = useState(null)
      const [dialog, setDialog] = useState(null)
      const [tick, setTick] = useState(0)
      const [favTick, setFavTick] = useState(0)
      const [pathFilter, setPathFilter] = useState('')
      const [railConfig] = useState(readRailConfig)
      const [railBox, setRailBox] = useState({ width: 0, height: 0 })

      /* ---------- toast plumbing ---------- */
      /* Declared early on purpose: the guard, the loaders and every menu builder
         close over pushToast, and a hooks dependency array is evaluated during
         render (invariant 12) — the plumbing has to exist before them, and the
         sink effect has to run before the first load reports a failure. The
         queue itself is the frame-wide store (m02986), so the same five-second
         rule covers notifications raised by the overlay dialogs too. */
      const dropToast = useCallback((id) => { toastCenter.drop(id) }, [])

      const pushToast = useCallback((toast) => toastCenter.push(toast), [])

      /* The guard and the loaders report through setError/setNote; both feed
         this sink so every failure and every background result lands in the
         bottom-right stack instead of a strip above the panes. */
      useEffect(() => {
        notifySink.current = (text, tone) => {
          pushToast({ text: text, tone: tone, icon: tone === 'error' ? 'close' : 'check' })
        }
        return () => { notifySink.current = null }
      }, [pushToast])
      const cwd = typeof scope.cwd === 'string' && scope.cwd !== '' ? scope.cwd : undefined
      const sessionId = typeof scope.sessionId === 'string' ? scope.sessionId : 'default'
      const base = useMemo(() => ({ cwd: cwd, repoRoot: repoRoot === null ? undefined : repoRoot }), [cwd, repoRoot])

      /* Layout effect ON PURPOSE: the chrome (compact/columns/stack) and the
         rail capacity derive from these numbers, and a paint-then-correct
         cycle showed up on every seat switch as buttons lighting up one by
         one (v0.13.1 report). Measuring in the commit phase keeps the first
         paint on the final chrome. */
      useMeasureLayoutEffect(() => {
        const element = hostRef.current
        if (element === null) return undefined
        const measure = () => {
          const rect = element.getBoundingClientRect()
          setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [])

      // Width decides: a wide container is a three-column workbench even when it is
      // short (the bottom panel is 1500x300 and still wants tree | graph | changes).
      // Only a genuinely tiny container (very narrow or very short) falls back to
      // the compact one-header chrome.
      // Width alone decides WHICH SURFACE this is: the native right sidebar is
      // narrow (< 400) whatever its height, the bottom workbench is wide
      // whatever its height. Height must never select the tall-narrow chrome on
      // its own — v0.1.3 already made that mistake with a height < 330 test (a
      // 1500x300 workbench came out single-column) and v0.3.5 still let
      // height < 200 flip a 1320x180 workbench into the right-sidebar chrome.
      /* The immersive conversation seat (v0.14) hands the panel a SQUARE-ish
         box by construction: the conversation column clamps content width
         (~920px) while the seat fills the view's whole height, so the
         bottom-workbench-vs-sidebar ratio (`width >= height * 1.15`) can never
         hold there and the panel would flip to the stacked layout. The seat is
         a tool window — neither a horizontal dock nor a narrow rail — so it
         always takes the columns chrome (compact still wins: a truly narrow
         viewport keeps the single-row layout). */
      const [immersiveSeat, setImmersiveSeat] = useState(false)
      useMeasureLayoutEffect(() => {
        const node = hostRef.current
        const holder = node === null || typeof node.closest !== 'function' ? null : node.closest('.git4idea-conversation-seat[data-immersive="1"]')
        if (gateNestedLoop() === false) return
        setImmersiveSeat(holder !== null)
      })
      const compact = size.width > 0 && size.width < COMPACT_MAX_WIDTH
      const columns = (immersiveSeat === true && compact === false)
        || (!compact && size.width >= 600 && size.width >= size.height * 1.15)

      /* ---------- draggable panes (issue #5) ---------- */

      // Like the rail, the panes measure the box that actually holds them instead
      // of trusting the root probe: the column chrome keeps a vertical rail
      // beside the body, and the header sits above it.
      useMeasureLayoutEffect(() => {
        const element = bodyRef.current
        if (element === null) { setBodyBox({ width: 0, height: 0 }); return undefined }
        const measure = () => {
          const rect = element.getBoundingClientRect()
          setBodyBox({ width: Math.round(rect.width), height: Math.round(rect.height) })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [])

      const chrome = compact ? 'compact' : columns ? 'columns' : 'stack'
      const measured = bodyBox.width > 0 || bodyBox.height > 0
      const paneBox = measured ? bodyBox : size
      /* The column chrome's dividers are vertical LINES, and the panes they move
         are sized by width; the stacked chromes move heights. One name for that
         switch: it decides the divider's orientation, the inline size, the ratio
         reference and the drag cursor, and getting it half-right is how a height
         drag ends up writing a width. */
      const paneByWidth = PANE_HEIGHT_CHROME[chrome] !== true
      /* What the panes actually measure right now. The clamp needs the real box of
         the pane it is NOT moving: a content-sized pane is usually shorter than
         its own percentage cap, and reserving the cap would block the drag (or
         snap a stored size back on the next render). The markers are data
         attributes rather than class sniffing so the diff pane, nested inside the
         middle pane, is found the same way. */
      const measurePanes = () => {
        const found = {}
        const element = bodyRef.current
        if (element === null) return found
        for (const node of element.querySelectorAll('[data-pane]')) {
          const rect = node.getBoundingClientRect()
          // The diff pane is measured in HEIGHT under every chrome — it is
          // carved out of the middle pane, whose siblings may run sideways.
          const key = node.getAttribute('data-pane')
          found[key] = Math.round(key === 'diff' || paneByWidth === false ? rect.height : rect.width)
        }
        return found
      }
      /* Kept in state, not in a ref: a pane's box changes without the panel
         re-rendering (content arrives, a dock resizes), and the render that
         re-clamps a stored size has to see the same numbers the drag did — a drag
         allowed further than the render allows snaps back under the cursor. The
         bail-out comparison is what keeps this from looping. */
      /* A LAYOUT effect: on mount this runs before the first paint, so the
         fallback layout (paneGeometry's stylesheet/literal defaults) is
         replaced by the live one inside the same frame instead of being
         painted and then jumped a frame later. Painting both is the "height
         animation" on tab switches from issue #16 — two visible layouts ~80px
         apart read as a smooth resize in a low-fps screen recording. Later
         runs still track content arrival; the layout-phase cost is one
         querySelectorAll over the 3-4 panes the post-paint run already paid. */
      /* ---------- measurement loop fuse (issue #17) ---------- */

      /* Every effect below runs on EVERY render and feeds a state update.
         In a steady UI the bail-out comparisons stop the chain, but when the
         realized layout disagrees with the just-measured one — a float pane
         being created/resized on the desktop client hit exactly this — each
         render re-measures a DIFFERENT box, the update nests synchronously
         and React aborts at depth 50 with #185, leaving the pane white
         behind the host's slot boundary. The gate detects that nesting
         directly: runs are counted in a 40 ms window and a nested render
         loop (50 commits inside one task) trips it long before React's
         limit, while legitimate per-event work (a pointermove drag renders
         at most twice in 40 ms) never comes close. Skipping a measurement
         during a pathological burst only freezes the affected number until
         the next window — degraded ratios for a frame, never a white pane. */
      const measureGate = useRef({ n: 0, at: 0 })
      const gateNestedLoop = () => {
        const slot = measureGate.current
        const now = Date.now()
        if (now - slot.at > 40) { slot.at = now; slot.n = 0 }
        slot.n += 1
        return slot.n <= 6
      }

      useMeasureLayoutEffect(() => {
        const found = measurePanes()
        if (gateNestedLoop() === false) return
        setPaneSizes((current) => (samePaneSizes(current, found) ? current : found))
      })
      useEffect(() => {
        const node = hostRef.current
        const holder = node === null || typeof node.closest !== 'function' ? null : node.closest('[data-dockkit-float]')
        const next = holder === null ? null : holder.getAttribute('data-dockkit-float')
        if (gateNestedLoop() === false) return
        setFloatPaneId((current) => (current === next ? current : next))
      })
      const dock = props.dock === undefined ? null : props.dock
      const dockState = dockActionState(dock, floatPaneId)
      const paneLayout = paneGeometry(chrome, paneBox, panes, paneSizes)

      const commitPanes = (next) => {
        panesRef.current = next
        setPanes(next)
      }

      /* The gutter hands back the px it wants; the clamp lives here, and what
         gets stored is the ratio that reproduces it on this container. The live
         measurement is pushed into state alongside the new ratio, so the render
         that follows this gesture clamps with the very same box. */
      const dragPane = (key, rawPx) => {
        const live = measurePanes()
        setPaneSizes((current) => (samePaneSizes(current, live) ? current : live))
        const layout = paneGeometry(chrome, paneBox, panesRef.current, live)
        const limit = layout.limits[key]
        // The diff divides the body HEIGHT in every chrome (see paneGeometry).
        const reference = key === 'diff' ? paneBox.height : (paneByWidth ? paneBox.width : paneBox.height)
        if (limit === undefined || !(reference > 0)) return
        const px = Math.round(Math.min(Math.max(rawPx, limit.min), limit.max))
        commitPanes(withPaneRatio(panesRef.current, layout.bucket, key, px / reference))
      }

      /* One write per gesture (pointerup / keyboard nudge / double-click), not one
         per pointermove. */
      const endPaneDrag = () => {
        setPaneDragging(null)
        writePanes(panesRef.current)
      }

      const resetPane = (key) => {
        commitPanes(withPaneRatio(panesRef.current, paneLayout.bucket, key, null))
        writePanes(panesRef.current)
      }

      const foldTree = (open) => {
        setTreeOpen(open)
        commitPanes({ treeOpen: open, panes: panesRef.current.panes })
        writePanes(panesRef.current)
      }

      /* Only a pane the user actually dragged gets an inline size; everything
         else keeps the stylesheet default (200px tree, 290px changes, the
         percentage caps) — which is also what a double-click returns to. */
      const paneStyle = (key) => {
        const px = paneLayout.overrides[key]
        if (px === undefined) return null
        // The diff always takes its size as a height, in every chrome.
        const vertical = key === 'diff' ? true : paneByWidth === false
        return vertical ? { height: px + 'px', maxHeight: px + 'px' } : { width: px + 'px', maxWidth: px + 'px' }
      }

      /* A divider is a control, so it only exists when it can actually move
         something: no pane of that key in this chrome, or a window with no travel
         at all, means no element — and therefore no tab stop either (v0.8.0 shipped
         a 0x0 focusable separator in the columns chrome that way). */
      const gutter = (key, side) => {
        const limit = paneLayout.limits[key]
        if (limit === undefined || limit.max <= limit.min) return null
        return E(Gutter, {
        key: 'gutter-' + key,
        t: t,
        nameKey: PANE_NAME_KEYS[key],
        // The diff divider is a horizontal bar in every chrome: it moves a
        // window that lives BELOW it, even where tree/changes are dragged
        // sideways (columns).
        vertical: key === 'diff' ? false : paneByWidth,
        side: side,
        active: paneDragging === key,
        // Now is clamped into [min, max]: an aria window the panel contradicts is
        // worse than no window at all.
        value: Math.min(Math.max(Math.round(paneLayout.effective[key] === undefined ? 0 : paneLayout.effective[key]), limit.min), limit.max),
        min: limit.min,
        max: limit.max,
        onStart: () => setPaneDragging(key),
        onDrag: (px) => dragPane(key, px),
        onEnd: endPaneDrag,
        onReset: () => resetPane(key),
        })
      }

// The action rail measures ITSELF, not the panel: how many buttons fit is a
      // function of the strip that holds them (a 1200x300 workbench and a 300x900
      // sidebar disagree about that). railBox keeps the last measured span; until
      // the first measurement lands, every action is rendered.
      // Layout effect (see the host measure above): the button count derives
      // from this box, and a late measure reads as the rail lighting up late.
      useMeasureLayoutEffect(() => {
        const element = railHostRef.current
        if (element === null) { setRailBox({ width: 0, height: 0 }); return undefined }
        const measure = () => {
          const rect = element.getBoundingClientRect()
          setRailBox({ width: Math.round(rect.width), height: Math.round(rect.height) })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [repoRoot, columns, compact])

      const guard = useCallback(async (work) => {
        setBusy(true)
        setError(null)
        try {
          return await work()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
          return undefined
        } finally {
          setBusy(false)
        }
      }, [])

      const favorites = useMemo(() => (repoRoot === null ? [] : readFavorites(repoRoot)), [repoRoot, favTick])
      const toggleFavoriteBranch = useCallback((name) => {
        if (repoRoot === null || name === '') return
        toggleFavorite(repoRoot, name)
        setFavTick((value) => value + 1)
      }, [repoRoot])

      useEffect(() => {
        /* No workspace attached: there is nothing to scan, so land the empty
           result straight away instead of leaving repoState null (which reads
           as "still loading" and would spin forever). */
        if (cwd === undefined) { setRepoState({ repos: [], isRepo: false }); return undefined }
        let cancelled = false
        /* First-paint cache: a session switch through the same workspace
           reuses the previous discovery synchronously (repo bar and pick land
           with the first paint), then the background scan re-proves it. */
        const apply = (data, cachedPick) => {
          setRepoState(data)
          const paths = data.repos.map((repo) => repo.path)
          const remembered = readRememberedRepo(sessionId)
          let pick = null
          if (remembered !== undefined && paths.indexOf(remembered) >= 0) pick = remembered
          else if (cachedPick !== undefined && paths.indexOf(cachedPick) >= 0) pick = cachedPick
          else if (data.isRepo === true) pick = data.cwd
          else if (paths.length > 0) pick = paths[0]
          setRepoRoot(pick)
          rememberPaintRoot(cwd, pick)
          return pick
        }
        const cached = readPaintRepos(cwd)
        if (cached !== undefined) apply(cached, readPaintRoot(cwd))
        void (async () => {
          try {
            const data = await request('repos', { cwd: cwd })
            if (cancelled) return
            writePaintRepos(cwd, data)
            apply(data, readPaintRoot(cwd))
          } catch (caught) {
            if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
          }
        })()
        return () => { cancelled = true }
      }, [cwd, sessionId, tick])

      /* Changes view state, lifted out of ChangesPanel so the "..." menu (a
         rail action, invariant 14) can drive the same groupBy and the sort
         order it introduces — one source of truth, wherever the click came
         from. sortKey 'git' keeps git's own status order. */
      const [groupBy, setGroupBy] = useState('flat')
      const [sortKey, setSortKey] = useState('git')
      /* The console tab reads the host's console.log. It refreshes only after a
         git run (consoleTick), never on the summary poll — the file is the
         record, and a timer would re-read it while nothing new lands. */
      const [consoleTick, setConsoleTick] = useState(0)


      /* Phase-two merge (issue #11): fold the [path, additions, deletions,
         binary] rows from the `stats` method into a deferred summary. Pure and
         immutable — untouched rows keep their object reference so the memoised
         ChangeRow skips them, and a group with no numeric change keeps its
         array reference so React reconciles nothing. Declared before use
         (hooks dependency TDZ rule). */
      const applyStats = (data, statsPayload) => {
        if (data === null || typeof data !== 'object' || statsPayload === null || typeof statsPayload !== 'object') return data
        const build = (entries, rows) => {
          if (Array.isArray(entries) !== true || entries.length === 0 || Array.isArray(rows) !== true) return entries
          const map = new Map()
          for (const row of rows) {
            if (Array.isArray(row) === true && row.length >= 4 && typeof row[0] === 'string') {
              map.set(row[0], { additions: row[1] | 0, deletions: row[2] | 0, binary: row[3] === true })
            }
          }
          let touched = false
          const next = entries.map((entry) => {
            const stat = map.get(entry.path)
            if (stat === undefined) {
              if (entry.additions === 0 && entry.deletions === 0 && entry.binary !== true) return entry
              touched = true
              return Object.assign({}, entry, { additions: 0, deletions: 0, binary: false })
            }
            if (entry.additions === stat.additions && entry.deletions === stat.deletions && entry.binary === stat.binary) return entry
            touched = true
            return Object.assign({}, entry, stat)
          })
          return touched ? next : entries
        }
        const changes = data.changes
        const staged = build(changes.staged, statsPayload.staged)
        const unstaged = build(changes.unstaged, statsPayload.unstaged)
        if (staged === changes.staged && unstaged === changes.unstaged) return data
        return Object.assign({}, data, {
          statsDeferred: false,
          changes: Object.assign({}, changes, { staged: staged, unstaged: unstaged }),
        })
      }

      const loadSummary = useCallback(async () => {
        /* Two-phase (issue #11): the rows land first (`stats: false` skips the
           two numstat passes), then the +/- numbers merge in behind them. The
           panel is usable the moment the rows arrive; the numbers are exact
           when they arrive — nothing is approximated or dropped. */
        const data = await request('summary', Object.assign({}, base, { ignored: showIgnored, stats: false }))
        setSummary(data)
        if (data.statsDeferred === true) {
          const merged = applyStats(data, await request('stats', base))
          setSummary(merged)
          return merged
        }
        return data
      }, [base, showIgnored])

      const loadBranches = useCallback(async () => {
        const data = await request('branches', base)
        setBranches(data)
        return data
      }, [base])

      /* ---- branch browsing (v0.19.3, IDEA-style) ----
         Double-clicking a tree branch no longer checks it out: it walks THAT
         branch's log (browseRev = '' keeps the HEAD view). The LAST browsed
         branch is remembered, so 2-then-1 lands 1's list on the merge commit
         that carried 2 into 1 ('merge-point') — 1's newer commits stay one
         wheel-scroll away, nothing is truncated. */
      const [browseRev, setBrowseRev] = useState('')
      const [mergeAnchor, setMergeAnchor] = useState(null)
      const lastBrowseRef = useRef(null)
      const loadCommits = useCallback(async (skip, overridePath) => {
        const activePath = overridePath === undefined ? pathFilter : overridePath
        const payload = Object.assign({}, base, { skip: skip === undefined ? 0 : skip, limit: 120 })
        if (browseRev !== '') payload.rev = browseRev
        if (activePath !== undefined && activePath !== '') payload.path = activePath
        const data = await request('log', payload)
        setCommits((previous) => (skip === undefined || skip === 0 ? data.commits : previous.concat(data.commits)))
        setHasMore(data.hasMore)
        return data
      }, [base, pathFilter, browseRev])

      /* `fetchRemote` turns the refresh into what the rail button means: "see
         whether the remote has anything new to pull" — a `git fetch --prune`
         runs first so ahead/behind land with the fresh summary. Only the
         MANUAL refresh passes it: the network call is the slow part, so the
         automatic refreshes (12s poll, post-action, mount) stay off it, and a
         failed fetch degrades silently — a refresh must not turn into an
         error notification just because the network is down. While it runs the rail
         icon spins: fetching is allowed to take a moment, and the spin says
         the wait is real while blocking a second click. */
      /* Declared before refresh (hooks dep TDZ rule): the manual refresh
         fetches only when a remote exists. */
      const remoteReady = branches !== null && Array.isArray(branches.remotes) && branches.remotes.length > 0
      const [refreshSpinning, setRefreshSpinning] = useState(false)
      /* Fold state of the per-directory groups, lifted from ChangesPanel so the
         ⋯ menu's 展开全部/折叠全部 entries drive the same map the folder
         headers toggle. */
      const [foldedDirs, setFoldedDirs] = useState({})
      /* Last-seen "HEAD hash|branch" signature, from the poll summaries
         (v0.18.7). A ref, not state: a change triggers a data reload, not a
         render. null until the first poll tick records the baseline. */
      const headRef = useRef(null)
      const refresh = useCallback(async (opts) => {
        if (repoRoot === null) return
        const withFetch = opts !== null && typeof opts === 'object' && opts.fetchRemote === true && remoteReady === true
        if (withFetch === true) setRefreshSpinning(true)
        try {
          await guard(async () => {
            if (withFetch === true) {
              try { await request('fetch', Object.assign({}, base, { prune: true })) } catch (error) { notifyFail(error) }
            }
            const [summaryData, branchesData, page] = await Promise.all([loadSummary(), loadBranches(), loadCommits(0)])
            /* Keep the poll's HEAD signature in step (v0.18.7): after an
               in-panel commit/checkout the next tick must not re-pull
               branches + history all over again. */
            if (summaryData !== null && typeof summaryData === 'object' && typeof summaryData.head === 'string') {
              headRef.current = summaryData.head + '|' + (summaryData.branch === undefined ? '' : summaryData.branch)
            }
            /* The write side of the first-paint cache: exactly the FIRST page
               (a paged fetch never reaches this path), replaced on every
               refresh — the auto-refresh included — so a session switch through
               the same workspace seeds fresh data, not the mount-time
               snapshot. A branch-browsing page (browseRev) must not evict the
               HEAD page: the next mount opens on HEAD and would otherwise be
               seeded with another branch's log. */
            if (browseRev === '') writePaintPage(repoRoot, { summary: summaryData, branches: branchesData, commits: page.commits, hasMore: page.hasMore })
          })
        } finally {
          if (withFetch === true) setRefreshSpinning(false)
        }
      }, [guard, loadSummary, loadBranches, loadCommits, repoRoot, remoteReady, base, browseRev])

      /* Double-click a branch (or the HEAD row): browse its history. The merge
         anchor comes from the PREVIOUSLY browsed branch — 'merge-point' finds
         the newest merge that carried it into the one now opened, and the
         history list scrolls there once (null = no relationship, top). */
      const browseBranch = useCallback(async (entry) => {
        const name = String(entry.name)
        const previous = lastBrowseRef.current
        if (previous === name) return
        lastBrowseRef.current = name
        setMergeAnchor(null)
        setBrowseRev(name)
        if (previous !== null) {
          try {
            const data = await request('merge-point', Object.assign({}, base, { from: previous, to: name }))
            if (data !== null && typeof data === 'object' && typeof data.hash === 'string' && data.hash !== '') setMergeAnchor(data.hash)
          } catch (error) { void error }
        }
      }, [base, request])
      /* A repository switch forgets the browsing context entirely. */
      useEffect(() => {
        lastBrowseRef.current = null
        setBrowseRev('')
        setMergeAnchor(null)
      }, [repoRoot])

      useEffect(() => {
        if (repoRoot === null) return undefined
        /* First-paint cache: seed the first page synchronously so a session
           switch through the same workspace paints the full chrome (rail,
           branch bar, history) at once instead of re-growing it piece by
           piece; the refresh below re-proves every field right after. Only a
           cold mount seeds — a later effect run (tick / repo switch) must not
           roll live state back to a stale snapshot. */
        const cachedPage = readPaintPage(repoRoot)
        if (cachedPage !== undefined) {
          /* Field-wise: a pill may have painted only its summary (the pill
             merges its own two fields alone), so branches/commits can be
             absent from the page. Seeding undefined into state would crash
             the branch-tree render (undefined.remotes) — skip that field
             and let refresh() fetch it as usual. */
          if (summary === null && cachedPage.summary !== undefined) setSummary(cachedPage.summary)
          if (branches === null && cachedPage.branches !== undefined) setBranches(cachedPage.branches)
          if (commits.length === 0 && Array.isArray(cachedPage.commits)) { setCommits(cachedPage.commits); setHasMore(cachedPage.hasMore === true) }
        }
        void refresh()
        return undefined
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [repoRoot, refresh, tick])

      useEffect(() => {
        if (props.visible !== true || repoRoot === null) return undefined
        /* In-flight gate (issue #11): a summary over a tree with thousands of
           changes can outlast AUTO_REFRESH_MS, and re-entering just piles
           queued scans behind the repo lock (the interval deliberately does
           not run through `guard` — a background refresh must not flash the
           busy UI). Skip while the previous round is still running; the next
           tick re-checks. */
        let inFlight = false
        const timer = setInterval(() => {
          if (inFlight === true) return
          inFlight = true
          void (async () => {
            try {
              const data = await loadSummary()
              /* v0.18.7: the poll used to be summary-only, so commits and
                 checkouts made OUTSIDE the panel (terminal, another tool)
                 never reached the history and branch lists until a manual
                 refresh. Each summary now carries HEAD + branch; when that
                 signature moves, re-pull branches + history. The panel's own
                 actions already refresh everything through run() → refresh()
                 (which also re-records the signature), so this stays quiet
                 for in-panel work. The null baseline (first tick) only
                 records — the mount refresh already pulled everything. */
              const sig = data !== null && typeof data === 'object' && typeof data.head === 'string'
                ? data.head + '|' + (data.branch === undefined ? '' : data.branch)
                : null
              if (sig !== null && headRef.current !== null && sig !== headRef.current) {
                await Promise.all([loadBranches(), loadCommits(0)])
              }
              if (sig !== null) headRef.current = sig
            } catch (error) { void error } finally { inFlight = false }
          })()
        }, AUTO_REFRESH_MS)
        return () => clearInterval(timer)
      }, [props.visible, repoRoot, loadSummary, loadBranches, loadCommits])

      /* The failure path already reports through setError; the success half of
         every gesture lands in the same stack (m05310). A call site that pushes a
         richer toast of its own passes { quiet: true }. */
      const runSuccessText = useCallback((method, payload) => successToastText(t, method, payload), [t])
      const run = useCallback(async (method, payload, options) => {
        const result = await guard(() => request(method, Object.assign({}, base, payload)))
        /* A git run just happened — failed or not, the console has a new block. */
        setConsoleTick((value) => value + 1)
        if (result === undefined) return undefined
        await refresh()
        /* refresh itself runs git (status/log); the console gets those blocks
           too, so the second tick keeps the tab on the newest line. */
        setConsoleTick((value) => value + 1)
        if (options === undefined || options.quiet !== true) notifyOk(runSuccessText(method, payload))
        return result
      }, [base, runSuccessText, guard, refresh])

      const pickRepo = useCallback((path) => {
        setRepoRoot(path)
        /* Shared write: the composer status pill watches this store and
           follows, so both seats always name the same repository. */
        rememberRepoShared(sessionId, path)
        setSummary(null)
        setBranches(null)
        setCommits([])
        /* The signature is per-repo: force a fresh baseline for the new one
           so the first poll tick doesn't mistake the repo switch for an
           outside HEAD move. */
        headRef.current = null
        setDetail(null)
        setSelectedHash(null)
        setPatch('')
        setDiffContext(null)
        setView('history')
        setPathFilter('')
      }, [sessionId])

      /* The composer status pill and this panel are separate trees; when the
         pill (or any other seat) switches the repository or the branch, this
         subscription lands the same selection here — pickRepo for a repo move
         (full state reset, same as an in-panel pick), refresh() for a branch
         move (the panel's own post-action path). Declared AFTER pickRepo and
         refresh: hooks dependency arrays evaluate during render (invariant 12). */
      useEffect(() => {
        const onRepo = (sid, root) => {
          if (sid !== sessionId || typeof root !== 'string' || root === '') return
          setRepoRoot((current) => (current === root ? current : pickRepo(root)))
        }
        const onBranch = () => {
          if (repoRoot === null) return
          void refresh()
        }
        composerRepoWatchers.add(onRepo)
        composerBranchWatchers.add(onBranch)
        return () => {
          composerRepoWatchers.delete(onRepo)
          composerBranchWatchers.delete(onBranch)
        }
      }, [sessionId, repoRoot, pickRepo, refresh])

      const openDiff = useCallback(async (seed) => {
        setPatchLoading(true)
        setPatch('')
        try {
          const data = await request('diff', Object.assign({}, base, seed))
          setPatch(data.patch)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setPatchLoading(false)
        }
      }, [base])

      /* ---------- external diff preview ---------- */
      /* m02986: a diff opens as a card over the page, not a sidebar tab. The
         same card serves the push dialog's file list. The sidebar preview type
         stays registered as the fallback for a host without shell.overlay, and
         the inline pane remains the last resort (no right sidebar either). */
      const previewDiff = useCallback((seed) => {
        if (repoRoot === null) return false
        const commitHash = seed.hash !== undefined && seed.hash !== null ? String(seed.hash) : null
        const scopeObject = scope || {}
        const dialogSeed = commitHash !== null
          ? { hash: commitHash, subject: seed.subject || '', path: seed.path !== undefined && seed.path !== null ? seed.path : '', cwd: scopeObject.cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId }
          : { path: seed.path, staged: seed.staged === true, untracked: seed.untracked === true ? true : undefined, cwd: scopeObject.cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId }
        if (fileDialog.hosted === true) {
          fileDialog.set(dialogSeed)
          return true
        }
        let sidebarRight = undefined
        try { sidebarRight = props.ctx === undefined || props.ctx === null ? undefined : props.ctx.get('sidebarRight') } catch (error) { void error }
        if (sidebarRight === undefined || sidebarRight === null || typeof sidebarRight.openTab !== 'function') return false
        try {
          previewStore.set(dialogSeed)
          sidebarRight.openTab(NATIVE_PREVIEW_KIND)
          return true
        } catch (error) { return false }
      }, [repoRoot, scope, props.ctx])

      /* The one diff verb every surface calls (row click, row menu, detail
         file menu, working-diff shortcut): external first, inline fallback. */
      const showDiff = useCallback((seed) => {
        if (previewDiff(seed) === true) return
        if (seed.hash !== undefined && seed.hash !== null) {
          setDiffContext({ kind: 'commit', hash: seed.hash, subject: seed.subject || '' })
          void openDiff({ hash: seed.hash, path: seed.path })
          return
        }
        setDiffContext({ kind: 'worktree', staged: seed.staged === true })
        /* m04495: an untracked path has no index entry, so the route needs the
           flag to run `git diff --no-index` against /dev/null. Dropping it here
           left the inline fallback with an empty patch. */
        void openDiff({ path: seed.path, staged: seed.staged === true, untracked: seed.untracked === true ? true : undefined })
      }, [previewDiff, openDiff])

      /* m04920: the Git tab raises the SAME frame dialogs as the composer pill.
         The panel used to draw its own inline push card and commit layer, so the
         two surfaces drifted apart: the layer kept a right-hand diff that could
         not fit the card, and a file card opened from the panel could not cover
         the inline card. */
      const openPushDialog = useCallback(() => {
        const scopeObject = scope || {}
        if (repoRoot === null) return
        pushDialog.set({ cwd: cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId })
      }, [cwd, repoRoot, scope])


      const selectCommit = useCallback(async (commit) => {
        setSelectedHash(commit.hash)
        setSelectedPath(null)
        setPatch('')
        setDiffContext(null)
        /* Wide seats keep the log in the middle and open the commit in the
           right-hand column (m01216); a single-row seat has no third column, so
           there the detail takes the main one. */
        if (compact === true) setView('detail')
        setDetail(null)
        try {
          setDetail(await request('commitDetail', Object.assign({}, base, { hash: commit.hash })))
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }, [base, compact])

      const checkout = useCallback(async (entry) => {
        if (entry.tag === true) { void run('checkout', { branch: entry.name }); return }
        if (entry.remote === true) { void run('checkout', { branch: entry.name.slice(entry.name.indexOf('/') + 1) }); return }
        void run('checkout', { branch: entry.name })
      }, [run])

      const compareWith = useCallback(async (baseRef, headRef) => {
        const data = await run('compare', { base: baseRef, head: headRef })
        if (data === undefined) return
        setNote(baseRef + ' ... ' + headRef + ' · ' + String(data.files.length) + ' files / ' + String(data.commits.length) + ' commits')
      }, [run])

      /* Menu anchors are stored as offsets inside the panel, not as viewport
         coordinates: the bottom workbench is a containing block for fixed
         descendants (contain: layout), so viewport coordinates would place the
         menu outside the panel. See ContextMenu. */
      // A merge / rebase / cherry-pick / revert / bisect that has not finished yet
      // makes branch-level actions dangerous: git refuses most of them anyway, so
      // the panel greys them out and says why instead of letting them fail.
      const operation = summary === null || summary.operation === undefined ? null : summary.operation
      const blocked = operation !== null

      const openMenuAt = useCallback((event, items) => {
        const element = hostRef.current
        const rect = element === null ? null : element.getBoundingClientRect()
        setMenu({
          x: event.clientX - (rect === null ? 0 : rect.left),
          y: event.clientY - (rect === null ? 0 : rect.top),
          boundsWidth: rect === null ? 0 : Math.round(rect.width),
          boundsHeight: rect === null ? 0 : Math.round(rect.height),
          items: items,
        })
      }, [])


      /* Send-to-chat (v0.14): one funnel for the three context menus. The
         insertion target is the CURRENT session's composer (scope.sessionId);
         a miss — service absent, no retained session, phase busy, CAS raced
         twice — still gives feedback: the payload is copied to the clipboard
         and a toast says so. */
      const sendToComposer = useCallback((payload) => {
        const applied = insertIntoComposer(props.ctx, sessionId, (actx, input, span) => {
          if (payload.mention !== undefined && payload.text !== undefined) {
            // Chip + trailing sentence (v0.13.5 diff line refs): the @file chip
            // first, then the line-range text at the NEW draft tail (the chip
            // changed both the draft and its rev). The facade appends a
            // separating space after a chip when none follows, so the text leg
            // goes in verbatim. If the text leg loses its CAS race twice the
            // chip still stands — the reference made it, that reads as sent.
            let chipApplied = false
            try {
              chipApplied = input.insertReference({
                source: 'reference',
                ref: payload.mention,
                label: payload.label,
                appearance: payload.appearance,
                clipboardText: payload.mention,
              }, span) === true
            } catch (error) { void error; chipApplied = false }
            if (chipApplied === false) return false
            try {
              let state = input.state.getSnapshot()
              for (let attempt = 0; attempt < 2; attempt += 1) {
                // The chip changed BOTH projections; the tail must be rebuilt
                // in detect coordinates (see detectTailSpanOf), or selectSpan
                // rejects it and the sentence silently vanishes.
                const tail = detectTailSpanOf(state)
                if (tail !== null) {
                  let textApplied = false
                  try { textApplied = actx.bail(actx, 'slash/input-insert-text', { text: payload.text, span: tail }) === true } catch (error) { void error; textApplied = false }
                  if (textApplied === true) return true
                }
                try { state = input.state.getSnapshot() } catch (error) { void error; return true }
              }
            } catch (error) { void error }
            return true
          }
          if (payload.appearance !== undefined) {
            return input.insertReference({
              source: 'reference',
              ref: payload.mention,
              label: payload.label,
              appearance: payload.appearance,
              clipboardText: payload.mention,
            }, span)
          }
          // Plain text rides the scoped insert-text event (bail value IS the
          // answer); a trailing space keeps the next keystroke off the token.
          return actx.bail(actx, 'slash/input-insert-text', { text: payload.text + ' ', span: span }) === true
        })
        if (applied === true) {
          pushToast({ text: t('toast.sentToChat'), icon: 'send', tone: 'ok', ttl: 6000 })
          return
        }
        copyText(payload.fallback)
        pushToast({ text: t('toast.sendCopied'), icon: 'tag', tone: 'warn', ttl: 6000 })
      }, [props.ctx, sessionId, pushToast, t])

      const sendFileReferenceToChat = useCallback((path) => {
        const mention = fileMentionOf(path)
        if (mention === null) { sendToComposer({ text: path, fallback: path }); return }
        sendToComposer({
          mention: mention,
          label: path.slice(-1) === '/' ? path.slice(0, -1) : baseName(path),
          appearance: path.slice(-1) === '/' ? 'folder' : 'file',
          fallback: path,
        })
      }, [sendToComposer])

      /* Self-describing text payloads for the commit/branch sends (v0.13.3 user
         feedback): a bare short hash or branch name is noise out of context —
         the text must say WHAT it is and WHERE from. The wording rides the
         fill() templates send.commitText / send.branchText; `repo` is the repo
         root's basename. An unknown root degrades to a neutral dash — fill()
         leaves unknown keys verbatim, so the callers must never let an
         undefined repo reach the template. The file @-chip is already
         self-describing and stays untouched. */
      const repoLabel = repoRoot === null ? '' : baseName(repoRoot)
      const sendGitSummaryToChat = useCallback((key, values) => {
        const repo = values.repo === undefined || values.repo === '' ? '—' : values.repo
        const text = fill(t(key), Object.assign({}, values, { repo: repo }))
        sendToComposer({ text: text, fallback: text })
      }, [t, sendToComposer])

      /* ---------- multi-select actions (issue #13) ---------- */

      /* Copy with feedback: plain copyText stays silent, which reads as "did
         nothing" the moment the paste target is in another app. */
      const copyValues = useCallback((values) => {
        if (values === null || values === undefined || values.length === 0) return
        copyText(clipboardLines(values))
        pushToast({ text: fill(t('selection.copied'), { n: values.length }), icon: 'tag', tone: 'ok', ttl: 2500 })
      }, [pushToast, t])

      /* Resolve the change selection against the CURRENT summary: paths move
         between groups on every stage/unstage, so the key ('group:path') is
         the only stable handle and the entry lookup must be fresh. */
      const changeSelectionGroups = () => {
        const changes = summary === null ? null : summary.changes
        const groups = { staged: [], other: [], tracked: [], untracked: [] }
        if (changes === null) return groups
        const byKey = new Map()
        for (const entry of changes.staged) byKey.set('staged:' + entry.path, entry)
        for (const entry of changes.unstaged) byKey.set('unstaged:' + entry.path, entry)
        for (const entry of changes.untracked) byKey.set('untracked:' + entry.path, entry)
        for (const entry of changes.conflicted) byKey.set('conflicted:' + entry.path, entry)
        for (const key of changeSelection) {
          const entry = byKey.get(key)
          if (entry === undefined) continue
          if (key.indexOf('staged:') === 0) groups.staged.push(entry.path)
          else groups.other.push(entry.path)
          // Conflicted rides the tracked lane, like the single-file discard does.
          if (key.indexOf('untracked:') === 0) groups.untracked.push(entry.path)
          else groups.tracked.push(entry.path)
        }
        return groups
      }
      const bulkStageChanges = () => {
        const groups = changeSelectionGroups()
        if (groups.other.length === 0) return
        void run('stage', { paths: groups.other })
      }
      const bulkUnstageChanges = () => {
        const groups = changeSelectionGroups()
        if (groups.staged.length === 0) return
        void run('unstage', { paths: groups.staged })
      }
      const openDiscardManyDialog = () => {
        const groups = changeSelectionGroups()
        if (groups.tracked.length === 0 && groups.untracked.length === 0) return
        setDialog({ kind: 'discardMany', tracked: groups.tracked, untracked: groups.untracked })
      }
      const copyChangeSelection = () => {
        const groups = changeSelectionGroups()
        copyValues(groups.staged.concat(groups.other))
      }
      /* A refresh that resolves a selected key away (file staged, discarded,
         renamed) must not keep it selected. */
      useEffect(() => {
        setChangeSelection((previous) => {
          if (previous.size === 0) return previous
          const changes = summary === null ? null : summary.changes
          if (changes === null) return previous
          const alive = new Set()
          for (const entry of changes.conflicted) alive.add('conflicted:' + entry.path)
          for (const entry of changes.staged) alive.add('staged:' + entry.path)
          for (const entry of changes.unstaged) alive.add('unstaged:' + entry.path)
          for (const entry of changes.untracked) alive.add('untracked:' + entry.path)
          const next = new Set()
          for (const key of previous) {
            if (alive.has(key) === true) next.add(key)
          }
          return next.size === previous.size ? previous : next
        })
      }, [summary])
      /* Changes-list keyboard scope: Ctrl/Cmd+C copies paths, Delete opens the
         grouped discard confirm, Ctrl+A selects everything but ignored, Esc
         clears. Typing targets keep their native behaviour. */
      const onChangesKeyDown = (event) => {
        if (isTypingTarget(event.target) === true) return
        const mod = isToggleModifier(event)
        if (mod === true && (event.key === 'c' || event.key === 'C')) {
          const groups = changeSelectionGroups()
          const paths = groups.staged.concat(groups.other)
          if (paths.length === 0) return
          event.preventDefault()
          copyValues(paths)
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (changeSelection.size === 0) return
          event.preventDefault()
          openDiscardManyDialog()
          return
        }
        if (mod === true && (event.key === 'a' || event.key === 'A')) {
          const changes = summary === null ? null : summary.changes
          if (changes === null) return
          event.preventDefault()
          const next = new Set()
          for (const entry of changes.conflicted) next.add('conflicted:' + entry.path)
          for (const entry of changes.staged) next.add('staged:' + entry.path)
          for (const entry of changes.unstaged) next.add('unstaged:' + entry.path)
          for (const entry of changes.untracked) next.add('untracked:' + entry.path)
          setChangeSelection(next)
          return
        }
        if (event.key === 'Escape') setChangeSelection(new Set())
      }
      /* History keyboard scope: Ctrl/Cmd+C copies full hashes, Esc clears.
         Delete has no commit analogue — deliberately unmapped. */
      const onHistoryKeyDown = (event) => {
        if (isTypingTarget(event.target) === true) return
        if (isToggleModifier(event) === true && (event.key === 'c' || event.key === 'C')) {
          if (pickedCommits.size === 0) return
          event.preventDefault()
          copyValues(Array.from(pickedCommits))
          return
        }
        /* Enter = the keyboard twin of the double-click: open the picked
           commit's detail. Exactly one pick — with several, the intent is
           ambiguous, so Enter does nothing. */
        if (event.key === 'Enter' && pickedCommits.size === 1) {
          event.preventDefault()
          const hash = pickedCommits.values().next().value
          const commit = commits.find((entry) => entry.hash === hash)
          if (commit !== undefined) { void selectCommit(commit); return }
        }
        if (event.key === 'Escape') setPickedCommits(new Set())
      }
      /* Branch-tree Delete: group the picked refs by kind and hand them to ONE
         confirm dialog (head branches never get here — BranchTree filters). */
      const deleteBranchEntries = (entries) => {
        const locals = []
        const remotes = []
        const tags = []
        for (const item of entries) {
          if (item.kind === 'local') locals.push(item.name)
          else if (item.kind === 'tag') tags.push(item.name)
          else {
            const slash = item.name.indexOf('/')
            remotes.push({
              remote: slash >= 0 ? item.name.slice(0, slash) : item.name,
              branch: slash >= 0 ? item.name.slice(slash + 1) : item.name,
            })
          }
        }
        if (locals.length === 0 && remotes.length === 0 && tags.length === 0) return
        setDialog({ kind: 'deleteRefs', locals: locals, remotes: remotes, tags: tags })
      }
      /* Batch local delete with the same undo toast the single delete has.
         Plain function on purpose (invariant 12): a useCallback here would
         evaluate `undoAction` in its dep array — declared further below. */
      const deleteBranches = async (names) => {
        const data = await run('branchDelete', { names: names, confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) return
        pushToast({
          text: fill(t('toast.branchesDeleted'), { n: names.length }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }

      const branchMenu = useCallback((event, entry, picked) => {
        const current = branches === null ? '' : branches.branch
        const isLocal = entry.remote !== true && entry.tag !== true
        const reason = t('action.unavailable')
        /* Multi-select menu: the verbs that only make sense for one ref
           (checkout, merge, rebase, rename…) are dropped, not greyed — the
           selection itself already says what the user is going for. */
        if (picked !== null && picked !== undefined && picked.length > 1) {
          const locals = picked.filter((item) => item.kind === 'local' && item.entry.head !== true)
          const remotes = picked.filter((item) => item.kind === 'remote')
          const tags = picked.filter((item) => item.kind === 'tag')
          openMenuAt(event, withoutIcons([
            { id: 'copyNames', icon: 'tag', tone: 'secondary', label: fill(t('menu.copyNamesN'), { n: picked.length }), run: () => copyValues(picked.map((item) => item.name)) },
            null,
            locals.length > 0 ? { id: 'deleteLocal', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteLocalN'), { n: locals.length }), run: () => setDialog({ kind: 'deleteRefs', locals: locals.map((item) => item.name), remotes: [], tags: [] }) } : null,
            remotes.length > 0 ? { id: 'deleteRemote', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteRemoteN'), { n: remotes.length }), run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: remotes.map((item) => { const slash = item.name.indexOf('/'); return { remote: slash >= 0 ? item.name.slice(0, slash) : item.name, branch: slash >= 0 ? item.name.slice(slash + 1) : item.name } }), tags: [] }) } : null,
            tags.length > 0 ? { id: 'deleteTags', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteTagsN'), { n: tags.length }), run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: [], tags: tags.map((item) => item.name) }) } : null,
          ].filter((item) => item !== null)))
          return
        }
        const items = [
          { id: 'checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout'), disabled: entry.head === true || entry.tag === true || blocked, reason: blocked ? t('operation.hint') : reason, run: () => { void checkout(entry) } },
          isLocal ? { id: 'rebase', icon: 'compare', tone: 'violet', label: t('action.rebaseCurrentOnto'), disabled: entry.head === true || blocked, reason: blocked ? t('operation.hint') : reason, run: () => { void run('rebase', { onto: entry.name }) } } : null,
          isLocal ? { id: 'merge', icon: 'compare', tone: 'accent', label: t('action.mergeIntoCurrent'), disabled: entry.head === true || blocked, reason: blocked ? t('operation.hint') : reason, run: () => { void run('merge', { branch: entry.name }) } } : null,
          { id: 'compare', icon: 'filter', tone: 'violet', label: t('action.compare'), disabled: entry.head === true || current === '', reason: reason, run: () => { void compareWith(current, entry.name) } },
          { id: 'send', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => sendGitSummaryToChat('send.branchText', { name: entry.name, repo: repoLabel }) },
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyName'), run: () => copyValues([entry.name]) },
          null,
          { id: 'favorite', icon: 'star', tone: 'warn', label: t('action.favorite'), active: favorites.indexOf(entry.name) >= 0, run: () => toggleFavoriteBranch(entry.name) },
          /* Upstream management (issue #18). The remote-picker submenu is
             built INSIDE run() — branches.remote is read at click time, not
             render time, so branchMenu's useCallback deps stay untouched
             (remoteBranches is defined AFTER this callback; a render-time
             reference would be the classic hooks TDZ trap). */
          isLocal ? { id: 'setUpstream', icon: 'fetch', tone: 'cyan', label: t('action.setUpstream'), disabled: branches === null || branches.remote.length === 0, reason: reason, run: (event) => openMenuAt(event, withoutIcons(branches.remote.map((remoteEntry) => ({
            id: 'upstream:' + remoteEntry.name,
            icon: 'fetch', tone: 'cyan',
            label: remoteEntry.name,
            active: entry.upstream === remoteEntry.name,
            run: () => { void run('branch-upstream', { branch: entry.name, upstream: remoteEntry.name }) },
          })))) } : null,
          isLocal && entry.upstream !== null && entry.upstream !== undefined ? { id: 'unsetUpstream', icon: 'undo', tone: 'secondary', label: t('action.unsetUpstream'), run: () => { void run('branch-upstream', { branch: entry.name, unset: true }) } } : null,
          /* Remote rows get the tracking form: the local branch is created
             FROM the remote ref with --track in one step (issue #18 item 5),
             replacing the plain "new branch from" which could not bind. */
          entry.remote === true
            ? { id: 'createTracking', icon: 'branchCreate', tone: 'success', label: t('action.newBranchFrom'), run: () => setDialog({ kind: 'createTracking', from: entry.name, name: entry.name.slice(entry.name.indexOf('/') + 1) }) }
            : { id: 'newBranch', icon: 'plus', tone: 'success', label: t('action.newBranchFrom'), run: () => setDialog({ kind: 'newBranch', from: entry.name }) },
          isLocal ? { id: 'rename', icon: 'file', tone: 'primary', label: t('action.rename'), run: () => setDialog({ kind: 'renameBranch', from: entry.name }) } : null,
          isLocal ? { id: 'delete', icon: 'trash', tone: 'danger', label: t('action.delete'), danger: true, disabled: entry.head === true, reason: reason, run: () => setDialog({ kind: 'deleteBranch', name: entry.name }) } : null,
          entry.tag === true
            ? { id: 'delete', icon: 'trash', tone: 'danger', label: t('action.delete'), danger: true, run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: [], tags: [entry.name] }) }
            : (isLocal ? null : {
                id: 'delete', icon: 'trash', tone: 'danger', label: t('action.delete'), danger: true,
                run: () => {
                  const slash = entry.name.indexOf('/')
                  setDialog({
                    kind: 'deleteRefs', locals: [], tags: [],
                    remotes: [{ remote: slash >= 0 ? entry.name.slice(0, slash) : entry.name, branch: entry.name.slice(slash + 1) }],
                  })
                },
              }),
          null,
          { id: 'update', icon: 'fetch', tone: 'cyan', label: t('action.update'), run: () => { void run('fetch', { prune: true }) } },
          { id: 'push', icon: 'push', tone: 'success', label: t('action.push'), disabled: blocked, reason: t('operation.hint'), run: () => openPushDialog() },
        ].filter((item) => item !== null)
        openMenuAt(event, withoutIcons(items))
      }, [branches, checkout, run, t, compareWith, toggleFavoriteBranch, openMenuAt, favorites, blocked, sendGitSummaryToChat, repoLabel, copyValues])

      const commitMenu = useCallback((event, commit) => {
        const shortHash = commit.hash.slice(0, 7)
        /* Multi-select: copy every picked hash and cherry-pick them as ONE
           sequence, oldest first (the graph lists newest first, so the walk
           order reverses). Verbs that only make sense against one commit
           (checkout, branch, tag, reset, revert) drop out entirely. */
        if (pickedCommits.has(commit.hash) === true && pickedCommits.size > 1) {
          const ordered = []
          for (const entry of commits) {
            if (pickedCommits.has(entry.hash) === true) ordered.push(entry.hash)
          }
          const oldestFirst = ordered.slice().reverse()
          openMenuAt(event, [
            { id: 'copyHashes', icon: 'tag', tone: 'secondary', label: fill(t('menu.copyHashesN'), { n: pickedCommits.size }), run: () => copyValues(Array.from(pickedCommits)) },
            null,
            { id: 'cherry', icon: 'commit', tone: 'accent', label: fill(t('menu.cherryN'), { n: pickedCommits.size }), disabled: blocked, reason: t('operation.hint'), run: () => { void run('cherryPick', { hashes: oldestFirst }) } },
          ])
          return
        }
        const items = [
          { id: 'details', icon: 'file', tone: 'primary', label: t('action.details'), run: () => { void selectCommit(commit) } },
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyHash'), run: () => { copyText(commit.hash) } },
          { id: 'send', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => {
            // A commit whose subject is empty (git tolerates empty messages)
            // degrades to the old bare-hash payload instead of faking one.
            const subject = typeof commit.subject === 'string' ? commit.subject.trim() : ''
            if (subject === '') { sendToComposer({ text: shortHash, fallback: shortHash }); return }
            sendGitSummaryToChat('send.commitText', { hash: shortHash, subject: subject, repo: repoLabel })
          } },
          null,
          { id: 'checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout'), run: () => setDialog({ kind: 'checkoutCommit', hash: commit.hash }) },
          { id: 'branch', icon: 'plus', tone: 'success', label: t('action.newBranchHere'), run: () => setDialog({ kind: 'newBranch', from: commit.hash }) },
          { id: 'tag', icon: 'tag', tone: 'warn', label: t('action.newTag'), run: () => setDialog({ kind: 'newTag', hash: commit.hash }) },
          null,
          { id: 'cherry', icon: 'commit', tone: 'accent', label: t('action.cherryPick'), disabled: blocked, reason: t('operation.hint'), run: () => { void run('cherryPick', { hash: commit.hash }) } },
          { id: 'revert', icon: 'undo', tone: 'danger', label: t('action.revert'), disabled: blocked, reason: t('operation.hint'), run: () => { void run('revert', { hash: commit.hash }) } },
          null,
          { id: 'resetSoft', icon: 'undo', tone: 'warn', label: t('action.resetSoft'), disabled: blocked, reason: t('operation.hint'), run: () => setDialog({ kind: 'reset', hash: commit.hash, mode: 'mixed' }) },
          { id: 'resetHard', icon: 'trash', tone: 'danger', label: t('action.resetHard'), danger: true, disabled: blocked, reason: t('operation.hint'), run: () => setDialog({ kind: 'reset', hash: commit.hash, mode: 'hard' }) },
        ]
        openMenuAt(event, items)
      }, [run, selectCommit, t, openMenuAt, blocked, sendToComposer, sendGitSummaryToChat, repoLabel, pickedCommits, commits, copyValues])

      const changeMenu = useCallback((event, item, group) => {
        /* Multi-select: right-clicking a row that belongs to the selection
           acts on the WHOLE selection (stage N / unstage N / discard N). */
        if (changeSelection.has(group + ':' + item.path) === true && changeSelection.size > 1) {
          const groups = changeSelectionGroups()
          const allPaths = groups.staged.concat(groups.other)
          openMenuAt(event, [
            groups.other.length > 0 ? { id: 'stage', icon: 'plus', tone: 'success', label: fill(t('menu.stageN'), { n: groups.other.length }), run: () => { void run('stage', { paths: groups.other }) } } : null,
            groups.staged.length > 0 ? { id: 'unstage', icon: 'minus', tone: 'warn', label: fill(t('menu.unstageN'), { n: groups.staged.length }), run: () => { void run('unstage', { paths: groups.staged }) } } : null,
            { id: 'discard', icon: 'undo', tone: 'danger', danger: true, label: fill(t('menu.discardN'), { n: groups.tracked.length + groups.untracked.length }), run: () => openDiscardManyDialog() },
            null,
            { id: 'copy', icon: 'tag', tone: 'secondary', label: fill(t('menu.copyPathsN'), { n: allPaths.length }), run: () => copyValues(allPaths) },
          ].filter((entry) => entry !== null))
          return
        }
        const items = [
          { id: 'diff', icon: 'file', tone: 'primary', label: t('action.showDiff'), run: () => { showDiff({ path: item.path, staged: group === 'staged', untracked: group === 'untracked' }) } },
          { id: 'sendRef', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => sendFileReferenceToChat(item.path) },
          null,
          group === 'staged'
            ? { id: 'unstage', icon: 'minus', tone: 'warn', label: t('action.unstage'), run: () => { void run('unstage', { paths: [item.path] }) } }
            : { id: 'stage', icon: 'plus', tone: 'success', label: t('action.stage'), run: () => { void run('stage', { paths: [item.path] }) } },
          { id: 'discard', icon: 'undo', tone: 'danger', label: t('action.discard'), danger: true, disabled: group === 'untracked', reason: t('action.unavailable'), run: () => setDialog({ kind: 'discard', item: item, group: group }) },
          null,
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyPath'), run: () => { copyText(item.path) } },
        ]
        openMenuAt(event, items)
      }, [showDiff, run, t, openMenuAt, sendFileReferenceToChat, sendToComposer, changeSelection, changeSelectionGroups, openDiscardManyDialog, copyValues])

      /* The commit-detail file list shares the working-tree row menu, minus the
         staging verbs: a committed file's diff replays against its commit. */
      const detailFileMenu = useCallback((event, file) => {
        openMenuAt(event, [
          { id: 'diff', icon: 'file', tone: 'primary', label: t('action.showDiff'), run: () => {
            setSelectedPath(file.path)
            showDiff({
              hash: detail === null || detail === undefined ? undefined : detail.hash,
              subject: detail === null || detail === undefined ? '' : detail.subject,
              path: file.path,
            })
          } },
          null,
          { id: 'sendRef', icon: 'send', tone: 'accent', label: t('menu.sendToChat'), run: () => sendFileReferenceToChat(file.path) },
          null,
          { id: 'copy', icon: 'tag', tone: 'secondary', label: t('action.copyPath'), run: () => { copyText(file.path) } },
        ])
      }, [detail, showDiff, openMenuAt, sendFileReferenceToChat, sendToComposer, t])

      /* The diff pane's own context menu (v0.13.5): select text in the diff,
         right-click, send a self-describing line reference to the composer.
         The window selection is read BEFORE the menu opens — some platforms
         clear it the moment a context menu shows — and the whole payload is
         computed right here, so the menu items run from captured values and
         never depend on a selection that may no longer exist. A selection
         outside the diff rows keeps the browser's own menu: preventDefault is
         skipped and no item appears (the old behaviour).

         LAST-RESORT SEMANTICS (v0.13.5 forward compat): the rows under this
         pane may be HOST-rendered (ui-primitives DiffBlock), and a future DSH
         is free to add its own context-menu surface to that component. React
         dispatches synthetic contextmenu handlers in bubble order — innermost
         first — so an inner handler that claimed the event (opened its menu
         or called preventDefault) has already set defaultPrevented by the
         time this container handler runs. That check is the FIRST statement:
         if the host handled it we return and the host menu stands alone —
         never two menus at once, never an override. An unusable selection
         also returns without preventDefault (browser menu preserved). Only a
         valid diff selection that NOTHING else handled reaches our menu.
         UPGRADE MEMO (diff-右键向前兼容): DiffBlock today exposes NO menu
         surface and NO extension prop — DiffBlockProps is exactly
         { diffs, labels, maxLines, className } (ui-primitives DiffBlock.tsx);
         its only stable hook is the `data-diff` marker on the root div, which
         this pane already keys on. When upstream ships a menu surface (most
         likely an onRowContextMenu / items prop mounted on the row div or the
         body container), MIGRATE to that prop — feed it our line-reference
         items and RETIRE this container-level handler — the absorption
         pattern dsh-better-workspace uses (host menu surface + host
         dictionary, own entries appended last), not an event race. Until
         then this handler stays deliberately last-resort. */
      const onDiffPaneContextMenu = useCallback((event) => {
        if (event.defaultPrevented === true) return // an inner (host DiffBlock) handler already owns this event
        const saved = savedSelectionOf()
        const resolved = saved === null ? null : resolveDiffSelection(patch, saved)
        if (saved === null || resolved === null) return
        event.preventDefault()
        const path = selectedPath
        const hasFile = typeof path === 'string' && path !== ''
        const branchName = branches === null ? '' : branches.branch
        const mention = hasFile === true ? fileMentionOf(path) : null
        const snippet = resolved.text.length > DIFF_SNIPPET_MAX ? resolved.text.slice(0, DIFF_SNIPPET_MAX) : resolved.text
        const text = resolved.kind === 'lines' && hasFile === true
          ? diffSpanTextOf(t, diffContext, resolved.span, branchName)
          : snippet
        const plain = (mention === null ? (hasFile === true ? path : '') : mention) + ' ' + text
        const sendChip = () => {
          if (mention === null || hasFile === false) { sendToComposer({ text: text, fallback: text }); return }
          sendToComposer({ mention: mention, label: baseName(path), appearance: 'file', text: text, fallback: plain })
        }
        const items = [
          hasFile === true && resolved.kind === 'lines'
            ? { id: 'sendDiffLines', icon: 'send', tone: 'accent', label: t('menu.sendDiffLinesToChat'), run: sendChip }
            : { id: 'sendDiffSnippet', icon: 'send', tone: 'accent', label: t(resolved.kind === 'lines' ? 'menu.sendDiffLinesToChat' : 'menu.sendDiffSnippetToChat'), run: sendChip },
          null,
          { id: 'copyDiffRef', icon: 'tag', tone: 'secondary', label: t('menu.copyDiffRef'), run: () => { copyText(plain) } },
        ]
        openMenuAt(event, items)
      }, [patch, selectedPath, diffContext, branches, openMenuAt, sendToComposer, t])

      const submitDialog = useCallback(async (state, value) => {
        setDialog(null)
        if (state.kind === 'newBranch') { await run('checkout', { branch: value, create: true, startPoint: state.from }); return }
        /* From a remote ref (issue #18): --track binds the upstream in the
           same checkout -b, so "create" and "set upstream" are one motion. */
        if (state.kind === 'createTracking') { await run('checkout', { branch: value, create: true, startPoint: state.from, track: true }); return }
        if (state.kind === 'renameBranch') { await run('branchRename', { from: state.from, to: value }); return }
        if (state.kind === 'newTag') { await run('tagCreate', { name: value, hash: state.hash }); return }
        if (state.kind === 'deleteTag') { await run('tagDelete', { name: value }); return }
        /* SCM ▸ Commit ▸ variants: one dialog, four (all/staged × amend/sign)
           shapes. `all` stages every visible change first — the paths go in
           explicitly, never '.', so the host's root guard stays shut. */
        if (state.kind === 'commitMsg') {
          const paths = state.all === true
            ? summary === null ? [] : summary.changes.staged.concat(summary.changes.unstaged, summary.changes.untracked).map((entry) => entry.path)
            : undefined
          await run('commit', { message: value, paths: paths, amend: state.amend === true, signoff: state.sign === true })
          return
        }
      }, [run])

      /* ---------- toasts + undo ---------- */

      // The delete really happened; the host kept an object id for a while, and this
      // asks it to recreate the branch / stash entry from that id.
      const undoAction = useCallback(async (id) => {
        const data = await guard(() => request('undoApply', Object.assign({}, base, { id: id })))
        if (data === undefined) return
        setToasts((list) => list.filter((item) => item.undoId !== id))
        await refresh()
        pushToast({ text: t('toast.restored') + ' · ' + data.label, icon: 'check', tone: 'ok', ttl: 6000 })
      }, [base, guard, refresh, pushToast, t])

      const deleteBranch = useCallback(async (name) => {
        const data = await run('branchDelete', { name: name, confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) return
        pushToast({
          text: fill(t('toast.branchDeleted'), { name: name }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }, [run, pushToast, undoAction, t])

      const dropStash = useCallback(async (ref) => {
        const data = await run('stashDrop', { ref: ref, confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) return
        pushToast({
          text: fill(t('toast.stashDropped'), { ref: ref }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }, [run, pushToast, undoAction, t])

      /* SCM ▸ Changes ▸ Discard All Changes: tracked paths go through
         `checkout --`, untracked through `clean -fd`. Conflicted entries are
         deliberately NOT touched — a merge conflict needs a decision, not a
         silent side-taking; the dialog says so. */
      const discardAllChanges = useCallback(async () => {
        const changes = summary === null ? null : summary.changes
        if (changes === null) return
        const tracked = changes.unstaged.map((entry) => entry.path)
        const untracked = changes.untracked.map((entry) => entry.path)
        if (tracked.length > 0) await run('discard', { paths: tracked, confirm: true })
        if (untracked.length > 0) await run('discard', { paths: untracked, untracked: true, confirm: true })
      }, [run, summary])

      /* SCM ▸ Commit ▸ Undo Last Commit: a soft reset to HEAD~1 keeps the
         commit's work staged, exactly like VS Code's undo. The commit leaves
         the branch but stays in the reflog — no undo handle needed. */
      const undoLastCommit = useCallback(async () => {
        await run('reset', { hash: 'HEAD~1', mode: 'soft', confirm: true })
      }, [run])

      // A discard really overwrote the working tree, so it hands back the same
      // kind of handle a delete does: the host snapshotted the bytes first.
      const discardChanges = useCallback(async (item, group) => {
        const data = await run('discard', { paths: [item.path], untracked: group === 'untracked', confirm: true }, { quiet: true })
        if (data === undefined) return
        if (data.undo === undefined) {
          // The host declined to snapshot (too big / not faithfully reproducible);
          // say so instead of letting the toast promise an undo that is not there.
          if (data.undoBlocked === true) {
            pushToast({ text: fill(t('toast.discardNoUndo'), { path: item.path }), icon: 'trash', tone: 'warn' })
          }
          return
        }
        pushToast({
          text: fill(t('toast.discarded'), { path: item.path }),
          icon: 'trash',
          tone: 'warn',
          undoId: data.undo.id,
          actionLabel: t('toast.undo'),
          onAction: () => { void undoAction(data.undo.id) },
        })
      }, [run, pushToast, undoAction, t])

      // A toast is transient; this keeps the same handles reachable afterwards, so
      // undoing a delete never depends on catching a floating chip in time.
      const openUndoMenu = useCallback(async (event) => {
        const data = await guard(() => request('undoList', base))
        if (data === undefined) return
        const entries = Array.isArray(data.items) ? data.items.slice().reverse() : []
        if (entries.length === 0) {
          pushToast({ text: t('undo.empty'), icon: 'undo', ttl: 6000 })
          return
        }
        openMenuAt(event, entries.map((entry) => ({
          id: 'undo:' + entry.id,
          icon: 'undo',
          tone: 'warn',
          label: (entry.kind === 'branch-delete' ? t('undo.branch') : entry.kind === 'stash-drop' ? t('undo.stash') : entry.kind === 'discard' ? t('undo.discard') : entry.kind) + ' · ' + entry.label,
          run: () => { void undoAction(entry.id) },
        })))
      }, [base, guard, openMenuAt, pushToast, t, undoAction])

      /* ---------- shared pieces ---------- */

      const repoOptions = repoState === null ? [] : repoState.repos
      const dirty = summary === null ? 0 : summary.changes.staged.length + summary.changes.unstaged.length + summary.changes.untracked.length + summary.changes.conflicted.length

      /* Both header switchers are menu-driven now (see RepoSelect): the
         popovers reuse openMenuAt, so they clamp to the panel box and share
         the opaque, frosted menu surface instead of the OS select popup. */
      const openRepoMenu = useCallback((event) => {
        openMenuAt(event, repoOptions.map((repo) => ({
          id: 'repo:' + repo.path,
          icon: 'folder',
          tone: 'accent',
          label: repo.name + (repo.branch === null || repo.branch === undefined ? '' : ' · ' + repo.branch),
          active: repo.path === repoRoot,
          run: () => { if (repo.path !== repoRoot) pickRepo(repo.path) },
        })))
      }, [openMenuAt, repoOptions, repoRoot, pickRepo])

      const openBranchSwitchMenu = useCallback((event) => {
        const local = branches === null ? [] : branches.local
        openMenuAt(event, local.map((entry) => ({
          id: 'switch:' + entry.name,
          icon: entry.head === true ? 'star' : 'branch',
          tone: entry.head === true ? 'warn' : 'accent',
          label: entry.name,
          active: entry.head === true,
          run: () => { if (entry.head !== true) void checkout(entry) },
        })))
      }, [openMenuAt, branches, checkout])

      const topBar = E('div', { className: 'git4idea-topbar' },
        E(RepoSelect, {
          t: t, repos: repoOptions, value: repoRoot,
          loading: repoState === null,
          onOpenMenu: openRepoMenu,
        }),
        branches === null || branches.local.length === 0 ? null : E('span', { className: 'git4idea-select-wrap', 'data-tip': branches.branch },
          E(Icon, { name: 'branch', size: 12 }),
          E('button', {
            type: 'button',
            className: 'git4idea-select git4idea-select-btn git4idea-select-branch',
            onClick: openBranchSwitchMenu,
          },
            E('span', { className: 'git4idea-repo-name' }, branches.branch),
            E(Icon, { name: 'chevron', size: 12 }))),
        /* Push, pull and commit sit right of the branch name (m00174): each
           appears only while it has work to do, in IDEA's order — green push
           with the ahead count, blue pull with the behind count, white commit
           with the dirty count. */
        summary === null || summary.ahead === undefined || summary.ahead <= 0 ? null : E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small git4idea-track-btn',
          'data-tip': t('toolbar.push'),
          'aria-disabled': remoteReady !== true || blocked === true ? 'true' : 'false',
          onClick: () => {
            if (remoteReady !== true || blocked === true) return
            openPushDialog()
          },
        }, E('span', { className: 'git4idea-tone-success' },
          E(Icon, { name: 'push', size: 11 }),
          E('span', { className: 'git4idea-track-label' }, t('track.push')),
          E('span', { className: 'git4idea-track-num' }, String(summary.ahead)))),
        summary === null || summary.behind === undefined || summary.behind <= 0 ? null : E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small git4idea-track-btn',
          'data-tip': t('toolbar.pull'),
          'aria-disabled': remoteReady !== true || blocked === true ? 'true' : 'false',
          onClick: () => {
            if (remoteReady !== true || blocked === true) return
            void run('pull', { mode: 'ff-only' })
          },
        }, E('span', { className: 'git4idea-tone-business' },
          E(Icon, { name: 'pull', size: 11 }),
          E('span', { className: 'git4idea-track-label' }, t('track.pull')),
          E('span', { className: 'git4idea-track-num' }, String(summary.behind)))),
        dirty <= 0 ? null : E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small git4idea-track-btn',
          'data-tip': t('changes.commit'),
          onClick: () => {
            if (repoRoot === null) return
            const scopeObject = scope || {}
            commitDialog.set({ sessionId: scopeObject.sessionId, cwd: cwd, repoRoot: repoRoot })
          },
        }, E('span', { className: 'git4idea-track-commit' },
          E(Icon, { name: 'commit', size: 12 }),
          E('span', { className: 'git4idea-track-label' }, t('track.commit')),
          E('span', { className: 'git4idea-track-num' }, String(dirty)))),
        operation === null ? null : E('span', { className: 'git4idea-opchip', 'data-tip': t('operation.hint') }, t('operation.' + operation)),
        E('span', { className: 'git4idea-topbar-spacer' }))

      /* The log never leaves the middle column any more: the picked commit
         renders beside it (m01216), so the list stays put while the detail loads. */
      const historyPane = E(HistoryList, {
        t: t, commits: commits, hasMore: hasMore, busy: busy, selectedHash: selectedHash,
        hideSearch: compact, pathFilter: pathFilter, openMenuAt: openMenuAt,
        onPathFilter: (value) => setPathFilter(value),
        onSelect: (commit) => { void selectCommit(commit) },
        onMenu: commitMenu,
        onLoadMore: () => { void guard(() => loadCommits(commits.length)) },
        /* ---- multi-select (issue #13) ---- */
        pickedHashes: pickedCommits,
        onPicksChange: onCommitPicks,
        onSelectAll: (hashes) => onCommitPicks(new Set(hashes)),
        onKeyDown: onHistoryKeyDown,
        mergeAnchor: mergeAnchor,
        base: base,
        request: request,
      })

      const commitDetail = E(CommitDetail, {
        t: t, detail: detail, selectedPath: selectedPath, pane: true,
        onBack: () => { setSelectedPath(null); setPatch(''); setDiffContext(null) },
        /* Plain click only highlights the file; the DOUBLE-click opens its
           diff (v0.18.3, one click model across every list). */
        onSelectFile: (file) => { setSelectedPath(file.path) },
        onOpenFile: (file) => {
          setSelectedPath(file.path)
          showDiff({
            hash: detail === null || detail === undefined ? undefined : detail.hash,
            subject: detail === null || detail === undefined ? '' : detail.subject,
            path: file.path,
          })
        },
        onFileMenu: detailFileMenu,
      })

      /* The commit detail keeps its pane; the tab strip lives on the panel
         root, above every column, so the "日志" tab is the whole Git view. */
      const detailPane = commitDetail

      const diffPane = patch === '' && patchLoading === false ? null : E('div', { className: 'git4idea-diff-pane', 'data-pane': 'diff', style: paneStyle('diff'), onContextMenu: onDiffPaneContextMenu },
        E('div', { className: 'git4idea-diff-head' },
          E('span', { className: 'git4idea-mono git4idea-diff-path' }, selectedPath === null ? '' : selectedPath),
          E('button', { type: 'button', className: 'git4idea-icon-btn', onClick: () => { setPatch(''); setSelectedPath(null); setDiffContext(null) } }, E(Icon, { name: 'close', size: 12 }))),
        E(DiffBody, { patch: patch, loading: patchLoading, t: t }))

      /* ---------- rail (IDE-style left action strip) ---------- */

      const otherBranches = (branches === null ? [] : branches.local).filter((entry) => entry.head !== true)

      const pickBranchMenu = (event, kind) => {
        if (otherBranches.length === 0) { setNote(t('note.noBranches')); return }
        const current = branches === null ? '' : branches.branch
        const icon = kind === 'checkout' ? 'checkout' : kind === 'delete' ? 'trash' : 'compare'
        const tone = kind === 'delete' ? 'danger' : kind === 'compare' ? 'violet' : 'accent'
        openMenuAt(event, otherBranches.map((entry) => ({
          id: kind + ':' + entry.name,
          icon: icon,
          tone: tone,
          label: entry.name,
          run: () => {
            if (kind === 'checkout') { void run('checkout', { branch: entry.name }); return }
            if (kind === 'delete') { setDialog({ kind: 'deleteBranch', name: entry.name }); return }
            if (kind === 'merge') { void run('merge', { branch: entry.name }); return }
            if (kind === 'rebase') { void run('rebase', { onto: entry.name }); return }
            void compareWith(current, entry.name)
          },
        })))
      }

      /* Remote branches (origin/main…): a flat menu, each entry pre-split into
         its remote and branch halves for the destructive confirm. */
      const remoteBranches = branches === null ? [] : branches.remote
      const pickRemoteBranchMenu = (event) => {
        if (remoteBranches.length === 0) { setNote(t('note.noBranches')); return }
        openMenuAt(event, remoteBranches.map((entry) => {
          const slash = entry.name.indexOf('/')
          const remote = slash >= 0 ? entry.name.slice(0, slash) : entry.name
          const branch = slash >= 0 ? entry.name.slice(slash + 1) : entry.name
          return {
            id: 'remote-delete:' + entry.name,
            icon: 'trash', tone: 'danger', danger: true,
            label: entry.name,
            run: () => setDialog({ kind: 'deleteRemoteBranch', remote: remote, branch: branch }),
          }
        }))
      }

      /* Remotes themselves, for "pull from" / "push to" style entries. */
      const remoteNames = branches == null ? [] : branches.remotes.map((entry) => entry.name === undefined ? String(entry) : entry.name)

      const showWorkingDiff = () => {
        const changes = summary === null ? null : summary.changes
        if (changes === null) return
        const order = [
          ['unstaged', changes.unstaged, false],
          ['staged', changes.staged, true],
          ['conflicted', changes.conflicted, false],
          ['untracked', changes.untracked, false],
        ]
        for (const entry of order) {
          if (entry[1].length > 0) { showDiff({ path: entry[1][0].path, staged: entry[2], untracked: entry[0] === 'untracked' }); return }
        }
        setNote(t('note.noChanges'))
      }

      const stashMenu = (event) => {
        const count = summary === null ? 0 : summary.stashCount
        openMenuAt(event, [
          { id: 'stash-push', icon: 'stash', tone: 'violet', label: t('stash.push'), disabled: dirty === 0, reason: t('action.unavailable'), run: () => { void run('stashPush', { includeUntracked: true }) } },
          { id: 'stash-apply', icon: 'checkout', tone: 'accent', label: t('stash.apply'), disabled: count === 0, reason: t('action.unavailable'), run: () => { void run('stashApply', {}) } },
          { id: 'stash-drop', icon: 'trash', tone: 'danger', label: t('stash.drop'), danger: true, disabled: count === 0, reason: t('action.unavailable'), run: () => setDialog({ kind: 'stashDrop', ref: 'stash@{0}' }) },
          null,
          { id: 'stash-count', icon: 'tag', tone: 'secondary', label: fill(t('stash.count'), { n: count }), disabled: true, run: () => {} },
        ])
      }

      /* favorites/toggleFavoriteBranch live above branchMenu: a useCallback dep array is evaluated during render. */
      const headBranch = branches === null ? '' : branches.branch
      const tracked = summary !== null && summary.upstream !== null
      const stashCount = summary === null ? 0 : summary.stashCount
      const reason = t('action.unavailable')

      /* VS Code-style "..." menu — the SCM title menu: view mode, sort, sync,
         changes, branch/stash/tag shortcuts, and the Git-output view at the
         bottom. Every entry reuses the very handlers the rail rows and group
         heads already run, so the menu can never disagree with them. */
      /* The ⋯ menu, restructured to the FULL VS Code SCM ▸ tree (issue: the
         flat 22-item list ignored the submenu anatomy the user asked for).
         Groups are real submenus now (ContextMenu.items[]); every entry maps
         onto an action that already exists elsewhere in the panel, and the
         few new backend verbs (rebaseAbort / remoteAdd / remoteRemove /
         branchDeleteRemote / tagDeleteRemote / pushTags / stashClear) back
         their VS Code counterparts one-to-one. */
      const moreMenu = (event) => {
        const tagCount = branches === null || Array.isArray(branches.tags) !== true ? 0 : branches.tags.length
        const stageable = summary === null ? [] : summary.changes.unstaged.concat(summary.changes.untracked)
        const stagedPaths = summary === null ? [] : summary.changes.staged.map((entry) => entry.path)
        const allChangePaths = stagedPaths.concat(stageable.map((entry) => entry.path))
        const sort = (key) => () => setSortKey(key)
        const operation = summary === null ? null : summary.operation
        const pickRemote = (run) => (ev) => openMenuAt(ev, remoteNames.map((name) => ({
          id: 'remote:' + name, icon: 'fetch', tone: 'violet', label: name,
          run: () => run(name),
        })))
        const pickStash = (verb) => async (ev) => {
          try {
            const data = await request('stashList', base)
            const list = Array.isArray(data.stashes) ? data.stashes : []
            if (list.length === 0) { setNote(t('stash.none')); return }
            openMenuAt(ev, list.map((entry) => ({
              id: 'stash:' + entry.ref, icon: 'stash', tone: 'violet',
              label: entry.ref + ' · ' + entry.subject,
              run: () => { void run('stashApply', { ref: entry.ref, pop: verb === 'pop' }) },
            })))
          } catch (error) { void error }
        }
        openMenuAt(event, [
          /* —— view (VS Code: 以列表形式查看 / 查看和排序 ▸) —— */
          { id: 'view-flat', icon: 'commit', tone: 'secondary', label: t('changes.groupFlat'), active: groupBy === 'flat', run: () => setGroupBy('flat') },
          { id: 'view-dir', icon: 'folder', tone: 'secondary', label: t('changes.groupDir'), active: groupBy === 'dir', run: () => setGroupBy('dir') },
          { id: 'view-sort', icon: 'compare', tone: 'secondary', label: t('more.sort'), items: [
            { id: 'sort-git', label: t('more.sortGit'), active: sortKey === 'git', run: sort('git') },
            { id: 'sort-path', label: t('more.sortPath'), active: sortKey === 'path', run: sort('path') },
            { id: 'sort-name', label: t('more.sortName'), active: sortKey === 'name', run: sort('name') },
            { id: 'sort-status', label: t('more.sortStatus'), active: sortKey === 'status', run: sort('status') },
            null,
            /* The old header toggles live here now (v0.16.1): fold/unfold need
               the directory map, which only exists when grouping is on. */
            { id: 'view-expand', label: t('changes.expandAll'), disabled: groupBy !== 'dir', reason, run: () => setFoldedDirs({}) },
            { id: 'view-fold', label: t('changes.foldAll'), disabled: groupBy !== 'dir', reason, run: () => {
              const next = {}
              const changes = summary === null ? null : summary.changes
              if (changes !== null) {
                const groups = [['conflicted', changes.conflicted], ['staged', changes.staged], ['unstaged', changes.unstaged], ['untracked', changes.untracked], ['ignored', changes.ignored === undefined ? [] : changes.ignored]]
                for (const pair of groups) {
                  /* Fold every node of the compressed tree — the ids come from
                     the same builder the renderer uses, so single-chain nodes
                     ("a/b/c") fold exactly where they render (v0.18.6). */
                  const forest = buildDirForest(pair[1], pair[0])
                  if (forest.rootFiles.length > 0) next[pair[0] + '|/'] = true
                  for (const id of forest.ids) next[id] = true
                }
              }
              setFoldedDirs(next)
            } },
            null,
            { id: 'view-ignored', label: t('changes.showIgnored'), active: showIgnored === true, run: () => setShowIgnored(showIgnored !== true) },
          ] },
          null,
          /* —— top-level sync (VS Code header row) —— */
          { id: 'mm-pull', icon: 'pull', tone: 'accent', label: t('toolbar.pull'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void run('pull', { mode: 'ff-only' }) } },
          { id: 'mm-push', icon: 'push', tone: 'success', label: t('toolbar.push'), disabled: remoteReady !== true || blocked, reason, run: () => openPushDialog() },
          { id: 'mm-clone', icon: 'plus', tone: 'secondary', label: t('more.clone'), run: () => setDialog({ kind: 'clone' }) },
          { id: 'mm-checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout') + '...', disabled: otherBranches.length === 0 || blocked, reason, run: (ev) => pickBranchMenu(ev, 'checkout') },
          { id: 'mm-fetch', icon: 'fetch', tone: 'cyan', label: t('toolbar.fetch'), disabled: remoteReady !== true, reason, run: () => { void run('fetch', { prune: true }) } },
          null,
          /* —— SCM ▸ Commit ▸ —— */
          { id: 'sub-commit', icon: 'commit', tone: 'accent', label: t('more.commitGroup'), items: [
            { id: 'c-staged', label: t('more.commitStaged'), disabled: stagedPaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: false, amend: false, sign: false }) },
            { id: 'c-all', label: t('more.commitAll'), disabled: allChangePaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: true, amend: false, sign: false }) },
            null,
            { id: 'c-undo', label: t('more.undoCommit'), disabled: commits.length === 0 || blocked, reason, run: () => setDialog({ kind: 'undoCommit' }) },
            { id: 'c-abort', label: t('more.rebaseAbort'), disabled: operation !== 'rebase', reason, run: () => { void run('rebaseAbort', {}) } },
            null,
            { id: 'c-staged-amend', label: t('more.commitStagedAmend'), disabled: stagedPaths.length === 0 || commits.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: false, amend: true, sign: false }) },
            { id: 'c-all-amend', label: t('more.commitAllAmend'), disabled: allChangePaths.length === 0 || commits.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: true, amend: true, sign: false }) },
            null,
            { id: 'c-staged-sign', label: t('more.commitStagedSign'), disabled: stagedPaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: false, amend: false, sign: true }) },
            { id: 'c-all-sign', label: t('more.commitAllSign'), disabled: allChangePaths.length === 0, reason, run: () => setDialog({ kind: 'commitMsg', all: true, amend: false, sign: true }) },
          ] },
          /* —— SCM ▸ Changes ▸ —— */
          { id: 'sub-changes', icon: 'file', tone: 'secondary', label: t('more.changesGroup'), items: [
            { id: 'ch-stage', label: t('changes.stageAll'), disabled: stageable.length === 0, reason, run: () => { void run('stage', { paths: stageable.map((entry) => entry.path) }) } },
            { id: 'ch-unstage', label: t('changes.unstageAll'), disabled: stagedPaths.length === 0, reason, run: () => { void run('unstage', { paths: stagedPaths }) } },
            null,
            { id: 'ch-discard', label: t('more.discardAll'), danger: true, disabled: dirty === 0, reason, run: () => setDialog({ kind: 'discardAll' }) },
          ] },
          /* —— SCM ▸ Pull, Push ▸ —— */
          { id: 'sub-pullpush', icon: 'pull', tone: 'accent', label: t('more.pullpushGroup'), items: [
            { id: 'pp-sync', label: t('more.sync'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void (async () => { await run('pull', { mode: 'ff-only' }); await run('push', { confirm: true }) })() } },
            { id: 'pp-sync-rebase', label: t('more.syncRebase'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void (async () => { await run('pull', { mode: 'rebase' }); await run('push', { confirm: true }) })() } },
            null,
            { id: 'pp-pull', label: t('toolbar.pull'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void run('pull', { mode: 'ff-only' }) } },
            { id: 'pp-pull-rebase', label: t('more.pullRebase'), disabled: remoteReady !== true || tracked !== true || blocked, reason, run: () => { void run('pull', { mode: 'rebase' }) } },
            { id: 'pp-pull-from', label: t('more.pullFrom'), disabled: remoteNames.length === 0, reason, run: pickRemote((name) => { void run('pull', { mode: 'ff-only', remote: name }) }) },
            null,
            { id: 'pp-push', label: t('toolbar.push'), disabled: remoteReady !== true || blocked, reason, run: () => openPushDialog() },
            { id: 'pp-push-force', label: t('more.pushForce'), danger: true, disabled: remoteReady !== true || blocked, reason, run: () => setDialog({ kind: 'pushForce' }) },
            { id: 'pp-push-to', label: t('more.pushTo'), disabled: remoteNames.length === 0 || blocked, reason, run: pickRemote((name) => { void run('push', { remote: name, confirm: true }) }) },
            null,
            { id: 'pp-fetch', label: t('toolbar.fetch'), disabled: remoteReady !== true, reason, run: () => { void run('fetch', { prune: true }) } },
            { id: 'pp-fetch-all', label: t('more.fetchAll'), disabled: remoteNames.length === 0, reason, run: () => { void run('fetch', { all: true, prune: true }) } },
          ] },
          /* —— SCM ▸ Branch ▸ —— */
          { id: 'sub-branch', icon: 'branch', tone: 'secondary', label: t('more.branchGroup'), items: [
            { id: 'br-merge', label: t('action.mergeIntoCurrent'), disabled: otherBranches.length === 0 || blocked, reason, run: (ev) => pickBranchMenu(ev, 'merge') },
            { id: 'br-rebase', label: t('action.rebaseCurrentOnto'), disabled: otherBranches.length === 0 || blocked, reason, run: (ev) => pickBranchMenu(ev, 'rebase') },
            null,
            { id: 'br-new', label: t('toolbar.newBranch'), disabled: blocked, reason, run: () => setDialog({ kind: 'newBranch' }) },
            null,
            { id: 'br-rename', label: t('action.rename'), disabled: headBranch === '' || blocked, reason, run: () => setDialog({ kind: 'renameBranch', from: headBranch }) },
            { id: 'br-delete', label: t('action.delete'), danger: true, disabled: otherBranches.length === 0, reason, run: (ev) => pickBranchMenu(ev, 'delete') },
            { id: 'br-delete-remote', label: t('more.deleteRemoteBranch'), danger: true, disabled: remoteBranches.length === 0 || blocked, reason, run: (ev) => pickRemoteBranchMenu(ev) },
            null,
            { id: 'br-publish', label: t('more.publish'), disabled: remoteReady !== true || tracked === true || blocked, reason, run: () => { void run('push', { setUpstream: true, confirm: true }) } },
            /* Upstream management for the CURRENT branch (issue #18): same
               verbs as the branch-row menu, reachable without selecting a
               branch first. Submenu built inside run() like rm-remove. */
            { id: 'br-upstream', label: t('more.setUpstreamHead'), icon: 'fetch', tone: 'cyan', disabled: headBranch === '' || remoteBranches.length === 0 || blocked, reason, run: (ev) => openMenuAt(ev, remoteBranches.map((remoteEntry) => ({
              id: 'head-upstream:' + remoteEntry.name,
              icon: 'fetch', tone: 'cyan',
              label: remoteEntry.name,
              active: summary.upstream === remoteEntry.name,
              run: () => { void run('branch-upstream', { branch: headBranch, upstream: remoteEntry.name }) },
            }))) },
            { id: 'br-unset-upstream', label: t('more.unsetUpstreamHead'), icon: 'undo', tone: 'secondary', disabled: headBranch === '' || tracked !== true || blocked, reason, run: () => { void run('branch-upstream', { branch: headBranch, unset: true }) } },
          ] },
          /* —— SCM ▸ Remote ▸ —— */
          { id: 'sub-remote', icon: 'fetch', tone: 'violet', label: t('more.remoteGroup'), items: [
            { id: 'rm-add', label: t('more.addRemote'), run: () => setDialog({ kind: 'remoteAdd' }) },
            { id: 'rm-remove', label: t('more.removeRemote'), danger: true, disabled: remoteNames.length === 0, reason, run: (ev) => openMenuAt(ev, remoteNames.map((name) => ({
              id: 'rm-del:' + name, icon: 'trash', tone: 'danger', danger: true, label: name,
              run: () => setDialog({ kind: 'remoteRemove', name: name }),
            }))) },
          ] },
          /* —— SCM ▸ Stash ▸ —— */
          { id: 'sub-stash', icon: 'stash', tone: 'violet', label: t('more.stashGroup'), items: [
            { id: 'st-push', label: t('more.stashTracked'), disabled: dirty === 0, reason, run: () => { void run('stashPush', {}) } },
            { id: 'st-push-all', label: t('stash.push'), disabled: dirty === 0, reason, run: () => { void run('stashPush', { includeUntracked: true }) } },
            { id: 'st-push-staged', label: t('more.stashStaged'), disabled: stagedPaths.length === 0, reason, run: () => { void run('stashPush', { staged: true }) } },
            null,
            { id: 'st-apply', label: t('stash.apply'), disabled: stashCount === 0, reason, run: () => { void run('stashApply', {}) } },
            { id: 'st-apply-pick', label: t('more.stashApplyPick'), disabled: stashCount === 0, reason, run: pickStash('apply') },
            null,
            { id: 'st-pop', label: t('more.stashPop'), disabled: stashCount === 0, reason, run: () => { void run('stashApply', { pop: true }) } },
            { id: 'st-pop-pick', label: t('more.stashPopPick'), disabled: stashCount === 0, reason, run: pickStash('pop') },
            null,
            { id: 'st-drop', label: t('more.stashDropAny'), danger: true, disabled: stashCount === 0, reason, run: (ev) => pickStash('drop')(ev) },
            { id: 'st-clear', label: t('more.stashClear'), danger: true, disabled: stashCount === 0, reason, run: () => setDialog({ kind: 'stashClear' }) },
          ] },
          /* —— SCM ▸ Tags ▸ —— */
          { id: 'sub-tags', icon: 'tag', tone: 'warn', label: t('more.tagGroup'), items: [
            { id: 'tg-new', label: t('action.newTagHere'), disabled: commits.length === 0, reason, run: () => setDialog({ kind: 'newTag' }) },
            { id: 'tg-delete', label: t('more.deleteTag'), danger: true, disabled: tagCount === 0, reason, run: () => setDialog({ kind: 'deleteTag' }) },
            { id: 'tg-delete-remote', label: t('more.tagDeleteRemote'), danger: true, disabled: tagCount === 0 || remoteNames.length === 0 || blocked, reason, run: () => setDialog({ kind: 'deleteRemoteTag' }) },
            null,
            { id: 'tg-push', label: t('more.pushTags'), disabled: tagCount === 0 || remoteNames.length === 0 || blocked, reason, run: () => setDialog({ kind: 'pushTags' }) },
          ] },
          null,
        ])
      }
      /* One panel spec, two hosts: the compact chrome renders it inline, the
         commit layer renders it as the left half of the overlay (m01216). The
         only difference between the two is where a file click sends its diff. */
      const renderChanges = (onDiff) => E(ChangesPanel, {
        t: t, summary: summary, busy: busy, compact: compact, hideHeader: compact,
        groupBy: groupBy, sortKey: sortKey, onGroupBy: setGroupBy,
        foldedDirs: foldedDirs, onFoldedDirs: setFoldedDirs,
        onMoreMenu: moreMenu,
        request: request, cwd: cwd, sessionId: sessionId, base: base,
        showIgnored: showIgnored,
        onToggleIgnored: () => setShowIgnored((value) => !value),
        // Commit and push are two steps now (m02986): the commit lands, the
        // layer closes, and only then does the push dialog open with the fresh
        // commits. Failures stay in the layer; results go to notifications.
        onCommit: (message, amend, push, paths) => {
          void (async () => {
            /* paths: the ticked set; the host stages exactly these before it
               commits, so an unticked file is never swept in by `git add -A`. */
            const result = await run('commit', { message: message, amend: amend, paths: paths }, { quiet: true })
            /* Only a landed commit closes the layer; a rejected one keeps the
               message on screen while the failure surfaces as a notification. */
            if (result === undefined) return
            pushToast({ text: t('toast.committed'), tone: 'ok', icon: 'check' })
            if (push === true) openPushDialog()
          })()
        },
        onStage: (item) => { void run('stage', { paths: [item.path] }) },
        onUnstage: (item) => { void run('unstage', { paths: [item.path] }) },
        onStageAll: (entries) => { void run('stage', { paths: entries.map((entry) => entry.path) }) },
        onUnstageAll: () => { void run('unstage', { paths: (summary === null ? [] : summary.changes.staged).map((entry) => entry.path) }) },
        onDiscard: (item, group) => setDialog({ kind: 'discard', item: item, group: group }),
        onDiff: onDiff,
        onChangeMenu: changeMenu,
        /* ---- multi-select (issue #13) ---- */
        selection: changeSelection,
        onSelectionChange: onChangeSelection,
        anchorRef: changeAnchor,
        onBulkStage: bulkStageChanges,
        onBulkUnstage: bulkUnstageChanges,
        onBulkDiscard: openDiscardManyDialog,
        onCopySelection: copyChangeSelection,
        onKeyDown: onChangesKeyDown,
      })

      const changesPane = renderChanges((item, group) => {
        showDiff({ path: item.path, staged: group === 'staged', untracked: group === 'untracked' })
      })

      /* --- Rail acts on the branch-tree selection (v0.18.5) -------------------
         The tree reports its picks up; the rail resolves them back to live
         entries so "select main, press pull" pulls MAIN, not HEAD. With no
         selection every button keeps its old HEAD-oriented behaviour. */
      const pickedBranchEntries = () => {
        const out = []
        if (branches === null || branchPicks.size === 0) return out
        for (const key of branchPicks) {
          const colon = key.indexOf(':')
          const kind = key.slice(0, colon)
          const name = key.slice(colon + 1)
          if (kind === 'local') { const entry = branches.local.find((x) => x.name === name); if (entry !== undefined) out.push({ kind: 'local', name: name, entry: entry }) }
          else if (kind === 'remote') { const entry = branches.remote.find((x) => x.name === name); if (entry !== undefined) out.push({ kind: 'remote', name: name, entry: entry }) }
          else { const entry = branches.tags.find((x) => x.name === name); if (entry !== undefined) out.push({ kind: 'tag', name: name, entry: entry }) }
        }
        return out
      }
      /* "Pull" a branch that is NOT checked out: git pull would merge into
         HEAD, so a non-HEAD branch is fast-forwarded in place via a refspec
         fetch (`git fetch origin name:name` — git refuses a non-ff update,
         which is exactly the safety we want). run() never throws (the guard
         turns failures into a notification), so one bad branch does not
         abort the rest of the batch. */
      const pullPickedBranches = async (picked) => {
        for (const item of picked) {
          if (item.kind !== 'local') continue
          if (item.entry.head === true) { await run('pull', { mode: 'ff-only' }); continue }
          const upstream = item.entry.upstream
          if (upstream === null || upstream === undefined || upstream === '') continue
          const slash = upstream.indexOf('/')
          const remote = slash >= 0 ? upstream.slice(0, slash) : upstream
          await run('fetch', { remote: remote, branch: item.name + ':' + item.name })
        }
      }
      const fetchPickedRefs = async (picked) => {
        for (const item of picked) {
          if (item.kind === 'remote') { await run('fetch', { remote: item.name, prune: true }); continue }
          if (item.kind !== 'local') continue
          const upstream = item.entry.upstream
          if (upstream === null || upstream === undefined || upstream === '') continue
          const slash = upstream.indexOf('/')
          const remote = slash >= 0 ? upstream.slice(0, slash) : upstream
          await run('fetch', { remote: remote, branch: item.name + ':' + item.name })
        }
      }
      const railPicked = pickedBranchEntries()
      const railPickedLocals = railPicked.filter((item) => item.kind === 'local')

      /* One descriptor per action, with the availability IDEA would use: delete /
         checkout / compare need another local branch, fetch and push need a remote,
         pull needs an upstream, diff needs pending changes, tag needs a commit.
         The rail renders a user-chosen subset in a user-chosen order. */
      const railActions = RAIL_SPECS.map((spec) => {
        const entry = { id: spec.id, icon: spec.icon, tone: spec.tone, label: t(spec.key), disabled: false, active: false, run: () => {} }
        if (spec.id === 'tree') {
          // The chevron points at what the click does: right opens a closed
          // branch pane, left closes an open one (m01216 #3).
          entry.active = treeOpen
          entry.icon = treeOpen === true ? 'chevronLeft' : 'chevronRight'
          entry.run = () => foldTree(!treeOpen)
        }
        else if (spec.id === 'newBranch') entry.run = () => setDialog({ kind: 'newBranch' })
        else if (spec.id === 'delete') {
          if (railPicked.length > 0) { entry.label = fill(t('toolbar.deletePicked'), { n: railPicked.length }); entry.disabled = blocked; entry.run = () => deleteBranchEntries(railPicked) }
          else { entry.disabled = otherBranches.length === 0; entry.run = (event) => pickBranchMenu(event, 'delete') }
        }
        else if (spec.id === 'compare') { entry.disabled = otherBranches.length === 0; entry.run = (event) => pickBranchMenu(event, 'compare') }
        else if (spec.id === 'fetch') {
          if (railPicked.length > 0) { entry.label = fill(t('toolbar.fetchPicked'), { n: railPicked.length }); entry.disabled = blocked; entry.run = () => { void fetchPickedRefs(railPicked) } }
          else { entry.disabled = remoteReady !== true; entry.run = () => { void run('fetch', { prune: true }) } }
        }
        else if (spec.id === 'pull') {
          if (railPickedLocals.length > 0) { entry.label = fill(t('toolbar.pullPicked'), { n: railPickedLocals.length }); entry.disabled = blocked; entry.run = () => { void pullPickedBranches(railPickedLocals) } }
          else { entry.disabled = remoteReady !== true || tracked !== true || blocked; entry.run = () => { void run('pull', { mode: 'ff-only' }) } }
        }
        else if (spec.id === 'favorite') {
          // One picked LOCAL branch stars/unstars THAT branch; with no selection
          // it keeps starring the current one. Multi-select stays disabled —
          // favorites are per-branch and the toggle model does not batch well.
          const target = railPickedLocals.length === 1 ? railPickedLocals[0].name : headBranch
          entry.disabled = target === ''
          entry.active = favorites.indexOf(target) >= 0
          entry.run = () => toggleFavoriteBranch(target)
        }
        // A running git command greys out the repository actions, never the view.
        if (busy === true && RAIL_VIEW_IDS.indexOf(spec.id) < 0) entry.disabled = true
        return entry
      })

      const railOrdered = railConfig.order
        .map((id) => railActions.find((action) => action.id === id))
        // An action this mount cannot perform is not rendered at all — hidden, not
        // disabled: a greyed button for a service the host does not have is noise.
        .filter((action) => action !== undefined && action.available !== false)
      const railVisible = railOrdered.filter((action) => railConfig.hidden.indexOf(action.id) < 0)


      const RAIL_SLOT = 26
      const railCapacityOf = (vertical) => {
        const span = vertical ? railBox.height : railBox.width
        if (span <= 0) return railVisible.length + 1
        return Math.max(1, Math.floor((span - (vertical ? 10 : 12)) / RAIL_SLOT))
      }

      /* Renders the rail for one orientation: as many buttons as fit, then a more
         menu that lists EVERY action, then the settings button pinned to the end. */
      const renderRail = (vertical) => {
        const capacity = railCapacityOf(vertical)
        // The settings button is never dropped and never pushed out: the more
        // button only appears when there is room for it AND for settings.
        const overflow = railVisible.length + 1 > capacity && capacity >= 3
        const slots = overflow
          ? Math.max(1, capacity - 2)
          : Math.min(railVisible.length, Math.max(0, capacity - 1))
        // Disabled buttons keep their tooltip: a real `disabled` attribute
        // swallows hover events in the browser, which is exactly why the
        // explanation went missing on a busy repository. aria-disabled only
        // changes the look, the click is guarded below.
        const children = railVisible.slice(0, slots).flatMap((action, index) => [
          // The pane-collapse chevron sits in this same column, above a hairline
          // (IDEA draws it that way); it is never a column of its own.
          index === 1 && vertical === true ? E('span', { key: 'rail-sep', className: 'git4idea-rail-sep' }) : null,
          E('button', {
            key: action.id,
            type: 'button',
            className: 'git4idea-rail-btn'
              + (action.id === 'favorite' ? ' git4idea-rail-star' : '')
              + (action.active === true ? ' git4idea-rail-btn-active' : '')
              + (action.spinning === true ? ' git4idea-spin' : ''),
            'data-action': action.id,
            'aria-pressed': action.active === true ? 'true' : 'false',
            'aria-disabled': action.disabled === true ? 'true' : 'false',
            'data-tip': action.disabled === true ? action.label + ' · ' + reason : action.label,
            onClick: (event) => { if (action.disabled === true) return; action.run(event) },
          }, E(Icon, { name: action.icon, size: 18 })),
        ].filter((node) => node !== null))
        if (overflow === true) {
          children.push(E('button', {
            key: 'more',
            type: 'button',
            className: 'git4idea-rail-btn git4idea-rail-more',
            'data-tip': t('rail.more'),
            onClick: (event) => openMenuAt(event, railActions.map((action) => ({
              id: 'rail:' + action.id,
              icon: action.icon,
              tone: action.tone,
              label: action.label,
              disabled: action.disabled,
              active: action.active,
              reason: reason,
              run: (inner) => action.run(inner === undefined ? event : inner),
            }))),
          }, E(Icon, { name: 'more', size: 18 })))
        }
        return E('div', { className: vertical ? 'git4idea-rail' : 'git4idea-rail-row', ref: railHostRef }, children)
      }

      /* ---------- body per chrome ---------- */

      /* ---------- body per chrome ---------- */

      /* The history↔diff separator only exists while a diff is on screen, and it
         lives inside the middle pane — the diff is the pane below it. */
      const diffGutter = diffPane === null ? null : gutter('diff', 'next')

      let body
      if (repoState === null) {
        /* The scan is still running: a neutral loading state, never the
           "no repository found" verdict (that text is reserved for a scan
           that actually came back empty). */
        body = E('div', { className: 'git4idea-body', ref: bodyRef }, E('div', { className: 'git4idea-empty' }, t('status.loading')))
      } else if (repoRoot === null) {
        body = E('div', { className: 'git4idea-body', ref: bodyRef }, E(RepoPicker, {
          t: t, cwd: cwd === undefined ? '' : cwd, repos: repoOptions, onPick: pickRepo,
        }))
      } else if (compact) {
        body = E('div', { className: 'git4idea-body git4idea-body-compact', ref: bodyRef },
          E('div', { className: 'git4idea-compact-bar' },
            E(Segmented, {
              value: view === 'detail' ? 'history' : view,
              onChange: (next) => { setView(next); setPatch(''); setDiffContext(null) },
              items: [
                { id: 'changes', label: fill(t('seg.changes'), { n: dirty }) },
                { id: 'history', label: t('seg.history') },
              ],
            }),
            E('span', { className: 'git4idea-topbar-spacer' }),
            // Two-way on purpose: treeOpen is persisted, so a header button that
            // only rendered while the tree was OPEN left a folded tree with no way
            // back on this chrome (the rail now carries one too, for the others).
            E('button', {
              type: 'button',
              className: 'git4idea-icon-btn' + (treeOpen ? ' git4idea-icon-btn-active' : ''),
              'data-action': 'tree',
              'aria-pressed': treeOpen ? 'true' : 'false',
              'data-tip': t('toolbar.tree'),
              onClick: () => foldTree(!treeOpen),
            }, E(Icon, { name: treeOpen ? 'chevronLeft' : 'chevronRight' }))),
          treeOpen ? E('div', { className: 'git4idea-compact-tree', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          view === 'changes' ? changesPane : view === 'detail'
            ? E('div', { className: 'git4idea-pane git4idea-pane-main git4idea-pane-detail' }, detailPane)
            : E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane))
      } else if (columns) {
        // The collapse chevron lives in the action rail, in the same column as the
        // other buttons (m01216 #3), so a folded tree needs no strip of its own.
        body = E('div', { className: 'git4idea-body git4idea-body-columns', ref: bodyRef },
          treeOpen ? E('div', { className: 'git4idea-pane git4idea-pane-tree', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane),
          gutter('changes', 'next'),
          /* Third column = the picked commit (m01216): changed files over the
             message. It keeps the 'changes' pane key so stored widths survive. */
          E('div', { className: 'git4idea-pane git4idea-pane-changes git4idea-pane-detail', 'data-pane': 'changes', style: paneStyle('changes') }, detailPane))
      } else {
        body = E('div', { className: 'git4idea-body git4idea-body-stack', ref: bodyRef },
          treeOpen ? E('div', { className: 'git4idea-pane git4idea-pane-tree-stack', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          E('div', { className: 'git4idea-pane git4idea-pane-changes-stack git4idea-pane-detail', 'data-pane': 'changes', style: paneStyle('changes') }, detailPane),
          gutter('changes', 'prev'),
          E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane))
      }

      /* ---------- overlays ---------- */

      const overlays = []
      if (menu !== null) {
        overlays.push(E(ContextMenu, {
          key: 'menu',
          anchor: { x: menu.x, y: menu.y },
          boundsWidth: menu.boundsWidth,
          boundsHeight: menu.boundsHeight,
          items: menu.items,
          onClose: () => setMenu(null),
        }))
      }
      if (dialog !== null && (dialog.kind === 'newBranch' || dialog.kind === 'createTracking' || dialog.kind === 'renameBranch' || dialog.kind === 'newTag' || dialog.kind === 'deleteTag' || dialog.kind === 'commitMsg')) {
        const titles = { newBranch: t('prompt.newBranch'), createTracking: t('prompt.createTracking'), renameBranch: t('prompt.renameBranch'), newTag: t('prompt.newTag'), deleteTag: t('prompt.deleteTag'), commitMsg: t('prompt.commitMessage') }
        overlays.push(E(PromptDialog, {
          key: 'prompt',
          title: titles[dialog.kind],
          placeholder: dialog.from === undefined ? t('prompt.fromHead') : dialog.from,
          initialValue: dialog.kind === 'renameBranch' ? dialog.from : (dialog.kind === 'createTracking' ? dialog.name : ''),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (value) => { void submitDialog(dialog, value) },
        }))
      }
      if (dialog !== null && dialog.kind === 'clone') {
        overlays.push(E(CloneDialog, {
          key: 'clone',
          title: t('clone.title'),
          urlPlaceholder: t('clone.url'),
          dirPlaceholder: t('clone.dir'),
          okLabel: t('clone.run'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (url, dir) => { setDialog(null); void run('clone', { url: url, dir: dir }) },
        }))
      }
      /* SCM ▸ additions (v0.15): each destructive one is a ConfirmDialog whose
         text names the exact target; the tag/remote ones carry the picked
         remote through. */
      if (dialog !== null && dialog.kind === 'undoCommit') {
        overlays.push(E(ConfirmDialog, {
          key: 'undoCommit', t: t,
          title: t('confirm.title'),
          text: t('confirm.undoCommit'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void undoLastCommit() },
        }))
      }
      if (dialog !== null && dialog.kind === 'discardAll') {
        overlays.push(E(ConfirmDialog, {
          key: 'discardAll', t: t,
          title: t('confirm.title'),
          text: t('confirm.discardAll'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void discardAllChanges() },
        }))
      }
      if (dialog !== null && dialog.kind === 'pushForce') {
        overlays.push(E(ConfirmDialog, {
          key: 'pushForce', t: t,
          title: t('confirm.title'),
          text: t('confirm.pushForce'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('push', { force: true, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'deleteRemoteBranch') {
        overlays.push(E(ConfirmDialog, {
          key: 'deleteRemoteBranch', t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.deleteRemoteBranch'), { remote: dialog.remote, branch: dialog.branch }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const r = dialog.remote; const b = dialog.branch; setDialog(null); void run('branchDeleteRemote', { remote: r, branch: b, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'remoteAdd') {
        overlays.push(E(CloneDialog, {
          key: 'remoteAdd',
          title: t('more.addRemote'),
          urlPlaceholder: t('prompt.remoteName'),
          dirPlaceholder: t('prompt.remoteUrl'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (name, url) => { setDialog(null); void run('remoteAdd', { name: name, url: url }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'remoteRemove') {
        overlays.push(E(ConfirmDialog, {
          key: 'remoteRemove', t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.remoteRemove'), { name: dialog.name }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const n = dialog.name; setDialog(null); void run('remoteRemove', { name: n, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'stashClear') {
        overlays.push(E(ConfirmDialog, {
          key: 'stashClear', t: t,
          title: t('confirm.title'),
          text: t('confirm.stashClear'),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('stashClear', { confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'deleteRemoteTag') {
        overlays.push(E(PromptDialog, {
          key: 'deleteRemoteTag',
          title: t('more.tagDeleteRemote'),
          placeholder: fill(t('prompt.deleteRemoteTag'), { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0] }),
          initialValue: '',
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onSubmit: (name) => { setDialog(null); void run('tagDeleteRemote', { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0], name: name, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'pushTags') {
        overlays.push(E(ConfirmDialog, {
          key: 'pushTags', t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.pushTags'), { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0] }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('pushTags', { remote: remoteNames[0] === undefined ? 'origin' : remoteNames[0], confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'deleteBranch') {
        const guarded = isProtectedBranch(dialog.name)
        overlays.push(E(ConfirmDialog, {
          key: 'delete',
          t: t,
          title: t('confirm.title'),
          text: fill(guarded ? t('confirm.protected') : t('delete.confirm'), { name: dialog.name }),
          requireText: guarded ? dialog.name : undefined,
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const name = dialog.name; setDialog(null); void deleteBranch(name) },
        }))
      }
      if (dialog !== null && dialog.kind === 'stashDrop') {
        overlays.push(E(ConfirmDialog, {
          key: 'stashDrop',
          t: t,
          title: t('confirm.title'),
          text: fill(t('stashDrop.confirm'), { ref: dialog.ref }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { const ref = dialog.ref; setDialog(null); void dropStash(ref) },
        }))
      }
      /* Multi-select delete (issue #13): local branches / remote branches / tags
         in ONE confirm — each rides its existing destructive host method, and a
         protected local branch keeps the type-the-name gate. */
      if (dialog !== null && dialog.kind === 'deleteRefs') {
        const guardedName = dialog.locals.find((name) => isProtectedBranch(name) === true)
        const listed = dialog.locals
          .concat(dialog.tags)
          .concat(dialog.remotes.map((item) => item.remote + '/' + item.branch))
        const listText = listed.length <= 8 ? listed.join('、') : listed.slice(0, 8).join('、') + ' …'
        overlays.push(E(ConfirmDialog, {
          key: 'deleteRefs',
          t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.deleteRefs'), { b: dialog.locals.length, r: dialog.remotes.length, g: dialog.tags.length })
            + (listText === '' ? '' : ' ' + listText),
          requireText: guardedName === undefined ? undefined : guardedName,
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            const locals = dialog.locals
            const tags = dialog.tags
            const remotes = dialog.remotes
            setDialog(null)
            if (locals.length > 0) void deleteBranches(locals)
            if (tags.length > 0) void run('tagDelete', { names: tags })
            const byRemote = new Map()
            for (const item of remotes) {
              if (byRemote.has(item.remote) === false) byRemote.set(item.remote, [])
              byRemote.get(item.remote).push(item.branch)
            }
            for (const pair of byRemote) void run('branchDeleteRemote', { remote: pair[0], branches: pair[1], confirm: true })
          },
        }))
      }
      /* Multi-select discard: tracked paths go through `checkout --`, untracked
         through `clean -fd` — the same two-lane split as Discard All. */
      if (dialog !== null && dialog.kind === 'discardMany') {
        overlays.push(E(ConfirmDialog, {
          key: 'discardMany',
          t: t,
          title: t('confirm.title'),
          text: fill(t('confirm.discardMany'), { n: dialog.tracked.length + dialog.untracked.length })
            + (dialog.untracked.length > 0 ? ' ' + fill(t('confirm.discardManyUntracked'), { m: dialog.untracked.length }) : ''),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            const tracked = dialog.tracked
            const untracked = dialog.untracked
            setDialog(null)
            if (tracked.length > 0) void run('discard', { paths: tracked, confirm: true })
            if (untracked.length > 0) void run('discard', { paths: untracked, untracked: true, confirm: true })
          },
        }))
      }
      if (dialog !== null && dialog.kind === 'discard') {
        overlays.push(E(ConfirmDialog, {
          key: 'discard',
          t: t,
          title: t('confirm.title'),
          text: dialog.group === 'untracked'
            ? fill(t('discard.untracked.confirm'), { path: dialog.item.path })
            : fill(t('discard.confirm'), { path: dialog.item.path }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            const item = dialog.item
            const group = dialog.group
            setDialog(null)
            void discardChanges(item, group)
          },
        }))
      }
      if (dialog !== null && dialog.kind === 'reset') {
        overlays.push(E(ConfirmDialog, {
          key: 'reset', t: t,
          title: t('confirm.title'),
          text: dialog.mode === 'hard' ? fill(t('resetHard.confirm'), { hash: dialog.hash.slice(0, 8) }) : fill(t('resetSoft.confirm'), { hash: dialog.hash.slice(0, 8) }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('reset', { hash: dialog.hash, mode: dialog.mode, confirm: true }) },
        }))
      }
      if (dialog !== null && dialog.kind === 'checkoutCommit') {
        overlays.push(E(ConfirmDialog, {
          key: 'checkoutCommit', t: t,
          title: t('confirm.title'), text: fill(t('checkoutCommit.confirm'), { hash: dialog.hash.slice(0, 8) }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => { setDialog(null); void run('checkout', { branch: dialog.hash }) },
        }))
      }
      // Batch push of the picked local branches — one confirmation naming every
      // branch, then a plain `git push origin name` per branch (each sets its
      // own upstream when it does not track one yet).
      if (dialog !== null && dialog.kind === 'pushMany') {
        overlays.push(E(ConfirmDialog, {
          key: 'pushMany', t: t,
          title: t('confirm.title'), text: fill(t('push.confirmMany'), { n: dialog.items.length, names: dialog.items.map((item) => item.name).join(', ') }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            setDialog(null)
            void (async () => {
              for (const item of dialog.items) {
                await run('push', { branch: item.name, confirm: true, setUpstream: item.upstream === null || item.upstream === undefined })
              }
            })()
          },
        }))
      }

      // Wide chromes (the bottom workbench) get the vertical IDE rail on the left;
      // narrow ones (the native right sidebar) get the same actions as one
      // horizontal row under the repo/branch bar, and every action lives in
      // exactly one place.
      // While a divider is being dragged the whole panel stops selecting text and
      // keeps the resize cursor, even though the pointer has left the 8px gutter.
      /* 日志 / 控制台 / 工作树 wrap the whole view, not only the detail pane:
         IDEA puts its tab strip above the tree and the log alike. The log tab
         receives the current chrome (rail + shell) as children. */
      const logBody = E(Fragment, null,
        columns === true || repoRoot === null ? null : renderRail(false),
        E('div', { className: 'git4idea-shell' },
          columns === true && repoRoot !== null ? renderRail(true) : null,
          body))

      return E('div', {
        className: 'git4idea-root'
          + (compact ? ' git4idea-root-narrow' : '')
          + (paneDragging === null ? '' : ' git4idea-pane-dragging' + (paneByWidth ? '-v' : '-h')),
        ref: hostRef,
      },
        E(Workbench, {
          t: t, base: base, request: request,
          /* The tab strip sits above the branch row (m00174), so the branch
             bar travels with the workbench and paints under the tabs. */
          topBar: topBar,
          branch: summary === null ? '' : summary.branch,
          selectedHash: selectedHash,
          branches: branches, repoRoot: repoRoot,
          consoleTick: consoleTick,
          showTabs: repoState !== null && repoRoot !== null,
          openMenuAt: openMenuAt,
          notifyOk: notifyOk,
        }, logBody),
        overlays)
    }

    function copyText(text) {
      try {
        void navigator.clipboard.writeText(text)
      } catch (error) { void error }
    }

    /* The branch context menu is text-only (user request): IDEA's glyph column
       is noise there, so the rows carry labels only. Submenu rows are flattened
       the same way before they reach the shared ContextMenu. */
    function withoutIcons(items) {
      return items.map((item) => (item === null ? null : Object.assign({}, item, { icon: undefined })))
    }

    /* ============================== styles ============================== */
    /* Tokens only (--dsw-alias-*): transparent themes and background plugins
       (dsh-any-background) keep showing through, like the host's own panels. */

    /* Lane-hover trace, generated: one rule per lane (lanes are capped at
       GRAPH_MAX_LANES, so this is a fixed handful). When the scroll container
       carries data-hover-lane="N", every graph stroke whose data-lane differs
       fades — the hovered lane reads as one continuous thread down the graph
       with zero React involvement. */
    const LANE_TRACE_RULES = []
    for (let lane = 0; lane < GRAPH_MAX_LANES; lane += 1) {
      LANE_TRACE_RULES.push(
        '.git4idea-history-scroll[data-hover-lane="' + lane + '"] .git4idea-graph line:not([data-lane="' + lane + '"])'
        + ',.git4idea-history-scroll[data-hover-lane="' + lane + '"] .git4idea-graph path:not([data-lane="' + lane + '"])'
        + ',.git4idea-history-scroll[data-hover-lane="' + lane + '"] .git4idea-graph circle:not([data-lane="' + lane + '"])'
        + '{stroke-opacity:.18;fill-opacity:.18}',
      )
    }
    LANE_TRACE_RULES.push('.git4idea-graph line,.git4idea-graph path,.git4idea-graph circle{transition:stroke-opacity .15s,fill-opacity .15s}')
    /* The rail refresh button spins while its fetch+refresh round-trip runs. */
    LANE_TRACE_RULES.push('.git4idea-spin svg{animation:git4idea-spin-rotate .9s linear infinite}')
    LANE_TRACE_RULES.push('@keyframes git4idea-spin-rotate{to{transform:rotate(360deg)}}')

    const CSS = [
      '.git4idea-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif);font-size:13px;line-height:1.5;font-weight:400;overflow:hidden}',
      '.git4idea-topbar{display:flex;align-items:center;gap:6px;padding:4px 6px;flex:none;min-width:0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow:hidden}',
      '.git4idea-topbar-spacer{flex:1;min-width:4px}',
      '.git4idea-select-wrap{display:inline-flex;align-items:center;gap:4px;min-width:0;flex:0 1 auto;max-width:90%;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-select{appearance:none;-webkit-appearance:none;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-primary);font:inherit;padding:1px 6px;height:22px;max-width:min(280px,42%);min-width:0;cursor:pointer;text-overflow:ellipsis}',
      '.git4idea-select:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-select:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}',
      '.git4idea-select-btn{display:inline-flex;align-items:center;gap:4px;text-align:left;white-space:nowrap;overflow:hidden}',
      '.git4idea-select-btn .git4idea-repo-name{flex:1;min-width:0;max-width:none}',
      '.git4idea-select-repo{max-width:none}',
      '.git4idea-select option,.git4idea-filter-select option{background:var(--dsw-alias-bg-layer-1,#22262e);color:var(--dsw-alias-label-primary,#e6e8ee)}',
      /* Long branch names (the topbar picker): the cap lives on the WRAP (a
         direct topbar child, so the percentage resolves against the bar). The
         button grows a SECOND LINE instead of ellipsising — a sidebar is
         ~400px wide, and a 600px branch name simply cannot fit on one line,
         but two lines hold it (the user-facing rule: show the WHOLE name).
         The full name also rides on the wrapper's title. */
      '.git4idea-select-branch{max-width:none;height:auto;min-height:22px;align-items:center}',
      '.git4idea-select-branch .git4idea-repo-name{white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:1.3}',
      '.git4idea-repo-static{display:inline-flex;align-items:center;gap:5px;min-width:0;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-repo-name{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:none}',
      '.git4idea-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;flex:none}',
      '.git4idea-icon-btn:hover:not(:disabled):not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-icon-btn:disabled,.git4idea-icon-btn[aria-disabled="true"]{opacity:.4;cursor:default}',
      '.git4idea-icon-btn-active{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}',
      '.git4idea-shell{flex:1;min-height:0;display:flex;overflow:hidden}',
      '.git4idea-rail{width:32px;flex:none;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0;overflow:hidden;border-right:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-rail-gap{flex:1;min-height:2px}',
      '.git4idea-rail-gap-x{flex:1;min-width:2px}',
      '.git4idea-rail-row{display:flex;align-items:center;gap:2px;padding:3px 6px;flex:none;overflow:hidden;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-rail-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;flex:none}',
      '.git4idea-rail-btn:hover:not(:disabled):not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-rail-btn:disabled,.git4idea-rail-btn[aria-disabled="true"]{opacity:.28;cursor:default}',
      '.git4idea-rail-star{color:var(--dsw-alias-state-warn-primary,#e0b341)}',
      '.git4idea-rail-star:hover:not([aria-disabled="true"]){color:var(--dsw-alias-state-warn-primary,#e0b341)}',
      '.git4idea-rail-sep{width:18px;height:1px;margin:3px 0;flex:none;background:var(--dsw-alias-border-l2)}',
      '.git4idea-rail-row .git4idea-rail-sep{display:none}',
      '.git4idea-rail-btn-active{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)}',
      '.git4idea-rail-more{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-rail-more:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-tone-primary{color:var(--dsw-alias-label-primary)}',
      '.git4idea-tone-secondary{color:var(--dsw-alias-label-secondary)}',
      '.git4idea-tone-accent{color:var(--dsw-alias-brand-primary)}',
      '.git4idea-tone-success{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-tone-warn{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-tone-danger{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-tone-violet{color:#b083f0}',
      '.git4idea-tone-cyan{color:#59b0d6}',
      '.git4idea-tone-business{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-icon-btn-small{width:20px;height:20px;border-radius:var(--dsw-radius-xs,4px)}',
      /* Branch-bar verbs (m00174): icon, name and a count chip in one tight
         button, so the row reads as "push 2 / update 1 / commit 3" like IDEA. */
      '.git4idea-track-btn{width:auto;padding:0 5px;gap:4px}',
      '.git4idea-track-btn>span{display:inline-flex;align-items:center;gap:3px}',
      '.git4idea-track-num{min-width:15px;height:15px;padding:0 4px;border-radius:999px;corner-shape:round;display:inline-flex;align-items:center;justify-content:center;flex:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;font-variant-numeric:tabular-nums}',
      '.git4idea-track-commit{color:var(--dsw-alias-label-primary)}',
      '.git4idea-track-label{font-size:11px;line-height:1;white-space:nowrap}',
      // A panel dragged narrower than COMPACT_MAX_WIDTH (the compact chrome) is the
      // case where 'nowrap + ellipsis' stops being readable: the overlays clamp
      // their own width, and their text wraps inside that box instead of clipping.
      // The settings card (the host's plugin page renders it inside its own
      // section): one row per rail action, themed entirely by tokens.
      // The card shell below is the visual twin of the pc-card / dl-card /
      // gb-card pattern the sibling plugins draw.
      '.git4idea-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}',
      '.git4idea-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.git4idea-card.git4idea-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.git4idea-card-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:var(--dsw-radius-md,12px)}',
      '.git4idea-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.git4idea-card-header-flat{cursor:default}',
      '.git4idea-card-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.git4idea-card-name{font-size:15px;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.git4idea-card-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-card-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
      '.git4idea-card-chevron.git4idea-card-chevron-open{transform:rotate(180deg)}',
      '.git4idea-card-body{padding:8px 16px 16px}',
      '.git4idea-card-page{max-width:640px}',
      '.git4idea-settings{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.git4idea-settings-head{display:flex;flex-direction:column;gap:2px}',
      '.git4idea-settings-title{color:var(--dsw-alias-label-primary)}',
      '.git4idea-settings-hint{color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.git4idea-settings-note{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary));font-weight:400}',
      '.git4idea-settings-note-hidden{display:none}',
      '.git4idea-settings-error{color:var(--dsw-alias-state-error-primary);font-weight:400}',
      '.git4idea-settings-subnote{color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:12px}',
      '.git4idea-settings-sub{margin-top:6px;color:var(--dsw-alias-label-primary)}',
      '.git4idea-settings-text{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.git4idea-settings-text-label{color:var(--dsw-alias-label-secondary);font-weight:400}',
      '.git4idea-settings-input{width:100%;box-sizing:border-box;font:inherit}',
      '.git4idea-commit-ai{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}',
      '.git4idea-commit-lang{flex:none;height:22px;max-width:none;font-size:11px}',
      /* m05308: the IDEA split — the change list takes two thirds of the left
         column and the message box one third, at a fixed height. */
      '.git4idea-commit-layer-left .git4idea-commit-box{flex:0 0 33%;min-height:0;overflow:hidden}',
      '.git4idea-commit-layer-left .git4idea-textarea{flex:1 1 auto;min-height:0;overflow-y:auto;resize:none}',
      '.git4idea-commit-ai-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.git4idea-commit-ai-hint-block{flex:1 0 100%;font-size:11px}',
      '.git4idea-commit-ai-note{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary));font-size:11px;margin-bottom:4px;word-break:break-word}',
      '.git4idea-settings-list{display:flex;flex-direction:column;gap:2px;max-height:min(46vh,360px);overflow:auto;padding:2px;border:1px solid var(--dsw-alias-hairline,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-sm,8px)}',
      '.git4idea-settings-row{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:calc(var(--dsw-radius-sm,8px) - 2px);cursor:pointer;min-width:0}',
      '.git4idea-settings-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-settings-check{flex:none;accent-color:var(--dsw-alias-brand-primary)}',
      '.git4idea-settings-glyph{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-settings-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-root-narrow .git4idea-settings-label{white-space:normal}',
      /* Collapsible setting sections (hand-drawn, same pattern as dsh-gitbash-shell v0.38.4). */
      '.git4idea-fold{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);padding:4px 12px 12px;background:var(--dsw-alias-bg-layer-1,transparent)}',
      '.git4idea-fold .git4idea-stack{padding-top:10px}',
      '.git4idea-foldHead{display:flex;align-items:center;gap:8px;width:100%;appearance:none;background:none;border:0;padding:6px 0;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}',
      '.git4idea-foldHead:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-foldChevron{flex:none;display:inline-block;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
      '.git4idea-foldChevron.git4idea-foldChevronOpen{transform:rotate(90deg)}',
      '.git4idea-foldTitle{min-width:0;overflow-wrap:anywhere}',
      '.git4idea-root-narrow .git4idea-menu-item{white-space:normal}',
      '.git4idea-root-narrow .git4idea-toast-text{white-space:normal}',
      '.git4idea-tip{position:fixed;z-index:120;pointer-events:none;max-width:340px;padding:4px 8px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2,transparent);background:var(--dsw-alias-bg-layer-2,rgba(28,30,34,.98));box-shadow:var(--dsw-elevation-prominent,0 8px 22px rgba(0,0,0,.34));color:var(--dsw-alias-label-primary,inherit);font:400 12px/1.45 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif);white-space:pre-wrap;overflow-wrap:anywhere}',
      /* the tooltip node lives on body; keep it above the toasts */
      /* m00761: the stack lives on document.body, above every app layer (the
         frame's overlay layer and the composer are stacking contexts), so no
         page chrome can paint over a notice. */
      '.git4idea-toasts{position:fixed;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px;z-index:2147483000;max-width:min(380px,92%);align-items:stretch}',
      '.git4idea-toast{display:flex;align-items:flex-start;gap:6px;padding:9px 8px 9px 12px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));border:0;box-shadow:var(--dsw-elevation-prominent,0 8px 22px rgba(0,0,0,.32))}',
      /* m02407 #3: two lines while the pointer is away, the whole result while it
         is on the chip, and a pinned-open chip scrolls past min(40vh, 240px). */
      '.git4idea-toast-text{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;cursor:pointer}',
      '.git4idea-toast:hover .git4idea-toast-text,.git4idea-toast-open .git4idea-toast-text{display:block;-webkit-line-clamp:unset;max-height:min(40vh,240px);overflow:auto}',
      '.git4idea-toast-action{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;cursor:pointer;padding:0 2px;flex:none}',
      '.git4idea-toast-action:hover{text-decoration:underline}',
      '.git4idea-toast-close{flex:none;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1}',
      '.git4idea-opchip{flex:none;padding:0 6px;border-radius:999px;corner-shape:round;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary)) 20%, transparent);color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary));white-space:nowrap}',
      '.git4idea-rail-list{display:flex;flex-direction:column;gap:2px;max-height:min(50vh,300px);overflow:auto;padding:2px;border:1px solid var(--dsw-alias-hairline,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-sm,8px)}',
      '.git4idea-rail-item{display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:calc(var(--dsw-radius-sm,8px) - 2px)}',
      '.git4idea-rail-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-rail-item-off{opacity:.5}',
      '.git4idea-rail-item-drag{outline:1px solid var(--dsw-alias-brand-primary)}',
      '.git4idea-rail-grip{display:inline-flex;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary));cursor:grab;flex:none}',
      '.git4idea-rail-item-icon{display:inline-flex;flex:none}',
      '.git4idea-rail-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-body{flex:1;min-height:0;display:flex;overflow:hidden}',
      '.git4idea-body-columns{flex-direction:row}',
      '.git4idea-body-stack{flex-direction:column}',
      '.git4idea-body-compact{flex-direction:column}',
      '.git4idea-pane{display:flex;flex-direction:column;min-height:0;min-width:0}',
      /* m02407 #2: the columns split 1:2:2 — the two 8px dividers come off the top
         first, then one fifth to the tree and two fifths to each of the other two. */
      '.git4idea-pane-tree{width:calc((100% - 16px)/5);flex:none;border-right:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-pane-tree-stack{max-height:36%;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-pane-main{flex:1;min-width:0}',
      '.git4idea-pane-changes{width:calc((100% - 16px)*2/5);flex:none;border-left:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-pane-changes-stack{max-height:46%;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      /* Commit detail (m01216 #8): the third column IS the detail now, so the
         file list owns the top two thirds and the message the bottom third; each
         side scrolls on its own, and a 300-file commit never pushes the message
         out of the pane. */
      '.git4idea-pane-detail{overflow:hidden}',
      '.git4idea-detail-pane{flex:1;gap:4px;overflow:hidden;padding:6px 8px}',
      '.git4idea-detail-pane .git4idea-detail-files-head{flex:none;margin-top:0}',
      '.git4idea-detail-pane .git4idea-detail-files{flex:2 1 0;min-height:0;overflow:auto}',
      '.git4idea-detail-files>.git4idea-row{flex:none}',
      '.git4idea-detail-files>.git4idea-folder-head{flex:none}',
      '.git4idea-detail-pane .git4idea-detail-msg{flex:1 1 0;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px}',
      /* Commit layer (m01216 #9): pending changes + message on the left, the
         host-style diff on the right. Roomy enough for a real diff, and it only
         covers the panel — the conversation stays visible around it. */
      /* Floating card (m01737 #2): the layer is only a centring scrim; the card
         itself carries the IDE's window chrome, so the commit dialog reads as a
         window over the log instead of a page that replaced it. */
      '.git4idea-commit-layer-card{display:flex;flex-direction:column;width:min(940px,94%);height:min(640px,94%);overflow:hidden;border-radius:var(--dsw-radius-md,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.45))}',
      /* Frame-wide commit dialog (m02090): the composer's 提交 verb raises this
         over the whole conversation instead of switching to the sidebar tab.
         Fixed on purpose — it is mounted in shell.overlay, OUTSIDE the dock
         containers whose contain:layout would capture an absolute box. */
      /* No backdrop-filter here (m05305): a 2px blur over the whole viewport
         re-samples everything behind the scrim on every scroll frame, which made
         the diff card feel stuck. A denser scrim alone costs nothing. */
      '.git4idea-commit-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-scrim,rgba(0,0,0,.42));color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif);font-size:13px;line-height:1.5;font-weight:400}',
      /* m05307: the card carries the change list AND the file diff, so it takes
         the same footprint as the file card; the pane split is 40/60. */
      '.git4idea-commit-overlay .git4idea-commit-layer-card{width:min(1180px,94vw);height:min(760px,90vh)}',
      /* Single-file diff dialog (m02986): the commit card's right pane, lifted
         into its own window. The preview root already owns the head/body split. */
      '.git4idea-file-card{display:flex;flex-direction:column;width:min(1100px,94vw);height:min(720px,88vh);overflow:hidden;border-radius:var(--dsw-radius-md,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.45))}',
      '.git4idea-file-card .git4idea-preview-root{background:transparent}',
      /* m04489: the file card must sit ON TOP of the push card it was opened
         from — both used the commit overlay's z-index 80, so DOM order decided. */
      '.git4idea-file-overlay{z-index:86}',
      /* Push dialog (m02986): commits on the left, the selected commit's files on
         the right. Double-clicking a file raises the diff dialog above. */
      '.git4idea-push-card{display:flex;flex-direction:column;width:min(1100px,94vw);height:min(720px,88vh);overflow:hidden;border-radius:var(--dsw-radius-md,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.45))}',
      '.git4idea-push-target{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-push-body{flex:1;min-height:0;display:flex;overflow:hidden}',
      '.git4idea-push-commits{width:calc((100% - 1px)*2/5);flex:none;display:flex;flex-direction:column;overflow:auto;padding:4px;border-right:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-push-commit{display:flex;align-items:center;gap:8px;width:100%;flex:none;padding:4px 6px;border:0;border-radius:calc(var(--dsw-radius-sm,8px) - 2px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.git4idea-push-commit:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-push-commit-on{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-push-commit:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.git4idea-push-subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-push-hash{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.git4idea-push-note{flex:none;padding:4px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.git4idea-push-files{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}',
      '.git4idea-push-files-head{display:flex;align-items:center;gap:8px;min-width:0;flex:none;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.git4idea-push-files-subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.git4idea-push-files-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.git4idea-push-file-list{flex:1;min-height:0;overflow:auto;padding:4px}',
      /* The tree rows now come from CommitFileList, shared with the commit
         detail pane — the hover/focus affordance stays, scoped to this list. */
      '.git4idea-push-file-list .git4idea-row{cursor:pointer}',
      '.git4idea-push-file-list .git4idea-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-push-file-list .git4idea-row:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.git4idea-push-foot{display:flex;align-items:center;gap:8px;flex:none;padding:6px 8px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-push-footnote{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.git4idea-commit-layer-head{display:flex;align-items:center;gap:8px;padding:5px 8px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.git4idea-commit-layer-title{color:var(--dsw-alias-label-primary)}',
      '.git4idea-commit-layer-body{flex:1;min-height:0;display:flex;overflow:hidden}',
      '.git4idea-commit-layer-left{flex:0 0 40%;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-commit-layer-right{flex:1 1 60%;min-width:0;display:flex;flex-direction:column;overflow:hidden}',
      '.git4idea-compact-bar{display:flex;align-items:center;gap:6px;padding:4px 6px;flex:none}',
      '.git4idea-compact-tree{max-height:42%;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      // A divider: an 8px hit area (a fingertip needs it) painted as a 1px hairline
      // that lights up on hover, focus or while dragging. touch-action:none is what
      // makes a touch drag resize the pane instead of scrolling the panel.
      '.git4idea-gutter{flex:none;align-self:stretch;position:relative;z-index:1;touch-action:none;background:transparent;border:0;padding:0;cursor:col-resize}',
      '.git4idea-gutter-v{width:8px}',
      '.git4idea-gutter-h{height:8px;cursor:row-resize}',
      '.git4idea-gutter::after{content:"";position:absolute;background:var(--dsw-alias-hairline,var(--dsw-alias-border-l1));transition:background .12s ease}',
      '.git4idea-gutter-v::after{top:0;bottom:0;left:50%;width:1px;margin-left:-.5px}',
      '.git4idea-gutter-h::after{left:0;right:0;top:50%;height:1px;margin-top:-.5px}',
      '.git4idea-gutter:hover::after,.git4idea-gutter:focus-visible::after,.git4idea-gutter-active::after{background:var(--dsw-alias-brand-primary)}',
      '.git4idea-gutter:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}',
      '.git4idea-pane-dragging,.git4idea-pane-dragging *{user-select:none}',
      '.git4idea-pane-dragging-v{cursor:col-resize}',
      '.git4idea-pane-dragging-h{cursor:row-resize}',
      '.git4idea-seg{display:inline-flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-interactive-bg-hover);flex:none}',
      '.git4idea-seg-item{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;padding:2px 10px;border-radius:calc(var(--dsw-radius-sm,8px) - 2px);cursor:pointer;white-space:nowrap}',
      '.git4idea-seg-item:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-seg-item[data-active="true"]{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}',
      '.git4idea-search{padding:4px 6px;flex:none;display:flex;align-items:center;gap:6px}',
      '.git4idea-search .git4idea-input{flex:1;min-width:0}',
      '.git4idea-input{width:100%;box-sizing:border-box;padding:4px 6px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;outline:none}',
      '.git4idea-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-input:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-input-compact{padding:3px 6px}',
      '.git4idea-picker{display:flex;flex-direction:column;gap:2px;padding:12px;overflow:auto;flex:1;min-height:0}',
      '.git4idea-picker-title{color:var(--dsw-alias-label-primary);margin-bottom:2px}',
      '.git4idea-picker-sub{color:var(--dsw-alias-label-tertiary);margin-bottom:8px;word-break:break-all}',
      '.git4idea-picker-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:6px 8px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}',
      '.git4idea-picker-row:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary)}',
      '.git4idea-picker-icon{display:inline-flex;color:var(--dsw-alias-label-secondary);flex:none}',
      '.git4idea-picker-name{flex:none}',
      '.git4idea-picker-kind{color:var(--dsw-alias-label-tertiary);flex:none}',
      '.git4idea-picker-path{color:var(--dsw-alias-label-tertiary);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%}',
      /* position:relative: the marquee box paints against this wrapper (the
         scroll container is offset by the search field — same rule as
         .git4idea-history above). */
      '.git4idea-tree{display:flex;flex-direction:column;min-height:0;flex:1;position:relative}',
      '.git4idea-tree-scroll{flex:1;overflow:auto;padding-bottom:6px}',
      '.git4idea-section{display:flex;flex-direction:column}',
      '.git4idea-section-head{display:flex;align-items:center;gap:4px;width:100%;padding:3px 8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;text-align:left}',
      '.git4idea-section-head-static{cursor:default;padding-left:20px}',
      '.git4idea-section-head:hover{color:var(--dsw-alias-label-primary)}',
      // The header became a DIV (it now holds buttons), and a div is content-box
      // while a button is border-box: without this, width:100% plus its own padding
      // overflowed the pane by 16px and clipped the last toolbar icon (reported on
      // v0.3.8).
      '.git4idea-changes-head{cursor:default;gap:2px;box-sizing:border-box}',
      '.git4idea-section-toggle{display:flex;align-items:center;gap:4px;flex:1;min-width:0;padding:0;border:none;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.git4idea-folder{display:flex;flex-direction:column}',
      '.git4idea-branch-folder{display:flex;flex-direction:column}',
      '.git4idea-row-picked{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}',
      '.git4idea-folder-head{display:flex;align-items:center;gap:6px;width:100%;padding:1px 8px 1px 4px;height:14px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;text-align:left}',
      '.git4idea-folder-head:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-folder-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-count{margin-left:auto;opacity:.6;font-weight:400}',
      '.git4idea-chevron{display:inline-flex;transform:rotate(-90deg);transition:transform .12s ease}',
      '.git4idea-chevron-open{transform:rotate(0deg)}',
      '.git4idea-row{display:flex;align-items:center;gap:5px;padding:2px 8px;cursor:pointer;white-space:nowrap;overflow:hidden}',
      '.git4idea-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      /* v0.19.3: the HEAD section row behaves like a branch row (click
         selects, double-click browses, right-click menus) — same hover cue. */
      '.git4idea-head-branch{cursor:pointer;transition:background .12s}',
      '.git4idea-head-branch:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-row-head{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary))}',
      /* v0.19.5: the v0.19.4 mix folded the row's own TEXT color in, and on
         the dark theme that text is near-white — 42% of it whitewashed the
         fill over bright wallpapers (user report). Keep the mix SHAPE (58%
         alias tint + 42% OPAQUE gray = the >=.42 alpha floor that keeps the
         pick readable through any-background's transparency/frost) but mix a
         THEME-AWARE NEUTRAL GRAY instead of the text color: light theme mixes
         the host's pale highlight gray (bluish-75 — the light hover-solid
         tone), dark theme mixes charcoal (bluish-800 — the dark hover-solid
         tone) via the host's body[data-ds-dark-theme] switch. Selection reads
         as gray on both themes, wallpaper/frost stays visible, never white. */
      '.git4idea-row-selected{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover)) 58%,var(--dsw-static-neutral-bluish-75,var(--dsw-alias-bg-layer-3)) 42%);color:var(--dsw-alias-label-primary);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}',
      'body[data-ds-dark-theme] .git4idea-row-selected{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover)) 58%,var(--dsw-static-neutral-bluish-800,var(--dsw-alias-bg-layer-3)) 42%)}',
      '.git4idea-row-remote .git4idea-row-label{color:var(--dsw-alias-label-secondary)}',
      '.git4idea-row-tag .git4idea-row-label{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-row-icon{display:inline-flex;flex:none;opacity:.9}',
      '.git4idea-row-label{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}',
      // Inline tracking target (issue #18): flex:none so it never starves the
      // label, capped and ellipsised so a long origin/… cannot push the badges.
      '.git4idea-row-upstream{flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.git4idea-row-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis}',
      '.git4idea-row-dir{margin-left:auto;opacity:.75}',
      '.git4idea-badge{font-size:10px;padding:0 5px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);flex:none}',
      '.git4idea-badge-muted{opacity:.8}',
      '.git4idea-badge-worktree{padding:0 3px;display:inline-flex;align-items:center;height:14px}',
      /* position:relative: the marquee box (rubber-band selection) paints
         against this wrapper — the scroll container below is offset by the
         filter bar, and painting from the wrong rect was the v0.19.2 drift. */
      '.git4idea-history{display:flex;flex-direction:column;min-height:0;flex:1;position:relative}',
      '.git4idea-history-scroll{flex:1;overflow:auto}',
      '.git4idea-commit{display:flex;align-items:center;gap:6px;padding:1px 8px 1px 0;cursor:pointer;height:26px;overflow:hidden}',
      '.git4idea-commit:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      /* Same theme-aware gray mix as .git4idea-row-selected (see it). */
      '.git4idea-commit-selected{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover)) 58%,var(--dsw-static-neutral-bluish-75,var(--dsw-alias-bg-layer-3)) 42%);color:var(--dsw-alias-label-primary);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}',
      'body[data-ds-dark-theme] .git4idea-commit-selected{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover)) 58%,var(--dsw-static-neutral-bluish-800,var(--dsw-alias-bg-layer-3)) 42%)}',
      // A favorited branch renders its star SOLID (BranchRow adds this class
      // and flips the tone to warn) — the hollow green HEAD star read as
      // "not favorited" (v0.18.5).
      '.git4idea-star-filled svg path{fill:currentColor}',
      // Rows nested under a dir-group folder head are indented and drop the
      // trailing directory repeat, so the grouping reads as a tree.
      /* Nested rows indent inline (26px base + 12px per tree depth) — the CSS
         class only marks them for tests/probes. */
      '.git4idea-graph{flex:none}',
      '.git4idea-commit-date{color:var(--dsw-alias-label-tertiary);flex:none;width:106px;text-align:right;font-variant-numeric:tabular-nums}',
      '.git4idea-commit-author{color:var(--dsw-alias-label-secondary);flex:none;width:96px;overflow:hidden;text-overflow:ellipsis}',
      '.git4idea-commit-subject{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-commit-fill{flex:1 1 0;min-width:0}',
      /* Refs are IDEA-style tag glyphs after the subject: no pill, no name. They
         overlap like a deck (negative margin) so four refs cost ~34px, and the
         names live in the cluster tooltip. */
      '.git4idea-ref-stack{display:inline-flex;align-items:center;flex:none;margin-left:6px}',
      '.git4idea-ref-icon{display:inline-flex;flex:none}',
      '.git4idea-ref-stack .git4idea-ref-icon{margin-left:-8px}',
      '.git4idea-ref-stack .git4idea-ref-icon:first-child{margin-left:0}',
      '.git4idea-ref-count{font-size:10px;color:var(--dsw-alias-label-tertiary);margin-left:3px}',
      '.git4idea-ref-head{color:#d0c060}',
      '.git4idea-ref-local{color:#50a060}',
      '.git4idea-ref-remote{color:#a070d0}',
      '.git4idea-ref-tag{color:#7d8087}',
      '.git4idea-detail-refs{display:flex;flex-wrap:wrap;align-items:center;gap:2px 14px;padding:0 0 8px}',
      '.git4idea-detail-ref{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      /* "In N branches" (m00717): one line when collapsed, one name per line
         when expanded, the toggle inline with the label. */
      '.git4idea-detail-branches{padding:0 0 8px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-detail-branches-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 4px}',
      '.git4idea-detail-branches-label{color:var(--dsw-alias-label-secondary)}',
      '.git4idea-detail-branches-names{color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.git4idea-detail-branches .git4idea-link{margin-left:0;font-size:12px}',
      '.git4idea-detail-branches-list{display:flex;flex-direction:column;margin-top:2px}',
      '.git4idea-detail-branch{white-space:pre}',
      '.git4idea-filters{display:flex;align-items:center;gap:4px;padding:4px 6px;flex:none;min-width:0;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-filter-text{flex:1 1 90px;min-width:80px;width:auto}',
      '.git4idea-filter-select{flex:none;max-width:118px;appearance:none;-webkit-appearance:none;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-secondary);font:inherit;height:22px;padding:0 4px;cursor:pointer;text-overflow:ellipsis}',
      '.git4idea-filter-select:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-filter-select{display:inline-flex;align-items:center;gap:3px}',
      '.git4idea-filter-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:96px}',
      '.git4idea-filter-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.git4idea-filter-path{flex:0 1 112px;min-width:70px;display:flex}',
      '.git4idea-load-more{margin:6px auto;display:block;padding:3px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}',
      '.git4idea-load-more:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-empty{padding:14px;text-align:center;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-changes{display:flex;flex-direction:column;min-height:0;flex:1;position:relative}',
      '.git4idea-changes-body{display:flex;flex-direction:column;min-height:0;flex:1}',
      '.git4idea-changes-list{flex:1;overflow:auto;min-height:0}',
      /* Multi-select chrome (issue #13). The marquee box is anchored to the
         VIEWPORT-space .git4idea-changes (invariant 13: position:fixed would be
         captured by the workbench's contain:layout and flung off-panel). */
      '.git4idea-marquee{position:absolute;border:1px solid var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);pointer-events:none;z-index:6}',
      /* The selection action bar (v0.19.1 redesign). It used to FLOAT over the
         top of the list (absolute, v0.18.3): that covered the group head and
         the first rows, and on transparency skins (dsh-any-background) its
         background went see-through, so its own text blended into the rows
         underneath — unreadable. Now it is an IN-FLOW island between the list
         and the composer: nothing is covered, and a first selection only
         shrinks the viewport bottom edge (scrollTop untouched), which keeps
         the v0.18.3 dblclick precision. The surface rides the official menu
         token; data-cordis-panel (set at the render site) lets transparency
         skins sync it exactly like the official menus. */
      /* Local alias restore: dsh-any-background re-declares --dsw-alias-bg-layer-1/2/3
         on [data-conversation-composer-overlay] (the session seat) as its trajectory
         vars, which are absent when that feature is off — the seat inherits
         guaranteed-invalid values, and var() fallbacks do NOT rescue IVCT, so the
         whole background chain below resolves to transparent. Re-declaring the two
         aliases from the official static token — the exact source the LIGHT
         theme's own alias defs point at — makes the chain valid again regardless
         of any-bg's injection state. static never varies by theme, so this only
         reproduces the LIGHT surface; the dark override right below re-pins the
         same aliases to the dark theme's own sources (layer-1→bluish-875,
         layer-2→bluish-850). Without that override every dark theme renders
         white surfaces under light text here (issue #15, 1.13:1). */
      '.git4idea-selection-bar{--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00,#fff);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-00,#fff);display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:5px 10px;margin:6px 0;font-size:11px;line-height:16px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsh-any-op-menu-cordis,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,transparent));box-shadow:var(--dsw-elevation-prominent,0 4px 14px rgba(0,0,0,.25))}',
      'body[data-ds-dark-theme] .git4idea-selection-bar{--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-875,#232324);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-850,#2c2c2e)}',
      '.git4idea-selection-bar .git4idea-link{margin-left:0;padding:2px 0}',
      '.git4idea-selection-bar .git4idea-link-danger{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-selection-count{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      /* Focusable lists keep their own selection highlight as the focus
         indicator, so the container ring is suppressed. */
      '.git4idea-changes-list:focus-visible,.git4idea-tree:focus-visible,.git4idea-history-scroll:focus-visible{outline:none}',
      '.git4idea-group{display:flex;flex-direction:column}',
      '.git4idea-group-head{display:flex;align-items:center;gap:8px;padding:2px 8px;height:17px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.git4idea-link{margin-left:auto;border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;cursor:pointer;padding:0;flex:none}',
      '.git4idea-link:hover{text-decoration:underline}',
      '.git4idea-row-file{gap:6px;height:20px}',
      '.git4idea-row-check{flex:none;width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.git4idea-group-check{flex:none;width:12px;height:12px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.git4idea-file-status{flex:none;width:14px;text-align:center;font-size:10px;color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}',
      '.git4idea-file-status-A{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-file-status-D{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-file-status-R{color:var(--dsw-alias-brand-primary)}',
      '.git4idea-file-status-U{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-file-status-I{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-stat-add{color:var(--dsw-alias-state-success-primary);flex:none;font-variant-numeric:tabular-nums}',
      '.git4idea-stat-del{color:var(--dsw-alias-state-error-primary);flex:none;font-variant-numeric:tabular-nums}',
      '.git4idea-mini{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:none;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;flex:none;padding:0}',
      '.git4idea-row:hover .git4idea-mini{opacity:1}',
      '.git4idea-mini:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-commit-box{flex:none;padding:6px;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-commit-box-compact{flex-direction:row;align-items:center;gap:6px;padding:4px 6px;flex-wrap:wrap}',
      '.git4idea-textarea{width:100%;box-sizing:border-box;min-height:50px;resize:none;overflow-y:auto;padding:5px 6px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;outline:none}',
      '.git4idea-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-textarea:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-commit-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px}',
      '.git4idea-check{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.git4idea-btn{padding:3px 10px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;flex:none}',
      '.git4idea-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-btn:disabled{opacity:.45;cursor:default}',
      '.git4idea-btn-small{padding:2px 8px;font-size:11px}',
      '.git4idea-btn-primary{margin-left:auto;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.git4idea-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}',
      '.git4idea-btn-danger{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.git4idea-detail{display:flex;flex-direction:column;min-height:0;flex:1;overflow:auto;padding:6px 8px;gap:6px}',
      '.git4idea-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.git4idea-detail-author,.git4idea-detail-date{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-detail-subject{white-space:pre-wrap}',
      '.git4idea-detail-body{margin:0;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font:inherit}',
      '.git4idea-detail-files-head{margin-top:4px}',
      '.git4idea-detail-files{display:flex;flex-direction:column}',
      '.git4idea-mono{font-family:var(--ds-font-family-code,"SF Mono","JetBrains Mono","Fira Code",Consolas,"Liberation Mono",Menlo,Courier,"PingFang SC","Microsoft YaHei",monospace)}',
      '.git4idea-diff-pane{flex:none;max-height:55%;display:flex;flex-direction:column;min-height:0;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-diff-head{display:flex;align-items:center;gap:8px;padding:3px 8px;color:var(--dsw-alias-label-tertiary);flex:none;min-width:0}',
      '.git4idea-diff-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}',
      '.git4idea-diff{flex:1;overflow:auto;font-family:var(--ds-font-family-code,"SF Mono","JetBrains Mono","Fira Code",Consolas,"Liberation Mono",Menlo,Courier,"PingFang SC","Microsoft YaHei",monospace);font-size:calc(12px + var(--dsh-code-font-delta, 0px));line-height:1.5;min-height:0}',
      '.git4idea-diff-line{display:flex;gap:8px;padding:0 6px;white-space:pre}',
      '.git4idea-diff-gutter{width:32px;flex:none;text-align:right;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary));user-select:none}',
      '.git4idea-diff-text{white-space:pre-wrap;word-break:break-word;flex:1;min-width:0}',
      '.git4idea-diff-add{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent)}',
      '.git4idea-diff-del{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent)}',
      '.git4idea-diff-hunk{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)}',
      '.git4idea-diff-meta{color:var(--dsw-alias-label-tertiary)}',
      /* Host-rendered diff (ui-primitives DiffBlock): the host box keeps the
         pane's scroll contract (everything renders, the pane scrolls), and the
         card's own 16px vertical margin is tightened to the panel rhythm. */
      '.git4idea-diff-host{flex:1;overflow:auto;min-height:0}',
      '.git4idea-diff-card{margin:4px 6px 8px;font-size:calc(12px + var(--dsh-code-font-delta, 0px))}',
      /* File-type glyphs lead every change row (v0.14); a transparent-theme
         host still tints them through the component's own category colors. */
      '.git4idea-file-icon{flex:none;opacity:.95}',
      '.git4idea-overlay{position:absolute;inset:0;padding:8px;box-sizing:border-box;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.42));-webkit-backdrop-filter:var(--dsw-mask-blur,none);backdrop-filter:var(--dsw-mask-blur,none);display:flex;align-items:center;justify-content:center;z-index:60}',
      '.git4idea-dialog{box-sizing:border-box;min-width:min(240px,100%);max-width:min(420px,94%);max-height:100%;overflow:auto;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));border:0;border-radius:var(--dsw-radius-panel,28px);padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.35))}',
      /* IDE tool-window tabs over the detail column: log (the commit detail),
         console (host console.log) and worktrees. */
      '.git4idea-workbench{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}',
      '.git4idea-tabs{display:flex;align-items:center;gap:2px;flex:none;padding:0 6px;border-bottom:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-subtle));overflow-x:auto;scrollbar-width:none}',
      '.git4idea-tab{flex:none;padding:6px 10px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:calc(12px + var(--dsh-content-font-delta-secondary, 0px));cursor:pointer;white-space:nowrap}',
      '.git4idea-tab:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-tab[data-active="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}',
      '.git4idea-workbench-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.git4idea-console{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.git4idea-console-note{padding:4px 8px;color:var(--dsw-alias-label-tertiary);font-size:calc(11px + var(--dsh-content-font-delta-secondary, 0px));flex:none}',
      '.git4idea-console-body{flex:1;min-height:0;overflow:auto;margin:0;padding:4px 8px 10px;font-family:var(--ds-font-family-code,"SF Mono","JetBrains Mono","Fira Code",Consolas,"Liberation Mono",Menlo,Courier,"PingFang SC","Microsoft YaHei",monospace);font-size:calc(11px + var(--dsh-code-font-delta, 0px));line-height:1.5;white-space:pre-wrap;word-break:break-word;user-select:text;cursor:auto}',
      '.git4idea-console-line{white-space:pre-wrap}',
      '.git4idea-console-cmd{color:var(--dsw-alias-label-primary);margin-top:6px}',
      '.git4idea-console-bad{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-worktrees{flex:1;min-height:0;display:flex}',
      '.git4idea-wt-rail{flex:none;display:flex;flex-direction:column;gap:2px;padding:4px;border-right:1px solid var(--dsw-alias-border-l1,transparent)}',
      '.git4idea-wt-main{flex:1;min-width:0;min-height:0;overflow:auto}',
      '.git4idea-wt-error{padding:6px 8px;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}',
      '.git4idea-wt-list{display:flex;flex-direction:column;padding:2px 0 8px}',
      '.git4idea-wt-head,.git4idea-wt-row{display:grid;grid-template-columns:20px minmax(0,1.1fr) minmax(0,1fr) minmax(0,2fr);gap:8px;align-items:center;padding:4px 8px}',
      '.git4idea-wt-head{color:var(--dsw-alias-label-tertiary);font-size:calc(11px + var(--dsh-content-font-delta-secondary, 0px));border-bottom:1px solid var(--dsw-alias-border-l1,transparent)}',
      '.git4idea-wt-row{cursor:pointer;border-radius:var(--dsw-radius-sm,8px)}',
      '.git4idea-wt-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-wt-row-active{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-wt-check{display:inline-flex;justify-content:center;color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-wt-name,.git4idea-wt-branch,.git4idea-wt-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-wt-path{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-wt-label{color:var(--dsw-alias-label-secondary);font-size:calc(12px + var(--dsh-content-font-delta-secondary, 0px))}',
      '.git4idea-wt-toggle{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-wt-pathrow{display:flex;align-items:center;gap:6px}',
      '.git4idea-wt-pathrow .git4idea-input{flex:1;min-width:0}',
      '.git4idea-wt-hint{color:var(--dsw-alias-label-tertiary);font-size:calc(11px + var(--dsh-content-font-delta-secondary, 0px));word-break:break-all}',
      '.git4idea-wt-dialog .git4idea-input{width:100%;box-sizing:border-box}',
      '.git4idea-dialog-wide{min-width:min(360px,92%)}',
      '.git4idea-dialog-text{color:var(--dsw-alias-label-secondary);white-space:pre-wrap}',
      '.git4idea-dialog-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.git4idea-dialog-actions .git4idea-btn-primary{margin-left:0}',
      /* The wrapper carries the panel-relative anchor and the outside-click ref,
         plus the ONLY percentage widths (its containing block is .git4idea-root, so
         `max-width` resolves against the panel — on the card it would resolve
         against the shrink-to-fit wrapper and collapse the menu, cutting labels).
         The submenu is a second card offset to the parent card's edge, flipping
         left when the panel runs out of room (see ContextMenu.openSub). */
      '.git4idea-menu-wrap{position:absolute;z-index:70;width:max-content;max-width:calc(100% - 8px)}',
      '.git4idea-menu{box-sizing:border-box;min-width:200px;max-height:min(320px,calc(100% - 8px));padding:4px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;box-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.35));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);isolation:isolate;display:flex;flex-direction:column}',
      '.git4idea-menu-sub{position:absolute;min-width:180px;max-width:320px;z-index:71}',
      '.git4idea-menu::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1)));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(14px) saturate(1.2));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(14px) saturate(1.2));pointer-events:none}',
      '.git4idea-menu-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column}',
      '.git4idea-menu-item{display:flex;align-items:center;gap:8px;padding:4px 8px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;border-radius:var(--dsw-radius-sm,8px);cursor:pointer;white-space:nowrap;overflow:hidden}',
      '.git4idea-menu-chevron{margin-left:auto;opacity:.6;flex:none;display:inline-flex}',
      '.git4idea-menu-icon{display:inline-flex;flex:none}',
      '.git4idea-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.git4idea-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-menu-item-active{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-menu-danger,.git4idea-menu-danger .git4idea-menu-label{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-menu-disabled{opacity:.38;cursor:default}',
      '.git4idea-menu-sep{height:1px;margin:3px 6px;background:var(--dsw-alias-hairline,var(--dsw-alias-border-l1))}',
      /* ---- immersive conversation seat (issue #8 round 3) ---- */
      /* The seat itself carries `data-conversation-composer-overlay` (the
         host's own opt-in, what TrajectoryView rides): the host CSS flips the
         view area to `flex: 1 1 0; min-height: 0; overflow: hidden` and the
         composer seat to an overlay. What the host does NOT do is hide the
         composer — that is ours, and it is a single structural rule patterned
         after dsh-context's `.lc-root` rule: while a Git view owns the
         conversation ring, the composer seat displays none. The :not() chain
         is the SAFETY VALVE and its attribute names are verified against the
         host sources (ui-approval ApprovalPanel `data-approval-key`,
         ui-user-questions QuestionComposer `data-question-key`, PlanReviewPanel
         `data-plan-review-key`): a blocking interaction riding the seat must
         stay reachable even though the plain input card is hidden, or a user
         sitting in the Git view could never approve anything. */
      '[data-conversation-scroll]:has(.git4idea-conversation-seat[data-immersive="1"]) > [data-composer-seat]:not(:has([data-approval-key],[data-question-key],[data-plan-review-key])){display:none}',
      /* The transcript-width drag strips are FOLLOWING SIBLINGS of the shared
         scroller (children of the conversation body), full-height and
         z-index 8: over a full-bleed Git pane they glow and drag straight
         through it. Same sibling combinator lesson dsh-context recorded in
         its own issue #50 — a descendant combinator here matches nothing. */
      '[data-conversation-scroll]:has(.git4idea-conversation-seat[data-immersive="1"]) ~ [data-width-handle]{display:none}',
      /* ---- native preview tab (external diff preview) ---- */
      /* The body mounts straight into the right-sidebar pane: full height,
         internal scrolling in the body region, a one-line header for the
         subject/path. Same tokens as the rest of the panel — no hard-coded
         surfaces. */
      '.git4idea-preview-root{position:relative;height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}',
      /* m04483: one row — the path on the left, the verbs and the close button
         pinned to the right. Without flex the actions wrapped and the × fell to
         the left edge of the header. */
      '.git4idea-preview-head{display:flex;align-items:center;gap:8px;flex:none;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));overflow:hidden;white-space:nowrap}',
      '.git4idea-preview-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      /* m04921: the body never scrolls; the diff inside it does. A scrolling
         body pushed the diff's own horizontal bar below the fold, so the bar
         was only reachable after scrolling to the last line. */
      '.git4idea-preview-body{flex:1;min-height:0;overflow:hidden;padding:8px 12px;display:flex;flex-direction:column}',
      '.git4idea-preview-body .git4idea-diff-host,.git4idea-preview-body .git4idea-diff,.git4idea-preview-body .git4idea-lf-root{flex:1;min-height:0}',
      '.git4idea-preview-actions{display:flex;align-items:center;gap:4px;flex:none}',
      '.git4idea-preview-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.git4idea-preview-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      /* LineDiff (v0.14.3): the review view's anatomy on its own tokens —
         every rule below mirrors FileDiff.module.css / ReviewTab.module.css
         line for line (class git4idea-lf- stands in for their css modules), so the
         official theme and reading habits carry over. */
      '.git4idea-lf-root{--diff-empty-fill:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 50%,transparent);display:flex;flex-direction:column;box-sizing:border-box;width:100%;min-height:0;color:var(--dsw-alias-label-primary)}',
      '.git4idea-lf-header{display:flex;flex:0 0 auto;gap:6px;align-items:center;box-sizing:border-box;min-height:38px;padding:0 6px 0 8px;border-bottom:0.5px solid var(--dsw-alias-border-l3)}',
      '.git4idea-lf-status{display:flex;gap:12px;align-items:center;margin:0;padding:16px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-preview-boundary{display:flex;align-items:center;justify-content:center;margin:0;padding:24px 16px;font-size:13px;color:var(--dsw-alias-label-secondary);text-align:center}',
      '.git4idea-lf-body{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:auto;padding:8px 0 16px;font:var(--dsw-font-markdown-code-block)}',
      '.git4idea-lf-columns{display:grid;flex:1 1 auto;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0;overflow:hidden}',
      '.git4idea-lf-column,.git4idea-lf-body[data-review-view=unified]:not([data-review-wrap]){display:grid;grid-template-columns:minmax(max-content,100%);align-content:start}',
      '.git4idea-lf-column{min-width:0;min-height:0;overflow:auto;overscroll-behavior:none}',
      '.git4idea-lf-column + .git4idea-lf-column{border-left:0.5px solid var(--dsw-alias-border-l3)}',
      '.git4idea-lf-sideLine{display:grid;grid-template-columns:3.5em max-content;box-sizing:border-box;min-width:100%;width:max-content;min-height:22px;line-height:22px;white-space:pre}',
      '.git4idea-lf-note{margin:0;padding:4px 16px 8px;font:var(--dsw-font-xs-13,var(--dsw-font-markdown-code-block));color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-lf-hunk{margin-bottom:8px}',
      '.git4idea-lf-hunkHeader{padding:4px 16px;color:var(--dsw-alias-label-tertiary);white-space:pre}',
      '.git4idea-lf-line{display:grid;grid-template-columns:3.5em 3.5em 1.2em minmax(0,1fr);box-sizing:border-box;min-height:22px;line-height:22px;white-space:pre}',
      '.git4idea-lf-splitLine{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:22px;line-height:22px;white-space:pre}',
      '.git4idea-lf-cell{display:grid;grid-template-columns:3.5em minmax(0,1fr);box-sizing:border-box;min-width:0}',
      '.git4idea-lf-cell + .git4idea-lf-cell{border-left:0.5px solid var(--dsw-alias-border-l3)}',
      '.git4idea-lf-number{padding-right:8px;color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none}',
      '.git4idea-lf-sign{text-align:center;user-select:none}',
      '.git4idea-lf-text{padding-right:16px}',
      '.git4idea-lf-body[data-review-wrap] .git4idea-lf-line,.git4idea-lf-body[data-review-wrap] .git4idea-lf-splitLine{white-space:pre-wrap}',
      '.git4idea-lf-body[data-review-wrap] .git4idea-lf-text{overflow-wrap:anywhere}',
      '.git4idea-lf-add{--diff-gutter-fill:var(--dsw-alias-file-diff-added-gutter);--diff-marker:var(--dsw-alias-file-diff-added-marker);background:var(--dsw-alias-file-diff-added-bg)}',
      '.git4idea-lf-del{--diff-gutter-fill:var(--dsw-alias-file-diff-deleted-gutter);--diff-marker:var(--dsw-alias-file-diff-deleted-marker);background:var(--dsw-alias-file-diff-deleted-bg)}',
      '.git4idea-lf-add .git4idea-lf-number,.git4idea-lf-del .git4idea-lf-number{background:var(--diff-gutter-fill);color:var(--diff-marker)}',
      '.git4idea-lf-add .git4idea-lf-number:first-child,.git4idea-lf-del .git4idea-lf-number:first-child{box-shadow:inset 3px 0 0 var(--diff-marker)}',
      '.git4idea-lf-add .git4idea-lf-sign,.git4idea-lf-del .git4idea-lf-sign{color:var(--diff-marker)}',
      '.git4idea-lf-context .git4idea-lf-text{color:var(--dsw-alias-label-secondary)}',
      '.git4idea-lf-empty{background:var(--diff-empty-fill)}',
      /* header pieces from ReviewTab.module.css */
      '.git4idea-lf-selector{flex:0 1 auto;min-width:0}',
      '.git4idea-lf-selectorStatic{flex:0 1 auto;min-width:0;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-lf-selectorFallback{max-width:60%;padding:2px 6px;border:none;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:inherit;font:inherit;font-size:12px}',
      '.git4idea-lf-selectorButton{display:inline-flex;gap:4px;align-items:center;box-sizing:border-box;max-width:100%;height:28px;padding:0 6px 0 8px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:20px}',
      '.git4idea-lf-selectorButton:hover,.git4idea-lf-selectorButton[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-lf-selectorButton svg{display:block;flex:none}',
      '.git4idea-lf-item{display:flex;gap:12px;align-items:center;justify-content:space-between;min-width:0}',
      '.git4idea-lf-itemPath{min-width:0;overflow:hidden;line-height:20px;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-lf-itemCounts,.git4idea-lf-counts{display:inline-flex;flex:none;gap:6px;align-items:center;font-family:var(--ds-font-family-code);font-size:calc(12px + var(--dsh-code-font-delta, 0px));line-height:20px;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-lf-counts{min-width:0;margin-right:auto}',
      '.git4idea-lf-added{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-lf-deleted{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-lf-label{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-lf-tools{display:inline-flex;flex:none;gap:2px;align-items:center;margin-left:auto}',
      '.git4idea-lf-tool{display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.git4idea-lf-tool svg{width:15px;height:15px}',
      '.git4idea-lf-tool:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-lf-tool[aria-pressed=true] .git4idea-lf-compareIcon{transform:rotate(90deg)}',
      /* ---- composer git status pill (input-bar, issue: status beside the
         tool row). Colors follow the host's own state language: warn for
         uncommitted changes, business(blue) for pulls, success(green) for
         pushes — the same three tones the panel and DSH toasts use. ---- */
      '.git4idea-cs-root{position:relative;display:inline-flex;align-items:center;gap:2px;min-width:0;flex:none;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.git4idea-cs-pill{display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:inherit;line-height:inherit;white-space:nowrap;cursor:pointer}',
      '.git4idea-cs-pill:hover:not(:disabled),.git4idea-cs-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.git4idea-cs-name{overflow:hidden;text-overflow:ellipsis;max-width:220px;white-space:nowrap;display:inline-block;vertical-align:bottom}',
      '.git4idea-cs-mrun{display:inline-flex;text-overflow:clip;-webkit-mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 14px),transparent)}',
      '.git4idea-cs-mrun .git4idea-cs-run{display:inline-flex;flex:none;will-change:transform}',
      '.git4idea-cs-mrun .git4idea-cs-chunk{flex:none;white-space:nowrap;padding-right:28px}',
      '.git4idea-cs-mrun:hover .git4idea-cs-run{animation:git4idea-cs-marquee var(--git4idea-cs-marquee-dur,10s) linear infinite}',
      '@keyframes git4idea-cs-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
      '.git4idea-cs-pill svg{flex:none}',
      '.git4idea-cs-pill-count{display:inline-flex;align-items:center;gap:1px;flex:none;font-size:11px;line-height:1;font-variant-numeric:tabular-nums}',
      '.git4idea-cs-ahead,.git4idea-cs-behind{display:inline-flex;align-items:center;gap:2px;flex:none;line-height:1}',
      '.git4idea-cs-ahead{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-cs-behind{color:var(--dsw-alias-state-business-primary)}',
      // .git4idea-cs-menu opens upward (the composer sits at the bottom of the UI). The surface
      // carries no backdrop-filter of its own: the data-cordis-panel attribute opts the popover
      // into dsh-any-background's input-surface channel (--dsw-specific-menu remapped to
      // var(--dsh-any-op-menu-cordis) on body — see the .git4idea-selection-bar note:
      // leading with the op var keeps the fill valid even when the plugin's
      // surface sampling misses and that remap would otherwise IVCT to transparent).
      // --dsh-any-op-menu-cordis at the input opacity tier, plus its input blur rule), so fill
      // opacity and frost follow the composer card exactly. Without that plugin the
      // theme-owned menu material applies. The light re-declaration on the rule below
      // pins the LIGHT static surface (see the .git4idea-selection-bar note); dark themes
      // need the matching override right after it, or the menu renders white under
      // light text (issue #15).
      '.git4idea-cs-menu{--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00,#fff);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-00,#fff);position:absolute;bottom:calc(100% + 6px);left:0;z-index:60;min-width:220px;max-width:320px;max-height:320px;overflow:auto;padding:6px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsh-any-op-menu-cordis,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent,var(--dsw-elevation-dimmed,0 8px 24px rgba(0,0,0,.2)));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}',
      'body[data-ds-dark-theme] .git4idea-cs-menu{--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-875,#232324);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-850,#2c2c2e)}',
      '.git4idea-cs-item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left}',
      '.git4idea-cs-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-cs-item:disabled{opacity:.5;cursor:default}',
      '.git4idea-cs-item[data-current=true]{color:var(--dsw-alias-brand-primary)}',
      '.git4idea-cs-item svg{flex:none}',
      '.git4idea-cs-item-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-cs-item-main{display:flex;flex-direction:column;min-width:0;flex:1}',
      '.git4idea-cs-item-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:12px}',
      '.git4idea-cs-item-note{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}',
      '.git4idea-cs-item-counts{display:inline-flex;gap:5px;flex:none;font-variant-numeric:tabular-nums;font-size:11px}',
      '.git4idea-cs-item-tail{display:inline-flex;align-items:center;gap:6px;margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-cs-item[data-menu=true]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-cs-static{color:var(--dsw-alias-label-tertiary);cursor:default}',
      /* Branch popover (m01216 #10): the tree's search box, the fetched sections
         and the three actions, in one card above the composer. It is taller than
         the old flat menu, so the sections scroll while the search box and the
         action row stay put. */
      '.git4idea-cs-branches{display:flex;flex-direction:column;min-width:300px;max-width:min(420px,80vw);max-height:min(420px,60vh);padding:0;overflow:hidden}',
      '.git4idea-cs-search{display:flex;align-items:center;gap:4px;padding:6px 6px 4px;flex:none}',
      '.git4idea-cs-input{flex:1;min-width:0;height:22px;box-sizing:border-box;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.git4idea-cs-input:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      '.git4idea-cs-tool{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}',
      '.git4idea-cs-tool:hover:not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-cs-tool[aria-disabled="true"]{opacity:.4;cursor:default}',
      '.git4idea-cs-sections{flex:1;min-height:0;overflow:auto;padding:0 4px 4px}',
      '.git4idea-cs-head{padding:5px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;text-transform:none}',
      /* Name prompts (m03873): a centered card, not a box that swaps the tree,
         so the chooser may close while the prompt stays up. One step above the
         commit and push cards (z 80) since it is the transient of the two. */
      '.git4idea-prompt-overlay{z-index:81}',
      '.git4idea-prompt-card{width:min(420px,92vw)}',
      /* Inline secondary menu (m01737 #5): one row per verb, indented under
         the branch row it belongs to. */
      /* Row flyout (m02697 #2): floats beside the chooser, anchored on the row.
         Root-relative because the composer seat is the containing block. */
      /* The composer seat's layer tokens are translucent, so a flyout that
         only reads --dsw-alias-bg-layer-2 shows the branch rows behind its
         labels. Pin the two menu surfaces to the same opaque statics the
         chooser uses (issue #15), then paint with the menu token. */
      '.git4idea-cs-flyout{--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00,#fff);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-00,#fff);position:absolute;z-index:62;display:flex;flex-direction:column;gap:1px;width:max-content;min-width:240px;padding:4px;border-radius:var(--dsw-radius-sm,8px);overflow:hidden;background:var(--dsh-any-op-menu-cordis,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.32));color:var(--dsw-alias-label-secondary)}',
      'body[data-ds-dark-theme] .git4idea-cs-flyout{--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-875,#232324);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-850,#2c2c2e)}',
      '.git4idea-cs-sub-item{display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 6px;flex:none;border:none;border-radius:var(--dsw-radius-xs,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:24px;text-align:left;cursor:pointer}',
      '.git4idea-cs-sub-item svg{flex:none}',
      '.git4idea-cs-sub-label{flex:none;white-space:nowrap}',
      '.git4idea-cs-sub-item:hover:not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-cs-sub-item[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-cs-sub-item[aria-disabled="true"]{opacity:.4;cursor:default}',
      '.git4idea-cs-sub-sep{height:1px;margin:2px 4px;background:var(--dsw-alias-border-l2)}',
      '.git4idea-cs-folder{color:var(--dsw-alias-label-secondary)}',
      '.git4idea-cs-ok{height:22px;padding:0 10px;flex:none;border:none;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-on-primary,#fff);font:inherit;font-size:12px;cursor:pointer}',
      '.git4idea-cs-ok:disabled{opacity:.45;cursor:default}',
      /* One verb per row above the tree (m01737 #6). */
      '.git4idea-cs-actions{display:flex;flex-direction:column;align-items:stretch;gap:1px;padding:2px 6px 6px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-cs-action{display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 8px;flex:none;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '.git4idea-cs-action:hover:not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-cs-action[aria-disabled="true"]{opacity:.4;cursor:default}',
    ].concat(LANE_TRACE_RULES).join('\n')

    /* ============================== plugin ============================== */

    /* The native right-sidebar seats need three names: the registration id (a
       package name is the natural value, and it is also the seat key the body
       registers under), the tab kind (unique across kinds — the shipped `git`
       kind is not ours to take), and the guide capsule that opens the tab. */
    const NATIVE_ID = 'dsh-git4idea'
    const NATIVE_KIND = 'git4idea'
    const NATIVE_WORKSPACE_ITEMS = (state) => state.items
    /* The conversation.view slot id (issue #8). Order 30 sits the tab after
       Chat (0) and Trajectory (10), and after dsh-context's tab (20) when both
       are installed. */
    const CONVERSATION_VIEW_ID = 'git4idea'
    /* The native preview tab (external diff preview, 2026-10-08): a SECOND
       native right-sidebar type that exists only to show one diff. It carries
       no guide entry on purpose — nothing on the start page opens it; it opens
       itself when a diff verb fires.
       Content follows the module-level store below, so every seat (the
       conversation tab, the native panel) feeds the same single preview. */
    const NATIVE_PREVIEW_ID = 'dsh-git4idea-preview'
    const NATIVE_PREVIEW_KIND = 'git4idea-preview'

    /* The one diff seed the native preview tab shows. set() bumps a monotonous
       counter so a re-click of the SAME file still re-fetches; subscribers get
       the barest notify and re-read .seed themselves. Memory-only: after a
       reload the tab (if the layout restored it) shows the empty hint again —
       the next click re-seeds it. */
    const previewStore = {
      seed: null,
      listeners: new Set(),
      set(seed) {
        this.seed = seed
        for (const listener of [...this.listeners]) {
          try { listener() } catch (error) { void error }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }

    /* The native seat hands a tab the standard props; the panel wants
       `{ scope, t }`. A session's working directory is the path of the
       workspace that accounts for it — the same value the sidebar seat delivers
       as `scope.cwd`. */
    /* DSH's locale service notifies on every snapshot change, and its own
       components re-render on that. The panel is not one of DSH's components,
       so it subscribes for itself: a language switch then repaints the panel
       instead of waiting for the next page load. Everything the panel draws is
       inside this wrapper — every seat goes through it. */
    function LocaleLive(props) {
      const [tick, setTick] = useState(0)
      useEffect(() => {
        const locale = props.ctx === undefined ? undefined : props.ctx.get('locale')
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        const unsubscribe = locale.subscribe(() => { setTick((value) => value + 1) })
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [])
      void tick
      return E(Panel, { scope: props.scope, t: props.t, visible: props.visible, dock: props.dock, ctx: props.ctx, openDiffExternal: props.openDiffExternal })
    }

    /* The conversation-area seat (issue #8): the same panel as a view tab
       beside 对话/轨迹. The session's own cwd decides the repository — the
       harness records it when the session starts in a workspace, so this is
       the same source the sidebar seats resolve through. A session without a
       cwd (blank workspace, or a host without the sessions service) shows the
       panel's repo-pick state, never an error. */
    function sessionCwdOf(ctx, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return undefined
      try {
        const sessions = ctx.get('sessions')
        const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
        if (list === undefined || typeof list.getSnapshot !== 'function') return undefined
        const snapshot = list.getSnapshot()
        const entry = snapshot !== null && typeof snapshot === 'object' && snapshot.byId !== undefined
          && snapshot.byId[sessionId] !== undefined && snapshot.byId[sessionId] !== null
          ? snapshot.byId[sessionId] : undefined
        if (entry !== undefined && typeof entry.cwd === 'string' && entry.cwd !== '') return entry.cwd
      } catch (error) { void error }
      return undefined
    }

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
            label: t('action.newBranchFrom'),
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
            id: 'update', icon: 'pull', label: t('action.updateBranch'),
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
        onClick: () => { if (item.disabled !== true) item.run() },
      }, E('span', { className: 'git4idea-cs-sub-label' }, item.label)))))
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
        remote: typeof bag.remote === 'string' ? bag.remote : '',
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
      const [data, setData] = useState(null)
      const [selected, setSelected] = useState(null)
      const [files, setFiles] = useState([])
      const [filesLoading, setFilesLoading] = useState(false)
      const [selectedPath, setSelectedPath] = useState(null)
      const [busy, setBusy] = useState(false)
      const messageOf = (caught) => (caught instanceof Error ? caught.message : String(caught))
      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const next = await request('push-preview', base)
            if (alive !== true) return
            const normalized = pushPreviewOf(next)
            setData(normalized)
            setSelected(normalized.commits.length === 0 ? null : normalized.commits[0].hash)
          } catch (caught) {
            if (alive === true) { notifyFail(caught) }
          }
        })()
        return () => { alive = false }
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
      const runPush = async () => {
        if (busy === true || data === null) return
        setBusy(true)
        try {
          await request('push', Object.assign({}, base, {
            confirm: true,
            setUpstream: data.upstream === null,
          }))
          toastCenter.push({
            text: fill(t('toast.pushed'), { n: data.commits.length, target: data.target }),
            tone: 'ok',
            icon: 'check',
          })
          props.onClose()
        } catch (caught) {
          toastCenter.push({ text: messageOf(caught), tone: 'error', icon: 'close' })
        } finally {
          setBusy(false)
        }
      }
      const canPush = data !== null && data.detached === false && data.remotes.length > 0 && data.commits.length > 0 && busy === false
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
          E('span', { className: 'git4idea-push-footnote' }, emptyNote !== '' ? emptyNote : t('push.hint')),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', { type: 'button', className: 'git4idea-btn', onClick: () => { props.onClose() } }, t('confirm.cancel')),
          E('button', {
            type: 'button',
            className: 'git4idea-btn git4idea-btn-primary',
            disabled: canPush !== true,
            onClick: () => { void runPush() },
          }, t('toolbar.push')))))
    }

    function apply(ctx) {
      installTipLayer()
      installClientErrorHook()
      const style = document.createElement('style')
      style.setAttribute('data-dsh-git4idea', '')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() }, 'dsh-git4idea: panel styles')

      const t = translatorOf(ctx)
      /* The notification stack is plain DOM outside React (m00761); the one
         piece of copy it needs is the close button's accessible name. */
      toastCenter.closeLabel = t('toast.close')
      setBusyToast(t('status.busy'))

      /* DSH's own locale registry: bind this plugin's namespace so host-side
         consumers read exactly the copy the panel does. Every shipped
         dictionary rides this one call; a missing service (standalone
         compositions) simply means the panel is the only reader. */
      const localeService = ctx.get('locale')
      if (localeService !== undefined && typeof localeService.register === 'function') {
        ctx.effect(
          () => localeService.register(LOCALE_NS, { zh: ZH, en: EN }),
          'dsh-git4idea: locale dictionaries',
        )
      }

      /* One panel, one home: DSH's own right sidebar (ui-sidebar-right). Both
         native types register here — the panel itself (with its guide entry) and
         the external diff preview — and the panel's tab is opened once per page
         load, so the tool window is on screen without a trip to the start page. */
      let nativeFiber = null

      /* WAIT for the service instead of probing with ctx.get(): this apply can
         run BEFORE ui-sidebar-right provides the registry, and a synchronous
         probe returned silently — the seats were then never registered
         (reproduced on a clean instance and on the desktop app: the right
         sidebar showed no Git card and the console stayed empty). ctx.inject()
         retries the registration the moment the services appear. */
      const hostNatively = () => {
        if (nativeFiber !== null) return
        nativeFiber = ctx.inject(['sidebarRightTabs', 'slots'], (nativeCtx) => {
          const tabs = nativeCtx.get('sidebarRightTabs')
          const slots = nativeCtx.get('slots')
          if (tabs === undefined || typeof tabs.register !== 'function') return
          if (slots === undefined || typeof slots.inject !== 'function') return
          nativeCtx.effect(() => {
            /* m02407 #1: no start-page entry any more. The only door is the Git
               tab in the conversation header; omitting `guide` is the registry's
               documented way to stay off the start page. */
            const offType = tabs.register({
              id: NATIVE_ID,
              kind: NATIVE_KIND,
              title: () => t('title'),
            })
            const offBody = slots.inject('sidebar.right.pane.tab', () => slots.register(
              { name: 'sidebar.right.pane.tab', key: NATIVE_ID },
              (tabProps) => E(NativePanel, Object.assign({}, tabProps, { t: t, ctx: ctx })),
            ))
            /* The preview type has NO guide entry on purpose (start-page
               destinations are the main panel's job): it exists to receive the
               openTab a diff verb fires. Omitting `guide` is the registry's
               documented way to stay off the guide page. */
            const offPreviewType = tabs.register({
              id: NATIVE_PREVIEW_ID,
              kind: NATIVE_PREVIEW_KIND,
              title: () => t('preview.title'),
              keepMounted: true,
            })
            const offPreviewBody = slots.inject('sidebar.right.pane.tab', () => slots.register(
              { name: 'sidebar.right.pane.tab', key: NATIVE_PREVIEW_ID },
              (tabProps) => E(NativePreviewPanel, Object.assign({}, tabProps, { t: t, ctx: ctx })),
            ))
            return () => {
              try { offPreviewBody() } catch (error) { void error }
              try { offPreviewType() } catch (error) { void error }
              try { offBody() } catch (error) { void error }
              try { offType() } catch (error) { void error }
            }
          }, 'dsh-git4idea: native right-sidebar seats')
        })
      }

      /* ctx.inject runs its callback straight away when the services are already
         there, and retries otherwise. There is no second host to defer to, so the
         seats go up unconditionally. */
      hostNatively()

      /* ---- door 3: the conversation-area view tab (issue #8) ---- */
      /* A third seat beside 对话/轨迹, registered into ui-conversation's
         `conversation.view` slot (the same contract dsh-context rides). It is
         ON by default and follows the plugin settings card's switch (row
         Config field `conversationTab`) live — no reload. Hosts without the
         row Config keep the tab: there is no editor surface there to turn it
         off with, and the card says as much for the rail already. The seat
         rides `slots` (already a declared inject), so a host without
         ui-conversation simply never mounts it — nothing throws. */
      const conversationTabEnabled = () => true
      ctx.inject(['slots'], (viewCtx) => {
        const slots = viewCtx.get('slots')
        if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
        viewCtx.effect(() => {
          let offView = null
          const view = (viewProps) => E(ConversationPanel, Object.assign({}, viewProps, { t: t, ctx: ctx }))
          const sync = () => {
            const enabled = conversationTabEnabled()
            if (enabled === true && offView === null) {
              try {
                offView = slots.inject('conversation.view', () => slots.register(
                  { name: 'conversation.view', id: CONVERSATION_VIEW_ID, order: 30, locale: LOCALE_NS, label: () => t('title') },
                  view,
                ))
              } catch (error) {
                /* A late re-registration can lose a race with the previous
                   entry's asynchronous disposal (same keyed cell, same
                   priority): better one missed re-registration — the next
                   config change or reload retries — than a sync that throws
                   inside every rail-config notification. */
                console.warn('[dsh-git4idea] conversation seat registration failed: ' + String(error && error.message ? error.message : error))
              }
            } else if (enabled !== true && offView !== null) {
              try { offView() } catch (error) { void error }
              offView = null
            }
          }
          sync()
          return () => {
            if (offView !== null) {
              try { offView() } catch (error) { void error }
              offView = null
            }
          }
        }, 'dsh-git4idea: conversation view tab')
      })

      /* ---- door 4: the composer dock pill (branch, left of the session stats) ---- */
      /* A branch readout in the host composer's dock list — the row that holds
         the session statistics (ui-chat registers 'activity' at order 0 and
         'usage' at order 1), so this entry registers at -10 and renders first.
         It shares the first-paint cache's read paths (read-only routes only) and
         syncs the repository with the panel through the module store above. The
         slot is a plain list; a host without ui-conversation never mounts it and
         nothing throws. */
      ctx.inject(['slots'], (pillCtx) => {
        const pillSlots = pillCtx.get('slots')
        if (pillSlots === undefined || pillSlots === null || typeof pillSlots.inject !== 'function') return
        pillCtx.effect(() => {
          const offPill = pillSlots.inject('conversation.composer.dock', () => pillSlots.register(
            { name: 'conversation.composer.dock', id: 'dsh-git4idea:status', order: -10, locale: LOCALE_NS },
            (pillProps) => E(ComposerGitStatus, Object.assign({}, pillProps, { t: t, ctx: ctx })),
          ))
          return () => {
            try { offPill() } catch (error) { void error }
          }
        }, 'dsh-git4idea: composer dock pill')
      })

      /* ---- frame-wide dialog + notification seats (m02090, m02986) ---- */
      /* `shell.overlay` is the host's frame-wide layer (ui-chat registers its
         quota notice there). The composer pill cannot host a viewport dialog
         itself — its dock container has contain:layout — so every card rides
         this seat and is opened through the module stores above. Optional on
         purpose: a host without the slot keeps the sidebar fallback. */
      ctx.inject(['slots'], (overlayCtx) => {
        const overlaySlots = overlayCtx.get('slots')
        if (overlaySlots === undefined || overlaySlots === null || typeof overlaySlots.inject !== 'function') return
        overlayCtx.effect(() => {
          const offCommit = overlaySlots.inject('shell.overlay', () => overlaySlots.register(
            { name: 'shell.overlay', id: 'dsh-git4idea:commit', locale: LOCALE_NS },
            (overlayProps) => E(GitDialogHost, Object.assign({}, overlayProps, { t: t, ctx: ctx })),
          ))
          const offFile = overlaySlots.inject('shell.overlay', () => overlaySlots.register(
            { name: 'shell.overlay', id: 'dsh-git4idea:file', locale: LOCALE_NS },
            (overlayProps) => E(FileDialogHost, Object.assign({}, overlayProps, { t: t, ctx: ctx })),
          ))
          overlaySeatReady = true
          return () => {
            overlaySeatReady = false
            commitDialog.set(null)
            fileDialog.set(null)
            pushDialog.set(null)
            try { offCommit() } catch (error) { void error }
            try { offFile() } catch (error) { void error }

          }
        }, 'dsh-git4idea: commit, file and push overlays')
      })

      /* ---- session-switch prewarm ---- */
      /* Warm the first-paint cache the moment a workspace session becomes
         active — before any Git tab exists. ctx.inject keeps this optional:
         a host without the sessions service simply never arms it. */
      ctx.inject(['sessions'], (sessionCtx) => {
        const sessions = sessionCtx.get('sessions')
        if (sessions === undefined || sessions === null || sessions.list === undefined
          || sessions.list === null || typeof sessions.list.subscribe !== 'function'
          || typeof sessions.retainInfo !== 'function') return
        sessionCtx.effect(() => {
          /* Becoming the main view is a LOCAL retain event: the host's own
             ui-session subscribes retainInfo(id) per session for exactly this
             (a plain list subscription never fires on it). Mirror that shape —
             the list feeds membership, retainInfo per listed session feeds the
             main-view transitions. */
          const armed = new Map()
          const armAll = () => {
            let snapshot = null
            try { snapshot = sessions.list.getSnapshot() } catch (error) { void error; return }
            const ids = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.ids) ? snapshot.ids : []
            const wanted = new Set(ids.map((id) => String(id)))
            for (const [id, dispose] of armed) {
              if (wanted.has(id) === true) continue
              armed.delete(id)
              try { dispose() } catch (error) { void error }
            }
            for (const raw of ids) {
              const id = String(raw)
              if (armed.has(id) === true) continue
              let info = null
              try { info = sessions.retainInfo(raw) } catch (error) { void error; continue }
              if (info === undefined || info === null || typeof info.subscribe !== 'function') continue
              armed.set(id, info.subscribe(() => { schedulePrewarm(ctx) }))
            }
          }
          const unsubscribe = sessions.list.subscribe(armAll)
          armAll()
          /* The page may already hold an active session (first load, or this
             plugin applied late): warm it without waiting for a switch. */
          schedulePrewarm(ctx)
          return () => {
            if (prewarmTimer !== null) { clearTimeout(prewarmTimer); prewarmTimer = null }
            prewarmGeneration += 1
            try { unsubscribe() } catch (error) { void error }
            for (const dispose of armed.values()) { try { dispose() } catch (error) { void error } }
            armed.clear()
          }
        }, 'dsh-git4idea: session-switch prewarm')
      })

    }

    /* Synchronous by design: see loadPanelSettings. It runs before the host can
       mount any seat, so every readStored call below sees the saved value. */
    loadPanelSettings()

    return { name: '@guojinpeng/dsh-git4idea', inject: [], apply }
  },
})
