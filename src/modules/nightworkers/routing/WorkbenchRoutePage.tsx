import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { NightWorkersShell } from '../components/NightWorkersShell';
import { WorkspaceAppearanceProvider } from '../contexts/WorkspaceAppearanceContext';
import { WorkspaceLayoutProvider } from '../contexts/WorkspaceLayoutContext';
import { useNightWorkersWorkspace } from '../hooks/useNightWorkersWorkspace';
import { writeLastWorkbenchRoute } from './last-workbench-route';
import {
  parseWorkbenchRouteUrl,
  serializeWorkbenchRoute,
  type WorkbenchRouteState,
} from './workbench-route-state';

export function WorkbenchRoutePage({ routeState }: { routeState: WorkbenchRouteState }) {
  const workspace = useNightWorkersWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const currentRoute = useMemo(() => serializeWorkbenchRoute(routeState), [routeState]);

  useEffect(() => {
    writeLastWorkbenchRoute(currentRoute);
  }, [currentRoute]);

  useEffect(() => {
    const currentUrl = `${location.pathname}${location.searchStr}`;
    if (currentUrl === currentRoute) return;
    const nextUrl = parseWorkbenchRouteUrl(currentRoute);
    void navigate({
      to: nextUrl.pathname,
      search: nextUrl.search,
      replace: true,
    } as never);
  }, [currentRoute, location.pathname, location.searchStr, navigate]);

  return (
    <WorkspaceAppearanceProvider>
      <WorkspaceLayoutProvider>
        <NightWorkersShell
          workspace={workspace}
          routeState={routeState}
          onNavigate={(nextRouteState, options) => {
            const to = serializeWorkbenchRoute(nextRouteState);
            const nextUrl = parseWorkbenchRouteUrl(to);
            void navigate({
              to: nextUrl.pathname,
              search: nextUrl.search,
              replace: options?.replace,
            } as never);
          }}
          showFolderBrowser={showFolderBrowser}
          onOpenFolderBrowser={() => setShowFolderBrowser(true)}
          onCloseFolderBrowser={() => setShowFolderBrowser(false)}
        />
      </WorkspaceLayoutProvider>
    </WorkspaceAppearanceProvider>
  );
}
