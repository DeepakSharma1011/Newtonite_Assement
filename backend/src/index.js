require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPrisma } = require('./lib/prisma');

const authRoutes = require('./routes/auth');
const itemsRoutes = require('./routes/items');
const teamsRoutes = require('./routes/teams');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// Routes
app.use('/auth', authRoutes);
app.use('/items', itemsRoutes);
app.use('/teams', teamsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server (only if not imported for testing)
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`🚀 Newtonite backend running on port ${PORT}`);
  });
}

module.exports = app;
