import { createApp } from './app';
import { config } from './config';
import { createBookingExpiryWorker } from './modules/booking/workers/bookingExpiryWorker';

const app = createApp();

// Runs inside this same process (Redis holds all job state, so any instance
// could pick up any job — this doesn't break statelessness), started
// alongside the HTTP server and closed alongside it below.
const bookingExpiryWorker = createBookingExpiryWorker();

const server = app.listen(config.port, () => {
  console.log(`[saathiride] listening on port ${config.port} (${config.nodeEnv})`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[saathiride] received ${signal}, shutting down`);

  server.close((error) => {
    if (error) {
      console.error('[saathiride] error during shutdown', error);
      process.exit(1);
    }

    bookingExpiryWorker
      .close()
      .catch((workerError: unknown) => {
        console.error('[saathiride] error closing the booking-expiry worker', workerError);
      })
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
