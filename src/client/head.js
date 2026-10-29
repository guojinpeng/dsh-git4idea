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
    /* The frame's overlay slot lives inside .overlayLayer (z-index 20, a stacking
       context), so a child can never paint above the page's own layers. The
       notification stack escapes through a portal to document.body. */
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch (error) { void ReactDOM }
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
      void request('config-set', { key: key, value: value }).catch(() => undefined)
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

