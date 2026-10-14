import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as bookingService from '../services/bookingService';
import type { BookingIdParams } from '../schemas/bookingIdParams.schema';
import type { CreateBookingInput } from '../schemas/createBooking.schema';
import type { ListBookingsQuery } from '../schemas/listBookings.schema';

// `:id` here is the RIDE's id: this route is registered on the ride router (the
// resource is nested under the ride) but implemented by the booking module.
export async function createBooking(req: Request, res: Response): Promise<void> {
  const { id: rideId } = req.params as unknown as { id: string };
  const input = req.body as CreateBookingInput;
  const booking = await bookingService.createBooking(req.user!.id, rideId, input);
  sendSuccess(res, booking, 201);
}

export async function listBookings(req: Request, res: Response): Promise<void> {
  const query = req.validatedQuery as ListBookingsQuery;
  const page = await bookingService.listBookings(req.user!.id, query);
  sendSuccess(res, page);
}

// `:id` here is the RIDE's id, same convention as createBooking above —
// routed on the ride resource, implemented by the booking module.
export async function listBookingsForRide(req: Request, res: Response): Promise<void> {
  const { id: rideId } = req.params as unknown as { id: string };
  const query = req.validatedQuery as ListBookingsQuery;
  const page = await bookingService.listBookingsForRide(req.user!.id, rideId, query);
  sendSuccess(res, page);
}

export async function getBooking(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as BookingIdParams;
  const booking = await bookingService.getBooking(req.user!.id, id);
  sendSuccess(res, booking);
}

export async function getCheckout(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as BookingIdParams;
  const checkout = await bookingService.getCheckoutDetails(req.user!.id, id);
  sendSuccess(res, checkout);
}

export async function cancelBooking(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as BookingIdParams;
  const booking = await bookingService.cancelBooking(req.user!.id, id);
  sendSuccess(res, booking);
}
