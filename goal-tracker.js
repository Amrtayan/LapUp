/* ═══════════════════════════════════════════════════════════════
   Goal Tracker — Logic
   Data model, timeline rendering, modals, localStorage per-day
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────
  const TIMELINE_START = 4;          // 04:00 — day boundary
  const TIMELINE_HOURS = 24;         // 04:00 → 03:00 next day (full 24h)
  const TIMELINE_MINUTES = TIMELINE_HOURS * 60; // 1440
  const DEFAULT_VIEW_HOUR = 8;       // default scroll to 08:00
  const DAY_BOUNDARY = 4;            // day flips at 04:00
  const OVERSCROLL_THRESHOLD = 120;  // px of overscroll to trigger date change
  const STORAGE_PREFIX = 'lapup_goals_';
  const COLORS = ['#4a90d9', '#8a2be2', '#00e676', '#ff4d6d', '#f5a623', '#00bcd4'];

  // ── State ─────────────────────────────────────────────────────
  let currentDate = new Date();
  let tasks = [];
  let activeTaskId = null;
  let selectedColor = null;
  let overscrollAcc = 0;             // accumulated overscroll px

  let editingEntryIndex = null;
  let activePillTaskId = null;
  let activePillEntryIndex = null;

  // ── DOM Refs ──────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const monthEl         = $('gt-month');
  const dayLabelEl      = $('gt-day-label');
  const timelineHeader  = $('gt-timeline-header');
  const gridLinesEl     = $('gt-grid-lines');
  const tasksArea       = $('gt-tasks-area');
  const emptyState      = $('gt-empty-state');
  const timeIndicator   = $('gt-time-indicator');

  // Modals
  const addTaskModal      = $('add-task-modal');
  const logProgressModal  = $('log-progress-modal');
  const taskNameInput     = $('task-name-input');
  const colorPicker       = $('gt-color-picker');
  const progressPercent   = $('progress-percent');
  const progressStart     = $('progress-start');
  const progressEnd       = $('progress-end');
  const logProgressTitle  = $('log-progress-title');

  // ── Helpers ───────────────────────────────────────────────────

  /** Date → 'YYYY-MM-DD' */
  function dateKey(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** Date → 'August 2026' */
  function formatMonth(d) {
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /** Date → 'Daily Timeline (Tue, Aug 19)' */
  function formatDayLabel(d) {
    const inner = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return 'Daily Timeline (' + inner + ')';
  }

  function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth()    === d2.getMonth() &&
           d1.getDate()     === d2.getDate();
  }

  /**
   * Check if a real-time Date falls within this logical day
   * (04:00 of currentDate → 03:59 of currentDate+1).
   */
  function isWithinLogicalDay(realNow) {
    const dayStart = new Date(currentDate);
    dayStart.setHours(DAY_BOUNDARY, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return realNow >= dayStart && realNow < dayEnd;
  }

  /**
   * Convert "HH:MM" time string to minutes offset from TIMELINE_START (04:00).
   * Handles wrap-around: hours 00–03 are treated as 24–27 (next calendar day,
   * but still within this logical day).
   */
  function timeToMinutesFromStart(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    let offset = h - TIMELINE_START;
    if (offset < 0) offset += 24;               // 00:00–03:59 wraps to end
    return offset * 60 + m;
  }

  function minutesToPercent(mins) {
    return (mins / TIMELINE_MINUTES) * 100;
  }

  function generateId() {
    return 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── Storage ───────────────────────────────────────────────────

  function saveTasks() {
    localStorage.setItem(STORAGE_PREFIX + dateKey(currentDate), JSON.stringify(tasks));
  }

  function loadTasks() {
    const raw = localStorage.getItem(STORAGE_PREFIX + dateKey(currentDate));
    tasks = raw ? JSON.parse(raw) : [];
  }

  // ── Render: Timeline Header ───────────────────────────────────

  function renderTimelineHeader() {
    const now = new Date();
    const isToday = isSameDay(currentDate, now);
    const curHour = now.getHours();

    timelineHeader.innerHTML = '';
    for (let i = 0; i < TIMELINE_HOURS; i++) {
      const hour = (TIMELINE_START + i) % 24;
      const cell = document.createElement('div');
      cell.className = 'gt-hour-cell';
      if (isToday && hour === curHour) cell.classList.add('current-hour');
      cell.textContent = String(hour).padStart(2, '0') + ':00';
      timelineHeader.appendChild(cell);
    }
  }

  // ── Render: Vertical Grid Lines ───────────────────────────────

  function renderGridLines() {
    const now = new Date();
    const isToday = isSameDay(currentDate, now);
    const curHour = now.getHours();

    gridLinesEl.innerHTML = '';
    for (let i = 0; i < TIMELINE_HOURS; i++) {
      const hour = (TIMELINE_START + i) % 24;
      const line = document.createElement('div');
      line.className = 'gt-grid-line';
      if (isToday && hour === curHour) line.classList.add('current-hour');
      gridLinesEl.appendChild(line);
    }
  }

  // ── Render: Current-Time Indicator ────────────────────────────

  function updateTimeIndicator() {
    const now = new Date();
    if (!isWithinLogicalDay(now)) {
      timeIndicator.style.display = 'none';
      return;
    }

    const h = now.getHours();
    const m = now.getMinutes();
    let offset = h - TIMELINE_START;
    if (offset < 0) offset += 24;
    const totalMins = offset * 60 + m;

    if (totalMins < 0 || totalMins > TIMELINE_MINUTES) {
      timeIndicator.style.display = 'none';
      return;
    }

    timeIndicator.style.display = 'block';
    timeIndicator.style.left = minutesToPercent(totalMins) + '%';
  }

  // ── Render: Task Rows ─────────────────────────────────────────

  function renderTasks() {
    tasksArea.innerHTML = '';

    if (tasks.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    tasks.forEach((task, tIdx) => {
      const row = document.createElement('div');
      row.className = 'gt-task-row';
      row.style.animationDelay = (tIdx * 0.06) + 's';

      // Cumulative completion
      const totalPct = task.entries.reduce((s, e) => s + e.percent, 0);
      const isComplete = totalPct >= 100;

      // ─ Header (clickable to open options)
      const header = document.createElement('div');
      header.className = 'gt-task-header';
      header.addEventListener('click', () => openTaskOptions(task.id));

      // Icon
      const icon = document.createElement('div');
      icon.className = 'gt-task-icon';
      icon.style.color = task.color;
      icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>`;

      // Name
      const name = document.createElement('span');
      name.className = 'gt-task-name';
      name.textContent = task.name;

      // Completion badge
      const comp = document.createElement('span');
      comp.className = 'gt-task-completion';
      comp.style.color = isComplete ? 'var(--green)' : task.color;
      comp.textContent = `GOAL COMPLETION: ${totalPct}%`;

      header.append(icon, name, comp);
      row.appendChild(header);

      // ─ Pill Track
      const track = document.createElement('div');
      track.className = 'gt-pill-track';

      task.entries.forEach((entry, eIdx) => {
        const startMins = timeToMinutesFromStart(entry.startTime);
        const endMins   = timeToMinutesFromStart(entry.endTime);
        const duration  = endMins - startMins;
        if (duration <= 0) return;

        const left  = minutesToPercent(startMins);
        const width = minutesToPercent(duration);

        const pill = document.createElement('div');
        pill.className = 'gt-pill';
        pill.style.left   = left + '%';
        pill.style.width  = width + '%';
        pill.style.background = hexToRgba(task.color, 0.3);
        pill.style.border     = `2px solid ${task.color}`;
        pill.style.filter     = `drop-shadow(0 0 10px ${hexToRgba(task.color, 0.5)})`;
        pill.style.animationDelay = (eIdx * 0.08) + 's';
        if (entry.linkedSession) pill.dataset.sessionId = entry.linkedSession;
        pill.textContent = `+${entry.percent}%`;

        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          openPillDetails(task.id, eIdx);
        });

        track.appendChild(pill);
      });

      row.appendChild(track);
      tasksArea.appendChild(row);
    });
  }

  // ── Date Display & Navigation ─────────────────────────────────

  function updateDateDisplay() {
    monthEl.textContent    = formatMonth(currentDate);
    dayLabelEl.textContent = formatDayLabel(currentDate);
  }

  /**
   * Scroll the timeline so that DEFAULT_VIEW_HOUR (08:00) is the leftmost visible column.
   */
  function scrollToDefaultView() {
    const sc = document.querySelector('.gt-timeline-scroll');
    if (!sc) return;
    const columnsToSkip = DEFAULT_VIEW_HOUR - TIMELINE_START; // 8 - 4 = 4 columns
    const colWidth = sc.scrollWidth / TIMELINE_HOURS;
    sc.scrollLeft = columnsToSkip * colWidth;
  }

  /**
   * @param {number} delta  — +1 or -1
   * @param {'start'|'end'|'default'} scrollTo — where to scroll after date change
   */
  function changeDate(delta, scrollTo = 'default') {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + delta);
    loadTasks();
    updateDateDisplay();
    renderTimelineHeader();
    renderGridLines();
    updateTimeIndicator();
    renderTasks();

    // Position scroll based on direction of navigation
    requestAnimationFrame(() => {
      const sc = document.querySelector('.gt-timeline-scroll');
      if (!sc) return;
      if (scrollTo === 'start') {
        sc.scrollLeft = 0;
      } else if (scrollTo === 'end') {
        sc.scrollLeft = sc.scrollWidth - sc.clientWidth;
      } else {
        scrollToDefaultView();
      }
    });
  }

  // ── Modal: Add Task ───────────────────────────────────────────

  function openAddTask() {
    taskNameInput.value = '';
    selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    syncColorSwatches();
    addTaskModal.classList.add('active');
    setTimeout(() => taskNameInput.focus(), 120);
  }

  function closeAddTask() {
    addTaskModal.classList.remove('active');
  }

  function syncColorSwatches() {
    colorPicker.querySelectorAll('.gt-color-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === selectedColor);
    });
  }

  function saveNewTask() {
    const name = taskNameInput.value.trim();
    if (!name) { taskNameInput.focus(); return; }

    tasks.push({
      id: generateId(),
      name,
      color: selectedColor || COLORS[0],
      entries: []
    });

    saveTasks();
    renderTasks();
    closeAddTask();
  }

  // ── Modal: Log Progress ───────────────────────────────────────

  function openLogProgress(taskId) {
    activeTaskId = taskId;
    editingEntryIndex = null; // New entry by default
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    logProgressTitle.textContent = `Log Progress — ${task.name}`;
    progressPercent.value = '';
    progressStart.value   = '';
    progressEnd.value     = '';

    logProgressModal.classList.add('active');
    setTimeout(() => progressPercent.focus(), 120);
  }

  function closeLogProgress() {
    logProgressModal.classList.remove('active');
    activeTaskId = null;
    editingEntryIndex = null;
  }

  function saveProgress() {
    const task = tasks.find(t => t.id === activeTaskId);
    if (!task) return;

    const pct   = parseInt(progressPercent.value, 10);
    const start = progressStart.value;
    const end   = progressEnd.value;

    // Validation
    if (!pct || pct < 1 || pct > 100) { progressPercent.focus(); return; }
    if (!start || !end)                { return; }

    const startMins = timeToMinutesFromStart(start);
    const endMins   = timeToMinutesFromStart(end);
    if (endMins <= startMins) {
      progressStart.style.borderColor = 'var(--red)';
      progressEnd.style.borderColor   = 'var(--red)';
      setTimeout(() => {
        progressStart.style.borderColor = '';
        progressEnd.style.borderColor   = '';
      }, 1200);
      return;
    }

    // 1. Overlap Validation
    const hasOverlap = task.entries.some((entry, idx) => {
      if (idx === editingEntryIndex) return false;
      const eStart = timeToMinutesFromStart(entry.startTime);
      const eEnd = timeToMinutesFromStart(entry.endTime);
      // Overlap condition: start < eEnd AND end > eStart
      return (startMins < eEnd && endMins > eStart);
    });

    if (hasOverlap) {
      alert("This time period overlaps with an existing entry.");
      return;
    }

    // 2. >100% Validation
    const currentTotal = task.entries.reduce((sum, entry, idx) => {
      return idx === editingEntryIndex ? sum : sum + entry.percent;
    }, 0);

    if (currentTotal + pct > 100) {
      if (!confirm("Total progress will exceed 100%. Are you sure?")) {
        return;
      }
    }

    if (editingEntryIndex !== null) {
      task.entries[editingEntryIndex].percent = pct;
      task.entries[editingEntryIndex].startTime = start;
      task.entries[editingEntryIndex].endTime = end;
    } else {
      task.entries.push({ percent: pct, startTime: start, endTime: end });
    }

    saveTasks();
    renderTasks();
    closeLogProgress();
  }

  // ── Modal: Task Options ───────────────────────────────────────
  
  function openTaskOptions(taskId) {
    activeTaskId = taskId;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    $('task-options-title').textContent = task.name;
    $('task-options-modal').classList.add('active');
  }

  function closeTaskOptions() {
    $('task-options-modal').classList.remove('active');
    activeTaskId = null;
  }

  function handleRenameTask() {
    if (!activeTaskId) return;
    const task = tasks.find(t => t.id === activeTaskId);
    const newName = prompt('Enter new task name:', task.name);
    if (newName && newName.trim()) {
      task.name = newName.trim();
      saveTasks();
      renderTasks();
    }
    closeTaskOptions();
  }

  function handleRemoveTask() {
    if (!activeTaskId) return;
    if (confirm('Are you sure you want to completely remove this task and all its progress for today?')) {
      tasks = tasks.filter(t => t.id !== activeTaskId);
      saveTasks();
      renderTasks();
    }
    closeTaskOptions();
  }

  // ── Modal: Pill Details ───────────────────────────────────────

  function openPillDetails(taskId, entryIdx) {
    activePillTaskId = taskId;
    activePillEntryIndex = entryIdx;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const entry = task.entries[entryIdx];
    
    // Check if linked
    if (entry.linkedSession) {
      let sessionName = 'Linked Session';
      let netDefStr = 'Net: —';
      try {
        const rawSessions = localStorage.getItem('laptrack_sessions');
        if (rawSessions) {
          const allSessions = JSON.parse(rawSessions);
          const s = allSessions.find(x => x.id === entry.linkedSession);
          if (s) {
            sessionName = s.name;
            if (s.netDeficitMs !== undefined) {
               const absNet = Math.abs(s.netDeficitMs);
               const sign = s.netDeficitMs > 0 ? '-' : '+';
               const totalSec = Math.floor(absNet / 1000);
               const h = Math.floor(totalSec / 3600);
               const m = Math.floor((totalSec % 3600) / 60);
               const sec = totalSec % 60;
               const timeStr = [h, m, sec].map(v => v < 10 ? '0' + v : v).filter((v,i) => v !== '00' || i > 0).join(':');
               netDefStr = `Net: ${sign}${timeStr}`;
            }
            if (s.totalGapTimeMs !== undefined && s.gapCount !== undefined) {
               const gapSec = Math.floor(s.totalGapTimeMs / 1000);
               const gh = Math.floor(gapSec / 3600);
               const gm = Math.floor((gapSec % 3600) / 60);
               const gs = gapSec % 60;
               const gapTimeStr = [gh, gm, gs].map(v => String(v).padStart(2, '0')).filter((v,i) => v !== '00' || i > 0).join(':');
               netDefStr += ` • Gaps: ${s.gapCount} (${gapTimeStr})`;
            }
          }
        }
      } catch (e) { console.warn(e); }
      
      $('pill-details-title').innerHTML = `<a href="./?session=${entry.linkedSession}">${sessionName}</a>`;
      $('pill-details-subtitle').innerHTML = `<div>${entry.startTime} → ${entry.endTime}</div><div style="margin-top:4px; font-size:13px; opacity:0.9;">${netDefStr}</div>`;
      $('btn-pill-unlink').style.display = 'flex';
    } else {
      $('pill-details-title').textContent = 'Manual Entry';
      $('pill-details-subtitle').textContent = `${entry.startTime} → ${entry.endTime}`;
      $('btn-pill-unlink').style.display = 'none';
    }
    
    $('pill-details-modal').classList.add('active');
  }

  function closePillDetails() {
    $('pill-details-modal').classList.remove('active');
    activePillTaskId = null;
    activePillEntryIndex = null;
  }

  function handlePillRemove() {
    if (!activePillTaskId || activePillEntryIndex === null) return;
    if (confirm('Delete this progress entry?')) {
      const task = tasks.find(t => t.id === activePillTaskId);
      if (task) {
        task.entries.splice(activePillEntryIndex, 1);
        saveTasks();
        renderTasks();
      }
    }
    closePillDetails();
  }

  function handlePillUnlink() {
    if (!activePillTaskId || activePillEntryIndex === null) return;
    const task = tasks.find(t => t.id === activePillTaskId);
    if (task) {
      delete task.entries[activePillEntryIndex].linkedSession;
      saveTasks();
      openPillDetails(activePillTaskId, activePillEntryIndex);
      renderTasks();
    }
  }

  function handlePillEdit() {
    if (!activePillTaskId || activePillEntryIndex === null) return;
    const task = tasks.find(t => t.id === activePillTaskId);
    if (!task) return;
    const entry = task.entries[activePillEntryIndex];
    if (entry.linkedSession) {
      alert('Please unlink the session before editing this entry.');
      return;
    }
    
    closePillDetails();
    editingEntryIndex = activePillEntryIndex;
    activeTaskId = activePillTaskId;
    
    logProgressTitle.textContent = `Edit Progress — ${task.name}`;
    progressPercent.value = entry.percent;
    progressStart.value   = entry.startTime;
    progressEnd.value     = entry.endTime;
    logProgressModal.classList.add('active');
  }

  // ── Event Wiring ──────────────────────────────────────────────

  function init() {
    // Date nav
    $('btn-prev-day').addEventListener('click', () => changeDate(-1));
    $('btn-next-day').addEventListener('click', () => changeDate(1));

    // Add Task modal
    $('btn-add-task').addEventListener('click', openAddTask);
    $('btn-cancel-task').addEventListener('click', closeAddTask);
    $('btn-save-task').addEventListener('click', saveNewTask);

    // Color swatches
    colorPicker.querySelectorAll('.gt-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        selectedColor = sw.dataset.color;
        syncColorSwatches();
      });
    });

    // Log Progress modal
    $('btn-cancel-progress').addEventListener('click', closeLogProgress);
    $('btn-save-progress').addEventListener('click', saveProgress);

    // Task Options modal
    $('btn-cancel-task-options').addEventListener('click', closeTaskOptions);
    $('btn-opt-add-progress').addEventListener('click', () => { closeTaskOptions(); openLogProgress(activeTaskId); });
    $('btn-opt-rename-task').addEventListener('click', handleRenameTask);
    $('btn-opt-remove-task').addEventListener('click', handleRemoveTask);

    // Pill Details modal
    $('btn-cancel-pill-details').addEventListener('click', closePillDetails);
    $('btn-pill-edit').addEventListener('click', handlePillEdit);
    $('btn-pill-unlink').addEventListener('click', handlePillUnlink);
    $('btn-pill-remove').addEventListener('click', handlePillRemove);

    // Overlay click → close
    addTaskModal.addEventListener('click', e => { if (e.target === addTaskModal) closeAddTask(); });
    logProgressModal.addEventListener('click', e => { if (e.target === logProgressModal) closeLogProgress(); });
    $('task-options-modal').addEventListener('click', e => { if (e.target === $('task-options-modal')) closeTaskOptions(); });
    $('pill-details-modal').addEventListener('click', e => { if (e.target === $('pill-details-modal')) closePillDetails(); });

    // Keyboard
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (addTaskModal.classList.contains('active')) closeAddTask();
        if (logProgressModal.classList.contains('active')) closeLogProgress();
        if ($('task-options-modal').classList.contains('active')) closeTaskOptions();
        if ($('pill-details-modal').classList.contains('active')) closePillDetails();
      }
      if (e.key === 'Enter') {
        if (addTaskModal.classList.contains('active'))     saveNewTask();
        if (logProgressModal.classList.contains('active')) saveProgress();
      }
    });

    // ── Initial render ──
    const urlParams = new URLSearchParams(window.location.search);
    const targetLinkedSession = urlParams.get('linked_session');
    let autoScrolledToLink = false;

    if (targetLinkedSession) {
      // Find which date has this linked session
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('lapup_goals_')) {
          try {
            const dateTasks = JSON.parse(localStorage.getItem(key));
            let found = false;
            for (const t of dateTasks) {
              if (t.entries.some(e => e.linkedSession === targetLinkedSession)) {
                found = true;
                break;
              }
            }
            if (found) {
              const dateStr = key.replace('lapup_goals_', '');
              const parts = dateStr.split('-');
              if (parts.length === 3) {
                activeDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
              }
              break;
            }
          } catch(e) {}
        }
      }
    }

    loadTasks();
    updateDateDisplay();
    renderTimelineHeader();
    renderGridLines();
    updateTimeIndicator();
    renderTasks();

    if (targetLinkedSession) {
      // Find the pill and scroll to it
      requestAnimationFrame(() => {
        const pill = document.querySelector(`.gt-pill[data-session-id="${targetLinkedSession}"]`);
        if (pill) {
          const scrollContainer = document.querySelector('.gt-timeline-scroll');
          if (scrollContainer) {
            const pillLeft = pill.offsetLeft;
            const pillWidth = pill.offsetWidth;
            const containerWidth = scrollContainer.clientWidth;
            scrollContainer.scrollLeft = pillLeft - (containerWidth / 2) + (pillWidth / 2);
            autoScrolledToLink = true;
          }
          pill.classList.add('highlight-linked-pill');
        } else if (!autoScrolledToLink) {
          scrollToDefaultView();
        }
      });
    } else {
      // Default scroll position → 08:00
      requestAnimationFrame(() => scrollToDefaultView());
    }

    // ── Overscroll date-change detection ──
    const scrollContainer = document.querySelector('.gt-timeline-scroll');
    if (scrollContainer) {
      scrollContainer.addEventListener('wheel', (e) => {
        // Determine horizontal scroll intent
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
        if (delta === 0) return;

        const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;

        if (delta < 0 && scrollContainer.scrollLeft <= 1) {
          // At left edge, scrolling left → prev day
          overscrollAcc += Math.abs(delta);
          if (overscrollAcc >= OVERSCROLL_THRESHOLD) {
            overscrollAcc = 0;
            changeDate(-1, 'end');
          }
          e.preventDefault();
        } else if (delta > 0 && scrollContainer.scrollLeft >= maxScroll - 1) {
          // At right edge, scrolling right → next day
          overscrollAcc += Math.abs(delta);
          if (overscrollAcc >= OVERSCROLL_THRESHOLD) {
            overscrollAcc = 0;
            changeDate(1, 'start');
          }
          e.preventDefault();
        } else {
          overscrollAcc = 0;
        }
      }, { passive: false });
    }

    // Tick the time indicator every 60s
    setInterval(updateTimeIndicator, 60000);
  }

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
