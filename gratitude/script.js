// Data Model
const GratitudeModel = {
  entries: [],
  isEditMode: false,
  fileHandle: null,
  fileKey: "gratitude",

  load: async () => {
    // First check if we have a linked file
    GratitudeModel.fileHandle = await LocalFileLinker.getStoredHandle(GratitudeModel.fileKey);
    if (GratitudeModel.fileHandle) {
        await GratitudeModel.loadFileFromHandle();
    }
    m.redraw();
  },

  loadFileFromHandle: async () => {
    const granted = await GratitudeModel.fileHandle.verifyPermission(true);
    if (!granted) {
      console.warn('Failed to grant permission');
      return;
    }
    const data = await GratitudeModel.fileHandle.read();
    if (!Array.isArray(data)) {
      console.warn('Linked file structure is invalid');
      await GratitudeModel.unlinkFile();
      return;
    }
    GratitudeModel.entries = data;
  },

  linkFile: async () => {
    const file = await LocalFileLinker.pickAndLinkFile(GratitudeModel.fileKey);
    if (!file) {
      console.warn('Failed to pickAndLinkFile');
      return;
    }
    GratitudeModel.fileHandle = file;
    await GratitudeModel.loadFileFromHandle();
    m.redraw();
  },


  unlinkFile: async () => {
    if (GratitudeModel.fileHandle) {
      await GratitudeModel.fileHandle.clear();
    }
    GratitudeModel.fileHandle = null;
    m.redraw();
  },

  save: async () => {
    if (GratitudeModel.fileHandle) {
      await GratitudeModel.fileHandle.write(GratitudeModel.entries);
    }
  },

  add: (text) => {
    if (!text.trim()) return;
    const maxId = GratitudeModel.entries.reduce((max, e) => Math.max(max, e.id), 0);
    const newEntry = {
      id: maxId + 1,
      text: text,
      timestamp: new Date().toISOString()
    };
    GratitudeModel.entries.push(newEntry);
    GratitudeModel.save();
  },

  update: (id, text) => {
    const entry = GratitudeModel.entries.find(e => e.id === id);
    if (entry) {
      entry.text = text;
      GratitudeModel.save();
    }
  },

  delete: (id) => {
    GratitudeModel.entries = GratitudeModel.entries.filter(e => e.id !== id);
    GratitudeModel.save();
  },

  toggleEditMode: () => {
    GratitudeModel.isEditMode = !GratitudeModel.isEditMode;
  },

  exportData: () => {
    const data = JSON.stringify(GratitudeModel.entries, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gratitude-data.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  getPastEntry: (daysAgo) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    const targetDateString = targetDate.toLocaleDateString();
    return GratitudeModel.entries.find(e => new Date(e.timestamp).toLocaleDateString() === targetDateString);
  },

  getPastEntryMonths: (monthsAgo) => {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() - monthsAgo);
    const targetDateString = targetDate.toLocaleDateString();
    return GratitudeModel.entries.find(e => new Date(e.timestamp).toLocaleDateString() === targetDateString);
  },

  getPastEntryYears: (yearsAgo) => {
    const targetDate = new Date();
    targetDate.setFullYear(targetDate.getFullYear() - yearsAgo);
    const targetDateString = targetDate.toLocaleDateString();
    return GratitudeModel.entries.find(e => new Date(e.timestamp).toLocaleDateString() === targetDateString);
  },

  getPostItColorClass: (id) => {
    return `color-${id % 5}`;
  }
};

