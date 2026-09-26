import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import type { ConversationIdParams } from '../schemas/conversationIdParams.schema';
import type { ListConversationsQuery } from '../schemas/listConversations.schema';
import type { ListMessagesQuery } from '../schemas/listMessages.schema';
import * as conversationService from '../services/conversationService';

export async function listConversations(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as ListConversationsQuery;
  const page = await conversationService.listConversations(req.user!.id, query);
  sendSuccess(res, page);
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as ConversationIdParams;
  const query = req.validatedQuery as ListMessagesQuery;
  const page = await conversationService.listMessages(req.user!.id, id, query);
  sendSuccess(res, page);
}
