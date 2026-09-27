import { Prisma } from '../../../generated/prisma/client';
import type { VehicleType } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';
import type { Coordinates } from '../../../infrastructure/maps';
import type { SearchSort } from '../schemas/searchRides.schema';

// A ride matches when its origin is within this many metres of the pickup
// point AND its destination is within the same distance of the drop point.
export const SEARCH_RADIUS_METERS = 10_000;

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
  sortValue: string;
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
  // The row's value for the active sort expression, as text exactly as
  // PostgreSQL rendered it — what a keyset cursor carries for this row.
  sortValue: string;
}

// The keyset position to resume after: the sort value and id of the last row
// of the previous page. Already validated for form by the cursor module.
export interface SearchAfter {
  value: string;
  id: string;
}

export interface SearchRidesParams {
  pickup: Coordinates;
  destination: Coordinates;
  // Half-open UTC interval [dayStart, dayEnd) for the requested calendar day.
  dayStart: Date;
  dayEnd: Date;
  sort: SearchSort;
  after: SearchAfter | null;
  // Rows to fetch. The caller asks for one more than the page size — the extra
  // row is how it learns whether a next page exists, without a COUNT(*).
  limit: number;
}

function point({ lat, lng }: Coordinates): Prisma.Sql {
  // Longitude FIRST — reversed, every point lands in the wrong hemisphere.
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
}

interface SortSpec {
  // What the query orders by, and what the keyset comparison is made against.
  order: Prisma.Sql;
  // Appended to the bound cursor value so the comparison matches the type of
  // `order` — a text parameter compared to a timestamp/double/numeric would
  // otherwise fail, or silently compare as text.
  cast: Prisma.Sql;
  // The same value rendered as text, for the cursor. Rendered by the database
  // so a double or a numeric is never rounded or reformatted on the way out
  // and back in; a timestamp is pinned to one canonical UTC form.
  valueText: Prisma.Sql;
}

// The ONLY place a sort becomes SQL. A validated enum selects one of five
// fixed expressions; nothing the client sends is ever interpolated — that is
// the whole SQL-injection story for this endpoint. Every sort is ascending
// and every ORDER BY ends `, r.id ASC`: without a unique tie-breaker two rides
// that tie have no defined relative order and keyset pagination can skip or
// repeat rows across a page boundary.
function sortSpec(sort: SearchSort, pickup: Prisma.Sql, destination: Prisma.Sql): SortSpec {
  switch (sort) {
    case 'DEPARTURE_TIME':
      return {
        order: Prisma.sql`r.departure_time`,
        cast: Prisma.raw('::timestamptz'),
        valueText: Prisma.sql`to_char(r.departure_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      };
    case 'PICKUP_DISTANCE':
      return {
        order: Prisma.sql`ST_Distance(r.origin, ${pickup})`,
        cast: Prisma.raw('::double precision'),
        valueText: Prisma.sql`(ST_Distance(r.origin, ${pickup}))::text`,
      };
    case 'DESTINATION_DISTANCE':
      return {
        order: Prisma.sql`ST_Distance(r.destination, ${destination})`,
        cast: Prisma.raw('::double precision'),
        valueText: Prisma.sql`(ST_Distance(r.destination, ${destination}))::text`,
      };
    case 'FARE':
      return {
        order: Prisma.sql`r.fare_per_seat`,
        cast: Prisma.raw('::numeric'),
        valueText: Prisma.sql`(r.fare_per_seat)::text`,
      };
    case 'DRIVER_RATING':
      // 6 sits just above the 1-5 range, so an unrated driver sorts last
      // while NULL stays out of the comparison tuple — `(a, b) > (NULL, c)`
      // is not a total order.
      return {
        order: Prisma.sql`COALESCE(u.driver_rating_average, 6)`,
        cast: Prisma.raw('::numeric'),
        valueText: Prisma.sql`(COALESCE(u.driver_rating_average, 6))::text`,
      };
    default: {
      const unreachable: never = sort;
      throw new Error(`Unsupported search sort: ${String(unreachable)}`);
    }
  }
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
//  - Pagination is keyset, never OFFSET: `(sort, id) > (cursor value, cursor
//    id)` resumes exactly after the last row seen, so a row inserted or
//    removed between requests cannot shift the pages, and page N costs the
//    same as page 1.
//
// Every value is a bound parameter; nothing client-supplied is ever
// interpolated into the SQL text.
export async function search(params: SearchRidesParams): Promise<RideSearchRecord[]> {
  const pickup = point(params.pickup);
  const destination = point(params.destination);
  const spec = sortSpec(params.sort, pickup, destination);

  const keyset = params.after
    ? Prisma.sql`AND (${spec.order}, r.id) > (${params.after.value}${spec.cast}, ${params.after.id}::uuid)`
    : Prisma.empty;

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
      v.is_ac AS "vehicleIsAc",
      ${spec.valueText} AS "sortValue"
    FROM rides r
    JOIN vehicles v ON v.id = r.vehicle_id
    JOIN users u ON u.id = r.driver_id
    WHERE r.departure_time >= ${params.dayStart.toISOString()}::timestamptz
      AND r.departure_time < ${params.dayEnd.toISOString()}::timestamptz
      AND r.status IN ('OPEN', 'FULL')
      AND r.available_seats > 0
      AND ST_DWithin(r.origin, ${pickup}, ${SEARCH_RADIUS_METERS}::float8)
      AND ST_DWithin(r.destination, ${destination}, ${SEARCH_RADIUS_METERS}::float8)
      ${keyset}
    ORDER BY ${spec.order} ASC, r.id ASC
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
