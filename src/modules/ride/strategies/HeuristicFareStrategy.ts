import { config } from '../../../config';
import type { FareInput, FareStrategy } from './FareStrategy';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// null/undefined (unrated) is neutral — 1.0. Otherwise linearly interpolated
// across the 1-5 rating range between the configured bounds, so a rating can
// move the fare by at most the configured spread (±5% by default) — bounded
// on purpose, since multipliers compose multiplicatively and a single
// unbounded one is a pricing incident.
function ratingMultiplier(rating: number | null | undefined): number {
  if (rating === null || rating === undefined) {
    return 1;
  }

  const { ratingMultiplierMin: min, ratingMultiplierMax: max } = config.fare;
  const clamped = clamp(rating, 1, 5);
  return min + ((clamped - 1) / 4) * (max - min);
}

// (baseFare + km * pricePerKm) * vehicleMultiplier * clamp(traffic) * ratingMultiplier,
// rounded — exactly the formula in architecture.md §12.
export class HeuristicFareStrategy implements FareStrategy {
  calculateFare(input: FareInput): number {
    const distanceKm = input.distanceMeters / 1000;
    const distanceComponent = config.fare.baseFare + distanceKm * config.fare.pricePerKm;
    const vehicleMultiplier = config.fare.vehicleMultipliers[input.vehicleType];
    const traffic = clamp(
      input.trafficMultiplier ?? 1,
      config.fare.trafficMultiplierMin,
      config.fare.trafficMultiplierMax,
    );

    const fare =
      distanceComponent * vehicleMultiplier * traffic * ratingMultiplier(input.driverRating);

    return Math.round(fare);
  }
}
