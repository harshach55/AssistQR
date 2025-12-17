// Authentication Routes
// Handles user signup, login, and logout

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/vehicles');
  }
  res.render('auth/login', { error: null });
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return res.render('auth/login', { error: 'Invalid email or password format' });
    }

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Verify password using bcrypt
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.render('auth/login', { error: 'Invalid email or password' });
    }

    // Create session for logged-in user
    req.session.userId = user.id;
    req.session.userName = user.name;
    console.log('Setting session:', { userId: user.id, userName: user.name });
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('auth/login', { error: 'An error occurred. Please try again.' });
      }
      console.log('Session saved successfully, redirecting to /vehicles');
      res.redirect('/vehicles');
    });
  } catch (error) {
    console.error('Login error:', error);
    const errorMessage = error.code === 'P1001' ? 
      'Database connection error. Please ensure MySQL is running.' : 
      'An error occurred. Please try again.';
    res.render('auth/login', { error: errorMessage });
  }
});

router.get('/signup', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/vehicles');
  }
  res.render('auth/signup', { error: null });
});

router.post('/signup', [
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return res.render('auth/signup', { error: 'Invalid input. Name must be 2-100 chars, password at least 6 chars.' });
    }

    const { name, email, password } = req.body;

    // Check if email already exists
    if (await prisma.user.findUnique({ where: { email } })) {
      return res.render('auth/signup', { error: 'Email already registered' });
    }

    // Create new user with hashed password
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10) // Hash password before storing
      }
    });

    req.session.userId = user.id;
    req.session.userName = user.name;
    console.log('Setting session:', { userId: user.id, userName: user.name });
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('auth/signup', { error: 'An error occurred. Please try again.' });
      }
      console.log('Session saved successfully, redirecting to /vehicles');
      res.redirect('/vehicles');
    });
  } catch (error) {
    console.error('Signup error:', error);
    const errorMessage = error.code === 'P1001' ? 
      'Database connection error. Please ensure MySQL is running.' : 
      'An error occurred. Please try again.';
    res.render('auth/signup', { error: errorMessage });
  }
});

const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/auth/login');
  });
};

router.post('/logout', requireAuth, logout);
router.get('/logout', requireAuth, logout);

module.exports = router;

