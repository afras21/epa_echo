const express = require('express');
const facilitiesRoutes = require('./routes/facilities');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware (for production deployment)
app.use((req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['*'];
  
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
  });
});

// Routes
app.use('/api/facilities', facilitiesRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'EPA Facilities API Server',
    endpoints: {
      health: '/health',
      facilities: 'GET /api/facilities (list all facilities with filtering & pagination)',
      facilityById: 'GET /api/facilities/:id',
    },
    examples: {
      'Get all facilities': '/api/facilities?limit=50',
      'Filter by state': '/api/facilities?state=CA&limit=50',
      'Filter by city and state': '/api/facilities?state=CA&city=Los%20Angeles&limit=50',
      'Filter by ZIP': '/api/facilities?zip=90210',
      'Get facility by ID': '/api/facilities/110000123456',
    },
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ EPA Facilities API Server Started`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  API: http://localhost:${PORT}/api/facilities\n`);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;

