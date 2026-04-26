const today = new Date();
const formattedDate = today.toLocaleDateString();

// Results State & Component
const Results = {
  data: [],

  load: () => {
    Results.data = JSON.parse(localStorage.getItem('wimHofResults') || '[]');
  },

  add: (date, rounds) => {
    Results.data.push({ date, rounds });
    localStorage.setItem('wimHofResults', JSON.stringify(Results.data));
  },

  clear: () => {
    Results.data = [];
    localStorage.setItem('wimHofResults', JSON.stringify([]));
  },

  getStats: () => {
    let totalSeconds = 0;
    const activeDates = new Set();

    Results.data.forEach(r => {
      activeDates.add(r.date);
      r.rounds.forEach(round => {
        const [m, s] = round.split(':').map(Number);
        totalSeconds += (m * 60) + s;
      });
    });

    // Calculate Streak
    let streak = 0;
    const checkDate = new Date();
    // If no activity today, check starting from yesterday
    if (!activeDates.has(checkDate.toLocaleDateString())) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (activeDates.has(checkDate.toLocaleDateString())) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // Format Total Time
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const totalTime = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;

    return { totalTime, streak };
  },

  view: () => {
    return h(["section", [
      ["h2", "History"],
      ["button#clearBtn", { onclick: Results.clear }, "Clear History"],
      ["table#resultsTable", [
        ["thead", [
          ["tr", [
            ["th", "Date"],
            ["th", "Round 1"],
            ["th", "Round 2"],
            ["th", "Round 3"],
          ]]
        ]],
        ["tbody", Results.data.slice().reverse().map(result => {
          return ["tr", [
            ["td", result.date],
            result.rounds.map(round => ["td", round])
          ]];
        })],
      ]],
    ]]);
  }
};

// Heatmap Component
const Heatmap = {
  getYearData: () => {
    const activeDates = new Set(Results.data.map(r => r.date));
    const now = new Date();
    const year = now.getFullYear();

    const start = new Date(year, 0, 1);
    start.setDate(start.getDate() - start.getDay());

    const end = new Date(year, 11, 31);
    end.setDate(end.getDate() + (6 - end.getDay()));

    const days = [];
    const monthLabels = [];
    let currentMonth = -1;

    const temp = new Date(start);
    let dayCount = 0;

    while (temp <= end) {
      const dateStr = temp.toLocaleDateString();
      days.push({
        date: dateStr,
        active: activeDates.has(dateStr),
        month: temp.getMonth()
      });

      if (temp.getMonth() !== currentMonth && temp.getDay() === 0 && temp.getFullYear() === year) {
        const monthName = temp.toLocaleString('default', { month: 'short' });
        monthLabels.push({
          name: monthName,
          index: Math.floor(dayCount / 7)
        });
        currentMonth = temp.getMonth();
      }

      temp.setDate(temp.getDate() + 1);
      dayCount++;
    }

    return { year, days, monthLabels };
  },

  view: () => {
    const { year, days, monthLabels } = Heatmap.getYearData();
    const { totalTime, streak } = Results.getStats();

    return h(["section", [
      [".heatmap-header", [
        ["h2", "Activity Stats"],
        ["span.heatmap-year", year]
      ]],
      [".stats-prominent", [
        [".stat-card", [
          [".stat-label", "Total time"],
          [".stat-value", totalTime]
        ]],
        [".stat-card", [
          [".stat-label", "Current streak"],
          [".stat-value", `${streak} days`],
        ]]
      ]],
      [".heatmap-container", [
        [".heatmap-months", { style: { gridTemplateColumns: `repeat(${Math.ceil(days.length / 7)}, 10px)` } }, 
          monthLabels.map(mLabel => ["span.heatmap-month-label", {
            style: { gridColumnStart: mLabel.index + 1 }
          }, mLabel.name])
        ],
        [".heatmap-grid", days.map(day => {
          return [".heatmap-day", {
            class: day.active ? "active" : "",
            title: day.date
          }];
        })]
      ]]
    ]]);
  }
};

// Timer State & Component
const Timer = {
  seconds: 0,
  isRunning: false,
  interval: null,
  rounds: [],
  currentRound: 1,

  start: () => {
    if (!Timer.isRunning) {
      Timer.isRunning = true;
      Timer.interval = setInterval(() => {
        Timer.seconds++;
        m.redraw();
      }, 1000);
    }
  },

  stop: () => {
    if (Timer.isRunning) {
      clearInterval(Timer.interval);
      Timer.isRunning = false;

      Timer.rounds.push(formatTime(Timer.seconds));
      Timer.currentRound += 1;

      if (Timer.currentRound === 4) {
        Timer.currentRound = 1;
        Results.add(formattedDate, Timer.rounds);
        Timer.rounds = [];
      }
      Timer.seconds = 0;
    }
  },

  finish: () => {
    clearInterval(Timer.interval);
    Timer.isRunning = false;
    if (Timer.rounds.length > 0 || Timer.seconds > 0) {
      if (Timer.seconds > 0) {
        Timer.rounds.push(formatTime(Timer.seconds));
      }
      Results.add(formattedDate, Timer.rounds);
    }
    Timer.rounds = [];
    Timer.seconds = 0;
    Timer.currentRound = 1;
  },

  view: () => {
    return h(["section", [
      ["h2", "Breath Hold Timer"],
      ["p.round-indicator", `Round ${Timer.currentRound}`],
      ["span#timer.timer-display", formatTime(Timer.seconds)],
      ["nav", [
        ["button#startBtn", {
          onclick: Timer.start,
          disabled: Timer.isRunning
        }, "Start"],
        ["button#stopBtn", {
          onclick: Timer.stop,
          disabled: !Timer.isRunning
        }, "Stop"],
        ["button#finishBtn", {
          onclick: Timer.finish
        }, "Finish"]
      ]]
    ]]);
  }
};

// Helper Functions
function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Initialization
Results.load();
m.mount(document.getElementById('heatmap-mount'), Heatmap);
m.mount(document.getElementById('timer-mount'), Timer);
m.mount(document.getElementById('results-mount'), Results);
