import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';

export const Route = createFileRoute('/projects/$projectId/detail')({
  component: ProjectDetailDefaultRoute,
});

function ProjectDetailDefaultRoute() {
  const { projectId } = Route.useParams();
  return <WorkbenchRoutePage routeState={{ kind: 'project_detail', projectId, tab: 'overview' }} />;
}
