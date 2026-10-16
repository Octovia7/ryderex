import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

import { Skeleton } from './ui/Skeleton';
import type { RouteMap } from './RouteMap';

// Leaflet plus its stylesheet is the single largest dependency in this app,
// and only one screen uses a map — splitting it out keeps it off the
// critical path for search, trips, and the whole driver funnel.
const LazyLoadedRouteMap = lazy(async () => {
  const module = await import('./RouteMap');
  return { default: module.RouteMap };
});

export type { MapPoint } from './RouteMap';

export function LazyRouteMap(props: ComponentProps<typeof RouteMap>) {
  return (
    <Suspense fallback={<Skeleton className="h-60 w-full rounded-xl" />}>
      <LazyLoadedRouteMap {...props} />
    </Suspense>
  );
}
