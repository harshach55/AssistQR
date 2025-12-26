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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const relevantErrors = errors.array().filter(err => 
        !['latitude', 'longitude'].includes(err.param) || err.value
      );
      if (relevantErrors.length > 0) {
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

    // Send notifications to all emergency contacts in parallel
    const notificationPromises = vehicle.emergencyContacts.flatMap(contact => [
      sendAccidentAlertEmail({
        vehicle: vehicleData,
        contact: { name: contact.name, email: contact.email },
        lat, lng, imageUrls,
        helperNote: helperNote || null,
        manualLocation: manualLocation || null
      }).catch(err => {
        console.error(`Failed to send email to ${contact.email}:`, err);
        return { success: false };
      }),
      sendAccidentAlertSMS({
        vehicle: vehicleData,
        contact: { name: contact.name, phoneNumber: contact.phoneNumber },
        lat, lng, imageUrls,
        helperNote: helperNote || null,
        manualLocation: manualLocation || null
      }).catch(err => {
        console.error(`Failed to send SMS to ${contact.phoneNumber}:`, err);
        return { success: false };
      })
    ]);

    console.log('⏳ Sending notifications to', vehicle.emergencyContacts.length, 'contact(s)...');
    await Promise.all(notificationPromises);
    console.log('✅ All notifications sent!');

    res.render('accidents/thankyou', {
      vehicleLicensePlate: vehicle.licensePlate,
      notificationCount: vehicle.emergencyContacts.length
    });
  } catch (error) {
    console.error('Error processing accident report:', error);
    res.status(500).render('error', {
      message: 'Error processing your report. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error : null
    });
  }
});

// SMS Webhook: Receives SMS from bystanders when offline
// Twilio sends POST requests to this endpoint when SMS is received
router.post('/sms-webhook', express.raw({ type: 'application/x-www-form-urlencoded' }), async (req, res) => {
  try {
    // Parse incoming SMS data from Twilio
    const { From, Body, To } = req.body;
    
    console.log('📱 Received SMS from:', From);
    console.log('📱 SMS body:', Body);
    console.log('📱 To number:', To);
    
    // Parse SMS message format: "REPORT [TOKEN] [LAT] [LNG] [NOTE]"
    const parts = Body.trim().split(/\s+/);
    
    // Check if message starts with "REPORT"
    if (parts[0] !== 'REPORT') {
      console.error('❌ Invalid SMS format. Expected "REPORT" command.');
      res.type('text/xml');
      return res.send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>Invalid format. Expected: REPORT [TOKEN] [LAT] [LNG] [NOTE]</Message>
        </Response>
      `);
    }
    
    // Extract QR token (second part)
    const qrToken = parts[1];
    if (!qrToken) {
      console.error('❌ Missing QR token in SMS');
      res.type('text/xml');
      return res.send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>Missing vehicle token. Please include token after REPORT.</Message>
        </Response>
      `);
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
      res.type('text/xml');
      return res.send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>Vehicle not found. Invalid QR code token.</Message>
        </Response>
      `);
    }
    
    // Check if vehicle has emergency contacts
    if (!vehicle.emergencyContacts || vehicle.emergencyContacts.length === 0) {
      console.error('❌ No emergency contacts for vehicle:', vehicle.licensePlate);
      res.type('text/xml');
      return res.send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>No emergency contacts configured for this vehicle.</Message>
        </Response>
      `);
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
    
    // Send response to Twilio (required)
    res.type('text/xml');
    res.send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message>Emergency report received. Emergency contacts have been notified.</Message>
      </Response>
    `);
  } catch (error) {
    console.error('❌ Error processing SMS webhook:', error);
    res.type('text/xml');
    res.send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message>Error processing report. Please try again later.</Message>
      </Response>
    `);
  }
});

module.exports = router;

