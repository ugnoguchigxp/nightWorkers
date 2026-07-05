import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchRoutePage } from '../modules/nightworkers/routing/WorkbenchRoutePage';
import { normalizeSettingsSection } from '../modules/nightworkers/routing/workbench-route-state';

export const Route = createFileRoute('/settings/$section')({
  component: SettingsSectionRoute,
});

function SettingsSectionRoute() {
  const { section } = Route.useParams();
  return (
    <WorkbenchRoutePage
      routeState={{ kind: 'settings', section: normalizeSettingsSection(section) }}
    />
  );
}
