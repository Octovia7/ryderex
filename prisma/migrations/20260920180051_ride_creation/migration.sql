-- CreateEnum
CREATE TYPE "ride_status" AS ENUM ('PENDING_PAYMENT', 'OPEN', 'FULL', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "rides" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "origin" geography(Point,4326) NOT NULL,
    "destination" geography(Point,4326) NOT NULL,
    "departure_time" TIMESTAMPTZ(3) NOT NULL,
    "total_seats" INTEGER NOT NULL,
    "available_seats" INTEGER NOT NULL,
    "fare_per_seat" DECIMAL(10,2) NOT NULL,
    "posting_commission_amount" DECIMAL(10,2) NOT NULL,
    "route_geometry" JSONB NOT NULL,
    "route_distance_meters" INTEGER NOT NULL,
    "route_duration_seconds" INTEGER NOT NULL,
    "payment_order_id" TEXT NOT NULL,
    "status" "ride_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rides_driver_id_idx" ON "rides"("driver_id");

-- CreateIndex
CREATE INDEX "rides_vehicle_id_idx" ON "rides"("vehicle_id");

-- CreateIndex
CREATE INDEX "rides_departure_time_status_idx" ON "rides"("departure_time", "status");

-- CreateIndex (hand-written: Prisma cannot declare an @@index on an
-- Unsupported column, so it has no record these exist and will propose
-- dropping them in any later migration touching "rides" — strip those.)
CREATE INDEX IF NOT EXISTS "rides_origin_gist" ON "rides" USING GIST ("origin");

-- CreateIndex (hand-written, see above)
CREATE INDEX IF NOT EXISTS "rides_destination_gist" ON "rides" USING GIST ("destination");

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
