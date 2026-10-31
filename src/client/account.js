    /* ============================== account ============================== */

    /* Git identity and sign-in, drawn as the small pill between the repo
       switch and the branch pill. The plugin never stores a credential: the
       host reads git config, and the dialog either asks GCM to run its browser
       flow or passes a pasted token to the helper over stdin. */

    function accountInitial(account) {
      const name = account === null || account === undefined ? '' : String(account.name === undefined ? '' : account.name)
      return name === '' ? '?' : name.slice(0, 1).toUpperCase()
    }

    function accountScopeLabel(t, account) {
      if (account === null || account === undefined || account.scope === 'none') return t('account.scopeNone')
      if (account.scope === 'local') return t('account.scopeLocal')
      if (account.scope === 'global') return t('account.scopeGlobal')
      return t('account.scopeNone')
    }

    function accountGithubHost(value) {
      const raw = String(value === undefined || value === null ? '' : value).trim()
      try {
        const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw).hostname.toLowerCase()
        return host === 'github.com' || host.startsWith('github.') || host.endsWith('.github.com')
      } catch (error) {
        void error
        return false
      }
    }

    function AccountButton(props) {
      const account = props.account
      const name = account === null || account === undefined || account.name === undefined || account.name === ''
        ? props.t('account.none')
        : String(account.name)
      return E('button', {
        type: 'button',
        className: 'git4idea-account-btn',
        'data-tip': account === null || account === undefined ? props.t('account.loading') : name + (account.email === undefined || account.email === '' ? '' : ' · ' + account.email),
        'aria-label': props.t('account.label'),
        onClick: props.onOpen,
      },
        E('span', { className: 'git4idea-account-avatar' }, accountInitial(account)),
        E('span', { className: 'git4idea-account-name' }, name),
        E(Icon, { name: 'chevron', size: 12 }))
    }

    function AccountMenu(props) {
      const account = props.account
      const name = account === null || account === undefined || account.name === undefined || account.name === ''
        ? props.t('account.none')
        : String(account.name)
      const email = account === null || account === undefined || account.email === undefined ? '' : String(account.email)
      return E('div', { className: 'git4idea-account-menu' },
        E('div', { className: 'git4idea-account-identity' },
          E('span', { className: 'git4idea-account-avatar git4idea-account-avatar-lg' }, accountInitial(account)),
          E('div', { className: 'git4idea-account-text' },
            E('div', { className: 'git4idea-account-title', title: name }, name),
            email === '' ? null : E('div', { className: 'git4idea-account-mail', title: email }, email),
            E('div', { className: 'git4idea-account-scope' }, accountScopeLabel(props.t, account)))),
        E('div', { className: 'git4idea-account-sep' }),
        E('button', {
          type: 'button',
          className: 'git4idea-account-action',
          onClick: props.onAuth,
        }, E(Icon, { name: 'lock', size: 15 }), E('span', null, props.t('account.auth'))))
    }

    function AccountAuthDialog(props) {
      const online = props.account !== null && props.account !== undefined && props.account.online === true
      const initialEndpoint = props.account !== null && props.account !== undefined && typeof props.account.endpoint === 'string'
        ? props.account.endpoint
        : 'https://github.com'
      /* GCM's sign-in command serves GitHub and GitHub Enterprise only, so the
         online tab exists only for a GitHub host; every other host defaults to
         the token tab instead of failing inside GCM. */
      const [tab, setTab] = useState(online === true && accountGithubHost(initialEndpoint) ? 'online' : 'token')
      const [endpoint, setEndpoint] = useState(initialEndpoint)
      const [token, setToken] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const inputRef = useRef(null)
      const githubHost = accountGithubHost(endpoint)
      const onlineReady = online === true && githubHost

      useEffect(() => {
        if (tab !== 'token' || inputRef.current === null) return
        inputRef.current.focus()
      }, [tab])

      useEffect(() => {
        /* Only a non-GitHub host removes the online pane. A missing GCM just
           disables its action, so that pane still explains why. */
        if (tab === 'online' && githubHost !== true) setTab('token')
      }, [tab, githubHost])

      /* Closing the dialog while the browser flow runs must not trap the
         panel: the host keeps waiting for GCM (up to its own timeout), so the
         close button stays live. A result that lands after the close still
         updates the account, but it must not close a dialog the user has
         reopened meanwhile. */
      const closedRef = useRef(false)

      const fail = (reason) => {
        if (closedRef.current === true) return
        const text = reason === null || reason === undefined ? '' : String(reason.message === undefined ? reason : reason.message)
        setError(props.t('account.failed') + (text === '' ? '' : ' ' + text))
      }

      const finish = (data) => {
        setBusy(false)
        if (closedRef.current === true) {
          props.onLate(data === null || data === undefined ? null : data)
          return
        }
        props.onDone(data === null || data === undefined ? null : data)
      }

      const close = () => {
        closedRef.current = true
        props.onClose()
      }

      const endpointValue = () => {
        if (endpoint.trim() === '') {
          setError(props.t('account.endpointRequired'))
          return ''
        }
        return endpoint.trim()
      }

      const runWeb = async () => {
        if (busy === true) return
        const host = endpointValue()
        if (host === '') return
        setBusy(true)
        setError('')
        try {
          finish(await props.request('account-web', Object.assign({}, props.base, { endpoint: host })))
        } catch (reason) {
          setBusy(false)
          fail(reason)
        }
      }

      const runToken = async () => {
        if (busy === true) return
        const host = endpointValue()
        if (host === '') return
        if (token.trim() === '') {
          setError(props.t('account.tokenRequired'))
          return
        }
        setBusy(true)
        setError('')
        try {
          finish(await props.request('account-token', Object.assign({}, props.base, { endpoint: host, token: token.trim() })))
        } catch (reason) {
          setBusy(false)
          fail(reason)
        }
      }

      const closeButton = E('button', {
        type: 'button',
        className: 'git4idea-icon-btn git4idea-account-close',
        'aria-label': props.t('account.close'),
        onClick: close,
      }, E(Icon, { name: 'close', size: 16 }))

      const onlinePane = E('div', { className: 'git4idea-account-pane' },
        E('div', { className: 'git4idea-account-globe' }, E(Icon, { name: 'remote', size: 40 })),
        E('p', { className: 'git4idea-account-copy' }, props.t('account.onlineHint')),
        online === true ? null : E('p', { className: 'git4idea-account-note' }, props.t('account.onlineUnavailable')))

      const tokenPane = E('div', { className: 'git4idea-account-pane git4idea-account-pane-token' },
        E('label', { className: 'git4idea-account-field' },
          E('span', { className: 'git4idea-account-label' }, props.t('account.tokenLabel')),
          E('input', {
            ref: inputRef,
            className: 'git4idea-input git4idea-account-input',
            type: 'password',
            spellCheck: false,
            autoComplete: 'off',
            placeholder: props.t('account.tokenPlaceholder'),
            value: token,
            disabled: busy,
            onChange: (event) => setToken(event.currentTarget.value),
            onKeyDown: (event) => { if (event.key === 'Enter') void runToken() },
          })),
        E('p', { className: 'git4idea-account-hint' },
          props.t('account.tokenHint') + ' ',
          githubHost ? E('a', {
            className: 'git4idea-account-link',
            href: 'https://github.com/settings/tokens',
            target: '_blank',
            rel: 'noreferrer',
          }, props.t('account.tokenLink')) : null),
        E('p', { className: 'git4idea-account-hint' }, props.t('account.tokenOnly')))

      const canRun = endpoint.trim() !== '' && (tab === 'token' || onlineReady === true)
      return E('div', { className: 'git4idea-overlay' },
        E('div', { className: 'git4idea-dialog git4idea-account-dialog' },
          E('div', { className: 'git4idea-account-head' },
            E('div', { className: 'git4idea-dialog-title' }, props.t('account.title')),
            closeButton),
          githubHost ? E('div', { className: 'git4idea-seg git4idea-account-tabs' },
            E('button', {
              type: 'button', className: 'git4idea-seg-item', 'data-active': tab === 'online' ? 'true' : 'false',
              disabled: busy, onClick: () => { setTab('online'); setError('') },
            }, props.t('account.online')),
            E('button', {
              type: 'button', className: 'git4idea-seg-item', 'data-active': tab === 'token' ? 'true' : 'false',
              disabled: busy, onClick: () => { setTab('token'); setError('') },
            }, props.t('account.token'))) : null,
          E('label', { className: 'git4idea-account-field git4idea-account-endpoint' },
            E('span', { className: 'git4idea-account-label' }, props.t('account.endpointLabel')),
            E('input', {
              className: 'git4idea-input git4idea-account-input',
              type: 'text',
              spellCheck: false,
              autoComplete: 'off',
              placeholder: props.t('account.endpointPlaceholder'),
              value: endpoint,
              disabled: busy,
              onChange: (event) => setEndpoint(event.currentTarget.value),
            })),
          tab === 'online' ? onlinePane : tokenPane,
          error === '' ? null : E('div', { className: 'git4idea-account-error', role: 'alert' }, error),
          E('div', { className: 'git4idea-account-actions' },
            E('button', { type: 'button', className: 'git4idea-btn', onClick: close }, props.t('account.cancel')),
            E('button', {
              type: 'button',
              className: 'git4idea-btn git4idea-btn-primary git4idea-account-primary',
              disabled: busy || canRun !== true,
              onClick: tab === 'online' ? () => { void runWeb() } : () => { void runToken() },
            }, busy === true ? E('span', { className: 'git4idea-spin' }, E(Icon, { name: 'refresh', size: 13 })) : null,
              E('span', null, tab === 'online' ? props.t('account.login') : props.t('account.useToken'))))))
    }
