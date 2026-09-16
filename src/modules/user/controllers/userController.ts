import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as userService from '../services/userService';
import type { UpdateProfileInput } from '../schemas/updateProfile.schema';

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await userService.getProfile(req.user!.id);
  sendSuccess(res, user);
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const data = req.body as UpdateProfileInput;
  const user = await userService.updateProfile(req.user!.id, data);
  sendSuccess(res, user);
}
