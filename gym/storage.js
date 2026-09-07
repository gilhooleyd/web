/**
 * localStorage persistence + JSON/CSV export/import.
 * No Mithril, no model logic — just reading/writing plain data.
 */

const STORAGE_KEYS = {
  plans: 'gym.plans',
  sessions: 'gym.sessions',
  settings: 'gym.settings',
  activeSession: 'gym.activeSession',
};

const DEFAULT_SETTINGS = { unit: 'lb' };

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse ${key}:`, e);
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Storage = {
  loadPlans: () => loadJSON(STORAGE_KEYS.plans, []),
  savePlans: (plans) => saveJSON(STORAGE_KEYS.plans, plans),

  loadSessions: () => loadJSON(STORAGE_KEYS.sessions, []),
  saveSessions: (sessions) => saveJSON(STORAGE_KEYS.sessions, sessions),

  loadSettings: () => ({ ...DEFAULT_SETTINGS, ...loadJSON(STORAGE_KEYS.settings, {}) }),
  saveSettings: (settings) => saveJSON(STORAGE_KEYS.settings, settings),

  loadActiveSession: () => loadJSON(STORAGE_KEYS.activeSession, null),
  saveActiveSession: (session) => saveJSON(STORAGE_KEYS.activeSession, session),
  clearActiveSession: () => localStorage.removeItem(STORAGE_KEYS.activeSession),

  exportJSON: (plans, sessions, settings) => {
    const data = { plans, sessions, settings, exportedAt: new Date().toISOString() };
    downloadBlob(JSON.stringify(data, null, 2), 'application/json', `gym-export-${localDateStr(new Date())}.json`);
  },

  // Plans only, no logged history — for sharing/moving just the workout
  // structure (e.g. to another device or another person) without dragging
  // your training log along.
  exportPlansJSON: (plans) => {
    const data = { plans, exportedAt: new Date().toISOString() };
    downloadBlob(JSON.stringify(data, null, 2), 'application/json', `gym-plans-${localDateStr(new Date())}.json`);
  },

  exportCSV: (sessions, plans) => {
    const rows = [
      ['date', 'plan', 'workout', 'exercise', 'setIndex', 'weight', 'unit', 'reps', 'repRangeMin', 'repRangeMax'],
    ];
    sessions
      .filter((s) => s.finishedAt)
      .forEach((s) => {
        const plan = plans.find((p) => p.id === s.planId);
        const workout = plan && plan.workouts.find((w) => w.id === s.workoutId);
        (s.entries || []).forEach((entry) => {
          entry.sets.forEach((set, i) => {
            rows.push([
              s.date,
              plan ? plan.name : '(deleted plan)',
              workout ? workout.name : '(deleted workout)',
              entry.name,
              i + 1,
              set.weight,
              entry.unit,
              set.reps,
              entry.repRange ? entry.repRange.min : '',
              entry.repRange ? entry.repRange.max : '',
            ]);
          });
        });
      });
    downloadBlob(toCSV(rows), 'text/csv', `gym-history-${localDateStr(new Date())}.csv`);
  },

  importJSON: (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          resolve(JSON.parse(e.target.result));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    }),
};
