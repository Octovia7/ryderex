import { config } from '../../../config';
import type { VehicleType } from '../../../generated/prisma/enums';
import { AppError } from '../../../shared/AppError';
import { kolkataDayRangeUtc } from '../../../utils/kolkataDate';
import * as rideSearchRepository from '../repositories/rideSearchRepository';
import type { SearchRidesQuery } from '../schemas/searchRides.schema';

// Deliberately lean — a search page can hold dozens of rides, so it carries
// none of the ride's route geometry or the driver's commission.
export interface RideSearchItemDto {
  id: string;
  departureTime: Date;
  availableSeats: number;
  farePerSeat: number;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
  driver: { id: string; name: string; ratingAverage: number | null };
  vehicle: { vehicleType: VehicleType; model: string | null; isAc: boolean };
}

export async function searchRides(query: SearchRidesQuery): Promise<RideSearchItemDto[]> {
  // Cursor pagination does not exist yet, so no response has ever carried a
  // `nextCursor`: any cursor a client sends is not one we minted. Refuse it
  // rather than quietly returning the first page again, which would make a
  // page-walking client repeat rows forever. Real cursor decoding replaces
  // this check when pagination is built.
  if (query.cursor !== undefined) {
    throw new AppError({
      statusCode: 400,
      code: 'INVALID_CURSOR',
      message: 'The pagination cursor is not valid.',
    });
  }

  const { start, end } = kolkataDayRangeUtc(query.date);
  // Asking for more than the ceiling is not an error — it is clamped.
  const limit = Math.min(query.limit, config.rideSearch.maxLimit);

  const rides = await rideSearchRepository.search({
    pickup: { lat: query.pickupLat, lng: query.pickupLng },
    destination: { lat: query.destinationLat, lng: query.destinationLng },
    dayStart: start,
    dayEnd: end,
    limit,
  });

  return rides.map((ride) => ({
    id: ride.id,
    departureTime: ride.departureTime,
    availableSeats: ride.availableSeats,
    farePerSeat: ride.farePerSeat,
    // Whole metres: the exact spheroid figure is only meaningful to the
    // database, which ranks by it; a client just needs a readable distance.
    pickupDistanceMeters: Math.round(ride.pickupDistanceMeters),
    destinationDistanceMeters: Math.round(ride.destinationDistanceMeters),
    driver: {
      id: ride.driverId,
      name: ride.driverName,
      ratingAverage: ride.driverRatingAverage,
    },
    vehicle: {
      vehicleType: ride.vehicleType,
      model: ride.vehicleModel,
      isAc: ride.vehicleIsAc,
    },
  }));
}
