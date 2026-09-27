import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import type { ListSupportConversationsQuery } from '../schemas/listSupportConversations.schema';
import type { ListSupportMessagesQuery } from '../schemas/listSupportMessages.schema';
import type { SendSupportMessageInput } from '../schemas/sendSupportMessage.schema';
import type { SupportConversationIdParams } from '../schemas/supportConversationIdParams.schema';
import * as chatbotService from '../services/chatbotService';

export async function createConversation(req: Request, res: Response): Promise<void> {
  const conversation = await chatbotService.createConversation(req.user!.id);
  sendSuccess(res, conversation, 201);
}

export async function listConversations(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as ListSupportConversationsQuery;
  const page = await chatbotService.listConversations(req.user!.id, query);
  sendSuccess(res, page);
}

export async function getConversation(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as SupportConversationIdParams;
  const query = req.validatedQuery as ListSupportMessagesQuery;
  const conversation = await chatbotService.getConversation(req.user!.id, id, query);
  sendSuccess(res, conversation);
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as SupportConversationIdParams;
  const { content } = req.body as SendSupportMessageInput;
  const messages = await chatbotService.sendMessage(req.user!.id, id, content);
  sendSuccess(res, { messages }, 201);
}
