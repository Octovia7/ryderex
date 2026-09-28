import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prismaClient';

// Plain Prisma Client for the insert/read; raw SQL only for the aggregate
// UPDATE below, which needs a column choice no ORM call can parameterise.
type Client = Pick<typeof prisma, 'rating'>;
type SqlClient = Pick<typeof prisma, '$executeRaw'>;

export interface CreateRatingData {
  bookingId: string;
  rideId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment: string | null;
}

export interface RatingRecord {
  id: string;
  bookingId: string;
  rideId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment: string | null;
  createdAt: Date;
}

const RATING_SELECT = {
  id: true,
  bookingId: true,
  rideId: true,
  raterId: true,
  rateeId: true,
  score: true,
  comment: true,
  createdAt: true,
} as const;

// Ratings are immutable — no update or delete path exists anywhere in this
// codebase (architecture.md's Ratings section). `@@unique([bookingId,
// raterId])` is the sole duplicate guard; a repeat submission surfaces here
// as Prisma's own P2002 error. This repository does not catch or interpret
// it — translating that into `409 ALREADY_RATED` is the service layer's job,
// a later step.
export function create(client: Client, data: CreateRatingData): Promise<RatingRecord> {
  return client.rating.create({ data, select: RATING_SELECT });
}

// Every rating recorded against one booking (at most two: passenger→driver
// and driver→passenger) — the service layer's read path, a later step.
export function findByBookingId(client: Client, bookingId: string): Promise<RatingRecord[]> {
  return client.rating.findMany({
    where: { bookingId },
    select: RATING_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

export type RateeRole = 'DRIVER' | 'PASSENGER';

// The role-specific column pair to fold a new score into. Selected by a
// `switch` over a role THIS repository's caller derives and validates
// itself (never a client-supplied string) and emitted as compile-time
// `Prisma.raw` fragments — the same discipline rideSearchRepository's
// `sortSpec` already uses to keep a column-name choice out of a bound
// parameter position, where SQL syntax does not allow one.
function aggregateColumns(role: RateeRole): { average: Prisma.Sql; count: Prisma.Sql } {
  switch (role) {
    case 'DRIVER':
      return {
        average: Prisma.raw('driver_rating_average'),
        count: Prisma.raw('driver_rating_count'),
      };
    case 'PASSENGER':
      return {
        average: Prisma.raw('passenger_rating_average'),
        count: Prisma.raw('passenger_rating_count'),
      };
    default: {
      const unreachable: never = role;
      throw new Error(`Unsupported rating role: ${String(unreachable)}`);
    }
  }
}

// The one atomic UPDATE that folds a new score into the ratee's running
// average (architecture.md "Ratings — the aggregate must not be read-
// modify-write"). The new average is computed INSIDE this statement, so the
// row lock the UPDATE already takes covers the read as well — the same
// shape as `rideRepository.reserveSeats`. Must run in the SAME transaction
// as the Rating insert (the caller's responsibility, a later step), so a
// duplicate rejected by the unique constraint rolls the aggregate back with
// it and can never double-count.
//
// `rateeId` always references a real, FK-enforced row — a zero-row update
// is an invariant violation, not a normal outcome, so it throws rather than
// silently no-op'ing.
export async function applyToAggregate(
  client: SqlClient,
  rateeId: string,
  role: RateeRole,
  score: number,
): Promise<void> {
  const { average, count } = aggregateColumns(role);

  const affected = await client.$executeRaw`
    UPDATE users
    SET ${average} = ROUND(
          ((COALESCE(${average}, 0) * ${count}) + ${score}::int)
          / (${count} + 1), 2
        ),
        ${count} = ${count} + 1
    WHERE id = ${rateeId}::uuid
  `;

  if (affected !== 1) {
    throw new Error(`Rating aggregate update matched no user row for ratee ${rateeId}.`);
  }
}
