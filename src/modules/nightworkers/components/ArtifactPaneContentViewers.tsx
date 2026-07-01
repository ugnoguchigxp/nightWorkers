import { useTranslation } from 'react-i18next';
import {
  BlueprintArtifactViewer,
  ComponentDesignArtifactViewer,
  mockBlueprintToPreviewBlueprintSafely,
} from '../../blueprint-preview';
import type { ProjectFileEntry } from '../types';
import { DiffViewer, MarkdownViewer, ProjectTree } from './ArtifactFileViewers';

export function FilesOutline({
  isFilesLoading,
  fileEntries,
  fileEntriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFilePath,
  onToggleDirectory,
  onOpenFile,
}: {
  isFilesLoading: boolean;
  fileEntries: ProjectFileEntry[];
  fileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {isFilesLoading ? (
        <div className="px-2 py-1 text-[11px] text-slate-500">{t('artifact.loading')}</div>
      ) : (
        <ProjectTree
          entries={fileEntries}
          entriesByDirectory={fileEntriesByDirectory}
          expandedDirectories={expandedDirectories}
          loadingDirectories={loadingDirectories}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onOpenFile={onOpenFile}
        />
      )}
    </>
  );
}

export function ProjectDiffContent({ diff, isLoading }: { diff: string; isLoading: boolean }) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        {t('artifact.loadingDiff')}
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto p-3">
      <DiffViewer diff={diff} />
    </div>
  );
}

export function BlueprintViewer({
  sessionId,
  messageId,
  blueprint,
  mockBlueprint,
  validation,
  generation,
  markdown,
}: {
  sessionId: string | null;
  messageId: string | null;
  blueprint: unknown;
  mockBlueprint?: unknown;
  validation: unknown;
  generation?: unknown;
  markdown?: string;
}) {
  const { t } = useTranslation();
  const previewBlueprint = isObject(mockBlueprint)
    ? mockBlueprintToPreviewBlueprintSafely(mockBlueprint)
    : blueprint;

  if (!isObject(previewBlueprint)) {
    return <MarkdownViewer content={markdown || t('artifact.noBlueprintContent')} />;
  }
  return (
    <BlueprintArtifactViewer
      sessionId={sessionId}
      messageId={messageId}
      blueprint={previewBlueprint}
      validation={validation}
      generation={generation}
    />
  );
}

export function ComponentDesignViewer({
  artifact,
  markdown,
}: {
  artifact: unknown;
  markdown?: string;
}) {
  const { t } = useTranslation();

  if (!isObject(artifact))
    return <MarkdownViewer content={markdown || t('artifact.noComponentDesign')} />;
  return <ComponentDesignArtifactViewer artifact={artifact} />;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
