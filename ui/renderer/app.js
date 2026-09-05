/* OpenOptions renderer. One state object, full re-render on change, Adwaita-style layout. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const root = $('#root');

  const S = {
    devices: [], presets: null, apps: null, general: {}, conflicts: [], status: {}, connected: false, appInfo: {},
    theme: 'light', mode: 'app', page: 'buttons', dev: null, dir: 'tap', dlg: null, picker: null, menu: null,
    pair: { step: 1, found: [] }, ob: { step: 1, preset: 'gnome' }, appDetail: null, conflictDismissed: false,
    thumbSpeed: 5, history: {}, logs: [], backups: [], ui: {},
  };
  try { S.theme = localStorage.getItem('theme') || 'light'; } catch (e) {}
  const VERSION = '0.3.0';

  // ------------------------------------------------------------------ rpc
  async function call(method, params) {
    try { return await window.agent.call(method, params); }
    catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), true); throw e; }
  }
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.toggle('err', !!err);
    clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function merge(summary) {
    const i = S.devices.findIndex(x => x.id === summary.id);
    if (i >= 0) S.devices[i] = summary; else S.devices.push(summary);
  }
  const dev = () => S.devices.find(d => d.id === S.dev) || null;
  const isMouse = d => d && d.kind !== 'keyboard';
  const isNative = a => !a || a === 'native';
  const profileOf = (d, key) => (((d.config || {}).profiles || {})[key || 'default']) || {};
  const assignment = (d, section, cid, prof) => section === 'thumbwheel' ? profileOf(d, prof).thumbwheel : ((profileOf(d, prof)[section] || {})[String(cid)]);
  const presetLabel = a => {
    if (!a || a === 'native') return 'Default';
    if (typeof a === 'string') return (S.presets && S.presets.all[a] || {}).label || a;
    if (a.type === 'keystroke') return (a.keys || []).map(keyName).join(' + ');
    if (a.type === 'command') return 'Run: ' + (a.cmd || '');
    if (a.type === 'gesture') return a.label || 'Custom gestures';
    if (a.type === 'launch') return 'Launch ' + (a.label || a.app);
    if (a.type === 'type_text') return 'Type: ' + (a.text || '').slice(0, 24);
    if (a.type === 'open') return a.label || 'Open ' + (a.target || '');
    if (a.type === 'scroll') return a.label || (a.axis === 'x' ? 'Horizontal scroll' : 'Vertical scroll');
    if (a.type === 'button') return a.label || a.button.replace('BTN_', '') + ' click';
    if (a.type === 'nothing') return 'Disabled';
    return a.label || a.type;
  };
  const ICON = { native: 'fa-circle-dot', nothing: 'fa-ban', gesture: 'fa-hand-pointer', scroll: 'fa-arrows-left-right', adapter: 'fa-arrows-up-down', keystroke: 'fa-keyboard', button: 'fa-computer-mouse', change_host: 'fa-right-left', dpi_cycle: 'fa-arrow-pointer', command: 'fa-terminal', smartshift_toggle: 'fa-gear', open: 'fa-folder-open', launch: 'fa-rocket', type_text: 'fa-i-cursor' };
  const PRESET_ICON = { overview: 'fa-table-cells-large', show_desktop: 'fa-desktop', app_switcher: 'fa-window-restore', workspace_next: 'fa-arrow-right', workspace_prev: 'fa-arrow-left', tab_next: 'fa-arrow-right-long', tab_prev: 'fa-arrow-left-long',
    copy: 'fa-copy', paste: 'fa-paste', undo: 'fa-rotate-left', redo: 'fa-rotate-right', zoom_in: 'fa-magnifying-glass-plus', zoom_out: 'fa-magnifying-glass-minus', volume_up: 'fa-volume-high', volume_down: 'fa-volume-low', mute: 'fa-volume-xmark',
    mic_mute: 'fa-microphone-slash', play_pause: 'fa-play', next_track: 'fa-forward-step', prev_track: 'fa-backward-step', brightness_up: 'fa-sun', brightness_down: 'fa-sun', screenshot: 'fa-camera', screenshot_area: 'fa-crop-simple', lock: 'fa-lock',
    calculator: 'fa-calculator', emoji: 'fa-face-smile', emoji_picker: 'fa-face-smile', context_menu: 'fa-bars', dictation: 'fa-microphone', terminal: 'fa-terminal', close_window: 'fa-xmark', maximize: 'fa-window-maximize', minimize: 'fa-window-minimize', tile_left: 'fa-table-columns', tile_right: 'fa-table-columns',
    hscroll: 'fa-arrows-left-right', vscroll: 'fa-arrows-up-down', zoom_wheel: 'fa-magnifying-glass-plus', volume_wheel: 'fa-volume-high', tabs_wheel: 'fa-window-restore', workspaces_wheel: 'fa-table-cells-large', brightness_wheel: 'fa-sun',
    easy_switch_1: 'fa-right-left', easy_switch_2: 'fa-right-left', easy_switch_3: 'fa-right-left', dpi_cycle: 'fa-arrow-pointer', smartshift_toggle: 'fa-gear', open_home: 'fa-folder-open', middle_click: 'fa-computer-mouse', back: 'fa-arrow-left', forward: 'fa-arrow-right', native: 'fa-circle-dot', nothing: 'fa-ban',
    gesture_navigation: 'fa-hand-pointer', gesture_windows: 'fa-hand-pointer', gesture_volume: 'fa-hand-pointer', gesture_pan: 'fa-hand-pointer' };
  const actionIcon = a => typeof a === 'string' ? (PRESET_ICON[a] || ICON[(S.presets && S.presets.all[a] || {}).type] || 'fa-circle-dot') : ICON[(a || {}).type] || 'fa-circle-dot';
  const keyName = k => k.replace(/^KEY_/, '').replace(/^LEFT(CTRL|SHIFT|ALT|META)$/, '$1').replace(/^RIGHT(CTRL|SHIFT|ALT|META)$/, '$1').replace('META', 'Super').replace('CTRL', 'Ctrl').replace('SHIFT', 'Shift').replace('ALT', 'Alt').replace(/^([A-Z])$/, '$1').replace(/^([A-Z][A-Z]+)$/, m => m.charAt(0) + m.slice(1).toLowerCase());
  const batIcon = b => !b ? 'fa-battery-empty' : b.percent > 80 ? 'fa-battery-full' : b.percent > 55 ? 'fa-battery-three-quarters' : b.percent > 30 ? 'fa-battery-half' : b.percent > 10 ? 'fa-battery-quarter' : 'fa-battery-empty';
  const batClass = b => !b ? '' : b.charging ? 'ok' : b.percent <= 10 ? 'err' : b.percent <= 20 ? 'warn' : 'ok';
  const CID = { middle: 82, back: 83, forward: 86, gesture: 195, mode: 196 };

  // ------------------------------------------------------------ recorder
  const CODE_MAP = { ControlLeft: 'KEY_LEFTCTRL', ControlRight: 'KEY_RIGHTCTRL', ShiftLeft: 'KEY_LEFTSHIFT', ShiftRight: 'KEY_RIGHTSHIFT',
    AltLeft: 'KEY_LEFTALT', AltRight: 'KEY_RIGHTALT', MetaLeft: 'KEY_LEFTMETA', MetaRight: 'KEY_RIGHTMETA', OSLeft: 'KEY_LEFTMETA', OSRight: 'KEY_RIGHTMETA',
    Space: 'KEY_SPACE', Enter: 'KEY_ENTER', Tab: 'KEY_TAB', Backspace: 'KEY_BACKSPACE', Delete: 'KEY_DELETE', Insert: 'KEY_INSERT',
    Home: 'KEY_HOME', End: 'KEY_END', PageUp: 'KEY_PAGEUP', PageDown: 'KEY_PAGEDOWN', ArrowUp: 'KEY_UP', ArrowDown: 'KEY_DOWN', ArrowLeft: 'KEY_LEFT', ArrowRight: 'KEY_RIGHT',
    Minus: 'KEY_MINUS', Equal: 'KEY_EQUAL', BracketLeft: 'KEY_LEFTBRACE', BracketRight: 'KEY_RIGHTBRACE', Backslash: 'KEY_BACKSLASH', Semicolon: 'KEY_SEMICOLON',
    Quote: 'KEY_APOSTROPHE', Backquote: 'KEY_GRAVE', Comma: 'KEY_COMMA', Period: 'KEY_DOT', Slash: 'KEY_SLASH', CapsLock: 'KEY_CAPSLOCK', PrintScreen: 'KEY_SYSRQ',
    ScrollLock: 'KEY_SCROLLLOCK', Pause: 'KEY_PAUSE', ContextMenu: 'KEY_COMPOSE', NumLock: 'KEY_NUMLOCK', NumpadAdd: 'KEY_KPPLUS', NumpadSubtract: 'KEY_KPMINUS',
    NumpadMultiply: 'KEY_KPASTERISK', NumpadDivide: 'KEY_KPSLASH', NumpadEnter: 'KEY_KPENTER', NumpadDecimal: 'KEY_KPDOT', AudioVolumeUp: 'KEY_VOLUMEUP',
    AudioVolumeDown: 'KEY_VOLUMEDOWN', AudioVolumeMute: 'KEY_MUTE', MediaPlayPause: 'KEY_PLAYPAUSE', MediaTrackNext: 'KEY_NEXTSONG', MediaTrackPrevious: 'KEY_PREVIOUSSONG', IntlBackslash: 'KEY_102ND' };
  const MODS = new Set(['KEY_LEFTCTRL', 'KEY_RIGHTCTRL', 'KEY_LEFTSHIFT', 'KEY_RIGHTSHIFT', 'KEY_LEFTALT', 'KEY_RIGHTALT', 'KEY_LEFTMETA', 'KEY_RIGHTMETA']);
  function codeToKey(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return 'KEY_' + m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return 'KEY_' + m[1];
    if ((m = /^F(\d{1,2})$/.exec(code))) return 'KEY_F' + m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return 'KEY_KP' + m[1];
    return CODE_MAP[code] || null;
  }
  let recorder = null;
  function startRecorder(onUpdate, onDone) {
    stopRecorder();
    const st = { mods: [], key: null, down: new Set() };
    const chord = () => [...st.mods, ...(st.key ? [st.key] : [])];
    const onDown = e => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { stopRecorder(); onUpdate([], true); return; }
      const k = codeToKey(e.code); if (!k || e.repeat) return;
      st.down.add(k);
      if (MODS.has(k)) { if (!st.mods.includes(k)) st.mods.push(k); } else st.key = k;
      onUpdate(chord(), false);
    };
    const onUp = e => {
      e.preventDefault(); e.stopPropagation();
      const k = codeToKey(e.code); if (k) st.down.delete(k);
      if (st.key || st.down.size === 0) { const keys = chord(); stopRecorder(); if (keys.length) onDone(keys); }
    };
    recorder = { onDown, onUp };
    document.addEventListener('keydown', onDown, true);
    document.addEventListener('keyup', onUp, true);
  }
  function stopRecorder() {
    if (!recorder) return;
    document.removeEventListener('keydown', recorder.onDown, true);
    document.removeEventListener('keyup', recorder.onUp, true);
    recorder = null;
  }

  // ------------------------------------------------------------ helpers
  const sw = (on, attrs = '') => `<button class="switch ${on ? 'on' : ''}" ${attrs}></button>`;
  const sec = (title, body, meta = '') => `<div class="sec"><div class="sec-title"><span>${esc(title)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</div>${body}</div>`;
  const card = rows => `<div class="card">${rows}</div>`;
  const row = (label, sub, right, cls = '') => `<div class="row ${cls}"><div class="grow"><div class="lbl">${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>`;
  const drop = (a, attrs = '') => `<button class="drop" ${attrs}><i class="fa-solid ic ${actionIcon(a)}"></i>${esc(presetLabel(a))}<i class="fa-solid fa-chevron-down chev"></i></button>`;
  const range = (attrs, val, min, max, step) => `<input type="range" ${attrs} min="${min}" max="${max}" step="${step}" value="${val}" style="width:160px">`;
  const setSetting = async (d, path, value) => { const st = await call('set_setting', { id: d.id, path, value }); d.state = st; let x = d.config.settings || (d.config.settings = {}); for (const p of path.slice(0, -1)) { x[p] = x[p] || {}; x = x[p]; } x[path[path.length - 1]] = value; };
  const setGeneral = async patch => { try { S.general = await call('set_general', patch); } catch (e) { Object.assign(S.general, patch); } window.agent.generalChanged(); };
  const setAssign = async (d, section, control, action, profile) => { merge(await call('set_assignment', { id: d.id, profile: profile || 'default', section, control: section === 'thumbwheel' ? '' : String(control), action })); };

  // ------------------------------------------------------------- nav
  const PAGES = {
    buttons: ['Buttons', 'fa-computer-mouse'], gestures: ['Gestures', 'fa-hand-pointer'], pointer: ['Point & scroll', 'fa-arrow-pointer'], thumb: ['Thumb wheel', 'fa-arrows-left-right'],
    easy: ['Easy-Switch', 'fa-right-left'], info: ['Battery & info', 'fa-battery-three-quarters'], keys: ['Keys', 'fa-keyboard'], backlight: ['Backlight', 'fa-sun'],
    apps: ['Applications', 'fa-window-restore'], notif: ['Notifications', 'fa-bell'], backup: ['Backup & sync', 'fa-cloud-arrow-down'], settings: ['Settings', 'fa-sliders'], about: ['About', 'fa-circle-info'],
  };
  const devicePages = d => isMouse(d) ? ['buttons', 'gestures', 'pointer', 'thumb', 'easy', 'info'] : ['keys', 'backlight', 'easy', 'info'];
  const generalPages = ['apps', 'notif', 'backup', 'settings', 'about'];
  function go(page, devId) { S.page = page; if (devId !== undefined) S.dev = devId; S.dlg = null; S.menu = null; S.appDetail = null; render(); }

  // ============================================================ render
  function render() {
    stopRecorder();
    document.documentElement.setAttribute('data-theme', S.theme);
    let html = '';
    if (S.mode === 'onboard') html = renderOnboard();
    else if (!S.devices.length) html = renderEmpty();
    else html = renderWindow();
    html += renderDialog();
    root.innerHTML = html;
    bind();
  }

  function renderWindow() {
    const d = dev();
    const title = S.appDetail ? (S.appDetail.name || 'Application') : (PAGES[S.page] ? PAGES[S.page][0] : 'OpenOptions');
    let nav = '';
    for (const x of S.devices) {
      const b = x.battery;
      nav += `<div class="nav-head"><span>${esc(x.name)}</span><span>${b ? b.percent + '% · ' : ''}${x.transport === 'bolt' ? 'Bolt' : 'Bluetooth'}</span></div>`;
      for (const p of devicePages(x)) nav += `<button class="nav-item ${S.page === p && S.dev === x.id && !S.appDetail ? 'active' : ''}" data-page="${p}" data-dev="${x.id}"><i class="fa-solid ${PAGES[p][1]}"></i>${PAGES[p][0]}</button>`;
    }
    nav += `<div class="nav-head"><span>General</span><span></span></div>`;
    for (const p of generalPages) nav += `<button class="nav-item ${S.page === p ? 'active' : ''}" data-page="${p}"><i class="fa-solid ${PAGES[p][1]}"></i>${PAGES[p][0]}</button>`;
    const b = d && d.battery;
    const conflict = !S.conflictDismissed && S.conflicts.length && ['buttons', 'gestures', 'keys'].includes(S.page);
    const cname = conflict ? S.conflicts[0].name : '';
    return `<div class="window">
      <aside class="side">
        <div class="brand"><span class="mark"><i class="fa-solid fa-computer-mouse"></i></span>OpenOptions</div>
        <nav class="nav">${nav}</nav>
        <div class="side-foot ${S.connected ? '' : 'off'}"><i class="fa-solid fa-circle"></i>${S.connected ? 'Agent connected' : 'Agent not running'} · v${S.status.version || VERSION}</div>
      </aside>
      <main class="main">
        <header class="hb">
          ${S.appDetail ? `<div class="left"><button class="hbtn icon" data-act="back-apps" title="Back"><i class="fa-solid fa-arrow-left"></i></button></div>` : ''}
          <span class="title">${esc(title)}</span>
          <div class="right">
            ${d && b ? `<button class="hbtn" data-act="goinfo" title="Battery"><i class="fa-solid ${batIcon(b)} ${batClass(b)}"></i>${b.percent}%${b.charging ? ' ⚡' : ''}</button>` : ''}
            <div style="position:relative"><button class="hbtn icon" data-act="menu-theme" title="Theme"><i class="fa-solid ${S.theme.includes('dark') ? 'fa-moon' : 'fa-sun'}"></i></button>${S.menu === 'theme' ? themeMenu() : ''}</div>
            <div style="position:relative"><button class="hbtn icon" data-act="menu-main"><i class="fa-solid fa-ellipsis-vertical"></i></button>${S.menu === 'main' ? mainMenu() : ''}</div>
            <button class="hbtn close" data-act="win-close" title="Close to tray"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </header>
        ${conflict ? `<div class="banner"><i class="fa-solid fa-triangle-exclamation"></i><span><strong>${esc(cname === 'logid' ? 'logid' : 'Solaar')} is running.</strong> Both programs divert the same buttons; only one will win.</span><button class="bact" data-act="stop-tool" data-tool="${esc(cname)}">Stop ${esc(cname === 'logid' ? 'logid' : 'Solaar')}</button><button class="x" data-act="dismiss-conflict"><i class="fa-solid fa-xmark"></i></button></div>` : ''}
        <div class="content"><div class="page">${renderPage(d)}</div></div>
      </main></div>`;
  }
  const THEMES = [['light', 'Light', 'linear-gradient(135deg,#fff 50%,#3584e4 50%)'], ['dark', 'Dark', 'linear-gradient(135deg,#222 50%,#3584e4 50%)'], ['ubuntu', 'Ubuntu', 'linear-gradient(135deg,#fafafa 50%,#e95420 50%)'], ['ubuntu-dark', 'Ubuntu dark', 'linear-gradient(135deg,#2c2c2c 50%,#e95420 50%)']];
  const themeMenu = () => `<div class="menu" data-menu><div class="mhead">Appearance</div>${THEMES.map(([k, l, s]) => `<button data-act="theme" data-key="${k}"><span class="swatch" style="background:${s}"></span><span>${l}</span>${S.theme === k ? '<i class="fa-solid fa-check chk"></i>' : ''}</button>`).join('')}</div>`;
  const mainMenu = () => `<div class="menu" data-menu>
    <button data-act="export"><i class="fa-solid fa-download"></i>Export settings…</button>
    <button data-act="import"><i class="fa-solid fa-upload"></i>Import settings…</button>
    <button data-act="pair"><i class="fa-solid fa-plus"></i>Pair a device…</button>
    <button data-act="pause"><i class="fa-solid ${S.status.paused ? 'fa-play' : 'fa-pause'}"></i>${S.status.paused ? 'Resume diversion' : 'Pause diversion'}</button>
    <div class="sep"></div>
    <button data-act="page" data-page="settings"><i class="fa-solid fa-sliders"></i>Settings</button>
    <button data-act="page" data-page="about"><i class="fa-solid fa-circle-info"></i>About OpenOptions</button>
    <div class="sep"></div>
    <button data-act="quit"><i class="fa-solid fa-power-off"></i>Quit</button></div>`;

  function renderPage(d) {
    if (S.appDetail) return pageAppDetail(S.appDetail);
    switch (S.page) {
      case 'buttons': return d ? pageButtons(d) : '';
      case 'gestures': return d ? pageGestures(d) : '';
      case 'pointer': return d ? pagePointer(d) : '';
      case 'thumb': return d ? pageThumb(d) : '';
      case 'easy': return d ? pageEasy(d) : '';
      case 'info': return d ? pageInfo(d) : '';
      case 'keys': return d ? pageKeys(d) : '';
      case 'backlight': return d ? pageBacklight(d) : '';
      case 'apps': return pageApps();
      case 'notif': return pageNotif();
      case 'backup': return pageBackup();
      case 'settings': return pageSettings();
      case 'about': return pageAbout();
    }
    return '';
  }

  // ----------------------------------------------------------- photos
  const MOUSE_PHOTO = { src: '../assets/devices/mx-master-3s.png', w: 1021, h: 1517, spots: [[82, 636, 296, 1], [196, 636, 586, 5], [86, 279, 608, 3], ['thumb', 292, 721, 6], [83, 310, 901, 2], [195, 82, 880, 4]] };
  function mousePhoto(d) {
    const P = MOUSE_PHOTO;
    const spots = P.spots.map(([k, x, y, n]) => `<g class="hotspot" data-section="${k === 'thumb' ? 'thumbwheel' : 'buttons'}" data-cid="${k}"><circle class="ring" cx="${x}" cy="${y}" r="40"/><circle class="core" cx="${x}" cy="${y}" r="26"/><text class="n" x="${x}" y="${y + 11}" text-anchor="middle">${n}</text></g>`).join('');
    return `<svg viewBox="0 0 ${P.w} ${P.h}"><image href="${P.src}" width="${P.w}" height="${P.h}"/>${spots}</svg>`;
  }
  const KEYBOARD_PHOTO = { src: '../assets/devices/mx-keys-s.png', w: 2172, h: 670, y: 139, kw: 84, kh: 62,
    keys: [[199, 306], [200, 395], [226, 484], [227, 573], [259, 661], [264, 750], [266, 839], [284, 928], [228, 1017], [229, 1106], [230, 1195], [231, 1283], [232, 1372], [10, 1754], [266, 1842], [234, 1931], [111, 2020]] };
  function keyboardPhoto(d) {
    const P = KEYBOARD_PHOTO;
    const hot = P.keys.map(([cid, x]) => { const a = assignment(d, 'keys', cid); const ctl = d.controls.find(c => c.cid === cid); return `<g class="hotspot key-photo ${isNative(a) ? '' : 'assigned'}" data-section="keys" data-cid="${cid}"><title>${esc(ctl ? ctl.label : cid)}: ${esc(presetLabel(a))}</title><rect x="${x - P.kw / 2}" y="${P.y - P.kh / 2}" width="${P.kw}" height="${P.kh}" rx="12"/>${isNative(a) ? '' : `<circle cx="${x + P.kw / 2 - 10}" cy="${P.y - P.kh / 2 + 10}" r="6"/>`}</g>`; }).join('');
    return `<svg viewBox="0 0 ${P.w} ${P.h}"><image href="${P.src}" width="${P.w}" height="${P.h}"/>${hot}</svg>`;
  }

  // ----------------------------------------------------------- pages
  const PHYS = [[82, 'Middle button'], [83, 'Back'], [86, 'Forward'], [195, 'Gesture button'], [196, 'Mode shift']];
  function pageButtons(d) {
    const rows = PHYS.filter(([cid]) => d.controls.some(c => c.cid === cid)).map(([cid, label], i) => {
      const a = assignment(d, 'buttons', cid);
      return `<div class="row"><span class="num">${i + 1}</span><span class="grow lbl">${label}</span>${drop(a, `data-act="pick" data-section="buttons" data-cid="${cid}" data-label="${esc(label)}"`)}</div>`;
    }).join('');
    const tw = assignment(d, 'thumbwheel');
    const twRow = d.controls.length ? `<div class="row"><span class="num">6</span><span class="grow lbl">Thumb wheel</span>${drop(tw, `data-act="pick" data-section="thumbwheel" data-cid="thumb" data-label="Thumb wheel"`)}</div>` : '';
    return `<div class="photo-col"><div class="photo-card">${mousePhoto(d)}</div>
      ${sec('Buttons', card(rows + twRow) + `<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-act="reset-buttons"><i class="fa-solid fa-rotate-left"></i>Restore defaults</button></div><div class="hint">Left and right click cannot be reassigned. Overrides for the focused app are set in <a href="#" data-act="page" data-page="apps">Applications</a>.</div>`)}</div>`;
  }

  const SLOTS = { tap: ['Tap', 'click'], up: ['Swipe up', 'up'], down: ['Swipe down', 'down'], left: ['Swipe left', 'left'], right: ['Swipe right', 'right'] };
  const gestureCapable = d => d.controls.filter(c => c.divertable && c.raw_xy && c.cid !== 0xD7);
  function gestureControl(d) {
    for (const c of gestureCapable(d)) { const a = assignment(d, 'buttons', c.cid); const r = typeof a === 'string' ? (S.presets.all[a] || {}) : (a || {}); if (r.type === 'gesture') return c.cid; }
    return 195;
  }
  function gestureObject(d, cid) {
    const a = assignment(d, 'buttons', cid);
    const src = typeof a === 'string' ? S.presets.all[a] : a;
    if (src && src.type === 'gesture') return JSON.parse(JSON.stringify(src));
    const o = JSON.parse(JSON.stringify(S.presets.all.gesture_navigation)); o.label = 'Custom gestures'; return o;
  }
  function pageGestures(d) {
    const cid = gestureControl(d), g = gestureObject(d, cid), slot = SLOTS[S.dir][1];
    const a = assignment(d, 'buttons', cid); const active = (typeof a === 'string' ? (S.presets.all[a] || {}) : (a || {})).type === 'gesture';
    const sens = Math.max(1, Math.min(10, Math.round((165 - (g.threshold ?? 60)) / 15)));
    const cell = (k, txt, cls = '') => `<button class="${cls} ${S.dir === k ? 'on' : ''}" data-act="dir" data-key="${k}">${txt}</button>`;
    const grid = `<div class="gest-grid"><div></div>${cell('up', '↑')}<div></div>${cell('left', '←')}${cell('tap', 'Tap', 'tap')}${cell('right', '→')}<div></div>${cell('down', '↓')}<div></div></div>`;
    const presetsRow = ['gesture_navigation', 'gesture_windows', 'gesture_volume', 'gesture_pan'].map(k => `<button class="pill ${g.label === S.presets.all[k].label ? 'on' : ''}" data-act="gesture-preset" data-key="${k}">${esc(S.presets.all[k].label.replace('Gestures: ', ''))}</button>`).join('');
    return `<div class="photo-col" style="grid-template-columns:240px 1fr">${grid}
      <div style="display:flex;flex-direction:column;gap:22px">
        ${sec(SLOTS[S.dir][0], card(
          `<div class="row"><span class="grow lbl">Action</span>${drop(g[slot] && g[slot].preset ? g[slot].preset : (g[slot] || { type: 'nothing' }), `data-act="pick-gesture" data-slot="${slot}"`)}</div>` +
          `<div class="row"><span class="grow lbl">Mode</span><span class="seg"><button class="${g.continuous ? '' : 'on'}" data-act="gest-mode" data-key="once">One-shot</button><button class="${g.continuous ? 'on' : ''}" data-act="gest-mode" data-key="continuous">Continuous</button></span></div>`))}
        ${sec('Gesture button', card(
          `<div class="row"><span class="grow lbl">Enabled</span>${sw(active, 'data-act="gest-enable"')}</div>` +
          `<div class="row"><span class="grow lbl">Button</span><select class="sel" data-act="gest-button">${gestureCapable(d).map(c => `<option value="${c.cid}" ${c.cid === cid ? 'selected' : ''}>${esc(c.label)}${c.cid === 195 ? ' (thumb)' : ''}</option>`).join('')}</select></div>` +
          `<div class="row"><span class="grow lbl">Sensitivity</span>${range('data-act="gest-sens"', sens, 1, 10, 1)}<span class="val" style="width:24px;text-align:right">${sens}</span></div>` +
          (g.continuous ? `<div class="row"><span class="grow lbl">Repeat distance</span>${range('data-act="gest-step"', g.step ?? 40, 5, 120, 5)}<span class="val" style="width:24px;text-align:right">${g.step ?? 40}</span></div>` : '')))}
        ${sec('Presets', `<div class="chips">${presetsRow}</div>`)}
      </div></div>`;
  }

  function pagePointer(d) {
    const st = d.state || {}, s = d.config.settings || {};
    const dpi = s.dpi ?? (st.dpi ? st.dpi.dpi : 1000);
    const [min, max, step] = st.dpi && st.dpi.stepped ? st.dpi.levels : [200, 8000, 50];
    const speed = Math.round(((s.pointer_speed ?? 0) + 1) * 50);
    const ss = s.smartshift || {}, hr = s.hires || {};
    const ssOn = (ss.mode || (st.smartshift || {}).mode || 'ratchet') === 'ratchet';
    return sec('Pointer', card(
      `<div class="row" style="flex-direction:column;align-items:stretch;gap:8px"><div style="display:flex;justify-content:space-between"><span class="lbl">DPI</span><span class="val" data-out="dpi">${dpi}</span></div>${range('data-act="dpi" data-out="dpi" style="width:100%"', dpi, min, max, step)}<div style="display:flex;justify-content:space-between" class="hint"><span>${min}</span><span>${max}</span></div></div>` +
      `<div class="row"><span class="grow lbl">Desktop pointer speed</span>${range('data-act="pspeed" data-out="pspeed"', speed, 0, 100, 5)}<span class="val" data-out="pspeed" style="width:32px;text-align:right">${speed}</span></div>`)) +
      sec('Scroll wheel', card(
        row('SmartShift', 'Switch from ratchet to free-spin when the wheel is flicked', sw(ssOn, 'data-act="setting" data-path="smartshift.mode" data-on="ratchet" data-off="freespin"')) +
        `<div class="row"><span class="grow lbl">SmartShift sensitivity</span>${range('data-act="setting-range" data-path="smartshift.threshold" data-out="sst"', ss.threshold ?? (st.smartshift || {}).threshold ?? 14, 1, 50, 1)}<span class="val" data-out="sst" style="width:24px;text-align:right">${ss.threshold ?? (st.smartshift || {}).threshold ?? 14}</span></div>` +
        row('Smooth scrolling', 'High-resolution wheel events', sw(hr.enabled ?? (st.hires || {}).hires ?? true, 'data-act="setting" data-path="hires.enabled"')) +
        row('Natural scroll direction', '', sw(hr.invert ?? (st.hires || {}).invert ?? false, 'data-act="setting" data-path="hires.invert"'))));
  }

  const WHEEL_ACTIONS = [['hscroll', 'Horizontal scroll'], ['vscroll', 'Vertical scroll'], ['zoom_wheel', 'Zoom'], ['volume_wheel', 'Volume'], ['tabs_wheel', 'Switch tabs'], ['workspaces_wheel', 'Workspaces'], ['brightness_wheel', 'Brightness']];
  function pageThumb(d) {
    const tw = assignment(d, 'thumbwheel'); const inv = !!((d.config.settings || {}).thumbwheel || {}).invert;
    const gain = typeof tw === 'object' && tw && tw.gain ? tw.gain : 8;
    const speed = Math.max(1, Math.min(10, Math.round(gain / 1.6)));
    return sec('Thumb wheel', card(
      `<div class="row"><span class="grow lbl">Action</span>${drop(tw, `data-act="pick" data-section="thumbwheel" data-cid="thumb" data-label="Thumb wheel"`)}</div>` +
      row('Invert direction', '', sw(inv, 'data-act="setting" data-path="thumbwheel.invert"')) +
      `<div class="row"><span class="grow lbl">Speed</span>${range('data-act="thumb-speed" data-out="tws"', speed, 1, 10, 1)}<span class="val" data-out="tws" style="width:24px;text-align:right">${speed}</span></div>`)) +
      sec('Available actions', card(WHEEL_ACTIONS.map(([k, l]) => `<div class="row click" data-act="assign-thumb" data-key="${k}"><i class="fa-solid ${PRESET_ICON[k]}" style="width:20px;text-align:center;color:${(typeof tw === 'string' ? tw : (tw && tw.preset)) === k ? 'var(--acc)' : 'var(--dim)'}"></i><span class="grow lbl" style="${(typeof tw === 'string' ? tw : (tw && tw.preset)) === k ? 'color:var(--acc)' : ''}">${l}</span>${(typeof tw === 'string' ? tw : (tw && tw.preset)) === k ? '<i class="fa-solid fa-check" style="color:var(--acc)"></i>' : ''}</div>`).join('')));
  }

  function pageEasy(d) {
    const h = (d.state || {}).hosts;
    if (!h) return sec('Easy-Switch', card(row('Not supported by this device', '', '')));
    const cards = [0, 1, 2].map(i => {
      const n = h.names[i] || { index: i, paired: false, name: '', bus_type: 0 };
      const cur = h.current === i, empty = !n.paired;
      const bus = n.bus_type === 1 ? ['fa-usb', 'Bolt receiver'] : n.bus_type === 2 || n.bus_type === 3 ? ['fa-bluetooth-b', 'Bluetooth'] : empty ? ['fa-link-slash', 'Not paired'] : ['fa-usb', 'Receiver'];
      return `<div class="host ${cur ? 'cur' : ''}"><div class="top"><span class="n">${i + 1}</span><span class="st">${cur ? 'Connected' : empty ? '' : 'Paired'}</span></div>
        <div class="name">${esc(n.name || (empty ? 'Empty slot' : 'Unnamed host'))}</div>
        <div class="conn"><i class="fa-${bus[0] === 'fa-bluetooth-b' || bus[0] === 'fa-usb' ? 'brands' : 'solid'} ${bus[0]}"></i>${bus[1]}</div>
        <div class="hacts">${cur ? '<button class="btn sm flat" disabled>Current</button>' : empty ? '<button class="btn sm" data-act="pair">Pair…</button>' : `<button class="btn sm primary" data-act="host" data-key="${i}">Switch</button>`}${empty ? '' : `<button class="btn sm" data-act="rename-host" data-key="${i}" title="Rename"><i class="fa-solid fa-pen"></i></button>`}</div></div>`;
    }).join('');
    return sec(`Hosts · ${esc(d.name)}`, `<div class="hosts">${cards}</div>`) +
      card(row('Linked switching', `Move all devices to the same host together`, sw(!!S.general.linked_easy_switch, 'data-act="general" data-key="linked_easy_switch"')) +
        row('Keyboard shortcut', 'Switch host from the tray or with a shortcut', `<span class="val">Super + Alt + 1…3</span>`));
  }

  function pageInfo(d) {
    const b = d.battery || { percent: 0 }; const hist = S.history[d.id] || [];
    const bars = (hist.length ? hist : [b.percent]).slice(-14);
    const rows = [['Model', d.name], ['Connection', `${d.transport === 'bolt' ? 'Bolt receiver' : 'Bluetooth'} · host ${((d.state || {}).hosts || {}).current + 1 || 1}`], ['Firmware', d.firmware || 'n/a'], ['Serial', d.serial || 'n/a'], ['Protocol', 'HID++ 2.0'], ['Wireless PID', d.id.toUpperCase()]];
    const est = b.charging ? 'Charging over USB-C' : b.level ? `Level: ${b.level}` : '';
    const thr = S.general.notify_low_threshold ?? 20;
    return `<div class="grid2">
      <div class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="sec-title"><span>Battery</span><span class="meta" style="color:var(--ok)">${b.charging ? 'Charging' : 'Discharging'}</span></div><div class="big">${b.percent}%</div><div class="meter ${b.percent <= 10 ? 'crit' : b.percent <= 20 ? 'low' : ''}"><i style="width:${b.percent}%"></i></div><div class="hint">${esc(est)}</div></div>
      <div class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="sec-title"><span>Last 7 days</span></div><div class="hist">${bars.map(v => `<span style="height:${v}%" title="${v}%"></span>`).join('')}</div><div style="display:flex;justify-content:space-between" class="hint"><span>${hist.length > 1 ? 'Earlier' : ''}</span><span>Today</span></div></div></div>` +
      sec('Device', card(rows.map(([k, v]) => `<div class="row"><span class="grow lbl">${k}</span><span class="val">${esc(v)}</span></div>`).join(''))) +
      sec('Alerts', card(`<div class="row"><div class="grow"><div class="lbl">Low battery warning</div><div class="sub">Notify at</div></div>${range('data-act="general-range" data-key="notify_low_threshold" data-out="thr"', thr, 5, 50, 5)}<span class="val" data-out="thr" style="width:32px;text-align:right">${thr}%</span></div>` +
        row('Firmware update', 'Check with fwupd / LVFS', `<button class="btn sm" data-act="fwupd">Check…</button>`)));
  }

  const FKEYS = [[199, 'F1', 'fa-sun'], [200, 'F2', 'fa-sun'], [226, 'F3', 'fa-lightbulb'], [227, 'F4', 'fa-lightbulb'], [259, 'F5', 'fa-microphone'], [264, 'F6', 'fa-face-smile'], [266, 'F7', 'fa-camera'], [284, 'F8', 'fa-microphone-slash'], [228, 'F9', 'fa-backward-step'], [229, 'F10', 'fa-play'], [230, 'F11', 'fa-forward-step'], [231, 'F12', 'fa-volume-xmark'], [232, 'Vol−', 'fa-volume-low'], [233, 'Vol+', 'fa-volume-high']];
  const SKEYS = [[10, 'fa-calculator', 'Calculator'], [266, 'fa-camera', 'Capture'], [234, 'fa-bars', 'Menu'], [111, 'fa-lock', 'Lock'], [259, 'fa-microphone', 'Dictation'], [264, 'fa-face-smile', 'Emoji'], [284, 'fa-microphone-slash', 'Mic mute']];
  function pageKeys(d) {
    const SHORT = { 'Brightness down': 'Bright −', 'Brightness up': 'Bright +', 'Backlight down': 'Light −', 'Backlight up': 'Light +', 'Previous track': 'Previous', 'Play / Pause': 'Play', 'Next track': 'Next', 'Volume down': 'Vol −', 'Volume up': 'Vol +', 'Mute microphone': 'Mic mute', 'Screen capture': 'Capture', 'Screenshot area': 'Capture', 'Screenshot': 'Capture', 'Emoji picker': 'Emoji', 'Emoji (desktop shortcut)': 'Emoji', 'Do nothing': 'Off', 'Open terminal': 'Terminal', 'Context menu': 'Menu', 'Lock screen': 'Lock', 'Mute microphone ': 'Mic mute', 'Dictation (needs a tool)': 'Dictation', 'Show desktop': 'Desktop', 'App switcher': 'Apps', 'Close window': 'Close', 'Maximize window': 'Maximize', 'Minimize window': 'Minimize', 'Zoom in': 'Zoom +', 'Zoom out': 'Zoom −' };
    const shortLabel = t => SHORT[t] || (t.length > 11 ? t.replace(/\s*\(.*\)$/, '').split(' ').slice(0, 2).join(' ') : t);
    const fk = FKEYS.map(([cid, k, icon]) => { const a = assignment(d, 'keys', cid); const ctl = d.controls.find(c => c.cid === cid); const full = isNative(a) ? (ctl ? ctl.label : '') : presetLabel(a); return `<button class="fkey ${isNative(a) ? '' : 'assigned'}" data-act="pick" data-section="keys" data-cid="${cid}" data-label="${esc(ctl ? ctl.label : k)}" title="${esc(full)}"><span class="k">${k}</span><i class="fa-solid ${icon}"></i><span class="a">${esc(shortLabel(full))}</span></button>`; }).join('');
    const sk = SKEYS.map(([cid, icon, label]) => { const a = assignment(d, 'keys', cid); return `<div class="row"><span class="keycap"><i class="fa-solid ${icon}"></i></span><span class="grow lbl">${label}</span>${drop(a, `data-act="pick" data-section="keys" data-cid="${cid}" data-label="${label}"`)}</div>`; }).join('');
    const fn = (d.state || {}).fn_swap;
    return `<div class="kb-photo">${keyboardPhoto(d)}</div>` +
      sec('Function row', `<div class="fkeys">${fk}</div>` + card(row('Use F1–F12 as standard function keys', fn === undefined ? 'Not reported by this keyboard' : fn ? 'Off: the keys send their printed functions, hold Fn for F1–F12' : 'On: the keys send F1–F12, hold Fn for the printed functions (or press Fn+Esc)', sw(fn === false, 'data-act="setting" data-path="fn_swap" data-on="false" data-off="true"'))), `Fn lock: ${fn === undefined ? 'hardware' : fn ? 'off' : 'on'}`) +
      sec('Special keys', card(sk) + `<div class="hint"><i class="fa-solid fa-face-smile"></i> The built-in emoji picker opens at the pointer. Type to search, Enter inserts, Esc closes. Assign it with "Emoji picker"; "Emoji (desktop shortcut)" sends Ctrl+. instead.</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-act="pick" data-section="keys" data-cid="264" data-label="Emoji" data-cat="key"><i class="fa-solid fa-keyboard"></i>Record keystroke…</button><button class="btn" data-act="reset-keys"><i class="fa-solid fa-rotate-left"></i>Restore defaults</button></div>`);
  }

  function pageBacklight(d) {
    const st = (d.state || {}).backlight, s = (d.config.settings || {}).backlight || {};
    if (!st) return sec('Backlight', card(row('Not supported by this device', '', '')));
    const on = s.enabled ?? st.enabled, manual = (s.mode || (st.mode === 3 ? 'manual' : 'auto')) === 'manual';
    const level = manual ? (s.level ?? st.level) : st.current_level;
    const levels = Array.from({ length: st.num_levels || 8 }, (_, i) => `<button class="${on && i < level + (manual ? 1 : 0) ? (manual ? 'on' : 'auto') : ''}" style="height:${8 + i * 2.8}px" data-act="bl-level" data-key="${i}" title="Level ${i}"></button>`).join('');
    const hint = !on ? 'Backlight is off' : manual ? `Level ${level} of ${(st.num_levels || 8) - 1}` : 'Set by the ambient light sensor';
    const timers = [['duration_hands_out', 'fa-hand', 'Hands away', 'No hands over the keyboard', 1, 60, 1], ['duration_hands_in', 'fa-keyboard', 'Hands present', 'Typing paused', 1, 60, 1], ['duration_powered', 'fa-plug', 'On power', 'Charging cable connected', 5, 600, 5]];
    const fmt = v => v >= 60 ? `${Math.round(v / 60)} min` : `${v} s`;
    return sec('Backlight', card(row('Backlight', '', sw(on, 'data-act="setting" data-path="backlight.enabled"')) +
        `<div class="row"><span class="grow lbl">Mode</span><span class="seg"><button class="${manual ? '' : 'on'}" data-act="setting-val" data-path="backlight.mode" data-val="auto">Automatic</button><button class="${manual ? 'on' : ''}" data-act="setting-val" data-path="backlight.mode" data-val="manual">Manual</button></span></div>` +
        `<div class="row"><div class="grow"><div class="lbl">Level</div><div class="sub">${hint}</div></div><div class="levels">${levels}</div></div>`)) +
      sec('Turn off after', card(timers.map(([k, icon, label, desc, lo, hi, stp]) => { const v = s[k] ?? st[k]; return `<div class="row"><i class="fa-solid ${icon}" style="width:20px;text-align:center;color:var(--dim)"></i><div class="grow"><div class="lbl">${label}</div><div class="sub">${desc}</div></div><span class="stepper"><button data-act="step" data-key="${k}" data-d="${-stp}" data-lo="${lo}" data-hi="${hi}">−</button><span>${fmt(v)}</span><button data-act="step" data-key="${k}" data-d="${stp}" data-lo="${lo}" data-hi="${hi}">+</button></span></div>`; }).join('')));
  }

  function countOverrides(d, key) {
    const p = profileOf(d, key), def = profileOf(d, 'default'); let n = 0;
    for (const sec of ['buttons', 'keys']) for (const [cid, a] of Object.entries(p[sec] || {})) if (JSON.stringify(a) !== JSON.stringify((def[sec] || {})[cid])) n++;
    if (p.thumbwheel !== undefined && JSON.stringify(p.thumbwheel) !== JSON.stringify(def.thumbwheel)) n++;
    return n;
  }
  function allProfiles() {
    const map = {};
    for (const d of S.devices) for (const [k, p] of Object.entries((d.config || {}).profiles || {})) { if (k === 'default') continue; map[k] = map[k] || { key: k, name: p.name || k, match: p.match || [], overrides: 0 }; map[k].overrides += countOverrides(d, k); }
    return Object.values(map);
  }
  function pageApps() {
    const profs = allProfiles();
    const rows = [`<div class="row click app-row" data-act="app-detail" data-key="default"><span class="ch" style="background:var(--dim)">∗</span><div class="grow"><div class="lbl">Default</div><div class="sub">all other windows</div></div><i class="fa-solid fa-chevron-right" style="color:var(--dim)"></i></div>`]
      .concat(profs.map(p => `<div class="row click app-row" data-act="app-detail" data-key="${esc(p.key)}"><span class="ch" style="background:${colorFor(p.name)}">${esc(p.name.charAt(0).toUpperCase())}</span><div class="grow"><div class="lbl">${esc(p.name)}</div><div class="sub">${esc(p.match.join(', '))}</div></div><span class="val">${p.overrides} override${p.overrides === 1 ? '' : 's'}</span><i class="fa-solid fa-chevron-right" style="color:var(--dim)"></i></div>`)).join('');
    const sugg = (S.apps || []).filter(a => !profs.some(p => p.match.includes(a.wm_class || a.id))).slice(0, 8);
    return sec('Profiles', card(rows) + `<div style="margin-top:8px"><button class="btn" data-act="add-app"><i class="fa-solid fa-plus"></i>Add application</button></div>`, 'Matched on the focused window class') +
      sec('Suggestions from installed applications', `<div class="chips">${sugg.map(a => `<button class="chip" data-act="add-app-quick" data-name="${esc(a.name)}" data-cls="${esc(a.wm_class || a.id)}">${esc(a.name)}</button>`).join('') || '<span class="hint">No suggestions</span>'}</div>`);
  }
  const colorFor = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 45%)`; };
  function pageAppDetail(ad) {
    const key = ad.key, isDef = key === 'default';
    const groups = S.devices.map(d => {
      const def = profileOf(d, 'default'), p = profileOf(d, key);
      const items = [];
      const ctls = isMouse(d) ? PHYS.filter(([cid]) => d.controls.some(c => c.cid === cid)).map(([cid, l]) => ['buttons', cid, l]) : FKEYS.concat().map(([cid, k]) => ['keys', cid, (d.controls.find(c => c.cid === cid) || {}).label || k]).concat(SKEYS.filter(([cid]) => !FKEYS.some(f => f[0] === cid)).map(([cid, , l]) => ['keys', cid, l]));
      for (const [secn, cid, label] of ctls) {
        const dv = (def[secn] || {})[String(cid)], v = (p[secn] || {})[String(cid)];
        const ov = !isDef && v !== undefined && JSON.stringify(v) !== JSON.stringify(dv);
        items.push(`<div class="row"><span class="ov-dot ${ov ? 'on' : ''}"></span><span class="grow lbl" style="${ov ? '' : 'color:var(--dim)'}">${esc(label)}</span>${ov ? `<span class="val">${esc(presetLabel(dv))}</span>` : ''}${drop(v !== undefined ? v : dv, `data-act="pick" data-dev="${d.id}" data-section="${secn}" data-cid="${cid}" data-label="${esc(label)}" data-profile="${esc(key)}"`)}${ov ? `<button class="btn sm flat" data-act="ov-reset" data-dev="${d.id}" data-section="${secn}" data-cid="${cid}" data-profile="${esc(key)}" title="Reset to default"><i class="fa-solid fa-rotate-left"></i></button>` : ''}</div>`);
      }
      if (isMouse(d)) { const dv = def.thumbwheel, v = p.thumbwheel; const ov = !isDef && v !== undefined && JSON.stringify(v) !== JSON.stringify(dv); items.push(`<div class="row"><span class="ov-dot ${ov ? 'on' : ''}"></span><span class="grow lbl" style="${ov ? '' : 'color:var(--dim)'}">Thumb wheel</span>${ov ? `<span class="val">${esc(presetLabel(dv))}</span>` : ''}${drop(v !== undefined ? v : dv, `data-act="pick" data-dev="${d.id}" data-section="thumbwheel" data-cid="thumb" data-label="Thumb wheel" data-profile="${esc(key)}"`)}</div>`); }
      return sec(d.name, card(items.join('')));
    }).join('');
    const prof = isDef ? { name: 'Default', match: [] } : (allProfiles().find(p => p.key === key) || { name: key, match: [] });
    return `<div class="row" style="border:0;padding:0 0 4px"><span class="ch app-row" style="width:36px;height:36px;border-radius:10px;background:${isDef ? 'var(--dim)' : colorFor(prof.name)};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${esc(prof.name.charAt(0).toUpperCase())}</span><div class="grow"><div class="lbl" style="font-size:16px;font-weight:600">${esc(prof.name)}</div><div class="sub">${isDef ? 'Used for all other windows' : esc(prof.match.join(', ')) + ' · ' + (prof.overrides || 0) + ' overrides'}</div></div>${isDef ? '' : `<button class="btn sm" data-act="reset-overrides" data-key="${esc(key)}"><i class="fa-solid fa-rotate-left"></i>Reset all</button><button class="btn sm" data-act="rename-profile" data-key="${esc(key)}"><i class="fa-solid fa-pen"></i>Rename</button><button class="btn sm danger" data-act="del-profile" data-key="${esc(key)}">Remove</button>`}</div>` +
      groups + (isDef ? '' : `<div class="legend"><span class="dot" style="background:var(--accbg)"></span>Overridden here<span class="dot" style="background:var(--trk);margin-left:8px"></span>Inherited from Default</div>`);
  }

  function pageNotif() {
    const g = S.general, ev = g.osd_events || { mic: true, smartshift: true, backlight: true, host: true, dpi: false };
    const pos = g.osd_position || 'bottom', dur = g.osd_duration ?? 1500;
    return sec('On-screen overlays', card(row('Show overlays', 'Toast when a diverted key changes device state', sw(g.osd_enabled ?? true, 'data-act="general" data-key="osd_enabled"')) +
        `<div class="row"><span class="grow lbl">Position</span><span class="seg">${['top', 'center', 'bottom'].map(p => `<button class="${pos === p ? 'on' : ''}" data-act="general-val" data-key="osd_position" data-val="${p}">${p === 'center' ? 'Centre' : p.charAt(0).toUpperCase() + p.slice(1)}</button>`).join('')}</span></div>` +
        `<div class="row"><span class="grow lbl">Duration</span>${range('data-act="general-range" data-key="osd_duration" data-out="dur"', dur, 500, 4000, 250)}<span class="val" data-out="dur" style="width:40px;text-align:right">${(dur / 1000).toFixed(1)} s</span></div>` +
        row('Toggle overlays shortcut', '', '<span class="val">Super + Alt + O</span>') +
        `<div class="row"><span class="grow lbl">Preview</span>${['mic', 'smartshift', 'backlight', 'host', 'dpi', 'emoji'].map(k => `<button class="btn sm" data-act="osd-test" data-key="${k}">${k}</button>`).join('')}</div>`)) +
      sec('Show overlay for', card([['mic', 'fa-microphone-slash', 'Microphone mute'], ['smartshift', 'fa-gear', 'SmartShift mode'], ['backlight', 'fa-sun', 'Backlight level'], ['host', 'fa-right-left', 'Easy-Switch host'], ['dpi', 'fa-arrow-pointer', 'DPI change']].map(([k, icon, label]) => `<div class="row"><i class="fa-solid ${icon}" style="width:20px;text-align:center;color:var(--dim)"></i><span class="grow lbl">${label}</span>${sw(ev[k] !== false, `data-act="osd-event" data-key="${k}"`)}</div>`).join(''))) +
      sec('System notifications', card(row('Low battery', '', sw(g.notify_low ?? true, 'data-act="general" data-key="notify_low"')) + row('Device connected / disconnected', '', sw(g.notify_connect ?? false, 'data-act="general" data-key="notify_connect"'))));
  }

  function pageBackup() {
    const cfg = S.status.config_path || '~/.config/openoptions/config.json';
    const n = S.devices.length, np = allProfiles().length;
    return sec('Configuration file', card(row(esc(cfg), `${n} device${n === 1 ? '' : 's'} · ${np} app profile${np === 1 ? '' : 's'}`, `<button class="btn sm" data-act="show-config"><i class="fa-solid fa-folder-open"></i>Show</button>`) +
        `<div class="row" style="gap:8px"><button class="btn" data-act="export"><i class="fa-solid fa-download"></i>Export…</button><button class="btn" data-act="import"><i class="fa-solid fa-upload"></i>Import…</button><span class="grow"></span><button class="btn danger" data-act="reset-all">Reset all</button></div>`)) +
      sec('On-board profiles', card(S.devices.map(d => `<div class="row"><i class="fa-solid ${isMouse(d) ? 'fa-computer-mouse' : 'fa-keyboard'}" style="width:20px;text-align:center;color:var(--dim)"></i><div class="grow"><div class="lbl">${esc(d.name)}</div><div class="sub" style="color:var(--ok)">Read from device</div></div><button class="btn sm" data-act="sync-device" data-key="${d.id}"><i class="fa-solid fa-arrows-rotate"></i>Sync from device</button></div>`).join('')) + `<div class="hint">Devices keep DPI, SmartShift and host settings in flash; syncing reads them back into the configuration after using another computer.</div>`) +
      sec('Backups', `<div style="display:flex;justify-content:flex-end;margin-bottom:4px"><button class="btn sm" data-act="create-backup"><i class="fa-solid fa-plus"></i>Back up now</button></div>` + card(S.backups.length ? S.backups.map(b => `<div class="row"><i class="fa-solid fa-clock-rotate-left" style="width:20px;text-align:center;color:var(--dim)"></i><span class="grow lbl">${esc(b.when)}</span><span class="val">${esc(b.note || '')}</span><button class="btn sm" data-act="restore-backup" data-key="${esc(b.file)}">Restore</button></div>`).join('') : row('No backups yet', 'A backup is written before every import and reset', '')));
  }

  function pageSettings() {
    const u = S.ui || {};
    return sec('Startup', card(row('Start agent at login', 'systemd user service', sw(!!u.autostart, 'data-act="ui" data-key="autostart"')) +
        row('Show tray indicator', 'Battery and Easy-Switch in the top bar', sw(u.tray !== false, 'data-act="ui" data-key="tray"')) +
        row('Keep running when window closes', 'Closing hides to the tray', sw(u.minimize !== false, 'data-act="ui" data-key="minimize"')) +
        row('Start hidden', 'Open in the tray only', sw(!!u.start_hidden, 'data-act="ui" data-key="start_hidden"')))) +
      sec('General', card(`<div class="row"><span class="grow lbl">Appearance</span><select class="sel" data-act="theme-select">${THEMES.map(([k, l]) => `<option value="${k}" ${S.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` +
        row('Language', '', '<span class="val">System (English)</span>') +
        `<div class="row"><div class="grow"><div class="lbl">Check for updates</div><div class="sub">Looks at the GitHub release feed</div></div><button class="btn sm" data-act="check-updates">Check now</button>${sw(u.updates !== false, 'data-act="ui" data-key="updates"')}</div>`)) +
      sec('Privacy', card(row('Telemetry', 'Off. OpenOptions never sends data anywhere.', '<span class="val">Not available</span>')));
  }

  function pageAbout() {
    const links = [['fa-book', 'Documentation', 'https://github.com/aabdelghani/openoptions#readme'], ['fa-code-branch', 'Source code', 'https://github.com/aabdelghani/openoptions'], ['fa-bug', 'Report an issue', 'https://github.com/aabdelghani/openoptions/issues'], ['fa-heart', 'Contributors', 'https://github.com/aabdelghani/openoptions/graphs/contributors']];
    const logs = S.logs.length ? S.logs : [{ t: `${new Date().toLocaleTimeString()} INFO  agent ${S.connected ? 'connected' : 'not running'} · ${S.devices.length} device(s) · tracker ${S.status.tracker || 'n/a'}`, c: 'dim' }];
    return `<div class="card about-hero"><span class="mark"><i class="fa-solid fa-computer-mouse"></i></span><div class="name">OpenOptions</div><div class="hint">Configuration for MX mice and keyboards on Linux</div><div class="tags"><span>v${S.status.version || VERSION}</span><span>MIT</span><span>${S.appInfo.packaged ? 'Packaged' : 'Source'}</span></div></div>` +
      card(links.map(([i, l, u]) => `<div class="row click" data-act="open" data-url="${u}"><i class="fa-solid ${i}" style="width:20px;text-align:center;color:var(--dim)"></i><span class="grow lbl">${l}</span><i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--dim);font-size:11px"></i></div>`).join('')) +
      sec('Diagnostics', card(`<div class="logs">${logs.map(l => `<span class="${l.c || 'dim'}">${esc(l.t)}</span>`).join('')}</div>`) + `<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-act="export-diag"><i class="fa-solid fa-file-zipper"></i>Export diagnostics</button><button class="btn" data-act="copy-diag"><i class="fa-solid fa-copy"></i>Copy</button></div>`, `<button class="btn sm flat" data-act="refresh-logs">Refresh</button>`);
  }

  // ----------------------------------------------------------- dialogs
  const PICKER_CATS = [['all', 'All', 'fa-list'], ['key', 'Keystroke', 'fa-keyboard'], ['media', 'Media', 'fa-play'], ['window', 'Window', 'fa-window-maximize'], ['ws', 'Workspaces', 'fa-table-cells-large'], ['cmd', 'Command', 'fa-terminal'], ['device', 'Device', 'fa-computer-mouse']];
  const CAT_OF = { media: ['volume_up', 'volume_down', 'mute', 'mic_mute', 'play_pause', 'next_track', 'prev_track', 'brightness_up', 'brightness_down'],
    window: ['close_window', 'maximize', 'minimize', 'tile_left', 'tile_right', 'show_desktop', 'app_switcher', 'screenshot', 'screenshot_area', 'lock', 'terminal', 'calculator', 'emoji_picker', 'emoji', 'context_menu', 'copy', 'paste', 'undo', 'redo', 'zoom_in', 'zoom_out', 'tab_next', 'tab_prev'],
    ws: ['overview', 'workspace_next', 'workspace_prev'],
    device: ['native', 'nothing', 'middle_click', 'back', 'forward', 'easy_switch_1', 'easy_switch_2', 'easy_switch_3', 'dpi_cycle', 'smartshift_toggle', 'open_home', 'gesture_navigation', 'gesture_windows', 'gesture_volume', 'gesture_pan', 'hscroll', 'vscroll', 'zoom_wheel', 'volume_wheel', 'tabs_wheel', 'workspaces_wheel', 'brightness_wheel'] };
  const CAT_LABEL = { media: 'Media', window: 'Window', ws: 'Shell', device: 'Device' };
  function pickerItems(p) {
    const all = S.presets.all;
    const allowed = new Set(p.section === 'thumbwheel' ? S.presets.wheel : p.section === 'gesture' ? Object.keys(all).filter(k => ['nothing', 'keystroke', 'button', 'command', 'change_host', 'dpi_cycle', 'scroll', 'smartshift_toggle', 'open'].includes(all[k].type)) : p.section === 'keys' ? S.presets.keys : S.presets.buttons);
    const items = [];
    for (const [cat, keys] of Object.entries(CAT_OF)) for (const k of keys) if (allowed.has(k) && all[k] && (p.cat === 'all' || p.cat === cat)) {
      if (all[k].type === 'gesture' && p.section !== 'buttons') continue;
      if (p.section === 'buttons' && all[k].type === 'gesture' && !(p.ctl && p.ctl.raw_xy)) continue;
      items.push({ key: k, cat, icon: PRESET_ICON[k] || ICON[all[k].type], label: all[k].label, meta: CAT_LABEL[cat] });
    }
    const q = (p.q || '').toLowerCase();
    return q ? items.filter(i => i.label.toLowerCase().includes(q)) : items;
  }
  function renderDialog() {
    if (S.dlg === 'picker') return renderPicker();
    if (S.dlg === 'pair') return renderPair();
    if (S.dlg === 'prompt') return renderPrompt();
    return '';
  }
  function renderPicker() {
    const p = S.picker;
    const cur = p.current;
    const curKey = typeof cur === 'string' ? cur : (cur && cur.preset);
    let body = '';
    if (p.cat === 'key') {
      body = `<div class="recbox"><i class="fa-solid fa-keyboard big-ic"></i><div class="t">${p.recording ? 'Press the keys to record' : 'Click here, then press the keys'}</div><div class="keys">${(p.chord || []).length ? p.chord.map(k => `<span>${esc(keyName(k))}</span>`).join('') : '<span style="opacity:.5">…</span>'}</div><div class="hint">Release to finish. Esc cancels.</div>${p.recording ? '' : '<button class="btn primary" data-act="rec-start">Start recording</button>'}</div>
        <div class="hint">Or type it: <input class="text" data-field="keys" placeholder="ctrl+shift+t" style="width:200px;margin-left:8px" value="${esc(p.typed || '')}"></div>`;
    } else if (p.cat === 'cmd') {
      body = sec('Shell command', `<input class="mono" data-field="cmd" placeholder="gnome-screenshot -i" value="${esc(p.cmd || '')}"><div class="hint">Runs in the user session with your environment. Non-interactive.</div>`) +
        sec('Type text', `<input class="mono" data-field="text" placeholder="Text typed as keystrokes" value="${esc(p.text || '')}">`) +
        sec('Open URL, file or folder', `<input class="mono" data-field="open" placeholder="https://… or ~/Documents" value="${esc(p.open || '')}">`) +
        sec('Launch application', `<select class="sel" data-field="launch" style="width:100%"><option value="">Choose an application…</option>${(S.apps || []).map(a => `<option value="${esc(a.id)}" ${p.launch === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`);
    } else {
      const items = pickerItems(p);
      body = `<div class="acts">${items.map(i => `<button class="act ${curKey === i.key || p.sel === i.key ? 'on' : ''}" data-act="pick-item" data-key="${i.key}"><i class="fa-solid ${i.icon} ic"></i><span class="t">${esc(i.label)}</span><span class="m">${i.meta}</span><i class="fa-solid fa-check chk"></i></button>`).join('') || '<div class="row hint">No actions match</div>'}</div>`;
    }
    return `<div class="scrim" data-act="close-dlg"><div class="dlg" data-stop>
      <div class="dlg-head">Choose action · ${esc(p.label)}<button class="hbtn close" data-act="close-dlg"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="dlg-body">
        <div class="search"><i class="fa-solid fa-magnifying-glass"></i><input data-field="q" placeholder="Search actions" value="${esc(p.q || '')}"></div>
        <div class="cats">${PICKER_CATS.filter(([k]) => !(p.section === 'thumbwheel' && ['key', 'media', 'window', 'ws'].includes(k))).map(([k, l, i]) => `<button class="pill ${p.cat === k ? 'on' : ''}" data-act="pick-cat" data-key="${k}"><i class="fa-solid ${i}"></i>${l}</button>`).join('')}</div>
        ${body}
      </div>
      <div class="dlg-foot"><button class="btn flat" data-act="pick-default" title="Back to what this control does out of the box"><i class="fa-solid fa-rotate-left"></i>Reset to default</button><button class="btn flat danger" data-act="pick-disable">${p.section === 'gesture' ? 'Do nothing' : 'Disable ' + (p.section === 'keys' ? 'key' : p.section === 'thumbwheel' ? 'wheel' : 'button')}</button><div class="r"><button class="btn" data-act="close-dlg">Cancel</button><button class="btn primary" data-act="pick-assign">Assign</button></div></div>
    </div></div>`;
  }
  function renderPair() {
    const p = S.pair;
    const steps = [[1, 'Connection'], [2, 'Discover'], [3, 'Done']].map(([n, l]) => `<button class="${n < p.step ? 'done' : n === p.step ? 'cur' : ''}"><span class="bar"></span><span class="t">${l}</span></button>`).join('');
    let body = '';
    if (p.step === 1) body = `<button class="choice on"><span class="ic"><i class="fa-brands fa-usb"></i></span><div class="grow"><div>Bolt receiver</div><div class="sub">${S.status.receivers ? esc(S.status.receivers) : 'Plugged in'}</div></div></button>
      <button class="choice" data-act="open-bt"><span class="ic"><i class="fa-brands fa-bluetooth-b"></i></span><div class="grow"><div>Bluetooth</div><div class="sub">Via the system Bluetooth settings</div></div></button><div class="hint">Unifying receivers are supported for existing pairings only.</div>`;
    else if (p.step === 2) {
      const f = p.found[0];
      let title = 'Searching…', hint = 'Turn the device off and on, or hold its Easy-Switch key for 3 seconds until the LED blinks fast.';
      if (p.error) { title = 'Pairing failed'; hint = p.error; }
      else if (p.passkey && f) { title = `Confirm on ${f.name}`; hint = (f.authentication & 1) ? `Type ${p.passkey} on the keyboard and press Enter.` : `Click ${[...p.passkey].map(c => c === '1' ? 'right' : 'left').join(', ')} on the mouse, then press both buttons together.`; }
      else if (f) { title = `Pairing ${f.name}`; hint = 'Waiting for the device to confirm.'; }
      body = `<div class="center"><span class="ring"><i class="fa-solid ${p.error ? 'fa-triangle-exclamation' : 'fa-satellite-dish'}"></i></span><div style="font-size:15px;font-weight:600">${esc(title)}</div><div class="hint">${esc(hint)}</div>${p.error ? '' : '<div class="progress"><i></i></div>'}${p.passkey && f && (f.authentication & 1) ? `<div class="keys">${[...p.passkey].map(c => `<span>${c}</span>`).join('')}</div>` : ''}${f ? `<div class="choice on" style="max-width:360px"><span class="ic"><i class="fa-solid ${f.kind === 'keyboard' ? 'fa-keyboard' : 'fa-computer-mouse'}"></i></span><div class="grow"><div>${esc(f.name)}</div><div class="sub">${esc(f.kind)}</div></div></div>` : ''}<div class="hint">${p.error ? '' : 'Timeout in ' + (p.timeout ?? 60) + ' s'}</div></div>`;
    }
    else body = `<div class="center"><span class="ring ok"><i class="fa-solid fa-check"></i></span><div style="font-size:15px;font-weight:600">${esc(p.done || 'Device paired')}</div><div class="hint">It will appear in the sidebar in a moment.</div></div>`;
    return `<div class="scrim" data-act="close-dlg"><div class="dlg" data-stop>
      <div class="dlg-head">Pair a device<button class="hbtn close" data-act="close-dlg"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="dlg-body"><div class="steps">${steps}</div>${body}</div>
      <div class="dlg-foot"><span></span><div class="r"><button class="btn" data-act="pair-cancel">Cancel</button><button class="btn primary" data-act="pair-next" ${p.step === 2 && !p.error ? 'disabled' : ''}>${p.step === 3 ? 'Finish' : p.step === 2 ? 'Retry' : 'Continue'}</button></div></div></div></div>`;
  }
  function renderPrompt() {
    const p = S.prompt;
    return `<div class="scrim" data-act="close-dlg"><div class="dlg" style="width:460px" data-stop>
      <div class="dlg-head">${esc(p.title)}<button class="hbtn close" data-act="close-dlg"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="dlg-body">${p.fields.map(f => `<label class="hint">${esc(f.label)}<input class="text" style="display:block;width:100%;margin-top:4px" data-field="${f.key}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.list ? `list="dl-${f.key}"` : ''}>${f.list ? `<datalist id="dl-${f.key}">${f.list.map(o => `<option value="${esc(o.value)}">${esc(o.label || '')}</option>`).join('')}</datalist>` : ''}</label>`).join('')}${p.note ? `<div class="hint">${p.note}</div>` : ''}</div>
      <div class="dlg-foot"><span></span><div class="r"><button class="btn" data-act="close-dlg">Cancel</button><button class="btn primary" data-act="prompt-ok">${esc(p.ok || 'OK')}</button></div></div></div></div>`;
  }
  function prompt(title, fields, onOk, ok, note) { S.prompt = { title, fields, onOk, ok, note }; S.dlg = 'prompt'; render(); setTimeout(() => { const i = root.querySelector('.dlg input'); if (i) i.focus(); }, 30); }

  // ----------------------------------------------------------- states
  function renderEmpty() {
    const c = S.conflicts[0];
    return `<div class="window"><main class="main empty-wrap">
      <header class="hb"><span class="title">OpenOptions</span><div class="right"><div style="position:relative"><button class="hbtn icon" data-act="menu-theme"><i class="fa-solid ${S.theme.includes('dark') ? 'fa-moon' : 'fa-sun'}"></i></button>${S.menu === 'theme' ? themeMenu() : ''}</div><button class="hbtn close" data-act="win-close"><i class="fa-solid fa-xmark"></i></button></div></header>
      ${c ? `<div class="banner"><i class="fa-solid fa-triangle-exclamation"></i><span><strong>${esc(c.name)} is running.</strong> Two programs diverting the same buttons will fight over the device.</span><button class="bact" data-act="stop-tool" data-tool="${esc(c.name)}">Stop ${esc(c.name)}</button></div>` : ''}
      <div class="empty"><div class="ring"><i class="fa-brands fa-usb"></i></div><div class="t">${S.connected ? 'No devices found' : 'Agent not running'}</div><div class="s">${S.connected ? 'Plug in the Bolt or Unifying receiver, or pair over Bluetooth. Devices appear here as soon as they connect.' : 'Start the agent with <code>openoptions-agent</code> or enable the user service. The window reconnects automatically.'}</div>
        <div style="display:flex;gap:8px;margin-top:8px">${S.connected ? '<button class="btn primary" data-act="pair"><i class="fa-solid fa-plus"></i>Pair a device</button>' : ''}<button class="btn" data-act="onboard"><i class="fa-solid fa-shield-halved"></i>Setup guide</button></div></div></main></div>`;
  }
  function renderOnboard() {
    const o = S.ob;
    const steps = [[1, 'Permissions', 'udev rule and uinput'], [2, 'Devices', 'Choose what to manage'], [3, 'Preset', 'GNOME, macOS or Windows-like']].map(([n, t, s]) => `<button class="ob-step ${n === o.step ? 'cur' : n < o.step ? 'done' : ''}" data-act="ob-step" data-key="${n}"><span class="n">${n < o.step ? '✓' : n}</span><div><div class="t">${t}</div><div class="s">${s}</div></div></button>`).join('');
    let body = '';
    if (o.step === 1) {
      const agentOk = S.connected, devOk = S.devices.length > 0;
      const conf = S.conflicts.length;
      body = `<div><h1>Permissions</h1><div class="lead">OpenOptions talks to devices over HID and emits keys through uinput. Both need a one-time udev rule.</div></div>
        ${card(`<div class="row">${agentOk ? '<span class="mark-ok"><i class="fa-solid fa-check"></i></span>' : '<span class="mark-n">1</span>'}<div class="grow"><div class="lbl">Agent running (systemd user service)</div>${agentOk ? '' : '<code class="cmd">./install.sh   # or: openoptions-agent</code>'}</div></div>
          <div class="row">${devOk ? '<span class="mark-ok"><i class="fa-solid fa-check"></i></span>' : '<span class="mark-n">2</span>'}<div class="grow"><div class="lbl">Access to /dev/hidraw* and /dev/uinput</div>${devOk ? '' : '<code class="cmd">sudo cp udev/60-openoptions.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger</code>'}</div></div>
          <div class="row">${conf ? '<span class="mark-n">3</span>' : '<span class="mark-ok"><i class="fa-solid fa-check"></i></span>'}<div class="grow"><div class="lbl">Stop Solaar or logid while OpenOptions runs</div>${conf ? `<div class="sub">${esc(S.conflicts.map(c => c.name).join(', '))} is running</div>` : ''}</div>${conf ? `<button class="btn sm" data-act="stop-tool" data-tool="${esc(S.conflicts[0].name)}">Stop</button>` : ''}</div>`)}
        ${devOk ? '' : '<div><button class="btn primary" data-act="install-udev"><i class="fa-solid fa-shield-halved"></i>Install rule with pkexec</button></div>'}`;
    } else if (o.step === 2) {
      body = `<div><h1>Your devices</h1><div class="lead">${S.devices.length ? 'Found on the receiver.' : 'No devices yet. Switch a device on or plug in the receiver.'}</div></div>
        ${card(S.devices.map(d => `<div class="row"><span class="mark-ok"><i class="fa-solid fa-check"></i></span><i class="fa-solid ${isMouse(d) ? 'fa-computer-mouse' : 'fa-keyboard'}" style="color:var(--dim)"></i><div class="grow"><div class="lbl">${esc(d.name)}</div><div class="sub">${d.transport === 'bolt' ? 'Bolt' : 'Bluetooth'} · host ${((d.state || {}).hosts || {}).current + 1 || 1}</div></div><span class="val">${d.battery ? d.battery.percent + '%' : ''}</span></div>`).join('') || row('Waiting for devices…', '', ''))}
        <div><button class="btn" data-act="pair"><i class="fa-solid fa-plus"></i>Pair another device</button></div>`;
    } else {
      const presets = [['gnome', 'fa-linux', 'GNOME defaults', 'Gestures drive Overview and workspaces. F-keys follow the shell.'], ['mac', 'fa-apple', 'macOS-like', 'Gesture button acts as Mission Control; thumb wheel switches desktops.'], ['win', 'fa-windows', 'Windows-like', 'Task View on gesture tap, Alt+Tab on swipe; media row unchanged.']];
      body = `<div><h1>Pick a preset</h1><div class="lead">A starting point for buttons, gestures and F-keys. Everything can be changed later.</div></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${presets.map(([k, i, n, d]) => `<button class="choice ${o.preset === k ? 'on' : ''}" style="flex-direction:column;align-items:flex-start;gap:8px" data-act="ob-preset" data-key="${k}"><i class="fa-brands ${i}" style="font-size:22px;color:${o.preset === k ? 'var(--acc)' : 'var(--dim)'}"></i><span style="font-weight:600">${n}</span><span class="sub">${d}</span></button>`).join('')}</div>`;
    }
    return `<div class="window"><main class="main"><header class="hb"><span class="title">Welcome to OpenOptions</span><div class="right"><button class="hbtn close" data-act="ob-close"><i class="fa-solid fa-xmark"></i></button></div></header>
      <div class="onboard"><div class="steps-col">${steps}<div class="hint" style="margin-top:auto">Step ${o.step} of 3</div></div>
      <div class="ob-body">${body}<div class="ob-foot"><button class="btn" data-act="ob-prev" ${o.step === 1 ? 'disabled' : ''}>Back</button><button class="btn primary" data-act="ob-next">${o.step === 3 ? 'Finish' : 'Continue'}</button></div></div></div></main></div>`;
  }

  // ============================================================ bind
  function bind() {
    root.querySelectorAll('[data-stop]').forEach(e => e.onclick = ev => ev.stopPropagation());
    root.querySelectorAll('.nav-item').forEach(b => b.onclick = () => go(b.dataset.page, b.dataset.dev || S.dev));
    root.querySelectorAll('.hotspot').forEach(h => h.onclick = () => openPicker({ dev: dev(), section: h.dataset.section, cid: h.dataset.cid === 'thumb' ? 'thumb' : Number(h.dataset.cid), label: h.querySelector('title') ? h.querySelector('title').textContent.split(':')[0] : (h.dataset.section === 'thumbwheel' ? 'Thumb wheel' : (dev().controls.find(c => c.cid === Number(h.dataset.cid)) || {}).label) }));
    root.querySelectorAll('[data-act]').forEach(b => {
      const act = b.dataset.act;
      if (b.tagName === 'INPUT' && b.type === 'range') {
        b.oninput = () => { const out = root.querySelector(`[data-out="${b.dataset.out}"]:not(input)`); if (out) out.textContent = fmtOut(b.dataset.out, Number(b.value)); };
        b.onchange = () => onAction(act, b);
      } else if (b.tagName === 'SELECT') b.onchange = () => onAction(act, b);
      else if (b.tagName === 'INPUT') b.onchange = () => onAction(act, b);
      else b.onclick = e => { e.stopPropagation(); onAction(act, b, e); };
    });
    root.querySelectorAll('[data-field]').forEach(i => {
      i.onclick = e => e.stopPropagation();
      i.oninput = () => { if (S.dlg === 'picker') { S.picker[i.dataset.field] = i.value; if (i.dataset.field === 'q') { const list = root.querySelector('.acts'); if (list) renderPickerList(); } } if (S.dlg === 'prompt') { const f = S.prompt.fields.find(f => f.key === i.dataset.field); if (f) f.value = i.value; } };
      i.onkeydown = e => { if (e.key === 'Enter' && S.dlg === 'prompt') { e.preventDefault(); onAction('prompt-ok'); } };
    });
    if (S.dlg === 'picker' && S.picker.cat === 'key' && S.picker.recording) armRecorder();
    const q = root.querySelector('[data-field="q"]'); if (q && S.dlg === 'picker' && S.picker.cat !== 'key') setTimeout(() => q.focus(), 20);
  }
  function fmtOut(k, v) { if (k === 'pspeed' || k === 'sst' || k === 'dpi' || k === 'tws') return String(v); if (k === 'thr') return v + '%'; if (k === 'dur') return (v / 1000).toFixed(1) + ' s'; return String(v); }
  function renderPickerList() { const p = S.picker; const list = root.querySelector('.acts'); if (!list) return; const items = pickerItems(p); const curKey = typeof p.current === 'string' ? p.current : (p.current && p.current.preset); list.innerHTML = items.map(i => `<button class="act ${curKey === i.key || p.sel === i.key ? 'on' : ''}" data-act="pick-item" data-key="${i.key}"><i class="fa-solid ${i.icon} ic"></i><span class="t">${esc(i.label)}</span><span class="m">${i.meta}</span><i class="fa-solid fa-check chk"></i></button>`).join('') || '<div class="row hint">No actions match</div>'; list.querySelectorAll('[data-act]').forEach(b => b.onclick = e => { e.stopPropagation(); onAction('pick-item', b); }); }
  function armRecorder() {
    startRecorder((chord, cancelled) => { S.picker.chord = chord; if (cancelled) { S.picker.recording = false; render(); return; } const box = root.querySelector('.recbox .keys'); if (box) box.innerHTML = chord.map(k => `<span>${esc(keyName(k))}</span>`).join('') || '<span style="opacity:.5">…</span>'; },
      keys => { S.picker.chord = keys; S.picker.recording = false; assignPicked({ type: 'keystroke', keys }); });
  }
  function openPicker(t) {
    const d = t.dev || dev();
    const section = t.section, cid = t.cid;
    const current = section === 'gesture' ? null : assignment(d, section, cid, t.profile);
    const ctl = typeof cid === 'number' ? d.controls.find(c => c.cid === cid) : null;
    S.picker = { dev: d.id, section, cid, label: t.label, profile: t.profile || 'default', cat: t.cat || 'all', current, ctl, sel: null, slot: t.slot, recording: t.cat === 'key' };
    S.dlg = 'picker'; render();
  }
  async function assignPicked(action) {
    const p = S.picker; const d = S.devices.find(x => x.id === p.dev);
    if (p.section === 'gesture') {
      const cid = gestureControl(d), g = gestureObject(d, cid);
      let sub = typeof action === 'string' ? JSON.parse(JSON.stringify(S.presets.all[action])) : action;
      if (typeof action === 'string') sub.preset = action;
      if (sub.type === 'scroll' && !sub.amount) sub.amount = (p.slot === 'up' || p.slot === 'right') ? 360 : -360;
      g[p.slot] = sub; g.label = 'Custom gestures'; g.type = 'gesture';
      await setAssign(d, 'buttons', cid, g);
    } else {
      await setAssign(d, p.section, p.cid, action, p.profile);
    }
    S.dlg = null; toast('Assigned ' + presetLabel(action)); render();
  }

  async function onAction(act, b, e) {
    const d = dev(); const key = b && b.dataset.key;
    switch (act) {
      case 'page': go(b.dataset.page); return;
      case 'goinfo': go('info', S.dev); return;
      case 'back-apps': S.appDetail = null; render(); return;
      case 'win-close': window.agent.windowAction('close'); return;
      case 'quit': window.agent.windowAction('quit'); return;
      case 'menu-theme': S.menu = S.menu === 'theme' ? null : 'theme'; render(); return;
      case 'menu-main': S.menu = S.menu === 'main' ? null : 'main'; render(); return;
      case 'theme': S.theme = key; try { localStorage.setItem('theme', key); } catch (x) {} window.agent.setTheme(key); S.menu = null; render(); return;
      case 'theme-select': S.theme = b.value; try { localStorage.setItem('theme', b.value); } catch (x) {} window.agent.setTheme(b.value); render(); return;
      case 'osd-test': window.agent.osdTest(key); return;
      case 'pause': await call(S.status.paused ? 'resume_diversion' : 'pause_diversion'); S.status = await call('status'); render(); return;
      case 'dismiss-conflict': S.conflictDismissed = true; render(); return;
      case 'stop-tool': { const r = await window.agent.stopTool(b.dataset.tool); toast(r && r.ok ? `${b.dataset.tool} stopped` : (r && r.error) || 'Could not stop', !(r && r.ok)); setTimeout(refresh, 1500); return; }
      case 'open': window.agent.openExternal(b.dataset.url); return;
      case 'open-bt': window.agent.openBluetooth(); toast('Opening Bluetooth settings'); return;
      case 'close-dlg': stopRecorder(); if (S.dlg === 'pair') call('pair_cancel').catch(() => {}); S.dlg = null; render(); return;
      case 'dir': S.dir = key; render(); return;
      case 'pick': openPicker({ dev: b.dataset.dev ? S.devices.find(x => x.id === b.dataset.dev) : d, section: b.dataset.section, cid: b.dataset.cid === 'thumb' ? 'thumb' : Number(b.dataset.cid), label: b.dataset.label, cat: b.dataset.cat, profile: b.dataset.profile }); return;
      case 'pick-gesture': openPicker({ dev: d, section: 'gesture', cid: gestureControl(d), label: SLOTS[S.dir][0], slot: b.dataset.slot }); return;
      case 'pick-cat': S.picker.cat = key; S.picker.recording = key === 'key'; render(); return;
      case 'pick-item': S.picker.sel = key; root.querySelectorAll('.act').forEach(x => x.classList.toggle('on', x.dataset.key === key)); return;
      case 'rec-start': S.picker.recording = true; render(); return;
      case 'pick-disable': await assignPicked('nothing'); return;
      case 'pick-default': {
        const p = S.picker; const dd = S.devices.find(x => x.id === p.dev) || d;
        const defs = ((await window.agent.call('defaults', { id: dd.id })).profiles || {}).default || {};
        let a = 'native';
        if (p.section === 'thumbwheel') a = defs.thumbwheel || 'native';
        else if (p.section === 'gesture') a = 'nothing';
        else a = (defs[p.section] || {})[String(p.cid)] || 'native';
        if (p.profile && p.profile !== 'default') { const profs = JSON.parse(JSON.stringify(dd.config.profiles)); if (profs[p.profile] && profs[p.profile][p.section]) { delete profs[p.profile][p.section][String(p.cid)]; merge(await call('set_profiles', { id: dd.id, profiles: profs })); } S.picker = null; toast('Override removed, follows All applications'); render(); return; }
        await assignPicked(a); return;
      }
      case 'pick-assign': {
        const p = S.picker;
        if (p.cat === 'key') { const t = (p.typed || '').trim(); if (t) return assignPicked({ type: 'keystroke', keys: t.split('+').map(k => 'KEY_' + k.trim().toUpperCase().replace(/^CTRL$/, 'LEFTCTRL').replace(/^SHIFT$/, 'LEFTSHIFT').replace(/^ALT$/, 'LEFTALT').replace(/^SUPER$|^META$|^WIN$/, 'LEFTMETA')) }); return toast('Record or type a keystroke first', true); }
        if (p.cat === 'cmd') { if (p.cmd) return assignPicked({ type: 'command', cmd: p.cmd, label: 'Run: ' + p.cmd }); if (p.text) return assignPicked({ type: 'type_text', text: p.text }); if (p.open) return assignPicked({ type: 'open', target: p.open, label: 'Open ' + p.open.replace(/^https?:\/\//, '').slice(0, 24) }); if (p.launch) { const a = (S.apps || []).find(x => x.id === p.launch); return assignPicked({ type: 'launch', app: p.launch, label: a ? a.name : p.launch }); } return toast('Enter a command, text, target or application', true); }
        if (p.sel) return assignPicked(p.sel);
        return toast('Pick an action first', true);
      }
      case 'gesture-preset': await setAssign(d, 'buttons', gestureControl(d), key); render(); return;
      case 'gest-mode': { const cid = gestureControl(d), g = gestureObject(d, cid); g.continuous = key === 'continuous'; if (g.continuous && !g.step) g.step = 40; g.type = 'gesture'; await setAssign(d, 'buttons', cid, g); render(); return; }
      case 'gest-enable': { const cid = gestureControl(d); const on = !b.classList.contains('on'); if (on) { const g = gestureObject(d, cid); g.type = 'gesture'; await setAssign(d, 'buttons', cid, g); } else await setAssign(d, 'buttons', cid, 'native'); render(); return; }
      case 'gest-button': { const old = gestureControl(d), n = Number(b.value); if (n !== old) { const g = gestureObject(d, old); await setAssign(d, 'buttons', old, 'native'); g.type = 'gesture'; await setAssign(d, 'buttons', n, g); } render(); return; }
      case 'gest-sens': { const cid = gestureControl(d), g = gestureObject(d, cid); g.threshold = 165 - 15 * Number(b.value); g.type = 'gesture'; await setAssign(d, 'buttons', cid, g); return; }
      case 'gest-step': { const cid = gestureControl(d), g = gestureObject(d, cid); g.step = Number(b.value); g.type = 'gesture'; await setAssign(d, 'buttons', cid, g); return; }
      case 'dpi': await setSetting(d, ['dpi'], Number(b.value)); return;
      case 'pspeed': await setSetting(d, ['pointer_speed'], Number((Number(b.value) / 50 - 1).toFixed(2))); return;
      case 'setting': { const on = !b.classList.contains('on'); const path = b.dataset.path.split('.'); let v = b.dataset.on ? (on ? b.dataset.on : b.dataset.off) : on; if (v === 'true') v = true; else if (v === 'false') v = false; await setSetting(d, path, v); render(); return; }
      case 'setting-val': await setSetting(d, b.dataset.path.split('.'), b.dataset.val); render(); return;
      case 'setting-range': await setSetting(d, b.dataset.path.split('.'), Number(b.value)); return;
      case 'bl-level': await setSetting(d, ['backlight', 'mode'], 'manual'); await setSetting(d, ['backlight', 'level'], Number(key)); render(); return;
      case 'step': { const st = (d.state || {}).backlight || {}, s = (d.config.settings || {}).backlight || {}; const v = Math.max(Number(b.dataset.lo), Math.min(Number(b.dataset.hi), (s[key] ?? st[key] ?? 0) + Number(b.dataset.d))); await setSetting(d, ['backlight', key], v); render(); return; }
      case 'thumb-speed': { const tw = assignment(d, 'thumbwheel'); let a = typeof tw === 'string' ? Object.assign({}, S.presets.all[tw], { preset: tw }) : Object.assign({}, tw || S.presets.all.hscroll); a.gain = Number(b.value) * 1.6; await setAssign(d, 'thumbwheel', '', a); return; }
      case 'assign-thumb': await setAssign(d, 'thumbwheel', '', key); render(); return;
      case 'host': await call('change_host', { id: d.id, host: Number(key) }); toast(`${d.name}: switching to host ${Number(key) + 1}`); return;
      case 'rename-host': { const h = d.state.hosts.names[Number(key)]; prompt('Rename host', [{ key: 'name', label: 'Name shown on the device', value: h.name }], async v => { merge(await call('set_host_name', { id: d.id, host: Number(key), name: v.name.trim() })); render(); }, 'Rename'); return; }
      case 'general': await setGeneral({ [key]: !b.classList.contains('on') }); render(); return;
      case 'general-val': await setGeneral({ [key]: b.dataset.val }); render(); return;
      case 'general-range': await setGeneral({ [key]: Number(b.value) }); return;
      case 'osd-event': { const ev = Object.assign({ mic: true, smartshift: true, backlight: true, host: true, dpi: false }, S.general.osd_events || {}); ev[key] = !b.classList.contains('on'); await setGeneral({ osd_events: ev }); render(); return; }
      case 'ui': { const v = !b.classList.contains('on'); S.ui = await window.agent.uiSettings({ [key]: v }) || Object.assign(S.ui, { [key]: v }); render(); return; }
      case 'fwupd': toast('Run: fwupdmgr get-devices, then fwupdmgr update'); return;
      case 'check-updates': { const r = await window.agent.checkUpdates(); if (!r.ok) return toast('Update check failed: ' + r.error, true); const cur = S.status.version || VERSION; const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }; const has = r.latest && newer(r.latest, cur); toast(has ? `Version ${r.latest} is available` : `You are on the latest version (${cur})`); if (has && r.url) window.agent.openExternal(r.url); return; }
      case 'reset-overrides': { for (const dd of S.devices) { const profs = JSON.parse(JSON.stringify(dd.config.profiles)); if (profs[key]) { const keep = { name: profs[key].name, match: profs[key].match }; profs[key] = keep; merge(await call('set_profiles', { id: dd.id, profiles: profs })); } } toast('Overrides cleared'); render(); return; }
      case 'reset-buttons': { const defs = ((await window.agent.call('defaults', { id: d.id })).profiles || {}).default || {}; const btns = defs.buttons || {}; for (const cid of Object.keys(btns)) await setAssign(d, 'buttons', cid, btns[cid]); if (defs.thumbwheel) await setAssign(d, 'thumbwheel', null, defs.thumbwheel); toast('Buttons reset to defaults'); render(); return; }
      case 'reset-keys': { const defs = ((await window.agent.call('defaults', { id: d.id })).profiles || {}).default || {}; const keys = defs.keys || {}; for (const [cid] of FKEYS.concat(SKEYS.map(x => [x[0]]))) await setAssign(d, 'keys', cid, keys[cid] || 'native'); toast('Keys reset to defaults'); render(); return; }
      case 'app-detail': { const p = allProfiles().find(x => x.key === key); S.appDetail = key === 'default' ? { key: 'default', name: 'Default' } : Object.assign({ key }, p || { name: key }); S.menu = null; render(); return; }
      case 'add-app': prompt('Add application', [{ key: 'name', label: 'Name', placeholder: 'Firefox', list: (S.apps || []).map(a => ({ value: a.name })) }, { key: 'cls', label: 'Window class to match', placeholder: 'firefox', value: S.status.app || '', list: (S.apps || []).filter(a => a.wm_class || a.id).map(a => ({ value: a.wm_class || a.id, label: a.name })) }], v => addProfile(v.name, v.cls), 'Add', S.status.app ? `Currently focused: ${esc(S.status.app)}` : ''); return;
      case 'add-app-quick': await addProfile(b.dataset.name, b.dataset.cls); return;
      case 'rename-profile': prompt('Rename profile', [{ key: 'name', label: 'Name', value: (S.appDetail || {}).name }], async v => { for (const dd of S.devices) { const profs = JSON.parse(JSON.stringify(dd.config.profiles)); if (profs[key]) { profs[key].name = v.name; merge(await call('set_profiles', { id: dd.id, profiles: profs })); } } S.appDetail.name = v.name; render(); }, 'Rename'); return;
      case 'del-profile': { if (!confirm('Remove this profile on all devices?')) return; for (const dd of S.devices) { const profs = JSON.parse(JSON.stringify(dd.config.profiles)); if (profs[key]) { delete profs[key]; merge(await call('set_profiles', { id: dd.id, profiles: profs })); } } S.appDetail = null; render(); return; }
      case 'ov-reset': { const dd = S.devices.find(x => x.id === b.dataset.dev); const profs = JSON.parse(JSON.stringify(dd.config.profiles)); const sect = profs[b.dataset.profile][b.dataset.section]; if (sect) delete sect[b.dataset.cid]; merge(await call('set_profiles', { id: dd.id, profiles: profs })); render(); return; }
      case 'export': { const cfg = await call('export_config'); const p = await window.agent.saveJson('openoptions-settings.json', cfg); if (p) toast('Saved ' + p); S.menu = null; return; }
      case 'import': { const cfg = await window.agent.openJson(); if (!cfg) return; await call('import_config', { config: cfg }); toast('Settings imported'); S.menu = null; refresh(); return; }
      case 'reset-all': { if (!confirm('Reset every device to default settings and assignments?')) return; for (const dd of S.devices) merge(await call('reset_device', { id: dd.id })); toast('Reset to defaults'); render(); return; }
      case 'show-config': window.agent.openPath(S.status.config_path || '~/.config/openoptions'); return;
      case 'sync-device': { const dd = S.devices.find(x => x.id === key); try { merge(await call('sync_from_device', { id: key })); toast(`${dd.name}: settings read from device`); } catch (x) { merge(await call('device', { id: key })); } render(); return; }
      case 'restore-backup': { if (!confirm('Restore this backup? Current settings are backed up first.')) return; await call('restore_backup', { file: key }); toast('Backup restored'); refresh(); return; }
      case 'create-backup': { await call('create_backup', { note: 'Manual' }); S.backups = await call('list_backups'); toast('Backup written'); render(); return; }
      case 'pair': S.pair = { step: 1, found: [] }; S.dlg = 'pair'; S.menu = null; render(); return;
      case 'pair-next': {
        if (S.pair.step === 1 || (S.pair.step === 2 && S.pair.error)) { S.pair.step = 2; S.pair.error = null; S.pair.found = []; render(); try { await call('pair_start'); } catch (x) { S.pair.error = x.message || 'Pairing is not available'; render(); } return; }
        if (S.pair.step === 3) { S.dlg = null; render(); return; }
        return;
      }
      case 'pair-confirm': { try { await call('pair_confirm', { address: key }); S.pair.step = 3; S.pair.done = 'Pairing… the device joins when it confirms'; } catch (x) { S.pair.error = x.message; } render(); return; }
      case 'pair-cancel': call('pair_cancel').catch(() => {}); S.dlg = null; render(); return;
      case 'prompt-ok': { const p = S.prompt; const vals = {}; for (const f of p.fields) vals[f.key] = f.value || ''; S.dlg = null; await p.onOk(vals); return; }
      case 'export-diag': { const diag = { status: S.status, devices: S.devices, config: await call('export_config'), logs: S.logs, ui: S.ui, when: new Date().toISOString() }; const p = await window.agent.saveJson('openoptions-diagnostics.json', diag); if (p) toast('Saved ' + p); return; }
      case 'copy-diag': window.agent.copy(S.logs.map(l => l.t).join('\n') || JSON.stringify(S.status)); toast('Copied'); return;
      case 'refresh-logs': await loadLogs(); render(); return;
      case 'install-udev': { const r = await window.agent.installUdev(); toast(r && r.ok ? 'Rule installed, re-plug the receiver' : (r && r.error) || 'Failed', !(r && r.ok)); setTimeout(refresh, 2000); return; }
      case 'onboard': S.mode = 'onboard'; S.ob = { step: 1, preset: 'gnome' }; render(); return;
      case 'ob-close': S.mode = 'app'; try { localStorage.setItem('onboarded', '1'); } catch (x) {} render(); return;
      case 'ob-step': S.ob.step = Number(key); render(); return;
      case 'ob-prev': S.ob.step = Math.max(1, S.ob.step - 1); render(); return;
      case 'ob-next': if (S.ob.step < 3) { S.ob.step++; render(); } else { await applyPreset(S.ob.preset); S.mode = 'app'; try { localStorage.setItem('onboarded', '1'); } catch (x) {} render(); } return;
      case 'ob-preset': S.ob.preset = key; render(); return;
    }
  }
  async function addProfile(name, cls) {
    name = (name || '').trim(); cls = (cls || '').trim();
    if (!name || !cls) return toast('Name and window class are required', true);
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    for (const dd of S.devices) { const profs = JSON.parse(JSON.stringify(dd.config.profiles)); if (!profs[key]) { profs[key] = { name, match: [cls] }; merge(await call('set_profiles', { id: dd.id, profiles: profs })); } }
    S.appDetail = { key, name, match: [cls] }; render();
  }
  async function applyPreset(k) {
    const P = { gnome: { tap: 'overview', up: 'workspace_prev', down: 'workspace_next', left: 'tab_prev', right: 'tab_next' },
      mac: { tap: 'overview', up: 'maximize', down: 'show_desktop', left: 'workspace_prev', right: 'workspace_next' },
      win: { tap: 'overview', up: 'maximize', down: 'minimize', left: 'app_switcher', right: 'app_switcher' } }[k];
    for (const d of S.devices.filter(isMouse)) {
      const g = { type: 'gesture', label: `${k === 'gnome' ? 'GNOME' : k === 'mac' ? 'macOS-like' : 'Windows-like'} preset`, threshold: 60 };
      for (const [slot, preset] of Object.entries(P)) { g[slot === 'tap' ? 'click' : slot] = Object.assign({}, S.presets.all[preset], { preset }); }
      await setAssign(d, 'buttons', gestureControl(d), g);
      if (k !== 'gnome') await setAssign(d, 'thumbwheel', '', k === 'mac' ? 'workspaces_wheel' : 'hscroll');
    }
    toast('Preset applied');
  }

  // --------------------------------------------------------- lifecycle
  async function loadLogs() { try { S.logs = (await window.agent.call('logs')).map(t => ({ t, c: /WARN/.test(t) ? 'warn' : /ERR|fatal/.test(t) ? 'err' : 'dim' })); } catch (e) { S.logs = []; } }
  async function refresh() {
    try {
      S.devices = await window.agent.call('devices');
      if (!S.presets) S.presets = await window.agent.call('presets');
      S.status = await window.agent.call('status');
      S.general = S.status.general || {}; S.conflicts = S.status.conflicts || [];
      if (!S.apps) window.agent.call('applications').then(a => { S.apps = a; }).catch(() => { S.apps = []; });
      try { S.backups = await window.agent.call('list_backups'); } catch (e) { S.backups = []; }
      for (const d of S.devices) { try { S.history[d.id] = await window.agent.call('battery_history', { id: d.id }); } catch (e) {} }
      if (!S.dev || !S.devices.some(d => d.id === S.dev)) { S.dev = S.devices.length ? S.devices[0].id : null; if (S.dev && !generalPages.includes(S.page)) S.page = devicePages(S.devices[0])[0]; }
      S.connected = true;
      if (S.page === 'about') await loadLogs();
    } catch (e) { S.connected = false; }
    render();
  }
  document.addEventListener('click', () => { if (S.menu) { S.menu = null; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.dlg && !recorder) { S.dlg = null; render(); } });
  window.agent.onStatus(st => { S.connected = !!st.connected; if (st.connected) refresh(); else { S.devices = []; render(); } });
  window.agent.onEvent(msg => {
    const { event, data } = msg;
    if (event === 'device' || event === 'device_added') { merge(data); if (!S.dev) S.dev = data.id; render(); }
    else if (event === 'device_removed') { S.devices = S.devices.filter(d => d.id !== data.id); if (S.dev === data.id) S.dev = S.devices[0] ? S.devices[0].id : null; render(); }
    else if (event === 'battery') { const d = S.devices.find(x => x.id === data.id); if (d) { d.battery = data.battery; render(); } }
    else if (event === 'app') { S.status.app = data.app || ''; }
    else if (event === 'profile') { const d = S.devices.find(x => x.id === data.id); if (d) d.profile = data.profile; }
    else if (event === 'backlight') { const d = S.devices.find(x => x.id === data.id); if (d && d.state && d.state.backlight) { d.state.backlight.current_level = data.level; if (S.page === 'backlight') render(); } }
    else if (event === 'pair') { if (S.dlg === 'pair') { if (data.found) S.pair.found = data.found; if (data.error) S.pair.error = data.error; if (data.passkey) S.pair.passkey = data.passkey; if (data.done) { S.pair.step = 3; S.pair.done = data.done; } if (data.timeout !== undefined) S.pair.timeout = data.timeout; if (data.status === 'cancelled') S.pair.error = S.pair.error || 'Cancelled'; render(); } }
  });
  render();
  (async () => {
    S.ui = (await window.agent.uiSettings()) || {};
    S.appInfo = (await window.agent.appInfo()) || {};
    let onboarded = false; try { onboarded = localStorage.getItem('onboarded') === '1'; } catch (e) {}
    if (!onboarded) S.mode = 'onboard';
    const c = await window.agent.connected();
    if (c) { S.connected = true; await refresh(); } else render();
  })();
})();
