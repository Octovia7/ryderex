-- AlterTable
-- Adds a nullable, passenger-set timestamp recording when a CONFIRMED
-- booking's passenger confirmed they are actually in the car, ahead of the
-- driver starting the ride. A plain nullable column, no default, no backfill
-- needed — every existing row is simply "not confirmed", which is correct
-- for bookings that predate this feature.
ALTER TABLE "bookings" ADD COLUMN "pickup_confirmed_at" TIMESTAMPTZ(3);
