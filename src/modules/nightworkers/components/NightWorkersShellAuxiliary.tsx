import type { Dispatch, SetStateAction } from 'react';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import { FolderBrowserDialog } from './FolderBrowserDialog';

export function NightWorkersRouteNotFoundScreen({
  title,
  detail,
  onOpenOverview,
}: {
  title: string;
  detail: string;
  onOpenOverview: () => void;
}) {
  return (
    <main className="flex h-full min-h-0 items-center justify-center bg-[#111827] p-6 text-slate-100">
      <div className="max-w-md rounded-lg border border-slate-800 bg-slate-950/60 p-5 text-center shadow-xl">
        <div className="font-semibold text-base">{title}</div>
        <div className="mt-2 break-all text-slate-400 text-xs">{detail}</div>
        <button
          type="button"
          className="mt-4 h-9 rounded-md border border-slate-700 px-3 text-slate-200 text-xs hover:border-cyan-400/70 hover:text-cyan-100"
          onClick={onOpenOverview}
        >
          Overview を開く
        </button>
      </div>
    </main>
  );
}

export function NightWorkersFolderBrowser(props: {
  open: boolean;
  workspace: NightWorkersWorkspaceState;
  selectedPath: string;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  onClose: () => void;
}) {
  const { onClose, open, selectedPath, setSelectedPath, workspace } = props;
  return (
    <FolderBrowserDialog
      open={open}
      currentPath={workspace.currentBrowserPath}
      parentPath={workspace.browserParentPath}
      directories={workspace.browserDirectories}
      selectedPath={selectedPath}
      isLoading={workspace.isBrowserLoading}
      onClose={onClose}
      onNavigate={(path) => {
        setSelectedPath(path);
        void workspace.fetchDirectories(path);
      }}
      onSelectPath={(path) => {
        setSelectedPath(path);
      }}
      onCreateFolder={async (name) => {
        const parentPath = workspace.currentBrowserPath || undefined;
        const folder = await workspace.createFolder({ parentPath, name });
        await workspace.fetchDirectories(parentPath);
        setSelectedPath(folder.path);
      }}
      onConfirmSelection={() => {
        const selected = selectedPath || workspace.currentBrowserPath;
        if (!selected) return;
        const cleanPath = selected.replace(/[\\/]+$/, '');
        const folderName = cleanPath.split(/[\\/]/).filter(Boolean).at(-1) || 'Project';
        workspace.createProject({
          name: folderName,
          localPath: selected,
        });
        setSelectedPath('');
        onClose();
      }}
    />
  );
}
