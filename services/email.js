// Email Service
// Sends emergency alert emails with vehicle details, location, and photos
// Priority: Brevo API > Brevo SMTP > Mailgun API > Resend API > SendGrid > Nodemailer SMTP

const nodemailer = require('nodemailer');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const FormData = require('form-data');

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Check which email services are configured
const emailConfig = {
  brevoApi: process.env.BREVO_API_KEY,
  brevoSmtp: process.env.BREVO_SMTP_KEY && process.env.BREVO_SMTP_USER,
  mailgun: process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN,
  resend: process.env.RESEND_API_KEY,
  sendgrid: process.env.SENDGRID_API_KEY,
  smtp: process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
};

// Log configured services
if (emailConfig.brevoApi) {
  console.log(`✅ Brevo API configured (key: ${process.env.BREVO_API_KEY.substring(0, 20)}...)`);
}
if (emailConfig.brevoSmtp) {
  console.log(`✅ Brevo SMTP configured`);
}
if (emailConfig.mailgun) {
  console.log(`✅ Mailgun API configured`);
}
if (emailConfig.resend) {
  console.log(`✅ Resend API configured`);
}
if (emailConfig.sendgrid) {
  console.log(`✅ SendGrid API configured`);
}
if (emailConfig.smtp) {
  console.log(`✅ SMTP configured (${process.env.SMTP_HOST})`);
}
if (!Object.values(emailConfig).some(v => v)) {
  console.warn('⚠️  No email service configured. Email notifications will not be sent.');
}

// Initialize SMTP transporter (for Brevo SMTP and regular SMTP)
let brevoSmtpTransporter = null;
let smtpTransporter = null;

if (emailConfig.brevoSmtp) {
  brevoSmtpTransporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_KEY
    },
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000
  });
}

if (emailConfig.smtp) {
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    requireTLS: true,
    tls: {
      rejectUnauthorized: false
    }
  });

  // Only verify in development
  if (process.env.NODE_ENV !== 'production') {
    smtpTransporter.verify(function(error, success) {
      if (error) {
        console.error('❌ SMTP connection error:', error.message);
      } else {
        console.log('✅ SMTP server is ready to send emails');
      }
    });
  }
}

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
        timeout: 10000
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

// Helper function to extract email from "Name <email>" format
function extractEmail(emailString) {
  const match = emailString.match(/<(.+)>/);
  return match ? match[1] : emailString;
}

// Helper function to extract name from "Name <email>" format
function extractName(emailString) {
  const match = emailString.match(/^(.+?)\s*</);
  return match ? match[1].trim() : '';
}

