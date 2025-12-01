import dotenv from 'dotenv';

// Suppress dotenv tips in production/CI
dotenv.config({
  debug: false,
});

export const env = {
  port: Number(process.env.PORT) || 8001,
  node_env: (process.env.NODE_ENV || 'development') as string,
  
  // Gridlines API
  gridlines: {
    api_key: process.env.GRIDLINES_API_KEY || '',
    auth_type: process.env.GRIDLINES_AUTH_TYPE || '',
    api_url: 'https://api.gridlines.io/passport-api/ocr',
  },
  
  // Redis configuration
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ocr_progress_channel: process.env.OCR_PROGRESS_CHANNEL || 'ocr_progress',
  },
  
  // Main Backend
  main_backend: {
    url: process.env.MAIN_BACKEND_URL || 'http://localhost:3000',
  },
  
  // Logger
  logger: {
    level: process.env.LOGGER_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    error_log_file: process.env.LOGGER_ERROR_FILE || 'logs/error.log',
    combined_log_file: process.env.LOGGER_COMBINED_FILE || 'logs/combined.log',
    enable_console: process.env.LOGGER_ENABLE_CONSOLE !== 'false',
    service_name: process.env.LOGGER_SERVICE_NAME || 'compass-ocr-service',
  },
};

export default env;

