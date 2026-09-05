// Tray status panel: device battery, Easy-Switch, and the three tray actions.
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function render(st) {
    document.documentElement.setAttribute('data-theme', st.theme || 'light');
    const devs = (st.devices || []).map(d => {
      const b = d.battery; const pct = b ? b.percent : null;
      const color = pct === null ? 'var(--dim)' : pct <= 10 ? 'var(--err)' : pct <= 20 ? 'var(--warn)' : 'var(--ok)';
      const label = pct === null ? 'battery n/a' : `${pct}%${b.charging ? ' · charging' : pct <= 20 ? ' · charge soon' : ''}`;
      const hosts = d.state && d.state.hosts ? d.state.hosts.names.filter(h => h.paired).map(h => `<button class="${h.index === d.state.hosts.current ? 'on' : ''}" data-dev="${d.id}" data-host="${h.index}" title="${esc(h.name || 'host ' + (h.index + 1))}">${h.index + 1}</button>`).join('') : '';
      return `<div class="dev"><div class="top"><span class="name"><i class="fa-solid ${d.kind === 'keyboard' ? 'fa-keyboard' : 'fa-computer-mouse'}"></i>${esc(d.name)}</span><span class="bat" style="color:${color}">${label}</span></div>` +
        `<div class="bar"><div style="width:${pct === null ? 0 : pct}%;background:${color}"></div></div>` +
        (hosts ? `<div class="hosts"><span class="l">Easy-Switch</span>${hosts}</div>` : '') + `</div>`;
    }).join('');
    document.getElementById('pop').innerHTML =
      (st.connected ? (devs || '<div class="empty">No devices found</div>') : '<div class="empty">Agent not running</div>') +
      `<div class="sep"></div>` +
      `<button class="act" data-act="open"><i class="fa-solid fa-window-maximize"></i>Open OpenOptions</button>` +
      `<button class="act" data-act="pause"><i class="fa-solid ${st.paused ? 'fa-play' : 'fa-pause'}"></i>${st.paused ? 'Resume diversion' : 'Pause diversion'}</button>` +
      `<button class="act" data-act="quit"><i class="fa-solid fa-power-off"></i>Quit</button>`;
  }
  document.addEventListener('click', ev => {
    const h = ev.target.closest('.hosts button'); if (h) { window.tray.action('host', { id: h.dataset.dev, host: Number(h.dataset.host) }); return; }
    const a = ev.target.closest('.act'); if (a) window.tray.action(a.dataset.act);
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') window.tray.action('close'); });
  window.tray.onState(render);
  window.tray.state().then(render);
})();
