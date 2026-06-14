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
import { DiffViewer, FileViewer, MarkdownViewer, ProjectTree } from './ArtifactFileViewers';
import { BlueprintSpecificationWorkspaceViewer } from './ArtifactWorkspaceViewer';
import { BlueprintPreview } from './blueprint-preview';

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

function workspaceInitialTab(value: unknown) {
  if (value === 'design-doc') return 'specification';
  if (value === 'specification-status') return 'status';
  return value === 'blueprints' ||
    value === 'db-design' ||
    value === 'questionnaire' ||
    value === 'status' ||
    value === 'specification'
    ? value
    : undefined;
}

function parseArtifactContentJson(content: string | null | undefined): any {
  if (!content?.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
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
  const showBlueprintWorkspace = displayArtifact?.kind === 'blueprint_workspace';
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
  const artifactBlueprint =
    selectedActivityArtifact?.metadataJson?.appBlueprint ||
    parseArtifactContentJson(selectedActivityArtifact?.contentText);
  const artifactValidation = selectedActivityArtifact?.metadataJson?.validation;
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
            <BlueprintSpecificationWorkspaceViewer
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
              validation={artifactValidation || displayArtifact?.metadata?.validation}
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

function buildArtifactVersions(
  selectedArtifact: WorkbenchArtifactRef | null,
  taskMessages: TaskMessage[],
  activityArtifacts: ActivityArtifact[]
): WorkbenchArtifactRef[] {
  if (!selectedArtifact) return [];
  if (selectedArtifact.kind === 'diff') return [selectedArtifact];
  const messageRefs = taskMessages
    .map((message) => taskMessageToArtifactRef(message, selectedArtifact.kind))
    .filter((artifact): artifact is WorkbenchArtifactRef => Boolean(artifact));
  const activityRefs = activityArtifacts
    .map((artifact) => activityArtifactToArtifactRef(artifact, selectedArtifact.kind))
    .filter((artifact): artifact is WorkbenchArtifactRef => Boolean(artifact));
  const byId = new Map<string, WorkbenchArtifactRef>();
  for (const artifact of [...messageRefs, ...activityRefs, selectedArtifact]) {
    byId.set(artifact.id, artifact);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function taskMessageToArtifactRef(
  message: TaskMessage,
  selectedKind: WorkbenchArtifactRef['kind']
): WorkbenchArtifactRef | null {
  const metadata = message.metadataJson || {};
  const kind = resolveMessageArtifactKind(message);
  if (kind !== selectedKind) return null;
  const title =
    metadata.title ||
    metadata.display?.title ||
    metadata.appBlueprint?.name ||
    metadata.componentDesign?.componentName ||
    'Artifact';
  return {
    id: `message-${message.id}`,
    taskId: message.taskId,
    runId: message.runId || undefined,
    kind,
    title: String(title),
    summary: String(metadata.display?.summary || message.content.slice(0, 160)),
    source:
      typeof metadata.artifactRef?.artifactId === 'string'
        ? { type: 'artifact_row', artifactId: metadata.artifactRef.artifactId }
        : { type: 'task_message', messageId: message.id },
    createdAt: String(message.createdAt),
    metadata,
  };
}

function activityArtifactToArtifactRef(
  artifact: ActivityArtifact,
  selectedKind: WorkbenchArtifactRef['kind']
): WorkbenchArtifactRef | null {
  const kind = artifact.kind as WorkbenchArtifactRef['kind'];
  if (kind !== selectedKind) return null;
  const metadata = artifact.metadataJson || {};
  return {
    id: `artifact-${artifact.id}`,
    taskId: artifact.taskId,
    runId: artifact.runId || undefined,
    kind,
    title: String(metadata.title || metadata.appBlueprint?.name || artifact.path || artifact.kind),
    summary: String(metadata.summary || artifact.contentText?.slice(0, 160) || ''),
    source: { type: 'artifact_row', artifactId: artifact.id },
    createdAt: String(artifact.createdAt),
    metadata,
  };
}

function resolveMessageArtifactKind(message: TaskMessage): WorkbenchArtifactRef['kind'] | null {
  const metadata = message.metadataJson || {};
  if (metadata.componentDesign) return 'component_design';
  if (metadata.designDelta) return 'design_delta';
  if (metadata.markdownDocumentData || metadata.intent === 'draft_spec') return 'spec';
  if (metadata.appBlueprint || metadata.artifactRef) return 'app_blueprint';
  if (message.messageType === 'markdown_document') return 'spec';
  return null;
}

function buildExportedArtifactContent(input: {
  showDiff: boolean;
  latestRun?: TaskRun;
  selectedMessage: TaskMessage | null;
  selectedActivityArtifact: ActivityArtifact | null;
  selectedFile: ProjectFileContent | null;
  selectedArtifact: WorkbenchArtifactRef | null;
}) {
  if (input.showDiff) return input.latestRun?.diffPatch || '';
  if (input.selectedActivityArtifact?.contentText)
    return input.selectedActivityArtifact.contentText;
  if (input.selectedMessage?.content) return input.selectedMessage.content;
  if (input.selectedFile?.content) return input.selectedFile.content;
  return input.selectedArtifact
    ? JSON.stringify(input.selectedArtifact.metadata || {}, null, 2)
    : '';
}

async function copyText(content: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function saveTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function artifactFileName(artifact: WorkbenchArtifactRef) {
  const slug = artifact.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'artifact'}.md`;
}

function FilesOutline({
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

function ProjectDiffContent({ diff, isLoading }: { diff: string; isLoading: boolean }) {
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

function BlueprintViewer({
  sessionId,
  messageId,
  blueprint,
  validation,
  markdown,
}: {
  sessionId: string | null;
  messageId: string | null;
  blueprint: unknown;
  validation: unknown;
  markdown?: string;
}) {
  const { t } = useTranslation();

  if (!isObject(blueprint)) {
    return <MarkdownViewer content={markdown || t('artifact.noBlueprintContent')} />;
  }
  const screens = toObjectArray(blueprint.screens);
  const issues = isObject(validation) ? toObjectArray(validation.issues) : [];
  return (
    <div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
      <div className="grid gap-4">
        <BlueprintSection title={t('artifact.designPreview')}>
          <BlueprintPreview
            key={String(blueprint.id || blueprint.name || screens[0]?.id || 'draft-blueprint')}
            sessionId={sessionId}
            messageId={messageId}
            blueprint={blueprint}
            screens={screens}
            validationIssues={issues}
          />
        </BlueprintSection>
        <PromptDetail>
          <BlueprintSection title={t('artifact.screenComposition')}>
            {screens.map((screen, index) => (
              <div
                key={String(screen?.id || index)}
                className="rounded border border-slate-700/80 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-100">
                    {String(screen?.name || screen?.id)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {String(screen?.componentName || '')}
                  </span>
                </div>
                <div className="mt-2 grid gap-1">
                  {toObjectArray(screen.sections).map((section, sectionIndex) => (
                    <div
                      key={String(section?.id || sectionIndex)}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="min-w-0 truncate text-slate-300">
                        {String(section?.name || section?.id)}
                      </span>
                      <span className="shrink-0 text-slate-500">
                        {String(section?.componentName || '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </BlueprintSection>
          <BlueprintSection title={t('artifact.validationIssues')}>
            {issues.length > 0 ? (
              issues.map((issue, index) => (
                <div
                  key={`${String(issue?.path)}-${index}`}
                  className="rounded border border-amber-700/70 bg-amber-950/20 p-2 text-xs"
                >
                  <div className="font-mono text-amber-100">{String(issue?.path || '$')}</div>
                  <div className="mt-1 text-amber-50">
                    {String(issue?.message || issue?.code || '')}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded border border-emerald-700/60 bg-emerald-950/20 p-2 text-xs text-emerald-100">
                {t('artifact.noValidationIssues')}
              </div>
            )}
          </BlueprintSection>
        </PromptDetail>
      </div>
    </div>
  );
}

function ComponentDesignViewer({ artifact, markdown }: { artifact: unknown; markdown?: string }) {
  const { t } = useTranslation();

  if (!isObject(artifact))
    return <MarkdownViewer content={markdown || t('artifact.noComponentDesign')} />;
  const variants = toObjectArray(artifact.variants);
  const tokenChanges = toObjectArray(artifact.tokenChanges);
  const discussionPrompts = Array.isArray(artifact.discussionPrompts)
    ? artifact.discussionPrompts.map(String)
    : [];
  return (
    <div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
      <div className="mb-5 border-slate-700 border-b pb-4">
        <div className="text-xs font-semibold uppercase text-cyan-200">
          {t('artifact.componentDesign')}
        </div>
        <h1 className="mt-1 text-xl font-semibold text-slate-50">
          {String(artifact.componentName || t('artifact.componentFallback'))}
        </h1>
        <div className="mt-1 text-xs text-slate-400">{String(artifact.scope || '')}</div>
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-300">
          {String(artifact.summary || t('artifact.noSummary'))}
        </p>
      </div>
      <div className="grid gap-4">
        <BlueprintSection title={t('artifact.variantPreview')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {variants.map((variant, index) => (
              <div
                key={String(variant.name || index)}
                className="rounded border border-slate-700/80 bg-slate-950/20 p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-100">
                    {String(variant.name || 'variant')}
                  </span>
                  <span className="text-[10px] uppercase text-slate-500">
                    {t('artifact.button')}
                  </span>
                </div>
                <button
                  type="button"
                  className={componentButtonClass(String(variant.name || 'primary'))}
                >
                  {buttonLabelForVariant(String(variant.name || 'primary'), t)}
                </button>
                <p className="mt-3 text-[11px] leading-4 text-slate-400">
                  {String(variant.purpose || '')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(Array.isArray(variant.states) ? variant.states : []).map((state) => (
                    <span
                      key={String(state)}
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300"
                    >
                      {String(state)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </BlueprintSection>
        <BlueprintSection title={t('artifact.tokenChanges')}>
          {tokenChanges.map((change, index) => (
            <div
              key={String(change.token || index)}
              className="rounded border border-slate-700/80 p-3 text-xs"
            >
              <div className="font-medium text-slate-100">{String(change.token || '')}</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <TokenValue label={t('artifact.before')} value={String(change.before || '')} />
                <TokenValue label={t('artifact.proposed')} value={String(change.proposed || '')} />
              </div>
              <p className="mt-2 leading-5 text-slate-400">{String(change.rationale || '')}</p>
            </div>
          ))}
        </BlueprintSection>
        <BlueprintSection title={t('artifact.discussion')}>
          {discussionPrompts.map((prompt, index) => (
            <div
              key={`${prompt}-${index}`}
              className="rounded border border-slate-700/80 p-2 text-xs text-slate-300"
            >
              {prompt}
            </div>
          ))}
        </BlueprintSection>
      </div>
    </div>
  );
}

function TokenValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/25 p-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-slate-200">{value}</div>
    </div>
  );
}

function componentButtonClass(variant: string): string {
  const base =
    'inline-flex h-9 min-w-24 items-center justify-center rounded border px-3 text-xs font-medium';
  if (variant === 'danger') return `${base} border-rose-500/70 bg-rose-600 text-white`;
  if (variant === 'secondary') return `${base} border-slate-600 bg-slate-800 text-slate-100`;
  if (variant === 'icon-only')
    return `${base} w-9 min-w-9 border-slate-600 bg-slate-900 text-cyan-100`;
  return `${base} border-cyan-400/70 bg-cyan-500 text-slate-950`;
}

function buttonLabelForVariant(variant: string, t: (key: string) => string): string {
  if (variant === 'danger') return t('artifact.action.delete');
  if (variant === 'secondary') return t('artifact.action.cancel');
  if (variant === 'icon-only') return '+';
  return t('artifact.action.save');
}

function BlueprintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase text-slate-400">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function PromptDetail({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <details className="rounded border border-slate-800 bg-slate-950/20">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase text-slate-400 hover:text-slate-200">
        {t('artifact.promptDetail')}
      </summary>
      <div className="grid gap-4 border-slate-800 border-t p-3">{children}</div>
    </details>
  );
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toObjectArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}
