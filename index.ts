import express from 'express';
import cors from 'cors';
import { env } from './src/config/env.js';
import logger from './src/utils/logger.js';
import process_router from './src/api/process/process.router.js';

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  try {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  } catch (e) {
    // Logger might not be initialized yet
    console.error('Logger error:', e);
  }
  // Don't exit the process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  try {
    logger.error('Uncaught Exception:', error);
  } catch (e) {
    // Logger might not be initialized yet
    console.error('Logger error:', e);
  }
  // Don't exit the process - keep it running
  // In production, you might want to exit, but for debugging, keep it alive
});

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

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Express error:', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred',
    code: 500,
  });
});

// Start server
const port = env.port;
const server = app.listen(port, () => {
  logger.info(`OCR Microservice listening on port ${port}`);
}).on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${port} is already in use`);
    process.exit(1);
  } else {
    logger.error('Server error:', error);
    // Don't exit on other errors - let it retry
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Keep the process alive - prevent accidental exit
// This ensures the process doesn't exit if the event loop becomes empty
setInterval(() => {
  // Heartbeat to keep process alive
}, 10000);

// Log that the service is fully initialized
setImmediate(() => {
  logger.info('OCR Microservice fully initialized and ready');
});

export default app;

