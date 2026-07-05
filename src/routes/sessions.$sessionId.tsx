import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';
import { artifactRouteFromSearch } from '../modules/nightworkers/routing/workbench-route-state';

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: (search: Record<string, unknown>) => search,
  component: SessionRoute,
});

function SessionRoute() {
  const { sessionId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <WorkbenchRoutePage
      routeState={{ kind: 'session', sessionId, artifact: artifactRouteFromSearch(search) }}
    />
  );
}
