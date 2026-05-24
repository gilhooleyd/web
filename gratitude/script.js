class GratitudeModel {
  constructor(fileHandle, entries) {
    this.fileHandle = fileHandle;
    this.entries = entries;
    this.isEditMode = false;
  }

  static async create(fileHandle) {
    const entries = await fileHandle.read();
    if (!Array.isArray(entries)) {
      console.warn('Linked file structure is invalid');
      return null;
    }
    return new GratitudeModel(fileHandle, entries);
  }

  async save() {
    if (this.fileHandle) {
      await this.fileHandle.write(this.entries);
    }
  }

  add(text) {
    if (!text.trim()) return;
    const maxId = this.entries.reduce((max, e) => Math.max(max, e.id), 0);
    const newEntry = {
      id: maxId + 1,
      text: text,
      timestamp: new Date().toISOString()
    };
    this.entries.push(newEntry);
    this.save();
  }

  update(id, text) {
    const entry = this.entries.find(e => e.id === id);
    if (entry) {
      entry.text = text;
      this.save();
    }
  }

  delete(id) {
    this.entries = this.entries.filter(e => e.id !== id);
    this.save();
  }

  toggleEditMode() {
    this.isEditMode = !this.isEditMode;
    m.redraw();
  }

  getPastEntry(daysAgo) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    const targetDateString = targetDate.toLocaleDateString();
    return this.entries.find(e => new Date(e.timestamp).toLocaleDateString() === targetDateString);
  }

  getPastEntryMonths(monthsAgo) {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() - monthsAgo);
    const targetDateString = targetDate.toLocaleDateString();
    return this.entries.find(e => new Date(e.timestamp).toLocaleDateString() === targetDateString);
  }

  getPastEntryYears(yearsAgo) {
    const targetDate = new Date();
    targetDate.setFullYear(targetDate.getFullYear() - yearsAgo);
    const targetDateString = targetDate.toLocaleDateString();
    return this.entries.find(e => new Date(e.timestamp).toLocaleDateString() === targetDateString);
  }

  getPostItColorClass(id) {
    return `color-${id % 5}`;
  }
};

// Components
const App = {
  newEntryText: '',
  gratitudeModel: null,
  fileHandle: null,
  fileKey: "gratitude",

  oninit: async () => {
    App.fileHandle = await LocalFileLinker.getStoredHandle(App.fileKey);
    m.redraw();
  },

  loadFile: async () => {
    const granted = await App.fileHandle.verifyPermission(true);
    if (!granted) {
      console.warn('Failed to grant permission');
      return false;
    }

    App.gratitudeModel = await GratitudeModel.create(App.fileHandle);
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
    const file = await LocalFileLinker.createAndLinkFile('gratitude-data.json', App.fileKey);
    if (!file) {
      console.warn('Failed to createAndLinkFile');
      return;
    }
    await file.write([]);
    App.fileHandle = file;
    App.loadFile();
  },

  unlinkFile: async () => {
    if (App.fileHandle) {
      await App.fileHandle.clear();
    }
    App.fileHandle = null;
    App.gratitudeModel = null;
    m.redraw();
  },

  view: () => {
    if (!App.gratitudeModel) {
      return h(["div.container.centered-container", [
        ["h1", "Gratitude Journal"],
        App.fileHandle ?
          ["button.btn-primary", { onclick: App.loadFile }, "Open"] :
          [".button-group", [
            ["button.btn-primary", { onclick: App.linkFile }, "Link File"],
            ["button.btn-secondary", { onclick: App.createFile }, "Create File"]
          ]]
      ]]);
    }

    let GratitudeModel = App.gratitudeModel;

    const sortedEntries = [...GratitudeModel.entries].sort((a, b) => b.id - a.id);
    const nextId = GratitudeModel.entries.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    const reminders = [
      { label: '7 days ago', entry: GratitudeModel.getPastEntry(7) },
      { label: '1 month ago', entry: GratitudeModel.getPastEntryMonths(1) },
      { label: '3 months ago', entry: GratitudeModel.getPastEntryMonths(3) },
      { label: '1 year ago', entry: GratitudeModel.getPastEntryYears(1) }
    ].filter(r => r.entry);

    return h(["div.container", [
      ["nav", [
        ["h1", "Gratitude Journal"]
      ]],
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
                title: `Linked to: ${GratitudeModel.fileHandle.fileHandle.name}. Click to unlink.`,
                onclick: App.unlinkFile
              }, "✓ Linked"];
            }
          })(),
          ["input[type=file]#import-input", {
            style: { display: 'none' },
            onchange: (e) => {
              if (e.target.files.length > 0) {
                GratitudeModel.importData(e.target.files[0]);
              }
            }
          }],
          ["button.edit-mode-toggle", { 
            onclick: () => {GratitudeModel.toggleEditMode()},
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

m.mount(document.getElementById('app-mount'), App);
