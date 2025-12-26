// AssistQR - Main Server Entry Point
// Handles HTTP requests, routes, middleware, and server initialization

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Render (required for correct IP and secure cookies)
app.set('trust proxy', 1);

// Middleware: Parse request bodies and serve static files
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session: Store user login state in PostgreSQL
app.use(session({
  store: new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-key',
  resave: true, // Save session even if not modified (for better persistence)
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    sameSite: 'lax', // Required for cross-site requests
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// View Engine: EJS for server-side rendering
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes: Modular route handlers
const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const contactRoutes = require('./routes/contacts');
const accidentRoutes = require('./routes/accidents');
const qrRoutes = require('./routes/qr');

app.use('/auth', authRoutes);
app.use('/vehicles', vehicleRoutes);
app.use('/contacts', contactRoutes);
app.use('/accidents', accidentRoutes);
app.use('/qr', qrRoutes);

// Test Route: For mobile connectivity testing
app.get('/test', (req, res) => {
  res.send(`
    <html>
      <head><title>Server Test</title></head>
      <body style="font-family: Arial; padding: 20px;">
        <h1>✅ Server is accessible!</h1>
        <p>If you can see this, your mobile can reach the server.</p>
        <p>Server IP: ${req.headers.host}</p>
        <p>Time: ${new Date().toLocaleString()}</p>
      </body>
    </html>
  `);
});

// Home Route: Redirect based on login status
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/vehicles');
  } else {
    res.redirect('/auth/login');
  }
});

// Error Handler: Catch and display errors
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://${process.env.BASE_URL?.replace('http://', '').split(':')[0] || 'YOUR_IP'}:${PORT}`);
});
