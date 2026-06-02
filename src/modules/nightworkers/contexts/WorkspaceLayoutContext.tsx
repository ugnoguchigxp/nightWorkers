import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type WorkspacePanelSizes = [number, number];

type WorkspaceLayoutState = {
  panelSizes: WorkspacePanelSizes;
};

type WorkspaceLayoutActions = {
  setPanelSizes: (sizes: number[]) => void;
};

const STORAGE_KEY = 'nightworkers.workspaceLayout.v1';
const DEFAULT_PANEL_SIZES: WorkspacePanelSizes = [26, 74];
const MIN_SIDEBAR_SIZE = 18;
const MAX_SIDEBAR_SIZE = 42;

const WorkspaceLayoutStateContext = createContext<WorkspaceLayoutState | null>(null);
const WorkspaceLayoutActionsContext = createContext<WorkspaceLayoutActions | null>(null);

function clampSidebarSize(size: number) {
  return Math.min(MAX_SIDEBAR_SIZE, Math.max(MIN_SIDEBAR_SIZE, size));
}

function normalizePanelSizes(value: unknown): WorkspacePanelSizes {
  if (!Array.isArray(value) || value.length !== 2) return DEFAULT_PANEL_SIZES;

  const [sidebar, chat] = value;
  if (typeof sidebar !== 'number' || typeof chat !== 'number') return DEFAULT_PANEL_SIZES;
  if (!Number.isFinite(sidebar) || !Number.isFinite(chat) || sidebar <= 0 || chat <= 0) {
    return DEFAULT_PANEL_SIZES;
  }

  const normalizedSidebar = clampSidebarSize(sidebar);
  return [normalizedSidebar, 100 - normalizedSidebar];
}

function readStoredPanelSizes(): WorkspacePanelSizes {
  if (typeof window === 'undefined') return DEFAULT_PANEL_SIZES;

  try {
    return normalizePanelSizes(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return DEFAULT_PANEL_SIZES;
  }
}

function storePanelSizes(panelSizes: WorkspacePanelSizes) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(panelSizes));
}

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  const [panelSizes, setPanelSizesState] = useState<WorkspacePanelSizes>(readStoredPanelSizes);

  const setPanelSizes = useCallback((sizes: number[]) => {
    const nextPanelSizes = normalizePanelSizes(sizes);
    setPanelSizesState(nextPanelSizes);
    storePanelSizes(nextPanelSizes);
  }, []);

  const state = useMemo<WorkspaceLayoutState>(() => ({ panelSizes }), [panelSizes]);
  const actions = useMemo<WorkspaceLayoutActions>(() => ({ setPanelSizes }), [setPanelSizes]);

  return (
    <WorkspaceLayoutStateContext.Provider value={state}>
      <WorkspaceLayoutActionsContext.Provider value={actions}>
        {children}
      </WorkspaceLayoutActionsContext.Provider>
    </WorkspaceLayoutStateContext.Provider>
  );
}

export function useWorkspaceLayoutState() {
  const state = useContext(WorkspaceLayoutStateContext);
  if (!state)
    throw new Error('useWorkspaceLayoutState must be used within WorkspaceLayoutProvider');
  return state;
}

export function useWorkspaceLayoutActions() {
  const actions = useContext(WorkspaceLayoutActionsContext);
  if (!actions) {
    throw new Error('useWorkspaceLayoutActions must be used within WorkspaceLayoutProvider');
  }
  return actions;
}
