importScripts('utils.js');

// Helper to get domain from URL
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

// Check if domain is sub-domain of blocked
function findBlockedDomain(domain, blockedList) {
  for (const blocked of blockedList) {
    if (domain === blocked || domain.endsWith('.' + blocked)) {
      return blocked;
    }
  }
  return null;
}

function getTodayDateString() {
  return formatDate(new Date());
}

function ensureStatsStructure(stats, date, domain) {
  if (!stats[date]) stats[date] = {};
  if (!stats[date][domain]) stats[date][domain] = { attempts: 0, timeSpent: 0 };
}

function getStatsForPastDays(domain, allStats, days) {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (days - 1));
  return getTimeSpentInRange(domain, allStats, startDate, today);
}

async function getSettings() {
  const result = await chrome.storage.local.get({ settings: { blockedSites: {} } });
  return result.settings;
}

async function getAllowedTabs() {
  const result = await chrome.storage.session.get({ allowedTabs: {} });
  return result.allowedTabs;
}

async function isTabAllowed(tabId, domain) {
  const allowedTabs = await getAllowedTabs();
  const allowance = allowedTabs[tabId];
  return allowance && allowance.domain === domain;
}

async function allowTab(tabId, domain, bypassedViaMath) {
  const allowedTabs = await getAllowedTabs();
  allowedTabs[tabId] = { domain, bypassedViaMath };
  await chrome.storage.session.set({ allowedTabs });
}

async function removeTabAllowance(tabId) {
  const allowedTabs = await getAllowedTabs();
  delete allowedTabs[tabId];
  await chrome.storage.session.set({ allowedTabs });
}

async function incrementAttempts(domain) {
  const today = getTodayDateString();
  const result = await chrome.storage.local.get({ stats: {} });
  const stats = result.stats;
  ensureStatsStructure(stats, today, domain);
  
  stats[today][domain].attempts++;
  await chrome.storage.local.set({ stats });
}

async function handleHeartbeat(tabId, domain) {
  const allowedTabs = await getAllowedTabs();
  const allowance = allowedTabs[tabId];
  
  if (!allowance || allowance.domain !== domain) {
    return { allowed: false };
  }

  const today = getTodayDateString();
  const settings = await getSettings();
  const limitMins = settings.blockedSites[domain] || 0;
  const limitSecs = limitMins * 60;

  const result = await chrome.storage.local.get({ stats: {} });
  const stats = result.stats;
  ensureStatsStructure(stats, today, domain);

  stats[today][domain].timeSpent++;
  const newTimeSpent = stats[today][domain].timeSpent;

  await chrome.storage.local.set({ stats });

  if (!allowance.bypassedViaMath && newTimeSpent >= limitSecs) {
    await removeTabAllowance(tabId);
    return { allowed: false };
  }
  
  return {
    allowed: true,
    timeSpent: newTimeSpent,
    limit: limitSecs,
    attempts: stats[today][domain].attempts
  };
}

// Navigation Interception
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const url = details.url;
  if (url.startsWith(chrome.runtime.getURL(''))) return;

  const domain = getDomain(url);
  if (!domain) return;

  const settings = await getSettings();
  const blockedSites = settings.blockedSites || {};
  const blockedDomain = findBlockedDomain(domain, Object.keys(blockedSites));

  if (blockedDomain) {
    const isAllowed = await isTabAllowed(details.tabId, blockedDomain);
    if (!isAllowed) {
      await incrementAttempts(blockedDomain);
      const landingUrl = chrome.runtime.getURL(`landing.html?url=${encodeURIComponent(url)}&tabId=${details.tabId}&domain=${encodeURIComponent(blockedDomain)}`);
      chrome.tabs.update(details.tabId, { url: landingUrl });
    }
  }
});

