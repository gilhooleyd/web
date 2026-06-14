(async function() {
  // Prevent double injection
  if (window.hasBlockerInfoBox) return;
  window.hasBlockerInfoBox = true;

  const status = await chrome.runtime.sendMessage({ type: 'checkStatus' });
  if (status && status.isBlocked && status.isAllowed) {
    initInfoBox(status);
  }

  function initInfoBox(initialStatus) {
    const domain = initialStatus.domain;
    const tabId = initialStatus.tabId;
    
    // Create elements
    const container = document.createElement('div');
    container.id = 'blocker-info-box';
    container.innerHTML = `
      <span id="blocker-info-text">Loading...</span>
      <button id="blocker-info-back">Back</button>
    `;
    container.querySelector('#blocker-info-back').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'goBackToLanding',
        url: window.location.href,
        domain
      });
    });
    document.body.appendChild(container);

    // Initial update
    updateUI(initialStatus.timeSpent, initialStatus.limit);

    // Start heartbeat
    const intervalId = setInterval(async () => {
      if (document.hidden) return; // Don't track if tab is hidden

      const response = await chrome.runtime.sendMessage({ type: 'heartbeat', domain });
      if (response && response.allowed) {
        updateUI(response.timeSpent, response.limit);
      } else {
        clearInterval(intervalId);
        container.remove();
        window.location.reload();
      }
    }, 1000);
  }

  function updateUI(timeSpent, limit) {
    const textSpan = document.getElementById('blocker-info-text');
    if (!textSpan) return;

    if (timeSpent < limit) {
      const timeLeft = limit - timeSpent;
      textSpan.textContent = `Time Left: ${formatTime(timeLeft)}`;
      textSpan.style.color = '#28a745';
    } else {
      textSpan.textContent = `Total Time spent: ${formatTime(timeSpent)}`;
      textSpan.style.color = '#dc3545';
    }
  }

})();
