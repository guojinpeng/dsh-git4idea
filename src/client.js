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
  id: 'dsh-git4idea',
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
    /* The bundle's package name: the key the Plugins page uses for a bundle's own
       page and its `plugins.bundle.config` slot. */
    const SETTINGS_BUNDLE = 'dsh-git4idea'
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

    const ZH = {
      'title': 'Git',
      'description': 'IDE 级 Git 面板:分支树 / 提交图谱 / 变更与提交',
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
      'branches.starHint': "已收藏",
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
      'changes.commitPlaceholder': '提交信息(Ctrl+Enter 提交)',
      'changes.commit': '提交',
      'changes.amend': '修补',
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
      'action.createLocalBranch': '创建本地分支…',
      'action.newBranchHere': '在此新建分支...',
      'action.rename': '重命名...',
      'action.delete': '删除',
      'action.mergeIntoCurrent': '合并到当前分支',
      'action.rebaseCurrentOnto': '将当前分支变基到此',
      'action.compare': '与当前分支比较',
      'action.update': '更新(Fetch)',
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
      'more.pullpushGroup': '拉取，推送',
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
      'more.sync': '同步(拉取并推送)',
      'more.syncRebase': '同步(变基并推送)',
      'more.pullRebase': '拉取(变基)',
      'more.pullFrom': '从远程拉取',
      'more.pushForce': '推送(强制)...',
      'more.pushTo': '推送到远程',
      'more.fetchAll': '从所有远程抓取',
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
      'more.gitOutput': '显示 Git 输出',
      'clone.title': '克隆仓库',
      'clone.url': '仓库 URL',
      'clone.dir': '目标目录(绝对路径)',
      'clone.run': '克隆',
      'prompt.deleteTag': '要删除的标签名',
      'gitLog.title': 'Git 输出',
      'gitLog.empty': '暂无 Git 运行记录',
      'toolbar.newBranch': '新建分支',
      'toolbar.fetch': '抓取(Fetch)',
      'toolbar.pull': '拉取(Pull)',
      'toolbar.pullPicked': "拉取选中的 {n} 个分支",
      'toolbar.fetchPicked': "抓取选中的 {n} 个引用",
      'toolbar.pushPicked': "推送选中的 {n} 个分支",
      'toolbar.checkoutPicked': "签出选中的分支",
      'toolbar.deletePicked': "删除选中的 {n} 个引用",
      'toolbar.push': '推送(Push)',
      'toolbar.tree': '分支栏',
      'rail.more': '更多操作',
      'rail.settings': '动作条设置',
      'rail.openSettings': '打开插件设置',
      'settings.card.title': 'Git 工具窗口设置',
      'settings.card.desc': '面板放置、动作条按钮与 AI 提交信息',
      'settings.placement.title': '面板放置',
      'settings.placement.tab': '在主对话区显示 Git 标签页',
      'settings.composer.title': '输入框下方分支状态',
      'settings.composer.hint': '在输入框下方(会话统计左侧)显示当前分支(可点击切换,与 Git 面板联动);关闭后不再显示。',
      'composer.branchHint': '切换分支',
      'composer.detached': 'HEAD(游离)',
      'modelRoute.pick': '选择模型',
      'modelRoute.trigger': 'AI 提交信息模型',
      'modelRoute.modelRow': '模型',
      'modelRoute.effortRow': '思考',
      'modelRoute.effortDefault': '跟随默认',
      'modelRoute.empty': '暂无可用模型',
      'composer.inWorktree': '已被其他工作树签出',
      'composer.busy': 'Git 操作进行中…',
      'settings.placement.tabHint': '关闭后仍可从右侧栏或底部面板打开。',
      'settings.placement.immersive': '沉浸模式(占满全高,隐藏输入框)',
      'settings.placement.immersiveHint': '开启后 Git 标签页占满整个会话区高度,输入框自动收起;审批与提问仍会正常显示。',
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
      'settings.rail.title': '动作条',
      'settings.rail.hint': '勾选要显示在动作条上的动作;顺序固定为默认顺序,取消勾选即隐藏。',
      'settings.rail.unavailable': '当前宿主没有设置服务,请用面板内的「动作条设置」。',
      'settings.commit.title': 'AI 提交信息',
      'settings.commit.model': '使用的模型',
      'settings.commit.modelHint': '留空 = 跟随当前会话(provider/model)',
      'settings.commit.modelFollow': '跟随当前会话',
      'settings.commit.reasoning': '思考强度',
      'settings.commit.reasoningHint': '留空 = 不思考',
      'settings.commit.reasoningDefault': '不思考(默认)',
      'settings.commit.reasoningFollowHint': '跟随会话时固定不思考;选择固定模型后可再选思考强度',
      'settings.commit.prompt': '补充提示词',
      'settings.commit.promptHint': '例如:用 Conventional Commits,subject 用中文,不超过 72 字符',
      'settings.commit.tooLong': '超过 {n} 个字符的部分不会保存',
      'changes.aiWrite': 'AI 写提交信息',
      'changes.aiBusy': '正在生成…',
      'changes.aiQuota': '会消耗你的额度',
      'changes.aiOverwriteTitle': '覆盖当前草稿?',
      'changes.aiOverwriteText': 'AI 生成的内容会替换你已经输入的提交信息(可以撤销)。',
      'changes.aiUndo': '撤销,恢复我的草稿',
      'changes.aiFailed': '生成失败:',
      'changes.aiNotice': '部分变更没有发给模型(已截断或丢弃),信息可能不完整。',
      'settings.rail.writeFailed': '设置没写进去,已退回原状态;请重试。',
      'settings.rail.readonly': '当前宿主把配置设为只读,开关不可修改。',
      'rail.settingsHint': '拖动或用箭头调整顺序,眼睛图标控制显示',
      'rail.reset': '恢复默认',
      'rail.up': '上移',
      'rail.down': '下移',
      'rail.show': '显示',
      'rail.hide': '隐藏',
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
      'error.dismiss': '关闭',
      'status.loading': '正在读取...',
      'status.busy': '处理中...',
      'counts.staged': '已暂存 {n}',
      'counts.ignored': '忽略 {n}',
      'counts.unstaged': '更改 {n}',
      'counts.untracked': '未跟踪 {n}',
      'counts.conflicted': '冲突 {n}',
      'push.confirm': '将 {branch} 推送到 {upstream}?',
      'push.confirmMany': "将推送 {n} 个分支:{names}。确定?",
      'delete.confirm': '删除分支 {name}?删除后浮窗里可以撤回(未合并的分支 git 会拒绝删除)。',
      'discard.confirm': '丢弃 {path} 的更改?工作区内容会被覆盖,丢弃后浮窗里可以撤回。',
      'resetHard.confirm': '硬重置到 {hash}?未提交的更改会丢失。',
      'resetSoft.confirm': '将 HEAD 重置到 {hash}(保留工作区更改)?',
      'checkoutCommit.confirm': '签出提交 {hash}?(分离头指针)',
    }

    const EN = {
      'title': 'Git',
      'description': 'IDE-grade Git panel: branch tree / commit graph / changes',
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
      'branches.starHint': "Favorited",
      'branches.pickHint': 'Click to select, double-click to browse its history',
      'branches.headHint': 'Double-click to browse the current branch\'s history',
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
      'changes.commitPlaceholder': 'Commit message (Ctrl+Enter)',
      'changes.commit': 'Commit',
      'changes.amend': 'Amend',
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
      'action.createLocalBranch': 'Create Local Branch…',
      'action.newBranchHere': 'New branch here...',
      'action.rename': 'Rename...',
      'action.delete': 'Delete',
      'action.mergeIntoCurrent': 'Merge into current branch',
      'action.rebaseCurrentOnto': 'Rebase current branch onto this',
      'action.compare': 'Compare with current branch',
      'action.update': 'Update (fetch)',
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
      'more.gitOutput': 'Show Git output',
      'clone.title': 'Clone repository',
      'clone.url': 'Repository URL',
      'clone.dir': 'Target directory (absolute path)',
      'clone.run': 'Clone',
      'prompt.deleteTag': 'Tag name to delete',
      'gitLog.title': 'Git output',
      'gitLog.empty': 'No git runs yet',
      'toolbar.newBranch': 'New branch',
      'toolbar.fetch': 'Fetch',
      'toolbar.pull': 'Pull',
      'toolbar.pullPicked': "Pull {n} picked branch(es)",
      'toolbar.fetchPicked': "Fetch {n} picked ref(s)",
      'toolbar.pushPicked': "Push {n} picked branch(es)",
      'toolbar.checkoutPicked': "Check out the picked branch",
      'toolbar.deletePicked': "Delete {n} picked ref(s)",
      'toolbar.push': 'Push',
      'toolbar.tree': 'Branch pane',
      'rail.more': 'More actions',
      'rail.settings': 'Action bar settings',
      'rail.openSettings': 'Open plugin settings',
      'settings.card.title': 'Git tool window settings',
      'settings.card.desc': 'Placement, action rail buttons and AI commit message',
      'settings.placement.title': 'Placement',
      'settings.placement.tab': 'Show the Git tab in the conversation area',
      'settings.composer.title': 'Branch below the composer',
      'settings.composer.hint': 'Show the current branch under the composer, left of the session statistics — click to switch, synced with the Git panel. Off hides it.',
      'composer.branchHint': 'Switch branch',
      'composer.detached': 'HEAD (detached)',
      'modelRoute.pick': 'Pick a model',
      'modelRoute.trigger': 'AI commit message model',
      'modelRoute.modelRow': 'Model',
      'modelRoute.effortRow': 'Reasoning',
      'modelRoute.effortDefault': 'Follow default',
      'modelRoute.empty': 'No models available',
      'composer.inWorktree': 'Checked out in another worktree',
      'composer.busy': 'Git operation in progress…',
      'settings.placement.tabHint': 'Off, the panel stays reachable from the right sidebar and the bottom panel.',
      'settings.placement.immersive': 'Immersive mode (full height, hidden composer)',
      'settings.placement.immersiveHint': 'On, the Git tab fills the whole conversation area and the composer steps aside; approvals and questions still show.',
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
      'settings.rail.title': 'Action rail',
      'settings.rail.hint': 'Tick the actions shown on the rail. The order is fixed; unticking one hides it.',
      'settings.rail.unavailable': 'This host has no settings service; use the in-panel “Action rail settings”.',
      'settings.commit.title': 'AI commit message',
      'settings.commit.model': 'Model',
      'settings.commit.modelHint': 'Empty = follow this session (provider/model)',
      'settings.commit.modelFollow': 'Follow the current session',
      'settings.commit.reasoning': 'Reasoning effort',
      'settings.commit.reasoningHint': 'Empty = no reasoning',
      'settings.commit.reasoningDefault': 'No reasoning (default)',
      'settings.commit.reasoningFollowHint': 'Following the session always uses no reasoning; pick a fixed model to choose an effort',
      'settings.commit.prompt': 'Extra instructions',
      'settings.commit.promptHint': 'e.g. Conventional Commits, Chinese subject, at most 72 characters',
      'settings.commit.tooLong': 'Only the first {n} characters are saved',
      'changes.aiWrite': 'Write with AI',
      'changes.aiBusy': 'Writing…',
      'changes.aiQuota': 'Uses your own quota',
      'changes.aiOverwriteTitle': 'Replace the current draft?',
      'changes.aiOverwriteText': 'The AI text will replace the commit message you typed (you can undo it).',
      'changes.aiUndo': 'Undo, bring my draft back',
      'changes.aiFailed': 'Could not write it:',
      'changes.aiNotice': 'Some changes were not sent to the model (truncated or dropped); the message may be incomplete.',
      'settings.rail.writeFailed': 'The setting did not save; the switch went back. Try again.',
      'settings.rail.readonly': 'This host serves the configuration read-only.',
      'rail.settingsHint': 'Drag or use the arrows to reorder; the eye toggles visibility',
      'rail.reset': 'Restore defaults',
      'rail.up': 'Move up',
      'rail.down': 'Move down',
      'rail.show': 'Show',
      'rail.hide': 'Hide',
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
      'error.dismiss': 'Dismiss',
      'status.loading': 'Reading...',
      'status.busy': 'Working...',
      'counts.staged': 'Staged {n}',
      'counts.ignored': 'Ignored {n}',
      'counts.unstaged': 'Changes {n}',
      'counts.untracked': 'Untracked {n}',
      'counts.conflicted': 'Conflicts {n}',
      'push.confirm': 'Push {branch} to {upstream}?',
      'push.confirmMany': "Push {n} branch(es): {names}?",
      'delete.confirm': 'Delete branch {name}? A toast will offer to bring it back (git still refuses unmerged branches).',
      'discard.confirm': 'Discard changes in {path}? The working-tree content is overwritten — a toast will offer to bring it back.',
      'resetHard.confirm': 'Hard reset to {hash}? Uncommitted changes are lost.',
      'resetSoft.confirm': 'Move HEAD to {hash} (working tree kept)?',
      'checkoutCommit.confirm': 'Check out commit {hash}? (detached HEAD)',
    }

    /* Third-language dictionaries, keyed by lowercase BCP-47 tag. Every entry
       must carry the SAME key set as ZH: a missing key falls back to English at
       lookup time, and tests/smoke.mjs enforces the equality so a new string
       cannot land in zh and en alone. Adding a language is one entry here and
       nothing else — the dictionaries are also handed to the DSH locale
       registry, so host-side consumers read the same copy the panel does. */
    const LOCALES = {
      /* locale: zh-hk */
      'zh-hk': {
        'title': 'Git',
        'description': 'IDE 級 Git 面板:分支樹 / 提交圖譜 / 變更',
        'repo.label': '存放庫',
        'repo.workspace': '工作區',
        'repo.nested': '巢狀',
        'repo.none': '呢個工作區唔係 Git 存放庫',
        'repo.pick': '揀一個存放庫嚟睇',
        'repo.empty': '呢個工作區搵唔到 Git 存放庫',
        'repo.switch': '切換存放庫',
        'branch.switch': '切換分支',
        'seg.changes': '變更 {n}',
        'seg.history': '歷史',
        'branches.local': '本地',
        'branches.remote': '遠端',
        'branches.tags': '標籤',
        'branches.head': 'HEAD(當前分支)',
        'branches.favorites': '我的最愛',
        'branches.starHint': "已收藏",
        'branches.pickHint': '單擊選中,雙擊查看提交歷史',
        'branches.headHint': '雙擊查看當前分支的提交歷史',
        'branches.worktree': '已喺另一個工作區簽出',
        'action.stash': '貯藏',
        'action.favorite': '加入/取消我的最愛',
        'action.newTagHere': '喺當前提交新建標籤...',
        'stash.push': '貯藏當前變更',
        'stash.apply': '套用最新貯藏',
        'stash.drop': '丟棄最新貯藏',
        'stash.count': '{n} 個貯藏',
        'note.noChanges': '冇待處理嘅變更',
        'note.noBranches': '冇其他分支',
        'branches.filter': '分支或標籤',
        'changes.title': '變更',
        'changes.staged': '已暫存',
        'changes.unstaged': '變更',
        'changes.untracked': '未追蹤',
        'changes.conflicted': '衝突',
        'changes.empty': '冇待處理嘅變更',
        'changes.commitPlaceholder': '提交訊息(Ctrl+Enter)',
        'changes.commit': '提交',
        'changes.amend': '修訂上次提交',
        'changes.stageAll': '全部暫存',
        'selection.count': '已選 {n} 項',
        'selection.copied': '已複製 {n} 項',
        'selection.copyPaths': '複製路徑',
        'selection.clear': '清除選擇',
        'action.copyName': '複製名稱',
        'menu.copyNamesN': '複製 {n} 個名稱',
        'menu.copyHashesN': '複製 {n} 個雜湊',
        'menu.copyPathsN': '複製 {n} 個路徑',
        'menu.stageN': '暫存 {n} 項',
        'menu.unstageN': '取消暫存 {n} 項',
        'menu.discardN': '還原 {n} 項…',
        'menu.cherryN': 'Cherry-pick {n} 個提交',
        'menu.deleteLocalN': '刪除 {n} 個本地分支…',
        'menu.deleteRemoteN': '刪除 {n} 個遠端分支…',
        'menu.deleteTagsN': '刪除 {n} 個標籤…',
        'confirm.deleteRefs': '刪除所選引用?本地分支 {b} 個、遠端分支 {r} 個、標籤 {g} 個。',
        'confirm.discardMany': '還原 {n} 個檔案的未提交變更?',
        'confirm.discardManyUntracked': '其中 {m} 個未追蹤檔案將被徹底刪除。',
        'toast.branchesDeleted': '已刪除 {n} 個分支',
        'changes.unstageAll': '全部取消暫存',
        'changes.groupBy': '分組方式',
        'changes.groupFlat': '平面清單',
        'changes.groupDir': '按目錄',
        'changes.expandAll': '全部展開',
        'changes.foldAll': '全部收起',
        'changes.showIgnored': '顯示被忽略嘅檔案',
        'changes.rootDir': '(根目錄)',
        'changes.commitAndPush': '提交並推送',
        'action.stage': '暫存',
        'action.unstage': '取消暫存',
        'action.discard': '丟棄變更',
        'action.showDiff': '顯示差異',
        'action.copyPath': '複製路徑',
        'action.checkout': '簽出',
        'action.float': '浮動本頁',
        'action.dock': '收回停靠',
        'action.split': '分欄',
        'action.fullscreen': '全螢幕',
        'action.exitFullscreen': '結束全螢幕',
        'action.newBranchFrom': '由此新建分支...',
        'action.setUpstream': '設定上游…',
        'action.unsetUpstream': '取消上游',
        'action.createLocalBranch': '建立本地分支…',
        'action.newBranchHere': '喺呢度新建分支...',
        'action.rename': '重新命名...',
        'action.delete': '刪除',
        'action.mergeIntoCurrent': '合併到當前分支',
        'action.rebaseCurrentOnto': '將當前分支變基到此',
        'action.compare': '同當前分支比較',
        'action.update': '更新(抓取)',
        'action.push': '推送',
        'action.newTag': '新建標籤...',
        'action.cherryPick': '揀選',
        'action.revert': '還原提交',
        'action.resetSoft': '重置到此(保留變更)',
        'action.resetHard': '重置到此(丟棄變更)',
        'action.copyHash': '複製修訂號',
        'action.details': '提交詳情',
        'menu.sendToChat': '傳送到對話',
        'send.commitText': 'git 提交 {hash}「{subject}」(存放庫 {repo})',
        'send.branchText': 'git 分支 {name}(存放庫 {repo})',
        'menu.sendDiffLinesToChat': '傳送選中行到對話',
        'menu.sendDiffSnippetToChat': '傳送選中片段到對話',
        'menu.copyDiffRef': '複製選中引用',
        'send.diffLinesCommit': '{lines}(提交 {hash}「{subject}」@ {branch})',
        'send.diffLinesWorktree': '{lines}(工作區{state})',
        'send.diffStaged': '已暫存',
        'send.diffUnstaged': '未提交',
        'send.diffNewLines': '第 {lines} 行',
        'send.diffOldLines': '第 {lines} 行(舊行號)',
        'history.empty': '呢個存放庫仲未有提交',
        'history.loadMore': '載入更多',
        'history.filter': '文字或雜湊',
        'detail.files': '變更嘅檔案',
        'detail.pick': '揀一個提交',
        'detail.back': '返回歷史',
        'detail.noFiles': '冇檔案變更',
        'diff.empty': '冇文字差異可以顯示',
        'pane.diff': '差異檢視',
        'pane.resize': '拖動調整{name}尺寸,雙擊復位,方向鍵微調',
        'diff.binary': '二進位檔案',
        'diff.loading': '正在載入差異...',
        'diff.codeLabel': '差異',
        'diff.wrapLabel': '自動換行',
        'diff.unwrapLabel': '按原始欄寬顯示',
        'diff.copy': '複製',
        'diff.copied': '已複製',
        'toolbar.refresh': '重新整理',
      'more.sort': '查看和排序',
      'more.commitGroup': '提交',
      'more.changesGroup': '更改',
      'more.pullpushGroup': '拉取，推送',
      'more.branchGroup': '分支',
      'more.remoteGroup': '遠端',
      'more.stashGroup': '儲存',
      'more.tagGroup': '標籤',
      'more.commitStaged': '提交已暫存檔案...',
      'more.commitAll': '全部提交...',
      'more.undoCommit': '撤銷上次提交',
      'more.rebaseAbort': '中止變基',
      'more.commitStagedAmend': '提交已暫存檔案(修改)...',
      'more.commitAllAmend': '全部提交(修改)...',
      'more.commitStagedSign': '提交已暫存檔案(已簽收)...',
      'more.commitAllSign': '全部提交(已簽收)...',
      'prompt.commitMessage': '提交資訊',
      'more.discardAll': '放棄所有變更...',
      'more.sync': '同步(拉取並推送)',
      'more.syncRebase': '同步(變基並推送)',
      'more.pullRebase': '拉取(變基)',
      'more.pullFrom': '從遠端拉取',
      'more.pushForce': '推送(強制)...',
      'more.pushTo': '推送到遠端',
      'more.fetchAll': '從所有遠端抓取',
      'more.deleteRemoteBranch': '刪除遠端分支...',
      'more.publish': '發布分支...',
      'more.setUpstreamHead': '設定目前分支上游…',
      'more.unsetUpstreamHead': '取消目前分支上游',
      'more.addRemote': '新增遠端...',
      'more.removeRemote': '刪除遠端...',
      'more.stashTracked': '儲存(僅已追蹤)',
      'more.stashStaged': '儲存已暫存檔案',
      'more.stashApplyPick': '套用儲存...',
      'more.stashPopPick': '彈出儲存...',
      'more.stashDropAny': '刪除儲存...',
      'more.stashClear': '刪除全部儲存...',
      'stash.none': '沒有可用的儲存',
      'more.tagDeleteRemote': '刪除遠端標籤...',
      'more.pushTags': '推送標籤...',
      'confirm.undoCommit': '撤銷上次提交?提交的變更會保留在暫存區。',
      'confirm.discardAll': '放棄全部未暫存與未追蹤的變更?可透過復原浮窗恢復(衝突檔案除外)。',
      'confirm.pushForce': '強制推送會以本地分支覆寫遠端(--force-with-lease,他人有新提交時會被拒絕)。繼續?',
      'confirm.deleteRemoteBranch': '刪除遠端 {remote} 上的分支 {branch}?',
      'confirm.remoteRemove': '刪除遠端 {name}?其追蹤設定一併移除。',
      'confirm.stashClear': '刪除全部儲存?此操作不可復原。',
      'confirm.pushTags': '推送全部標籤到 {remote}?',
      'prompt.remoteName': '遠端名稱',
      'prompt.remoteUrl': '遠端 URL',
      'prompt.deleteRemoteTag': '要刪除的遠端標籤(將推送到 {remote})',
      'toolbar.more': '更多操作',
      'more.sortGit': 'Git 順序',
      'more.sortPath': '按路徑',
      'more.sortName': '按名稱',
      'more.sortStatus': '按狀態',
      'more.clone': '複製存放庫...',
      'more.stashPop': '彈出最近貯藏',
      'more.deleteTag': '刪除標籤...',
      'more.gitOutput': '顯示 Git 輸出',
      'clone.title': '複製存放庫',
      'clone.url': '存放庫 URL',
      'clone.dir': '目標目錄(絕對路徑)',
      'clone.run': '複製',
      'prompt.deleteTag': '要刪除的標籤名',
      'gitLog.title': 'Git 輸出',
      'gitLog.empty': '暫無 Git 執行記錄',
        'toolbar.newBranch': '新建分支',
        'toolbar.fetch': '抓取',
        'toolbar.pull': '拉取',
        'toolbar.pullPicked': "拉取選中的 {n} 個分支",
        'toolbar.fetchPicked': "抓取選中的 {n} 個引用",
        'toolbar.pushPicked': "推送選中的 {n} 個分支",
        'toolbar.checkoutPicked': "簽出選中的分支",
        'toolbar.deletePicked': "刪除選中的 {n} 個引用",
        'toolbar.push': '推送',
        'toolbar.tree': '分支面板',
        'rail.more': '更多操作',
        'rail.settings': '動作列設定',
        'rail.openSettings': '開啟外掛設定',
        'settings.card.title': 'Git 工具視窗設定',
        'settings.card.desc': '面板放置、動作列按鈕與 AI 提交訊息',
        'settings.placement.title': '面板放置',
        'settings.placement.tab': '喺主對話區顯示 Git 分頁',
      'settings.composer.title': '輸入框下面分支狀態',
      'settings.composer.hint': '喺輸入框下面(會話統計左邊)顯示目前分支(可以點擊切換,同 Git 面板聯動);關閉之後就唔會再顯示。',
      'composer.branchHint': '切換分支',
      'composer.detached': 'HEAD(游離)',
      'modelRoute.pick': '選擇模型',
      'modelRoute.trigger': 'AI 提交訊息模型',
      'modelRoute.modelRow': '模型',
      'modelRoute.effortRow': '思考',
      'modelRoute.effortDefault': '跟隨預設',
      'modelRoute.empty': '暫無可用模型',
      'composer.inWorktree': '已經喺其他工作樹簽出',
      'composer.busy': 'Git 操作進行中…',
        'settings.placement.tabHint': '關閉之後仍可從右側欄或底部面板開啟。',
        'settings.placement.immersive': '沉浸模式(佔滿全高,隱藏輸入框)',
        'settings.placement.immersiveHint': '開啟之後 Git 分頁會佔滿整個會話區高度,輸入框自動收起;審批與提問仍會正常顯示。',
        'preview.openFile': '開啟檔案預覽',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': '選擇要查看嘅檔案',
        'lf.split': '切換為左右對比',
        'lf.unified': '切換為單欄對比',
        'lf.wrap': '開啟自動換行',
        'lf.nowrap': '關閉自動換行',
        'lf.created': '新建嘅檔案',
        'lf.removedFile': '刪除嘅檔案',
        'lf.truncated': '只顯示前 {count} 行',
        'preview.title': 'Git 預覽',
        'preview.hint': '喺檔案或提交撳「顯示差異」,差異就會喺側邊欄度開啟。',
        'preview.boundary': '預覽渲染出錯——請重新載入頁面,或者回報呢個問題。',
        'settings.rail.title': '動作列',
        'settings.rail.hint': '勾選要顯示在動作列上的動作;順序固定,取消勾選即隱藏。',
        'settings.rail.unavailable': '目前宿主沒有設定服務,請用面板內的「動作條設定」。',
        'settings.commit.title': 'AI 提交訊息',
        'settings.commit.model': '使用嘅模型',
        'settings.commit.modelHint': '留空 = 跟隨當前對話(provider/model)',
        'settings.commit.modelFollow': '跟隨當前對話',
        'settings.commit.reasoning': '思考強度',
        'settings.commit.reasoningHint': '留空 = 不思考',
        'settings.commit.reasoningDefault': '不思考(預設)',
        'settings.commit.reasoningFollowHint': '跟隨對話時固定不思考;選擇固定模型後可再選思考強度',
        'settings.commit.prompt': '補充提示詞',
        'settings.commit.promptHint': '例如:用 Conventional Commits,subject 用中文,唔超過 72 字',
        'settings.commit.tooLong': '超過 {n} 個字嘅部分唔會儲存',
        'changes.aiWrite': 'AI 寫提交訊息',
        'changes.aiBusy': '生成緊…',
        'changes.aiQuota': '會消耗你嘅額度',
        'changes.aiOverwriteTitle': '覆蓋當前草稿?',
        'changes.aiOverwriteText': 'AI 生成嘅內容會換走你打咗嘅提交訊息(可以撤銷)。',
        'changes.aiUndo': '撤銷,還原我嘅草稿',
        'changes.aiFailed': '生成失敗:',
        'changes.aiNotice': '有部分變更冇發俾模型(已截斷或丟棄),訊息可能唔完整。',
        'settings.rail.writeFailed': '設定寫唔入,已經退回原狀;請再試。',
        'settings.rail.readonly': '目前宿主將設定設為唯讀,開關改唔到。',
        'rail.settingsHint': '拖曳或用箭嘴排序;眼睛圖示切換顯示',
        'rail.reset': '還原預設',
        'rail.up': '上移',
        'rail.down': '下移',
        'rail.show': '顯示',
        'rail.hide': '隱藏',
        'action.unavailable': '當前狀態下唔可用',
        'filter.branch': '分支',
        'filter.user': '提交者',
        'history.me': '我',
        'filter.date': '日期',
        'filter.path': '路徑',
        'filter.all': '全部',
        'filter.today': '今日',
        'filter.week': '近 7 日',
        'filter.month': '近 30 日',
        'filter.year': '今年',
        'filter.pathPlaceholder': '按路徑篩選(Enter)',
        'filter.sortDesc': '新到舊',
        'filter.sortAsc': '舊到新',
        'filter.clear': '清除篩選',
        'filter.none': '冇符合嘅提交',
        'toast.undo': '撤回',
        'toast.close': '關閉',
        'toast.branchDeleted': '已刪除分支 {name}',
        'toast.stashDropped': '已丟棄貯藏 {ref}',
        'toast.discarded': '已丟棄 {path} 嘅變更',
        'toast.discardNoUndo': '已丟棄 {path} 嘅變更(太大,冇保留撤回)',
        'toast.restored': '已還原',
        'toast.sentToChat': '已傳送到對話框',
        'toast.sendCopied': '無法傳送,已複製到剪貼板',
        'undo.menu': '最近刪除(撤回)',
        'undo.empty': '暫時冇嘢可以撤回',
        'undo.branch': '分支',
        'undo.stash': '貯藏',
        'undo.discard': '丟棄',
        'confirm.typeName': '輸入 {name} 以確認',
        'confirm.protected': '{name} 係主分支。刪除風險好高,請輸入分支名確認 —— 之後仍然可以喺提示條撤回。',
        'discard.untracked.confirm': '刪除未追蹤檔案 {path}?內容會被移除 —— 之後可以喺提示條撤回。',
        'stashDrop.confirm': '丟棄貯藏 {ref}?之後可以喺提示條撤回。',
        'operation.merge': '合併進行中',
        'operation.rebase': '變基進行中',
        'operation.cherry-pick': '揀選進行中',
        'operation.revert': '還原進行中',
        'operation.bisect': 'Bisect 進行中',
        'operation.hint': '呢個存放庫仲有未完成嘅多步操作 —— 請先完成或中止,再進行分支層級嘅操作',
        'confirm.title': '確認',
        'confirm.cancel': '取消',
        'confirm.ok': '確定',
        'prompt.newBranch': '新分支名(建立並簽出)',
        'prompt.createTracking': '從遠端分支建立本地分支',
        'prompt.renameBranch': '重新命名分支',
        'prompt.newTag': '新標籤名',
        'prompt.fromHead': '當前 HEAD',
        'error.dismiss': '關閉',
        'status.loading': '讀取中...',
        'status.busy': '處理中...',
        'counts.staged': '已暫存 {n}',
        'counts.ignored': '已忽略 {n}',
        'counts.unstaged': '變更 {n}',
        'counts.untracked': '未追蹤 {n}',
        'counts.conflicted': '衝突 {n}',
        'push.confirm': '將 {branch} 推送到 {upstream}?',
        'push.confirmMany': "將推送 {n} 個分支:{names}。確定?",
        'delete.confirm': '刪除分支 {name}?之後可以喺提示條撤回(git 仍然會拒絕未合併嘅分支)。',
        'discard.confirm': '丟棄 {path} 嘅變更?工作區內容會被覆寫 —— 之後可以喺提示條撤回。',
        'resetHard.confirm': '硬重置到 {hash}?未提交嘅變更會遺失。',
        'resetSoft.confirm': '將 HEAD 移到 {hash}(保留工作區)?',
        'checkoutCommit.confirm': '簽出提交 {hash}?(detached HEAD)',
      },
      /* locale: zh-tw */
      'zh-tw': {
        'title': 'Git',
        'description': 'IDE 級 Git 面板:分支樹 / 提交圖形 / 變更',
        'repo.label': '版本庫',
        'repo.workspace': '工作區',
        'repo.nested': '巢狀',
        'repo.none': '這個工作區不是 Git 版本庫',
        'repo.pick': '選擇要檢視的版本庫',
        'repo.empty': '這個工作區找不到 Git 版本庫',
        'repo.switch': '切換版本庫',
        'branch.switch': '切換分支',
        'seg.changes': '變更 {n}',
        'seg.history': '歷史',
        'branches.local': '本機',
        'branches.remote': '遠端',
        'branches.tags': '標籤',
        'branches.head': 'HEAD(目前分支)',
        'branches.favorites': '我的最愛',
        'branches.starHint': "已收藏",
        'branches.pickHint': '單擊選取,雙擊檢視提交歷史',
        'branches.headHint': '雙擊檢視目前分支的提交歷史',
        'branches.worktree': '已在另一個工作區簽出',
        'action.stash': '暫存擱置',
        'action.favorite': '加入/移除我的最愛',
        'action.newTagHere': '在目前提交新建標籤...',
        'stash.push': '擱置目前變更',
        'stash.apply': '套用最新擱置',
        'stash.drop': '丟棄最新擱置',
        'stash.count': '{n} 筆擱置',
        'note.noChanges': '沒有待處理的變更',
        'note.noBranches': '沒有其他分支',
        'branches.filter': '分支或標籤',
        'changes.title': '變更',
        'changes.staged': '已暫存',
        'changes.unstaged': '變更',
        'changes.untracked': '未追蹤',
        'changes.conflicted': '衝突',
        'changes.empty': '沒有待處理的變更',
        'changes.commitPlaceholder': '提交訊息(Ctrl+Enter)',
        'changes.commit': '提交',
        'changes.amend': '修訂上次提交',
        'changes.stageAll': '全部暫存',
        'selection.count': '已選 {n} 項',
        'selection.copied': '已複製 {n} 項',
        'selection.copyPaths': '複製路徑',
        'selection.clear': '清除選擇',
        'action.copyName': '複製名稱',
        'menu.copyNamesN': '複製 {n} 個名稱',
        'menu.copyHashesN': '複製 {n} 個雜湊',
        'menu.copyPathsN': '複製 {n} 個路徑',
        'menu.stageN': '暫存 {n} 項',
        'menu.unstageN': '取消暫存 {n} 項',
        'menu.discardN': '還原 {n} 項…',
        'menu.cherryN': 'Cherry-pick {n} 個提交',
        'menu.deleteLocalN': '刪除 {n} 個本地分支…',
        'menu.deleteRemoteN': '刪除 {n} 個遠端分支…',
        'menu.deleteTagsN': '刪除 {n} 個標籤…',
        'confirm.deleteRefs': '刪除所選引用?本地分支 {b} 個、遠端分支 {r} 個、標籤 {g} 個。',
        'confirm.discardMany': '還原 {n} 個檔案的未提交變更?',
        'confirm.discardManyUntracked': '其中 {m} 個未追蹤檔案將被徹底刪除。',
        'toast.branchesDeleted': '已刪除 {n} 個分支',
        'changes.unstageAll': '全部取消暫存',
        'changes.groupBy': '分組方式',
        'changes.groupFlat': '平面清單',
        'changes.groupDir': '依目錄',
        'changes.expandAll': '全部展開',
        'changes.foldAll': '全部收合',
        'changes.showIgnored': '顯示被忽略的檔案',
        'changes.rootDir': '(根目錄)',
        'changes.commitAndPush': '提交並推送',
        'action.stage': '暫存',
        'action.unstage': '取消暫存',
        'action.discard': '丟棄變更',
        'action.showDiff': '顯示差異',
        'action.copyPath': '複製路徑',
        'action.checkout': '簽出',
        'action.float': '浮動本頁',
        'action.dock': '收回停靠',
        'action.split': '分割欄',
        'action.fullscreen': '全螢幕',
        'action.exitFullscreen': '結束全螢幕',
        'action.newBranchFrom': '由此新建分支...',
        'action.setUpstream': '設定上游…',
        'action.unsetUpstream': '取消上游',
        'action.createLocalBranch': '建立本地分支…',
        'action.newBranchHere': '在此新建分支...',
        'action.rename': '重新命名...',
        'action.delete': '刪除',
        'action.mergeIntoCurrent': '合併到目前分支',
        'action.rebaseCurrentOnto': '將目前分支變基到此',
        'action.compare': '與目前分支比較',
        'action.update': '更新(抓取)',
        'action.push': '推送',
        'action.newTag': '新建標籤...',
        'action.cherryPick': '揀選',
        'action.revert': '還原提交',
        'action.resetSoft': '重置到此(保留變更)',
        'action.resetHard': '重置到此(丟棄變更)',
        'action.copyHash': '複製修訂編號',
        'action.details': '提交詳情',
        'menu.sendToChat': '傳送至對話',
        'send.commitText': 'git 提交 {hash}「{subject}」(版本庫 {repo})',
        'send.branchText': 'git 分支 {name}(版本庫 {repo})',
        'menu.sendDiffLinesToChat': '傳送選取行至對話',
        'menu.sendDiffSnippetToChat': '傳送選取片段至對話',
        'menu.copyDiffRef': '複製選取的引用',
        'send.diffLinesCommit': '{lines}(提交 {hash}「{subject}」@ {branch})',
        'send.diffLinesWorktree': '{lines}(工作區{state})',
        'send.diffStaged': '已暫存',
        'send.diffUnstaged': '未提交',
        'send.diffNewLines': '第 {lines} 行',
        'send.diffOldLines': '第 {lines} 行(舊行號)',
        'history.empty': '這個版本庫還沒有提交',
        'history.loadMore': '載入更多',
        'history.filter': '文字或雜湊',
        'detail.files': '變更的檔案',
        'detail.pick': '選擇一個提交',
        'detail.back': '返回歷史',
        'detail.noFiles': '沒有檔案變更',
        'diff.empty': '沒有文字差異可顯示',
        'pane.diff': '差異檢視',
        'pane.resize': '拖曳調整{name}尺寸,雙擊重設,方向鍵微調',
        'diff.binary': '二進位檔案',
        'diff.loading': '正在載入差異...',
        'diff.codeLabel': '差異',
        'diff.wrapLabel': '自動換行',
        'diff.unwrapLabel': '依原始欄寬顯示',
        'diff.copy': '複製',
        'diff.copied': '已複製',
        'toolbar.refresh': '重新整理',
      'more.sort': '查看和排序',
      'more.commitGroup': '提交',
      'more.changesGroup': '變更',
      'more.pullpushGroup': '拉取，推送',
      'more.branchGroup': '分支',
      'more.remoteGroup': '遠端',
      'more.stashGroup': '擱置',
      'more.tagGroup': '標籤',
      'more.commitStaged': '提交已暫存檔案...',
      'more.commitAll': '全部提交...',
      'more.undoCommit': '復原上次提交',
      'more.rebaseAbort': '中止變基',
      'more.commitStagedAmend': '提交已暫存檔案(修改)...',
      'more.commitAllAmend': '全部提交(修改)...',
      'more.commitStagedSign': '提交已暫存檔案(已簽核)...',
      'more.commitAllSign': '全部提交(已簽核)...',
      'prompt.commitMessage': '提交資訊',
      'more.discardAll': '捨棄所有變更...',
      'more.sync': '同步(拉取並推送)',
      'more.syncRebase': '同步(變基並推送)',
      'more.pullRebase': '拉取(變基)',
      'more.pullFrom': '從遠端拉取',
      'more.pushForce': '推送(強制)...',
      'more.pushTo': '推送到遠端',
      'more.fetchAll': '從所有遠端擷取',
      'more.deleteRemoteBranch': '刪除遠端分支...',
      'more.publish': '發佈分支...',
      'more.setUpstreamHead': '設定目前分支上游…',
      'more.unsetUpstreamHead': '取消目前分支上游',
      'more.addRemote': '新增遠端...',
      'more.removeRemote': '移除遠端...',
      'more.stashTracked': '擱置(僅已追蹤)',
      'more.stashStaged': '擱置已暫存檔案',
      'more.stashApplyPick': '套用擱置...',
      'more.stashPopPick': '取出擱置...',
      'more.stashDropAny': '刪除擱置...',
      'more.stashClear': '刪除全部擱置...',
      'stash.none': '沒有可用的擱置',
      'more.tagDeleteRemote': '刪除遠端標籤...',
      'more.pushTags': '推送標籤...',
      'confirm.undoCommit': '復原上次提交?提交的變更會保留在暫存區。',
      'confirm.discardAll': '捨棄全部未暫存與未追蹤的變更?可透過復原浮窗復原(衝突檔案除外)。',
      'confirm.pushForce': '強制推送會以本地分支覆寫遠端(--force-with-lease,他人有新提交時會被拒絕)。繼續?',
      'confirm.deleteRemoteBranch': '刪除遠端 {remote} 上的分支 {branch}?',
      'confirm.remoteRemove': '移除遠端 {name}?其追蹤設定一併移除。',
      'confirm.stashClear': '刪除全部擱置?此作業無法復原。',
      'confirm.pushTags': '推送全部標籤到 {remote}?',
      'prompt.remoteName': '遠端名稱',
      'prompt.remoteUrl': '遠端 URL',
      'prompt.deleteRemoteTag': '要刪除的遠端標籤(將推送至 {remote})',
      'toolbar.more': '更多操作',
      'more.sortGit': 'Git 順序',
      'more.sortPath': '按路徑',
      'more.sortName': '按名稱',
      'more.sortStatus': '按狀態',
      'more.clone': '複製存放庫...',
      'more.stashPop': '取出最近擱置',
      'more.deleteTag': '刪除標籤...',
      'more.gitOutput': '顯示 Git 輸出',
      'clone.title': '複製存放庫',
      'clone.url': '存放庫 URL',
      'clone.dir': '目標目錄(絕對路徑)',
      'clone.run': '複製',
      'prompt.deleteTag': '要刪除的標籤名',
      'gitLog.title': 'Git 輸出',
      'gitLog.empty': '暫無 Git 執行記錄',
        'toolbar.newBranch': '新建分支',
        'toolbar.fetch': '抓取',
        'toolbar.pull': '拉取',
        'toolbar.pullPicked': "拉取選中的 {n} 個分支",
        'toolbar.fetchPicked': "抓取選中的 {n} 個引用",
        'toolbar.pushPicked': "推送選中的 {n} 個分支",
        'toolbar.checkoutPicked': "簽出選中的分支",
        'toolbar.deletePicked': "刪除選中的 {n} 個引用",
        'toolbar.push': '推送',
        'toolbar.tree': '分支面板',
        'rail.more': '更多操作',
        'rail.settings': '動作列設定',
        'rail.openSettings': '開啟外掛設定',
        'settings.card.title': 'Git 工具視窗設定',
        'settings.card.desc': '面板放置、動作列按鈕與 AI 提交訊息',
        'settings.placement.title': '面板放置',
        'settings.placement.tab': '在主對話區顯示 Git 分頁',
      'settings.composer.title': '輸入框下方分支狀態',
      'settings.composer.hint': '在輸入框下方(工作階段統計左側)顯示目前分支(可點擊切換,並與 Git 面板連動);關閉後不再顯示。',
      'composer.branchHint': '切換分支',
      'composer.detached': 'HEAD(分離)',
      'modelRoute.pick': '選擇模型',
      'modelRoute.trigger': 'AI 提交訊息模型',
      'modelRoute.modelRow': '模型',
      'modelRoute.effortRow': '思考',
      'modelRoute.effortDefault': '跟隨預設',
      'modelRoute.empty': '暫無可用模型',
      'composer.inWorktree': '已被其他工作樹簽出',
      'composer.busy': 'Git 操作進行中…',
        'settings.placement.tabHint': '關閉之後仍可從右側欄或底部面板開啟。',
        'settings.placement.immersive': '沉浸模式(佔滿全高,隱藏輸入框)',
        'settings.placement.immersiveHint': '開啟之後 Git 分頁會佔滿整個對話區高度,輸入框自動收起;審核與提問仍會正常顯示。',
        'preview.openFile': '開啟檔案預覽',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': '選擇要查看的檔案',
        'lf.split': '切換為左右對比',
        'lf.unified': '切換為單欄對比',
        'lf.wrap': '開啟自動換行',
        'lf.nowrap': '關閉自動換行',
        'lf.created': '新建的檔案',
        'lf.removedFile': '刪除的檔案',
        'lf.truncated': '只顯示前 {count} 行',
        'preview.title': 'Git 預覽',
        'preview.hint': '點選檔案或提交的「顯示差異」,差異就會在側邊欄開啟。',
        'preview.boundary': '預覽算繪出錯——請重新載入頁面,或回報這個問題。',
        'settings.rail.title': '動作列',
        'settings.rail.hint': '勾選要顯示在動作列上的動作;順序固定,取消勾選即隱藏。',
        'settings.rail.unavailable': '目前宿主沒有設定服務,請用面板內的「動作條設定」。',
        'settings.commit.title': 'AI 提交訊息',
        'settings.commit.model': '使用的模型',
        'settings.commit.modelHint': '留空 = 跟隨目前工作階段(provider/model)',
        'settings.commit.modelFollow': '跟隨目前工作階段',
        'settings.commit.reasoning': '思考強度',
        'settings.commit.reasoningHint': '留空 = 不思考',
        'settings.commit.reasoningDefault': '不思考(預設)',
        'settings.commit.reasoningFollowHint': '跟隨工作階段時固定不思考;選擇固定模型後可再選思考強度',
        'settings.commit.prompt': '補充提示詞',
        'settings.commit.promptHint': '例如:用 Conventional Commits,subject 用中文,不超過 72 字元',
        'settings.commit.tooLong': '超過 {n} 個字元的部分不會儲存',
        'changes.aiWrite': 'AI 寫提交訊息',
        'changes.aiBusy': '正在生成…',
        'changes.aiQuota': '會消耗你的額度',
        'changes.aiOverwriteTitle': '覆蓋目前的草稿?',
        'changes.aiOverwriteText': 'AI 生成的內容會取代你已輸入的提交訊息(可以復原)。',
        'changes.aiUndo': '復原,還原我的草稿',
        'changes.aiFailed': '生成失敗:',
        'changes.aiNotice': '部分變更沒有傳給模型(已截斷或捨棄),訊息可能不完整。',
        'settings.rail.writeFailed': '設定沒有寫入,已退回原狀態;請重試。',
        'settings.rail.readonly': '目前宿主將設定設為唯讀,開關無法修改。',
        'rail.settingsHint': '拖曳或用箭頭排序;眼睛圖示切換顯示',
        'rail.reset': '還原預設',
        'rail.up': '上移',
        'rail.down': '下移',
        'rail.show': '顯示',
        'rail.hide': '隱藏',
        'action.unavailable': '目前狀態下無法使用',
        'filter.branch': '分支',
        'filter.user': '提交者',
        'history.me': '我',
        'filter.date': '日期',
        'filter.path': '路徑',
        'filter.all': '全部',
        'filter.today': '今天',
        'filter.week': '近 7 天',
        'filter.month': '近 30 天',
        'filter.year': '今年',
        'filter.pathPlaceholder': '依路徑篩選(Enter)',
        'filter.sortDesc': '新到舊',
        'filter.sortAsc': '舊到新',
        'filter.clear': '清除篩選',
        'filter.none': '沒有符合的提交',
        'toast.undo': '撤回',
        'toast.close': '關閉',
        'toast.branchDeleted': '已刪除分支 {name}',
        'toast.stashDropped': '已丟棄擱置 {ref}',
        'toast.discarded': '已丟棄 {path} 的變更',
        'toast.discardNoUndo': '已丟棄 {path} 的變更(太大,未保留撤回)',
        'toast.restored': '已還原',
        'toast.sentToChat': '已傳送至對話框',
        'toast.sendCopied': '無法傳送,已複製到剪貼簿',
        'undo.menu': '最近刪除(撤回)',
        'undo.empty': '目前沒有可撤回的項目',
        'undo.branch': '分支',
        'undo.stash': '擱置',
        'undo.discard': '丟棄',
        'confirm.typeName': '輸入 {name} 以確認',
        'confirm.protected': '{name} 是主分支。刪除風險很高,請輸入分支名稱確認 —— 之後仍可從提示條撤回。',
        'discard.untracked.confirm': '刪除未追蹤檔案 {path}?內容會被移除 —— 之後可從提示條撤回。',
        'stashDrop.confirm': '丟棄擱置 {ref}?之後可從提示條撤回。',
        'operation.merge': '合併進行中',
        'operation.rebase': '變基進行中',
        'operation.cherry-pick': '揀選進行中',
        'operation.revert': '還原進行中',
        'operation.bisect': 'Bisect 進行中',
        'operation.hint': '這個版本庫仍有未完成的多步驟操作 —— 請先完成或中止,再進行分支層級的操作',
        'confirm.title': '確認',
        'confirm.cancel': '取消',
        'confirm.ok': '確定',
        'prompt.newBranch': '新分支名稱(建立並簽出)',
        'prompt.createTracking': '從遠端分支建立本地分支',
        'prompt.renameBranch': '重新命名分支',
        'prompt.newTag': '新標籤名稱',
        'prompt.fromHead': '目前 HEAD',
        'error.dismiss': '關閉',
        'status.loading': '讀取中...',
        'status.busy': '處理中...',
        'counts.staged': '已暫存 {n}',
        'counts.ignored': '已忽略 {n}',
        'counts.unstaged': '變更 {n}',
        'counts.untracked': '未追蹤 {n}',
        'counts.conflicted': '衝突 {n}',
        'push.confirm': '將 {branch} 推送到 {upstream}?',
        'push.confirmMany': "將推送 {n} 個分支:{names}。確定?",
        'delete.confirm': '刪除分支 {name}?之後可從提示條撤回(git 仍會拒絕未合併的分支)。',
        'discard.confirm': '丟棄 {path} 的變更?工作區內容會被覆寫 —— 之後可從提示條撤回。',
        'resetHard.confirm': '硬重置到 {hash}?未提交的變更會遺失。',
        'resetSoft.confirm': '將 HEAD 移到 {hash}(保留工作區)?',
        'checkoutCommit.confirm': '簽出提交 {hash}?(detached HEAD)',
      },
      /* locale: zh-mo */
      'zh-mo': {
        'title': 'Git',
        'description': 'IDE 級 Git 面板:分支樹 / 提交圖譜 / 變更',
        'repo.label': '存放庫',
        'repo.workspace': '工作區',
        'repo.nested': '巢狀',
        'repo.none': '呢個工作區唔係 Git 存放庫',
        'repo.pick': '揀一個存放庫嚟睇',
        'repo.empty': '呢個工作區搵唔到 Git 存放庫',
        'repo.switch': '切換存放庫',
        'branch.switch': '切換分支',
        'seg.changes': '變更 {n}',
        'seg.history': '歷史',
        'branches.local': '本地',
        'branches.remote': '遠端',
        'branches.tags': '標籤',
        'branches.head': 'HEAD(當前分支)',
        'branches.favorites': '我的最愛',
        'branches.starHint': "已收藏",
        'branches.pickHint': '單擊選中,雙擊查看提交歷史',
        'branches.headHint': '雙擊查看當前分支的提交歷史',
        'branches.worktree': '已喺另一個工作區簽出',
        'action.stash': '貯藏',
        'action.favorite': '加入/取消我的最愛',
        'action.newTagHere': '喺當前提交新建標籤...',
        'stash.push': '貯藏當前變更',
        'stash.apply': '套用最新貯藏',
        'stash.drop': '丟棄最新貯藏',
        'stash.count': '{n} 個貯藏',
        'note.noChanges': '冇待處理嘅變更',
        'note.noBranches': '冇其他分支',
        'branches.filter': '分支或標籤',
        'changes.title': '變更',
        'changes.staged': '已暫存',
        'changes.unstaged': '變更',
        'changes.untracked': '未追蹤',
        'changes.conflicted': '衝突',
        'changes.empty': '冇待處理嘅變更',
        'changes.commitPlaceholder': '提交訊息(Ctrl+Enter)',
        'changes.commit': '提交',
        'changes.amend': '修訂上次提交',
        'changes.stageAll': '全部暫存',
        'selection.count': '已選 {n} 項',
        'selection.copied': '已複製 {n} 項',
        'selection.copyPaths': '複製路徑',
        'selection.clear': '清除選擇',
        'action.copyName': '複製名稱',
        'menu.copyNamesN': '複製 {n} 個名稱',
        'menu.copyHashesN': '複製 {n} 個雜湊',
        'menu.copyPathsN': '複製 {n} 個路徑',
        'menu.stageN': '暫存 {n} 項',
        'menu.unstageN': '取消暫存 {n} 項',
        'menu.discardN': '還原 {n} 項…',
        'menu.cherryN': 'Cherry-pick {n} 個提交',
        'menu.deleteLocalN': '刪除 {n} 個本地分支…',
        'menu.deleteRemoteN': '刪除 {n} 個遠端分支…',
        'menu.deleteTagsN': '刪除 {n} 個標籤…',
        'confirm.deleteRefs': '刪除所選引用?本地分支 {b} 個、遠端分支 {r} 個、標籤 {g} 個。',
        'confirm.discardMany': '還原 {n} 個檔案的未提交變更?',
        'confirm.discardManyUntracked': '其中 {m} 個未追蹤檔案將被徹底刪除。',
        'toast.branchesDeleted': '已刪除 {n} 個分支',
        'changes.unstageAll': '全部取消暫存',
        'changes.groupBy': '分組方式',
        'changes.groupFlat': '平面清單',
        'changes.groupDir': '按目錄',
        'changes.expandAll': '全部展開',
        'changes.foldAll': '全部收起',
        'changes.showIgnored': '顯示被忽略嘅檔案',
        'changes.rootDir': '(根目錄)',
        'changes.commitAndPush': '提交並推送',
        'action.stage': '暫存',
        'action.unstage': '取消暫存',
        'action.discard': '丟棄變更',
        'action.showDiff': '顯示差異',
        'action.copyPath': '複製路徑',
        'action.checkout': '簽出',
        'action.float': '浮動本頁',
        'action.dock': '收回停靠',
        'action.split': '分欄',
        'action.fullscreen': '全螢幕',
        'action.exitFullscreen': '結束全螢幕',
        'action.newBranchFrom': '由此新建分支...',
        'action.setUpstream': '設定上游…',
        'action.unsetUpstream': '取消上游',
        'action.createLocalBranch': '建立本地分支…',
        'action.newBranchHere': '喺呢度新建分支...',
        'action.rename': '重新命名...',
        'action.delete': '刪除',
        'action.mergeIntoCurrent': '合併到當前分支',
        'action.rebaseCurrentOnto': '將當前分支變基到此',
        'action.compare': '同當前分支比較',
        'action.update': '更新(抓取)',
        'action.push': '推送',
        'action.newTag': '新建標籤...',
        'action.cherryPick': '揀選',
        'action.revert': '還原提交',
        'action.resetSoft': '重置到此(保留變更)',
        'action.resetHard': '重置到此(丟棄變更)',
        'action.copyHash': '複製修訂號',
        'action.details': '提交詳情',
        'menu.sendToChat': '傳送至對話',
        'send.commitText': 'git 提交 {hash}「{subject}」(存放庫 {repo})',
        'send.branchText': 'git 分支 {name}(存放庫 {repo})',
        'menu.sendDiffLinesToChat': '傳送選中行至對話',
        'menu.sendDiffSnippetToChat': '傳送選中片段至對話',
        'menu.copyDiffRef': '複製選中引用',
        'send.diffLinesCommit': '{lines}(提交 {hash}「{subject}」@ {branch})',
        'send.diffLinesWorktree': '{lines}(工作區{state})',
        'send.diffStaged': '已暫存',
        'send.diffUnstaged': '未提交',
        'send.diffNewLines': '第 {lines} 行',
        'send.diffOldLines': '第 {lines} 行(舊行號)',
        'history.empty': '呢個存放庫仲未有提交',
        'history.loadMore': '載入更多',
        'history.filter': '文字或雜湊',
        'detail.files': '變更嘅檔案',
        'detail.pick': '揀一個提交',
        'detail.back': '返回歷史',
        'detail.noFiles': '冇檔案變更',
        'diff.empty': '冇文字差異可以顯示',
        'pane.diff': '差異檢視',
        'pane.resize': '拖動調整{name}尺寸,雙擊復位,方向鍵微調',
        'diff.binary': '二進位檔案',
        'diff.loading': '正在載入差異...',
        'diff.codeLabel': '差異',
        'diff.wrapLabel': '自動換行',
        'diff.unwrapLabel': '依原始欄寬顯示',
        'diff.copy': '複製',
        'diff.copied': '已複製',
        'toolbar.refresh': '重新整理',
      'more.sort': '查看和排序',
      'more.commitGroup': '提交',
      'more.changesGroup': '更改',
      'more.pullpushGroup': '拉取，推送',
      'more.branchGroup': '分支',
      'more.remoteGroup': '遠端',
      'more.stashGroup': '儲存',
      'more.tagGroup': '標籤',
      'more.commitStaged': '提交已暫存檔案...',
      'more.commitAll': '全部提交...',
      'more.undoCommit': '撤銷上次提交',
      'more.rebaseAbort': '中止變基',
      'more.commitStagedAmend': '提交已暫存檔案(修改)...',
      'more.commitAllAmend': '全部提交(修改)...',
      'more.commitStagedSign': '提交已暫存檔案(已簽收)...',
      'more.commitAllSign': '全部提交(已簽收)...',
      'prompt.commitMessage': '提交資訊',
      'more.discardAll': '放棄所有變更...',
      'more.sync': '同步(拉取並推送)',
      'more.syncRebase': '同步(變基並推送)',
      'more.pullRebase': '拉取(變基)',
      'more.pullFrom': '從遠端拉取',
      'more.pushForce': '推送(強制)...',
      'more.pushTo': '推送到遠端',
      'more.fetchAll': '從所有遠端抓取',
      'more.deleteRemoteBranch': '刪除遠端分支...',
      'more.publish': '發布分支...',
      'more.setUpstreamHead': '設定目前分支上游…',
      'more.unsetUpstreamHead': '取消目前分支上游',
      'more.addRemote': '新增遠端...',
      'more.removeRemote': '刪除遠端...',
      'more.stashTracked': '儲存(僅已追蹤)',
      'more.stashStaged': '儲存已暫存檔案',
      'more.stashApplyPick': '套用儲存...',
      'more.stashPopPick': '彈出儲存...',
      'more.stashDropAny': '刪除儲存...',
      'more.stashClear': '刪除全部儲存...',
      'stash.none': '沒有可用的儲存',
      'more.tagDeleteRemote': '刪除遠端標籤...',
      'more.pushTags': '推送標籤...',
      'confirm.undoCommit': '撤銷上次提交?提交的變更會保留在暫存區。',
      'confirm.discardAll': '放棄全部未暫存與未追蹤的變更?可透過復原浮窗恢復(衝突檔案除外)。',
      'confirm.pushForce': '強制推送會以本地分支覆寫遠端(--force-with-lease,他人有新提交時會被拒絕)。繼續?',
      'confirm.deleteRemoteBranch': '刪除遠端 {remote} 上的分支 {branch}?',
      'confirm.remoteRemove': '刪除遠端 {name}?其追蹤設定一併移除。',
      'confirm.stashClear': '刪除全部儲存?此操作不可復原。',
      'confirm.pushTags': '推送全部標籤到 {remote}?',
      'prompt.remoteName': '遠端名稱',
      'prompt.remoteUrl': '遠端 URL',
      'prompt.deleteRemoteTag': '要刪除的遠端標籤(將推送到 {remote})',
      'toolbar.more': '更多操作',
      'more.sortGit': 'Git 順序',
      'more.sortPath': '按路徑',
      'more.sortName': '按名稱',
      'more.sortStatus': '按狀態',
      'more.clone': '複製存放庫...',
      'more.stashPop': '彈出最近貯藏',
      'more.deleteTag': '刪除標籤...',
      'more.gitOutput': '顯示 Git 輸出',
      'clone.title': '複製存放庫',
      'clone.url': '存放庫 URL',
      'clone.dir': '目標目錄(絕對路徑)',
      'clone.run': '複製',
      'prompt.deleteTag': '要刪除的標籤名',
      'gitLog.title': 'Git 輸出',
      'gitLog.empty': '暫無 Git 執行記錄',
        'toolbar.newBranch': '新建分支',
        'toolbar.fetch': '抓取',
        'toolbar.pull': '拉取',
        'toolbar.pullPicked': "拉取選中的 {n} 個分支",
        'toolbar.fetchPicked': "抓取選中的 {n} 個引用",
        'toolbar.pushPicked': "推送選中的 {n} 個分支",
        'toolbar.checkoutPicked': "簽出選中的分支",
        'toolbar.deletePicked': "刪除選中的 {n} 個引用",
        'toolbar.push': '推送',
        'toolbar.tree': '分支面板',
        'rail.more': '更多操作',
        'rail.settings': '動作列設定',
        'rail.openSettings': '開啟外掛設定',
        'settings.card.title': 'Git 工具視窗設定',
        'settings.card.desc': '面板放置、動作列按鈕與 AI 提交訊息',
        'settings.placement.title': '面板放置',
        'settings.placement.tab': '喺主對話區顯示 Git 分頁',
      'settings.composer.title': '輸入框下方分支狀態',
      'settings.composer.hint': '在輸入框下方(工作階段統計左側)顯示目前分支(可點擊切換,並與 Git 面板連動);關閉後不再顯示。',
      'composer.branchHint': '切換分支',
      'composer.detached': 'HEAD(游離)',
      'modelRoute.pick': '選擇模型',
      'modelRoute.trigger': 'AI 提交訊息模型',
      'modelRoute.modelRow': '模型',
      'modelRoute.effortRow': '思考',
      'modelRoute.effortDefault': '跟隨預設',
      'modelRoute.empty': '暫無可用模型',
      'composer.inWorktree': '已經喺其他工作樹簽出',
      'composer.busy': 'Git 操作進行中…',
        'settings.placement.tabHint': '關閉之後仍可從右側欄或底部面板開啟。',
        'settings.placement.immersive': '沉浸模式(佔滿全高,隱藏輸入框)',
        'settings.placement.immersiveHint': '開啟之後 Git 分頁會佔滿整個會話區高度,輸入框自動收起;審批與提問仍會正常顯示。',
        'preview.openFile': '開啟檔案預覽',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': '選擇要查看嘅檔案',
        'lf.split': '切換為左右對比',
        'lf.unified': '切換為單欄對比',
        'lf.wrap': '開啟自動換行',
        'lf.nowrap': '關閉自動換行',
        'lf.created': '新建嘅檔案',
        'lf.removedFile': '刪除嘅檔案',
        'lf.truncated': '只顯示前 {count} 行',
        'preview.title': 'Git 預覽',
        'preview.hint': '喺檔案或提交撳「顯示差異」,差異就會喺側邊欄度開啟。',
        'preview.boundary': '預覽渲染出錯——請重新載入頁面,或者回報呢個問題。',
        'settings.rail.title': '動作列',
        'settings.rail.hint': '勾選要顯示在動作列上的動作;順序固定,取消勾選即隱藏。',
        'settings.rail.unavailable': '目前宿主沒有設定服務,請用面板內的「動作條設定」。',
        'settings.commit.title': 'AI 提交訊息',
        'settings.commit.model': '使用的模型',
        'settings.commit.modelHint': '留空 = 跟隨目前工作階段(provider/model)',
        'settings.commit.modelFollow': '跟隨目前工作階段',
        'settings.commit.reasoning': '思考強度',
        'settings.commit.reasoningHint': '留空 = 不思考',
        'settings.commit.reasoningDefault': '不思考(預設)',
        'settings.commit.reasoningFollowHint': '跟隨工作階段時固定不思考;選擇固定模型後可再選思考強度',
        'settings.commit.prompt': '補充提示詞',
        'settings.commit.promptHint': '例如:用 Conventional Commits,subject 用中文,不超過 72 字元',
        'settings.commit.tooLong': '超過 {n} 個字元的部分不會儲存',
        'changes.aiWrite': 'AI 寫提交訊息',
        'changes.aiBusy': '正在生成…',
        'changes.aiQuota': '會消耗你的額度',
        'changes.aiOverwriteTitle': '覆蓋目前的草稿?',
        'changes.aiOverwriteText': 'AI 生成的內容會取代你已輸入的提交訊息(可以復原)。',
        'changes.aiUndo': '復原,還原我的草稿',
        'changes.aiFailed': '生成失敗:',
        'changes.aiNotice': '部分變更沒有傳給模型(已截斷或捨棄),訊息可能不完整。',
        'settings.rail.writeFailed': '設定沒有寫入,已退回原狀態;請重試。',
        'settings.rail.readonly': '目前宿主將設定設為唯讀,開關無法修改。',
        'rail.settingsHint': '拖曳或用箭嘴排序;眼睛圖示切換顯示',
        'rail.reset': '還原預設',
        'rail.up': '上移',
        'rail.down': '下移',
        'rail.show': '顯示',
        'rail.hide': '隱藏',
        'action.unavailable': '當前狀態下唔可用',
        'filter.branch': '分支',
        'filter.user': '提交者',
        'history.me': '我',
        'filter.date': '日期',
        'filter.path': '路徑',
        'filter.all': '全部',
        'filter.today': '今日',
        'filter.week': '近 7 日',
        'filter.month': '近 30 日',
        'filter.year': '今年',
        'filter.pathPlaceholder': '按路徑篩選(Enter)',
        'filter.sortDesc': '新到舊',
        'filter.sortAsc': '舊到新',
        'filter.clear': '清除篩選',
        'filter.none': '冇符合嘅提交',
        'toast.undo': '撤回',
        'toast.close': '關閉',
        'toast.branchDeleted': '已刪除分支 {name}',
        'toast.stashDropped': '已丟棄貯藏 {ref}',
        'toast.discarded': '已丟棄 {path} 嘅變更',
        'toast.discardNoUndo': '已丟棄 {path} 嘅變更(太大,冇保留撤回)',
        'toast.restored': '已還原',
        'toast.sentToChat': '已傳送至對話框',
        'toast.sendCopied': '無法傳送,已複製到剪貼簿',
        'undo.menu': '最近刪除(撤回)',
        'undo.empty': '暫時冇嘢可以撤回',
        'undo.branch': '分支',
        'undo.stash': '貯藏',
        'undo.discard': '丟棄',
        'confirm.typeName': '輸入 {name} 以確認',
        'confirm.protected': '{name} 係主分支。刪除風險好高,請輸入分支名確認 —— 之後仍然可以喺提示條撤回。',
        'discard.untracked.confirm': '刪除未追蹤檔案 {path}?內容會被移除 —— 之後可以喺提示條撤回。',
        'stashDrop.confirm': '丟棄貯藏 {ref}?之後可以喺提示條撤回。',
        'operation.merge': '合併進行中',
        'operation.rebase': '變基進行中',
        'operation.cherry-pick': '揀選進行中',
        'operation.revert': '還原進行中',
        'operation.bisect': 'Bisect 進行中',
        'operation.hint': '呢個存放庫仲有未完成嘅多步操作 —— 請先完成或中止,再進行分支層級嘅操作',
        'confirm.title': '確認',
        'confirm.cancel': '取消',
        'confirm.ok': '確定',
        'prompt.newBranch': '新分支名(建立並簽出)',
        'prompt.createTracking': '從遠端分支建立本地分支',
        'prompt.renameBranch': '重新命名分支',
        'prompt.newTag': '新標籤名',
        'prompt.fromHead': '當前 HEAD',
        'error.dismiss': '關閉',
        'status.loading': '讀取中...',
        'status.busy': '處理中...',
        'counts.staged': '已暫存 {n}',
        'counts.ignored': '已忽略 {n}',
        'counts.unstaged': '變更 {n}',
        'counts.untracked': '未追蹤 {n}',
        'counts.conflicted': '衝突 {n}',
        'push.confirm': '將 {branch} 推送到 {upstream}?',
        'push.confirmMany': "將推送 {n} 個分支:{names}。確定?",
        'delete.confirm': '刪除分支 {name}?之後可以喺提示條撤回(git 仍然會拒絕未合併嘅分支)。',
        'discard.confirm': '丟棄 {path} 嘅變更?工作區內容會被覆寫 —— 之後可以喺提示條撤回。',
        'resetHard.confirm': '硬重置到 {hash}?未提交嘅變更會遺失。',
        'resetSoft.confirm': '將 HEAD 移到 {hash}(保留工作區)?',
        'checkoutCommit.confirm': '簽出提交 {hash}?(detached HEAD)',
      },
      /* locale: ja */
      'ja': {
        'title': 'Git',
        'description': 'IDE 級の Git パネル:ブランチツリー / コミットグラフ / 変更',
        'repo.label': 'リポジトリ',
        'repo.workspace': 'ワークスペース',
        'repo.nested': 'ネスト',
        'repo.none': 'このワークスペースは Git リポジトリではありません',
        'repo.pick': '確認するリポジトリを選択',
        'repo.empty': 'このワークスペースに Git リポジトリが見つかりません',
        'repo.switch': 'リポジトリを切り替え',
        'branch.switch': 'ブランチを切り替え',
        'seg.changes': '変更 {n}',
        'seg.history': '履歴',
        'branches.local': 'ローカル',
        'branches.remote': 'リモート',
        'branches.tags': 'タグ',
        'branches.head': 'HEAD(現在のブランチ)',
        'branches.favorites': 'お気に入り',
        'branches.starHint': "お気に入り済み",
        'branches.pickHint': 'クリックで選択、ダブルクリックで履歴を表示',
        'branches.headHint': 'ダブルクリックで現在のブランチの履歴を表示',
        'branches.worktree': '別のワークツリーでチェックアウト済み',
        'action.stash': 'スタッシュ',
        'action.favorite': '現在のブランチをお気に入りに追加/解除',
        'action.newTagHere': '現在のコミットにタグを作成...',
        'stash.push': '現在の変更をスタッシュ',
        'stash.apply': '最新のスタッシュを適用',
        'stash.drop': '最新のスタッシュを削除',
        'stash.count': 'スタッシュ {n} 件',
        'note.noChanges': '保留中の変更はありません',
        'note.noBranches': '他のブランチはありません',
        'branches.filter': 'ブランチまたはタグ',
        'changes.title': '変更',
        'changes.staged': 'ステージ済み',
        'changes.unstaged': '変更',
        'changes.untracked': '未追跡',
        'changes.conflicted': '競合',
        'changes.empty': '保留中の変更はありません',
        'changes.commitPlaceholder': 'コミットメッセージ(Ctrl+Enter)',
        'changes.commit': 'コミット',
        'changes.amend': '前回のコミットを修正',
        'changes.stageAll': 'すべてステージ',
        'selection.count': '{n} 件を選択中',
        'selection.copied': '{n} 件をコピーしました',
        'selection.copyPaths': 'パスをコピー',
        'selection.clear': '選択を解除',
        'action.copyName': '名前をコピー',
        'menu.copyNamesN': '{n} 件の名前をコピー',
        'menu.copyHashesN': '{n} 件のハッシュをコピー',
        'menu.copyPathsN': '{n} 件のパスをコピー',
        'menu.stageN': '{n} 件をステージ',
        'menu.unstageN': '{n} 件のステージ解除',
        'menu.discardN': '{n} 件を破棄…',
        'menu.cherryN': 'コミット {n} 件をチェリーピック',
        'menu.deleteLocalN': 'ローカルブランチ {n} 件を削除…',
        'menu.deleteRemoteN': 'リモートブランチ {n} 件を削除…',
        'menu.deleteTagsN': 'タグ {n} 件を削除…',
        'confirm.deleteRefs': '選択した参照を削除しますか?ローカル {b} 件、リモート {r} 件、タグ {g} 件。',
        'confirm.discardMany': '{n} 件の未コミット変更を破棄しますか?',
        'confirm.discardManyUntracked': 'うち {m} 件の未追跡ファイルは完全に削除されます。',
        'toast.branchesDeleted': '{n} 件のブランチを削除しました',
        'changes.unstageAll': 'すべてステージ解除',
        'changes.groupBy': 'グループ化',
        'changes.groupFlat': 'フラット表示',
        'changes.groupDir': 'ディレクトリ別',
        'changes.expandAll': 'すべて展開',
        'changes.foldAll': 'すべて折りたたむ',
        'changes.showIgnored': '無視されたファイルを表示',
        'changes.rootDir': '(ルート)',
        'changes.commitAndPush': 'コミットしてプッシュ',
        'action.stage': 'ステージ',
        'action.unstage': 'ステージ解除',
        'action.discard': '変更を破棄',
        'action.showDiff': '差分を表示',
        'action.copyPath': 'パスをコピー',
        'action.checkout': 'チェックアウト',
        'action.float': 'このページを浮動表示',
        'action.dock': 'ドックに戻す',
        'action.split': '分割',
        'action.fullscreen': '全画面',
        'action.exitFullscreen': '全画面を終了',
        'action.newBranchFrom': 'ここから新しいブランチ...',
        'action.setUpstream': '上流を設定…',
        'action.unsetUpstream': '上流を解除',
        'action.createLocalBranch': 'ローカルブランチを作成…',
        'action.newBranchHere': 'ここに新しいブランチ...',
        'action.rename': '名前を変更...',
        'action.delete': '削除',
        'action.mergeIntoCurrent': '現在のブランチにマージ',
        'action.rebaseCurrentOnto': '現在のブランチをここにリベース',
        'action.compare': '現在のブランチと比較',
        'action.update': '更新(フェッチ)',
        'action.push': 'プッシュ',
        'action.newTag': '新しいタグ...',
        'action.cherryPick': 'チェリーピック',
        'action.revert': 'コミットを打ち消す',
        'action.resetSoft': 'ここにリセット(変更を保持)',
        'action.resetHard': 'ここにリセット(変更を破棄)',
        'action.copyHash': 'リビジョン番号をコピー',
        'action.details': 'コミットの詳細',
        'menu.sendToChat': 'チャットへ送る',
        'send.commitText': 'git コミット {hash}「{subject}」(リポジトリ {repo})',
        'send.branchText': 'git ブランチ {name}(リポジトリ {repo})',
        'menu.sendDiffLinesToChat': '選択した行をチャットへ送る',
        'menu.sendDiffSnippetToChat': '選択した範囲をチャットへ送る',
        'menu.copyDiffRef': '選択範囲の参照をコピー',
        'send.diffLinesCommit': '{lines}(コミット {hash}「{subject}」@ {branch})',
        'send.diffLinesWorktree': '{lines}(作業ツリー、{state})',
        'send.diffStaged': 'ステージ済み',
        'send.diffUnstaged': '未コミット',
        'send.diffNewLines': '{lines} 行目',
        'send.diffOldLines': '{lines} 行目(旧番号)',
        'history.empty': 'このリポジトリにはまだコミットがありません',
        'history.loadMore': 'さらに読み込む',
        'history.filter': 'テキストまたはハッシュ',
        'detail.files': '変更されたファイル',
        'detail.pick': 'コミットを選択',
        'detail.back': '履歴に戻る',
        'detail.noFiles': 'ファイルの変更はありません',
        'diff.empty': '表示できるテキスト差分がありません',
        'pane.diff': '差分ビュー',
        'pane.resize': '{name}のサイズをドラッグで調整(ダブルクリックでリセット、矢印キーで微調整)',
        'diff.binary': 'バイナリファイル',
        'diff.loading': '差分を読み込み中...',
        'diff.codeLabel': '差分',
        'diff.wrapLabel': '折り返し',
        'diff.unwrapLabel': 'ソースの列幅を維持',
        'diff.copy': 'コピー',
        'diff.copied': 'コピーしました',
        'toolbar.refresh': '更新',
      'more.sort': '表示と並べ替え',
      'more.commitGroup': 'コミット',
      'more.changesGroup': '変更',
      'more.pullpushGroup': 'プル,プッシュ',
      'more.branchGroup': 'ブランチ',
      'more.remoteGroup': 'リモート',
      'more.stashGroup': 'スタッシュ',
      'more.tagGroup': 'タグ',
      'more.commitStaged': 'ステージ済みをコミット...',
      'more.commitAll': 'すべてコミット...',
      'more.undoCommit': '最後のコミットを取り消す',
      'more.rebaseAbort': 'リベースを中止',
      'more.commitStagedAmend': 'ステージ済みをコミット(修正)...',
      'more.commitAllAmend': 'すべてコミット(修正)...',
      'more.commitStagedSign': 'ステージ済みをコミット(署名)...',
      'more.commitAllSign': 'すべてコミット(署名)...',
      'prompt.commitMessage': 'コミットメッセージ',
      'more.discardAll': 'すべての変更を破棄...',
      'more.sync': '同期(プルしてプッシュ)',
      'more.syncRebase': '同期(リベースしてプッシュ)',
      'more.pullRebase': 'プル(リベース)',
      'more.pullFrom': 'リモートからプル',
      'more.pushForce': '強制プッシュ...',
      'more.pushTo': 'リモートへプッシュ',
      'more.fetchAll': '全リモートからフェッチ',
      'more.deleteRemoteBranch': 'リモートブランチを削除...',
      'more.publish': 'ブランチを公開...',
      'more.setUpstreamHead': '現在のブランチの上流を設定…',
      'more.unsetUpstreamHead': '現在のブランチの上流を解除',
      'more.addRemote': 'リモートを追加...',
      'more.removeRemote': 'リモートを削除...',
      'more.stashTracked': 'スタッシュ(追跡済みのみ)',
      'more.stashStaged': 'ステージ済みをスタッシュ',
      'more.stashApplyPick': 'スタッシュを適用...',
      'more.stashPopPick': 'スタッシュをポップ...',
      'more.stashDropAny': 'スタッシュを削除...',
      'more.stashClear': 'すべてのスタッシュを削除...',
      'stash.none': '利用可能なスタッシュはありません',
      'more.tagDeleteRemote': 'リモートタグを削除...',
      'more.pushTags': 'タグをプッシュ...',
      'confirm.undoCommit': '最後のコミットを取り消しますか?変更はステージに残ります。',
      'confirm.discardAll': 'ステージ外と未追跡のすべての変更を破棄しますか?元に戻すトーストで復元できます(競合ファイルを除く)。',
      'confirm.pushForce': '強制プッシュはリモートをこのブランチで上書きします(--force-with-lease により他者の更新時は拒否)。続行しますか?',
      'confirm.deleteRemoteBranch': '{remote} のブランチ {branch} を削除しますか?',
      'confirm.remoteRemove': 'リモート {name} を削除しますか?追跡設定も削除されます。',
      'confirm.stashClear': 'すべてのスタッシュを削除しますか?この操作は元に戻せません。',
      'confirm.pushTags': 'すべてのタグを {remote} にプッシュしますか?',
      'prompt.remoteName': 'リモート名',
      'prompt.remoteUrl': 'リモート URL',
      'prompt.deleteRemoteTag': '削除するリモートタグ({remote} にプッシュ)',
      'toolbar.more': 'その他の操作',
      'more.sortGit': 'Git の順序',
      'more.sortPath': 'パス順',
      'more.sortName': '名前順',
      'more.sortStatus': '状態順',
      'more.clone': 'リポジトリを複製...',
      'more.stashPop': '最新のスタッシュをポップ',
      'more.deleteTag': 'タグを削除...',
      'more.gitOutput': 'Git 出力を表示',
      'clone.title': 'リポジトリを複製',
      'clone.url': 'リポジトリ URL',
      'clone.dir': '複製先ディレクトリ(絶対パス)',
      'clone.run': '複製',
      'prompt.deleteTag': '削除するタグ名',
      'gitLog.title': 'Git 出力',
      'gitLog.empty': 'Git 実行履歴はまだありません',
        'toolbar.newBranch': '新しいブランチ',
        'toolbar.fetch': 'フェッチ',
        'toolbar.pull': 'プル',
        'toolbar.pullPicked': "選択した {n} 個のブランチをプル",
        'toolbar.fetchPicked': "選択した {n} 個の参照をフェッチ",
        'toolbar.pushPicked': "選択した {n} 個のブランチをプッシュ",
        'toolbar.checkoutPicked': "選択したブランチをチェックアウト",
        'toolbar.deletePicked': "選択した {n} 個の参照を削除",
        'toolbar.push': 'プッシュ',
        'toolbar.tree': 'ブランチペイン',
        'rail.more': 'その他の操作',
        'rail.settings': 'アクションバーの設定',
        'rail.openSettings': 'プラグイン設定を開く',
        'settings.card.title': 'Gitツールウィンドウの設定',
        'settings.card.desc': 'パネル配置、アクションレールのボタンと AI コミットメッセージ',
        'settings.placement.title': 'パネル配置',
        'settings.placement.tab': '会話エリアに Git タブを表示',
      'settings.composer.title': '入力欄下のブランチ',
      'settings.composer.hint': '入力欄の下(セッション統計の左)に現在のブランチを表示します(クリックで切り替え、Git パネルと連動)。オフにすると表示されません。',
      'composer.branchHint': 'ブランチを切り替え',
      'composer.detached': 'HEAD(切断)',
      'modelRoute.pick': 'モデルを選択',
      'modelRoute.trigger': 'AI コミットメッセージのモデル',
      'modelRoute.modelRow': 'モデル',
      'modelRoute.effortRow': '思考',
      'modelRoute.effortDefault': 'デフォルトに従う',
      'modelRoute.empty': '利用可能なモデルがありません',
      'composer.inWorktree': '別のワークツリーでチェックアウト中',
      'composer.busy': 'Git 操作を実行中…',
        'settings.placement.tabHint': 'オフにしても右サイドバーと下部パネルから開けます。',
        'settings.placement.immersive': '没入モード(全高表示・入力欄を非表示)',
        'settings.placement.immersiveHint': 'オンにすると Git タブが会話エリアの高さいっぱいに広がり、入力欄は引っ込みます。承認や質問は通常どおり表示されます。',
        'preview.openFile': 'ファイルプレビューを開く',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'レビューするファイルを選択',
        'lf.split': '左右分割に切り替える',
        'lf.unified': '単欄に切り替える',
        'lf.wrap': '自動折り返しをオンにする',
        'lf.nowrap': '自動折り返しをオフにする',
        'lf.created': '新規作成されたファイル',
        'lf.removedFile': '削除されたファイル',
        'lf.truncated': '先頭 {count} 行のみ表示',
        'preview.title': 'Git プレビュー',
        'preview.hint': 'ファイルやコミットの「差分を表示」をクリックすると、差分がここに開きます。',
        'preview.boundary': 'プレビューの描画に失敗しました——ページを再読み込みするか、問題を報告してください。',
        'settings.rail.title': 'レール',
        'settings.rail.hint': 'レールに表示する操作にチェックを入れてください。順序は固定で、チェックを外すと非表示になります。',
        'settings.rail.unavailable': 'このホストには設定サービスがないため、パネル内の「アクションレール設定」を使ってください。',
        'settings.commit.title': 'AI コミットメッセージ',
        'settings.commit.model': '使用するモデル',
        'settings.commit.modelHint': '空欄 = 現在のセッションに従う(provider/model)',
        'settings.commit.modelFollow': '現在のセッションに従う',
        'settings.commit.reasoning': '思考の強度',
        'settings.commit.reasoningHint': '空欄 = 思考なし',
        'settings.commit.reasoningDefault': '思考なし(既定)',
        'settings.commit.reasoningFollowHint': 'セッション追従では常に思考なし。固定モデルを選ぶと強度を選べます',
        'settings.commit.prompt': '追加の指示',
        'settings.commit.promptHint': '例:Conventional Commits、subject は日本語、72 文字以内',
        'settings.commit.tooLong': '{n} 文字を超える部分は保存されません',
        'changes.aiWrite': 'AI で書く',
        'changes.aiBusy': '生成中…',
        'changes.aiQuota': 'あなたの利用枠を消費します',
        'changes.aiOverwriteTitle': '現在の下書きを置き換えますか?',
        'changes.aiOverwriteText': 'AI の文章が入力済みのコミットメッセージを置き換えます(元に戻せます)。',
        'changes.aiUndo': '元に戻す',
        'changes.aiFailed': '生成できませんでした:',
        'changes.aiNotice': '一部の変更はモデルに送られていません(切り詰めまたは除外)。内容が不完全な可能性があります。',
        'settings.rail.writeFailed': '設定を保存できませんでした。元の状態に戻しました。もう一度お試しください。',
        'settings.rail.readonly': 'このホストは設定を読み取り専用で提供しています。',
        'rail.settingsHint': 'ドラッグまたは矢印で並べ替え、目のアイコンで表示を切り替え',
        'rail.reset': '既定に戻す',
        'rail.up': '上へ',
        'rail.down': '下へ',
        'rail.show': '表示',
        'rail.hide': '非表示',
        'action.unavailable': '現在の状態では使用できません',
        'filter.branch': 'ブランチ',
        'filter.user': 'コミット者',
        'history.me': '自分',
        'filter.date': '日付',
        'filter.path': 'パス',
        'filter.all': 'すべて',
        'filter.today': '今日',
        'filter.week': '過去 7 日',
        'filter.month': '過去 30 日',
        'filter.year': '今年',
        'filter.pathPlaceholder': 'パスで絞り込み(Enter)',
        'filter.sortDesc': '新しい順',
        'filter.sortAsc': '古い順',
        'filter.clear': '絞り込みを解除',
        'filter.none': '一致するコミットがありません',
        'toast.undo': '元に戻す',
        'toast.close': '閉じる',
        'toast.branchDeleted': 'ブランチ {name} を削除しました',
        'toast.stashDropped': 'スタッシュ {ref} を削除しました',
        'toast.discarded': '{path} の変更を破棄しました',
        'toast.discardNoUndo': '{path} の変更を破棄しました(大きすぎるため取り消しは保持していません)',
        'toast.restored': '復元しました',
        'toast.sentToChat': '入力欄に送りました',
        'toast.sendCopied': '送信できなかったためクリップボードにコピーしました',
        'undo.menu': '最近の削除(元に戻す)',
        'undo.empty': '今すぐ元に戻せるものはありません',
        'undo.branch': 'ブランチ',
        'undo.stash': 'スタッシュ',
        'undo.discard': '破棄',
        'confirm.typeName': '確認のため {name} と入力してください',
        'confirm.protected': '{name} はメインブランチです。削除はリスクが高いため、ブランチ名を入力して確認してください —— その後もトーストから復元できます。',
        'discard.untracked.confirm': '未追跡ファイル {path} を削除しますか?内容は削除されます —— その後トーストから復元できます。',
        'stashDrop.confirm': 'スタッシュ {ref} を削除しますか?その後トーストから復元できます。',
        'operation.merge': 'マージ中',
        'operation.rebase': 'リベース中',
        'operation.cherry-pick': 'チェリーピック中',
        'operation.revert': '打ち消し中',
        'operation.bisect': 'bisect 中',
        'operation.hint': 'このリポジトリには未完了の多段階操作があります —— ブランチ操作の前に完了または中止してください',
        'confirm.title': '確認',
        'confirm.cancel': 'キャンセル',
        'confirm.ok': 'OK',
        'prompt.newBranch': '新しいブランチ名(作成してチェックアウト)',
        'prompt.createTracking': 'リモートブランチからローカルブランチを作成',
        'prompt.renameBranch': 'ブランチ名を変更',
        'prompt.newTag': '新しいタグ名',
        'prompt.fromHead': '現在の HEAD',
        'error.dismiss': '閉じる',
        'status.loading': '読み込み中...',
        'status.busy': '処理中...',
        'counts.staged': 'ステージ済み {n}',
        'counts.ignored': '無視 {n}',
        'counts.unstaged': '変更 {n}',
        'counts.untracked': '未追跡 {n}',
        'counts.conflicted': '競合 {n}',
        'push.confirm': '{branch} を {upstream} にプッシュしますか?',
        'push.confirmMany': "{n} 個のブランチをプッシュします:{names}。よろしいですか?",
        'delete.confirm': 'ブランチ {name} を削除しますか?その後トーストから復元できます(git は未マージのブランチを引き続き拒否します)。',
        'discard.confirm': '{path} の変更を破棄しますか?ワークツリーの内容が上書きされます —— その後トーストから復元できます。',
        'resetHard.confirm': '{hash} にハードリセットしますか?未コミットの変更は失われます。',
        'resetSoft.confirm': 'HEAD を {hash} に移動しますか(ワークツリーは保持)?',
        'checkoutCommit.confirm': 'コミット {hash} をチェックアウトしますか?(detached HEAD)',
      },
      /* locale: ko */
      'ko': {
        'title': 'Git',
        'description': 'IDE 급 Git 패널: 브랜치 트리 / 커밋 그래프 / 변경',
        'repo.label': '저장소',
        'repo.workspace': '워크스페이스',
        'repo.nested': '중첩',
        'repo.none': '이 워크스페이스는 Git 저장소가 아닙니다',
        'repo.pick': '확인할 저장소를 선택하세요',
        'repo.empty': '이 워크스페이스에서 Git 저장소를 찾을 수 없습니다',
        'repo.switch': '저장소 전환',
        'branch.switch': '브랜치 전환',
        'seg.changes': '변경 {n}',
        'seg.history': '기록',
        'branches.local': '로컬',
        'branches.remote': '원격',
        'branches.tags': '태그',
        'branches.head': 'HEAD(현재 브랜치)',
        'branches.favorites': '즐겨찾기',
        'branches.starHint': "즐겨찾기",
        'branches.pickHint': '클릭하여 선택, 더블클릭으로 커밋 히스토리 보기',
        'branches.headHint': '더블클릭으로 현재 브랜치의 히스토리 보기',
        'branches.worktree': '다른 워크트리에서 체크아웃됨',
        'action.stash': '스태시',
        'action.favorite': '현재 브랜치 즐겨찾기 추가/해제',
        'action.newTagHere': '현재 커밋에 태그 만들기...',
        'stash.push': '현재 변경 사항 스태시',
        'stash.apply': '최신 스태시 적용',
        'stash.drop': '최신 스태시 삭제',
        'stash.count': '스태시 {n}개',
        'note.noChanges': '보류 중인 변경 사항이 없습니다',
        'note.noBranches': '다른 브랜치가 없습니다',
        'branches.filter': '브랜치 또는 태그',
        'changes.title': '변경',
        'changes.staged': '스테이지됨',
        'changes.unstaged': '변경',
        'changes.untracked': '추적되지 않음',
        'changes.conflicted': '충돌',
        'changes.empty': '보류 중인 변경 사항이 없습니다',
        'changes.commitPlaceholder': '커밋 메시지(Ctrl+Enter)',
        'changes.commit': '커밋',
        'changes.amend': '이전 커밋 수정',
        'changes.stageAll': '모두 스테이지',
        'selection.count': '{n}개 선택됨',
        'selection.copied': '{n}개 복사됨',
        'selection.copyPaths': '경로 복사',
        'selection.clear': '선택 해제',
        'action.copyName': '이름 복사',
        'menu.copyNamesN': '이름 {n}개 복사',
        'menu.copyHashesN': '해시 {n}개 복사',
        'menu.copyPathsN': '경로 {n}개 복사',
        'menu.stageN': '{n}개 스테이지',
        'menu.unstageN': '{n}개 스테이지 해제',
        'menu.discardN': '{n}개 되돌리기…',
        'menu.cherryN': '커밋 {n}개 체리픽',
        'menu.deleteLocalN': '로컬 브랜치 {n}개 삭제…',
        'menu.deleteRemoteN': '원격 브랜치 {n}개 삭제…',
        'menu.deleteTagsN': '태그 {n}개 삭제…',
        'confirm.deleteRefs': '선택한 레퍼런스를 삭제할까요? 로컬 {b}개, 원격 {r}개, 태그 {g}개.',
        'confirm.discardMany': '{n}개 파일의 커밋되지 않은 변경을 되돌릴까요?',
        'confirm.discardManyUntracked': '이 중 추적되지 않는 {m}개 파일은 완전히 삭제됩니다.',
        'toast.branchesDeleted': '브랜치 {n}개 삭제됨',
        'changes.unstageAll': '모두 스테이지 해제',
        'changes.groupBy': '그룹 기준',
        'changes.groupFlat': '평면 목록',
        'changes.groupDir': '디렉터리별',
        'changes.expandAll': '모두 펼치기',
        'changes.foldAll': '모두 접기',
        'changes.showIgnored': '무시된 파일 표시',
        'changes.rootDir': '(루트)',
        'changes.commitAndPush': '커밋 후 푸시',
        'action.stage': '스테이지',
        'action.unstage': '스테이지 해제',
        'action.discard': '변경 사항 버리기',
        'action.showDiff': '차이 보기',
        'action.copyPath': '경로 복사',
        'action.checkout': '체크아웃',
        'action.float': '이 페이지 띄우기',
        'action.dock': '도킹으로 복귀',
        'action.split': '분할',
        'action.fullscreen': '전체 화면',
        'action.exitFullscreen': '전체 화면 종료',
        'action.newBranchFrom': '여기서 새 브랜치...',
        'action.setUpstream': '업스트림 설정…',
        'action.unsetUpstream': '업스트림 해제',
        'action.createLocalBranch': '로컬 브랜치 만들기…',
        'action.newBranchHere': '여기에 새 브랜치...',
        'action.rename': '이름 바꾸기...',
        'action.delete': '삭제',
        'action.mergeIntoCurrent': '현재 브랜치로 병합',
        'action.rebaseCurrentOnto': '현재 브랜치를 여기로 리베이스',
        'action.compare': '현재 브랜치와 비교',
        'action.update': '업데이트(페치)',
        'action.push': '푸시',
        'action.newTag': '새 태그...',
        'action.cherryPick': '체리픽',
        'action.revert': '커밋 되돌리기',
        'action.resetSoft': '여기로 리셋(변경 유지)',
        'action.resetHard': '여기로 리셋(변경 버림)',
        'action.copyHash': '리비전 번호 복사',
        'action.details': '커밋 상세',
        'menu.sendToChat': '대화로 보내기',
        'send.commitText': 'git 커밋 {hash} "{subject}" (저장소 {repo})',
        'send.branchText': 'git 브랜치 {name} (저장소 {repo})',
        'menu.sendDiffLinesToChat': '선택한 줄 대화로 보내기',
        'menu.sendDiffSnippetToChat': '선택한 조각 대화로 보내기',
        'menu.copyDiffRef': '선택 범위 참조 복사',
        'send.diffLinesCommit': '{lines}(커밋 {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines}(작업 트리, {state})',
        'send.diffStaged': '스테이징됨',
        'send.diffUnstaged': '커밋되지 않음',
        'send.diffNewLines': '{lines}행',
        'send.diffOldLines': '{lines}행(이전 번호)',
        'history.empty': '이 저장소에는 아직 커밋이 없습니다',
        'history.loadMore': '더 불러오기',
        'history.filter': '텍스트 또는 해시',
        'detail.files': '변경된 파일',
        'detail.pick': '커밋을 선택하세요',
        'detail.back': '기록으로 돌아가기',
        'detail.noFiles': '파일 변경 없음',
        'diff.empty': '표시할 텍스트 차이가 없습니다',
        'pane.diff': '차이 보기',
        'pane.resize': '{name} 크기를 드래그해 조절(더블클릭 초기화, 화살표 키 미세 조정)',
        'diff.binary': '바이너리 파일',
        'diff.loading': '차이 불러오는 중...',
        'diff.codeLabel': '차이',
        'diff.wrapLabel': '줄 바꿈',
        'diff.unwrapLabel': '원본 열 너비 유지',
        'diff.copy': '복사',
        'diff.copied': '복사됨',
        'toolbar.refresh': '새로 고침',
      'more.sort': '보기 및 정렬',
      'more.commitGroup': '커밋',
      'more.changesGroup': '변경',
      'more.pullpushGroup': '풀, 푸시',
      'more.branchGroup': '브랜치',
      'more.remoteGroup': '원격',
      'more.stashGroup': '스태시',
      'more.tagGroup': '태그',
      'more.commitStaged': '스테이지된 파일 커밋...',
      'more.commitAll': '모두 커밋...',
      'more.undoCommit': '마지막 커밋 취소',
      'more.rebaseAbort': '리베이스 중단',
      'more.commitStagedAmend': '스테이지된 파일 커밋(수정)...',
      'more.commitAllAmend': '모두 커밋(수정)...',
      'more.commitStagedSign': '스테이지된 파일 커밋(서명)...',
      'more.commitAllSign': '모두 커밋(서명)...',
      'prompt.commitMessage': '커밋 메시지',
      'more.discardAll': '모든 변경 내용 취소...',
      'more.sync': '동기화(풀 후 푸시)',
      'more.syncRebase': '동기화(리베이스 후 푸시)',
      'more.pullRebase': '풀(리베이스)',
      'more.pullFrom': '원격에서 풀',
      'more.pushForce': '강제 푸시...',
      'more.pushTo': '원격으로 푸시',
      'more.fetchAll': '모든 원격에서 페치',
      'more.deleteRemoteBranch': '원격 브랜치 삭제...',
      'more.publish': '브랜치 게시...',
      'more.setUpstreamHead': '현재 브랜치 업스트림 설정…',
      'more.unsetUpstreamHead': '현재 브랜치 업스트림 해제',
      'more.addRemote': '원격 추가...',
      'more.removeRemote': '원격 제거...',
      'more.stashTracked': '스태시(추적된 파일만)',
      'more.stashStaged': '스테이지된 파일 스태시',
      'more.stashApplyPick': '스태시 적용...',
      'more.stashPopPick': '스태시 팝...',
      'more.stashDropAny': '스태시 삭제...',
      'more.stashClear': '모든 스태시 삭제...',
      'stash.none': '사용 가능한 스태시가 없습니다',
      'more.tagDeleteRemote': '원격 태그 삭제...',
      'more.pushTags': '태그 푸시...',
      'confirm.undoCommit': '마지막 커밋을 취소할까요?변경 사항은 스테이지에 유지됩니다.',
      'confirm.discardAll': '스테이지되지 않은 모든 변경과 추적되지 않는 파일을 취소할까요?실행 취소 토스트로 복구할 수 있습니다(충돌 파일 제외).',
      'confirm.pushForce': '강제 푸시는 원격을 이 브랜치로 덮어씁니다(--force-with-lease, 다른 사람이 푸시했으면 거부됨).계속할까요?',
      'confirm.deleteRemoteBranch': '{remote}의 브랜치 {branch}를 삭제할까요?',
      'confirm.remoteRemove': '원격 {name}을(를) 제거할까요?추적 설정도 함께 제거됩니다.',
      'confirm.stashClear': '모든 스태시를 삭제할까요?이 작업은 되돌릴 수 없습니다.',
      'confirm.pushTags': '모든 태그를 {remote}에 푸시할까요?',
      'prompt.remoteName': '원격 이름',
      'prompt.remoteUrl': '원격 URL',
      'prompt.deleteRemoteTag': '삭제할 원격 태그({remote}로 푸시됨)',
      'toolbar.more': '더 보기',
      'more.sortGit': 'Git 순서',
      'more.sortPath': '경로순',
      'more.sortName': '이름순',
      'more.sortStatus': '상태순',
      'more.clone': '복제...',
      'more.stashPop': '최신 스태시 팝',
      'more.deleteTag': '태그 삭제...',
      'more.gitOutput': 'Git 출력 표시',
      'clone.title': '리포지토리 복제',
      'clone.url': '리포지토리 URL',
      'clone.dir': '대상 디렉터리(절대 경로)',
      'clone.run': '복제',
      'prompt.deleteTag': '삭제할 태그 이름',
      'gitLog.title': 'Git 출력',
      'gitLog.empty': '아직 Git 실행 기록이 없습니다',
        'toolbar.newBranch': '새 브랜치',
        'toolbar.fetch': '페치',
        'toolbar.pull': '풀',
        'toolbar.pullPicked': "선택한 {n}개 브랜치 가져오기",
        'toolbar.fetchPicked': "선택한 {n}개 레퍼런스 페치",
        'toolbar.pushPicked': "선택한 {n}개 브랜치 푸시",
        'toolbar.checkoutPicked': "선택한 브랜치 체크아웃",
        'toolbar.deletePicked': "선택한 {n}개 레퍼런스 삭제",
        'toolbar.push': '푸시',
        'toolbar.tree': '브랜치 창',
        'rail.more': '추가 작업',
        'rail.settings': '작업 표시줄 설정',
        'rail.openSettings': '플러그인 설정 열기',
        'settings.card.title': 'Git 도구 창 설정',
        'settings.card.desc': '패널 배치, 액션 레일 버튼 및 AI 커밋 메시지',
        'settings.placement.title': '패널 배치',
        'settings.placement.tab': '대화 영역에 Git 탭 표시',
      'settings.composer.title': '입력창 아래 브랜치',
      'settings.composer.hint': '입력창 아래(세션 통계 왼쪽)에 현재 브랜치를 표시합니다(클릭하여 전환, Git 패널과 연동). 끄면 표시되지 않습니다.',
      'composer.branchHint': '브랜치 전환',
      'composer.detached': 'HEAD(분리됨)',
      'modelRoute.pick': '모델 선택',
      'modelRoute.trigger': 'AI 커밋 메시지 모델',
      'modelRoute.modelRow': '모델',
      'modelRoute.effortRow': '추론',
      'modelRoute.effortDefault': '기본값 따르기',
      'modelRoute.empty': '사용 가능한 모델이 없습니다',
      'composer.inWorktree': '다른 작업 트리에서 체크아웃됨',
      'composer.busy': 'Git 작업 진행 중…',
        'settings.placement.tabHint': '꺼도 오른쪽 사이드바와 하단 패널에서 열 수 있습니다.',
        'settings.placement.immersive': '몰입 모드(전체 높이, 입력창 숨김)',
        'settings.placement.immersiveHint': '켜면 Git 탭이 대화 영역 전체 높이를 차지하고 입력창은 숨겨집니다. 승인과 질문은 정상적으로 표시됩니다.',
        'preview.openFile': '파일 미리보기로 열기',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': '검토할 파일 선택',
        'lf.split': '좌우 분할 보기로 전환',
        'lf.unified': '단일 보기로 전환',
        'lf.wrap': '자동 줄바꿈 켜기',
        'lf.nowrap': '자동 줄바꿈 끄기',
        'lf.created': '새로 만든 파일',
        'lf.removedFile': '삭제된 파일',
        'lf.truncated': '처음 {count}줄만 표시',
        'preview.title': 'Git 미리보기',
        'preview.hint': '파일이나 커밋의 「차이 보기」를 클릭하면 차이가 사이드바 여기에 열립니다.',
        'preview.boundary': '미리보기 렌더링에 실패했습니다 — 페이지를 새로고침하거나 문제를 보고해 주세요.',
        'settings.rail.title': '레일',
        'settings.rail.hint': '레일에 표시할 동작을 선택하세요. 순서는 고정이며 선택을 해제하면 숨겨집니다.',
        'settings.rail.unavailable': '이 호스트에는 설정 서비스가 없으므로 패널의 "액션 레일 설정"을 사용하세요.',
        'settings.commit.title': 'AI 커밋 메시지',
        'settings.commit.model': '사용할 모델',
        'settings.commit.modelHint': '비우면 현재 세션을 따릅니다(provider/model)',
        'settings.commit.modelFollow': '현재 세션 따르기',
        'settings.commit.reasoning': '추론 강도',
        'settings.commit.reasoningHint': '비워 두면 추론 없음',
        'settings.commit.reasoningDefault': '추론 없음(기본값)',
        'settings.commit.reasoningFollowHint': '세션을 따를 때는 항상 추론을 건너뜁니다. 고정 모델을 선택하면 강도를 고를 수 있습니다',
        'settings.commit.prompt': '추가 지시',
        'settings.commit.promptHint': '예: Conventional Commits, 제목은 한국어, 72자 이내',
        'settings.commit.tooLong': '{n}자를 넘는 부분은 저장되지 않습니다',
        'changes.aiWrite': 'AI로 작성',
        'changes.aiBusy': '생성 중…',
        'changes.aiQuota': '사용자의 할당량을 소모합니다',
        'changes.aiOverwriteTitle': '현재 초안을 바꿀까요?',
        'changes.aiOverwriteText': 'AI 텍스트가 입력한 커밋 메시지를 대체합니다(되돌릴 수 있습니다).',
        'changes.aiUndo': '되돌리기',
        'changes.aiFailed': '생성하지 못했습니다:',
        'changes.aiNotice': '일부 변경이 모델에 전달되지 않았습니다(잘림 또는 제외). 내용이 불완전할 수 있습니다.',
        'settings.rail.writeFailed': '설정이 저장되지 않아 원래 상태로 되돌렸습니다. 다시 시도하세요.',
        'settings.rail.readonly': '이 호스트는 설정을 읽기 전용으로 제공합니다.',
        'rail.settingsHint': '끌어서 또는 화살표로 순서를 바꾸고, 눈 아이콘으로 표시를 전환합니다',
        'rail.reset': '기본값 복원',
        'rail.up': '위로',
        'rail.down': '아래로',
        'rail.show': '표시',
        'rail.hide': '숨기기',
        'action.unavailable': '현재 상태에서는 사용할 수 없습니다',
        'filter.branch': '브랜치',
        'filter.user': '작성자',
        'history.me': '나',
        'filter.date': '날짜',
        'filter.path': '경로',
        'filter.all': '전체',
        'filter.today': '오늘',
        'filter.week': '최근 7일',
        'filter.month': '최근 30일',
        'filter.year': '올해',
        'filter.pathPlaceholder': '경로로 필터(Enter)',
        'filter.sortDesc': '최신순',
        'filter.sortAsc': '오래된순',
        'filter.clear': '필터 지우기',
        'filter.none': '일치하는 커밋이 없습니다',
        'toast.undo': '되돌리기',
        'toast.close': '닫기',
        'toast.branchDeleted': '브랜치 {name} 삭제됨',
        'toast.stashDropped': '스태시 {ref} 삭제됨',
        'toast.discarded': '{path}의 변경 사항을 버렸습니다',
        'toast.discardNoUndo': '{path}의 변경 사항을 버렸습니다(너무 커서 되돌리기를 보관하지 않음)',
        'toast.restored': '복원했습니다',
        'toast.sentToChat': '입력창에 보냈습니다',
        'toast.sendCopied': '보낼 수 없어 클립보드에 복사했습니다',
        'undo.menu': '최근 삭제(되돌리기)',
        'undo.empty': '지금 되돌릴 항목이 없습니다',
        'undo.branch': '브랜치',
        'undo.stash': '스태시',
        'undo.discard': '버리기',
        'confirm.typeName': '확인하려면 {name}을(를) 입력하세요',
        'confirm.protected': '{name}은(는) 메인 브랜치입니다. 삭제 위험이 크므로 브랜치 이름을 입력해 확인하세요 —— 이후에도 토스트에서 복원할 수 있습니다.',
        'discard.untracked.confirm': '추적되지 않은 파일 {path}을(를) 삭제할까요? 내용이 제거됩니다 —— 이후 토스트에서 복원할 수 있습니다.',
        'stashDrop.confirm': '스태시 {ref}을(를) 삭제할까요? 이후 토스트에서 복원할 수 있습니다.',
        'operation.merge': '병합 진행 중',
        'operation.rebase': '리베이스 진행 중',
        'operation.cherry-pick': '체리픽 진행 중',
        'operation.revert': '되돌리기 진행 중',
        'operation.bisect': 'bisect 진행 중',
        'operation.hint': '이 저장소에 아직 끝나지 않은 다단계 작업이 있습니다 —— 브랜치 작업 전에 완료하거나 중단하세요',
        'confirm.title': '확인',
        'confirm.cancel': '취소',
        'confirm.ok': '확인',
        'prompt.newBranch': '새 브랜치 이름(생성 후 체크아웃)',
        'prompt.createTracking': '원격 브랜치에서 로컬 브랜치 만들기',
        'prompt.renameBranch': '브랜치 이름 바꾸기',
        'prompt.newTag': '새 태그 이름',
        'prompt.fromHead': '현재 HEAD',
        'error.dismiss': '닫기',
        'status.loading': '읽는 중...',
        'status.busy': '처리 중...',
        'counts.staged': '스테이지됨 {n}',
        'counts.ignored': '무시됨 {n}',
        'counts.unstaged': '변경 {n}',
        'counts.untracked': '추적되지 않음 {n}',
        'counts.conflicted': '충돌 {n}',
        'push.confirm': '{branch}을(를) {upstream}에 푸시할까요?',
        'push.confirmMany': "{n}개 브랜치를 푸시합니다: {names}. 확입니까?",
        'delete.confirm': '브랜치 {name}을(를) 삭제할까요? 이후 토스트에서 복원할 수 있습니다(git은 병합되지 않은 브랜치를 계속 거부합니다).',
        'discard.confirm': '{path}의 변경 사항을 버릴까요? 워크트리 내용이 덮어써집니다 —— 이후 토스트에서 복원할 수 있습니다.',
        'resetHard.confirm': '{hash}로 하드 리셋할까요? 커밋하지 않은 변경 사항은 사라집니다.',
        'resetSoft.confirm': 'HEAD를 {hash}로 옮길까요(워크트리 유지)?',
        'checkoutCommit.confirm': '커밋 {hash}을(를) 체크아웃할까요?(detached HEAD)',
      },
      /* locale: de */
      'de': {
        'title': 'Git',
        'description': 'Git-Panel auf IDE-Niveau: Branch-Baum / Commit-Graph / Änderungen',
        'repo.label': 'Repository',
        'repo.workspace': 'Arbeitsbereich',
        'repo.nested': 'verschachtelt',
        'repo.none': 'Dieser Arbeitsbereich ist kein Git-Repository',
        'repo.pick': 'Repository zum Ansehen wählen',
        'repo.empty': 'In diesem Arbeitsbereich wurde kein Git-Repository gefunden',
        'repo.switch': 'Repository wechseln',
        'branch.switch': 'Branch wechseln',
        'seg.changes': 'Änderungen {n}',
        'seg.history': 'Verlauf',
        'branches.local': 'Lokal',
        'branches.remote': 'Remote',
        'branches.tags': 'Tags',
        'branches.head': 'HEAD (aktueller Branch)',
        'branches.favorites': 'Favoriten',
        'branches.starHint': "Favorit",
        'branches.pickHint': 'Klicken zum Auswählen, Doppelklick zeigt den Verlauf',
        'branches.headHint': 'Doppelklick zeigt den Verlauf des aktuellen Branches',
        'branches.worktree': 'In einem anderen Arbeitsbaum ausgecheckt',
        'action.stash': 'Stash',
        'action.favorite': 'Aktuellen Branch als Favorit setzen/entfernen',
        'action.newTagHere': 'Neuer Tag am aktuellen Commit...',
        'stash.push': 'Aktuelle Änderungen stashen',
        'stash.apply': 'Neuesten Stash anwenden',
        'stash.drop': 'Neuesten Stash verwerfen',
        'stash.count': '{n} Stash-Einträge',
        'note.noChanges': 'Keine offenen Änderungen',
        'note.noBranches': 'Keine weiteren Branches',
        'branches.filter': 'Branch oder Tag',
        'changes.title': 'Änderungen',
        'changes.staged': 'Vorgemerkt',
        'changes.unstaged': 'Änderungen',
        'changes.untracked': 'Nicht verfolgt',
        'changes.conflicted': 'Konflikte',
        'changes.empty': 'Keine offenen Änderungen',
        'changes.commitPlaceholder': 'Commit-Nachricht (Strg+Enter)',
        'changes.commit': 'Committen',
        'changes.amend': 'Letzten Commit ergänzen',
        'changes.stageAll': 'Alle vormerken',
        'selection.count': '{n} ausgewählt',
        'selection.copied': '{n} Element(e) kopiert',
        'selection.copyPaths': 'Pfade kopieren',
        'selection.clear': 'Auswahl aufheben',
        'action.copyName': 'Name kopieren',
        'menu.copyNamesN': '{n} Namen kopieren',
        'menu.copyHashesN': '{n} Hashes kopieren',
        'menu.copyPathsN': '{n} Pfade kopieren',
        'menu.stageN': '{n} Elemente vormerken',
        'menu.unstageN': '{n} Elemente zurücknehmen',
        'menu.discardN': '{n} Elemente verwerfen…',
        'menu.cherryN': '{n} Commits cherry-picken',
        'menu.deleteLocalN': '{n} lokale Branches löschen…',
        'menu.deleteRemoteN': '{n} Remote-Branches löschen…',
        'menu.deleteTagsN': '{n} Tags löschen…',
        'confirm.deleteRefs': 'Ausgewählte Referenzen löschen? {b} lokal, {r} remote, {g} Tag(s).',
        'confirm.discardMany': 'Uncommittete Änderungen von {n} Dateien verwerfen?',
        'confirm.discardManyUntracked': '{m} unbeobachtete Datei(en) werden endgültig gelöscht.',
        'toast.branchesDeleted': '{n} Branch(es) gelöscht',
        'changes.unstageAll': 'Alle zurücknehmen',
        'changes.groupBy': 'Gruppieren nach',
        'changes.groupFlat': 'Flache Liste',
        'changes.groupDir': 'Nach Verzeichnis',
        'changes.expandAll': 'Alle ausklappen',
        'changes.foldAll': 'Alle einklappen',
        'changes.showIgnored': 'Ignorierte Dateien anzeigen',
        'changes.rootDir': '(Wurzel)',
        'changes.commitAndPush': 'Committen und pushen',
        'action.stage': 'Vormerken',
        'action.unstage': 'Zurücknehmen',
        'action.discard': 'Änderungen verwerfen',
        'action.showDiff': 'Diff anzeigen',
        'action.copyPath': 'Pfad kopieren',
        'action.checkout': 'Auschecken',
        'action.float': 'Diese Seite schweben lassen',
        'action.dock': 'Zurück andocken',
        'action.split': 'Teilen',
        'action.fullscreen': 'Vollbild',
        'action.exitFullscreen': 'Vollbild beenden',
        'action.newBranchFrom': 'Neuer Branch von hier...',
        'action.setUpstream': 'Upstream festlegen …',
        'action.unsetUpstream': 'Upstream entfernen',
        'action.createLocalBranch': 'Lokalen Branch erstellen …',
        'action.newBranchHere': 'Neuer Branch hier...',
        'action.rename': 'Umbenennen...',
        'action.delete': 'Löschen',
        'action.mergeIntoCurrent': 'In aktuellen Branch mergen',
        'action.rebaseCurrentOnto': 'Aktuellen Branch hierauf rebasen',
        'action.compare': 'Mit aktuellem Branch vergleichen',
        'action.update': 'Aktualisieren (fetch)',
        'action.push': 'Push',
        'action.newTag': 'Neuer Tag...',
        'action.cherryPick': 'Cherry-Pick',
        'action.revert': 'Commit rückgängig machen',
        'action.resetSoft': 'Hierher zurücksetzen (Änderungen behalten)',
        'action.resetHard': 'Hierher zurücksetzen (Änderungen verwerfen)',
        'action.copyHash': 'Revisionsnummer kopieren',
        'action.details': 'Commit-Details',
        'menu.sendToChat': 'Im Chat senden',
        'send.commitText': 'git-Commit {hash} "{subject}" (Repository {repo})',
        'send.branchText': 'git-Branch {name} (Repository {repo})',
        'menu.sendDiffLinesToChat': 'Ausgewählte Zeilen in den Chat senden',
        'menu.sendDiffSnippetToChat': 'Ausgewählten Ausschnitt in den Chat senden',
        'menu.copyDiffRef': 'Auswahlbezug kopieren',
        'send.diffLinesCommit': '{lines} (Commit {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (Arbeitsbaum, {state})',
        'send.diffStaged': 'staged',
        'send.diffUnstaged': 'nicht committet',
        'send.diffNewLines': 'Zeilen {lines}',
        'send.diffOldLines': 'Zeilen {lines} (alte Nummerierung)',
        'history.empty': 'Dieses Repository hat noch keine Commits',
        'history.loadMore': 'Mehr laden',
        'history.filter': 'Text oder Hash',
        'detail.files': 'Geänderte Dateien',
        'detail.pick': 'Commit auswählen',
        'detail.back': 'Zurück zum Verlauf',
        'detail.noFiles': 'Keine Dateiänderungen',
        'diff.empty': 'Kein textueller Diff vorhanden',
        'pane.diff': 'Diff-Ansicht',
        'pane.resize': 'Größe von {name} per Ziehen ändern (Doppelklick setzt zurück, Pfeiltasten justieren)',
        'diff.binary': 'Binärdatei',
        'diff.loading': 'Diff wird geladen...',
        'diff.codeLabel': 'Diff',
        'diff.wrapLabel': 'Zeilen umbrechen',
        'diff.unwrapLabel': 'Quellspalten beibehalten',
        'diff.copy': 'Kopieren',
        'diff.copied': 'Kopiert',
        'toolbar.refresh': 'Aktualisieren',
      'more.sort': 'Anzeigen & Sortieren',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Änderungen',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Branch',
      'more.remoteGroup': 'Remote',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Tags',
      'more.commitStaged': 'Staged committen...',
      'more.commitAll': 'Alles committen...',
      'more.undoCommit': 'Letzten Commit zurücknehmen',
      'more.rebaseAbort': 'Rebase abbrechen',
      'more.commitStagedAmend': 'Staged committen (Amend)...',
      'more.commitAllAmend': 'Alles committen (Amend)...',
      'more.commitStagedSign': 'Staged committen (Signed Off)...',
      'more.commitAllSign': 'Alles committen (Signed Off)...',
      'prompt.commitMessage': 'Commit-Nachricht',
      'more.discardAll': 'Alle Änderungen verwerfen...',
      'more.sync': 'Synchronisieren (Pull, dann Push)',
      'more.syncRebase': 'Synchronisieren (Rebase, dann Push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Von Remote pullen',
      'more.pushForce': 'Push (Erzwingen)...',
      'more.pushTo': 'Auf Remote pushen',
      'more.fetchAll': 'Von allen Remotes holen',
      'more.deleteRemoteBranch': 'Remote-Branch löschen...',
      'more.publish': 'Branch veröffentlichen...',
      'more.setUpstreamHead': 'Upstream des aktuellen Branch festlegen …',
      'more.unsetUpstreamHead': 'Upstream des aktuellen Branch entfernen',
      'more.addRemote': 'Remote hinzufügen...',
      'more.removeRemote': 'Remote entfernen...',
      'more.stashTracked': 'Stash (nur getrackt)',
      'more.stashStaged': 'Staged stashed',
      'more.stashApplyPick': 'Stash anwenden...',
      'more.stashPopPick': 'Stash poppen...',
      'more.stashDropAny': 'Stash löschen...',
      'more.stashClear': 'Alle Stashes löschen...',
      'stash.none': 'Keine Stashes vorhanden',
      'more.tagDeleteRemote': 'Remote-Tag löschen...',
      'more.pushTags': 'Tags pushen...',
      'confirm.undoCommit': 'Letzten Commit zurücknehmen? Die Änderungen bleiben gestaged.',
      'confirm.discardAll': 'ALLE ungestageden und ungetrackten Änderungen verwerfen? Über Undo-Toasts wiederherstellbar (Konfliktdateien ausgenommen).',
      'confirm.pushForce': 'Force-Push überschreibt das Remote mit diesem Branch (--force-with-lease lehnt ab, wenn andere gepusht haben). Fortfahren?',
      'confirm.deleteRemoteBranch': 'Branch {branch} auf {remote} löschen?',
      'confirm.remoteRemove': 'Remote {name} entfernen? Die Tracking-Konfiguration wird mitentfernt.',
      'confirm.stashClear': 'ALLE Stashes löschen? Das kann nicht rückgängig gemacht werden.',
      'confirm.pushTags': 'Alle Tags auf {remote} pushen?',
      'prompt.remoteName': 'Remote-Name',
      'prompt.remoteUrl': 'Remote-URL',
      'prompt.deleteRemoteTag': 'Zu löschendes Remote-Tag (wird nach {remote} gepusht)',
      'toolbar.more': 'Weitere Aktionen',
      'more.sortGit': 'Git-Reihenfolge',
      'more.sortPath': 'Nach Pfad',
      'more.sortName': 'Nach Name',
      'more.sortStatus': 'Nach Status',
      'more.clone': 'Repository klonen...',
      'more.stashPop': 'Letzten Stash poppen',
      'more.deleteTag': 'Tag löschen...',
      'more.gitOutput': 'Git-Ausgabe anzeigen',
      'clone.title': 'Repository klonen',
      'clone.url': 'Repository-URL',
      'clone.dir': 'Zielverzeichnis (absoluter Pfad)',
      'clone.run': 'Klonen',
      'prompt.deleteTag': 'Zu löschender Tag-Name',
      'gitLog.title': 'Git-Ausgabe',
      'gitLog.empty': 'Noch keine Git-Ausführungen',
        'toolbar.newBranch': 'Neuer Branch',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "{n} ausgewählte Branch(es) pullen",
        'toolbar.fetchPicked': "{n} ausgewählte Ref(s) fetchen",
        'toolbar.pushPicked': "{n} ausgewählte Branch(es) pushen",
        'toolbar.checkoutPicked': "Ausgewählten Branch auschecken",
        'toolbar.deletePicked': "{n} ausgewählte Ref(s) löschen",
        'toolbar.push': 'Push',
        'toolbar.tree': 'Branch-Bereich',
        'rail.more': 'Weitere Aktionen',
        'rail.settings': 'Einstellungen der Aktionsleiste',
        'rail.openSettings': 'Plugin-Einstellungen öffnen',
        'settings.card.title': 'Git-Werkzeugfenster-Einstellungen',
        'settings.card.desc': 'Panel-Platzierung, Aktionsleisten-Schaltflächen und KI-Commit-Nachricht',
        'settings.placement.title': 'Panel-Platzierung',
        'settings.placement.tab': 'Git-Tab im Gesprächsbereich anzeigen',
      'settings.composer.title': 'Branch unter der Eingabe',
      'settings.composer.hint': 'Zeigt den aktuellen Branch unter der Eingabe links neben den Sitzungsstatistiken — anklickbar zum Wechseln, mit dem Git-Panel synchron. Aus blendet ihn aus.',
      'composer.branchHint': 'Zweig wechseln',
      'composer.detached': 'HEAD (detached)',
      'modelRoute.pick': 'Modell wählen',
      'modelRoute.trigger': 'Modell für KI-Commits',
      'modelRoute.modelRow': 'Modell',
      'modelRoute.effortRow': 'Denken',
      'modelRoute.effortDefault': 'Standard folgen',
      'modelRoute.empty': 'Keine Modelle verfügbar',
      'composer.inWorktree': 'In anderem Worktree ausgecheckt',
      'composer.busy': 'Git-Aktion läuft…',
        'settings.placement.tabHint': 'Ausgeschaltet bleibt das Panel über rechte Seitenleiste und unteres Panel erreichbar.',
        'settings.placement.immersive': 'Immersiver Modus (volle Höhe, ausgeblendetes Eingabefeld)',
        'settings.placement.immersiveHint': 'Eingeschaltet füllt der Git-Tab die gesamte Gesprächshöhe und das Eingabefeld weicht zurück; Freigaben und Rückfragen bleiben sichtbar.',
        'preview.openFile': 'In der Dateivorschau öffnen',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Zu prüfende Datei wählen',
        'lf.split': 'Zur geteilten Ansicht wechseln',
        'lf.unified': 'Zur gemeinsamen Ansicht wechseln',
        'lf.wrap': 'Zeilenumbruch aktivieren',
        'lf.nowrap': 'Zeilenumbruch deaktivieren',
        'lf.created': 'Neue Datei',
        'lf.removedFile': 'Gelöschte Datei',
        'lf.truncated': 'Nur die ersten {count} Zeilen',
        'preview.title': 'Git-Vorschau',
        'preview.hint': '„Diff anzeigen“ an einer Datei oder einem Commit öffnet den Diff hier in der Seitenleiste.',
        'preview.boundary': 'Die Vorschau konnte nicht gerendert werden – Seite neu laden oder das Problem melden.',
        'settings.rail.title': 'Aktionsleiste',
        'settings.rail.hint': 'Die auf der Leiste sichtbaren Aktionen ankreuzen. Die Reihenfolge ist fest; abwählen blendet eine aus.',
        'settings.rail.unavailable': 'Dieser Host hat keinen Einstellungsdienst; nutze die „Aktionsleisten-Einstellungen“ im Panel.',
        'settings.commit.title': 'KI-Commit-Nachricht',
        'settings.commit.model': 'Modell',
        'settings.commit.modelHint': 'Leer = dieser Sitzung folgen (provider/model)',
        'settings.commit.modelFollow': 'Dieser Sitzung folgen',
        'settings.commit.reasoning': 'Denkaufwand',
        'settings.commit.reasoningHint': 'Leer = kein Denken',
        'settings.commit.reasoningDefault': 'Kein Denken (Standard)',
        'settings.commit.reasoningFollowHint': 'Beim Folgen der Sitzung wird nie gedacht; wähle ein festes Modell, um eine Stufe zu wählen',
        'settings.commit.prompt': 'Zusätzliche Anweisungen',
        'settings.commit.promptHint': 'z. B. Conventional Commits, Betreff auf Deutsch, höchstens 72 Zeichen',
        'settings.commit.tooLong': 'Nur die ersten {n} Zeichen werden gespeichert',
        'changes.aiWrite': 'Mit KI schreiben',
        'changes.aiBusy': 'Wird geschrieben…',
        'changes.aiQuota': 'Verbraucht dein eigenes Kontingent',
        'changes.aiOverwriteTitle': 'Aktuellen Entwurf ersetzen?',
        'changes.aiOverwriteText': 'Der KI-Text ersetzt deine eingegebene Commit-Nachricht (rückgängig möglich).',
        'changes.aiUndo': 'Rückgängig',
        'changes.aiFailed': 'Konnte nicht schreiben:',
        'changes.aiNotice': 'Einige Änderungen wurden nicht ans Modell gesendet (gekürzt oder verworfen); die Nachricht kann unvollständig sein.',
        'settings.rail.writeFailed': 'Die Einstellung wurde nicht gespeichert; der Schalter ist zurückgesprungen. Bitte erneut versuchen.',
        'settings.rail.readonly': 'Dieser Host liefert die Konfiguration schreibgeschützt.',
        'rail.settingsHint': 'Ziehen oder Pfeile zum Sortieren, das Auge schaltet die Sichtbarkeit um',
        'rail.reset': 'Standard wiederherstellen',
        'rail.up': 'Nach oben',
        'rail.down': 'Nach unten',
        'rail.show': 'Anzeigen',
        'rail.hide': 'Ausblenden',
        'action.unavailable': 'Im aktuellen Zustand nicht verfügbar',
        'filter.branch': 'Branch',
        'filter.user': 'Autor',
        'history.me': 'Ich',
        'filter.date': 'Datum',
        'filter.path': 'Pfad',
        'filter.all': 'Alle',
        'filter.today': 'Heute',
        'filter.week': 'Letzte 7 Tage',
        'filter.month': 'Letzte 30 Tage',
        'filter.year': 'Dieses Jahr',
        'filter.pathPlaceholder': 'Nach Pfad filtern (Enter)',
        'filter.sortDesc': 'Neueste zuerst',
        'filter.sortAsc': 'Älteste zuerst',
        'filter.clear': 'Filter zurücksetzen',
        'filter.none': 'Keine passenden Commits',
        'toast.undo': 'Rückgängig',
        'toast.close': 'Schließen',
        'toast.branchDeleted': 'Branch {name} gelöscht',
        'toast.stashDropped': 'Stash {ref} verworfen',
        'toast.discarded': 'Änderungen in {path} verworfen',
        'toast.discardNoUndo': 'Änderungen in {path} verworfen (zu groß für ein Rückgängig)',
        'toast.restored': 'Wiederhergestellt',
        'toast.sentToChat': 'In das Eingabefeld eingefügt',
        'toast.sendCopied': 'Senden nicht möglich – stattdessen in die Zwischenablage kopiert',
        'undo.menu': 'Zuletzt gelöscht (rückgängig)',
        'undo.empty': 'Derzeit nichts rückgängig zu machen',
        'undo.branch': 'Branch',
        'undo.stash': 'Stash',
        'undo.discard': 'Verwerfen',
        'confirm.typeName': 'Zur Bestätigung {name} eingeben',
        'confirm.protected': '{name} ist ein Hauptbranch. Das Löschen ist riskant, daher bitte den Branchnamen eingeben —— ein Hinweis kann ihn danach noch zurückholen.',
        'discard.untracked.confirm': 'Nicht verfolgte Datei {path} löschen? Der Inhalt wird entfernt —— ein Hinweis kann ihn danach zurückholen.',
        'stashDrop.confirm': 'Stash {ref} verwerfen? Ein Hinweis kann ihn danach zurückholen.',
        'operation.merge': 'Merge läuft',
        'operation.rebase': 'Rebase läuft',
        'operation.cherry-pick': 'Cherry-Pick läuft',
        'operation.revert': 'Revert läuft',
        'operation.bisect': 'Bisect läuft',
        'operation.hint': 'In diesem Repository läuft noch eine mehrstufige Operation —— bitte zuerst abschließen oder abbrechen',
        'confirm.title': 'Bestätigen',
        'confirm.cancel': 'Abbrechen',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Name des neuen Branch (wird erstellt und ausgecheckt)',
        'prompt.createTracking': 'Lokalen Branch aus dem Remote-Branch erstellen',
        'prompt.renameBranch': 'Branch umbenennen',
        'prompt.newTag': 'Name des neuen Tags',
        'prompt.fromHead': 'aktuelles HEAD',
        'error.dismiss': 'Schließen',
        'status.loading': 'Wird gelesen...',
        'status.busy': 'Arbeitet...',
        'counts.staged': 'Vorgemerkt {n}',
        'counts.ignored': 'Ignoriert {n}',
        'counts.unstaged': 'Änderungen {n}',
        'counts.untracked': 'Nicht verfolgt {n}',
        'counts.conflicted': 'Konflikte {n}',
        'push.confirm': '{branch} nach {upstream} pushen?',
        'push.confirmMany': "{n} Branch(es) pushen: {names}?",
        'delete.confirm': 'Branch {name} löschen? Ein Hinweis kann ihn danach zurückholen (git verweigert weiterhin nicht gemergte Branches).',
        'discard.confirm': 'Änderungen in {path} verwerfen? Der Arbeitsbaum wird überschrieben —— ein Hinweis kann sie danach zurückholen.',
        'resetHard.confirm': 'Hart auf {hash} zurücksetzen? Nicht committete Änderungen gehen verloren.',
        'resetSoft.confirm': 'HEAD auf {hash} verschieben (Arbeitsbaum bleibt)?',
        'checkoutCommit.confirm': 'Commit {hash} auschecken? (detached HEAD)',
      },
      /* locale: fr */
      'fr': {
        'title': 'Git',
        'description': 'Panneau Git de niveau IDE : arbre des branches / graphe des commits / modifications',
        'repo.label': 'Dépôt',
        'repo.workspace': 'espace de travail',
        'repo.nested': 'imbriqué',
        'repo.none': 'Cet espace de travail n\'est pas un dépôt Git',
        'repo.pick': 'Choisir un dépôt à inspecter',
        'repo.empty': 'Aucun dépôt Git trouvé dans cet espace de travail',
        'repo.switch': 'Changer de dépôt',
        'branch.switch': 'Changer de branche',
        'seg.changes': 'Modifications {n}',
        'seg.history': 'Historique',
        'branches.local': 'Locales',
        'branches.remote': 'Distantes',
        'branches.tags': 'Étiquettes',
        'branches.head': 'HEAD (branche courante)',
        'branches.favorites': 'Favoris',
        'branches.starHint': "Favori",
        'branches.pickHint': 'Clic pour sélectionner, double-clic pour ouvrir l\'historique',
        'branches.headHint': 'Double-clic pour l\'historique de la branche courante',
        'branches.worktree': 'Extraite dans un autre arbre de travail',
        'action.stash': 'Remisage',
        'action.favorite': 'Ajouter/retirer la branche courante des favoris',
        'action.newTagHere': 'Nouvelle étiquette sur le commit courant...',
        'stash.push': 'Remiser les modifications courantes',
        'stash.apply': 'Appliquer le dernier remisage',
        'stash.drop': 'Supprimer le dernier remisage',
        'stash.count': '{n} remisages',
        'note.noChanges': 'Aucune modification en attente',
        'note.noBranches': 'Aucune autre branche',
        'branches.filter': 'Branche ou étiquette',
        'changes.title': 'Modifications',
        'changes.staged': 'Indexé',
        'changes.unstaged': 'Modifications',
        'changes.untracked': 'Non suivi',
        'changes.conflicted': 'Conflits',
        'changes.empty': 'Aucune modification en attente',
        'changes.commitPlaceholder': 'Message de commit (Ctrl+Entrée)',
        'changes.commit': 'Valider',
        'changes.amend': 'Corriger le dernier commit',
        'changes.stageAll': 'Tout indexer',
        'selection.count': '{n} sélectionné(s)',
        'selection.copied': '{n} élément(s) copié(s)',
        'selection.copyPaths': 'Copier les chemins',
        'selection.clear': 'Effacer la sélection',
        'action.copyName': 'Copier le nom',
        'menu.copyNamesN': 'Copier {n} noms',
        'menu.copyHashesN': 'Copier {n} hachages',
        'menu.copyPathsN': 'Copier {n} chemins',
        'menu.stageN': 'Indexer {n} éléments',
        'menu.unstageN': 'Désindexer {n} éléments',
        'menu.discardN': 'Abandonner {n} éléments…',
        'menu.cherryN': 'Cherry-pick de {n} commits',
        'menu.deleteLocalN': 'Supprimer {n} branches locales…',
        'menu.deleteRemoteN': 'Supprimer {n} branches distantes…',
        'menu.deleteTagsN': 'Supprimer {n} étiquettes…',
        'confirm.deleteRefs': 'Supprimer les références sélectionnées ? {b} locale(s), {r} distante(s), {g} étiquette(s).',
        'confirm.discardMany': 'Abandonner les modifications non commitées de {n} fichiers ?',
        'confirm.discardManyUntracked': '{m} fichier(s) non suivi(s) seront définitivement supprimés.',
        'toast.branchesDeleted': '{n} branche(s) supprimée(s)',
        'changes.unstageAll': 'Tout désindexer',
        'changes.groupBy': 'Grouper par',
        'changes.groupFlat': 'Liste plate',
        'changes.groupDir': 'Par répertoire',
        'changes.expandAll': 'Tout déplier',
        'changes.foldAll': 'Tout replier',
        'changes.showIgnored': 'Afficher les fichiers ignorés',
        'changes.rootDir': '(racine)',
        'changes.commitAndPush': 'Valider et pousser',
        'action.stage': 'Indexer',
        'action.unstage': 'Désindexer',
        'action.discard': 'Abandonner les modifications',
        'action.showDiff': 'Afficher le diff',
        'action.copyPath': 'Copier le chemin',
        'action.checkout': 'Extraire',
        'action.float': 'Détacher cette page',
        'action.dock': 'Réancrer',
        'action.split': 'Fractionner',
        'action.fullscreen': 'Plein écran',
        'action.exitFullscreen': 'Quitter le plein écran',
        'action.newBranchFrom': 'Nouvelle branche depuis ici...',
        'action.setUpstream': 'Définir l\'upstream…',
        'action.unsetUpstream': 'Retirer l\'upstream',
        'action.createLocalBranch': 'Créer une branche locale…',
        'action.newBranchHere': 'Nouvelle branche ici...',
        'action.rename': 'Renommer...',
        'action.delete': 'Supprimer',
        'action.mergeIntoCurrent': 'Fusionner dans la branche courante',
        'action.rebaseCurrentOnto': 'Rebaser la branche courante sur celle-ci',
        'action.compare': 'Comparer avec la branche courante',
        'action.update': 'Mettre à jour (fetch)',
        'action.push': 'Pousser',
        'action.newTag': 'Nouvelle étiquette...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Annuler le commit',
        'action.resetSoft': 'Réinitialiser ici (garder les modifications)',
        'action.resetHard': 'Réinitialiser ici (abandonner les modifications)',
        'action.copyHash': 'Copier le numéro de révision',
        'action.details': 'Détails du commit',
        'menu.sendToChat': 'Envoyer dans la conversation',
        'send.commitText': 'commit git {hash} « {subject} » (dépôt {repo})',
        'send.branchText': 'branche git {name} (dépôt {repo})',
        'menu.sendDiffLinesToChat': 'Envoyer les lignes sélectionnées dans la conversation',
        'menu.sendDiffSnippetToChat': 'Envoyer l\'extrait sélectionné dans la conversation',
        'menu.copyDiffRef': 'Copier la référence de la sélection',
        'send.diffLinesCommit': '{lines} (commit {hash} « {subject} » @ {branch})',
        'send.diffLinesWorktree': '{lines} (arbre de travail, {state})',
        'send.diffStaged': 'indexé',
        'send.diffUnstaged': 'non commité',
        'send.diffNewLines': 'lignes {lines}',
        'send.diffOldLines': 'lignes {lines} (ancienne numérotation)',
        'history.empty': 'Ce dépôt n\'a pas encore de commit',
        'history.loadMore': 'Charger plus',
        'history.filter': 'Texte ou empreinte',
        'detail.files': 'Fichiers modifiés',
        'detail.pick': 'Sélectionnez un commit',
        'detail.back': 'Retour à l\'historique',
        'detail.noFiles': 'Aucune modification de fichier',
        'diff.empty': 'Aucun diff textuel à afficher',
        'pane.diff': 'vue du diff',
        'pane.resize': 'Glisser pour redimensionner {name} (double-clic pour réinitialiser, flèches pour ajuster)',
        'diff.binary': 'Fichier binaire',
        'diff.loading': 'Chargement du diff...',
        'diff.codeLabel': 'Diff',
        'diff.wrapLabel': 'Renvoyer à la ligne',
        'diff.unwrapLabel': 'Conserver les colonnes de la source',
        'diff.copy': 'Copier',
        'diff.copied': 'Copié',
        'toolbar.refresh': 'Rafraîchir',
      'more.sort': 'Afficher & trier',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Modifications',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Branche',
      'more.remoteGroup': 'Distant',
      'more.stashGroup': 'Remisage',
      'more.tagGroup': 'Étiquettes',
      'more.commitStaged': 'Commit des fichiers indexés...',
      'more.commitAll': 'Tout committer...',
      'more.undoCommit': 'Annuler le dernier commit',
      'more.rebaseAbort': 'Abandonner le rebase',
      'more.commitStagedAmend': 'Commit indexé (Amend)...',
      'more.commitAllAmend': 'Tout committer (Amend)...',
      'more.commitStagedSign': 'Commit indexé (Signé)...',
      'more.commitAllSign': 'Tout committer (Signé)...',
      'prompt.commitMessage': 'Message de commit',
      'more.discardAll': 'Abandonner toutes les modifications...',
      'more.sync': 'Synchroniser (pull puis push)',
      'more.syncRebase': 'Synchroniser (rebase puis push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Pull depuis un dépôt distant',
      'more.pushForce': 'Push (Forcer)...',
      'more.pushTo': 'Push vers un distant',
      'more.fetchAll': 'Récupérer de tous les distants',
      'more.deleteRemoteBranch': 'Supprimer la branche distante...',
      'more.publish': 'Publier la branche...',
      'more.setUpstreamHead': 'Définir l\'upstream de la branche courante…',
      'more.unsetUpstreamHead': 'Retirer l\'upstream de la branche courante',
      'more.addRemote': 'Ajouter un distant...',
      'more.removeRemote': 'Supprimer le distant...',
      'more.stashTracked': 'Remisage (suivis seulement)',
      'more.stashStaged': 'Remiser les fichiers indexés',
      'more.stashApplyPick': 'Appliquer un remisage...',
      'more.stashPopPick': 'Dépiler un remisage...',
      'more.stashDropAny': 'Supprimer un remisage...',
      'more.stashClear': 'Supprimer tous les remisages...',
      'stash.none': 'Aucun remisage disponible',
      'more.tagDeleteRemote': 'Supprimer l\'étiquette distante...',
      'more.pushTags': 'Pousser les étiquettes...',
      'confirm.undoCommit': 'Annuler le dernier commit ? Ses modifications restent indexées.',
      'confirm.discardAll': 'Abandonner TOUTES les modifications non indexées et non suivies ? Récupérable via les toasts d\'annulation (fichiers en conflit exclus).',
      'confirm.pushForce': 'Le forçage du push écrasera le distant avec cette branche (--force-with-lease refuse si d\'autres ont poussé). Continuer ?',
      'confirm.deleteRemoteBranch': 'Supprimer la branche {branch} sur {remote} ?',
      'confirm.remoteRemove': 'Supprimer le distant {name} ? Sa configuration de suivi part avec lui.',
      'confirm.stashClear': 'Supprimer TOUS les remisages ? Irréversible.',
      'confirm.pushTags': 'Pousser toutes les étiquettes vers {remote} ?',
      'prompt.remoteName': 'Nom du distant',
      'prompt.remoteUrl': 'URL du distant',
      'prompt.deleteRemoteTag': 'Étiquette distante à supprimer (poussée vers {remote})',
      'toolbar.more': 'Actions supplémentaires',
      'more.sortGit': 'Ordre Git',
      'more.sortPath': 'Par chemin',
      'more.sortName': 'Par nom',
      'more.sortStatus': 'Par statut',
      'more.clone': 'Cloner...',
      'more.stashPop': 'Pop du dernier stash',
      'more.deleteTag': 'Supprimer l\'étiquette...',
      'more.gitOutput': 'Afficher la sortie Git',
      'clone.title': 'Cloner le dépôt',
      'clone.url': 'URL du dépôt',
      'clone.dir': 'Répertoire cible (chemin absolu)',
      'clone.run': 'Cloner',
      'prompt.deleteTag': 'Nom de l\'étiquette à supprimer',
      'gitLog.title': 'Sortie Git',
      'gitLog.empty': 'Aucune exécution Git pour l\'instant',
        'toolbar.newBranch': 'Nouvelle branche',
        'toolbar.fetch': 'Récupérer',
        'toolbar.pull': 'Tirer',
        'toolbar.pullPicked': "Tirer {n} branche(s) sélectionnée(s)",
        'toolbar.fetchPicked': "Récupérer {n} réf(s) sélectionnée(s)",
        'toolbar.pushPicked': "Pousser {n} branche(s) sélectionnée(s)",
        'toolbar.checkoutPicked': "Extraire la branche sélectionnée",
        'toolbar.deletePicked': "Supprimer {n} réf(s) sélectionnée(s)",
        'toolbar.push': 'Pousser',
        'toolbar.tree': 'Volet des branches',
        'rail.more': 'Plus d\'actions',
        'rail.settings': 'Réglages de la barre d\'actions',
        'rail.openSettings': 'Ouvrir les réglages du plugin',
        'settings.card.title': 'Paramètres de la fenêtre d’outils Git',
        'settings.card.desc': 'Placement du panneau, boutons de la barre d’actions et message de commit par IA',
        'settings.placement.title': 'Placement du panneau',
        'settings.placement.tab': 'Afficher l’onglet Git dans la zone de conversation',
      'settings.composer.title': 'Branche sous la saisie',
      'settings.composer.hint': 'Affiche la branche actuelle sous la saisie, à gauche des statistiques de session — cliquer pour basculer, synchronisé avec le panneau Git. Désactivé, elle est masquée.',
      'composer.branchHint': 'Changer de branche',
      'composer.detached': 'HEAD (détaché)',
      'modelRoute.pick': 'Choisir un modèle',
      'modelRoute.trigger': 'Modèle des messages de commit IA',
      'modelRoute.modelRow': 'Modèle',
      'modelRoute.effortRow': 'Raisonnement',
      'modelRoute.effortDefault': 'Suivre la valeur par défaut',
      'modelRoute.empty': 'Aucun modèle disponible',
      'composer.inWorktree': 'Extrait dans un autre arbre de travail',
      'composer.busy': 'Opération Git en cours…',
        'settings.placement.tabHint': 'Désactivé, le panneau reste accessible depuis la barre latérale droite et le panneau inférieur.',
        'settings.placement.immersive': 'Mode immersif (pleine hauteur, zone de saisie masquée)',
        'settings.placement.immersiveHint': 'Activé, l’onglet Git occupe toute la hauteur de la conversation et la zone de saisie s’efface ; approbations et questions restent visibles.',
        'preview.openFile': 'Ouvrir dans l’aperçu du fichier',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Choisir le fichier à examiner',
        'lf.split': 'Passer à la vue scindée',
        'lf.unified': 'Passer à la vue unifiée',
        'lf.wrap': 'Activer le retour à la ligne',
        'lf.nowrap': 'Désactiver le retour à la ligne',
        'lf.created': 'Fichier créé',
        'lf.removedFile': 'Fichier supprimé',
        'lf.truncated': 'Affichage des {count} premières lignes',
        'preview.title': 'Aperçu Git',
        'preview.hint': 'Cliquez sur « Afficher le diff » sur un fichier ou un commit : le diff s’ouvre ici, dans la barre latérale.',
        'preview.boundary': 'L\'aperçu n\'a pas pu être affiché — rechargez la page ou signalez le problème.',
        'settings.rail.title': 'Barre d’actions',
        'settings.rail.hint': 'Cochez les actions affichées sur la barre. L’ordre est fixe ; décocher masque une action.',
        'settings.rail.unavailable': 'Cet hôte n’a pas de service de réglages ; utilisez « Réglages de la barre d’actions » dans le panneau.',
        'settings.commit.title': 'Message de commit par IA',
        'settings.commit.model': 'Modèle',
        'settings.commit.modelHint': 'Vide = suivre cette session (provider/model)',
        'settings.commit.modelFollow': 'Suivre cette session',
        'settings.commit.reasoning': 'Effort de raisonnement',
        'settings.commit.reasoningHint': 'Vide = sans raisonnement',
        'settings.commit.reasoningDefault': 'Sans raisonnement (par défaut)',
        'settings.commit.reasoningFollowHint': 'En suivant la session, jamais de raisonnement ; choisissez un modèle fixe pour en choisir l\'intensité',
        'settings.commit.prompt': 'Instructions supplémentaires',
        'settings.commit.promptHint': 'ex. Conventional Commits, sujet en français, 72 caractères maximum',
        'settings.commit.tooLong': 'Seuls les {n} premiers caractères sont enregistrés',
        'changes.aiWrite': 'Écrire avec l’IA',
        'changes.aiBusy': 'Rédaction…',
        'changes.aiQuota': 'Consomme votre propre quota',
        'changes.aiOverwriteTitle': 'Remplacer le brouillon actuel ?',
        'changes.aiOverwriteText': 'Le texte de l’IA remplacera le message saisi (annulable).',
        'changes.aiUndo': 'Annuler, reprendre mon brouillon',
        'changes.aiFailed': 'Échec de la rédaction :',
        'changes.aiNotice': 'Certaines modifications n’ont pas été envoyées au modèle (tronquées ou écartées) ; le message peut être incomplet.',
        'settings.rail.writeFailed': 'Le réglage n’a pas été enregistré ; l’interrupteur est revenu en place. Réessayez.',
        'settings.rail.readonly': 'Cet hôte fournit la configuration en lecture seule.',
        'rail.settingsHint': 'Glisser ou utiliser les flèches pour réordonner ; l\'œil bascule la visibilité',
        'rail.reset': 'Rétablir les valeurs par défaut',
        'rail.up': 'Monter',
        'rail.down': 'Descendre',
        'rail.show': 'Afficher',
        'rail.hide': 'Masquer',
        'action.unavailable': 'Indisponible dans l\'état actuel',
        'filter.branch': 'Branche',
        'filter.user': 'Auteur',
        'history.me': 'Moi',
        'filter.date': 'Date',
        'filter.path': 'Chemin',
        'filter.all': 'Tout',
        'filter.today': 'Aujourd\'hui',
        'filter.week': '7 derniers jours',
        'filter.month': '30 derniers jours',
        'filter.year': 'Cette année',
        'filter.pathPlaceholder': 'Filtrer par chemin (Entrée)',
        'filter.sortDesc': 'Plus récents d’abord',
        'filter.sortAsc': 'Plus anciens d’abord',
        'filter.clear': 'Effacer les filtres',
        'filter.none': 'Aucun commit correspondant',
        'toast.undo': 'Annuler',
        'toast.close': 'Fermer',
        'toast.branchDeleted': 'Branche {name} supprimée',
        'toast.stashDropped': 'Remisage {ref} supprimé',
        'toast.discarded': 'Modifications de {path} abandonnées',
        'toast.discardNoUndo': 'Modifications de {path} abandonnées (trop volumineuses pour être annulées)',
        'toast.restored': 'Restauré',
        'toast.sentToChat': 'Envoyé dans la zone de saisie',
        'toast.sendCopied': 'Envoi impossible — copié dans le presse-papiers à la place',
        'undo.menu': 'Supprimés récemment (annuler)',
        'undo.empty': 'Rien à annuler pour le moment',
        'undo.branch': 'Branche',
        'undo.stash': 'Remisage',
        'undo.discard': 'Abandon',
        'confirm.typeName': 'Saisir {name} pour confirmer',
        'confirm.protected': '{name} est une branche principale. Sa suppression est risquée : saisissez le nom de la branche pour confirmer —— une notification peut ensuite la rétablir.',
        'discard.untracked.confirm': 'Supprimer le fichier non suivi {path} ? Son contenu est retiré —— une notification peut ensuite le rétablir.',
        'stashDrop.confirm': 'Supprimer le remisage {ref} ? Une notification peut ensuite le rétablir.',
        'operation.merge': 'Fusion en cours',
        'operation.rebase': 'Rebasage en cours',
        'operation.cherry-pick': 'Cherry-pick en cours',
        'operation.revert': 'Annulation en cours',
        'operation.bisect': 'Bisect en cours',
        'operation.hint': 'Ce dépôt a encore une opération multi-étapes en cours —— terminez-la ou abandonnez-la avant les actions de branche',
        'confirm.title': 'Confirmer',
        'confirm.cancel': 'Annuler',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Nom de la nouvelle branche (créée et extraite)',
        'prompt.createTracking': 'Créer une branche locale depuis la branche distante',
        'prompt.renameBranch': 'Renommer la branche',
        'prompt.newTag': 'Nom de la nouvelle étiquette',
        'prompt.fromHead': 'HEAD courant',
        'error.dismiss': 'Fermer',
        'status.loading': 'Lecture...',
        'status.busy': 'En cours...',
        'counts.staged': 'Indexé {n}',
        'counts.ignored': 'Ignoré {n}',
        'counts.unstaged': 'Modifications {n}',
        'counts.untracked': 'Non suivi {n}',
        'counts.conflicted': 'Conflits {n}',
        'push.confirm': 'Pousser {branch} vers {upstream} ?',
        'push.confirmMany': "Pousser {n} branche(s) : {names} ?",
        'delete.confirm': 'Supprimer la branche {name} ? Une notification peut ensuite la rétablir (git refuse toujours les branches non fusionnées).',
        'discard.confirm': 'Abandonner les modifications de {path} ? Le contenu de l’arbre de travail est écrasé —— une notification peut ensuite le rétablir.',
        'resetHard.confirm': 'Réinitialisation dure sur {hash} ? Les modifications non validées sont perdues.',
        'resetSoft.confirm': 'Déplacer HEAD sur {hash} (arbre de travail conservé) ?',
        'checkoutCommit.confirm': 'Extraire le commit {hash} ? (HEAD détachée)',
      },
      /* locale: ru */
      'ru': {
        'title': 'Git',
        'description': 'Панель Git уровня IDE: дерево веток / граф коммитов / изменения',
        'repo.label': 'Репозиторий',
        'repo.workspace': 'рабочая область',
        'repo.nested': 'вложенный',
        'repo.none': 'Эта рабочая область не является репозиторием Git',
        'repo.pick': 'Выберите репозиторий для просмотра',
        'repo.empty': 'В этой рабочей области репозиторий Git не найден',
        'repo.switch': 'Сменить репозиторий',
        'branch.switch': 'Сменить ветку',
        'seg.changes': 'Изменения {n}',
        'seg.history': 'История',
        'branches.local': 'Локальные',
        'branches.remote': 'Удалённые',
        'branches.tags': 'Теги',
        'branches.head': 'HEAD (текущая ветка)',
        'branches.favorites': 'Избранное',
        'branches.starHint': "В избранном",
        'branches.pickHint': 'Клик — выбор, двойной клик — история коммитов',
        'branches.headHint': 'Двойной клик — история текущей ветки',
        'branches.worktree': 'Уже развёрнута в другом рабочем дереве',
        'action.stash': 'Отложить',
        'action.favorite': 'Добавить/убрать текущую ветку из избранного',
        'action.newTagHere': 'Новый тег на текущем коммите...',
        'stash.push': 'Отложить текущие изменения',
        'stash.apply': 'Применить последнюю отложенную запись',
        'stash.drop': 'Удалить последнюю отложенную запись',
        'stash.count': 'Отложенных записей: {n}',
        'note.noChanges': 'Нет незакоммиченных изменений',
        'note.noBranches': 'Других веток нет',
        'branches.filter': 'Ветка или тег',
        'changes.title': 'Изменения',
        'changes.staged': 'В индексе',
        'changes.unstaged': 'Изменения',
        'changes.untracked': 'Не отслеживается',
        'changes.conflicted': 'Конфликты',
        'changes.empty': 'Нет незакоммиченных изменений',
        'changes.commitPlaceholder': 'Сообщение коммита (Ctrl+Enter)',
        'changes.commit': 'Закоммитить',
        'changes.amend': 'Дополнить последний коммит',
        'changes.stageAll': 'Добавить всё в индекс',
        'selection.count': 'Выбрано: {n}',
        'selection.copied': 'Скопировано: {n}',
        'selection.copyPaths': 'Копировать пути',
        'selection.clear': 'Снять выделение',
        'action.copyName': 'Копировать имя',
        'menu.copyNamesN': 'Копировать имён: {n}',
        'menu.copyHashesN': 'Копировать хешей: {n}',
        'menu.copyPathsN': 'Копировать путей: {n}',
        'menu.stageN': 'В индекс: {n}',
        'menu.unstageN': 'Из индекса: {n}',
        'menu.discardN': 'Отменить изменения: {n}…',
        'menu.cherryN': 'Cherry-pick {n} коммит(ов)',
        'menu.deleteLocalN': 'Удалить локальных ветвей: {n}…',
        'menu.deleteRemoteN': 'Удалить внешних ветвей: {n}…',
        'menu.deleteTagsN': 'Удалить меток: {n}…',
        'confirm.deleteRefs': 'Удалить выбранные ссылки? Локальных: {b}, внешних: {r}, меток: {g}.',
        'confirm.discardMany': 'Отменить незафиксированные изменения в {n} файлах?',
        'confirm.discardManyUntracked': 'Будет безвозвратно удалено непрослеживаемых файлов: {m}.',
        'toast.branchesDeleted': 'Ветвей удалено: {n}',
        'changes.unstageAll': 'Убрать всё из индекса',
        'changes.groupBy': 'Группировать по',
        'changes.groupFlat': 'Плоский список',
        'changes.groupDir': 'По каталогам',
        'changes.expandAll': 'Развернуть всё',
        'changes.foldAll': 'Свернуть всё',
        'changes.showIgnored': 'Показывать игнорируемые файлы',
        'changes.rootDir': '(корень)',
        'changes.commitAndPush': 'Закоммитить и отправить',
        'action.stage': 'В индекс',
        'action.unstage': 'Из индекса',
        'action.discard': 'Отменить изменения',
        'action.showDiff': 'Показать различия',
        'action.copyPath': 'Скопировать путь',
        'action.checkout': 'Переключиться',
        'action.float': 'Открепить страницу',
        'action.dock': 'Вернуть в док',
        'action.split': 'Разделить',
        'action.fullscreen': 'Полный экран',
        'action.exitFullscreen': 'Выйти из полного экрана',
        'action.newBranchFrom': 'Новая ветка отсюда...',
        'action.setUpstream': 'Задать upstream…',
        'action.unsetUpstream': 'Убрать upstream',
        'action.createLocalBranch': 'Создать локальную ветку…',
        'action.newBranchHere': 'Новая ветка здесь...',
        'action.rename': 'Переименовать...',
        'action.delete': 'Удалить',
        'action.mergeIntoCurrent': 'Влить в текущую ветку',
        'action.rebaseCurrentOnto': 'Перебазировать текущую ветку сюда',
        'action.compare': 'Сравнить с текущей веткой',
        'action.update': 'Обновить (fetch)',
        'action.push': 'Отправить',
        'action.newTag': 'Новый тег...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Отменить коммит',
        'action.resetSoft': 'Сбросить сюда (сохранить изменения)',
        'action.resetHard': 'Сбросить сюда (отбросить изменения)',
        'action.copyHash': 'Скопировать номер ревизии',
        'action.details': 'Сведения о коммите',
        'menu.sendToChat': 'Отправить в чат',
        'send.commitText': 'git-коммит {hash} «{subject}» (репозиторий {repo})',
        'send.branchText': 'git-ветка {name} (репозиторий {repo})',
        'menu.sendDiffLinesToChat': 'Отправить выбранные строки в чат',
        'menu.sendDiffSnippetToChat': 'Отправить выбранный фрагмент в чат',
        'menu.copyDiffRef': 'Скопировать ссылку на выделение',
        'send.diffLinesCommit': '{lines} (коммит {hash} «{subject}» @ {branch})',
        'send.diffLinesWorktree': '{lines} (рабочее дерево, {state})',
        'send.diffStaged': 'в индексе',
        'send.diffUnstaged': 'не закоммичено',
        'send.diffNewLines': 'строки {lines}',
        'send.diffOldLines': 'строки {lines} (старая нумерация)',
        'history.empty': 'В этом репозитории ещё нет коммитов',
        'history.loadMore': 'Загрузить ещё',
        'history.filter': 'Текст или хеш',
        'detail.files': 'Изменённые файлы',
        'detail.pick': 'Выберите коммит',
        'detail.back': 'Назад к истории',
        'detail.noFiles': 'Файлы не изменялись',
        'diff.empty': 'Нет текстовых различий для показа',
        'pane.diff': 'просмотр diff',
        'pane.resize': 'Перетащите, чтобы изменить размер {name} (двойной клик — сброс, стрелки — точная настройка)',
        'diff.binary': 'Двоичный файл',
        'diff.loading': 'Загрузка различий...',
        'diff.codeLabel': 'Различия',
        'diff.wrapLabel': 'Переносить строки',
        'diff.unwrapLabel': 'Сохранять исходные колонки',
        'diff.copy': 'Копировать',
        'diff.copied': 'Скопировано',
        'toolbar.refresh': 'Обновить',
      'more.sort': 'Просмотр и сортировка',
      'more.commitGroup': 'Фиксация',
      'more.changesGroup': 'Изменения',
      'more.pullpushGroup': 'Изъять, отправить',
      'more.branchGroup': 'Ветвь',
      'more.remoteGroup': 'Сервер',
      'more.stashGroup': 'Отложить',
      'more.tagGroup': 'Метки',
      'more.commitStaged': 'Фиксация индексированного...',
      'more.commitAll': 'Фиксация всего...',
      'more.undoCommit': 'Отменить последнюю фиксацию',
      'more.rebaseAbort': 'Прервать перебазирование',
      'more.commitStagedAmend': 'Фиксация индексированного (Amend)...',
      'more.commitAllAmend': 'Фиксация всего (Amend)...',
      'more.commitStagedSign': 'Фиксация индексированного (С подписью)...',
      'more.commitAllSign': 'Фиксация всего (С подписью)...',
      'prompt.commitMessage': 'Сообщение фиксации',
      'more.discardAll': 'Отменить все изменения...',
      'more.sync': 'Синхронизировать (изъять, затем отправить)',
      'more.syncRebase': 'Синхронизировать (перебазировать, затем отправить)',
      'more.pullRebase': 'Изъять (перебазирование)',
      'more.pullFrom': 'Изъять с сервера',
      'more.pushForce': 'Отправить (принудительно)...',
      'more.pushTo': 'Отправить на сервер',
      'more.fetchAll': 'Изъять со всех серверов',
      'more.deleteRemoteBranch': 'Удалить ветвь на сервере...',
      'more.publish': 'Опубликовать ветвь...',
      'more.setUpstreamHead': 'Задать upstream текущей ветки…',
      'more.unsetUpstreamHead': 'Убрать upstream текущей ветки',
      'more.addRemote': 'Добавить сервер...',
      'more.removeRemote': 'Удалить сервер...',
      'more.stashTracked': 'Отложить (только отслеживаемое)',
      'more.stashStaged': 'Отложить индексированное',
      'more.stashApplyPick': 'Применить отложенное...',
      'more.stashPopPick': 'Снять отложенное...',
      'more.stashDropAny': 'Удалить отложенное...',
      'more.stashClear': 'Удалить всё отложенное...',
      'stash.none': 'Нет отложенных изменений',
      'more.tagDeleteRemote': 'Удалить метку на сервере...',
      'more.pushTags': 'Отправить метки...',
      'confirm.undoCommit': 'Отменить последнюю фиксацию? Её изменения останутся в индексе.',
      'confirm.discardAll': 'Отменить ВСЕ непроиндексированные и неотслеживаемые изменения? Можно восстановить через уведомления (кроме конфликтных файлов).',
      'confirm.pushForce': 'Принудительная отправка перезапишет сервер этой ветвью (--force-with-lease отклонит при чужих отправках). Продолжить?',
      'confirm.deleteRemoteBranch': 'Удалить ветвь {branch} на {remote}?',
      'confirm.remoteRemove': 'Удалить сервер {name}? Конфигурация отслеживания будет удалена.',
      'confirm.stashClear': 'Удалить ВСЁ отложенное? Это необратимо.',
      'confirm.pushTags': 'Отправить все метки на {remote}?',
      'prompt.remoteName': 'Имя сервера',
      'prompt.remoteUrl': 'URL сервера',
      'prompt.deleteRemoteTag': 'Метка для удаления (будет удалена с {remote})',
      'toolbar.more': 'Дополнительные действия',
      'more.sortGit': 'Порядок Git',
      'more.sortPath': 'По пути',
      'more.sortName': 'По имени',
      'more.sortStatus': 'По состоянию',
      'more.clone': 'Клонировать...',
      'more.stashPop': 'Pop последнего stash',
      'more.deleteTag': 'Удалить тег...',
      'more.gitOutput': 'Показать вывод Git',
      'clone.title': 'Клонировать репозиторий',
      'clone.url': 'URL репозитория',
      'clone.dir': 'Целевой каталог (абсолютный путь)',
      'clone.run': 'Клонировать',
      'prompt.deleteTag': 'Имя тега для удаления',
      'gitLog.title': 'Вывод Git',
      'gitLog.empty': 'Запусков Git пока нет',
        'toolbar.newBranch': 'Новая ветка',
        'toolbar.fetch': 'Получить',
        'toolbar.pull': 'Забрать',
        'toolbar.pullPicked': "Забрать выбранные ветки ({n})",
        'toolbar.fetchPicked': "Подтянуть выбранные ссылки ({n})",
        'toolbar.pushPicked': "Отправить выбранные ветки ({n})",
        'toolbar.checkoutPicked': "Перейти на выбранную ветку",
        'toolbar.deletePicked': "Удалить выбранные ссылки ({n})",
        'toolbar.push': 'Отправить',
        'toolbar.tree': 'Панель веток',
        'rail.more': 'Другие действия',
        'rail.settings': 'Настройки панели действий',
        'rail.openSettings': 'Открыть настройки плагина',
        'settings.card.title': 'Настройки окна инструментов Git',
        'settings.card.desc': 'Размещение панели, кнопки панели действий и сообщение коммита от ИИ',
        'settings.placement.title': 'Размещение панели',
        'settings.placement.tab': 'Показывать вкладку Git в области диалога',
      'settings.composer.title': 'Ветка под строкой ввода',
      'settings.composer.hint': 'Показывает текущую ветку под строкой ввода слева от статистики сеанса — щелчок переключает, синхронно с панелью Git. Выключено — скрыто.',
      'composer.branchHint': 'Сменить ветку',
      'composer.detached': 'HEAD (отделён)',
      'modelRoute.pick': 'Выбрать модель',
      'modelRoute.trigger': 'Модель сообщений коммитов ИИ',
      'modelRoute.modelRow': 'Модель',
      'modelRoute.effortRow': 'Рассуждение',
      'modelRoute.effortDefault': 'По умолчанию',
      'modelRoute.empty': 'Нет доступных моделей',
      'composer.inWorktree': 'Выверен в другом worktree',
      'composer.busy': 'Операция Git выполняется…',
        'settings.placement.tabHint': 'В выключенном виде панель доступна из правой боковой панели и нижней панели.',
        'settings.placement.immersive': 'Полноэкранный режим (во всю высоту, без поля ввода)',
        'settings.placement.immersiveHint': 'Во включённом виде вкладка Git занимает всю высоту области диалога, поле ввода скрывается; подтверждения и вопросы остаются на виду.',
        'preview.openFile': 'Открыть в предпросмотре файла',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Выберите файл для просмотра',
        'lf.split': 'Переключить на двухпанельный вид',
        'lf.unified': 'Переключить на однопанельный вид',
        'lf.wrap': 'Включить перенос строк',
        'lf.nowrap': 'Отключить перенос строк',
        'lf.created': 'Новый файл',
        'lf.removedFile': 'Удалённый файл',
        'lf.truncated': 'Показаны первые {count} строк',
        'preview.title': 'Git-предпросмотр',
        'preview.hint': 'Нажмите «Показать различия» у файла или коммита — различия откроются здесь, в боковой панели.',
        'preview.boundary': 'Не удалось отобразить предпросмотр — перезагрузите страницу или сообщите о проблеме.',
        'settings.rail.title': 'Панель действий',
        'settings.rail.hint': 'Отметьте действия, показываемые на панели. Порядок фиксирован; снятие флажка скрывает действие.',
        'settings.rail.unavailable': 'На этом хосте нет службы настроек; используйте «Настройки панели действий» в панели.',
        'settings.commit.title': 'Сообщение коммита от ИИ',
        'settings.commit.model': 'Модель',
        'settings.commit.modelHint': 'Пусто = как в этой сессии (provider/model)',
        'settings.commit.modelFollow': 'Как в этой сессии',
        'settings.commit.reasoning': 'Усилие рассуждения',
        'settings.commit.reasoningHint': 'Пусто = без размышлений',
        'settings.commit.reasoningDefault': 'Без размышлений (по умолчанию)',
        'settings.commit.reasoningFollowHint': 'При следовании за сессией размышления всегда выключены; выберите фиксированную модель, чтобы выбрать уровень',
        'settings.commit.prompt': 'Дополнительные указания',
        'settings.commit.promptHint': 'напр. Conventional Commits, тема по-русски, до 72 символов',
        'settings.commit.tooLong': 'Сохраняются только первые {n} символов',
        'changes.aiWrite': 'Написать с ИИ',
        'changes.aiBusy': 'Генерация…',
        'changes.aiQuota': 'Расходует вашу квоту',
        'changes.aiOverwriteTitle': 'Заменить текущий черновик?',
        'changes.aiOverwriteText': 'Текст ИИ заменит введённое сообщение коммита (можно отменить).',
        'changes.aiUndo': 'Отменить',
        'changes.aiFailed': 'Не удалось сгенерировать:',
        'changes.aiNotice': 'Часть изменений не отправлена модели (обрезана или отброшена); сообщение может быть неполным.',
        'settings.rail.writeFailed': 'Настройка не сохранилась; переключатель вернулся назад. Попробуйте снова.',
        'settings.rail.readonly': 'Этот хост отдаёт конфигурацию только для чтения.',
        'rail.settingsHint': 'Перетаскивайте или используйте стрелки для порядка; значок глаза переключает видимость',
        'rail.reset': 'Вернуть значения по умолчанию',
        'rail.up': 'Вверх',
        'rail.down': 'Вниз',
        'rail.show': 'Показать',
        'rail.hide': 'Скрыть',
        'action.unavailable': 'Недоступно в текущем состоянии',
        'filter.branch': 'Ветка',
        'filter.user': 'Автор',
        'history.me': 'Я',
        'filter.date': 'Дата',
        'filter.path': 'Путь',
        'filter.all': 'Все',
        'filter.today': 'Сегодня',
        'filter.week': 'Последние 7 дней',
        'filter.month': 'Последние 30 дней',
        'filter.year': 'В этом году',
        'filter.pathPlaceholder': 'Фильтр по пути (Enter)',
        'filter.sortDesc': 'Сначала новые',
        'filter.sortAsc': 'Сначала старые',
        'filter.clear': 'Сбросить фильтры',
        'filter.none': 'Подходящих коммитов нет',
        'toast.undo': 'Отменить',
        'toast.close': 'Закрыть',
        'toast.branchDeleted': 'Ветка {name} удалена',
        'toast.stashDropped': 'Отложенная запись {ref} удалена',
        'toast.discarded': 'Изменения в {path} отменены',
        'toast.discardNoUndo': 'Изменения в {path} отменены (слишком велики, отмена не сохранена)',
        'toast.restored': 'Восстановлено',
        'toast.sentToChat': 'Отправлено в поле ввода',
        'toast.sendCopied': 'Не удалось отправить — скопировано в буфер обмена',
        'undo.menu': 'Недавно удалённое (отменить)',
        'undo.empty': 'Сейчас нечего отменять',
        'undo.branch': 'Ветка',
        'undo.stash': 'Отложенная запись',
        'undo.discard': 'Отмена изменений',
        'confirm.typeName': 'Введите {name} для подтверждения',
        'confirm.protected': '{name} — основная ветка. Удаление рискованно, поэтому введите имя ветки для подтверждения —— уведомление затем сможет её вернуть.',
        'discard.untracked.confirm': 'Удалить неотслеживаемый файл {path}? Его содержимое будет удалено —— уведомление затем сможет его вернуть.',
        'stashDrop.confirm': 'Удалить отложенную запись {ref}? Уведомление затем сможет её вернуть.',
        'operation.merge': 'Идёт слияние',
        'operation.rebase': 'Идёт перебазирование',
        'operation.cherry-pick': 'Идёт cherry-pick',
        'operation.revert': 'Идёт отмена коммита',
        'operation.bisect': 'Идёт bisect',
        'operation.hint': 'В этом репозитории ещё не завершена многошаговая операция —— завершите или прервите её перед действиями с ветками',
        'confirm.title': 'Подтверждение',
        'confirm.cancel': 'Отмена',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Имя новой ветки (будет создана и выбрана)',
        'prompt.createTracking': 'Создать локальную ветку из удалённой',
        'prompt.renameBranch': 'Переименовать ветку',
        'prompt.newTag': 'Имя нового тега',
        'prompt.fromHead': 'текущий HEAD',
        'error.dismiss': 'Закрыть',
        'status.loading': 'Чтение...',
        'status.busy': 'Работа...',
        'counts.staged': 'В индексе {n}',
        'counts.ignored': 'Игнорируется {n}',
        'counts.unstaged': 'Изменения {n}',
        'counts.untracked': 'Не отслеживается {n}',
        'counts.conflicted': 'Конфликты {n}',
        'push.confirm': 'Отправить {branch} в {upstream}?',
        'push.confirmMany': "Отправить ветки ({n}): {names}?",
        'delete.confirm': 'Удалить ветку {name}? Уведомление затем сможет её вернуть (git по-прежнему откажет для несмёрженных веток).',
        'discard.confirm': 'Отменить изменения в {path}? Содержимое рабочего дерева будет перезаписано —— уведомление затем сможет его вернуть.',
        'resetHard.confirm': 'Жёсткий сброс на {hash}? Незакоммиченные изменения будут потеряны.',
        'resetSoft.confirm': 'Переместить HEAD на {hash} (рабочее дерево сохранится)?',
        'checkoutCommit.confirm': 'Переключиться на коммит {hash}? (detached HEAD)',
      },
      /* locale: pt */
      'pt': {
        'title': 'Git',
        'description': 'Painel Git de nível IDE: árvore de branches / grafo de commits / alterações',
        'repo.label': 'Repositório',
        'repo.workspace': 'área de trabalho',
        'repo.nested': 'aninhado',
        'repo.none': 'Esta área de trabalho não é um repositório Git',
        'repo.pick': 'Escolha um repositório para inspecionar',
        'repo.empty': 'Nenhum repositório Git encontrado nesta área de trabalho',
        'repo.switch': 'Trocar de repositório',
        'branch.switch': 'Trocar de branch',
        'seg.changes': 'Alterações {n}',
        'seg.history': 'Histórico',
        'branches.local': 'Locais',
        'branches.remote': 'Remotas',
        'branches.tags': 'Tags',
        'branches.head': 'HEAD (branch atual)',
        'branches.favorites': 'Favoritas',
        'branches.starHint': "Favorito",
        'branches.pickHint': 'Clique para selecionar, duplo clique abre o histórico',
        'branches.headHint': 'Duplo clique abre o histórico do branch atual',
        'branches.worktree': 'Já em checkout em outra árvore de trabalho',
        'action.stash': 'Stash',
        'action.favorite': 'Adicionar/remover a branch atual dos favoritos',
        'action.newTagHere': 'Nova tag no commit atual...',
        'stash.push': 'Guardar alterações atuais',
        'stash.apply': 'Aplicar o stash mais recente',
        'stash.drop': 'Descartar o stash mais recente',
        'stash.count': '{n} stashes',
        'note.noChanges': 'Nenhuma alteração pendente',
        'note.noBranches': 'Nenhuma outra branch',
        'branches.filter': 'Branch ou tag',
        'changes.title': 'Alterações',
        'changes.staged': 'Preparado',
        'changes.unstaged': 'Alterações',
        'changes.untracked': 'Não rastreado',
        'changes.conflicted': 'Conflitos',
        'changes.empty': 'Nenhuma alteração pendente',
        'changes.commitPlaceholder': 'Mensagem do commit (Ctrl+Enter)',
        'changes.commit': 'Commitar',
        'changes.amend': 'Corrigir o último commit',
        'changes.stageAll': 'Preparar tudo',
        'selection.count': '{n} selecionado(s)',
        'selection.copied': '{n} item(ns) copiado(s)',
        'selection.copyPaths': 'Copiar caminhos',
        'selection.clear': 'Limpar seleção',
        'action.copyName': 'Copiar nome',
        'menu.copyNamesN': 'Copiar {n} nomes',
        'menu.copyHashesN': 'Copiar {n} hashes',
        'menu.copyPathsN': 'Copiar {n} caminhos',
        'menu.stageN': 'Preparar {n} itens',
        'menu.unstageN': 'Despreparar {n} itens',
        'menu.discardN': 'Descartar {n} itens…',
        'menu.cherryN': 'Cherry-pick de {n} commits',
        'menu.deleteLocalN': 'Excluir {n} ramificações locais…',
        'menu.deleteRemoteN': 'Excluir {n} ramificações remotas…',
        'menu.deleteTagsN': 'Excluir {n} etiquetas…',
        'confirm.deleteRefs': 'Excluir as referências selecionadas? {b} locais, {r} remotas, {g} etiqueta(s).',
        'confirm.discardMany': 'Descartar as alterações não commitadas de {n} arquivos?',
        'confirm.discardManyUntracked': '{m} arquivo(s) não rastreado(s) serão excluídos em definitivo.',
        'toast.branchesDeleted': '{n} ramificação(ões) excluída(s)',
        'changes.unstageAll': 'Despreparar tudo',
        'changes.groupBy': 'Agrupar por',
        'changes.groupFlat': 'Lista simples',
        'changes.groupDir': 'Por diretório',
        'changes.expandAll': 'Expandir tudo',
        'changes.foldAll': 'Recolher tudo',
        'changes.showIgnored': 'Mostrar arquivos ignorados',
        'changes.rootDir': '(raiz)',
        'changes.commitAndPush': 'Commitar e enviar',
        'action.stage': 'Preparar',
        'action.unstage': 'Despreparar',
        'action.discard': 'Descartar alterações',
        'action.showDiff': 'Mostrar diff',
        'action.copyPath': 'Copiar caminho',
        'action.checkout': 'Checkout',
        'action.float': 'Flutuar esta página',
        'action.dock': 'Reacoplar',
        'action.split': 'Dividir',
        'action.fullscreen': 'Tela cheia',
        'action.exitFullscreen': 'Sair da tela cheia',
        'action.newBranchFrom': 'Nova branch a partir daqui...',
        'action.setUpstream': 'Definir upstream…',
        'action.unsetUpstream': 'Remover upstream',
        'action.createLocalBranch': 'Criar branch local…',
        'action.newBranchHere': 'Nova branch aqui...',
        'action.rename': 'Renomear...',
        'action.delete': 'Excluir',
        'action.mergeIntoCurrent': 'Mesclar na branch atual',
        'action.rebaseCurrentOnto': 'Rebasear a branch atual sobre esta',
        'action.compare': 'Comparar com a branch atual',
        'action.update': 'Atualizar (fetch)',
        'action.push': 'Enviar',
        'action.newTag': 'Nova tag...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Reverter commit',
        'action.resetSoft': 'Redefinir aqui (manter alterações)',
        'action.resetHard': 'Redefinir aqui (descartar alterações)',
        'action.copyHash': 'Copiar número da revisão',
        'action.details': 'Detalhes do commit',
        'menu.sendToChat': 'Enviar para a conversa',
        'send.commitText': 'commit git {hash} "{subject}" (repositório {repo})',
        'send.branchText': 'branch git {name} (repositório {repo})',
        'menu.sendDiffLinesToChat': 'Enviar linhas selecionadas para a conversa',
        'menu.sendDiffSnippetToChat': 'Enviar trecho selecionado para a conversa',
        'menu.copyDiffRef': 'Copiar a referência da seleção',
        'send.diffLinesCommit': '{lines} (commit {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (árvore de trabalho, {state})',
        'send.diffStaged': 'preparado',
        'send.diffUnstaged': 'não commitado',
        'send.diffNewLines': 'linhas {lines}',
        'send.diffOldLines': 'linhas {lines} (numeração antiga)',
        'history.empty': 'Este repositório ainda não tem commits',
        'history.loadMore': 'Carregar mais',
        'history.filter': 'Texto ou hash',
        'detail.files': 'Arquivos alterados',
        'detail.pick': 'Selecione um commit',
        'detail.back': 'Voltar ao histórico',
        'detail.noFiles': 'Nenhuma alteração de arquivo',
        'diff.empty': 'Nenhum diff textual para mostrar',
        'pane.diff': 'visualização do diff',
        'pane.resize': 'Arraste para redimensionar {name} (duplo clique restaura, setas ajustam)',
        'diff.binary': 'Arquivo binário',
        'diff.loading': 'Carregando diff...',
        'diff.codeLabel': 'Diff',
        'diff.wrapLabel': 'Quebrar linhas',
        'diff.unwrapLabel': 'Manter colunas do código',
        'diff.copy': 'Copiar',
        'diff.copied': 'Copiado',
        'toolbar.refresh': 'Atualizar',
      'more.sort': 'Ver & ordenar',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Alterações',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Ramificação',
      'more.remoteGroup': 'Remoto',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Etiquetas',
      'more.commitStaged': 'Commit dos ficheiros em staging...',
      'more.commitAll': 'Commit de tudo...',
      'more.undoCommit': 'Desfazer último commit',
      'more.rebaseAbort': 'Abortar rebase',
      'more.commitStagedAmend': 'Commit em staging (Amend)...',
      'more.commitAllAmend': 'Commit de tudo (Amend)...',
      'more.commitStagedSign': 'Commit em staging (Assinado)...',
      'more.commitAllSign': 'Commit de tudo (Assinado)...',
      'prompt.commitMessage': 'Mensagem de commit',
      'more.discardAll': 'Descartar todas as alterações...',
      'more.sync': 'Sincronizar (pull e push)',
      'more.syncRebase': 'Sincronizar (rebase e push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Pull de remoto',
      'more.pushForce': 'Push (Forçado)...',
      'more.pushTo': 'Push para remoto',
      'more.fetchAll': 'Fetch de todos os remotos',
      'more.deleteRemoteBranch': 'Eliminar ramo remoto...',
      'more.publish': 'Publicar ramificação...',
      'more.setUpstreamHead': 'Definir upstream da branch atual…',
      'more.unsetUpstreamHead': 'Remover upstream da branch atual',
      'more.addRemote': 'Adicionar remoto...',
      'more.removeRemote': 'Remover remoto...',
      'more.stashTracked': 'Stash (apenas rastreados)',
      'more.stashStaged': 'Stash de ficheiros em staging',
      'more.stashApplyPick': 'Aplicar stash...',
      'more.stashPopPick': 'Pop stash...',
      'more.stashDropAny': 'Eliminar stash...',
      'more.stashClear': 'Eliminar todos os stashes...',
      'stash.none': 'Sem stashes disponíveis',
      'more.tagDeleteRemote': 'Eliminar etiqueta remota...',
      'more.pushTags': 'Enviar etiquetas...',
      'confirm.undoCommit': 'Desfazer o último commit? As alterações ficam em staging.',
      'confirm.discardAll': 'Descartar TODAS as alterações não em staging e não rastreadas? Recuperável pelos avisos de desfazer (ficheiros em conflito excluídos).',
      'confirm.pushForce': 'O push forçado sobrescreve o remoto com esta ramificação (--force-with-lease recusa se outros enviaram). Continuar?',
      'confirm.deleteRemoteBranch': 'Eliminar o ramo {branch} em {remote}?',
      'confirm.remoteRemove': 'Remover o remoto {name}? A configuração de tracking vai junto.',
      'confirm.stashClear': 'Eliminar TODOS os stashes? Isto não pode ser desfeito.',
      'confirm.pushTags': 'Enviar todas as etiquetas para {remote}?',
      'prompt.remoteName': 'Nome do remoto',
      'prompt.remoteUrl': 'URL do remoto',
      'prompt.deleteRemoteTag': 'Etiqueta remota a eliminar (enviada para {remote})',
      'toolbar.more': 'Mais ações',
      'more.sortGit': 'Ordem do Git',
      'more.sortPath': 'Por caminho',
      'more.sortName': 'Por nome',
      'more.sortStatus': 'Por status',
      'more.clone': 'Clonar...',
      'more.stashPop': 'Pop do último stash',
      'more.deleteTag': 'Excluir tag...',
      'more.gitOutput': 'Mostrar saída do Git',
      'clone.title': 'Clonar repositório',
      'clone.url': 'URL do repositório',
      'clone.dir': 'Diretório de destino (caminho absoluto)',
      'clone.run': 'Clonar',
      'prompt.deleteTag': 'Nome da tag a excluir',
      'gitLog.title': 'Saída do Git',
      'gitLog.empty': 'Ainda não há execuções do Git',
        'toolbar.newBranch': 'Nova branch',
        'toolbar.fetch': 'Buscar',
        'toolbar.pull': 'Puxar',
        'toolbar.pullPicked': "Puxar {n} branch(es) selecionado(s)",
        'toolbar.fetchPicked': "Buscar {n} ref(s) selecionada(s)",
        'toolbar.pushPicked': "Enviar {n} branch(es) selecionado(s)",
        'toolbar.checkoutPicked': "Checkout do branch selecionado",
        'toolbar.deletePicked': "Excluir {n} ref(s) selecionada(s)",
        'toolbar.push': 'Enviar',
        'toolbar.tree': 'Painel de branches',
        'rail.more': 'Mais ações',
        'rail.settings': 'Configurações da barra de ações',
        'rail.openSettings': 'Abrir configurações do plugin',
        'settings.card.title': 'Configurações da janela de ferramentas Git',
        'settings.card.desc': 'Posição do painel, botões da barra de ações e mensagem de commit por IA',
        'settings.placement.title': 'Posição do painel',
        'settings.placement.tab': 'Mostrar a aba Git na área de conversa',
      'settings.composer.title': 'Branch sob a entrada',
      'settings.composer.hint': 'Mostra o branch atual sob a caixa de entrada, à esquerda das estatísticas da sessão — clique para alternar, em sincronia com o painel Git. Desligado, ele fica oculto.',
      'composer.branchHint': 'Trocar branch',
      'composer.detached': 'HEAD (destacado)',
      'modelRoute.pick': 'Escolher modelo',
      'modelRoute.trigger': 'Modelo da mensagem de commit por IA',
      'modelRoute.modelRow': 'Modelo',
      'modelRoute.effortRow': 'Raciocínio',
      'modelRoute.effortDefault': 'Seguir o padrão',
      'modelRoute.empty': 'Nenhum modelo disponível',
      'composer.inWorktree': 'Em checkout em outra worktree',
      'composer.busy': 'Operação Git em andamento…',
        'settings.placement.tabHint': 'Desligado, o painel continua disponível na barra lateral direita e no painel inferior.',
        'settings.placement.immersive': 'Modo imersivo (altura total, campo de entrada oculto)',
        'settings.placement.immersiveHint': 'Ativado, a aba Git ocupa toda a altura da conversa e o campo de entrada fica de lado; aprovações e perguntas continuam visíveis.',
        'preview.openFile': 'Abrir na pré-visualização do arquivo',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Escolher o arquivo para revisar',
        'lf.split': 'Alternar para a vista dividida',
        'lf.unified': 'Alternar para a vista unificada',
        'lf.wrap': 'Ativar quebra de linha',
        'lf.nowrap': 'Desativar quebra de linha',
        'lf.created': 'Arquivo criado',
        'lf.removedFile': 'Arquivo excluído',
        'lf.truncated': 'Mostrando as primeiras {count} linhas',
        'preview.title': 'Pré-visualização do Git',
        'preview.hint': 'Clique em “Mostrar diff” num arquivo ou commit — o diff abre aqui, na barra lateral.',
        'preview.boundary': 'Falha ao renderizar a pré-visualização — recarregue a página ou relate o problema.',
        'settings.rail.title': 'Barra de ações',
        'settings.rail.hint': 'Marque as ações exibidas na barra. A ordem é fixa; desmarcar oculta uma ação.',
        'settings.rail.unavailable': 'Este host não tem serviço de configurações; use «Configurações da barra de ações» no painel.',
        'settings.commit.title': 'Mensagem de commit por IA',
        'settings.commit.model': 'Modelo',
        'settings.commit.modelHint': 'Vazio = seguir esta sessão (provider/model)',
        'settings.commit.modelFollow': 'Seguir esta sessão',
        'settings.commit.reasoning': 'Esforço de raciocínio',
        'settings.commit.reasoningHint': 'Vazio = sem raciocínio',
        'settings.commit.reasoningDefault': 'Sem raciocínio (padrão)',
        'settings.commit.reasoningFollowHint': 'Ao seguir a sessão, o raciocínio fica sempre desativado; escolha um modelo fixo para escolher o nível',
        'settings.commit.prompt': 'Instruções extras',
        'settings.commit.promptHint': 'ex.: Conventional Commits, assunto em português, até 72 caracteres',
        'settings.commit.tooLong': 'Só os primeiros {n} caracteres são salvos',
        'changes.aiWrite': 'Escrever com IA',
        'changes.aiBusy': 'Gerando…',
        'changes.aiQuota': 'Consome a sua cota',
        'changes.aiOverwriteTitle': 'Substituir o rascunho atual?',
        'changes.aiOverwriteText': 'O texto da IA substituirá a mensagem que você digitou (dá para desfazer).',
        'changes.aiUndo': 'Desfazer',
        'changes.aiFailed': 'Não foi possível gerar:',
        'changes.aiNotice': 'Algumas alterações não foram enviadas ao modelo (truncadas ou descartadas); a mensagem pode ficar incompleta.',
        'settings.rail.writeFailed': 'A configuração não foi salva; o interruptor voltou ao lugar. Tente de novo.',
        'settings.rail.readonly': 'Este host fornece a configuração somente para leitura.',
        'rail.settingsHint': 'Arraste ou use as setas para reordenar; o olho alterna a visibilidade',
        'rail.reset': 'Restaurar padrões',
        'rail.up': 'Mover para cima',
        'rail.down': 'Mover para baixo',
        'rail.show': 'Mostrar',
        'rail.hide': 'Ocultar',
        'action.unavailable': 'Indisponível no estado atual',
        'filter.branch': 'Branch',
        'filter.user': 'Autor',
        'history.me': 'Eu',
        'filter.date': 'Data',
        'filter.path': 'Caminho',
        'filter.all': 'Tudo',
        'filter.today': 'Hoje',
        'filter.week': 'Últimos 7 dias',
        'filter.month': 'Últimos 30 dias',
        'filter.year': 'Este ano',
        'filter.pathPlaceholder': 'Filtrar por caminho (Enter)',
        'filter.sortDesc': 'Mais recentes primeiro',
        'filter.sortAsc': 'Mais antigos primeiro',
        'filter.clear': 'Limpar filtros',
        'filter.none': 'Nenhum commit correspondente',
        'toast.undo': 'Desfazer',
        'toast.close': 'Fechar',
        'toast.branchDeleted': 'Branch {name} excluída',
        'toast.stashDropped': 'Stash {ref} descartado',
        'toast.discarded': 'Alterações em {path} descartadas',
        'toast.discardNoUndo': 'Alterações em {path} descartadas (grandes demais para desfazer)',
        'toast.restored': 'Restaurado',
        'toast.sentToChat': 'Enviado para a caixa de entrada',
        'toast.sendCopied': 'Não foi possível enviar — copiado para a área de transferência',
        'undo.menu': 'Excluídos recentemente (desfazer)',
        'undo.empty': 'Nada para desfazer agora',
        'undo.branch': 'Branch',
        'undo.stash': 'Stash',
        'undo.discard': 'Descarte',
        'confirm.typeName': 'Digite {name} para confirmar',
        'confirm.protected': '{name} é uma branch principal. Excluí-la é arriscado, então digite o nome da branch para confirmar —— um aviso ainda poderá trazê-la de volta.',
        'discard.untracked.confirm': 'Excluir o arquivo não rastreado {path}? O conteúdo será removido —— um aviso ainda poderá trazê-lo de volta.',
        'stashDrop.confirm': 'Descartar o stash {ref}? Um aviso ainda poderá trazê-lo de volta.',
        'operation.merge': 'Mesclagem em andamento',
        'operation.rebase': 'Rebase em andamento',
        'operation.cherry-pick': 'Cherry-pick em andamento',
        'operation.revert': 'Reversão em andamento',
        'operation.bisect': 'Bisect em andamento',
        'operation.hint': 'Este repositório ainda tem uma operação de várias etapas aberta —— conclua ou aborte antes das ações de branch',
        'confirm.title': 'Confirmar',
        'confirm.cancel': 'Cancelar',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Nome da nova branch (criada e com checkout)',
        'prompt.createTracking': 'Criar branch local a partir da remota',
        'prompt.renameBranch': 'Renomear branch',
        'prompt.newTag': 'Nome da nova tag',
        'prompt.fromHead': 'HEAD atual',
        'error.dismiss': 'Fechar',
        'status.loading': 'Lendo...',
        'status.busy': 'Trabalhando...',
        'counts.staged': 'Preparado {n}',
        'counts.ignored': 'Ignorado {n}',
        'counts.unstaged': 'Alterações {n}',
        'counts.untracked': 'Não rastreado {n}',
        'counts.conflicted': 'Conflitos {n}',
        'push.confirm': 'Enviar {branch} para {upstream}?',
        'push.confirmMany': "Enviar {n} branch(es): {names}?",
        'delete.confirm': 'Excluir a branch {name}? Um aviso ainda poderá trazê-la de volta (o git continua recusando branches não mescladas).',
        'discard.confirm': 'Descartar as alterações em {path}? O conteúdo da árvore de trabalho será sobrescrito —— um aviso ainda poderá trazê-lo de volta.',
        'resetHard.confirm': 'Redefinição forçada para {hash}? Alterações não commitadas serão perdidas.',
        'resetSoft.confirm': 'Mover HEAD para {hash} (árvore de trabalho mantida)?',
        'checkoutCommit.confirm': 'Fazer checkout do commit {hash}? (HEAD destacado)',
      },
      /* locale: it */
      'it': {
        'title': 'Git',
        'description': 'Pannello Git di livello IDE: albero dei branch / grafo dei commit / modifiche',
        'repo.label': 'Repository',
        'repo.workspace': 'area di lavoro',
        'repo.nested': 'annidato',
        'repo.none': 'Questa area di lavoro non è un repository Git',
        'repo.pick': 'Scegli un repository da esaminare',
        'repo.empty': 'Nessun repository Git trovato in questa area di lavoro',
        'repo.switch': 'Cambia repository',
        'branch.switch': 'Cambia branch',
        'seg.changes': 'Modifiche {n}',
        'seg.history': 'Cronologia',
        'branches.local': 'Locali',
        'branches.remote': 'Remoti',
        'branches.tags': 'Tag',
        'branches.head': 'HEAD (branch corrente)',
        'branches.favorites': 'Preferiti',
        'branches.starHint': "Preferito",
        'branches.pickHint': 'Clic per selezionare, doppio clic apre la cronologia',
        'branches.headHint': 'Doppio clic apre la cronologia del branch corrente',
        'branches.worktree': 'Già in checkout in un altro albero di lavoro',
        'action.stash': 'Stash',
        'action.favorite': 'Aggiungi/rimuovi il branch corrente dai preferiti',
        'action.newTagHere': 'Nuovo tag sul commit corrente...',
        'stash.push': 'Metti in stash le modifiche correnti',
        'stash.apply': 'Applica lo stash più recente',
        'stash.drop': 'Elimina lo stash più recente',
        'stash.count': '{n} stash',
        'note.noChanges': 'Nessuna modifica in sospeso',
        'note.noBranches': 'Nessun altro branch',
        'branches.filter': 'Branch o tag',
        'changes.title': 'Modifiche',
        'changes.staged': 'In stage',
        'changes.unstaged': 'Modifiche',
        'changes.untracked': 'Non tracciati',
        'changes.conflicted': 'Conflitti',
        'changes.empty': 'Nessuna modifica in sospeso',
        'changes.commitPlaceholder': 'Messaggio di commit (Ctrl+Invio)',
        'changes.commit': 'Esegui commit',
        'changes.amend': 'Correggi l’ultimo commit',
        'changes.stageAll': 'Metti tutto in stage',
        'selection.count': '{n} selezionato/i',
        'selection.copied': '{n} elemento/i copiato/i',
        'selection.copyPaths': 'Copia percorsi',
        'selection.clear': 'Azzera selezione',
        'action.copyName': 'Copia nome',
        'menu.copyNamesN': 'Copia {n} nomi',
        'menu.copyHashesN': 'Copia {n} hash',
        'menu.copyPathsN': 'Copia {n} percorsi',
        'menu.stageN': 'Metti in stage {n} elementi',
        'menu.unstageN': 'Rimuovi {n} elementi dallo stage',
        'menu.discardN': 'Scarta {n} elementi…',
        'menu.cherryN': 'Cherry-pick di {n} commit',
        'menu.deleteLocalN': 'Elimina {n} branch locali…',
        'menu.deleteRemoteN': 'Elimina {n} branch remoti…',
        'menu.deleteTagsN': 'Elimina {n} tag…',
        'confirm.deleteRefs': 'Eliminare i riferimenti selezionati? {b} locali, {r} remoti, {g} tag.',
        'confirm.discardMany': 'Scartare le modifiche non commitate di {n} file?',
        'confirm.discardManyUntracked': '{m} file non tracciati saranno eliminati definitivamente.',
        'toast.branchesDeleted': '{n} branch eliminati',
        'changes.unstageAll': 'Rimuovi tutto dallo stage',
        'changes.groupBy': 'Raggruppa per',
        'changes.groupFlat': 'Elenco piatto',
        'changes.groupDir': 'Per directory',
        'changes.expandAll': 'Espandi tutto',
        'changes.foldAll': 'Comprimi tutto',
        'changes.showIgnored': 'Mostra i file ignorati',
        'changes.rootDir': '(radice)',
        'changes.commitAndPush': 'Commit e push',
        'action.stage': 'Metti in stage',
        'action.unstage': 'Rimuovi dallo stage',
        'action.discard': 'Scarta le modifiche',
        'action.showDiff': 'Mostra il diff',
        'action.copyPath': 'Copia percorso',
        'action.checkout': 'Checkout',
        'action.float': 'Fluttua questa pagina',
        'action.dock': 'Riaggancia',
        'action.split': 'Dividi',
        'action.fullscreen': 'Schermo intero',
        'action.exitFullscreen': 'Esci da schermo intero',
        'action.newBranchFrom': 'Nuovo branch da qui...',
        'action.setUpstream': 'Imposta upstream…',
        'action.unsetUpstream': 'Rimuovi upstream',
        'action.createLocalBranch': 'Crea branch locale…',
        'action.newBranchHere': 'Nuovo branch qui...',
        'action.rename': 'Rinomina...',
        'action.delete': 'Elimina',
        'action.mergeIntoCurrent': 'Unisci nel branch corrente',
        'action.rebaseCurrentOnto': 'Rebase del branch corrente su questo',
        'action.compare': 'Confronta con il branch corrente',
        'action.update': 'Aggiorna (fetch)',
        'action.push': 'Push',
        'action.newTag': 'Nuovo tag...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Annulla il commit',
        'action.resetSoft': 'Ripristina qui (mantieni le modifiche)',
        'action.resetHard': 'Ripristina qui (scarta le modifiche)',
        'action.copyHash': 'Copia il numero di revisione',
        'action.details': 'Dettagli del commit',
        'menu.sendToChat': 'Invia alla conversazione',
        'send.commitText': 'commit git {hash} "{subject}" (repository {repo})',
        'send.branchText': 'branch git {name} (repository {repo})',
        'menu.sendDiffLinesToChat': 'Invia le righe selezionate alla conversazione',
        'menu.sendDiffSnippetToChat': 'Invia il frammento selezionato alla conversazione',
        'menu.copyDiffRef': 'Copia il riferimento alla selezione',
        'send.diffLinesCommit': '{lines} (commit {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (albero di lavoro, {state})',
        'send.diffStaged': 'in stage',
        'send.diffUnstaged': 'senza commit',
        'send.diffNewLines': 'righe {lines}',
        'send.diffOldLines': 'righe {lines} (numerazione precedente)',
        'history.empty': 'Questo repository non ha ancora commit',
        'history.loadMore': 'Carica altro',
        'history.filter': 'Testo o hash',
        'detail.files': 'File modificati',
        'detail.pick': 'Seleziona un commit',
        'detail.back': 'Torna alla cronologia',
        'detail.noFiles': 'Nessuna modifica ai file',
        'diff.empty': 'Nessun diff testuale da mostrare',
        'pane.diff': 'vista diff',
        'pane.resize': 'Trascina per ridimensionare {name} (doppio clic ripristina, frecce per regolare)',
        'diff.binary': 'File binario',
        'diff.loading': 'Caricamento del diff...',
        'diff.codeLabel': 'Diff',
        'diff.wrapLabel': 'A capo automatico',
        'diff.unwrapLabel': 'Mantieni le colonne originali',
        'diff.copy': 'Copia',
        'diff.copied': 'Copiato',
        'toolbar.refresh': 'Aggiorna',
      'more.sort': 'Visualizza e ordina',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Modifiche',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Branch',
      'more.remoteGroup': 'Remoto',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Tag',
      'more.commitStaged': 'Commit dei file in staging...',
      'more.commitAll': 'Esegui commit di tutto...',
      'more.undoCommit': 'Annulla ultimo commit',
      'more.rebaseAbort': 'Interrompi rebase',
      'more.commitStagedAmend': 'Commit in staging (Amend)...',
      'more.commitAllAmend': 'Commit di tutto (Amend)...',
      'more.commitStagedSign': 'Commit in staging (Firmato)...',
      'more.commitAllSign': 'Commit di tutto (Firmato)...',
      'prompt.commitMessage': 'Messaggio di commit',
      'more.discardAll': 'Scarta tutte le modifiche...',
      'more.sync': 'Sincronizza (pull e push)',
      'more.syncRebase': 'Sincronizza (rebase e push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Pull da remoto',
      'more.pushForce': 'Push (Forza)...',
      'more.pushTo': 'Push su remoto',
      'more.fetchAll': 'Fetch da tutti i remoti',
      'more.deleteRemoteBranch': 'Elimina branch remoto...',
      'more.publish': 'Pubblica branch...',
      'more.setUpstreamHead': 'Imposta upstream del branch corrente…',
      'more.unsetUpstreamHead': 'Rimuovi upstream del branch corrente',
      'more.addRemote': 'Aggiungi remoto...',
      'more.removeRemote': 'Rimuovi remoto...',
      'more.stashTracked': 'Stash (solo tracciati)',
      'more.stashStaged': 'Stash dei file in staging',
      'more.stashApplyPick': 'Applica stash...',
      'more.stashPopPick': 'Pop stash...',
      'more.stashDropAny': 'Elimina stash...',
      'more.stashClear': 'Elimina tutti gli stash...',
      'stash.none': 'Nessuno stash disponibile',
      'more.tagDeleteRemote': 'Elimina tag remoto...',
      'more.pushTags': 'Esegui push dei tag...',
      'confirm.undoCommit': 'Annullare l\'ultimo commit? Le modifiche restano in staging.',
      'confirm.discardAll': 'Scartare TUTTE le modifiche non in staging e non tracciate? Recuperabili dai toast di annullamento (file in conflitto esclusi).',
      'confirm.pushForce': 'Il push forzato sovrascrive il remoto con questo branch (--force-with-lease rifiuta se altri hanno fatto push). Continuare?',
      'confirm.deleteRemoteBranch': 'Eliminare il branch {branch} su {remote}?',
      'confirm.remoteRemove': 'Rimuovere il remoto {name}? La configurazione di tracking viene rimossa.',
      'confirm.stashClear': 'Eliminare TUTTI gli stash? Operazione irreversibile.',
      'confirm.pushTags': 'Eseguire il push di tutti i tag su {remote}?',
      'prompt.remoteName': 'Nome remoto',
      'prompt.remoteUrl': 'URL remoto',
      'prompt.deleteRemoteTag': 'Tag remoto da eliminare (verrà rimosso da {remote})',
      'toolbar.more': 'Altre azioni',
      'more.sortGit': 'Ordine Git',
      'more.sortPath': 'Per percorso',
      'more.sortName': 'Per nome',
      'more.sortStatus': 'Per stato',
      'more.clone': 'Clona...',
      'more.stashPop': 'Pop dell\'ultimo stash',
      'more.deleteTag': 'Elimina tag...',
      'more.gitOutput': 'Mostra output Git',
      'clone.title': 'Clona repository',
      'clone.url': 'URL del repository',
      'clone.dir': 'Directory di destinazione (percorso assoluto)',
      'clone.run': 'Clona',
      'prompt.deleteTag': 'Nome del tag da eliminare',
      'gitLog.title': 'Output Git',
      'gitLog.empty': 'Nessuna esecuzione Git registrata',
        'toolbar.newBranch': 'Nuovo branch',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "Esegui pull di {n} branch selezionati",
        'toolbar.fetchPicked': "Esegui fetch di {n} ref selezionati",
        'toolbar.pushPicked': "Esegui push di {n} branch selezionati",
        'toolbar.checkoutPicked': "Checkout del branch selezionato",
        'toolbar.deletePicked': "Elimina {n} ref selezionati",
        'toolbar.push': 'Push',
        'toolbar.tree': 'Riquadro dei branch',
        'rail.more': 'Altre azioni',
        'rail.settings': 'Impostazioni della barra delle azioni',
        'rail.openSettings': 'Apri le impostazioni del plugin',
        'settings.card.title': 'Impostazioni della finestra strumenti Git',
        'settings.card.desc': 'Posizione del pannello, pulsanti della barra azioni e messaggio di commit con IA',
        'settings.placement.title': 'Posizione del pannello',
        'settings.placement.tab': 'Mostra la scheda Git nell’area conversazione',
      'settings.composer.title': 'Ramo sotto la casella di input',
      'settings.composer.hint': 'Mostra il ramo corrente sotto la casella di input, a sinistra delle statistiche di sessione — clic per cambiare, sincronizzato con il pannello Git. Disattivato, resta nascosto.',
      'composer.branchHint': 'Cambia ramo',
      'composer.detached': 'HEAD (staccato)',
      'modelRoute.pick': 'Scegli modello',
      'modelRoute.trigger': 'Modello dei messaggi di commit IA',
      'modelRoute.modelRow': 'Modello',
      'modelRoute.effortRow': 'Ragionamento',
      'modelRoute.effortDefault': 'Segui il predefinito',
      'modelRoute.empty': 'Nessun modello disponibile',
      'composer.inWorktree': 'Estratto in un altro worktree',
      'composer.busy': 'Operazione Git in corso…',
        'settings.placement.tabHint': 'Da spento, il pannello resta raggiungibile dalla barra laterale destra e dal pannello inferiore.',
        'settings.placement.immersive': 'Modalità immersiva (altezza piena, input nascosto)',
        'settings.placement.immersiveHint': 'Attiva, la scheda Git occupa tutta l’altezza della conversazione e la barra di input resta nascosta; approvazioni e domande restano visibili.',
        'preview.openFile': 'Apri nell’anteprima del file',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Scegli il file da esaminare',
        'lf.split': 'Passa alla vista affiancata',
        'lf.unified': 'Passa alla vista unificata',
        'lf.wrap': 'Attiva il ritorno a capo',
        'lf.nowrap': 'Disattiva il ritorno a capo',
        'lf.created': 'File creato',
        'lf.removedFile': 'File eliminato',
        'lf.truncated': 'Mostrate le prime {count} righe',
        'preview.title': 'Anteprima Git',
        'preview.hint': 'Fai clic su «Mostra diff» su un file o un commit: il diff si apre qui, nella barra laterale.',
        'preview.boundary': 'Impossibile visualizzare l\'anteprima — ricarica la pagina o segnala il problema.',
        'settings.rail.title': 'Barra delle azioni',
        'settings.rail.hint': 'Seleziona le azioni mostrate sulla barra. L’ordine è fisso; deselezionando se ne nasconde una.',
        'settings.rail.unavailable': 'Questo host non ha un servizio di impostazioni; usa «Impostazioni barra azioni» nel pannello.',
        'settings.commit.title': 'Messaggio di commit con IA',
        'settings.commit.model': 'Modello',
        'settings.commit.modelHint': 'Vuoto = segui questa sessione (provider/model)',
        'settings.commit.modelFollow': 'Segui questa sessione',
        'settings.commit.reasoning': 'Sforzo di ragionamento',
        'settings.commit.reasoningHint': 'Vuoto = senza ragionamento',
        'settings.commit.reasoningDefault': 'Senza ragionamento (predefinito)',
        'settings.commit.reasoningFollowHint': 'Seguendo la sessione il ragionamento resta sempre spento; scegli un modello fisso per sceglierne il livello',
        'settings.commit.prompt': 'Istruzioni aggiuntive',
        'settings.commit.promptHint': 'es. Conventional Commits, oggetto in italiano, max 72 caratteri',
        'settings.commit.tooLong': 'Solo i primi {n} caratteri vengono salvati',
        'changes.aiWrite': 'Scrivi con l’IA',
        'changes.aiBusy': 'Generazione…',
        'changes.aiQuota': 'Consuma la tua quota',
        'changes.aiOverwriteTitle': 'Sostituire la bozza attuale?',
        'changes.aiOverwriteText': 'Il testo dell’IA sostituirà il messaggio digitato (puoi annullare).',
        'changes.aiUndo': 'Annulla',
        'changes.aiFailed': 'Scrittura non riuscita:',
        'changes.aiNotice': 'Alcune modifiche non sono state inviate al modello (troncate o scartate); il messaggio può essere incompleto.',
        'settings.rail.writeFailed': 'L’impostazione non è stata salvata; l’interruttore è tornato indietro. Riprova.',
        'settings.rail.readonly': 'Questo host fornisce la configurazione in sola lettura.',
        'rail.settingsHint': 'Trascina o usa le frecce per riordinare; l’occhio attiva o disattiva la visibilità',
        'rail.reset': 'Ripristina i valori predefiniti',
        'rail.up': 'Sposta su',
        'rail.down': 'Sposta giù',
        'rail.show': 'Mostra',
        'rail.hide': 'Nascondi',
        'action.unavailable': 'Non disponibile nello stato attuale',
        'filter.branch': 'Branch',
        'filter.user': 'Autore',
        'history.me': 'Io',
        'filter.date': 'Data',
        'filter.path': 'Percorso',
        'filter.all': 'Tutti',
        'filter.today': 'Oggi',
        'filter.week': 'Ultimi 7 giorni',
        'filter.month': 'Ultimi 30 giorni',
        'filter.year': 'Quest’anno',
        'filter.pathPlaceholder': 'Filtra per percorso (Invio)',
        'filter.sortDesc': 'Più recenti prima',
        'filter.sortAsc': 'Più vecchi prima',
        'filter.clear': 'Cancella i filtri',
        'filter.none': 'Nessun commit corrispondente',
        'toast.undo': 'Annulla',
        'toast.close': 'Chiudi',
        'toast.branchDeleted': 'Branch {name} eliminato',
        'toast.stashDropped': 'Stash {ref} eliminato',
        'toast.discarded': 'Modifiche in {path} scartate',
        'toast.discardNoUndo': 'Modifiche in {path} scartate (troppo grandi per essere annullate)',
        'toast.restored': 'Ripristinato',
        'toast.sentToChat': 'Inviato nella casella di input',
        'toast.sendCopied': 'Impossibile inviare — copiato negli appunti',
        'undo.menu': 'Eliminati di recente (annulla)',
        'undo.empty': 'Niente da annullare al momento',
        'undo.branch': 'Branch',
        'undo.stash': 'Stash',
        'undo.discard': 'Scarto',
        'confirm.typeName': 'Digita {name} per confermare',
        'confirm.protected': '{name} è un branch principale. Eliminarlo è rischioso, quindi digita il nome del branch per confermare —— un avviso potrà comunque riportarlo indietro.',
        'discard.untracked.confirm': 'Eliminare il file non tracciato {path}? Il contenuto viene rimosso —— un avviso potrà comunque riportarlo indietro.',
        'stashDrop.confirm': 'Eliminare lo stash {ref}? Un avviso potrà comunque riportarlo indietro.',
        'operation.merge': 'Unione in corso',
        'operation.rebase': 'Rebase in corso',
        'operation.cherry-pick': 'Cherry-pick in corso',
        'operation.revert': 'Annullamento in corso',
        'operation.bisect': 'Bisect in corso',
        'operation.hint': 'Questo repository ha ancora un’operazione a più passaggi aperta —— completala o interrompila prima delle azioni sui branch',
        'confirm.title': 'Conferma',
        'confirm.cancel': 'Annulla',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Nome del nuovo branch (creato e messo in checkout)',
        'prompt.createTracking': 'Crea un branch locale dal branch remoto',
        'prompt.renameBranch': 'Rinomina il branch',
        'prompt.newTag': 'Nome del nuovo tag',
        'prompt.fromHead': 'HEAD corrente',
        'error.dismiss': 'Chiudi',
        'status.loading': 'Lettura...',
        'status.busy': 'In corso...',
        'counts.staged': 'In stage {n}',
        'counts.ignored': 'Ignorati {n}',
        'counts.unstaged': 'Modifiche {n}',
        'counts.untracked': 'Non tracciati {n}',
        'counts.conflicted': 'Conflitti {n}',
        'push.confirm': 'Inviare {branch} a {upstream}?',
        'push.confirmMany': "Eseguire il push di {n} branch: {names}?",
        'delete.confirm': 'Eliminare il branch {name}? Un avviso potrà comunque riportarlo indietro (git continua a rifiutare i branch non uniti).',
        'discard.confirm': 'Scartare le modifiche in {path}? Il contenuto dell’albero di lavoro viene sovrascritto —— un avviso potrà comunque riportarlo indietro.',
        'resetHard.confirm': 'Reset forzato a {hash}? Le modifiche non committate andranno perse.',
        'resetSoft.confirm': 'Spostare HEAD a {hash} (albero di lavoro mantenuto)?',
        'checkoutCommit.confirm': 'Fare checkout del commit {hash}? (HEAD scollegato)',
      },
      /* locale: nl */
      'nl': {
        'title': 'Git',
        'description': 'Git-paneel op IDE-niveau: branchboom / commit-graaf / wijzigingen',
        'repo.label': 'Repository',
        'repo.workspace': 'werkruimte',
        'repo.nested': 'genest',
        'repo.none': 'Deze werkruimte is geen Git-repository',
        'repo.pick': 'Kies een repository om te bekijken',
        'repo.empty': 'Geen Git-repository gevonden in deze werkruimte',
        'repo.switch': 'Wissel van repository',
        'branch.switch': 'Wissel van branch',
        'seg.changes': 'Wijzigingen {n}',
        'seg.history': 'Geschiedenis',
        'branches.local': 'Lokaal',
        'branches.remote': 'Extern',
        'branches.tags': 'Tags',
        'branches.head': 'HEAD (huidige branch)',
        'branches.favorites': 'Favorieten',
        'branches.starHint': "Favoriet",
        'branches.pickHint': 'Klik om te selecteren, dubbelklik opent de geschiedenis',
        'branches.headHint': 'Dubbelklik opent de geschiedenis van de huidige branch',
        'branches.worktree': 'Al uitgecheckt in een andere werkboom',
        'action.stash': 'Stash',
        'action.favorite': 'Huidige branch aan favorieten toevoegen/onttrekken',
        'action.newTagHere': 'Nieuwe tag op de huidige commit...',
        'stash.push': 'Huidige wijzigingen stashen',
        'stash.apply': 'Nieuwste stash toepassen',
        'stash.drop': 'Nieuwste stash verwijderen',
        'stash.count': '{n} stashes',
        'note.noChanges': 'Geen openstaande wijzigingen',
        'note.noBranches': 'Geen andere branches',
        'branches.filter': 'Branch of tag',
        'changes.title': 'Wijzigingen',
        'changes.staged': 'Gestaged',
        'changes.unstaged': 'Wijzigingen',
        'changes.untracked': 'Niet gevolgd',
        'changes.conflicted': 'Conflicten',
        'changes.empty': 'Geen openstaande wijzigingen',
        'changes.commitPlaceholder': 'Commit-bericht (Ctrl+Enter)',
        'changes.commit': 'Committen',
        'changes.amend': 'Laatste commit aanvullen',
        'changes.stageAll': 'Alles stagen',
        'selection.count': '{n} geselecteerd',
        'selection.copied': '{n} item(s) gekopieerd',
        'selection.copyPaths': 'Paden kopiëren',
        'selection.clear': 'Selectie wissen',
        'action.copyName': 'Naam kopiëren',
        'menu.copyNamesN': '{n} namen kopiëren',
        'menu.copyHashesN': '{n} hashes kopiëren',
        'menu.copyPathsN': '{n} paden kopiëren',
        'menu.stageN': '{n} items stagen',
        'menu.unstageN': '{n} items unstagen',
        'menu.discardN': '{n} items weggooien…',
        'menu.cherryN': '{n} commits cherry-picken',
        'menu.deleteLocalN': '{n} lokale branches verwijderen…',
        'menu.deleteRemoteN': '{n} remote branches verwijderen…',
        'menu.deleteTagsN': '{n} tags verwijderen…',
        'confirm.deleteRefs': 'De geselecteerde referenties verwijderen? {b} lokaal, {r} remote, {g} tag(s).',
        'confirm.discardMany': 'Niet-gecommitte wijzigingen van {n} bestanden weggooien?',
        'confirm.discardManyUntracked': '{m} niet-gevolgde bestand(en) worden definitief verwijderd.',
        'toast.branchesDeleted': '{n} branch(es) verwijderd',
        'changes.unstageAll': 'Alles unstagen',
        'changes.groupBy': 'Groeperen op',
        'changes.groupFlat': 'Platte lijst',
        'changes.groupDir': 'Op map',
        'changes.expandAll': 'Alles uitklappen',
        'changes.foldAll': 'Alles inklappen',
        'changes.showIgnored': 'Genegeerde bestanden tonen',
        'changes.rootDir': '(hoofdmap)',
        'changes.commitAndPush': 'Committen en pushen',
        'action.stage': 'Stagen',
        'action.unstage': 'Unstagen',
        'action.discard': 'Wijzigingen weggooien',
        'action.showDiff': 'Diff tonen',
        'action.copyPath': 'Pad kopiëren',
        'action.checkout': 'Uitchecken',
        'action.float': 'Deze pagina losmaken',
        'action.dock': 'Terugdokken',
        'action.split': 'Splitsen',
        'action.fullscreen': 'Volledig scherm',
        'action.exitFullscreen': 'Volledig scherm sluiten',
        'action.newBranchFrom': 'Nieuwe branch vanaf hier...',
        'action.setUpstream': 'Upstream instellen…',
        'action.unsetUpstream': 'Upstream verwijderen',
        'action.createLocalBranch': 'Lokale branch maken…',
        'action.newBranchHere': 'Nieuwe branch hier...',
        'action.rename': 'Hernoemen...',
        'action.delete': 'Verwijderen',
        'action.mergeIntoCurrent': 'Samenvoegen in huidige branch',
        'action.rebaseCurrentOnto': 'Huidige branch rebasen op deze',
        'action.compare': 'Vergelijken met huidige branch',
        'action.update': 'Bijwerken (fetch)',
        'action.push': 'Pushen',
        'action.newTag': 'Nieuwe tag...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Commit terugdraaien',
        'action.resetSoft': 'Hierheen resetten (wijzigingen behouden)',
        'action.resetHard': 'Hierheen resetten (wijzigingen weggooien)',
        'action.copyHash': 'Revisienummer kopiëren',
        'action.details': 'Commit-details',
        'menu.sendToChat': 'Naar het gesprek verzenden',
        'send.commitText': 'git-commit {hash} "{subject}" (repository {repo})',
        'send.branchText': 'git-branch {name} (repository {repo})',
        'menu.sendDiffLinesToChat': 'Geselecteerde regels naar het gesprek verzenden',
        'menu.sendDiffSnippetToChat': 'Geselecteerd fragment naar het gesprek verzenden',
        'menu.copyDiffRef': 'Selectiereferentie kopiëren',
        'send.diffLinesCommit': '{lines} (commit {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (werkboom, {state})',
        'send.diffStaged': 'staged',
        'send.diffUnstaged': 'niet vastgelegd',
        'send.diffNewLines': 'regels {lines}',
        'send.diffOldLines': 'regels {lines} (oude nummering)',
        'history.empty': 'Deze repository heeft nog geen commits',
        'history.loadMore': 'Meer laden',
        'history.filter': 'Tekst of hash',
        'detail.files': 'Gewijzigde bestanden',
        'detail.pick': 'Selecteer een commit',
        'detail.back': 'Terug naar geschiedenis',
        'detail.noFiles': 'Geen bestandswijzigingen',
        'diff.empty': 'Geen tekstuele diff om te tonen',
        'pane.diff': 'diff-weergave',
        'pane.resize': 'Sleep om {name} te vergroten (dubbelklik herstelt, pijltjes stellen fijn af)',
        'diff.binary': 'Binair bestand',
        'diff.loading': 'Diff laden...',
        'diff.codeLabel': 'Diff',
        'diff.wrapLabel': 'Regels afbreken',
        'diff.unwrapLabel': 'Bronkolommen behouden',
        'diff.copy': 'Kopiëren',
        'diff.copied': 'Gekopieerd',
        'toolbar.refresh': 'Vernieuwen',
      'more.sort': 'Weergeven & sorteren',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Wijzigingen',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Branch',
      'more.remoteGroup': 'Remote',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Tags',
      'more.commitStaged': 'Staged committen...',
      'more.commitAll': 'Alles committen...',
      'more.undoCommit': 'Laatste commit ongedaan maken',
      'more.rebaseAbort': 'Rebase afbreken',
      'more.commitStagedAmend': 'Staged committen (Amend)...',
      'more.commitAllAmend': 'Alles committen (Amend)...',
      'more.commitStagedSign': 'Staged committen (Getekend)...',
      'more.commitAllSign': 'Alles committen (Getekend)...',
      'prompt.commitMessage': 'Commitbericht',
      'more.discardAll': 'Alle wijzigingen verwijderen...',
      'more.sync': 'Synchroniseren (pull, dan push)',
      'more.syncRebase': 'Synchroniseren (rebase, dan push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Pull van remote',
      'more.pushForce': 'Push (Forceer)...',
      'more.pushTo': 'Naar remote pushen',
      'more.fetchAll': 'Van alle remotes halen',
      'more.deleteRemoteBranch': 'Remote branch verwijderen...',
      'more.publish': 'Branch publiceren...',
      'more.setUpstreamHead': 'Upstream instellen voor huidige branch…',
      'more.unsetUpstreamHead': 'Upstream van huidige branch verwijderen',
      'more.addRemote': 'Remote toevoegen...',
      'more.removeRemote': 'Remote verwijderen...',
      'more.stashTracked': 'Stash (alleen gevolgd)',
      'more.stashStaged': 'Staged stashen',
      'more.stashApplyPick': 'Stash toepassen...',
      'more.stashPopPick': 'Stash poppen...',
      'more.stashDropAny': 'Stash verwijderen...',
      'more.stashClear': 'Alle stashes verwijderen...',
      'stash.none': 'Geen stashes beschikbaar',
      'more.tagDeleteRemote': 'Remote tag verwijderen...',
      'more.pushTags': 'Tags pushen...',
      'confirm.undoCommit': 'Laatste commit ongedaan maken? De wijzigingen blijven staged.',
      'confirm.discardAll': 'ALLE niet-staged en niet-gevolgde wijzigingen verwijderen? Herstelbaar via undo-toasts (conflictbestanden uitgezonderd).',
      'confirm.pushForce': 'Force push overschrijft de remote met deze branch (--force-with-lease weigert bij en en ander zijn push). Doorgaan?',
      'confirm.deleteRemoteBranch': 'Branch {branch} op {remote} verwijderen?',
      'confirm.remoteRemove': 'Remote {name} verwijderen? De trackingconfiguratie gaat mee.',
      'confirm.stashClear': 'ALLE stashes verwijderen? Dit kan niet ongedaan worden gemaakt.',
      'confirm.pushTags': 'Alle tags naar {remote} pushen?',
      'prompt.remoteName': 'Remote-naam',
      'prompt.remoteUrl': 'Remote-URL',
      'prompt.deleteRemoteTag': 'Te verwijderen remote tag (wordt naar {remote} gepusht)',
      'toolbar.more': 'Meer acties',
      'more.sortGit': 'Git-volgorde',
      'more.sortPath': 'Op pad',
      'more.sortName': 'Op naam',
      'more.sortStatus': 'Op status',
      'more.clone': 'Klonen...',
      'more.stashPop': 'Pop laatste stash',
      'more.deleteTag': 'Tag verwijderen...',
      'more.gitOutput': 'Git-uitvoer tonen',
      'clone.title': 'Repository klonen',
      'clone.url': 'Repository-URL',
      'clone.dir': 'Doelmap (absoluut pad)',
      'clone.run': 'Klonen',
      'prompt.deleteTag': 'Naam van de te verwijderen tag',
      'gitLog.title': 'Git-uitvoer',
      'gitLog.empty': 'Nog geen Git-uitvoeringen',
        'toolbar.newBranch': 'Nieuwe branch',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "{n} geselecteerde branch(es) pullen",
        'toolbar.fetchPicked': "{n} geselecteerde ref(s) fetchen",
        'toolbar.pushPicked': "{n} geselecteerde branch(es) pushen",
        'toolbar.checkoutPicked': "Geselecteerde branch uitchecken",
        'toolbar.deletePicked': "{n} geselecteerde ref(s) verwijderen",
        'toolbar.push': 'Push',
        'toolbar.tree': 'Branchpaneel',
        'rail.more': 'Meer acties',
        'rail.settings': 'Instellingen van de actiebalk',
        'rail.openSettings': 'Plugin-instellingen openen',
        'settings.card.title': 'Instellingen van het Git-werkvenster',
        'settings.card.desc': 'Paneelplaatsing, knoppen van de actiebalk en AI-commitbericht',
        'settings.placement.title': 'Paneelplaatsing',
        'settings.placement.tab': 'Git-tabblad in het gespreksgebied tonen',
      'settings.composer.title': 'Branch onder de invoerbalk',
      'settings.composer.hint': 'Toont de huidige branch onder de invoerbalk, links van de sessiestatistieken — klik om te wisselen, gesynchroniseerd met het Git-paneel. Uit verbergt hem.',
      'composer.branchHint': 'Branch wisselen',
      'composer.detached': 'HEAD (los)',
      'modelRoute.pick': 'Kies een model',
      'modelRoute.trigger': 'Model voor AI-commitberichten',
      'modelRoute.modelRow': 'Model',
      'modelRoute.effortRow': 'Redeneren',
      'modelRoute.effortDefault': 'Standaard volgen',
      'modelRoute.empty': 'Geen modellen beschikbaar',
      'composer.inWorktree': 'Uitgecheckt in een andere worktree',
      'composer.busy': 'Git-actie gaande…',
        'settings.placement.tabHint': 'Uitgeschakeld blijft het paneel bereikbaar via de rechterzijbalk en het onderpaneel.',
        'settings.placement.immersive': 'Meeslepende modus (volledige hoogte, verborgen invoerveld)',
        'settings.placement.immersiveHint': 'Aan: het Git-tabblad vult de hele gespreksruimte en het invoerveld wijkt; goedkeuringen en vragen blijven zichtbaar.',
        'preview.openFile': 'Openen in de bestandsvoorbeeld',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Kies het te bekijken bestand',
        'lf.split': 'Overschakelen naar gesplitste weergave',
        'lf.unified': 'Overschakelen naar gecombineerde weergave',
        'lf.wrap': 'Regelterugloop inschakelen',
        'lf.nowrap': 'Regelterugloop uitschakelen',
        'lf.created': 'Nieuw bestand',
        'lf.removedFile': 'Verwijderd bestand',
        'lf.truncated': 'Eerste {count} regels worden weergegeven',
        'preview.title': 'Git-voorbeeld',
        'preview.hint': 'Klik op „Diff tonen“ bij een bestand of commit — de diff opent hier in de zijbalk.',
        'preview.boundary': 'De voorvertoning kon niet worden weergegeven — herlaad de pagina of meld het probleem.',
        'settings.rail.title': 'Actiebalk',
        'settings.rail.hint': 'Vink de acties aan die op de balk verschijnen. De volgorde ligt vast; uitvinken verbergt er een.',
        'settings.rail.unavailable': 'Deze host heeft geen instellingenservice; gebruik "Actiebalk-instellingen" in het paneel.',
        'settings.commit.title': 'AI-commitbericht',
        'settings.commit.model': 'Model',
        'settings.commit.modelHint': 'Leeg = deze sessie volgen (provider/model)',
        'settings.commit.modelFollow': 'Deze sessie volgen',
        'settings.commit.reasoning': 'Redeneerinspanning',
        'settings.commit.reasoningHint': 'Leeg = geen redeneren',
        'settings.commit.reasoningDefault': 'Geen redeneren (standaard)',
        'settings.commit.reasoningFollowHint': 'Bij het volgen van de sessie wordt nooit geredeneerd; kies een vast model om een niveau te kiezen',
        'settings.commit.prompt': 'Extra instructies',
        'settings.commit.promptHint': 'bv. Conventional Commits, onderwerp in het Nederlands, max. 72 tekens',
        'settings.commit.tooLong': 'Alleen de eerste {n} tekens worden opgeslagen',
        'changes.aiWrite': 'Met AI schrijven',
        'changes.aiBusy': 'Bezig…',
        'changes.aiQuota': 'Verbruikt je eigen quota',
        'changes.aiOverwriteTitle': 'Huidig concept vervangen?',
        'changes.aiOverwriteText': 'De AI-tekst vervangt je getypte commitbericht (ongedaan te maken).',
        'changes.aiUndo': 'Ongedaan maken',
        'changes.aiFailed': 'Kon niet schrijven:',
        'changes.aiNotice': 'Sommige wijzigingen zijn niet naar het model gestuurd (afgekapt of overgeslagen); het bericht kan onvolledig zijn.',
        'settings.rail.writeFailed': 'De instelling is niet opgeslagen; de schakelaar sprong terug. Probeer opnieuw.',
        'settings.rail.readonly': 'Deze host levert de configuratie alleen-lezen.',
        'rail.settingsHint': 'Sleep of gebruik de pijlen om te sorteren; het oog schakelt de zichtbaarheid',
        'rail.reset': 'Standaardwaarden herstellen',
        'rail.up': 'Omhoog',
        'rail.down': 'Omlaag',
        'rail.show': 'Tonen',
        'rail.hide': 'Verbergen',
        'action.unavailable': 'Niet beschikbaar in de huidige staat',
        'filter.branch': 'Branch',
        'filter.user': 'Auteur',
        'history.me': 'Ik',
        'filter.date': 'Datum',
        'filter.path': 'Pad',
        'filter.all': 'Alles',
        'filter.today': 'Vandaag',
        'filter.week': 'Afgelopen 7 dagen',
        'filter.month': 'Afgelopen 30 dagen',
        'filter.year': 'Dit jaar',
        'filter.pathPlaceholder': 'Filteren op pad (Enter)',
        'filter.sortDesc': 'Nieuwste eerst',
        'filter.sortAsc': 'Oudste eerst',
        'filter.clear': 'Filters wissen',
        'filter.none': 'Geen overeenkomende commits',
        'toast.undo': 'Ongedaan maken',
        'toast.close': 'Sluiten',
        'toast.branchDeleted': 'Branch {name} verwijderd',
        'toast.stashDropped': 'Stash {ref} verwijderd',
        'toast.discarded': 'Wijzigingen in {path} weggegooid',
        'toast.discardNoUndo': 'Wijzigingen in {path} weggegooid (te groot om ongedaan te maken)',
        'toast.restored': 'Hersteld',
        'toast.sentToChat': 'In het invoerveld geplaatst',
        'toast.sendCopied': 'Kon niet worden verzonden — in plaats daarvan naar het klembord gekopieerd',
        'undo.menu': 'Onlangs verwijderd (ongedaan maken)',
        'undo.empty': 'Nu niets om ongedaan te maken',
        'undo.branch': 'Branch',
        'undo.stash': 'Stash',
        'undo.discard': 'Weggooien',
        'confirm.typeName': 'Typ {name} om te bevestigen',
        'confirm.protected': '{name} is een hoofdbranch. Verwijderen is riskant, typ daarom de branchnaam om te bevestigen —— een melding kan hem daarna nog terugbrengen.',
        'discard.untracked.confirm': 'Het niet gevolgde bestand {path} verwijderen? De inhoud wordt verwijderd —— een melding kan het daarna nog terugbrengen.',
        'stashDrop.confirm': 'Stash {ref} verwijderen? Een melding kan hem daarna nog terugbrengen.',
        'operation.merge': 'Samenvoegen bezig',
        'operation.rebase': 'Rebase bezig',
        'operation.cherry-pick': 'Cherry-pick bezig',
        'operation.revert': 'Terugdraaien bezig',
        'operation.bisect': 'Bisect bezig',
        'operation.hint': 'Deze repository heeft nog een meerstapsbewerking openstaan —— rond die af of breek die af voordat je branchacties uitvoert',
        'confirm.title': 'Bevestigen',
        'confirm.cancel': 'Annuleren',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Naam van de nieuwe branch (wordt aangemaakt en uitgecheckt)',
        'prompt.createTracking': 'Lokale branch maken vanaf de remote branch',
        'prompt.renameBranch': 'Branch hernoemen',
        'prompt.newTag': 'Naam van de nieuwe tag',
        'prompt.fromHead': 'huidige HEAD',
        'error.dismiss': 'Sluiten',
        'status.loading': 'Lezen...',
        'status.busy': 'Bezig...',
        'counts.staged': 'Gestaged {n}',
        'counts.ignored': 'Genegeerd {n}',
        'counts.unstaged': 'Wijzigingen {n}',
        'counts.untracked': 'Niet gevolgd {n}',
        'counts.conflicted': 'Conflicten {n}',
        'push.confirm': '{branch} naar {upstream} pushen?',
        'push.confirmMany': "{n} branch(es) pushen: {names}?",
        'delete.confirm': 'Branch {name} verwijderen? Een melding kan hem daarna nog terugbrengen (git weigert nog steeds niet-samengevoegde branches).',
        'discard.confirm': 'Wijzigingen in {path} weggooien? De inhoud van de werkboom wordt overschreven —— een melding kan die daarna nog terugbrengen.',
        'resetHard.confirm': 'Hard resetten naar {hash}? Niet-gecommitte wijzigingen gaan verloren.',
        'resetSoft.confirm': 'HEAD naar {hash} verplaatsen (werkboom behouden)?',
        'checkoutCommit.confirm': 'Commit {hash} uitchecken? (detached HEAD)',
      },
      /* locale: pl */
      'pl': {
        'title': 'Git',
        'description': 'Panel Git na poziomie IDE: drzewo gałęzi / graf commitów / zmiany',
        'repo.label': 'Repozytorium',
        'repo.workspace': 'obszar roboczy',
        'repo.nested': 'zagnieżdżone',
        'repo.none': 'Ten obszar roboczy nie jest repozytorium Git',
        'repo.pick': 'Wybierz repozytorium do podglądu',
        'repo.empty': 'W tym obszarze roboczym nie znaleziono repozytorium Git',
        'repo.switch': 'Zmień repozytorium',
        'branch.switch': 'Zmień gałąź',
        'seg.changes': 'Zmiany {n}',
        'seg.history': 'Historia',
        'branches.local': 'Lokalne',
        'branches.remote': 'Zdalne',
        'branches.tags': 'Tagi',
        'branches.head': 'HEAD (bieżąca gałąź)',
        'branches.favorites': 'Ulubione',
        'branches.starHint': "Ulubione",
        'branches.pickHint': 'Kliknij, aby zaznaczyć, dwuklik otwiera historię',
        'branches.headHint': 'Dwuklik otwiera historię bieżącej gałęzi',
        'branches.worktree': 'Już wybrana w innym drzewie roboczym',
        'action.stash': 'Schowek',
        'action.favorite': 'Dodaj/usuń bieżącą gałąź z ulubionych',
        'action.newTagHere': 'Nowy tag na bieżącym commicie...',
        'stash.push': 'Odłóż bieżące zmiany',
        'stash.apply': 'Zastosuj najnowszy schowek',
        'stash.drop': 'Usuń najnowszy schowek',
        'stash.count': 'Schowki: {n}',
        'note.noChanges': 'Brak oczekujących zmian',
        'note.noBranches': 'Brak innych gałęzi',
        'branches.filter': 'Gałąź lub tag',
        'changes.title': 'Zmiany',
        'changes.staged': 'W indeksie',
        'changes.unstaged': 'Zmiany',
        'changes.untracked': 'Nieśledzone',
        'changes.conflicted': 'Konflikty',
        'changes.empty': 'Brak oczekujących zmian',
        'changes.commitPlaceholder': 'Opis commita (Ctrl+Enter)',
        'changes.commit': 'Zatwierdź',
        'changes.amend': 'Popraw ostatni commit',
        'changes.stageAll': 'Dodaj wszystko do indeksu',
        'selection.count': 'Wybrano: {n}',
        'selection.copied': 'Skopiowano: {n}',
        'selection.copyPaths': 'Kopiuj ścieżki',
        'selection.clear': 'Wyczyść zaznaczenie',
        'action.copyName': 'Kopiuj nazwę',
        'menu.copyNamesN': 'Kopiuj {n} nazw',
        'menu.copyHashesN': 'Kopiuj {n} skrótów',
        'menu.copyPathsN': 'Kopiuj {n} ścieżek',
        'menu.stageN': 'Dodaj {n} do indeksu',
        'menu.unstageN': 'Usuń {n} z indeksu',
        'menu.discardN': 'Odrzuć {n}…',
        'menu.cherryN': 'Cherry-pick {n} commit(ów)',
        'menu.deleteLocalN': 'Usuń {n} gałęzi lokalnych…',
        'menu.deleteRemoteN': 'Usuń {n} gałęzi zdalnych…',
        'menu.deleteTagsN': 'Usuń {n} tagów…',
        'confirm.deleteRefs': 'Usunąć wybrane referencje? Lokalne: {b}, zdalne: {r}, tagi: {g}.',
        'confirm.discardMany': 'Odrzucić niezacommitowane zmiany w {n} plikach?',
        'confirm.discardManyUntracked': '{m} nieśledzonych plików zostanie trwale usuniętych.',
        'toast.branchesDeleted': 'Usunięto gałęzi: {n}',
        'changes.unstageAll': 'Usuń wszystko z indeksu',
        'changes.groupBy': 'Grupuj według',
        'changes.groupFlat': 'Płaska lista',
        'changes.groupDir': 'Według katalogu',
        'changes.expandAll': 'Rozwiń wszystko',
        'changes.foldAll': 'Zwiń wszystko',
        'changes.showIgnored': 'Pokaż ignorowane pliki',
        'changes.rootDir': '(katalog główny)',
        'changes.commitAndPush': 'Zatwierdź i wypchnij',
        'action.stage': 'Dodaj do indeksu',
        'action.unstage': 'Usuń z indeksu',
        'action.discard': 'Odrzuć zmiany',
        'action.showDiff': 'Pokaż różnice',
        'action.copyPath': 'Kopiuj ścieżkę',
        'action.checkout': 'Przełącz',
        'action.float': 'Odczep tę stronę',
        'action.dock': 'Zadokuj z powrotem',
        'action.split': 'Podziel',
        'action.fullscreen': 'Pełny ekran',
        'action.exitFullscreen': 'Wyjdź z pełnego ekranu',
        'action.newBranchFrom': 'Nowa gałąź stąd...',
        'action.setUpstream': 'Ustaw upstream…',
        'action.unsetUpstream': 'Usuń upstream',
        'action.createLocalBranch': 'Utwórz gałąź lokalną…',
        'action.newBranchHere': 'Nowa gałąź tutaj...',
        'action.rename': 'Zmień nazwę...',
        'action.delete': 'Usuń',
        'action.mergeIntoCurrent': 'Scal z bieżącą gałęzią',
        'action.rebaseCurrentOnto': 'Zrebase’uj bieżącą gałąź na tę',
        'action.compare': 'Porównaj z bieżącą gałęzią',
        'action.update': 'Odśwież (fetch)',
        'action.push': 'Wypchnij',
        'action.newTag': 'Nowy tag...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Wycofaj commit',
        'action.resetSoft': 'Przywróć tutaj (zachowaj zmiany)',
        'action.resetHard': 'Przywróć tutaj (odrzuć zmiany)',
        'action.copyHash': 'Kopiuj numer wersji',
        'action.details': 'Szczegóły commita',
        'menu.sendToChat': 'Wyślij do rozmowy',
        'send.commitText': 'commit git {hash} „{subject}" (repozytorium {repo})',
        'send.branchText': 'gałąź git {name} (repozytorium {repo})',
        'menu.sendDiffLinesToChat': 'Wyślij zaznaczone wiersze do rozmowy',
        'menu.sendDiffSnippetToChat': 'Wyślij zaznaczony fragment do rozmowy',
        'menu.copyDiffRef': 'Skopiuj odwołanie do zaznaczenia',
        'send.diffLinesCommit': '{lines} (commit {hash} „{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (drzewo robocze, {state})',
        'send.diffStaged': 'przygotowane',
        'send.diffUnstaged': 'niezacommitowane',
        'send.diffNewLines': 'wiersze {lines}',
        'send.diffOldLines': 'wiersze {lines} (stara numeracja)',
        'history.empty': 'To repozytorium nie ma jeszcze commitów',
        'history.loadMore': 'Wczytaj więcej',
        'history.filter': 'Tekst lub hash',
        'detail.files': 'Zmienione pliki',
        'detail.pick': 'Wybierz commit',
        'detail.back': 'Powrót do historii',
        'detail.noFiles': 'Brak zmian w plikach',
        'diff.empty': 'Brak różnic tekstowych do pokazania',
        'pane.diff': 'widok diff',
        'pane.resize': 'Przeciągnij, aby zmienić rozmiar {name} (podwójne kliknięcie przywraca, strzałki korygują)',
        'diff.binary': 'Plik binarny',
        'diff.loading': 'Wczytywanie różnic...',
        'diff.codeLabel': 'Różnice',
        'diff.wrapLabel': 'Zawijaj wiersze',
        'diff.unwrapLabel': 'Zachowaj kolumny źródła',
        'diff.copy': 'Kopiuj',
        'diff.copied': 'Skopiowano',
        'toolbar.refresh': 'Odśwież',
      'more.sort': 'Widok i sortowanie',
      'more.commitGroup': 'Zatwierdź',
      'more.changesGroup': 'Zmiany',
      'more.pullpushGroup': 'Pobierz, wyślij',
      'more.branchGroup': 'Gałąź',
      'more.remoteGroup': 'Zdalne',
      'more.stashGroup': 'Schowaj',
      'more.tagGroup': 'Tagi',
      'more.commitStaged': 'Zatwierdź przechowane...',
      'more.commitAll': 'Zatwierdź wszystko...',
      'more.undoCommit': 'Cofnij ostatnie zatwierdzenie',
      'more.rebaseAbort': 'Przerwij rebase',
      'more.commitStagedAmend': 'Zatwierdź przechowane (Amend)...',
      'more.commitAllAmend': 'Zatwierdź wszystko (Amend)...',
      'more.commitStagedSign': 'Zatwierdź przechowane (Podpisane)...',
      'more.commitAllSign': 'Zatwierdź wszystko (Podpisane)...',
      'prompt.commitMessage': 'Opis zatwierdzenia',
      'more.discardAll': 'Odrzuć wszystkie zmiany...',
      'more.sync': 'Synchronizuj (pobierz, potem wyślij)',
      'more.syncRebase': 'Synchronizuj (rebase, potem wyślij)',
      'more.pullRebase': 'Pobierz (Rebase)',
      'more.pullFrom': 'Pobierz z zdalnego',
      'more.pushForce': 'Wyślij (Wymuszone)...',
      'more.pushTo': 'Wyślij do zdalnego',
      'more.fetchAll': 'Pobierz ze wszystkich zdalnych',
      'more.deleteRemoteBranch': 'Usuń zdalną gałąź...',
      'more.publish': 'Opublikuj gałąź...',
      'more.setUpstreamHead': 'Ustaw upstream bieżącej gałęzi…',
      'more.unsetUpstreamHead': 'Usuń upstream bieżącej gałęzi',
      'more.addRemote': 'Dodaj zdalne...',
      'more.removeRemote': 'Usuń zdalne...',
      'more.stashTracked': 'Schowaj (tylko śledzone)',
      'more.stashStaged': 'Schowaj przechowane',
      'more.stashApplyPick': 'Zastosuj schowek...',
      'more.stashPopPick': 'Zdejmij schowek...',
      'more.stashDropAny': 'Usuń schowek...',
      'more.stashClear': 'Usuń wszystkie schowki...',
      'stash.none': 'Brak dostępnych schowków',
      'more.tagDeleteRemote': 'Usuń zdalny tag...',
      'more.pushTags': 'Wyślij tagi...',
      'confirm.undoCommit': 'Cofnąć ostatnie zatwierdzenie? Zmiany pozostaną przechowane.',
      'confirm.discardAll': 'Odrzucić WSZYSTKIE nieprzechowane i nieśledzone zmiany? Do odzyskania przez powiadomienia (pliki konfliktowe wyłączone).',
      'confirm.pushForce': 'Wymuszone wysłanie nadpisze zdalne tą gałęzią (--force-with-lease odmówi, gdy inni wysłali). Kontynuować?',
      'confirm.deleteRemoteBranch': 'Usunąć gałąź {branch} na {remote}?',
      'confirm.remoteRemove': 'Usunąć zdalne {name}? Konfiguracja śledzenia zostanie usunięta.',
      'confirm.stashClear': 'Usunąć WSZYSTKIE schowki? Tego nie da się cofnąć.',
      'confirm.pushTags': 'Wysłać wszystkie tagi do {remote}?',
      'prompt.remoteName': 'Nazwa zdalnego',
      'prompt.remoteUrl': 'URL zdalnego',
      'prompt.deleteRemoteTag': 'Zdalny tag do usunięcia (zostanie usunięty z {remote})',
      'toolbar.more': 'Więcej akcji',
      'more.sortGit': 'Kolejność Gita',
      'more.sortPath': 'Według ścieżki',
      'more.sortName': 'Według nazwy',
      'more.sortStatus': 'Według stanu',
      'more.clone': 'Klonuj...',
      'more.stashPop': 'Pop ostatniego stash',
      'more.deleteTag': 'Usuń tag...',
      'more.gitOutput': 'Pokaż dane wyjściowe Git',
      'clone.title': 'Klonuj repozytorium',
      'clone.url': 'URL repozytorium',
      'clone.dir': 'Katalog docelowy (ścieżka bezwzględna)',
      'clone.run': 'Klonuj',
      'prompt.deleteTag': 'Nazwa tagu do usunięcia',
      'gitLog.title': 'Dane wyjściowe Git',
      'gitLog.empty': 'Brak zapisanych wykonań Git',
        'toolbar.newBranch': 'Nowa gałąź',
        'toolbar.fetch': 'Pobierz',
        'toolbar.pull': 'Ściągnij',
        'toolbar.pullPicked': "Pobierz wybrane gałęzie ({n})",
        'toolbar.fetchPicked': "Ściągnij wybrane referencje ({n})",
        'toolbar.pushPicked': "Wyślij wybrane gałęzie ({n})",
        'toolbar.checkoutPicked': "Przełącz na wybraną gałąź",
        'toolbar.deletePicked': "Usuń wybrane referencje ({n})",
        'toolbar.push': 'Wypchnij',
        'toolbar.tree': 'Panel gałęzi',
        'rail.more': 'Więcej działań',
        'rail.settings': 'Ustawienia paska działań',
        'rail.openSettings': 'Otwórz ustawienia wtyczki',
        'settings.card.title': 'Ustawienia okna narzędzi Git',
        'settings.card.desc': 'Rozmieszczenie panelu, przyciski paska akcji i wiadomość commita od AI',
        'settings.placement.title': 'Rozmieszczenie panelu',
        'settings.placement.tab': 'Pokazuj kartę Git w obszarze rozmowy',
      'settings.composer.title': 'Gałąź pod polem wprowadzania',
      'settings.composer.hint': 'Pokazuje bieżącą gałąź pod polem wprowadzania, po lewej stronie statystyk sesji — kliknij, aby przełączyć; synchronizacja z panelem Git. Wyłączone — ukryta.',
      'composer.branchHint': 'Przełącz gałąź',
      'composer.detached': 'HEAD (odłączony)',
      'modelRoute.pick': 'Wybierz model',
      'modelRoute.trigger': 'Model wiadomości commitów AI',
      'modelRoute.modelRow': 'Model',
      'modelRoute.effortRow': 'Rozumowanie',
      'modelRoute.effortDefault': 'Domyślne',
      'modelRoute.empty': 'Brak dostępnych modeli',
      'composer.inWorktree': 'Wybrane w innym drzewie roboczym',
      'composer.busy': 'Operacja Git w toku…',
        'settings.placement.tabHint': 'Po wyłączeniu panel pozostaje dostępny z prawego paska bocznego i dolnego panelu.',
        'settings.placement.immersive': 'Tryb immersyjny (pełna wysokość, ukryte pole wpisywania)',
        'settings.placement.immersiveHint': 'Po włączeniu karta Git wypełnia całą wysokość rozmowy, a pole wpisywania się chowa; zatwierdzenia i pytania pozostają widoczne.',
        'preview.openFile': 'Otwórz w podglądzie pliku',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Wybierz plik do przeglądu',
        'lf.split': 'Przełącz na widok dzielony',
        'lf.unified': 'Przełącz na widok połączony',
        'lf.wrap': 'Włącz zawijanie wierszy',
        'lf.nowrap': 'Wyłącz zawijanie wierszy',
        'lf.created': 'Nowy plik',
        'lf.removedFile': 'Usunięty plik',
        'lf.truncated': 'Pokazano pierwsze {count} wierszy',
        'preview.title': 'Podgląd Git',
        'preview.hint': 'Kliknij „Pokaż różnice” przy pliku lub commicie — różnice otworzą się tutaj, na pasku bocznym.',
        'preview.boundary': 'Nie udało się wyświetlić podglądu — odśwież stronę lub zgłoś problem.',
        'settings.rail.title': 'Pasek akcji',
        'settings.rail.hint': 'Zaznacz akcje widoczne na pasku. Kolejność jest stała; odznaczenie ukrywa akcję.',
        'settings.rail.unavailable': 'Ten host nie ma usługi ustawień; użyj „Ustawienia paska akcji” w panelu.',
        'settings.commit.title': 'Wiadomość commita od AI',
        'settings.commit.model': 'Model',
        'settings.commit.modelHint': 'Puste = zgodnie z tą sesją (provider/model)',
        'settings.commit.modelFollow': 'Zgodnie z tą sesją',
        'settings.commit.reasoning': 'Poziom rozumowania',
        'settings.commit.reasoningHint': 'Puste = bez rozumowania',
        'settings.commit.reasoningDefault': 'Bez rozumowania (domyślnie)',
        'settings.commit.reasoningFollowHint': 'Podążanie za sesją zawsze pomija rozumowanie; wybierz stały model, aby wybrać poziom',
        'settings.commit.prompt': 'Dodatkowe instrukcje',
        'settings.commit.promptHint': 'np. Conventional Commits, temat po polsku, maks. 72 znaki',
        'settings.commit.tooLong': 'Zapisywane jest tylko pierwszych {n} znaków',
        'changes.aiWrite': 'Napisz z AI',
        'changes.aiBusy': 'Generowanie…',
        'changes.aiQuota': 'Zużywa twój limit',
        'changes.aiOverwriteTitle': 'Zastąpić bieżący szkic?',
        'changes.aiOverwriteText': 'Tekst AI zastąpi wpisaną wiadomość commita (można cofnąć).',
        'changes.aiUndo': 'Cofnij',
        'changes.aiFailed': 'Nie udało się wygenerować:',
        'changes.aiNotice': 'Część zmian nie trafiła do modelu (przycięta lub pominięta); wiadomość może być niepełna.',
        'settings.rail.writeFailed': 'Ustawienie nie zostało zapisane; przełącznik wrócił na miejsce. Spróbuj ponownie.',
        'settings.rail.readonly': 'Ten host udostępnia konfigurację tylko do odczytu.',
        'rail.settingsHint': 'Przeciągnij lub użyj strzałek, aby zmienić kolejność; oko przełącza widoczność',
        'rail.reset': 'Przywróć domyślne',
        'rail.up': 'W górę',
        'rail.down': 'W dół',
        'rail.show': 'Pokaż',
        'rail.hide': 'Ukryj',
        'action.unavailable': 'Niedostępne w bieżącym stanie',
        'filter.branch': 'Gałąź',
        'filter.user': 'Autor',
        'history.me': 'Ja',
        'filter.date': 'Data',
        'filter.path': 'Ścieżka',
        'filter.all': 'Wszystkie',
        'filter.today': 'Dzisiaj',
        'filter.week': 'Ostatnie 7 dni',
        'filter.month': 'Ostatnie 30 dni',
        'filter.year': 'W tym roku',
        'filter.pathPlaceholder': 'Filtruj po ścieżce (Enter)',
        'filter.sortDesc': 'Najnowsze najpierw',
        'filter.sortAsc': 'Najstarsze najpierw',
        'filter.clear': 'Wyczyść filtry',
        'filter.none': 'Brak pasujących commitów',
        'toast.undo': 'Cofnij',
        'toast.close': 'Zamknij',
        'toast.branchDeleted': 'Usunięto gałąź {name}',
        'toast.stashDropped': 'Usunięto schowek {ref}',
        'toast.discarded': 'Odrzucono zmiany w {path}',
        'toast.discardNoUndo': 'Odrzucono zmiany w {path} (zbyt duże, aby zachować cofnięcie)',
        'toast.restored': 'Przywrócono',
        'toast.sentToChat': 'Wysłano do pola wprowadzania',
        'toast.sendCopied': 'Nie udało się wysłać — skopiowano do schowka',
        'undo.menu': 'Ostatnio usunięte (cofnij)',
        'undo.empty': 'Teraz nie ma czego cofać',
        'undo.branch': 'Gałąź',
        'undo.stash': 'Schowek',
        'undo.discard': 'Odrzucenie',
        'confirm.typeName': 'Wpisz {name}, aby potwierdzić',
        'confirm.protected': '{name} to gałąź główna. Usunięcie jest ryzykowne, więc wpisz nazwę gałęzi, aby potwierdzić —— powiadomienie może ją potem przywrócić.',
        'discard.untracked.confirm': 'Usunąć nieśledzony plik {path}? Jego zawartość zostanie usunięta —— powiadomienie może ją potem przywrócić.',
        'stashDrop.confirm': 'Usunąć schowek {ref}? Powiadomienie może go potem przywrócić.',
        'operation.merge': 'Trwa scalanie',
        'operation.rebase': 'Trwa rebase',
        'operation.cherry-pick': 'Trwa cherry-pick',
        'operation.revert': 'Trwa wycofywanie',
        'operation.bisect': 'Trwa bisect',
        'operation.hint': 'W tym repozytorium wciąż trwa wieloetapowa operacja —— zakończ ją lub przerwij przed działaniami na gałęziach',
        'confirm.title': 'Potwierdzenie',
        'confirm.cancel': 'Anuluj',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Nazwa nowej gałęzi (zostanie utworzona i wybrana)',
        'prompt.createTracking': 'Utwórz gałąź lokalną z gałęzi zdalnej',
        'prompt.renameBranch': 'Zmień nazwę gałęzi',
        'prompt.newTag': 'Nazwa nowego tagu',
        'prompt.fromHead': 'bieżący HEAD',
        'error.dismiss': 'Zamknij',
        'status.loading': 'Wczytywanie...',
        'status.busy': 'Praca...',
        'counts.staged': 'W indeksie {n}',
        'counts.ignored': 'Ignorowane {n}',
        'counts.unstaged': 'Zmiany {n}',
        'counts.untracked': 'Nieśledzone {n}',
        'counts.conflicted': 'Konflikty {n}',
        'push.confirm': 'Wypchnąć {branch} do {upstream}?',
        'push.confirmMany': "Wysłać gałęzie ({n}): {names}?",
        'delete.confirm': 'Usunąć gałąź {name}? Powiadomienie może ją potem przywrócić (git nadal odmawia dla niescalonych gałęzi).',
        'discard.confirm': 'Odrzucić zmiany w {path}? Zawartość drzewa roboczego zostanie nadpisana —— powiadomienie może ją potem przywrócić.',
        'resetHard.confirm': 'Twarde przywrócenie do {hash}? Niezapisane zmiany przepadną.',
        'resetSoft.confirm': 'Przenieść HEAD do {hash} (drzewo robocze zachowane)?',
        'checkoutCommit.confirm': 'Przełączyć na commit {hash}? (detached HEAD)',
      },
      /* locale: sv */
      'sv': {
        'title': 'Git',
        'description': 'Git-panel i IDE-klass: grensträd / commit-graf / ändringar',
        'repo.label': 'Arkiv',
        'repo.workspace': 'arbetsyta',
        'repo.nested': 'nästlad',
        'repo.none': 'Den här arbetsytan är inte ett Git-arkiv',
        'repo.pick': 'Välj ett arkiv att granska',
        'repo.empty': 'Inget Git-arkiv hittades i den här arbetsytan',
        'repo.switch': 'Byt arkiv',
        'branch.switch': 'Byt gren',
        'seg.changes': 'Ändringar {n}',
        'seg.history': 'Historik',
        'branches.local': 'Lokala',
        'branches.remote': 'Fjärr',
        'branches.tags': 'Taggar',
        'branches.head': 'HEAD (aktuell gren)',
        'branches.favorites': 'Favoriter',
        'branches.starHint': "Favorit",
        'branches.pickHint': 'Klicka för att välja, dubbelklick visar historiken',
        'branches.headHint': 'Dubbelklick visar historiken för aktuell gren',
        'branches.worktree': 'Redan utcheckad i ett annat arbetsträd',
        'action.stash': 'Stash',
        'action.favorite': 'Lägg till/ta bort aktuell gren som favorit',
        'action.newTagHere': 'Ny tagg på aktuell commit...',
        'stash.push': 'Stasha aktuella ändringar',
        'stash.apply': 'Tillämpa senaste stash',
        'stash.drop': 'Släng senaste stash',
        'stash.count': '{n} stash-poster',
        'note.noChanges': 'Inga väntande ändringar',
        'note.noBranches': 'Inga andra grenar',
        'branches.filter': 'Gren eller tagg',
        'changes.title': 'Ändringar',
        'changes.staged': 'Klad',
        'changes.unstaged': 'Ändringar',
        'changes.untracked': 'Ospårad',
        'changes.conflicted': 'Konflikter',
        'changes.empty': 'Inga väntande ändringar',
        'changes.commitPlaceholder': 'Commit-meddelande (Ctrl+Enter)',
        'changes.commit': 'Committa',
        'changes.amend': 'Komplettera senaste commit',
        'changes.stageAll': 'Klädda alla',
        'selection.count': '{n} markerade',
        'selection.copied': 'Kopierade {n} objekt',
        'selection.copyPaths': 'Kopiera sökvägar',
        'selection.clear': 'Rensa markering',
        'action.copyName': 'Kopiera namn',
        'menu.copyNamesN': 'Kopiera {n} namn',
        'menu.copyHashesN': 'Kopiera {n} hashar',
        'menu.copyPathsN': 'Kopiera {n} sökvägar',
        'menu.stageN': 'Klädda {n} objekt',
        'menu.unstageN': 'Avklädda {n} objekt',
        'menu.discardN': 'Förkasta {n} objekt…',
        'menu.cherryN': 'Cherry-picka {n} commit(s)',
        'menu.deleteLocalN': 'Ta bort {n} lokala grenar…',
        'menu.deleteRemoteN': 'Ta bort {n} fjärrgrenar…',
        'menu.deleteTagsN': 'Ta bort {n} taggar…',
        'confirm.deleteRefs': 'Ta bort markerade referenser? {b} lokala, {r} fjärr, {g} taggar.',
        'confirm.discardMany': 'Förkasta icke-committade ändringar i {n} filer?',
        'confirm.discardManyUntracked': '{m} ospårade filer tas bort permanent.',
        'toast.branchesDeleted': 'Tog bort {n} gren(ar)',
        'changes.unstageAll': 'Avklädda alla',
        'changes.groupBy': 'Gruppera efter',
        'changes.groupFlat': 'Platt lista',
        'changes.groupDir': 'Per katalog',
        'changes.expandAll': 'Expandera alla',
        'changes.foldAll': 'Fäll ihop alla',
        'changes.showIgnored': 'Visa ignorerade filer',
        'changes.rootDir': '(rot)',
        'changes.commitAndPush': 'Committa och pusha',
        'action.stage': 'Klädda',
        'action.unstage': 'Avklädda',
        'action.discard': 'Förkasta ändringar',
        'action.showDiff': 'Visa diff',
        'action.copyPath': 'Kopiera sökväg',
        'action.checkout': 'Checka ut',
        'action.float': 'Friställ sidan',
        'action.dock': 'Docka tillbaka',
        'action.split': 'Dela',
        'action.fullscreen': 'Helskärm',
        'action.exitFullscreen': 'Avsluta helskärm',
        'action.newBranchFrom': 'Ny gren härifrån...',
        'action.setUpstream': 'Ange upstream…',
        'action.unsetUpstream': 'Ta bort upstream',
        'action.createLocalBranch': 'Skapa lokal gren…',
        'action.newBranchHere': 'Ny gren här...',
        'action.rename': 'Byt namn...',
        'action.delete': 'Ta bort',
        'action.mergeIntoCurrent': 'Sammanfoga in i aktuell gren',
        'action.rebaseCurrentOnto': 'Rebasa aktuell gren mot denna',
        'action.compare': 'Jämför med aktuell gren',
        'action.update': 'Uppdatera (fetch)',
        'action.push': 'Pusha',
        'action.newTag': 'Ny tagg...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Återställ commit',
        'action.resetSoft': 'Återställ hit (behåll ändringar)',
        'action.resetHard': 'Återställ hit (förkasta ändringar)',
        'action.copyHash': 'Kopiera revisionsnummer',
        'action.details': 'Commit-detaljer',
        'menu.sendToChat': 'Skicka till samtalet',
        'send.commitText': 'git-commit {hash} ”{subject}” (arkiv {repo})',
        'send.branchText': 'git-gren {name} (arkiv {repo})',
        'menu.sendDiffLinesToChat': 'Skicka markerade rader till samtalet',
        'menu.sendDiffSnippetToChat': 'Skicka markerat utdrag till samtalet',
        'menu.copyDiffRef': 'Kopiera markeringens referens',
        'send.diffLinesCommit': '{lines} (incheckning {hash} ”{subject}” @ {branch})',
        'send.diffLinesWorktree': '{lines} (arbetskopia, {state})',
        'send.diffStaged': 'staged',
        'send.diffUnstaged': 'ej incheckad',
        'send.diffNewLines': 'rader {lines}',
        'send.diffOldLines': 'rader {lines} (gammal numrering)',
        'history.empty': 'Det här arkivet har inga commits ännu',
        'history.loadMore': 'Ladda mer',
        'history.filter': 'Text eller hash',
        'detail.files': 'Ändrade filer',
        'detail.pick': 'Välj en commit',
        'detail.back': 'Tillbaka till historiken',
        'detail.noFiles': 'Inga filändringar',
        'diff.empty': 'Ingen textdiff att visa',
        'pane.diff': 'diff-vy',
        'pane.resize': 'Dra för att ändra storleken på {name} (dubbelklick återställer, piltangenter finjusterar)',
        'diff.binary': 'Binär fil',
        'diff.loading': 'Laddar diff...',
        'diff.codeLabel': 'Skillnad',
        'diff.wrapLabel': 'Radbryt rader',
        'diff.unwrapLabel': 'Behåll kolumner från källan',
        'diff.copy': 'Kopiera',
        'diff.copied': 'Kopierat',
        'toolbar.refresh': 'Uppdatera',
      'more.sort': 'Visa & sortera',
      'more.commitGroup': 'Checka in',
      'more.changesGroup': 'Ändringar',
      'more.pullpushGroup': 'Hämta, skicka',
      'more.branchGroup': 'Gren',
      'more.remoteGroup': 'Fjärr',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Taggar',
      'more.commitStaged': 'Checka in stagingade...',
      'more.commitAll': 'Checka in allt...',
      'more.undoCommit': 'Ångra senaste incheckning',
      'more.rebaseAbort': 'Avbryt rebase',
      'more.commitStagedAmend': 'Checka in stagingade (Amend)...',
      'more.commitAllAmend': 'Checka in allt (Amend)...',
      'more.commitStagedSign': 'Checka in stagingade (Signerat)...',
      'more.commitAllSign': 'Checka in allt (Signerat)...',
      'prompt.commitMessage': 'Incheckningsmeddelande',
      'more.discardAll': 'Kasta alla ändringar...',
      'more.sync': 'Synka (hämta, sedan skicka)',
      'more.syncRebase': 'Synka (rebase, sedan skicka)',
      'more.pullRebase': 'Hämta (Rebase)',
      'more.pullFrom': 'Hämta från fjärr',
      'more.pushForce': 'Skicka (Tvinga)...',
      'more.pushTo': 'Skicka till fjärr',
      'more.fetchAll': 'Hämta från alla fjärrar',
      'more.deleteRemoteBranch': 'Ta bort fjärrgren...',
      'more.publish': 'Publicera gren...',
      'more.setUpstreamHead': 'Ange upstream för aktuell gren…',
      'more.unsetUpstreamHead': 'Ta bort upstream för aktuell gren',
      'more.addRemote': 'Lägg till fjärr...',
      'more.removeRemote': 'Ta bort fjärr...',
      'more.stashTracked': 'Stash (endast spårade)',
      'more.stashStaged': 'Stasha stagingade',
      'more.stashApplyPick': 'Använd stash...',
      'more.stashPopPick': 'Poppa stash...',
      'more.stashDropAny': 'Ta bort stash...',
      'more.stashClear': 'Ta bort alla stash:ar...',
      'stash.none': 'Inga stash:ar tillgängliga',
      'more.tagDeleteRemote': 'Ta bort fjärrtagg...',
      'more.pushTags': 'Skicka taggar...',
      'confirm.undoCommit': 'Ångra senaste incheckningen? Ändringarna stannar i staging.',
      'confirm.discardAll': 'Kasta ALLA ostagingade och ospårade ändringar? Återställningsbara via ångra-toasts (konfliktfiler undantagna).',
      'confirm.pushForce': 'Tvingad sändning skriver över fjärren med denna gren (--force-with-lease nekar om andra skickat). Fortsätta?',
      'confirm.deleteRemoteBranch': 'Ta bort grenen {branch} på {remote}?',
      'confirm.remoteRemove': 'Ta bort fjärren {name}? Spårningskonfigurationen tas bort med den.',
      'confirm.stashClear': 'Ta bort ALLA stash:ar? Detta går inte att ångra.',
      'confirm.pushTags': 'Skicka alla taggar till {remote}?',
      'prompt.remoteName': 'Fjärrnamn',
      'prompt.remoteUrl': 'Fjärr-URL',
      'prompt.deleteRemoteTag': 'Fjärrtagg att ta bort (skickas till {remote})',
      'toolbar.more': 'Fler åtgärder',
      'more.sortGit': 'Git-ordning',
      'more.sortPath': 'Efter sökväg',
      'more.sortName': 'Efter namn',
      'more.sortStatus': 'Efter status',
      'more.clone': 'Klona...',
      'more.stashPop': 'Pop:a senaste stash',
      'more.deleteTag': 'Ta bort tagg...',
      'more.gitOutput': 'Visa Git-utdata',
      'clone.title': 'Klona lagringsplats',
      'clone.url': 'URL till lagringsplats',
      'clone.dir': 'Målkatalog (absolut sökväg)',
      'clone.run': 'Klona',
      'prompt.deleteTag': 'Tagnamn som ska tas bort',
      'gitLog.title': 'Git-utdata',
      'gitLog.empty': 'Inga Git-körningar ännu',
        'toolbar.newBranch': 'Ny gren',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "Pulla {n} valda grenar",
        'toolbar.fetchPicked': "Fetcha {n} valda referenser",
        'toolbar.pushPicked': "Pusha {n} valda grenar",
        'toolbar.checkoutPicked': "Checka ut vald gren",
        'toolbar.deletePicked': "Ta bort {n} valda referenser",
        'toolbar.push': 'Push',
        'toolbar.tree': 'Grenpanel',
        'rail.more': 'Fler åtgärder',
        'rail.settings': 'Inställningar för åtgärdsfältet',
        'rail.openSettings': 'Öppna plugininställningar',
        'settings.card.title': 'Inställningar för Git-verktygsfönstret',
        'settings.card.desc': 'Panelplacering, knappar i åtgärdsfältet och AI-commitmeddelande',
        'settings.placement.title': 'Panelplacering',
        'settings.placement.tab': 'Visa Git-fliken i konversationsytan',
      'settings.composer.title': 'Gren under inmatningen',
      'settings.composer.hint': 'Visar aktuell gren under inmatningsfältet, till vänster om sessionsstatistiken — klicka för att växla, synkat med Git-panelen. Av döljer den.',
      'composer.branchHint': 'Byt gren',
      'composer.detached': 'HEAD (frånkopplad)',
      'modelRoute.pick': 'Välj modell',
      'modelRoute.trigger': 'Modell för AI-commit-meddelanden',
      'modelRoute.modelRow': 'Modell',
      'modelRoute.effortRow': 'Resonemang',
      'modelRoute.effortDefault': 'Följ standard',
      'modelRoute.empty': 'Inga modeller tillgängliga',
      'composer.inWorktree': 'Utcheckad i ett annat arbetsträd',
      'composer.busy': 'Git-åtgärd pågår…',
        'settings.placement.tabHint': 'Avstängd finns panelen kvar via höger sidopanel och nedre panelen.',
        'settings.placement.immersive': 'Uppslukande läge (full höjd, dolt inmatningsfält)',
        'settings.placement.immersiveHint': 'På: Git-fliken fyller hela konversationsytan och inmatningsfältet träder åt sidan; godkännanden och frågor visas fortfarande.',
        'preview.openFile': 'Öppna i filförhandsvisningen',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Välj filen att granska',
        'lf.split': 'Byt till delad vy',
        'lf.unified': 'Byt till samlad vy',
        'lf.wrap': 'Aktivera radbrytning',
        'lf.nowrap': 'Inaktivera radbrytning',
        'lf.created': 'Ny fil',
        'lf.removedFile': 'Borttagen fil',
        'lf.truncated': 'Visar de första {count} raderna',
        'preview.title': 'Git-förhandsvisning',
        'preview.hint': 'Klicka på ”Visa diff” på en fil eller en commit — diffen öppnas här i sidopanelen.',
        'preview.boundary': 'Förhandsvisningen kunde inte visas — ladda om sidan eller rapportera problemet.',
        'settings.rail.title': 'Åtgärdsfältet',
        'settings.rail.hint': 'Markera de åtgärder som visas i fältet. Ordningen är fast; avmarkering döljer en.',
        'settings.rail.unavailable': 'Denna värd saknar inställningstjänst; använd ”Åtgärdsfältets inställningar” i panelen.',
        'settings.commit.title': 'AI-commitmeddelande',
        'settings.commit.model': 'Modell',
        'settings.commit.modelHint': 'Tomt = följ denna session (provider/model)',
        'settings.commit.modelFollow': 'Följ denna session',
        'settings.commit.reasoning': 'Resonemangsinsats',
        'settings.commit.reasoningHint': 'Tomt = inget resonemang',
        'settings.commit.reasoningDefault': 'Inget resonemang (standard)',
        'settings.commit.reasoningFollowHint': 'När sessionen följs används aldrig resonemang; välj en fast modell för att välja en nivå',
        'settings.commit.prompt': 'Extra instruktioner',
        'settings.commit.promptHint': 't.ex. Conventional Commits, ämne på svenska, högst 72 tecken',
        'settings.commit.tooLong': 'Endast de första {n} tecknen sparas',
        'changes.aiWrite': 'Skriv med AI',
        'changes.aiBusy': 'Skriver…',
        'changes.aiQuota': 'Använder din egen kvot',
        'changes.aiOverwriteTitle': 'Ersätt nuvarande utkast?',
        'changes.aiOverwriteText': 'AI-texten ersätter commitmeddelandet du skrev (går att ångra).',
        'changes.aiUndo': 'Ångra',
        'changes.aiFailed': 'Kunde inte skriva:',
        'changes.aiNotice': 'Vissa ändringar skickades inte till modellen (kapade eller utelämnade); meddelandet kan vara ofullständigt.',
        'settings.rail.writeFailed': 'Inställningen sparades inte; reglaget gick tillbaka. Försök igen.',
        'settings.rail.readonly': 'Denna värd tillhandahåller konfigurationen skrivskyddad.',
        'rail.settingsHint': 'Dra eller använd pilarna för att sortera; ögat växlar synlighet',
        'rail.reset': 'Återställ standard',
        'rail.up': 'Flytta upp',
        'rail.down': 'Flytta ner',
        'rail.show': 'Visa',
        'rail.hide': 'Dölj',
        'action.unavailable': 'Inte tillgängligt i aktuellt läge',
        'filter.branch': 'Gren',
        'filter.user': 'Författare',
        'history.me': 'Jag',
        'filter.date': 'Datum',
        'filter.path': 'Sökväg',
        'filter.all': 'Alla',
        'filter.today': 'I dag',
        'filter.week': 'Senaste 7 dagarna',
        'filter.month': 'Senaste 30 dagarna',
        'filter.year': 'I år',
        'filter.pathPlaceholder': 'Filtrera på sökväg (Enter)',
        'filter.sortDesc': 'Nyast först',
        'filter.sortAsc': 'Äldst först',
        'filter.clear': 'Rensa filter',
        'filter.none': 'Inga matchande commits',
        'toast.undo': 'Ångra',
        'toast.close': 'Stäng',
        'toast.branchDeleted': 'Grenen {name} borttagen',
        'toast.stashDropped': 'Stashen {ref} slängd',
        'toast.discarded': 'Ändringar i {path} förkastade',
        'toast.discardNoUndo': 'Ändringar i {path} förkastade (för stora för att ångra)',
        'toast.restored': 'Återställd',
        'toast.sentToChat': 'Skickat till inmatningsrutan',
        'toast.sendCopied': 'Det gick inte att skicka – kopierade till urklipp istället',
        'undo.menu': 'Nyligen borttaget (ångra)',
        'undo.empty': 'Inget att ångra just nu',
        'undo.branch': 'Gren',
        'undo.stash': 'Stash',
        'undo.discard': 'Förkasta',
        'confirm.typeName': 'Skriv {name} för att bekräfta',
        'confirm.protected': '{name} är en huvudgren. Att ta bort den är riskabelt, så skriv grennamnet för att bekräfta —— en avisering kan sedan fortfarande återställa den.',
        'discard.untracked.confirm': 'Ta bort den ospårade filen {path}? Innehållet tas bort —— en avisering kan sedan fortfarande återställa det.',
        'stashDrop.confirm': 'Släng stashen {ref}? En avisering kan sedan fortfarande återställa den.',
        'operation.merge': 'Sammanfogning pågår',
        'operation.rebase': 'Rebase pågår',
        'operation.cherry-pick': 'Cherry-pick pågår',
        'operation.revert': 'Återställning pågår',
        'operation.bisect': 'Bisect pågår',
        'operation.hint': 'Det här arkivet har fortfarande en flerstegsoperation öppen —— slutför eller avbryt den före grenåtgärder',
        'confirm.title': 'Bekräfta',
        'confirm.cancel': 'Avbryt',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Namn på ny gren (skapas och checkas ut)',
        'prompt.createTracking': 'Skapa lokal gren från fjärrgrenen',
        'prompt.renameBranch': 'Byt namn på grenen',
        'prompt.newTag': 'Namn på ny tagg',
        'prompt.fromHead': 'aktuell HEAD',
        'error.dismiss': 'Stäng',
        'status.loading': 'Läser...',
        'status.busy': 'Arbetar...',
        'counts.staged': 'Klädda {n}',
        'counts.ignored': 'Ignorerade {n}',
        'counts.unstaged': 'Ändringar {n}',
        'counts.untracked': 'Ospårade {n}',
        'counts.conflicted': 'Konflikter {n}',
        'push.confirm': 'Pusha {branch} till {upstream}?',
        'push.confirmMany': "Pusha {n} gren(ar): {names}?",
        'delete.confirm': 'Ta bort grenen {name}? En avisering kan sedan fortfarande återställa den (git nekar fortfarande till ej sammanfogade grenar).',
        'discard.confirm': 'Förkasta ändringar i {path}? Arbetsträdets innehåll skrivs över —— en avisering kan sedan fortfarande återställa det.',
        'resetHard.confirm': 'Hård återställning till {hash}? Ej committade ändringar går förlorade.',
        'resetSoft.confirm': 'Flytta HEAD till {hash} (arbetsträdet behålls)?',
        'checkoutCommit.confirm': 'Checka ut commiten {hash}? (detached HEAD)',
      },
      /* locale: tr */
      'tr': {
        'title': 'Git',
        'description': 'IDE düzeyinde Git paneli: dal ağacı / commit grafiği / değişiklikler',
        'repo.label': 'Depo',
        'repo.workspace': 'çalışma alanı',
        'repo.nested': 'iç içe',
        'repo.none': 'Bu çalışma alanı bir Git deposu değil',
        'repo.pick': 'İncelenecek depoyu seçin',
        'repo.empty': 'Bu çalışma alanında Git deposu bulunamadı',
        'repo.switch': 'Depoyu değiştir',
        'branch.switch': 'Dalı değiştir',
        'seg.changes': 'Değişiklikler {n}',
        'seg.history': 'Geçmiş',
        'branches.local': 'Yerel',
        'branches.remote': 'Uzak',
        'branches.tags': 'Etiketler',
        'branches.head': 'HEAD (geçerli dal)',
        'branches.favorites': 'Sık kullanılanlar',
        'branches.starHint': "Favori",
        'branches.pickHint': 'Seçmek için tek tık, geçmişi görmek için çift tık',
        'branches.headHint': 'Çift tık, geçerli dalın geçmişini açar',
        'branches.worktree': 'Başka bir çalışma ağacında çıkarılmış',
        'action.stash': 'Saklama',
        'action.favorite': 'Geçerli dalı sık kullanılanlara ekle/çıkar',
        'action.newTagHere': 'Geçerli commit üzerinde yeni etiket...',
        'stash.push': 'Geçerli değişiklikleri sakla',
        'stash.apply': 'En son saklamayı uygula',
        'stash.drop': 'En son saklamayı sil',
        'stash.count': '{n} saklama kaydı',
        'note.noChanges': 'Bekleyen değişiklik yok',
        'note.noBranches': 'Başka dal yok',
        'branches.filter': 'Dal veya etiket',
        'changes.title': 'Değişiklikler',
        'changes.staged': 'Hazırlanan',
        'changes.unstaged': 'Değişiklikler',
        'changes.untracked': 'İzlenmeyen',
        'changes.conflicted': 'Çakışmalar',
        'changes.empty': 'Bekleyen değişiklik yok',
        'changes.commitPlaceholder': 'Commit mesajı (Ctrl+Enter)',
        'changes.commit': 'Commit’le',
        'changes.amend': 'Son commit’i düzelt',
        'changes.stageAll': 'Tümünü hazırla',
        'selection.count': '{n} seçili',
        'selection.copied': '{n} öğe kopyalandı',
        'selection.copyPaths': 'Yolları kopyala',
        'selection.clear': 'Seçimi temizle',
        'action.copyName': 'Adı kopyala',
        'menu.copyNamesN': '{n} adı kopyala',
        'menu.copyHashesN': '{n} karmayı kopyala',
        'menu.copyPathsN': '{n} yolu kopyala',
        'menu.stageN': '{n} öğeyi hazırla',
        'menu.unstageN': '{n} öğeyi hazırlıktan çıkar',
        'menu.discardN': '{n} öğeyi at…',
        'menu.cherryN': '{n} commit seçip al',
        'menu.deleteLocalN': '{n} yerel dalı sil…',
        'menu.deleteRemoteN': '{n} uzak dalı sil…',
        'menu.deleteTagsN': '{n} etiketi sil…',
        'confirm.deleteRefs': 'Seçili referanslar silinsin mi? {b} yerel, {r} uzak, {g} etiket.',
        'confirm.discardMany': '{n} dosyanın commitlenmemiş değişiklikleri atılsın mı?',
        'confirm.discardManyUntracked': '{m} izlenmeyen dosya kalıcı olarak silinecek.',
        'toast.branchesDeleted': '{n} dal silindi',
        'changes.unstageAll': 'Tümünü hazırlıktan çıkar',
        'changes.groupBy': 'Gruplama ölçütü',
        'changes.groupFlat': 'Düz liste',
        'changes.groupDir': 'Dizine göre',
        'changes.expandAll': 'Tümünü genişlet',
        'changes.foldAll': 'Tümünü daralt',
        'changes.showIgnored': 'Yok sayılan dosyaları göster',
        'changes.rootDir': '(kök)',
        'changes.commitAndPush': 'Commit’le ve gönder',
        'action.stage': 'Hazırla',
        'action.unstage': 'Hazırlıktan çıkar',
        'action.discard': 'Değişiklikleri at',
        'action.showDiff': 'Farkı göster',
        'action.copyPath': 'Yolu kopyala',
        'action.checkout': 'Çıkar',
        'action.float': 'Bu sayfayı yüzdür',
        'action.dock': 'Yuvaya geri al',
        'action.split': 'Böl',
        'action.fullscreen': 'Tam ekran',
        'action.exitFullscreen': 'Tam ekrandan çık',
        'action.newBranchFrom': 'Buradan yeni dal...',
        'action.setUpstream': 'Upstream ayarla…',
        'action.unsetUpstream': 'Upstream kaldır',
        'action.createLocalBranch': 'Yerel dal oluştur…',
        'action.newBranchHere': 'Burada yeni dal...',
        'action.rename': 'Yeniden adlandır...',
        'action.delete': 'Sil',
        'action.mergeIntoCurrent': 'Geçerli dala birleştir',
        'action.rebaseCurrentOnto': 'Geçerli dalı bunun üzerine rebase et',
        'action.compare': 'Geçerli dalla karşılaştır',
        'action.update': 'Güncelle (fetch)',
        'action.push': 'Gönder',
        'action.newTag': 'Yeni etiket...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Commit’i geri al',
        'action.resetSoft': 'Buraya sıfırla (değişiklikleri koru)',
        'action.resetHard': 'Buraya sıfırla (değişiklikleri at)',
        'action.copyHash': 'Revizyon numarasını kopyala',
        'action.details': 'Commit ayrıntıları',
        'menu.sendToChat': 'Sohbete gönder',
        'send.commitText': 'git commit {hash} "{subject}" (depo {repo})',
        'send.branchText': 'git dalı {name} (depo {repo})',
        'menu.sendDiffLinesToChat': 'Seçili satırları sohbete gönder',
        'menu.sendDiffSnippetToChat': 'Seçili parçayı sohbete gönder',
        'menu.copyDiffRef': 'Seçim referansını kopyala',
        'send.diffLinesCommit': '{lines} (işleme {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (çalışma ağacı, {state})',
        'send.diffStaged': 'hazırlanmış',
        'send.diffUnstaged': 'işlenmemiş',
        'send.diffNewLines': 'satırlar {lines}',
        'send.diffOldLines': 'satırlar {lines} (eski numaralandırma)',
        'history.empty': 'Bu depoda henüz commit yok',
        'history.loadMore': 'Daha fazla yükle',
        'history.filter': 'Metin veya hash',
        'detail.files': 'Değişen dosyalar',
        'detail.pick': 'Bir commit seçin',
        'detail.back': 'Geçmişe dön',
        'detail.noFiles': 'Dosya değişikliği yok',
        'diff.empty': 'Gösterilecek metin farkı yok',
        'pane.diff': 'diff görünümü',
        'pane.resize': '{name} boyutunu sürükleyerek ayarlayın (çift tıklama sıfırlar, ok tuşları ince ayar yapar)',
        'diff.binary': 'İkili dosya',
        'diff.loading': 'Fark yükleniyor...',
        'diff.codeLabel': 'Fark',
        'diff.wrapLabel': 'Satırları kaydır',
        'diff.unwrapLabel': 'Kaynak sütunlarını koru',
        'diff.copy': 'Kopyala',
        'diff.copied': 'Kopyalandı',
        'toolbar.refresh': 'Yenile',
      'more.sort': 'Görüntüle & sırala',
      'more.commitGroup': 'İşle',
      'more.changesGroup': 'Değişiklikler',
      'more.pullpushGroup': 'Çek, Gönder',
      'more.branchGroup': 'Dal',
      'more.remoteGroup': 'Uzak',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Etiket',
      'more.commitStaged': 'Staged dosyaları işle...',
      'more.commitAll': 'Tümünü işle...',
      'more.undoCommit': 'Son işlemi geri al',
      'more.rebaseAbort': 'Rebase\'i durdur',
      'more.commitStagedAmend': 'Staged dosyaları işle (Düzelt)...',
      'more.commitAllAmend': 'Tümünü işle (Düzelt)...',
      'more.commitStagedSign': 'Staged dosyaları işle (İmzalı)...',
      'more.commitAllSign': 'Tümünü işle (İmzalı)...',
      'prompt.commitMessage': 'İşleme mesajı',
      'more.discardAll': 'TÜM değişiklikleri at...',
      'more.sync': 'Eşitle (çek, sonra gönder)',
      'more.syncRebase': 'Eşitle (rebase, sonra gönder)',
      'more.pullRebase': 'Çek (Rebase)',
      'more.pullFrom': 'Uzaktan çek',
      'more.pushForce': 'Gönder (Zorla)...',
      'more.pushTo': 'Uzağa gönder',
      'more.fetchAll': 'Tüm uzaklardan al',
      'more.deleteRemoteBranch': 'Uzak dalı sil...',
      'more.publish': 'Dalı yayınla...',
      'more.setUpstreamHead': 'Geçerli dalın upstream\'ini ayarla…',
      'more.unsetUpstreamHead': 'Geçerli dalın upstream\'ini kaldır',
      'more.addRemote': 'Uzak ekle...',
      'more.removeRemote': 'Uzağı kaldır...',
      'more.stashTracked': 'Stash (yalnızca izlenen)',
      'more.stashStaged': 'Staged dosyaları stash\'le',
      'more.stashApplyPick': 'Stash uygula...',
      'more.stashPopPick': 'Stash pop yap...',
      'more.stashDropAny': 'Stash sil...',
      'more.stashClear': 'Tüm stash\'leri sil...',
      'stash.none': 'Kullanılabilir stash yok',
      'more.tagDeleteRemote': 'Uzak etiketi sil...',
      'more.pushTags': 'Etiketleri gönder...',
      'confirm.undoCommit': 'Son işlem geri alınsın mı? Değişiklikler staged olarak kalır.',
      'confirm.discardAll': 'Staged OLMAYAN ve izlenmeyen TÜM değişiklikler atılsın mı? Geri alma bildirimlerinden kurtarılabilir (çakışan dosyalar hariç).',
      'confirm.pushForce': 'Zorla gönderme, uzakta olanı bu dalla üzerine yazar (--force-with-lease, başkası göndermişse reddeder).Devam edilsin mi?',
      'confirm.deleteRemoteBranch': '{remote} üzerindeki {branch} dalı silinsin mi?',
      'confirm.remoteRemove': '{name} uzaklığı kaldırılsın mı? Takip yapılandırması da kaldırılır.',
      'confirm.stashClear': 'TÜM stash\'ler silinsin mi? Bu geri alınamaz.',
      'confirm.pushTags': 'Tüm etiketler {remote} üzerine gönderilsin mi?',
      'prompt.remoteName': 'Uzak adı',
      'prompt.remoteUrl': 'Uzak URL',
      'prompt.deleteRemoteTag': 'Silinecek uzak etiket ({remote} üzerine gönderilir)',
      'toolbar.more': 'Diğer eylemler',
      'more.sortGit': 'Git sırası',
      'more.sortPath': 'Yola göre',
      'more.sortName': 'Ada göre',
      'more.sortStatus': 'Duruma göre',
      'more.clone': 'Klonla...',
      'more.stashPop': 'Son stash\'i aç',
      'more.deleteTag': 'Etiket sil...',
      'more.gitOutput': 'Git çıktısını göster',
      'clone.title': 'Depoyu klonla',
      'clone.url': 'Depo URL\'si',
      'clone.dir': 'Hedef dizin (mutlak yol)',
      'clone.run': 'Klonla',
      'prompt.deleteTag': 'Silinecek etiket adı',
      'gitLog.title': 'Git çıktısı',
      'gitLog.empty': 'Henüz Git çalıştırması yok',
        'toolbar.newBranch': 'Yeni dal',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "Seçilen {n} dalı çek",
        'toolbar.fetchPicked': "Seçilen {n} referansı getir",
        'toolbar.pushPicked': "Seçilen {n} dalı gönder",
        'toolbar.checkoutPicked': "Seçilen dala geç",
        'toolbar.deletePicked': "Seçilen {n} referansı sil",
        'toolbar.push': 'Push',
        'toolbar.tree': 'Dal paneli',
        'rail.more': 'Diğer eylemler',
        'rail.settings': 'Eylem çubuğu ayarları',
        'rail.openSettings': 'Eklenti ayarlarını aç',
        'settings.card.title': 'Git araç penceresi ayarları',
        'settings.card.desc': 'Panel yerleşimi, eylem çubuğu düğmeleri ve AI commit mesajı',
        'settings.placement.title': 'Panel yerleşimi',
        'settings.placement.tab': 'Konuşma alanında Git sekmesini göster',
      'settings.composer.title': 'Giriş altında dal',
      'settings.composer.hint': 'Geçerli dalı giriş alanının altında, oturum istatistiklerinin solunda gösterir — geçiş için tıklayın, Git paneliyle eşitlenir. Kapalıyken gizlenir.',
      'composer.branchHint': 'Dal değiştir',
      'composer.detached': 'HEAD (ayrık)',
      'modelRoute.pick': 'Model seç',
      'modelRoute.trigger': 'Yapay zekâ commit mesajı modeli',
      'modelRoute.modelRow': 'Model',
      'modelRoute.effortRow': 'Akıl yürütme',
      'modelRoute.effortDefault': 'Varsayılanı izle',
      'modelRoute.empty': 'Kullanılabilir model yok',
      'composer.inWorktree': 'Başka bir worktree’da checkout yapılmış',
      'composer.busy': 'Git işlemi sürüyor…',
        'settings.placement.tabHint': 'Kapatıldığında panel sağ kenar çubuğundan ve alt panelden açılabilir.',
        'settings.placement.immersive': 'Odaklanma modu (tam yükseklik, gizli giriş alanı)',
        'settings.placement.immersiveHint': 'Açıkken Git sekmesi tüm konuşma alanını kaplar ve giriş alanı gizlenir; onaylar ve sorular yine de görünür.',
        'preview.openFile': 'Dosya önizlemesinde aç',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'İncelenecek dosyayı seçin',
        'lf.split': 'Bölünmüş görünüme geç',
        'lf.unified': 'Birleşik görünüme geç',
        'lf.wrap': 'Satır kaydırmayı aç',
        'lf.nowrap': 'Satır kaydırmayı kapat',
        'lf.created': 'Yeni dosya',
        'lf.removedFile': 'Silinen dosya',
        'lf.truncated': 'Yalnızca ilk {count} satır gösteriliyor',
        'preview.title': 'Git Önizlemesi',
        'preview.hint': 'Bir dosya veya commit üzerinde „Farkı göster”e tıklayın — fark burada, kenar çubuğunda açılır.',
        'preview.boundary': 'Önizleme işlenemedi — sayfayı yeniden yükleyin veya sorunu bildirin.',
        'settings.rail.title': 'Eylem çubuğu',
        'settings.rail.hint': 'Çubukta gösterilecek eylemleri işaretleyin. Sıra sabittir; işareti kaldırmak eylemi gizler.',
        'settings.rail.unavailable': 'Bu ana bilgisayarda ayar hizmeti yok; paneldeki "Eylem çubuğu ayarları"nı kullanın.',
        'settings.commit.title': 'AI commit mesajı',
        'settings.commit.model': 'Model',
        'settings.commit.modelHint': 'Boş = bu oturumu izle (provider/model)',
        'settings.commit.modelFollow': 'Bu oturumu izle',
        'settings.commit.reasoning': 'Düşünme yoğunluğu',
        'settings.commit.reasoningHint': 'Boş = akıl yürütme yok',
        'settings.commit.reasoningDefault': 'Akıl yürütme yok (varsayılan)',
        'settings.commit.reasoningFollowHint': 'Oturumu izlerken akıl yürütme her zaman kapalıdır; bir düzey seçmek için sabit bir model seçin',
        'settings.commit.prompt': 'Ek yönergeler',
        'settings.commit.promptHint': 'örn. Conventional Commits, konu Türkçe, en fazla 72 karakter',
        'settings.commit.tooLong': 'Yalnızca ilk {n} karakter kaydedilir',
        'changes.aiWrite': 'AI ile yaz',
        'changes.aiBusy': 'Yazılıyor…',
        'changes.aiQuota': 'Kendi kotanızı harcar',
        'changes.aiOverwriteTitle': 'Geçerli taslağın yerine geçilsin mi?',
        'changes.aiOverwriteText': 'AI metni yazdığınız commit mesajının yerine geçer (geri alınabilir).',
        'changes.aiUndo': 'Geri al',
        'changes.aiFailed': 'Yazılamadı:',
        'changes.aiNotice': 'Bazı değişiklikler modele gönderilmedi (kısaltıldı veya atlandı); mesaj eksik olabilir.',
        'settings.rail.writeFailed': 'Ayar kaydedilemedi; anahtar eski konumuna döndü. Yeniden deneyin.',
        'settings.rail.readonly': 'Bu ana bilgisayar yapılandırmayı salt okunur sunuyor.',
        'rail.settingsHint': 'Sıralamak için sürükleyin veya okları kullanın; göz simgesi görünürlüğü değiştirir',
        'rail.reset': 'Varsayılanlara dön',
        'rail.up': 'Yukarı taşı',
        'rail.down': 'Aşağı taşı',
        'rail.show': 'Göster',
        'rail.hide': 'Gizle',
        'action.unavailable': 'Geçerli durumda kullanılamaz',
        'filter.branch': 'Dal',
        'filter.user': 'Yazar',
        'history.me': 'Ben',
        'filter.date': 'Tarih',
        'filter.path': 'Yol',
        'filter.all': 'Tümü',
        'filter.today': 'Bugün',
        'filter.week': 'Son 7 gün',
        'filter.month': 'Son 30 gün',
        'filter.year': 'Bu yıl',
        'filter.pathPlaceholder': 'Yola göre filtrele (Enter)',
        'filter.sortDesc': 'En yeniler önce',
        'filter.sortAsc': 'En eskiler önce',
        'filter.clear': 'Filtreleri temizle',
        'filter.none': 'Eşleşen commit yok',
        'toast.undo': 'Geri al',
        'toast.close': 'Kapat',
        'toast.branchDeleted': '{name} dalı silindi',
        'toast.stashDropped': '{ref} saklaması silindi',
        'toast.discarded': '{path} içindeki değişiklikler atıldı',
        'toast.discardNoUndo': '{path} içindeki değişiklikler atıldı (geri alma için fazla büyük)',
        'toast.restored': 'Geri yüklendi',
        'toast.sentToChat': 'Giriş kutusuna gönderildi',
        'toast.sendCopied': 'Gönderilemedi – bunun yerine panoya kopyalandı',
        'undo.menu': 'Son silinenler (geri al)',
        'undo.empty': 'Şu anda geri alınacak bir şey yok',
        'undo.branch': 'Dal',
        'undo.stash': 'Saklama',
        'undo.discard': 'Atma',
        'confirm.typeName': 'Onaylamak için {name} yazın',
        'confirm.protected': '{name} bir ana daldır. Silmek risklidir; onaylamak için dal adını yazın —— ardından bir bildirim onu geri getirebilir.',
        'discard.untracked.confirm': '{path} izlenmeyen dosyası silinsin mi? İçeriği kaldırılır —— ardından bir bildirim onu geri getirebilir.',
        'stashDrop.confirm': '{ref} saklaması silinsin mi? Ardından bir bildirim onu geri getirebilir.',
        'operation.merge': 'Birleştirme sürüyor',
        'operation.rebase': 'Rebase sürüyor',
        'operation.cherry-pick': 'Cherry-pick sürüyor',
        'operation.revert': 'Geri alma sürüyor',
        'operation.bisect': 'Bisect sürüyor',
        'operation.hint': 'Bu depoda hâlâ açık çok adımlı bir işlem var —— dal işlemlerinden önce tamamlayın veya iptal edin',
        'confirm.title': 'Onayla',
        'confirm.cancel': 'İptal',
        'confirm.ok': 'Tamam',
        'prompt.newBranch': 'Yeni dal adı (oluşturulur ve çıkarılır)',
        'prompt.createTracking': 'Uzak daldan yerel dal oluştur',
        'prompt.renameBranch': 'Dalı yeniden adlandır',
        'prompt.newTag': 'Yeni etiket adı',
        'prompt.fromHead': 'geçerli HEAD',
        'error.dismiss': 'Kapat',
        'status.loading': 'Okunuyor...',
        'status.busy': 'Çalışıyor...',
        'counts.staged': 'Hazırlanan {n}',
        'counts.ignored': 'Yok sayılan {n}',
        'counts.unstaged': 'Değişiklikler {n}',
        'counts.untracked': 'İzlenmeyen {n}',
        'counts.conflicted': 'Çakışmalar {n}',
        'push.confirm': '{branch} dalı {upstream} deposuna gönderilsin mi?',
        'push.confirmMany': "{n} dal gönderilecek: {names}. Emin misiniz?",
        'delete.confirm': '{name} dalı silinsin mi? Ardından bir bildirim onu geri getirebilir (git birleştirilmemiş dalları yine de reddeder).',
        'discard.confirm': '{path} içindeki değişiklikler atılsın mı? Çalışma ağacının içeriği üzerine yazılır —— ardından bir bildirim onu geri getirebilir.',
        'resetHard.confirm': '{hash} sürümüne zorla sıfırlansın mı? Commit’lenmemiş değişiklikler kaybolur.',
        'resetSoft.confirm': 'HEAD {hash} sürümüne taşınsın mı (çalışma ağacı korunur)?',
        'checkoutCommit.confirm': '{hash} commit’i çıkarılsın mı? (detached HEAD)',
      },
      /* locale: id */
      'id': {
        'title': 'Git',
        'description': 'Panel Git kelas IDE: pohon branch / grafik commit / perubahan',
        'repo.label': 'Repositori',
        'repo.workspace': 'ruang kerja',
        'repo.nested': 'bersarang',
        'repo.none': 'Ruang kerja ini bukan repositori Git',
        'repo.pick': 'Pilih repositori untuk diperiksa',
        'repo.empty': 'Tidak ada repositori Git di ruang kerja ini',
        'repo.switch': 'Ganti repositori',
        'branch.switch': 'Ganti branch',
        'seg.changes': 'Perubahan {n}',
        'seg.history': 'Riwayat',
        'branches.local': 'Lokal',
        'branches.remote': 'Remote',
        'branches.tags': 'Tag',
        'branches.head': 'HEAD (branch saat ini)',
        'branches.favorites': 'Favorit',
        'branches.starHint': "Favorit",
        'branches.pickHint': 'Klik untuk memilih, klik ganda membuka riwayat',
        'branches.headHint': 'Klik ganda membuka riwayat branch saat ini',
        'branches.worktree': 'Sudah di-checkout di worktree lain',
        'action.stash': 'Stash',
        'action.favorite': 'Tambah/hapus branch saat ini dari favorit',
        'action.newTagHere': 'Tag baru pada commit saat ini...',
        'stash.push': 'Stash perubahan saat ini',
        'stash.apply': 'Terapkan stash terbaru',
        'stash.drop': 'Buang stash terbaru',
        'stash.count': '{n} entri stash',
        'note.noChanges': 'Tidak ada perubahan tertunda',
        'note.noBranches': 'Tidak ada branch lain',
        'branches.filter': 'Branch atau tag',
        'changes.title': 'Perubahan',
        'changes.staged': 'Ter-stage',
        'changes.unstaged': 'Perubahan',
        'changes.untracked': 'Tidak terlacak',
        'changes.conflicted': 'Konflik',
        'changes.empty': 'Tidak ada perubahan tertunda',
        'changes.commitPlaceholder': 'Pesan commit (Ctrl+Enter)',
        'changes.commit': 'Commit',
        'changes.amend': 'Perbaiki commit terakhir',
        'changes.stageAll': 'Stage semua',
        'selection.count': '{n} dipilih',
        'selection.copied': '{n} item disalin',
        'selection.copyPaths': 'Salin jalur',
        'selection.clear': 'Hapus pilihan',
        'action.copyName': 'Salin nama',
        'menu.copyNamesN': 'Salin {n} nama',
        'menu.copyHashesN': 'Salin {n} hash',
        'menu.copyPathsN': 'Salin {n} jalur',
        'menu.stageN': 'Stage {n} item',
        'menu.unstageN': 'Batalkan stage {n} item',
        'menu.discardN': 'Buang {n} item…',
        'menu.cherryN': 'Cherry-pick {n} commit',
        'menu.deleteLocalN': 'Hapus {n} cabang lokal…',
        'menu.deleteRemoteN': 'Hapus {n} cabang remote…',
        'menu.deleteTagsN': 'Hapus {n} tag…',
        'confirm.deleteRefs': 'Hapus referensi terpilih? {b} lokal, {r} remote, {g} tag.',
        'confirm.discardMany': 'Buang perubahan yang belum di-commit dari {n} berkas?',
        'confirm.discardManyUntracked': '{m} berkas yang tidak dilacak akan dihapus permanen.',
        'toast.branchesDeleted': '{n} cabang dihapus',
        'changes.unstageAll': 'Batalkan stage semua',
        'changes.groupBy': 'Kelompokkan menurut',
        'changes.groupFlat': 'Daftar datar',
        'changes.groupDir': 'Per direktori',
        'changes.expandAll': 'Bentangkan semua',
        'changes.foldAll': 'Lipat semua',
        'changes.showIgnored': 'Tampilkan berkas yang diabaikan',
        'changes.rootDir': '(akar)',
        'changes.commitAndPush': 'Commit dan push',
        'action.stage': 'Stage',
        'action.unstage': 'Batalkan stage',
        'action.discard': 'Buang perubahan',
        'action.showDiff': 'Tampilkan diff',
        'action.copyPath': 'Salin jalur',
        'action.checkout': 'Checkout',
        'action.float': 'Apungkan halaman ini',
        'action.dock': 'Kembalikan ke dok',
        'action.split': 'Bagi',
        'action.fullscreen': 'Layar penuh',
        'action.exitFullscreen': 'Keluar dari layar penuh',
        'action.newBranchFrom': 'Branch baru dari sini...',
        'action.setUpstream': 'Atur upstream…',
        'action.unsetUpstream': 'Hapus upstream',
        'action.createLocalBranch': 'Buat branch lokal…',
        'action.newBranchHere': 'Branch baru di sini...',
        'action.rename': 'Ganti nama...',
        'action.delete': 'Hapus',
        'action.mergeIntoCurrent': 'Gabungkan ke branch saat ini',
        'action.rebaseCurrentOnto': 'Rebase branch saat ini ke ini',
        'action.compare': 'Bandingkan dengan branch saat ini',
        'action.update': 'Perbarui (fetch)',
        'action.push': 'Push',
        'action.newTag': 'Tag baru...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Batalkan commit',
        'action.resetSoft': 'Reset ke sini (pertahankan perubahan)',
        'action.resetHard': 'Reset ke sini (buang perubahan)',
        'action.copyHash': 'Salin nomor revisi',
        'action.details': 'Detail commit',
        'menu.sendToChat': 'Kirim ke obrolan',
        'send.commitText': 'commit git {hash} "{subject}" (repositori {repo})',
        'send.branchText': 'cabang git {name} (repositori {repo})',
        'menu.sendDiffLinesToChat': 'Kirim baris terpilih ke obrolan',
        'menu.sendDiffSnippetToChat': 'Kirim cuplikan terpilih ke obrolan',
        'menu.copyDiffRef': 'Salin referensi pilihan',
        'send.diffLinesCommit': '{lines} (commit {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (pohon kerja, {state})',
        'send.diffStaged': 'di-stage',
        'send.diffUnstaged': 'belum di-commit',
        'send.diffNewLines': 'baris {lines}',
        'send.diffOldLines': 'baris {lines} (penomoran lama)',
        'history.empty': 'Repositori ini belum punya commit',
        'history.loadMore': 'Muat lebih banyak',
        'history.filter': 'Teks atau hash',
        'detail.files': 'Berkas yang berubah',
        'detail.pick': 'Pilih commit',
        'detail.back': 'Kembali ke riwayat',
        'detail.noFiles': 'Tidak ada perubahan berkas',
        'diff.empty': 'Tidak ada diff teks untuk ditampilkan',
        'pane.diff': 'tampilan diff',
        'pane.resize': 'Seret untuk mengubah ukuran {name} (klik ganda mengatur ulang, tombol panah menyesuaikan)',
        'diff.binary': 'Berkas biner',
        'diff.loading': 'Memuat diff...',
        'diff.codeLabel': 'Perbedaan',
        'diff.wrapLabel': 'Lipat baris',
        'diff.unwrapLabel': 'Pertahankan kolom sumber',
        'diff.copy': 'Salin',
        'diff.copied': 'Tersalin',
        'toolbar.refresh': 'Segarkan',
      'more.sort': 'Lihat & urutkan',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Perubahan',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Cabang',
      'more.remoteGroup': 'Remote',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Tag',
      'more.commitStaged': 'Commit file yang di-stage...',
      'more.commitAll': 'Commit semua...',
      'more.undoCommit': 'Batalkan commit terakhir',
      'more.rebaseAbort': 'Batalkan rebase',
      'more.commitStagedAmend': 'Commit stage (Amend)...',
      'more.commitAllAmend': 'Commit semua (Amend)...',
      'more.commitStagedSign': 'Commit stage (Ditandatangani)...',
      'more.commitAllSign': 'Commit semua (Ditandatangani)...',
      'prompt.commitMessage': 'Pesan commit',
      'more.discardAll': 'Buang semua perubahan...',
      'more.sync': 'Sinkronkan (pull lalu push)',
      'more.syncRebase': 'Sinkronkan (rebase lalu push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Pull dari remote',
      'more.pushForce': 'Push (Paksa)...',
      'more.pushTo': 'Push ke remote',
      'more.fetchAll': 'Fetch dari semua remote',
      'more.deleteRemoteBranch': 'Hapus cabang remote...',
      'more.publish': 'Publikasikan cabang...',
      'more.setUpstreamHead': 'Atur upstream cabang saat ini…',
      'more.unsetUpstreamHead': 'Hapus upstream cabang saat ini',
      'more.addRemote': 'Tambah remote...',
      'more.removeRemote': 'Hapus remote...',
      'more.stashTracked': 'Stash (hanya yang dilacak)',
      'more.stashStaged': 'Stage yang di-stash',
      'more.stashApplyPick': 'Terapkan stash...',
      'more.stashPopPick': 'Pop stash...',
      'more.stashDropAny': 'Buang stash...',
      'more.stashClear': 'Buang semua stash...',
      'stash.none': 'Tidak ada stash tersedia',
      'more.tagDeleteRemote': 'Hapus tag remote...',
      'more.pushTags': 'Kirim tag...',
      'confirm.undoCommit': 'Batalkan commit terakhir? Perubahannya tetap di stage.',
      'confirm.discardAll': 'Buang SEMUA perubahan yang tidak di-stage dan tidak dilacak? Dapat dipulihkan lewat toast undo (file konflik dikecualikan).',
      'confirm.pushForce': 'Push paksa menimpa remote dengan cabang ini (--force-with-lease menolak jika orang lain sudah push).Lanjutkan?',
      'confirm.deleteRemoteBranch': 'Hapus cabang {branch} di {remote}?',
      'confirm.remoteRemove': 'Hapus remote {name}? Konfigurasi trackingnya ikut terhapus.',
      'confirm.stashClear': 'Buang SEMUA stash? Ini tidak bisa dibatalkan.',
      'confirm.pushTags': 'Kirim semua tag ke {remote}?',
      'prompt.remoteName': 'Nama remote',
      'prompt.remoteUrl': 'URL remote',
      'prompt.deleteRemoteTag': 'Tag remote yang akan dihapus (didorong ke {remote})',
      'toolbar.more': 'Tindakan lainnya',
      'more.sortGit': 'Urutan Git',
      'more.sortPath': 'Menurut jalur',
      'more.sortName': 'Menurut nama',
      'more.sortStatus': 'Menurut status',
      'more.clone': 'Kloning...',
      'more.stashPop': 'Pop stash terbaru',
      'more.deleteTag': 'Hapus tag...',
      'more.gitOutput': 'Tampilkan keluaran Git',
      'clone.title': 'Kloning repositori',
      'clone.url': 'URL repositori',
      'clone.dir': 'Direktori target (jalur absolut)',
      'clone.run': 'Kloning',
      'prompt.deleteTag': 'Nama tag yang akan dihapus',
      'gitLog.title': 'Keluaran Git',
      'gitLog.empty': 'Belum ada eksekusi Git',
        'toolbar.newBranch': 'Branch baru',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "Pull {n} branch terpilih",
        'toolbar.fetchPicked': "Fetch {n} referensi terpilih",
        'toolbar.pushPicked': "Push {n} branch terpilih",
        'toolbar.checkoutPicked': "Checkout branch terpilih",
        'toolbar.deletePicked': "Hapus {n} referensi terpilih",
        'toolbar.push': 'Push',
        'toolbar.tree': 'Panel branch',
        'rail.more': 'Tindakan lain',
        'rail.settings': 'Pengaturan bilah tindakan',
        'rail.openSettings': 'Buka pengaturan plugin',
        'settings.card.title': 'Pengaturan jendela alat Git',
        'settings.card.desc': 'Penempatan panel, tombol bilah aksi dan pesan commit AI',
        'settings.placement.title': 'Penempatan panel',
        'settings.placement.tab': 'Tampilkan tab Git di area percakapan',
      'settings.composer.title': 'Branch di bawah input',
      'settings.composer.hint': 'Menampilkan cabang saat ini di bawah kolom input, di kiri statistik sesi — klik untuk beralih, tersinkron dengan panel Git. Matikan untuk menyembunyikannya.',
      'composer.branchHint': 'Ganti cabang',
      'composer.detached': 'HEAD (lepas)',
      'modelRoute.pick': 'Pilih model',
      'modelRoute.trigger': 'Model pesan commit AI',
      'modelRoute.modelRow': 'Model',
      'modelRoute.effortRow': 'Penalaran',
      'modelRoute.effortDefault': 'Ikuti bawaan',
      'modelRoute.empty': 'Tidak ada model yang tersedia',
      'composer.inWorktree': 'Sudah di-checkout di worktree lain',
      'composer.busy': 'Operasi Git sedang berjalan…',
        'settings.placement.tabHint': 'Dimatikan, panel tetap bisa dibuka dari bilah sisi kanan dan panel bawah.',
        'settings.placement.immersive': 'Mode imersif (tinggi penuh, kolom masukan tersembunyi)',
        'settings.placement.immersiveHint': 'Aktif: tab Git memenuhi seluruh tinggi area percakapan dan kolom masukan mengalah; persetujuan dan pertanyaan tetap tampil.',
        'preview.openFile': 'Buka di pratinjau berkas',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Pilih berkas untuk ditinjau',
        'lf.split': 'Ganti ke tampilan terbagi',
        'lf.unified': 'Ganti ke tampilan tunggal',
        'lf.wrap': 'Aktifkan pelipatan baris',
        'lf.nowrap': 'Nonaktifkan pelipatan baris',
        'lf.created': 'Berkas baru',
        'lf.removedFile': 'Berkas dihapus',
        'lf.truncated': 'Menampilkan {count} baris pertama',
        'preview.title': 'Pratinjau Git',
        'preview.hint': 'Klik “Tampilkan diff” pada file atau commit — diff terbuka di sini, di bilah sisi.',
        'preview.boundary': 'Pratinjau gagal dirender — muat ulang halaman atau laporkan masalahnya.',
        'settings.rail.title': 'Bilah aksi',
        'settings.rail.hint': 'Centang aksi yang ditampilkan di bilah. Urutannya tetap; menghapus centang menyembunyikannya.',
        'settings.rail.unavailable': 'Host ini tidak punya layanan pengaturan; gunakan "Pengaturan bilah aksi" di panel.',
        'settings.commit.title': 'Pesan commit AI',
        'settings.commit.model': 'Model',
        'settings.commit.modelHint': 'Kosong = ikuti sesi ini (provider/model)',
        'settings.commit.modelFollow': 'Ikuti sesi ini',
        'settings.commit.reasoning': 'Intensitas penalaran',
        'settings.commit.reasoningHint': 'Kosong = tanpa penalaran',
        'settings.commit.reasoningDefault': 'Tanpa penalaran (bawaan)',
        'settings.commit.reasoningFollowHint': 'Saat mengikuti sesi, penalaran selalu nonaktif; pilih model tetap untuk memilih tingkat',
        'settings.commit.prompt': 'Instruksi tambahan',
        'settings.commit.promptHint': 'mis. Conventional Commits, subjek bahasa Indonesia, maks 72 karakter',
        'settings.commit.tooLong': 'Hanya {n} karakter pertama yang disimpan',
        'changes.aiWrite': 'Tulis dengan AI',
        'changes.aiBusy': 'Menulis…',
        'changes.aiQuota': 'Memakai kuota Anda',
        'changes.aiOverwriteTitle': 'Ganti draf saat ini?',
        'changes.aiOverwriteText': 'Teks AI akan menggantikan pesan commit yang Anda tulis (bisa dibatalkan).',
        'changes.aiUndo': 'Batalkan',
        'changes.aiFailed': 'Gagal menulis:',
        'changes.aiNotice': 'Sebagian perubahan tidak dikirim ke model (dipotong atau dibuang); pesan bisa tidak lengkap.',
        'settings.rail.writeFailed': 'Pengaturan tidak tersimpan; tombol kembali ke posisi semula. Coba lagi.',
        'settings.rail.readonly': 'Host ini menyajikan konfigurasi hanya-baca.',
        'rail.settingsHint': 'Seret atau pakai panah untuk mengurutkan; ikon mata mengalihkan visibilitas',
        'rail.reset': 'Kembalikan default',
        'rail.up': 'Naikkan',
        'rail.down': 'Turunkan',
        'rail.show': 'Tampilkan',
        'rail.hide': 'Sembunyikan',
        'action.unavailable': 'Tidak tersedia pada keadaan saat ini',
        'filter.branch': 'Branch',
        'filter.user': 'Penulis',
        'history.me': 'Saya',
        'filter.date': 'Tanggal',
        'filter.path': 'Jalur',
        'filter.all': 'Semua',
        'filter.today': 'Hari ini',
        'filter.week': '7 hari terakhir',
        'filter.month': '30 hari terakhir',
        'filter.year': 'Tahun ini',
        'filter.pathPlaceholder': 'Filter menurut jalur (Enter)',
        'filter.sortDesc': 'Terbaru dulu',
        'filter.sortAsc': 'Terlama dulu',
        'filter.clear': 'Hapus filter',
        'filter.none': 'Tidak ada commit yang cocok',
        'toast.undo': 'Urungkan',
        'toast.close': 'Tutup',
        'toast.branchDeleted': 'Branch {name} dihapus',
        'toast.stashDropped': 'Stash {ref} dibuang',
        'toast.discarded': 'Perubahan di {path} dibuang',
        'toast.discardNoUndo': 'Perubahan di {path} dibuang (terlalu besar untuk diurungkan)',
        'toast.restored': 'Dipulihkan',
        'toast.sentToChat': 'Terkirim ke kotak masukan',
        'toast.sendCopied': 'Tidak dapat mengirim — disalin ke papan klip sebagai gantinya',
        'undo.menu': 'Baru dihapus (urungkan)',
        'undo.empty': 'Tidak ada yang bisa diurungkan sekarang',
        'undo.branch': 'Branch',
        'undo.stash': 'Stash',
        'undo.discard': 'Pembuangan',
        'confirm.typeName': 'Ketik {name} untuk mengonfirmasi',
        'confirm.protected': '{name} adalah branch utama. Menghapusnya berisiko, jadi ketik nama branch untuk mengonfirmasi —— notifikasi masih bisa mengembalikannya.',
        'discard.untracked.confirm': 'Hapus berkas tidak terlacak {path}? Isinya dihapus —— notifikasi masih bisa mengembalikannya.',
        'stashDrop.confirm': 'Buang stash {ref}? Notifikasi masih bisa mengembalikannya.',
        'operation.merge': 'Penggabungan berlangsung',
        'operation.rebase': 'Rebase berlangsung',
        'operation.cherry-pick': 'Cherry-pick berlangsung',
        'operation.revert': 'Pembatalan berlangsung',
        'operation.bisect': 'Bisect berlangsung',
        'operation.hint': 'Repositori ini masih punya operasi bertahap yang terbuka —— selesaikan atau batalkan sebelum tindakan tingkat branch',
        'confirm.title': 'Konfirmasi',
        'confirm.cancel': 'Batal',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Nama branch baru (dibuat dan di-checkout)',
        'prompt.createTracking': 'Buat branch lokal dari branch remote',
        'prompt.renameBranch': 'Ganti nama branch',
        'prompt.newTag': 'Nama tag baru',
        'prompt.fromHead': 'HEAD saat ini',
        'error.dismiss': 'Tutup',
        'status.loading': 'Membaca...',
        'status.busy': 'Bekerja...',
        'counts.staged': 'Ter-stage {n}',
        'counts.ignored': 'Diabaikan {n}',
        'counts.unstaged': 'Perubahan {n}',
        'counts.untracked': 'Tidak terlacak {n}',
        'counts.conflicted': 'Konflik {n}',
        'push.confirm': 'Push {branch} ke {upstream}?',
        'push.confirmMany': "Push {n} branch: {names}?",
        'delete.confirm': 'Hapus branch {name}? Notifikasi masih bisa mengembalikannya (git tetap menolak branch yang belum digabung).',
        'discard.confirm': 'Buang perubahan di {path}? Isi worktree ditimpa —— notifikasi masih bisa mengembalikannya.',
        'resetHard.confirm': 'Reset keras ke {hash}? Perubahan yang belum di-commit akan hilang.',
        'resetSoft.confirm': 'Pindahkan HEAD ke {hash} (worktree dipertahankan)?',
        'checkoutCommit.confirm': 'Checkout commit {hash}? (detached HEAD)',
      },
      /* locale: vi */
      'vi': {
        'title': 'Git',
        'description': 'Bảng Git chuẩn IDE: cây nhánh / đồ thị commit / thay đổi',
        'repo.label': 'Kho',
        'repo.workspace': 'không gian làm việc',
        'repo.nested': 'lồng nhau',
        'repo.none': 'Không gian làm việc này không phải kho Git',
        'repo.pick': 'Chọn một kho để xem',
        'repo.empty': 'Không tìm thấy kho Git trong không gian làm việc này',
        'repo.switch': 'Chuyển kho',
        'branch.switch': 'Chuyển nhánh',
        'seg.changes': 'Thay đổi {n}',
        'seg.history': 'Lịch sử',
        'branches.local': 'Cục bộ',
        'branches.remote': 'Từ xa',
        'branches.tags': 'Thẻ',
        'branches.head': 'HEAD (nhánh hiện tại)',
        'branches.favorites': 'Yêu thích',
        'branches.starHint': "Đã yêu thích",
        'branches.pickHint': 'Bấm để chọn, nhấp đúp mở lịch sử commit',
        'branches.headHint': 'Nhấp đúp mở lịch sử của nhánh hiện tại',
        'branches.worktree': 'Đã được checkout ở một worktree khác',
        'action.stash': 'Tạm cất',
        'action.favorite': 'Thêm/bỏ nhánh hiện tại khỏi yêu thích',
        'action.newTagHere': 'Thẻ mới trên commit hiện tại...',
        'stash.push': 'Tạm cất thay đổi hiện tại',
        'stash.apply': 'Áp dụng bản tạm cất mới nhất',
        'stash.drop': 'Xoá bản tạm cất mới nhất',
        'stash.count': '{n} bản tạm cất',
        'note.noChanges': 'Không có thay đổi nào đang chờ',
        'note.noBranches': 'Không có nhánh khác',
        'branches.filter': 'Nhánh hoặc thẻ',
        'changes.title': 'Thay đổi',
        'changes.staged': 'Đã stage',
        'changes.unstaged': 'Thay đổi',
        'changes.untracked': 'Chưa theo dõi',
        'changes.conflicted': 'Xung đột',
        'changes.empty': 'Không có thay đổi nào đang chờ',
        'changes.commitPlaceholder': 'Nội dung commit (Ctrl+Enter)',
        'changes.commit': 'Commit',
        'changes.amend': 'Sửa commit gần nhất',
        'changes.stageAll': 'Stage tất cả',
        'selection.count': 'Đã chọn {n}',
        'selection.copied': 'Đã sao chép {n} mục',
        'selection.copyPaths': 'Sao chép đường dẫn',
        'selection.clear': 'Bỏ chọn',
        'action.copyName': 'Sao chép tên',
        'menu.copyNamesN': 'Sao chép {n} tên',
        'menu.copyHashesN': 'Sao chép {n} hash',
        'menu.copyPathsN': 'Sao chép {n} đường dẫn',
        'menu.stageN': 'Stage {n} mục',
        'menu.unstageN': 'Bỏ stage {n} mục',
        'menu.discardN': 'Bỏ {n} mục…',
        'menu.cherryN': 'Cherry-pick {n} commit',
        'menu.deleteLocalN': 'Xoá {n} nhánh cục bộ…',
        'menu.deleteRemoteN': 'Xoá {n} nhánh từ xa…',
        'menu.deleteTagsN': 'Xoá {n} thẻ…',
        'confirm.deleteRefs': 'Xoá các tham chiếu đã chọn? {b} cục bộ, {r} từ xa, {g} thẻ.',
        'confirm.discardMany': 'Bỏ thay đổi chưa commit của {n} tệp?',
        'confirm.discardManyUntracked': '{m} tệp chưa theo dõi sẽ bị xoá vĩnh viễn.',
        'toast.branchesDeleted': 'Đã xoá {n} nhánh',
        'changes.unstageAll': 'Bỏ stage tất cả',
        'changes.groupBy': 'Nhóm theo',
        'changes.groupFlat': 'Danh sách phẳng',
        'changes.groupDir': 'Theo thư mục',
        'changes.expandAll': 'Mở rộng tất cả',
        'changes.foldAll': 'Thu gọn tất cả',
        'changes.showIgnored': 'Hiện tệp bị bỏ qua',
        'changes.rootDir': '(gốc)',
        'changes.commitAndPush': 'Commit và push',
        'action.stage': 'Stage',
        'action.unstage': 'Bỏ stage',
        'action.discard': 'Bỏ thay đổi',
        'action.showDiff': 'Xem diff',
        'action.copyPath': 'Sao chép đường dẫn',
        'action.checkout': 'Checkout',
        'action.float': 'Tách trang này',
        'action.dock': 'Ghép lại vào dock',
        'action.split': 'Chia',
        'action.fullscreen': 'Toàn màn hình',
        'action.exitFullscreen': 'Thoát toàn màn hình',
        'action.newBranchFrom': 'Nhánh mới từ đây...',
        'action.setUpstream': 'Đặt upstream…',
        'action.unsetUpstream': 'Bỏ upstream',
        'action.createLocalBranch': 'Tạo nhánh cục bộ…',
        'action.newBranchHere': 'Nhánh mới tại đây...',
        'action.rename': 'Đổi tên...',
        'action.delete': 'Xoá',
        'action.mergeIntoCurrent': 'Hợp nhất vào nhánh hiện tại',
        'action.rebaseCurrentOnto': 'Rebase nhánh hiện tại lên nhánh này',
        'action.compare': 'So sánh với nhánh hiện tại',
        'action.update': 'Cập nhật (fetch)',
        'action.push': 'Push',
        'action.newTag': 'Thẻ mới...',
        'action.cherryPick': 'Cherry-pick',
        'action.revert': 'Hoàn tác commit',
        'action.resetSoft': 'Đặt lại về đây (giữ thay đổi)',
        'action.resetHard': 'Đặt lại về đây (bỏ thay đổi)',
        'action.copyHash': 'Sao chép số hiệu bản sửa',
        'action.details': 'Chi tiết commit',
        'menu.sendToChat': 'Gửi vào hội thoại',
        'send.commitText': 'git commit {hash} "{subject}" (kho {repo})',
        'send.branchText': 'nhánh git {name} (kho {repo})',
        'menu.sendDiffLinesToChat': 'Gửi các dòng đã chọn vào hội thoại',
        'menu.sendDiffSnippetToChat': 'Gửi đoạn đã chọn vào hội thoại',
        'menu.copyDiffRef': 'Sao chép tham chiếu vùng chọn',
        'send.diffLinesCommit': '{lines} (commit {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (cây làm việc, {state})',
        'send.diffStaged': 'đã staged',
        'send.diffUnstaged': 'chưa commit',
        'send.diffNewLines': 'dòng {lines}',
        'send.diffOldLines': 'dòng {lines} (đánh số cũ)',
        'history.empty': 'Kho này chưa có commit nào',
        'history.loadMore': 'Tải thêm',
        'history.filter': 'Văn bản hoặc hash',
        'detail.files': 'Tệp đã thay đổi',
        'detail.pick': 'Chọn một commit',
        'detail.back': 'Quay lại lịch sử',
        'detail.noFiles': 'Không có thay đổi tệp',
        'diff.empty': 'Không có diff văn bản để hiển thị',
        'pane.diff': 'chế độ xem diff',
        'pane.resize': 'Kéo để đổi kích thước {name} (nhấp đúp để đặt lại, phím mũi tên để tinh chỉnh)',
        'diff.binary': 'Tệp nhị phân',
        'diff.loading': 'Đang tải diff...',
        'diff.codeLabel': 'Khác biệt',
        'diff.wrapLabel': 'Ngắt dòng',
        'diff.unwrapLabel': 'Giữ độ rộng cột gốc',
        'diff.copy': 'Sao chép',
        'diff.copied': 'Đã sao chép',
        'toolbar.refresh': 'Làm mới',
      'more.sort': 'Xem & sắp xếp',
      'more.commitGroup': 'Commit',
      'more.changesGroup': 'Thay đổi',
      'more.pullpushGroup': 'Pull, Push',
      'more.branchGroup': 'Nhánh',
      'more.remoteGroup': 'Remote',
      'more.stashGroup': 'Stash',
      'more.tagGroup': 'Thẻ',
      'more.commitStaged': 'Commit các tệp đã stage...',
      'more.commitAll': 'Commit tất cả...',
      'more.undoCommit': 'Hoàn tác commit cuối',
      'more.rebaseAbort': 'Hủy rebase',
      'more.commitStagedAmend': 'Commit đã stage (Sửa)...',
      'more.commitAllAmend': 'Commit tất cả (Sửa)...',
      'more.commitStagedSign': 'Commit đã stage (Ký)...',
      'more.commitAllSign': 'Commit tất cả (Ký)...',
      'prompt.commitMessage': 'Thông điệp commit',
      'more.discardAll': 'Bỏ TẤT CẢ thay đổi...',
      'more.sync': 'Đồng bộ (pull rồi push)',
      'more.syncRebase': 'Đồng bộ (rebase rồi push)',
      'more.pullRebase': 'Pull (Rebase)',
      'more.pullFrom': 'Pull từ remote',
      'more.pushForce': 'Push (Ép)...',
      'more.pushTo': 'Push lên remote',
      'more.fetchAll': 'Fetch từ mọi remote',
      'more.deleteRemoteBranch': 'Xóa nhánh remote...',
      'more.publish': 'Công bố nhánh...',
      'more.setUpstreamHead': 'Đặt upstream cho nhánh hiện tại…',
      'more.unsetUpstreamHead': 'Bỏ upstream của nhánh hiện tại',
      'more.addRemote': 'Thêm remote...',
      'more.removeRemote': 'Xóa remote...',
      'more.stashTracked': 'Stash (chỉ theo dõi)',
      'more.stashStaged': 'Stash các tệp đã stage',
      'more.stashApplyPick': 'Áp dụng stash...',
      'more.stashPopPick': 'Pop stash...',
      'more.stashDropAny': 'Xóa stash...',
      'more.stashClear': 'Xóa tất cả stash...',
      'stash.none': 'Không có stash nào',
      'more.tagDeleteRemote': 'Xóa thẻ remote...',
      'more.pushTags': 'Đẩy thẻ...',
      'confirm.undoCommit': 'Hoàn tác commit cuối? Các thay đổi vẫn giữ trong stage.',
      'confirm.discardAll': 'Bỏ TẤT CẢ thay đổi chưa stage và chưa theo dõi? Có thể khôi phục qua toast hoàn tác (trừ tệp xung đột).',
      'confirm.pushForce': 'Push ép sẽ ghi đè remote bằng nhánh này (--force-with-lease từ chối nếu người khác đã đẩy).Tiếp tục?',
      'confirm.deleteRemoteBranch': 'Xóa nhánh {branch} trên {remote}?',
      'confirm.remoteRemove': 'Xóa remote {name}? Cấu hình theo dõi cũng bị xóa.',
      'confirm.stashClear': 'Xóa TẤT CẢ stash? Không thể hoàn tác.',
      'confirm.pushTags': 'Đẩy tất cả thẻ lên {remote}?',
      'prompt.remoteName': 'Tên remote',
      'prompt.remoteUrl': 'URL remote',
      'prompt.deleteRemoteTag': 'Thẻ remote cần xóa (sẽ đẩy lên {remote})',
      'toolbar.more': 'Thao tác khác',
      'more.sortGit': 'Thứ tự Git',
      'more.sortPath': 'Theo đường dẫn',
      'more.sortName': 'Theo tên',
      'more.sortStatus': 'Theo trạng thái',
      'more.clone': 'Clone...',
      'more.stashPop': 'Pop stash gần nhất',
      'more.deleteTag': 'Xóa thẻ...',
      'more.gitOutput': 'Hiện đầu ra Git',
      'clone.title': 'Clone kho',
      'clone.url': 'URL kho',
      'clone.dir': 'Thư mục đích (đường dẫn tuyệt đối)',
      'clone.run': 'Clone',
      'prompt.deleteTag': 'Tên thẻ cần xóa',
      'gitLog.title': 'Đầu ra Git',
      'gitLog.empty': 'Chưa có lần chạy Git nào',
        'toolbar.newBranch': 'Nhánh mới',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "Pull {n} nhánh đã chọn",
        'toolbar.fetchPicked': "Fetch {n} tham chiếu đã chọn",
        'toolbar.pushPicked': "Push {n} nhánh đã chọn",
        'toolbar.checkoutPicked': "Checkout nhánh đã chọn",
        'toolbar.deletePicked': "Xóa {n} tham chiếu đã chọn",
        'toolbar.push': 'Push',
        'toolbar.tree': 'Bảng nhánh',
        'rail.more': 'Thao tác khác',
        'rail.settings': 'Cài đặt thanh thao tác',
        'rail.openSettings': 'Mở cài đặt plugin',
        'settings.card.title': 'Cài đặt cửa sổ công cụ Git',
        'settings.card.desc': 'Vị trí bảng, nút thanh tác vụ và thông điệp commit do AI viết',
        'settings.placement.title': 'Vị trí bảng',
        'settings.placement.tab': 'Hiện thẻ Git trong vùng hội thoại',
      'settings.composer.title': 'Nhánh dưới ô nhập',
      'settings.composer.hint': 'Hiện nhánh hiện tại dưới ô nhập, bên trái thống kê phiên — bấm để chuyển đổi, đồng bộ với bảng Git. Tắt để ẩn.',
      'composer.branchHint': 'Chuyển nhánh',
      'composer.detached': 'HEAD (tách rời)',
      'modelRoute.pick': 'Chọn mô hình',
      'modelRoute.trigger': 'Mô hình tin nhắn commit AI',
      'modelRoute.modelRow': 'Mô hình',
      'modelRoute.effortRow': 'Suy luận',
      'modelRoute.effortDefault': 'Theo mặc định',
      'modelRoute.empty': 'Không có mô hình nào',
      'composer.inWorktree': 'Đã được checkout ở worktree khác',
      'composer.busy': 'Đang chạy tác vụ Git…',
        'settings.placement.tabHint': 'Tắt rồi, bảng vẫn mở được từ thanh bên phải và bảng dưới.',
        'settings.placement.immersive': 'Chế độ đắm chìm (chiều cao đầy đủ, ẩn ô nhập)',
        'settings.placement.immersiveHint': 'Bật: thẻ Git chiếm toàn bộ chiều cao vùng hội thoại và ô nhập thu vào; phê duyệt và câu hỏi vẫn hiển thị bình thường.',
        'preview.openFile': 'Mở trong xem trước tệp',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'Chọn tệp để xem',
        'lf.split': 'Chuyển sang xem đôi',
        'lf.unified': 'Chuyển sang xem đơn',
        'lf.wrap': 'Bật tự động xuống dòng',
        'lf.nowrap': 'Tắt tự động xuống dòng',
        'lf.created': 'Tệp mới tạo',
        'lf.removedFile': 'Tệp bị xóa',
        'lf.truncated': 'Chỉ hiện {count} dòng đầu',
        'preview.title': 'Xem trước Git',
        'preview.hint': 'Bấm “Xem diff” trên tệp hoặc commit — diff sẽ mở ở đây, trên thanh bên.',
        'preview.boundary': 'Không thể hiển thị bản xem trước — hãy tải lại trang hoặc báo cáo sự cố.',
        'settings.rail.title': 'Thanh tác vụ',
        'settings.rail.hint': 'Chọn các tác vụ hiển thị trên thanh. Thứ tự cố định; bỏ chọn sẽ ẩn tác vụ đó.',
        'settings.rail.unavailable': 'Máy chủ này không có dịch vụ cài đặt; hãy dùng “Cài đặt thanh tác vụ” trong bảng điều khiển.',
        'settings.commit.title': 'Thông điệp commit do AI viết',
        'settings.commit.model': 'Mô hình',
        'settings.commit.modelHint': 'Trống = theo phiên này (provider/model)',
        'settings.commit.modelFollow': 'Theo phiên này',
        'settings.commit.reasoning': 'Mức suy luận',
        'settings.commit.reasoningHint': 'Để trống = không suy luận',
        'settings.commit.reasoningDefault': 'Không suy luận (mặc định)',
        'settings.commit.reasoningFollowHint': 'Khi theo phiên, suy luận luôn tắt; chọn một mô hình cố định để chọn mức',
        'settings.commit.prompt': 'Chỉ dẫn bổ sung',
        'settings.commit.promptHint': 'ví dụ Conventional Commits, tiêu đề tiếng Việt, tối đa 72 ký tự',
        'settings.commit.tooLong': 'Chỉ {n} ký tự đầu được lưu',
        'changes.aiWrite': 'Viết bằng AI',
        'changes.aiBusy': 'Đang viết…',
        'changes.aiQuota': 'Dùng hạn mức của bạn',
        'changes.aiOverwriteTitle': 'Thay bản nháp hiện tại?',
        'changes.aiOverwriteText': 'Nội dung AI sẽ thay thế thông điệp commit bạn đã nhập (có thể hoàn tác).',
        'changes.aiUndo': 'Hoàn tác',
        'changes.aiFailed': 'Không viết được:',
        'changes.aiNotice': 'Một số thay đổi chưa gửi tới mô hình (bị cắt hoặc bỏ); thông điệp có thể chưa đầy đủ.',
        'settings.rail.writeFailed': 'Cài đặt không lưu được; công tắc đã trở về trạng thái cũ. Hãy thử lại.',
        'settings.rail.readonly': 'Máy chủ này chỉ cung cấp cấu hình ở chế độ chỉ đọc.',
        'rail.settingsHint': 'Kéo hoặc dùng mũi tên để sắp xếp; biểu tượng con mắt bật tắt hiển thị',
        'rail.reset': 'Khôi phục mặc định',
        'rail.up': 'Di chuyển lên',
        'rail.down': 'Di chuyển xuống',
        'rail.show': 'Hiện',
        'rail.hide': 'Ẩn',
        'action.unavailable': 'Không dùng được ở trạng thái hiện tại',
        'filter.branch': 'Nhánh',
        'filter.user': 'Tác giả',
        'history.me': 'Tôi',
        'filter.date': 'Ngày',
        'filter.path': 'Đường dẫn',
        'filter.all': 'Tất cả',
        'filter.today': 'Hôm nay',
        'filter.week': '7 ngày qua',
        'filter.month': '30 ngày qua',
        'filter.year': 'Năm nay',
        'filter.pathPlaceholder': 'Lọc theo đường dẫn (Enter)',
        'filter.sortDesc': 'Mới nhất trước',
        'filter.sortAsc': 'Cũ nhất trước',
        'filter.clear': 'Xoá bộ lọc',
        'filter.none': 'Không có commit khớp',
        'toast.undo': 'Hoàn tác',
        'toast.close': 'Đóng',
        'toast.branchDeleted': 'Đã xoá nhánh {name}',
        'toast.stashDropped': 'Đã xoá bản tạm cất {ref}',
        'toast.discarded': 'Đã bỏ thay đổi trong {path}',
        'toast.discardNoUndo': 'Đã bỏ thay đổi trong {path} (quá lớn để giữ hoàn tác)',
        'toast.restored': 'Đã khôi phục',
        'toast.sentToChat': 'Đã gửi vào ô nhập',
        'toast.sendCopied': 'Không thể gửi — đã sao chép vào clipboard để thay thế',
        'undo.menu': 'Vừa xoá (hoàn tác)',
        'undo.empty': 'Hiện không có gì để hoàn tác',
        'undo.branch': 'Nhánh',
        'undo.stash': 'Tạm cất',
        'undo.discard': 'Bỏ thay đổi',
        'confirm.typeName': 'Nhập {name} để xác nhận',
        'confirm.protected': '{name} là nhánh chính. Xoá nó rất rủi ro, hãy nhập tên nhánh để xác nhận —— thông báo sau đó vẫn có thể khôi phục.',
        'discard.untracked.confirm': 'Xoá tệp chưa theo dõi {path}? Nội dung sẽ bị xoá —— thông báo sau đó vẫn có thể khôi phục.',
        'stashDrop.confirm': 'Xoá bản tạm cất {ref}? Thông báo sau đó vẫn có thể khôi phục.',
        'operation.merge': 'Đang hợp nhất',
        'operation.rebase': 'Đang rebase',
        'operation.cherry-pick': 'Đang cherry-pick',
        'operation.revert': 'Đang hoàn tác',
        'operation.bisect': 'Đang bisect',
        'operation.hint': 'Kho này vẫn còn một thao tác nhiều bước chưa xong —— hãy hoàn tất hoặc huỷ trước khi thao tác ở mức nhánh',
        'confirm.title': 'Xác nhận',
        'confirm.cancel': 'Huỷ',
        'confirm.ok': 'OK',
        'prompt.newBranch': 'Tên nhánh mới (được tạo và checkout)',
        'prompt.createTracking': 'Tạo nhánh cục bộ từ nhánh từ xa',
        'prompt.renameBranch': 'Đổi tên nhánh',
        'prompt.newTag': 'Tên thẻ mới',
        'prompt.fromHead': 'HEAD hiện tại',
        'error.dismiss': 'Đóng',
        'status.loading': 'Đang đọc...',
        'status.busy': 'Đang xử lý...',
        'counts.staged': 'Đã stage {n}',
        'counts.ignored': 'Bị bỏ qua {n}',
        'counts.unstaged': 'Thay đổi {n}',
        'counts.untracked': 'Chưa theo dõi {n}',
        'counts.conflicted': 'Xung đột {n}',
        'push.confirm': 'Push {branch} lên {upstream}?',
        'push.confirmMany': "Push {n} nhánh: {names}?",
        'delete.confirm': 'Xoá nhánh {name}? Thông báo sau đó vẫn có thể khôi phục (git vẫn từ chối nhánh chưa hợp nhất).',
        'discard.confirm': 'Bỏ thay đổi trong {path}? Nội dung worktree sẽ bị ghi đè —— thông báo sau đó vẫn có thể khôi phục.',
        'resetHard.confirm': 'Đặt lại cứng về {hash}? Thay đổi chưa commit sẽ mất.',
        'resetSoft.confirm': 'Chuyển HEAD về {hash} (giữ worktree)?',
        'checkoutCommit.confirm': 'Checkout commit {hash}? (detached HEAD)',
      },
      /* locale: ar */
      'ar': {
        'title': 'Git',
        'description': 'لوحة Git بمستوى IDE: شجرة الفروع / رسم الالتزامات / التغييرات',
        'repo.label': 'المستودع',
        'repo.workspace': 'مساحة العمل',
        'repo.nested': 'متشعّب',
        'repo.none': 'مساحة العمل هذه ليست مستودع Git',
        'repo.pick': 'اختر مستودعًا لعرضه',
        'repo.empty': 'لم يُعثر على مستودع Git في مساحة العمل هذه',
        'repo.switch': 'تبديل المستودع',
        'branch.switch': 'تبديل الفرع',
        'seg.changes': 'التغييرات {n}',
        'seg.history': 'السجل',
        'branches.local': 'محلي',
        'branches.remote': 'بعيد',
        'branches.tags': 'الوسوم',
        'branches.head': 'HEAD (الفرع الحالي)',
        'branches.favorites': 'المفضلة',
        'branches.starHint': "مفضل",
        'branches.pickHint': 'انقر للتحديد، ونقرتان مزدوجتان لعرض السجل',
        'branches.headHint': 'نقرتان مزدوجتان لعرض سجل الفرع الحالي',
        'branches.worktree': 'مُستخرَج بالفعل في شجرة عمل أخرى',
        'action.stash': 'التخزين المؤقت',
        'action.favorite': 'إضافة الفرع الحالي إلى المفضلة أو إزالته',
        'action.newTagHere': 'وسم جديد على الالتزام الحالي...',
        'stash.push': 'خزّن التغييرات الحالية',
        'stash.apply': 'طبّق أحدث تخزين',
        'stash.drop': 'احذف أحدث تخزين',
        'stash.count': '{n} مدخلات تخزين',
        'note.noChanges': 'لا توجد تغييرات معلّقة',
        'note.noBranches': 'لا توجد فروع أخرى',
        'branches.filter': 'فرع أو وسم',
        'changes.title': 'التغييرات',
        'changes.staged': 'مُجهَّز',
        'changes.unstaged': 'التغييرات',
        'changes.untracked': 'غير متعقَّب',
        'changes.conflicted': 'التعارضات',
        'changes.empty': 'لا توجد تغييرات معلّقة',
        'changes.commitPlaceholder': 'رسالة الالتزام (Ctrl+Enter)',
        'changes.commit': 'التزام',
        'changes.amend': 'تعديل الالتزام الأخير',
        'changes.stageAll': 'جهّز الكل',
        'selection.count': 'تم تحديد {n}',
        'selection.copied': 'تم نسخ {n} عنصرًا',
        'selection.copyPaths': 'انسخ المسارات',
        'selection.clear': 'امسح التحديد',
        'action.copyName': 'انسخ الاسم',
        'menu.copyNamesN': 'انسخ {n} اسمًا',
        'menu.copyHashesN': 'انسخ {n} تجزئة',
        'menu.copyPathsN': 'انسخ {n} مسارًا',
        'menu.stageN': 'جهّز {n} عنصرًا',
        'menu.unstageN': 'ألغِ تجهيز {n} عنصرًا',
        'menu.discardN': 'تجاهل {n} عنصرًا…',
        'menu.cherryN': 'Cherry-pick لـ {n} إيداع',
        'menu.deleteLocalN': 'احذف {n} فرعًا محليًا…',
        'menu.deleteRemoteN': 'احذف {n} فرعًا بعيدًا…',
        'menu.deleteTagsN': 'احذف {n} وسمًا…',
        'confirm.deleteRefs': 'حذف المراجع المحددة؟ {b} محلية و{r} بعيدة و{g} وسوم.',
        'confirm.discardMany': 'تجاهل التغييرات غير المودعة في {n} ملفًا؟',
        'confirm.discardManyUntracked': '{m} ملفًا غير متتبَّع سيُحذف نهائيًا.',
        'toast.branchesDeleted': 'تم حذف {n} فرعًا',
        'changes.unstageAll': 'ألغِ تجهيز الكل',
        'changes.groupBy': 'التجميع حسب',
        'changes.groupFlat': 'قائمة مسطّحة',
        'changes.groupDir': 'حسب الدليل',
        'changes.expandAll': 'وسّع الكل',
        'changes.foldAll': 'اطوِ الكل',
        'changes.showIgnored': 'إظهار الملفات المتجاهَلة',
        'changes.rootDir': '(الجذر)',
        'changes.commitAndPush': 'التزام ودفع',
        'action.stage': 'تجهيز',
        'action.unstage': 'إلغاء التجهيز',
        'action.discard': 'تجاهل التغييرات',
        'action.showDiff': 'عرض الفروق',
        'action.copyPath': 'نسخ المسار',
        'action.checkout': 'تبديل',
        'action.float': 'تعويم هذه الصفحة',
        'action.dock': 'الإرجاع إلى الرصيف',
        'action.split': 'تقسيم',
        'action.fullscreen': 'ملء الشاشة',
        'action.exitFullscreen': 'إنهاء ملء الشاشة',
        'action.newBranchFrom': 'فرع جديد من هنا...',
        'action.setUpstream': 'تعيين upstream…',
        'action.unsetUpstream': 'إزالة upstream',
        'action.createLocalBranch': 'إنشاء فرع محلي…',
        'action.newBranchHere': 'فرع جديد هنا...',
        'action.rename': 'إعادة التسمية...',
        'action.delete': 'حذف',
        'action.mergeIntoCurrent': 'الدمج في الفرع الحالي',
        'action.rebaseCurrentOnto': 'إعادة تأسيس الفرع الحالي على هذا',
        'action.compare': 'المقارنة مع الفرع الحالي',
        'action.update': 'تحديث (fetch)',
        'action.push': 'دفع',
        'action.newTag': 'وسم جديد...',
        'action.cherryPick': 'انتقاء',
        'action.revert': 'تراجع عن الالتزام',
        'action.resetSoft': 'إعادة التعيين هنا (مع الاحتفاظ بالتغييرات)',
        'action.resetHard': 'إعادة التعيين هنا (مع تجاهل التغييرات)',
        'action.copyHash': 'نسخ رقم المراجعة',
        'action.details': 'تفاصيل الالتزام',
        'menu.sendToChat': 'إرسال إلى المحادثة',
        'send.commitText': 'التزام git {hash} "{subject}" (المستودع {repo})',
        'send.branchText': 'فرع git {name} (المستودع {repo})',
        'menu.sendDiffLinesToChat': 'إرسال الأسطر المحددة إلى المحادثة',
        'menu.sendDiffSnippetToChat': 'إرسال المقتطف المحدد إلى المحادثة',
        'menu.copyDiffRef': 'نسخ مرجع التحديد',
        'send.diffLinesCommit': '{lines} (التزام {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (شجرة العمل، {state})',
        'send.diffStaged': 'مُرحَّل',
        'send.diffUnstaged': 'غير مُلتزم',
        'send.diffNewLines': 'الأسطر {lines}',
        'send.diffOldLines': 'الأسطر {lines} (ترقيم قديم)',
        'history.empty': 'لا توجد التزامات في هذا المستودع بعد',
        'history.loadMore': 'تحميل المزيد',
        'history.filter': 'نص أو تجزئة',
        'detail.files': 'الملفات المتغيّرة',
        'detail.pick': 'اختر التزامًا',
        'detail.back': 'رجوع إلى السجل',
        'detail.noFiles': 'لا توجد تغييرات في الملفات',
        'diff.empty': 'لا توجد فروق نصية لعرضها',
        'pane.diff': 'عرض الفروق',
        'pane.resize': 'اسحب لتغيير حجم {name} (النقر المزدوج يعيد الضبط، ومفاتيح الأسهم للضبط الدقيق)',
        'diff.binary': 'ملف ثنائي',
        'diff.loading': 'جارٍ تحميل الفروق...',
        'diff.codeLabel': 'الفروق',
        'diff.wrapLabel': 'التفاف الأسطر',
        'diff.unwrapLabel': 'الحفاظ على أعمدة المصدر',
        'diff.copy': 'نسخ',
        'diff.copied': 'تم النسخ',
        'toolbar.refresh': 'تحديث',
      'more.sort': 'عرض وفرز',
      'more.commitGroup': 'إيداع',
      'more.changesGroup': 'التغييرات',
      'more.pullpushGroup': 'سحب، دفع',
      'more.branchGroup': 'فرع',
      'more.remoteGroup': 'جهاز بعيد',
      'more.stashGroup': 'خبئ',
      'more.tagGroup': 'وسوم',
      'more.commitStaged': 'إيداع الملفات المجهزة...',
      'more.commitAll': 'إيداع الكل...',
      'more.undoCommit': 'تراجع عن آخر إيداع',
      'more.rebaseAbort': 'إلغاء إعادة الأساس',
      'more.commitStagedAmend': 'إيداع المجهز (تعديل)...',
      'more.commitAllAmend': 'إيداع الكل (تعديل)...',
      'more.commitStagedSign': 'إيداع المجهز (موقع)...',
      'more.commitAllSign': 'إيداع الكل (موقع)...',
      'prompt.commitMessage': 'رسالة الإيداع',
      'more.discardAll': 'تجاهل جميع التغييرات...',
      'more.sync': 'مزامنة (سحب ثم دفع)',
      'more.syncRebase': 'مزامنة (إعادة أساس ثم دفع)',
      'more.pullRebase': 'سحب (إعادة أساس)',
      'more.pullFrom': 'سحب من الجهاز البعيد',
      'more.pushForce': 'دفع (قسري)...',
      'more.pushTo': 'دفع إلى جهاز بعيد',
      'more.fetchAll': 'جلب من كل الأجهزة البعيدة',
      'more.deleteRemoteBranch': 'حذف فرع بعيد...',
      'more.publish': 'نشر الفرع...',
      'more.setUpstreamHead': 'تعيين upstream للفرع الحالي…',
      'more.unsetUpstreamHead': 'إزالة upstream للفرع الحالي',
      'more.addRemote': 'إضافة جهاز بعيد...',
      'more.removeRemote': 'إزالة جهاز بعيد...',
      'more.stashTracked': 'خبئ (المتتبع فقط)',
      'more.stashStaged': 'خبئ الملفات المجهزة',
      'more.stashApplyPick': 'تطبيق مخبأ...',
      'more.stashPopPick': 'فرقغ مخبأ...',
      'more.stashDropAny': 'حذف مخبأ...',
      'more.stashClear': 'حذف جميع المخبآء...',
      'stash.none': 'لا توجد مخبآء متاحة',
      'more.tagDeleteRemote': 'حذف وسم بعيد...',
      'more.pushTags': 'دفع الوسوم...',
      'confirm.undoCommit': 'التراجع عن آخر إيداع؟تبقى تغييراته في منطقة التجهيز.',
      'confirm.discardAll': 'تجاهل كل التغييرات غير المجهزة وغير المتتبعة؟يمكن استعادتها من إشعارات التراجع (ملفات التعارض مستثناة).',
      'confirm.pushForce': 'الدفع القسري سيستبدل البعيد بهذا الفرع(--force-with-lease يرفض إن دفع غيرك).المتابعة؟',
      'confirm.deleteRemoteBranch': 'حذف الفرع {branch} على {remote}؟',
      'confirm.remoteRemove': 'إزالة البعيد {name}؟ستُزال إعدادات التتبع معه.',
      'confirm.stashClear': 'حذف جميع المخبآء؟لا يمكن التراجع.',
      'confirm.pushTags': 'دفع كل الوسوم إلى {remote}؟',
      'prompt.remoteName': 'اسم البعيد',
      'prompt.remoteUrl': 'رابط البعيد',
      'prompt.deleteRemoteTag': 'الوسم البعيد المراد حذفه(سيُدفع إلى {remote})',
      'toolbar.more': 'مزيد من الإجراءات',
      'more.sortGit': 'ترتيب Git',
      'more.sortPath': 'حسب المسار',
      'more.sortName': 'حسب الاسم',
      'more.sortStatus': 'حسب الحالة',
      'more.clone': 'استنساخ...',
      'more.stashPop': 'تفريغ آخر stash',
      'more.deleteTag': 'حذف الوسم...',
      'more.gitOutput': 'إظهار مخرجات Git',
      'clone.title': 'استنساخ المستودع',
      'clone.url': 'رابط المستودع',
      'clone.dir': 'المجلد الهدف (مسار مطلق)',
      'clone.run': 'استنساخ',
      'prompt.deleteTag': 'اسم الوسم المطلوب حذفه',
      'gitLog.title': 'مخرجات Git',
      'gitLog.empty': 'لا توجد عمليات Git بعد',
        'toolbar.newBranch': 'فرع جديد',
        'toolbar.fetch': 'جلب',
        'toolbar.pull': 'سحب',
        'toolbar.pullPicked': "سحب {n} فروع مختارة",
        'toolbar.fetchPicked': "جلب {n} مراجع مختارة",
        'toolbar.pushPicked': "دفع {n} فروع مختارة",
        'toolbar.checkoutPicked': "التبديل إلى الفرع المختار",
        'toolbar.deletePicked': "حذف {n} مراجع مختارة",
        'toolbar.push': 'دفع',
        'toolbar.tree': 'لوحة الفروع',
        'rail.more': 'مزيد من الإجراءات',
        'rail.settings': 'إعدادات شريط الإجراءات',
        'rail.openSettings': 'فتح إعدادات الإضافة',
        'settings.card.title': 'إعدادات نافذة أدوات Git',
        'settings.card.desc': 'موضع اللوحة، أزرار شريط الإجراءات ورسالة إيداع بالذكاء الاصطناعي',
        'settings.placement.title': 'موضع اللوحة',
        'settings.placement.tab': 'إظهار تبويب Git في منطقة المحادثة',
      'settings.composer.title': 'الفرع أسفل حقل الإدخال',
      'settings.composer.hint': 'يعرض الفرع الحالي أسفل حقل الإدخال، يسار إحصاءات الجلسة — انقر للتبديل، ومتزامن مع لوحة Git. عند الإيقاف يختفي.',
      'composer.branchHint': 'تبديل الفرع',
      'composer.detached': 'HEAD (منفصل)',
      'modelRoute.pick': 'اختر نموذجًا',
      'modelRoute.trigger': 'نموذج رسائل الالتزام بالذكاء الاصطناعي',
      'modelRoute.modelRow': 'النموذج',
      'modelRoute.effortRow': 'الاستدلال',
      'modelRoute.effortDefault': 'اتبع الافتراضي',
      'modelRoute.empty': 'لا توجد نماذج متاحة',
      'composer.inWorktree': 'مسحوب في شجرة عمل أخرى',
      'composer.busy': 'عملية Git جارية…',
        'settings.placement.tabHint': 'عند الإيقاف تبقى اللوحة متاحة من الشريط الجانبي الأيمن واللوحة السفلية.',
        'settings.placement.immersive': 'الوضع الغامر (ارتفاع كامل، إخفاء صندوق الكتابة)',
        'settings.placement.immersiveHint': 'عند التشغيل يملأ تبويب Git منطقة المحادثة بكامل ارتفاعها ويتراجع صندوق الكتابة؛ تظل الموافقات والأسئلة ظاهرة كالمعتاد.',
        'preview.openFile': 'افتح في معاينة الملف',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'اختر الملف للمراجعة',
        'lf.split': 'التبديل إلى العرض المنقسم',
        'lf.unified': 'التبديل إلى العرض الموحد',
        'lf.wrap': 'تمكين التفاف الأسطر',
        'lf.nowrap': 'تعطيل التفاف الأسطر',
        'lf.created': 'ملف جديد',
        'lf.removedFile': 'ملف محذوف',
        'lf.truncated': 'عرض أول {count} سطرًا فقط',
        'preview.title': 'معاينة Git',
        'preview.hint': 'انقر «عرض الفروق» على ملف أو commit — تُفتح الفروق هنا في الشريط الجانبي.',
        'preview.boundary': 'تعذّر عرض المعاينة — أعد تحميل الصفحة أو أبلغ عن المشكلة.',
        'settings.rail.title': 'شريط الإجراءات',
        'settings.rail.hint': 'حدّد الإجراءات المعروضة على الشريط. الترتيب ثابت، وإلغاء التحديد يخفي الإجراء.',
        'settings.rail.unavailable': 'لا تتوفر خدمة إعدادات على هذا المضيف؛ استخدم «إعدادات شريط الإجراءات» في اللوحة.',
        'settings.commit.title': 'رسالة إيداع بالذكاء الاصطناعي',
        'settings.commit.model': 'النموذج',
        'settings.commit.modelHint': 'فارغ = اتبع هذه الجلسة (provider/model)',
        'settings.commit.modelFollow': 'اتبع هذه الجلسة',
        'settings.commit.reasoning': 'مستوى التفكير',
        'settings.commit.reasoningHint': 'فارغ = بدون استدلال',
        'settings.commit.reasoningDefault': 'بدون استدلال (افتراضي)',
        'settings.commit.reasoningFollowHint': 'عند اتباع الجلسة يكون الاستدلال معطلًا دائمًا؛ اختر نموذجًا ثابتًا لاختيار المستوى',
        'settings.commit.prompt': 'تعليمات إضافية',
        'settings.commit.promptHint': 'مثال: Conventional Commits، والعنوان بالعربية، وبحد أقصى 72 حرفًا',
        'settings.commit.tooLong': 'يُحفظ أول {n} حرفًا فقط',
        'changes.aiWrite': 'اكتب بالذكاء الاصطناعي',
        'changes.aiBusy': 'جارٍ الكتابة…',
        'changes.aiQuota': 'يستهلك حصتك',
        'changes.aiOverwriteTitle': 'استبدال المسودة الحالية؟',
        'changes.aiOverwriteText': 'سيستبدل نص الذكاء الاصطناعي رسالة الإيداع التي كتبتها (يمكن التراجع).',
        'changes.aiUndo': 'تراجع',
        'changes.aiFailed': 'تعذّرت الكتابة:',
        'changes.aiNotice': 'لم تُرسل بعض التغييرات إلى النموذج (مقتطعة أو متروكة)؛ قد تكون الرسالة ناقصة.',
        'settings.rail.writeFailed': 'لم يتم حفظ الإعداد؛ عاد المفتاح إلى حاله. حاول مرة أخرى.',
        'settings.rail.readonly': 'يوفّر هذا المضيف الإعدادات للقراءة فقط.',
        'rail.settingsHint': 'اسحب أو استخدم الأسهم لإعادة الترتيب؛ وأيقونة العين تبدّل الظهور',
        'rail.reset': 'استعادة الإعدادات الافتراضية',
        'rail.up': 'تحريك لأعلى',
        'rail.down': 'تحريك لأسفل',
        'rail.show': 'إظهار',
        'rail.hide': 'إخفاء',
        'action.unavailable': 'غير متاح في الحالة الحالية',
        'filter.branch': 'الفرع',
        'filter.user': 'المؤلف',
        'history.me': 'أنا',
        'filter.date': 'التاريخ',
        'filter.path': 'المسار',
        'filter.all': 'الكل',
        'filter.today': 'اليوم',
        'filter.week': 'آخر 7 أيام',
        'filter.month': 'آخر 30 يومًا',
        'filter.year': 'هذا العام',
        'filter.pathPlaceholder': 'تصفية حسب المسار (Enter)',
        'filter.sortDesc': 'الأحدث أولًا',
        'filter.sortAsc': 'الأقدم أولًا',
        'filter.clear': 'مسح عوامل التصفية',
        'filter.none': 'لا توجد التزامات مطابقة',
        'toast.undo': 'تراجع',
        'toast.close': 'إغلاق',
        'toast.branchDeleted': 'تم حذف الفرع {name}',
        'toast.stashDropped': 'تم حذف التخزين {ref}',
        'toast.discarded': 'تم تجاهل التغييرات في {path}',
        'toast.discardNoUndo': 'تم تجاهل التغييرات في {path} (أكبر من أن يُحتفظ بالتراجع)',
        'toast.restored': 'تمت الاستعادة',
        'toast.sentToChat': 'تم الإرسال إلى مربع الكتابة',
        'toast.sendCopied': 'تعذّر الإرسال — تم النسخ إلى الحافظة بدلًا من ذلك',
        'undo.menu': 'المحذوف حديثًا (تراجع)',
        'undo.empty': 'لا شيء لتراجعه الآن',
        'undo.branch': 'فرع',
        'undo.stash': 'تخزين',
        'undo.discard': 'تجاهل',
        'confirm.typeName': 'اكتب {name} للتأكيد',
        'confirm.protected': '{name} فرع رئيسي. حذفه محفوف بالمخاطر، لذا اكتب اسم الفرع للتأكيد —— ويمكن لإشعار بعد ذلك أن يعيده.',
        'discard.untracked.confirm': 'حذف الملف غير المتعقَّب {path}؟ سيُزال محتواه —— ويمكن لإشعار بعد ذلك أن يعيده.',
        'stashDrop.confirm': 'حذف التخزين {ref}؟ يمكن لإشعار بعد ذلك أن يعيده.',
        'operation.merge': 'الدمج جارٍ',
        'operation.rebase': 'إعادة التأسيس جارية',
        'operation.cherry-pick': 'الانتقاء جارٍ',
        'operation.revert': 'التراجع جارٍ',
        'operation.bisect': 'bisect جارٍ',
        'operation.hint': 'لا يزال في هذا المستودع إجراء متعدد الخطوات مفتوح —— أكمله أو ألغِه قبل إجراءات الفروع',
        'confirm.title': 'تأكيد',
        'confirm.cancel': 'إلغاء',
        'confirm.ok': 'موافق',
        'prompt.newBranch': 'اسم الفرع الجديد (يُنشأ ويُبدَّل إليه)',
        'prompt.createTracking': 'إنشاء فرع محلي من الفرع البعيد',
        'prompt.renameBranch': 'إعادة تسمية الفرع',
        'prompt.newTag': 'اسم الوسم الجديد',
        'prompt.fromHead': 'HEAD الحالي',
        'error.dismiss': 'إغلاق',
        'status.loading': 'جارٍ القراءة...',
        'status.busy': 'جارٍ العمل...',
        'counts.staged': 'مُجهَّز {n}',
        'counts.ignored': 'متجاهَل {n}',
        'counts.unstaged': 'التغييرات {n}',
        'counts.untracked': 'غير متعقَّب {n}',
        'counts.conflicted': 'التعارضات {n}',
        'push.confirm': 'دفع {branch} إلى {upstream}?',
        'push.confirmMany': "دفع {n} فروع: {names}؟",
        'delete.confirm': 'حذف الفرع {name}? يمكن لإشعار بعد ذلك أن يعيده (سيظل git يرفض الفروع غير المدمجة).',
        'discard.confirm': 'تجاهل التغييرات في {path}? سيُستبدل محتوى شجرة العمل —— ويمكن لإشعار بعد ذلك أن يعيده.',
        'resetHard.confirm': 'إعادة تعيين قسرية إلى {hash}? ستفقد التغييرات غير الملتزَم بها.',
        'resetSoft.confirm': 'نقل HEAD إلى {hash} (مع الاحتفاظ بشجرة العمل)?',
        'checkoutCommit.confirm': 'تبديل إلى الالتزام {hash}? (detached HEAD)',
      },
      /* locale: hi */
      'hi': {
        'title': 'Git',
        'description': 'IDE स्तर का Git पैनल: शाखा वृक्ष / कमिट ग्राफ़ / परिवर्तन',
        'repo.label': 'रिपॉज़िटरी',
        'repo.workspace': 'कार्यक्षेत्र',
        'repo.nested': 'नेस्टेड',
        'repo.none': 'यह कार्यक्षेत्र Git रिपॉज़िटरी नहीं है',
        'repo.pick': 'देखने के लिए रिपॉज़िटरी चुनें',
        'repo.empty': 'इस कार्यक्षेत्र में कोई Git रिपॉज़िटरी नहीं मिली',
        'repo.switch': 'रिपॉज़िटरी बदलें',
        'branch.switch': 'शाखा बदलें',
        'seg.changes': 'परिवर्तन {n}',
        'seg.history': 'इतिहास',
        'branches.local': 'स्थानीय',
        'branches.remote': 'रिमोट',
        'branches.tags': 'टैग',
        'branches.head': 'HEAD (वर्तमान शाखा)',
        'branches.favorites': 'पसंदीदा',
        'branches.starHint': "पसंदीदा",
        'branches.pickHint': 'चुनने के लिए क्लिक करें, इतिहास देखने के लिए डबल-क्लिक',
        'branches.headHint': 'डबल-क्लिक से वर्तमान ब्रांच का इतिहास देखें',
        'branches.worktree': 'पहले से किसी अन्य वर्कट्री में चेकआउट है',
        'action.stash': 'स्टैश',
        'action.favorite': 'वर्तमान शाखा को पसंदीदा में जोड़ें/हटाएँ',
        'action.newTagHere': 'वर्तमान कमिट पर नया टैग...',
        'stash.push': 'वर्तमान परिवर्तन स्टैश करें',
        'stash.apply': 'नवीनतम स्टैश लागू करें',
        'stash.drop': 'नवीनतम स्टैश हटाएँ',
        'stash.count': '{n} स्टैश प्रविष्टियाँ',
        'note.noChanges': 'कोई लंबित परिवर्तन नहीं',
        'note.noBranches': 'कोई अन्य शाखा नहीं',
        'branches.filter': 'शाखा या टैग',
        'changes.title': 'परिवर्तन',
        'changes.staged': 'स्टेज्ड',
        'changes.unstaged': 'परिवर्तन',
        'changes.untracked': 'अनट्रैक्ड',
        'changes.conflicted': 'टकराव',
        'changes.empty': 'कोई लंबित परिवर्तन नहीं',
        'changes.commitPlaceholder': 'कमिट संदेश (Ctrl+Enter)',
        'changes.commit': 'कमिट करें',
        'changes.amend': 'पिछला कमिट सुधारें',
        'changes.stageAll': 'सभी स्टेज करें',
        'selection.count': '{n} चयनित',
        'selection.copied': '{n} आइटम कॉपी किए',
        'selection.copyPaths': 'पाथ कॉपी करें',
        'selection.clear': 'चयन हटाएँ',
        'action.copyName': 'नाम कॉपी करें',
        'menu.copyNamesN': '{n} नाम कॉपी करें',
        'menu.copyHashesN': '{n} हैश कॉपी करें',
        'menu.copyPathsN': '{n} पाथ कॉपी करें',
        'menu.stageN': '{n} आइटम स्टेज करें',
        'menu.unstageN': '{n} आइटम अनस्टेज करें',
        'menu.discardN': '{n} आइटम छोड़ें…',
        'menu.cherryN': '{n} कमिट चेरी-पिक करें',
        'menu.deleteLocalN': '{n} लोकल ब्रांच हटाएँ…',
        'menu.deleteRemoteN': '{n} रिमोट ब्रांच हटाएँ…',
        'menu.deleteTagsN': '{n} टैग हटाएँ…',
        'confirm.deleteRefs': 'चयनित रेफ़रेंस हटाएँ? लोकल {b}, रिमोट {r}, टैग {g}।',
        'confirm.discardMany': '{n} फ़ाइलों के अनकमिटेड बदलाव छोड़ें?',
        'confirm.discardManyUntracked': 'इनमें {m} अनट्रैक्ड फ़ाइलें स्थायी रूप से हट जाएँगी।',
        'toast.branchesDeleted': '{n} ब्रांच हटाई गईं',
        'changes.unstageAll': 'सभी अनस्टेज करें',
        'changes.groupBy': 'इसके अनुसार समूह',
        'changes.groupFlat': 'सपाट सूची',
        'changes.groupDir': 'निर्देशिका के अनुसार',
        'changes.expandAll': 'सभी फैलाएँ',
        'changes.foldAll': 'सभी समेटें',
        'changes.showIgnored': 'अनदेखी फ़ाइलें दिखाएँ',
        'changes.rootDir': '(रूट)',
        'changes.commitAndPush': 'कमिट और पुश',
        'action.stage': 'स्टेज',
        'action.unstage': 'अनस्टेज',
        'action.discard': 'परिवर्तन छोड़ें',
        'action.showDiff': 'अंतर दिखाएँ',
        'action.copyPath': 'पथ कॉपी करें',
        'action.checkout': 'चेकआउट',
        'action.float': 'इस पृष्ठ को तैराएँ',
        'action.dock': 'डॉक पर वापस लाएँ',
        'action.split': 'विभाजित करें',
        'action.fullscreen': 'पूर्ण स्क्रीन',
        'action.exitFullscreen': 'पूर्ण स्क्रीन से बाहर',
        'action.newBranchFrom': 'यहाँ से नई शाखा...',
        'action.setUpstream': 'अपस्ट्रीम सेट करें…',
        'action.unsetUpstream': 'अपस्ट्रीम हटाएँ',
        'action.createLocalBranch': 'लोकल शाखा बनाएँ…',
        'action.newBranchHere': 'यहाँ नई शाखा...',
        'action.rename': 'नाम बदलें...',
        'action.delete': 'हटाएँ',
        'action.mergeIntoCurrent': 'वर्तमान शाखा में मर्ज करें',
        'action.rebaseCurrentOnto': 'वर्तमान शाखा को इस पर रीबेस करें',
        'action.compare': 'वर्तमान शाखा से तुलना करें',
        'action.update': 'अद्यतन करें (fetch)',
        'action.push': 'पुश',
        'action.newTag': 'नया टैग...',
        'action.cherryPick': 'चेरी-पिक',
        'action.revert': 'कमिट वापस लें',
        'action.resetSoft': 'यहाँ रीसेट करें (परिवर्तन रखें)',
        'action.resetHard': 'यहाँ रीसेट करें (परिवर्तन छोड़ें)',
        'action.copyHash': 'रिवीज़न संख्या कॉपी करें',
        'action.details': 'कमिट विवरण',
        'menu.sendToChat': 'बातचीत में भेजें',
        'send.commitText': 'git कमिट {hash} "{subject}" (रिपॉज़िटरी {repo})',
        'send.branchText': 'git ब्रांच {name} (रिपॉज़िटरी {repo})',
        'menu.sendDiffLinesToChat': 'चयनित पंक्तियाँ बातचीत में भेजें',
        'menu.sendDiffSnippetToChat': 'चयनित अंश बातचीत में भेजें',
        'menu.copyDiffRef': 'चयन का संदर्भ कॉपी करें',
        'send.diffLinesCommit': '{lines} (कमिट {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (वर्कट्री, {state})',
        'send.diffStaged': 'स्टेज्ड',
        'send.diffUnstaged': 'अनकमिटेड',
        'send.diffNewLines': 'पंक्तियाँ {lines}',
        'send.diffOldLines': 'पंक्तियाँ {lines} (पुरानी क्रमांक)',
        'history.empty': 'इस रिपॉज़िटरी में अभी कोई कमिट नहीं है',
        'history.loadMore': 'और लोड करें',
        'history.filter': 'टेक्स्ट या हैश',
        'detail.files': 'बदली हुई फ़ाइलें',
        'detail.pick': 'एक कमिट चुनें',
        'detail.back': 'इतिहास पर वापस',
        'detail.noFiles': 'कोई फ़ाइल परिवर्तन नहीं',
        'diff.empty': 'दिखाने के लिए कोई टेक्स्ट अंतर नहीं',
        'pane.diff': 'डिफ़ व्यू',
        'pane.resize': '{name} का आकार बदलने के लिए खींचें (डबल-क्लिक रीसेट, तीर कुंजियाँ सूक्ष्म समायोजन)',
        'diff.binary': 'बाइनरी फ़ाइल',
        'diff.loading': 'अंतर लोड हो रहा है...',
        'diff.codeLabel': 'अंतर',
        'diff.wrapLabel': 'पंक्तियाँ रैप करें',
        'diff.unwrapLabel': 'स्रोत कॉलम बनाए रखें',
        'diff.copy': 'कॉपी करें',
        'diff.copied': 'कॉपी हो गया',
        'toolbar.refresh': 'ताज़ा करें',
      'more.sort': 'देखें और क्रमबद्ध करें',
      'more.commitGroup': 'कमिट',
      'more.changesGroup': 'बदलाव',
      'more.pullpushGroup': 'पुल, पुश',
      'more.branchGroup': 'ब्रांच',
      'more.remoteGroup': 'रिमोट',
      'more.stashGroup': 'स्टैश',
      'more.tagGroup': 'टैग',
      'more.commitStaged': 'स्टेज्ड फ़ाइलें कमिट करें...',
      'more.commitAll': 'सभी कमिट करें...',
      'more.undoCommit': 'अंतिम कमिट रद्द करें',
      'more.rebaseAbort': 'रिबेस रोकें',
      'more.commitStagedAmend': 'स्टेज्ड कमिट (संशोधन)...',
      'more.commitAllAmend': 'सभी कमिट (संशोधन)...',
      'more.commitStagedSign': 'स्टेज्ड कमिट (हस्ताक्षरित)...',
      'more.commitAllSign': 'सभी कमिट (हस्ताक्षरित)...',
      'prompt.commitMessage': 'कमिट संदेश',
      'more.discardAll': 'सभी बदलाव छोड़ें...',
      'more.sync': 'सिंक (पुल फिर पुश)',
      'more.syncRebase': 'सिंक (रिबेस फिर पुश)',
      'more.pullRebase': 'पुल (रिबेस)',
      'more.pullFrom': 'रिमोट से पुल',
      'more.pushForce': 'पुश (बलपूर्वक)...',
      'more.pushTo': 'रिमोट पर पुश',
      'more.fetchAll': 'सभी रिमोट से फ़ेच',
      'more.deleteRemoteBranch': 'रिमोट ब्रांच हटाएँ...',
      'more.publish': 'ब्रांच प्रकाशित करें...',
      'more.setUpstreamHead': 'वर्तमान शाखा के लिए अपस्ट्रीम सेट करें…',
      'more.unsetUpstreamHead': 'वर्तमान शाखा का अपस्ट्रीम हटाएँ',
      'more.addRemote': 'रिमोट जोड़ें...',
      'more.removeRemote': 'रिमोट हटाएँ...',
      'more.stashTracked': 'स्टैश (केवल ट्रैक की गई)',
      'more.stashStaged': 'स्टेज्ड स्टैश करें',
      'more.stashApplyPick': 'स्टैश लागू करें...',
      'more.stashPopPick': 'स्टैश पॉप करें...',
      'more.stashDropAny': 'स्टैश हटाएँ...',
      'more.stashClear': 'सभी स्टैश हटाएँ...',
      'stash.none': 'कोई स्टैश उपलब्ध नहीं',
      'more.tagDeleteRemote': 'रिमोट टैग हटाएँ...',
      'more.pushTags': 'टैग पुश करें...',
      'confirm.undoCommit': 'अंतिम कमिट रद्द करें?इसके बदलाव स्टेज पर रहेंगे।',
      'confirm.discardAll': 'सभी अन-स्टेज्ड और अन-ट्रैक्ड बदलाव छोड़ें?अन्डू टोस्ट से पुनर्प्राप्त संभव (कॉन्फ्लिक्ट फ़ाइलें छोड़कर)।',
      'confirm.pushForce': 'फोर्स पुश रिमोट को इस ब्रांच से अधिलेखित करेगा(--force-with-lease अस्वीकार करेगा यदि दूसरों ने पुश किया)।जारी रखें?',
      'confirm.deleteRemoteBranch': '{remote} पर ब्रांच {branch} हटाएँ?',
      'confirm.remoteRemove': 'रिमोट {name} हटाएँ?इसकी ट्रैकिंग सेटिंग भी हट जाएगी।',
      'confirm.stashClear': 'सभी स्टैश हटाएँ?यह पूर्ववत नहीं हो सकता।',
      'confirm.pushTags': 'सभी टैग {remote} पर पुश करें?',
      'prompt.remoteName': 'रिमोट नाम',
      'prompt.remoteUrl': 'रिमोट URL',
      'prompt.deleteRemoteTag': 'हटाने के लिए रिमोट टैग ({remote} पर पुश होगा)',
      'toolbar.more': 'अधिक क्रियाएँ',
      'more.sortGit': 'Git क्रम',
      'more.sortPath': 'पथ से',
      'more.sortName': 'नाम से',
      'more.sortStatus': 'स्थिति से',
      'more.clone': 'क्लोन करें...',
      'more.stashPop': 'नवीनतम स्टैश पॉप करें',
      'more.deleteTag': 'टैग हटाएँ...',
      'more.gitOutput': 'Git आउटपुट दिखाएँ',
      'clone.title': 'रिपॉज़िटरी क्लोन करें',
      'clone.url': 'रिपॉज़िटरी URL',
      'clone.dir': 'लक्ष्य डायरेक्टरी (पूर्ण पथ)',
      'clone.run': 'क्लोन करें',
      'prompt.deleteTag': 'हटाने के लिए टैग नाम',
      'gitLog.title': 'Git आउटपुट',
      'gitLog.empty': 'अभी तक कोई Git रन नहीं',
        'toolbar.newBranch': 'नई शाखा',
        'toolbar.fetch': 'फ़ेच',
        'toolbar.pull': 'पुल',
        'toolbar.pullPicked': "{n} चुनी हुई शाखाएँ पुल करें",
        'toolbar.fetchPicked': "{n} चुने हुए रेफ़रेंस फ़ेच करें",
        'toolbar.pushPicked': "{n} चुनी हुई शाखाएँ पुश करें",
        'toolbar.checkoutPicked': "चुनी हुई शाखा पर स्विच करें",
        'toolbar.deletePicked': "{n} चुने हुए रेफ़रेंस हटाएँ",
        'toolbar.push': 'पुश',
        'toolbar.tree': 'शाखा पैनल',
        'rail.more': 'अधिक क्रियाएँ',
        'rail.settings': 'क्रिया पट्टी सेटिंग्स',
        'rail.openSettings': 'प्लगइन सेटिंग खोलें',
        'settings.card.title': 'Git टूल विंडो सेटिंग्स',
        'settings.card.desc': 'पैनल प्लेसमेंट, एक्शन रेल बटन और AI कमिट संदेश',
        'settings.placement.title': 'पैनल प्लेसमेंट',
        'settings.placement.tab': 'संवाद क्षेत्र में Git टैब दिखाएँ',
      'settings.composer.title': 'इनपुट के नीचे ब्रांच',
      'settings.composer.hint': 'इनपुट के नीचे, सत्र आँकड़ों के बाएँ मौजूदा ब्रांच दिखाता है — बदलने के लिए क्लिक करें, Git पैनल के साथ सिंक। बंद करने पर छिप जाती है।',
      'composer.branchHint': 'शाखा बदलें',
      'composer.detached': 'HEAD (पृथक)',
      'modelRoute.pick': 'मॉडल चुनें',
      'modelRoute.trigger': 'AI कमिट संदेश मॉडल',
      'modelRoute.modelRow': 'मॉडल',
      'modelRoute.effortRow': 'तर्क',
      'modelRoute.effortDefault': 'डिफ़ॉल्ट का पालन करें',
      'modelRoute.empty': 'कोई मॉडल उपलब्ध नहीं',
      'composer.inWorktree': 'दूसरे वर्कट्री में चेकआउट',
      'composer.busy': 'Git कार्य चल रहा है…',
        'settings.placement.tabHint': 'बंद करने पर भी पैनल दाएँ साइडबार और निचले पैनल से खुलता है।',
        'settings.placement.immersive': 'इमर्सिव मोड (पूरी ऊँचाई, छिपा इनपुट बॉक्स)',
        'settings.placement.immersiveHint': 'चालू होने पर Git टैब पूरे संवाद क्षेत्र की ऊँचाई घेर लेता है और इनपुट बॉक्स हट जाता है; अनुमोदन और प्रश्न फिर भी दिखते हैं।',
        'preview.openFile': 'फ़ाइल पूर्वावलोकन में खोलें',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'समीक्षा की फ़ाइल चुनें',
        'lf.split': 'स्प्लिट व्यू पर स्विच करें',
        'lf.unified': 'यूनिफाइड व्यू पर स्विच करें',
        'lf.wrap': 'लाइन रैप चालू करें',
        'lf.nowrap': 'लाइन रैप बंद करें',
        'lf.created': 'नई फ़ाइल',
        'lf.removedFile': 'हटाई गई फ़ाइल',
        'lf.truncated': 'केवल पहली {count} पंक्तियाँ दिखाई जा रही हैं',
        'preview.title': 'Git पूर्वावलोकन',
        'preview.hint': 'फ़ाइल या कमिट पर “अंतर दिखाएँ” पर क्लिक करें — अंतर यहीं साइडबार में खुलेगा।',
        'preview.boundary': 'पूर्वावलोकन रेंडर नहीं हो सका — पृष्ठ पुनः लोड करें या समस्या की रिपोर्ट करें।',
        'settings.rail.title': 'क्रिया रेल',
        'settings.rail.hint': 'रेल पर दिखने वाली क्रियाएँ चुनें। क्रम निश्चित है; चुनाव हटाने पर वह छिप जाती है।',
        'settings.rail.unavailable': 'इस होस्ट में सेटिंग सेवा नहीं है; पैनल में «एक्शन रेल सेटिंग» का उपयोग करें।',
        'settings.commit.title': 'AI कमिट संदेश',
        'settings.commit.model': 'मॉडल',
        'settings.commit.modelHint': 'खाली = इस सत्र का अनुसरण करें (provider/model)',
        'settings.commit.modelFollow': 'इस सत्र का पालन करें',
        'settings.commit.reasoning': 'तर्क की तीव्रता',
        'settings.commit.reasoningHint': 'खाली = कोई तर्क नहीं',
        'settings.commit.reasoningDefault': 'कोई तर्क नहीं (डिफ़ॉल्ट)',
        'settings.commit.reasoningFollowHint': 'सत्र का पालन करते समय तर्क हमेशा बंद रहता है; स्तर चुनने के लिए एक निश्चित मॉडल चुनें',
        'settings.commit.prompt': 'अतिरिक्त निर्देश',
        'settings.commit.promptHint': 'जैसे Conventional Commits, विषय हिंदी में, अधिकतम 72 अक्षर',
        'settings.commit.tooLong': 'केवल पहले {n} अक्षर सहेजे जाते हैं',
        'changes.aiWrite': 'AI से लिखें',
        'changes.aiBusy': 'लिखा जा रहा है…',
        'changes.aiQuota': 'आपका कोटा खर्च होता है',
        'changes.aiOverwriteTitle': 'मौजूदा ड्राफ़्ट बदलें?',
        'changes.aiOverwriteText': 'AI पाठ आपके लिखे कमिट संदेश की जगह लेगा (पूर्ववत कर सकते हैं)।',
        'changes.aiUndo': 'पूर्ववत करें',
        'changes.aiFailed': 'लिख नहीं सका:',
        'changes.aiNotice': 'कुछ बदलाव मॉडल को नहीं भेजे गए (काटे या छोड़े गए); संदेश अधूरा हो सकता है।',
        'settings.rail.writeFailed': 'सेटिंग सहेजी नहीं गई; स्विच वापस पुरानी स्थिति में आ गया। फिर से कोशिश करें।',
        'settings.rail.readonly': 'यह होस्ट कॉन्फ़िगरेशन को केवल-पढ़ने के लिए देता है।',
        'rail.settingsHint': 'क्रम बदलने के लिए खींचें या तीरों का उपयोग करें; आँख आइकन दृश्यता बदलता है',
        'rail.reset': 'डिफ़ॉल्ट बहाल करें',
        'rail.up': 'ऊपर ले जाएँ',
        'rail.down': 'नीचे ले जाएँ',
        'rail.show': 'दिखाएँ',
        'rail.hide': 'छिपाएँ',
        'action.unavailable': 'वर्तमान स्थिति में उपलब्ध नहीं',
        'filter.branch': 'शाखा',
        'filter.user': 'लेखक',
        'history.me': 'मैं',
        'filter.date': 'दिनांक',
        'filter.path': 'पथ',
        'filter.all': 'सभी',
        'filter.today': 'आज',
        'filter.week': 'पिछले 7 दिन',
        'filter.month': 'पिछले 30 दिन',
        'filter.year': 'इस वर्ष',
        'filter.pathPlaceholder': 'पथ से फ़िल्टर करें (Enter)',
        'filter.sortDesc': 'नवीनतम पहले',
        'filter.sortAsc': 'पुराने पहले',
        'filter.clear': 'फ़िल्टर साफ़ करें',
        'filter.none': 'कोई मेल खाता कमिट नहीं',
        'toast.undo': 'पूर्ववत करें',
        'toast.close': 'बंद करें',
        'toast.branchDeleted': 'शाखा {name} हटाई गई',
        'toast.stashDropped': 'स्टैश {ref} हटाया गया',
        'toast.discarded': '{path} में परिवर्तन छोड़े गए',
        'toast.discardNoUndo': '{path} में परिवर्तन छोड़े गए (पूर्ववत रखने के लिए बहुत बड़ा)',
        'toast.restored': 'बहाल किया गया',
        'toast.sentToChat': 'इनपुट बॉक्स में भेज दिया गया',
        'toast.sendCopied': 'भेजा नहीं जा सका — इसके बजाय क्लिपबोर्ड पर कॉपी कर दिया गया',
        'undo.menu': 'हाल में हटाए गए (पूर्ववत करें)',
        'undo.empty': 'अभी पूर्ववत करने के लिए कुछ नहीं',
        'undo.branch': 'शाखा',
        'undo.stash': 'स्टैश',
        'undo.discard': 'छोड़ना',
        'confirm.typeName': 'पुष्टि के लिए {name} लिखें',
        'confirm.protected': '{name} एक मुख्य शाखा है। इसे हटाना जोखिम भरा है, इसलिए पुष्टि के लिए शाखा का नाम लिखें —— बाद में एक सूचना इसे वापस ला सकती है।',
        'discard.untracked.confirm': 'अनट्रैक्ड फ़ाइल {path} हटाएँ? इसकी सामग्री हट जाएगी —— बाद में एक सूचना इसे वापस ला सकती है।',
        'stashDrop.confirm': 'स्टैश {ref} हटाएँ? बाद में एक सूचना इसे वापस ला सकती है।',
        'operation.merge': 'मर्ज जारी है',
        'operation.rebase': 'रीबेस जारी है',
        'operation.cherry-pick': 'चेरी-पिक जारी है',
        'operation.revert': 'वापसी जारी है',
        'operation.bisect': 'bisect जारी है',
        'operation.hint': 'इस रिपॉज़िटरी में अभी एक बहु-चरणीय कार्य खुला है —— शाखा क्रियाओं से पहले उसे पूरा करें या रद्द करें',
        'confirm.title': 'पुष्टि',
        'confirm.cancel': 'रद्द करें',
        'confirm.ok': 'ठीक',
        'prompt.newBranch': 'नई शाखा का नाम (बनाई और चेकआउट की जाएगी)',
        'prompt.createTracking': 'रिमोट शाखा से लोकल शाखा बनाएँ',
        'prompt.renameBranch': 'शाखा का नाम बदलें',
        'prompt.newTag': 'नए टैग का नाम',
        'prompt.fromHead': 'वर्तमान HEAD',
        'error.dismiss': 'बंद करें',
        'status.loading': 'पढ़ा जा रहा है...',
        'status.busy': 'कार्य जारी...',
        'counts.staged': 'स्टेज्ड {n}',
        'counts.ignored': 'अनदेखा {n}',
        'counts.unstaged': 'परिवर्तन {n}',
        'counts.untracked': 'अनट्रैक्ड {n}',
        'counts.conflicted': 'टकराव {n}',
        'push.confirm': '{branch} को {upstream} पर पुश करें?',
        'push.confirmMany': "{n} शाखाएँ पुश करें: {names}?",
        'delete.confirm': 'शाखा {name} हटाएँ? बाद में एक सूचना इसे वापस ला सकती है (git अब भी अनमर्ज्ड शाखाओं से इनकार करता है)।',
        'discard.confirm': '{path} में परिवर्तन छोड़ें? वर्कट्री की सामग्री अधिलेखित हो जाएगी —— बाद में एक सूचना इसे वापस ला सकती है।',
        'resetHard.confirm': '{hash} पर हार्ड रीसेट करें? बिना कमिट किए परिवर्तन खो जाएँगे।',
        'resetSoft.confirm': 'HEAD को {hash} पर ले जाएँ (वर्कट्री सुरक्षित)?',
        'checkoutCommit.confirm': 'कमिट {hash} चेकआउट करें? (detached HEAD)',
      },
      /* locale: th */
      'th': {
        'title': 'Git',
        'description': 'แผง Git ระดับ IDE: ทรีแบรนช์ / กราฟคอมมิต / การเปลี่ยนแปลง',
        'repo.label': 'รีโพซิทอรี',
        'repo.workspace': 'เวิร์กสเปซ',
        'repo.nested': 'ซ้อนกัน',
        'repo.none': 'เวิร์กสเปซนี้ไม่ใช่รีโพซิทอรี Git',
        'repo.pick': 'เลือกรีโพซิทอรีที่จะดู',
        'repo.empty': 'ไม่พบรีโพซิทอรี Git ในเวิร์กสเปซนี้',
        'repo.switch': 'สลับรีโพซิทอรี',
        'branch.switch': 'สลับแบรนช์',
        'seg.changes': 'การเปลี่ยนแปลง {n}',
        'seg.history': 'ประวัติ',
        'branches.local': 'โลคัล',
        'branches.remote': 'รีโมต',
        'branches.tags': 'แท็ก',
        'branches.head': 'HEAD (แบรนช์ปัจจุบัน)',
        'branches.favorites': 'รายการโปรด',
        'branches.starHint': "รายการโปรด",
        'branches.pickHint': 'คลิกเพื่อเลือก ดับเบิลคลิกเพื่อดูประวัติคอมมิต',
        'branches.headHint': 'ดับเบิลคลิกเพื่อดูประวัติของแบรนช์ปัจจุบัน',
        'branches.worktree': 'เช็กเอาต์อยู่ในเวิร์กทรีอื่นแล้ว',
        'action.stash': 'สแตช',
        'action.favorite': 'เพิ่ม/移除แบรนช์ปัจจุบันในรายการโปรด',
        'action.newTagHere': 'แท็กใหม่บนคอมมิตปัจจุบัน...',
        'stash.push': 'สแตชการเปลี่ยนแปลงปัจจุบัน',
        'stash.apply': 'ใช้สแตชล่าสุด',
        'stash.drop': 'ลบสแตชล่าสุด',
        'stash.count': 'สแตช {n} รายการ',
        'note.noChanges': 'ไม่มีการเปลี่ยนแปลงที่ค้างอยู่',
        'note.noBranches': 'ไม่มีแบรนช์อื่น',
        'branches.filter': 'แบรนช์หรือแท็ก',
        'changes.title': 'การเปลี่ยนแปลง',
        'changes.staged': 'สเตจแล้ว',
        'changes.unstaged': 'การเปลี่ยนแปลง',
        'changes.untracked': 'ไม่ถูกติดตาม',
        'changes.conflicted': 'ความขัดแย้ง',
        'changes.empty': 'ไม่มีการเปลี่ยนแปลงที่ค้างอยู่',
        'changes.commitPlaceholder': 'ข้อความคอมมิต (Ctrl+Enter)',
        'changes.commit': 'คอมมิต',
        'changes.amend': 'แก้ไขคอมมิตล่าสุด',
        'changes.stageAll': 'สเตจทั้งหมด',
        'selection.count': 'เลือก {n} รายการ',
        'selection.copied': 'คัดลอก {n} รายการแล้ว',
        'selection.copyPaths': 'คัดลอกพาธ',
        'selection.clear': 'ล้างการเลือก',
        'action.copyName': 'คัดลอกชื่อ',
        'menu.copyNamesN': 'คัดลอกชื่อ {n} รายการ',
        'menu.copyHashesN': 'คัดลอกแฮช {n} รายการ',
        'menu.copyPathsN': 'คัดลอกพาธ {n} รายการ',
        'menu.stageN': 'สเตจ {n} รายการ',
        'menu.unstageN': 'ยกเลิกสเตจ {n} รายการ',
        'menu.discardN': 'ทิ้ง {n} รายการ…',
        'menu.cherryN': 'Cherry-pick {n} คอมมิต',
        'menu.deleteLocalN': 'ลบแบรนช์ในเครื่อง {n} รายการ…',
        'menu.deleteRemoteN': 'ลบแบรนช์รีโมต {n} รายการ…',
        'menu.deleteTagsN': 'ลบแท็ก {n} รายการ…',
        'confirm.deleteRefs': 'ลบรีเฟอเรนซ์ที่เลือก? ในเครื่อง {b} รีโมต {r} แท็ก {g}',
        'confirm.discardMany': 'ทิ้งการเปลี่ยนแปลงที่ยังไม่คอมมิตของ {n} ไฟล์?',
        'confirm.discardManyUntracked': 'ไฟล์ที่ไม่ได้ติดตาม {m} ไฟล์จะถูกลบถาวร',
        'toast.branchesDeleted': 'ลบแบรนช์ {n} รายการแล้ว',
        'changes.unstageAll': 'ยกเลิกสเตจทั้งหมด',
        'changes.groupBy': 'จัดกลุ่มตาม',
        'changes.groupFlat': 'รายการแบน',
        'changes.groupDir': 'ตามไดเรกทอรี',
        'changes.expandAll': 'ขยายทั้งหมด',
        'changes.foldAll': 'ย่อทั้งหมด',
        'changes.showIgnored': 'แสดงไฟล์ที่ถูกเพิกเฉย',
        'changes.rootDir': '(รูท)',
        'changes.commitAndPush': 'คอมมิตและพุช',
        'action.stage': 'สเตจ',
        'action.unstage': 'ยกเลิกสเตจ',
        'action.discard': 'ทิ้งการเปลี่ยนแปลง',
        'action.showDiff': 'แสดงความต่าง',
        'action.copyPath': 'คัดลอกพาธ',
        'action.checkout': 'เช็กเอาต์',
        'action.float': 'ลอยหน้านี้',
        'action.dock': 'กลับเข้าด็อก',
        'action.split': 'แบ่งหน้าต่าง',
        'action.fullscreen': 'เต็มหน้าจอ',
        'action.exitFullscreen': 'ออกจากเต็มหน้าจอ',
        'action.newBranchFrom': 'แบรนช์ใหม่จากที่นี่...',
        'action.setUpstream': 'ตั้งค่า upstream…',
        'action.unsetUpstream': 'ยกเลิก upstream',
        'action.createLocalBranch': 'สร้างแบรนช์ในเครื่อง…',
        'action.newBranchHere': 'แบรนช์ใหม่ที่นี่...',
        'action.rename': 'เปลี่ยนชื่อ...',
        'action.delete': 'ลบ',
        'action.mergeIntoCurrent': 'รวมเข้าแบรนช์ปัจจุบัน',
        'action.rebaseCurrentOnto': 'รีเบสแบรนช์ปัจจุบันไปที่นี้',
        'action.compare': 'เปรียบเทียบกับแบรนช์ปัจจุบัน',
        'action.update': 'อัปเดต (fetch)',
        'action.push': 'พุช',
        'action.newTag': 'แท็กใหม่...',
        'action.cherryPick': 'เชอร์รีพิก',
        'action.revert': 'ย้อนคอมมิต',
        'action.resetSoft': 'รีเซ็ตมาที่นี่ (เก็บการเปลี่ยนแปลง)',
        'action.resetHard': 'รีเซ็ตมาที่นี่ (ทิ้งการเปลี่ยนแปลง)',
        'action.copyHash': 'คัดลอกเลขรีวิชัน',
        'action.details': 'รายละเอียดคอมมิต',
        'menu.sendToChat': 'ส่งไปยังบทสนทนา',
        'send.commitText': 'git คอมมิต {hash} "{subject}" (รีโพซิทอรี {repo})',
        'send.branchText': 'git บรานช์ {name} (รีโพซิทอรี {repo})',
        'menu.sendDiffLinesToChat': 'ส่งบรรทัดที่เลือกไปยังบทสนทนา',
        'menu.sendDiffSnippetToChat': 'ส่งข้อความที่เลือกไปยังบทสนทนา',
        'menu.copyDiffRef': 'คัดลอกการอ้างอิงที่เลือก',
        'send.diffLinesCommit': '{lines} (คอมมิต {hash} "{subject}" @ {branch})',
        'send.diffLinesWorktree': '{lines} (แผนผังงาน, {state})',
        'send.diffStaged': 'สเตจแล้ว',
        'send.diffUnstaged': 'ยังไม่คอมมิต',
        'send.diffNewLines': 'บรรทัด {lines}',
        'send.diffOldLines': 'บรรทัด {lines} (เลขบรรทัดเดิม)',
        'history.empty': 'รีโพซิทอรีนี้ยังไม่มีคอมมิต',
        'history.loadMore': 'โหลดเพิ่ม',
        'history.filter': 'ข้อความหรือแฮช',
        'detail.files': 'ไฟล์ที่เปลี่ยน',
        'detail.pick': 'เลือกคอมมิต',
        'detail.back': 'กลับไปที่ประวัติ',
        'detail.noFiles': 'ไม่มีการเปลี่ยนแปลงไฟล์',
        'diff.empty': 'ไม่มีความต่างเชิงข้อความให้แสดง',
        'pane.diff': 'มุมมอง diff',
        'pane.resize': 'ลากเพื่อปรับขนาด {name} (ดับเบิลคลิกเพื่อรีเซ็ต ปุ่มลูกศรปรับละเอียด)',
        'diff.binary': 'ไฟล์ไบนารี',
        'diff.loading': 'กำลังโหลดความต่าง...',
        'diff.codeLabel': 'ความต่าง',
        'diff.wrapLabel': 'ตัดบรรทัด',
        'diff.unwrapLabel': 'คงความกว้างคอลัมน์เดิม',
        'diff.copy': 'คัดลอก',
        'diff.copied': 'คัดลอกแล้ว',
        'toolbar.refresh': 'รีเฟรช',
      'more.sort': 'ดู & เรียงลำดับ',
      'more.commitGroup': 'คอมมิต',
      'more.changesGroup': 'การเปลี่ยนแปลง',
      'more.pullpushGroup': 'พูล, พุช',
      'more.branchGroup': 'บรานช์',
      'more.remoteGroup': 'รีโมต',
      'more.stashGroup': 'สแตช',
      'more.tagGroup': 'แท็ก',
      'more.commitStaged': 'คอมมิตไฟล์ที่สเตจ...',
      'more.commitAll': 'คอมมิตทั้งหมด...',
      'more.undoCommit': 'ยกเลิกคอมมิตล่าสุด',
      'more.rebaseAbort': 'ยกเลิกรีเบส',
      'more.commitStagedAmend': 'คอมมิตไฟล์ที่สเตจ(แก้ไข)...',
      'more.commitAllAmend': 'คอมมิตทั้งหมด(แก้ไข)...',
      'more.commitStagedSign': 'คอมมิตไฟล์ที่สเตจ(ลงนาม)...',
      'more.commitAllSign': 'คอมมิตทั้งหมด(ลงนาม)...',
      'prompt.commitMessage': 'ข้อความคอมมิต',
      'more.discardAll': 'ทิ้งการเปลี่ยนแปลงทั้งหมด...',
      'more.sync': 'ซิงก์(พูลแล้วพุช)',
      'more.syncRebase': 'ซิงก์(รีเบสแล้วพุช)',
      'more.pullRebase': 'พูล(รีเบส)',
      'more.pullFrom': 'พูลจากรีโมต',
      'more.pushForce': 'พุช(บังคับ)...',
      'more.pushTo': 'พุชไปรีโมต',
      'more.fetchAll': 'ฟีตช์จากทุกรีโมต',
      'more.deleteRemoteBranch': 'ลบบรานช์รีโมต...',
      'more.publish': 'เผยแพร่บรานช์...',
      'more.setUpstreamHead': 'ตั้งค่า upstream ของแบรนช์ปัจจุบัน…',
      'more.unsetUpstreamHead': 'ยกเลิก upstream ของแบรนช์ปัจจุบัน',
      'more.addRemote': 'เพิ่มรีโมต...',
      'more.removeRemote': 'ลบรีโมต...',
      'more.stashTracked': 'สแตช(เฉพาะไฟล์ที่ติดตาม)',
      'more.stashStaged': 'สแตชไฟล์ที่สเตจ',
      'more.stashApplyPick': 'ใช้สแตช...',
      'more.stashPopPick': 'ป๊อปสแตช...',
      'more.stashDropAny': 'ลบสแตช...',
      'more.stashClear': 'ลบสแตชทั้งหมด...',
      'stash.none': 'ไม่มีสแตชที่ใช้ได้',
      'more.tagDeleteRemote': 'ลบแท็กรีโมต...',
      'more.pushTags': 'พุชแท็ก...',
      'confirm.undoCommit': 'ยกเลิกคอมมิตล่าสุด?การเปลี่ยนแปลงจะอยู่ในสเตจ',
      'confirm.discardAll': 'ทิ้งการเปลี่ยนแปลงที่ไม่ได้สเตจและไม่ได้ติดตามทั้งหมด?กู้คืนได้จาก toast เลิกทำ(ยกเว้นไฟล์ขัดแย้ง)',
      'confirm.pushForce': 'พุชแบบบังคับจะเขียนทับรีโมตด้วยบรานช์นี้(--force-with-lease จะปฏิเสธหากคนอื่นพุชแล้ว)ดำเนินการต่อ?',
      'confirm.deleteRemoteBranch': 'ลบบรานช์ {branch} บน {remote}?',
      'confirm.remoteRemove': 'ลบรีโมต {name}?การตั้งค่าติดตามจะถูกลบด้วย',
      'confirm.stashClear': 'ลบสแตชทั้งหมด?ทำไม่ได้ที่จะย้อนกลับ',
      'confirm.pushTags': 'พุชแท็กทั้งหมดไปยัง {remote}?',
      'prompt.remoteName': 'ชื่อรีโมต',
      'prompt.remoteUrl': 'URL รีโมต',
      'prompt.deleteRemoteTag': 'แท็กรีโมตที่จะลบ(จะพุชไปยัง {remote})',
      'toolbar.more': 'การกระทำเพิ่มเติม',
      'more.sortGit': 'ลำดับ Git',
      'more.sortPath': 'ตามเส้นทาง',
      'more.sortName': 'ตามชื่อ',
      'more.sortStatus': 'ตามสถานะ',
      'more.clone': 'โคลน...',
      'more.stashPop': 'ป๊อป stash ล่าสุด',
      'more.deleteTag': 'ลบแท็ก...',
      'more.gitOutput': 'แสดงเอาต์พุต Git',
      'clone.title': 'โคลนรีโพซิทอรี',
      'clone.url': 'URL ของรีโพซิทอรี',
      'clone.dir': 'ไดเรกทอรีเป้าหมาย (พาธสัมบูรณ์)',
      'clone.run': 'โคลน',
      'prompt.deleteTag': 'ชื่อแท็กที่จะลบ',
      'gitLog.title': 'เอาต์พุต Git',
      'gitLog.empty': 'ยังไม่มีการรัน Git',
        'toolbar.newBranch': 'แบรนช์ใหม่',
        'toolbar.fetch': 'Fetch',
        'toolbar.pull': 'Pull',
        'toolbar.pullPicked': "Pull {n} สาขาที่เลือก",
        'toolbar.fetchPicked': "Fetch {n} รีเฟอเรนซ์ที่เลือก",
        'toolbar.pushPicked': "Push {n} สาขาที่เลือก",
        'toolbar.checkoutPicked': "เปลี่ยนไปยังสาขาที่เลือก",
        'toolbar.deletePicked': "ลบ {n} รีเฟอเรนซ์ที่เลือก",
        'toolbar.push': 'Push',
        'toolbar.tree': 'แผงแบรนช์',
        'rail.more': 'การทำงานเพิ่มเติม',
        'rail.settings': 'ตั้งค่าแถบการทำงาน',
        'rail.openSettings': 'เปิดการตั้งค่าปลั๊กอิน',
        'settings.card.title': 'การตั้งค่าหน้าต่างเครื่องมือ Git',
        'settings.card.desc': 'ตำแหน่งแผง, ปุ่มแถบการทำงานและข้อความคอมมิตโดย AI',
        'settings.placement.title': 'ตำแหน่งแผง',
        'settings.placement.tab': 'แสดงแท็บ Git ในพื้นที่บทสนทนา',
      'settings.composer.title': 'สาขาใต้ช่องป้อนข้อความ',
      'settings.composer.hint': 'แสดงสาขาปัจจุบันใต้ช่องป้อนข้อความ ทางซ้ายของสถิติเซสชัน — คลิกเพื่อสลับ และซิงก์กับแผง Git ปิดแล้วจะซ่อน',
      'composer.branchHint': 'สลับแบรนช์',
      'composer.detached': 'HEAD (แยกขาด)',
      'modelRoute.pick': 'เลือกโมเดล',
      'modelRoute.trigger': 'โมเดลข้อความคอมมิต AI',
      'modelRoute.modelRow': 'โมเดล',
      'modelRoute.effortRow': 'การใช้เหตุผล',
      'modelRoute.effortDefault': 'ตามค่าเริ่มต้น',
      'modelRoute.empty': 'ไม่มีโมเดลที่ใช้ได้',
      'composer.inWorktree': 'ถูกเช็คเอาต์ในเวิร์กทรีอื่น',
      'composer.busy': 'กำลังดำเนินการ Git…',
        'settings.placement.tabHint': 'ปิดแล้วยังเปิดแผงจากแถบข้างขวาหรือแผงล่างได้',
        'settings.placement.immersive': 'โหมดดื่มด่ำ (เต็มความสูง, ซ่อนกล่องพิมพ์)',
        'settings.placement.immersiveHint': 'เมื่อเปิด แท็บ Git จะกินพื้นที่สูงทั้งหมดของบทสนทนาและกล่องพิมพ์จะถอยออก; การอนุมัติและคำถามยังแสดงตามปกติ',
        'preview.openFile': 'เปิดในตัวอย่างไฟล์',
        'lf.added': '+{count}',
        'lf.deleted': '-{count}',
        'lf.selectFile': 'เลือกไฟล์ที่จะตรวจสอบ',
        'lf.split': 'สลับเป็นมุมมองคู่',
        'lf.unified': 'สลับเป็นมุมมองเดียว',
        'lf.wrap': 'เปิดการตัดบรรทัด',
        'lf.nowrap': 'ปิดการตัดบรรทัด',
        'lf.created': 'ไฟล์ที่สร้างใหม่',
        'lf.removedFile': 'ไฟล์ที่ถูกลบ',
        'lf.truncated': 'แสดงเฉพาะ {count} บรรทัดแรก',
        'preview.title': 'ดูตัวอย่าง Git',
        'preview.hint': 'คลิก “แสดงความต่าง” ที่ไฟล์หรือคอมมิต — ความต่างจะเปิดที่นี่ในแถบข้าง',
        'preview.boundary': 'แสดงผลตัวอย่างไม่สำเร็จ — โหลดหน้าซ้ำหรือรายงานปัญหา',
        'settings.rail.title': 'แถบการทำงาน',
        'settings.rail.hint': 'ทำเครื่องหมายการทำงานที่จะแสดงบนแถบ ลำดับคงที่; ยกเลิกเครื่องหมายเพื่อซ่อน',
        'settings.rail.unavailable': 'โฮสต์นี้ไม่มีบริการตั้งค่า ให้ใช้ «ตั้งค่าแถบการทำงาน» ในแผง',
        'settings.commit.title': 'ข้อความคอมมิตโดย AI',
        'settings.commit.model': 'โมเดล',
        'settings.commit.modelHint': 'ว่าง = ตามเซสชันนี้ (provider/model)',
        'settings.commit.modelFollow': 'ตามเซสชันนี้',
        'settings.commit.reasoning': 'ระดับการใช้เหตุผล',
        'settings.commit.reasoningHint': 'เว้นว่าง = ไม่ใช้เหตุผล',
        'settings.commit.reasoningDefault': 'ไม่ใช้เหตุผล (ค่าเริ่มต้น)',
        'settings.commit.reasoningFollowHint': 'เมื่อตามเซสชันจะไม่ใช้เหตุผลเสมอ เลือกโมเดลคงที่เพื่อเลือกระดับ',
        'settings.commit.prompt': 'คำสั่งเพิ่มเติม',
        'settings.commit.promptHint': 'เช่น Conventional Commits หัวข้อเป็นภาษาไทย ไม่เกิน 72 ตัวอักษร',
        'settings.commit.tooLong': 'บันทึกเพียง {n} ตัวอักษรแรก',
        'changes.aiWrite': 'เขียนด้วย AI',
        'changes.aiBusy': 'กำลังเขียน…',
        'changes.aiQuota': 'ใช้โควตาของคุณ',
        'changes.aiOverwriteTitle': 'แทนที่ฉบับร่างปัจจุบันหรือไม่',
        'changes.aiOverwriteText': 'ข้อความจาก AI จะแทนที่ข้อความคอมมิตที่คุณพิมพ์ (เลิกทำได้)',
        'changes.aiUndo': 'เลิกทำ',
        'changes.aiFailed': 'เขียนไม่สำเร็จ:',
        'changes.aiNotice': 'มีการเปลี่ยนแปลงบางส่วนที่ไม่ได้ส่งให้โมเดล (ถูกตัดหรือทิ้ง) ข้อความอาจไม่ครบถ้วน',
        'settings.rail.writeFailed': 'บันทึกการตั้งค่าไม่สำเร็จ สวิตช์กลับไปสถานะเดิม ลองอีกครั้ง',
        'settings.rail.readonly': 'โฮสต์นี้ให้บริการการตั้งค่าแบบอ่านอย่างเดียว',
        'rail.settingsHint': 'ลากหรือใช้ลูกศรเพื่อจัดลำดับ; ไอคอนตาใช้สลับการแสดง',
        'rail.reset': 'คืนค่าเริ่มต้น',
        'rail.up': 'เลื่อนขึ้น',
        'rail.down': 'เลื่อนลง',
        'rail.show': 'แสดง',
        'rail.hide': 'ซ่อน',
        'action.unavailable': 'ใช้ไม่ได้ในสถานะปัจจุบัน',
        'filter.branch': 'แบรนช์',
        'filter.user': 'ผู้เขียน',
        'history.me': 'ฉัน',
        'filter.date': 'วันที่',
        'filter.path': 'พาธ',
        'filter.all': 'ทั้งหมด',
        'filter.today': 'วันนี้',
        'filter.week': '7 วันที่ผ่านมา',
        'filter.month': '30 วันที่ผ่านมา',
        'filter.year': 'ปีนี้',
        'filter.pathPlaceholder': 'กรองตามพาธ (Enter)',
        'filter.sortDesc': 'ใหม่สุดก่อน',
        'filter.sortAsc': 'เก่าสุดก่อน',
        'filter.clear': 'ล้างตัวกรอง',
        'filter.none': 'ไม่มีคอมมิตที่ตรงกัน',
        'toast.undo': 'เลิกทำ',
        'toast.close': 'ปิด',
        'toast.branchDeleted': 'ลบแบรนช์ {name} แล้ว',
        'toast.stashDropped': 'ลบสแตช {ref} แล้ว',
        'toast.discarded': 'ทิ้งการเปลี่ยนแปลงใน {path} แล้ว',
        'toast.discardNoUndo': 'ทิ้งการเปลี่ยนแปลงใน {path} แล้ว (ใหญ่เกินกว่าจะเก็บไว้เลิกทำ)',
        'toast.restored': 'กู้คืนแล้ว',
        'toast.sentToChat': 'ส่งไปที่กล่องป้อนข้อความแล้ว',
        'toast.sendCopied': 'ส่งไม่สำเร็จ – คัดลอกไปยังคลิปบอร์ดแทนแล้ว',
        'undo.menu': 'ลบล่าสุด (เลิกทำ)',
        'undo.empty': 'ตอนนี้ไม่มีอะไรให้เลิกทำ',
        'undo.branch': 'แบรนช์',
        'undo.stash': 'สแตช',
        'undo.discard': 'การทิ้ง',
        'confirm.typeName': 'พิมพ์ {name} เพื่อยืนยัน',
        'confirm.protected': '{name} เป็นแบรนช์หลัก การลบมีความเสี่ยงสูง จึงให้พิมพ์ชื่อแบรนช์เพื่อยืนยัน —— จากนั้นยังกู้คืนได้ผ่านการแจ้งเตือน',
        'discard.untracked.confirm': 'ลบไฟล์ที่ไม่ถูกติดตาม {path}? เนื้อหาจะถูกลบ —— จากนั้นยังกู้คืนได้ผ่านการแจ้งเตือน',
        'stashDrop.confirm': 'ลบสแตช {ref}? จากนั้นยังกู้คืนได้ผ่านการแจ้งเตือน',
        'operation.merge': 'กำลังรวม',
        'operation.rebase': 'กำลังรีเบส',
        'operation.cherry-pick': 'กำลังเชอร์รีพิก',
        'operation.revert': 'กำลังย้อน',
        'operation.bisect': 'กำลัง bisect',
        'operation.hint': 'รีโพซิทอรีนี้ยังมีงานหลายขั้นตอนค้างอยู่ —— ทำให้เสร็จหรือยกเลิกก่อนทำการกับแบรนช์',
        'confirm.title': 'ยืนยัน',
        'confirm.cancel': 'ยกเลิก',
        'confirm.ok': 'ตกลง',
        'prompt.newBranch': 'ชื่อแบรนช์ใหม่ (สร้างและเช็กเอาต์ให้)',
        'prompt.createTracking': 'สร้างแบรนช์ในเครื่องจากแบรนช์รีโมต',
        'prompt.renameBranch': 'เปลี่ยนชื่อแบรนช์',
        'prompt.newTag': 'ชื่อแท็กใหม่',
        'prompt.fromHead': 'HEAD ปัจจุบัน',
        'error.dismiss': 'ปิด',
        'status.loading': 'กำลังอ่าน...',
        'status.busy': 'กำลังทำงาน...',
        'counts.staged': 'สเตจแล้ว {n}',
        'counts.ignored': 'เพิกเฉย {n}',
        'counts.unstaged': 'การเปลี่ยนแปลง {n}',
        'counts.untracked': 'ไม่ถูกติดตาม {n}',
        'counts.conflicted': 'ความขัดแย้ง {n}',
        'push.confirm': 'พุช {branch} ไปที่ {upstream}?',
        'push.confirmMany': "จะ Push {n} สาขา: {names} ใช่หรือไม่?",
        'delete.confirm': 'ลบแบรนช์ {name}? จากนั้นยังกู้คืนได้ผ่านการแจ้งเตือน (git ยังคงปฏิเสธแบรนช์ที่ยังไม่รวม)',
        'discard.confirm': 'ทิ้งการเปลี่ยนแปลงใน {path}? เนื้อหาของเวิร์กทรีจะถูกเขียนทับ —— จากนั้นยังกู้คืนได้ผ่านการแจ้งเตือน',
        'resetHard.confirm': 'ฮาร์ดรีเซ็ตไปที่ {hash}? การเปลี่ยนแปลงที่ยังไม่คอมมิตจะหายไป',
        'resetSoft.confirm': 'ย้าย HEAD ไปที่ {hash} (เก็บเวิร์กทรีไว้)?',
        'checkoutCommit.confirm': 'เช็กเอาต์คอมมิต {hash}? (detached HEAD)',
      },
    }

    /* Resolve one locale tag against what this plugin ships: the exact tag,
       then the primary subtag, then English. Chinese is special-cased because
       the traditional variants are shipped while a bare zh-Hant-* is not
       spelled out. */
    function dictionaryFor(active) {
      const raw = active === undefined || active === null || active === '' ? 'en' : String(active)
      const tag = raw.toLowerCase().replace(/_/g, '-')
      const primary = tag.split('-')[0]
      if (primary === 'zh') {
        if (hasOwnKey(LOCALES, tag)) return LOCALES[tag]
        if (tag.indexOf('hant') >= 0 || tag === 'zh-hk' || tag === 'zh-mo' || tag === 'zh-tw') {
          return hasOwnKey(LOCALES, 'zh-hk') ? LOCALES['zh-hk'] : ZH
        }
        return ZH
      }
      if (hasOwnKey(LOCALES, primary)) return LOCALES[primary]
      return EN
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
    function translatorOf(ctx) {
      let cachedTag = null
      let cachedDict = null
      return (key) => {
        const tag = activeLocaleOf(ctx)
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

    async function request(method, payload) {
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
       snapped back to defaults and folders re-folded. One localStorage home,
       GLOBAL by design: which sections you keep folded is a habit, not a
       property of the repository. ---- */
    const TREE_KEY = 'dsh-git4idea.tree.v1'

    function readTreeState() {
      try {
        const raw = window.localStorage.getItem(TREE_KEY)
        if (raw === null || raw === '') return null
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : null
      } catch (error) { void error }
      return null
    }

    function writeTreeState(state) {
      try { window.localStorage.setItem(TREE_KEY, JSON.stringify(state)) } catch (error) { void error }
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

    /* ---- ai commit pickers (issue #7): the model catalog and per-model
       reasoning efforts, served by the host's commit-models / commit-efforts
       routes. Cached for a short window so the settings card can mount twice
       without asking twice; a failed or empty lookup degrades the row to its
       plain text field (the hand-typed value keeps working: routing accepts
       unlisted ids), never to an error. ---- */
    const PICKER_TTL_MS = 30_000
    let commitCatalogCache = null
    let commitCatalogFlight = null
    const commitEffortsCache = new Map()

    function pickerProvidersOf(catalog) {
      if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.providers)) return null
      return catalog.providers
    }

    async function fetchCommitCatalog() {
      if (commitCatalogCache !== null && Date.now() - commitCatalogCache.at < PICKER_TTL_MS) {
        return pickerProvidersOf(commitCatalogCache.value)
      }
      if (commitCatalogFlight !== null) return commitCatalogFlight
      commitCatalogFlight = request('commit-models', {})
        .then(
          (value) => {
            commitCatalogCache = { at: Date.now(), value: value }
            return pickerProvidersOf(value)
          },
          () => null,
        )
      commitCatalogFlight.then(() => { commitCatalogFlight = null }, () => { commitCatalogFlight = null })
      return commitCatalogFlight
      return commitCatalogFlight
    }

    async function fetchCommitEfforts(model) {
      const hit = commitEffortsCache.get(model)
      if (hit !== undefined && Date.now() - hit.at < PICKER_TTL_MS) return hit.value
      const value = await request('commit-efforts', { model: model })
      commitEffortsCache.set(model, { at: Date.now(), value: value })
      return value
    }

    function readRememberedRepo(sessionId) {
      try {
        const raw = window.localStorage.getItem(REPO_KEY)
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
        const raw = window.localStorage.getItem(REPO_KEY)
        const parsed = raw === null || raw === '' ? {} : JSON.parse(raw)
        const next = parsed !== null && typeof parsed === 'object' ? parsed : {}
        next[sessionId] = repoPath
        window.localStorage.setItem(REPO_KEY, JSON.stringify(next))
      } catch (error) { void error }
    }

    const FAV_KEY = 'dsh-git4idea.favorites.v1'

    function readFavorites(repoPath) {
      try {
        const raw = window.localStorage.getItem(FAV_KEY)
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
        const raw = window.localStorage.getItem(FAV_KEY)
        const parsed = raw === null || raw === '' ? {} : JSON.parse(raw)
        const all = parsed !== null && typeof parsed === 'object' ? parsed : {}
        all[repoPath] = next
        window.localStorage.setItem(FAV_KEY, JSON.stringify(all))
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

    /* ---------------------------------------------------------------------
       Where the rail config LIVES. On dsh >= 0.1.7 a plugin's configuration is
       the row Config (the official settings surface, persisted by the host under
       the loader row id) and the browser reads it through ctx.configForms — so
       the settings card and the rail read ONE source and nothing is written
       twice. An older host has no such service: there the rail keeps its
       localStorage home and its in-panel editor, which is the only editor those
       hosts have. `railForm` is that switch; null means legacy.
       --------------------------------------------------------------------- */
    const RAIL_NS = 'git4idea'
    /* One write window for the settings card: a burst of switches becomes one
       atomic mutation instead of a stream the Host can lose. */
    const FLUSH_MS = 250
    const RAIL_MIGRATED_KEY = 'dsh-git4idea.rail.v1.migrated'
    let railForm = null
    let railMigrating = false
    const railWatchers = new Set()

    /* ---- rail config core (pure: tests/smoke.mjs slices this block) ---- */
    function railFieldOf(id) {
      return 'rail' + id.charAt(0).toUpperCase() + id.slice(1)
    }

    /* Stored booleans -> the { order, hidden } shape the rail has always used.
       The order is the code order now: the settings card edits one switch per
       action, so a stored permutation would have no editor left, and dropping it
       keeps this surface honest rather than half-editable. */
    function railConfigOfValues(values) {
      const source = values !== null && typeof values === 'object' ? values : {}
      const hidden = RAIL_IDS.filter((id) => source[railFieldOf(id)] === false)
      return { order: RAIL_IDS.slice(), hidden: hidden }
    }

    /* The inverse of railFieldOf, for the one-field write path. Returns null for a
       field no rail action owns, so a caller cannot invent a row-Config key. */
    function railIdOfField(field) {
      if (typeof field !== 'string' || field.indexOf('rail') !== 0 || field.length <= 4) return null
      const name = field.slice(4)
      const id = name.charAt(0).toLowerCase() + name.slice(1)
      return RAIL_IDS.indexOf(id) < 0 ? null : id
    }

    function railValuesOfConfig(config) {
      const values = {}
      for (const id of RAIL_IDS) values[railFieldOf(id)] = config.hidden.indexOf(id) < 0
      return values
    }

    /* ---- end rail config core ---- */

    /* The three AI-commit settings live in the same row Config document the
       settings card writes; the panel reads them per render, so a change in the
       card applies to the next click without a reload. */
    function readCommitSettings() {
      let values = {}
      const ready = railFormReady()
      if (ready !== null && ready.value !== null && typeof ready.value === 'object') values = ready.value
      const text = (field, max) => (typeof values[field] === 'string' ? values[field].trim().slice(0, max) : '')
      return { model: text('commitModel', 120), reasoning: text('commitReasoning', 60), prompt: text('commitPrompt', 2000) }
    }

    function railFormReady() {
      if (railForm === null) return null
      const snapshot = railForm.getSnapshot()
      if (snapshot === null || snapshot === undefined || snapshot.status !== 'ready' || snapshot.value === undefined) return null
      return snapshot
    }

    /* The conversation seat's immersive mode (issue #8 round 3, placement
       group): the view rides the host's composer-overlay contract so it fills
       the WHOLE conversation height, and the composer seat hides while the Git
       view owns the ring. Default ON — that full-height space is why the tab
       placement exists at all; the settings card flips it live. A host without
       the row Config keeps the immersive seat (same policy as the tab switch). */
    function conversationImmersiveEnabled() {
      const ready = railFormReady()
      if (ready === null) return true
      const value = ready.value !== null && typeof ready.value === 'object' ? ready.value.immersive : undefined
      return value !== false
    }

    function readRailConfig() {
      const ready = railFormReady()
      if (ready !== null) return railConfigOfValues(ready.value)
      // Legacy home (and the state before the host answers): localStorage.
      try {
        const raw = window.localStorage.getItem(RAIL_KEY)
        if (raw === null || raw === '') return normalizeRail(null)
        return normalizeRail(JSON.parse(raw))
      } catch (error) { void error }
      return normalizeRail(null)
    }

    /* `form` lets a caller write through the exact handle it read from (the
       settings card gets the framework's own form); without it the module handle
       is used. When a config surface EXISTS but is not ready yet, the write is
       refused instead of silently landing in the legacy localStorage home — two
       sources would be worse than a refused edit. */
    function writeRailConfig(config, form) {
      const active = form !== undefined && form !== null && typeof form.getSnapshot === 'function' ? form : railForm
      let ready = null
      try {
        const snapshot = active === null || active === undefined ? null : active.getSnapshot()
        if (snapshot !== null && snapshot !== undefined && snapshot.status === 'ready' && snapshot.value !== undefined) ready = snapshot
      } catch (error) { void error }
      if (ready !== null) {
        if (ready.writable !== true || typeof active.set !== 'function') return
        railForm = active
        const current = ready.value !== null && typeof ready.value === 'object' ? ready.value : {}
        // Only the fields that actually changed: one write, not sixteen.
        for (const id of RAIL_IDS) {
          const field = railFieldOf(id)
          const visible = config.hidden.indexOf(id) < 0
          if (current[field] === visible) continue
          const written = active.set(field, visible)
          if (written !== undefined && written !== null && typeof written.then === 'function') {
            void written.then((accepted) => {
              if (accepted === false) console.warn('[dsh-git4idea] rail setting "' + field + '" was refused by the host')
            }, (error) => { console.warn('[dsh-git4idea] rail setting write failed: ' + String(error && error.message ? error.message : error)) })
          }
        }
        return
      }
      if (railForm !== null) return
      try { window.localStorage.setItem(RAIL_KEY, JSON.stringify(config)) } catch (error) { void error }
    }

    /* One switch, one field, one write — computed from the value the user just
       chose rather than from a whole-config snapshot that may predate the click.
       The card edits one field at a time, and a full-config write derived from a
       stale render clobbers whichever sibling was toggled a moment earlier
       (measured on 16 rapid toggles: 4 fields never reached the row Config and
       reverted on reload).
       Returns the write's disposition so the caller can roll its optimistic value
       back and say so instead of leaving a switch that lies:
         sent:true            + settled:Promise<boolean> when the Host answers
         sent:false, reason   'read-only' | 'not-ready' | 'unknown'. */
    function writeRailFields(ops, form) {
      const active = form !== undefined && form !== null && typeof form.getSnapshot === 'function' ? form : railForm
      let ready = null
      try {
        const snapshot = active === null || active === undefined ? null : active.getSnapshot()
        if (snapshot !== null && snapshot !== undefined && snapshot.status === 'ready' && snapshot.value !== undefined) ready = snapshot
      } catch (error) { void error }
      if (ready !== null) {
        if (ready.writable !== true || typeof active.mutate !== 'function') return { sent: false, reason: 'read-only' }
        railForm = active
        const settled = Promise.resolve(active.mutate(ops)).then(
          (accepted) => accepted !== false,
          (error) => {
            console.warn('[dsh-git4idea] rail setting write failed: ' + String(error && error.message ? error.message : error))
            return false
          },
        )
        return { sent: true, settled: settled }
      }
      /* A config surface that exists but has not answered yet must refuse rather
         than fall through to the legacy home: two sources would be worse. */
      if (railForm !== null) return { sent: false, reason: 'not-ready' }
      const current = readRailConfig()
      let hidden = current.hidden.slice()
      for (const op of ops) {
        const id = railIdOfField(String(op.path[0]))
        if (id === null) return { sent: false, reason: 'unknown' }
        const wanted = op.value === true
        if (wanted === true) hidden = hidden.filter((entry) => entry !== id)
        else if (hidden.indexOf(id) < 0) hidden = hidden.concat([id])
      }
      try { window.localStorage.setItem(RAIL_KEY, JSON.stringify({ order: current.order, hidden: hidden })) } catch (error) { void error }
      notifyRailConfig()
      return { sent: true }
    }

    /* One switch's write. The card batches a burst through writeRailFields so the
       Host sees one atomic mutation instead of a stream of overlapping ones. */
    function writeRailField(field, value, form) {
      return writeRailFields([{ op: 'set', path: [field], value: value }], form)
    }

    /* One-shot move of the pre-settings rail config into the row Config: read the
       legacy value ONCE, write it through, mark it done. After this the row Config
       is the only source (the legacy key is left untouched as a paper trail, but
       nothing writes it any more on this host). */
    function migrateRailConfig(form) {
      try {
        if (window.localStorage.getItem(RAIL_MIGRATED_KEY) !== null) return
        if (railMigrating === true) return
        const done = () => {
          railMigrating = false
          try { window.localStorage.setItem(RAIL_MIGRATED_KEY, '1') } catch (error) { void error }
        }
        const raw = window.localStorage.getItem(RAIL_KEY)
        if (raw === null || raw === '') { done(); return }
        const values = railValuesOfConfig(normalizeRail(JSON.parse(raw)))
        const ready = railFormReady()
        const accepted = ready !== null && ready.value !== null && typeof ready.value === 'object' ? ready.value : {}
        const ops = []
        for (const id of RAIL_IDS) {
          const field = railFieldOf(id)
          if (accepted[field] === values[field]) continue
          ops.push({ op: 'set', path: [field], value: values[field] === true })
        }
        if (ops.length === 0) { done(); return }
        /* ONE atomic mutation, and the marker ONLY once the Host accepted it.
           The per-field set() loop this replaces fired sixteen unawaited writes
           and stamped the marker right away, so on a real profile fifteen of the
           sixteen fields (and in one case all of them) never reached the row
           Config and were never retried — an upgrade silently lost the user's
           rail settings while the marker claimed success. A refusal, a failed
           write or a superseded one now leaves the marker unwritten so the next
           load migrates again. */
        railMigrating = true
        const outcome = writeRailFields(ops, form)
        if (outcome.sent !== true) {
          railMigrating = false
          console.warn('[dsh-git4idea] legacy rail migration was refused (' + String(outcome.reason) + '); it stays unmarked and is retried')
          return
        }
        if (outcome.settled === undefined) { done(); return }
        void outcome.settled.then((acceptedWrite) => {
          if (acceptedWrite === true) { done(); return }
          railMigrating = false
          console.warn('[dsh-git4idea] legacy rail migration was not accepted; it stays unmarked and is retried')
        })
      } catch (error) { void error }
    }

    function subscribeRailConfig(listener) {
      railWatchers.add(listener)
      return () => { railWatchers.delete(listener) }
    }

    function notifyRailConfig() {
      for (const listener of Array.from(railWatchers)) {
        try { listener() } catch (error) { void error }
      }
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
        const raw = window.localStorage.getItem(PANES_KEY)
        if (raw === null || raw === '') return normalizePanes(null)
        return normalizePanes(JSON.parse(raw))
      } catch (error) { void error }
      return normalizePanes(null)
    }

    function writePanes(config) {
      try { window.localStorage.setItem(PANES_KEY, JSON.stringify(normalizePanes(config))) } catch (error) { void error }
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

    function buildRows(commits) {
      /* The log is a WINDOW: the oldest visible commits usually have parents
         that were never loaded. A parent outside the window must not park its
         hash on a lane — the lane would stay occupied for the rest of the
         page (the hash can never be consumed), every later branch tip would
         claim yet another fresh lane, and the drawing degenerated into a
         bundle of independent parallel lines that pushed the subjects out of
         the panel. So the pass first learns which hashes are actually on the
         board, and an edge to anything else simply ends at its commit. */
      const present = new Set()
      for (const commit of commits) present.add(commit.hash)
      const lanes = []
      /* The current branch keeps the LEFTMOST column whenever it is on the
         board: pre-seeding its hash makes that commit claim lane 0 when its
         row arrives, so HEAD's line never drifts to the right of a side
         branch (the rest of the lanes fill newest-first, see below). */
      const headCommit = commits.find((commit) => Array.isArray(commit.refs) && commit.refs.some((ref) => String(ref).indexOf('HEAD') >= 0))
      if (headCommit !== undefined) lanes.push(headCommit.hash)
      const rows = []
      for (const commit of commits) {
        const before = lanes.slice()
        let lane = lanes.indexOf(commit.hash)
        if (lane === -1) {
          lane = lanes.indexOf(null)
          if (lane === -1) { lanes.push(null); lane = lanes.length - 1 }
        }
        const parents = Array.isArray(commit.parents) ? commit.parents : []
        const parentLanes = []
        /* A commit whose parent already sits on ANOTHER lane merges into it:
           its own lane ends here and the edge is drawn across. Until v0.4.1 the
           first parent was parked on the commit's own lane unconditionally, so
           a branch that merged back into a lane to its left kept a stub of its
           own colour running on above the junction — a fork that never
           happened. Only a parent that is not on the board yet inherits the
           lane, and (v0.5.4) only a parent that is on the board at all: a
           parent past the loaded window ends the lane at this row instead of
           holding it for a commit that will never arrive. */
        if (parents.length > 0) {
          const first = lanes.indexOf(parents[0])
          if (first !== -1 && first !== lane) {
            lanes[lane] = null
            parentLanes.push(first)
          } else if (present.has(parents[0])) {
            lanes[lane] = parents[0]
          } else {
            lanes[lane] = null
          }
        } else {
          lanes[lane] = null
        }
        for (let index = 1; index < parents.length; index += 1) {
          const parent = parents[index]
          if (!present.has(parent)) continue
          let slot = lanes.indexOf(parent)
          if (slot === -1) {
            slot = lanes.indexOf(null)
            if (slot === -1) { lanes.push(parent); slot = lanes.length - 1 }
            else lanes[slot] = parent
          }
          parentLanes.push(slot)
        }
        rows.push({ commit, lane, parentLanes, before: before, after: lanes.slice(), width: 1 })
      }
      let laneCount = 1
      for (const row of rows) laneCount = Math.max(laneCount, row.before.length, row.after.length)
      for (const row of rows) row.width = laneCount
      return rows
    }

    /* One SVG per row, but the geometry is chosen so that rows stack into ONE
       continuous graph: a lane segment always covers the full row box (0..height)
       whenever the lane exists above and below, and only rounds off to the row
       centre where the lane genuinely starts (a branch tip) or ends (a root).
       v0.1.7 started every non-own lane at 0 and every own lane at height/2, which
       left a visible gap between two consecutive commits on the same lane. */
    /* Vertical lane segments for one row. A lane that this row OPENS through an
       edge curve (it was empty above, and the curve lands at the row bottom) must
       NOT also get a vertical segment from the row centre: the two overlapped and
       left a floating hook where the line visibly started in mid-air — reported
       twice by the user as "断开的线/无端点的分叉". The curve alone carries the
       connection, and the next row's segment starts at its top edge. */
    function laneSegments(row, height) {
      const middle = height / 2
      const depth = Math.max(row.before.length, row.after.length)
      const segments = []
      for (let lane = 0; lane < depth; lane += 1) {
        const above = lane < row.before.length ? row.before[lane] : null
        const below = lane < row.after.length ? row.after[lane] : null
        const hasTop = above !== null && above !== undefined
        const hasBottom = below !== null && below !== undefined
        if (hasTop === false && hasBottom === false) continue
        if (hasTop === false && row.parentLanes.indexOf(lane) >= 0) continue
        const y1 = hasTop ? 0 : middle
        const y2 = hasBottom ? height : middle
        if (y1 === y2) continue
        segments.push({ lane: lane, y1: y1, y2: y2 })
      }
      return segments
    }

    /* Memoised: rows come from a useMemo, so a row object is referentially
       stable across re-renders unless the commit list actually changed — the
       26px graph cells then skip re-rendering on every filter keystroke. */
    /* IDEA paints no curves: a lane is a vertical stem, and a branch edge
       leaves the node at the row centre and reaches the parent lane at the row
       bottom as a straight diagonal (SimpleGraphCellPainter.kt). The next
       row's stem then starts at its own top edge, so consecutive rows read as
       one continuous wiring — the elbow look of the IDE log. */
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
      for (const segment of laneSegments(row, height)) {
        children.push(E('line', {
          key: 'lane-' + segment.lane,
          'data-lane': String(segment.lane),
          x1: x(segment.lane), y1: segment.y1, x2: x(segment.lane), y2: segment.y2,
          stroke: color(segment.lane), strokeWidth: stem, strokeLinecap: 'round',
        }))
      }
      for (const parentLane of row.parentLanes) {
        if (parentLane === row.lane) continue
        children.push(E('line', {
          key: 'edge-' + parentLane,
          'data-lane': String(parentLane),
          x1: x(row.lane), y1: middle, x2: x(parentLane), y2: height,
          stroke: color(parentLane), strokeWidth: stem, strokeLinecap: 'round',
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
      const oldText = []
      const newText = []
      for (const line of lines) {
        if (line.indexOf('+++ ') === 0) {
          const name = line.slice(4).split('\t')[0]
          if (name !== '/dev/null') path = name.replace(/^b\//, '')
          continue
        }
        if (line.indexOf('--- ') === 0) {
          if (path === null) {
            const name = line.slice(4).split('\t')[0]
            if (name !== '/dev/null') path = name.replace(/^a\//, '')
          }
          continue
        }
        if (line.indexOf('@@') === 0) continue
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

    /* split/wrap preferences are habits, not tab state — one localStorage
       home, the same policy as the tree folds. */
    const LINEDIFF_KEY = 'dsh-git4idea.linediff.v1'
    function readLineDiffPrefs() {
      try {
        const raw = window.localStorage.getItem(LINEDIFF_KEY)
        const parsed = raw === null ? null : JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object'
          ? { split: parsed.split === true, wrap: parsed.wrap === true }
          : { split: false, wrap: false }
      } catch (error) { void error }
      return { split: false, wrap: false }
    }
    function writeLineDiffPrefs(prefs) {
      try { window.localStorage.setItem(LINEDIFF_KEY, JSON.stringify(prefs)) } catch (error) { void error }
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
      const spans = props.spans
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
      const spans = props.spans
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
      const hunks = props.hunks
      const highlights = props.highlights
      const paired = useMemo(() => hunks.map((hunk) => ({ header: hunkHeader(hunk), rows: splitRows(hunk) })), [hunks])
      const leftRef = useRef(null)
      const rightRef = useRef(null)
      const offsets = useRef({ left: { x: 0, y: 0 }, right: { x: 0, y: 0 } })
      const follow = (side) => (event) => {
        const peer = side === 'left' ? rightRef : leftRef
        const other = peer.current
        if (other === null) return
        for (const axis of ['scrollLeft', 'scrollTop']) {
          const value = event.currentTarget[axis]
          const key = axis === 'scrollLeft' ? 'x' : 'y'
          if (offsets.current[side][key] === value) continue
          offsets.current[side][key] = value
          other[axis] = value
          offsets.current[side === 'left' ? 'right' : 'left'][key] = other[axis]
        }
      }
      return E('div', { className: 'git4idea-lf-columns' },
        ['left', 'right'].map((side) => E('div', {
          key: side,
          className: 'git4idea-lf-column',
          'data-diff-side': side,
          ref: side === 'left' ? leftRef : rightRef,
          onScroll: follow(side),
        }, paired.map((hunk, position) => E('section', { key: position, className: 'git4idea-lf-hunk' },
          E('div', { className: 'git4idea-lf-hunkHeader', 'data-diff-hunk-header': '' }, hunk.header),
          hunk.rows.map((row, at) => {
            const cell = row[side]
            const spans = cell === undefined ? undefined : highlights[position][side === 'left' ? 'old' : 'new']
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
        return E('span', { title: props.label }, inner)
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
      }
      render() {
        if (this.state.failed === true) return E('div', { className: 'git4idea-preview-boundary' }, this.props.message)
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
        if (file === undefined) return { hunks: [], truncated: false, maps: [] }
        const result = renderedHunks(file.hunks)
        return { hunks: result.hunks, truncated: result.truncated, maps: result.hunks.map((hunk) => hunkHighlights(hunk, highlighter)) }
      }, [file, highlighter])
      const hasAdditions = file !== undefined && file.hunks.some((hunk) => hunk.lines.some((line) => line.indexOf('+') === 0))
      const hasDeletions = file !== undefined && file.hunks.some((hunk) => hunk.lines.some((line) => line.indexOf('-') === 0))
      const oneSided = hasAdditions !== hasDeletions
      const split = prefs.split === true && oneSided !== true
      const wrap = prefs.wrap === true
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
        title: file.path,
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
        : E('span', { className: 'git4idea-lf-selectorStatic', title: file.path },
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
          : E('div', { className: 'git4idea-lf-body', 'data-review-view': split === true ? 'split' : 'unified', 'data-review-wrap': wrap === true ? '' : undefined },
              file.created === true ? E('p', { className: 'git4idea-lf-note' }, t('lf.created')) : null,
              file.removed === true ? E('p', { className: 'git4idea-lf-note' }, t('lf.removedFile')) : null,
              cut.truncated === true ? E('p', { className: 'git4idea-lf-note' }, fill(t('lf.truncated'), { count: String(LINEDIFF_MAX_LINES) })) : null,
              split === true && wrap !== true
                ? E(SplitColumns, { hunks: cut.hunks, highlights: cut.maps })
                : cut.hunks.map((hunk, position) => {
                    const paired = split === true ? splitRows(hunk) : null
                    // The wrapped branch must iterate the SAME row list it indexes
                    // (issue #16): splitRows pairs del/add runs, so its length is
                    // max(dels, adds) per run — strictly less than hunkRows'
                    // per-line count whenever anything pairs. Indexing paired with
                    // hunkRows' indices handed SplitLine an undefined row and took
                    // the whole panel down (no boundary above it). Each paired
                    // entry is already { left, right } — exactly SplitLine's shape.
                    const rows = split === true ? paired : hunkRows(hunk)
                    return E('section', { key: position, className: 'git4idea-lf-hunk' },
                      E('div', { className: 'git4idea-lf-hunkHeader', 'data-diff-hunk-header': '' }, hunkHeader(hunk)),
                      rows.map((row, at) => split === true
                        ? E(SplitLine, { key: at, row: row, spans: cut.maps[position] })
                        : E(UnifiedLine, { key: at, row: row, spans: cut.maps[position] })))
                  })))
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
        setSub({ items: item.items, flip: flip, top: Math.max(0, itemRect.top - cardRect.top - 4) })
      }
      const renderItem = (item, index, inSub) => {
        if (item === null) return E('div', { key: 'sep-' + index, className: 'git4idea-menu-sep' })
        const hasSub = inSub !== true && Array.isArray(item.items) === true && item.items.length > 0
        return E('button', {
          key: item.id + '-' + index + (inSub === true ? '-sub' : ''),
          type: 'button',
          title: item.disabled === true && item.reason !== undefined ? item.reason : '',
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
        sub === null ? null : E('div', { className: 'git4idea-menu git4idea-menu-sub', 'data-menu-material': 'translucent', style: sub.flip === true ? { right: '100%', top: sub.top + 'px' } : { left: '100%', top: sub.top + 'px' } },
          E('div', { className: 'git4idea-menu-scroll' },
            sub.items.map((item, index) => renderItem(item, index, true)))))
    }

    /* Lets the user choose which actions the rail shows and in which order. The
       list is drag-sortable and arrow-sortable (the arrows also work with a
       keyboard); visibility is a per-action toggle, not a delete, so a hidden
       action keeps its position. */
    /* The plugin's settings card. It lives on the plugin's detail page (slot
       `plugins.bundle.config`, keyed by the PACKAGE name), and it is the only
       editor when the host serves the row Config — the in-panel editor is not
       reachable there. The legacy Settings → Plugins seat went away with the
       raised host floor.

       A host without that service still renders the card (the seat exists), so it
       says so instead of pretending to have settings. */
    function RailSettingsCard(props) {
      const t = props.t
      const [tick, setTick] = useState(0)
      /* Collapse state of the card shell (the li card on the list seat). The
         plugin-page seat (props.view === 'page') renders flat. */
      const [openCard, setOpenCard] = useState(false)
      const [pending, setPending] = useState({})
      const [note, setNote] = useState('')
      /* The three AI-commit settings are free text, so they are drafted locally
         and written on blur / Enter — one write per edit, never one per keystroke. */
      const [textDraft, setTextDraft] = useState({})
      /* Picker data (issue #7): the model catalog once per mount, and the
         reasoning efforts of whichever model the settings currently name.
         null = not answered yet; an empty array = answered with nothing. Both
         degrade the row to its plain text field, never to an error — a
         hand-typed value keeps working because routing accepts unlisted ids. */
      const [pickers, setPickers] = useState({ catalog: null, efforts: null })
      /* The user's latest intent per field, written SYNCHRONOUSLY. React state is
         not enough: two clicks inside one frame would both read the pre-click
         snapshot, so the second click recomputed the same target and the toggle
         was lost (measured: a fast double click on one switch netted one step
         instead of returning to where it started). */
      const intent = useRef({})
      const timers = useRef(new Set())
      const dirty = useRef(new Map())
      const pendingFlush = useRef(null)
      const bump = () => setTick((value) => value + 1)
      /* Writes the Host answers ok for can still be lost when several overlap its
         persist cycle: measured on this surface, 16 switches toggled 55ms apart
         left 3 fields at their old value in the row Config while every request
         answered 200, and the same 16 at 500ms apart all landed. So a switch is
         only "done" when the accepted document agrees — checked once after the
         burst settles, re-issued once, and otherwise rolled back and reported. */
      const reconcile = (field, want, attempt) => {
        const timer = setTimeout(() => {
          timers.current.delete(timer)
          let hostValue
          try {
            const snapshot = scope === null || scope === undefined ? null : scope.getSnapshot()
            hostValue = snapshot !== null && snapshot !== undefined && snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value[field] : undefined
          } catch (error) { hostValue = undefined }
          if (hostValue === want) return
          if (attempt === 0) {
            const again = writeRailField(field, want, scope)
            if (again.sent === true) {
              if (again.settled !== undefined) void again.settled.then(() => { reconcile(field, want, 1) })
              else reconcile(field, want, 1)
              return
            }
          }
          delete intent.current[field]
          setPending((now) => { const copy = Object.assign({}, now); delete copy[field]; return copy })
          setNote(t('settings.rail.writeFailed'))
        }, 600)
        timers.current.add(timer)
      }
      const rollbackFields = (fields) => {
        for (const field of fields) {
          delete intent.current[field]
          setPending((now) => { const copy = Object.assign({}, now); delete copy[field]; return copy })
        }
      }
      /* One atomic mutation for the whole burst. Sixteen separate writes 55ms
         apart lost 3 fields inside the Host's persist cycle while every request
         answered 200 (the same sixteen 500ms apart all landed), so the fix is to
         stop producing a burst: collect the fields the user touched and submit
         them together, at most one mutation per window. */
      const commitTextField = (field, max) => {
        const accepted = values[field] === undefined || values[field] === null ? '' : String(values[field])
        const shown = Object.prototype.hasOwnProperty.call(textDraft, field) ? textDraft[field] : accepted
        const wanted = shown.slice(0, max)
        if (wanted === accepted) return
        const outcome = writeRailFields([{ op: 'set', path: [field], value: wanted }], scope)
        if (outcome.sent !== true) {
          setNote(t(outcome.reason === 'read-only' ? 'settings.rail.readonly' : 'settings.rail.writeFailed'))
          return
        }
        if (outcome.settled === undefined) return
        void outcome.settled.then((ok) => {
          if (ok !== true) { setNote(t('settings.rail.writeFailed')); return }
          /* The accepted document now carries it: drop the draft so the control
             shows the Host's own value again. */
          setTextDraft((now) => { const copy = Object.assign({}, now); delete copy[field]; return copy })
        })
      }
      /* A picker row writes on CHANGE (a select has no blur-edit cycle): the
         optimistic value lands in the same textDraft the text rows use, so the
         control does not snap back to the accepted document for the round trip
         the host needs to echo the write. */
      const commitSelectField = (field, value) => {
        if (readOnly === true) { setNote(t('settings.rail.readonly')); return }
        setTextDraft((now) => Object.assign({}, now, { [field]: value }))
        const outcome = writeRailFields([{ op: 'set', path: [field], value: value }], scope)
        if (outcome.sent !== true) {
          setTextDraft((now) => { const copy = Object.assign({}, now); delete copy[field]; return copy })
          setNote(t(outcome.reason === 'read-only' ? 'settings.rail.readonly' : 'settings.rail.writeFailed'))
          return
        }
        if (outcome.settled === undefined) return
        void outcome.settled.then((ok) => {
          if (ok !== true) {
            setTextDraft((now) => { const copy = Object.assign({}, now); delete copy[field]; return copy })
            setNote(t('settings.rail.writeFailed'))
            return
          }
          /* The accepted document now carries it: drop the draft so the control
             shows the Host's own value again — the same contract a text row's
             blur commit keeps. */
          setTextDraft((now) => { const copy = Object.assign({}, now); delete copy[field]; return copy })
        })
      }
      const textRow = (field, labelKey, hintKey, max, multiline) => {
        const accepted = values[field] === undefined || values[field] === null ? '' : String(values[field])
        const shown = Object.prototype.hasOwnProperty.call(textDraft, field) ? textDraft[field] : accepted
        const id = 'git4idea-' + field
        const common = {
          id: id, className: 'git4idea-input git4idea-settings-input', value: shown, spellCheck: false,
          disabled: readOnly === true, placeholder: t(hintKey), 'aria-labelledby': id + '-label',
          onChange: (event) => setTextDraft((now) => Object.assign({}, now, { [field]: event.target.value })),
          onBlur: () => commitTextField(field, max),
        }
        if (multiline === true) common.onKeyDown = (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commitTextField(field, max) }
        else common.onKeyDown = (event) => { if (event.key === 'Enter') commitTextField(field, max) }
        return E('div', { className: 'git4idea-settings-text', key: field },
          E('label', { id: id + '-label', className: 'git4idea-settings-text-label', htmlFor: id }, t(labelKey)),
          multiline === true ? E('textarea', Object.assign({ rows: 3 }, common)) : E('input', Object.assign({ type: 'text' }, common)),
          shown.length >= max ? E('div', { className: 'git4idea-settings-error' }, fill(t('settings.commit.tooLong'), { n: String(max) })) : null)
      }
      /* A picker row: same shell as a text row, but a <select>. `children` are
         the options (built by the caller); a stored value the list does not
         carry is injected as its own option, because a controlled select whose
         value matches no option renders blank and the setting would LOOK lost. */
      const selectRow = (field, labelKey, value, children, disabled, hint) => {
        const id = 'git4idea-' + field
        return E('div', { className: 'git4idea-settings-text', key: field },
          E('label', { id: id + '-label', className: 'git4idea-settings-text-label', htmlFor: id }, t(labelKey)),
          E('select', {
            id: id, className: 'git4idea-input git4idea-settings-input', value: value, disabled: disabled === true,
            'aria-labelledby': id + '-label',
            onChange: (event) => commitSelectField(field, event.target.value),
          }, children),
          hint === null ? null : E('div', { className: 'git4idea-settings-subnote' }, hint))
      }
      /* Collapsible sections, HAND-DRAWN. The official disclosure row was ruled
         out the same way the sibling dsh-gitbash-shell ruled it out (v0.38.0 -
         0.38.3): the ui-primitives module shape this plugin's restricted require
         returns does not expose it, so a borrowed component silently degrades to
         a flat title+stack pile. One button + one conditional draws the whole
         thing: the header row always renders, the body only while open, and all
         sections ship collapsed. State lives with the other hooks, above every
         early return, so a status flip cannot reorder them. */
      const [folds, setFolds] = useState({})
      const toggleFold = (key) => {
        setFolds((previous) => Object.assign({}, previous, { [key]: !(previous[key] === true) }))
      }
      const fold = (titleKey, ...body) => {
        const open = folds[titleKey] === true
        return E('div', { className: 'git4idea-fold' },
          E('button', {
            type: 'button',
            className: 'git4idea-foldHead',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => toggleFold(titleKey),
          },
            E('span', { className: 'git4idea-foldChevron' + (open ? ' git4idea-foldChevronOpen' : ''), 'aria-hidden': 'true' }, '▸'),
            E('span', { className: 'git4idea-foldTitle' }, t(titleKey))),
          open ? E('div', { className: 'git4idea-stack' }, body) : null)
      }
      const flush = () => {
        pendingFlush.current = null
        /* The pending TARGET per field, not "whatever the render-time intent
           happens to hold now": the accepted document can already agree with the
           user's new value, which clears the optimistic intent before this flush
           runs — reading it here would then submit the opposite of the click and
           write the switch back to the wrong state. */
        const targets = new Map(dirty.current)
        dirty.current.clear()
        const fields = Array.from(targets.keys())
        if (fields.length === 0) return
        const ops = fields.map((field) => ({ op: 'set', path: [field], value: targets.get(field) === true }))
        const outcome = writeRailFields(ops, scope)
        if (outcome.sent !== true) {
          rollbackFields(fields)
          setNote(t(outcome.reason === 'read-only' ? 'settings.rail.readonly' : 'settings.rail.writeFailed'))
          return
        }
        if (outcome.settled === undefined) return
        void outcome.settled.then((accepted) => {
          if (accepted !== true) {
            rollbackFields(fields)
            setNote(t('settings.rail.writeFailed'))
            return
          }
          for (const field of fields) reconcile(field, targets.get(field) === true, 0)
        })
      }
      const scheduleFlush = () => {
        if (pendingFlush.current !== null) return
        pendingFlush.current = setTimeout(() => { pendingFlush.current = null; flush() }, FLUSH_MS)
        timers.current.add(pendingFlush.current)
      }
      /* Two handles, one document: the slot hands the card the framework's own
         form for this entry (`props.scope`), and our ctx.configForms handle is the
         fallback — both address the same namespace, so a write through either is
         the same row Config write. */
      const scope = props.scope !== undefined && props.scope !== null && typeof props.scope.getSnapshot === 'function'
        ? props.scope
        : railForm
      useEffect(() => {
        const offRail = subscribeRailConfig(bump)
        let offScope
        if (scope !== null && scope !== undefined && typeof scope.subscribe === 'function') {
          const unsubscribe = scope.subscribe(bump)
          if (typeof unsubscribe === 'function') offScope = unsubscribe
        }
        return () => {
          offRail()
          if (offScope !== undefined) offScope()
          for (const timer of Array.from(timers.current)) clearTimeout(timer)
          timers.current.clear()
        }
      }, [])
      void tick
      /* Card shell, shared by both seats — a visual twin of the pc-card /
         dl-card / gb-card pattern in dsh-ptc-cordis-preset, dsh-agent-lang and
         dsh-gitbash-shell: a collapsible li card on the Settings → Plugins
         seat, a flat page card on the plugin-page seat. Title + description
         come from the settings.card.* dictionary keys (every locale). */
      const pageView = props.view === 'page'
      const cardHead = E('span', { className: 'git4idea-card-head-text' },
        E('span', { className: 'git4idea-card-name' }, t('settings.card.title')),
        E('span', { className: 'git4idea-card-desc' }, t('settings.card.desc')))
      const wrapCard = (body) => {
        if (pageView) return E('div', { className: 'git4idea-card git4idea-card-page' },
          E('div', { className: 'git4idea-card-header git4idea-card-header-flat' }, cardHead), body)
        return E('li', { className: 'git4idea-card' + (openCard ? ' git4idea-card-open' : '') },
          E('button', {
            type: 'button',
            className: 'git4idea-card-header',
            'aria-expanded': openCard,
            onClick: () => setOpenCard(!openCard),
          }, cardHead,
            E('span', { className: 'git4idea-card-chevron' + (openCard ? ' git4idea-card-chevron-open' : '') },
              E(Icon, { name: 'chevron', size: 12 }))),
          openCard ? body : null)
      }
      let snapshot = null
      try { snapshot = scope === null || scope === undefined ? null : scope.getSnapshot() } catch (error) { void error }
      const status = snapshot === null || snapshot === undefined || typeof snapshot.status !== 'string' ? 'absent' : snapshot.status
      const values = snapshot !== null && snapshot !== undefined && snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : null
      // Drop optimistic values the host has since confirmed (post-commit effect).
      useEffect(() => {
        setPending((current) => {
          const keys = Object.keys(current)
          if (keys.length === 0 || values === null) return current
          const next = {}
          let changed = false
          for (const key of keys) {
            if (values[key] === current[key]) {
              changed = true
              /* The accepted document agrees: this intent is no longer pending.
                 Deleting twice is harmless, so a re-invoked updater stays safe. */
              delete intent.current[key]
              continue
            }
            next[key] = current[key]
          }
          return changed ? next : current
        })
      })
      /* The picker catalog loads once per mount (cached module-wide); a rejected
         lookup answers null and the rows simply stay text fields. */
      useEffect(() => {
        let alive = true
        fetchCommitCatalog().then(
          (providers) => { if (alive === true) setPickers((now) => Object.assign({}, now, { catalog: providers })) },
          () => { if (alive === true) setPickers((now) => Object.assign({}, now, { catalog: null })) },
        )
        return () => { alive = false }
      }, [])
      /* The efforts list follows whichever model the settings name — the draft
         counts too, so the picker reacts to a fresh selection before the host
         has echoed the write. Following the session has no fixed model, so
         there is nothing to list (and nothing to ask). */
      const pickerModel = Object.prototype.hasOwnProperty.call(textDraft, 'commitModel') && typeof textDraft.commitModel === 'string'
        ? textDraft.commitModel
        : (values === null ? '' : (values.commitModel === undefined || values.commitModel === null ? '' : String(values.commitModel)))
      useEffect(() => {
        let alive = true
        if (pickerModel === '') {
          setPickers((now) => (now.efforts === null ? now : Object.assign({}, now, { efforts: null })))
          return () => { alive = false }
        }
        fetchCommitEfforts(pickerModel).then(
          (value) => {
            if (alive !== true) return
            const rows = value !== null && typeof value === 'object' && Array.isArray(value.efforts) ? value.efforts : []
            setPickers((now) => Object.assign({}, now, { efforts: rows }))
          },
          () => { if (alive === true) setPickers((now) => Object.assign({}, now, { efforts: null })) },
        )
        return () => { alive = false }
      }, [pickerModel])
      // Switches exist only where they can actually write: a host that does not
      // serve this entry's settings gets a sentence instead of dead controls.
      if (status !== 'ready' || values === null) {
        return wrapCard(E('div', { className: 'git4idea-settings git4idea-card-body', 'data-settings-status': status },
          E('div', { className: 'git4idea-settings-note' }, t('settings.rail.unavailable'))))
      }
      const config = railConfigOfValues(values)
      /* A toggle is a host round trip, so the switch would snap back to the old
         value for a moment and read as "stuck". The optimistic value wins until
         the accepted document agrees with it (then it is dropped). */
      const shown = (spec) => {
        const field = railFieldOf(spec.id)
        if (Object.prototype.hasOwnProperty.call(intent.current, field)) return intent.current[field]
        return config.hidden.indexOf(spec.id) < 0
      }
      /* A host that serves the document but refuses writes gets disabled switches
         and a sentence, not controls that silently do nothing. */
      const readOnly = snapshot.writable !== true
      /* The three placement switches (conversation tab / immersive / composer
         pill) share one target rule: the control's own answer wins; otherwise
         the target is the INVERSE of what is on screen — the synchronous intent
         when the user already touched the field, the accepted document
         otherwise. The parentheses are load-bearing: `cond ? a : b !== false`
         parses as `cond ? a : (b !== false)`, so the old spelling of the
         fallback (`: values[field] !== false) !== true`) made a label click a
         silent no-op — it recomputed the CURRENT value and wrote it back
         unchanged (v0.19.6 user report, fixed in v0.19.7). Keep the inversion
         on the whole expression, never on its last operand. */
      const placementShown = (field) => (Object.prototype.hasOwnProperty.call(intent.current, field)
        ? intent.current[field] === true
        : values[field] !== false)
      const placementTarget = (field, fromControl) => {
        if (fromControl !== null) return fromControl
        const current = placementShown(field)
        return current !== true
      }
      return wrapCard(E('div', { className: 'git4idea-settings git4idea-card-body', 'data-settings-status': status, 'data-settings-readonly': readOnly === true ? 'true' : 'false' },
        E('div', { className: readOnly === true ? 'git4idea-settings-note' : 'git4idea-settings-note git4idea-settings-note-hidden', 'data-settings-readonly-note': '' }, t('settings.rail.readonly')),
        note === '' ? null : E('div', { className: 'git4idea-settings-error', 'data-settings-error': '' }, note),
        /* Three collapsible sections, one per functional domain — the header
           rows are what a collapsed card shows. The readonly/error notes stay
           OUTSIDE them: they are status, not settings, and must stay visible.
           Section 1 carries its own hint (it describes exactly this list). */
        fold('settings.rail.title',
        E('div', { className: 'git4idea-settings-hint' }, t('settings.rail.hint')),
        E('div', { className: 'git4idea-settings-list' }, RAIL_SPECS.map((spec) => {
          const inputId = 'git4idea-rail-' + spec.id
          const visible = shown(spec)
          /* A row, not a <label>: a label that both carries htmlFor and wraps its
             own input toggles twice per click (once for the input, once for the
             label activation), which reads as a stuck switch and writes twice. */
          const toggle = (event) => {
            if (readOnly === true) { setNote(t('settings.rail.readonly')); return }
            const field = railFieldOf(spec.id)
            /* The control's own answer when the browser gives it to us: a click that
               lands while the previous one is still rendering would otherwise
               compose from the pre-click snapshot and be lost (measured: a fast
               double click netted one step instead of returning to its start). The
               row's label span is not a control, so it falls back to the
               synchronous intent — never to the render snapshot alone. */
            const fromControl = event !== undefined && event !== null && event.target !== null
              && event.target !== undefined && typeof event.target.checked === 'boolean'
              ? event.target.checked
              : null
            /* The control already holds the state the user just asked for, so it is
               the TARGET — inverting it here would write the opposite of the click.
               Without a control (the row's label span) the target is the inverse of
               the current intent, falling back to the accepted document. */
            const wanted = fromControl !== null
              ? fromControl
              : (Object.prototype.hasOwnProperty.call(intent.current, field)
                ? intent.current[field] !== true
                : config.hidden.indexOf(spec.id) < 0 !== true)
            intent.current[field] = wanted
            dirty.current.set(field, wanted)
            setPending((now) => Object.assign({}, now, { [field]: wanted }))
            setNote('')
            bump()
            scheduleFlush()
          }
          return E('div', { key: spec.id, className: 'git4idea-settings-row', 'data-rail-action': spec.id },
            E('input', {
              id: inputId,
              type: 'checkbox',
              className: 'git4idea-settings-check',
              'aria-labelledby': inputId + '-label',
              checked: visible,
              disabled: readOnly === true,
              onChange: toggle,
            }),
            E('span', { className: 'git4idea-settings-glyph' }, E(Icon, { name: spec.icon, size: 13 })),
            E('span', { id: inputId + '-label', className: 'git4idea-settings-label', onClick: toggle }, t(spec.key)))
        }))),
        /* Section 2 — placement (issue #8): one switch, the same optimistic-write
           contract the rail rows keep. The conversation tab registers/unregisters
           live (see door 3 in apply), so the flip is visible without a reload. */
        fold('settings.placement.title',
        (() => {
          const field = 'conversationTab'
          const inputId = 'git4idea-placement-' + field
          const shown = placementShown(field)
          const toggle = (event) => {
            if (readOnly === true) { setNote(t('settings.rail.readonly')); return }
            const fromControl = event !== undefined && event !== null && event.target !== null
              && event.target !== undefined && typeof event.target.checked === 'boolean'
              ? event.target.checked
              : null
            const wanted = placementTarget(field, fromControl)
            intent.current[field] = wanted
            dirty.current.set(field, wanted)
            setPending((now) => Object.assign({}, now, { [field]: wanted }))
            setNote('')
            bump()
            scheduleFlush()
          }
          return E('div', { key: field },
            E('div', { className: 'git4idea-settings-row', 'data-placement-row': field },
              E('input', {
                id: inputId,
                type: 'checkbox',
                className: 'git4idea-settings-check',
                'aria-labelledby': inputId + '-label',
                checked: shown,
                disabled: readOnly === true,
                onChange: toggle,
              }),
              E('span', { className: 'git4idea-settings-glyph' }, E(Icon, { name: 'commit', size: 13 })),
              E('span', { id: inputId + '-label', className: 'git4idea-settings-label', onClick: toggle }, t('settings.placement.tab'))),
            E('div', { className: 'git4idea-settings-subnote' }, t('settings.placement.tabHint')))
        })(),
        (() => {
          /* Immersive mode (issue #8 round 3): the conversation seat's
             full-height overlay layout + hidden composer. Default ON — the
             full-height space is what the tab placement is for; flipping it
             re-renders the seat live (the ConversationPanel subscribes to the
             same config). */
          const field = 'immersive'
          const inputId = 'git4idea-placement-' + field
          const shown = placementShown(field)
          const toggle = (event) => {
            if (readOnly === true) { setNote(t('settings.rail.readonly')); return }
            const fromControl = event !== undefined && event !== null && event.target !== null
              && event.target !== undefined && typeof event.target.checked === 'boolean'
              ? event.target.checked
              : null
            const wanted = placementTarget(field, fromControl)
            intent.current[field] = wanted
            dirty.current.set(field, wanted)
            setPending((now) => Object.assign({}, now, { [field]: wanted }))
            setNote('')
            bump()
            scheduleFlush()
          }
          return E('div', { key: field },
            E('div', { className: 'git4idea-settings-row', 'data-placement-row': field },
              E('input', {
                id: inputId,
                type: 'checkbox',
                className: 'git4idea-settings-check',
                'aria-labelledby': inputId + '-label',
                checked: shown,
                disabled: readOnly === true,
                onChange: toggle,
              }),
              E('span', { className: 'git4idea-settings-glyph' }, E(Icon, { name: 'commit', size: 13 })),
              E('span', { id: inputId + '-label', className: 'git4idea-settings-label', onClick: toggle }, t('settings.placement.immersive'))),
            E('div', { className: 'git4idea-settings-subnote' }, t('settings.placement.immersiveHint')))
        })(),
        (() => {
          /* Composer dock pill (the current branch, left of the session
             statistics). Same optimistic-write contract as the two rows above;
             the pill reads composerStatus through composerStatusEnabled() and
             appears or disappears live. Default ON. */
          const field = 'composerStatus'
          const inputId = 'git4idea-placement-' + field
          const shown = placementShown(field)
          const toggle = (event) => {
            if (readOnly === true) { setNote(t('settings.rail.readonly')); return }
            const fromControl = event !== undefined && event !== null && event.target !== null
              && event.target !== undefined && typeof event.target.checked === 'boolean'
              ? event.target.checked
              : null
            const wanted = placementTarget(field, fromControl)
            intent.current[field] = wanted
            dirty.current.set(field, wanted)
            setPending((now) => Object.assign({}, now, { [field]: wanted }))
            setNote('')
            bump()
            scheduleFlush()
          }
          return E('div', { key: field },
            E('div', { className: 'git4idea-settings-row', 'data-placement-row': field },
              E('input', {
                id: inputId,
                type: 'checkbox',
                className: 'git4idea-settings-check',
                'aria-labelledby': inputId + '-label',
                checked: shown,
                disabled: readOnly === true,
                onChange: toggle,
              }),
              E('span', { className: 'git4idea-settings-glyph' }, E(Icon, { name: 'branch', size: 13 })),
              E('span', { id: inputId + '-label', className: 'git4idea-settings-label', onClick: toggle }, t('settings.composer.title'))),
            E('div', { className: 'git4idea-settings-subnote' }, t('settings.composer.hint')))
        })()),
        /* Section 3 — the AI commit message (issue #6): model, reasoning and the
           prompt template. */
        fold('settings.commit.title',
        (() => {
          /* The model row is a picker over the host's provider catalog; while
             the catalog has not answered (or cannot), the row stays the plain
             text field it always was. */
          const accepted = values.commitModel === undefined || values.commitModel === null ? '' : String(values.commitModel)
          const shown = Object.prototype.hasOwnProperty.call(textDraft, 'commitModel') && typeof textDraft.commitModel === 'string' ? textDraft.commitModel : accepted
          if (Array.isArray(pickers.catalog)) {
            const listed = pickers.catalog.some((provider) => Array.isArray(provider.models)
              && provider.models.some((model) => provider.id + '/' + model.id === shown))
            return selectRow('commitModel', 'settings.commit.model', shown, [
              E('option', { key: 'follow', value: '' }, t('settings.commit.modelFollow')),
              shown === '' || listed === true ? null : E('option', { key: 'kept', value: shown }, shown),
            ].concat(pickers.catalog.map((provider) => E('optgroup', {
              key: provider.id,
              label: provider.name === provider.id ? provider.id : provider.name + ' (' + provider.id + ')',
            }, (Array.isArray(provider.models) ? provider.models : []).map((model) => E('option', {
              key: model.id, value: provider.id + '/' + model.id,
            }, model.name === model.id ? model.id : model.name + ' — ' + model.id))))), false, null)
          }
          return textRow('commitModel', 'settings.commit.model', 'settings.commit.modelHint', 120, false)
        })(),
        (() => {
          /* The reasoning row follows the model row: following the session has
             no fixed model, so it is the fixed no-reasoning default (the host
             asks for "off" for us); a fixed model lists exactly the efforts
             that route accepts — hand-typing an effort id was issue #7's
             error-prone path. No list (yet/unavailable) keeps the text field. */
          if (pickerModel === '') {
            return selectRow('commitReasoning', 'settings.commit.reasoning', '', [
              E('option', { key: 'default', value: '' }, t('settings.commit.reasoningDefault')),
            ], true, t('settings.commit.reasoningFollowHint'))
          }
          if (pickers.efforts !== null && pickers.efforts.length > 0) {
            const accepted = values.commitReasoning === undefined || values.commitReasoning === null ? '' : String(values.commitReasoning)
            const shown = Object.prototype.hasOwnProperty.call(textDraft, 'commitReasoning') && typeof textDraft.commitReasoning === 'string' ? textDraft.commitReasoning : accepted
            const listed = pickers.efforts.some((row) => row.id === shown)
            return selectRow('commitReasoning', 'settings.commit.reasoning', shown, [
              E('option', { key: 'default', value: '' }, t('settings.commit.reasoningDefault')),
              shown === '' || listed === true ? null : E('option', { key: 'kept', value: shown }, shown),
            ].concat(pickers.efforts.map((row) => E('option', {
              key: row.id, value: row.id,
            }, row.name === row.id ? row.id : row.name + ' (' + row.id + ')'))), false, null)
          }
          return textRow('commitReasoning', 'settings.commit.reasoning', 'settings.commit.reasoningHint', 60, false)
        })(),
        textRow('commitPrompt', 'settings.commit.prompt', 'settings.commit.promptHint', 2000, true))))
    }

    function RailSettings(props) {
      const t = props.t
      const [dragId, setDragId] = useState(null)
      return E('div', {
        className: 'git4idea-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() },
      },
        E('div', { className: 'git4idea-dialog git4idea-dialog-wide' },
          E('div', { className: 'git4idea-dialog-title' }, t('rail.settings')),
          E('div', { className: 'git4idea-dialog-text' }, t('rail.settingsHint')),
          E('div', { className: 'git4idea-rail-list' },
            props.items.map((item, index) => E('div', {
              key: item.id,
              className: 'git4idea-rail-item'
                + (item.hidden === true ? ' git4idea-rail-item-off' : '')
                + (dragId === item.id ? ' git4idea-rail-item-drag' : ''),
              draggable: true,
              onDragStart: (event) => {
                setDragId(item.id)
                if (event.dataTransfer !== undefined && event.dataTransfer !== null) {
                  event.dataTransfer.effectAllowed = 'move'
                  try { event.dataTransfer.setData('text/plain', item.id) } catch (error) { void error }
                }
              },
              onDragEnd: () => setDragId(null),
              onDragOver: (event) => { event.preventDefault() },
              onDrop: (event) => { event.preventDefault(); props.onDrop(dragId, item.id); setDragId(null) },
            },
              E('span', { className: 'git4idea-rail-grip' }, E(Icon, { name: 'grip', size: 12 })),
              E('span', { className: 'git4idea-rail-item-icon git4idea-tone-' + item.tone }, E(Icon, { name: item.icon, size: 13 })),
              E('span', { className: 'git4idea-rail-item-label' }, item.label),
              E('button', {
                type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small', title: t('rail.up'),
                disabled: index === 0, onClick: () => props.onMove(item.id, -1),
              }, E(Icon, { name: 'up', size: 12 })),
              E('button', {
                type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small', title: t('rail.down'),
                disabled: index === props.items.length - 1, onClick: () => props.onMove(item.id, 1),
              }, E(Icon, { name: 'down', size: 12 })),
              E('button', {
                type: 'button',
                className: 'git4idea-icon-btn git4idea-icon-btn-small' + (item.hidden === true ? '' : ' git4idea-icon-btn-active'),
                title: item.hidden === true ? t('rail.show') : t('rail.hide'),
                onClick: () => props.onToggle(item.id),
              }, E(Icon, { name: item.hidden === true ? 'eyeOff' : 'eye', size: 13 }))))),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', { type: 'button', className: 'git4idea-btn', onClick: props.onReset }, t('rail.reset')),
            E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-primary', onClick: props.onClose }, t('confirm.ok')))))
    }

    /* One notification in the bottom-right stack (m02407 #3). It closes itself
       after ttl ms; a pointer on it holds that count and leaving restarts a fresh
       five seconds. A long result folds to two lines — hovering shows the whole
       text, a click pins it open, and an over-long one scrolls. */
    function ToastItem(props) {
      const item = props.item
      const ttl = item.ttl === undefined ? 5000 : item.ttl
      const [open, setOpen] = useState(false)
      const [hovered, setHovered] = useState(false)
      const left = useRef(ttl)
      const since = useRef(0)
      useEffect(() => {
        if (hovered === true || ttl <= 0) return undefined
        since.current = Date.now()
        const timer = setTimeout(() => item.onClose(), left.current)
        return () => {
          clearTimeout(timer)
          left.current = Math.max(1200, left.current - (Date.now() - since.current))
        }
      }, [hovered, ttl, item])
      const leave = () => {
        left.current = ttl
        setHovered(false)
      }
      const toggle = () => setOpen((value) => value !== true)
      return E('div', {
        className: 'git4idea-toast' + (item.tone === undefined ? '' : ' git4idea-toast-' + item.tone)
          + (open === true ? ' git4idea-toast-open' : ''),
        onMouseEnter: () => setHovered(true),
        onMouseLeave: leave,
      },
        E('span', { className: 'git4idea-toast-icon' }, E(Icon, { name: item.icon === undefined ? 'check' : item.icon, size: 13 })),
        E('div', {
          className: 'git4idea-toast-text',
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open === true ? 'true' : 'false',
          onClick: toggle,
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            toggle()
          },
        }, item.text),
        item.actionLabel === undefined ? null : E('button', {
          type: 'button', className: 'git4idea-toast-action', onClick: () => item.onAction(),
        }, item.actionLabel),
        E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small',
          title: props.t('toast.close'), onClick: () => item.onClose(),
        }, E(Icon, { name: 'close', size: 11 })))
    }

    function ToastStack(props) {
      if (props.toasts.length === 0) return null
      return E('div', { className: 'git4idea-toasts', role: 'status', 'aria-live': 'polite' },
        props.toasts.map((item) => E(ToastItem, { key: item.id, item: item })))
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

    /* VS Code's "Git output" view (showOutput): the tail of the host's git-run
       ring buffer, fetched through the gitLogs method. A debugging view —
       opened on demand, refreshed by hand; newest land at the bottom and the
       body auto-scrolls to them. Panel-internal absolute positioning (13). */
    function GitOutputDrawer(props) {
      const t = props.t
      const ref = useRef(null)
      useEffect(() => { if (ref.current !== null) ref.current.scrollTop = ref.current.scrollHeight }, [props.entries])
      return E('div', { className: 'git4idea-gitlog' },
        E('div', { className: 'git4idea-gitlog-head' },
          E('span', { className: 'git4idea-gitlog-title' }, t('gitLog.title')),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', { type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small', title: t('toolbar.refresh'), onClick: props.onRefresh }, E(Icon, { name: 'refresh', size: 13 })),
          E('button', { type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small', title: t('confirm.cancel'), onClick: props.onClose }, E(Icon, { name: 'collapse', size: 13 }))),
        props.entries.length === 0
          ? E('div', { className: 'git4idea-gitlog-empty' }, t('gitLog.empty'))
          : E('div', { className: 'git4idea-gitlog-body', ref: ref },
            props.entries.map((entry, index) => E('div', {
              key: index,
              className: 'git4idea-gitlog-row' + (String(entry.code) === '0' ? '' : ' git4idea-gitlog-row-bad'),
            },
              E('div', { className: 'git4idea-gitlog-meta' },
                E('span', { className: 'git4idea-gitlog-code' }, String(entry.code)),
                E('span', { className: 'git4idea-gitlog-ms' }, String(entry.ms) + 'ms'),
                E('span', { className: 'git4idea-gitlog-at' }, String(entry.at)),
                E('span', { className: 'git4idea-gitlog-argv' }, String(entry.argv))),
              entry.out === '' && entry.err === '' ? null
                : E('pre', { className: 'git4idea-gitlog-pre' }, String(entry.err) === '' ? String(entry.out) : String(entry.out) + '\n' + String(entry.err))))))
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
        title: label,
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
        return E('span', { className: 'git4idea-repo-static', title: only === null ? '' : only.path },
          E(Icon, { name: 'folder', size: 12 }),
          E('span', { className: 'git4idea-repo-name' }, only === null ? t('repo.empty') : only.name))
      }
      /* The switcher is a button over a panel-internal menu, not a native
         <select>: the OS-drawn popup ignores the panel theme entirely (light
         system colours over a dark translucent panel) and was unreadable. */
      let current = null
      for (const repo of props.repos) { if (repo.path === props.value) { current = repo; break } }
      return E('span', { className: 'git4idea-select-wrap', title: current === null ? t('repo.switch') : current.path },
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
        title: props.hint === undefined ? label : props.hint,
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
        title: where + ' · ' + t('branches.pickHint'),
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
          title: t('branches.worktree') + ': ' + entry.worktree,
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
          }),
          /* The IDE log folds the branch pane from its own header chevron
             (the stripe's first button); the same gesture lives here so the
             pane can be collapsed without reaching for the rail. */
          typeof props.onCollapse === 'function' ? E('button', {
            type: 'button',
            className: 'git4idea-icon-btn',
            'data-action': 'tree-collapse',
            title: t('toolbar.tree'),
            'aria-label': t('toolbar.tree'),
            onClick: () => props.onCollapse(),
          }, E(Icon, { name: 'chevronLeft', size: 14 })) : null),
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
            title: headEntry.name + ' · ' + t('branches.headHint'),
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
        title: item.origPath === undefined ? item.path : item.origPath + ' → ' + item.path,
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
          ? E('button', { type: 'button', className: 'git4idea-mini', title: t('action.unstage'), onClick: (event) => { event.stopPropagation(); props.onUnstage(item) } }, E(Icon, { name: 'minus', size: 12 }))
          : E('button', { type: 'button', className: 'git4idea-mini', title: t('action.stage'), onClick: (event) => { event.stopPropagation(); props.onStage(item) } }, E(Icon, { name: 'plus', size: 12 }))),
        readOnly ? null : E('button', { type: 'button', className: 'git4idea-mini', title: t('action.discard'), onClick: (event) => { event.stopPropagation(); props.onDiscard(item, props.group) } }, E(Icon, { name: 'undo', size: 12 })))
    }, (prev, next) => prev.item === next.item && prev.group === next.group && prev.t === next.t && prev.selected === next.selected && prev.depth === next.depth && prev.checked === next.checked)

    function ChangesPanel(props) {
      const t = props.t
      const summary = props.summary
      /* The panel-side model picker (issue #19) rides the official model
         directories, soft-injected into a module ref at apply time — see
         ModelRoutePicker for why a bare ctx property read cannot work. */
      const [message, setMessage] = useState('')
      const [amend, setAmend] = useState(false)
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
      }, [setSelection, anchorRef, props.onDiff])
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
          const settings = props.commitSettings === undefined ? { model: '', reasoning: '', prompt: '' } : props.commitSettings
          /* `base` carries the picked repository ({ cwd, repoRoot }) exactly like
             every other request: without it the host resolves the repository from
             the session cwd, which need not be one (several sibling repos). */
          const data = await props.request('commit-message', Object.assign(
            {},
            props.base === undefined ? { cwd: props.cwd } : props.base,
            {
              sessionId: props.sessionId,
              model: settings.model,
              reasoningEffort: settings.reasoning,
              prompt: settings.prompt,
            },
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
        title: t('changes.aiOverwriteTitle'),
        text: t('changes.aiOverwriteText'),
        okLabel: t('confirm.ok'),
        cancelLabel: t('confirm.cancel'),
        onConfirm: () => { void aiRun() },
        onCancel: () => setAiAsk(false),
      })
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
              title: t('changes.aiQuota'),
              onClick: () => { if (message.trim() === '') void aiRun(); else setAiAsk(true) },
            }, aiBusy === true ? t('changes.aiBusy') : t('changes.aiWrite')),
            E(ModelRoutePicker, { sessionId: props.sessionId, t: t }),
            E('button', {
              type: 'button', className: 'git4idea-btn git4idea-btn-primary git4idea-btn-small',
              disabled: message.trim() === '' || props.busy === true || pickedNow === 0,
              onClick: () => { submit(false) },
            }, t('changes.commit')),
            E('span', { className: 'git4idea-commit-ai-hint git4idea-commit-ai-hint-block' }, t('changes.aiQuota')))
        : E('div', { className: 'git4idea-commit-box' },
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
              E(ModelRoutePicker, { sessionId: props.sessionId, t: t }),
              E('span', { className: 'git4idea-commit-ai-hint' }, t('changes.aiQuota')),
              aiUndo === null ? null : E('button', {
                type: 'button', className: 'git4idea-link',
                onClick: () => { setMessage(aiUndo); setAiUndo(null); setAiNote(null) },
              }, t('changes.aiUndo'))),
            aiNote === null ? null : E('div', { className: 'git4idea-commit-ai-note', 'data-ai-note': '' }, aiNote),
            E('div', { className: 'git4idea-commit-actions' },
              E('label', { className: 'git4idea-check' },
                E('input', { type: 'checkbox', checked: amend, onChange: (event) => setAmend(event.target.checked) }),
                E('span', null, t('changes.amend'))),
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
          title: t('toolbar.more'),
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

    /* Display form of a decoration: a HEAD decoration names the branch it points
       at, so the badge says "HEAD → main" — where HEAD sits must be readable at
       a glance (GitLens-style), not only inferable from the hollow dot. */
    function refLabel(decoration) {
      if (decoration.kind !== 'head') return decoration.name
      return decoration.name === 'HEAD' ? 'HEAD' : 'HEAD → ' + decoration.name
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
       rows, and the +N overflow badge opens the hidden refs in a menu instead
       of hiding them behind a bare count. */
    const REF_ICONS = { head: 'star', local: 'branch', remote: 'fetch', tag: 'tag' }
    const REF_TONES = { head: 'success', local: 'accent', remote: 'violet', tag: 'warn' }
    const CommitRow = memo(function CommitRow(props) {
      const commit = props.commit
      const decorations = (Array.isArray(commit.refs) ? commit.refs : []).map(refInfo)
      /* Remote folding (GitLens-style dedupe): a remote whose short name
         (origin/main → main) matches a LOCAL or HEAD badge on the same commit
         stops taking a badge of its own — the local badge's title gains a
         "⇅ origin/main" line and the overflow menu still lists it. Nothing is
         lost, the row just stops saying "main" and "origin/main" twice. */
      const localNames = new Set(decorations.filter((d) => d.kind === 'local' || d.kind === 'head').map((d) => d.name))
      const foldedBy = new Map()
      const kept = []
      for (const decoration of decorations) {
        if (decoration.kind === 'remote') {
          const slash = decoration.name.indexOf('/')
          const short = slash >= 0 ? decoration.name.slice(slash + 1) : decoration.name
          if (localNames.has(short) === true) {
            if (foldedBy.has(short) === false) foldedBy.set(short, [])
            foldedBy.get(short).push(decoration.name)
            continue
          }
        }
        kept.push(decoration)
      }
      const folded = []
      for (const list of foldedBy.values()) folded.push(...list)
      const shown = kept.slice(0, 3)
      const hidden = kept.length - shown.length
      const badgeTitle = (decoration) => {
        const label = refLabel(decoration)
        if (decoration.kind !== 'local' && decoration.kind !== 'head') return label
        const folds = foldedBy.get(decoration.name)
        return folds === undefined ? label : label + '\n⇅ ' + folds.join(', ')
      }
      return E('div', {
        /* data-lane feeds the hover highlight: the scroll container copies the
           hovered row's lane into data-hover-lane, and generated CSS dims every
           graph stroke whose data-lane differs — zero React re-renders. */
        'data-lane': String(props.row.lane),
        className: 'git4idea-commit' + (props.selected === true ? ' git4idea-commit-selected' : ''),
        /* Modifier handling lives in HistoryList (it owns the rendered row
           order the Shift-range walks); a plain click only selects and the
           DOUBLE-click opens the detail (v0.18.3, same model as the tree). */
        onClick: (event) => props.onRowClick(event, commit),
        onDoubleClick: () => props.onOpenDetail(commit),
        onContextMenu: (event) => { event.preventDefault(); props.onMenu(event, commit) },
      },
        /* Column order (m01737 #4, mirroring the IDE log): graph, message,
           ref chips, author, then the absolute timestamp. The relative "4d"
           column is gone — it made every row read differently by the hour. */
        E(GraphCell, { row: props.row, height: 26 }),
        E('span', { className: 'git4idea-commit-subject', title: commit.subject }, commit.subject),
        shown.map((decoration, index) => E('span', {
          key: decoration.kind + ':' + decoration.name + ':' + index,
          className: 'git4idea-ref git4idea-ref-' + decoration.kind,
          title: badgeTitle(decoration),
        }, refLabel(decoration))),
        hidden > 0 || folded.length > 0 ? E('span', {
          className: 'git4idea-ref git4idea-ref-more',
          title: kept.slice(3).map(refLabel).concat(folded.map((name) => '⇅ ' + name)).join('\n'),
          onClick: (event) => {
            event.stopPropagation()
            if (props.openMenuAt === undefined) return
            const entries = kept.slice(3).map((decoration, at) => ({
              id: 'ref:' + at,
              icon: REF_ICONS[decoration.kind] === undefined ? 'branch' : REF_ICONS[decoration.kind],
              tone: REF_TONES[decoration.kind] === undefined ? 'secondary' : REF_TONES[decoration.kind],
              label: refLabel(decoration),
              run: () => { copyText(refLabel(decoration)) },
            })).concat(folded.map((name, at) => ({
              id: 'fold:' + at,
              icon: 'fetch', tone: 'violet',
              label: '⇅ ' + name,
              run: () => { copyText(name) },
            })))
            props.openMenuAt(event, entries)
          },
        }, '+' + String(hidden + folded.length)) : null,
        E('span', { className: 'git4idea-commit-fill' }),
        E('span', { className: 'git4idea-commit-author', title: commit.author }, commit.author),
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
         the same list the eye sees. A plain click only SELECTS (single-replace,
         like the branch tree); it must NOT open the detail view — that killed
         any multi-select mid-flight and is now the DOUBLE-click's job (user
         request, v0.18.3). The stale-callback risk is nil: rows change identity
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
        /* Plain click only SELECTS (single-replace, the changes list's
           model): the detail view moved to DOUBLE-click. v0.18.3 updated the
           comment but left props.onSelect(commit) on this path, so single
           clicks kept yanking the pane away (user report) — the call is gone
           for real now; row highlight comes from the picked set, Enter is the
           keyboard twin of the double-click. */
        setPicks((previous) => previous.size === 1 && previous.has(commit.hash) === true ? previous : new Set([commit.hash]))
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
        const openFilterMenu = (event, options, currentValue, onPick) => {
          if (props.openMenuAt === undefined) return
          props.openMenuAt(event, options.map((option) => ({
            id: 'filter:' + String(option.value),
            icon: option.value === '' ? 'filter' : 'check',
            tone: option.value === '' ? 'secondary' : 'accent',
            label: option.label,
            active: option.value === currentValue,
            run: () => onPick(option.value),
          })))
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
          onOpenMenu: (event, options) => openFilterMenu(event, options, refName, setRefName),
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
          title: order === 'desc' ? t('filter.sortDesc') : t('filter.sortAsc'),
          onClick: () => setOrder(order === 'desc' ? 'asc' : 'desc'),
        }, E(Icon, { name: order === 'desc' ? 'down' : 'up', size: 12 })),
        dirtyFilter ? E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small', title: t('filter.clear'),
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
            onRowClick: handleRowClick, onOpenDetail: props.onSelect, onMenu: props.onMenu, openMenuAt: props.openMenuAt,
          })),
          winEnd < rows.length ? E('div', { key: 'pad-bottom', style: { height: String((rows.length - winEnd) * HISTORY_ROW_H) + 'px' } }) : null,
          order === 'desc' ? loadMoreButton : null),
        E(MarqueeBox, { box: historyMarquee.box }))
    }

    function CommitDetail(props) {
      const t = props.t
      const detail = props.detail
      /* The right column (m01216): changed files on top (2/3 of the height), the
         commit message below (1/3). The parent folder rides in its own column so
         two files called index.js are told apart without a tooltip. */
      const fileRows = detail === null || detail === undefined
        ? null
        : detail.files.length === 0
          ? E('div', { className: 'git4idea-empty' }, t('detail.noFiles'))
          : detail.files.map((file) => E('div', {
              key: file.path,
              className: 'git4idea-row git4idea-row-file' + (props.selectedPath === file.path ? ' git4idea-row-selected' : ''),
              title: file.path,
              /* Same click model as everywhere else (v0.18.3): plain click only
                 selects, DOUBLE-click opens the diff. */
              onClick: () => props.onSelectFile(file),
              onDoubleClick: () => props.onOpenFile(file),
              onContextMenu: props.onFileMenu === undefined ? undefined : (event) => { event.preventDefault(); props.onFileMenu(event, file) },
            },
              FileTypeGlyph({ path: file.path }),
              E('span', { className: 'git4idea-row-label' }, baseName(file.path)),
              E('span', { className: 'git4idea-row-sub git4idea-row-dir' }, dirName(file.path)),
              file.additions > 0 ? E('span', { className: 'git4idea-stat-add' }, '+' + file.additions) : null,
              file.deletions > 0 ? E('span', { className: 'git4idea-stat-del' }, '-' + file.deletions) : null))
      if (detail === null || detail === undefined) return E('div', { className: 'git4idea-empty git4idea-detail-empty' }, t('detail.pick'))
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
            detail.body === undefined || detail.body.trim() === '' ? null : E('pre', { className: 'git4idea-detail-body' }, detail.body.trim())))
      }
      return E('div', { className: 'git4idea-detail' },
        E('div', { className: 'git4idea-detail-head' },
          E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-small', onClick: props.onBack }, '← ' + t('detail.back')),
          E('span', { className: 'git4idea-mono' }, detail.shortHash),
          E('span', { className: 'git4idea-detail-author' }, detail.author),
          E('span', { className: 'git4idea-detail-date' }, shortDate(detail.date))),
        E('div', { className: 'git4idea-detail-subject' }, detail.subject),
        detail.body === undefined || detail.body.trim() === '' ? null : E('pre', { className: 'git4idea-detail-body' }, detail.body.trim()),
        E('div', { className: 'git4idea-detail-files-head' }, t('detail.files') + ' · ' + String(detail.files.length)),
        E('div', { className: 'git4idea-detail-files' }, fileRows))
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
      const [railConfig, setRailConfig] = useState(readRailConfig)
      const [railTick, setRailTick] = useState(0)
      const [railSettings, setRailSettings] = useState(false)
      const [railBox, setRailBox] = useState({ width: 0, height: 0 })
      const [toasts, setToasts] = useState([])

      /* ---------- toast plumbing ---------- */
      /* Declared early on purpose: the guard, the loaders and every menu builder
         close over pushToast, and a hooks dependency array is evaluated during
         render (invariant 12) — the plumbing has to exist before them, and the
         sink effect has to run before the first load reports a failure. */
      const toastSeq = useRef(0)

      const dropToast = useCallback((id) => {
        setToasts((list) => list.filter((item) => item.id !== id))
      }, [])

      /* m02407 #3: five seconds by default — the countdown itself lives in
         ToastItem, because pausing it on hover is per-notification state. An undo
         chip keeps its longer life: it is the only way back from a delete. */
      const pushToast = useCallback((toast) => {
        toastSeq.current += 1
        const id = 'toast-' + String(toastSeq.current)
        const ttl = toast.ttl === undefined ? (toast.actionLabel === undefined ? 5000 : 30000) : toast.ttl
        setToasts((list) => list.concat([Object.assign({ id: id, ttl: ttl, onClose: () => dropToast(id) }, toast)]))
        return id
      }, [dropToast])

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
      /* Where the gear goes: the plugin's own settings page when this host has
         both the row Config and the navigation to it, the in-panel editor
         otherwise (see RAIL_NS / railForm). */
      const railSettingsTarget = () => (railForm === null || props.openSettings === null || props.openSettings === undefined ? 'panel' : 'page')
      const openSettingsPage = () => {
        if (props.openSettings === null || props.openSettings === undefined) return
        props.openSettings()
      }

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
      /* The Git-output drawer (VS Code showOutput): null = closed, an array =
         the entries it currently shows. Opened on demand, refreshed by hand or
         by reopening — it is a debugging view, not a live stream. */
      const [gitOutput, setGitOutput] = useState(null)
      const openGitOutput = useCallback(async () => {
        try {
          const data = await request('gitLogs', {})
          setGitOutput(Array.isArray(data.entries) ? data.entries : [])
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }, [request])


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
              try { await request('fetch', Object.assign({}, base, { prune: true })) } catch (error) { void error }
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

      const run = useCallback(async (method, payload) => {
        const result = await guard(() => request(method, Object.assign({}, base, payload)))
        if (result !== undefined) await refresh()
        return result
      }, [base, guard, refresh])

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

      /* ---------- external diff preview (user request, 2026-10-08) ---------- */
      /* 「点击文件预览」不再内嵌:预览交给右侧栏的原生预览 tab —— 本插件自己
         的第二个 sidebarRight 类型。seed 先写进 previewStore,再 openTab;tab 在
         分栏里是单例,再点一次原地重写 seed 而不是堆 tab。seed 带 cwd(路由必需)
         + repoRoot(跳过 rev-parse),多仓库工作区不会落错仓库。右侧栏服务不在
         (老宿主)→ 返回 false,调用方落回内嵌 diff 窗。 */
      const previewDiff = useCallback((seed) => {
        if (repoRoot === null) return false
        const commitHash = seed.hash !== undefined && seed.hash !== null ? String(seed.hash) : null
        let sidebarRight = undefined
        try { sidebarRight = props.ctx === undefined || props.ctx === null ? undefined : props.ctx.get('sidebarRight') } catch (error) { void error }
        if (sidebarRight === undefined || sidebarRight === null || typeof sidebarRight.openTab !== 'function') return false
        try {
          const scopeObject = scope || {}
          previewStore.set(commitHash !== null
            ? { hash: commitHash, subject: seed.subject || '', path: seed.path !== undefined && seed.path !== null ? seed.path : '', cwd: scopeObject.cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId }
            : { path: seed.path, staged: seed.staged === true, untracked: seed.untracked === true ? true : undefined, cwd: scopeObject.cwd, repoRoot: repoRoot, sessionId: scopeObject.sessionId })
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
        void openDiff({ path: seed.path, staged: seed.staged === true })
      }, [previewDiff, openDiff])

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
        const data = await run('branchDelete', { names: names, confirm: true })
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
          openMenuAt(event, [
            { id: 'copyNames', icon: 'tag', tone: 'secondary', label: fill(t('menu.copyNamesN'), { n: picked.length }), run: () => copyValues(picked.map((item) => item.name)) },
            null,
            locals.length > 0 ? { id: 'deleteLocal', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteLocalN'), { n: locals.length }), run: () => setDialog({ kind: 'deleteRefs', locals: locals.map((item) => item.name), remotes: [], tags: [] }) } : null,
            remotes.length > 0 ? { id: 'deleteRemote', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteRemoteN'), { n: remotes.length }), run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: remotes.map((item) => { const slash = item.name.indexOf('/'); return { remote: slash >= 0 ? item.name.slice(0, slash) : item.name, branch: slash >= 0 ? item.name.slice(slash + 1) : item.name } }), tags: [] }) } : null,
            tags.length > 0 ? { id: 'deleteTags', icon: 'trash', tone: 'danger', danger: true, label: fill(t('menu.deleteTagsN'), { n: tags.length }), run: () => setDialog({ kind: 'deleteRefs', locals: [], remotes: [], tags: tags.map((item) => item.name) }) } : null,
          ].filter((item) => item !== null))
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
          isLocal ? { id: 'setUpstream', icon: 'fetch', tone: 'cyan', label: t('action.setUpstream'), disabled: branches === null || branches.remote.length === 0, reason: reason, run: (event) => openMenuAt(event, branches.remote.map((remoteEntry) => ({
            id: 'upstream:' + remoteEntry.name,
            icon: 'fetch', tone: 'cyan',
            label: remoteEntry.name,
            active: entry.upstream === remoteEntry.name,
            run: () => { void run('branch-upstream', { branch: entry.name, upstream: remoteEntry.name }) },
          }))) } : null,
          isLocal && entry.upstream !== null && entry.upstream !== undefined ? { id: 'unsetUpstream', icon: 'undo', tone: 'secondary', label: t('action.unsetUpstream'), run: () => { void run('branch-upstream', { branch: entry.name, unset: true }) } } : null,
          /* Remote rows get the tracking form: the local branch is created
             FROM the remote ref with --track in one step (issue #18 item 5),
             replacing the plain "new branch from" which could not bind. */
          entry.remote === true
            ? { id: 'createTracking', icon: 'branchCreate', tone: 'success', label: t('action.createLocalBranch'), run: () => setDialog({ kind: 'createTracking', from: entry.name, name: entry.name.slice(entry.name.indexOf('/') + 1) }) }
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
          { id: 'push', icon: 'push', tone: 'success', label: t('action.push'), disabled: blocked, reason: t('operation.hint'), run: () => setDialog({ kind: 'push' }) },
        ].filter((item) => item !== null)
        openMenuAt(event, items)
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
        const data = await run('branchDelete', { name: name, confirm: true })
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
        const data = await run('stashDrop', { ref: ref, confirm: true })
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
        const data = await run('discard', { paths: [item.path], untracked: group === 'untracked', confirm: true })
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

      /* The commit layer (m01216): the changes column is gone, so pending
         changes, the message and the buttons live in one overlay over the log. */
      const [commitOpen, setCommitOpen] = useState(false)

      const topBar = E('div', { className: 'git4idea-topbar' },
        E(RepoSelect, {
          t: t, repos: repoOptions, value: repoRoot,
          loading: repoState === null,
          onOpenMenu: openRepoMenu,
        }),
        branches === null || branches.local.length === 0 ? null : E('span', { className: 'git4idea-select-wrap', title: branches.branch },
          E(Icon, { name: 'branch', size: 12 }),
          E('button', {
            type: 'button',
            className: 'git4idea-select git4idea-select-btn git4idea-select-branch',
            onClick: openBranchSwitchMenu,
          },
            E('span', { className: 'git4idea-repo-name' }, branches.branch),
            E(Icon, { name: 'chevron', size: 12 }))),
        /* Push and pull sit right of the branch name (m01216): the rail is left
           for branch-tree actions only, and the undo menu is gone. */
        E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small',
          title: t('toolbar.push'),
          'aria-disabled': remoteReady !== true || blocked === true ? 'true' : 'false',
          onClick: () => {
            if (remoteReady !== true || blocked === true) return
            setDialog({ kind: 'push' })
          },
        }, E(Icon, { name: 'push', size: 14 })),
        E('button', {
          type: 'button', className: 'git4idea-icon-btn git4idea-icon-btn-small',
          title: t('toolbar.pull'),
          'aria-disabled': remoteReady !== true || summary === null || summary.upstream === null || blocked === true ? 'true' : 'false',
          onClick: () => {
            if (remoteReady !== true || summary === null || summary.upstream === null || blocked === true) return
            void run('pull', { mode: 'ff-only' })
          },
        }, E(Icon, { name: 'pull', size: 14 })),
        summary === null || summary.upstream === null ? null : E('span', { className: 'git4idea-track' },
          summary.ahead > 0 ? E('span', { className: 'git4idea-track-ahead' }, '↑' + summary.ahead) : null,
          summary.behind > 0 ? E('span', { className: 'git4idea-track-behind' }, (summary.ahead > 0 ? ' ' : '') + '↓' + summary.behind) : null),
        operation === null ? null : E('span', { className: 'git4idea-opchip', title: t('operation.hint') }, t('operation.' + operation)),
        E('span', { className: 'git4idea-topbar-spacer' }),
        busy ? E('span', { className: 'git4idea-busy' }, t('status.busy')) : null,
        /* The commit button opens the commit layer (m01216); the old always-on
           changes column is gone, so this is the only way in. */
        E('button', {
          type: 'button', className: 'git4idea-topbar-commit',
          title: t('changes.commit'),
          onClick: () => setCommitOpen(true),
        },
          E(Icon, { name: 'commit', size: 13 }),
          E('span', null, t('changes.commit')),
          dirty > 0 ? E('span', { className: 'git4idea-topbar-commit-count' }, String(dirty)) : null))

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

      const detailPane = E(CommitDetail, {
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
          { id: 'mm-push', icon: 'push', tone: 'success', label: t('toolbar.push'), disabled: remoteReady !== true || blocked, reason, run: () => setDialog({ kind: 'push' }) },
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
            { id: 'pp-push', label: t('toolbar.push'), disabled: remoteReady !== true || blocked, reason, run: () => setDialog({ kind: 'push' }) },
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
          { id: 'mm-git-output', icon: 'commit', tone: 'secondary', label: t('more.gitOutput'), run: () => { void openGitOutput() } },
        ])
      }
      const commitSettings = readCommitSettings()
      /* One panel spec, two hosts: the compact chrome renders it inline, the
         commit layer renders it as the left half of the overlay (m01216). The
         only difference between the two is where a file click sends its diff. */
      const renderChanges = (onDiff) => E(ChangesPanel, {
        t: t, summary: summary, busy: busy, compact: compact, hideHeader: compact,
        groupBy: groupBy, sortKey: sortKey, onGroupBy: setGroupBy,
        foldedDirs: foldedDirs, onFoldedDirs: setFoldedDirs,
        onMoreMenu: moreMenu,
        request: request, cwd: cwd, sessionId: sessionId, commitSettings: commitSettings, base: base,
        showIgnored: showIgnored,
        onToggleIgnored: () => setShowIgnored((value) => !value),
        // Commit-and-push carries the confirm flag with it: the button already
        // says exactly what it will publish, so the host guard is satisfied by
        // the click itself rather than by a second dialog.
        onCommit: (message, amend, push, paths) => {
          void (async () => {
            /* paths: the ticked set; the host stages exactly these before it
               commits, so an unticked file is never swept in by `git add -A`. */
            const result = await run('commit', { message: message, amend: amend, push: push === true, confirm: push === true, paths: paths })
            /* Only a landed commit closes the layer; a rejected one keeps the
               message on screen while the failure surfaces as a notification. */
            if (result !== undefined) setCommitOpen(false)
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

      /* The commit layer (m01216): pending changes over the message on the
         left, the picked file's diff on the right — the same panel the narrow
         chrome uses, so staging and the AI message keep working inside it. */
      const commitLayer = commitOpen === false ? null : E('div', { className: 'git4idea-commit-layer', 'data-git4idea-commit-layer': '' },
        E('div', { className: 'git4idea-commit-layer-card', 'data-git4idea-commit-card': '' },
        E('div', { className: 'git4idea-commit-layer-head' },
          E(Icon, { name: 'commit', size: 13 }),
          E('span', { className: 'git4idea-commit-layer-title' }, t('changes.title')),
          E('span', { className: 'git4idea-topbar-spacer' }),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn', title: t('confirm.cancel'),
            onClick: () => setCommitOpen(false),
          }, E(Icon, { name: 'close', size: 12 }))),
        E('div', { className: 'git4idea-commit-layer-body' },
          E('div', { className: 'git4idea-commit-layer-left' }, renderChanges((item, group) => {
            setDiffContext({ kind: 'worktree', staged: group === 'staged' })
            void openDiff({ path: item.path, staged: group === 'staged' })
          })),
          E('div', { className: 'git4idea-commit-layer-right' },
            patch === '' && patchLoading === false
              ? E('div', { className: 'git4idea-empty' }, t('pane.diff'))
              : E(DiffBody, { patch: patch, loading: patchLoading, t: t })))))

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

      /* The rail is drawn from the row Config when the host serves it: a change
         made in the settings card must show up here without a reload. */
      useEffect(() => subscribeRailConfig(() => {
        setRailConfig(readRailConfig())
        setRailTick((value) => value + 1)
      }), [])
      void railTick

      const applyRail = (next) => { setRailConfig(next); writeRailConfig(next) }
      const moveRailAction = (id, delta) => {
        const order = railConfig.order.slice()
        const at = order.indexOf(id)
        const to = at + delta
        if (at < 0 || to < 0 || to >= order.length) return
        order.splice(at, 1)
        order.splice(to, 0, id)
        applyRail({ order: order, hidden: railConfig.hidden })
      }
      const dropRailAction = (fromId, toId) => {
        if (fromId === null || fromId === toId) return
        const order = railConfig.order.slice()
        const at = order.indexOf(fromId)
        const to = order.indexOf(toId)
        if (at < 0 || to < 0) return
        order.splice(at, 1)
        order.splice(to, 0, fromId)
        applyRail({ order: order, hidden: railConfig.hidden })
      }
      const toggleRailAction = (id) => {
        const hidden = railConfig.hidden.indexOf(id) >= 0
          ? railConfig.hidden.filter((entry) => entry !== id)
          : railConfig.hidden.concat([id])
        applyRail({ order: railConfig.order, hidden: hidden })
      }
      const resetRailActions = () => applyRail({ order: RAIL_IDS.slice(), hidden: [] })

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
            title: action.disabled === true ? action.label + ' · ' + reason : action.label,
            onClick: (event) => { if (action.disabled === true) return; action.run(event) },
          }, E(Icon, { name: action.icon, size: 18 })),
        ].filter((node) => node !== null))
        if (overflow === true) {
          children.push(E('button', {
            key: 'more',
            type: 'button',
            className: 'git4idea-rail-btn git4idea-rail-more',
            title: t('rail.more'),
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
        children.push(E('span', { key: 'gap', className: vertical ? 'git4idea-rail-gap' : 'git4idea-rail-gap-x' }))
        children.push(E('button', {
          key: 'settings',
          type: 'button',
          className: 'git4idea-rail-btn git4idea-rail-settings',
          'data-action': 'settings',
          // On a host that serves the row Config this button opens the plugin's own
          // settings page (where the card below the description edits the rail);
          // on an older host it keeps the in-panel editor. Never both.
          title: railSettingsTarget() === 'page' ? t('rail.openSettings') : t('rail.settings'),
          onClick: () => {
            const target = railSettingsTarget()
            if (target === 'page') { openSettingsPage(); return }
            setRailSettings(true)
          },
        }, E(Icon, { name: 'settings', size: 18 })))
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
              title: t('toolbar.tree'),
              onClick: () => foldTree(!treeOpen),
            }, E(Icon, { name: treeOpen ? 'chevronLeft' : 'chevronRight' }))),
          treeOpen ? E('div', { className: 'git4idea-compact-tree', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree, onCollapse: () => foldTree(false) })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          view === 'changes' ? changesPane : view === 'detail'
            ? E('div', { className: 'git4idea-pane git4idea-pane-main git4idea-pane-detail' }, detailPane)
            : E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane))
      } else if (columns) {
        // The collapse chevron lives in the action rail, in the same column as the
        // other buttons (m01216 #3), so a folded tree needs no strip of its own.
        body = E('div', { className: 'git4idea-body git4idea-body-columns', ref: bodyRef },
          treeOpen ? E('div', { className: 'git4idea-pane git4idea-pane-tree', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree, onCollapse: () => foldTree(false) })) : null,
          treeOpen ? gutter('tree', 'prev') : null,
          E('div', { className: 'git4idea-pane git4idea-pane-main' }, historyPane, diffGutter, diffPane),
          gutter('changes', 'next'),
          /* Third column = the picked commit (m01216): changed files over the
             message. It keeps the 'changes' pane key so stored widths survive. */
          E('div', { className: 'git4idea-pane git4idea-pane-changes git4idea-pane-detail', 'data-pane': 'changes', style: paneStyle('changes') }, detailPane))
      } else {
        body = E('div', { className: 'git4idea-body git4idea-body-stack', ref: bodyRef },
          treeOpen ? E('div', { className: 'git4idea-pane git4idea-pane-tree-stack', 'data-pane': 'tree', style: paneStyle('tree') }, E(BranchTree, { t: t, branches: branches, favorites: favorites, onCheckout: checkout, onBrowse: browseBranch, onBranchMenu: branchMenu, onDeleteEntries: deleteBranchEntries, onCopyValues: copyValues, onPicksChange: onBranchPicks, clearSignal: pickEpochs.tree, onCollapse: () => foldTree(false) })) : null,
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
      if (railSettings === true) {
        overlays.push(E(RailSettings, {
          key: 'rail-settings',
          t: t,
          items: railOrdered.map((action) => ({
            id: action.id,
            icon: action.icon,
            tone: action.tone,
            label: action.label,
            hidden: railConfig.hidden.indexOf(action.id) >= 0,
          })),
          onMove: moveRailAction,
          onDrop: dropRailAction,
          onToggle: toggleRailAction,
          onReset: resetRailActions,
          onClose: () => setRailSettings(false),
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
      if (dialog !== null && dialog.kind === 'push') {
        const branch = summary === null ? '' : summary.branch
        const target = summary === null || summary.upstream === null ? 'origin' : summary.upstream
        overlays.push(E(ConfirmDialog, {
          key: 'push', t: t,
          title: t('confirm.title'), text: fill(t('push.confirm'), { branch: branch, upstream: target }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDialog(null),
          onConfirm: () => {
            setDialog(null)
            void run('push', { confirm: true, setUpstream: summary !== null && summary.upstream === null })
          },
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
      return E('div', {
        className: 'git4idea-root'
          + (compact ? ' git4idea-root-narrow' : '')
          + (paneDragging === null ? '' : ' git4idea-pane-dragging' + (paneByWidth ? '-v' : '-h')),
        ref: hostRef,
      }, topBar,
        columns === true || repoRoot === null ? null : renderRail(false),
        E('div', { className: 'git4idea-shell' },
          columns === true && repoRoot !== null ? renderRail(true) : null,
          body),
        commitLayer,
        gitOutput === null ? null : E(GitOutputDrawer, {
          t: t, entries: gitOutput,
          onRefresh: () => { void openGitOutput() },
          onClose: () => setGitOutput(null),
        }),
        overlays,
        E(ToastStack, { t: t, toasts: toasts }))
    }

    function copyText(text) {
      try {
        void navigator.clipboard.writeText(text)
      } catch (error) { void error }
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
      '.git4idea-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:13px;line-height:1.5;font-weight:600;overflow:hidden}',
      '.git4idea-topbar{display:flex;align-items:center;gap:6px;padding:4px 6px;flex:none;min-width:0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow:hidden}',
      '.git4idea-topbar-spacer{flex:1;min-width:4px}',
      '.git4idea-busy{color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap}',
      '.git4idea-track{color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.git4idea-select-wrap{display:inline-flex;align-items:center;gap:4px;min-width:0;flex:0 1 auto;max-width:90%;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-select{appearance:none;-webkit-appearance:none;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-primary);font:inherit;font-weight:500;padding:1px 6px;height:22px;max-width:min(280px,42%);min-width:0;cursor:pointer;text-overflow:ellipsis}',
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
      '.git4idea-banner{display:flex;align-items:center;gap:8px;padding:4px 8px;flex:none;color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-note{display:flex;align-items:center;gap:8px;padding:4px 8px;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-banner-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
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
      '.git4idea-rail-more,.git4idea-rail-settings{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-rail-more:hover,.git4idea-rail-settings:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-tone-primary{color:var(--dsw-alias-label-primary)}',
      '.git4idea-tone-secondary{color:var(--dsw-alias-label-secondary)}',
      '.git4idea-tone-accent{color:var(--dsw-alias-brand-primary)}',
      '.git4idea-tone-success{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-tone-warn{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-tone-danger{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-tone-violet{color:#b083f0}',
      '.git4idea-tone-cyan{color:#59b0d6}',
      '.git4idea-icon-btn-small{width:20px;height:20px;border-radius:var(--dsw-radius-xs,4px)}',
      /* The one way into the commit layer: a labelled button, so the action is
         readable at any panel width, with the dirty count as a badge. */
      '.git4idea-topbar-commit{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-weight:600;cursor:pointer}',
      '.git4idea-topbar-commit:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-topbar-commit-count{min-width:16px;height:16px;padding:0 4px;border-radius:999px;corner-shape:round;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);color:var(--dsw-alias-brand-primary);font-size:11px;font-weight:600;line-height:16px;text-align:center}',
      '.git4idea-root-narrow .git4idea-topbar-commit span:not(.git4idea-topbar-commit-count){display:none}',
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
      '.git4idea-card-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.git4idea-card-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-card-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
      '.git4idea-card-chevron.git4idea-card-chevron-open{transform:rotate(180deg)}',
      '.git4idea-card-body{padding:8px 16px 16px}',
      '.git4idea-card-page{max-width:640px}',
      '.git4idea-settings{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.git4idea-settings-head{display:flex;flex-direction:column;gap:2px}',
      '.git4idea-settings-title{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.git4idea-settings-hint{color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.git4idea-settings-note{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary));font-weight:400}',
      '.git4idea-settings-note-hidden{display:none}',
      '.git4idea-settings-error{color:var(--dsw-alias-state-error-primary);font-weight:400}',
      '.git4idea-settings-subnote{color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:12px}',
      '.git4idea-settings-sub{margin-top:6px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.git4idea-settings-text{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.git4idea-settings-text-label{color:var(--dsw-alias-label-secondary);font-weight:400}',
      '.git4idea-settings-input{width:100%;box-sizing:border-box;font:inherit}',
      '.git4idea-commit-ai{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}',
      '.git4idea-commit-ai-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.git4idea-commit-ai-hint-block{flex:1 0 100%;font-size:11px}',
      '.git4idea-commit-ai-note{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary));font-size:11px;margin-bottom:4px;word-break:break-word}',
      '.git4idea-settings-list{display:flex;flex-direction:column;gap:2px;max-height:min(46vh,360px);overflow:auto;padding:2px;border:1px solid var(--dsw-alias-hairline,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-sm,8px)}',
      '.git4idea-settings-row{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:calc(var(--dsw-radius-sm,8px) - 2px);cursor:pointer;min-width:0}',
      '.git4idea-settings-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-settings-check{flex:none;accent-color:var(--dsw-alias-brand-primary)}',
      '.git4idea-settings-glyph{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-settings-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
      '.git4idea-root-narrow .git4idea-settings-label{white-space:normal}',
      /* Collapsible setting sections (hand-drawn, same pattern as dsh-gitbash-shell v0.38.4). */
      '.git4idea-fold{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);padding:4px 12px 12px;background:var(--dsw-alias-bg-layer-1,transparent)}',
      '.git4idea-fold .git4idea-stack{padding-top:10px}',
      '.git4idea-foldHead{display:flex;align-items:center;gap:8px;width:100%;appearance:none;background:none;border:0;padding:6px 0;font:inherit;font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}',
      '.git4idea-foldHead:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-foldChevron{flex:none;display:inline-block;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
      '.git4idea-foldChevron.git4idea-foldChevronOpen{transform:rotate(90deg)}',
      '.git4idea-foldTitle{min-width:0;overflow-wrap:anywhere}',
      '.git4idea-root-narrow .git4idea-menu-item{white-space:normal}',
      '.git4idea-root-narrow .git4idea-toast-text{white-space:normal}',
      '.git4idea-toasts{position:absolute;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px;z-index:80;max-width:min(380px,92%);align-items:stretch}',
      '.git4idea-toast{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));border:0;box-shadow:var(--dsw-elevation-prominent,0 8px 22px rgba(0,0,0,.32))}',
      '.git4idea-toast-icon{display:inline-flex;flex:none;margin-top:2px;color:var(--dsw-alias-label-secondary)}',
      '.git4idea-toast-warn .git4idea-toast-icon{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-toast-ok .git4idea-toast-icon{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-toast-error .git4idea-toast-icon{color:var(--dsw-alias-state-error-primary)}',
      /* m02407 #3: two lines while the pointer is away, the whole result while it
         is on the chip, and a pinned-open chip scrolls past min(40vh, 240px). */
      '.git4idea-toast-text{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:500;cursor:pointer}',
      '.git4idea-toast:hover .git4idea-toast-text,.git4idea-toast-open .git4idea-toast-text{display:block;-webkit-line-clamp:unset;max-height:min(40vh,240px);overflow:auto}',
      '.git4idea-toast-action{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-weight:600;cursor:pointer;padding:0 2px;flex:none}',
      '.git4idea-toast-action:hover{text-decoration:underline}',
      '.git4idea-opchip{flex:none;padding:0 6px;border-radius:999px;corner-shape:round;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary)) 20%, transparent);color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary));font-weight:500;white-space:nowrap}',
      '.git4idea-rail-list{display:flex;flex-direction:column;gap:2px;max-height:min(50vh,300px);overflow:auto;padding:2px;border:1px solid var(--dsw-alias-hairline,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-sm,8px)}',
      '.git4idea-rail-item{display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:calc(var(--dsw-radius-sm,8px) - 2px)}',
      '.git4idea-rail-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-rail-item-off{opacity:.5}',
      '.git4idea-rail-item-drag{outline:1px solid var(--dsw-alias-brand-primary)}',
      '.git4idea-rail-grip{display:inline-flex;color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary));cursor:grab;flex:none}',
      '.git4idea-rail-item-icon{display:inline-flex;flex:none}',
      '.git4idea-rail-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
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
      '.git4idea-detail-pane .git4idea-detail-msg{flex:1 1 0;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px}',
      /* Commit layer (m01216 #9): pending changes + message on the left, the
         host-style diff on the right. Roomy enough for a real diff, and it only
         covers the panel — the conversation stays visible around it. */
      /* Floating card (m01737 #2): the layer is only a centring scrim; the card
         itself carries the IDE's window chrome, so the commit dialog reads as a
         window over the log instead of a page that replaced it. */
      '.git4idea-commit-layer{position:absolute;inset:0;z-index:55;display:flex;align-items:center;justify-content:center;padding:18px;background:transparent}',
      '.git4idea-commit-layer-card{display:flex;flex-direction:column;width:min(940px,94%);height:min(640px,94%);overflow:hidden;border-radius:var(--dsw-radius-md,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.45))}',
      /* Frame-wide commit dialog (m02090): the composer's 提交 verb raises this
         over the whole conversation instead of switching to the sidebar tab.
         Fixed on purpose — it is mounted in shell.overlay, OUTSIDE the dock
         containers whose contain:layout would capture an absolute box. */
      '.git4idea-commit-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-scrim,rgba(0,0,0,.32));-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:13px;line-height:1.5;font-weight:600}',
      '.git4idea-commit-overlay .git4idea-commit-layer-card{width:min(1100px,94vw);height:min(720px,88vh)}',
      '.git4idea-commit-layer-head{display:flex;align-items:center;gap:8px;padding:5px 8px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.git4idea-commit-layer-title{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.git4idea-commit-layer-body{flex:1;min-height:0;display:flex;overflow:hidden}',
      '.git4idea-commit-layer-left{flex:2 1 0;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-commit-layer-right{flex:1 1 0;min-width:0;display:flex;flex-direction:column;overflow:hidden}',
      '.git4idea-root-narrow .git4idea-commit-layer-body{flex-direction:column}',
      '.git4idea-root-narrow .git4idea-commit-layer-left{flex:1 1 0;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-root-narrow .git4idea-commit-layer-right{flex:1 1 0}',
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
      '.git4idea-seg-item{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-weight:500;padding:2px 10px;border-radius:calc(var(--dsw-radius-sm,8px) - 2px);cursor:pointer;white-space:nowrap}',
      '.git4idea-seg-item:hover{color:var(--dsw-alias-label-primary)}',
      '.git4idea-seg-item[data-active="true"]{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}',
      '.git4idea-search{padding:4px 6px;flex:none;display:flex;align-items:center;gap:6px}',
      '.git4idea-search .git4idea-input{flex:1;min-width:0}',
      '.git4idea-input{width:100%;box-sizing:border-box;padding:4px 6px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;outline:none}',
      '.git4idea-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-input:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-input-compact{padding:3px 6px}',
      '.git4idea-picker{display:flex;flex-direction:column;gap:2px;padding:12px;overflow:auto;flex:1;min-height:0}',
      '.git4idea-picker-title{color:var(--dsw-alias-label-primary);font-weight:600;margin-bottom:2px}',
      '.git4idea-picker-sub{color:var(--dsw-alias-label-tertiary);margin-bottom:8px;word-break:break-all}',
      '.git4idea-picker-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:6px 8px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}',
      '.git4idea-picker-row:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary)}',
      '.git4idea-picker-icon{display:inline-flex;color:var(--dsw-alias-label-secondary);flex:none}',
      '.git4idea-picker-name{flex:none;font-weight:600}',
      '.git4idea-picker-kind{color:var(--dsw-alias-label-tertiary);flex:none}',
      '.git4idea-picker-path{color:var(--dsw-alias-label-tertiary);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%}',
      /* position:relative: the marquee box paints against this wrapper (the
         scroll container is offset by the search field — same rule as
         .git4idea-history above). */
      '.git4idea-tree{display:flex;flex-direction:column;min-height:0;flex:1;position:relative}',
      '.git4idea-tree-scroll{flex:1;overflow:auto;padding-bottom:6px}',
      '.git4idea-section{display:flex;flex-direction:column}',
      '.git4idea-section-head{display:flex;align-items:center;gap:4px;width:100%;padding:3px 8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-weight:600;cursor:pointer;text-align:left}',
      '.git4idea-section-head-static{cursor:default;padding-left:20px}',
      '.git4idea-section-head:hover{color:var(--dsw-alias-label-primary)}',
      // The header became a DIV (it now holds buttons), and a div is content-box
      // while a button is border-box: without this, width:100% plus its own padding
      // overflowed the pane by 16px and clipped the last toolbar icon (reported on
      // v0.3.8).
      '.git4idea-changes-head{cursor:default;gap:2px;box-sizing:border-box}',
      '.git4idea-section-toggle{display:flex;align-items:center;gap:4px;flex:1;min-width:0;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;text-align:left}',
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
      '.git4idea-row-remote .git4idea-row-label{color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.git4idea-row-tag .git4idea-row-label{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary));font-weight:500}',
      '.git4idea-row-head .git4idea-row-label{font-weight:600}',
      '.git4idea-row-icon{display:inline-flex;flex:none;opacity:.9}',
      '.git4idea-row-label{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;font-weight:600}',
      // Inline tracking target (issue #18): flex:none so it never starves the
      // label, capped and ellipsised so a long origin/… cannot push the badges.
      '.git4idea-row-upstream{flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.git4idea-row-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis}',
      '.git4idea-row-dir{margin-left:auto;opacity:.75}',
      '.git4idea-badge{font-size:10px;padding:0 5px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);flex:none}',
      /* Ahead/behind colours + size (user request): pending pushes read green,
         pending pulls read blue — the same semantics in the tree rows and the
         top bar. 12px/600 keeps the counts legible at a glance. */
      '.git4idea-badge-ahead,.git4idea-track-ahead{color:var(--dsw-alias-state-success-primary);font-size:12px;font-weight:600}',
      '.git4idea-badge-behind,.git4idea-track-behind{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));font-size:12px;font-weight:600}',
      '.git4idea-badge.git4idea-badge-ahead,.git4idea-badge.git4idea-badge-behind{padding:0 6px}',
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
      '.git4idea-commit-date{color:var(--dsw-alias-label-tertiary);flex:none;width:106px;text-align:right;font-variant-numeric:tabular-nums;font-weight:500}',
      '.git4idea-commit-author{color:var(--dsw-alias-label-secondary);flex:none;width:96px;overflow:hidden;text-overflow:ellipsis;font-weight:500}',
      '.git4idea-commit-subject{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.git4idea-commit-fill{flex:1 1 0;min-width:0}',
      '.git4idea-ref{font-size:10px;padding:0 5px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);flex:none;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.git4idea-ref-head{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-ref-local{color:var(--dsw-alias-brand-primary)}',
      '.git4idea-ref-remote{color:#b083f0}',
      '.git4idea-ref-tag{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-ref-more{color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.git4idea-filters{display:flex;align-items:center;gap:4px;padding:4px 6px;flex:none;min-width:0;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-filter-text{flex:1 1 90px;min-width:80px;width:auto}',
      '.git4idea-filter-select{flex:none;max-width:118px;appearance:none;-webkit-appearance:none;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-secondary);font:inherit;font-weight:500;height:22px;padding:0 4px;cursor:pointer;text-overflow:ellipsis}',
      '.git4idea-filter-select:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-filter-select{display:inline-flex;align-items:center;gap:3px}',
      '.git4idea-filter-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:96px}',
      '.git4idea-filter-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.git4idea-filter-path{flex:0 1 112px;min-width:70px;display:flex}',
      '.git4idea-load-more{margin:6px auto;display:block;padding:3px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}',
      '.git4idea-load-more:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-empty{padding:14px;text-align:center;color:var(--dsw-alias-label-tertiary);font-weight:500}',
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
      '.git4idea-group-head{display:flex;align-items:center;gap:8px;padding:2px 8px;height:17px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}',
      '.git4idea-link{margin-left:auto;border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;cursor:pointer;padding:0;flex:none}',
      '.git4idea-link:hover{text-decoration:underline}',
      '.git4idea-row-file{gap:6px;height:20px}',
      '.git4idea-row-check{flex:none;width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.git4idea-group-check{flex:none;width:12px;height:12px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.git4idea-file-status{flex:none;width:14px;text-align:center;font-weight:700;font-size:10px;color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}',
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
      '.git4idea-textarea{width:100%;box-sizing:border-box;min-height:50px;resize:vertical;padding:5px 6px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;outline:none}',
      '.git4idea-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-textarea:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
      '.git4idea-commit-actions{display:flex;align-items:center;gap:8px}',
      '.git4idea-check{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.git4idea-btn{padding:3px 10px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-weight:500;cursor:pointer;flex:none}',
      '.git4idea-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-btn:disabled{opacity:.45;cursor:default}',
      '.git4idea-btn-small{padding:2px 8px;font-size:11px}',
      '.git4idea-btn-primary{margin-left:auto;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.git4idea-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}',
      '.git4idea-btn-danger{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.git4idea-detail{display:flex;flex-direction:column;min-height:0;flex:1;overflow:auto;padding:6px 8px;gap:6px}',
      '.git4idea-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.git4idea-detail-author,.git4idea-detail-date{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-detail-subject{font-weight:600;white-space:pre-wrap}',
      '.git4idea-detail-body{margin:0;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font:inherit}',
      '.git4idea-detail-files-head{font-weight:600;margin-top:4px}',
      '.git4idea-detail-files{display:flex;flex-direction:column}',
      '.git4idea-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.git4idea-diff-pane{flex:none;max-height:55%;display:flex;flex-direction:column;min-height:0;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-diff-head{display:flex;align-items:center;gap:8px;padding:3px 8px;color:var(--dsw-alias-label-tertiary);flex:none;min-width:0}',
      '.git4idea-diff-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}',
      '.git4idea-diff{flex:1;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:calc(12px + var(--dsh-code-font-delta, 0px));line-height:1.5;font-weight:500;min-height:0}',
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
      /* Git-output drawer (VS Code showOutput): panel-internal absolute bottom
         sheet (invariant 13). */
      '.git4idea-gitlog{position:absolute;left:0;right:0;bottom:0;z-index:55;height:46%;min-height:132px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));border-radius:var(--dsw-radius-panel,28px) var(--dsw-radius-panel,28px) 0 0;box-shadow:var(--dsw-elevation-prominent,0 -8px 28px rgba(0,0,0,.3))}',
      '.git4idea-gitlog-head{display:flex;align-items:center;gap:4px;padding:8px 14px 6px;flex:none}',
      '.git4idea-gitlog-title{font-weight:600}',
      '.git4idea-gitlog-empty{padding:10px 14px;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-gitlog-body{flex:1;min-height:0;overflow:auto;padding:0 14px 10px;font-weight:400}',
      '.git4idea-gitlog-row{padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1,transparent)}',
      '.git4idea-gitlog-row-bad .git4idea-gitlog-code{color:var(--dsw-alias-state-danger,#e5484d);font-weight:700}',
      '.git4idea-gitlog-meta{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
      '.git4idea-gitlog-code{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.git4idea-gitlog-ms{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.git4idea-gitlog-at{color:var(--dsw-alias-label-tertiary);font-size:calc(11px + var(--dsh-content-font-delta-secondary, 0px))}',
      '.git4idea-gitlog-argv{font-weight:600;word-break:break-all}',
      '.git4idea-gitlog-pre{margin:4px 0 0;padding:6px 8px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));overflow:auto;max-height:160px;white-space:pre-wrap;word-break:break-all;font-size:calc(11px + var(--dsh-code-font-delta, 0px))}',
      '.git4idea-dialog-wide{min-width:min(360px,92%)}',
      '.git4idea-dialog-title{font-weight:600}',
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
      '.git4idea-menu{box-sizing:border-box;min-width:200px;max-height:calc(100% - 8px);padding:4px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;box-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.35));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);isolation:isolate;display:flex;flex-direction:column}',
      '.git4idea-menu-sub{position:absolute;min-width:180px;max-width:300px;z-index:71}',
      '.git4idea-menu::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1)));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(14px) saturate(1.2));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(14px) saturate(1.2));pointer-events:none}',
      '.git4idea-menu-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column}',
      '.git4idea-menu-item{display:flex;align-items:center;gap:8px;padding:4px 8px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-weight:500;text-align:left;border-radius:var(--dsw-radius-sm,8px);cursor:pointer;white-space:nowrap;overflow:hidden}',
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
      '.git4idea-preview-head{flex:none;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-preview-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-preview-body{flex:1;min-height:0;overflow:auto;padding:8px 12px;display:flex;flex-direction:column}',
      '.git4idea-preview-body .git4idea-diff-host,.git4idea-preview-body .git4idea-diff{flex:1;min-height:0}',
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
      '.git4idea-lf-columns{display:grid;flex:1 1 auto;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0}',
      '.git4idea-lf-column,.git4idea-lf-body[data-review-view=unified]:not([data-review-wrap]){display:grid;grid-template-columns:minmax(max-content,100%);align-content:start}',
      '.git4idea-lf-column{min-width:0;overflow-x:scroll;overscroll-behavior:none}',
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
      '.git4idea-lf-selectorStatic{flex:0 1 auto;min-width:0;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
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
      '.git4idea-cs-ahead{color:var(--dsw-alias-state-success-primary)}',
      '.git4idea-cs-behind{color:var(--dsw-alias-state-business-primary)}',
      '.git4idea-cs-errorbar{flex:none;margin:0 6px 4px;padding:4px 8px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:15px;word-break:break-word}',
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
      '.git4idea-cs-item-counts{display:inline-flex;gap:5px;margin-left:auto;flex:none;font-variant-numeric:tabular-nums;font-size:11px}',
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
      '.git4idea-cs-head{padding:5px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;text-transform:none}',
      /* New-branch dialog (m02016): the popover box swaps the tree for this card. */
      '.git4idea-cs-dialog{display:flex;flex-direction:column;gap:8px;padding:8px;overflow:visible;max-height:none}',
      '.git4idea-cs-dialog-title{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary)}',
      '.git4idea-cs-dialog-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-cs-dialog-input{flex:none;width:100%}',
      '.git4idea-cs-dialog-error{margin:0}',
      '.git4idea-cs-dialog-actions{display:flex;justify-content:flex-end;gap:6px}',
      '.git4idea-cs-dialog-btn{height:24px;padding:0 12px;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
      '.git4idea-cs-dialog-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-cs-dialog-ok{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-on-primary,#fff)}',
      '.git4idea-cs-dialog-ok:hover{background:var(--dsw-alias-brand-primary)}',
      '.git4idea-cs-dialog-ok:disabled{opacity:.45;cursor:default}',
      /* Inline secondary menu (m01737 #5): one row per verb, indented under
         the branch row it belongs to. */
      '.git4idea-cs-sub{display:flex;flex-direction:column;gap:1px;margin:2px 4px 4px 18px;padding:3px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-interactive-bg-hover)}',
      '.git4idea-cs-sub-item{display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 6px;border:none;border-radius:var(--dsw-radius-xs,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '.git4idea-cs-sub-item:hover:not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-selected)}',
      '.git4idea-cs-sub-item[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}',
      '.git4idea-cs-sub-item[aria-disabled="true"]{opacity:.4;cursor:default}',
      '.git4idea-cs-sub-sep{height:1px;margin:2px 4px;background:var(--dsw-alias-border-l2)}',
      '.git4idea-cs-folder{color:var(--dsw-alias-label-secondary);font-weight:600}',
      '.git4idea-cs-ok{height:22px;padding:0 10px;flex:none;border:none;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-on-primary,#fff);font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
      '.git4idea-cs-ok:disabled{opacity:.45;cursor:default}',
      /* One verb per row above the tree (m01737 #6). */
      '.git4idea-cs-actions{display:flex;flex-direction:column;align-items:stretch;gap:1px;padding:2px 6px 6px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.git4idea-cs-action{display:flex;align-items:center;gap:6px;width:100%;height:24px;padding:0 8px;flex:none;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:600;text-align:left;cursor:pointer}',
      '.git4idea-cs-action:hover:not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.git4idea-cs-action[aria-disabled="true"]{opacity:.4;cursor:default}',
      /* ---- ModelRoutePicker (issue #19) ---- */
      '.git4idea-mrp-root{position:relative;display:inline-flex;flex:none;min-width:0}',
      '.git4idea-mrp-trigger{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:220px;font-size:11px;line-height:16px}',
      '.git4idea-mrp-trigger[data-open=true]{color:var(--dsw-alias-brand-primary)}',
      '.git4idea-mrp-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git4idea-mrp-effort{flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10px}',
      '.git4idea-mrp-menu{max-width:300px}',
      '.git4idea-mrp-row .git4idea-cs-item-name{display:none}',
      '.git4idea-mrp-row-label{flex:none}',
      '.git4idea-mrp-row-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-mrp-row-arrow{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-mrp-back{color:var(--dsw-alias-label-tertiary)}',
      '.git4idea-mrp-group{padding:6px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}',
      '.git4idea-mrp-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.git4idea-mrp-error{padding:6px 10px;margin-bottom:2px;border-radius:var(--dsw-radius-sm,8px);background:rgba(220,38,38,.12);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;word-break:break-word}',
      'body[data-ds-dark-theme] .git4idea-mrp-error{background:rgba(248,113,113,.16)}',
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
      /* Read at RENDER time (the service may arrive after this plugin's apply) and
         soft: a host without the plugin page simply keeps the in-panel editor. */
      let navigation
      try {
        navigation = props.ctx === undefined || props.ctx === null ? undefined : props.ctx.get('pluginNavigation')
      } catch (error) { navigation = undefined }
      const openSettings = navigation !== undefined && navigation !== null && typeof navigation.openBundle === 'function'
        ? () => { navigation.openBundle(SETTINGS_BUNDLE) }
        : null
      return E(Panel, { scope: props.scope, t: props.t, visible: props.visible, dock: props.dock, openSettings: openSettings, ctx: props.ctx, openDiffExternal: props.openDiffExternal })
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

    /* The pill's own on/off switch: the same read the conversation tab's
       placement switch uses — row Config when the host serves it, always-on
       before it answers (default ON per the request). */
    function composerStatusEnabled() {
      const ready = railFormReady()
      if (ready === null) return true
      const value = ready.value !== null && typeof ready.value === 'object' ? ready.value.composerStatus : undefined
      return value !== false
    }

    const COMPOSER_POLL_MS = 30000
    const COMPOSER_ERROR_TTL_MS = 6000
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

    /* ---- ModelRoutePicker (issue #19) ------------------------------------
       The panel-side model + reasoning picker, bound to the SAME session model
       route the composer's own selector writes: the host's ui-model-selection
       plugin exposes the modelDirectories resolver, and directoryFor(sessionId)
       hands out the session-scoped directory whose select() IS
       sessions.selectModel — so this picker, the composer pill and the /model
       command can never disagree. The VIEW is hand-drawn (ModelSelect is not
       exported from the official package); the DATA and the selection semantics
       are official end to end. The resolver arrives through a soft inject into
       a module-level ref (a bare `ctx.modelDirectories` read throws "without
       inject" on a real host — cordis gates EVERY property read behind an
       inject declaration); until it lands, and on any older host, the picker
       hides itself instead of throwing, and the AI-write button still works
       through the host's served-models fallback. */
    let modelDirectoriesRef = null
    const modelDirectorySubs = new Set()
    function ModelRoutePicker(props) {
      const t = props.t
      const sessionId = typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : 'default'
      const [injectVersion, setInjectVersion] = useState(0)
      const [directory, setDirectory] = useState(null)
      const [state, setState] = useState(null)
      const [open, setOpen] = useState(false)
      const [pane, setPane] = useState('root')
      const rootRef = useRef(null)
      /* The soft inject may land AFTER first paint (apply runs once, this slot
         mounts per session view): re-render when the module ref refills. */
      useEffect(() => {
        const bump = () => setInjectVersion((v) => v + 1)
        modelDirectorySubs.add(bump)
        return () => modelDirectorySubs.delete(bump)
      }, [])
      const resolver = modelDirectoriesRef
      const ok = resolver !== undefined && resolver !== null && typeof resolver.directoryFor === 'function'
      /* Resolve the session-scoped directory once per session; subscribe AFTER
         taking the snapshot so a change that lands between the two is not lost. */
      useEffect(() => {
        if (ok !== true) return undefined
        let dir = null
        try { dir = resolver.directoryFor(sessionId) } catch (error) { void error }
        if (dir === null || dir === undefined) return undefined
        setState(dir.store.getSnapshot())
        setDirectory(dir)
        /* Snapshot and subscription live on dir.store (uSES-safe); load()/
           select() hang directly off the directory. */
        return dir.store.subscribe(() => setState(dir.store.getSnapshot()))
      }, [ok, resolver, sessionId, injectVersion])
      /* The catalog loads on mount; failures surface through the store and the
         menu shows them. A rejected load must not unmount or disable anything. */
      useEffect(() => {
        if (directory === null) return undefined
        directory.load().catch(() => {})
        return undefined
      }, [directory])
      /* Outside close. pointerdown + capture: the change list captures
         pointerdown for the rubber band, so a plain mousedown listener can
         miss the very click that opened another menu (v0.19.2 lesson). */
      useEffect(() => {
        if (open !== true) return undefined
        const close = (event) => {
          const root = rootRef.current
          if (root !== null && root.contains(event.target) === true) return
          setOpen(false)
          setPane('root')
        }
        document.addEventListener('pointerdown', close, true)
        return () => document.removeEventListener('pointerdown', close, true)
      }, [open])
      if (ok !== true || directory === null) return null
      const s = state === null ? directory.getSnapshot() : state
      const current = s === null || s.current === undefined ? null : s.current
      const busy = s !== null && s.pending !== null && s.pending !== undefined
      const groups = s === null || s.groups === undefined ? [] : s.groups
      /* The current route's reasoning table, looked up through the SAME
         directory groups the menu renders (official effectiveEffort rule). */
      let routeGroup = null
      let routeModel = null
      if (current !== null) {
        routeGroup = groups.filter((row) => row.id === current.provider)[0] || null
        routeModel = routeGroup === null ? null : routeGroup.models.filter((row) => row.id === current.model)[0] || null
      }
      const reasoning = routeModel === null || routeModel.reasoning === undefined ? undefined : routeModel.reasoning
      const effectiveEffort = current === null ? undefined : current.reasoningEffort !== undefined ? current.reasoningEffort : reasoning === undefined ? undefined : reasoning.defaultEffort
      const effortName = (effort) => {
        if (reasoning !== undefined) {
          const hit = reasoning.efforts.filter((row) => row.id === effort)[0]
          if (hit !== undefined) return hit.name
        }
        return effort === undefined ? t('modelRoute.effortDefault') : effort
      }
      const effortLabel = current === null ? '' : reasoning === undefined
        ? (current.reasoningEffort === undefined ? '' : current.reasoningEffort)
        : (effectiveEffort === undefined ? t('modelRoute.effortDefault') : effortName(effectiveEffort))
      const modelName = current === null ? '' : routeModel === null ? current.model : routeModel.name
      const effortChoices = reasoning === undefined ? [] : ([
        ...(reasoning.defaultEffort === undefined ? [{ key: 'provider-default', effort: undefined, label: t('modelRoute.effortDefault') }] : []),
        ...reasoning.efforts.map((row) => ({ key: row.id, effort: row.id, label: row.name })),
      ])
      const closeMenu = () => { setOpen(false); setPane('root') }
      const choose = (selection) => {
        void directory.select(selection).then((result) => {
          if (result !== undefined && result !== null && result.ok !== true) return
          closeMenu()
        }).catch(() => {})
      }
      const triggerTitle = t('modelRoute.trigger') + (current === null ? '' : ' · ' + current.provider + '/' + current.model + (effortLabel === '' ? '' : ' · ' + effortLabel))
      return E('div', { className: 'git4idea-mrp-root', ref: rootRef },
        E('button', {
          type: 'button',
          className: 'git4idea-btn git4idea-btn-small git4idea-mrp-trigger',
          'data-open': open === true ? 'true' : undefined,
          title: triggerTitle,
          onClick: () => { setOpen(!open); setPane('root') },
        },
          E(Icon, { name: 'settings', size: 11 }),
          E('span', { className: 'git4idea-mrp-label' }, current === null ? t('modelRoute.pick') : modelName),
          effortLabel === '' ? null : E('span', { className: 'git4idea-mrp-effort' }, effortLabel),
          E(Icon, { name: 'chevron', size: 9 })),
        open !== true ? null : E('div', { className: 'git4idea-cs-menu git4idea-mrp-menu', role: 'menu' },
          s !== null && typeof s.error === 'string' && s.error !== ''
            ? E('div', { className: 'git4idea-mrp-error', role: 'status' }, s.error)
            : null,
          pane === 'root'
            ? [
              E('button', {
                type: 'button', key: 'model', className: 'git4idea-cs-item git4idea-mrp-row', disabled: busy === true,
                onClick: () => setPane('model'),
              },
                E('span', { className: 'git4idea-mrp-row-label' }, t('modelRoute.modelRow')),
                E('span', { className: 'git4idea-mrp-row-value' }, current === null ? t('modelRoute.pick') : modelName),
                E('span', { className: 'git4idea-mrp-row-arrow' }, E(Icon, { name: 'chevron', size: 9 }))),
              E('button', {
                type: 'button', key: 'effort', className: 'git4idea-cs-item git4idea-mrp-row', disabled: busy === true || current === null || effortChoices.length === 0,
                onClick: () => setPane('effort'),
              },
                E('span', { className: 'git4idea-mrp-row-label' }, t('modelRoute.effortRow')),
                E('span', { className: 'git4idea-mrp-row-value' }, effortChoices.length === 0 ? '' : (effortLabel === '' ? t('modelRoute.effortDefault') : effortLabel)),
                E('span', { className: 'git4idea-mrp-row-arrow' }, E(Icon, { name: 'chevron', size: 9 }))),
            ]
            : [
              E('button', {
                type: 'button', key: 'back', className: 'git4idea-cs-item git4idea-mrp-back', disabled: busy === true,
                onClick: () => setPane('root'),
              }, '‹ ' + (pane === 'model' ? t('modelRoute.modelRow') : t('modelRoute.effortRow'))),
            ],
          pane === 'model' && groups.length === 0
            ? E('div', { className: 'git4idea-mrp-empty' }, t('modelRoute.empty'))
            : null,
          pane === 'model' && groups.map((group) => E(Fragment, { key: group.id },
            E('div', { className: 'git4idea-mrp-group' }, group.name === undefined || group.name === null || group.name === '' ? group.id : group.name),
            group.models.map((model) => {
              const selected = current !== null && current.provider === group.id && current.model === model.id
              return E('button', {
                type: 'button', key: model.id, className: 'git4idea-cs-item', 'data-current': selected === true ? 'true' : undefined,
                disabled: busy === true,
                title: group.id + '/' + model.id,
                onClick: () => choose({ provider: group.id, model: model.id }),
              },
                E('span', { className: 'git4idea-cs-item-name' }, model.name === undefined || model.name === null ? model.id : model.name),
                E('span', { className: 'git4idea-cs-item-note' }, selected === true ? E(Icon, { name: 'check', size: 11 }) : null))
            }))),
          pane === 'effort' && current !== null && effortChoices.map((level) => {
            const selected = effectiveEffort === level.effort
            return E('button', {
              type: 'button', key: level.key, className: 'git4idea-cs-item', 'data-current': selected === true ? 'true' : undefined,
              disabled: busy === true,
              onClick: () => choose({ provider: current.provider, model: current.model, reasoningEffort: level.effort }),
            },
              E('span', { className: 'git4idea-cs-item-name' }, level.label),
              E('span', { className: 'git4idea-cs-item-note' }, selected === true ? E(Icon, { name: 'check', size: 11 }) : null))
          })))
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

    /* Mounted once by the overlay slot, it renders nothing until a composer
       raises it. The body is keyed by repository, so no summary, ticked file or
       diff survives from the previous dialog. */
    function CommitDialogHost(props) {
      const [entry, setEntry] = useState(commitDialog.entry)
      useEffect(() => {
        const sync = () => setEntry(commitDialog.entry)
        sync()
        const off = commitDialog.subscribe(sync)
        commitDialog.hosted = true
        return () => {
          commitDialog.hosted = false
          off()
        }
      }, [])
      if (entry === null) return null
      return E(CommitDialogBody, {
        key: entry.sessionId + '|' + entry.repoRoot,
        entry: entry,
        t: props.t,
        onClose: () => commitDialog.set(null),
      })
    }

    /* The card is the panel's commit layer, rebuilt without the panel: every
       mutation runs its own route call and reloads the summary, so the overlay
       never depends on a mounted Git tab. */
    function CommitDialogBody(props) {
      const t = props.t
      const entry = props.entry
      const [summary, setSummary] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [patch, setPatch] = useState('')
      const [patchLoading, setPatchLoading] = useState(false)
      const [groupBy, setGroupBy] = useState('flat')
      const [foldedDirs, setFoldedDirs] = useState({})
      const [rowMenu, setRowMenu] = useState(null)
      const [discardAsk, setDiscardAsk] = useState(null)
      const anchorRef = useRef(null)
      const diffToken = useRef(0)
      const selection = EMPTY_SELECTION
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
          setError(messageOf(caught))
          return null
        }
      }
      useEffect(() => { void loadSummary() }, [])
      /* One mutation at a time: staging, discarding and committing all reload
         the same summary, so overlapping calls would race their results. */
      const call = async (method, payload) => {
        setBusy(true)
        setError('')
        try {
          await request(method, Object.assign({}, base, payload))
          await loadSummary()
          return true
        } catch (caught) {
          setError(messageOf(caught))
          return false
        } finally {
          setBusy(false)
        }
      }
      const openDiff = async (item, group) => {
        const token = diffToken.current + 1
        diffToken.current = token
        setPatchLoading(true)
        setPatch('')
        try {
          const data = await request('diff', Object.assign({}, base, {
            path: item.path,
            staged: group === 'staged',
            untracked: group === 'untracked',
          }))
          if (diffToken.current === token) setPatch(typeof data.patch === 'string' ? data.patch : '')
        } catch (caught) {
          if (diffToken.current === token) setError(messageOf(caught))
        } finally {
          if (diffToken.current === token) setPatchLoading(false)
        }
      }
      /* A landed commit closes the card and tells every branch readout to
         refresh; a rejected one keeps the box filled with the error above it.
         ChangesPanel has already cleared its draft by the time this returns. */
      const commit = (message, amend, push, paths) => {
        void (async () => {
          setBusy(true)
          setError('')
          try {
            await request('commit', Object.assign({}, base, {
              message: message,
              amend: amend === true,
              push: push === true,
              confirm: push === true,
              paths: paths,
            }))
            try { notifyBranchSwitched(entry.sessionId, entry.repoRoot) } catch (caught) { void caught }
            props.onClose()
          } catch (caught) {
            setError(messageOf(caught))
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
              type: 'button', className: 'git4idea-icon-btn', title: t('confirm.cancel'),
              onClick: () => props.onClose(),
            }, E(Icon, { name: 'close', size: 12 }))),
          error === '' ? null : E('div', { className: 'git4idea-banner' },
            E('span', { className: 'git4idea-banner-text' }, error),
            E('button', { type: 'button', className: 'git4idea-link', onClick: () => setError('') }, t('error.dismiss'))),
          E('div', { className: 'git4idea-commit-layer-body' },
            E('div', { className: 'git4idea-commit-layer-left' },
              E(ChangesPanel, {
                t: t, summary: summary, busy: busy, compact: false, hideHeader: true,
                groupBy: groupBy, sortKey: 'git', onGroupBy: setGroupBy,
                foldedDirs: foldedDirs, onFoldedDirs: setFoldedDirs,
                request: request, cwd: entry.cwd, sessionId: entry.sessionId,
                commitSettings: readCommitSettings(), base: base,
                onCommit: commit,
                onStage: (item) => { void call('stage', { paths: [item.path] }) },
                onUnstage: (item) => { void call('unstage', { paths: [item.path] }) },
                onStageAll: (entries) => { void call('stage', { paths: entries.map((item) => item.path) }) },
                onUnstageAll: () => { void call('unstage', { paths: stagedPaths() }) },
                onDiscard: (item, group) => setDiscardAsk({ item: item, group: group }),
                onDiff: (item, group) => { void openDiff(item, group) },
                onChangeMenu: (event, item, group) => setRowMenu({ item: item, group: group, x: event.clientX, y: event.clientY }),
                /* This card's rows are not a multi-select surface: the panel owns
                   the keyboard/drag model, and the checkbox is the commit pick. */
                selection: selection,
                onSelectionChange: () => undefined,
                anchorRef: anchorRef,
              })),
            E('div', { className: 'git4idea-commit-layer-right' },
              patch === '' && patchLoading === false
                ? E('div', { className: 'git4idea-empty' }, t('pane.diff'))
                : E(DiffBody, { patch: patch, loading: patchLoading, t: t })))),
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
      const [enabled, setEnabled] = useState(() => composerStatusEnabled())
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
      const [error, setError] = useState('')
      const [tick, setTick] = useState(0)
      /* Branch popover (m01216 #10): a searchable local/remote/tag tree, the
         fetch button beside the search box, and commit/push/new-branch at the
         bottom. Everything here runs on this pill's own API calls — it lives in
         the host composer and cannot reach the panel. */
      const [branchFilter, setBranchFilter] = useState('')
      const [newBranchOpen, setNewBranchOpen] = useState(false)
      const [newBranchName, setNewBranchName] = useState('')
      /* Where a new branch forks from (m01737 #5): the row menu opens the
         inline name field with this ref, so "new branch from 'origin/x'" is one
         step instead of a checkout first. */
      const [newBranchFrom, setNewBranchFrom] = useState('')
      /* Only a REMOTE start point may bind an upstream. A local branch with a
         slash in its name is not a tracking ref, and `--track` on it makes git
         refuse the whole checkout. */
      const [newBranchTrack, setNewBranchTrack] = useState(false)
      /* Folded folders of the popover tree, keyed by slash path. Absent means
         open — the tree starts expanded like the IDE's branch chooser. */
      const [csFolded, setCsFolded] = useState({})
      /* Secondary menu for a row (m01737 #5): a click SELECTS, it never checks
         out. { entry, kind, x, y } — offsets inside the popover root. */
      const [csMenu, setCsMenu] = useState(null)
      const [csBusy, setCsBusy] = useState('')
      const rootRef = useRef(null)

      /* The switch flips live through the same rail-config notify walk the
         settings card and the conversation tab ride. */
      useEffect(() => {
        const sync = () => setEnabled(composerStatusEnabled())
        sync()
        return subscribeRailConfig(sync)
      }, [])

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

      useEffect(() => {
        if (error === '') return undefined
        const timer = setTimeout(() => { setError('') }, COMPOSER_ERROR_TTL_MS)
        return () => clearTimeout(timer)
      }, [error])

      if (enabled !== true) return null
      const data = repoState
      if (data === null || (data.isRepo !== true && (data.repos === undefined || data.repos.length === 0))) return null
      const branchName = summary !== null && typeof summary.branch === 'string' && summary.branch !== '' ? summary.branch : null
      const detached = summary !== null && summary.detached === true

      const openBranchMenu = async () => {
        setMenu('branch')
        /* A warm page (panel or prewarm) fills the list this tick; the fetch
           below re-proves it. On failure keep whatever is showing. */
        const seed = readPaintPage(repoRoot)
        const seeded = seed !== undefined && seed.branches !== undefined && seed.branches !== null ? seed.branches : null
        setBranchList(seeded)
        setBranchLoading(seeded === null)
        try {
          const branchesData = await request('branches', { cwd: cwd, repoRoot: repoRoot })
          setBranchList(branchesData)
          mergePaintPage(repoRoot, { branches: branchesData })
        } catch (caught) { void caught } finally { setBranchLoading(false) }
      }
      const checkoutBranch = async (name) => {
        if (repoRoot === null || checkingOut !== '') return
        setCheckingOut(name)
        try {
          await request('checkout', { cwd: cwd, repoRoot: repoRoot, branch: name, confirm: true })
          setMenu(null)
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
        } catch (caught) {
          setMenu(null)
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally { setCheckingOut('') }
      }
      /* Popover actions (m01216 #10). Nothing here may depend on panel state:
         the pill lives in the host composer, outside the panel's React tree. */
      const csCall = async (action, payload) => {
        if (repoRoot === null || csBusy !== '') return
        setCsBusy(action)
        try {
          await request(action, Object.assign({ cwd: cwd, repoRoot: repoRoot }, payload))
          setMenu(null)
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
        } catch (caught) {
          setMenu(null)
          setError(caught instanceof Error ? caught.message : String(caught))
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
        if (commitDialog.hosted === true) {
          commitDialog.set({ sessionId: sessionId, cwd: cwd, repoRoot: repoRoot })
          setMenu(null)
          return
        }
        openPanelSeat()
      }
      /* Create-and-switch in one step (m02016): the dialog's confirm runs
         `git checkout -b` — the same verb the panel's dialog uses — so the new
         branch is never a dangling ref the user still has to check out. A
         remote start point also binds the upstream, like every other path here. */
      const createBranch = async () => {
        const name = newBranchName.trim()
        if (name === '' || repoRoot === null || csBusy !== '') return
        setCsBusy('newBranch')
        try {
          const payload = {
            cwd: cwd, repoRoot: repoRoot, branch: name, create: true, confirm: true,
          }
          if (newBranchFrom !== '') {
            payload.startPoint = newBranchFrom
            if (newBranchTrack === true) payload.track = true
          }
          await request('checkout', payload)
          setNewBranchName('')
          setNewBranchFrom('')
          setNewBranchTrack(false)
          setNewBranchOpen(false)
          setMenu(null)
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally { setCsBusy('') }
      }
      const closeNewBranch = () => {
        setNewBranchName('')
        setNewBranchFrom('')
        setNewBranchTrack(false)
        setNewBranchOpen(false)
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
          } catch (caught) {
            setMenu(null)
            setError(caught instanceof Error ? caught.message : String(caught))
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
      /* Row menu (m01737 #5): a click selects the row and opens the IDEA verb
         list beside it. Offsets are root-relative, the same convention the
         panel menu uses, because the composer seat is its own containing block. */
      /* The verb list opens inline under its row rather than as a floating
         layer: the popover body is a scrolling, clipped box, so a positioned
         submenu would be cut off at the first row near the fold. Inline keeps
         every item reachable at any scroll offset. */
      const openCsMenu = (entry, kind) => {
        setCsMenu((current) => (current !== null && current.entry === entry && current.kind === kind ? null : { entry: entry, kind: kind }))
      }
      const csMenuItems = (sel) => {
        const entry = sel.entry
        const kind = sel.kind
        const local = kind === 'local'
        return [
          {
            id: 'checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout'),
            disabled: entry.head === true || entry.worktree !== null || checkingOut !== '',
            run: () => { setCsMenu(null); csCheckout(entry, kind) },
          },
          {
            id: 'newBranch', icon: 'branchCreate', tone: 'success',
            label: t(kind === 'remote' ? 'action.createLocalBranch' : 'action.newBranchFrom'),
            run: () => {
              setCsMenu(null)
              setError('')
              setNewBranchFrom(entry.name)
              setNewBranchTrack(kind === 'remote')
              setNewBranchName(kind === 'remote' ? entry.name.slice(entry.name.indexOf('/') + 1) : '')
              setNewBranchOpen(true)
            },
          },
          null,
          { id: 'compare', icon: 'filter', tone: 'violet', label: t('action.compare'), run: () => { setCsMenu(null); openPanelSeat() } },
          null,
          {
            id: 'delete', icon: 'trash', tone: 'danger', danger: true, label: t('action.delete'),
            disabled: entry.head === true && local,
            run: () => { setCsMenu(null); csDelete(entry, kind) },
          },
        ].filter((item) => item !== null)
      }
      const csSubmenu = (sel) => E('div', { key: 'sub:' + sel.entry.name, className: 'git4idea-cs-sub' },
        csMenuItems(sel).map((item) => item === null
          ? E('div', { key: 'sep', className: 'git4idea-cs-sub-sep' })
          : E('button', {
            key: item.id,
            type: 'button',
            className: 'git4idea-cs-sub-item',
            'data-tone': item.danger === true ? 'danger' : (item.tone === undefined ? 'secondary' : item.tone),
            'aria-disabled': item.disabled === true ? 'true' : 'false',
            title: sel.entry.name,
            onClick: () => { if (item.disabled !== true) item.run() },
          }, E(Icon, { name: item.icon, size: 12 }), E('span', null, item.label))))
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
        title: entry.worktree !== null ? t('composer.inWorktree') : (checkingOut !== '' ? t('composer.busy') : entry.name),
        onClick: () => { openCsMenu(entry, kind) },
      },
        E(Icon, { name: kind === 'tags' ? 'tag' : 'branch', size: 11 }),
        E('span', { className: 'git4idea-cs-item-name' }, entry.name.slice(entry.name.lastIndexOf('/') + 1)),
        entry.worktree !== null ? E('span', { className: 'git4idea-cs-item-note' }, t('composer.inWorktree')) : null,
        checkingOut === entry.name ? E('span', { className: 'git4idea-cs-item-note' }, '…') : null,
        entry.ahead > 0 || entry.behind > 0
          ? E('span', { className: 'git4idea-cs-item-counts' },
            entry.ahead > 0 ? E('span', { className: 'git4idea-cs-ahead' }, '↑' + String(entry.ahead)) : null,
            entry.behind > 0 ? E('span', { className: 'git4idea-cs-behind' }, '↓' + String(entry.behind)) : null)
          : null)
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
            const closed = csNeedle === '' && csFolded[path] === true
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
            if (csMenu !== null && csMenu.entry === entry && csMenu.kind === kind) rows.push(csSubmenu(csMenu))
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
        title: error === '' ? undefined : error,
      },
        branchName !== null ? E('button', {
          type: 'button',
          className: 'git4idea-cs-pill',
          title: t('composer.branchHint'),
          'aria-expanded': menu === 'branch' ? 'true' : 'false',
          onClick: () => {
            setCsMenu(null)
            if (menu !== 'branch') { void openBranchMenu() } else { setMenu(null) }
          },
        },
          E(Icon, { name: 'branch', size: 14 }),
          E(ComposerMarqueeName, { text: detached === true ? t('composer.detached') : branchName }),
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
              csTree('tags', t('branches.tags'), csEntries(branchList.tags), 'tags') || [],
            )
            /* New-branch dialog (m02016): the popover ITSELF becomes the dialog
               while a name is being typed. A card floating inside the scrollable
               tree would be clipped or dragged by the tree's scroll offset; one
               box that swaps content has neither failure mode, and Cancel gets
               the tree back. Create runs the checkout, so the new branch is
               also the current one. */
            if (newBranchOpen === true) {
              return E('div', {
                className: 'git4idea-cs-menu git4idea-cs-dialog', 'data-cordis-panel': '',
                onKeyDown: (event) => { if (event.key === 'Escape') closeNewBranch() },
              },
                E('div', { className: 'git4idea-cs-dialog-title' }, t('toolbar.newBranch')),
                newBranchFrom !== '' ? E('div', { className: 'git4idea-cs-dialog-sub', title: newBranchFrom },
                  t('action.newBranchFrom') + ' · ' + newBranchFrom) : null,
                E('input', {
                  className: 'git4idea-cs-input git4idea-cs-dialog-input', value: newBranchName,
                  spellCheck: false, autoFocus: true,
                  placeholder: t('prompt.newBranch'),
                  onChange: (event) => setNewBranchName(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter') void createBranch() },
                }),
                error !== '' ? E('div', { className: 'git4idea-cs-errorbar git4idea-cs-dialog-error', title: error }, error) : null,
                E('div', { className: 'git4idea-cs-dialog-actions' },
                  E('button', {
                    type: 'button', className: 'git4idea-cs-dialog-btn', onClick: closeNewBranch,
                  }, t('confirm.cancel')),
                  E('button', {
                    type: 'button', className: 'git4idea-cs-dialog-btn git4idea-cs-dialog-ok',
                    disabled: newBranchName.trim() === '' || csBusy !== '' || repoRoot === null,
                    onClick: () => { void createBranch() },
                  }, t('confirm.ok'))))
            }
            return E('div', { className: 'git4idea-cs-menu git4idea-cs-branches', 'data-cordis-panel': '' },
              E('div', { className: 'git4idea-cs-search' },
                E('input', {
                  className: 'git4idea-cs-input', value: branchFilter, spellCheck: false,
                  placeholder: t('branches.filter'),
                  onChange: (event) => setBranchFilter(event.target.value),
                }),
                E('button', {
                  type: 'button', className: 'git4idea-cs-tool',
                  title: t('toolbar.fetch'),
                  'aria-disabled': repoRoot === null || csBusy !== '' ? 'true' : 'false',
                  onClick: () => { void csCall('fetch', { prune: true }) },
                }, E(Icon, { name: 'fetch', size: 13 }))),
              error !== '' ? E('div', { className: 'git4idea-cs-errorbar', title: error }, error) : null,
              /* Actions sit under the search box and above the tree, one per row
                 (m01737 #6) — they read as verbs on the branch list below them,
                 not as a footer. */
              E('div', { className: 'git4idea-cs-actions' },
                E('button', { type: 'button', className: 'git4idea-cs-action', title: t('changes.commit'), onClick: openCommitDialog },
                  E(Icon, { name: 'commit', size: 12 }), E('span', null, t('changes.commit'))),
                E('button', {
                  type: 'button', className: 'git4idea-cs-action', title: t('toolbar.push'),
                  'aria-disabled': repoRoot === null || csBusy !== '' ? 'true' : 'false',
                  onClick: () => { void csCall('push', { confirm: true }) },
                }, E(Icon, { name: 'push', size: 12 }), E('span', null, t('toolbar.push'))),
                E('button', {
                  type: 'button', className: 'git4idea-cs-action', title: t('toolbar.newBranch'),
                  onClick: () => {
                    setNewBranchFrom('')
                    setNewBranchTrack(false)
                    setNewBranchName('')
                    setError('')
                    setNewBranchOpen(true)
                  },
                }, E(Icon, { name: 'plus', size: 12 }), E('span', null, t('toolbar.newBranch')))),
              E('div', { className: 'git4idea-cs-sections' },
                sections.length === 0 ? E('div', { className: 'git4idea-cs-item git4idea-cs-static' }, t('filter.none')) : sections),
              )
          })())
          : null,
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
      const [immersive, setImmersive] = useState(() => conversationImmersiveEnabled())
      useEffect(() => {
        const sync = () => { setImmersive(conversationImmersiveEnabled()) }
        sync()
        return subscribeRailConfig(sync)
      }, [])
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
    function NativePreviewPanel(props) {
      const t = props.t
      const [seed, setSeed] = useState(() => previewStore.seed)
      useEffect(() => previewStore.subscribe(() => { setSeed(previewStore.seed) }), [])
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
          E('span', { className: 'git4idea-preview-title', title: title }, title === '' ? t('preview.title') : title),
          seed === null ? null : E('div', { className: 'git4idea-preview-actions' },
            E('button', { type: 'button', className: 'git4idea-preview-btn', 'aria-label': t('diff.copy'), title: t('diff.copy'), onClick: copyPatch },
              E(Icon, { name: copied === true ? 'check' : 'copy', size: 13 })),
            E('button', { type: 'button', className: 'git4idea-preview-btn', 'aria-label': t('toolbar.refresh'), title: t('toolbar.refresh'), onClick: () => { setRefreshTick((n) => n + 1) } },
              E(Icon, { name: 'refresh', size: 13 })))),
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

    function apply(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-git4idea', '')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() }, 'dsh-git4idea: panel styles')

      const t = translatorOf(ctx)

      /* DSH's own locale registry: bind this plugin's namespace so host-side
         consumers read exactly the copy the panel does. Every shipped
         dictionary rides this one call; a missing service (standalone
         compositions) simply means the panel is the only reader. */
      const localeService = ctx.get('locale')
      if (localeService !== undefined && typeof localeService.register === 'function') {
        ctx.effect(
          () => localeService.register(LOCALE_NS, Object.assign({ zh: ZH, en: EN }, LOCALES)),
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
      const conversationTabEnabled = () => {
        const ready = railFormReady()
        if (ready === null) return true
        const value = ready.value !== null && typeof ready.value === 'object' ? ready.value.conversationTab : undefined
        return value !== false
      }
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
          const unsubscribe = subscribeRailConfig(sync)
          return () => {
            unsubscribe()
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

      /* ---- frame-wide commit dialog seat (m02090) ---- */
      /* `shell.overlay` is the host's frame-wide layer (ui-chat registers its
         quota notice there). The composer pill cannot host a viewport dialog
         itself — its dock container has contain:layout — so the card rides this
         seat and is opened through the module store above. Optional on purpose:
         a host without the slot keeps the sidebar fallback. */
      ctx.inject(['slots'], (overlayCtx) => {
        const overlaySlots = overlayCtx.get('slots')
        if (overlaySlots === undefined || overlaySlots === null || typeof overlaySlots.inject !== 'function') return
        overlayCtx.effect(() => {
          const offOverlay = overlaySlots.inject('shell.overlay', () => overlaySlots.register(
            { name: 'shell.overlay', id: 'dsh-git4idea:commit', locale: LOCALE_NS },
            (overlayProps) => E(CommitDialogHost, Object.assign({}, overlayProps, { t: t, ctx: ctx })),
          ))
          return () => {
            commitDialog.set(null)
            try { offOverlay() } catch (error) { void error }
          }
        }, 'dsh-git4idea: commit dialog overlay')
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

      /* ---- panel model picker: the official directories resolver ---- */
      /* ui-model-selection exposes the resolver as a CONTEXT PROPERTY, and
         cordis refuses bare property reads ("cannot get property … without
         inject") — the only legal consumer path is a declared inject. Soft:
         an older host without the service never fires this callback, the ref
         stays null and the picker hides itself (the AI-write button keeps its
         served-models fallback). Subscribers re-render the mounted pickers. */
      ctx.inject(['modelDirectories'], (mdCtx) => {
        const md = mdCtx.get('modelDirectories')
        if (md === undefined || md === null || typeof md.directoryFor !== 'function') return
        modelDirectoriesRef = md
        for (const notify of modelDirectorySubs) { try { notify() } catch (error) { void error } }
      })

      /* ---- settings: the row Config is the rail's source of truth ---- */
      /* dsh >= 0.1.7 serves a plugin's row Config to the browser through
         ctx.configForms; from then on the settings card and the rail read that one
         document (and the legacy localStorage value is migrated once). A host
         without the service never fires this callback: railForm stays null and the
         localStorage home + in-panel editor keep working there. */
      ctx.inject(['configForms'], (formCtx) => {
        const forms = formCtx.get('configForms')
        if (forms === undefined || forms === null || typeof forms.get !== 'function') return
        let form
        try { form = forms.get(RAIL_NS) } catch (error) { void error }
        if (form === undefined || form === null || typeof form.getSnapshot !== 'function') return
        formCtx.effect(() => {
          railForm = form
          migrateRailConfig(form)
          /* The row Config is still 'loading' at bind time, so the migration is
             attempted here AND on every notification until it lands — it is
             idempotent (marker-gated, re-entrancy-guarded) and only stamps the
             marker once the Host accepted the write. */
          const unsubscribe = typeof form.subscribe === 'function' ? form.subscribe(() => { notifyRailConfig(); migrateRailConfig(form) }) : undefined
          notifyRailConfig()
          return () => {
            railForm = null
            if (typeof unsubscribe === 'function') unsubscribe()
            notifyRailConfig()
          }
        }, 'dsh-git4idea: row config')
      })

      /* The settings card, on the plugin detail page (plugins.bundle.config,
         keyed by the PACKAGE name; dsh >= 0.1.6-alpha.2). The legacy settings-list
         seat served pre-alpha.2 hosts only and is gone with the raised floor. The
         seat is optional — a host without the slots keeps whatever surface it has. */
      ctx.inject(['slots'], (slotCtx) => {
        const slots = slotCtx.get('slots')
        if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
        slotCtx.effect(() => {
          const card = (cardProps) => E(RailSettingsCard, Object.assign({}, cardProps, { t: t }))
          const offBundle = slots.inject('plugins.bundle.config', () => slots.register(
            { name: 'plugins.bundle.config', key: SETTINGS_BUNDLE, locale: LOCALE_NS },
            card,
          ))
          return () => {
            try { offBundle() } catch (error) { void error }
          }
        }, 'dsh-git4idea: settings card')
      })
    }

    return { name: 'dsh-git4idea', inject: [], apply }
  },
})
