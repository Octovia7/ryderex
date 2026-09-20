import { config } from '../../config';
import { AppError } from '../../shared/AppError';
import type {
  Coordinates,
  DistanceMatrixEntry,
  GeocodeResult,
  MapProvider,
  RouteResult,
} from './MapProvider';

const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const REVERSE_GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/reverse';
const ROUTING_URL = 'https://api.geoapify.com/v1/routing';
const ROUTE_MATRIX_URL = 'https://api.geoapify.com/v1/routematrix';

// `format=json` response shape, shared by forward and reverse geocoding —
// flat result objects, not GeoJSON. An empty `results` array is the
// documented no-match signal, not a thrown error.
interface GeoapifySearchResult {
  lat: number;
  lon: number;
  formatted: string;
}
interface GeoapifySearchResponse {
  results: GeoapifySearchResult[];
}

// Default (GeoJSON) response shape for the Routing API. `coordinates` is a
// MultiLineString: an array of linestrings, each an array of [lon, lat]
// pairs — flattened one level to a single ordered point list.
interface GeoapifyRoutingResponse {
  features: Array<{
    geometry: { coordinates: number[][][] };
    properties: { distance: number; time: number };
  }>;
}

// Route Matrix API response — indexed sources_to_targets[sourceIndex][targetIndex].
interface GeoapifyMatrixResponse {
  sources_to_targets: Array<Array<{ distance: number; time: number }>>;
}

// Geoapify URLs carry the API key in the query string (unlike Brevo, which
// takes it as a header) — architecture.md's sensitive-data hygiene rule
// excludes those URLs from errors/logs for exactly that reason. Nothing
// caught here is ever attached to an AppError verbatim.
function redactApiKey(text: string): string {
  return text.replace(/apiKey=[^&\s]+/gi, 'apiKey=REDACTED');
}

function sanitizeCause(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: redactApiKey(error.message) };
  }
  return undefined;
}

export class GeoapifyMapProvider implements MapProvider {
  private requireApiKey(): string {
    if (!config.maps.geoapifyApiKey) {
      throw new AppError({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'The map provider is not configured.',
      });
    }
    return config.maps.geoapifyApiKey;
  }

  private async getJson<T>(url: string): Promise<T> {
    let response: Response;

    try {
      response = await fetch(url);
    } catch (cause) {
      throw new AppError({
        statusCode: 502,
        code: 'MAP_PROVIDER_ERROR',
        message: 'Failed to reach the map provider.',
        cause: sanitizeCause(cause),
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new AppError({
        statusCode: 502,
        code: 'MAP_PROVIDER_ERROR',
        message: 'The map provider returned an error.',
        cause: { status: response.status, body: redactApiKey(body) },
      });
    }

    return (await response.json()) as T;
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new AppError({
        statusCode: 502,
        code: 'MAP_PROVIDER_ERROR',
        message: 'Failed to reach the map provider.',
        cause: sanitizeCause(cause),
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AppError({
        statusCode: 502,
        code: 'MAP_PROVIDER_ERROR',
        message: 'The map provider returned an error.',
        cause: { status: response.status, body: redactApiKey(text) },
      });
    }

    return (await response.json()) as T;
  }

  private toGeocodeResult(data: GeoapifySearchResponse, notFoundMessage: string): GeocodeResult {
    const result = data.results[0];

    if (!result) {
      throw new AppError({ statusCode: 404, code: 'GEOCODE_NOT_FOUND', message: notFoundMessage });
    }

    return { lat: result.lat, lng: result.lon, formattedAddress: result.formatted };
  }

  async geocode(address: string): Promise<GeocodeResult> {
    const apiKey = this.requireApiKey();
    const params = new URLSearchParams({ text: address, format: 'json', apiKey });
    const data = await this.getJson<GeoapifySearchResponse>(`${GEOCODE_URL}?${params.toString()}`);
    return this.toGeocodeResult(data, 'No location found for the given address.');
  }

  async reverseGeocode(coordinates: Coordinates): Promise<GeocodeResult> {
    const apiKey = this.requireApiKey();
    const params = new URLSearchParams({
      lat: String(coordinates.lat),
      lon: String(coordinates.lng),
      format: 'json',
      apiKey,
    });
    const data = await this.getJson<GeoapifySearchResponse>(
      `${REVERSE_GEOCODE_URL}?${params.toString()}`,
    );
    return this.toGeocodeResult(data, 'No address found for the given coordinates.');
  }

  async getRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult> {
    const apiKey = this.requireApiKey();
    const waypoints = `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`;
    const params = new URLSearchParams({ waypoints, mode: 'drive', apiKey });
    const data = await this.getJson<GeoapifyRoutingResponse>(`${ROUTING_URL}?${params.toString()}`);
    const feature = data.features[0];

    if (!feature) {
      throw new AppError({
        statusCode: 502,
        code: 'MAP_PROVIDER_ERROR',
        message: 'The map provider returned no route.',
      });
    }

    return {
      distanceMeters: feature.properties.distance,
      durationSeconds: feature.properties.time,
      routeGeometry: feature.geometry.coordinates
        .flat()
        .map(([lng, lat]) => ({ lat, lng }) as Coordinates),
    };
  }

  async getDistanceMatrix(
    origins: Coordinates[],
    destinations: Coordinates[],
  ): Promise<DistanceMatrixEntry[][]> {
    const apiKey = this.requireApiKey();
    const body = {
      mode: 'drive',
      sources: origins.map((point) => ({ location: [point.lng, point.lat] })),
      targets: destinations.map((point) => ({ location: [point.lng, point.lat] })),
    };
    const data = await this.postJson<GeoapifyMatrixResponse>(
      `${ROUTE_MATRIX_URL}?apiKey=${apiKey}`,
      body,
    );

    return data.sources_to_targets.map((row) =>
      row.map((cell) => ({ distanceMeters: cell.distance, durationSeconds: cell.time })),
    );
  }
}
