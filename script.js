let RAW_ROWS = []; // {route, dir, day, b, avg, tier, hw:[], times:[], dirDetails:{'0':{times:[],tier},'1':{...}} }
let ROUTE_DATA = {}; // {routeName: {Weekday: rowData, Saturday: rowData, Sunday: rowData}}
let ROUTE_MODES = {}; // {routeName: mode} - detected from route_type
let activeTierFilters = new Set(); // Multi-select tier filter
let VALIDATIONS = {}; // {route: {day: {status, notes, verifiedAt, expectedTier, data_source, source_notes}}}
let ROUTE_LINEAGE = {}; // {route: {stable_id, comparable_to_previous, notes}}
window.FEED_INFO = null;
window.ANALYZED_AT = null;
window.IS_HISTORICAL_DATA = false; // True if feed dates are in the past

// Format YYYYMMDD to readable date like "Nov 30, 2025"
function formatGtfsDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  const year = dateStr.substring(0, 4);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  const date = new Date(year, month, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Detect mode from GTFS route_type
function detectMode(route_type, routeName) {
  const type = route_type ? String(route_type).trim() : '';
  const name = (routeName || '').toLowerCase();

  // route_type 0 = Tram/Light rail
  if (type === '0') return 'LRT';

  // route_type 1 = Subway/Metro (Heavy Rail)
  if (type === '1') return 'Heavy Rail';

  // route_type 2 = Rail (Commuter Rail)
  if (type === '2') return 'Commuter Rail';

  // route_type 3 = Bus - check name for BRT indicators
  if (type === '3') {
    if (name.includes('rapid') || name.includes('express') || name.includes('brt') || name.includes('bus rapid')) {
      return 'BRT';
    }
    return 'Bus';
  }

  // route_type 4 = Ferry
  if (type === '4') return 'Ferry';

  // route_type 5 = Cable tram
  if (type === '5') return 'Cable Car';

  // route_type 6 = Aerial lift/Gondola
  if (type === '6') return 'Gondola';

  // route_type 7 = Funicular
  if (type === '7') return 'Funicular';

  // Default to Bus if unknown
  return 'Bus';
}

const fileEl = document.getElementById('gtfs');

// File selection via label click - auto-analyze after upload
fileEl.addEventListener('change', () => {
  document.getElementById('landingPage').style.display = 'none'; document.getElementById('controlsPanel').style.display = fileEl.files?.[0] ? 'block' : 'none';
  // Automatically trigger analysis after file upload
  if (fileEl.files && fileEl.files.length > 0) {
    analyze();
  }
});

// Time settings modal functions
function openTimeSettings() {
  document.getElementById('timeSettingsModal').style.display = 'flex';
}
function closeTimeSettings() {
  document.getElementById('timeSettingsModal').style.display = 'none';
}
function applyTimeSettings() {
  closeTimeSettings();
  // Re-trigger analysis if data exists
  if (RAW_ROWS.length > 0) {
    analyze();
  }
}

function setupResultsSizing() {
  updateResultsMaxHeight();
  window.addEventListener('resize', updateResultsMaxHeight);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupResultsSizing);
} else {
  setupResultsSizing();
}

// theme
document.getElementById('theme').addEventListener('click', toggleTheme);
(function initTheme() {
  try {
    const saved = localStorage.getItem('theme') || 'light';
    if (saved === 'dark') document.body.classList.add('dark');
  } catch (error) {
    console.error('Failed to load theme preference:', error);
  }
  const themeBtn = document.getElementById('theme');
  themeBtn.textContent = document.body.classList.contains('dark') ? '🌙' : '☀️';
})();
function toggleTheme() {
  document.body.classList.toggle('dark');
  const themeBtn = document.getElementById('theme');
  themeBtn.textContent = document.body.classList.contains('dark') ? '🌙' : '☀️';
  try {
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  } catch (error) {
    console.error('Failed to save theme preference:', error);
  }
}

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeTimeSettings();
  }
});

// Validation functions
function loadValidations() {
  try {
    const saved = localStorage.getItem('gtfs-validations');
    if (saved) VALIDATIONS = JSON.parse(saved);
  } catch (error) {
    console.error('Failed to load validations from localStorage:', error);
    VALIDATIONS = {};
  }
}

// Route lineage functions
function loadRouteLineage() {
  try {
    const saved = localStorage.getItem('gtfs-route-lineage');
    if (saved) ROUTE_LINEAGE = JSON.parse(saved);
  } catch (error) {
    console.error('Failed to load route lineage from localStorage:', error);
    ROUTE_LINEAGE = {};
  }
}

function saveRouteLineage() {
  try {
    localStorage.setItem('gtfs-route-lineage', JSON.stringify(ROUTE_LINEAGE));
  } catch (error) {
    console.error('Failed to save route lineage to localStorage:', error);
    alert('Warning: Failed to save route lineage data. Your changes may not persist.');
  }
}

function getRouteLineage(route) {
  return ROUTE_LINEAGE[route] || { stable_id: '', route_changes: { changes: [], comparable_to_previous: true, notes: '' } };
}

function setRouteLineage(route, lineage) {
  ROUTE_LINEAGE[route] = {
    stable_id: lineage.stable_id || '',
    route_changes: {
      changes: lineage.route_changes?.changes || [],
      comparable_to_previous: lineage.route_changes?.comparable_to_previous !== false,
      notes: lineage.route_changes?.notes || ''
    }
  };
  saveRouteLineage();
}

// Route change type definitions
const CHANGE_TYPES = [
  { value: 'rerouted', label: 'Rerouted (different streets/corridor)' },
  { value: 'extended', label: 'Extended (added stops at end(s))' },
  { value: 'shortened', label: 'Shortened (removed stops)' },
  { value: 'merged', label: 'Merged with another route' },
  { value: 'split', label: 'Split into multiple routes' },
  { value: 'number-changed', label: 'Route number changed (same corridor)' },
  { value: 'frequency-only', label: 'Service frequency changed only' },
  { value: 'discontinued', label: 'Discontinued/eliminated' },
  { value: 'new-route', label: 'New route (first time analyzing)' }
];

const GEOGRAPHIC_CHANGES = ['rerouted', 'merged', 'split', 'shortened', 'discontinued', 'new-route'];

function buildChangeTypeCheckboxes(selectedChanges) {
  return `<div class="changeButtons">
    ${CHANGE_TYPES.map(ct => `
      <button type="button" class="changeBtn ${selectedChanges.includes(ct.value) ? 'active' : ''}" data-change="${ct.value}" onclick="this.classList.toggle('active')">
        ${ct.label}
      </button>
    `).join('')}
  </div>`;
}

function determineComparability(selectedChanges) {
  const hasGeographicChange = selectedChanges.some(c => GEOGRAPHIC_CHANGES.includes(c));
  return !hasGeographicChange;
}

// Historical data detection
function detectHistoricalData() {
  if (!FEED_INFO?.validTo) return false;
  const validTo = parseFeedDate(FEED_INFO.validTo);
  if (!validTo) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return validTo < today;
}

function parseFeedDate(dateStr) {
  if (!dateStr) return null;
  // GTFS dates are typically YYYYMMDD format
  if (/^\d{8}$/.test(dateStr)) {
    const year = parseInt(dateStr.substr(0, 4), 10);
    const month = parseInt(dateStr.substr(4, 2), 10) - 1;
    const day = parseInt(dateStr.substr(6, 2), 10);
    return new Date(year, month, day);
  }
  // Try standard date parsing
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// New verification panel interaction functions
function selectSource(source) {
  document.querySelectorAll('[data-source]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === source);
  });
}



function selectStatus(status) {
  document.querySelectorAll('[data-status]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
  // Show/hide frequency section if status is 'incorrect'
  const frequencySection = document.getElementById('frequencySection');
  if (frequencySection) {
    frequencySection.style.display = status === 'incorrect' ? 'block' : 'none';
  }
}

function selectFrequency(freq) {
  document.querySelectorAll('[data-freq]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.freq === freq);
  });

  // Show/hide exclusion reasons
  const exclusionSection = document.getElementById('exclusionSection');
  if (exclusionSection) {
    exclusionSection.style.display = freq === 'exclude' ? 'block' : 'none';
  }
}



function saveVerification() {
  const route = currentModalRoute;
  const day = currentModalDay;

  // Get source
  const sourceBtn = document.querySelector('[data-source].active');
  const dataSource = sourceBtn?.dataset.source || 'gtfs';

  // Get attributes from multi-select
  const attributeChips = document.querySelectorAll('#attributes-chips .chip');
  const attributes = Array.from(attributeChips).map(c => c.dataset.value);

  // Get status
  const statusBtn = document.querySelector('[data-status].active');
  const status = statusBtn?.dataset.status || 'unverified';

  // Get frequency (if status is incorrect)
  let expectedFreq = null;
  let exclusionReason = null;
  if (status === 'incorrect') {
    const freqBtn = document.querySelector('[data-freq].active');
    expectedFreq = freqBtn?.dataset.freq || null;

    if (expectedFreq === 'exclude') {
      const exclusionChips = document.querySelectorAll('#exclusion-chips .chip');
      const reasons = Array.from(exclusionChips).map(c => c.dataset.value);
      exclusionReason = reasons.length > 0 ? reasons : ['other'];
    }
  }

  // Get notes
  const notes = document.getElementById('validationNotes')?.value || '';

  // Save validation data
  if (!VALIDATIONS[route]) VALIDATIONS[route] = {};
  VALIDATIONS[route][day] = {
    status,
    notes,
    verifiedAt: new Date().toISOString(),
    expectedFreq,
    exclusionReason,
    data_source: dataSource
  };

  // Save lineage/attributes data
  if (!ROUTE_LINEAGE[route]) ROUTE_LINEAGE[route] = {};
  if (!ROUTE_LINEAGE[route].route_changes) ROUTE_LINEAGE[route].route_changes = {};
  ROUTE_LINEAGE[route].route_changes.changes = attributes;

  // Persist to localStorage
  try {
    localStorage.setItem('gtfs-validations', JSON.stringify(VALIDATIONS));
    saveRouteLineage();

    // Re-render modal to show updated state
    renderModalContent();

    // Re-render table to update validation icons
    render();

    alert('Verification saved successfully!');
  } catch (error) {
    console.error('Failed to save verification data:', error);
    alert('Error: Failed to save verification data. Please check your browser storage settings.');
  }
}

