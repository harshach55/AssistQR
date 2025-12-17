// Emergency Contact Routes
// Handles adding and deleting emergency contacts (API endpoints)

const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const isValidE164 = (phone) => /^\+[1-9]\d{1,14}$/.test(phone);

router.post('/add', [
  body('vehicleId').isInt(),
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }),
  body('phoneNumber').custom((value) => {
    if (!isValidE164(value)) {
      throw new Error('Phone number must be in E.164 format (e.g., +919876543210)');
    }
    return true;
  }),
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMsg = errors.array().map(e => e.msg).join(', ');
      return res.status(400).json({ error: errorMsg });
    }

    const { vehicleId, name, phoneNumber, email } = req.body;

    // Verify user owns the vehicle
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: parseInt(vehicleId), userId: req.session.userId }
    });

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // Create emergency contact
    const contact = await prisma.emergencyContact.create({
      data: {
        vehicleId: parseInt(vehicleId),
        name: name.trim(),
        phoneNumber: phoneNumber.trim(),
        email: email.trim().toLowerCase()
      }
    });

    res.json({ success: true, contact });
  } catch (error) {
    console.error('Error adding contact:', error);
    res.status(500).json({ error: 'Error adding emergency contact' });
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    const contact = await prisma.emergencyContact.findFirst({
      where: { id: parseInt(req.params.id) },
      include: { vehicle: true }
    });

    if (!contact || contact.vehicle.userId !== req.session.userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    await prisma.emergencyContact.delete({
      where: { id: contact.id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: 'Error deleting emergency contact' });
  }
});

module.exports = router;

