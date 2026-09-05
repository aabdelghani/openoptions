// On-screen overlay renderer: receives {kind, ...} from the main process and shows a toast.
(() => {
  const $ = s => document.querySelector(s);
  const KIND = {
    mic: { icon: 'fa-microphone-slash', bg: 'var(--err)' },
    smartshift: { icon: 'fa-arrows-rotate', bg: 'var(--accbg)' },
    backlight: { icon: 'fa-sun', bg: 'var(--warn)' },
    host: { icon: 'fa-right-left', bg: 'var(--ok)' },
    dpi: { icon: 'fa-arrow-pointer', bg: 'var(--accbg)' },
  };
  let hideTimer = null;
  window.osd.onShow(msg => {
    document.documentElement.setAttribute('data-theme', msg.theme || 'light');
    const k = KIND[msg.kind] || KIND.dpi;
    $('#ic').innerHTML = `<i class="fa-solid ${k.icon}"></i>`;
    $('#ic').style.background = k.bg;
    $('#title').textContent = msg.title || '';
    $('#sub').textContent = msg.sub || '';
    const extra = $('#extra'); extra.innerHTML = '';
    if (msg.kind === 'backlight') { const n = msg.num_levels || 8; extra.innerHTML = `<div class="segs">${Array.from({ length: n }, (_, i) => `<span class="${i < msg.level ? 'on' : ''}"></span>`).join('')}</div>`; }
    if (msg.kind === 'host') extra.innerHTML = `<div class="hosts">${[0, 1, 2].map(i => `<span class="${i === msg.host ? 'on' : ''}">${i + 1}</span>`).join('')}</div>`;
    const t = $('#toast');
    t.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { t.classList.remove('show'); window.osd.hidden(); }, msg.duration || 1500);
  });
})();
