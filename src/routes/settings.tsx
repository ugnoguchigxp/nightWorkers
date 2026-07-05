import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';

export const Route = createFileRoute('/settings')({
  component: SettingsDefaultRoute,
});

function SettingsDefaultRoute() {
  const location = useLocation();
  if (location.pathname !== '/settings') return <Outlet />;
  return <WorkbenchRoutePage routeState={{ kind: 'settings', section: 'general' }} />;
}
