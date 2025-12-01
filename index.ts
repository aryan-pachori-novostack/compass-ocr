import express from 'express';
import cors from 'cors';
import { env } from './src/config/env.js';
import logger from './src/utils/logger.js';
import process_router from './src/api/process/process.router.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/process', process_router);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'compass-ocr-service' });
});

// Start server
const port = env.port;
app.listen(port, () => {
  logger.info(`OCR Microservice listening on port ${port}`);
});

export default app;

