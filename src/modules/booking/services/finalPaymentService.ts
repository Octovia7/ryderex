import { prisma } from '../../../infrastructure/database/prismaClient';
import { paymentProvider, providerName } from '../../../infrastructure/payments';
import * as paymentRecordService from '../../payment/services/paymentRecordService';
import * as bookingRepository from '../repositories/bookingRepository';
import { calculateRemainingFare } from './settlementService';

interface ConfirmedBookingRow {
  id: string;
  totalFare: unknown;
  prepaidAmount: unknown;
  finalPaymentOrderId: string | null;
}

// One booking's own order — the existing external-call-then-follow-up-tx
// pattern (architecture.md §11), the same shape as booking creation's own
// prepayment order: the external call never sits inside any transaction, so
// only the DB writes that follow it (attach the order id, record the
// Payment/Transaction) are wrapped.
async function createFinalPaymentOrderForBooking(booking: ConfirmedBookingRow): Promise<void> {
  const remainingAmount = calculateRemainingFare(
    Number(booking.totalFare),
    Number(booking.prepaidAmount),
  );

  const order = await paymentProvider.createOrder({
    amount: remainingAmount,
    receipt: booking.id,
  });

  await prisma.$transaction(async (tx) => {
    await bookingRepository.attachFinalPaymentOrder(tx, booking.id, order.orderId);
    await paymentRecordService.recordOrder(tx, {
      rideId: null,
      bookingId: booking.id,
      provider: providerName,
      providerOrderId: order.orderId,
      amount: remainingAmount,
      transactionType: 'FINAL_PAYMENT',
    });
  });
}

// Called by rideService.completeRide once rideRepository.complete() has
// succeeded — synchronous with the same request, mirroring how ride/booking
// creation already auto-create their own payment orders rather than
// requiring a separate passenger-initiated endpoint (steps.md §12).
//
// For every CONFIRMED booking on the ride, computes the remaining amount
// from the fare *locked* on the booking (never recalculated) and creates a
// FINAL_PAYMENT order. Skips any booking that already has one — idempotent
// against a manual re-invocation after a partial failure, since completeRide
// itself can't be retried once the ride is COMPLETED. Each booking is
// wrapped independently (Promise.allSettled) so one failure never blocks
// the others, or blocks ride completion, which has already happened by the
// time this runs.
export async function createFinalPaymentOrdersForRide(rideId: string): Promise<void> {
  const confirmedBookings = await bookingRepository.findConfirmedByRideId(prisma, rideId);
  const pending = confirmedBookings.filter((booking) => !booking.finalPaymentOrderId);

  const results = await Promise.allSettled(
    pending.map((booking) => createFinalPaymentOrderForBooking(booking)),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(
        `[finalPayment] failed to create a final payment order for ride ${rideId}`,
        result.reason,
      );
    }
  }
}
