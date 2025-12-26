// Offline Sync Layer for AssistQR
// Handles syncing queued reports when connection is restored

// Prevent duplicate syncs
let isSyncing = false;

// Submit a queued report to the server
async function syncReport(report) {
  try {
    console.log('🔄 Syncing report:', report.id);

    // Get images for this report
    const images = await window.offlineStorage.getReportImages(report.id);
    console.log(`📷 Found ${images.length} image(s) for report ${report.id}`);

    // Create FormData
    const formData = new FormData();
    formData.append('qrToken', report.qrToken);
    
    if (report.latitude) formData.append('latitude', report.latitude);
    if (report.longitude) formData.append('longitude', report.longitude);
    if (report.manualLocation) formData.append('manualLocation', report.manualLocation);
    if (report.helperNote) formData.append('helperNote', report.helperNote);

    // Add images
    if (images && images.length > 0) {
      images.forEach((file, index) => {
        if (file && file instanceof File) {
          formData.append('images', file);
          console.log(`📎 Added image ${index + 1}: ${file.name} (${file.size} bytes)`);
        }
      });
    } else {
      console.log('⚠️ No images found for this report');
    }

    // Submit to server
    const response = await fetch('/accidents/report', {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      // Success - remove from queue IMMEDIATELY to prevent duplicate syncs
      await window.offlineStorage.removeReport(report.id);
      console.log('✅ Report synced successfully and removed from queue:', report.id);
      return { success: true, reportId: report.id };
    } else {
      // Failed - update status
      await window.offlineStorage.updateReportStatus(report.id, 'failed');
      console.error('❌ Report sync failed:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    console.error('❌ Error syncing report:', error);
    await window.offlineStorage.updateReportStatus(report.id, 'failed');
    return { success: false, error: error.message };
  }
}

// Sync all pending reports
async function syncAllPendingReports() {
  // Prevent duplicate syncs
  if (isSyncing) {
    console.log('🔄 Sync already in progress, skipping...');
    return { synced: 0, failed: 0 };
  }

  if (!window.offlineStorage || !window.offlineStorage.isOnline()) {
    console.log('📴 Still offline, cannot sync');
    return { synced: 0, failed: 0 };
  }

  isSyncing = true;
  console.log('🔄 Starting sync...');

  try {
    const pendingReports = await window.offlineStorage.getPendingReports();
    
    if (pendingReports.length === 0) {
      console.log('✅ No pending reports to sync');
      return { synced: 0, failed: 0 };
    }

    console.log(`🔄 Syncing ${pendingReports.length} pending report(s)...`);

    let synced = 0;
    let failed = 0;

    // Sync reports one by one to avoid overwhelming the server
    // Get fresh list before each sync to avoid duplicates
    let currentPending = await window.offlineStorage.getPendingReports();
    
    for (const report of currentPending) {
      // Double-check report is still pending (might have been synced by another process)
      if (report.status !== 'pending') {
        console.log(`⏭️  Report ${report.id} status is ${report.status}, skipping...`);
        continue;
      }

      console.log(`🔄 Syncing report ${report.id}...`);
      const result = await syncReport(report);
      
      // Refresh pending list after each sync
      currentPending = await window.offlineStorage.getPendingReports();
      if (result.success) {
        synced++;
      } else {
        failed++;
        // If retry count is too high, mark as permanently failed
        if (report.retryCount >= 5) {
          await window.offlineStorage.updateReportStatus(report.id, 'permanently_failed');
        }
      }

      // Small delay between syncs
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Sync complete: ${synced} synced, ${failed} failed`);

    // Update UI
    updateSyncStatus(synced, failed);

    return { synced, failed };
  } finally {
    isSyncing = false;
  }
}

// Update sync status in UI
function updateSyncStatus(synced, failed) {
  const statusElement = document.getElementById('sync-status');
  if (statusElement) {
    if (synced > 0) {
      statusElement.textContent = `✅ ${synced} report(s) synced successfully`;
      statusElement.className = 'sync-status success';
      setTimeout(() => {
        statusElement.textContent = '';
        statusElement.className = '';
      }, 5000);
    }
    if (failed > 0) {
      statusElement.textContent = `⚠️ ${failed} report(s) failed to sync`;
      statusElement.className = 'sync-status error';
    }
  }

  // Update pending count
  updatePendingCount();
}

// Update pending reports count in UI
async function updatePendingCount() {
  const count = await window.offlineStorage.getPendingCount();
  const countElement = document.getElementById('pending-count');
  if (countElement) {
    countElement.textContent = count;
    countElement.style.display = count > 0 ? 'inline' : 'none';
  }
}

// Initialize sync on page load if online
async function initSync() {
  if (window.offlineStorage && window.offlineStorage.isOnline()) {
    // Small delay to ensure page is loaded
    setTimeout(async () => {
      await syncAllPendingReports();
    }, 2000);
  }
}

// Register background sync
function registerBackgroundSync() {
  if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
    navigator.serviceWorker.ready.then(registration => {
      registration.sync.register('sync-reports').then(() => {
        console.log('✅ Background sync registered');
      }).catch(err => {
        console.warn('⚠️ Background sync registration failed:', err);
      });
    });
  }
}

// Listen for online events and sync (with debounce to prevent multiple calls)
let onlineSyncTimeout = null;
let syncListenerRegistered = false;

// Register sync listener only once
if (!syncListenerRegistered && window.offlineStorage) {
  syncListenerRegistered = true;
  window.offlineStorage.onOnlineStatusChange(async (isOnline) => {
    if (isOnline) {
      console.log('🌐 Online - scheduling sync...');
      // Register background sync
      registerBackgroundSync();
      // Debounce sync to prevent multiple rapid calls
      if (onlineSyncTimeout) {
        clearTimeout(onlineSyncTimeout);
      }
      onlineSyncTimeout = setTimeout(async () => {
        await syncAllPendingReports();
      }, 2000); // Wait 2 seconds after coming online
    }
  });
}

// Also listen for Service Worker messages
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SYNC_REPORTS') {
      console.log('🔄 Service Worker requested sync');
      // Debounce to prevent duplicates
      if (onlineSyncTimeout) {
        clearTimeout(onlineSyncTimeout);
      }
      onlineSyncTimeout = setTimeout(async () => {
        await syncAllPendingReports();
      }, 1000);
    }
  });
}

// Export functions
window.offlineSync = {
  syncReport,
  syncAllPendingReports,
  updatePendingCount,
  initSync,
  registerBackgroundSync
};

