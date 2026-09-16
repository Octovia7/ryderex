import Redis from 'ioredis';
import { config } from '../../config';

// A 2s commandTimeout is load-bearing: ioredis buffers commands issued while
// disconnected rather than rejecting them, so without a deadline a command
// during an outage hangs instead of failing — and no try/catch rescues a hang.
export const redis = new Redis(config.redis.url, {
  commandTimeout: 2000,
});

redis.on('error', (error: unknown) => {
  console.error('[redis] connection error', error);
});