// Legacy saveValidation function (kept for compatibility, redirects to new function)
function saveValidation() {
  const route = currentModalRoute;
  const day = currentModalDay;
  const status = document.getElementById('validationStatus')?.value || 'unverified';
  const notes = document.getElementById('validationNotes')?.value || '';
  const expectedTier = document.getElementById('expectedTier')?.value;
  const dataSource = document.getElementById('dataSourceManual')?.checked ? 'manual' : 'gtfs';
  const sourceNotes = document.getElementById('sourceNotes')?.value || '';

  // Check for manual override
  const hasOverride = document.getElementById('manualOverride')?.checked;
  const manualTier = document.getElementById('manualTier')?.value;
  const overrideReason = document.getElementById('overrideReason')?.value || '';

  if (hasOverride && !manualTier) {
    alert('Please select a tier for manual override');
    return;
  }

  if (!VALIDATIONS[route]) VALIDATIONS[route] = {};
  VALIDATIONS[route][day] = {
    status,
    notes,
    verifiedAt: new Date().toISOString(),
    expectedTier: status === 'incorrect' ? expectedTier : null,
    data_source: dataSource,
    source_notes: dataSource === 'manual' ? sourceNotes : ''
  };

  // Add manual override if checked
  if (hasOverride && manualTier) {
    VALIDATIONS[route][day].manual_override = {
      tier: manualTier,
      reason: overrideReason
    };
  }

  try {
    localStorage.setItem('gtfs-validations', JSON.stringify(VALIDATIONS));
    render(); // Refresh table to show new validation status
    renderModalContent(); // Refresh modal to show updated validation
    alert('Validation saved!');
  } catch (error) {
    console.error('Failed to save validation data:', error);
    alert('Error: Failed to save validation data. Please check your browser storage settings.');
  }
}

function saveLineage() {
  const route = currentModalRoute;
  const stableId = document.getElementById('lineageStableId')?.value || '';

  // Get all selected route changes (from toggle buttons)
  const selectedChanges = Array.from(
    document.querySelectorAll('.changeBtn.active')
  ).map(btn => btn.dataset.change);

  const changeNotes = document.getElementById('routeChangeNotes')?.value || '';

  // Determine comparability based on change types
  const comparable = determineComparability(selectedChanges);

  setRouteLineage(route, {
    stable_id: stableId,
    route_changes: {
      changes: selectedChanges,
      comparable_to_previous: comparable,
      notes: changeNotes
    }
  });
  alert('Lineage metadata saved!');
}

function getValidationIcon(route, day) {
  const v = VALIDATIONS[route]?.[day];

  // Stale check: If verified BEFORE the current feed started, it's stale.
  const verifiedAt = v?.verifiedAt ? new Date(v.verifiedAt) : null;
  const feedStart = window.FEED_INFO?.validFrom ? parseFeedDate(window.FEED_INFO.validFrom) : null;

  const isStale = verifiedAt && feedStart && verifiedAt < feedStart;

  if (!v || v.status === 'unverified') return '<span class="validIcon unverified" title="Not verified">?</span>';

  let icon = '?';
  let cleanStatus = 'unverified';

  if (v.status === 'correct') { icon = '✓'; cleanStatus = 'correct'; }
  if (v.status === 'incorrect') { icon = '✗'; cleanStatus = 'incorrect'; }

  if (isStale) {
    return `<span class="validIcon ${cleanStatus}" style="position:relative" title="STALE: Verified on older data">
      ${icon}<span style="position:absolute;top:-4px;right:-6px;font-size:10px;background:#f59e0b;color:white;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center">!</span>
    </span>`;
  }

  return `<span class="validIcon ${cleanStatus}" title="Verified ${cleanStatus}">${icon}</span>`;
}

function toggleExpectedTierDiv() {
  const status = document.getElementById('validationStatus').value;
  const div = document.getElementById('incorrectTierDiv');
  if (div) div.style.display = status === 'incorrect' ? 'block' : 'none';
}

function toggleSourceNotes() {
  const manualRadio = document.getElementById('dataSourceManual');
  const div = document.getElementById('sourceNotesDiv');
  if (div) div.style.display = manualRadio?.checked ? 'block' : 'none';
}

function toggleManualOverride() {
  const checkbox = document.getElementById('manualOverride');
  const selectDiv = document.getElementById('manualTierSelect');
  if (selectDiv) {
    selectDiv.style.display = checkbox?.checked ? 'block' : 'none';
  }

  // If unchecking, clear selections
  if (!checkbox?.checked) {
    const tierSelect = document.getElementById('manualTier');
    const reasonTextarea = document.getElementById('overrideReason');
    if (tierSelect) tierSelect.value = '';
    if (reasonTextarea) reasonTextarea.value = '';
  }
}

// Load validations and lineage on page load
loadValidations();
loadRouteLineage();

// Day pill clicks
let currentSortDay = 'Weekday';
document.querySelectorAll('.dayPill').forEach(pill => {
  pill.addEventListener('click', () => {
    const day = pill.dataset.day;
    currentSortDay = day;

    // Update active state
    document.querySelectorAll('.dayPill').forEach(p => {
      p.classList.toggle('active', p.dataset.day === day);
    });

    // Update filter message
    const sortDayLabel = document.getElementById('sortDayLabel');
    if (sortDayLabel) sortDayLabel.textContent = day;

    // Update time range label
    const timeRangeLabel = document.getElementById('timeRangeLabel');
    if (timeRangeLabel) {
      const t0 = document.getElementById('t0').value || '07:00';
      const t1 = document.getElementById('t1').value || '22:00';
      timeRangeLabel.textContent = `(${t0} - ${t1})`;
    }

    render();
  });
});

// Merge checkbox (hidden but still functional)
const mergeCheckbox = document.getElementById('merge');
if (mergeCheckbox) mergeCheckbox.addEventListener('change', render);

// Search input
document.getElementById('q').addEventListener('input', render);

// Tier box click handlers (multi-select)
document.querySelectorAll('.tierBox').forEach(box => {
  box.addEventListener('click', () => {
    const tier = box.dataset.tier;
    if (activeTierFilters.has(tier)) {
      // Deselect this tier
      activeTierFilters.delete(tier);
      box.classList.remove('active');
    } else {
      // Add this tier to selection
      activeTierFilters.add(tier);
      box.classList.add('active');
    }
    render();
  });
});

