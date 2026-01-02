// QR Code Routes
// Public: Accident reporting page (via QR scan)
// Protected: QR code generation and download

const express = require('express');
const QRCode = require('qrcode');
const prisma = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/help', async (req, res) => {
  try {
    const { v: qrToken } = req.query;

    if (!qrToken) {
      return res.status(400).render('error', {
        message: 'Invalid QR code. Missing vehicle token.',
        error: null
      });
    }

    // Find vehicle by QR token (public endpoint - no authentication required)
    const vehicle = await prisma.vehicle.findUnique({
      where: { qrToken },
      select: {
        id: true,
        licensePlate: true,
        model: true,
        color: true
      }
    });

    if (!vehicle) {
      return res.status(404).render('error', {
        message: 'Invalid QR code. Vehicle not found.',
        error: null
      });
    }

    res.render('accidents/report', {
      vehicle: {
        licensePlate: vehicle.licensePlate,
        model: vehicle.model || 'Unknown',
        color: vehicle.color || 'Unknown'
      },
      qrToken,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null,
      smsServiceNumber: process.env.TWILIO_FROM_NUMBER || process.env.SMS_SERVICE_NUMBER || null,
      twilioSmsNumber: process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_FROM_NUMBER || null
    });
  } catch (error) {
    console.error('Error loading help page:', error);
    res.status(500).render('error', {
      message: 'Error loading page',
      error: process.env.NODE_ENV === 'development' ? error : null
    });
  }
});

router.get('/:vehicleId/download', requireAuth, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: parseInt(req.params.vehicleId),
        userId: req.session.userId
      }
    });

    if (!vehicle) {
      return res.status(404).render('error', { message: 'Vehicle not found' });
    }

    // Generate QR code containing the accident reporting URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const helpUrl = `${baseUrl}/qr/help?v=${vehicle.qrToken}`;
    const qrCodeBuffer = await QRCode.toBuffer(helpUrl, {
      type: 'png',
      width: 500,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${vehicle.licensePlate.replace(/\s+/g, '-')}.png"`);
    res.send(qrCodeBuffer);
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).render('error', {
      message: 'Error generating QR code',
      error: process.env.NODE_ENV === 'development' ? error : null
    });
  }
});

router.get('/:vehicleId/preview', requireAuth, async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: parseInt(req.params.vehicleId),
        userId: req.session.userId
      }
    });

    if (!vehicle) {
      return res.status(404).render('error', { message: 'Vehicle not found' });
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const helpUrl = `${baseUrl}/qr/help?v=${vehicle.qrToken}`;
    const qrCodeDataUrl = await QRCode.toDataURL(helpUrl, {
      width: 500,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.render('qr/preview', {
      user: { name: req.session.userName },
      vehicle,
      qrCodeDataUrl,
      helpUrl,
      downloadUrl: `/qr/${vehicle.id}/download`
    });
  } catch (error) {
    console.error('Error loading QR preview:', error);
    res.status(500).render('error', {
      message: 'Error loading QR code',
      error: process.env.NODE_ENV === 'development' ? error : null
    });
  }
});

module.exports = router;

