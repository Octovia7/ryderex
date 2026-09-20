export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeocodeResult extends Coordinates {
  formattedAddress: string;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  routeGeometry: Coordinates[];
}

export interface DistanceMatrixEntry {
  distanceMeters: number;
  durationSeconds: number;
}

// Geocoding, routing and distance matrices — exactly the four methods, no
// mapMatch and no tile/rendering concern (a frontend SDK choice, outside this
// interface entirely). GeoapifyMapProvider is the only implementation today,
// but a vendor swap (Mapbox -> Geoapify already happened once, before any
// code existed) touches only infrastructure/maps/ plus config, never a
// module that depends on this interface.
export interface MapProvider {
  geocode(address: string): Promise<GeocodeResult>;
  reverseGeocode(coordinates: Coordinates): Promise<GeocodeResult>;
  getRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult>;
  getDistanceMatrix(
    origins: Coordinates[],
    destinations: Coordinates[],
  ): Promise<DistanceMatrixEntry[][]>;
}
