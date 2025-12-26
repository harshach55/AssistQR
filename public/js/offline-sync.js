// Offline Sync Layer for AssistQR
// Handles syncing queued reports when connection is restored

// Submit a queued report to the server
async function syncReport(report) {
  try {
    console.log('🔄 Syncing report:', report.id);

    // Get images for this report
    const images = await window.offlineStorage.getReportImages(report.id);

    // Create FormData
    const formData = new FormData();
    formData.append('qrToken', report.qrToken);
    
    if (report.latitude) formData.append('latitude', report.latitude);
    if (report.longitude) formData.append('longitude', report.longitude);
    if (report.manualLocation) formData.append('manualLocation', report.manualLocation);
    if (report.helperNote) formData.append('helperNote', report.helperNote);

    // Add images
    images.forEach((file, index) => {
      formData.append('images', file);
    });

    // Submit to server
    const response = await fetch('/accidents/report', {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      // Success - remove from queue
      await window.offlineStorage.removeReport(report.id);
      console.log('✅ Report synced successfully:', report.id);
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
  if (!window.offlineStorage.isOnline()) {
    console.log('📴 Still offline, cannot sync');
    return;
  }

  const pendingReports = await window.offlineStorage.getPendingReports();
  
  if (pendingReports.length === 0) {
    console.log('✅ No pending reports to sync');
    return { synced: 0, failed: 0 };
  }

  console.log(`🔄 Syncing ${pendingReports.length} pending report(s)...`);

  let synced = 0;
  let failed = 0;

  // Sync reports one by one to avoid overwhelming the server
  for (const report of pendingReports) {
    const result = await syncReport(report);
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
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`✅ Sync complete: ${synced} synced, ${failed} failed`);

  // Update UI
  updateSyncStatus(synced, failed);

  return { synced, failed };
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
  if (window.offlineStorage.isOnline()) {
    // Small delay to ensure page is loaded
    setTimeout(async () => {
      await syncAllPendingReports();
    }, 1000);
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

// Listen for online events and sync
window.offlineStorage.onOnlineStatusChange(async (isOnline) => {
  if (isOnline) {
    console.log('🌐 Online - starting sync...');
    // Register background sync
    registerBackgroundSync();
    // Also sync immediately
    await syncAllPendingReports();
  }
});

// Export functions
window.offlineSync = {
  syncReport,
  syncAllPendingReports,
  updatePendingCount,
  initSync,
  registerBackgroundSync
};

