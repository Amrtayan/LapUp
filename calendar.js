/* ═══════════════════════════════════════════════════════════════
   Calendar — Logic
   For each day: total session time (sum over all sessions) and the
   average efficiency of that day's sessions. Days roll over at 04:00,
   matching the rest of the app.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const DAY_BOUNDARY_HOURS = 4;
  const SESSIONS_KEY = 'laptrack_sessions';
  const BASELINE_KEY = 'lapup_calendar_baseline_ms';
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const monthEl = document.getElementById('cal-month');
  const gridEl = document.getElementById('cal-grid');
  const weekdaysEl = document.getElementById('cal-weekdays');

  const baselineInput = document.getElementById('baseline-input');

  let sessions = [];
  let baselineMs = 0; // 0 = no baseline set
  let viewYear, viewMonth; // viewMonth: 0-11

  // ── Helpers ───────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');

  // Timestamp -> 'YYYY-MM-DD' for the logical (4 AM) day it belongs to
  function logicalDayKey(ts) {
    const d = new Date(ts - DAY_BOUNDARY_HOURS * 3600 * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function msToHHMMSS(ms) {
    const total = Math.floor(ms / 1000);
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  }

  // 'H' | 'H:MM' | 'H:MM:SS' -> ms (null if invalid, 0 for empty)
  function parseBaseline(str) {
    const t = str.trim();
    if (t === '') return 0;
    const parts = t.split(':');
    if (parts.length > 3 || parts.some(p => !/^\d{1,3}$/.test(p.trim()))) return null;
    const [h, m = 0, s = 0] = parts.map(Number);
    if (m > 59 || s > 59) return null;
    return ((h * 60 + m) * 60 + s) * 1000;
  }

  function loadBaseline() {
    try { baselineMs = Number(localStorage.getItem(BASELINE_KEY)) || 0; } catch (e) { baselineMs = 0; }
    baselineInput.value = baselineMs > 0 ? msToHHMMSS(baselineMs) : '';
  }

  function commitBaseline() {
    const ms = parseBaseline(baselineInput.value);
    baselineInput.classList.toggle('invalid', ms === null);
    if (ms === null) return;
    baselineMs = ms;
    try { localStorage.setItem(BASELINE_KEY, String(ms)); } catch (e) {}
    render();
  }

  // Recorded laps + the lap in progress (same rule as the sessions panel)
  function sessionTotalMs(s) {
    const recorded = (s.laps || [])
      .filter(l => !l.type || l.type === 'lap')
      .reduce((acc, l) => acc + (l.lapTimeMs || 0), 0)
      + (s.laps || []).filter(l => l.type === 'manual').reduce((acc, l) => acc + (l.durationMs || 0), 0);
    return recorded + Math.max(0, (s.elapsedMs || 0) - (s.lapStartMs || 0));
  }

  // dayKey -> { totalMs, effSum, effCount }
  function buildDayStats() {
    const stats = new Map();
    for (const s of sessions) {
      const ts = s.startTime || s.createdTime;
      if (!ts) continue;
      const key = logicalDayKey(ts);
      if (!stats.has(key)) stats.set(key, { totalMs: 0, effSum: 0, effCount: 0 });
      const st = stats.get(key);
      st.totalMs += sessionTotalMs(s);
      if (typeof s.efficiency === 'number') {
        st.effSum += s.efficiency;
        st.effCount++;
      }
    }
    return stats;
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    monthEl.textContent = new Date(viewYear, viewMonth, 1)
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const stats = buildDayStats();
    const todayKey = logicalDayKey(Date.now());
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push('<div class="cal-cell empty"></div>');

    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
      const st = stats.get(key);
      const hasTime = st && st.totalMs > 0;
      const hasEff = st && st.effCount > 0;
      const classes = ['cal-cell'];
      if (hasTime || hasEff) classes.push('has-data');
      if (key === todayKey) classes.push('today');
      if (baselineMs > 0 && hasTime && st.totalMs < baselineMs) classes.push('below-baseline');

      cells.push(`
        <div class="${classes.join(' ')}">
          <div class="cal-date">${day}</div>
          ${hasTime ? `<div class="cal-total">${msToHHMMSS(st.totalMs)}</div>` : ''}
          ${hasEff ? `<div class="cal-eff">${(st.effSum / st.effCount).toFixed(2)}x</div>`
            : (hasTime ? `<div class="cal-eff cal-eff-empty">-</div>` : '')}
        </div>`);
    }

    // Fill the last row so the grid lines stay tidy
    while (cells.length % 7 !== 0) cells.push('<div class="cal-cell empty"></div>');
    gridEl.innerHTML = cells.join('');
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      sessions = raw ? JSON.parse(raw) : [];
    } catch (e) {
      sessions = [];
    }
  }

  function goToMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    render();
  }

  function goToToday() {
    const now = new Date(Date.now() - DAY_BOUNDARY_HOURS * 3600 * 1000);
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    render();
  }

  // ── Optional cloud merge (read-only) ──────────────────────────
  // Brings in sessions from other devices that this browser hasn't synced yet.
  async function mergeFromCloud() {
    try {
      const fb = await import('./firebase-config.js');
      fb.onAuthChange(async (user) => {
        if (!user) return;
        const result = await fb.loadSessionsFromCloud();
        if (!result) return;
        sessions = fb.mergeSessions(sessions, result.sessions);
        render();
      });
    } catch (e) {
      console.warn('[LapUp] Calendar: cloud data unavailable, showing local sessions.', e);
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  weekdaysEl.innerHTML = WEEKDAYS.map(d => `<div>${d}</div>`).join('');
  document.getElementById('btn-prev-month').addEventListener('click', () => goToMonth(-1));
  document.getElementById('btn-next-month').addEventListener('click', () => goToMonth(1));
  document.getElementById('btn-today').addEventListener('click', goToToday);
  baselineInput.addEventListener('input', commitBaseline);
  baselineInput.addEventListener('blur', () => {
    const ms = parseBaseline(baselineInput.value);
    if (ms !== null) baselineInput.value = ms > 0 ? msToHHMMSS(ms) : '';
    baselineInput.classList.remove('invalid');
  });
  baselineInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') baselineInput.blur(); });
  // Another tab changed the baseline
  window.addEventListener('storage', (e) => {
    if (e.key === BASELINE_KEY) { loadBaseline(); render(); }
  });

  // Refresh if sessions change in another tab / when returning to this one
  window.addEventListener('storage', (e) => {
    if (e.key === SESSIONS_KEY) { loadLocal(); render(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { loadLocal(); render(); }
  });

  loadBaseline();
  loadLocal();
  goToToday();
  mergeFromCloud();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