// Brevo API email sending
async function sendViaBrevoAPI({ to, subject, html, text, attachments = [] }) {
  return new Promise((resolve, reject) => {
    const fromEmail = process.env.BREVO_FROM 
      ? extractEmail(process.env.BREVO_FROM)
      : 'noreply@assistqr.com';
    const fromName = process.env.BREVO_FROM 
      ? extractName(process.env.BREVO_FROM) || 'AssistQR'
      : 'AssistQR';

    console.log(`   📤 Brevo API - From: ${fromName} <${fromEmail}>, To: ${to}`);

    const payload = {
      sender: {
        name: fromName,
        email: fromEmail
      },
      to: [{ email: to }],
      subject: subject,
      htmlContent: html,
      textContent: text
    };

    // Add attachments if any
    if (attachments.length > 0) {
      payload.attachment = attachments.map(att => {
        const attachment = {
          name: att.filename,
          content: att.content.toString('base64')
        };
        // If attachment has a cid, use it as contentId for inline images
        if (att.cid) {
          attachment.contentId = att.cid;
          console.log(`   📎 Adding inline image: ${att.filename} with contentId: ${att.cid}`);
        } else {
          console.log(`   📎 Adding attachment: ${att.filename}`);
        }
        return attachment;
      });
    }

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'api-key': process.env.BREVO_API_KEY
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const response = JSON.parse(data);
          console.log(`   ✅ Brevo API response:`, JSON.stringify(response, null, 2));
          resolve({ success: true, messageId: response.messageId || 'unknown', response: response });
        } else {
          try {
            const error = JSON.parse(data);
            console.error(`   ❌ Brevo API error response:`, JSON.stringify(error, null, 2));
            reject(new Error(error.message || `Brevo API error: ${data}`));
          } catch (e) {
            console.error(`   ❌ Brevo API error (non-JSON):`, data);
            reject(new Error(`Brevo API error: ${data}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Brevo API request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Brevo API request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// Resend API email sending
async function sendViaResendAPI({ to, subject, html, text, attachments = [] }) {
  return new Promise((resolve, reject) => {
    // Use default Resend domain if RESEND_FROM is not set or is a placeholder
    let fromEmail = 'onboarding@resend.dev';
    if (process.env.RESEND_FROM && !process.env.RESEND_FROM.includes('yourdomain.com')) {
      fromEmail = extractEmail(process.env.RESEND_FROM);
    }

    const payload = {
      from: fromEmail,
      to: [to],
      subject: subject,
      html: html,
      text: text
    };

    // Add attachments if any
    if (attachments.length > 0) {
      payload.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content.toString('base64')
      }));
    }

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const response = JSON.parse(data);
          resolve({ success: true, messageId: response.id || 'unknown' });
        } else {
          try {
            const error = JSON.parse(data);
            reject(new Error(error.message || `Resend API error: ${data}`));
          } catch (e) {
            reject(new Error(`Resend API error: ${data}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Resend API request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Resend API request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// Mailgun API email sending
async function sendViaMailgunAPI({ to, subject, html, text, attachments = [] }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('from', process.env.MAILGUN_FROM || `AssistQR <noreply@${process.env.MAILGUN_DOMAIN}>`);
    form.append('to', to);
    form.append('subject', subject);
    form.append('html', html);
    form.append('text', text);

    // Add attachments if any
    attachments.forEach(att => {
      form.append('attachment', att.content, {
        filename: att.filename,
        contentType: att.contentType || 'application/octet-stream'
      });
    });

    const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64');
    const options = {
      hostname: 'api.mailgun.net',
      path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        ...form.getHeaders()
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const response = JSON.parse(data);
          resolve({ success: true, messageId: response.id || 'unknown' });
        } else {
          try {
            const error = JSON.parse(data);
            reject(new Error(error.message || `Mailgun API error: ${data}`));
          } catch (e) {
            reject(new Error(`Mailgun API error: ${data}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Mailgun API request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Mailgun API request timeout'));
    });

    form.pipe(req);
  });
}

// SendGrid API email sending
async function sendViaSendGridAPI({ to, subject, html, text, attachments = [] }) {
  return new Promise((resolve, reject) => {
    const payload = {
      personalizations: [{
        to: [{ email: to }]
      }],
      from: {
        email: process.env.SENDGRID_FROM || 'noreply@assistqr.com',
        name: 'AssistQR'
      },
      subject: subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html }
      ]
    };

    // Add attachments if any
    if (attachments.length > 0) {
      payload.attachments = attachments.map(att => ({
        content: att.content.toString('base64'),
        filename: att.filename,
        type: att.contentType || 'application/octet-stream',
        disposition: 'attachment'
      }));
    }

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, messageId: res.headers['x-message-id'] || 'unknown' });
        } else {
          reject(new Error(`SendGrid API error: ${data || res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`SendGrid API request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('SendGrid API request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

async function sendAccidentAlertEmail({ vehicle, contact, lat, lng, imageUrls = [], helperNote, manualLocation }) {
  // Check if any email service is configured
  if (!Object.values(emailConfig).some(v => v)) {
    const errorMsg = 'No email service configured. Please configure at least one email service (Brevo API, Resend, Mailgun, SendGrid, or SMTP).';
    console.error('❌ Email not sent to', contact.email, '-', errorMsg);
    return { success: false, error: errorMsg };
  }

  // Log image URLs being passed to email service
  console.log(`📧 Preparing email for ${contact.email} with ${imageUrls.length} image(s):`);
  if (imageUrls.length > 0) {
    imageUrls.forEach((url, index) => {
      console.log(`  📷 Image ${index + 1}: ${url}`);
    });
  } else {
    console.warn('  ⚠️  No image URLs provided to email service');
  }

  try {
    const mapsLink = (lat && lng) ? `https://www.google.com/maps?q=${lat},${lng}` : '';
    const locationText = [
      mapsLink && `Location: ${mapsLink}`,
      manualLocation && `Manual location description: ${manualLocation}`
    ].filter(Boolean).join('\n') + (mapsLink || manualLocation ? '\n' : '');

    // Note: Brevo API doesn't support inline images via CID attachments
    // We'll use direct image URLs in the HTML instead
    const attachments = [];
    
    if (imageUrls.length > 0) {
      console.log(`   - Using ${imageUrls.length} image(s) as direct URLs in email body (Brevo doesn't support inline attachments)`);
    }

    let imagesHtml = '';
    if (imageUrls.length > 0) {
      imagesHtml = '\n\nAccident Photos:\n';
      imageUrls.forEach((url, index) => {
        imagesHtml += `${index + 1}. ${url}\n`;
      });
    }

    const subject = `🚨 URGENT: Emergency Alert - Possible Accident Involving Vehicle ${vehicle.licensePlate}`;
    const text = `
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
    `.trim();

    const html = `
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
              
              ${imageUrls.length > 0 ? `
              <div class="section">
                <h3>Accident Photos (${imageUrls.length} photo${imageUrls.length > 1 ? 's' : ''})</h3>
                <div class="images">
                  ${imageUrls.map((url, index) => `<img src="${url}" alt="Accident photo ${index + 1}" style="max-width: 100%; height: auto; margin: 10px 0; border: 2px solid #ddd; border-radius: 5px; display: block;" />`).join('')}
                </div>
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
      `;

    console.log(`📧 Sending email to: ${contact.email}`);
    console.log(`   - Vehicle: ${vehicle.licensePlate}`);
    console.log(`   - Location: ${lat && lng ? `${lat}, ${lng}` : manualLocation || 'Not provided'}`);
    console.log(`   - Photos: ${imageUrls.length} image(s) - using direct URLs in email body`);
    console.log(`   - Helper Note: ${helperNote ? 'Yes' : 'No'}`);

    // Try email services in priority order
    const emailData = { to: contact.email, subject, html, text, attachments };

    // 1. Try Brevo API (highest priority - works on Render)
    if (emailConfig.brevoApi) {
      try {
        console.log('   🔄 Trying Brevo API...');
        const result = await sendViaBrevoAPI(emailData);
        const fromEmail = process.env.BREVO_FROM 
          ? extractEmail(process.env.BREVO_FROM)
          : 'noreply@assistqr.com';
        console.log(`✅ Email sent successfully via Brevo API to ${contact.email}!`);
        console.log(`   📧 From: ${fromEmail}`);
        console.log(`   📬 Message ID: ${result.messageId}`);
        console.log(`   ⚠️  Note: If email not received, check spam folder. Sender email must be verified in Brevo dashboard.`);
        return { success: true, messageId: result.messageId, provider: 'Brevo API' };
      } catch (error) {
        console.warn(`   ⚠️  Brevo API failed: ${error.message}`);
      }
    }

    // 2. Try Brevo SMTP (will likely fail on Render free tier)
    if (emailConfig.brevoSmtp && brevoSmtpTransporter) {
      try {
        console.log('   🔄 Trying Brevo SMTP...');
        const fromEmail = process.env.BREVO_FROM || process.env.BREVO_SMTP_USER;
        const info = await brevoSmtpTransporter.sendMail({
          from: fromEmail,
          to: contact.email,
          subject,
          html,
          text,
          attachments
        });
        console.log(`✅ Email sent successfully via Brevo SMTP to ${contact.email}! Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId, provider: 'Brevo SMTP' };
      } catch (error) {
        console.warn(`   ⚠️  Brevo SMTP failed: ${error.message}`);
      }
    }

    // 3. Try Mailgun API
    if (emailConfig.mailgun) {
      try {
        console.log('   🔄 Trying Mailgun API...');
        const result = await sendViaMailgunAPI(emailData);
        console.log(`✅ Email sent successfully via Mailgun API to ${contact.email}! Message ID: ${result.messageId}`);
        return { success: true, messageId: result.messageId, provider: 'Mailgun API' };
      } catch (error) {
        console.warn(`   ⚠️  Mailgun API failed: ${error.message}`);
      }
    }

    // 4. Try Resend API
    if (emailConfig.resend) {
      try {
        console.log('   🔄 Trying Resend API...');
        const result = await sendViaResendAPI(emailData);
        console.log(`✅ Email sent successfully via Resend API to ${contact.email}! Message ID: ${result.messageId}`);
        return { success: true, messageId: result.messageId, provider: 'Resend API' };
      } catch (error) {
        console.warn(`   ⚠️  Resend API failed: ${error.message}`);
      }
    }

    // 5. Try SendGrid API
    if (emailConfig.sendgrid) {
      try {
        console.log('   🔄 Trying SendGrid API...');
        const result = await sendViaSendGridAPI(emailData);
        console.log(`✅ Email sent successfully via SendGrid API to ${contact.email}! Message ID: ${result.messageId}`);
        return { success: true, messageId: result.messageId, provider: 'SendGrid API' };
      } catch (error) {
        console.warn(`   ⚠️  SendGrid API failed: ${error.message}`);
      }
    }

    // 6. Try regular SMTP (will likely fail on Render free tier)
    if (emailConfig.smtp && smtpTransporter) {
      try {
        console.log('   🔄 Trying SMTP...');
        const from = process.env.SMTP_FROM_NAME 
          ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>` 
          : (process.env.SMTP_FROM || process.env.SMTP_USER);
        const info = await smtpTransporter.sendMail({
          from,
          to: contact.email,
          subject,
          html,
          text,
          priority: 'high',
          headers: {
            'X-Priority': '1',
            'X-MSMail-Priority': 'High',
            'Importance': 'high',
            'Priority': 'urgent'
          },
          attachments
        });
        console.log(`✅ Email sent successfully via SMTP to ${contact.email}! Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId, provider: 'SMTP' };
      } catch (error) {
        console.warn(`   ⚠️  SMTP failed: ${error.message}`);
      }
    }

    // All services failed
    const errorMsg = 'All email services failed. Please check your email service configuration.';
    console.error(`❌ Failed to send email to ${contact.email}: ${errorMsg}`);
    return { success: false, error: errorMsg };

  } catch (error) {
    console.error('❌ Error sending email to', contact.email, ':');
    console.error('   Error message:', error.message);
    console.error('   Error code:', error.code || 'N/A');
    
    let errorMsg = error.message;
    if (error.code === 'ETIMEDOUT') {
      errorMsg = 'Email service connection timeout. This may be due to network restrictions (e.g., Render free tier blocks SMTP).';
    }
    
    return { success: false, error: errorMsg, details: error.message };
  }
}

module.exports = {
  sendAccidentAlertEmail
};
