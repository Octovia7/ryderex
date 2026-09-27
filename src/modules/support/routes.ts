import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validateBody } from '../../middleware/validateBody';
import { validateParams } from '../../middleware/validateParams';
import { validateQuery } from '../../middleware/validateQuery';
import * as supportConversationController from './controllers/supportConversationController';
import { listSupportConversationsQuerySchema } from './schemas/listSupportConversations.schema';
import { listSupportMessagesQuerySchema } from './schemas/listSupportMessages.schema';
import { sendSupportMessageSchema } from './schemas/sendSupportMessage.schema';
import { supportConversationIdParamsSchema } from './schemas/supportConversationIdParams.schema';

const router = Router();

// No role gate: any authenticated user gets their own support conversations
// only — scoped in the service by the caller's own id, never a route/body
// parameter. No body to validate — a conversation is created empty.
router.post('/conversations', authenticate, supportConversationController.createConversation);

router.get(
  '/conversations',
  authenticate,
  validateQuery(listSupportConversationsQuerySchema),
  supportConversationController.listConversations,
);

// Ownership-scoped in the service, not here — a non-participant gets the
// same 404 (`SUPPORT_CONVERSATION_NOT_FOUND`) as an unknown id.
router.get(
  '/conversations/:id',
  authenticate,
  validateParams(supportConversationIdParamsSchema),
  validateQuery(listSupportMessagesQuerySchema),
  supportConversationController.getConversation,
);

// Rate limiting (10/min + 50/day) is checked inside chatbotService.sendMessage
// itself, the same place otpService checks its own limits — not route
// middleware, so it composes with the ownership check in one place.
router.post(
  '/conversations/:id/messages',
  authenticate,
  validateParams(supportConversationIdParamsSchema),
  validateBody(sendSupportMessageSchema),
  supportConversationController.sendMessage,
);

export default router;
