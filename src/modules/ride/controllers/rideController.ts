import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as rideService from '../services/rideService';
import type { CreateRideInput } from '../schemas/createRide.schema';
import type { RideIdParams } from '../schemas/rideIdParams.schema';

export async function createRide(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateRideInput;
  const ride = await rideService.createRide(req.user!.id, input);
  sendSuccess(res, ride, 201);
}

export async function getRide(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as RideIdParams;
  const ride = await rideService.getRide(id);
  sendSuccess(res, ride);
}

export async function startRide(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as RideIdParams;
  const ride = await rideService.startRide(req.user!.id, id);
  sendSuccess(res, ride);
}

export async function completeRide(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as RideIdParams;
  const ride = await rideService.completeRide(req.user!.id, id);
  sendSuccess(res, ride);
}

export async function cancelRide(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as RideIdParams;
  const ride = await rideService.cancelRide(req.user!.id, id);
  sendSuccess(res, ride);
}
