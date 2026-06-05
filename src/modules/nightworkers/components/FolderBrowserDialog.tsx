import { Button } from '@repo/design-system';
import { Folder, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type FolderBrowserDialogProps = {
  open: boolean;
  currentPath: string | null;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
  selectedPath: string;
  isLoading: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSelectPath: (path: string, name: string) => void;
  onConfirmSelection: () => void;
};

export function FolderBrowserDialog(props: FolderBrowserDialogProps) {
  const { t } = useTranslation();

  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[400px] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/40 px-4 py-3">
          <span className="text-xs font-bold text-zinc-300">{t('folderBrowser.title')}</span>
          <button type="button" onClick={props.onClose} className="text-xs text-zinc-500">
            {t('folderBrowser.close')}
          </button>
        </div>
        <div className="truncate border-b border-zinc-800 bg-zinc-950/20 px-4 py-2 font-mono text-[10px] text-zinc-400">
          {t('folderBrowser.path', { path: props.currentPath })}
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {props.isLoading ? (
            <div className="px-3 py-4 text-xs text-zinc-500">{t('folderBrowser.loading')}</div>
          ) : null}
          {!props.isLoading && props.parentPath ? (
            <button
              type="button"
              onClick={() => props.parentPath && props.onNavigate(props.parentPath)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/40"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t('folderBrowser.goUp')}
            </button>
          ) : null}
          {!props.isLoading &&
            props.directories.map((dir) => (
              <div
                key={dir.path}
                className={`flex items-center justify-between rounded-md px-3 py-1.5 text-xs ${props.selectedPath === dir.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
              >
                <button
                  type="button"
                  onClick={() => props.onSelectPath(dir.path, dir.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="truncate">{dir.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => props.onNavigate(dir.path)}
                  className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-cyan-400"
                >
                  {t('folderBrowser.enter')}
                </button>
              </div>
            ))}
        </div>
        <div className="flex items-center justify-end border-t border-zinc-800 bg-zinc-950/40 px-4 py-3">
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={props.onConfirmSelection}
            disabled={!props.selectedPath && !props.currentPath}
          >
            {t('folderBrowser.selectFolder')}
          </Button>
        </div>
      </div>
    </div>
  );
}
