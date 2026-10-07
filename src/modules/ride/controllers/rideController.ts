import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as rideSearchService from '../services/rideSearchService';
import * as rideService from '../services/rideService';
import type { CreateRideInput } from '../schemas/createRide.schema';
import type { RideIdParams } from '../schemas/rideIdParams.schema';
import type { SearchRidesQuery } from '../schemas/searchRides.schema';

export async function createRide(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateRideInput;
  const ride = await rideService.createRide(req.user!.id, input);
  sendSuccess(res, ride, 201);
}

export async function searchRides(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as SearchRidesQuery;
  const page = await rideSearchService.searchRides(query);
  sendSuccess(res, page);
}

export async function getRide(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as RideIdParams;
  const ride = await rideService.getRide(id);
  sendSuccess(res, ride);
}

export async function getMyRides(req: Request, res: Response): Promise<void> {
  const rides = await rideService.getMyRides(req.user!.id);
  sendSuccess(res, { items: rides });
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
