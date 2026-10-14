import { GEOAPIFY_API_KEY } from './config';

// A deliberately separate client from ./client.ts: this calls Geoapify
// directly from the browser (api.geoapify.com), never our own backend —
// there is no places/autocomplete endpoint there, and this must not be
// mistaken for one. Response shape confirmed by a live call against the
// real API (format=json), not assumed from documentation.
export interface PlaceSuggestion {
  label: string;
  lat: number;
  lon: number;
  placeId: string;
}

interface GeoapifyAutocompleteResult {
  formatted: string;
  lat: number;
  lon: number;
  place_id: string;
}

export class PlacesUnavailableError extends Error {
  constructor() {
    super('Place search is not configured.');
    this.name = 'PlacesUnavailableError';
  }
}

export async function autocompletePlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  if (!GEOAPIFY_API_KEY) {
    throw new PlacesUnavailableError();
  }
  if (query.trim().length < 3) {
    return [];
  }

  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', query);
  url.searchParams.set('filter', 'countrycode:in');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('apiKey', GEOAPIFY_API_KEY);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error('Place search failed.');
  }
  const body = (await response.json()) as { results?: GeoapifyAutocompleteResult[] };

  return (body.results ?? []).map((result) => ({
    label: result.formatted,
    lat: result.lat,
    lon: result.lon,
    placeId: result.place_id,
  }));
}
