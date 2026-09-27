import { Router } from 'express';
import { config } from '../../config';
import { rateLimit } from '../../infrastructure/redis/rateLimit';
import { authenticate } from '../../middleware/authenticate';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as conversationController from './controllers/conversationController';
import { conversationIdParamsSchema } from './schemas/conversationIdParams.schema';
import { listConversationsQuerySchema } from './schemas/listConversations.schema';
import { listMessagesQuerySchema } from './schemas/listMessages.schema';

const router = Router();

// The generous "authenticated reads" catch-all (architecture.md §15) — the
// REST history endpoints only; WebSocket connect/message have their own
// dedicated categories (socketServer.ts / chatGateway.ts).
const authenticatedReadRateLimit = rateLimit({
  prefix: 'authenticated-read',
  keyBy: 'user',
  windowSeconds: 60,
  max: config.rateLimits.authenticatedReadPerMinute,
});

// No role gate: any authenticated user reads their own conversations only —
// scoped in the service by the caller's own id, never a route/body parameter.
router.get(
  '/',
  authenticate,
  authenticatedReadRateLimit,
  validateQuery(listConversationsQuerySchema),
  conversationController.listConversations,
);

// Ownership-scoped in the service, not here — a non-participant gets the
// same 404 as an unknown id (claude.md §7).
router.get(
  '/:id/messages',
  authenticate,
  authenticatedReadRateLimit,
  validateParams(conversationIdParamsSchema),
  validateQuery(listMessagesQuerySchema),
  conversationController.listMessages,
);

export default router;
