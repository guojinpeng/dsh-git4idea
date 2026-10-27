# dsh-git4idea

> 把 IDE 风格的 Git 工具窗口做成 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里的原生面板：分支树、提交图谱、变更与提交、提交详情，三栏布局。

本仓库从 [KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git)（MIT）派生，保留其全部核心实现，重新设计了图标与外观方向，并按自己的使用习惯继续演进。

## 能力

- **默认在原生右侧栏**：注册成 DSH 右侧栏（`@deepseek-ai/dsh-client-ui-sidebar-right`）里的一个 Tab，加载后自动打开；另外可选挂到会话标签行（「对话 / 轨迹」旁边的 Git 页）。
- **分支树**：`HEAD / 本地 / 远程 / 标签` 分组，ahead/behind 角标、上游、worktree 占用标记；右键签出、新建、重命名、删除、合并、变基、设上游。
- **提交图谱**：lane 拓扑 + ref 徽章，无限滚动，按文本 / 哈希 / 作者 / 分支 / 日期 / 路径过滤。
- **变更与提交**：分组变更列表、暂存 / 取消暂存 / 丢弃、提交框；「提交并推送」一步到位。
- **提交详情**：作者、日期、完整信息、变更文件与逐行 diff（双列行号、± 统计、hunk 高亮）。
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
| `rail*` | 动作条每个按钮的显隐（16 个布尔字段） |
| `commitModel` / `commitReasoning` / `commitPrompt` | 「AI 写提交信息」用哪个模型、哪档思考、附加提示 |

## 开发

无构建：`src/index.js` 是宿主半（只 import `node:` 内置模块，git 调用永远是 argv 数组），`src/client.js` 是客户端半（单文件，保持 `window.__ModuleLoader__.load` 包装，只 require `react`）。

```bash
npm test   # smoke + api + graph + repos
```

## 许可

MIT。原始实现版权归 KannaKuron（见 `LICENSE`）。

图标路径数据取自 IntelliJ Platform（`platform/icons/src/expui/**` 与 `platform/icons/src/vcs/branch.svg`，经 Rebased 源码树取得），Apache License 2.0，版权归 JetBrains s.r.o.。来源清单与许可证全文见 `THIRD_PARTY_NOTICES.md`。
