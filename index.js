// -----------------------------------------------------------------------------
// Entry point of the AccuWeather integration for Gladys Assistant.
//
// This file only builds the SDK client, hands it to the app (src/app.js, where
// every handler is registered) and connects. The supervisor provides
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR:
// the SDK reads them, `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp(gladys);

// A forgotten promise must be logged, never take the integration down.
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', err);
});

// The SDK disconnects cleanly and exits 0 on SIGTERM/SIGINT; the state file
// (location keys, cached forecasts, quota count) is written first.
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await app.shutdown();
});

logger.info('Starting the AccuWeather integration...');
app
  .load()
  .then(() => gladys.connect())
  .catch((err) => {
    logger.error('Initial connection failed', err);
    process.exit(1);
  });
