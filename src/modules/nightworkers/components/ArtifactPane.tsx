import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderTree,
  GitCompare,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toDeepRecord } from '../../../../shared/json-record';
import { PlanModeWorkspaceViewer } from '../../planMode';
import type { PlanWorkspaceTab } from '../../specification';
import type {
  ActivityArtifact,
  ProjectDiff,
  ProjectFileContent,
  ProjectFileEntry,
  Repository,
  TaskMessage,
  TaskRun,
  WorkbenchArtifactRef,
} from '../types';
import { DiffViewer, FileViewer, MarkdownViewer } from './ArtifactFileViewers';
import {
  BlueprintViewer,
  ComponentDesignViewer,
  FilesOutline,
  ProjectDiffContent,
} from './ArtifactPaneContentViewers';
import {
  artifactFileName,
  buildArtifactVersions,
  buildExportedArtifactContent,
  copyText,
  saveTextFile,
} from './ArtifactPaneVersions';

type ArtifactPaneProps = {
  activeProject: Repository | null;
  activeSessionId: string | null;
  latestRun?: TaskRun;
  focusType: 'project_tree' | 'artifact';
  selectedArtifact: WorkbenchArtifactRef | null;
  taskMessages: TaskMessage[];
  activityArtifacts: ActivityArtifact[];
  fileEntries: ProjectFileEntry[];
  fileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFile: ProjectFileContent | null;
  selectedFilePath: string | null;
  isFilesLoading: boolean;
  isFileLoading: boolean;
  projectDiff: ProjectDiff | null;
  isDiffLoading: boolean;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  onRefreshFiles: () => Promise<void>;
  onRefreshDiff: () => Promise<void>;
  onQueueSession?: () => Promise<void>;
  onAddToQueue?: () => Promise<void>;
  isImplementationLocked?: boolean;
};

type ProjectArtifactMode = 'tree' | 'diff';

function workspaceInitialTab(value: unknown): PlanWorkspaceTab | undefined {
  if (value === 'design-doc' || value === 'specification') return 'feature-plan';
  if (value === 'specification-status') return 'status';
  if (value === 'blueprints') return 'blueprint';
  if (value === 'db-design') return 'data-model';
  return value === 'feature-plan' ||
    value === 'blueprint' ||
    value === 'data-model' ||
    value === 'user-flow' ||
    value === 'api-io-contract' ||
    value === 'state-model' ||
    value === 'activity-flow' ||
    value === 'sequence-flow' ||
    value === 'zod-schema-design' ||
    value === 'questionnaire' ||
    value === 'status'
    ? value
    : undefined;
}

