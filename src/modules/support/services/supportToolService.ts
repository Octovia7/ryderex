import { z } from 'zod';
import type { BookingStatus, RideStatus } from '../../../generated/prisma/enums';
import type { AIToolCall, AIToolDefinition } from '../../../infrastructure/ai';
import { AppError } from '../../../shared/AppError';
import * as bookingService from '../../booking/services/bookingService';
import type { BookingDto } from '../../booking/services/bookingService';
import * as rideService from '../../ride/services/rideService';
import type { RideDto } from '../../ride/services/rideService';

// The four tools, exactly (architecture.md §17's own table) — no identity
// parameter on any of them, ever. The executor below binds `userId` from
// the authenticated session; the model's only degrees of freedom are which
// tool to call and which resource id to pass.
export const SUPPORT_TOOLS: AIToolDefinition[] = [
  {
    name: 'getMyRecentBookings',
    description: "Get the caller's own 10 most recent bookings, as a passenger, with their status.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'getBookingStatus',
    description: 'Get the status and details of one booking by its id.',
    parameters: {
      type: 'object',
      properties: { bookingId: { type: 'string', description: 'The booking id (UUID).' } },
      required: ['bookingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'getMyRecentRidesAsDriver',
    description: "Get the caller's own 10 most recent rides posted as a driver, with their status.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'getRideStatus',
    description: 'Get the status and details of one ride by its id.',
    parameters: {
      type: 'object',
      properties: { rideId: { type: 'string', description: 'The ride id (UUID).' } },
      required: ['rideId'],
      additionalProperties: false,
    },
  },
];

// Results are projected, not raw DTOs (architecture.md §17): a raw
// `RideDto` ships `routeGeometry` (~10,000 characters of route coordinates)
// and the driver's own `postingCommissionAmount` into the model's context
// on every lookup — neither is useful to a support answer, and the second
// is a different user's private earning figure when the caller is a
// passenger asking about someone else's ride.
interface BookingSummary {
  id: string;
  rideId: string;
  seats: number;
  farePerSeat: number;
  totalFare: number;
  prepaidAmount: number;
  status: BookingStatus;
  createdAt: string;
}

interface RideSummary {
  id: string;
  departureTime: string;
  totalSeats: number;
  availableSeats: number;
  farePerSeat: number;
  status: RideStatus;
  createdAt: string;
}

function toBookingSummary(booking: BookingDto): BookingSummary {
  return {
    id: booking.id,
    rideId: booking.rideId,
    seats: booking.seats,
    farePerSeat: booking.farePerSeat,
    totalFare: booking.totalFare,
    prepaidAmount: booking.prepaidAmount,
    status: booking.status,
    createdAt: booking.createdAt.toISOString(),
  };
}

function toRideSummary(ride: RideDto): RideSummary {
  return {
    id: ride.id,
    departureTime: ride.departureTime.toISOString(),
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    farePerSeat: ride.farePerSeat,
    status: ride.status,
    createdAt: ride.createdAt.toISOString(),
  };
}

const bookingIdArgsSchema = z.object({ bookingId: z.string().uuid() });
const rideIdArgsSchema = z.object({ rideId: z.string().uuid() });

// The executor binds `userId` from the SESSION (architecture.md §17) —
// never from the model's own arguments, which never include one. A tool
// failure (invalid arguments, or the ownership-checked service method's own
// 404) becomes a plain result the model is told about, never a thrown error
// that would abort the turn — "the tool layer refused and the assistant
// reported not-found, leaking nothing."
export async function executeToolCall(userId: string, call: AIToolCall): Promise<unknown> {
  try {
    switch (call.name) {
      case 'getMyRecentBookings': {
        const bookings = await bookingService.getMyRecentBookings(userId);
        return bookings.map(toBookingSummary);
      }

      case 'getBookingStatus': {
        const parsed = bookingIdArgsSchema.safeParse(call.arguments);

        if (!parsed.success) {
          return { error: 'A valid bookingId is required.' };
        }

        const booking = await bookingService.getBooking(userId, parsed.data.bookingId);
        return toBookingSummary(booking);
      }

      case 'getMyRecentRidesAsDriver': {
        const rides = await rideService.getMyRecentRidesAsDriver(userId);
        return rides.map(toRideSummary);
      }

      case 'getRideStatus': {
        const parsed = rideIdArgsSchema.safeParse(call.arguments);

        if (!parsed.success) {
          return { error: 'A valid rideId is required.' };
        }

        const ride = await rideService.getRide(parsed.data.rideId);
        return toRideSummary(ride);
      }

      default:
        return { error: `Unknown tool: ${call.name}` };
    }
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }

    throw error;
  }
}
