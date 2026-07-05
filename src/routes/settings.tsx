import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';

export const Route = createFileRoute('/settings')({
  component: SettingsDefaultRoute,
});

function SettingsDefaultRoute() {
  return <WorkbenchRoutePage routeState={{ kind: 'settings', section: 'general' }} />;
}
