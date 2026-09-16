import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as vehicleService from '../services/vehicleService';
import type { CreateVehicleInput } from '../schemas/createVehicle.schema';
import type { UpdateVehicleInput } from '../schemas/updateVehicle.schema';
import type { VehicleIdParams } from '../schemas/vehicleIdParams.schema';

export async function createVehicle(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateVehicleInput;
  const vehicle = await vehicleService.createVehicle(req.user!.id, input);
  sendSuccess(res, vehicle, 201);
}

export async function listVehicles(req: Request, res: Response): Promise<void> {
  const vehicles = await vehicleService.listOwnVehicles(req.user!.id);
  sendSuccess(res, { items: vehicles });
}

export async function getVehicle(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as VehicleIdParams;
  const vehicle = await vehicleService.getOwnVehicle(req.user!.id, id);
  sendSuccess(res, vehicle);
}

export async function updateVehicle(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as VehicleIdParams;
  const input = req.body as UpdateVehicleInput;
  const vehicle = await vehicleService.updateOwnVehicle(req.user!.id, id, input);
  sendSuccess(res, vehicle);
}
