const express = require('express');
const cors = require('cors');
const env = require('@/config/env');
const errorHandler = require('@/middleware/errorHandler');
const appRoutes = require('@/routes/app.route');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Parsed query container used by validators/controllers
app.use((req, _res, next) => {
  req.customQuery = {};
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: env.SERVICE_NAME });
});

app.use('/api', appRoutes);

app.use(errorHandler);

module.exports = app;
