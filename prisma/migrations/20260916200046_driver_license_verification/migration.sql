-- CreateEnum
CREATE TYPE "driver_license_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "driver_license_rejection_reason" TEXT,
ADD COLUMN     "driver_license_status" "driver_license_status",
ADD COLUMN     "driver_license_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "driver_license_verified_by" UUID;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_driver_license_verified_by_fkey" FOREIGN KEY ("driver_license_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
