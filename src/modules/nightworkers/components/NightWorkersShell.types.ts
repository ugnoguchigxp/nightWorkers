import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import type { WorkbenchRouteState } from '../routing/workbench-route-state';

export type NightWorkersShellProps = {
  workspace: NightWorkersWorkspaceState;
  routeState: WorkbenchRouteState;
  onNavigate: (routeState: WorkbenchRouteState, options?: { replace?: boolean }) => void;
  showFolderBrowser: boolean;
  onOpenFolderBrowser: () => void;
  onCloseFolderBrowser: () => void;
};
