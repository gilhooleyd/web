(() => {
  const STORAGE_KEYS = {
    LOGS: 'workclock_logs_v1',
    ACTIVE_START: 'workclock_active_start_v1',
    PENDING_SHIFT: 'workclock_pending_shift_v1',
    SEEDED: 'workclock_seeded_v1'
  };

  // Doctor's office 1-5 faces metadata & SVG generator
  const MOOD_META = {
    1: { label: 'Rough', color: 'hsl(4, 76%, 56%)' },
    2: { label: 'Tough', color: 'hsl(26, 88%, 56%)' },
    3: { label: 'Okay', color: 'hsl(45, 92%, 44%)' },
    4: { label: 'Good', color: 'hsl(142, 52%, 42%)' },
    5: { label: 'Great', color: 'hsl(168, 68%, 34%)' }
  };

  function getFaceSVG(rating, size = 38) {
    const meta = MOOD_META[rating] || MOOD_META[3];
    let mouthPath = '';
    let browPath = '';
    if (rating === 1) {
      // Deep frown + angled brows
      mouthPath = 'M 8 17.5 C 10 13.5, 14 13.5, 16 17.5';
      browPath = 'M 6.5 7.5 L 9.5 9 M 17.5 7.5 L 14.5 9';
    } else if (rating === 2) {
      // Slight frown
      mouthPath = 'M 8.5 16.5 C 10.5 14.5, 13.5 14.5, 15.5 16.5';
    } else if (rating === 3) {
      // Neutral flat line
      mouthPath = 'M 8.5 15.5 L 15.5 15.5';
    } else if (rating === 4) {
      // Gentle smile
      mouthPath = 'M 8.5 14.5 C 10.5 17, 13.5 17, 15.5 14.5';
    } else {
      // Big happy grin
      mouthPath = 'M 7.5 14 C 9.5 18.5, 14.5 18.5, 16.5 14';
    }

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="${meta.color}" fill-opacity="0.16" stroke="${meta.color}" stroke-width="2" />
        ${browPath ? `<path d="${browPath}" stroke="${meta.color}" stroke-width="1.8" stroke-linecap="round" />` : ''}
        <circle cx="9" cy="10" r="1.35" fill="${meta.color}" />
        <circle cx="15" cy="10" r="1.35" fill="${meta.color}" />
        <path d="${mouthPath}" stroke="${meta.color}" stroke-width="2" stroke-linecap="round" fill="none" />
      </svg>
    `;
  }

  // Date helpers
  function toDateKey(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatTimeShort(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatActiveStartTime(isoStr) {
    const d = new Date(isoStr);
    const todayKey = toDateKey(new Date());
    const startKey = toDateKey(d);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (startKey === todayKey) {
      return timeStr;
    }
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateStr}, ${timeStr}`;
  }

  function toLocalDatetimeInputValue(dateOrISO) {
    const d = new Date(dateOrISO);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${mins}`;
  }

  function parseLocalDatetime(str) {
    if (!str) return null;
    const parts = str.split('T');
    if (parts.length !== 2) return null;
    const dateParts = parts[0].split('-').map(Number);
    const timeParts = parts[1].split(':').map(Number);
    if (dateParts.length !== 3 || timeParts.length < 2) return null;
    const [year, month, day] = dateParts;
    const [hours, minutes] = timeParts;
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) return null;
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  }

  function formatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSec % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  }

  // State
  let logs = [];
  let activeStartISO = null;
  let pendingShift = null;
  let elapsedTimer = null;
  let selectedHistoryDate = null;

  // History navigation state
  let currentHistorySubtab = 'month'; // 'month' | 'week'
  let viewedMonthDate = new Date();
  viewedMonthDate.setDate(1);
  let viewedWeekStart = getStartOfWeek(new Date());

  function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 (Sun) to 6 (Sat)
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Load and save state
  function loadState() {
    try {
      const rawLogs = localStorage.getItem(STORAGE_KEYS.LOGS);
      logs = rawLogs ? JSON.parse(rawLogs) : [];
    } catch {
      logs = [];
    }
    activeStartISO = localStorage.getItem(STORAGE_KEYS.ACTIVE_START) || null;
    try {
      const rawPending = localStorage.getItem(STORAGE_KEYS.PENDING_SHIFT);
      pendingShift = rawPending ? JSON.parse(rawPending) : null;
    } catch {
      pendingShift = null;
    }

    // Auto-seed last 30 days on first visit
    if (!localStorage.getItem(STORAGE_KEYS.SEEDED) && logs.length === 0) {
      seedTestData(false);
      localStorage.setItem(STORAGE_KEYS.SEEDED, '1');
    }
  }

  function saveLogs() {
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
  }

  // Generate realistic past month of work shifts
  function seedTestData(showNotification = true) {
    const now = new Date();
    const generated = [];

    // Deterministic-looking but varied values for the past 30 days
    for (let i = 30; i >= 1; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dow = d.getDay();
      // Skip most weekends, except maybe 1 short Saturday shift
      if (dow === 0) continue;
      if (dow === 6 && i % 14 !== 0) continue;

      const dateStr = toDateKey(d);
      const startHour = 8 + (i % 2);
      const startMin = (i * 11) % 45;

      const clockInDate = new Date(d);
      clockInDate.setHours(startHour, startMin, 0, 0);

      // Hours between 6.5 and 9.5 on weekdays, ~4.0 on occasional Saturday
      const baseHours = dow === 6 ? 4.2 : 7.4 + ((i * 7) % 22) / 10;
      const hours = Math.round(baseHours * 100) / 100;

      const clockOutDate = new Date(clockInDate.getTime() + hours * 3600 * 1000);

      // Mood rating 1-5 (weighted toward 3-5 with an occasional 1 or 2)
      const ratingsPool = [4, 5, 3, 4, 2, 5, 4, 3, 1, 4, 5, 3, 4, 2, 5];
      const rating = ratingsPool[i % ratingsPool.length];

      generated.push({
        id: `seed-${dateStr}`,
        date: dateStr,
        clockIn: clockInDate.toISOString(),
        clockOut: clockOutDate.toISOString(),
        hours,
        rating
      });
    }

    // Merge with any existing logs outside the seed dates or replace seed dates
    const seedDates = new Set(generated.map((g) => g.date));
    const filteredExisting = logs.filter((l) => !seedDates.has(l.date));
    logs = [...filteredExisting, ...generated].sort((a, b) => a.clockIn.localeCompare(b.clockIn));
    saveLogs();
    renderAll();
    if (showNotification) {
      showToast('Prefilled last 30 days with test shifts');
    }
  }

  // Toast helper
  let toastTimeout = null;
  function showToast(message) {
    const el = document.getElementById('toast-msg');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.classList.add('hidden');
    }, 2600);
  }

  // Clock In / Clock Out logic
  function handleClockToggle() {
    if (!activeStartISO) {
      // Clock In
      activeStartISO = new Date().toISOString();
      localStorage.setItem(STORAGE_KEYS.ACTIVE_START, activeStartISO);
      renderClockView();
      showToast('Clocked in! Have a great shift.');
    } else {
      // Clock Out -> trigger 1-5 face survey modal
      const clockOutDate = new Date();
      const clockInDate = new Date(activeStartISO);
      const diffHours = Math.max(0.01, (clockOutDate - clockInDate) / (1000 * 3600));
      const roundedHours = Math.round(diffHours * 100) / 100;

      pendingShift = {
        id: `shift-${Date.now()}`,
        date: toDateKey(clockInDate),
        clockIn: clockInDate.toISOString(),
        clockOut: clockOutDate.toISOString(),
        hours: roundedHours
      };
      localStorage.setItem(STORAGE_KEYS.PENDING_SHIFT, JSON.stringify(pendingShift));

      openSurveyModal(pendingShift);
    }
  }

  function handleCancelShift() {
    if (!activeStartISO) return;
    activeStartISO = null;
    pendingShift = null;
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_START);
    localStorage.removeItem(STORAGE_KEYS.PENDING_SHIFT);
    renderClockView();
    showToast('Current shift cancelled');
  }

  function openSurveyModal(shift) {
    const backdrop = document.getElementById('survey-modal-backdrop');
    const summary = document.getElementById('survey-shift-summary');
    summary.textContent = `${formatTimeShort(shift.clockIn)} – ${formatTimeShort(shift.clockOut)} (${shift.hours.toFixed(2)} hrs)`;
    backdrop.classList.remove('hidden');
  }

  function completeShiftWithRating(rating) {
    if (!pendingShift) return;
    const completed = {
      ...pendingShift,
      rating: Number(rating)
    };
    logs.push(completed);
    logs.sort((a, b) => a.clockIn.localeCompare(b.clockIn));
    saveLogs();

    pendingShift = null;
    activeStartISO = null;
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_START);
    localStorage.removeItem(STORAGE_KEYS.PENDING_SHIFT);

    document.getElementById('survey-modal-backdrop').classList.add('hidden');
    renderAll();
    showToast(`Shift saved with mood ${rating}/5!`);
  }

  // Render Clock View
  function renderClockView() {
    const badge = document.getElementById('clock-status-badge');
    const statusText = document.getElementById('clock-status-text');
    const btn = document.getElementById('clock-toggle-btn');
    const btnIcon = document.getElementById('clock-btn-icon');
    const btnLabel = document.getElementById('clock-btn-label');
    const btnSub = document.getElementById('clock-btn-sub');
    const sessionPanel = document.getElementById('active-session-panel');
    const clockedInTimeVal = document.getElementById('clocked-in-time-val');
    const elapsedTimeVal = document.getElementById('elapsed-time-val');

    clearInterval(elapsedTimer);

    if (activeStartISO) {
      badge.classList.add('clocked-in');
      statusText.textContent = 'Currently Working';
      btn.classList.add('is-clocked-in');
      btnIcon.innerHTML = `<rect x="6" y="6" width="12" height="12" rx="2"></rect>`;
      btnLabel.textContent = 'Clock Out';
      btnSub.textContent = 'Tap to finish & rate';
      sessionPanel.classList.remove('hidden');
      clockedInTimeVal.textContent = formatActiveStartTime(activeStartISO);

      const updateTick = () => {
        const ms = Date.now() - new Date(activeStartISO).getTime();
        elapsedTimeVal.textContent = formatElapsed(ms);
      };
      updateTick();
      elapsedTimer = setInterval(updateTick, 1000);
    } else {
      badge.classList.remove('clocked-in');
      statusText.textContent = 'Off the Clock';
      btn.classList.remove('is-clocked-in');
      btnIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
      btnLabel.textContent = 'Clock In';
      btnSub.textContent = 'Tap to start shift';
      sessionPanel.classList.add('hidden');
    }

    // Recent shifts list (last 5 shifts)
    const recentContainer = document.getElementById('recent-logs-list');
    const todayKey = toDateKey(new Date());
    const todayTotal = logs
      .filter((l) => l.date === todayKey)
      .reduce((sum, l) => sum + l.hours, 0);

    document.getElementById('today-total-badge').textContent =
      todayTotal > 0 ? `Today: ${todayTotal.toFixed(1)}h` : '';

    const recent = [...logs].reverse().slice(0, 5);
    if (recent.length === 0) {
      recentContainer.innerHTML = `<div class="empty-state">No shifts recorded yet. Clock in above or prefill test data in Settings.</div>`;
    } else {
      recentContainer.innerHTML = recent
        .map((item) => {
          const dObj = new Date(item.date + 'T12:00:00');
          const niceDate = dObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
          return `
            <div class="log-row" data-id="${item.id}" style="cursor: pointer;" title="Tap to edit this shift">
              <div class="log-row-left">
                <span class="log-times mono">${formatTimeShort(item.clockIn)} – ${formatTimeShort(item.clockOut)}</span>
                <span class="log-date-sub">${niceDate}</span>
              </div>
              <div class="log-row-right">
                <span class="log-hours-badge mono">${item.hours.toFixed(1)}h</span>
                <span title="Mood ${item.rating}/5 (${MOOD_META[item.rating]?.label || ''})">${getFaceSVG(item.rating, 28)}</span>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  // Aggregate logs per day (YYYY-MM-DD -> { hours, rating })
  function getDailyAggregates() {
    const map = new Map();
    for (const entry of logs) {
      const prev = map.get(entry.date);
      if (!prev) {
        map.set(entry.date, {
          hours: entry.hours,
          ratings: [entry.rating]
        });
      } else {
        prev.hours += entry.hours;
        prev.ratings.push(entry.rating);
      }
    }
    const result = new Map();
    for (const [date, data] of map.entries()) {
      const avgRating = Math.round(data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length);
      result.set(date, {
        hours: Math.round(data.hours * 100) / 100,
        rating: Math.min(5, Math.max(1, avgRating))
      });
    }
    return result;
  }

  // Render History View (Month Calendar & Week Line Graph)
  function renderHistoryView() {
    const dailyMap = getDailyAggregates();
    if (currentHistorySubtab === 'month') {
      renderMonthCalendar(dailyMap);
    } else {
      renderWeekGraph(dailyMap);
    }
  }

  function updateSummaryStats(entries) {
    const totalHours = entries.reduce((acc, e) => acc + e.hours, 0);
    const activeDays = entries.filter((e) => e.hours > 0);
    const avgHours = activeDays.length > 0 ? totalHours / activeDays.length : 0;
    const avgMood =
      activeDays.length > 0
        ? activeDays.reduce((acc, e) => acc + e.rating, 0) / activeDays.length
        : 0;

    document.getElementById('stat-total-hours').textContent = `${totalHours.toFixed(1)}h`;
    document.getElementById('stat-avg-hours').textContent = `${avgHours.toFixed(1)}h`;
    document.getElementById('stat-avg-mood').textContent =
      avgMood > 0 ? `${avgMood.toFixed(1)} / 5` : '—';
  }

  function renderMonthCalendar(dailyMap) {
    const year = viewedMonthDate.getFullYear();
    const month = viewedMonthDate.getMonth();

    const monthLabel = viewedMonthDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
    document.getElementById('month-label').textContent = monthLabel;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = toDateKey(new Date());

    const grid = document.getElementById('calendar-grid');
    const cells = [];
    const monthEntries = [];

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(`<div class="cal-day empty"></div>`);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const key = toDateKey(d);
      const data = dailyMap.get(key);
      const isToday = key === todayKey;

      if (data) {
        monthEntries.push(data);
        cells.push(`
          <div class="cal-day has-data ${isToday ? 'today' : ''}" data-date="${key}" title="${key}: ${data.hours.toFixed(1)} hrs, Mood ${data.rating}/5">
            <span class="cal-day-num mono">${day}</span>
            <span class="cal-day-face">${getFaceSVG(data.rating, 22)}</span>
            <span class="cal-day-hours mono">${data.hours.toFixed(1)}h</span>
          </div>
        `);
      } else {
        cells.push(`
          <div class="cal-day ${isToday ? 'today' : ''}" data-date="${key}">
            <span class="cal-day-num mono">${day}</span>
            <span class="cal-day-face"></span>
            <span class="cal-day-hours mono" style="color: var(--border);">—</span>
          </div>
        `);
      }
    }

    grid.innerHTML = cells.join('');
    updateSummaryStats(monthEntries);
  }

  function renderWeekGraph(dailyMap) {
    const days = [];
    const weekEntries = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(viewedWeekStart);
      d.setDate(viewedWeekStart.getDate() + i);
      const key = toDateKey(d);
      const data = dailyMap.get(key) || { hours: 0, rating: null };
      if (data.hours > 0) weekEntries.push(data);
      days.push({
        date: d,
        key,
        shortDay: d.toLocaleDateString([], { weekday: 'short' }),
        dayNum: d.getDate(),
        hours: data.hours,
        rating: data.rating
      });
    }

    const startStr = days[0].date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const endStr = days[6].date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('week-label').textContent = `${startStr} – ${endStr}`;

    updateSummaryStats(weekEntries);

    // Build responsive dual-series SVG line chart
    const width = 440;
    const height = 240;
    const padL = 36;
    const padR = 30;
    const padT = 26;
    const padB = 46;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxHours = Math.max(10, ...days.map((d) => Math.ceil(d.hours)));

    const xFor = (idx) => padL + (idx / 6) * plotW;
    const yForHours = (h) => padT + plotH - (h / maxHours) * plotH;
    const yForMood = (r) => padT + plotH - ((r - 1) / 4) * plotH;

    // Grid lines (0h, maxHours/2, maxHours)
    const gridTicks = [0, Math.round(maxHours / 2), maxHours];
    const gridLines = gridTicks
      .map((val) => {
        const y = yForHours(val);
        return `
          <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="hsl(40, 15%, 86%)" stroke-dasharray="3 3" />
          <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="hsl(192, 16%, 44%)" font-family="JetBrains Mono">${val}h</text>
        `;
      })
      .join('');

    // Hours polyline & area
    const hoursPoints = days.map((d, idx) => `${xFor(idx)},${yForHours(d.hours)}`).join(' ');
    const areaPoints = `${xFor(0)},${yForHours(0)} ${hoursPoints} ${xFor(6)},${yForHours(0)}`;

    // Mood polyline (connect days that have mood ratings)
    const moodRatedDays = days
      .map((d, idx) => (d.rating ? { x: xFor(idx), y: yForMood(d.rating), rating: d.rating } : null))
      .filter(Boolean);
    const moodPolyline =
      moodRatedDays.length > 1
        ? `<polyline fill="none" stroke="hsl(24, 85%, 56%)" stroke-width="2.2" stroke-dasharray="4 3" points="${moodRatedDays.map((p) => `${p.x},${p.y}`).join(' ')}" />`
        : '';

    const dataNodes = days
      .map((d, idx) => {
        const cx = xFor(idx);
        const cy = yForHours(d.hours);
        const labelVal = d.hours > 0 ? `${d.hours.toFixed(1)}h` : '';
        return `
          <g>
            <circle cx="${cx}" cy="${cy}" r="4.5" fill="hsl(173, 58%, 33%)" stroke="#fff" stroke-width="1.8" />
            ${labelVal ? `<text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="hsl(192, 42%, 14%)" font-family="JetBrains Mono">${labelVal}</text>` : ''}
            <text x="${cx}" y="${height - 22}" text-anchor="middle" font-size="11" font-weight="600" fill="hsl(192, 42%, 14%)">${d.shortDay}</text>
            <text x="${cx}" y="${height - 8}" text-anchor="middle" font-size="10" fill="hsl(192, 16%, 44%)" font-family="JetBrains Mono">${d.dayNum}</text>
          </g>
        `;
      })
      .join('');

    const moodNodes = moodRatedDays
      .map((p) => {
        const meta = MOOD_META[p.rating];
        return `
          <g>
            <circle cx="${p.x}" cy="${p.y}" r="9" fill="#fff" stroke="${meta.color}" stroke-width="2" />
            <text x="${p.x}" y="${p.y + 3.5}" text-anchor="middle" font-size="10" font-weight="800" fill="${meta.color}" font-family="JetBrains Mono">${p.rating}</text>
          </g>
        `;
      })
      .join('');

    document.getElementById('week-chart-container').innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="Weekly hours and mood line graph">
        <defs>
          <linearGradient id="hoursAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="hsl(173, 58%, 33%)" stop-opacity="0.24" />
            <stop offset="100%" stop-color="hsl(173, 58%, 33%)" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${gridLines}
        <polygon points="${areaPoints}" fill="url(#hoursAreaGrad)" />
        <polyline fill="none" stroke="hsl(173, 58%, 33%)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${hoursPoints}" />
        ${moodPolyline}
        ${dataNodes}
        ${moodNodes}
      </svg>
    `;
  }

  // CSV Export & Import
  function exportCSV() {
    if (logs.length === 0) {
      showToast('No shifts to export');
      return;
    }
    const header = 'date,clockIn,clockOut,hours,rating\n';
    const rows = logs
      .map((l) => `${l.date},${l.clockIn},${l.clockOut},${l.hours},${l.rating}`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workclock-export-${toDateKey(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported CSV file');
  }

  function importCSVFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) {
        showToast('CSV file is empty or invalid');
        return;
      }

      const imported = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        if (cols.length < 5) continue;
        const [date, clockIn, clockOut, hoursStr, ratingStr] = cols;
        const hours = parseFloat(hoursStr);
        const rating = parseInt(ratingStr, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(hours) || isNaN(rating)) continue;
        imported.push({
          id: `imp-${date}-${i}`,
          date,
          clockIn,
          clockOut,
          hours: Math.round(hours * 100) / 100,
          rating: Math.min(5, Math.max(1, rating))
        });
      }

      if (imported.length === 0) {
        showToast('No valid rows found in CSV');
        return;
      }

      logs = imported.sort((a, b) => a.clockIn.localeCompare(b.clockIn));
      saveLogs();
      renderAll();
      showToast(`Imported ${imported.length} shifts from CSV`);
    };
    reader.readAsText(file);
  }

  // Render All Views
  function renderAll() {
    renderClockView();
    renderHistoryView();
  }

  // Active Start Time Editing Modal
  function openActiveStartModal() {
    if (!activeStartISO) {
      showToast('You must be clocked in to edit start time');
      return;
    }
    const input = document.getElementById('active-start-input');
    input.value = toLocalDatetimeInputValue(activeStartISO);
    document.getElementById('active-start-modal-backdrop').classList.remove('hidden');
  }

  function closeActiveStartModal() {
    document.getElementById('active-start-modal-backdrop').classList.add('hidden');
  }

  function handleActiveStartSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('active-start-input');
    const parsed = parseLocalDatetime(input.value);
    if (!parsed) {
      showToast('Please enter a valid date and time');
      return;
    }
    // Disallow future start times beyond a 1-minute buffer
    if (parsed.getTime() > Date.now() + 60000) {
      showToast('Start time cannot be in the future');
      return;
    }

    activeStartISO = parsed.toISOString();
    localStorage.setItem(STORAGE_KEYS.ACTIVE_START, activeStartISO);
    renderClockView();
    closeActiveStartModal();
    showToast('Start time updated');
  }

  // History Shift Editing Modal
  function formatShiftOption(shift) {
    const d = new Date(shift.clockIn);
    const niceDate = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const startStr = formatTimeShort(shift.clockIn);
    const endStr = formatTimeShort(shift.clockOut);
    return `${niceDate}: ${startStr} – ${endStr} (${shift.hours.toFixed(1)}h)`;
  }

  function updateHistoryEditDuration() {
    const startInput = document.getElementById('history-edit-start-input');
    const endInput = document.getElementById('history-edit-end-input');
    const durationVal = document.getElementById('history-edit-duration-val');
    const saveBtn = document.getElementById('history-edit-save-btn');

    const start = parseLocalDatetime(startInput.value);
    const end = parseLocalDatetime(endInput.value);

    if (!start || !end) {
      durationVal.textContent = '-- hrs';
      durationVal.classList.remove('error');
      saveBtn.disabled = true;
      return;
    }

    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) {
      durationVal.textContent = 'End time must be after start time';
      durationVal.classList.add('error');
      saveBtn.disabled = true;
    } else {
      const diffHours = diffMs / (1000 * 3600);
      durationVal.textContent = `${diffHours.toFixed(2)} hrs`;
      durationVal.classList.remove('error');
      saveBtn.disabled = false;
    }
  }

  function populateHistoryEditFields() {
    const select = document.getElementById('history-edit-shift-select');
    const shiftId = select.value;
    const shift = logs.find((l) => l.id === shiftId);
    if (!shift) return;

    document.getElementById('history-edit-start-input').value = toLocalDatetimeInputValue(shift.clockIn);
    document.getElementById('history-edit-end-input').value = toLocalDatetimeInputValue(shift.clockOut);
    updateHistoryEditDuration();
  }

  function openHistoryEditModal(targetShiftId = null) {
    if (logs.length === 0) {
      showToast('No shifts recorded to edit');
      return;
    }

    const select = document.getElementById('history-edit-shift-select');
    const sorted = [...logs].sort((a, b) => b.clockIn.localeCompare(a.clockIn));

    select.innerHTML = sorted
      .map((s) => `<option value="${s.id}">${formatShiftOption(s)}</option>`)
      .join('');

    let selectedId = sorted[0].id;
    if (targetShiftId && logs.some((l) => l.id === targetShiftId)) {
      selectedId = targetShiftId;
    } else if (selectedHistoryDate && sorted.some((l) => l.date === selectedHistoryDate)) {
      selectedId = sorted.find((l) => l.date === selectedHistoryDate).id;
    }

    select.value = selectedId;
    populateHistoryEditFields();
    document.getElementById('history-edit-modal-backdrop').classList.remove('hidden');
  }

  function closeHistoryEditModal() {
    document.getElementById('history-edit-modal-backdrop').classList.add('hidden');
  }

  function handleHistoryEditSubmit(e) {
    e.preventDefault();
    const select = document.getElementById('history-edit-shift-select');
    const shiftId = select.value;
    const shift = logs.find((l) => l.id === shiftId);
    if (!shift) {
      showToast('Shift not found');
      return;
    }

    const startInput = document.getElementById('history-edit-start-input');
    const endInput = document.getElementById('history-edit-end-input');
    const start = parseLocalDatetime(startInput.value);
    const end = parseLocalDatetime(endInput.value);

    if (!start || !end) {
      showToast('Please enter valid start and end dates and times');
      return;
    }

    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) {
      showToast('End time must be after start time');
      return;
    }

    const diffHours = Math.round((diffMs / (1000 * 3600)) * 100) / 100;
    shift.clockIn = start.toISOString();
    shift.clockOut = end.toISOString();
    shift.date = toDateKey(start);
    shift.hours = diffHours;

    logs.sort((a, b) => a.clockIn.localeCompare(b.clockIn));
    saveLogs();
    renderAll();
    closeHistoryEditModal();
    showToast('Shift updated');
  }

  function handleHistoryDeleteShift() {
    const select = document.getElementById('history-edit-shift-select');
    const shiftId = select.value;
    const shift = logs.find((l) => l.id === shiftId);
    if (!shift) return;

    if (!confirm('Are you sure you want to delete this shift?')) return;

    logs = logs.filter((l) => l.id !== shiftId);
    saveLogs();
    renderAll();
    closeHistoryEditModal();
    showToast('Shift deleted');
  }

  // Setup Doctor's Office 1-5 Survey Buttons
  function initSurveyModal() {
    const container = document.getElementById('faces-chart-container');
    container.innerHTML = [1, 2, 3, 4, 5]
      .map((rating) => {
        const meta = MOOD_META[rating];
        return `
          <button class="face-option-btn" type="button" data-rating="${rating}" aria-label="Rate ${rating} out of 5: ${meta.label}">
            <span class="face-num mono" style="color: ${meta.color}">${rating}</span>
            ${getFaceSVG(rating, 40)}
            <span class="face-caption">${meta.label}</span>
          </button>
        `;
      })
      .join('');

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.face-option-btn');
      if (!btn) return;
      completeShiftWithRating(Number(btn.dataset.rating));
    });
  }

  // Navigation & Event Listeners
  function initEvents() {
    // Header date
    const now = new Date();
    document.getElementById('header-date-pill').textContent = now.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    // Bottom bar tabs
    const tabs = [
      { btn: 'nav-clock-btn', view: 'view-clock' },
      { btn: 'nav-history-btn', view: 'view-history' },
      { btn: 'nav-settings-btn', view: 'view-settings' }
    ];

    tabs.forEach(({ btn, view }) => {
      document.getElementById(btn).addEventListener('click', () => {
        tabs.forEach((t) => {
          document.getElementById(t.btn).classList.toggle('active', t.btn === btn);
          document.getElementById(t.view).classList.toggle('active', t.view === view);
        });
        if (view === 'view-history') renderHistoryView();
      });
    });

    // Clock toggle & cancel
    document.getElementById('clock-toggle-btn').addEventListener('click', handleClockToggle);
    document.getElementById('cancel-shift-btn').addEventListener('click', handleCancelShift);

    // Active start time editing
    document.getElementById('edit-active-start-btn').addEventListener('click', openActiveStartModal);
    document.getElementById('active-start-close-btn').addEventListener('click', closeActiveStartModal);
    document.getElementById('active-start-cancel-btn').addEventListener('click', closeActiveStartModal);
    document.getElementById('active-start-form').addEventListener('submit', handleActiveStartSubmit);
    document.getElementById('active-start-modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'active-start-modal-backdrop') closeActiveStartModal();
    });

    // History shift editing
    document.getElementById('history-edit-btn').addEventListener('click', () => openHistoryEditModal());
    document.getElementById('history-edit-close-btn').addEventListener('click', closeHistoryEditModal);
    document.getElementById('history-edit-cancel-btn').addEventListener('click', closeHistoryEditModal);
    document.getElementById('history-edit-shift-select').addEventListener('change', populateHistoryEditFields);
    document.getElementById('history-edit-start-input').addEventListener('input', updateHistoryEditDuration);
    document.getElementById('history-edit-end-input').addEventListener('input', updateHistoryEditDuration);
    document.getElementById('history-edit-form').addEventListener('submit', handleHistoryEditSubmit);
    document.getElementById('history-edit-delete-btn').addEventListener('click', handleHistoryDeleteShift);
    document.getElementById('history-edit-modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'history-edit-modal-backdrop') closeHistoryEditModal();
    });

    // Tap recent shift to edit
    document.getElementById('recent-logs-list').addEventListener('click', (e) => {
      const row = e.target.closest('.log-row[data-id]');
      if (row) openHistoryEditModal(row.dataset.id);
    });

    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeActiveStartModal();
        closeHistoryEditModal();
      }
    });

    // History subtabs (Month / Week)
    const subMonthBtn = document.getElementById('subtab-month-btn');
    const subWeekBtn = document.getElementById('subtab-week-btn');
    const monthPanel = document.getElementById('history-month-panel');
    const weekPanel = document.getElementById('history-week-panel');

    subMonthBtn.addEventListener('click', () => {
      currentHistorySubtab = 'month';
      subMonthBtn.classList.add('active');
      subWeekBtn.classList.remove('active');
      monthPanel.style.display = 'block';
      weekPanel.style.display = 'none';
      renderHistoryView();
    });

    subWeekBtn.addEventListener('click', () => {
      currentHistorySubtab = 'week';
      subWeekBtn.classList.add('active');
      subMonthBtn.classList.remove('active');
      weekPanel.style.display = 'block';
      monthPanel.style.display = 'none';
      renderHistoryView();
    });

    // Month prev/next
    document.getElementById('month-prev-btn').addEventListener('click', () => {
      viewedMonthDate.setMonth(viewedMonthDate.getMonth() - 1);
      renderHistoryView();
    });
    document.getElementById('month-next-btn').addEventListener('click', () => {
      viewedMonthDate.setMonth(viewedMonthDate.getMonth() + 1);
      renderHistoryView();
    });

    // Week prev/next
    document.getElementById('week-prev-btn').addEventListener('click', () => {
      viewedWeekStart.setDate(viewedWeekStart.getDate() - 7);
      renderHistoryView();
    });
    document.getElementById('week-next-btn').addEventListener('click', () => {
      viewedWeekStart.setDate(viewedWeekStart.getDate() + 7);
      renderHistoryView();
    });

    // Clicking a day in Month Calendar jumps to that week in Week Graph and selects the date
    document.getElementById('calendar-grid').addEventListener('click', (e) => {
      const cell = e.target.closest('.cal-day[data-date]');
      if (!cell) return;
      selectedHistoryDate = cell.dataset.date;
      const clickedDate = new Date(cell.dataset.date + 'T12:00:00');
      viewedWeekStart = getStartOfWeek(clickedDate);
      subWeekBtn.click();
    });

    // Settings actions
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
    const fileInput = document.getElementById('csv-file-input');
    document.getElementById('import-csv-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        importCSVFile(file);
        fileInput.value = '';
      }
    });

    document.getElementById('prefill-data-btn').addEventListener('click', () => {
      seedTestData(true);
    });

    document.getElementById('clear-data-btn').addEventListener('click', () => {
      logs = [];
      activeStartISO = null;
      pendingShift = null;
      localStorage.removeItem(STORAGE_KEYS.LOGS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_START);
      localStorage.removeItem(STORAGE_KEYS.PENDING_SHIFT);
      localStorage.setItem(STORAGE_KEYS.SEEDED, '1');
      renderAll();
      showToast('All shift data cleared');
    });

    // Refresh header date and live timestamp delta when returning from background on iOS
    const handleResume = () => {
      const curr = new Date();
      document.getElementById('header-date-pill').textContent = curr.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      activeStartISO = localStorage.getItem(STORAGE_KEYS.ACTIVE_START) || null;
      renderClockView();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleResume();
    });
    window.addEventListener('pageshow', handleResume);

    // Register Service Worker for offline PWA support
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  // Boot
  loadState();
  initSurveyModal();
  initEvents();
  renderAll();
  if (pendingShift) {
    openSurveyModal(pendingShift);
  }
})();
