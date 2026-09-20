import { Prisma } from '../../../generated/prisma/client';
import type { RideStatus } from '../../../generated/prisma/enums';
import type { Coordinates } from '../../../infrastructure/maps';
import { prisma } from '../../../infrastructure/database/prismaClient';

// Prisma Client has no native geography type, so every read that needs
// coordinates and the one write (INSERT) go through raw SQL, confined to
// this file. Longitude comes FIRST in ST_MakePoint — reversed, every Indian
// ride would land in the Indian Ocean. Reads that don't need coordinates use
// the ordinary Prisma client instead (findStatusById, transitionStatus).
//
// The only fragment interpolated as raw SQL is this compile-time constant
// column list; every value is a bound parameter.
const RIDE_COLUMNS = Prisma.raw(`
  id,
  driver_id AS "driverId",
  vehicle_id AS "vehicleId",
  ST_Y(origin::geometry) AS "originLat",
  ST_X(origin::geometry) AS "originLng",
  ST_Y(destination::geometry) AS "destinationLat",
  ST_X(destination::geometry) AS "destinationLng",
  departure_time AS "departureTime",
  total_seats AS "totalSeats",
  available_seats AS "availableSeats",
  fare_per_seat AS "farePerSeat",
  posting_commission_amount AS "postingCommissionAmount",
  route_geometry AS "routeGeometry",
  route_distance_meters AS "routeDistanceMeters",
  route_duration_seconds AS "routeDurationSeconds",
  payment_order_id AS "paymentOrderId",
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`);

// Numeric columns come back as Prisma.Decimal (or a string, depending on the
// driver path) — typed loosely here and converted to plain numbers at the
// mapping boundary below, so nothing downstream has to know about Decimal.
interface RawRideRow {
  id: string;
  driverId: string;
  vehicleId: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  departureTime: Date;
  totalSeats: number;
  availableSeats: number;
  farePerSeat: unknown;
  postingCommissionAmount: unknown;
  routeGeometry: Coordinates[];
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  paymentOrderId: string;
  status: RideStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RideRecord {
  id: string;
  driverId: string;
  vehicleId: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  departureTime: Date;
  totalSeats: number;
  availableSeats: number;
  farePerSeat: number;
  postingCommissionAmount: number;
  routeGeometry: Coordinates[];
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  paymentOrderId: string;
  status: RideStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toRideRecord(row: RawRideRow): RideRecord {
  return {
    ...row,
    farePerSeat: Number(row.farePerSeat),
    postingCommissionAmount: Number(row.postingCommissionAmount),
  };
}

export interface CreateRideData {
  id: string;
  driverId: string;
  vehicleId: string;
  origin: Coordinates;
  destination: Coordinates;
  departureTime: Date;
  totalSeats: number;
  farePerSeat: number;
  postingCommissionAmount: number;
  routeGeometry: Coordinates[];
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  paymentOrderId: string;
}

// A new ride always starts PENDING_PAYMENT with every seat still available;
// neither is a caller's choice.
export async function create(data: CreateRideData): Promise<RideRecord> {
  const rows = await prisma.$queryRaw<RawRideRow[]>(Prisma.sql`
    INSERT INTO rides (
      id, driver_id, vehicle_id, origin, destination, departure_time,
      total_seats, available_seats, fare_per_seat, posting_commission_amount,
      route_geometry, route_distance_meters, route_duration_seconds,
      payment_order_id, status, updated_at
    ) VALUES (
      ${data.id}::uuid,
      ${data.driverId}::uuid,
      ${data.vehicleId}::uuid,
      ST_SetSRID(ST_MakePoint(${data.origin.lng}::float8, ${data.origin.lat}::float8), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${data.destination.lng}::float8, ${data.destination.lat}::float8), 4326)::geography,
      ${data.departureTime.toISOString()}::timestamptz,
      ${data.totalSeats}::int,
      ${data.totalSeats}::int,
      ${data.farePerSeat}::numeric,
      ${data.postingCommissionAmount}::numeric,
      ${JSON.stringify(data.routeGeometry)}::jsonb,
      ${data.routeDistanceMeters}::int,
      ${data.routeDurationSeconds}::int,
      ${data.paymentOrderId},
      'PENDING_PAYMENT'::ride_status,
      now()
    )
    RETURNING ${RIDE_COLUMNS}
  `);

  return toRideRecord(rows[0] as RawRideRow);
}

export async function findById(id: string): Promise<RideRecord | null> {
  const rows = await prisma.$queryRaw<RawRideRow[]>(
    Prisma.sql`SELECT ${RIDE_COLUMNS} FROM rides WHERE id = ${id}::uuid`,
  );
  const row = rows[0];

  return row ? toRideRecord(row) : null;
}

// No coordinates needed, so the ordinary Prisma client is fine here.
export function findStatusById(id: string) {
  return prisma.ride.findUnique({
    where: { id },
    select: { id: true, driverId: true, status: true },
  });
}

// Conditional UPDATE: the WHERE enumerates every legal source state, so the
// guard and the write are one statement. `count === 0` means the ride was
// not in one of them (someone else moved it first) and nothing was written.
export async function transitionStatus(
  id: string,
  from: RideStatus[],
  to: RideStatus,
): Promise<boolean> {
  const result = await prisma.ride.updateMany({
    where: { id, status: { in: from } },
    data: { status: to },
  });
  return result.count === 1;
}
