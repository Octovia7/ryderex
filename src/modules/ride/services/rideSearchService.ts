import { config } from '../../../config';
import type { VehicleType } from '../../../generated/prisma/enums';
import { kolkataDayRangeUtc } from '../../../utils/kolkataDate';
import * as rideSearchRepository from '../repositories/rideSearchRepository';
import type { SearchRidesQuery } from '../schemas/searchRides.schema';
import { decodeSearchCursor, encodeSearchCursor } from './rideSearchCursor';

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

export interface RideSearchPage {
  items: RideSearchItemDto[];
  // Opaque; hand it back verbatim as `cursor` (with the same sort) to get the
  // next page. null when this is the last page.
  nextCursor: string | null;
}

export async function searchRides(query: SearchRidesQuery): Promise<RideSearchPage> {
  // Validated before any other work, and against THIS request's sort: a cursor
  // minted for another sort carries a value of the wrong type for the keyset
  // comparison, so it is refused, never reinterpreted.
  const after = query.cursor === undefined ? null : decodeSearchCursor(query.cursor, query.sort);

  const { start, end } = kolkataDayRangeUtc(query.date);
  // Asking for more than the ceiling is not an error — it is clamped.
  const limit = Math.min(query.limit, config.rideSearch.maxLimit);

  // One row more than the page: if it comes back, another page exists — no
  // second COUNT(*) query needed to know.
  const rows = await rideSearchRepository.search({
    pickup: { lat: query.pickupLat, lng: query.pickupLng },
    destination: { lat: query.destinationLat, lng: query.destinationLng },
    dayStart: start,
    dayEnd: end,
    sort: query.sort,
    after,
    limit: limit + 1,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];

  const nextCursor =
    rows.length > limit && lastRow
      ? encodeSearchCursor(query.sort, { value: lastRow.sortValue, id: lastRow.id })
      : null;

  return {
    items: pageRows.map((ride) => ({
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
    })),
    nextCursor,
  };
}
