// ── Firebase imports ─────────────────────────────────────────
import {
  getCurrentUser,
  signInWithGoogle,
  signOutUser,
  onAuthChange,
  saveSessionsToCloud,
  loadSessionsFromCloud,
  mergeSessions
} from './firebase-config.js';

// ── State ────────────────────────────────────────────────────
let elapsedMs   = 0;          // total ms on the clock
let lapStartMs  = 0;          // ms at which the current lap began
let lapMedianMs = 0;          // user-set median in ms (0 = not set)
let isRunning   = false;
let rafId       = null;       // requestAnimationFrame handle
let lastTimestamp = null;     // last rAF timestamp
let laps        = [];         // { type: 'lap'/'cycle_change'/'gap', ... }
let lapCounter  = 1;          // next lap number
let lastSavedElapsedMs = 0;   // last elapsedMs at which we autosaved
let clearStopwatchWithLap = true; // permanently true
let tempMedians = [];         // temporary medians list for Set Lap Cycle modal
let mobileShowStates = {};    // tracks independent timeouts for each lap's eye icon

// ── Gap Timer State ──────────────────────────────────────────
let gapElapsedMs      = 0;    // ms in the currently-running / accumulated gap
let gapLastTimestamp  = null; // rAF timestamp for gap tick
let isGapRunning      = false;// gap timer is actively ticking
let gapRafId          = null; // rAF handle for gap tick loop
let currentGapLapNum  = 0;    // display lap# (in-cycle) at time of current pause

let sessions      = [];       // study sessions list
let activeSessionId = null;   // active session ID

// DOM refs
const clockDigits      = document.getElementById('clock-digits');
const clockCs          = document.getElementById('clock-cs');
const clockDisplay     = document.getElementById('clock-display');
const lapSegmentLabel  = document.getElementById('lap-segment-label');
const medianDisplay    = document.getElementById('median-value-display');
const dialProgress     = document.getElementById('dial-progress');
const dialSvg          = document.getElementById('dial-svg');
const ledgerBody       = document.getElementById('ledger-body');
const ledgerEmpty      = document.getElementById('ledger-empty');
const ledgerLapCount   = document.getElementById('ledger-lap-count');
const netDeficitValue  = document.getElementById('net-deficit-value');
const netSubtext       = document.getElementById('net-subtext');
const btnStart         = document.getElementById('btn-start');
const btnLap           = document.getElementById('btn-lap');
const btnReset         = document.getElementById('btn-reset');
const btnSetMedian     = document.getElementById('btn-set-median');
const modalOverlay     = document.getElementById('modal-overlay');
const btnModalSet      = document.getElementById('btn-modal-set');
const btnModalCancel   = document.getElementById('btn-modal-cancel');
const inputHH          = document.getElementById('input-hh');
const inputMM          = document.getElementById('input-mm');
const inputSS          = document.getElementById('input-ss');

// Sidebar DOM refs
const sidebar            = document.getElementById('sidebar');
const sessionsList       = document.getElementById('sessions-list');
const btnToggleSidebar   = document.getElementById('btn-toggle-sidebar');
const btnCreateSession   = document.getElementById('btn-create-session');

// Auth DOM refs
const btnAuth            = document.getElementById('btn-auth');
const btnAvatar          = document.getElementById('btn-avatar');
const avatarImg          = document.getElementById('avatar-img');
const authDropdown       = document.getElementById('auth-dropdown');
const authDropdownUser   = document.getElementById('auth-dropdown-user');
const authDropdownSync   = document.getElementById('auth-dropdown-sync');
const btnSignOut         = document.getElementById('btn-sign-out');

// Modal list and add button DOM refs
const btnModalAddMedian  = document.getElementById('btn-modal-add-median');
const modalCycleList     = document.getElementById('modal-cycle-list');

// Remarks DOM refs
const btnRemarks         = document.getElementById('btn-remarks');
const remarksModalOverlay = document.getElementById('remarks-modal-overlay');
const remarksTextarea    = document.getElementById('remarks-textarea');
const remarksSaveIndicator = document.getElementById('remarks-save-indicator');
const btnRemarksClose    = document.getElementById('btn-remarks-close');

// Gap Timer DOM refs
const gapTimerContainer  = document.getElementById('gap-timer-container');
const gapDigits          = document.getElementById('gap-digits');
const gapCs              = document.getElementById('gap-cs');
const gapTotalRow        = document.getElementById('gap-total-row');
const gapTotalValue      = document.getElementById('gap-total-value');

// View toggle DOM refs
const activeSessionView    = document.getElementById('active-session-view');
const noSessionView        = document.getElementById('no-session-view');
const btnCreateSessionBig  = document.getElementById('btn-create-session-big');

// Dial constants
const DIAL_RADIUS      = 132;
const DIAL_CIRCUMF     = 2 * Math.PI * DIAL_RADIUS; // ≈ 829.38

// ── Tick mark generation ─────────────────────────────────────
(function generateTicks() {
  const tickGroup = document.getElementById('dial-ticks');
  const cx = 160, cy = 160;
  const majorOuter = 145, majorInner = 136;
  const minorOuter = 143, minorInner = 138;
  const count = 60;

  for (let i = 0; i < count; i++) {
    const angle  = (i / count) * 2 * Math.PI - Math.PI / 2;
    const isMajor = i % 5 === 0;
    const r1 = isMajor ? majorOuter : minorOuter;
    const r2 = isMajor ? majorInner : minorInner;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx + r1 * Math.cos(angle));
    line.setAttribute('y1', cy + r1 * Math.sin(angle));
    line.setAttribute('x2', cx + r2 * Math.cos(angle));
    line.setAttribute('y2', cy + r2 * Math.sin(angle));
    line.setAttribute('class', isMajor ? 'dial-tick-major' : 'dial-tick-minor');
    tickGroup.appendChild(line);
  }
})();

// ── Helpers ───────────────────────────────────────────────────
function pad(n, len = 2) {
  return String(Math.floor(n)).padStart(len, '0');
}

