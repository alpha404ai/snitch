/* Browser Snitch: shows what any page can read without asking. Nothing is stored or sent, except one IP lookup. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  (() => {
    const h = location.hostname;
    if (h.endsWith('github.io')) {
      const user = h.split('.')[0];
      const repo = location.pathname.split('/').filter(Boolean)[0] || 'snitch';
      $('gh-link').href = `https://github.com/${user}/${repo}`;
    }
  })();

  const toast = (msg) => {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600);
  };

  // ---------------- collectors ----------------
  async function getIP() {
    const tries = [
      async () => {
        const r = await fetch('https://ipwho.is/?fields=ip,success,city,region,country,country_code,latitude,longitude,connection,timezone');
        const j = await r.json();
        if (!j.success) throw 0;
        return { ip: j.ip, city: j.city, region: j.region, country: j.country, cc: j.country_code, lat: j.latitude, lon: j.longitude, isp: j.connection?.isp || j.connection?.org, asn: j.connection?.asn, tz: j.timezone?.id };
      },
      async () => {
        const r = await fetch('https://ipapi.co/json/');
        const j = await r.json();
        if (j.error) throw 0;
        return { ip: j.ip, city: j.city, region: j.region, country: j.country_name, cc: j.country_code, lat: j.latitude, lon: j.longitude, isp: j.org, asn: j.asn, tz: j.timezone };
      },
    ];
    for (const t of tries) {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 5000);
        const res = await t(); clearTimeout(to); return res;
      } catch {}
    }
    return null;
  }

  const flag = (cc) => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '';

  function getGPU() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      let r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      let v = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const raw = r;
      const m = /ANGLE \(([^,]+),\s*(?:ANGLE Metal Renderer:\s*)?([^,(]+)/.exec(r);
      if (m) r = m[2].trim();
      r = r.replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/Direct3D.*$/i, '').trim();
      return { name: r, vendor: v, raw };
    } catch { return null; }
  }

  async function getUA() {
    const ua = navigator.userAgent;
    const out = { os: 'Unknown', browser: 'Unknown', model: '' };
    if (navigator.userAgentData?.getHighEntropyValues) {
      try {
        const h = await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'model', 'architecture', 'bitness', 'fullVersionList']);
        let os = h.platform || '';
        if (os === 'Windows') {
          const major = parseInt(h.platformVersion, 10);
          os = major >= 13 ? 'Windows 11' : major > 0 ? 'Windows 10' : 'Windows';
        } else if (os === 'macOS' && h.platformVersion) os = `macOS ${h.platformVersion.split('.').slice(0, 2).join('.')}`;
        else if (h.platformVersion) os = `${os} ${h.platformVersion.split('.')[0]}`;
        if (h.architecture) os += ` · ${h.architecture === 'arm' ? 'ARM' : h.architecture}${h.bitness ? '-' + h.bitness : ''}`;
        const b = (h.fullVersionList || []).find((x) => !/Not.?A.?Brand|Chromium/i.test(x.brand)) || (h.fullVersionList || [])[0];
        return { os, browser: b ? `${b.brand} ${b.version.split('.')[0]}` : 'Chromium', model: h.model || '' };
      } catch {}
    }
    if (/iPhone/.test(ua)) out.os = 'iOS ' + ((/OS (\d+)_(\d+)/.exec(ua) || []).slice(1).join('.') || '');
    else if (/iPad/.test(ua)) out.os = 'iPadOS';
    else if (/Android ([\d.]+)/.test(ua)) out.os = 'Android ' + /Android ([\d.]+)/.exec(ua)[1];
    else if (/Mac OS X/.test(ua)) out.os = navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
    else if (/Windows/.test(ua)) out.os = 'Windows';
    else if (/Linux/.test(ua)) out.os = 'Linux';
    const bm = /(Firefox|Edg|OPR|SamsungBrowser|CriOS|FxiOS|Chrome|Version)\/(\d+)/.exec(ua);
    if (bm) out.browser = ({ Edg: 'Edge', OPR: 'Opera', CriOS: 'Chrome', FxiOS: 'Firefox', Version: 'Safari', SamsungBrowser: 'Samsung Internet' }[bm[1]] || bm[1]) + ' ' + bm[2];
    return out;
  }

  async function getBattery() {
    try {
      if (!navigator.getBattery) return null;
      const b = await navigator.getBattery();
      return { level: Math.round(b.level * 100), charging: b.charging, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime };
    } catch { return null; }
  }

  async function getMedia() {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      return { cams: d.filter((x) => x.kind === 'videoinput').length, mics: d.filter((x) => x.kind === 'audioinput').length, spk: d.filter((x) => x.kind === 'audiooutput').length };
    } catch { return null; }
  }

  async function adblock() {
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner adsbygoogle pub_300x250 text-ad';
    bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:300px;height:250px;';
    bait.innerHTML = '&nbsp;';
    document.body.appendChild(bait);
    await sleep(120);
    const blocked = !bait.offsetParent || bait.offsetHeight === 0 || getComputedStyle(bait).display === 'none';
    bait.remove();
    return blocked;
  }

  function fonts() {
    const c = document.createElement('canvas').getContext('2d');
    const s = 'mmmmmmmmmmlli1WQ@#';
    const base = ['monospace', 'serif', 'sans-serif'];
    const w0 = base.map((b) => { c.font = `72px ${b}`; return c.measureText(s).width; });
    const has = (f) => base.some((b, i) => { c.font = `72px "${f}", ${b}`; return c.measureText(s).width !== w0[i]; });
    const groups = {
      'Microsoft Office': ['Calibri', 'Cambria', 'Candara', 'Constantia'],
      'Adobe apps': ['Myriad Pro', 'Minion Pro', 'Adobe Garamond Pro', 'Acumin Pro'],
      'Coding fonts': ['Fira Code', 'Hack', 'Source Code Pro', 'Inconsolata', 'Cascadia Code'],
      'Designer fonts': ['Helvetica Neue', 'Futura', 'Gotham', 'Proxima Nova', 'Avenir Next'],
    };
    const found = {}; const all = [];
    for (const [g, list] of Object.entries(groups)) {
      const hit = list.filter(has);
      if (hit.length) found[g] = hit;
      all.push(...hit);
    }
    return { found, all };
  }

  function canvasPrint() {
    try {
      const c = document.createElement('canvas'); c.width = 280; c.height = 60;
      const x = c.getContext('2d');
      x.textBaseline = 'top'; x.font = '16px Arial';
      x.fillStyle = '#f60'; x.fillRect(110, 1, 62, 20);
      x.fillStyle = '#069'; x.fillText('Snitch 🐀 fingerprint, 0.1', 2, 15);
      x.fillStyle = 'rgba(102,204,0,0.7)'; x.fillText('Snitch 🐀 fingerprint, 0.1', 4, 17);
      const g = x.createLinearGradient(0, 0, 280, 0); g.addColorStop(0, '#f0f'); g.addColorStop(1, '#0ff');
      x.fillStyle = g; x.beginPath(); x.arc(240, 30, 20, 0, Math.PI * 2); x.fill();
      return c.toDataURL();
    } catch { return ''; }
  }

  async function sha(str) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
      return (h >>> 0).toString(16).padStart(8, '0').repeat(2);
    }
  }

  function visits() {
    try {
      const k = 'snitch_seen';
      const prev = JSON.parse(localStorage.getItem(k) || 'null');
      const now = Date.now();
      const v = prev ? { n: prev.n + 1, first: prev.first } : { n: 1, first: now };
      localStorage.setItem(k, JSON.stringify(v));
      return v;
    } catch { return null; }
  }

  function referrer() {
    if (!document.referrer) return null;
    try {
      const u = new URL(document.referrer);
      if (u.hostname === location.hostname) return null;
      const h = u.hostname.replace(/^www\./, '');
      const nice = { 't.co': 'X (Twitter)', 'x.com': 'X (Twitter)', 'twitter.com': 'X (Twitter)', 'reddit.com': 'Reddit', 'old.reddit.com': 'Reddit', 'google.com': 'Google', 'news.ycombinator.com': 'Hacker News', 'l.instagram.com': 'Instagram', 'l.facebook.com': 'Facebook', 'lm.facebook.com': 'Facebook', 'out.reddit.com': 'Reddit', 'github.com': 'GitHub', 't.me': 'Telegram' }[h];
      return nice || h;
    } catch { return null; }
  }

  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const ago = (ms) => { const m = Math.round(ms / 60000); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 48) return `${h} h ago`; return `${Math.round(h / 24)} days ago`; };

  // ---------------- rendering ----------------
  let facts = [];
  let map = null;

  function card(gridId, k, v, note, hot) {
    facts.push({ k, v });
    const d = document.createElement('div');
    d.className = 'ev' + (hot ? ' hot' : '');
    d.innerHTML = `<div class="k"><span>${esc(k)}</span></div><div class="v">${esc(v)}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}`;
    $(gridId).appendChild(d);
    requestAnimationFrame(() => setTimeout(() => d.classList.add('in'), 20));
    $('score').textContent = facts.length;
    return d;
  }

  const term = $('term');
  async function say(html, cls = '', pause = 260) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    term.querySelector('.cursor')?.remove();
    term.appendChild(line);
    if (reduce) line.innerHTML = html;
    else {
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      const text = tmp.textContent;
      for (let i = 1; i <= text.length; i += 2) { line.textContent = text.slice(0, i); await sleep(9); }
      line.innerHTML = html;
    }
    const cur = document.createElement('span'); cur.className = 'cursor'; line.appendChild(cur);
    while (term.children.length > 9) term.firstChild.remove();
    await sleep(reduce ? 0 : pause);
  }


  // Satellite base + street labels (Esri, no key). Falls back to OpenStreetMap if Esri fails.
  function addBaseLayers(map) {
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    }).addTo(map);
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
    const roads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.6 }).addTo(map);
    let fails = 0, switched = false;
    sat.on('tileerror', () => {
      if (switched || ++fails < 4) return;
      switched = true;
      [sat, labels, roads].forEach((l) => map.removeLayer(l));
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    });
  }

  function showMap(lat, lon) {
    if (!map) {
      map = L.map('map', { zoomControl: true, scrollWheelZoom: false });
      addBaseLayers(map);
    }
    map.eachLayer((l) => { if (!(l instanceof L.TileLayer)) map.removeLayer(l); });
    map.setView([lat, lon], 2);
    L.circle([lat, lon], { radius: 4000, color: '#ff3b30', weight: 1, fillOpacity: 0.12 }).addTo(map);
    L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    setTimeout(() => map.flyTo([lat, lon], 11, { duration: reduce ? 0 : 2.4 }), 300);
  }

  // ---------------- run ----------------
  async function scan() {
    facts = [];
    ['g-where', 'g-device', 'g-you'].forEach((g) => ($(g).innerHTML = ''));
    term.innerHTML = '';
    $('stamp').className = 'stamp';
    $('bar').style.width = '0';
    $('verdict').textContent = 'Scanning…';
    $('casefile').textContent = `Case #${Math.floor(1000 + Math.random() * 9000)} · ${new Date().toLocaleString()}`;

    // kick off async stuff in parallel
    const pIP = getIP(), pUA = getUA(), pBat = getBattery(), pMed = getMedia(), pAd = adblock();
    const gpu = getGPU();
    const fnt = fonts();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const vis = visits();
    const ref = referrer();

    await say('<span class="dim">$</span> snitch --target you --no-permission', '', 350);
    await say('<span class="dim">› tracing your IP…</span>', '', 200);

    const ip = await pIP;
    if (ip) {
      await say(`<span class="warn">✓</span> ${esc(ip.ip)} → <b>${esc(ip.city || '?')}, ${esc(ip.country || '?')}</b> ${flag(ip.cc)}`, '', 300);
      card('g-where', 'Your IP address', ip.ip, 'Every site gets this. No way around it except a VPN.', true);
      card('g-where', 'City', `${flag(ip.cc)} ${[ip.city, ip.region, ip.country].filter(Boolean).join(', ')}`, 'Guessed from the IP. Usually right to the city.', true);
      if (ip.isp) card('g-where', 'Internet provider', ip.isp, ip.asn ? `AS${ip.asn}` : '');
      if (Number.isFinite(ip.lat)) showMap(ip.lat, ip.lon);
      if (ip.tz && tz && ip.tz !== tz) card('g-where', 'VPN? Probably', `IP says ${ip.tz}, your clock says ${tz}`, 'Your IP and your system clock disagree. That usually means a VPN or proxy.', true);
    } else {
      await say('<span class="bad">✗</span> IP lookup blocked (adblock or privacy browser). Nice.', '', 250);
      $('map').style.display = 'none';
      card('g-where', 'IP lookup', 'Blocked', 'Something on your side stopped the lookup. Most sites still see your IP on their own server.');
    }
    const now = new Date();
    card('g-where', 'Your clock', `${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${tz}`, `UTC${-now.getTimezoneOffset() >= 0 ? '+' : ''}${-now.getTimezoneOffset() / 60}`);

    await say('<span class="dim">› fingerprinting hardware…</span>', '', 150);
    const ua = await pUA;
    card('g-device', 'System', ua.os + (ua.model ? ` · ${ua.model}` : ''), ua.model ? 'Your phone model, sent in a request header.' : '');
    card('g-device', 'Browser', ua.browser, '');
    if (gpu) {
      card('g-device', 'Graphics card', gpu.name, 'Read straight from WebGL.', true);
      await say(`<span class="warn">✓</span> GPU: ${esc(gpu.name)}`, '', 220);
    }
    if (navigator.hardwareConcurrency) card('g-device', 'CPU cores', `${navigator.hardwareConcurrency} threads`, '');
    if (navigator.deviceMemory) card('g-device', 'RAM', `${navigator.deviceMemory >= 8 ? '8+' : navigator.deviceMemory} GB`, 'Browsers round this and cap it at 8.');
    const dpr = window.devicePixelRatio || 1;
    card('g-device', 'Screen', `${screen.width}×${screen.height} @${+dpr.toFixed(2)}x`, `Window ${innerWidth}×${innerHeight} · ${screen.colorDepth}-bit color`);
    if (screen.isExtended) card('g-device', 'Monitors', 'More than one', 'Your browser says you have a second screen.', true);

    const bat = await pBat;
    if (bat) {
      const mins = bat.charging ? bat.chargingTime : bat.dischargingTime;
      const t = Number.isFinite(mins) && mins > 0 ? ` · ~${Math.round(mins / 60)} min ${bat.charging ? 'to full' : 'left'}` : '';
      card('g-device', 'Battery', `${bat.level}% ${bat.charging ? '⚡ charging' : 'on battery'}`, `Live, updates while you sit here${t}.`, bat.level <= 25 && !bat.charging);
      await say(`<span class="warn">✓</span> battery ${bat.level}%${bat.charging ? ', plugged in' : ''}`, '', 200);
    }
    const conn = navigator.connection;
    if (conn && conn.effectiveType) card('g-device', 'Connection', `${conn.effectiveType.toUpperCase()}${conn.downlink ? ` · ~${conn.downlink} Mbps` : ''}${conn.rtt ? ` · ${conn.rtt} ms` : ''}`, conn.saveData ? 'Data saver is on.' : '');
    const med = await pMed;
    if (med && (med.cams || med.mics)) card('g-device', 'Camera & mic', `${med.cams ? 'Camera ✓' : 'No camera'} · ${med.mics ? 'Mic ✓' : 'No mic'}`, 'Seen without asking. Using them still needs your OK.');
    if (navigator.maxTouchPoints > 0) card('g-device', 'Touchscreen', `${navigator.maxTouchPoints}-point touch`, '');

    await say('<span class="dim">› profiling you…</span>', '', 150);
    const langs = (navigator.languages || [navigator.language]).filter(Boolean);
    const dn = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();
    const langNames = [...new Set(langs.map((l) => (dn ? dn.of(l.split('-')[0]) : l)))];
    card('g-you', 'You speak', langNames.join(', '), 'From your browser language settings.', langNames.length > 1);
    if (ref) card('g-you', 'You came from', ref, 'Sites see the page that sent you here.', true);
    if (vis) card('g-you', 'Visits', vis.n === 1 ? 'First time here' : `${ordinal(vis.n)} visit`, vis.n === 1 ? 'Come back and this page will know.' : `First seen ${ago(Date.now() - vis.first)}.`, vis.n > 1);
    if (matchMedia('(prefers-color-scheme: dark)').matches) card('g-you', 'Dark mode', 'On', 'Sites can read your theme setting.');
    const blocked = await pAd;
    card('g-you', 'Ad blocker', blocked ? 'Detected' : 'None found', blocked ? 'Good for you. Sites can still tell it\'s there.' : 'You see every ad on the internet.', false);
    for (const [g, list] of Object.entries(fnt.found)) {
      const label = { 'Microsoft Office': 'Microsoft Office installed', 'Adobe apps': 'Adobe apps installed', 'Coding fonts': 'You probably write code', 'Designer fonts': 'Pro design fonts installed' }[g];
      card('g-you', label, list.slice(0, 3).join(', '), 'Detected from fonts on your system.', g === 'Coding fonts');
    }
    if (navigator.globalPrivacyControl || navigator.doNotTrack === '1') card('g-you', '"Do not track"', 'On', 'Most sites ignore it. Ironically it makes you easier to fingerprint.');

    await say('<span class="dim">› building fingerprint…</span>', '', 120);
    const fpSrc = [canvasPrint(), gpu?.raw, gpu?.vendor, screen.width, screen.height, screen.colorDepth, dpr, tz, langs.join(','), navigator.hardwareConcurrency, navigator.deviceMemory, navigator.platform, fnt.all.join(','), navigator.maxTouchPoints].join('|');
    const h = (await sha(fpSrc)).toUpperCase();
    const id = `SN-${h.slice(0, 4)}-${h.slice(4, 8)}`;
    $('fp').textContent = id;
    facts.push({ k: 'Fingerprint', v: id });
    $('score').textContent = facts.length;
    await say(`<span class="bad">●</span> fingerprint locked: <b>${id}</b>`, '', 200);
    await say(`<span class="warn">done.</span> your browser snitched <b>${facts.length}</b> things in ${(performance.now() / 1000).toFixed(1)}s. you clicked nothing.`, '', 0);

    const n = facts.length;
    $('bar').style.width = Math.min(100, n * 4) + '%';
    $('verdict').textContent = n >= 18 ? 'Full snitch' : n >= 12 ? 'Big snitch' : 'Snitched a little';
    $('stamp').classList.add('on');
  }

  // ---------------- live tracking (local only) ----------------
  const live = { t0: Date.now(), dist: 0, clicks: 0, keys: 0, away: 0, copies: 0, scroll: 0, last: null, lastMove: Date.now() };
  const liveCards = {};
  const mk = (key, label) => {
    const d = document.createElement('div'); d.className = 'ev';
    d.innerHTML = `<div class="k"><span>${label}</span></div><div class="v">0</div>`;
    $('g-live').appendChild(d); liveCards[key] = d.querySelector('.v');
  };
  mk('time', 'Time on page'); mk('dist', 'Mouse traveled'); mk('clicks', 'Clicks'); mk('scroll', 'Read so far');
  mk('away', 'Left this tab'); mk('keys', 'Keys pressed'); mk('idle', 'Idle for');

  addEventListener('pointermove', (e) => {
    if (live.last) live.dist += Math.hypot(e.clientX - live.last[0], e.clientY - live.last[1]);
    live.last = [e.clientX, e.clientY]; live.lastMove = Date.now();
  }, { passive: true });
  addEventListener('pointerdown', () => { live.clicks++; live.lastMove = Date.now(); });
  addEventListener('keydown', () => { live.keys++; live.lastMove = Date.now(); });
  addEventListener('copy', () => { live.copies++; });
  addEventListener('scroll', () => {
    const p = Math.round(((scrollY + innerHeight) / document.documentElement.scrollHeight) * 100);
    live.scroll = Math.max(live.scroll, Math.min(100, p)); live.lastMove = Date.now();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) live.away++; });

  setInterval(() => {
    const s = Math.floor((Date.now() - live.t0) / 1000);
    liveCards.time.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    const cm = live.dist / 37.8; // CSS px → cm at 96dpi
    liveCards.dist.textContent = cm < 100 ? `${cm.toFixed(0)} cm` : `${(cm / 100).toFixed(2)} m`;
    liveCards.clicks.textContent = live.clicks;
    liveCards.scroll.textContent = `${live.scroll}%`;
    liveCards.away.textContent = `${live.away}×`;
    liveCards.keys.textContent = live.keys;
    const idle = Math.floor((Date.now() - live.lastMove) / 1000);
    liveCards.idle.textContent = `${idle}s`;
  }, 250);

  // ---------------- share ----------------
  $('share').addEventListener('click', async () => {
    const pick = (k) => facts.find((f) => f.k === k)?.v;
    const bits = [pick('City'), pick('Graphics card'), pick('Battery'), pick('You came from') && `came from ${pick('You came from')}`].filter(Boolean);
    const text = `My browser snitched ${facts.length} things on me without a single click${bits.length ? ': ' + bits.join(', ') : ''}. Fingerprint ${$('fp').textContent}. Check yours: ${location.href.split('#')[0]}`;
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); }
    catch { prompt('Copy this:', text); }
  });
  $('rescan').addEventListener('click', () => { scrollTo({ top: 0, behavior: 'smooth' }); scan(); });

  scan();
})();
