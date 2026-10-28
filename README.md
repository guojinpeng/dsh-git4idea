# dsh-git4idea

> 把 IDE 风格的 Git 工具窗口做成 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里的原生面板：分支树、提交图谱、提交详情，三栏布局。

本仓库从 [KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git)（MIT）派生，保留其全部核心实现，重新设计了图标与外观方向，并按自己的使用习惯继续演进。

## 能力

- **入口只有会话标签行**：注册成会话标签行（「对话 / 轨迹」旁边的 Git 页）。DSH 启动时不再自动打开右侧栏的 Git 详情，起始页也没有入口。
- **分支树**：`HEAD / 本地 / 远程 / 标签` 分组，ahead/behind 角标、上游、worktree 占用标记；右键签出、新建、重命名、删除、合并、变基、设上游。左缘 `<` 可把整列收起，`>` 再展开。
- **分支行菜单**：输入框分支胶囊展开的树，每行右侧有 `>` 箭头，点开后菜单浮在列表右侧（不会撑开或裁剪列表），四个动词：签出、从此新建、合并到当前分支、删除。抓取（fetch）后弹层不关闭，只刷新列表。
- **分支名自动跟随**：在终端或别的 IDE 里 `git checkout` 后，输入框的胶囊约 2.5 秒内换成新分支名；切回标签页时立即探测。探测只读分支名与 HEAD（两条 git 命令），不扫工作区状态。
- **三栏按 1:2:2 分**：左侧分支树 1 份、中间提交列表 2 份、右侧提交详情 2 份（详情上 2/3 为变更文件、下 1/3 为提交说明），分隔条可拖动。
- **提交图谱**：lane 拓扑 + ref 徽章，无限滚动，按文本 / 哈希 / 作者 / 分支 / 日期 / 路径过滤。
- **提交详情**：作者、日期、完整信息、变更文件与逐行 diff（双列行号、± 统计、hunk 高亮）。合并提交与它的第一父比较，所以文件列表和 diff 不会一边有一边空。
- **提交弹窗**：点输入框分支胶囊里的「提交」，直接在当前会话上浮出提交窗口（左 2/3 变更列表、右 1/3 diff、底部提交框），不用先打开右侧栏、再点一次。
- **推送弹窗**：推送前先看清要发什么——左侧是本次要推送的提交，点某一条，右侧列出它的变更文件；双击文件浮出变更卡。没有上游时自动设置上游，成功后在右下角通知里报出提交数与目标。
- **变更卡**：双击任意文件（推送弹窗、提交详情）都在页面中央浮出独立 diff 卡，不再把右侧栏切走。主题、行号、hunk 高亮与提交弹窗右侧一致。
- **提交并推送拆两步**：先提交，成功才关提交窗并打开推送窗；推送成功再关。任一步失败都停在当前卡片上，并在右下角通知里说明原因。
- **右下角通知**：git 的结果与异常都走右下角通知，默认 5 秒消失；鼠标移到通知上暂停计时，离开后重新计 5 秒。通知默认折成 2 行，悬停展开全文，内容过长时可滚动。
- **IDE 式动作条**：按面板自身尺寸决定放几个按钮，放不下的收进 `⋯`；顺序与显隐可在设置里改。

## 安装

```bash
dsh plugin --profile desktop add dsh-git4idea
```

包自带 `dsh.bundle.patch`，`dsh plugin add` 会把它并进 profile，不需要手写 `insert` 行。宿主半改动需要重启 `dsh web`，客户端半改动刷新页面即可。

## 配置

设置卡片里的「面板」分区（与 DSH 的 row Config 同步）：

| 字段 | 作用 |
| --- | --- |
| `conversationTab` | 是否在会话标签行注册 Git 页（默认开） |
| `immersive` | 会话内 Git 页是否用沉浸式布局（默认开） |
| `composerStatus` | 输入框下方是否显示当前分支（默认开） |
| `rail*` | 动作条每个按钮的显隐（7 个布尔字段：tree / newBranch / pull / delete / compare / fetch / favorite） |
| `commitModel` / `commitReasoning` / `commitPrompt` | 「AI 写提交信息」用哪个模型、哪档思考、附加提示 |

## 开发

无构建：`src/index.js` 是宿主半（只 import `node:` 内置模块，git 调用永远是 argv 数组），`src/client.js` 是客户端半（单文件，保持 `window.__ModuleLoader__.load` 包装，只 require `react`）。

```bash
npm test   # smoke + api + graph + repos
```

## 许可

MIT。原始实现版权归 KannaKuron（见 `LICENSE`）。

图标路径数据取自 IntelliJ Platform（`platform/icons/src/expui/**` 与 `platform/icons/src/vcs/branch.svg`，经 Rebased 源码树取得），Apache License 2.0，版权归 JetBrains s.r.o.。来源清单与许可证全文见 `THIRD_PARTY_NOTICES.md`。
