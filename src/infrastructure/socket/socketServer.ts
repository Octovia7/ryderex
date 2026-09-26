import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import type { DefaultEventsMap } from 'socket.io';
import { Server } from 'socket.io';
import { config } from '../../config';
import { verifyAccessToken } from '../../modules/auth/services/tokenService';
import { AppError } from '../../shared/AppError';
import { redis } from '../redis/redisClient';

// `Socket.data`'s type comes from the 4th generic parameter, not from
// augmenting the `Socket` interface directly (that conflicts with its own
// generic declaration: "subsequent property declarations must have the same
// type"). Every socket in this server is authenticated by the `io.use()`
// middleware below before any handler ever sees it.
export interface ChatSocketData {
  user: { id: string; role: string };
}

export type ChatServer = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  ChatSocketData
>;

export interface SocketServerHandle {
  io: ChatServer;
  close: () => Promise<void>;
}

// Composition root for the chat transport (architecture.md §2: "infrastructure/
// never imports from modules/" — this file wires generic Socket.IO plumbing
// only; chat-specific event handlers are registered separately by the chat
// module's own gateway, the same two-step shape src/index.ts already uses
// for the BullMQ workers).
//
// Auth (architecture.md §13/claude.md §7 "WebSocket auth"): the handshake
// carries the same access token HTTP does, verified with the identical
// `verifyAccessToken` — read from `socket.handshake.auth.token`, falling
// back to an `Authorization: Bearer` header. An unauthenticated socket never
// reaches `connection`; `io.use()` rejects it at the `connect_error` stage.
export function createSocketServer(httpServer: HttpServer): SocketServerHandle {
  const io: ChatServer = new Server(httpServer, {
    // The parsed array, never the raw CORS_ORIGINS string (claude.md §15's
    // own trap: "Socket.IO CORS needs the parsed origin array — the raw
    // comma-separated string emits an illegal header and breaks every
    // origin" once more than one origin is configured).
    cors: { origin: config.corsOrigins },
  });

  io.use((socket, next) => {
    const header = socket.handshake.headers.authorization;
    const headerToken =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : undefined;
    const token = socket.handshake.auth?.token ?? headerToken;

    if (typeof token !== 'string' || token.length === 0) {
      next(
        new AppError({
          statusCode: 401,
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid access token.',
        }),
      );
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data.user = { id: payload.sub, role: payload.role };
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Invalid access token.'));
    }
  });

  // Multi-instance readiness (architecture.md §15): two DEDICATED
  // `redis.duplicate()` connections, never the shared `infrastructure/redis`
  // client directly and never `infrastructure/queue`'s BullMQ connection —
  // pub/sub mode needs its own sockets, the same "every Worker needs its own
  // connection" reasoning BullMQ already follows elsewhere in this codebase.
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.all([pubClient.quit(), subClient.quit()]);
  }

  return { io, close };
}
