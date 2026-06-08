import { ChevronRight, GitCompare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ProjectFileContent,
  ProjectFileEntry,
  Repository,
  TaskMessage,
  TaskRun,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
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
  fileEntries: ProjectFileEntry[];
  fileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFile: ProjectFileContent | null;
  selectedFilePath: string | null;
  isFilesLoading: boolean;
  isFileLoading: boolean;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  onShowDiff: () => void;
  onSubmitWorkbenchMessage?: (prompt: string, intent: WorkbenchChatIntent) => Promise<void>;
  isWorkbenchMessageSubmitting?: boolean;
};

function workspaceInitialTab(value: unknown) {
  if (value === 'design-doc') return 'specification';
  return value === 'blueprints' ||
    value === 'db-design' ||
    value === 'questionnaire' ||
    value === 'specification-status' ||
    value === 'specification'
    ? value
    : undefined;
}

export function ArtifactPane({
  activeProject,
  activeSessionId,
  latestRun,
  focusType,
  selectedArtifact,
  taskMessages,
  fileEntries,
  fileEntriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFile,
  selectedFilePath,
  isFilesLoading,
  isFileLoading,
  onToggleDirectory,
  onOpenFile,
  onShowDiff,
  onSubmitWorkbenchMessage,
  isWorkbenchMessageSubmitting = false,
}: ArtifactPaneProps) {
  const { t } = useTranslation();
  const showProjectTree = focusType === 'project_tree';
  const showDiff = selectedArtifact?.kind === 'diff';
  const showBlueprintWorkspace = selectedArtifact?.kind === 'blueprint_workspace';
  const showBlueprint = selectedArtifact?.kind === 'app_blueprint';
  const showComponentDesign =
    selectedArtifact?.kind === 'component_design' || selectedArtifact?.kind === 'design_delta';
  const taskMessageId =
    selectedArtifact?.source.type === 'task_message' ? selectedArtifact.source.messageId : null;
  const selectedMessage = taskMessageId
    ? taskMessages.find((message) => message.id === taskMessageId)
    : null;
  const showDocument =
    Boolean(selectedArtifact) &&
    !showDiff &&
    !showBlueprintWorkspace &&
    !showBlueprint &&
    !showComponentDesign &&
    Boolean(selectedMessage);
  const artifactTitle =
    showProjectTree || !selectedArtifact
      ? selectedFilePath || t('artifact.projectTree')
      : selectedArtifact.title;
  return (
    <aside className="nightworkers-artifact-pane flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center border-b border-[#313244] bg-[#1e1e2e] px-3 pr-12">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate text-[#a6adc8]">
            {activeProject?.name || t('artifact.project')}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6c7086]" />
          <span className="truncate font-medium text-[#cdd6f4]">{artifactTitle}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {showProjectTree ? (
          <div className="min-h-0 w-56 shrink-0 overflow-auto border-r border-slate-800 p-2">
            <FilesOutline
              latestRun={latestRun}
              isFilesLoading={isFilesLoading}
              fileEntries={fileEntries}
              fileEntriesByDirectory={fileEntriesByDirectory}
              expandedDirectories={expandedDirectories}
              loadingDirectories={loadingDirectories}
              selectedFilePath={selectedFilePath}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
              onShowDiff={onShowDiff}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 overflow-hidden bg-[#1e1e2e]">
          {showDiff ? (
            <DiffViewer diff={latestRun?.diffPatch || ''} />
          ) : showBlueprintWorkspace ? (
            <BlueprintSpecificationWorkspaceViewer
              sessionId={activeSessionId}
              taskMessages={taskMessages}
              initialTab={workspaceInitialTab(selectedArtifact?.metadata?.initialTab)}
            />
          ) : showBlueprint ? (
            <BlueprintViewer
              sessionId={activeSessionId}
              messageId={taskMessageId}
              blueprint={selectedArtifact?.metadata?.appBlueprint}
              validation={selectedArtifact?.metadata?.validation}
              markdown={selectedMessage?.content}
            />
          ) : showComponentDesign ? (
            <ComponentDesignViewer
              artifact={
                selectedArtifact?.metadata?.componentDesign ||
                selectedArtifact?.metadata?.designDelta
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

function FilesOutline({
  latestRun,
  isFilesLoading,
  fileEntries,
  fileEntriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFilePath,
  onToggleDirectory,
  onOpenFile,
  onShowDiff,
}: {
  latestRun?: TaskRun;
  isFilesLoading: boolean;
  fileEntries: ProjectFileEntry[];
  fileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  onShowDiff: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {latestRun?.diffPatch?.trim() ? (
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-2 rounded border border-slate-700/70 px-2 py-1 text-left text-[11px] text-slate-200 hover:border-slate-500"
          onClick={onShowDiff}
        >
          <GitCompare className="h-3.5 w-3.5" />
          {t('artifact.diff')}
        </button>
      ) : null}
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
  const tables =
    isObject(blueprint.databaseSchema) && Array.isArray(blueprint.databaseSchema.tables)
      ? toObjectArray(blueprint.databaseSchema.tables)
      : [];
  const bindings = toObjectArray(blueprint.dataBindings);
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
            tables={tables}
            bindings={bindings}
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
