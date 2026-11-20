// ── LapUp Overlay Script ──────────────────────────────────────
// Receives live state from the main window via BroadcastChannel,
// and sends button commands back to it.

const CHANNEL_NAME = 'lapup-overlay';
const bc = new BroadcastChannel(CHANNEL_NAME);

// ── DOM refs ──────────────────────────────────────────────────
const clockDigits      = document.getElementById('clock-digits');
const clockCs          = document.getElementById('clock-cs');
const clockDisplay     = document.getElementById('clock-display');
const lapSegmentLabel  = document.getElementById('lap-segment-label');
const medianValueEl    = document.getElementById('median-value-display');
const dialProgress     = document.getElementById('dial-progress');
const gapContainer     = document.getElementById('gap-timer-container');
const gapDigits        = document.getElementById('gap-digits');
const gapCs            = document.getElementById('gap-cs');
const btnStart         = document.getElementById('btn-start');
const btnLap           = document.getElementById('btn-lap');
const btnReset         = document.getElementById('btn-reset');
const btnRemarks       = document.getElementById('btn-overlay-remarks');
const btnSetCycle      = document.getElementById('btn-overlay-set-cycle');
const btnClose         = document.getElementById('btn-close-overlay');
const noSessionView    = document.getElementById('no-session-view');
const activeView       = document.getElementById('active-session-view');
const disconnectedBanner = document.getElementById('disconnected-banner');

// ── Remarks modal refs ────────────────────────────────────────
const ovRemarksOverlay  = document.getElementById('ov-remarks-overlay');
const ovRemarksClose    = document.getElementById('ov-remarks-close');
const ovRemarksTextarea = document.getElementById('ov-remarks-textarea');
const ovEfficiency      = document.getElementById('ov-efficiency');
const ovSaveIndicator   = document.getElementById('ov-save-indicator');

// ── Cycle modal refs ──────────────────────────────────────────
const ovCycleOverlay = document.getElementById('ov-cycle-overlay');
const ovCycleClose   = document.getElementById('ov-cycle-close');
const ovCycleCancel  = document.getElementById('ov-cycle-cancel');
const ovCycleSet     = document.getElementById('ov-cycle-set');
const ovCycleList    = document.getElementById('ov-cycle-list');
const ovAddMedian    = document.getElementById('ov-add-median');
const ovHH           = document.getElementById('ov-hh');
const ovMM           = document.getElementById('ov-mm');
const ovSS           = document.getElementById('ov-ss');

// ── Dial constants ─────────────────────────────────────────────
const DIAL_RADIUS  = 132;
const DIAL_CIRCUMF = 2 * Math.PI * DIAL_RADIUS; // ≈ 829.38

