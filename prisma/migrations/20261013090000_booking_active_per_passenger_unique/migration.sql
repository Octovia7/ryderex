-- CreateIndex (hand-written: Prisma's schema DSL has no syntax for a
-- partial index WHERE predicate, so this constraint has no representation
-- in schema.prisma and Prisma has no record it exists. Any later
-- `prisma migrate dev --create-only` touching "bookings" may propose
-- `DROP INDEX "bookings_active_ride_passenger_key"` — strip that line
-- before applying. The exact same hazard, and the exact same fix, as the
-- rides_origin_gist / rides_destination_gist indexes (docs/claude.md §13).
--
-- Enforces the approved business rule: a passenger may have at most one
-- PENDING_PAYMENT or CONFIRMED booking for a given ride at a time. Scoped
-- to those two statuses only, not table-wide — CANCELLED and
-- PAYMENT_FAILED are permanent dead ends for that specific row (no
-- retry/reactivate endpoint exists for either), so a passenger must still
-- be able to create a new booking once an earlier one on this ride reaches
-- either state. `IF NOT EXISTS` matches this repository's own convention
-- for a hand-written index that might already exist from a prior partial
-- apply (see rides_origin_gist/rides_destination_gist above) — but it only
-- guards against a NAME collision. PostgreSQL does not check whether a
-- pre-existing index named "bookings_active_ride_passenger_key" actually
-- has these columns, is UNIQUE, or carries this WHERE predicate; if a
-- same-named but differently-defined index already existed, this statement
-- would silently no-op and leave the wrong constraint in place. That can
-- only happen from a prior hand-edit under this same name, not from a
-- normal first apply.
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_active_ride_passenger_key"
  ON "bookings" ("ride_id", "passenger_id")
  WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED');
