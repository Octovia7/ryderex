import type { FareInput, FareStrategy } from '../strategies/FareStrategy';
import { HeuristicFareStrategy } from '../strategies/HeuristicFareStrategy';

const defaultFareStrategy: FareStrategy = new HeuristicFareStrategy();

// The single call site the future Ride module (Phase 7) will use. Takes an
// injectable FareStrategy, defaulting to the heuristic one, so callers and
// tests can substitute a different strategy without a second call site ever
// re-deriving the formula.
export function calculateFare(
  input: FareInput,
  strategy: FareStrategy = defaultFareStrategy,
): number {
  return strategy.calculateFare(input);
}