// Sanitize HTML to prevent XSS attacks
function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function t2m(s) { const p = (s || '').split(':'); if (p.length < 2) return null; return (+p[0]) * 60 + (+p[1]); }
function m2t(m) { const h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, '0'); return `${String(h).padStart(2, '0')}:${mm}`; }
function parseCsv(text) {
  return new Promise((resolve, reject) => {
    try {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length > 0) {
            console.warn('CSV parsing warnings:', results.errors);
          }
          const clean = results.data.filter(row => Object.values(row).some(v => v && String(v).trim() !== ''));
          resolve(clean);
        },
        error: (error) => {
          reject(new Error(`CSV parsing failed: ${error.message || error}`));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
function bucketCounts(headways) {
  const b = { '≤10': 0, '11–15': 0, '16–20': 0, '21–30': 0, '31–60': 0, '>60': 0 };
  for (const h of headways) {
    if (h <= 10) b['≤10']++;
    else if (h <= 15) b['11–15']++;
    else if (h <= 20) b['16–20']++;
    else if (h <= 30) b['21–30']++;
    else if (h <= 60) b['31–60']++;
    else b['>60']++;
  }
  return b;
}
// Two-stage screening for each tier:
// Stage 1 - Pre-screen: Check if trip count meets minimum (spanMinutes/threshold)
// Stage 2 - Full-screen: STRICT grace - at most 2 gaps where T < h ≤ T+5; any h > T+5 fails immediately.
// If all tiers fail both stages, returns 'span' for exclusion.
function leastWorstTier(headways, tripCount, spanMinutes) {
  const tiers = [10, 15, 20, 30, 60];
  const GRACE = 5, MAX_GRACE_COUNT = 2;

  for (const T of tiers) {
    // Stage 1 - Pre-screen: Check minimum trip count
    const minTrips = Math.ceil(spanMinutes / T);
    if (tripCount < minTrips) {
      // FAIL Stage 1 - not enough trips to cover the window at this frequency
      continue;
    }

    // Stage 2 - Full-screen: Gap analysis
    let graceCount = 0;
    let fail = false;
    for (const h of headways) {
      if (h <= T) continue;
      if (h <= T + GRACE) {
        graceCount++;
        if (graceCount > MAX_GRACE_COUNT) { fail = true; break; }
      } else { // strictly beyond grace
        fail = true; break;
      }
    }
    if (!fail) return String(T);
  }

  // All tiers failed - exclude with reason "span"
  return 'span';
}
function directionLabel(dir) {
  const merge = document.getElementById('merge').checked;
  if (merge) return '–';
  if (String(dir) === '0') return 'Outbound';
  if (String(dir) === '1') return 'Inbound';
  return String(dir || '–');
}
function computeMedian(hw) {
  if (!hw.length) return 0;
  const sorted = [...hw].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return (sorted.length % 2 === 1) ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function computeMode(hw) {
  if (!hw.length) return 0;
  const counts = new Map();
  for (const h of hw) counts.set(h, (counts.get(h) || 0) + 1);
  let best = hw[0], bestCount = 0;
  for (const [val, c] of counts.entries()) {
    if (c > bestCount || (c === bestCount && val < best)) { best = val; bestCount = c; }
  }
  return best;
}
function formatGroupedGaps(hw) {
  const top = [...hw].sort((a, b) => b - a).slice(0, 10);
  const m = new Map(); for (const h of top) m.set(h, (m.get(h) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([gap, count]) => `${gap} min (×${count})`);
}
function tierThreshold(tier) { const n = parseInt(tier, 10); return Number.isFinite(n) ? n : Infinity; }
function gapHighlightClass(gap, tier) {
  const T = tierThreshold(tier); if (!Number.isFinite(T)) return '';
  if (gap > T + 5) return 'gapHigh'; if (gap > T) return 'gapWarn'; return '';
}
// Count violations: gaps that exceed tier threshold + grace period (5 min)
function countViolations(gaps, tier) {
  const T = tierThreshold(tier);
  if (!Number.isFinite(T) || !gaps || !gaps.length) return { hard: 0, grace: 0 };
  let hard = 0;  // gaps > T + 5 (fail immediately)
  let grace = 0; // gaps > T but <= T + 5 (within grace)
  for (const g of gaps) {
    if (g > T + 5) hard++;
    else if (g > T) grace++;
  }
  return { hard, grace };
}
function renderGapCell(gap, tier) {
  if (gap == null) return '—';
  const cls = gapHighlightClass(gap, tier);
  const classes = ['gapBadge']; if (cls) classes.push(cls);
  return `<span class="${classes.join(' ')}">${gap}</span>`;
}

function round1(n) { return Math.round(n * 10) / 10; }
function formatHeadway(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const rounded = round1(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
function formatDuration(mins) {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return '—';
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || !parts.length) parts.push(`${m}m`);
  return parts.join(' ');
}
function formatDelta(diff) {
  if (diff == null || !Number.isFinite(diff) || diff === 0) return '±0';
  const abs = round1(Math.abs(diff));
  const value = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${diff > 0 ? '+' : '−'}${value}`;
}

function mergeRows(rows) {
  // merge by route+day using real headways and preserving per-direction times
  const m = new Map();
  for (const r of rows) {
    const key = `${r.route}::${r.day}`;
    if (!m.has(key)) m.set(key, { route: r.route, day: r.day, dir: '–', hw: [], times: [], dirDetails: { '0': { times: [], gaps: [], tier: null }, '1': { times: [], gaps: [], tier: null } } });
    const obj = m.get(key);
    obj.hw = obj.hw.concat(r.hw);
    obj.times = obj.times.concat(r.times);
    // stash per-direction times and gaps for modal
    if (r.dir === '0' || r.dir === 0) {
      obj.dirDetails['0'].times = obj.dirDetails['0'].times.concat(r.times);
      obj.dirDetails['0'].gaps = obj.dirDetails['0'].gaps.concat(r.hw);
      obj.dirDetails['0'].tier = r.tier;
    }
    if (r.dir === '1' || r.dir === 1) {
      obj.dirDetails['1'].times = obj.dirDetails['1'].times.concat(r.times);
      obj.dirDetails['1'].gaps = obj.dirDetails['1'].gaps.concat(r.hw);
      obj.dirDetails['1'].tier = r.tier;
    }
  }
  const out = [];
  for (const [, v] of m.entries()) {
    v.hw.sort((a, b) => a - b);
    const b = bucketCounts(v.hw);
    const avg = v.hw.length ? Math.round(v.hw.reduce((a, b) => a + b, 0) / v.hw.length) : 0;
    const best = computeMedian(v.hw);
    const mergedTimes = v.times.sort((a, b) => a - b);
    const dedupTimes = []; for (const t of mergedTimes) { if (!dedupTimes.length || dedupTimes[dedupTimes.length - 1] !== t) dedupTimes.push(t); }
    const spanMins = t2m(document.getElementById('t1').value) - t2m(document.getElementById('t0').value);
    const tier = leastWorstTier(v.hw, dedupTimes.length, spanMins);

    // Process each direction: clean times, calculate gaps with time info
    for (const dirKey of Object.keys(v.dirDetails)) {
      const dirTimes = v.dirDetails[dirKey]?.times || [];
      dirTimes.sort((a, b) => a - b);
      const cleaned = [];
      for (const t of dirTimes) { if (!cleaned.length || cleaned[cleaned.length - 1] !== t) cleaned.push(t); }
      v.dirDetails[dirKey].times = cleaned;

      // Calculate gaps with time info for this direction
      const gapsWithTime = [];
      for (let i = 1; i < cleaned.length; i++) {
        const gap = cleaned[i] - cleaned[i - 1];
        if (gap >= 5 && gap <= 240) {
          gapsWithTime.push({ gap, time: cleaned[i - 1] });
        }
      }
      v.dirDetails[dirKey].gapsWithTime = gapsWithTime;
      v.dirDetails[dirKey].gaps = gapsWithTime.map(g => g.gap);
    }

    // Find max gap location across all directions
    let maxGapInfo = null;
    for (const dirKey of Object.keys(v.dirDetails)) {
      const gapsWithTime = v.dirDetails[dirKey].gapsWithTime || [];
      for (const g of gapsWithTime) {
        if (!maxGapInfo || g.gap > maxGapInfo.gap) {
          maxGapInfo = { gap: g.gap, direction: dirKey, time: g.time };
        }
      }
    }

    out.push({ route: v.route, dir: '–', day: v.day, b, avg, best, tier, hw: v.hw, times: dedupTimes, dirDetails: v.dirDetails, maxGapInfo });
  }
  return out;
}
function cloneRow(r) {
  return { route: r.route, dir: r.dir, day: r.day, b: structuredClone ? r.b : JSON.parse(JSON.stringify(r.b)), avg: r.avg, best: r.best, tier: r.tier, hw: [...r.hw], times: [...r.times], dirDetails: cloneDirDetails(r.dirDetails), maxGapInfo: r.maxGapInfo ? { ...r.maxGapInfo } : null };
}

// Analyze
async function analyze() {
  const file = fileEl.files[0]; if (!file) return;
  const rangeMessage = document.getElementById('rangeMessage');
  if (rangeMessage) rangeMessage.textContent = '';

  const t0 = t2m(document.getElementById('t0').value);
  const t1 = t2m(document.getElementById('t1').value);
  if (t0 == null || t1 == null || t0 > t1) {
    const msg = 'Enter a valid time range where start is before end.';
    if (rangeMessage) {
      rangeMessage.textContent = msg;
    } else {
      alert(msg);
    }
    return;
  }

  try {
    const zip = await JSZip.loadAsync(file);
    const need = ['routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt'];
    for (const n of need) { if (!zip.file(n)) { alert(n + ' missing'); return; } }

  const [routes, trips, stopTimes, calendar] = await Promise.all([
    parseCsv(await zip.file('routes.txt').async('text')),
    parseCsv(await zip.file('trips.txt').async('text')),
    parseCsv(await zip.file('stop_times.txt').async('text')),
    parseCsv(await zip.file('calendar.txt').async('text')),
  ]);

  // Try to load feed_info.txt
  let feedInfo = null;
  const feedInfoFile = zip.file('feed_info.txt');
  if (feedInfoFile) {
    const feedInfoCsv = await parseCsv(await feedInfoFile.async('text'));
    if (feedInfoCsv.length > 0) {
      feedInfo = feedInfoCsv[0];
    }
  }

  // Store feed metadata globally
  window.FEED_INFO = {
    filename: file.name,
    validFrom: feedInfo?.feed_start_date || null,
    validTo: feedInfo?.feed_end_date || null,
    version: feedInfo?.feed_version || null,
    publisher: feedInfo?.feed_publisher_name || null
  };
  window.ANALYZED_AT = new Date().toISOString();

  const routeById = {}; for (const r of routes) { if (r.route_id) routeById[r.route_id] = r; }
  const calByService = {}; for (const c of calendar) { if (c.service_id) calByService[c.service_id] = c; }

  // origin departure per trip
  const originForTrip = new Map();
  {
    const earliest = new Map();
    for (const st of stopTimes) {
      const tid = st.trip_id; if (!tid) continue;
      const seq = parseInt(st.stop_sequence || '0', 10);
      const prev = earliest.get(tid);
      if (!prev || seq < prev.seq) earliest.set(tid, { seq, row: st });
    }
    for (const [tid, obj] of earliest.entries()) {
      const r = obj.row;
      const dep = (r.departure_time && r.departure_time.trim()) ? r.departure_time : r.arrival_time;
      const m = t2m(dep);
      if (m != null) originForTrip.set(tid, m);
    }
  }

  function tripsForDay(day) {
    // Only use calendar.txt to determine if service runs on this day type.
    // We ignore calendar_dates.txt exceptions since we're analyzing general
    // service patterns across the week, not specific dates. The previous logic
    // incorrectly excluded ALL trips for a service if ANY exception existed
    // (e.g., a Dec 25 removal would exclude all weekday trips).
    return trips.filter(tr => {
      const serviceId = tr.service_id;
      const c = calByService[serviceId];

      if (!c) return false;

      if (day === 'Weekday') return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].some(d => c[d] === '1');
      else if (day === 'Saturday') return c['saturday'] === '1';
      else if (day === 'Sunday') return c['sunday'] === '1';
      return false;
    });
  }

  const days = ['Weekday', 'Saturday', 'Sunday'];
  const rows = [];
  const routeDayData = new Map();

  for (const day of days) {
    const dayTrips = tripsForDay(day);
    const map = new Map();
    for (const tr of dayTrips) {
      const dir = (tr.direction_id !== undefined && tr.direction_id !== '' && tr.direction_id !== null) ? String(tr.direction_id) : '0';
      const key = `${tr.route_id}::${dir}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tr.trip_id);
    }

    for (const [key, tripIds] of map.entries()) {
      const [route_id, dir] = key.split('::');
      const rt = routeById[route_id] || {};
      const rname = rt.route_short_name || rt.route_long_name || route_id;

      // Detect and store mode for this route
      if (!ROUTE_MODES[rname]) {
        const mode = detectMode(rt.route_type, rname);
        ROUTE_MODES[rname] = mode;
      }

      const times = [];
      for (const tid of tripIds) {
        const m = originForTrip.get(tid);
        if (m == null) continue;
        if (m < t0 || m > t1) continue; // inclusive
        times.push(m);
      }
      if (times.length < 2) continue;
      times.sort((a, b) => a - b);

      // de-duplicate identical minute marks
      const dedup = []; for (const t of times) { if (!dedup.length || dedup[dedup.length - 1] !== t) dedup.push(t); }
      if (dedup.length < 2) continue;

      const gaps = [];
      for (let i = 1; i < dedup.length; i++) {
        const h = dedup[i] - dedup[i - 1];
        if (h >= 5 && h <= 240) gaps.push(h);
      }
      if (gaps.length === 0) continue;

      const b = bucketCounts(gaps);
      const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      const best = computeMedian(gaps);
      const spanMins = t1 - t0;
      const tier = leastWorstTier(gaps, dedup.length, spanMins);

      rows.push({ route: rname, dir, day, b, avg, best, tier, hw: gaps, times: dedup });

      // keep per-direction times and gaps for modal (by route+day)
      const routeDayKey = `${rname}::${day}`;
      if (!routeDayData.has(routeDayKey)) routeDayData.set(routeDayKey, {});
      const perDir = routeDayData.get(routeDayKey);
      // Store gaps with time info for detailed analysis
      const gapsWithTime = [];
      for (let i = 1; i < dedup.length; i++) {
        const g = dedup[i] - dedup[i - 1];
        if (g >= 5 && g <= 240) {
          gapsWithTime.push({ gap: g, time: dedup[i - 1] });
        }
      }
      perDir[dir] = { times: [...dedup], tier, gaps: [...gaps], gapsWithTime };
    }
  }

  // stash per-route/day dir details
  for (const row of rows) {
    const key = `${row.route}::${row.day}`;
    row.dirDetails = cloneDirDetails(routeDayData.get(key));
  }

  RAW_ROWS = rows;
  render();
  document.getElementById('tierSummary').style.display = 'block';
  const tableWrapEl = document.getElementById('tableWrap');
  tableWrapEl.style.display = 'block';
  updateResultsMaxHeight();

  // Populate and show feed metadata
  document.getElementById('feedFilename').textContent = FEED_INFO.filename;
  document.getElementById('feedValidity').textContent =
    FEED_INFO.validFrom && FEED_INFO.validTo
      ? `${formatGtfsDate(FEED_INFO.validFrom)} to ${formatGtfsDate(FEED_INFO.validTo)}`
      : 'Unknown';
  document.getElementById('analyzedTime').textContent = new Date(ANALYZED_AT).toLocaleString();
  document.getElementById('feedMetadata').style.display = 'flex';

  // Detect and display historical data warning
  window.IS_HISTORICAL_DATA = detectHistoricalData();
  const historicalBanner = document.getElementById('historicalBanner');
  if (historicalBanner) {
    if (window.IS_HISTORICAL_DATA) {
      historicalBanner.style.display = 'block';
      const validTo = FEED_INFO.validTo ? formatGtfsDate(FEED_INFO.validTo) : 'Unknown';
      historicalBanner.innerHTML = `<strong>Historical Data:</strong> This GTFS feed expired on ${escapeHtml(validTo)}. Results reflect past service patterns.`;
    } else {
      historicalBanner.style.display = 'none';
    }
  }

  // Show export and sync buttons
  document.getElementById('exportBtn').style.display = 'inline-block';
  document.getElementById('syncBtn').style.display = 'inline-block';
  } catch (error) {
    console.error('Analysis failed:', error);
    const errorMsg = error.message || 'Unknown error occurred';
    alert(`Failed to analyze GTFS file: ${errorMsg}\n\nPlease ensure the file is a valid GTFS ZIP archive.`);

    // Reset UI state
    document.getElementById('tierSummary').style.display = 'none';
    document.getElementById('tableWrap').style.display = 'none';
    document.getElementById('feedMetadata').style.display = 'none';
  }
}

function cloneDirDetails(details) {
  const keys = new Set(['0', '1']);
  if (details) { Object.keys(details).forEach(k => keys.add(k)); }
  const result = {};
  for (const key of keys) {
    const src = details?.[key];
    result[key] = {
      times: src?.times ? [...src.times] : [],
      tier: src?.tier ?? null,
      gaps: src?.gaps ? [...src.gaps] : [],
      gapsWithTime: src?.gapsWithTime ? src.gapsWithTime.map(g => ({ ...g })) : []
    };
  }
  return result;
}

function tierClass(t) {
  if (t === '10') return 't10';
  if (t === '15') return 't15';
  if (t === '20') return 't20';
  if (t === '30') return 't30';
  if (t === '60') return 't60';
  if (t === 'span') return 'tSpan';
  return 'tBig';
}

function render(opts = {}) {
  const sortDay = currentSortDay || 'Weekday';
  const mergeCheckbox = document.getElementById('merge');
  const merge = mergeCheckbox ? mergeCheckbox.checked : true;
  const q = (document.getElementById('q').value || '').toLowerCase();

  // Build ROUTE_DATA: group by route, then by day
  ROUTE_DATA = {};
  const processedRows = merge ? mergeRows(RAW_ROWS) : RAW_ROWS.map(cloneRow);

  for (const r of processedRows) {
    if (!ROUTE_DATA[r.route]) ROUTE_DATA[r.route] = {};
    ROUTE_DATA[r.route][r.day] = r;
  }

  // Get unique routes and filter by search
  let routes = Object.keys(ROUTE_DATA);
  if (q) routes = routes.filter(r => r.toLowerCase().includes(q));

  // Count tiers based on sortDay (use override tier if present)
  const tierCounts = { '10': 0, '15': 0, '20': 0, '30': 0, '60': 0, '>60': 0, 'span': 0 };
  for (const route of routes) {
    const dayData = ROUTE_DATA[route][sortDay];
    if (dayData) {
      const validation = VALIDATIONS[route]?.[sortDay];
      const hasOverride = validation?.manual_override;
      const tier = hasOverride ? tierValueToStandard(validation.manual_override.tier) : dayData.tier;
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
  }

  // Update tier summary boxes
  document.querySelectorAll('.tierBox').forEach(box => {
    const tier = box.dataset.tier;
    box.querySelector('.tierCount').textContent = tierCounts[tier] || 0;
  });

  // Filter by tier if any tiers selected (use override tier if present)
  if (activeTierFilters.size > 0) {
    routes = routes.filter(route => {
      const dayData = ROUTE_DATA[route][sortDay];
      if (!dayData) return false;
      const validation = VALIDATIONS[route]?.[sortDay];
      const hasOverride = validation?.manual_override;
      const tier = hasOverride ? tierValueToStandard(validation.manual_override.tier) : dayData.tier;
      return activeTierFilters.has(tier);
    });
  }

  // Natural sort function for route names (handles numbers properly)
  function naturalSort(a, b) {
    // Extract leading numbers if present
    const aMatch = a.match(/^(\d+)/);
    const bMatch = b.match(/^(\d+)/);

    if (aMatch && bMatch) {
      const aNum = parseInt(aMatch[1], 10);
      const bNum = parseInt(bMatch[1], 10);
      if (aNum !== bNum) return aNum - bNum;
      // If numbers are equal, fall back to string comparison
      return a.localeCompare(b);
    }

    // If one has a number and the other doesn't, number comes first
    if (aMatch) return -1;
    if (bMatch) return 1;

    // Otherwise, normal string comparison
    return a.localeCompare(b);
  }

  // Sort routes: alphabetically/numerically only (no tier-based sorting)
  routes.sort(naturalSort);

  // Update route count
  const routeCountEl = document.querySelector('.routeCount');
  if (routeCountEl) routeCountEl.innerHTML = `Displaying <strong>${routes.length}</strong> routes`;

  // Update time range label
  const timeRangeLabel = document.getElementById('timeRangeLabel');
  if (timeRangeLabel) {
    const t0 = document.getElementById('t0').value || '07:00';
    const t1 = document.getElementById('t1').value || '22:00';
    timeRangeLabel.textContent = `(${t0} - ${t1})`;
  }

  // Build table with 3-day columns
  const tbody = document.querySelector('#tbl tbody');
  tbody.innerHTML = '';

  for (const route of routes) {
    const tr = document.createElement('tr');
    tr.dataset.route = route;

    // Route name cell (using textContent is safe from XSS)
    const routeCell = document.createElement('td');
    routeCell.className = 'route';
    routeCell.textContent = route;
    tr.appendChild(routeCell);

    // Mode cell
    const modeCell = document.createElement('td');
    modeCell.className = 'modeCol';
    modeCell.textContent = ROUTE_MODES[route] || 'Bus';
    tr.appendChild(modeCell);

    // Day cells
    for (const day of ['Weekday', 'Saturday', 'Sunday']) {
      const cell = document.createElement('td');
      cell.className = 'dayCell';
      const dayData = ROUTE_DATA[route][day];

      if (dayData) {
        const headway = dayData.avg || 0;
        const validation = VALIDATIONS[route]?.[day];
        const hasOverride = validation?.manual_override;

        // Use override tier if present
        const displayTier = hasOverride ? validation.manual_override.tier : dayData.tier;
        const tierLabel = hasOverride ? tierToLabelFromValue(displayTier) : tierToLabel(dayData.tier);
        const tierCls = hasOverride ? tierClassFromValue(displayTier) : tierClass(dayData.tier);
        const overrideIndicator = hasOverride ? '<span class="overrideIndicator">*</span>' : '';

        cell.innerHTML = `<span class="headway">${headway}m</span><span class="tierBadge ${tierCls}">${tierLabel}</span>${overrideIndicator}`;
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          openModal(dayData, day);
        });
      } else {
        cell.innerHTML = '<span class="noService">—</span>';
      }
      tr.appendChild(cell);
    }

    // Trips, Best, Worst columns (based on sortDay)
    const sortDayData = ROUTE_DATA[route][sortDay];

    // Trips: total departures
    const tripsCell = document.createElement('td');
    tripsCell.className = 'numCol';
    if (sortDayData) {
      const dirDetails = sortDayData.dirDetails || {};
      const outboundTimes = dirDetails['0']?.times || [];
      const inboundTimes = dirDetails['1']?.times || [];
      const totalTrips = outboundTimes.length + inboundTimes.length;
      tripsCell.textContent = totalTrips || sortDayData.times?.length || '—';
    } else {
      tripsCell.textContent = '—';
    }
    tr.appendChild(tripsCell);

    // Best: median headway (representative "best" performance)
    const bestCell = document.createElement('td');
    bestCell.className = 'numCol';
    if (sortDayData && sortDayData.hw && sortDayData.hw.length) {
      const best = Math.min(...sortDayData.hw);
      bestCell.textContent = best + 'm';
    } else {
      bestCell.textContent = '—';
    }
    tr.appendChild(bestCell);

    // Worst: longest gap
    const worstCell = document.createElement('td');
    worstCell.className = 'numCol';
    if (sortDayData && sortDayData.hw && sortDayData.hw.length) {
      const worst = Math.max(...sortDayData.hw);
      worstCell.textContent = worst + 'm';
    } else {
      worstCell.textContent = '—';
    }
    tr.appendChild(worstCell);

    // Validation: show icon for current sortDay
    const validCell = document.createElement('td');
    validCell.className = 'validCol';
    validCell.innerHTML = getValidationIcon(route, sortDay);
    validCell.style.cursor = 'pointer';
    validCell.addEventListener('click', (e) => {
      e.stopPropagation();
      const dayData = ROUTE_DATA[route][sortDay];
      if (dayData) openModal(dayData, sortDay);
    });
    tr.appendChild(validCell);

    // Click on route name opens modal for sortDay
    routeCell.style.cursor = 'pointer';
    routeCell.addEventListener('click', () => {
      const dayData = ROUTE_DATA[route][sortDay];
      if (dayData) openModal(dayData, sortDay);
    });

    tbody.appendChild(tr);
  }

  updateResultsMaxHeight();
}

function tierToLabel(tier) {
  if (tier === '10') return 'Freq+';
  if (tier === '15') return 'Freq';
  if (tier === '20') return 'Good';
  if (tier === '30') return 'Basic';
  if (tier === '60') return 'Infreq';
  if (tier === 'span') return 'Span';
  return 'Sparse';
}

// Helper functions for manual override tier values
function tierToLabelFromValue(tierValue) {
  // Map override dropdown values to labels
  if (tierValue === '10') return 'Freq+';
  if (tierValue === 'freq') return 'Freq';
  if (tierValue === 'good') return 'Good';
  if (tierValue === 'basic') return 'Basic';
  if (tierValue === '60') return 'Infreq';
  if (tierValue === 'infreq') return 'Sparse';
  if (tierValue === 'span') return 'Span';
  return tierValue;
}

function tierClassFromValue(tierValue) {
  // Map override dropdown values to CSS classes
  if (tierValue === '10') return 't10';
  if (tierValue === 'freq') return 't15';
  if (tierValue === 'good') return 't20';
  if (tierValue === 'basic') return 't30';
  if (tierValue === '60') return 't60';
  if (tierValue === 'infreq') return 'tBig';
  if (tierValue === 'span') return 'tSpan';
  return 'tBig';
}

function tierValueToStandard(tierValue) {
  // Map override dropdown values to standard tier values for export
  if (tierValue === '10') return '10';
  if (tierValue === 'freq') return '15';
  if (tierValue === 'good') return '20';
  if (tierValue === 'basic') return '30';
  if (tierValue === '60') return '60';
  if (tierValue === 'infreq') return '>60';
  if (tierValue === 'span') return 'span';
  return tierValue;
}

// Modal (Departures & Gaps)
function getDirDetails(route, day) {
  // Build from RAW_ROWS for both directions
  const details = { '0': { times: [], tier: null }, '1': { times: [], tier: null } };
  for (const r of RAW_ROWS) {
    if (r.route === route && r.day === day) {
      if (String(r.dir) === '0') { details['0'].times = details['0'].times.concat(r.times); details['0'].tier = r.tier; }
      if (String(r.dir) === '1') { details['1'].times = details['1'].times.concat(r.times); details['1'].tier = r.tier; }
    }
  }
  for (const k of Object.keys(details)) { details[k].times.sort((a, b) => a - b); }
  return details;
}
function buildDepartureTable(label, detail) {
  const times = (detail?.times || []).slice().sort((a, b) => a - b);
  const uniq = []; for (const t of times) { if (!uniq.length || uniq[uniq.length - 1] !== t) uniq.push(t); }
  const tier = detail?.tier ?? null;
  let rows = '';
  if (uniq.length) {
    for (let i = 0; i < uniq.length; i++) {
      const timeStr = m2t(uniq[i]);
      if (i === 0) {
        rows += `<tr><td class="numCol">${i + 1}</td><td>${timeStr}</td><td>—</td></tr>`;
      } else {
        const gap = Math.round(uniq[i] - uniq[i - 1]);
        rows += `<tr><td class="numCol">${i + 1}</td><td>${timeStr}</td><td>${renderGapCell(gap, tier)}</td></tr>`;
      }
    }
  } else {
    rows = `<tr><td colspan="3" class="muted">No departures in window</td></tr>`;
  }
  return `<div class="gapTableWrap"><h5>${label}</h5><div class="gapTableScroll"><table class="gapTable"><thead><tr><th>#</th><th>Time</th><th>Gap</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
// Compact departure format: group by hour with HH | MM format
function buildCompactDepartures(times) {
  if (!times || !times.length) return '<div class="muted">No departures</div>';
  const sorted = [...times].sort((a, b) => a - b);
  const byHour = new Map();
  for (const t of sorted) {
    const h = Math.floor(t / 60);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push(String(t % 60).padStart(2, '0'));
  }
  let html = '';
  for (const [hour, mins] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
    const hourDisplay = String(hour).padStart(2, '0');
    html += `<div class="hourRow"><span class="hourLabel">${hourDisplay}</span><span class="hourPipe">|</span><div class="hourMins">${mins.join('  ')}</div></div>`;
  }
  return html;
}

function buildCompactDeparturesSection(dirDetails, collapsed = true) {
  const outboundTimes = dirDetails?.['0']?.times || [];
  const inboundTimes = dirDetails?.['1']?.times || [];
  return `
    <div class="sideBySide">
      <div class="directionBlock"><h5>Outbound</h5>${buildCompactDepartures(outboundTimes)}</div>
      <div class="directionBlock"><h5>Inbound</h5>${buildCompactDepartures(inboundTimes)}</div>
    </div>`;
}



function buildGapDistributionBars(headways) {
  if (!headways || !headways.length) return '<div class="muted">No gap data available</div>';

  // Bucket gaps into categories
  const buckets = [
    { label: '≤10 min', min: 0, max: 10, count: 0, tierClass: 'tier10' },
    { label: '11-15 min', min: 11, max: 15, count: 0, tierClass: 'tier15' },
    { label: '16-20 min', min: 16, max: 20, count: 0, tierClass: 'tier20' },
    { label: '21-30 min', min: 21, max: 30, count: 0, tierClass: 'tier30' },
    { label: '>30 min', min: 31, max: Infinity, count: 0, tierClass: 'tier60' }
  ];

  for (const h of headways) {
    for (const b of buckets) {
      if (h >= b.min && h <= b.max) {
        b.count++;
        break;
      }
    }
  }

  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  const rows = buckets.map(b => {
    const pct = (b.count / maxCount) * 100;
    const tripLabel = b.count === 1 ? 'trip' : 'trips';
    return `
      <div class="gapDistRow">
        <span class="gapDistLabel">${b.label}</span>
        <div class="gapDistBarWrap">
          <div class="gapDistBar ${b.tierClass}" style="width:${pct}%"></div>
        </div>
        <span class="gapDistCount">${b.count} ${tripLabel}</span>
      </div>`;
  }).join('');

  return `
    <div class="gapDistribution">
      <h4>Gap Distribution</h4>
      <div class="gapDistContainer">
        <div class="gapDistBars">
          ${rows}
        </div>
      </div>
    </div>`;
}
let currentModalRoute = null;
let currentModalDay = 'Weekday';
let currentModalTab = 'overview'; // 'overview' or 'departures'

function openModal(r, day) {
  currentModalRoute = r.route;
  currentModalDay = day || r.day;
  currentModalTab = 'overview'; // Reset to overview when opening modal

  const modal = document.getElementById('modal');
  modal.style.display = 'flex';

  renderModalContent();
}

function renderModalContent() {
  const route = currentModalRoute;
  const day = currentModalDay;

  // Get data for this route and day
  const r = ROUTE_DATA[route]?.[day];
  if (!r) {
    document.getElementById('modalBody').innerHTML = '<p class="muted">No data available for this day.</p>';
    return;
  }

  const t0 = document.getElementById('t0').value || '07:00';
  const t1 = document.getElementById('t1').value || '22:00';

  // Build modal header with day tabs and content tabs in top bar
  const headerHtml = `
    <div class="modalRouteHeader">
      <span class="modalRouteBadge">${escapeHtml(route)}</span>
      <div class="modalDayTabs">
        <button class="modalDayTab ${day === 'Weekday' ? 'active' : ''}" onclick="switchModalDay('Weekday')">Weekday</button>
        <button class="modalDayTab ${day === 'Saturday' ? 'active' : ''}" onclick="switchModalDay('Saturday')">Saturday</button>
        <button class="modalDayTab ${day === 'Sunday' ? 'active' : ''}" onclick="switchModalDay('Sunday')">Sunday</button>
      </div>
      <div class="modalContentTabs">
        <button class="modalContentTab ${currentModalTab === 'overview' ? 'active' : ''}" onclick="switchModalTab('overview')">Overview</button>
        <button class="modalContentTab ${currentModalTab === 'departures' ? 'active' : ''}" onclick="switchModalTab('departures')">Departures</button>
      </div>
    </div>
  `;

  document.getElementById('modalTitle').innerHTML = headerHtml;

  const dirDetails = r.dirDetails || getDirDetails(route, day);
  const validation = VALIDATIONS[route]?.[day];

  // Calculate separate direction stats
  const outboundTimes = dirDetails?.['0']?.times || [];
  const inboundTimes = dirDetails?.['1']?.times || [];

  const outboundGaps = dirDetails?.['0']?.gaps?.length ? dirDetails['0'].gaps : calculateGaps(outboundTimes);
  const inboundGaps = dirDetails?.['1']?.gaps?.length ? dirDetails['1'].gaps : calculateGaps(inboundTimes);

  const outboundAvg = outboundGaps.length ? Math.round(outboundGaps.reduce((a, b) => a + b, 0) / outboundGaps.length) : null;
  const inboundAvg = inboundGaps.length ? Math.round(inboundGaps.reduce((a, b) => a + b, 0) / inboundGaps.length) : null;

  const outboundMaxGap = outboundGaps.length ? Math.max(...outboundGaps) : null;
  const inboundMaxGap = inboundGaps.length ? Math.max(...inboundGaps) : null;

  const totalTrips = outboundTimes.length + inboundTimes.length;

  // Calculate worst gap from pooled gaps (both directions)
  const worstGap = r.hw && r.hw.length ? Math.max(...r.hw) : null;

  // Get max gap info with direction/time (from mergeRows data or calculate)
  let maxGapInfo = r.maxGapInfo;
  if (!maxGapInfo && worstGap !== null) {
    // Fallback: find it in dirDetails
    for (const dirKey of ['0', '1']) {
      const gapsWithTime = dirDetails?.[dirKey]?.gapsWithTime || [];
      for (const g of gapsWithTime) {
        if (!maxGapInfo || g.gap > maxGapInfo.gap) {
          maxGapInfo = { gap: g.gap, direction: dirKey, time: g.time };
        }
      }
    }
  }

  // Count violations across ALL pooled gaps
  const allGaps = [...outboundGaps, ...inboundGaps];
  const violations = countViolations(allGaps, r.tier);

  // Check for manual override
  const hasOverride = validation?.manual_override;
  const displayTier = hasOverride ? validation.manual_override.tier : r.tier;
  const displayTierLabel = hasOverride ? tierToLabelFromValue(validation.manual_override.tier) : tierToLabel(r.tier);
  const displayTierClass = hasOverride ? tierClassFromValue(validation.manual_override.tier) : tierClass(r.tier);

  // Format max gap location info
  const maxGapDirLabel = maxGapInfo?.direction === '0' ? 'Outbound' : maxGapInfo?.direction === '1' ? 'Inbound' : 'Unknown';
  const maxGapTimeStr = maxGapInfo?.time != null ? m2t(maxGapInfo.time) : '';

  // Get threshold for current tier
  const tierThresholds = {
    't10': '≤10 min', 'tier10': '≤10 min',
    't15': '≤15 min', 'tier15': '≤15 min',
    't20': '≤20 min', 'tier20': '≤20 min',
    't30': '≤30 min', 'tier30': '≤30 min',
    't60': '≤60 min', 'tier60': '≤60 min',
    'tBig': '>60 min', 'tierBig': '>60 min',
    'tSpan': 'Insufficient trips', 'tierSpan': 'Insufficient trips'
  };
  const currentTierThreshold = tierThresholds[displayTierClass] || '';

  // Build 4-column stats row: Frequency | Analysis | Outbound | Inbound
  const statsCardsHtml = `
    <div class="statsRow">
      <div class="statCard frequencyCard">
        <div class="freqHeader">
          <span class="freqBadge ${displayTierClass}">${displayTierLabel}</span>
          <span class="freqThreshold">${currentTierThreshold}</span>
        </div>
        <div class="freqStatRow"><span>Exceptions:</span> <strong>${violations.grace}</strong> <span class="muted">(out of 2)</span></div>
      </div>
      <div class="statCard analysisCard">
        <div class="label" style="margin-bottom:8px">COMBINED ANALYSIS</div>
        <div class="combinedStats">
          <div class="combinedRow">
            <span class="statLabel">Max gap:</span>
            <span class="statValue">${worstGap !== null ? `<strong>${worstGap}m</strong>` : '—'}${maxGapInfo ? ` <span class="muted">(${maxGapDirLabel} at ${maxGapTimeStr})</span>` : ''}</span>
          </div>
          <div class="combinedRow">
            <span class="statLabel">Total trips:</span>
            <span class="statValue"><strong>${totalTrips}</strong> <span class="muted">(${outboundTimes.length} out, ${inboundTimes.length} in)</span></span>
          </div>
          <div class="combinedRow">
            <span class="statLabel">Violations:</span>
            <span class="statValue">${violations.hard > 0 ? `<span class="violationBadge hard">${violations.hard} hard</span>` : ''}${violations.grace > 0 ? `<span class="violationBadge grace">${violations.grace} grace</span>` : ''}${violations.hard === 0 && violations.grace === 0 ? '<span class="muted">None</span>' : ''}</span>
          </div>
        </div>
      </div>
      <div class="statCard dirCard">
        <div class="dirHeader">
          <span class="dirBadgeSmall outbound">Outbound</span>
          <span class="tripCountSmall">${outboundTimes.length} trips</span>
        </div>
        <div class="dirStatRow"><span>Avg headway:</span> <strong>${outboundAvg !== null ? outboundAvg + 'm' : '—'}</strong></div>
        <div class="dirStatRow"><span>Max gap:</span> <strong>${outboundMaxGap !== null ? outboundMaxGap + 'm' : '—'}</strong></div>
      </div>
      <div class="statCard dirCard">
        <div class="dirHeader">
          <span class="dirBadgeSmall inbound">Inbound</span>
          <span class="tripCountSmall">${inboundTimes.length} trips</span>
        </div>
        <div class="dirStatRow"><span>Avg headway:</span> <strong>${inboundAvg !== null ? inboundAvg + 'm' : '—'}</strong></div>
        <div class="dirStatRow"><span>Max gap:</span> <strong>${inboundMaxGap !== null ? inboundMaxGap + 'm' : '—'}</strong></div>
      </div>
    </div>
  `;

  // Build chart with separate direction lines
  const chartSection = buildDirectionalChart(dirDetails, r.tier);

  // Build gap distribution section (horizontal bar chart)
  const gapDistSection = buildGapDistributionBars(r.hw);

  // Build departure times section
  const departuresSection = buildCompactDeparturesSection(dirDetails, false);

  // Build validation panel
  const feedValidity = FEED_INFO?.validFrom && FEED_INFO?.validTo
    ? `${formatGtfsDate(FEED_INFO.validFrom)} to ${formatGtfsDate(FEED_INFO.validTo)}`
    : 'Unknown';
  const analyzedAt = ANALYZED_AT ? new Date(ANALYZED_AT).toLocaleString() : 'Unknown';
  const verifiedAt = validation?.verifiedAt ? new Date(validation.verifiedAt).toLocaleString() : 'Not verified';

  // Get lineage data for this route
  const lineage = getRouteLineage(route);

  // Get lineage attributes
  const attributes = lineage.route_changes?.changes || [];

  const validationPanelHtml = `
    <div class="validationPanel panel">
      <h4>Verification</h4>

      <div class="verificationSection">
        <label>SOURCE</label>
        <div class="btnGroup">
          <button class="verifyBtn ${(!validation?.data_source || validation?.data_source === 'gtfs') ? 'active' : ''}" data-source="gtfs" onclick="selectSource('gtfs')">GTFS</button>
          <button class="verifyBtn ${validation?.data_source === 'pdf' ? 'active' : ''}" data-source="pdf" onclick="selectSource('pdf')">PDF</button>
          <button class="verifyBtn ${validation?.data_source === 'manual' ? 'active' : ''}" data-source="manual" onclick="selectSource('manual')">Manual</button>
        </div>
      </div>

      ${renderMultiSelect('attributes', 'ATTRIBUTES', [
    { value: 'branches', label: 'Branches' },
    { value: 'short-turns', label: 'Short-Turns' },
    { value: 'discontinued', label: 'Discontinued' }
  ], attributes)}

      <div class="verificationSection">
        <label>STATUS</label>
        <div class="btnGroup">
          <button class="verifyBtn ${validation?.status === 'correct' ? 'active' : ''}" data-status="correct" onclick="selectStatus('correct')">✓ Correct</button>
          <button class="verifyBtn ${validation?.status === 'incorrect' ? 'active' : ''}" data-status="incorrect" onclick="selectStatus('incorrect')">✗ Incorrect</button>
          <button class="verifyBtn ${!validation || validation.status === 'unverified' ? 'active' : ''}" data-status="unverified" onclick="selectStatus('unverified')">? Needs Verification</button>
        </div>
      </div>

      <div id="frequencySection" class="verificationSection" style="display:${validation?.status === 'incorrect' ? 'block' : 'none'}">
        <label>FREQUENCY (if incorrect)</label>
        <div class="btnGroup btnGroupWrap">
          <button class="verifyBtn ${validation?.expectedFreq === '10' ? 'active' : ''}" data-freq="10" onclick="selectFrequency('10')">10</button>
          <button class="verifyBtn ${validation?.expectedFreq === '15' ? 'active' : ''}" data-freq="15" onclick="selectFrequency('15')">15</button>
          <button class="verifyBtn ${validation?.expectedFreq === '20' ? 'active' : ''}" data-freq="20" onclick="selectFrequency('20')">20</button>
          <button class="verifyBtn ${validation?.expectedFreq === '30' ? 'active' : ''}" data-freq="30" onclick="selectFrequency('30')">30</button>
          <button class="verifyBtn ${validation?.expectedFreq === '60' ? 'active' : ''}" data-freq="60" onclick="selectFrequency('60')">60</button>
          <button class="verifyBtn ${validation?.expectedFreq === 'longer' ? 'active' : ''}" data-freq="longer" onclick="selectFrequency('longer')">Longer</button>
          <button class="verifyBtn ${validation?.expectedFreq === 'exclude' ? 'active' : ''}" data-freq="exclude" onclick="selectFrequency('exclude')" style="color:var(--meh)">Exclude</button>
        </div>
      </div>
      
      <div id="exclusionSection" class="verificationSection" style="display:${validation?.expectedFreq === 'exclude' ? 'block' : 'none'}">
        ${renderMultiSelect('exclusion', 'REASON FOR EXCLUSION', [
    { value: 'frequency', label: 'Frequency' },
    { value: 'span', label: 'Span' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'inaccessible', label: 'Inaccessible Schedules' },
    { value: 'other', label: 'Other' }
  ], Array.isArray(validation?.exclusionReason) ? validation.exclusionReason : (validation?.exclusionReason ? [validation.exclusionReason] : []))}
      </div>

      <div class="verificationSection">
        <label>NOTES</label>
        <textarea id="validationNotes" placeholder="e.g., Checked against Jan 2025 PDF schedule" rows="4">${escapeHtml(validation?.notes || '')}</textarea>
      </div>

      <button onclick="saveVerification()" class="btn" style="width:100%">Save</button>

      <div class="validationMeta" style="margin-top:12px">
        <div><strong>Feed validity:</strong> <span id="modalFeedValidity">${escapeHtml(feedValidity)}</span></div>
        <div><strong>Analyzed:</strong> <span id="modalAnalyzedAt">${escapeHtml(analyzedAt)}</span></div>
        <div><strong>Last verified:</strong> <span id="verifiedAt">${escapeHtml(verifiedAt)}</span></div>
        ${window.IS_HISTORICAL_DATA ? '<div style="color:#f59e0b;font-weight:700">This is historical data (feed has expired)</div>' : ''}
      </div>
    </div>
  `;

  // Build content based on active tab
  const overviewContent = `
    ${statsCardsHtml}
    <div class="chartsRow">
      ${chartSection}
      ${gapDistSection}
    </div>
  `;

  const departuresContent = `
    <div class="compactDepartures">
      <h4>Departure Times</h4>
      ${departuresSection}
    </div>
  `;

  const body = document.getElementById('modalBody');
  body.innerHTML = `
    <div class="modalGrid">
      <div class="modalTopRow">
        <div class="modalMain">
          ${currentModalTab === 'overview' ? overviewContent : departuresContent}
        </div>
        <div class="modalSidebar">
          ${validationPanelHtml}
        </div>
      </div>
    </div>
  `;
}

function switchModalDay(day) {
  currentModalDay = day;
  renderModalContent();
}

function switchModalTab(tab) {
  currentModalTab = tab;
  renderModalContent();
}

function calculateGaps(times) {
  if (!times || times.length < 2) return [];
  const sorted = [...times].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap >= 5 && gap <= 240) gaps.push(gap);
  }
  return gaps;
}

function buildDirectionalChart(dirDetails, tier) {
  const outboundTimes = (dirDetails?.['0']?.times || []).sort((a, b) => a - b);
  const inboundTimes = (dirDetails?.['1']?.times || []).sort((a, b) => a - b);

  if (outboundTimes.length < 2 && inboundTimes.length < 2) return '<p class="muted">Not enough data for chart</p>';

  // Chart dimensions
  const width = 680, height = 200, padL = 50, padR = 20, padT = 25, padB = 40;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Time scale
  const t0 = document.getElementById('t0')?.value || '07:00';
  const t1 = document.getElementById('t1')?.value || '22:00';
  const minTime = t2m(t0);
  const maxTime = t2m(t1);

  // Calculate gaps for each direction
  const outboundData = [];
  for (let i = 1; i < outboundTimes.length; i++) {
    const gap = outboundTimes[i] - outboundTimes[i - 1];
    if (gap >= 5 && gap <= 120) {
      outboundData.push({ time: outboundTimes[i - 1], gap });
    }
  }

  const inboundData = [];
  for (let i = 1; i < inboundTimes.length; i++) {
    const gap = inboundTimes[i] - inboundTimes[i - 1];
    if (gap >= 5 && gap <= 120) {
      inboundData.push({ time: inboundTimes[i - 1], gap });
    }
  }

  // Find max gap for Y scale
  const allGaps = [...outboundData.map(d => d.gap), ...inboundData.map(d => d.gap)];
  const maxGap = Math.min(60, Math.max(12, ...allGaps) + 5);

  const scaleX = t => (t - minTime) / (maxTime - minTime) * chartW;
  const scaleY = g => chartH - (g / maxGap) * chartH;

  // Build outbound path (cyan)
  let outPath = '';
  let outDots = '';
  if (outboundData.length >= 1) {
    outPath = `M ${padL + scaleX(outboundData[0].time)} ${padT + scaleY(outboundData[0].gap)}`;
    for (let i = 1; i < outboundData.length; i++) {
      outPath += ` L ${padL + scaleX(outboundData[i].time)} ${padT + scaleY(outboundData[i].gap)}`;
    }
    outDots = outboundData.map(d =>
      `<circle cx="${padL + scaleX(d.time)}" cy="${padT + scaleY(d.gap)}" r="4" fill="#06b6d4"/>`
    ).join('');
  }

  // Build inbound path (green)
  let inPath = '';
  let inDots = '';
  if (inboundData.length >= 1) {
    inPath = `M ${padL + scaleX(inboundData[0].time)} ${padT + scaleY(inboundData[0].gap)}`;
    for (let i = 1; i < inboundData.length; i++) {
      inPath += ` L ${padL + scaleX(inboundData[i].time)} ${padT + scaleY(inboundData[i].gap)}`;
    }
    inDots = inboundData.map(d =>
      `<circle cx="${padL + scaleX(d.time)}" cy="${padT + scaleY(d.gap)}" r="4" fill="#10b981"/>`
    ).join('');
  }

  // X-axis labels
  const xLabels = [];
  for (let h = Math.ceil(minTime / 60); h <= Math.floor(maxTime / 60); h++) {
    const x = padL + scaleX(h * 60);
    const label = h > 12 ? `${h - 12}p` : h === 12 ? '12p' : h === 0 ? '12a' : `${h}a`;
    xLabels.push(`<text x="${x}" y="${height - 8}" class="chartAxisLabel" text-anchor="middle">${label}</text>`);
  }

  // Y-axis labels
  const yLabels = [];
  const yTicks = [0, 10, 20, 30, maxGap > 40 ? 40 : null, maxGap > 50 ? 60 : null].filter(v => v !== null && v <= maxGap);
  for (const g of yTicks) {
    const y = padT + scaleY(g);
    yLabels.push(`<text x="${padL - 8}" y="${y + 4}" class="chartAxisLabel" text-anchor="end">${g}</text>`);
    yLabels.push(`<line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="var(--line)" stroke-dasharray="2,2"/>`);
  }

  return `
    <div class="chartSection">
      <h4>Frequency Throughout Day</h4>
      <div class="chartContainer">
        <svg class="chartSvg" viewBox="0 0 ${width} ${height}" style="height:200px">
          <!-- Axes -->
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" class="chartAxis"/>
          <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" class="chartAxis"/>
          ${yLabels.join('')}
          ${xLabels.join('')}

          <!-- Outbound line (cyan) -->
          ${outPath ? `<path d="${outPath}" fill="none" stroke="#06b6d4" stroke-width="2"/>` : ''}
          ${outDots}

          <!-- Inbound line (green) -->
          ${inPath ? `<path d="${inPath}" fill="none" stroke="#10b981" stroke-width="2"/>` : ''}
          ${inDots}

          <text x="8" y="${padT + chartH / 2}" class="chartAxisLabel" transform="rotate(-90,8,${padT + chartH / 2})">Headway (min)</text>
        </svg>
        <div class="chartLegendDir">
          <span><span class="dot" style="background:#06b6d4"></span>Outbound</span>
          <span><span class="dot" style="background:#10b981"></span>Inbound</span>
        </div>
      </div>
    </div>
  `;
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }

function updateResultsMaxHeight() {
  const results = document.getElementById('resultsScroll');
  if (!results) return;
  results.style.removeProperty('max-height');
  results.style.overflow = 'visible';
}

// Export functions
function exportResults() {
  const agency = prompt('Enter agency slug (e.g., spokane-transit):');
  if (!agency) return;

  const agencyName = prompt('Enter agency full name (e.g., Spokane Transit Authority):');
  if (!agencyName) return;

  const data = {
    schema_version: '1.1',

    check: {
      id: `${agency}_${new Date().toISOString().split('T')[0]}`,
      created_at: ANALYZED_AT,
      is_historical: window.IS_HISTORICAL_DATA || false
    },

    agency: {
      id: agency,
      name: agencyName
    },

    gtfs_feed: {
      filename: FEED_INFO?.filename || 'unknown.zip',
      valid_from: FEED_INFO?.validFrom || null,
      valid_to: FEED_INFO?.validTo || null,
      version: FEED_INFO?.version || null,
      publisher: FEED_INFO?.publisher || null
    },

    methodology: {
      version: '1.0',
      window_start: document.getElementById('t0').value,
      window_end: document.getElementById('t1').value,
      grace_minutes: 5,
      max_violations: 2,
      merge_directions: document.getElementById('merge').checked
    },

    routes: buildRouteExports()
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${agency}_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildRouteExports() {
  const routes = [];

  for (const routeName of Object.keys(ROUTE_DATA)) {
    const route = {
      route_id: routeName,
      route_name: routeName,
      mode: ROUTE_MODES[routeName] || 'Bus'
    };

    // Add lineage metadata if exists
    const lineage = ROUTE_LINEAGE[routeName];
    if (lineage) {
      // Include stable_id if set
      if (lineage.stable_id) {
        route.stable_id = lineage.stable_id;
      }

      // Include route_changes if any changes selected or notes provided
      const rc = lineage.route_changes;
      if (rc && (rc.changes?.length > 0 || rc.notes || rc.comparable_to_previous === false)) {
        route.route_changes = {
          changes: rc.changes || [],
          comparable_to_previous: rc.comparable_to_previous !== false,
          notes: rc.notes || ''
        };
      }
    }

    for (const day of ['Weekday', 'Saturday', 'Sunday']) {
      const dayData = ROUTE_DATA[routeName][day];
      if (!dayData) continue;

      const dayKey = day.toLowerCase();
      const validation = VALIDATIONS[routeName]?.[day];
      const override = validation?.manual_override;

      // Calculate calculated tier and determine final tier
      const calculatedTier = dayData.tier;
      const finalTier = override?.tier ? tierValueToStandard(override.tier) : calculatedTier;

      route[dayKey] = {
        tier: finalTier,
        calculated_tier: calculatedTier,
        is_override: !!override,
        override_reason: override?.reason || '',
        avg_headway: dayData.avg,
        best_headway: dayData.best,
        max_gap: Math.max(...dayData.hw),
        total_trips: dayData.times.length,
        violations: dayData.hw.filter(h => h > tierThreshold(dayData.tier) && h <= tierThreshold(dayData.tier) + 5).length
      };

      // Include validation if exists
      if (validation) {
        route[dayKey].validation = {
          status: validation.status,
          verified_at: validation.verifiedAt,
          notes: validation.notes,
          expected_tier: validation.expectedTier,
          data_source: validation.data_source || 'gtfs',
          source_notes: validation.source_notes || ''
        };
      }
    }



    // Excluded routes are now INCLUDED in the export, but will have tier: 'exclude' and exclusion_reason set within their validation/day object.

    routes.push(route);
  }

  return routes;
}

// Mock Sync Function
async function syncToAtlas() {
  const agency = prompt('Enter agency slug for Atlas Sync (e.g., spokane-transit):');
  if (!agency) return;

  const confirmSync = confirm(`Ready to sync ${Object.keys(ROUTE_DATA).length} routes to Transit Atlas project "${agency}"?\n\n(Note: Atlas is not built yet, this checks connection)`);

  if (confirmSync) {
    const payload = {
      agency_id: agency,
      synced_at: new Date().toISOString(),
      routes: buildRouteExports()
    };

    console.log('--- SYNCING TO ATLAS (MOCK) ---');
    console.log(JSON.stringify(payload, null, 2));

    // Simulate network delay
    document.getElementById('syncBtn').textContent = 'Syncing...';
    document.getElementById('syncBtn').disabled = true;

    await new Promise(r => setTimeout(r, 1500));

    alert('Successfully synced to Transit Atlas! (Mock Success)\n\nPayload logged to console.');
    document.getElementById('syncBtn').textContent = 'Sync to Atlas';
    document.getElementById('syncBtn').disabled = false;
  }
}

// Global click listener to close dropdowns
document.addEventListener('click', function (e) {
  if (!e.target.closest('.multiSelectInput')) {
    document.querySelectorAll('.dropdownMenu.show').forEach(menu => {
      menu.classList.remove('show');
    });
  }
});

// Multi-Select Helper Functions

function renderMultiSelect(id, label, options, selectedValues, placeholder = 'Search...') {
  // Store options globally or in a way we can access them for filtering
  if (!window.MULTI_SELECT_OPTIONS) window.MULTI_SELECT_OPTIONS = {};
  window.MULTI_SELECT_OPTIONS[id] = options;

  const selectedChips = selectedValues.map(val => {
    const opt = options.find(o => o.value === val);
    const labelText = opt ? opt.label : val;
    return `
      <div class="chip" data-value="${val}">
        ${labelText}
        <span class="removeChip" onclick="removeMultiSelectOption('${id}', '${val}', event)">×</span>
      </div>
    `;
  }).join('');

  const dropdownOptions = options.map(opt => {
    const isSelected = selectedValues.includes(opt.value);
    return `
      <div class="dropdownOption ${isSelected ? 'selected' : ''}" data-val="${opt.value}" onclick="toggleMultiSelectOption('${id}', '${opt.value}')">
        <input type="checkbox" ${isSelected ? 'checked' : ''}>
        <span>${opt.label}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="verificationSection" id="${id}-section">
      <label>${label}</label>
      <div class="multiSelectContainer" id="${id}-container">
        <div class="multiSelectInput" onclick="openMultiSelectDropdown('${id}')">
          <div class="multiSelectChips" id="${id}-chips">
            ${selectedChips}
          </div>
          <input type="text" class="searchField" placeholder="${placeholder}" 
            oninput="filterMultiSelectOptions('${id}')" 
            onfocus="openMultiSelectDropdown('${id}')"
            id="${id}-search"
            autocomplete="off"
          >
        </div>
        <div class="dropdownMenu" id="${id}-dropdown">
          <div id="${id}-options">
            ${dropdownOptions}
          </div>
          <div class="noResults" id="${id}-no-results" style="display:none">No matches found</div>
        </div>
      </div>
    </div>
  `;
}

function openMultiSelectDropdown(id) {
  // Close others
  document.querySelectorAll('.dropdownMenu.show').forEach(m => {
    if (m.id !== `${id}-dropdown`) m.classList.remove('show');
  });

  const dropdown = document.getElementById(`${id}-dropdown`);
  if (dropdown) {
    dropdown.classList.add('show');
    // document.getElementById(`${id}-search`).focus();
  }
}

function toggleMultiSelectOption(id, value) {
  const chipsContainer = document.getElementById(`${id}-chips`);
  const optionsContainer = document.getElementById(`${id}-options`);
  if (!chipsContainer || !optionsContainer) return;

  const options = window.MULTI_SELECT_OPTIONS[id] || [];
  const optData = options.find(o => o.value === value);
  const label = optData ? optData.label : value;

  // Check if already selected
  const existingChip = chipsContainer.querySelector(`.chip[data-value="${value}"]`);

  if (existingChip) {
    // Remove it
    existingChip.remove();
    // Uncheck in dropdown
    const dropOpt = optionsContainer.querySelector(`.dropdownOption[data-val="${value}"]`);
    if (dropOpt) {
      dropOpt.classList.remove('selected');
      dropOpt.querySelector('input').checked = false;
    }
  } else {
    // Add it
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.value = value;
    chip.innerHTML = `
      ${label}
      <span class="removeChip" onclick="removeMultiSelectOption('${id}', '${value}', event)">×</span>
    `;
    chipsContainer.appendChild(chip);

    // Check in dropdown
    const dropOpt = optionsContainer.querySelector(`.dropdownOption[data-val="${value}"]`);
    if (dropOpt) {
      dropOpt.classList.add('selected');
      dropOpt.querySelector('input').checked = true;
    }
  }

  // Clear search and reset filter
  const searchInput = document.getElementById(`${id}-search`);
  if (searchInput) {
    searchInput.value = '';
    filterMultiSelectOptions(id);
    searchInput.focus();
  }
}

function removeMultiSelectOption(id, value, event) {
  if (event) event.stopPropagation();

  const chipsContainer = document.getElementById(`${id}-chips`);
  const optionsContainer = document.getElementById(`${id}-options`);

  const chip = chipsContainer.querySelector(`.chip[data-value="${value}"]`);
  if (chip) chip.remove();

  const dropOpt = optionsContainer.querySelector(`.dropdownOption[data-val="${value}"]`);
  if (dropOpt) {
    dropOpt.classList.remove('selected');
    dropOpt.querySelector('input').checked = false;
  }
}

function filterMultiSelectOptions(id) {
  const searchInput = document.getElementById(`${id}-search`);
  const query = searchInput.value.toLowerCase();
  const optionsContainer = document.getElementById(`${id}-options`);
  const noResults = document.getElementById(`${id}-no-results`);

  let matchCount = 0;
  optionsContainer.querySelectorAll('.dropdownOption').forEach(opt => {
    const text = opt.innerText.toLowerCase();
    if (text.includes(query)) {
      opt.style.display = 'flex';
      matchCount++;
    } else {
      opt.style.display = 'none';
    }
  });

  if (matchCount === 0) {
    noResults.style.display = 'block';
  } else {
    noResults.style.display = 'none';
  }
}
