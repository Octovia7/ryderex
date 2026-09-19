import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as adminVehicleService from '../services/adminVehicleService';
import type { ListVehiclesQuery } from '../schemas/listVehicles.schema';
import type { RejectVehicleInput } from '../schemas/rejectVehicle.schema';
import type { VehicleParams } from '../schemas/vehicleParams.schema';

export async function listVehicles(req: Request, res: Response): Promise<void> {
  const { status } = req.validatedQuery as ListVehiclesQuery;
  const vehicles = await adminVehicleService.listVehicles(status);
  sendSuccess(res, { items: vehicles });
}

export async function getVehicle(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as VehicleParams;
  const vehicle = await adminVehicleService.getVehicle(id);
  sendSuccess(res, vehicle);
}

export async function verifyVehicle(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as VehicleParams;
  await adminVehicleService.verifyVehicle(id, req.user!.id);
  sendSuccess(res, null);
}

export async function rejectVehicle(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as VehicleParams;
  const { rejectionReason } = req.body as RejectVehicleInput;
  await adminVehicleService.rejectVehicle(id, req.user!.id, rejectionReason);
  sendSuccess(res, null);
}
