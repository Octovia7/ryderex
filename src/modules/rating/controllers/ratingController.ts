import type { Request, Response } from 'express';
import type { BookingIdParams } from '../../booking/schemas/bookingIdParams.schema';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as ratingService from '../ratingService';
import type { SubmitRatingInput } from '../schemas/submitRating.schema';

export async function submitRating(req: Request, res: Response): Promise<void> {
  const { id: bookingId } = req.params as unknown as BookingIdParams;
  const input = req.body as SubmitRatingInput;
  const rating = await ratingService.submitRating(req.user!.id, bookingId, input);
  sendSuccess(res, rating, 201);
}

export async function listRatingsForBooking(req: Request, res: Response): Promise<void> {
  const { id: bookingId } = req.params as unknown as BookingIdParams;
  const ratings = await ratingService.getRatingsForBooking(req.user!.id, bookingId);
  sendSuccess(res, ratings);
}