// ── Tick mark generation ───────────────────────────────────────
(function generateTicks() {
  const tickGroup = document.getElementById('dial-ticks');
  const cx = 160, cy = 160;
  const majorOuter = 145, majorInner = 136;
  const minorOuter = 143, minorInner = 138;
  for (let i = 0; i < 60; i++) {
    const angle   = (i / 60) * 2 * Math.PI - Math.PI / 2;
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

// ── Live interpolation ─────────────────────────────────────────
let isRunning        = false;
let lastKnownMs      = 0;
let localStartTime   = null;
let currentTargetMs  = 0;
let isGapRunning     = false;
let lastKnownGapMs   = 0;
let localGapStart    = null;
let rafId            = null;
let lastKnownLapStartMs = 0;

function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }

function msToDisplay(ms) {
  const totalSec = Math.floor(ms / 1000);
  const cs       = Math.floor((ms % 1000) / 10);
  const ss       = totalSec % 60;
  const mm       = Math.floor(totalSec / 60) % 60;
  const hh       = Math.floor(totalSec / 3600);
  return { main: `${pad(hh)}:${pad(mm)}:${pad(ss)}`, cs: `.${pad(cs)}` };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function lerpColor(hex1, hex2, t) {
  const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
  const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
  return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}

function renderFrame() {
  const now = performance.now();
  let ms    = lastKnownMs;
  if (isRunning && localStartTime !== null) ms = lastKnownMs + (now - localStartTime);
  let gapMs = lastKnownGapMs;
  if (isGapRunning && localGapStart !== null) gapMs = lastKnownGapMs + (now - localGapStart);

  const { main, cs } = msToDisplay(ms);
  if (clockDigits.textContent !== main) clockDigits.textContent = main;
  if (clockCs.textContent !== cs)       clockCs.textContent = cs;

  if (gapContainer.classList.contains('active')) {
    const g = msToDisplay(gapMs);
    if (gapDigits.textContent !== g.main) gapDigits.textContent = g.main;
    if (gapCs.textContent !== g.cs)       gapCs.textContent = g.cs;
  }

  if (currentTargetMs > 0) {
    const inLapMs = ms - lastKnownLapStartMs;
    const ratio   = clamp(inLapMs / currentTargetMs, 0, 1);
    dialProgress.style.strokeDashoffset = DIAL_CIRCUMF * (1 - ratio);
    if (inLapMs > currentTargetMs) {
      const overMs  = inLapMs - currentTargetMs;
      dialProgress.style.stroke = lerpColor('#4a90d9', '#ff4d6d', clamp(overMs / 5000, 0, 1));
      dialProgress.style.filter = `drop-shadow(0 0 6px ${dialProgress.style.stroke}88)`;
      const c = lerpColor('#e8eaf6', '#ff4d6d', clamp(overMs / 30000, 0, 1));
      clockDigits.style.color = c;
      clockCs.style.color = c;
    } else {
      dialProgress.style.stroke = '#4a90d9';
      dialProgress.style.filter = 'drop-shadow(0 0 6px rgba(74,144,217,0.6))';
      clockDigits.style.color = '';
      clockCs.style.color = '';
    }
  } else {
    dialProgress.style.stroke = '#4a90d9';
    dialProgress.style.filter = 'drop-shadow(0 0 6px rgba(74,144,217,0.6))';
    clockDigits.style.color = '';
    clockCs.style.color = '';
  }

  rafId = requestAnimationFrame(renderFrame);
}

requestAnimationFrame(renderFrame);

// ── Apply state from main window ───────────────────────────────
function applyState(state) {
  isRunning        = state.isRunning;
  lastKnownMs      = state.elapsedMs;
  localStartTime   = isRunning ? performance.now() : null;
  currentTargetMs  = state.currentTargetMs || 0;
  lastKnownLapStartMs = state.lapStartMs || 0;
  isGapRunning     = state.isGapRunning;
  lastKnownGapMs   = state.gapElapsedMs || 0;
  localGapStart    = isGapRunning ? performance.now() : null;

  if (state.lapLabel)    lapSegmentLabel.textContent = state.lapLabel;
  if (state.medianText != null) medianValueEl.textContent = state.medianText;

  btnStart.textContent = state.isRunning ? 'Pause' : (state.startLabel || 'Start');
  btnStart.disabled    = state.startDisabled || false;
  btnLap.disabled      = state.lapDisabled !== false;
  btnReset.disabled    = state.resetDisabled !== false;

  if (state.isGapRunning || (state.gapElapsedMs > 0 && !state.isRunning)) {
    gapContainer.classList.add('active');
  } else {
    gapContainer.classList.remove('active');
    gapDigits.textContent = '00:00:00';
    gapCs.textContent = '.00';
  }

  if (!isRunning && currentTargetMs <= 0) {
    dialProgress.style.strokeDashoffset = DIAL_CIRCUMF;
  }

  if (state.hasActiveSession) {
    activeView.classList.remove('hidden');
    noSessionView.classList.add('hidden');
  } else {
    activeView.classList.add('hidden');
    noSessionView.classList.remove('hidden');
  }

  if (state.flashGreen) {
    clockDisplay.classList.remove('flash-green');
    void clockDisplay.offsetWidth;
    clockDisplay.classList.add('flash-green');
    clockDisplay.addEventListener('animationend', () => clockDisplay.classList.remove('flash-green'), { once: true });
  }

  // Sync remarks modal content if it's open
  if (!ovRemarksOverlay.classList.contains('hidden')) {
    if (state.remarks   != null && ovRemarksTextarea.value === '') ovRemarksTextarea.value = state.remarks;
    if (state.efficiency != null && ovEfficiency.value === '')    ovEfficiency.value = state.efficiency;
  }

  disconnectedBanner.classList.add('hidden');
}

// ── BroadcastChannel ───────────────────────────────────────────
bc.addEventListener('message', (e) => {
  if (e.data.type === 'STATE_UPDATE') applyState(e.data.state);
  if (e.data.type === 'HEARTBEAT' || e.data.type === 'STATE_UPDATE') lastHeartbeat = Date.now();

  // Main window sends back initial data for modals
  if (e.data.type === 'REMARKS_DATA') {
    ovRemarksTextarea.value = e.data.remarks || '';
    ovEfficiency.value      = (e.data.efficiency != null) ? e.data.efficiency : '';
    ovRemarksTextarea.focus();
  }
  if (e.data.type === 'CYCLE_DATA') {
    ovTempMedians = [...(e.data.medians || [])];
    renderOvCycleList();
    ovMM.focus();
  }
});

bc.postMessage({ type: 'OVERLAY_READY' });

// ── Heartbeat: detect main window closed ──────────────────────
let lastHeartbeat = Date.now();
setInterval(() => {
  if (Date.now() - lastHeartbeat > 4000) {
    disconnectedBanner.classList.remove('hidden');
    if (isRunning) { lastKnownMs += performance.now() - (localStartTime || performance.now()); localStartTime = null; isRunning = false; }
  }
}, 2000);

// ── Send commands ──────────────────────────────────────────────
function sendCmd(cmd, payload) {
  bc.postMessage({ type: 'OVERLAY_CMD', cmd, ...payload });
}

btnStart.addEventListener('click', () => sendCmd('START_STOP'));
btnLap.addEventListener('click',   () => sendCmd('LAP'));
btnReset.addEventListener('click', () => sendCmd('RESET'));

btnClose.addEventListener('click', () => window.close());

// ── Keyboard shortcuts ─────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space')  { e.preventDefault(); sendCmd('START_STOP'); }
  if (e.code === 'KeyL')   { if (!btnLap.disabled) sendCmd('LAP'); }
  if (e.code === 'KeyR')   { if (!btnReset.disabled) sendCmd('RESET'); }
  if (e.code === 'KeyM')   openCycleModal();
  if (e.code === 'Escape') { closeRemarksModal(); closeCycleModal(); }
});

// ── Remarks Modal ──────────────────────────────────────────────
function openRemarksModal() {
  // Ask main window for current remarks data
  sendCmd('GET_REMARKS_DATA');
  ovRemarksOverlay.classList.remove('hidden');
}

function closeRemarksModal() {
  ovRemarksOverlay.classList.add('hidden');
  saveRemarksNow();
}

function saveRemarksNow() {
  sendCmd('SAVE_REMARKS', {
    remarks:    ovRemarksTextarea.value,
    efficiency: ovEfficiency.value !== '' ? parseFloat(ovEfficiency.value) : null
  });
  flashSaved();
}

function flashSaved() {
  ovSaveIndicator.classList.remove('hidden');
  ovSaveIndicator.classList.add('visible');
  setTimeout(() => ovSaveIndicator.classList.remove('visible'), 1500);
}

let _remarksSaveTimer = null;
function onRemarksInput() {
  clearTimeout(_remarksSaveTimer);
  _remarksSaveTimer = setTimeout(saveRemarksNow, 700);
}

btnRemarks.addEventListener('click', openRemarksModal);
ovRemarksClose.addEventListener('click', closeRemarksModal);
ovRemarksOverlay.addEventListener('click', (e) => { if (e.target === ovRemarksOverlay) closeRemarksModal(); });
ovRemarksTextarea.addEventListener('input', onRemarksInput);
ovEfficiency.addEventListener('input', onRemarksInput);

// ── Set Lap Cycle Modal ────────────────────────────────────────
let ovTempMedians = [];

function pad2(n) { return String(Math.floor(n)).padStart(2, '0'); }
function msToHMS(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad2(Math.floor(s/3600))}:${pad2(Math.floor(s/60)%60)}:${pad2(s%60)}`;
}

function renderOvCycleList() {
  if (ovTempMedians.length === 0) {
    ovCycleList.innerHTML = '<div class="ov-cycle-empty">No medians added yet</div>';
    return;
  }
  ovCycleList.innerHTML = ovTempMedians.map((ms, i) => `
    <div class="ov-cycle-item">
      <span><span class="idx">#${i+1}</span>${msToHMS(ms)}</span>
      <button class="ov-cycle-item-del" onclick="deleteOvMedian(${i})" title="Remove">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `).join('');
}

window.deleteOvMedian = function(i) {
  ovTempMedians.splice(i, 1);
  renderOvCycleList();
};

function openCycleModal() {
  sendCmd('GET_CYCLE_DATA');
  ovCycleOverlay.classList.remove('hidden');
}

function closeCycleModal() {
  ovCycleOverlay.classList.add('hidden');
}

function addOvMedian() {
  const hh = parseInt(ovHH.value) || 0;
  const mm = parseInt(ovMM.value) || 0;
  const ss = parseInt(ovSS.value) || 0;
  const ms = (hh * 3600 + mm * 60 + ss) * 1000;
  if (ms <= 0) {
    ovMM.style.borderColor = '#ff4d6d';
    setTimeout(() => ovMM.style.borderColor = '', 1000);
    return;
  }
  ovTempMedians.push(ms);
  ovHH.value = 0; ovMM.value = 0; ovSS.value = 0;
  renderOvCycleList();
  ovMM.focus();
}

function applyCycle() {
  if (ovTempMedians.length === 0) {
    ovMM.style.borderColor = '#ff4d6d';
    setTimeout(() => ovMM.style.borderColor = '', 1000);
    return;
  }
  sendCmd('APPLY_CYCLE', { medians: [...ovTempMedians] });
  closeCycleModal();
}

btnSetCycle.addEventListener('click', openCycleModal);
ovCycleClose.addEventListener('click', closeCycleModal);
ovCycleCancel.addEventListener('click', closeCycleModal);
ovCycleOverlay.addEventListener('click', (e) => { if (e.target === ovCycleOverlay) closeCycleModal(); });
ovAddMedian.addEventListener('click', addOvMedian);
ovCycleSet.addEventListener('click', applyCycle);

// Enter key in time inputs adds median
[ovHH, ovMM, ovSS].forEach(el => {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') addOvMedian(); });
});
