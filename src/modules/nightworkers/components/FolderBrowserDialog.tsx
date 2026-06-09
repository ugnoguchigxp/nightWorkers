import { Folder, FolderOpen, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

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
  onCreateFolder: (name: string) => Promise<void>;
  onConfirmSelection: () => void;
};

export function FolderBrowserDialog(props: FolderBrowserDialogProps) {
  const { t } = useTranslation();
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateFolder = async () => {
    const folderName = newFolderName.trim();
    if (!folderName) return;
    setIsCreateSubmitting(true);
    setCreateError(null);
    try {
      await props.onCreateFolder(folderName);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreateSubmitting(false);
    }
  };

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
        {isCreatingFolder ? (
          <div className="border-t border-zinc-800 bg-zinc-950/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreateFolder();
                  if (event.key === 'Escape') {
                    setIsCreatingFolder(false);
                    setCreateError(null);
                  }
                }}
                placeholder={t('folderBrowser.newFolderPlaceholder')}
                className="h-8 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => void handleCreateFolder()}
                disabled={!newFolderName.trim() || isCreateSubmitting}
              >
                {t('folderBrowser.createFolderConfirm')}
              </Button>
            </div>
            {createError ? (
              <div className="mt-2 break-all text-[10px] text-red-300">{createError}</div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/40 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setIsCreatingFolder((current) => !current);
              setCreateError(null);
            }}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            disabled={!props.currentPath}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t('folderBrowser.createFolder')}
          </button>
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