// Components
const App = {
  newEntryText: '',

  oninit: GratitudeModel.load,

  view: () => {
    const sortedEntries = [...GratitudeModel.entries].sort((a, b) => b.id - a.id);
    const nextId = GratitudeModel.entries.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    const reminders = [
      { label: '7 days ago', entry: GratitudeModel.getPastEntry(7) },
      { label: '1 month ago', entry: GratitudeModel.getPastEntryMonths(1) },
      { label: '3 months ago', entry: GratitudeModel.getPastEntryMonths(3) },
      { label: '1 year ago', entry: GratitudeModel.getPastEntryYears(1) }
    ].filter(r => r.entry);

    return h(["div.container", [
      ["div.input-area", [
        [".input-grid", [
          [".post-it.input-post-it", {
            class: GratitudeModel.getPostItColorClass(nextId),
            onclick: (e) => {
              const el = e.currentTarget.querySelector('.entry-text');
              if (el) el.focus();
            }
          }, [
            ["span.entry-number", "What are you grateful for?"],
            [".post-it-content", [
              ["div.entry-text", {
                contenteditable: true,
                "data-placeholder": "Type here...",
                oninput: (e) => App.newEntryText = e.target.textContent,
                onkeydown: (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    GratitudeModel.add(App.newEntryText);
                    App.newEntryText = '';
                    e.target.textContent = '';
                  }
                },
                onupdate: (vnode) => {
                  if (App.newEntryText === "" && vnode.dom.textContent !== "") {
                    vnode.dom.textContent = "";
                  }
                }
              }]
            ]]
          ]]
        ]]
      ]],

      // Reminders.
      reminders.length > 0 ? ["section", [
        ["h2", "Reflections from the Past"],
        [".entries-grid", reminders.map(r => [".post-it", { 
          key: `reminder-${r.label}`,
          class: GratitudeModel.getPostItColorClass(r.entry.id)
        }, [
          ["span.entry-number", `#${r.entry.id} - ${r.label}`],
          [".post-it-content", [
            ["p.entry-text", r.entry.text]
          ]]
        ]])]
      ]] : null,

      // Full list.
      ["section", [
        ["h2", "Recent Gratitudes"],
        [".top-right", [
          // Link File Status Button
          (() => {
            if (!GratitudeModel.fileHandle) {
              return ["button.btn-secondary", {
                style: { marginRight: '0.5rem' },
                onclick: GratitudeModel.linkFile
              }, "Link File"];
            } else {
              return ["button.btn-secondary", {
                style: { marginRight: '0.5rem', backgroundColor: '#d4edda', borderColor: '#c3e6cb', color: '#155724' },
                title: 'Linked to local file. Click to unlink.',
                onclick: GratitudeModel.unlinkFile
              }, "✓ Linked"];
            }
          })(),
          ["button.btn-secondary", { 
            style: { marginRight: '0.5rem' },
            onclick: GratitudeModel.exportData 
          }, "Create File"],
          ["input[type=file]#import-input", {
            style: { display: 'none' },
            onchange: (e) => {
              if (e.target.files.length > 0) {
                GratitudeModel.importData(e.target.files[0]);
              }
            }
          }],
          ["button.edit-mode-toggle", { 
            onclick: GratitudeModel.toggleEditMode,
            class: GratitudeModel.isEditMode ? "btn-secondary" : "btn-primary"
          }, GratitudeModel.isEditMode ? "Done Editing" : "Edit"],
        ]],
        [".entries-grid", sortedEntries.map((entry) => {
          return [".post-it", { 
            key: entry.id,
            class: GratitudeModel.getPostItColorClass(entry.id)
          }, [
            ["span.entry-number", `#${entry.id}`],
            GratitudeModel.isEditMode ?
              ["button.btn-danger.top-right", { 
                onclick: (e) => {
                  e.stopPropagation();
                  GratitudeModel.delete(entry.id);
                }
              }, "Delete"] : null,
            [".post-it-content", [
              GratitudeModel.isEditMode ? 
                ["div.entry-text", {
                  contenteditable: true,
                  oninput: (e) => entry.text = e.target.textContent,
                  onblur: () => GratitudeModel.save(),
                  oncreate: (vnode) => vnode.dom.textContent = entry.text
                }] :
                ["p.entry-text", entry.text]
            ]],
          ]];
        })]
      ]]
    ]]);
  }
};

// Initialization
GratitudeModel.load();
m.mount(document.getElementById('app-mount'), App);
