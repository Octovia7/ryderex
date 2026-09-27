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

// The base client or a transaction client: every function below that takes
// one is composed by a service into ONE transaction with another module's
// write, so it must run on whatever client that transaction hands it.
type SqlClient = Pick<typeof prisma, '$queryRaw' | '$executeRaw'>;

// A new ride always starts PENDING_PAYMENT with every seat still available;
// neither is a caller's choice.
//
// Takes a client (the base client, or a transaction client) so the service
// can run this in the SAME transaction as the Payment/Transaction rows that
// record its posting-commission order — the same pattern reserveSeats and
// releaseSeats below already use.
export async function create(client: SqlClient, data: CreateRideData): Promise<RideRecord> {
  const rows = await client.$queryRaw<RawRideRow[]>(Prisma.sql`
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

// The support chatbot's `getMyRecentRidesAsDriver` tool (architecture.md
// §17) — the caller's own, 10 most recent, newest-first. A plain read;
// result projection for the model happens in the support module, not here.
export async function findRecentByDriverId(driverId: string, limit: number): Promise<RideRecord[]> {
  const rows = await prisma.$queryRaw<RawRideRow[]>(Prisma.sql`
    SELECT ${RIDE_COLUMNS} FROM rides
    WHERE driver_id = ${driverId}::uuid
    ORDER BY created_at DESC
    LIMIT ${limit}::int
  `);

  return rows.map(toRideRecord);
}

// No coordinates needed, so the ordinary Prisma client is fine here.
//
// Takes a client (the base client, or a transaction client) so
// bookingService.cancelBooking's passenger-cancellation guard can run this
// read INSIDE its own transaction (architecture.md's "Cancellation guard":
// re-read the ride's status inside the transaction, never before it, to
// avoid a TOCTOU window against a concurrently-starting ride).
export function findStatusById(client: Pick<typeof prisma, 'ride'>, id: string) {
  return client.ride.findUnique({
    where: { id },
    select: { id: true, driverId: true, status: true },
  });
}

// Conditional UPDATE: the WHERE enumerates every legal source state, so the
// guard and the write are one statement. `count === 0` means the ride was
// not in one of them (someone else moved it first) and nothing was written.
//
// Takes a client (the base client, or a transaction client) so the webhook's
// payment resolution can run this in the SAME transaction as its Payment/
// Transaction rows — the same reason reserveSeats/releaseSeats below take one.
export async function transitionStatus(
  client: Pick<typeof prisma, 'ride'>,
  id: string,
  from: RideStatus[],
  to: RideStatus,
): Promise<boolean> {
  const result = await client.ride.updateMany({
    where: { id, status: { in: from } },
    data: { status: to },
  });
  return result.count === 1;
}

// The driver-cancellation cascade's own conditional UPDATE — a dedicated
// function rather than a `transitionStatus` call, since its source states
// and target never vary: every legal pre-cancellation ride status
// (PENDING_PAYMENT, OPEN, FULL) to CANCELLED, always. Its only call site is
// the cascade in rideService.cancelRide, always inside that cascade's own
// transaction, never standalone.
export async function cancel(client: Pick<typeof prisma, 'ride'>, id: string): Promise<boolean> {
  const result = await client.ride.updateMany({
    where: { id, status: { in: ['PENDING_PAYMENT', 'OPEN', 'FULL'] } },
    data: { status: 'CANCELLED' },
  });
  return result.count === 1;
}

// completeRide's own conditional UPDATE — a dedicated function rather than
// a `transitionStatus` call, the same reasoning as `cancel` above: its
// source state and target never vary (STARTED -> COMPLETED, always). Its
// only call site is rideService.completeRide, which follows a successful
// call with finalPaymentService.createFinalPaymentOrdersForRide(rideId) —
// never inside a transaction with this UPDATE, since that follow-up makes
// external calls per booking.
export async function complete(client: Pick<typeof prisma, 'ride'>, id: string): Promise<boolean> {
  const result = await client.ride.updateMany({
    where: { id, status: 'STARTED' },
    data: { status: 'COMPLETED' },
  });
  return result.count === 1;
}

interface RawReservedSeats {
  farePerSeat: unknown;
  driverId: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
}

export interface ReservedSeats {
  farePerSeat: number;
  driverId: string;
  origin: Coordinates;
  destination: Coordinates;
}

// THE seat-allocation primitive: one conditional UPDATE whose WHERE carries the
// seat guard, so the check and the decrement cannot separate. PostgreSQL takes a
// row-level exclusive lock for the statement's duration; a concurrent
// reservation blocks on it, then re-evaluates `available_seats >= n` against the
// COMMITTED value — and matches nothing. No SELECT ... FOR UPDATE, no advisory or
// Redis lock, no SERIALIZABLE: there is no read-then-write window to lose.
//
// OPEN -> FULL rides along in the same statement (`available_seats - n = 0`), so
// the seat count and the status can never disagree. `null` means the guard
// failed: not enough seats, or the ride is not OPEN/FULL any more.
//
// The fare and both endpoints come back from the same statement, so a booking is
// priced and located from exactly the row whose seats it just took.
export async function reserveSeats(
  client: SqlClient,
  rideId: string,
  seats: number,
): Promise<ReservedSeats | null> {
  const rows = await client.$queryRaw<RawReservedSeats[]>(Prisma.sql`
    UPDATE rides
    SET available_seats = available_seats - ${seats}::int,
        status = CASE WHEN available_seats - ${seats}::int = 0 THEN 'FULL'::ride_status ELSE status END,
        updated_at = now()
    WHERE id = ${rideId}::uuid
      AND status IN ('OPEN', 'FULL')
      AND available_seats >= ${seats}::int
    RETURNING
      fare_per_seat AS "farePerSeat",
      driver_id AS "driverId",
      ST_Y(origin::geometry) AS "originLat",
      ST_X(origin::geometry) AS "originLng",
      ST_Y(destination::geometry) AS "destinationLat",
      ST_X(destination::geometry) AS "destinationLng"
  `);
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    farePerSeat: Number(row.farePerSeat),
    driverId: row.driverId,
    origin: { lat: row.originLat, lng: row.originLng },
    destination: { lat: row.destinationLat, lng: row.destinationLng },
  };
}

// The mirror of reserveSeats: hand seats back, and reopen a FULL ride. The guard
// `available_seats + n <= total_seats` means a release can never push a ride past
// its capacity, however many times it is (wrongly) called — the same "seats are
// never oversold" invariant, from the other side. FULL -> OPEN is the only status
// change: a CANCELLED, STARTED or COMPLETED ride keeps its status.
//
// Not reachable over HTTP yet; the cancellation and expiry paths that call it
// arrive later. `false` means nothing was written.
export async function releaseSeats(
  client: SqlClient,
  rideId: string,
  seats: number,
): Promise<boolean> {
  const affected = await client.$executeRaw(Prisma.sql`
    UPDATE rides
    SET available_seats = available_seats + ${seats}::int,
        status = CASE WHEN status = 'FULL' THEN 'OPEN'::ride_status ELSE status END,
        updated_at = now()
    WHERE id = ${rideId}::uuid
      AND available_seats + ${seats}::int <= total_seats
  `);

  return affected === 1;
}
