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
            conflictDialog.set(null)
            conflictOverviewDialog.set(null)
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
