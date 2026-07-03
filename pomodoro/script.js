// Web Audio API Alarm System
let prewarmedAudioCtx = null;

function prewarmAudio() {
  try {
    if (!prewarmedAudioCtx) {
      prewarmedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Play silent click to unlock
      const buffer = prewarmedAudioCtx.createBuffer(1, 1, 22050);
      const source = prewarmedAudioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(prewarmedAudioCtx.destination);
      source.start(0);
    }
    if (prewarmedAudioCtx.state === 'suspended') {
      prewarmedAudioCtx.resume();
    }
  } catch (e) {
    console.error("Audio context prewarming failed:", e);
  }
}

function playAlarm() {
  try {
    const audioCtx = prewarmedAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    let startTime = audioCtx.currentTime;
    
    function beep(time, freq, duration) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.3, time + 0.02);
      gain.gain.setValueAtTime(0.3, time + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0, time + duration);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(time);
      osc.stop(time + duration);
    }
    
    // Multi-beep pattern
    for (let i = 0; i < 4; i++) {
      let groupStart = startTime + i * 0.8;
      beep(groupStart, 880, 0.12);
      beep(groupStart + 0.15, 880, 0.12);
      beep(groupStart + 0.3, 1200, 0.25);
    }
  } catch (e) {
    console.error("Web Audio API play alarm failed:", e);
  }
}

// Heatmap shared adapter
function renderHeatmap(pomodoros) {
  if (typeof SharedHeatmap !== 'undefined') {
    return SharedHeatmap.render(pomodoros, { timestampField: 'started' });
  }
  return ["div", "Heatmap renderer not loaded."];
}

// Model for storing and updating the Pomodoro JSON data
class PomodoroModel {
  constructor(fileHandle, store) {
    this.fileHandle = fileHandle;
    this.projects = store.projects || [];
    this.tags = store.tags || [];
    this.data = store.data || [];
  }

  static async create(fileHandle) {
    const store = await fileHandle.read();
    if (!store || !Array.isArray(store.data)) {
      console.warn('Linked file structure invalid, re-initializing');
      const validStore = {
        projects: store?.projects || [],
        tags: store?.tags || [],
        data: Array.isArray(store?.data) ? store.data : []
      };
      await fileHandle.write(validStore);
      return new PomodoroModel(fileHandle, validStore);
    }
    return new PomodoroModel(fileHandle, store);
  }

  async save() {
    if (this.fileHandle) {
      await this.fileHandle.write({
        projects: this.projects,
        tags: this.tags,
        data: this.data
      });
    }
  }

  add(pomodoro) {
    this.data.push(pomodoro);

    if (pomodoro.project && !this.projects.includes(pomodoro.project)) {
      this.projects.push(pomodoro.project);
    }

    if (Array.isArray(pomodoro.tags)) {
      pomodoro.tags.forEach(tag => {
        if (tag && !this.tags.includes(tag)) {
          this.tags.push(tag);
        }
      });
    }

    this.save();
    m.redraw();
  }

  delete(startedTime) {
    this.data = this.data.filter(p => p.started !== startedTime);
    this.save();
    m.redraw();
  }
}

