// Accident Reporting Routes
// Public endpoint: Bystanders submit accident reports via QR code scan

const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const prisma = require('../config/database');
const { uploadMultiple, getFileUrl } = require('../services/s3');
const { sendAccidentAlertEmail } = require('../services/email');
const { sendAccidentAlertSMS } = require('../services/sms');

const router = express.Router();

router.post('/report', (req, res, next) => {
  uploadMultiple(req, res, (err) => {
    if (err) {
      console.error('File upload error:', err);
      const messages = {
        'LIMIT_FILE_SIZE': 'File too large. Maximum size is 100MB per file.',
        'LIMIT_FILE_COUNT': 'Too many files. Maximum 10 images allowed.'
      };
      // Check if this is a programmatic request (from sync)
      const isProgrammatic = req.headers['x-requested-with'] === 'XMLHttpRequest' || 
                            req.headers['accept']?.includes('application/json');
      if (isProgrammatic) {
        return res.status(400).json({
          success: false,
          error: messages[err.code] || `File upload error: ${err.message || 'Unknown error'}`
          });
      }
      return res.status(400).render('error', {
        message: messages[err.code] || `File upload error: ${err.message || 'Unknown error'}`,
        error: null
      });
    }
    next();
  });
}, [
  body('qrToken').notEmpty(),
  body('latitude').optional({ checkFalsy: true }).custom((value) => {
    if (value === '' || value === null || value === undefined) {
      return true; // Allow empty values
    }
    const num = parseFloat(value);
    if (isNaN(num) || num < -90 || num > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }
    return true;
  }),
  body('longitude').optional({ checkFalsy: true }).custom((value) => {
    if (value === '' || value === null || value === undefined) {
      return true; // Allow empty values
    }
    const num = parseFloat(value);
    if (isNaN(num) || num < -180 || num > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }
    return true;
  }),
  body('manualLocation').optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
  body('helperNote').optional({ checkFalsy: true }).trim().isLength({ max: 1000 })
], async (req, res) => {
  try {
    // Check if this is a programmatic request (from sync)
    const isProgrammatic = req.headers['x-requested-with'] === 'XMLHttpRequest' || 
                          req.headers['accept']?.includes('application/json');
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const relevantErrors = errors.array().filter(err => 
        !['latitude', 'longitude'].includes(err.param) || err.value
      );
      if (relevantErrors.length > 0) {
        if (isProgrammatic) {
          return res.status(400).json({
            success: false,
            error: 'Invalid form data',
            details: relevantErrors
          });
        }
        return res.status(400).render('error', {
          message: 'Invalid form data',
          error: relevantErrors
        });
      }
    }

    const { qrToken, latitude, longitude, manualLocation, helperNote } = req.body;

    const vehicle = await prisma.vehicle.findUnique({
      where: { qrToken },
      include: {
        emergencyContacts: true,
        user: { select: { id: true, name: true } }
      }
    });

    if (!vehicle) {
      if (isProgrammatic) {
        return res.status(404).json({
          success: false,
          error: 'Invalid QR code. Vehicle not found.'
        });
      }
      return res.status(404).render('error', {
        message: 'Invalid QR code. Vehicle not found.',
        error: null
      });
    }

    const lat = latitude ? parseFloat(latitude) : null;
    const lng = longitude ? parseFloat(longitude) : null;

    // Log received files for debugging
    console.log(`📷 Received ${req.files ? req.files.length : 0} file(s) for accident report`);
    if (req.files && req.files.length > 0) {
      req.files.forEach((file, index) => {
        console.log(`  File ${index + 1}: ${file.originalname || file.filename || file.key} (${file.size || 'unknown size'} bytes, type: ${file.mimetype || file.contentType || 'unknown'})`);
        console.log(`    - Location: ${file.location || 'N/A'}`);
        console.log(`    - Key: ${file.key || 'N/A'}`);
        console.log(`    - Filename: ${file.filename || 'N/A'}`);
      });
    } else {
      console.warn('⚠️ No files received in request');
    }

    const imageUrls = (req.files || []).map(file => {
      const url = file.location || getFileUrl(file.filename || file.key);
      console.log(`  🔗 Mapping file to URL: ${file.filename || file.key} -> ${url || 'NULL'}`);
      return url;
    }).filter(Boolean);

    // Log image URLs for debugging
    console.log(`📸 Generated ${imageUrls.length} image URL(s):`);
    if (imageUrls.length > 0) {
      imageUrls.forEach((url, index) => {
        console.log(`  Image ${index + 1} URL: ${url}`);
      });
    } else if (req.files && req.files.length > 0) {
      console.error('❌ ERROR: Files were uploaded but no URLs were generated!');
      console.error('   This might indicate S3 is not configured and local storage is not accessible.');
      console.error(`   BASE_URL: ${process.env.BASE_URL || 'NOT SET'}`);
      console.error(`   S3_CONFIGURED: ${process.env.S3_ACCESS_KEY_ID ? 'YES' : 'NO'}`);
    }
    
    // Warn if no images and this might be a sync issue
    if (imageUrls.length === 0 && req.files && req.files.length === 0) {
      console.warn('⚠️  No images in request - this might be an offline sync issue');
    }

    const accidentReport = await prisma.accidentReport.create({
      data: {
        vehicleId: vehicle.id,
        lat,
        lng,
        manualLocation: manualLocation?.trim() || null,
        helperNote: helperNote?.trim() || null,
        images: { create: imageUrls.map(url => ({ imageUrl: url })) }
      },
      include: { images: true }
    });

    // Prepare notification data
    const vehicleData = {
          licensePlate: vehicle.licensePlate,
          model: vehicle.model,
          color: vehicle.color
    };

    // Send EMAIL ONLY to all emergency contacts (online mode)
    // SMS is sent separately via /report-offline endpoint when offline
    const notificationPromises = vehicle.emergencyContacts.map(contact => 
      sendAccidentAlertEmail({
        vehicle: vehicleData,
        contact: { name: contact.name, email: contact.email },
        lat, lng, imageUrls,
        helperNote: helperNote || null,
        manualLocation: manualLocation || null
      }).catch(err => {
        console.error(`Failed to send email to ${contact.email}:`, err);
        return { success: false };
      })
    );

    console.log('⏳ Sending email notifications to', vehicle.emergencyContacts.length, 'contact(s)...');
    await Promise.all(notificationPromises);
    console.log('✅ All email notifications sent!');

    // Check if this is a programmatic request (from sync) - return JSON
    if (isProgrammatic) {
      return res.json({
        success: true,
        message: 'Emergency report received. Emergency contacts have been notified via email.',
        reportId: accidentReport.id,
        notificationCount: vehicle.emergencyContacts.length
      });
    }

    // Otherwise return HTML for browser form submissions
    res.render('accidents/thankyou', {
      vehicleLicensePlate: vehicle.licensePlate,
      notificationCount: vehicle.emergencyContacts.length
    });
  } catch (error) {
    console.error('Error processing accident report:', error);
    // Check if this is a programmatic request (from sync)
    const isProgrammatic = req.headers['x-requested-with'] === 'XMLHttpRequest' || 
                          req.headers['accept']?.includes('application/json');
    if (isProgrammatic) {
      return res.status(500).json({
        success: false,
        error: 'Error processing your report. Please try again.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    res.status(500).render('error', {
      message: 'Error processing your report. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error : null
    });
  }
});

