import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'booking'>;

const SELECT = {
  id: true,
  rideId: true,
  passengerId: true,
  seats: true,
  farePerSeat: true,
  totalFare: true,
  prepaidAmount: true,
  pickupLat: true,
  pickupLng: true,
  dropLat: true,
  dropLng: true,
  status: true,
  paymentOrderId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CreateBookingData {
  id: string;
  rideId: string;
  passengerId: string;
  seats: number;
  farePerSeat: number;
  totalFare: number;
  prepaidAmount: number;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
}

// Takes a client so the service can run it in the SAME transaction as the seat
// reservation: the hold and the row that represents it commit together or not
// at all. A new booking is always PENDING_PAYMENT (the column default) with no
// payment order yet — neither is a caller's choice.
export function create(client: Client, data: CreateBookingData) {
  return client.booking.create({ data, select: SELECT });
}

export function findById(id: string) {
  return prisma.booking.findUnique({ where: { id }, select: SELECT });
}

// Conditional UPDATE: an order is attached exactly once. `count === 0` means
// one is already attached (or the booking is gone) and nothing was overwritten.
export async function attachPaymentOrder(id: string, paymentOrderId: string): Promise<boolean> {
  const result = await prisma.booking.updateMany({
    where: { id, paymentOrderId: null },
    data: { paymentOrderId },
  });
  return result.count === 1;
}
