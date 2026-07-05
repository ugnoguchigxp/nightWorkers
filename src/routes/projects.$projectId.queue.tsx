import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';
import { normalizeProjectQueueViewMode } from '../modules/nightworkers/routing/workbench-route-state';

export const Route = createFileRoute('/projects/$projectId/queue')({
  validateSearch: (search: Record<string, unknown>) => search,
  component: ProjectQueueRoute,
});

function ProjectQueueRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <WorkbenchRoutePage
      routeState={{
        kind: 'project_queue',
        projectId,
        view: normalizeProjectQueueViewMode(search.view),
      }}
    />
  );
}
