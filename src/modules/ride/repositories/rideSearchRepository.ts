import { Prisma } from '../../../generated/prisma/client';
import type { VehicleType } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';
import type { Coordinates } from '../../../infrastructure/maps';

// A ride matches when its origin is within this many metres of the pickup
// point AND its destination is within the same distance of the drop point.
const SEARCH_RADIUS_METERS = 10_000;

interface RawSearchRow {
  id: string;
  departureTime: Date;
  availableSeats: number;
  farePerSeat: unknown;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
  driverId: string;
  driverName: string;
  driverRatingAverage: unknown;
  vehicleType: VehicleType;
  vehicleModel: string | null;
  vehicleIsAc: boolean;
}

export interface RideSearchRecord {
  id: string;
  departureTime: Date;
  availableSeats: number;
  farePerSeat: number;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
  driverId: string;
  driverName: string;
  driverRatingAverage: number | null;
  vehicleType: VehicleType;
  vehicleModel: string | null;
  vehicleIsAc: boolean;
}

export interface SearchRidesParams {
  pickup: Coordinates;
  destination: Coordinates;
  // Half-open UTC interval [dayStart, dayEnd) for the requested calendar day.
  dayStart: Date;
  dayEnd: Date;
  limit: number;
}

function point({ lat, lng }: Coordinates): Prisma.Sql {
  // Longitude FIRST — reversed, every point lands in the wrong hemisphere.
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
}

// The whole match is ONE query, filtered in the database — never fetched and
// filtered in Node, which can't use an index and would break LIMIT. The map
// provider is never called from here: it is for routing and geocoding, not
// discovery.
//
//  - The date range is a plain comparison on the indexed column (never
//    DATE(departure_time), which would discard the index and silently use the
//    server's timezone).
//  - `status IN ('OPEN','FULL')` AND `available_seats > 0`: PENDING_PAYMENT
//    rides (commission not yet confirmed) are never discoverable, and FULL
//    alone is not evidence of unavailability — the seat count decides.
//  - Two ST_DWithin calls use the GiST indexes on the geography columns;
//    ST_Distance (exact, on the spheroid) runs only for rows that survive.
//
// Every value is a bound parameter; nothing client-supplied is ever
// interpolated into the SQL text.
export async function search(params: SearchRidesParams): Promise<RideSearchRecord[]> {
  const pickup = point(params.pickup);
  const destination = point(params.destination);

  const rows = await prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
    SELECT
      r.id,
      r.departure_time AS "departureTime",
      r.available_seats AS "availableSeats",
      r.fare_per_seat AS "farePerSeat",
      ST_Distance(r.origin, ${pickup}) AS "pickupDistanceMeters",
      ST_Distance(r.destination, ${destination}) AS "destinationDistanceMeters",
      u.id AS "driverId",
      u.name AS "driverName",
      u.driver_rating_average AS "driverRatingAverage",
      v.vehicle_type AS "vehicleType",
      v.model AS "vehicleModel",
      v.is_ac AS "vehicleIsAc"
    FROM rides r
    JOIN vehicles v ON v.id = r.vehicle_id
    JOIN users u ON u.id = r.driver_id
    WHERE r.departure_time >= ${params.dayStart.toISOString()}::timestamptz
      AND r.departure_time < ${params.dayEnd.toISOString()}::timestamptz
      AND r.status IN ('OPEN', 'FULL')
      AND r.available_seats > 0
      AND ST_DWithin(r.origin, ${pickup}, ${SEARCH_RADIUS_METERS}::float8)
      AND ST_DWithin(r.destination, ${destination}, ${SEARCH_RADIUS_METERS}::float8)
    ORDER BY r.departure_time ASC, r.id ASC
    LIMIT ${params.limit}::int
  `);

  // Numeric columns may come back as Prisma.Decimal; converted to plain
  // numbers here, at the mapping boundary.
  return rows.map((row) => ({
    ...row,
    farePerSeat: Number(row.farePerSeat),
    pickupDistanceMeters: Number(row.pickupDistanceMeters),
    destinationDistanceMeters: Number(row.destinationDistanceMeters),
    driverRatingAverage: row.driverRatingAverage === null ? null : Number(row.driverRatingAverage),
  }));
}
