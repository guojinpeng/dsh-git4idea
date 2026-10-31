    /* ============================ theme tokens ============================ */
    /* The "Islands" skin. Every visual decision that can be expressed as a
       token lives here, including the host aliases this panel already reads.
       A future restyle changes this file (and ui/components.js), not the 600+
       layout rules in styles.js. */
    const G4_SCOPE = [
      '.git4idea-root',
      '.git4idea-commit-overlay',
      '.git4idea-tip',
      '.git4idea-toasts',
      '.git4idea-preview-root',
      '.git4idea-chooser-seat',
      '.git4idea-chooser-backdrop',
      /* Frame-level confirms sit outside every panel root; without the token
         scope their card had no surface and showed the page through it. */
      '.git4idea-overlay',
      '.git4idea-account-seat',
    ].join(',')
    const G4_DARK_SCOPE = [
      'body[data-ds-dark-theme] .git4idea-root',
      'body[data-ds-dark-theme] .git4idea-commit-overlay',
      'body[data-ds-dark-theme] .git4idea-tip',
      'body[data-ds-dark-theme] .git4idea-toasts',
      'body[data-ds-dark-theme] .git4idea-preview-root',
      'body[data-ds-dark-theme] .git4idea-chooser-seat',
      'body[data-ds-dark-theme] .git4idea-chooser-backdrop',
      'body[data-ds-dark-theme] .git4idea-overlay',
      'body[data-ds-dark-theme] .git4idea-account-seat',
    ].join(',')

    const G4_THEME_CSS = [
      G4_SCOPE + '{'
        + '--g4-canvas:#e9eaee;--g4-surface:#fff;--g4-raised:#f7f8f9;--g4-overlay:#fff;--g4-header:#f7f8f9;--g4-sunken:#f2f3f5;'
        + '--g4-hover:rgba(38,49,72,.06);--g4-hover-strong:rgba(38,49,72,.1);--g4-selected:#d0dffe;--g4-selected-hover:#c2d4fc;'
        + '--g4-text:#000;--g4-text-2:#5f6269;--g4-text-3:#73767c;'
        + '--g4-border:#e9eaee;--g4-border-strong:#d1d3d9;'
        + '--g4-brand:#3871e1;--g4-brand-hover:#2f5eb9;--g4-brand-pressed:#2e4d89;--g4-brand-subtle:#e3ebfe;--g4-brand-text:#2f5eb9;'
        + '--g4-success:#338555;--g4-success-bg:#e2efe2;--g4-danger:#c54e58;--g4-danger-bg:#ffe5e5;--g4-warning:#a56906;--g4-warning-bg:#fde7c9;'
        + '--g4-info:#2f5eb9;--g4-info-bg:#e3ebfe;--g4-ai:#8060db;--g4-ai-bg:#efeafd;'
        + '--g4-graph-1:#3871e1;--g4-graph-2:#338555;--g4-graph-3:#cf7659;--g4-graph-4:#8060db;--g4-graph-5:#c54e58;--g4-graph-6:#31827b;--g4-graph-7:#a56906;--g4-graph-8:#73767c;'
        + '--g4-diff-add:#e2efe2;--g4-diff-add-word:#cde5d1;--g4-diff-add-gutter:#cde5d1;--g4-diff-del:#ffe5e5;--g4-diff-del-word:#ffd6d6;--g4-diff-del-gutter:#ffd6d6;--g4-diff-mod:#e3ebfe;'
        + '--g4-shadow:0 8px 24px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.08);'
        + '--g4-font:"Inter","Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif;'
        + '--g4-mono:"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"Liberation Mono",monospace;'
        /* Host aliases: text, surfaces, borders, states, radii, elevation. */
        + '--dsw-font-family:var(--g4-font);'
        + '--dsw-alias-label-primary:var(--g4-text);--dsw-alias-label-secondary:var(--g4-text-2);--dsw-alias-label-tertiary:var(--g4-text-3);--dsw-alias-label-dimmed:var(--g4-text-3);'
        + '--dsw-alias-label-primary-inverted:#fff;--dsw-alias-brand-on-primary:#fff;'
        + '--dsw-alias-border-l1:var(--g4-border);--dsw-alias-border-l2:var(--g4-border);--dsw-alias-border-l3:var(--g4-border-strong);--dsw-alias-hairline:var(--g4-border);'
        + '--dsw-alias-bg-base:var(--g4-surface);--dsw-alias-bg-layer-1:var(--g4-surface);--dsw-alias-bg-layer-2:var(--g4-overlay);--dsw-alias-bg-layer-3:var(--g4-raised);'
        + '--dsw-alias-bg-mask-1:rgba(15,23,42,.42);--dsw-alias-bg-scrim:rgba(15,23,42,.42);'
        + '--dsw-alias-brand-primary:var(--g4-brand-text);--dsw-alias-state-business-primary:var(--g4-brand-text);'
        + '--dsw-alias-state-success-primary:var(--g4-success);--dsw-alias-state-error-primary:var(--g4-danger);--dsw-alias-state-warn-primary:var(--g4-warning);'
        + '--dsw-alias-interactive-bg-hover:var(--g4-hover);--dsw-alias-interactive-bg-active:var(--g4-selected);'
        + '--dsw-alias-button-primary-fill:var(--g4-brand);--dsw-alias-button-primary-hover:var(--g4-brand-hover);'
        + '--dsw-focus-ring-color:var(--g4-brand);'
        + '--dsw-radius-xs:4px;--dsw-radius-sm:8px;--dsw-radius-md:10px;--dsw-radius-lg:10px;--dsw-radius-panel:12px;'
        + '--dsw-elevation-prominent:var(--g4-shadow);'
        + '--dsw-alias-file-diff-added-bg:var(--g4-diff-add);--dsw-alias-file-diff-added-gutter:var(--g4-diff-add-gutter);--dsw-alias-file-diff-added-marker:var(--g4-success);'
        + '--dsw-alias-file-diff-deleted-bg:var(--g4-diff-del);--dsw-alias-file-diff-deleted-gutter:var(--g4-diff-del-gutter);--dsw-alias-file-diff-deleted-marker:var(--g4-danger);'
        + '--dsw-static-neutral-bluish-00:#fff;--dsw-static-neutral-bluish-75:var(--g4-sunken);--dsw-static-neutral-bluish-800:#2b2d31;--dsw-static-neutral-bluish-850:#2c2c2e;--dsw-static-neutral-bluish-875:#232324;'
        + '}',
      G4_DARK_SCOPE + '{'
        + '--g4-canvas:#0e0f10;--g4-surface:#191a1c;--g4-raised:#26282c;--g4-overlay:#2c2c2e;--g4-header:#212326;--g4-sunken:#141517;'
        + '--g4-hover:rgba(255,255,255,.08);--g4-hover-strong:rgba(255,255,255,.14);--g4-selected:#233558;--g4-selected-hover:#2a3f68;'
        + '--g4-text:#d1d3d9;--g4-text-2:#9fa2a8;--g4-text-3:#9fa2a8;'
        + '--g4-border:#26282c;--g4-border-strong:#40434a;'
        + '--g4-brand:#3871e1;--g4-brand-hover:#4a80ea;--g4-brand-pressed:#2e4d89;--g4-brand-subtle:#233558;--g4-brand-text:#71a1fe;'
        + '--g4-success:#6db083;--g4-success-bg:#203b2a;--g4-danger:#f57e84;--g4-danger-bg:#56272b;--g4-warning:#d59637;--g4-warning-bg:#44321d;'
        + '--g4-info:#71a1fe;--g4-info-bg:#233558;--g4-ai:#a894f6;--g4-ai-bg:#33294d;'
        + '--g4-graph-1:#71a1fe;--g4-graph-2:#6db083;--g4-graph-3:#eea58e;--g4-graph-4:#a894f6;--g4-graph-5:#f57e84;--g4-graph-6:#6aaea6;--g4-graph-7:#d59637;--g4-graph-8:#9fa2a8;'
        + '--g4-diff-add:#203b2a;--g4-diff-add-word:#274b34;--g4-diff-add-gutter:#274b34;--g4-diff-del:#56272b;--g4-diff-del-word:#6d3136;--g4-diff-del-gutter:#6d3136;--g4-diff-mod:#233558;'
        + '--g4-shadow:0 8px 24px rgba(0,0,0,.35),0 1px 3px rgba(0,0,0,.3);'
        + '--dsw-alias-bg-mask-1:rgba(0,0,0,.55);--dsw-alias-bg-scrim:rgba(0,0,0,.55);'
        + '--dsw-static-neutral-bluish-875:#232324;--dsw-static-neutral-bluish-850:#2c2c2e;--dsw-static-neutral-bluish-800:#2b2d31;--dsw-static-neutral-bluish-75:var(--g4-sunken);'
        + '}',
      /* Native control popups (the remote <select> list) take their colours from
         `color-scheme`, not from the tokens above. The browser draws that popup
         outside the panel subtree, so the declaration goes on body: Chrome then
         follows the app theme instead of the OS theme (m00916). The push
         destination list is plugin DOM for the same reason (m00978). */
      'body{color-scheme:light}',
      'body[data-ds-dark-theme]{color-scheme:dark}',
    ].join('\n')