// Clean up allowance on navigation away
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const allowedTabs = await getAllowedTabs();
    const allowance = allowedTabs[tabId];
    
    if (allowance) {
      const allowedDomain = allowance.domain;
      const domain = getDomain(changeInfo.url);
      const isStillOnAllowed = domain && (domain === allowedDomain || domain.endsWith('.' + allowedDomain));
      if (!isStillOnAllowed) {
        await removeTabAllowance(tabId);
      }
    }
  }
});

// Clean up allowance on tab close
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTabAllowance(tabId);
});

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'checkStatus') {
    const tabId = sender.tab.id;
    const domain = getDomain(sender.url);
    checkStatus(tabId, domain).then((status) => {
      sendResponse(status);
    });
    return true;
  }

  if (message.type === 'goBackToLanding') {
    const tabId = sender.tab.id;
    removeTabAllowance(tabId).then(() => {
      const landingUrl = chrome.runtime.getURL(`landing.html?url=${encodeURIComponent(message.url)}&tabId=${tabId}&domain=${encodeURIComponent(message.domain)}`);
      chrome.tabs.update(tabId, { url: landingUrl });
    });
    return;
  }

  if (message.type === 'allowTab') {
    allowTab(message.tabId, message.domain, message.bypassedViaMath).then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'heartbeat') {
    const tabId = sender.tab.id;
    handleHeartbeat(tabId, message.domain).then((response) => {
      sendResponse(response);
    });
    return true;
  }

  if (message.type === 'getStats') {
    getStatsForDomain(message.domain).then((stats) => {
      sendResponse(stats);
    });
    return true;
  }
});

async function getStatsForDomain(domain) {
  const result = await chrome.storage.local.get({ stats: {} });
  const stats = result.stats;
  const today = getTodayDateString();
  
  return {
    today: (stats[today] && stats[today][domain]) || { attempts: 0, timeSpent: 0 },
    weekly: getWeeklyStats(domain, stats),
    yearly: getYearlyStats(domain, stats),
    lastMonthTime: getStatsForPastDays(domain, stats, 30),
    lastYearTime: getStatsForPastDays(domain, stats, 365),
    allTime: getAllTimeStats(domain, stats)
  };
}

function getWeeklyStats(domain, allStats) {
  const today = new Date();
  const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName, i) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    const dateStr = formatDate(date);
    return {
      date: dateStr,
      dayName,
      timeSpent: allStats[dateStr]?.[domain]?.timeSpent || 0
    };
  });
}

function getYearlyStats(domain, allStats) {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), 0, 1);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  const startDateStr = formatDate(startDate);
  
  return Object.entries(allStats).reduce((acc, [dateStr, dayData]) => {
    if (dateStr >= startDateStr && dayData[domain]) {
      acc[dateStr] = dayData[domain].timeSpent;
    }
    return acc;
  }, {});
}

async function checkStatus(tabId, domain) {
  if (!domain) return { isBlocked: false };

  const settings = await getSettings();
  const blockedSites = settings.blockedSites || {};
  const blockedDomain = findBlockedDomain(domain, Object.keys(blockedSites));

  if (!blockedDomain) {
    return { isBlocked: false };
  }

  const isAllowed = await isTabAllowed(tabId, blockedDomain);
  const today = getTodayDateString();
  
  const result = await chrome.storage.local.get({ stats: {} });
  const stats = result.stats;
  const todayStats = (stats[today] && stats[today][blockedDomain]) || { timeSpent: 0 };
  const limitMins = blockedSites[blockedDomain] || 0;
  
  return {
    isBlocked: true,
    isAllowed: isAllowed,
    domain: blockedDomain,
    timeSpent: todayStats.timeSpent,
    limit: limitMins * 60,
    tabId: tabId
  };
}

function getTimeSpentInRange(domain, allStats, startDate, endDate) {
  let total = 0;
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    total += allStats[formatDate(d)]?.[domain]?.timeSpent || 0;
  }
  return total;
}

function getAllTimeStats(domain, allStats) {
  let total = 0;
  for (const dayData of Object.values(allStats)) {
    if (dayData[domain]) {
      total += dayData[domain].timeSpent;
    }
  }
  return total;
}



