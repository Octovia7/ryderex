import type { VehicleType } from '../../../generated/prisma/enums';

export interface FareInput {
  distanceMeters: number;
  vehicleType: VehicleType;
  // Bounds-checked but optional — no caller supplies it yet, so it defaults
  // to neutral (1.0) rather than requiring every caller to pass one.
  trafficMultiplier?: number;
  // null/undefined (unrated) is neutral (1.0) — see HeuristicFareStrategy.
  driverRating?: number | null;
}

// One call site (fareService.calculateFare) depends on this, not on a
// concrete strategy — the future Ride module injects one for testability,
// the same Strategy-pattern shape as MapProvider/PaymentProvider.
export interface FareStrategy {
  calculateFare(input: FareInput): number;
}
