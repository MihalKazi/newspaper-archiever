// Background service worker for the extension

const SERVER_URL = 'http://localhost:3000';

// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'archiveArticle',
    title: '📰 Archive This Article',
    contexts: ['page', 'link']
  });

  // Set default settings
  chrome.storage.local.set({
    serverUrl: SERVER_URL,
    autoDownloadMedia: true,
    notifications: true
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'archiveArticle') {
    const url = info.linkUrl || tab.url;
    archiveArticle(url, tab.id);
  }
});

// Handle messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'archiveCurrentPage') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        archiveArticle(tabs[0].url, tabs[0].id);
        sendResponse({ success: true });
      }
    });
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'checkServerStatus') {
    checkServerStatus().then(status => {
      sendResponse(status);
    });
    return true;
  }
});

// Archive an article
async function archiveArticle(url, tabId) {
  try {
    // Check if server is running
    const serverStatus = await checkServerStatus();
    if (!serverStatus.running) {
      showNotification('Server Not Running', 
        'Please start the archiver server: npm start', 
        'error');
      return;
    }

    // Show progress notification
    showNotification('Archiving Started', 
      `Archiving: ${new URL(url).hostname}`, 
      'info');

    // Send to server
    const response = await fetch(`${SERVER_URL}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode: 'single' })
    });

    if (!response.ok) {
      throw new Error('Failed to start archiving');
    }

    const data = await response.json();
    const jobId = data.jobId;

    // Poll for status
    pollJobStatus(jobId, url);

  } catch (error) {
    console.error('Archive error:', error);
    showNotification('Archive Failed', 
      error.message || 'Could not connect to server', 
      'error');
  }
}

// Poll job status
async function pollJobStatus(jobId, originalUrl) {
  const maxAttempts = 120; // 2 minutes max
  let attempts = 0;

  const checkStatus = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/status/${jobId}`);
      const job = await response.json();

      if (job.status === 'completed') {
        showNotification('Archive Complete! ✓', 
          `Saved: ${job.articleData?.title || 'Article'}`, 
          'success');
        
        // Store recent archive
        storeRecentArchive({
          url: originalUrl,
          title: job.articleData?.title || 'Unknown',
          date: new Date().toISOString()
        });
        return;
      }

      if (job.status === 'failed') {
        showNotification('Archive Failed', 
          job.error || 'Unknown error occurred', 
          'error');
        return;
      }

      // Continue polling
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(checkStatus, 2000); // Check every 2 seconds
      } else {
        showNotification('Timeout', 
          'Archiving is taking too long', 
          'warning');
      }

    } catch (error) {
      console.error('Status check error:', error);
    }
  };

  checkStatus();
}

// Check if server is running
async function checkServerStatus() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${SERVER_URL}/api/health`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      return { running: data.status === 'ok' };
    }
    return { running: false };
  } catch (error) {
    console.log('Server check failed:', error.message);
    return { running: false };
  }
}

// Show notification
function showNotification(title, message, type) {
  chrome.storage.local.get(['notifications'], (result) => {
    if (result.notifications !== false) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: title,
        message: message,
        priority: type === 'error' ? 2 : 1
      });
    }
  });
}

// Store recent archive
async function storeRecentArchive(archive) {
  const result = await chrome.storage.local.get(['recentArchives']);
  let archives = result.recentArchives || [];
  
  // Add to beginning
  archives.unshift(archive);
  
  // Keep only last 20
  archives = archives.slice(0, 20);
  
  await chrome.storage.local.set({ recentArchives: archives });
}