// Offline Report Endpoint: Sends SMS only (for cellular network submissions)
// This endpoint is used when internet is down but cellular is available
// Bystander never sees emergency contacts - server sends SMS directly
router.post('/report-offline', (req, res, next) => {
  uploadMultiple(req, res, (err) => {
    if (err) {
      console.error('File upload error:', err);
      const messages = {
        'LIMIT_FILE_SIZE': 'File too large. Maximum size is 100MB per file.',
        'LIMIT_FILE_COUNT': 'Too many files. Maximum 10 images allowed.'
      };
      return res.status(400).json({
        success: false,
        error: messages[err.code] || `File upload error: ${err.message || 'Unknown error'}`
      });
    }
    next();
  });
}, [
  body('qrToken').notEmpty(),
  body('latitude').optional({ checkFalsy: true }).custom((value) => {
    if (value === '' || value === null || value === undefined) {
      return true;
    }
    const num = parseFloat(value);
    if (isNaN(num) || num < -90 || num > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }
    return true;
  }),
  body('longitude').optional({ checkFalsy: true }).custom((value) => {
    if (value === '' || value === null || value === undefined) {
      return true;
    }
    const num = parseFloat(value);
    if (isNaN(num) || num < -180 || num > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }
    return true;
  }),
  body('manualLocation').optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
  body('helperNote').optional({ checkFalsy: true }).trim().isLength({ max: 1000 })
], async (req, res) => {
  try {
    console.log('📱 ===== OFFLINE REPORT RECEIVED =====');
    console.log('📱 Request method:', req.method);
    console.log('📱 Request headers:', JSON.stringify(req.headers, null, 2));
    console.log('📱 Request body keys:', Object.keys(req.body));
    console.log('📱 Files received:', req.files ? req.files.length : 0);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ Validation errors:', errors.array());
      const relevantErrors = errors.array().filter(err => 
        !['latitude', 'longitude'].includes(err.param) || err.value
      );
      if (relevantErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid form data',
          details: relevantErrors
        });
      }
    }

    const { qrToken, latitude, longitude, manualLocation, helperNote } = req.body;
    console.log('📱 Report data:', { qrToken, latitude, longitude, manualLocation, helperNote });

    const vehicle = await prisma.vehicle.findUnique({
      where: { qrToken },
      include: {
        emergencyContacts: true,
        user: { select: { id: true, name: true } }
      }
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        error: 'Invalid QR code. Vehicle not found.'
      });
    }

    const lat = latitude ? parseFloat(latitude) : null;
    const lng = longitude ? parseFloat(longitude) : null;

    // Get image URLs (if any - images may not be available via cellular)
    const imageUrls = (req.files || []).map(file => {
      const url = file.location || getFileUrl(file.filename || file.key);
      return url;
    }).filter(Boolean);

    // Create accident report in database
    const accidentReport = await prisma.accidentReport.create({
      data: {
        vehicleId: vehicle.id,
        lat,
        lng,
        manualLocation: manualLocation?.trim() || null,
        helperNote: helperNote?.trim() || null,
        images: { create: imageUrls.map(url => ({ imageUrl: url })) }
      },
      include: { images: true }
    });

    // Prepare notification data
    const vehicleData = {
      licensePlate: vehicle.licensePlate,
      model: vehicle.model,
      color: vehicle.color
    };

    // Send SMS ONLY to all emergency contacts (no email - internet is down)
    // Bystander never sees these phone numbers - server handles it
    console.log('📱 ===== OFFLINE MODE: SENDING SMS NOTIFICATIONS =====');
    console.log('📱 Emergency contacts count:', vehicle.emergencyContacts.length);
    console.log('📱 Emergency contacts:', vehicle.emergencyContacts.map(c => ({ 
      name: c.name, 
      phone: c.phoneNumber,
      phoneRaw: c.phoneNumber,
      phoneLength: c.phoneNumber ? c.phoneNumber.replace(/\D/g, '').length : 0
    })));
    console.log('📱 Fast2SMS configured:', !!process.env.FAST2SMS_API_KEY);
    console.log('📱 Twilio configured:', !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN));
    
    const smsPromises = vehicle.emergencyContacts.map(contact => {
      console.log(`📱 Preparing SMS for ${contact.name} (${contact.phoneNumber})...`);
      return sendAccidentAlertSMS({
        vehicle: vehicleData,
        contact: { name: contact.name, phoneNumber: contact.phoneNumber },
        lat, lng, imageUrls,
        helperNote: helperNote || null,
        manualLocation: manualLocation || null
      }).then(result => {
        console.log(`📱 SMS result for ${contact.name} (${contact.phoneNumber}):`, result);
        return result;
      }).catch(err => {
        console.error(`❌ Failed to send SMS to ${contact.phoneNumber}:`, err);
        console.error(`   Error details:`, err.message, err.stack);
        return { success: false, error: err.message };
      });
    });

    const smsResults = await Promise.all(smsPromises);
    console.log('📱 ===== SMS SENDING COMPLETE =====');
    console.log('📱 SMS sending results:', JSON.stringify(smsResults, null, 2));
    const successCount = smsResults.filter(r => r && r.success).length;
    const failedCount = smsResults.filter(r => !r || !r.success).length;
    console.log(`📱 Summary: ${successCount} succeeded, ${failedCount} failed out of ${vehicle.emergencyContacts.length} total`);
    
    if (successCount === 0 && vehicle.emergencyContacts.length > 0) {
      console.error('❌ WARNING: No SMS messages were sent successfully!');
      console.error('   This might indicate:');
      console.error('   1. Fast2SMS API key not configured (check FAST2SMS_API_KEY in .env)');
      console.error('   2. Phone numbers are not Indian numbers (Fast2SMS only works for India)');
      console.error('   3. Twilio not configured for international numbers');
    }

    // Return JSON response (for offline cellular submissions)
    res.json({
      success: true,
      message: 'Emergency report received via cellular network. Emergency contacts have been notified via SMS.',
      reportId: accidentReport.id
    });
  } catch (error) {
    console.error('Error processing offline accident report:', error);
    res.status(500).json({
      success: false,
      error: 'Error processing your report. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// SMS Webhook: Receives SMS from bystanders when offline
// Supports both Twilio and Telerivet webhook formats
router.post('/sms-webhook', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  try {
    // Detect webhook format (Twilio or Telerivet)
    // Twilio sends: From, Body, To (form-urlencoded)
    // Telerivet sends: event, from_number, content, phone_id (JSON or form-urlencoded)
    let fromNumber, messageBody, toNumber, webhookSource;
    
    if (req.body.From && req.body.Body) {
      // Twilio format
      webhookSource = 'Twilio';
      fromNumber = req.body.From;
      messageBody = req.body.Body;
      toNumber = req.body.To;
    } else if (req.body.from_number && req.body.content) {
      // Telerivet format
      webhookSource = 'Telerivet';
      fromNumber = req.body.from_number;
      messageBody = req.body.content;
      toNumber = req.body.phone_id || req.body.to_number;
    } else if (req.body.event === 'incoming_message' || req.body.event === 'message_received') {
      // Telerivet format (alternative)
      webhookSource = 'Telerivet';
      fromNumber = req.body.from_number || req.body.from;
      messageBody = req.body.content || req.body.message || req.body.body;
      toNumber = req.body.phone_id || req.body.to_number || req.body.to;
    } else {
      // Unknown format - log and try to extract
      console.log('⚠️ Unknown webhook format. Request body:', JSON.stringify(req.body));
      webhookSource = 'Unknown';
      // Try to extract common fields
      fromNumber = req.body.from_number || req.body.From || req.body.from;
      messageBody = req.body.content || req.body.Body || req.body.body || req.body.message;
      toNumber = req.body.phone_id || req.body.To || req.body.to_number || req.body.to;
    }
    
    console.log(`📱 ===== SMS WEBHOOK RECEIVED (${webhookSource}) =====`);
    console.log('📱 From:', fromNumber);
    console.log('📱 Message:', messageBody);
    console.log('📱 To:', toNumber);
    console.log('📱 Full request body:', JSON.stringify(req.body));
    
    if (!messageBody) {
      console.error('❌ No message body found in webhook');
      return res.status(400).json({ error: 'No message body found' });
    }
    
    // Parse SMS message format: "REPORT [TOKEN] [LAT] [LNG] [NOTE]"
    const parts = messageBody.trim().split(/\s+/);
    
    // Check if message starts with "REPORT"
    if (parts[0] !== 'REPORT') {
      console.error('❌ Invalid SMS format. Expected "REPORT" command.');
      // Return appropriate response format based on webhook source
      if (webhookSource === 'Telerivet') {
        return res.status(400).json({ 
          error: 'Invalid format. Expected: REPORT [TOKEN] [LOCATION] [NOTE]' 
        });
      } else {
        // Twilio format (XML)
        res.type('text/xml');
        return res.send(`
          <?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Message>Invalid format. Expected: REPORT [TOKEN] [LOCATION] [NOTE]</Message>
          </Response>
        `);
      }
    }
    
    // Extract QR token (second part)
    const qrToken = parts[1];
    if (!qrToken) {
      console.error('❌ Missing QR token in SMS');
      if (webhookSource === 'Telerivet') {
        return res.status(400).json({ 
          error: 'Missing vehicle token. Please include token after REPORT.' 
        });
      } else {
        res.type('text/xml');
        return res.send(`
          <?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Message>Missing vehicle token. Please include token after REPORT.</Message>
          </Response>
        `);
      }
    }
    
    // Extract location and note
    let lat = null;
    let lng = null;
    let manualLocation = null;
    let helperNote = null;
    
    // Check if location is coordinates (numbers) or text
    if (parts.length >= 4 && !isNaN(parseFloat(parts[2])) && !isNaN(parseFloat(parts[3]))) {
      // Parse latitude and longitude
      lat = parseFloat(parts[2]);
      lng = parseFloat(parts[3]);
      
      // Extract note if present (everything after coordinates)
      if (parts.length > 4) {
        const noteIndex = parts.indexOf('NOTE');
        if (noteIndex !== -1 && parts[noteIndex + 1]) {
          helperNote = parts.slice(noteIndex + 1).join(' ');
        }
      }
    } else {
      // Check for "LOCATION" keyword (manual location)
      const locationIndex = parts.indexOf('LOCATION');
      if (locationIndex !== -1 && parts[locationIndex + 1]) {
        manualLocation = parts.slice(locationIndex + 1).join(' ');
        // Check if there's a NOTE after LOCATION
        const noteIndex = parts.indexOf('NOTE', locationIndex);
        if (noteIndex !== -1 && parts[noteIndex + 1]) {
          helperNote = parts.slice(noteIndex + 1).join(' ');
          // Remove NOTE from manualLocation
          manualLocation = parts.slice(locationIndex + 1, noteIndex).join(' ');
        }
      } else {
        // Check for "NOTE" keyword
        const noteIndex = parts.indexOf('NOTE');
        if (noteIndex !== -1 && parts[noteIndex + 1]) {
          helperNote = parts.slice(noteIndex + 1).join(' ');
        }
      }
    }
    
    // Look up vehicle by QR token
    const vehicle = await prisma.vehicle.findUnique({
      where: { qrToken },
      include: {
        emergencyContacts: true,
        user: { 
          select: { 
            id: true, 
            name: true 
          } 
        }
      }
    });
    
    // Check if vehicle exists
    if (!vehicle) {
      console.error('❌ Vehicle not found for token:', qrToken);
      if (webhookSource === 'Telerivet') {
        return res.status(404).json({ 
          error: 'Vehicle not found. Invalid QR code token.' 
        });
      } else {
        res.type('text/xml');
        return res.send(`
          <?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Message>Vehicle not found. Invalid QR code token.</Message>
          </Response>
        `);
      }
    }
    
    // Check if vehicle has emergency contacts
    if (!vehicle.emergencyContacts || vehicle.emergencyContacts.length === 0) {
      console.error('❌ No emergency contacts for vehicle:', vehicle.licensePlate);
      if (webhookSource === 'Telerivet') {
        return res.status(400).json({ 
          error: 'No emergency contacts configured for this vehicle.' 
        });
      } else {
        res.type('text/xml');
        return res.send(`
          <?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Message>No emergency contacts configured for this vehicle.</Message>
          </Response>
        `);
      }
    }
    
    // Save accident report to database
    const accidentReport = await prisma.accidentReport.create({
      data: {
        vehicleId: vehicle.id,
        lat: lat,
        lng: lng,
        manualLocation: manualLocation,
        helperNote: helperNote,
        // Note: Images not available via SMS, so empty array
        images: { create: [] }
      }
    });
    
    console.log('✅ Accident report created:', accidentReport.id);
    
    // Prepare vehicle data for notifications
    const vehicleData = {
      licensePlate: vehicle.licensePlate,
      model: vehicle.model,
      color: vehicle.color
    };
    
    // Send SMS to all emergency contacts in parallel
    const smsPromises = vehicle.emergencyContacts.map(contact => {
      return sendAccidentAlertSMS({
        vehicle: vehicleData,
        contact: { 
          name: contact.name, 
          phoneNumber: contact.phoneNumber 
        },
        lat: lat,
        lng: lng,
        imageUrls: [],  // No images via SMS
        helperNote: helperNote,
        manualLocation: manualLocation
      }).catch(err => {
        // Log error but don't fail entire process
        console.error(`❌ Failed to send SMS to ${contact.phoneNumber}:`, err);
        return { success: false, error: err.message };
      });
    });
    
    // Wait for all SMS to be sent
    const results = await Promise.all(smsPromises);
    
    // Count successful sends
    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Sent SMS to ${successCount}/${vehicle.emergencyContacts.length} emergency contacts`);
    
    // Send appropriate response based on webhook source
    if (webhookSource === 'Telerivet') {
      // Telerivet expects JSON response
      return res.json({ 
        success: true,
        message: 'Emergency report received. Emergency contacts have been notified.',
        reportId: accidentReport.id,
        contactsNotified: successCount
      });
    } else {
      // Twilio expects XML response
      res.type('text/xml');
      return res.send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>Emergency report received. Emergency contacts have been notified.</Message>
        </Response>
      `);
    }
  } catch (error) {
    console.error('❌ Error processing SMS webhook:', error);
    console.error('   Error stack:', error.stack);
    
    // Detect webhook source for error response
    const isTelerivet = req.body.from_number || req.body.content || req.body.event === 'incoming_message';
    
    if (isTelerivet) {
      return res.status(500).json({ 
        error: 'Error processing report. Please try again later.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else {
      res.type('text/xml');
      return res.send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>Error processing report. Please try again later.</Message>
        </Response>
      `);
    }
  }
});

module.exports = router;