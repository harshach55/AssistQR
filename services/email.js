// Email Service
// Sends emergency alert emails with vehicle details, location, and photos

const nodemailer = require('nodemailer');
const https = require('https');
const http = require('http');
const { URL } = require('url');

let transporter = null;
let useResend = false;

// Support for Resend (no phone verification), SendGrid, or SMTP
if (process.env.RESEND_API_KEY) {
  // Use Resend API (no phone verification required, works with Render free tier)
  useResend = true;
  console.log('✅ Resend API configured');
} else if (process.env.SENDGRID_API_KEY) {
  // Use SendGrid (works better with Render free tier)
  transporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY
    }
  });
  console.log('✅ SendGrid transporter configured');
} else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  // Use SMTP (Gmail, etc.)
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 60000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    requireTLS: true,
    tls: {
      rejectUnauthorized: false,
      ciphers: 'SSLv3'
    }
  });

  // Verify connection (disabled on startup to avoid timeout issues on Render)
  // Connection will be verified when actually sending emails
  if (process.env.NODE_ENV !== 'production') {
    transporter.verify(function(error, success) {
      if (error) {
        console.error('❌ SMTP connection error:', error.message);
      } else {
        console.log('✅ SMTP server is ready to send emails');
      }
    });
  } else {
    console.log('✅ SMTP transporter configured (verification skipped in production)');
  }
} else {
  console.warn('⚠️  Email not configured. Email notifications will not be sent.');
  console.warn('   Please add RESEND_API_KEY (recommended, no phone verification), SENDGRID_API_KEY, or SMTP settings to enable email notifications.');
}

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    try {
      const uploadsPath = path.join(__dirname, '..', 'uploads', 'accidents');
      
      if (url.includes('/uploads/accidents/')) {
        const filename = url.split('/uploads/accidents/')[1]?.split('?')[0];
        if (filename) {
        const filePath = path.join(uploadsPath, filename);
        
        if (fs.existsSync(filePath)) {
          try {
            const buffer = fs.readFileSync(filePath);
            resolve(buffer);
            return;
          } catch (error) {
            console.warn(`   ⚠️  Could not read local file, trying HTTP download: ${error.message}`);
            }
          }
        }
      }
      
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const request = client.get(url, {
        timeout: 5000
      }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image: ${response.statusCode}`));
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
      
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Image download timeout'));
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function sendAccidentAlertEmail({ vehicle, contact, lat, lng, imageUrls = [], helperNote, manualLocation }) {
  if (!transporter && !useResend) {
    const errorMsg = 'Email not configured. Please add RESEND_API_KEY, SENDGRID_API_KEY, or SMTP settings in .env file.';
    console.error('❌ Email not sent to', contact.email, '-', errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
    const mapsLink = (lat && lng) ? `https://www.google.com/maps?q=${lat},${lng}` : '';
    const locationText = [
      mapsLink && `Location: ${mapsLink}`,
      manualLocation && `Manual location description: ${manualLocation}`
    ].filter(Boolean).join('\n') + (mapsLink || manualLocation ? '\n' : '');

    const attachments = [];
    const imageCids = [];
    
    if (imageUrls.length > 0) {
      console.log(`   - Processing ${imageUrls.length} image(s) for email attachment...`);
      
      const imagePromises = imageUrls.map(async (url, i) => {
        try {
          const imageBuffer = await downloadImage(url);
          if (imageBuffer) {
            const cid = `image_${i}_${Date.now()}`;
            imageCids.push(cid);
            
            let optimizedBuffer;
            try {
              optimizedBuffer = await sharp(imageBuffer)
                .resize(1200, null, { 
                  withoutEnlargement: true,
                  fit: 'inside'
                })
                .jpeg({ 
                  quality: 85,
                  mozjpeg: true
                })
                .toBuffer();
              
              if (optimizedBuffer.length < imageBuffer.length) {
                imageBuffer = optimizedBuffer;
              }
            } catch (sharpError) {
              console.warn(`   ⚠️  Could not optimize image ${i + 1}, using original:`, sharpError.message);
            }
            
            return {
              filename: `accident_photo_${i + 1}.jpg`,
              content: imageBuffer,
              cid: cid,
              contentType: 'image/jpeg'
            };
          }
        } catch (error) {
          console.warn(`   ⚠️  Could not process image ${i + 1} (${url}):`, error.message);
          return null;
        }
      });
      
      const imageResults = await Promise.all(imagePromises);
      attachments.push(...imageResults.filter(result => result !== null));
    }

    let imagesHtml = '';
    if (imageUrls.length > 0) {
      imagesHtml = '\n\nAccident Photos:\n';
      imageUrls.forEach((url, index) => {
        imagesHtml += `${index + 1}. ${url}\n`;
      });
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_NAME ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>` : (process.env.SMTP_FROM || process.env.SMTP_USER),
      to: contact.email,
      subject: `🚨 URGENT: Emergency Alert - Possible Accident Involving Vehicle ${vehicle.licensePlate}`,
      priority: 'high',
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        'Priority': 'urgent'
      },
      text: `
Emergency Alert: Possible Accident Report

Vehicle Information:
- License Plate: ${vehicle.licensePlate}
- Model: ${vehicle.model || 'Not specified'}
- Color: ${vehicle.color || 'Not specified'}

Time of Report: ${new Date().toLocaleString()}

${locationText}
${helperNote ? `Helper Note: ${helperNote}\n` : ''}${imagesHtml}

If you believe this is a false alarm, please contact the vehicle owner directly.

---
⚠️ IMPORTANT: Please do not reply to this email address (noreply.assistqr@gmail.com) as it is not monitored. This mailbox does not receive or respond to messages. If you need to contact someone regarding this alert, please reach out to the vehicle owner directly.

Thank you,
AssistQR - Vehicle Safety System
      `.trim(),
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #dc3545; color: white; padding: 20px; text-align: center; }
            .content { background-color: #f9f9f9; padding: 20px; }
            .section { margin-bottom: 20px; }
            .section h3 { color: #dc3545; border-bottom: 2px solid #dc3545; padding-bottom: 5px; }
            .info-row { margin: 10px 0; }
            .label { font-weight: bold; }
            .button { display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
            .images { margin-top: 20px; }
            .images img { max-width: 100%; height: auto; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 Emergency Alert</h1>
            </div>
            <div class="content">
              <div class="section">
                <h3>Vehicle Information</h3>
                <div class="info-row"><span class="label">License Plate:</span> ${vehicle.licensePlate}</div>
                <div class="info-row"><span class="label">Model:</span> ${vehicle.model || 'Not specified'}</div>
                <div class="info-row"><span class="label">Color:</span> ${vehicle.color || 'Not specified'}</div>
              </div>
              
              <div class="section">
                <h3>Report Details</h3>
                <div class="info-row"><span class="label">Time of Report:</span> ${new Date().toLocaleString()}</div>
                ${mapsLink ? `<div class="info-row"><a href="${mapsLink}" class="button">📍 View Location on Google Maps</a></div>` : ''}
                ${manualLocation ? `<div class="info-row"><span class="label">Location Description:</span> ${manualLocation}</div>` : ''}
                ${helperNote ? `<div class="info-row"><span class="label">Helper Note:</span> ${helperNote}</div>` : ''}
              </div>
              
              ${imageCids.length > 0 ? `
              <div class="section">
                <h3>Accident Photos (${imageCids.length} photo${imageCids.length > 1 ? 's' : ''})</h3>
                <div class="images">
                  ${imageCids.map((cid, index) => `<img src="cid:${cid}" alt="Accident photo ${index + 1}" style="max-width: 100%; height: auto; margin: 10px 0; border: 2px solid #ddd; border-radius: 5px; display: block;" />`).join('')}
                </div>
              </div>
              ` : ''}
              ${imageUrls.length > 0 && imageCids.length === 0 ? `
              <div class="section">
                <h3>Accident Photos</h3>
                <p>Photos are available at the following links:</p>
                <ul>
                  ${imageUrls.map((url, index) => `<li><a href="${url}" target="_blank">Photo ${index + 1}</a></li>`).join('')}
                </ul>
              </div>
              ` : ''}
              
              <div class="footer">
                <p>If you believe this is a false alarm, please contact the vehicle owner directly.</p>
                <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                <p style="color: #dc3545; font-weight: bold; margin-top: 20px;">⚠️ IMPORTANT NOTICE</p>
                <p style="color: #666; font-size: 11px; line-height: 1.5;">
                  Please <strong>do not reply</strong> to this email address (noreply.assistqr@gmail.com) as it is not monitored. This mailbox does not receive or respond to messages. If you need to contact someone regarding this alert, please reach out to the vehicle owner directly.
                </p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      attachments: attachments // Add inline attachments for images
    };

    console.log(`📧 Sending email to: ${contact.email}`);
    console.log(`   - Vehicle: ${vehicle.licensePlate}`);
    console.log(`   - Location: ${lat && lng ? `${lat}, ${lng}` : manualLocation || 'Not provided'}`);
    console.log(`   - Photos: ${imageUrls.length} image(s) - ${imageCids.length} attached as inline`);
    console.log(`   - Helper Note: ${helperNote ? 'Yes' : 'No'}`);
    
    // Send email via Resend API, SendGrid, or SMTP
    if (useResend) {
      // Use Resend API
      const resendPayload = {
        from: process.env.RESEND_FROM || process.env.SMTP_FROM || 'AssistQR <onboarding@resend.dev>',
        to: [contact.email],
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text
      };

      // Add attachments if any
      if (attachments.length > 0) {
        resendPayload.attachments = attachments.map(att => ({
          filename: att.filename,
          content: att.content.toString('base64'),
          content_type: att.contentType
        }));
      }

      const resendData = JSON.stringify(resendPayload);
      const resendOptions = {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(resendData)
        }
      };

      return new Promise((resolve, reject) => {
        const req = https.request(resendOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const response = JSON.parse(data);
              console.log(`✅ Email sent successfully to ${contact.email} via Resend! Message ID: ${response.id}`);
              resolve({ success: true, messageId: response.id });
            } else {
              const error = JSON.parse(data);
              console.error('❌ Resend API error:', error);
              reject(new Error(error.message || `Resend API error: ${res.statusCode}`));
            }
          });
        });

        req.on('error', (error) => {
          console.error('❌ Resend request error:', error);
          reject(error);
        });

        req.write(resendData);
        req.end();
      });
    } else {
      // Use SendGrid or SMTP via nodemailer
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${contact.email}! Message ID: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    }
  } catch (error) {
    console.error('❌ Error sending email to', contact.email, ':');
    console.error('   Error message:', error.message);
    console.error('   Error code:', error.code || 'N/A');
    console.error('   Command:', error.command || 'N/A');
    
    // Provide helpful error messages
    let errorMsg = error.message;
    if (error.code === 'ETIMEDOUT') {
      errorMsg = 'SMTP connection timeout. Check your internet connection and Gmail settings. If using Gmail, verify the App Password is correct.';
    } else if (error.code === 'EAUTH') {
      errorMsg = 'SMTP authentication failed. Please check your email and App Password are correct.';
    } else if (error.code === 'ECONNECTION') {
      errorMsg = 'Could not connect to SMTP server. Check SMTP_HOST and port settings.';
    }
    
    return { success: false, error: errorMsg, details: error.message };
  }
}

module.exports = {
  sendAccidentAlertEmail
};

