// OpenOptions UI: Electron main process. Talks to the C++ agent over a UNIX socket,
// keeps a tray indicator with battery levels and raises low battery notifications.
const { app, BrowserWindow, ipcMain, nativeTheme, Tray, Menu, Notification, nativeImage, dialog, shell, clipboard, globalShortcut, screen } = require('electron');
app.setName('OpenOptions');
const PACKAGED = app.isPackaged;
const APPIMAGE = process.env.APPIMAGE || '';
const WM_CLASS = PACKAGED ? 'openoptions' : 'OpenOptions';
// files shipped next to the app: repo root in development, resources/ in a package
const resPath = (...p) => PACKAGED ? path.join(process.resourcesPath, ...p) : path.join(__dirname, '..', ...p);
// how to launch this very app again (autostart, desktop entry)
const launchCmd = () => APPIMAGE ? `"${APPIMAGE}"` : PACKAGED ? process.execPath : `${process.execPath} ${__dirname} --no-sandbox --class=OpenOptions`;
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const UI_SETTINGS_PATH = path.join(app.getPath('userData'), 'ui-settings.json');
function loadUi() { try { return JSON.parse(fs.readFileSync(UI_SETTINGS_PATH, 'utf8')); } catch (e) { return { tray: true, minimize: true, updates: true }; } }
function saveUi(u) { try { fs.mkdirSync(path.dirname(UI_SETTINGS_PATH), { recursive: true }); fs.writeFileSync(UI_SETTINGS_PATH, JSON.stringify(u, null, 2)); } catch (e) {} }
let uiSettings = null;
const net = require('net');
const os = require('os');

