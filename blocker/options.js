document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domain');
  const limitInput = document.getElementById('limit');
  const addBtn = document.getElementById('add-btn');
  const blockedListBody = document.querySelector('#blocked-list tbody');

  // Load and render settings
  async function loadSettings() {
    const result = await chrome.storage.local.get({ settings: { blockedSites: {} } });
    const blockedSites = result.settings.blockedSites;
    blockedListBody.innerHTML = Object.entries(blockedSites).map(([domain, limit]) => `
      <tr>
        <td>${domain}</td>
        <td>${limit}</td>
        <td><button class="btn btn-danger delete-btn" data-domain="${domain}">Delete</button></td>
      </tr>
    `).join('');
  }

  // Event delegation for delete buttons
  blockedListBody.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-btn')) {
      deleteDomain(e.target.getAttribute('data-domain'));
    }
  });

  // Add a new domain
  addBtn.addEventListener('click', async () => {
    let domain = domainInput.value.trim().toLowerCase();
    const limit = parseInt(limitInput.value, 10);

    if (!domain) {
      alert('Please enter a domain.');
      return;
    }
    if (isNaN(limit) || limit < 0) {
      alert('Please enter a valid limit (minimum 0 minutes).');
      return;
    }

    domain = cleanDomain(domain);

    const result = await chrome.storage.local.get({ settings: { blockedSites: {} } });
    const settings = result.settings;
    settings.blockedSites[domain] = limit;
    
    await chrome.storage.local.set({ settings });
    loadSettings();
    domainInput.value = '';
    limitInput.value = '30';
  });

  // Delete a domain
  async function deleteDomain(domain) {
    const result = await chrome.storage.local.get({ settings: { blockedSites: {} } });
    const settings = result.settings;
    delete settings.blockedSites[domain];
    
    await chrome.storage.local.set({ settings });
    loadSettings();
  }

  // Helper to clean domain input (remove http/https/www if entered)
  function cleanDomain(url) {
    let hostname = url;
    if (hostname.includes('://')) {
      hostname = hostname.split('://')[1];
    }
    hostname = hostname.split('/')[0];
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname;
  }

  // Export Data
  document.getElementById('export-btn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(null);
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blocker_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import Data Trigger
  const importFile = document.getElementById('import-file');
  document.getElementById('import-btn-trigger').addEventListener('click', () => {
    importFile.click();
  });

  // Import Data Action
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsedData = JSON.parse(event.target.result);
        
        // Basic validation
        if (typeof parsedData !== 'object' || parsedData === null) {
          throw new Error('Invalid JSON structure. Root must be an object.');
        }
        if (!parsedData.settings && !parsedData.stats) {
          throw new Error('Invalid backup file. Missing settings or stats.');
        }

        if (confirm('Are you sure you want to import this data? This will overwrite your current settings and stats.')) {
          await chrome.storage.local.clear();
          await chrome.storage.local.set(parsedData);
          alert('Data imported successfully!');
          loadSettings();
          await chrome.storage.session.clear();
        }
      } catch (err) {
        alert(`Failed to import data: ${err.message}`);
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  loadSettings();
});
