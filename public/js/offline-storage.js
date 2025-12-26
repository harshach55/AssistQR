// Offline Storage Layer for AssistQR
// Uses IndexedDB to store reports and images when offline

const DB_NAME = 'assistqr-offline';
const DB_VERSION = 1;
const STORE_REPORTS = 'reports';
const STORE_IMAGES = 'images';

let db = null;

// Initialize IndexedDB
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('❌ IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('✅ IndexedDB initialized');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create reports store
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        const reportStore = db.createObjectStore(STORE_REPORTS, { keyPath: 'id', autoIncrement: true });
        reportStore.createIndex('timestamp', 'timestamp', { unique: false });
        reportStore.createIndex('status', 'status', { unique: false });
        console.log('✅ Created reports store');
      }

      // Create images store
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        const imageStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id', autoIncrement: true });
        imageStore.createIndex('reportId', 'reportId', { unique: false });
        console.log('✅ Created images store');
      }
    };
  });
}

// Get database instance (initialize if needed)
async function getDB() {
  if (db) return db;
  return await initDB();
}

// Store a report in the queue
async function queueReport(reportData) {
  try {
    const database = await getDB();
    const transaction = database.transaction([STORE_REPORTS], 'readwrite');
    const store = transaction.objectStore(STORE_REPORTS);

    const report = {
      ...reportData,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0
    };

    const request = store.add(report);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        console.log('✅ Report queued:', request.result);
        resolve(request.result);
      };
      request.onerror = () => {
        console.error('❌ Error queueing report:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('❌ Error in queueReport:', error);
    throw error;
  }
}

// Store an image blob
async function storeImage(file, reportId) {
  try {
    const database = await getDB();
    const transaction = database.transaction([STORE_IMAGES], 'readwrite');
    const store = transaction.objectStore(STORE_IMAGES);

    // Convert file to ArrayBuffer for storage
    let arrayBuffer;
    if (file instanceof File || file instanceof Blob) {
      arrayBuffer = await file.arrayBuffer();
    } else if (file instanceof ArrayBuffer) {
      arrayBuffer = file;
    } else {
      throw new Error('Invalid file type');
    }

    const imageData = {
      reportId: reportId,
      blob: arrayBuffer,
      filename: file.name || `image_${Date.now()}.jpg`,
      type: file.type || 'image/jpeg',
      timestamp: Date.now()
    };

    const request = store.add(imageData);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        console.log('✅ Image stored:', request.result);
        resolve(request.result);
      };
      request.onerror = () => {
        console.error('❌ Error storing image:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('❌ Error in storeImage:', error);
    throw error;
  }
}

// Get all pending reports
async function getPendingReports() {
  try {
    const database = await getDB();
    const transaction = database.transaction([STORE_REPORTS], 'readonly');
    const store = transaction.objectStore(STORE_REPORTS);
    const index = store.index('status');

    const request = index.getAll('pending');

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => {
        console.error('❌ Error getting pending reports:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('❌ Error in getPendingReports:', error);
    return [];
  }
}

// Get images for a report
async function getReportImages(reportId) {
  try {
    const database = await getDB();
    const transaction = database.transaction([STORE_IMAGES], 'readonly');
    const store = transaction.objectStore(STORE_IMAGES);
    const index = store.index('reportId');

    const request = index.getAll(reportId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const images = request.result || [];
        // Convert blobs back to File objects
        const files = images.map(img => {
          const blob = new Blob([img.blob], { type: img.type });
          return new File([blob], img.filename, { type: img.type });
        });
        resolve(files);
      };
      request.onerror = () => {
        console.error('❌ Error getting report images:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('❌ Error in getReportImages:', error);
    return [];
  }
}

// Update report status
async function updateReportStatus(reportId, status) {
  try {
    const database = await getDB();
    const transaction = database.transaction([STORE_REPORTS], 'readwrite');
    const store = transaction.objectStore(STORE_REPORTS);

    const getRequest = store.get(reportId);

    return new Promise((resolve, reject) => {
      getRequest.onsuccess = () => {
        const report = getRequest.result;
        if (!report) {
          reject(new Error('Report not found'));
          return;
        }

        report.status = status;
        if (status === 'failed') {
          report.retryCount = (report.retryCount || 0) + 1;
        }

        const updateRequest = store.put(report);
        updateRequest.onsuccess = () => {
          console.log(`✅ Report ${reportId} status updated to ${status}`);
          resolve(report);
        };
        updateRequest.onerror = () => {
          reject(updateRequest.error);
        };
      };
      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  } catch (error) {
    console.error('❌ Error in updateReportStatus:', error);
    throw error;
  }
}

// Remove report after successful sync
async function removeReport(reportId) {
  try {
    const database = await getDB();
    const transaction = database.transaction([STORE_REPORTS, STORE_IMAGES], 'readwrite');
    const reportStore = transaction.objectStore(STORE_REPORTS);
    const imageStore = transaction.objectStore(STORE_IMAGES);
    const imageIndex = imageStore.index('reportId');

    // Remove images first
    const getImagesRequest = imageIndex.getAll(reportId);
    getImagesRequest.onsuccess = () => {
      getImagesRequest.result.forEach(img => {
        imageStore.delete(img.id);
      });
    };

    // Remove report
    const request = reportStore.delete(reportId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        console.log('✅ Report removed:', reportId);
        resolve();
      };
      request.onerror = () => {
        console.error('❌ Error removing report:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('❌ Error in removeReport:', error);
    throw error;
  }
}

// Get count of pending reports
async function getPendingCount() {
  const reports = await getPendingReports();
  return reports.length;
}

// Check if online
function isOnline() {
  return navigator.onLine;
}

// Listen for online/offline events
function onOnlineStatusChange(callback) {
  window.addEventListener('online', () => {
    console.log('🌐 Connection restored');
    callback(true);
  });
  window.addEventListener('offline', () => {
    console.log('📴 Connection lost');
    callback(false);
  });
}

// Export functions
window.offlineStorage = {
  init: initDB,
  queueReport,
  storeImage,
  getPendingReports,
  getReportImages,
  updateReportStatus,
  removeReport,
  getPendingCount,
  isOnline,
  onOnlineStatusChange
};

