// Single source for the backend's base URL — every API call goes through
// this, never a hardcoded origin inline at the call site. Falls back to the
// local backend's own default port (PORT=4000, src/config/env.ts) so
// `npm run dev` works out of the box against a locally-run backend without
// requiring a .env file first.
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1'
).replace(/\/+$/, '');

// Deliberately separate from the backend's own MAP_PROVIDER_API_KEY — this
// one is used directly from the browser (Geoapify's autocomplete endpoint
// takes it as a plain query parameter), so it's visible in every page's
// network requests by design. Undefined when not configured; callers must
// handle that rather than assume it's always present.
export const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY;
