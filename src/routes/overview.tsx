import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';
import { normalizeOverviewRange } from '../modules/nightworkers/routing/workbench-route-state';

export const Route = createFileRoute('/overview')({
  validateSearch: (search: Record<string, unknown>) => search,
  component: OverviewRoute,
});

function OverviewRoute() {
  const search = Route.useSearch();
  return (
    <WorkbenchRoutePage
      routeState={{
        kind: 'overview',
        range: normalizeOverviewRange(search.range),
        projectId: typeof search.projectId === 'string' ? search.projectId : null,
      }}
    />
  );
}
