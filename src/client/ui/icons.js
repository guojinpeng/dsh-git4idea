    /* ===================== shared icon set ===================== */
    /* One line family on a 24x24 grid: 1.75 stroke, round caps, no fills.
       Every panel surface draws from this table, so swapping the visual
       language means editing this file and ui/theme.js only. */
    const G4_ICONS = {
      ai: [{"d":"M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9z"},{"d":"M18.5 16.5v4M16.5 18.5h4"}],
      alert: [{"d":"M12 3.5 21.5 20h-19z"},{"d":"M12 9v5"},{"circle":[12,17.2,1]}],
      arrowLeft: [{"d":"M20 12H4"},{"d":"m10 6-6 6 6 6"}],
      arrowRight: [{"d":"M4 12h16"},{"d":"m14 6 6 6-6 6"}],
      bell: [{"d":"M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"},{"d":"M10 19a2 2 0 0 0 4 0"}],
      branch: [{"circle":[6.5,5,2.2]},{"circle":[6.5,19,2.2]},{"circle":[17.5,7,2.2]},{"d":"M6.5 7.2v9.6"},{"d":"M17.5 9.2c0 4.6-3.4 6.6-7 7.4"}],
      branchCreate: [{"circle":[6.5,5,2.2]},{"circle":[6.5,19,2.2]},{"circle":[17.5,7,2.2]},{"d":"M6.5 7.2v9.6"},{"d":"M17.5 9.2c0 4.6-3.4 6.6-7 7.4"},{"d":"M18 13v6M15 16h6"}],
      branchPlus: [{"circle":[6.5,5,2.2]},{"circle":[6.5,19,2.2]},{"circle":[17.5,7,2.2]},{"d":"M6.5 7.2v9.6"},{"d":"M17.5 9.2c0 4.6-3.4 6.6-7 7.4"},{"d":"M18 13v6M15 16h6"}],
      check: [{"d":"m4.5 12.5 5 5 10-11"}],
      checkout: [{"d":"M4 5.5h9a3 3 0 0 1 3 3V19"},{"d":"m12 13 4 4 4-4"},{"d":"M16 8v9"}],
      chevron: [{"d":"m6 9 6 6 6-6"}],
      chevronDown: [{"d":"m6 9 6 6 6-6"}],
      chevronLeft: [{"d":"m15 6-6 6 6 6"}],
      chevronRight: [{"d":"m9 6 6 6-6 6"}],
      chevronUp: [{"d":"m6 15 6-6 6 6"}],
      clock: [{"circle":[12,12,8.5]},{"d":"M12 7.5V12l3 2"}],
      close: [{"d":"M6 6l12 12M18 6 6 18"}],
      collapse: [{"d":"M4 9h5V4M20 15h-5v5M4 4l6 6M20 20l-6-6"}],
      commit: [{"circle":[12,12,4]},{"d":"M2 12h6M16 12h6"}],
      compare: [{"d":"M7 4 3 8l4 4M3 8h12a4 4 0 0 1 4 4"},{"d":"m17 20 4-4-4-4M21 16H9a4 4 0 0 1-4-4"}],
      copy: [{"d":"M15 9V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H9"}],
      diff: [{"d":"M8 9.5h8M8 15h5"}],
      down: [{"d":"M12 5v14"},{"d":"m6 13 6 6 6-6"}],
      edit: [{"d":"M4 20h4.2L20 8.2 15.8 4 4 15.8z"},{"d":"m13.5 6.5 4 4"}],
      error: [{"circle":[12,12,9]},{"d":"M8.5 8.5l7 7M15.5 8.5l-7 7"}],
      expand: [{"d":"M9 4H4v5M15 20h5v-5M20 4l-6 6M4 20l6-6"}],
      eye: [{"d":"M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"},{"circle":[12,12,2.6]}],
      fetch: [{"d":"M12 3v10"},{"d":"m8 9 4 4 4-4"},{"d":"M4 16v3.5h16V16"}],
      file: [{"d":"M6.5 3.5h7l4 4v13h-11z"},{"d":"M13.5 3.5V8h4"}],
      filter: [{"d":"M3.5 5h17l-6.6 7.6V20l-3.8-2v-5.4z"}],
      float: [{"d":"M14 4h6v6M20 4l-8.5 8.5"},{"d":"M18 14v5.5H4.5V6H10"}],
      folder: [{"d":"M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"}],
      grip: [{"circle":[9,7,1.3]},{"circle":[9,12,1.3]},{"circle":[9,17,1.3]},{"circle":[15,7,1.3]},{"circle":[15,12,1.3]},{"circle":[15,17,1.3]}],
      info: [{"circle":[12,12,9]},{"d":"M12 11v5.5"},{"circle":[12,7.8,1]}],
      layers: [{"d":"m12 3 9 5-9 5-9-5z"},{"d":"m3 12 9 5 9-5M3 16l9 5 9-5"}],
      lock: [{"d":"M6 10.5h12V20H6z"},{"d":"M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5"}],
      merge: [{"circle":[7,5,2.2]},{"circle":[7,19,2.2]},{"circle":[17,12,2.2]},{"d":"M7 7.2v9.6"},{"d":"M9 9.5c4.2 0 3.8 2.5 5.9 2.5"}],
      minus: [{"d":"M5 12h14"}],
      more: [{"circle":[12,5,1.4]},{"circle":[12,12,1.4]},{"circle":[12,19,1.4]}],
      plus: [{"d":"M12 5v14M5 12h14"}],
      pull: [{"d":"M12 3v13"},{"d":"m7 11 5 5 5-5"},{"d":"M4 20h16"}],
      push: [{"d":"M12 16V3"},{"d":"m7 8 5-5 5 5"},{"d":"M4 20h16"}],
      refresh: [{"d":"M20 12a8 8 0 1 1-2.3-5.6"},{"d":"M20 4.5V9h-4.5"}],
      remote: [{"circle":[12,12,9]},{"d":"M3 12h18"},{"d":"M12 3c4 3 4 15 0 18c-4-3-4-15 0-18Z"}],
      repo: [{"d":"M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8A3 3 0 0 1 5 16.5z"},{"d":"M5 16.5A2.5 2.5 0 0 1 7.5 14H19"},{"d":"M9 4.5v7"},{"d":"M12.5 8.5 15 11l2.5-2.5"}],
      search: [{"circle":[10.8,10.8,6.3]},{"d":"m16 16 4.5 4.5"}],
      send: [{"d":"M21 3 3 10.7l7.1 2.6L21 3Z"},{"d":"m10.1 13.3 2.3 7L21 3"}],
      settings: [{"d":"M4 7h10M18 7h2M4 17h2M10 17h10"},{"circle":[16,7,2]},{"circle":[8,17,2]}],
      split: [{"d":"M4 5h16v14H4z"},{"d":"M12 5v14"}],
      star: [{"d":"m12 3.5 2.6 5.4 5.9.9-4.3 4.1 1 5.9L12 17l-5.2 2.8 1-5.9-4.3-4.1 5.9-.9z"}],
      stash: [{"d":"M4 9h16v10.5H4z"},{"d":"M8 4h8"},{"d":"M12 13V6.5"},{"d":"m9.5 11 2.5 2.5L14.5 11"}],
      tag: [{"d":"M20 13.2 13.2 20a2 2 0 0 1-2.8 0L3.5 13.3V4.5h8.8l7.7 7.7a1 1 0 0 1 0 1z"},{"circle":[8,8,1.3]}],
      tagOutline: [{"d":"M20 13.2 13.2 20a2 2 0 0 1-2.8 0L3.5 13.3V4.5h8.8l7.7 7.7a1 1 0 0 1 0 1z"},{"circle":[8,8,1.3]}],
      tags: [{"d":"M20 13.2 13.2 20a2 2 0 0 1-2.8 0L3.5 13.3V4.5h8.8l7.7 7.7a1 1 0 0 1 0 1z"},{"circle":[8,8,1.3]}],
      terminal: [{"d":"m7 9 3 3-3 3M13 15h4"}],
      toolWindow: [{"d":"M9 4v16M12.5 9h5M12.5 12.5h5"}],
      toolwindow: [{"d":"M9 4v16M12.5 9h5M12.5 12.5h5"}],
      trash: [{"d":"M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"},{"d":"M10 11v5.5M14 11v5.5"}],
      tree: [{"d":"M9 4v16M12.5 9h5M12.5 12.5h5"}],
      undo: [{"d":"M8 7 4 11l4 4"},{"d":"M4 11h9a5 5 0 0 1 5 5v1"}],
      up: [{"d":"M12 19V5"},{"d":"m6 11 6-6 6 6"}],
      user: [{"circle":[12,8,3.6]},{"d":"M4.5 20c.7-4 3.7-6 7.5-6s6.8 2 7.5 6"}],
      warning: [{"d":"M12 3.5 21.5 20h-19z"},{"d":"M12 9v5"},{"circle":[12,17.2,1]}],
      wrap: [{"d":"M4 6h16M4 12h11.5a4 4 0 0 1 0 8H13"},{"d":"m15 17-2 3 2 3"},{"d":"M4 18h4"}],
    }

    function Icon(props) {
      const size = props.size === undefined ? 16 : props.size
      const shape = G4_ICONS[props.name] === undefined ? G4_ICONS.commit : G4_ICONS[props.name]
      return E('svg', {
        className: 'git4idea-icon' + (props.className === undefined ? '' : ' ' + props.className),
        width: size, height: size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, shape.map((entry, index) => {
        if (entry.circle !== undefined) {
          const dot = entry.circle[2] <= 1.45
          return E('circle', {
            key: index, cx: entry.circle[0], cy: entry.circle[1], r: entry.circle[2],
            fill: dot ? 'currentColor' : 'none', stroke: dot ? 'none' : 'currentColor',
          })
        }
        return E('path', { key: index, d: entry.d })
      }))
    }