// SMS Service
// Sends emergency alert SMS notifications via Fast2SMS (India) or Twilio (International)

const twilio = require('twilio');
const https = require('https');

// Initialize Twilio client (only if Twilio is configured)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  console.log('✅ Twilio SMS service is ready');
}

// Initialize Fast2SMS (India - no DLT registration needed)
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;
if (FAST2SMS_API_KEY) {
  console.log('✅ Fast2SMS service is ready (India - Quick SMS, no DLT)');
} else {
  console.warn('⚠️  Fast2SMS not configured. SMS notifications to India will not be sent.');
  console.warn('   Please add FAST2SMS_API_KEY to .env file to enable SMS notifications.');
}

// Helper function to format Indian phone numbers for Fast2SMS
function formatIndianPhoneNumber(phoneNumber) {
  // Remove any non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Remove country code if present (+91, 91, etc.)
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('91') && cleaned.length > 12) {
    cleaned = cleaned.substring(2, 12);
  }
  
  // Ensure it's 10 digits (Indian mobile numbers)
  if (cleaned.length === 10) {
    return cleaned;
  }
  
  // If still not 10 digits, return as is (let Fast2SMS handle validation)
  return cleaned;
}

// Helper function to check if phone number is Indian
function isIndianNumber(phoneNumber) {
  const cleaned = phoneNumber.replace(/\D/g, '');
  // Indian numbers: +91 or 91 followed by 10 digits, or just 10 digits
  return cleaned.length === 10 || (cleaned.startsWith('91') && cleaned.length === 12);
}

// Send SMS via Fast2SMS (India - Quick SMS, no DLT)
async function sendViaFast2SMS(phoneNumber, message) {
  if (!FAST2SMS_API_KEY) {
    throw new Error('Fast2SMS API key not configured');
  }

  const formattedNumber = formatIndianPhoneNumber(phoneNumber);
  
  // Fast2SMS API endpoint
  const url = 'https://www.fast2sms.com/dev/bulkV2';
  
  const payload = JSON.stringify({
    route: 'q', // 'q' for Quick SMS (no DLT registration needed)
    message: message,
    language: 'english',
    numbers: formattedNumber
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.fast2sms.com',
      path: '/dev/bulkV2',
      method: 'POST',
      headers: {
        'authorization': FAST2SMS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.return === true) {
            console.log(`✅ Fast2SMS: SMS sent successfully to ${formattedNumber}`);
            console.log(`   Request ID: ${response.request_id || 'N/A'}`);
            resolve({ success: true, requestId: response.request_id });
          } else {
            const errorMsg = response.message || 'Unknown error from Fast2SMS';
            console.error(`❌ Fast2SMS error: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        } catch (parseError) {
          console.error('❌ Fast2SMS: Error parsing response:', parseError);
          reject(new Error('Failed to parse Fast2SMS response'));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Fast2SMS: Request error:', error);
      reject(error);
    });

    req.write(payload);
    req.end();
  });
}

// Send SMS via Twilio (International)
async function sendViaTwilio(phoneNumber, message) {
  if (!twilioClient) {
    throw new Error('Twilio not configured');
  }

  const messageResult = await twilioClient.messages.create({
    body: message,
    from: process.env.TWILIO_FROM_NUMBER,
    to: phoneNumber
  });

  return { success: true, messageSid: messageResult.sid };
}

async function sendAccidentAlertSMS({ vehicle, contact, lat, lng, imageUrls = [], helperNote, manualLocation }) {
  // Build Google Maps link
  let mapsLink = '';
  if (lat && lng) {
    mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
  }

  // Build location text
  let locationText = '';
  if (mapsLink) {
    locationText = `Location: ${mapsLink}`;
  }
  if (manualLocation) {
    locationText += locationText ? `\nDescription: ${manualLocation}` : `Location: ${manualLocation}`;
  }

  // Build SMS message (keep it concise - SMS has 160 character limit)
  let message = `🚨 EMERGENCY ALERT\n\n`;
  message += `Vehicle: ${vehicle.licensePlate}\n`;
  if (vehicle.model) message += `Model: ${vehicle.model}\n`;
  if (vehicle.color) message += `Color: ${vehicle.color}\n`;
  message += `Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n`;
  
  if (locationText) {
    message += `${locationText}\n\n`;
  }
  
  if (helperNote) {
    // Truncate note if too long
    const maxNoteLength = 100;
    const truncatedNote = helperNote.length > maxNoteLength 
      ? helperNote.substring(0, maxNoteLength) + '...' 
      : helperNote;
    message += `Note: ${truncatedNote}\n\n`;
  }
  
  if (imageUrls.length > 0) {
    message += `Photos: ${imageUrls.length} image(s) available\n`;
    if (imageUrls[0]) {
      message += `View: ${imageUrls[0]}\n`;
    }
  }
  
  message += `\nThis is an automated alert from Vehicle Safety QR System.`;

  console.log(`📱 Sending SMS to: ${contact.phoneNumber}`);
  console.log(`   - Vehicle: ${vehicle.licensePlate}`);
  console.log(`   - Location: ${lat && lng ? `${lat}, ${lng}` : manualLocation || 'Not provided'}`);
  console.log(`   - Photos: ${imageUrls.length} image(s)`);
  console.log(`   - Helper Note: ${helperNote ? 'Yes' : 'No'}`);

  // Try Fast2SMS first for Indian numbers, fallback to Twilio
  try {
    if (isIndianNumber(contact.phoneNumber) && FAST2SMS_API_KEY) {
      console.log('   - Using Fast2SMS (India - Quick SMS, no DLT)');
      const result = await sendViaFast2SMS(contact.phoneNumber, message);
      return result;
    } else if (twilioClient) {
      console.log('   - Using Twilio (International)');
      const result = await sendViaTwilio(contact.phoneNumber, message);
      return result;
    } else {
      const errorMsg = 'No SMS service configured. Please configure Fast2SMS (for India) or Twilio (for International).';
      console.error('❌ SMS not sent to', contact.phoneNumber, '-', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('❌ Error sending SMS to', contact.phoneNumber, ':');
    console.error('   Error message:', error.message);
    
    // Try fallback if Fast2SMS fails and Twilio is available
    if (isIndianNumber(contact.phoneNumber) && FAST2SMS_API_KEY && twilioClient) {
      console.log('   - Fast2SMS failed, trying Twilio as fallback...');
      try {
        const result = await sendViaTwilio(contact.phoneNumber, message);
        return result;
      } catch (twilioError) {
        console.error('   - Twilio fallback also failed:', twilioError.message);
      }
    }
    
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendAccidentAlertSMS
};