// Main App Configuration
const App = {
  // State
  fileHandle: null,
  pomodoroModel: null,
  fileKey: "pomodoro",

  // Form Input state
  title: '',
  project: '',
  tagsString: '',
  info: '',

  // Timer State
  timeLeft: 1500, // 25 minutes default
  timerDuration: 1500,
  timerState: 'idle', // idle, running, paused
  timerInterval: null,
  timerStartTime: null,
  timerPausedElapsed: 0,

  // Filter State
  filterProject: '',
  filterTag: '',
  filterText: '',

  // UI States
  showCompletionModal: false,
  showStatsSidebar: false,

  // Bulk Edit States
  isEditingAll: false,
  editStates: {},

  // Init
  oninit: async () => {
    App.fileHandle = await LocalFileLinker.getStoredHandle(App.fileKey);
    if (App.fileHandle) {
      await App.loadFile();
    }
    m.redraw();
  },

  loadFile: async () => {
    const granted = await App.fileHandle.verifyPermission(true);
    if (!granted) {
      console.warn('Failed to grant permission');
      return false;
    }
    App.pomodoroModel = await PomodoroModel.create(App.fileHandle);
    m.redraw();
  },

  linkFile: async () => {
    const file = await LocalFileLinker.pickAndLinkFile(App.fileKey);
    if (!file) {
      console.warn('Failed to pickAndLinkFile');
      return;
    }
    App.fileHandle = file;
    App.loadFile();
  },

  createFile: async () => {
    const file = await LocalFileLinker.createAndLinkFile('pomodoro-data.json', App.fileKey);
    if (!file) {
      console.warn('Failed to createAndLinkFile');
      return;
    }
    await file.write({
      projects: [],
      tags: [],
      data: []
    });
    App.fileHandle = file;
    App.loadFile();
  },

  unlinkFile: async () => {
    if (App.fileHandle) {
      await App.fileHandle.clear();
    }
    App.fileHandle = null;
    App.pomodoroModel = null;
    m.redraw();
  },

  // Timer Methods
  selectPreset: (seconds) => {
    if (App.timerState === 'running') return;
    App.timerDuration = seconds;
    App.timeLeft = seconds;
    App.timerPausedElapsed = 0;
    m.redraw();
  },

  startTimer: () => {
    if (App.timerState === 'running') return;
    
    prewarmAudio();
    App.timerState = 'running';
    App.timerStartTime = Date.now() - (App.timerPausedElapsed * 1000);
    
    App.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - App.timerStartTime) / 1000);
      App.timeLeft = Math.max(0, App.timerDuration - elapsed);
      
      if (App.timeLeft <= 0) {
        App.completeTimer();
      }
      m.redraw();
    }, 100);
  },

  pauseTimer: () => {
    if (App.timerState !== 'running') return;
    App.timerState = 'paused';
    clearInterval(App.timerInterval);
    App.timerPausedElapsed = Math.floor((Date.now() - App.timerStartTime) / 1000);
    m.redraw();
  },

  resetTimer: () => {
    App.timerState = 'idle';
    clearInterval(App.timerInterval);
    App.timerPausedElapsed = 0;
    App.timeLeft = App.timerDuration;
    m.redraw();
  },

  completeTimer: () => {
    App.timerState = 'idle';
    clearInterval(App.timerInterval);
    App.timerPausedElapsed = 0;
    App.timeLeft = App.timerDuration;

    // Play audio alarm
    playAlarm();

    // Save Pomodoro record
    const tags = App.tagsString
      .split(',')
      .map(t => t.trim())
      .filter(t => t !== '');

    const newPomodoro = {
      title: App.title.trim() || 'Unnamed Pomodoro',
      project: App.project.trim() || 'General',
      tags: tags,
      info: App.info.trim(),
      started: new Date().toISOString()
    };

    if (App.pomodoroModel) {
      App.pomodoroModel.add(newPomodoro);
    }

    // Show completion modal
    App.showCompletionModal = true;

    // Reset inputs for the next one
    App.title = '';
    // Keep project and tags to make next input easier, but clear info
    App.info = '';
    m.redraw();
  },

  // Bulk Editing Methods
  startBulkEdit: (filteredPoms) => {
    App.isEditingAll = true;
    App.editStates = {};
    filteredPoms.forEach(p => {
      App.editStates[p.started] = {
        title: p.title,
        project: p.project || 'General',
        tagsString: (p.tags || []).join(', '),
        info: p.info || ''
      };
    });
    m.redraw();
  },

  saveBulkEdit: () => {
    App.pomodoroModel.data.forEach(p => {
      const editState = App.editStates[p.started];
      if (editState) {
        p.title = editState.title.trim() || 'Unnamed Pomodoro';
        p.project = editState.project.trim() || 'General';
        p.tags = editState.tagsString
          .split(',')
          .map(t => t.trim())
          .filter(t => t !== '');
        p.info = editState.info.trim();
        
        // Update Autocompletes if new
        if (p.project && !App.pomodoroModel.projects.includes(p.project)) {
          App.pomodoroModel.projects.push(p.project);
        }
        p.tags.forEach(tag => {
          if (tag && !App.pomodoroModel.tags.includes(tag)) {
            App.pomodoroModel.tags.push(tag);
          }
        });
      }
    });
    App.pomodoroModel.save();
    App.isEditingAll = false;
    App.editStates = {};
    m.redraw();
  },

  deleteDuringBulkEdit: (startedTime) => {
    if (confirm("Are you sure you want to delete this focus log?")) {
      App.pomodoroModel.delete(startedTime);
      delete App.editStates[startedTime];
    }
  },

  // Render Helper
  formatTime: (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  // View Layout
  view: () => {
    // If no file has been linked/created yet, show the setup screen
    if (!App.pomodoroModel) {
      return h(["div.container.centered-container", [
        ["h1", "Pomodoro Timer Dashboard"],
        ["p", "Manage and visualize your pomodoro focus sessions with stats, heatmaps, and custom project logs."],
        App.fileHandle ?
          ["button.btn-primary", { onclick: App.loadFile }, "Open Linked File"] :
          ["div.button-group", [
            ["button.btn-primary", { onclick: App.linkFile }, "Link Existing File"],
            ["button.btn-secondary", { onclick: App.createFile }, "Create New File"]
          ]]
      ]]);
    }

    const pm = App.pomodoroModel;
    const stats = getStats(pm.data);

    // Apply filters to previous pomodoros
    const filteredPomodoros = [...pm.data]
      .reverse() // Most recent first
      .filter(p => {
        if (App.filterProject && p.project !== App.filterProject) return false;
        if (App.filterTag && (!p.tags || !p.tags.includes(App.filterTag))) return false;
        if (App.filterText) {
          const query = App.filterText.toLowerCase();
          const inTitle = p.title && p.title.toLowerCase().includes(query);
          const inInfo = p.info && p.info.toLowerCase().includes(query);
          if (!inTitle && !inInfo) return false;
        }
        return true;
      });

    // Group and index our pomodoros chronologically by day
    const { groups, order } = getGroupedPomodoros(filteredPomodoros, pm.data);

    // Get unique projects and tags actually saved in completed list for filters
    const uniqueProjects = Array.from(new Set(pm.data.map(p => p.project || 'General')));
    const uniqueTags = Array.from(new Set(pm.data.flatMap(p => p.tags || [])));

    return h(["div.container", [
      // Header
      ["div.nav-container", [
        ["h1", "Pomodoro Dashboard"],
        ["div", [
          ["button", {
            style: { backgroundColor: '#2196f3', color: 'white', fontWeight: 'bold', marginRight: '0.5rem' },
            onclick: () => App.showStatsSidebar = true
          }, "📊 View Stats"],
          ["button", {
            style: { backgroundColor: '#ffeef0', color: '#d73a49', fontWeight: 'bold' },
            title: `Linked: ${App.fileHandle.fileHandle.name}. Click to unlink.`,
            onclick: App.unlinkFile
          }, "✓ Linked"]
        ]]
      ]],

      // Core Dashboard
      ["div.timer-dashboard", [
        // Timer Card
        ["div.timer-card", [
          ["div.timer-display", App.formatTime(App.timeLeft)],
          
          ["div.timer-controls", [
            App.timerState === 'running' ?
              ["button.btn-warning", { onclick: App.pauseTimer }, "Pause"] :
              ["button.btn-success", { onclick: App.startTimer }, "Start"],
            ["button.btn-success", {
              onclick: App.completeTimer,
              disabled: App.timerState === 'idle',
              style: { marginLeft: '0.5rem', marginRight: '0.5rem' }
            }, "Finish"],
            ["button.btn-danger", { onclick: App.resetTimer }, "Reset"]
          ]],

          ["div.timer-presets", [
            ["button", { onclick: () => App.selectPreset(1500), disabled: App.timerState === 'running' }, "25m"],
            ["button", { onclick: () => App.selectPreset(300), disabled: App.timerState === 'running' }, "5m"],
            ["button", { onclick: () => App.selectPreset(900), disabled: App.timerState === 'running' }, "15m"],
            ["button", { onclick: () => App.selectPreset(5), disabled: App.timerState === 'running' }, "5s"]
          ]]
        ]],

        // Form Input Card
        ["div.form-card", [
          ["div.form-row", { style: { display: 'flex', gap: '1rem', marginBottom: '1.25rem' } }, [
            ["div.form-group", { style: { flex: 1, marginBottom: 0 } }, [
              ["input[type=text]", {
                placeholder: "Project",
                value: App.project,
                list: "projects-list",
                oninput: (e) => App.project = e.target.value
              }],
              ["datalist#projects-list", pm.projects.map(p => ["option", { value: p }])]
            ]],
            ["div.form-group", { style: { flex: 1, marginBottom: 0 } }, [
              ["input[type=text]", {
                placeholder: "Tags",
                value: App.tagsString,
                list: "tags-list",
                oninput: (e) => App.tagsString = e.target.value
              }],
              ["datalist#tags-list", pm.tags.map(t => ["option", { value: t }])],
            ]]
          ]],

          ["div.form-group", [
            ["input[type=text]", {
              placeholder: "Title",
              value: App.title,
              oninput: (e) => App.title = e.target.value
            }]
          ]],

          ["div.form-group", [
            ["textarea", {
              placeholder: "Notes (Markdown supported)",
              value: App.info,
              oninput: (e) => App.info = e.target.value
            }]
          ]]
        ]]
      ]],

      ["hr"],

      // Grouped Completed Sessions Feed
      ["div.feed-section", [
        ["div.feed-header", [
          ["div", { style: { display: 'flex', alignItems: 'center', gap: '1rem' } }, [
            ["h2", `Completed Sessions (${filteredPomodoros.length})`],
            filteredPomodoros.length > 0 ? (
              App.isEditingAll ?
                ["button.btn-success", { onclick: App.saveBulkEdit }, "Save Changes"] :
                ["button", { onclick: () => App.startBulkEdit(filteredPomodoros) }, "Edit All"]
            ) : null
          ]],
          
          ["div.filter-controls", [
            // Project Filter
            ["select", {
              value: App.filterProject,
              onchange: (e) => App.filterProject = e.target.value
            }, [
              ["option", { value: '' }, "All Projects"],
              uniqueProjects.map(p => ["option", { value: p }, p])
            ]],

            // Tag Filter
            ["select", {
              value: App.filterTag,
              onchange: (e) => App.filterTag = e.target.value
            }, [
              ["option", { value: '' }, "All Tags"],
              uniqueTags.map(t => ["option", { value: t }, t])
            ]],

            // Text Filter
            ["input[type=text]", {
              placeholder: "Search title/notes...",
              value: App.filterText,
              oninput: (e) => App.filterText = e.target.value
            }],

            // Clear Button
            (App.filterProject || App.filterTag || App.filterText) ?
              ["button", {
                style: { padding: '0.3rem 0.6rem', fontSize: '0.8rem', background: '#edf2f7' },
                onclick: () => {
                  App.filterProject = '';
                  App.filterTag = '';
                  App.filterText = '';
                }
              }, "Clear Filters"] : null
          ]]
        ]],

        // Grouped Feed List
        ["div.feed-list", order.length === 0 ?
          [["div.empty-state", "No pomodoros matching the active filters."]] :
          order.map(dateKey => {
            const dayPoms = groups[dateKey];
            return ["div.feed-day-group", { key: dateKey }, [
              ["h3", { key: dateKey + "-header", style: { marginTop: '2.5rem', borderBottom: '2px solid #0066cc', paddingBottom: '0.4rem', color: '#0066cc', fontSize: '1.2rem' } }, dateKey],
              dayPoms.map(p => {
                const startTime = new Date(p.started).toLocaleTimeString(undefined, {
                  hour: '2-digit', minute: '2-digit'
                });

                if (App.isEditingAll) {
                  const editState = App.editStates[p.started];
                  if (editState) {
                    return ["div.feed-item", { key: p.started, style: { borderLeft: '4px solid #0066cc', background: '#f0f8ff' } }, [
                      ["div.top-right-btn", [
                        ["button.btn-danger", {
                          style: { padding: '0.15rem 0.4rem', fontSize: '0.75rem' },
                          onclick: () => App.deleteDuringBulkEdit(p.started)
                        }, "Delete"]
                      ]],
                      ["h4", { style: { margin: '0 0 1rem 0' } }, `Editing: ${p.dayIndex} - ${startTime}`],
                      ["div.form-group", [
                        ["label", "Title"],
                        ["input[type=text]", {
                          value: editState.title,
                          oninput: (e) => editState.title = e.target.value
                        }]
                      ]],
                      ["div.form-row", { style: { display: 'flex', gap: '1rem', marginBottom: '1.25rem' } }, [
                        ["div.form-group", { style: { flex: 1, marginBottom: 0 } }, [
                          ["label", "Project"],
                          ["input[type=text]", {
                            value: editState.project,
                            list: "projects-list",
                            oninput: (e) => editState.project = e.target.value
                          }]
                        ]],
                        ["div.form-group", { style: { flex: 1, marginBottom: 0 } }, [
                          ["label", "Tags"],
                          ["input[type=text]", {
                            value: editState.tagsString,
                            list: "tags-list",
                            oninput: (e) => editState.tagsString = e.target.value
                          }]
                        ]]
                      ]],
                      ["div.form-group", [
                        ["label", "Notes (Markdown)"],
                        ["textarea", {
                          style: { minHeight: '80px' },
                          value: editState.info,
                          oninput: (e) => editState.info = e.target.value
                        }]
                      ]]
                    ]];
                  }
                }

                // Standard item view: Inline tags, pre-fixed absolute count, start time meta.
                return ["div.feed-item", { key: p.started }, [
                  ["div.feed-item-header", [
                    ["h3.feed-item-title", [
                      `${p.dayIndex} - ${startTime} - ${p.title}`,
                      ["span.badge.badge-project", { style: { marginLeft: '0.75rem', verticalAlign: 'middle' } }, p.project || 'General'],
                      (p.tags || []).map(tag => ["span.badge.badge-tag", { style: { marginLeft: '0.5rem', verticalAlign: 'middle' } }, tag])
                    ]]
                  ]],

                  p.info ? 
                    ["div.feed-item-info", m.trust(snarkdown(p.info))] : null
                ]];
              })
            ]];
          })
        ]
      ]],

      // Completion Dialog Modal
      App.showCompletionModal ? ["div.modal-backdrop", [
        ["div.modal-content", [
          ["span", { style: { fontSize: '4rem' } }, "🎉"],
          ["h3", "Focus Session Finished!"],
          ["p", "Awesome work! You have successfully completed your focused Pomodoro block. Take a short rest, stretch, hydrate, and relax before starting the next block!"],
          ["button.btn-success", {
            style: { width: '100%' },
            onclick: () => {
              App.showCompletionModal = false;
            }
          }, "Let's Rest"]
        ]]
      ]] : null,

      // Slide-over Stats Sidebar
      App.showStatsSidebar ? ["div.sidebar-backdrop", {
        onclick: (e) => {
          if (e.target.className === 'sidebar-backdrop') {
            App.showStatsSidebar = false;
          }
        }
      }, [
        ["div.sidebar-content", [
          ["div.sidebar-header", [
            ["h2", "📊 Focus Stats & Insights"],
            ["button", {
              style: { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#777' },
              onclick: () => App.showStatsSidebar = false
            }, "✕"]
          ]],

          // Activity Heatmap (rendered dynamically using our shared helper module!)
          ["div.heatmap-card", { style: { padding: '1rem', border: '1px solid #eee', borderRadius: '8px', marginBottom: '2rem' } }, [
            ["div.heatmap-header", [
              ["h4", { style: { margin: '0 0 0.75rem 0' } }, "Activity Heatmap"]
            ]],
            renderHeatmap(pm.data)
          ]],

          // Focus Stats Cards
          ["div.stat-summary-card", { style: { marginBottom: '2rem', border: '1px solid #eee', borderRadius: '8px', padding: '1.25rem' } }, [
            ["h3", { style: { margin: '0 0 1rem 0', color: '#0066cc' } }, "Session Summaries"],
            ["div.stat-box", [
              ["span", "Total Completed Sessions"],
              ["span.stat-val", stats.total]
            ]],
            ["div.stat-box", [
              ["span", "This Week's Sessions"],
              ["span.stat-val", stats.thisWeek]
            ]],
            ["div.stat-box", [
              ["span", "Total Focus Time"],
              ["span.stat-val", `${stats.total * 25} mins`]
            ]]
          ]],

          // Project breakdown stats table
          ["div.stat-breakdown-card", { style: { border: '1px solid #eee', borderRadius: '8px', padding: '1.25rem' } }, [
            ["h3", { style: { margin: '0 0 1rem 0', color: '#0066cc' } }, "Breakdown By Project"],
            ["div", { style: { maxHeight: '280px', overflowY: 'auto' } }, [
              ["table.breakdown-table", [
                ["thead", [
                  ["tr", [
                    ["th", "Project"],
                    ["th", "Total Poms"],
                    ["th", "This Week"]
                  ]]
                ]],
                ["tbody", Object.keys(stats.totalByProject).length === 0 ?
                  [["tr", [["td[colspan=3]", { style: { textAlign: 'center', color: '#999' } }, "No logged pomodoros yet."]]]] :
                  Object.keys(stats.totalByProject).map(proj => ["tr", [
                    ["td", proj],
                    ["td", stats.totalByProject[proj]],
                    ["td", stats.thisWeekByProject[proj] || 0]
                  ]])
                ]
              ]]
            ]]
          ]]
        ]]
      ]] : null
    ]]);
  }
};

// Helper: calculate stats
function getStats(pomodoros) {
  const stats = {
    total: pomodoros.length,
    totalByProject: {},
    thisWeek: 0,
    thisWeekByProject: {}
  };

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Align to Sunday

  pomodoros.forEach(p => {
    const proj = p.project || 'General';
    stats.totalByProject[proj] = (stats.totalByProject[proj] || 0) + 1;

    if (p.started) {
      const date = new Date(p.started);
      if (date >= startOfWeek) {
        stats.thisWeek++;
        stats.thisWeekByProject[proj] = (stats.thisWeekByProject[proj] || 0) + 1;
      }
    }
  });

  return stats;
}

// Helper: Group and index pomodoros chronologically by day
function getGroupedPomodoros(filteredPoms, allPoms) {
  const dayCounts = {}; // dateKey -> absolute count on that day

  const getDayKey = (isoStr) => {
    const d = new Date(isoStr);
    // Format: "June 01 - Monday"
    const month = d.toLocaleString('default', { month: 'long' });
    const day = String(d.getDate()).padStart(2, '0');
    const weekday = d.toLocaleString('default', { weekday: 'long' });
    return `${month} ${day} - ${weekday}`;
  };

  // Sort ALL completed pomodoros chronologically to assign consistent 1-based count numbers
  const sortedAll = [...allPoms].sort((a, b) => new Date(a.started) - new Date(b.started));
  const pomWithIndex = sortedAll.map(p => {
    const dateKey = getDayKey(p.started);
    dayCounts[dateKey] = (dayCounts[dateKey] || 0) + 1;
    return {
      ...p,
      dateKey: dateKey,
      dayIndex: dayCounts[dateKey]
    };
  });

  // Filter these index-assigned pomodoros using active filters
  const filteredIds = new Set(filteredPoms.map(p => p.started));
  const filteredIndexed = pomWithIndex.filter(p => filteredIds.has(p.started));

  // Group by day key in reverse chronological order (newest days first)
  const groups = {};
  const dateKeysOrder = [];

  for (let i = filteredIndexed.length - 1; i >= 0; i--) {
    const p = filteredIndexed[i];
    if (!groups[p.dateKey]) {
      groups[p.dateKey] = [];
      dateKeysOrder.push(p.dateKey);
    }
    groups[p.dateKey].push(p);
  }

  return { groups, order: dateKeysOrder };
}

m.mount(document.getElementById('app-mount'), App);
