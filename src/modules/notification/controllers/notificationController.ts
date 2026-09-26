import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import type { ListNotificationsQuery } from '../schemas/listNotifications.schema';
import type { NotificationIdParams } from '../schemas/notificationIdParams.schema';
import * as notificationQueryService from '../services/notificationQueryService';

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as ListNotificationsQuery;
  const page = await notificationQueryService.listNotifications(req.user!.id, query);
  sendSuccess(res, page);
}

export async function markNotificationRead(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as NotificationIdParams;
  const notification = await notificationQueryService.markNotificationRead(req.user!.id, id);
  sendSuccess(res, notification);
}
