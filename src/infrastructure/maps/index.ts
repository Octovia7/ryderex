import { config } from '../../config';
import { GeoapifyMapProvider } from './GeoapifyMapProvider';
import type { MapProvider } from './MapProvider';

export type {
  Coordinates,
  DistanceMatrixEntry,
  GeocodeResult,
  MapProvider,
  RouteResult,
} from './MapProvider';

// Only one implementation exists today, but selection is still a factory
// keyed off config — never a concrete class imported by a consumer — so the
// next vendor swap (as already happened once, Mapbox -> Geoapify) stays a
// config change. The `never` branch is unreachable while MAP_PROVIDER has
// only one value; it exists so adding a second one without a case here is a
// compile error, not a silent fallthrough.
function createMapProvider(): MapProvider {
  switch (config.maps.provider) {
    case 'geoapify':
      return new GeoapifyMapProvider();
    default: {
      const exhaustiveCheck: never = config.maps.provider;
      throw new Error(`Unsupported MAP_PROVIDER: ${String(exhaustiveCheck)}`);
    }
  }
}

export const mapProvider: MapProvider = createMapProvider();
