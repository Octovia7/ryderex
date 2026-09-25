import { createApp } from './app';
import { config } from './config';
import { createBookingExpiryWorker } from './modules/booking/workers/bookingExpiryWorker';
import { createRefundWorker } from './modules/payment/workers/refundWorker';

const app = createApp();

// Runs inside this same process (Redis holds all job state, so any instance
// could pick up any job — this doesn't break statelessness), started
// alongside the HTTP server and closed alongside it below.
const bookingExpiryWorker = createBookingExpiryWorker();
const refundWorker = createRefundWorker();

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

    Promise.all([
      bookingExpiryWorker.close().catch((workerError: unknown) => {
        console.error('[saathiride] error closing the booking-expiry worker', workerError);
      }),
      refundWorker.close().catch((workerError: unknown) => {
        console.error('[saathiride] error closing the refund worker', workerError);
      }),
    ]).finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