function parseArtifactContentJson(content: string | null | undefined): unknown {
  if (!content?.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMockBlueprintCandidate(value: unknown) {
  return asRecord(value).artifactKind === 'mock_blueprint';
}

export function ArtifactPane({
  activeProject,
  activeSessionId,
  latestRun,
  focusType,
  selectedArtifact,
  taskMessages,
  activityArtifacts,
  fileEntries,
  fileEntriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFile,
  selectedFilePath,
  isFilesLoading,
  isFileLoading,
  projectDiff,
  isDiffLoading,
  onToggleDirectory,
  onOpenFile,
  onRefreshFiles,
  onRefreshDiff,
  onQueueSession,
  onAddToQueue,
  isImplementationLocked = false,
}: ArtifactPaneProps) {
  const { t } = useTranslation();
  const [versionArtifactId, setVersionArtifactId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [projectArtifactMode, setProjectArtifactMode] = useState<ProjectArtifactMode>('tree');
  const showProjectTree = focusType === 'project_tree';
  const showProjectDiff = showProjectTree && projectArtifactMode === 'diff';
  const artifactVersions = useMemo(
    () => buildArtifactVersions(selectedArtifact, taskMessages, activityArtifacts),
    [activityArtifacts, selectedArtifact, taskMessages]
  );
  useEffect(() => {
    setVersionArtifactId(selectedArtifact?.id || null);
    setIsFullscreen(false);
  }, [selectedArtifact?.id]);
  useEffect(() => {
    if (!showProjectTree) return;
    const refreshCurrentProjectArtifact = () => {
      if (document.visibilityState === 'hidden') return;
      if (projectArtifactMode === 'diff') {
        void onRefreshDiff();
        return;
      }
      void onRefreshFiles();
    };
    refreshCurrentProjectArtifact();
    window.addEventListener('focus', refreshCurrentProjectArtifact);
    document.addEventListener('visibilitychange', refreshCurrentProjectArtifact);
    return () => {
      window.removeEventListener('focus', refreshCurrentProjectArtifact);
      document.removeEventListener('visibilitychange', refreshCurrentProjectArtifact);
    };
  }, [onRefreshDiff, onRefreshFiles, projectArtifactMode, showProjectTree]);
  const currentVersionIndex = Math.max(
    0,
    artifactVersions.findIndex(
      (artifact) => artifact.id === (versionArtifactId || selectedArtifact?.id)
    )
  );
  const displayArtifact = artifactVersions[currentVersionIndex] || selectedArtifact;
  const showDiff = displayArtifact?.kind === 'diff';
  const showBlueprintWorkspace = displayArtifact?.kind === 'plan_mode_workspace';
  const showBlueprint = displayArtifact?.kind === 'app_blueprint';
  const showComponentDesign =
    displayArtifact?.kind === 'component_design' || displayArtifact?.kind === 'design_delta';
  const taskMessageId =
    displayArtifact?.source.type === 'task_message' ? displayArtifact.source.messageId : null;
  const selectedMessage = taskMessageId
    ? taskMessages.find((message) => message.id === taskMessageId) || null
    : null;
  const artifactRowId =
    displayArtifact?.source.type === 'artifact_row' ? displayArtifact.source.artifactId : null;
  const selectedActivityArtifact = artifactRowId
    ? activityArtifacts.find((artifact) => artifact.id === artifactRowId) || null
    : null;
  const selectedActivityArtifactContent = parseArtifactContentJson(
    selectedActivityArtifact?.contentText
  );
  const activityArtifactMetadata = {
    ...asRecord(selectedActivityArtifactContent),
    ...toDeepRecord(selectedActivityArtifact?.metadataJson),
    ...asRecord(selectedArtifact?.metadata),
    ...asRecord(displayArtifact?.metadata),
  };
  const artifactBlueprint =
    activityArtifactMetadata.appBlueprint ||
    (!isMockBlueprintCandidate(selectedActivityArtifactContent)
      ? selectedActivityArtifactContent
      : null);
  const artifactMockBlueprint =
    activityArtifactMetadata.mockBlueprint ||
    (String(activityArtifactMetadata.schemaName || '') === 'mock_blueprint' ||
    isMockBlueprintCandidate(selectedActivityArtifactContent)
      ? selectedActivityArtifactContent
      : null);
  const artifactValidation = activityArtifactMetadata.validation;
  const artifactGeneration =
    activityArtifactMetadata.generation || displayArtifact?.metadata?.generation || null;
  const showDocument =
    Boolean(selectedArtifact) &&
    !showDiff &&
    !showBlueprintWorkspace &&
    !showBlueprint &&
    !showComponentDesign &&
    Boolean(selectedMessage);
  const artifactTitle =
    showProjectTree || !selectedArtifact
      ? showProjectDiff
        ? t('artifact.gitDiff')
        : selectedFilePath || t('artifact.projectTree')
      : displayArtifact?.title || selectedArtifact.title;
  const exportedContent = buildExportedArtifactContent({
    showDiff,
    latestRun,
    selectedMessage,
    selectedActivityArtifact,
    selectedFile,
    selectedArtifact: displayArtifact,
  });
  const artifactFrameClass = isFullscreen
    ? 'fixed inset-3 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#1e1e2e] shadow-2xl'
    : 'nightworkers-artifact-pane flex min-h-0 min-w-0 flex-col overflow-hidden';
  return (
    <aside className={artifactFrameClass}>
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[#313244] bg-[#1e1e2e] px-3 pr-12">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate text-[#a6adc8]">
            {activeProject?.name || t('artifact.project')}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6c7086]" />
          <span className="truncate font-medium text-[#cdd6f4]">{artifactTitle}</span>
        </div>
        {showProjectTree ? (
          <ProjectTreeHeaderActions
            mode={projectArtifactMode}
            isFullscreen={isFullscreen}
            onModeChange={setProjectArtifactMode}
            onToggleFullscreen={() => setIsFullscreen((value) => !value)}
          />
        ) : displayArtifact ? (
          <ArtifactHeaderActions
            currentVersionIndex={currentVersionIndex}
            versionCount={artifactVersions.length || 1}
            isFullscreen={isFullscreen}
            onPrevious={() =>
              setVersionArtifactId(artifactVersions[currentVersionIndex - 1]?.id || null)
            }
            onNext={() =>
              setVersionArtifactId(artifactVersions[currentVersionIndex + 1]?.id || null)
            }
            onCopy={() => void copyText(exportedContent)}
            onSave={() => saveTextFile(exportedContent, artifactFileName(displayArtifact))}
            onToggleFullscreen={() => setIsFullscreen((value) => !value)}
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        {showProjectTree && !showProjectDiff ? (
          <div className="min-h-0 w-56 shrink-0 overflow-auto border-r border-slate-800 p-2">
            <FilesOutline
              isFilesLoading={isFilesLoading}
              fileEntries={fileEntries}
              fileEntriesByDirectory={fileEntriesByDirectory}
              expandedDirectories={expandedDirectories}
              loadingDirectories={loadingDirectories}
              selectedFilePath={selectedFilePath}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 overflow-hidden bg-[#1e1e2e]">
          {showProjectDiff ? (
            <ProjectDiffContent
              diff={projectDiff?.diff || ''}
              isLoading={isDiffLoading || Boolean(activeProject && !projectDiff)}
            />
          ) : showDiff ? (
            <DiffViewer diff={latestRun?.diffPatch || ''} />
          ) : showBlueprintWorkspace ? (
            <PlanModeWorkspaceViewer
              sessionId={activeSessionId}
              taskMessages={taskMessages}
              activityArtifacts={activityArtifacts}
              initialTab={workspaceInitialTab(displayArtifact?.metadata?.initialTab)}
              onQueueSession={onQueueSession}
              onAddToQueue={onAddToQueue}
              isImplementationLocked={isImplementationLocked}
            />
          ) : showBlueprint ? (
            <BlueprintViewer
              sessionId={activeSessionId}
              messageId={taskMessageId}
              blueprint={artifactBlueprint || displayArtifact?.metadata?.appBlueprint}
              mockBlueprint={artifactMockBlueprint || displayArtifact?.metadata?.mockBlueprint}
              validation={artifactValidation || displayArtifact?.metadata?.validation}
              generation={artifactGeneration}
              markdown={
                selectedMessage?.content || selectedActivityArtifact?.contentText || undefined
              }
            />
          ) : showComponentDesign ? (
            <ComponentDesignViewer
              artifact={
                displayArtifact?.metadata?.componentDesign || displayArtifact?.metadata?.designDelta
              }
              markdown={selectedMessage?.content}
            />
          ) : showDocument ? (
            <MarkdownViewer content={selectedMessage?.content || ''} />
          ) : showProjectTree && selectedFile ? (
            <FileViewer file={selectedFile} />
          ) : showProjectTree && isFileLoading ? (
            <p className="text-xs text-slate-400">{t('artifact.loadingFile')}</p>
          ) : showProjectTree ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              {t('artifact.selectFileOrDiff')}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              Artifact target is not available.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function ArtifactHeaderActions({
  currentVersionIndex,
  versionCount,
  isFullscreen,
  onPrevious,
  onNext,
  onCopy,
  onSave,
  onToggleFullscreen,
}: {
  currentVersionIndex: number;
  versionCount: number;
  isFullscreen: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCopy: () => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={currentVersionIndex <= 0}
        onClick={onPrevious}
        aria-label={t('artifact.previousVersion')}
        title={t('artifact.previousVersion')}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[4.5rem] text-center text-[11px] text-slate-400">
        {t('artifact.versionLabel', {
          current: currentVersionIndex + 1,
          total: Math.max(versionCount, 1),
        })}
      </span>
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={currentVersionIndex >= versionCount - 1}
        onClick={onNext}
        aria-label={t('artifact.nextVersion')}
        title={t('artifact.nextVersion')}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        onClick={onCopy}
        aria-label={t('artifact.copyVersion')}
        title={t('artifact.copyVersion')}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        onClick={onSave}
        aria-label={t('artifact.saveVersion')}
        title={t('artifact.saveVersion')}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        onClick={onToggleFullscreen}
        aria-label={isFullscreen ? t('artifact.exitFullscreen') : t('artifact.fullscreen')}
        title={isFullscreen ? t('artifact.exitFullscreen') : t('artifact.fullscreen')}
      >
        {isFullscreen ? (
          <Minimize2 className="h-3.5 w-3.5" />
        ) : (
          <Maximize2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function ProjectTreeHeaderActions({
  mode,
  isFullscreen,
  onModeChange,
  onToggleFullscreen,
}: {
  mode: ProjectArtifactMode;
  isFullscreen: boolean;
  onModeChange: (mode: ProjectArtifactMode) => void;
  onToggleFullscreen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={`inline-flex h-7 w-7 items-center justify-center rounded border text-slate-300 ${
          mode === 'tree'
            ? 'border-sky-500/80 bg-sky-500/15 text-sky-100'
            : 'border-slate-700 hover:border-slate-500'
        }`}
        onClick={() => onModeChange('tree')}
        aria-label={t('artifact.showProjectTree')}
        title={t('artifact.showProjectTree')}
      >
        <FolderTree className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={`inline-flex h-7 w-7 items-center justify-center rounded border text-slate-300 ${
          mode === 'diff'
            ? 'border-sky-500/80 bg-sky-500/15 text-sky-100'
            : 'border-slate-700 hover:border-slate-500'
        }`}
        onClick={() => onModeChange('diff')}
        aria-label={t('artifact.showGitDiff')}
        title={t('artifact.showGitDiff')}
      >
        <GitCompare className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        onClick={onToggleFullscreen}
        aria-label={isFullscreen ? t('artifact.exitFullscreen') : t('artifact.fullscreen')}
        title={isFullscreen ? t('artifact.exitFullscreen') : t('artifact.fullscreen')}
      >
        {isFullscreen ? (
          <Minimize2 className="h-3.5 w-3.5" />
        ) : (
          <Maximize2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
