/* Photo Snitch: reads photo metadata locally, shows it, wipes it. */
(() => {
  const $ = (id) => document.getElementById(id);
  const drop = $('drop'), input = $('file'), report = $('report');
  let current = null, map = null, objectUrl = null;

  // point the GitHub link at this repo when hosted on github.io
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

  // ---------- input ----------
  input.addEventListener('change', () => input.files[0] && handle(input.files[0]));
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (ev) => { const f = ev.dataTransfer.files[0]; if (f) handle(f); });
  document.addEventListener('paste', (ev) => {
    const f = [...(ev.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) handle(f);
  });
  $('sample').addEventListener('click', async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const r = await fetch('assets/sample.jpg');
    const b = await r.blob();
    handle(new File([b], 'IMG_4471.jpg', { type: 'image/jpeg' }));
  });
  $('another').addEventListener('click', () => {
    report.classList.remove('show');
    input.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------- helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => {
    if (!(d instanceof Date) || isNaN(d)) return String(d);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // exifr builds local-time Dates from the camera's wall clock, so read local fields
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const compass = (deg) => {
    const dirs = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  };
  const fmtVal = (v) => {
    if (v == null) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().replace('T', ' ').replace('.000Z', '');
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `<${v.byteLength} bytes>`;
    if (Array.isArray(v)) return v.length > 12 ? `[${v.length} values]` : v.map(fmtVal).join(', ');
    if (typeof v === 'object') return Object.entries(v).slice(0, 8).map(([k, x]) => `${k}: ${fmtVal(x)}`).join('; ');
    const s = String(v);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const first = (o, keys) => { for (const k of keys) if (o[k] != null && String(o[k]).trim() !== '') return o[k]; return null; };

  // ---------- main ----------
  async function handle(file) {
    current = file;
    report.classList.add('show');
    $('grid').innerHTML = '';
    $('raw-table').innerHTML = '';
    $('geo-block').classList.add('hidden');
    $('stamp').className = 'stamp';
    $('bar').style.width = '0';
    $('score').textContent = '0';
    $('verdict').textContent = 'Scanning…';
    $('casefile').textContent = `Case #${Math.floor(1000 + Math.random() * 9000)} · ${file.name}`;
    $('clean').disabled = false;
    $('clean-msg').textContent = 'Makes a fresh copy with zero metadata: no GPS, no phone, no date. Same picture.';

    // thumbnail
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.alt = 'Your photo';
    img.onerror = () => { $('thumb').innerHTML = '<div class="noimg">This browser can\'t preview this format, but the metadata was still read.</div>'; };
    img.src = objectUrl;
    $('thumb').innerHTML = '';
    $('thumb').appendChild(img);

    setTimeout(() => report.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);

    let data = null;
    try {
      data = await exifr.parse(file, {
        tiff: true, exif: true, gps: true, xmp: true, iptc: true, jfif: true, ihdr: true,
        icc: false, interop: false, makerNote: false, userComment: true,
        translateValues: true, reviveValues: true, mergeOutput: true,
      });
    } catch (e) { data = null; }
    data = data || {};

    const ev = [];
    let score = 0;
    const add = (k, v, note, pts, hot, extra = {}) => { ev.push({ k, v, note, hot, ...extra }); score += pts; };

    // GPS
    const lat = data.latitude, lon = data.longitude;
    const hasGPS = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
    if (hasGPS) {
      add('Exact location', `${lat.toFixed(6)}, ${lon.toFixed(6)}`, 'GPS coordinates baked into the file. Accurate to a few meters.', 45, true, { tag: 'GPS', id: 'ev-gps' });
      add('Nearest address', 'Looking it up…', 'Turned from the coordinates above.', 0, true, { id: 'ev-addr', wide: false });
    }
    if (Number.isFinite(data.GPSAltitude)) {
      add('Altitude', `${Math.round(data.GPSAltitude)} m above sea level`, 'Sometimes enough to guess the floor.', 3, false);
    }
    if (Number.isFinite(data.GPSImgDirection)) {
      add('You were facing', `${compass(data.GPSImgDirection)} (${Math.round(data.GPSImgDirection)}°)`, 'The direction the camera pointed.', 4, false);
    }
    if (Number.isFinite(data.GPSSpeed) && data.GPSSpeed > 0) {
      add('Moving at', `${data.GPSSpeed.toFixed(1)} ${data.GPSSpeedRef === 'M' ? 'mph' : data.GPSSpeedRef === 'N' ? 'knots' : 'km/h'}`, 'Speed when the shot was taken.', 2, false);
    }

    // time
    const taken = first(data, ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate']);
    if (taken) {
      const tz = first(data, ['OffsetTimeOriginal', 'OffsetTime']);
      add('Taken at', fmtDate(taken instanceof Date ? taken : new Date(taken)), tz ? `Timezone UTC${tz}` : 'Down to the second.', 15, !!hasGPS);
    }

    // device
    const make = data.Make ? String(data.Make).trim() : '';
    const model = data.Model ? String(data.Model).trim() : '';
    if (make || model) {
      const dev = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim();
      add('Device', dev, data.HostComputer ? `Reported as ${data.HostComputer}` : 'The exact phone or camera model.', 12, false);
    }
    const lens = first(data, ['LensModel', 'Lens', 'LensInfo']);
    if (lens) {
      const sel = /front/i.test(String(lens));
      add(sel ? 'Selfie camera' : 'Lens', fmtVal(lens), sel ? 'Shot with the front camera.' : 'Which camera on the phone.', 3, false);
    }
    const sw = first(data, ['Software', 'CreatorTool', 'ProcessingSoftware']);
    if (sw) {
      let s = String(sw).trim();
      if (/apple/i.test(make) && /^\d+(\.\d+)*$/.test(s)) s = `iOS ${s}`;
      add('Software', s, 'OS or app version that saved it.', 4, false);
    }
    const serial = first(data, ['BodySerialNumber', 'SerialNumber', 'CameraSerialNumber', 'InternalSerialNumber', 'LensSerialNumber']);
    if (serial) add('Serial number', String(serial), 'Ties every photo from this camera back to one device.', 10, true);
    const owner = first(data, ['OwnerName', 'CameraOwnerName', 'Artist', 'Creator', 'By-line', 'Copyright', 'Rights']);
    if (owner) add('Name inside the file', fmtVal(owner), 'Someone typed this into the camera or app.', 10, true);
    const desc = first(data, ['ImageDescription', 'UserComment', 'Description', 'Caption-Abstract', 'XPComment', 'title']);
    if (desc && fmtVal(desc).trim()) add('Hidden caption', fmtVal(desc), 'Text stored in the file.', 3, false);

    const w = data.ExifImageWidth || data.ImageWidth || img.naturalWidth;
    const h = data.ExifImageHeight || data.ImageHeight || img.naturalHeight;

    const tagCount = Object.keys(data).length;
    if (!ev.length) {
      add('Nothing found', tagCount ? `${tagCount} harmless tags` : '0 tags', 'No location, no device, no date. This one keeps its mouth shut.', 0, false, { wide: true });
    } else if (!hasGPS) {
      add('No GPS in this file', 'Location missing', 'Either location was off, or the app you got it from already stripped it. Photos sent as files (email, AirDrop, cloud drives, "send as file" in messengers) usually keep it.', 0, false, { wide: true });
    }
    if (w && h) ev.push({ k: 'Size', v: `${w} × ${h}`, note: `${(file.size / 1024 / 1024).toFixed(2)} MB` });

    score = Math.min(100, score);
    render(ev, score, tagCount, data, hasGPS ? { lat, lon, dir: data.GPSImgDirection } : null);
    if (hasGPS) lookupAddress(lat, lon);
  }

  function render(ev, score, tagCount, data, geo) {
    const grid = $('grid');
    ev.forEach((e, i) => {
      const d = document.createElement('div');
      d.className = 'ev' + (e.hot ? ' hot' : '') + (e.wide ? ' wide' : '');
      if (e.id) d.id = e.id;
      d.innerHTML = `<div class="k"><span>${esc(e.k)}</span>${e.tag ? `<span class="tag">${esc(e.tag)}</span>` : ''}</div><div class="v">${esc(e.v)}</div>${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}`;
      grid.appendChild(d);
      setTimeout(() => d.classList.add('in'), 180 + i * 110);
    });
    $('ev-count').textContent = `${tagCount} hidden tags in this file`;

    // score count-up
    const t0 = performance.now(), dur = 1100;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      $('score').textContent = Math.round(score * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    requestAnimationFrame(() => { $('bar').style.width = score + '%'; });

    const v = score === 0 ? 'Clean. No snitching.'
      : score < 25 ? 'Mostly quiet'
      : score < 60 ? 'Snitched a little'
      : score < 85 ? 'Big snitch'
      : 'Full snitch. It knows where you stood.';
    $('verdict').textContent = v;
    $('score').style.color = score < 25 ? 'var(--green)' : score < 60 ? 'var(--tape)' : 'var(--red)';
    const st = $('stamp');
    st.textContent = score < 25 ? 'Clean' : 'Snitched';
    st.className = 'stamp' + (score < 25 ? ' clean' : '');
    requestAnimationFrame(() => st.classList.add('on'));

    // raw table
    const rows = Object.entries(data)
      .filter(([, v]) => fmtVal(v) !== '')
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(fmtVal(v))}</td></tr>`).join('');
    $('raw-table').innerHTML = rows || '<tr><td>—</td><td>No tags</td></tr>';

    if (geo) showMap(geo);
  }

  function showMap({ lat, lon, dir }) {
    $('geo-block').classList.remove('hidden');
    $('geo-acc').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    if (!map) {
      map = L.map('map', { zoomControl: true, attributionControl: true, worldCopyJump: true });
      addBaseLayers(map);
    }
    map.eachLayer((l) => { if (!(l instanceof L.TileLayer)) map.removeLayer(l); });
    map.setView([lat, lon], 3);
    setTimeout(() => map.invalidateSize(), 50);

    if (Number.isFinite(dir)) {
      // view cone, ~60m long, 50° wide
      const R = 6378137, len = 60, half = 25;
      const pt = (b) => {
        const br = (b * Math.PI) / 180;
        return [lat + ((len * Math.cos(br)) / R) * (180 / Math.PI), lon + ((len * Math.sin(br)) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI)];
      };
      const arc = [];
      for (let b = dir - half; b <= dir + half; b += 5) arc.push(pt(b));
      L.polygon([[lat, lon], ...arc], { color: '#ffd60a', weight: 1, fillColor: '#ffd60a', fillOpacity: 0.22 }).addTo(map);
    }
    L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    L.circle([lat, lon], { radius: 25, color: '#ff3b30', weight: 1, fillOpacity: 0.08 }).addTo(map);
    setTimeout(() => map.flyTo([lat, lon], 17, { duration: 2.6 }), 700);
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

  async function lookupAddress(lat, lon) {
    const el = document.querySelector('#ev-addr .v');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const a = j.address || {};
      const street = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
      const place = a.city || a.town || a.village || a.suburb || a.county || '';
      const line = [street, place, a.country].filter(Boolean).join(', ') || j.display_name || 'Unknown';
      if (el) el.textContent = line;
    } catch (e) {
      if (el) el.textContent = 'Lookup failed. The coordinates above still work in any maps app.';
    }
  }

  // ---------- wipe ----------
  $('clean').addEventListener('click', async () => {
    if (!current) return;
    const btn = $('clean');
    btn.disabled = true;
    try {
      let bmp;
      try { bmp = await createImageBitmap(current, { imageOrientation: 'from-image' }); }
      catch { bmp = await createImageBitmap(current); }
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      const type = current.type === 'image/png' ? 'image/png' : current.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
      const blob = await new Promise((res) => c.toBlob(res, type, 0.93));
      const ext = type.split('/')[1].replace('jpeg', 'jpg');

      let left = 0;
      try { const chk = await exifr.parse(blob, { tiff: true, exif: true, gps: true, xmp: true, iptc: true }); left = chk ? Object.keys(chk).length : 0; } catch {}

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `clean_${current.name.replace(/\.[^.]+$/, '')}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);

      $('clean-msg').textContent = left === 0
        ? 'Done. Checked the new copy: 0 metadata tags. No GPS, no device, no date.'
        : `Done. ${left} tags left in the copy.`;
      toast(left === 0 ? 'Wiped. 0 tags left. Downloaded.' : 'Downloaded.');
      const st = $('stamp'); st.textContent = 'Wiped'; st.className = 'stamp clean on';
    } catch (e) {
      $('clean-msg').textContent = 'This browser can\'t redraw this format (HEIC on Chrome, for example). Open it in Safari, or convert to JPG first.';
    } finally {
      btn.disabled = false;
    }
  });
})();
