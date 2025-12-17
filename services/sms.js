// SMS Service
// Sends emergency alert SMS notifications via Twilio

const twilio = require('twilio');

// Create Twilio client (only if Twilio is configured)
let twilioClient = null;

// Initialize Twilio client if credentials are available
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  console.log('✅ Twilio SMS service is ready');
} else {
  console.warn('⚠️  Twilio not configured. SMS notifications will not be sent.');
  console.warn('   Please add Twilio settings to .env file to enable SMS notifications.');
  console.warn('   Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER');
}

async function sendAccidentAlertSMS({ vehicle, contact, lat, lng, imageUrls = [], helperNote, manualLocation }) {
  // Check if Twilio is configured
  if (!twilioClient) {
    const errorMsg = 'Twilio not configured. Please configure Twilio settings in .env file (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).';
    console.error('❌ SMS not sent to', contact.phoneNumber, '-', errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
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

    // Build SMS message (SMS has 160 character limit per message, but Twilio supports longer messages that get split)
    // Keep it concise but informative
    let message = `🚨 EMERGENCY ALERT\n\n`;
    message += `Vehicle: ${vehicle.licensePlate}\n`;
    if (vehicle.model) message += `Model: ${vehicle.model}\n`;
    if (vehicle.color) message += `Color: ${vehicle.color}\n`;
    message += `Time: ${new Date().toLocaleString()}\n\n`;
    
    if (locationText) {
      message += `${locationText}\n\n`;
    }
    
    if (helperNote) {
      message += `Note: ${helperNote}\n\n`;
    }
    
    if (imageUrls.length > 0) {
      message += `Photos: ${imageUrls.length} image(s) available\n`;
      // Include first image URL if available (SMS can contain URLs)
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
    
    const messageResult = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_FROM_NUMBER,
      to: contact.phoneNumber
    });

    console.log(`✅ SMS sent successfully to ${contact.phoneNumber}! SID: ${messageResult.sid}`);
    return { success: true, messageSid: messageResult.sid };
  } catch (error) {
    console.error('❌ Error sending SMS to', contact.phoneNumber, ':');
    console.error('   Error message:', error.message);
    console.error('   Error code:', error.code || 'N/A');
    
    // Provide helpful error messages
    let errorMsg = error.message;
    if (error.code === 21211) {
      errorMsg = 'Invalid phone number format. Phone numbers must be in E.164 format (e.g., +1234567890).';
    } else if (error.code === 21608) {
      errorMsg = 'Twilio account does not have permission to send SMS to this number.';
    } else if (error.code === 21614) {
      errorMsg = 'Invalid "from" phone number. Check TWILIO_FROM_NUMBER in .env.';
    } else if (error.code === 20003) {
      errorMsg = 'Twilio authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.';
    }
    
    return { success: false, error: errorMsg, details: error.message };
  }
}

module.exports = {
  sendAccidentAlertSMS
};



