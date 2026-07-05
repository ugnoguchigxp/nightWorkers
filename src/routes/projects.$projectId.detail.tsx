import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';

export const Route = createFileRoute('/projects/$projectId/detail')({
  component: ProjectDetailDefaultRoute,
});

function ProjectDetailDefaultRoute() {
  const { projectId } = Route.useParams();
  const location = useLocation();
  if (location.pathname !== `/projects/${projectId}/detail`) return <Outlet />;
  return <WorkbenchRoutePage routeState={{ kind: 'project_detail', projectId, tab: 'overview' }} />;
}