function msToHHMMSScs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const cs       = Math.floor((ms % 1000) / 10);
  const ss       = totalSec % 60;
  const mm       = Math.floor(totalSec / 60) % 60;
  const hh       = Math.floor(totalSec / 3600);
  return {
    main:  `${pad(hh)}:${pad(mm)}:${pad(ss)}`,
    cs:    `.${pad(cs)}`
  };
}

function msToHHMMSS(ms) {
  const t = msToHHMMSScs(ms);
  return t.main;
}

// Format deficit: + under, - over (user convention)
function formatDeficit(defMs) {
  const abs  = Math.abs(defMs);
  const sign = defMs > 0 ? '-' : '+';   // over = negative sign (bad)
  return sign + msToHHMMSS(abs);
}

// Lerp between two hex colors, t in [0,1]
function lerpColor(hex1, hex2, t) {
  const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
  const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
  const r  = Math.round(r1 + (r2 - r1) * t);
  const g  = Math.round(g1 + (g2 - g1) * t);
  const b  = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Clock rendering ───────────────────────────────────────────
function renderClock(ms) {
  const { main, cs } = msToHHMMSScs(ms);
  clockDigits.textContent = main;
  clockCs.textContent     = cs;
}

function getActiveMedians() {
  for (let i = laps.length - 1; i >= 0; i--) {
    if (laps[i].type === 'cycle_change') {
      return laps[i].medians || [];
    }
  }
  return lapMedianMs > 0 ? [lapMedianMs] : [];
}

function getCurrentLapTarget() {
  const activeMedians = getActiveMedians();
  if (activeMedians.length === 0) return 0;
  
  let lapsInCurrentCycle = 0;
  for (let i = laps.length - 1; i >= 0; i--) {
    if (laps[i].type === 'cycle_change') break;
    if (laps[i].type === 'lap') lapsInCurrentCycle++;
  }
  return activeMedians[lapsInCurrentCycle % activeMedians.length];
}

function updateMedianDisplay() {
  const activeMedians = getActiveMedians();
  if (activeMedians.length === 0) {
    medianDisplay.textContent = 'No cycle set';
    return;
  }

  // Count only recorded lap-type events since the last cycle_change
  let lapsInCurrentCycle = 0;
  for (let i = laps.length - 1; i >= 0; i--) {
    if (laps[i].type === 'cycle_change') break;
    if (laps[i].type === 'lap') lapsInCurrentCycle++;
  }
  
  const currentIdx = lapsInCurrentCycle % activeMedians.length;
  const currentTargetMs = activeMedians[currentIdx];
  medianDisplay.textContent = `${msToHHMMSS(currentTargetMs)} (${currentIdx + 1}/${activeMedians.length})`;
}

// ── Dial update (called every frame) ─────────────────────────
function updateDial() {
  const currentTargetMs = getCurrentLapTarget();
  if (currentTargetMs <= 0) {
    // No target: static decorative ring at 0
    dialProgress.style.strokeDashoffset = DIAL_CIRCUMF;
    dialProgress.style.stroke = '#4a90d9';
    setClockColor(null);
    return;
  }

  const currentLapMs = elapsedMs - lapStartMs;
  const ratio        = clamp(currentLapMs / currentTargetMs, 0, 1);
  const offset       = DIAL_CIRCUMF * (1 - ratio);
  dialProgress.style.strokeDashoffset = offset;

  if (currentLapMs > currentTargetMs) {
    // Target breached: arc goes red; clock digits interpolate white→red over 30s
    const overMs = currentLapMs - currentTargetMs;
    const t      = clamp(overMs / 30000, 0, 1);
    const color  = lerpColor('#e8eaf6', '#ff4d6d', t);
    dialProgress.style.stroke = lerpColor('#4a90d9', '#ff4d6d', clamp(overMs / 5000, 0, 1));
    dialProgress.style.filter = `drop-shadow(0 0 6px ${dialProgress.style.stroke}88)`;
    setClockColor(color);
  } else {
    dialProgress.style.stroke = '#4a90d9';
    dialProgress.style.filter = 'drop-shadow(0 0 6px rgba(74,144,217,0.6))';
    setClockColor(null);
  }
}

// ── Gap Timer Helpers ───────────────────────────────────────
// Returns the current in-cycle lap number (= the lap that is IN PROGRESS)
function getCurrentInCycleLapNum() {
  let count = 0;
  for (let i = laps.length - 1; i >= 0; i--) {
    if (laps[i].type === 'cycle_change') break;
    if (laps[i].type === 'lap') count++;
  }
  return count + 1; // the next lap to be recorded
}

function showGapUI() {
  gapTimerContainer.classList.add('active');
}

function hideGapUI() {
  gapTimerContainer.classList.remove('active');
  gapDigits.textContent = '00:00:00';
  gapCs.textContent = '.00';
}

function renderGapClock() {
  const { main, cs } = msToHHMMSScs(gapElapsedMs);
  gapDigits.textContent = main;
  gapCs.textContent = cs;
}

function gapTick(timestamp) {
  if (!isGapRunning) return;
  if (gapLastTimestamp !== null) {
    gapElapsedMs += timestamp - gapLastTimestamp;
  }
  gapLastTimestamp = timestamp;
  renderGapClock();
  gapRafId = requestAnimationFrame(gapTick);
}

// Start gap RAF (optionally set which lap this gap belongs to)
function startGapTimer(lapNum) {
  if (isGapRunning) return;
  if (lapNum !== undefined) {
    currentGapLapNum = lapNum;
    gapElapsedMs = 0; // fresh gap
  }
  isGapRunning = true;
  gapLastTimestamp = null;
  gapRafId = requestAnimationFrame(gapTick);
  showGapUI();
}

// Pause gap RAF without logging (preserves accumulated time)
function pauseGapTimer() {
  if (!isGapRunning) return;
  cancelAnimationFrame(gapRafId);
  gapRafId = null;
  isGapRunning = false;
  gapLastTimestamp = null;
  // gapElapsedMs is kept; gap UI stays visible (frozen display)
}

// Log accumulated gap as an event, then reset gap state
// cleared = true means the gap was ended by a Clear Lap action
function finalizeGap(cleared = false) {
  const MIN_GAP_MS = 500; // don't log sub-500ms gaps
  if (gapElapsedMs >= MIN_GAP_MS) {
    laps.push({ type: 'gap', lapNum: currentGapLapNum, durationMs: gapElapsedMs, cleared });
  }
  // Stop RAF if still running
  if (isGapRunning) {
    cancelAnimationFrame(gapRafId);
    gapRafId = null;
    isGapRunning = false;
  }
  gapElapsedMs = 0;
  gapLastTimestamp = null;
  currentGapLapNum = 0;
}

function setClockColor(color) {
  const c = color || 'var(--text)';
  clockDigits.style.color = c;
  clockCs.style.color     = c;
}

// ── Animation loop ────────────────────────────────────────────
function tick(timestamp) {
  if (!isRunning) return;
  if (lastTimestamp !== null) {
    elapsedMs += timestamp - lastTimestamp;
  }
  lastTimestamp = timestamp;

  renderClock(elapsedMs);
  updateDial();

  // Periodic autosave (every 5 seconds of elapsed time)
  if (elapsedMs - lastSavedElapsedMs >= 5000) {
    saveActiveSessionState();
    lastSavedElapsedMs = elapsedMs;
  }

  rafId = requestAnimationFrame(tick);
}

// ── Controls ──────────────────────────────────────────────────
function startStop() {
  if (isRunning) {
    // Active -> Paused: stop dial, start gap timer
    isRunning = false;
    cancelAnimationFrame(rafId);
    lastTimestamp = null;
    btnStart.textContent = 'Resume';
    btnLap.disabled      = true;
    startGapTimer(getCurrentInCycleLapNum());
    saveActiveSessionState();
  } else {
    // Paused or Hard-Paused -> Active: finalize any gap, start dial
    if (isGapRunning || gapElapsedMs > 0) {
      finalizeGap(false);
      hideGapUI();
      renderLedger();
    }
    isRunning = true;
    btnStart.textContent = 'Pause';
    btnLap.disabled      = false;
    btnReset.disabled    = false;
    rafId = requestAnimationFrame(tick);
    saveActiveSessionState();
  }
  renderSessionsList();
}

function recordLap() {
  if (!isRunning) return;
  const targetMs   = getCurrentLapTarget();
  const lapTimeMs  = elapsedMs - lapStartMs;
  const deficitMs  = (targetMs > 0) ? (lapTimeMs - targetMs) : 0;

  // Green flash if early lap (under median)
  if (targetMs > 0 && lapTimeMs < targetMs) {
    // Remove any ongoing flash first
    clockDisplay.classList.remove('flash-green');
    void clockDisplay.offsetWidth; // reflow to restart animation
    clockDisplay.classList.add('flash-green');
    clockDisplay.addEventListener('animationend', () => {
      clockDisplay.classList.remove('flash-green');
      // Restore computed color from dial state after flash
      updateDial();
    }, { once: true });
  }

  laps.push({ type: 'lap', lapNum: lapCounter, lapTimeMs, deficitMs, targetMs });
  lapCounter++;

  if (clearStopwatchWithLap) {
    elapsedMs = 0;
    lapStartMs = 0;
    lastSavedElapsedMs = 0;
  } else {
    lapStartMs = elapsedMs;
  }

  // Reset dial arc for new lap segment
  dialProgress.style.strokeDashoffset = DIAL_CIRCUMF;
  dialProgress.style.stroke = '#4a90d9';
  setClockColor(null);

  renderLedger();

  // Update segment label
  lapSegmentLabel.textContent = `LAP ${lapCounter}`;

  // If clock cleared, make sure we render the clock display immediately as 0
  if (clearStopwatchWithLap) {
    renderClock(0);
  }

  saveActiveSessionState();
  updateMedianDisplay(); // advance displayed target to next median in cycle
}

function clearLap() {
  // Capture paused state BEFORE we change anything
  const wasInPausedState = !isRunning && (isGapRunning || gapElapsedMs > 0);

  // Finalize any in-progress gap (mark as cleared)
  if (isGapRunning || gapElapsedMs > 0) {
    finalizeGap(true); // cleared = true
  }

  // Reset main elapsed
  elapsedMs        = 0;
  lapStartMs       = 0;
  lastSavedElapsedMs = 0;

  // Also pause if running (avoids a ghost lap accumulating while clock shows 0)
  if (isRunning) {
    isRunning = false;
    cancelAnimationFrame(rafId);
    lastTimestamp = null;
    btnStart.textContent = 'Resume';
    btnLap.disabled      = true;
  }

  renderClock(0);
  dialProgress.style.strokeDashoffset = DIAL_CIRCUMF;
  dialProgress.style.stroke = '#4a90d9';
  dialProgress.style.filter = 'drop-shadow(0 0 6px rgba(74,144,217,0.6))';
  setClockColor(null);
  updateMedianDisplay();

  // If we were in a paused state, automatically start a new gap timer for this lap
  if (wasInPausedState) {
    startGapTimer(getCurrentInCycleLapNum());
  }

  renderLedger();
  saveActiveSessionState();
}

// ── Ledger rendering ──────────────────────────────────────────
function getLedgerItems() {
  const items = [];
  let currentCycleLaps = 0;
  let activeMedians = [];
  
  if (laps.length > 0 && laps[0].type !== 'cycle_change' && lapMedianMs > 0) {
    items.push({
      type: 'separator',
      medians: [lapMedianMs],
      virtual: true
    });
  }

  for (let i = 0; i < laps.length; i++) {
    const item = laps[i];
    if (item && item.type === 'cycle_change') {
      currentCycleLaps = 0;
      activeMedians = item.medians || [];
      items.push({
        type: 'separator',
        medians: activeMedians,
        timestamp: item.timestamp || i
      });
    } else if (item && item.type === 'gap') {
      items.push({
        type: 'gap',
        lapNum: item.lapNum,
        durationMs: item.durationMs,
        cleared: item.cleared || false
      });
    } else if (item) {
      currentCycleLaps++;
      const lapTimeMs = item.lapTimeMs;
      const deficitMs = item.deficitMs;
      const targetMs = item.targetMs || (activeMedians.length > 0 ? activeMedians[(currentCycleLaps - 1) % activeMedians.length] : 0);
      items.push({
        type: 'lap',
        lapNum: currentCycleLaps,
        lapTimeMs: lapTimeMs,
        deficitMs: deficitMs,
        targetMs: targetMs,
        excludeDeficit: item.excludeDeficit || false,
        originalIndex: i
      });
    }
  }
  return items;
}

// ── Ledger rendering ──────────────────────────────────────────
function renderLedger() {
  const lapItems = laps.filter(l => !l.type || l.type === 'lap');
  ledgerLapCount.textContent = `${lapItems.length} lap${lapItems.length !== 1 ? 's' : ''}`;

  if (laps.length === 0) {
    ledgerEmpty.classList.remove('hidden');
    ledgerBody.innerHTML = '';
    netDeficitValue.textContent = '—';
    netDeficitValue.className   = 'net-value';
    netSubtext.textContent      = 'Record your first lap to begin tracking';
    return;
  }

  ledgerEmpty.classList.add('hidden');

  // Build rows (newest on top)
  const ledgerItems = getLedgerItems().reverse();
  const rows = ledgerItems.map(item => {
    if (item.type === 'separator') {
      const mediansStr = item.medians.map(m => msToHHMMSS(m)).join(' → ');
      return `
        <tr class="ledger-cycle-header">
          <td colspan="3">
            <div class="cycle-header-content">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>Lap Cycle: ${mediansStr}</span>
            </div>
          </td>
        </tr>`;
    }

    if (item.type === 'gap') {
      const { main, cs } = msToHHMMSScs(item.durationMs);
      const clearedBadge = item.cleared ? '<span class="gap-cleared-badge">cleared</span>' : '';
      return `
        <tr class="ledger-gap-row">
          <td colspan="3">
            <div class="gap-content">
              <span class="gap-lap-ref">#${item.lapNum}</span>
              <span class="gap-arrow">→</span>
              <span class="gap-time">${main}${cs}</span>
              ${clearedBadge}
            </div>
          </td>
        </tr>`;
    }

    const lapStr    = msToHHMMSS(item.lapTimeMs);
    const hasTarget = item.targetMs > 0;
    const defStr    = hasTarget ? formatDeficit(item.deficitMs) : '—';
    let   defClass  = 'exact';
    if (hasTarget) {
      if (item.deficitMs > 0)       defClass = 'over';
      else if (item.deficitMs < 0)  defClass = 'under';
    }
    
    const eyeIconOpen = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const eyeIconClosed = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    
    const excludeBtnHtml = hasTarget ? `
      <button class="btn-hide-deficit ${item.excludeDeficit ? 'excluded' : ''}" onclick="toggleDeficit(event, ${item.originalIndex})" title="${item.excludeDeficit ? 'Include deficit' : 'Exclude deficit'}">
        ${item.excludeDeficit ? eyeIconClosed : eyeIconOpen}
      </button>
    ` : '';

    return `
      <tr id="lap-row-${item.originalIndex}" class="ledger-lap-row ${item.excludeDeficit ? 'deficit-excluded' : ''} ${mobileShowStates[item.originalIndex] ? 'mobile-show' : ''}" onclick="showHideDeficitBtn(this, ${item.originalIndex})">
        <td class="lap-num">${pad(item.lapNum)}</td>
        <td class="lap-time">${lapStr}</td>
        <td class="lap-deficit ${defClass}">
          <span class="deficit-text">${defStr}</span>
          ${excludeBtnHtml}
        </td>
      </tr>`;
  });
  ledgerBody.innerHTML = rows.join('');

  // Net deficit
  const validLapItems = lapItems.filter(l => !l.excludeDeficit);
  const netMs     = validLapItems.reduce((acc, l) => acc + (l.deficitMs || 0), 0);
  const netAbs    = Math.abs(netMs);
  const activeMedians = getActiveMedians();
  const hasActiveMedian = activeMedians.length > 0;
  const netStr    = hasActiveMedian ? formatDeficit(netMs) : '—';
  let   netClass  = '';
  let   subtext   = '';

  if (hasActiveMedian && netMs !== 0) {
    netClass = netMs > 0 ? 'over' : 'under';
    subtext  = netMs > 0
      ? `You are ${msToHHMMSS(netAbs)} behind target across ${validLapItems.length} lap(s)`
      : `You are ${msToHHMMSS(netAbs)} ahead of target across ${validLapItems.length} lap(s)`;
  } else {
    subtext = hasActiveMedian
      ? `Exactly on target across ${validLapItems.length} lap(s)`
      : `Set a Lap Cycle to enable deficit tracking`;
  }

  // Pulse animation
  netDeficitValue.classList.remove('pulse');
  void netDeficitValue.offsetWidth;
  netDeficitValue.classList.add('pulse');
  netDeficitValue.addEventListener('animationend', () => netDeficitValue.classList.remove('pulse'), { once: true });

  netDeficitValue.textContent = netStr;
  netDeficitValue.className   = `net-value ${netClass}`;
  netSubtext.textContent      = subtext;

  // ── Total Gap Time footer row ───────────────────────────────
  const gapItems = laps.filter(l => l.type === 'gap');
  if (gapItems.length > 0) {
    const totalGapMs = gapItems.reduce((acc, g) => acc + g.durationMs, 0);
    const { main: gMain, cs: gCs } = msToHHMMSScs(totalGapMs);
    gapTotalValue.textContent = `${gMain}${gCs}`;
    gapTotalRow.classList.remove('hidden');
  } else {
    gapTotalRow.classList.add('hidden');
  }
}

// ── Median Modal ──────────────────────────────────────────────
function openModal() {
  tempMedians = [...getActiveMedians()];
  
  // Clean inputs to 0:00:00 as requested
  inputHH.value = 0;
  inputMM.value = 0;
  inputSS.value = 0;
  
  modalOverlay.classList.add('active');
  renderModalCycleList();
  inputMM.focus();
}

function closeModal() {
  modalOverlay.classList.remove('active');
}

function renderModalCycleList() {
  if (!modalCycleList) return;
  
  if (tempMedians.length === 0) {
    modalCycleList.innerHTML = '<div class="modal-cycle-empty">No medians added to cycle yet</div>';
    return;
  }
  
  modalCycleList.innerHTML = tempMedians.map((ms, idx) => {
    return `
      <div class="modal-cycle-item">
        <div>
          <span class="index">#${idx + 1}</span>
          <span>${msToHHMMSS(ms)}</span>
        </div>
        <button class="modal-cycle-item-delete" onclick="deleteTempMedian(${idx})" title="Remove from cycle" aria-label="Remove Median">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

function addTempMedian() {
  const hh = parseInt(inputHH.value) || 0;
  const mm = parseInt(inputMM.value) || 0;
  const ss = parseInt(inputSS.value) || 0;
  const ms = (hh * 3600 + mm * 60 + ss) * 1000;

  if (ms <= 0) {
    inputMM.focus();
    inputMM.style.borderColor = '#ff4d6d';
    setTimeout(() => { inputMM.style.borderColor = ''; }, 1000);
    return;
  }

  tempMedians.push(ms);
  
  // Clear inputs
  inputHH.value = 0;
  inputMM.value = 0;
  inputSS.value = 0;
  
  renderModalCycleList();
  inputMM.focus();
}

function deleteTempMedian(idx) {
  tempMedians.splice(idx, 1);
  renderModalCycleList();
}

window.deleteTempMedian = deleteTempMedian;

function applyMedian() {
  if (tempMedians.length === 0) {
    alert("Please add at least one median target to the cycle.");
    inputMM.focus();
    return;
  }

  // Push cycle change event to laps history
  laps.push({
    type: 'cycle_change',
    medians: [...tempMedians],
    timestamp: Date.now()
  });

  // Reset counters for the new cycle
  lapCounter = 1;
  lapStartMs = elapsedMs;

  closeModal();
  updateDial();
  renderLedger();
  
  // Segment label
  lapSegmentLabel.textContent = `LAP ${lapCounter}`;
  
  updateMedianDisplay();
  saveActiveSessionState();
}

// ── Event Listeners ───────────────────────────────────────────
btnStart.addEventListener('click', startStop);
btnLap.addEventListener('click', recordLap);
btnReset.addEventListener('click', clearLap);
btnSetMedian.addEventListener('click', openModal);
btnModalSet.addEventListener('click', applyMedian);
btnModalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

// Sidebar Event Listeners
btnToggleSidebar.addEventListener('click', toggleSidebar);
btnCreateSession.addEventListener('click', () => createNewSession(true));

// Modal Add Median listener
btnModalAddMedian.addEventListener('click', addTempMedian);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); startStop(); }
  if (e.code === 'KeyL')  { if (!btnLap.disabled) recordLap(); }
  if (e.code === 'KeyR')  { if (!btnReset.disabled) clearLap(); }
  if (e.code === 'KeyM')  openModal();
  if (e.code === 'Escape') {
    closeModal();
    closeRemarks();
  }
});

// Clamp numeric inputs on blur
[inputHH, inputMM, inputSS].forEach(el => {
  el.addEventListener('blur', (e) => {
    if (!e.target.value) e.target.value = '00';
    else {
      let val = parseInt(e.target.value, 10);
      if (isNaN(val)) val = 0;
      if (e.target !== inputHH && val > 59) val = 59;
      e.target.value = val.toString().padStart(2, '0');
    }
  });
});

// Big Create Session Button
if (btnCreateSessionBig) {
  btnCreateSessionBig.addEventListener('click', () => {
    createNewSession(true);
  });
}

// ── Sessions Management ────────────────────────────────────────

// Format today's date as YYYY-MM-DD (Day rolls over at 4:00 AM)
function getLocalDateString() {
  const d = new Date();
  // Shift the time back by 4 hours. 
  // This causes times between 12:00 AM and 3:59 AM to fall into the previous day.
  d.setHours(d.getHours() - 4);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Generate the next session name (e.g. 2026-07-15-Session 1)
function generateSessionName() {
  const dateStr = getLocalDateString();
  let index = 1;
  while (sessions.some(s => s.name === `${dateStr}-Session ${index}`)) {
    index++;
  }
  return `${dateStr}-Session ${index}`;
}

// Load sessions from localStorage
function loadSessions() {
  try {
    const data = localStorage.getItem('laptrack_sessions');
    if (data) {
      sessions = JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading sessions from localStorage:', e);
  }

  if (!sessions || sessions.length === 0) {
    sessions = [];
    activeSessionId = null;
    loadActiveSession();
  } else {
    // Load the active session ID if it exists and is not ended
    const savedActiveId = localStorage.getItem('laptrack_active_session_id');
    const exists = sessions.some(s => s.id === savedActiveId);
    const savedSession = exists ? sessions.find(s => s.id === savedActiveId) : null;
    
    if (savedSession && savedSession.status !== 'ended') {
      activeSessionId = savedActiveId;
    } else {
      // Find the most recently updated 'active' session
      const activeSessions = sessions.filter(s => s.status !== 'ended').sort((a, b) => b.lastUpdated - a.lastUpdated);
      activeSessionId = activeSessions.length > 0 ? activeSessions[0].id : null;
    }
    loadActiveSession();
  }
}

// Merge in cloud sessions after sign-in
async function syncFromCloud() {
  setSyncStatus('syncing');
  const result = await loadSessionsFromCloud();
  if (!result) {
    setSyncStatus('error');
    return;
  }

  const merged = mergeSessions(sessions, result.sessions);

  // Determine the best active session ID post-merge
  let newActiveId = result.activeSessionId || activeSessionId;
  const newActiveSession = merged.find(s => s.id === newActiveId);
  if (!newActiveSession || newActiveSession.status === 'ended') {
    const activeSessions = merged.filter(s => s.status !== 'ended').sort((a, b) => b.lastUpdated - a.lastUpdated);
    newActiveId = activeSessions.length > 0 ? activeSessions[0].id : null;
  }

  sessions = merged;
  activeSessionId = newActiveId;

  // Persist merged state locally
  localStorage.setItem('laptrack_sessions', JSON.stringify(sessions));
  if (activeSessionId) localStorage.setItem('laptrack_active_session_id', activeSessionId);

  loadActiveSession();
  setSyncStatus('synced');
}

// ── Cloud sync debounce ────────────────────────────────────────
let _cloudSyncTimer = null;
function scheduleSyncToCloud() {
  if (!getCurrentUser()) return;
  clearTimeout(_cloudSyncTimer);
  _cloudSyncTimer = setTimeout(async () => {
    setSyncStatus('syncing');
    const ok = await saveSessionsToCloud(sessions, activeSessionId);
    setSyncStatus(ok ? 'synced' : 'error');
  }, 2000); // debounce: wait 2 s of inactivity before writing
}

// Save sessions to localStorage
function saveSessions() {
  try {
    localStorage.setItem('laptrack_sessions', JSON.stringify(sessions));
    if (activeSessionId) {
      localStorage.setItem('laptrack_active_session_id', activeSessionId);
    }
  } catch (e) {
    console.error('Error saving sessions to localStorage:', e);
  }
  scheduleSyncToCloud();
}

// Save current stopwatch live variables into active session
function saveActiveSessionState() {
  if (!activeSessionId) return;
  const session = sessions.find(s => s.id === activeSessionId);
  if (session) {
    session.elapsedMs = elapsedMs;
    session.lapStartMs = lapStartMs;
    session.lapMedianMs = lapMedianMs;
    session.lapCounter = lapCounter;
    session.laps = [...laps];
    session.remarks = remarksTextarea.value;
    session.gapElapsedMs = gapElapsedMs;
    session.currentGapLapNum = currentGapLapNum;
    session.lastUpdated = Date.now();
    saveSessions();
    renderSessionsList();
  }
}

// Load active session state into stopwatch live variables
function loadActiveSession() {
  if (!activeSessionId) {
    activeSessionView.classList.add('hidden');
    noSessionView.classList.remove('hidden');
    // Clear live variables
    elapsedMs = 0;
    lapStartMs = 0;
    lapCounter = 1;
    laps = [];
    gapElapsedMs = 0;
    currentGapLapNum = 0;
    isGapRunning = false;
    
    // Clear ledger
    ledgerBody.innerHTML = '';
    netDeficitValue.textContent = '—';
    netDeficitValue.className   = 'net-value';
    netSubtext.textContent      = 'Record your first lap to begin tracking';
    ledgerEmpty.classList.remove('hidden');
    renderSessionsList();
    return;
  }

  activeSessionView.classList.remove('hidden');
  noSessionView.classList.add('hidden');

  const session = sessions.find(s => s.id === activeSessionId);
  if (session) {
    // If the stopwatch is running, pause it first (safety)
    if (isRunning) {
      isRunning = false;
      cancelAnimationFrame(rafId);
      lastTimestamp = null;
      btnStart.textContent = 'Resume';
      btnLap.disabled = true;
    }

    elapsedMs = session.elapsedMs;
    lapStartMs = session.lapStartMs;
    lapMedianMs = session.lapMedianMs;
    lapCounter = session.lapCounter;
    laps = [...session.laps];
    lastSavedElapsedMs = elapsedMs;

    // Restore gap state
    gapElapsedMs = session.gapElapsedMs || 0;
    currentGapLapNum = session.currentGapLapNum || 0;
    isGapRunning = false; // don't auto-start RAF on load
    gapLastTimestamp = null;

    const isEnded = session.status === 'ended';

    // Update buttons state
    if (isEnded) {
      btnStart.textContent = 'Ended';
      btnStart.disabled = true;
      btnLap.disabled = true;
      btnReset.disabled = true;
    } else {
      if (elapsedMs > 0 || gapElapsedMs > 0) {
        btnReset.disabled = false;
        btnStart.textContent = 'Resume';
      } else {
        btnReset.disabled = true;
        btnStart.textContent = 'Start';
      }
      btnStart.disabled = false;
      btnLap.disabled = true; // disabled until started
    }

    // Render components
    renderClock(elapsedMs);
    updateDial();
    renderLedger();
    updateMedianDisplay();

    // Set segment label
    lapSegmentLabel.textContent = `LAP ${lapCounter}`;
    setClockColor(null);

    // Restore gap UI state (show frozen gap if there was one, without auto-starting)
    if (gapElapsedMs > 0 && !isEnded) {
      renderGapClock();
      showGapUI();
    } else {
      hideGapUI();
    }

    // Load remarks for this session
    remarksTextarea.value = session.remarks || '';

    renderSessionsList();
  }
}

// Create a new study session
function createNewSession(switchToIt = true) {
  // Pause clock if running
  if (isRunning) {
    startStop(); // pauses the clock
  }

  // Find active cycle of the current session to copy it over
  const currentActiveMedians = getActiveMedians();
  const initialLaps = [];
  if (currentActiveMedians.length > 0) {
    initialLaps.push({
      type: 'cycle_change',
      medians: [...currentActiveMedians],
      timestamp: Date.now()
    });
  }

  const id = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const newSession = {
    id: id,
    name: generateSessionName(),
    status: 'active',
    startTime: Date.now(),
    endTime: null,
    elapsedMs: 0,
    lapStartMs: 0,
    lapMedianMs: lapMedianMs, // carry over legacy field
    lapCounter: 1,
    laps: initialLaps,
    remarks: '',
    createdTime: Date.now(),
    lastUpdated: Date.now()
  };

  sessions.push(newSession);
  saveSessions();

  if (switchToIt) {
    activeSessionId = id;
    loadActiveSession();
  }
}

// Select a session
function selectSession(id) {
  if (id === activeSessionId) return;

  // Finalize any in-progress gap before switching sessions
  if (isGapRunning || gapElapsedMs > 0) {
    finalizeGap(false);
    hideGapUI();
  }

  saveActiveSessionState();
  activeSessionId = id;
  loadActiveSession();

  // Auto-close sidebar on mobile after selecting a session
  if (window.innerWidth <= 800) {
    sidebar.classList.remove('active');
  }
}

// Delete a session
function deleteSession(id, event) {
  if (event) event.stopPropagation(); // prevent selecting the session

  const session = sessions.find(s => s.id === id);
  if (!session) return;

  sessions = sessions.filter(s => s.id !== id);

  if (activeSessionId === id) {
    if (sessions.length > 0) {
      const sorted = [...sessions].sort((a, b) => b.lastUpdated - a.lastUpdated);
      activeSessionId = sorted[0].id;
      loadActiveSession();
    } else {
      createNewSession(true);
    }
  } else {
    saveSessions();
    renderSessionsList();
  }
}

window.confirmDeleteSession = function(btnEl, id, event) {
  if (event) event.stopPropagation();

  if (btnEl.classList.contains('confirm-mode')) {
    deleteSession(id, null);
    return;
  }

  document.querySelectorAll('.btn-delete-session.confirm-mode').forEach(el => {
    el.classList.remove('confirm-mode');
    el.innerHTML = el.dataset.originalHtml;
  });

  btnEl.dataset.originalHtml = btnEl.innerHTML;
  btnEl.classList.add('confirm-mode');
  btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  setTimeout(() => {
    if (btnEl && btnEl.classList.contains('confirm-mode')) {
      btnEl.classList.remove('confirm-mode');
      btnEl.innerHTML = btnEl.dataset.originalHtml;
    }
  }, 3000);
};

// Toggle Sidebar
function toggleSidebar() {
  if (window.innerWidth <= 800) {
    sidebar.classList.remove('collapsed');
    sidebar.classList.toggle('active');
  } else {
    sidebar.classList.remove('active');
    sidebar.classList.toggle('collapsed');
  }
}

// Render Sessions List in Sidebar
function renderSessionsList() {
  if (!sessionsList) return;

  const sortedSessions = [...sessions].sort((a, b) => b.createdTime - a.createdTime);

  sessionsList.innerHTML = sortedSessions.map(s => {
    const isActive = s.id === activeSessionId;
    const isRunningSession = isActive && isRunning;
    const isGapSession     = isActive && isGapRunning;
    const isEnded = s.status === 'ended';

    // Sidebar play/pause button (active session only)
    const showPlayPause = !isEnded && isActive && (isRunning || isGapRunning || gapElapsedMs > 0);
    const ppTitle  = isRunning ? 'Hard-pause session' : isGapRunning ? 'Pause gap timer' : 'Resume gap timer';
    const ppIcon   = (!isRunning && !isGapRunning && gapElapsedMs > 0)
      // Play icon
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
      // Pause icon
      : `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    const ppBtn = showPlayPause
      ? `<button class="btn-session-playpause" onclick="toggleSessionGapTimer(event)" title="${ppTitle}" aria-label="${ppTitle}">${ppIcon}</button>`
      : '';
    
    // Time range formatting
    const startTimeStr = s.startTime ? new Date(s.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Unknown';
    const endTimeStr = s.endTime ? new Date(s.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'In Progress';
    const timeRangeStr = `${startTimeStr} - ${endTimeStr}`;
    
    // End button: show when session is active, not ended, dial is paused, gap timer is paused
    const showEndButton = isActive && !isEnded && !isRunning && !isGapRunning;
    const endBtnHtml = showEndButton 
      ? `<button class="btn-end-session" onclick="endSession('${s.id}', event)">End</button>`
      : '';
    
    const lapItems  = s.laps.filter(l => !l.type || l.type === 'lap');
    const lapsCount = lapItems.length;
    const lapsText  = `${lapsCount} lap${lapsCount !== 1 ? 's' : ''}`;
    
    let netDefStr = 'Net: —';
    let netClass = '';
    const hasMedians = s.lapMedianMs > 0 || s.laps.some(l => l.type === 'cycle_change');
    if (hasMedians && lapsCount > 0) {
      const netMs = lapItems.reduce((acc, l) => acc + (l.deficitMs || 0), 0);
      const absNet = Math.abs(netMs);
      const sign = netMs > 0 ? '-' : '+';
      netDefStr = `Net: ${sign}${msToHHMMSS(absNet)}`;
      if (netMs !== 0) {
        netClass = netMs > 0 ? 'over' : 'under';
      }
    }

    const runningIndicator = isRunningSession ? '<span class="pulse-dot" title="Stopwatch Running"></span>' : '';

    return `
      <div class="session-item ${isActive ? 'active' : ''}" onclick="selectSession('${s.id}')">
        <div class="session-info">
          <div class="session-title">${s.name}</div>
          <div class="session-meta">
            <span>${lapsText}</span>
            <span>•</span>
            <span class="session-deficit ${netClass}">${netDefStr}</span>
            ${runningIndicator}
          </div>
          <div class="session-time-range">${timeRangeStr}</div>
          ${endBtnHtml}
        </div>
        ${ppBtn}
        <button class="btn-delete-session" onclick="confirmDeleteSession(this, '${s.id}', event)" title="Delete session" aria-label="Delete Session">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

// Expose functions globally for dynamic elements
window.selectSession = selectSession;
window.deleteSession = deleteSession;

window.toggleDeficit = function(event, index) {
  if (event) event.stopPropagation();
  if (laps[index]) {
    laps[index].excludeDeficit = !laps[index].excludeDeficit;
    
    // Refresh the independent mobile-show timer to keep it visible after interacting
    if (mobileShowStates[index]) {
      clearTimeout(mobileShowStates[index]);
    }
    
    mobileShowStates[index] = setTimeout(() => {
      delete mobileShowStates[index];
      const currentEl = document.getElementById(`lap-row-${index}`);
      if (currentEl) {
        currentEl.classList.remove('mobile-show');
      }
    }, 2000);

    saveActiveSessionState();
    renderLedger();
  }
};

window.showHideDeficitBtn = function(rowEl, index) {
  rowEl.classList.add('mobile-show');
  
  if (mobileShowStates[index]) {
    clearTimeout(mobileShowStates[index]);
  }
  
  mobileShowStates[index] = setTimeout(() => {
    delete mobileShowStates[index];
    const currentEl = document.getElementById(`lap-row-${index}`);
    if (currentEl) {
      currentEl.classList.remove('mobile-show');
    }
  }, 2000);
};

window.endSession = function(id, event) {
  if (event) event.stopPropagation();
  const session = sessions.find(s => s.id === id);
  if (!session || session.status === 'ended') return;
  
  session.status = 'ended';
  session.endTime = Date.now();
  session.lastUpdated = Date.now();
  
  if (id === activeSessionId) {
    // Finalize any running gaps or dial
    if (isRunning) {
      startStop();
    }
    if (isGapRunning || gapElapsedMs > 0) {
      finalizeGap(false);
      hideGapUI();
    }
    saveActiveSessionState(); // one final save
    activeSessionId = null;
    loadActiveSession();
  } else {
    saveSessions();
    renderSessionsList();
  }
};

// ── Sidebar session gap-timer toggle ───────────────────────────
function toggleSessionGapTimer(event) {
  event.stopPropagation(); // don't trigger selectSession

  if (isRunning) {
    // Active → Hard-Paused: stop dial, NO gap timer
    isRunning = false;
    cancelAnimationFrame(rafId);
    lastTimestamp = null;
    btnStart.textContent = 'Resume';
    btnLap.disabled = true;
    saveActiveSessionState();

  } else if (isGapRunning) {
    // Paused → Hard-Paused: freeze gap timer (keep accumulated)
    pauseGapTimer();
    // gap UI stays visible showing frozen time
    saveActiveSessionState();

  } else if (gapElapsedMs > 0) {
    // Hard-Paused → Paused: resume gap timer from accumulated time
    isGapRunning = true;
    gapLastTimestamp = null;
    gapRafId = requestAnimationFrame(gapTick);
    // gap UI is already visible
    saveActiveSessionState();
  }

  renderSessionsList();
}
window.toggleSessionGapTimer = toggleSessionGapTimer;

// ── Remarks Modal ────────────────────────────────────────────
function openRemarks() {
  remarksModalOverlay.classList.add('active');
  remarksTextarea.focus();
}

function closeRemarks() {
  remarksModalOverlay.classList.remove('active');
  // Ensure final value is saved
  saveRemarksNow();
}

function saveRemarksNow() {
  if (!activeSessionId) return;
  const session = sessions.find(s => s.id === activeSessionId);
  if (session) {
    session.remarks = remarksTextarea.value;
    session.lastUpdated = Date.now();
    saveSessions();
  }
}

let _remarksSaveTimer = null;
function onRemarksInput() {
  // Show 'Saving…' indicator
  remarksSaveIndicator.textContent = 'Saving…';
  remarksSaveIndicator.classList.add('visible');

  clearTimeout(_remarksSaveTimer);
  _remarksSaveTimer = setTimeout(() => {
    saveRemarksNow();
    remarksSaveIndicator.textContent = 'Saved';
    // Fade out after 1.5s
    setTimeout(() => remarksSaveIndicator.classList.remove('visible'), 1500);
  }, 600);
}

btnRemarks.addEventListener('click', openRemarks);
btnRemarksClose.addEventListener('click', closeRemarks);
remarksModalOverlay.addEventListener('click', (e) => {
  if (e.target === remarksModalOverlay) closeRemarks();
});
remarksTextarea.addEventListener('input', onRemarksInput);

// ── Auth UI helpers ───────────────────────────────────────────
function setSyncStatus(status) {
  // status: 'syncing' | 'synced' | 'error'
  const labels = { syncing: 'Syncing…', synced: 'Synced to cloud', error: 'Sync failed' };
  authDropdownSync.innerHTML = `<span class="sync-dot ${status}"></span>${labels[status] || ''}`;
}

function updateAuthUI(user) {
  if (user) {
    // Signed in
    btnAuth.classList.add('hidden');
    btnAvatar.classList.remove('hidden');
    avatarImg.src = user.photoURL || '';
    avatarImg.alt = user.displayName || 'Account';
    authDropdownUser.textContent = user.displayName || user.email || 'Signed in';
    authDropdownSync.innerHTML = '<span class="sync-dot synced"></span>Synced to cloud';
  } else {
    // Signed out
    btnAuth.classList.remove('hidden');
    btnAvatar.classList.add('hidden');
    authDropdown.classList.add('hidden');
  }
}

// Auth button: sign in
btnAuth.addEventListener('click', () => signInWithGoogle());

// Avatar button: toggle dropdown
btnAvatar.addEventListener('click', (e) => {
  e.stopPropagation();
  authDropdown.classList.toggle('hidden');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!authDropdown.classList.contains('hidden') &&
      !authDropdown.contains(e.target) &&
      e.target !== btnAvatar) {
    authDropdown.classList.add('hidden');
  }
});

// Sign out
btnSignOut.addEventListener('click', async () => {
  authDropdown.classList.add('hidden');
  await signOutUser();
});

// Auth state listener — fires on page load and whenever the user signs in/out
onAuthChange(async (user) => {
  updateAuthUI(user);
  if (user) {
    // Signed in: merge cloud data into local
    await syncFromCloud();
  }
});

// ── Init ──────────────────────────────────────────────────────
loadSessions();

// ── Service Worker Registration ───────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[LapUp] Service Worker registered. Scope:', reg.scope);
      })
      .catch(err => {
        console.warn('[LapUp] Service Worker registration failed:', err);
      });
  });
}
