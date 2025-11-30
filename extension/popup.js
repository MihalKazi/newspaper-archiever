// Popup script
let currentUrl = '';
let currentJobId = null;
let progressInterval = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab.url;
  
  // Display current URL
  document.getElementById('currentUrl').textContent = currentUrl;

  // Check server status
  checkServerStatus();

  // Load recent archives
  loadRecentArchives();

  // Check if there's an active job in storage
  const result = await chrome.storage.local.get(['activeJobId']);
  if (result.activeJobId) {
    currentJobId = result.activeJobId;
    startProgressTracking();
  }

  // Set up button listeners
  document.getElementById('archiveBtn').addEventListener('click', archiveCurrentPage);
  document.getElementById('openDashboardBtn').addEventListener('click', openDashboard);
});

// Check if server is running
async function checkServerStatus() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const archiveBtn = document.getElementById('archiveBtn');
  const serverOfflineInfo = document.getElementById('serverOfflineInfo');

  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'checkServerStatus' 
    });

    if (response.running) {
      statusDot.classList.remove('offline');
      statusText.textContent = 'Server is running';
      archiveBtn.disabled = false;
      serverOfflineInfo.style.display = 'none';
    } else {
      throw new Error('Server not running');
    }
  } catch (error) {
    statusDot.classList.add('offline');
    statusText.textContent = 'Server is offline';
    archiveBtn.disabled = true;
    serverOfflineInfo.style.display = 'block';
  }
}

// Archive current page
async function archiveCurrentPage() {
  const btn = document.getElementById('archiveBtn');
  const btnText = document.getElementById('archiveBtnText');
  
  // Disable button and show loading
  btn.disabled = true;
  btnText.innerHTML = '⏳ Starting...';

  try {
    // Send archive request
    const response = await fetch('http://localhost:3000/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl, mode: 'single' })
    });

    if (!response.ok) {
      throw new Error('Failed to start archiving');
    }

    const data = await response.json();
    currentJobId = data.jobId;

    // Store job ID
    await chrome.storage.local.set({ activeJobId: currentJobId });

    // Show progress container
    startProgressTracking();

    btnText.innerHTML = '📥 Archive This Article';
    btn.disabled = false;

  } catch (error) {
    btnText.innerHTML = '✗ Failed';
    setTimeout(() => {
      btnText.innerHTML = '📥 Archive This Article';
      btn.disabled = false;
    }, 2000);
  }
}

// Start tracking progress
function startProgressTracking() {
  // Show progress container
  const progressContainer = document.getElementById('progressContainer');
  progressContainer.classList.add('active');

  // Clear any existing interval
  if (progressInterval) {
    clearInterval(progressInterval);
  }

  // Start polling
  updateProgress();
  progressInterval = setInterval(updateProgress, 1000);
}

// Update progress
async function updateProgress() {
  if (!currentJobId) return;

  try {
    const response = await fetch(`http://localhost:3000/api/status/${currentJobId}`);
    
    if (!response.ok) {
      throw new Error('Failed to get status');
    }

    const job = await response.json();

    // Update progress bar
    const progressBarFill = document.getElementById('progressBarFill');
    const progressPercentage = document.getElementById('progressPercentage');
    progressBarFill.style.width = job.progress + '%';
    progressPercentage.textContent = job.progress + '%';

    // Update status badge
    const progressStatus = document.getElementById('progressStatus');
    progressStatus.textContent = job.status;
    progressStatus.className = 'progress-status ' + job.status;

    // Update details
    const progressDetails = document.getElementById('progressDetails');
    if (job.logs && job.logs.length > 0) {
      const lastLog = job.logs[job.logs.length - 1];
      progressDetails.textContent = lastLog.message;
    }

    // Check if completed or failed
    if (job.status === 'completed') {
      clearInterval(progressInterval);
      progressInterval = null;

      // Clear active job
      await chrome.storage.local.remove(['activeJobId']);
      currentJobId = null;

      // Show completion
      showCompletion(job);

      // Reload recent archives after 2 seconds
      setTimeout(loadRecentArchives, 2000);
    } else if (job.status === 'failed') {
      clearInterval(progressInterval);
      progressInterval = null;

      // Clear active job
      await chrome.storage.local.remove(['activeJobId']);
      currentJobId = null;

      progressDetails.textContent = '❌ ' + (job.error || 'Failed to archive article');
    }

  } catch (error) {
    console.error('Progress update error:', error);
  }
}

// Show completion message
function showCompletion(job) {
  const progressComplete = document.getElementById('progressComplete');
  const completeDetails = document.getElementById('completeDetails');

  if (job.articleData) {
    completeDetails.innerHTML = `
      <strong>${job.articleData.title}</strong><br>
      📝 ${job.articleData.wordCount} words<br>
      🖼️ ${job.articleData.imageCount} images<br>
      🎥 ${job.articleData.videoCount} videos
    `;
  } else {
    completeDetails.textContent = 'Article archived successfully!';
  }

  progressComplete.style.display = 'block';

  // Hide after 5 seconds
  setTimeout(() => {
    const progressContainer = document.getElementById('progressContainer');
    progressContainer.classList.remove('active');
    progressComplete.style.display = 'none';
    
    // Reset progress
    document.getElementById('progressBarFill').style.width = '0%';
    document.getElementById('progressPercentage').textContent = '0%';
  }, 5000);
}

// Open dashboard
function openDashboard() {
  chrome.tabs.create({ url: 'http://localhost:3000' });
}

// Load recent archives
async function loadRecentArchives() {
  const result = await chrome.storage.local.get(['recentArchives']);
  const archives = result.recentArchives || [];
  const container = document.getElementById('recentArchivesList');

  if (archives.length === 0) {
    container.innerHTML = '<div class="empty-state">No archived articles yet</div>';
    return;
  }

  container.innerHTML = archives.slice(0, 5).map(archive => {
    const date = new Date(archive.date);
    const timeAgo = getTimeAgo(date);
    
    return `
      <div class="archive-item">
        <div class="archive-title">${escapeHtml(archive.title)}</div>
        <div class="archive-date">${timeAgo}</div>
      </div>
    `;
  }).join('');
}

// Get relative time
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60
  };

  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
    }
  }

  return 'Just now';
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Clean up on popup close
window.addEventListener('beforeunload', () => {
  if (progressInterval) {
    clearInterval(progressInterval);
  }
});