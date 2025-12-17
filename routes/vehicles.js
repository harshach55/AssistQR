// Vehicle Management Routes
// Handles CRUD operations for vehicles (requires authentication)

const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { userId: req.session.userId },
      include: {
        emergencyContacts: true,
        _count: { select: { accidentReports: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.render('vehicles/list', {
      user: { name: req.session.userName },
      vehicles
    });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.render('error', { message: 'Error loading vehicles', error });
  }
});

router.get('/add', (req, res) => {
  res.render('vehicles/add', { error: null });
});

router.post('/add', [
  body('licensePlate').trim().notEmpty().isLength({ min: 1, max: 50 }),
  body('model').optional().trim().isLength({ max: 100 }),
  body('color').optional().trim().isLength({ max: 50 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('vehicles/add', { error: 'Invalid input. Please check all fields.' });
    }

    const { licensePlate, model, color } = req.body;

    // Create vehicle with unique QR token
    const vehicle = await prisma.vehicle.create({
      data: {
        userId: req.session.userId,
        licensePlate: licensePlate.trim().toUpperCase(),
        model: model ? model.trim() : null,
        color: color ? color.trim() : null,
        qrToken: uuidv4() // Generate secure random token
      }
    });

    res.redirect(`/vehicles/${vehicle.id}`);
  } catch (error) {
    console.error('Error creating vehicle:', error);
    res.render('vehicles/add', { error: 'Error creating vehicle. License plate may already exist.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.session.userId
      },
      include: {
        emergencyContacts: {
          orderBy: { createdAt: 'desc' }
        },
        accidentReports: {
          orderBy: { createdAt: 'desc' },
          include: {
            images: true
          }
        }
      }
    });

    if (!vehicle) {
      return res.status(404).render('error', { message: 'Vehicle not found' });
    }

    res.render('vehicles/detail', {
      user: { name: req.session.userName },
      vehicle,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000'
    });
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    res.render('error', { message: 'Error loading vehicle', error });
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, userId: req.session.userId }
    });

    if (!vehicle) {
      return res.status(404).render('error', { message: 'Vehicle not found' });
    }

    await prisma.vehicle.delete({ where: { id: vehicleId } });

    res.redirect('/vehicles');
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.render('error', { message: 'Error deleting vehicle', error });
  }
});

module.exports = router;

