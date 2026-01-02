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
        const reportId = request.result;
        console.log('✅ Report queued with ID:', reportId);
        console.log('📝 Report data:', JSON.stringify(reportData, null, 2));
        resolve(reportId);
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
async function storeImage(file, reportId, retryCount = 0) {
  const maxRetries = 3;
  
  // Convert file to ArrayBuffer FIRST (before any database operations)
  // This is the slowest part, so do it upfront
  let arrayBuffer;
  if (file instanceof File || file instanceof Blob) {
    arrayBuffer = await file.arrayBuffer();
  } else if (file instanceof ArrayBuffer) {
    arrayBuffer = file;
  } else {
    throw new Error('Invalid file type');
  }

  // Prepare image data
  const imageData = {
    reportId: reportId,
    blob: arrayBuffer,
    filename: file.name || `image_${Date.now()}.jpg`,
    type: file.type || 'image/jpeg',
    timestamp: Date.now()
  };

  console.log(`💾 Storing image for report ${reportId}: ${imageData.filename} (${arrayBuffer.byteLength} bytes, type: ${imageData.type})${retryCount > 0 ? ` [Retry ${retryCount}/${maxRetries}]` : ''}`);

  try {
    // Get fresh database connection
    const database = await getDB();
    
    // Verify database is ready
    if (!database) {
      throw new Error('Database not available');
    }

    // Check if database connection is still open
    if (database.version === null) {
      // Database connection is closed, reinitialize
      console.log('🔄 Database connection closed, reinitializing...');
      db = null;
      const freshDb = await getDB();
      if (!freshDb) {
        throw new Error('Failed to reinitialize database');
      }
      // Retry with fresh connection
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100 * (retryCount + 1)));
        return storeImage(file, reportId, retryCount + 1);
      }
      throw new Error('Database connection failed after retries');
    }

    // Create transaction and add operation SYNCHRONOUSLY (no async operations between these)
    // IndexedDB transactions auto-commit when there are no pending operations
    // So we must create transaction and queue add() in the same synchronous execution
    const transaction = database.transaction([STORE_IMAGES], 'readwrite');
    const store = transaction.objectStore(STORE_IMAGES);
    
    // Queue add operation IMMEDIATELY (this keeps transaction alive)
    const request = store.add(imageData);

    // Return promise that resolves when request completes
    return new Promise((resolve, reject) => {
      // Set up all handlers immediately
      request.onsuccess = () => {
        console.log(`✅ Image stored with ID ${request.result} for report ${reportId}${retryCount > 0 ? ` (after ${retryCount} retry)` : ''}`);
        resolve(request.result);
      };

      request.onerror = () => {
        const error = request.error;
        console.error(`❌ Error storing image (attempt ${retryCount + 1}):`, error);
        
        // If it's a transaction error and we have retries left, retry
        if (error && error.name === 'TransactionInactiveError' && retryCount < maxRetries) {
          console.log(`🔄 Retrying image storage (attempt ${retryCount + 2}/${maxRetries + 1})...`);
          // Reset database connection and retry
          db = null;
          setTimeout(async () => {
            try {
              const result = await storeImage(file, reportId, retryCount + 1);
              resolve(result);
            } catch (retryError) {
              reject(retryError);
            }
          }, 100 * (retryCount + 1));
        } else {
          reject(error || new Error('Add operation failed'));
        }
      };

      transaction.onerror = (event) => {
        const error = transaction.error || event || new Error('Transaction failed');
        console.error(`❌ Transaction error (attempt ${retryCount + 1}):`, error);
        
        // Retry on transaction errors
        if (retryCount < maxRetries) {
          console.log(`🔄 Retrying image storage (attempt ${retryCount + 2}/${maxRetries + 1})...`);
          db = null; // Reset connection
          setTimeout(async () => {
            try {
              const result = await storeImage(file, reportId, retryCount + 1);
              resolve(result);
            } catch (retryError) {
              reject(retryError);
            }
          }, 100 * (retryCount + 1));
        } else {
          reject(error);
        }
      };

      transaction.onabort = () => {
        const error = new Error('Transaction was aborted');
        console.error(`❌ Transaction aborted (attempt ${retryCount + 1})`);
        
        if (retryCount < maxRetries) {
          console.log(`🔄 Retrying image storage (attempt ${retryCount + 2}/${maxRetries + 1})...`);
          db = null; // Reset connection
          setTimeout(async () => {
            try {
              const result = await storeImage(file, reportId, retryCount + 1);
              resolve(result);
            } catch (retryError) {
              reject(retryError);
            }
          }, 100 * (retryCount + 1));
        } else {
          reject(error);
        }
      };
    });
  } catch (error) {
    console.error(`❌ Error in storeImage attempt ${retryCount + 1}:`, error);
    
    // Retry if we haven't exceeded max retries
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying image storage (attempt ${retryCount + 2}/${maxRetries + 1})...`);
      db = null; // Reset connection
      await new Promise(resolve => setTimeout(resolve, 100 * (retryCount + 1)));
      return storeImage(file, reportId, retryCount + 1);
    } else {
      throw error;
    }
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
        const reports = request.result || [];
        // Filter out any reports that are currently syncing (safety check)
        const pendingOnly = reports.filter(r => r.status === 'pending');
        console.log(`📋 Found ${pendingOnly.length} pending report(s) (${reports.length - pendingOnly.length} in other states)`);
        resolve(pendingOnly);
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
        console.log(`📷 Retrieved ${images.length} image(s) from storage for report ${reportId}`);
        
        if (images.length === 0) {
          console.warn(`⚠️ No images found for report ${reportId}`);
          resolve([]);
          return;
        }
        
        // Convert ArrayBuffers back to File objects
        const files = images.map((img, index) => {
          try {
            // img.blob should be an ArrayBuffer
            let arrayBuffer = img.blob;
            
            // Handle different storage formats
            if (!arrayBuffer) {
              console.error(`❌ Image ${index + 1} has no blob data:`, img);
              return null;
            }
            
            // If it's already an ArrayBuffer, use it directly
            // If it's stored as something else, try to convert
            if (!(arrayBuffer instanceof ArrayBuffer)) {
              // Try to convert if it's a different type
              if (arrayBuffer instanceof Uint8Array) {
                arrayBuffer = arrayBuffer.buffer;
              } else if (typeof arrayBuffer === 'object' && arrayBuffer.byteLength !== undefined) {
                // Might be a typed array, get the underlying buffer
                arrayBuffer = arrayBuffer.buffer || arrayBuffer;
              } else {
                console.error(`❌ Image ${index + 1} blob is not an ArrayBuffer. Type: ${typeof arrayBuffer}, constructor: ${arrayBuffer?.constructor?.name}`);
                return null;
              }
            }
            
            // Verify ArrayBuffer has data
            if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
              console.error(`❌ Image ${index + 1} ArrayBuffer is invalid or empty (${arrayBuffer?.byteLength || 0} bytes)`);
              return null;
            }
            
            console.log(`🔄 Converting image ${index + 1}: ArrayBuffer size = ${arrayBuffer.byteLength} bytes`);
            
            // Create Blob from ArrayBuffer
            const blob = new Blob([arrayBuffer], { type: img.type || 'image/jpeg' });
            
            if (blob.size === 0) {
              console.error(`❌ Image ${index + 1} Blob has zero size after creation`);
              return null;
            }
            
            // Create File from Blob (File constructor accepts BlobParts directly)
            const fileName = img.filename || `image_${index + 1}.jpg`;
            const fileType = img.type || 'image/jpeg';
            const file = new File([blob], fileName, { 
              type: fileType,
              lastModified: img.timestamp || Date.now()
            });
            
            if (file.size === 0) {
              console.error(`❌ Image ${index + 1} File has zero size after conversion`);
              return null;
            }
            
            // Verify sizes match
            if (file.size !== arrayBuffer.byteLength) {
              console.warn(`⚠️ Image ${index + 1} size mismatch: ArrayBuffer=${arrayBuffer.byteLength}, File=${file.size}`);
            }
            
            console.log(`✅ Converted image ${index + 1}: ${file.name} (${file.size} bytes, type: ${file.type})`);
            return file;
          } catch (error) {
            console.error(`❌ Error converting image ${index + 1}:`, error, error.stack);
            return null;
          }
        }).filter(file => file !== null && file.size > 0);
        
        console.log(`✅ Returning ${files.length} valid image file(s) for report ${reportId}`);
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

