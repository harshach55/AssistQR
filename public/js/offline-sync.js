// Offline Sync Layer for AssistQR
// Handles syncing queued reports when connection is restored

// Prevent duplicate syncs - use localStorage to persist across page loads
let isSyncing = false;
const SYNC_COOLDOWN = 10000; // 10 seconds cooldown between syncs
const SYNC_LOCK_KEY = 'assistqr_sync_lock';
const SYNC_LOCK_TIMEOUT = 30000; // 30 seconds max lock time

function getLastSyncTime() {
  try {
    const stored = localStorage.getItem('assistqr_last_sync');
    return stored ? parseInt(stored, 10) : 0;
  } catch (e) {
    return 0;
  }
}

function setLastSyncTime() {
  try {
    localStorage.setItem('assistqr_last_sync', Date.now().toString());
  } catch (e) {
    // Ignore localStorage errors
  }
}

function getSyncLock() {
  try {
    const lock = localStorage.getItem(SYNC_LOCK_KEY);
    if (!lock) return false;
    const lockTime = parseInt(lock, 10);
    const now = Date.now();
    // If lock is older than timeout, consider it stale
    if (now - lockTime > SYNC_LOCK_TIMEOUT) {
      localStorage.removeItem(SYNC_LOCK_KEY);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function setSyncLock() {
  try {
    localStorage.setItem(SYNC_LOCK_KEY, Date.now().toString());
  } catch (e) {
    // Ignore localStorage errors
  }
}

function clearSyncLock() {
  try {
    localStorage.removeItem(SYNC_LOCK_KEY);
  } catch (e) {
    // Ignore localStorage errors
  }
}

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
      console.log(`📎 Adding ${images.length} image(s) to FormData...`);
      images.forEach((file, index) => {
        if (file && file instanceof File) {
          // Ensure file has proper name and type
          const fileName = file.name || `image_${index + 1}.jpg`;
          const fileType = file.type || 'image/jpeg';
          
          // Create a new File with explicit properties to ensure compatibility
          const fileToSend = new File([file], fileName, {
            type: fileType,
            lastModified: file.lastModified || Date.now()
          });
          
          formData.append('images', fileToSend);
          console.log(`📎 Added image ${index + 1} to FormData: ${fileToSend.name} (${fileToSend.size} bytes, type: ${fileToSend.type})`);
        } else {
          console.warn(`⚠️ Image ${index + 1} is not a valid File object:`, file, typeof file);
        }
      });
      
      // Verify images are in FormData
      const formDataImages = formData.getAll('images');
      console.log(`✅ FormData now contains ${formDataImages.length} image(s)`);
      
      // Log FormData entries for debugging (can't directly inspect FormData, but we can count)
      if (formDataImages.length !== images.length) {
        console.error(`❌ FormData mismatch: Expected ${images.length} images, but FormData has ${formDataImages.length}`);
      }
    } else {
      console.log('⚠️ No images found for this report');
    }

    // Submit to server
    console.log('🚀 Submitting report to server...');
    const response = await fetch('/accidents/report', {
      method: 'POST',
      body: formData
    });

    // Log response for debugging
    const responseText = await response.text();
    console.log(`📥 Server response: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      // Success - remove from queue IMMEDIATELY to prevent duplicate syncs
      await window.offlineStorage.removeReport(report.id);
      console.log('✅ Report synced successfully and removed from queue:', report.id);
      return { success: true, reportId: report.id };
    } else {
      // Failed - update status
      await window.offlineStorage.updateReportStatus(report.id, 'failed');
      console.error('❌ Report sync failed:', response.status, responseText.substring(0, 200));
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
  // Prevent duplicate syncs - check both in-memory lock and localStorage lock
  const now = Date.now();
  if (isSyncing) {
    console.log('🔄 Sync already in progress (in-memory lock), skipping...');
    return { synced: 0, failed: 0 };
  }
  
  if (getSyncLock()) {
    console.log('🔄 Sync already in progress (localStorage lock), skipping...');
    return { synced: 0, failed: 0 };
  }
  
  const lastSync = getLastSyncTime();
  if (now - lastSync < SYNC_COOLDOWN) {
    const remaining = Math.round((SYNC_COOLDOWN - (now - lastSync)) / 1000);
    console.log(`🔄 Sync cooldown active (${remaining}s remaining), skipping...`);
    return { synced: 0, failed: 0 };
  }

  if (!window.offlineStorage || !window.offlineStorage.isOnline()) {
    console.log('📴 Still offline, cannot sync');
    return { synced: 0, failed: 0 };
  }

  isSyncing = true;
  setSyncLock();
  setLastSyncTime();
  console.log('🔄 Starting sync (locked)...');

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
    // Mark as syncing BEFORE getting the list to prevent race conditions
    const pendingReports = await window.offlineStorage.getPendingReports();
    
    if (pendingReports.length === 0) {
      console.log('✅ No pending reports to sync');
      return { synced: 0, failed: 0 };
    }

    console.log(`🔄 Found ${pendingReports.length} pending report(s) to sync`);

    let synced = 0;
    let failed = 0;

    for (const report of pendingReports) {
      // Double-check report is still pending (might have been synced by another process)
      const freshPending = await window.offlineStorage.getPendingReports();
      const stillPending = freshPending.find(r => r.id === report.id && r.status === 'pending');
      
      if (!stillPending) {
        console.log(`⏭️  Report ${report.id} no longer pending, skipping...`);
        continue;
      }

      // Mark as syncing BEFORE syncing to prevent duplicates
      await window.offlineStorage.updateReportStatus(report.id, 'syncing');
      console.log(`🔄 Syncing report ${report.id}...`);
      
      const result = await syncReport(report);
      
      if (result.success) {
        synced++;
        // Report is already removed by syncReport on success
      } else {
        failed++;
        // Mark back as pending if sync failed (unless retry limit reached)
        if (report.retryCount >= 5) {
          await window.offlineStorage.updateReportStatus(report.id, 'permanently_failed');
        } else {
          await window.offlineStorage.updateReportStatus(report.id, 'pending');
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
    clearSyncLock();
    console.log('🔓 Sync lock released');
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

// Initialize sync on page load if online (DISABLED - only sync when coming online)
async function initSync() {
  // Don't sync on page load - only sync when connection is restored
  // This prevents duplicate syncs when page is refreshed
  console.log('⏭️  initSync called but disabled to prevent duplicates');
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

