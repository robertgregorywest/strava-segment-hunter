const state = {
  meta: null,
  lastSearchParams: null,
  lastItems: [],
  openSegmentId: null,
};

const map = L.map('map');
const markersLayer = L.layerGroup().addTo(map);
let tilesAdded = false;

function ensureTiles() {
  if (tilesAdded) return;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  tilesAdded = true;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.round(Math.abs(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}

function formatGap(seconds) {
  if (seconds === undefined) return '—';
  const label = formatDuration(seconds);
  return seconds <= 0 ? `${label} (faster)` : `+${label} (slower)`;
}

function arrowIcon(rotationDeg, colorClass) {
  return L.divIcon({
    className: 'segment-marker',
    html: `<div class="marker-arrows"><span class="marker-arrow ${colorClass}" style="transform:rotate(${rotationDeg}deg)"></span></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

async function loadMeta() {
  const meta = await fetchJson('/api/meta');
  state.meta = meta;

  document.getElementById('lat').value = meta.home.lat;
  document.getElementById('lng').value = meta.home.lng;

  const dateInput = document.getElementById('targetDate');
  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = today;
  dateInput.min = today;
  dateInput.max = meta.latestForecastDate;
  document.getElementById('forecastHorizonNote').textContent =
    `Forecasts available through ${meta.latestForecastDate}.`;

  for (const key of ['massKg', 'cdA', 'crr', 'roughnessFactor']) {
    document.getElementById(key).value = meta.rider[key];
  }

  map.setView([meta.home.lat, meta.home.lng], 12);
  ensureTiles();
}

function buildSearchParams() {
  const params = new URLSearchParams();
  params.set('lat', document.getElementById('lat').value);
  params.set('lng', document.getElementById('lng').value);
  params.set('radiusM', document.getElementById('radiusM').value);
  params.set('targetDate', document.getElementById('targetDate').value);
  params.set('orderBy', document.getElementById('orderBy').value);

  const optionalIds = [
    'maxGapToKomS',
    'maxKomRank',
    'minLengthM',
    'maxLengthM',
    'minGradePercent',
    'maxGradePercent',
    'minDirectionality',
  ];
  for (const id of optionalIds) {
    const value = document.getElementById(id).value;
    if (value !== '') params.set(id, value);
  }
  return params;
}

function badgesFor(item) {
  const badges = [];
  if (item.komStatus === 'stale') badges.push('Stale KOM');
  if (item.komStatus === 'absent') badges.push('No KOM on record');
  if (!item.hasBaseline) badges.push('No baseline effort');
  if (item.windNeutral) badges.push('Wind-neutral');
  if (item.geometryApproximate) badges.push('Approximate geometry');
  if (item.wind && item.wind.confidence === 'lower-confidence') badges.push('Lower-confidence projection');
  return badges;
}

function renderResults(items) {
  state.lastItems = items;
  const list = document.getElementById('results');
  list.innerHTML = '';
  markersLayer.clearLayers();

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'result-card';
    li.dataset.id = String(item.segmentId);

    const gapClass = item.gapToKomS === undefined ? '' : item.gapToKomS <= 0 ? 'gap--faster' : 'gap--slower';
    const bestConditions = item.wind
      ? `${item.wind.windSpeedMs.toFixed(1)} m/s @ ${Math.round(item.wind.windDirectionDeg)}° (from), ${new Date(item.wind.hour).toLocaleString()}`
      : 'No wind projection available';

    li.innerHTML = `
      <h3>${item.name ?? `Segment ${item.segmentId}`}</h3>
      <div class="result-meta">
        <span>${Math.round(item.distanceFromSearchM)} m away</span>
        <span>${item.lengthM ?? '—'} m long</span>
        <span>${item.averageGrade ?? '—'}% grade</span>
        <span>bearing ${item.bearingDeg !== null ? Math.round(item.bearingDeg) + '°' : '—'}</span>
      </div>
      <div class="result-meta">
        <span>Best: ${bestConditions}</span>
      </div>
      <div class="result-meta">
        <span>Projected: ${item.wind ? formatDuration(item.wind.predictedTimeS) : '—'}</span>
        <span class="gap ${gapClass}">Gap to KOM: ${formatGap(item.gapToKomS)}</span>
      </div>
      <div class="badges">${badgesFor(item).map((b) => `<span class="badge">${b}</span>`).join('')}</div>
    `;
    li.addEventListener('click', () => openDetail(item.segmentId));
    list.appendChild(li);

    if (item.startLat !== null && item.startLng !== null) {
      const bearingIcon = arrowIcon(item.bearingDeg ?? 0, 'marker-arrow--bearing');
      L.marker([item.startLat, item.startLng], { icon: bearingIcon })
        .bindTooltip(item.name ?? `Segment ${item.segmentId}`)
        .addTo(markersLayer);

      if (item.wind) {
        const windIcon = arrowIcon((item.wind.windDirectionDeg + 180) % 360, 'marker-arrow--wind');
        L.marker([item.startLat, item.startLng], { icon: windIcon }).addTo(markersLayer);
      }
    }
  }
}

async function runSearch() {
  const params = buildSearchParams();
  state.lastSearchParams = params;
  const banner = document.getElementById('weatherBanner');
  const messageEl = document.getElementById('resultMessage');
  banner.hidden = true;
  messageEl.hidden = true;

  try {
    const result = await fetchJson(`/api/search?${params.toString()}`);
    if (result.weatherUnavailable) banner.hidden = false;
    if (result.message) {
      messageEl.hidden = false;
      messageEl.textContent = result.message;
    }
    renderResults(result.items);
  } catch (err) {
    messageEl.hidden = false;
    messageEl.textContent = err.message;
    renderResults([]);
  }
}

function renderDetail(detail) {
  const content = document.getElementById('detailContent');
  const s = detail.segment;
  const h = detail.personalHistory;

  const komBadge = h.komStatus !== 'fresh' ? `<span class="badge">${h.komStatus === 'absent' ? 'No KOM on record' : 'Stale KOM'}</span>` : '';
  const approxBadge = s.geometryApproximate ? '<span class="badge">Approximate geometry</span>' : '';
  const neutralBadge = s.windNeutral ? '<span class="badge">Wind-neutral</span>' : '';
  const confidenceBadge =
    detail.confidence === 'lower-confidence' ? '<span class="badge">Lower-confidence projection</span>' : '';

  let hourlyRows = '';
  if (detail.hourly.length > 0) {
    const fastestTimes = new Set(detail.fastestHours.map((h2) => h2.time));
    hourlyRows = detail.hourly
      .map(
        (h2) => `
      <tr class="${fastestTimes.has(h2.time) ? 'fastest-hour' : ''}">
        <td>${new Date(h2.time).toLocaleString()}</td>
        <td>${h2.windSpeedMs.toFixed(1)} m/s</td>
        <td>${Math.round(h2.windDirectionDeg)}°</td>
        <td>${formatDuration(h2.predictedTimeS)}</td>
        <td>${formatGap(h2.gapToKomS)}</td>
      </tr>`,
      )
      .join('');
  }

  content.innerHTML = `
    <h2>${s.name ?? `Segment ${s.id}`}</h2>
    <div class="badges">${komBadge}${approxBadge}${neutralBadge}${confidenceBadge}</div>

    <div class="detail-section">
      <h3>Segment</h3>
      <div class="kv-grid">
        <span>Length</span><span>${s.distanceM ?? '—'} m</span>
        <span>Average grade</span><span>${s.averageGrade ?? '—'}%</span>
        <span>Bearing</span><span>${s.bearingDeg !== null ? Math.round(s.bearingDeg) + '°' : '—'}</span>
        <span>Directionality</span><span>${s.directionality !== null ? s.directionality.toFixed(2) : '—'}</span>
        <span>Ideal wind (from)</span><span>${detail.idealWindFromDeg !== undefined ? Math.round(detail.idealWindFromDeg) + '°' : '—'}</span>
      </div>
    </div>

    <div class="detail-section">
      <h3>Personal history</h3>
      <div class="kv-grid">
        <span>PR</span><span>${h.prSeconds !== null ? formatDuration(h.prSeconds) : '—'}</span>
        <span>PR date</span><span>${h.prStartDate ? new Date(h.prStartDate).toLocaleDateString() : '—'}</span>
        <span>Effort count</span><span>${h.effortCount ?? '—'}</span>
        <span>Best KOM rank achieved</span><span>${h.bestKomRank ?? '—'}</span>
        <span>Current KOM</span><span>${h.komSeconds !== null ? formatDuration(h.komSeconds) : '—'} (${h.komStatus})</span>
      </div>
    </div>

    ${detail.message ? `<p class="hint">${detail.message}</p>` : ''}
    ${detail.weatherUnavailable ? `<p class="hint">Wind data became unreachable partway through fetching the forecast; hours below may be incomplete.</p>` : ''}

    ${
      hourlyRows
        ? `<div class="detail-section">
      <h3>Hourly projection (fastest hours highlighted)</h3>
      <table class="hourly">
        <thead><tr><th>Hour</th><th>Wind</th><th>From</th><th>Time</th><th>Gap</th></tr></thead>
        <tbody>${hourlyRows}</tbody>
      </table>
    </div>`
        : ''
    }
  `;
}

async function openDetail(segmentId) {
  state.openSegmentId = segmentId;
  const panel = document.getElementById('detailPanel');
  panel.hidden = false;
  document.getElementById('detailContent').innerHTML = '<p class="hint">Loading…</p>';
  try {
    const detail = await fetchJson(`/api/segments/${segmentId}`);
    renderDetail(detail);
  } catch (err) {
    document.getElementById('detailContent').innerHTML = `<p class="hint">${err.message}</p>`;
  }
}

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});

document.getElementById('detailClose').addEventListener('click', () => {
  document.getElementById('detailPanel').hidden = true;
  state.openSegmentId = null;
});

document.getElementById('settingsToggle').addEventListener('click', () => {
  document.getElementById('settingsPanel').hidden = false;
});
document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsPanel').hidden = true;
});

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rider = {
    massKg: Number(document.getElementById('massKg').value),
    cdA: Number(document.getElementById('cdA').value),
    crr: Number(document.getElementById('crr').value),
    roughnessFactor: Number(document.getElementById('roughnessFactor').value),
  };
  await fetchJson('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rider),
  });
  document.getElementById('settingsPanel').hidden = true;

  if (state.lastSearchParams) await runSearch();
  if (state.openSegmentId !== null) await openDetail(state.openSegmentId);
});

loadMeta().then(runSearch);