const SOCKET = path.join(process.env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`, 'openoptions.sock');
const LOW = 20, CRITICAL = 10;

let win = null;
let tray = null;
let sock = null;
let connected = false;
let buffer = '';
let nextId = 1;
const pending = new Map();
let devices = [];                 // last known device summaries
let general = {};                 // agent general settings (notifications, overlays)
let paused = false;
let osdWin = null;
let osdTimer = null;
const alerted = new Map();        // device id -> 'low' | 'critical'
app.isQuitting = false;

function send(obj) {
  if (!sock || !connected) return false;
  sock.write(JSON.stringify(obj) + '\n');
  return true;
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    if (!connected) return reject(new Error('agent not connected'));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ id, method, params: params || {} });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); }
    }, 8000);
  });
}

function notify(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ------------------------------------------------------------------ battery
function checkBattery(d) {
  const b = d.battery;
  if (!b) return;
  if (general.notify_low === false) return;
  const low = general.notify_low_threshold || LOW;
  const prev = alerted.get(d.id);
  if (b.charging || b.percent > low) { if (prev) alerted.delete(d.id); return; }
  const level = b.percent <= CRITICAL ? 'critical' : 'low';
  if (prev === level || (prev === 'critical' && level === 'low')) return;
  alerted.set(d.id, level);
  if (Notification.isSupported()) {
    new Notification({
      title: `${d.name}: battery ${level}`,
      body: `${b.percent}% left. ${d.kind === 'keyboard' ? 'Plug in the USB-C cable to charge.' : 'Charge it soon.'}`,
      urgency: level === 'critical' ? 'critical' : 'normal',
      icon: path.join(__dirname, 'assets', 'icon.png'),
    }).show();
  }
}

// --------------------------------------------------------------------- tray
function trayIcon(warn) {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', warn ? 'tray-warn.png' : 'tray.png'));
  img.setTemplateImage(false);
  return img;
}

const menuIcon = n => nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray', n + '.png'));
const batteryBar = pct => { const n = Math.round(Math.max(0, Math.min(100, pct)) / 10); return '▰'.repeat(n) + '▱'.repeat(10 - n); };
function updateTray() {
  if (!tray) return;
  const warn = devices.some(d => d.battery && !d.battery.charging && d.battery.percent <= LOW);
  tray.setImage(trayIcon(warn));
  const lines = devices.map(d => {
    const b = d.battery;
    return `${d.name}: ${b ? b.percent + '%' + (b.charging ? ' charging' : '') : 'battery n/a'}`;
  });
  tray.setToolTip(connected ? (lines.length ? lines.join('\n') + (paused ? '\nDiversion paused' : '') : 'OpenOptions: no devices') : 'OpenOptions: agent not running');
  const items = [];
  if (!connected) items.push({ label: 'Agent not running', enabled: false });
  else if (!devices.length) items.push({ label: 'No devices', enabled: false });
  for (const d of devices) {
    const b = d.battery;
    const bat = b ? `${b.percent}%${b.charging ? ' · charging' : b.percent <= LOW ? ' · charge soon' : ''}` : 'battery n/a';
    items.push({ label: `${d.name}   ${bat}`, icon: menuIcon(d.kind === 'keyboard' ? 'keyboard' : 'mouse'), enabled: false });
    if (b) items.push({ label: `      ${batteryBar(b.percent)}`, enabled: false });
    if (d.state && d.state.hosts) {
      items.push({ label: '      Easy-Switch', enabled: false });
      for (const h of d.state.hosts.names.filter(h => h.paired)) {
        const cur = h.index === d.state.hosts.current;
        items.push({ label: `      ${cur ? '●' : '○'}  ${h.index + 1}   ${h.name || 'host ' + (h.index + 1)}`, enabled: !cur, click: () => rpc('change_host', { id: d.id, host: h.index }).catch(() => {}) });
      }
    }
    items.push({ type: 'separator' });
  }
  items.push({ label: 'Open OpenOptions', icon: menuIcon('window'), click: showWindow });
  items.push({ label: paused ? 'Resume diversion' : 'Pause diversion', icon: menuIcon(paused ? 'play' : 'pause'), enabled: connected, click: () => rpc(paused ? 'resume_diversion' : 'pause_diversion').then(() => refreshGeneral().then(updateTray)).catch(() => {}) });
  items.push({ label: 'Status panel', icon: menuIcon('panel'), click: () => showTrayPanel() });
  items.push({ label: 'Quit', icon: menuIcon('power'), click: () => { app.isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  pushTrayState();
}

// --------------------------------------------------------- tray status panel
let trayWin = null;
const TRAY_W = 340;
function trayState() { uiSettings = uiSettings || loadUi(); return { connected, paused, devices, theme: uiSettings.theme || 'light' }; }
function pushTrayState() { if (trayWin && !trayWin.isDestroyed()) trayWin.webContents.send('tray-state', trayState()); }
function ensureTrayPanel() {
  if (trayWin && !trayWin.isDestroyed()) return trayWin;
  trayWin = new BrowserWindow({
    width: TRAY_W, height: 320, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-tray.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  trayWin.loadFile(path.join(__dirname, 'renderer', 'tray.html'));
  trayWin.on('blur', () => { if (trayWin && !trayWin.isDestroyed() && trayWin.isVisible()) trayWin.hide(); });
  return trayWin;
}
function showTrayPanel() {
  const w = ensureTrayPanel();
  if (w.isVisible()) { w.hide(); return; }
  const n = devices.length || 1;
  const height = 8 + n * 96 + 9 + 3 * 40 + 8;
  let a; try { const tb = tray && tray.getBounds(); a = screen.getDisplayNearestPoint(tb && tb.width ? { x: tb.x, y: tb.y } : screen.getCursorScreenPoint()).workArea; } catch (e) { a = screen.getPrimaryDisplay().workArea; }
  w.setBounds({ x: Math.round(a.x + a.width - TRAY_W - 12), y: Math.round(a.y + 8), width: TRAY_W, height });
  const send = () => { w.show(); w.focus(); pushTrayState(); };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
}
ipcMain.handle('tray-state', () => trayState());
ipcMain.handle('tray-panel', () => showTrayPanel());
ipcMain.handle('tray-action', async (_e, name, params) => {
  if (name === 'close') { if (trayWin && !trayWin.isDestroyed()) trayWin.hide(); return; }
  if (name === 'open') { if (trayWin && !trayWin.isDestroyed()) trayWin.hide(); showWindow(); return; }
  if (name === 'quit') { app.isQuitting = true; app.quit(); return; }
  if (name === 'pause') { const want = !paused; paused = want; pushTrayState(); try { await rpc(want ? 'pause_diversion' : 'resume_diversion'); await refreshGeneral(); } catch (e) {} updateTray(); return; }
  if (name === 'host') { try { await rpc('change_host', { id: params.id, host: params.host }); } catch (e) {} return; }
});

async function refreshDevices() {
  try {
    const st = await rpc('status');
    general = st.general || {};
    paused = !!st.paused;
    devices = await rpc('devices');
    devices.forEach(checkBattery);
  } catch (e) { devices = []; }
  updateTray();
}
async function refreshGeneral() { try { const st = await rpc('status'); general = st.general || {}; paused = !!st.paused; } catch (e) {} }

function mergeDevice(summary) {
  const i = devices.findIndex(d => d.id === summary.id);
  if (i >= 0) devices[i] = summary; else devices.push(summary);
  checkBattery(summary);
  updateTray();
}

// ------------------------------------------------------------------- socket
function connect() {
  if (sock) return;
  sock = net.createConnection(SOCKET);
  sock.setEncoding('utf8');
  sock.on('connect', () => {
    connected = true;
    notify('agent-status', { connected: true });
    refreshDevices();
  });
  sock.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.event) {
        handleEvent(msg.event, msg.data);
        notify('agent-event', msg);
        continue;
      }
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
      }
    }
  });
  const drop = () => {
    connected = false;
    sock = null;
    buffer = '';
    for (const [, p] of pending) p.reject(new Error('agent disconnected'));
    pending.clear();
    devices = [];
    updateTray();
    notify('agent-status', { connected: false });
    setTimeout(connect, 1500);
  };
  sock.on('error', drop);
  sock.on('close', drop);
}

function handleEvent(event, data) {
  if (event === 'device' || event === 'device_added') {
    const isNew = event === 'device_added' && !devices.some(d => d.id === data.id);
    mergeDevice(data);
    if (isNew && general.notify_connect && Notification.isSupported()) new Notification({ title: `${data.name} connected`, body: data.battery ? `Battery ${data.battery.percent}%` : '', icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  }
  else if (event === 'device_removed') {
    const d = devices.find(x => x.id === data.id);
    devices = devices.filter(x => x.id !== data.id); alerted.delete(data.id); updateTray();
    if (d && general.notify_connect && Notification.isSupported()) new Notification({ title: `${d.name} disconnected`, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  }
  else if (event === 'action') { if (data.kind === 'emoji') showEmoji(`${data.device || 'Keyboard'} · Emoji key`); else showOsd(data); }
  else if (event === 'paused') { paused = !!data.paused; updateTray(); }
  else if (event === 'battery') {
    const d = devices.find(x => x.id === data.id);
    if (d) { d.battery = data.battery; checkBattery(d); updateTray(); }
  } else if (event === 'profile') {
    const d = devices.find(x => x.id === data.id);
    if (d) { d.profile = data.profile; updateTray(); }
  }
}

// --------------------------------------------------------------------- OSD
function osdEnabled(kind) {
  if (general.osd_enabled === false) return false;
  const ev = Object.assign({ mic: true, smartshift: true, backlight: true, host: true, dpi: false }, general.osd_events || {});
  return ev[kind] !== false;
}
function ensureOsd() {
  if (osdWin && !osdWin.isDestroyed()) return osdWin;
  osdWin = new BrowserWindow({
    width: 460, height: 90, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false,
    hasShadow: false, show: false, type: 'notification',
    webPreferences: { preload: path.join(__dirname, 'preload-osd.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  osdWin.setIgnoreMouseEvents(true);
  osdWin.setAlwaysOnTop(true, 'screen-saver');
  osdWin.loadFile(path.join(__dirname, 'renderer', 'osd.html'));
  return osdWin;
}
function positionOsd() {
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const a = disp.workArea;
  const pos = general.osd_position || 'bottom';
  const x = Math.round(a.x + (a.width - 460) / 2);
  const y = pos === 'top' ? a.y + 40 : pos === 'center' ? Math.round(a.y + (a.height - 90) / 2) : a.y + a.height - 130;
  osdWin.setPosition(x, y);
}
async function micMuted() {
  return new Promise(resolve => execFile('pactl', ['get-source-mute', '@DEFAULT_SOURCE@'], { timeout: 1500 }, (err, out) => resolve(err ? null : /yes/i.test(String(out)))));
}
async function showOsd(data) {
  if (!osdEnabled(data.kind)) return;
  let msg = { kind: data.kind, duration: general.osd_duration || 1500, theme: (uiSettings && uiSettings.theme) || 'light' };
  if (data.kind === 'mic') { const m = await micMuted(); msg.title = m === null ? 'Microphone' : m ? 'Microphone muted' : 'Microphone on'; msg.sub = m === null ? 'Toggled' : m ? 'Press again to unmute' : 'Press again to mute'; }
  else if (data.kind === 'smartshift') { msg.title = data.mode === 'ratchet' ? 'Ratchet' : 'Free-spin'; msg.sub = `Scroll wheel · SmartShift ${data.mode === 'ratchet' ? 'on' : 'off'}`; }
  else if (data.kind === 'backlight') { msg.title = 'Backlight'; msg.sub = `Level ${data.level} of ${(data.num_levels || 8) - 1}`; msg.level = data.level; msg.num_levels = (data.num_levels || 8) - 1; }
  else if (data.kind === 'host') { const d = devices.find(x => x.id === data.id); const name = d && d.state && d.state.hosts && d.state.hosts.names[data.host] ? d.state.hosts.names[data.host].name : ''; msg.title = `Switched to ${name || 'host ' + (data.host + 1)}`; msg.sub = `${data.device || ''} · host ${data.host + 1}`; msg.host = data.host; }
  else if (data.kind === 'dpi') { msg.title = `${data.dpi} DPI`; msg.sub = data.device || ''; }
  const w = ensureOsd();
  const send = () => { positionOsd(); w.showInactive(); w.webContents.send('osd-show', msg); clearTimeout(osdTimer); osdTimer = setTimeout(() => { if (w && !w.isDestroyed()) w.hide(); }, (msg.duration || 1500) + 400); };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
}
ipcMain.on('osd-hidden', () => { if (osdWin && !osdWin.isDestroyed()) osdWin.hide(); });

// ------------------------------------------------------------- emoji picker
let emojiWin = null;
const EMOJI_W = 380, EMOJI_H = 460;
function ensureEmoji() {
  if (emojiWin && !emojiWin.isDestroyed()) return emojiWin;
  emojiWin = new BrowserWindow({
    width: EMOJI_W, height: EMOJI_H, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-emoji.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  emojiWin.setAlwaysOnTop(true, 'pop-up-menu');
  emojiWin.loadFile(path.join(__dirname, 'renderer', 'emoji.html'));
  emojiWin.on('blur', () => { if (emojiWin && !emojiWin.isDestroyed() && emojiWin.isVisible()) emojiWin.hide(); });
  return emojiWin;
}
// Electron's getCursorScreenPoint() goes stale on X11 while no Electron window has the pointer,
// so ask the X server directly when we can.
function cursorPoint() {
  return new Promise(resolve => {
    const fallback = () => resolve(screen.getCursorScreenPoint());
    if ((process.env.XDG_SESSION_TYPE || '').toLowerCase() !== 'x11' && !process.env.DISPLAY) return fallback();
    execFile('xdotool', ['getmouselocation', '--shell'], { timeout: 500 }, (err, out) => {
      if (err) return fallback();
      const m = /X=(-?\d+)\s+Y=(-?\d+)/.exec(String(out));
      if (!m) return fallback();
      resolve({ x: Number(m[1]), y: Number(m[2]) });
    });
  });
}
async function showEmoji(source) {
  const w = ensureEmoji();
  if (w.isVisible()) { w.hide(); return; }
  uiSettings = uiSettings || loadUi();
  const pt = await cursorPoint();
  const a = screen.getDisplayNearestPoint(pt).workArea;
  const x = Math.max(a.x, Math.min(a.x + a.width - EMOJI_W, pt.x - EMOJI_W / 2));
  const y = Math.max(a.y, Math.min(a.y + a.height - EMOJI_H, pt.y + 24));
  const X = Math.round(x), Y = Math.round(y);
  const place = () => { if (w.isDestroyed()) return; const [cx, cy] = w.getPosition(); if (cx !== X || cy !== Y) w.setPosition(X, Y); };
  const send = () => {
    w.setPosition(X, Y); w.show(); place(); w.focus();
    setTimeout(place, 40); setTimeout(place, 160);   // the window manager may re-place a freshly mapped window
    w.webContents.send('emoji-show', { theme: uiSettings.theme || 'light', recent: uiSettings.emojiRecent || [], source: source || 'Emoji key' });
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
}
ipcMain.on('emoji-close', () => { if (emojiWin && !emojiWin.isDestroyed()) emojiWin.hide(); });
ipcMain.on('emoji-pick', async (_e, { ch }) => {
  if (emojiWin && !emojiWin.isDestroyed()) emojiWin.hide();
  uiSettings = uiSettings || loadUi();
  uiSettings.emojiRecent = [ch].concat((uiSettings.emojiRecent || []).filter(x => x !== ch)).slice(0, 16);
  saveUi(uiSettings);
  const previous = clipboard.readText();
  clipboard.writeText(ch);
  await new Promise(r => setTimeout(r, 120));   // let focus return to the previous window
  try { await rpc('play_action', { action: { type: 'keystroke', keys: ['KEY_LEFTCTRL', 'KEY_V'] } }); }
  catch (e) { if (Notification.isSupported()) new Notification({ title: 'Emoji copied', body: `${ch} is on the clipboard (agent not reachable to paste)`, icon: path.join(__dirname, 'assets', 'icon.png') }).show(); }
  setTimeout(() => { try { if (clipboard.readText() === ch && previous) clipboard.writeText(previous); } catch (e) {} }, 800);
});
ipcMain.handle('emoji-show', () => showEmoji('Preview'));
ipcMain.handle('screen-info', () => ({ cursor: screen.getCursorScreenPoint(), displays: screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor })), picker: emojiWin && !emojiWin.isDestroyed() ? { visible: emojiWin.isVisible(), bounds: emojiWin.getBounds() } : null }));
ipcMain.handle('osd-test', (_e, kind) => kind === 'emoji' ? showEmoji('Preview') : showOsd({ kind, mode: 'freespin', level: 5, num_levels: 8, host: 1, dpi: 1600, device: 'MX Master 3S' }));
ipcMain.handle('general-changed', async () => { await refreshGeneral(); updateTray(); });
ipcMain.handle('set-theme', (_e, theme) => { uiSettings = uiSettings || loadUi(); uiSettings.theme = theme; saveUi(uiSettings); });

function registerShortcuts() {
  for (const n of [1, 2, 3]) globalShortcut.register(`Super+Alt+${n}`, () => { for (const d of devices) rpc('change_host', { id: d.id, host: n - 1 }).catch(() => {}); });
  globalShortcut.register('Super+Alt+O', async () => { const on = general.osd_enabled === false; try { general = await rpc('set_general', { osd_enabled: on }); } catch (e) {} if (Notification.isSupported()) new Notification({ title: `Overlays ${on ? 'on' : 'off'}`, icon: path.join(__dirname, 'assets', 'icon.png') }).show(); });
  globalShortcut.register('Super+Alt+P', () => rpc(paused ? 'resume_diversion' : 'pause_diversion').then(() => refreshGeneral().then(updateTray)).catch(() => {}));
}

// ------------------------------------------------------------------- window
function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0e1116',
    title: 'OpenOptions',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    frame: false,
    show: !process.argv.includes('--hidden') && !(uiSettings && uiSettings.start_hidden),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', e => {
    const keep = !uiSettings || uiSettings.minimize !== false;
    if (!app.isQuitting && tray && keep) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

ipcMain.handle('rpc', (_e, method, params) => rpc(method, params));
ipcMain.handle('agent-connected', () => connected);
ipcMain.handle('save-json', async (_e, name, data) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(os.homedir(), name), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
  return r.filePath;
});
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('open-path', (_e, p) => { const full = p.replace(/^~/, os.homedir()); if (fs.existsSync(full) && fs.statSync(full).isFile()) shell.showItemInFolder(full); else shell.openPath(full); });
ipcMain.handle('copy-text', (_e, t) => clipboard.writeText(String(t || '')));
ipcMain.handle('app-info', () => ({ version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron }));
ipcMain.handle('window-action', (_e, a) => {
  if (a === 'close') { if (win) win.close(); }
  else if (a === 'quit') { app.isQuitting = true; app.quit(); }
  else if (a === 'minimize') { if (win) win.minimize(); }
  else if (a === 'show') showWindow();
});
ipcMain.handle('ui-settings', (_e, patch) => {
  uiSettings = uiSettings || loadUi();
  if (patch) {
    Object.assign(uiSettings, patch);
    saveUi(uiSettings);
    if ('tray' in patch) { if (patch.tray && !tray) createTray(); else if (!patch.tray && tray) { tray.destroy(); tray = null; } }
    if ('autostart' in patch) setAutostart(!!patch.autostart);
  }
  return uiSettings;
});
function run(cmd, args) { return new Promise(resolve => execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), error: err ? String(stderr || err.message).trim() : '' }))); }
ipcMain.handle('stop-tool', async (_e, name) => {
  if (name === 'solaar') return run('pkill', ['-x', 'solaar']).then(r => ({ ok: true }));
  if (name === 'logid') { const r = await run('pkexec', ['systemctl', 'stop', 'logid']); return r.ok ? { ok: true } : { ok: false, error: r.error || 'cancelled' }; }
  return { ok: false, error: 'unknown tool' };
});
ipcMain.handle('install-udev', async () => {
  const rule = resPath('udev', '60-openoptions.rules');
  if (!fs.existsSync(rule)) return { ok: false, error: 'rule file missing' };
  const script = `cp '${rule}' /etc/udev/rules.d/60-openoptions.rules && udevadm control --reload && udevadm trigger`;
  const r = await run('pkexec', ['sh', '-c', script]);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'cancelled' };
});
function setAutostart(on) {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const agentBin = fs.existsSync(path.join(os.homedir(), '.local', 'bin', 'openoptions-agent')) ? path.join(os.homedir(), '.local', 'bin', 'openoptions-agent') : path.join(__dirname, '..', 'agent', 'build', 'openoptions-agent');
  const unit = `[Unit]\nDescription=OpenOptions agent for MX Master and MX Keys devices\nAfter=graphical-session.target\nPartOf=graphical-session.target\n\n[Service]\nType=simple\nExecStart=${agentBin}\nRestart=on-failure\nRestartSec=2\n\n[Install]\nWantedBy=graphical-session.target\n`;
  try { fs.mkdirSync(unitDir, { recursive: true }); fs.writeFileSync(path.join(unitDir, 'openoptions.service'), unit); } catch (e) { return; }
  execFile('systemctl', ['--user', 'daemon-reload'], () => execFile('systemctl', ['--user', on ? 'enable' : 'disable', 'openoptions.service'], () => {}));
  const autostartDir = path.join(os.homedir(), '.config', 'autostart'), desktop = path.join(autostartDir, 'openoptions.desktop');
  if (on) { try { fs.mkdirSync(autostartDir, { recursive: true }); fs.writeFileSync(desktop, `[Desktop Entry]\nType=Application\nName=OpenOptions\nIcon=openoptions\nExec=${launchCmd()} --hidden\nStartupWMClass=${WM_CLASS}\nX-GNOME-Autostart-enabled=true\n`); } catch (e) {} }
  else { try { fs.unlinkSync(desktop); } catch (e) {} }
}
ipcMain.handle('open-bluetooth', () => { execFile('gnome-control-center', ['bluetooth'], () => execFile('systemsettings', ['kcm_bluetooth'], () => {})); });
ipcMain.handle('check-updates', () => new Promise(resolve => {
  const https = require('https');
  const req = https.get({ host: 'api.github.com', path: '/repos/aabdelghani/openoptions/releases/latest', headers: { 'User-Agent': 'OpenOptions' }, timeout: 8000 }, res => {
    let body = ''; res.on('data', c => body += c); res.on('end', () => { try { const j = JSON.parse(body); resolve({ ok: true, latest: (j.tag_name || '').replace(/^v/, ''), url: j.html_url, current: app.getVersion() }); } catch (e) { resolve({ ok: false, error: 'unexpected reply' }); } });
  });
  req.on('error', e => resolve({ ok: false, error: e.message })); req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
}));
ipcMain.handle('open-json', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
});

const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  function createTray() {
    tray = new Tray(trayIcon(false));
    tray.on('click', showWindow);
    updateTray();
  }
  function ensureDesktopEntry() {
    if (PACKAGED && !APPIMAGE) return;   // the .deb installs its own entry
    try {
      const iconDir = path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor', '256x256', 'apps');
      const appDir = path.join(os.homedir(), '.local', 'share', 'applications');
      fs.mkdirSync(iconDir, { recursive: true }); fs.mkdirSync(appDir, { recursive: true });
      const iconSrc = path.join(__dirname, 'assets', 'icon.png'), iconDst = path.join(iconDir, 'openoptions.png');
      if (!fs.existsSync(iconDst) || fs.statSync(iconDst).size !== fs.statSync(iconSrc).size) fs.copyFileSync(iconSrc, iconDst);
      const entry = `[Desktop Entry]\nType=Application\nName=OpenOptions\nComment=Buttons, gestures, keys and Easy-Switch for MX mice and keyboards\nExec=${launchCmd()}\nIcon=openoptions\nTerminal=false\nCategories=Settings;HardwareSettings;\nKeywords=mouse;keyboard;MX;Bolt;\nStartupWMClass=${WM_CLASS}\nStartupNotify=true\n`;
      const dst = path.join(appDir, 'openoptions.desktop');
      let cur = ''; try { cur = fs.readFileSync(dst, 'utf8'); } catch (e) {}
      if (cur !== entry) { fs.writeFileSync(dst, entry); execFile('update-desktop-database', [appDir], () => {}); execFile('gtk-update-icon-cache', ['-f', '-t', path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor')], () => {}); }
    } catch (e) {}
  }
  let agentChild = null;
  function agentCandidates() {
    const c = [];
    if (PACKAGED) c.push(resPath('agent', 'openoptions-agent'));
    c.push('/usr/bin/openoptions-agent', '/usr/local/bin/openoptions-agent', path.join(os.homedir(), '.local', 'bin', 'openoptions-agent'));
    return c.filter(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (e) { return false; } });
  }
  function maybeStartAgent() {
    if (!PACKAGED || connected || agentChild) return;
    execFile('pgrep', ['-x', 'openoptions-age'], (err, out) => {
      if (!err && String(out).trim()) return;                 // an agent exists, it just is not up yet
      const bin = agentCandidates()[0];
      if (!bin) return;
      try {
        agentChild = spawn(bin, [], { stdio: 'ignore' });
        agentChild.on('exit', () => { agentChild = null; });
      } catch (e) { agentChild = null; }
    });
  }
  app.on('will-quit', () => { if (agentChild) { try { agentChild.kill(); } catch (e) {} } });
  app.whenReady().then(() => {
    ensureDesktopEntry();
    setTimeout(maybeStartAgent, 1500);
    uiSettings = loadUi();
    if (uiSettings.tray !== false) createTray();
    connect();
    createWindow();
    try { registerShortcuts(); } catch (e) {}
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { /* stay in the tray */ });
  app.on('before-quit', () => { app.isQuitting = true; });
}
