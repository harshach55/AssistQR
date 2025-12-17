// Authentication Middleware
// Checks if user is logged in before allowing access to protected routes

function requireAuth(req, res, next) {
  console.log('requireAuth check:', { 
    hasSession: !!req.session, 
    userId: req.session?.userId,
    sessionId: req.sessionID 
  });
  if (req.session && req.session.userId) {
    return next();
  }
  console.log('No session found, redirecting to login');
  res.redirect('/auth/login');
}

function requireAuthApi(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

module.exports = {
  requireAuth,
  requireAuthApi
};