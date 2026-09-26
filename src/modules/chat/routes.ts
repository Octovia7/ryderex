import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as conversationController from './controllers/conversationController';
import { conversationIdParamsSchema } from './schemas/conversationIdParams.schema';
import { listConversationsQuerySchema } from './schemas/listConversations.schema';
import { listMessagesQuerySchema } from './schemas/listMessages.schema';

const router = Router();

// No role gate: any authenticated user reads their own conversations only —
// scoped in the service by the caller's own id, never a route/body parameter.
router.get(
  '/',
  authenticate,
  validateQuery(listConversationsQuerySchema),
  conversationController.listConversations,
);

// Ownership-scoped in the service, not here — a non-participant gets the
// same 404 as an unknown id (claude.md §7).
router.get(
  '/:id/messages',
  authenticate,
  validateParams(conversationIdParamsSchema),
  validateQuery(listMessagesQuerySchema),
  conversationController.listMessages,
);

export default router;
