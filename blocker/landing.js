document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const targetUrl = urlParams.get('url');
  const tabId = parseInt(urlParams.get('tabId'), 10);
  const domain = urlParams.get('domain');

  if (!targetUrl || isNaN(tabId) || !domain) {
    document.body.innerHTML = '<h1>Error: Missing parameters.</h1>';
    return;
  }

  document.getElementById('blocked-title').textContent = `${domain} is Blocked`;

  // Fetch stats from background
  chrome.runtime.sendMessage({ type: 'getStats', domain }, (stats) => {
    renderStats(stats, domain);
    renderWeeklyChart(stats.weekly);
    renderHeatmap(stats.yearly);
    setupBypass(stats, domain);
  });

  async function renderStats(stats, domain) {
    const todayStats = stats.today;
    document.getElementById('stat-attempts').textContent = todayStats.attempts;
    document.getElementById('stat-time-spent').textContent = formatTime(todayStats.timeSpent);
    
    // Set historical stats
    document.getElementById('stat-all-time').textContent = formatTime(stats.allTime || 0);
    document.getElementById('stat-last-month').textContent = formatTime(stats.lastMonthTime || 0);
    document.getElementById('stat-last-year').textContent = formatTime(stats.lastYearTime || 0);
    
    // Get limit
    const result = await chrome.storage.local.get({ settings: { blockedSites: {} } });
    const limitMins = result.settings.blockedSites[domain] || 0;
    document.getElementById('stat-time-limit').textContent = `${limitMins}m`;
    
    const timeSpentSecs = todayStats.timeSpent;
    const limitSecs = limitMins * 60;
    
    const statusMsg = document.getElementById('status-message');
    if (timeSpentSecs < limitSecs) {
      const timeLeft = limitSecs - timeSpentSecs;
      statusMsg.textContent = `You have ${formatTime(timeLeft)} left for this website today.`;
      statusMsg.style.color = '#28a745';
    } else {
      statusMsg.textContent = `You have reached your daily limit of ${limitMins} minutes.`;
      statusMsg.style.color = '#dc3545';
    }
  }

  async function setupBypass(stats, domain, showError = false) {
    const todayStats = stats.today;
    const bypassContainer = document.getElementById('bypass-container');
    bypassContainer.innerHTML = ''; // Clear container to prevent duplicate elements on rebuild
    
    const result = await chrome.storage.local.get({ settings: { blockedSites: {} } });
    const limitMins = result.settings.blockedSites[domain] || 0;
    const limitSecs = limitMins * 60;
    const timeSpentSecs = todayStats.timeSpent;

    if (timeSpentSecs < limitSecs) {
      // Time left - simple bypass
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Visit Site';
      btn.addEventListener('click', () => {
        proceedToSite(false);
      });
      bypassContainer.appendChild(btn);
    } else {
      // No time left - math challenge
      const challengeDiv = document.createElement('div');
      challengeDiv.className = 'math-challenge';
      
      const num1 = Math.floor(1000 + Math.random() * 9000); // 4-digit number (1000-9999)
      const num2 = Math.floor(1000 + Math.random() * 9000); // 4-digit number (1000-9999)
      const correctAnswer = num1 + num2;
      
      challengeDiv.innerHTML = `
        <div class="math-question">Solve to visit: ${num1} + ${num2} = ?</div>
        <input type="number" id="math-answer" class="math-input" placeholder="?" autofocus>
        <div id="math-error" style="color: red; margin-bottom: 10px; display: ${showError ? 'block' : 'none'};">Incorrect answer. Try again.</div>
        <button id="verify-btn" class="btn btn-warning">Verify & Visit</button>
      `;
      
      bypassContainer.appendChild(challengeDiv);
      
      document.getElementById('verify-btn').addEventListener('click', () => {
        const userAnswer = parseInt(document.getElementById('math-answer').value, 10);
        if (userAnswer === correctAnswer) {
          proceedToSite(true);
        } else {
          setupBypass(stats, domain, true); // Rebuild with error shown
        }
      });
    }
  }

  function proceedToSite(bypassedViaMath) {
    // Tell background to allow this tab
    chrome.runtime.sendMessage({ type: 'allowTab', tabId, domain, bypassedViaMath }, (response) => {
      if (response && response.success) {
        // Redirect to target URL
        window.location.href = targetUrl;
      }
    });
  }


  // Render weekly chart using HTML/CSS
  function renderWeeklyChart(weeklyData) {
    const container = document.getElementById('weekly-chart');
    const maxTime = Math.max(...weeklyData.map(d => d.timeSpent), 60);
    container.innerHTML = weeklyData.map(day => `
      <div class="chart-bar-container">
        <div class="chart-value">${day.timeSpent > 0 ? formatTimeShort(day.timeSpent) : ''}</div>
        <div class="chart-bar" style="height: ${(day.timeSpent / maxTime) * 70}%"></div>
        <div class="chart-label">${day.dayName}</div>
      </div>
    `).join('');
  }

  function formatTimeShort(seconds) {
    const mins = Math.round(seconds / 60);
    return `${mins}m`;
  }

  // Render GitHub-style Heatmap
  function renderHeatmap(yearlyStats) {
    const heatmapContainer = document.getElementById('heatmap');
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const startDay = startOfYear.getDay();
    const startDate = new Date(startOfYear);
    startDate.setDate(startOfYear.getDate() - startDay);
    
    const totalWeeks = 53;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let lastMonth = -1;
    const htmlParts = [];

    for (let w = 0; w < totalWeeks; w++) {
      const sunday = new Date(startDate);
      sunday.setDate(startDate.getDate() + w * 7);
      
      const currentMonth = sunday.getMonth();
      if (currentMonth !== lastMonth) {
        let labelText = months[currentMonth];
        if (w === 0 && currentMonth === 11) {
          const temp = new Date(sunday);
          temp.setDate(temp.getDate() + 6);
          labelText = temp.getFullYear() === today.getFullYear() ? 'Jan' : '';
          if (labelText === 'Jan') lastMonth = 0;
        } else {
          lastMonth = currentMonth;
        }

        if (labelText) {
          htmlParts.push(`<div class="heatmap-month-label" style="grid-row: 1; grid-column: ${w + 1}">${labelText}</div>`);
        }
      }

      for (let d = 0; d < 7; d++) {
        const currentDate = new Date(sunday);
        currentDate.setDate(sunday.getDate() + d);
        const dateStr = formatDate(currentDate);
        const timeSpent = yearlyStats[dateStr] || 0;
        
        htmlParts.push(`
          <div class="heatmap-day level-${getIntensityLevel(timeSpent)}" 
               data-date="${dateStr}" 
               data-time="${formatTime(timeSpent)}" 
               style="grid-row: ${d + 2}; grid-column: ${w + 1}">
          </div>
        `);
      }
    }
    heatmapContainer.innerHTML = htmlParts.join('');
  }

  function getIntensityLevel(seconds) {
    if (seconds === 0) return 0;
    if (seconds <= 5 * 60) return 1;    // <= 5 mins
    if (seconds <= 15 * 60) return 2;   // <= 15 mins
    if (seconds <= 30 * 60) return 3;   // <= 30 mins
    return 4;                           // > 30 mins
  }

});
