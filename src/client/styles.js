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

