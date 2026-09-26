import { createServer } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { createSocketServer } from './infrastructure/socket/socketServer';
import { createBookingExpiryWorker } from './modules/booking/workers/bookingExpiryWorker';
import { registerChatGateway } from './modules/chat/socket/chatGateway';
import { createNotificationWorker } from './modules/notification/workers/notificationWorker';
import { createRefundWorker } from './modules/payment/workers/refundWorker';

const app = createApp();

// An explicit http.Server, rather than app.listen()'s own implicit one, so
// both HTTP and WebSocket traffic can share one port (architecture.md §14).
const server = createServer(app);

// Runs inside this same process (Redis holds all job state, so any instance
// could pick up any job — this doesn't break statelessness), started
// alongside the HTTP server and closed alongside it below.
const bookingExpiryWorker = createBookingExpiryWorker();
const refundWorker = createRefundWorker();
const notificationWorker = createNotificationWorker();

// Same two-step composition as the workers above: infrastructure wires the
// generic transport (auth, CORS, the Redis adapter), the owning module
// registers its own event handlers on it (architecture.md §2:
// "infrastructure/ never imports from modules/").
const socketServer = createSocketServer(server);
registerChatGateway(socketServer.io);

server.listen(config.port, () => {
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
      notificationWorker.close().catch((workerError: unknown) => {
        console.error('[saathiride] error closing the notification worker', workerError);
      }),
      socketServer.close().catch((socketError: unknown) => {
        console.error('[saathiride] error closing the socket server', socketError);
      }),
    ]).finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
