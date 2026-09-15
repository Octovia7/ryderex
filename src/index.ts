import { createApp } from './app';
import { config } from './config';

const app = createApp();

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

    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
