import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as adminDriverApplicationService from '../services/adminDriverApplicationService';
import type { DriverApplicationParams } from '../schemas/driverApplicationParams.schema';
import type { ListDriverApplicationsQuery } from '../schemas/listDriverApplications.schema';
import type { RejectDriverApplicationInput } from '../schemas/rejectDriverApplication.schema';

export async function listDriverApplications(req: Request, res: Response): Promise<void> {
  const { status } = req.validatedQuery as ListDriverApplicationsQuery;
  const applications = await adminDriverApplicationService.listDriverApplications(status);
  sendSuccess(res, { items: applications });
}

export async function verifyDriverApplication(req: Request, res: Response): Promise<void> {
  const { userId } = req.params as unknown as DriverApplicationParams;
  await adminDriverApplicationService.verifyDriverApplication(userId, req.user!.id);
  sendSuccess(res, null);
}

export async function rejectDriverApplication(req: Request, res: Response): Promise<void> {
  const { userId } = req.params as unknown as DriverApplicationParams;
  const { rejectionReason } = req.body as RejectDriverApplicationInput;
  await adminDriverApplicationService.rejectDriverApplication(
    userId,
    req.user!.id,
    rejectionReason,
  );
  sendSuccess(res, null);
}
