import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as bookingService from '../services/bookingService';
import type { BookingIdParams } from '../schemas/bookingIdParams.schema';
import type { CreateBookingInput } from '../schemas/createBooking.schema';

// `:id` here is the RIDE's id: this route is registered on the ride router (the
// resource is nested under the ride) but implemented by the booking module.
export async function createBooking(req: Request, res: Response): Promise<void> {
  const { id: rideId } = req.params as unknown as { id: string };
  const input = req.body as CreateBookingInput;
  const booking = await bookingService.createBooking(req.user!.id, rideId, input);
  sendSuccess(res, booking, 201);
}

export async function getBooking(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as BookingIdParams;
  const booking = await bookingService.getBooking(req.user!.id, id);
  sendSuccess(res, booking);
}
