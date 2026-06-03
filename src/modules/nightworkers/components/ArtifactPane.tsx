import { CodeBlock } from '@repo/design-system';
import { ChevronRight, File, Folder, GitCompare } from 'lucide-react';
import { memo } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ProjectFileContent,
  ProjectFileEntry,
  Repository,
  TaskMessage,
  TaskRun,
  WorkbenchArtifactRef,
} from '../types';
import { getChangedFiles } from '../utils/diff';

type ArtifactPaneProps = {
  activeProject: Repository | null;
  latestRun?: TaskRun;
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
};

const artifactCodeBlockThemes = {
  light: 'github-dark-default',
  dark: 'github-dark-default',
} as const;
const markdownRemarkPlugins = [remarkGfm];
const markdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a className="text-[#89b4fa] underline underline-offset-2" {...props}>
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-[#45475a] border-l-2 pl-4 text-[#bac2de]">{children}</blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[#181825] px-1 py-0.5 font-mono text-[#f5c2e7] text-[0.92em]">
      {children}
    </code>
  ),
  h1: ({ children }) => (
    <h1 className="mt-0 mb-4 border-[#313244] border-b pb-2 text-2xl font-semibold text-[#f5e0dc]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 border-[#313244] border-b pb-1 text-xl font-semibold text-[#f5e0dc]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-lg font-semibold text-[#f5e0dc]">{children}</h3>
  ),
  li: ({ children }) => <li className="my-1 pl-1">{children}</li>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
  p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-hidden whitespace-pre-wrap break-words rounded bg-[#181825] p-3 font-mono text-sm text-[#cdd6f4]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-hidden">
      <table className="w-full table-fixed border-collapse text-sm">{children}</table>
    </div>
  ),
  td: ({ children }) => (
    <td className="break-words border border-[#313244] px-2 py-1 align-top">{children}</td>
  ),
  th: ({ children }) => (
    <th className="break-words border border-[#313244] bg-[#181825] px-2 py-1 text-left font-medium">
      {children}
    </th>
  ),
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
};

export function ArtifactPane({
  activeProject,
  latestRun,
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
}: ArtifactPaneProps) {
  const showDiff = selectedArtifact?.kind === 'diff';
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
    !showBlueprint &&
    !showComponentDesign &&
    Boolean(selectedMessage);
  const artifactTitle = selectedArtifact?.title || selectedFilePath || 'Project tree';
  return (
    <aside className="flex min-h-screen min-w-0 flex-col border-l border-[#313244] bg-[#1e1e2e]">
      <div className="flex h-10 shrink-0 items-center border-b border-[#313244] bg-[#1e1e2e] px-3 pr-12">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate text-[#a6adc8]">{activeProject?.name || 'Project'}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6c7086]" />
          <span className="truncate font-medium text-[#cdd6f4]">{artifactTitle}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {!selectedArtifact ? (
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
          ) : showBlueprint ? (
            <BlueprintViewer
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
          ) : selectedFile ? (
            <FileViewer file={selectedFile} />
          ) : isFileLoading ? (
            <p className="text-xs text-slate-400">Loading file...</p>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              Select a file or open the diff.
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
  return (
    <>
      {latestRun?.diffPatch?.trim() ? (
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-2 rounded border border-slate-700/70 px-2 py-1 text-left text-[11px] text-slate-200 hover:border-slate-500"
          onClick={onShowDiff}
        >
          <GitCompare className="h-3.5 w-3.5" />
          Diff
        </button>
      ) : null}
      {isFilesLoading ? (
        <div className="px-2 py-1 text-[11px] text-slate-500">Loading...</div>
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
  blueprint,
  validation,
  markdown,
}: {
  blueprint: unknown;
  validation: unknown;
  markdown?: string;
}) {
  if (!isObject(blueprint)) {
    return <MarkdownViewer content={markdown || 'No Blueprint content'} />;
  }
  const screens = toObjectArray(blueprint.screens);
  const tables =
    isObject(blueprint.databaseSchema) && Array.isArray(blueprint.databaseSchema.tables)
      ? toObjectArray(blueprint.databaseSchema.tables)
      : [];
  const bindings = toObjectArray(blueprint.dataBindings);
  const issues = isObject(validation) ? toObjectArray(validation.issues) : [];
  const valid = isObject(validation) && validation.valid === true;
  const designPreset = isObject(blueprint.designPreset) ? blueprint.designPreset : null;
  return (
    <div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
      <div className="mb-5 flex items-start justify-between gap-4 border-slate-700 border-b pb-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-slate-50">
            {String(blueprint.name || 'App Blueprint')}
          </h1>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">
            {String(blueprint.description || '')}
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-1 text-[11px] ${
            valid
              ? 'border-emerald-500/60 bg-emerald-950/25 text-emerald-100'
              : 'border-amber-500/60 bg-amber-950/25 text-amber-100'
          }`}
        >
          {valid ? 'valid' : `${issues.length} issues`}
        </span>
      </div>
      <div className="grid gap-4">
        <BlueprintSection title="Screen Preview">
          <BlueprintScreenPreview
            screens={screens}
            tables={tables}
            bindings={bindings}
            designPreset={designPreset}
          />
        </BlueprintSection>
        <BlueprintSection title="Screens">
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
        <BlueprintSection title="Data Model">
          {tables.map((table, index) => (
            <div
              key={String(table?.name || index)}
              className="rounded border border-slate-700/80 p-3"
            >
              <div className="font-medium text-slate-100">
                {String(table?.label || table?.name)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {toObjectArray(table.columns).map((column, columnIndex) => (
                  <span
                    key={String(column?.name || columnIndex)}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300"
                  >
                    {String(column?.name || '')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </BlueprintSection>
        <BlueprintSection title="Bindings">
          {bindings.map((binding, index) => (
            <div
              key={String(binding?.id || index)}
              className="rounded border border-slate-700/80 p-3 text-xs"
            >
              <div className="font-medium text-slate-100">
                {String(binding?.name || binding?.id)}
              </div>
              <div className="mt-1 text-slate-400">
                {String(binding?.mode || '')} / {String(binding?.table || '')}
              </div>
            </div>
          ))}
        </BlueprintSection>
        <BlueprintSection title="Validation Issues">
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
              No validation issues.
            </div>
          )}
        </BlueprintSection>
      </div>
    </div>
  );
}

function BlueprintScreenPreview({
  screens,
  tables,
  bindings,
  designPreset,
}: {
  screens: Array<Record<string, any>>;
  tables: Array<Record<string, any>>;
  bindings: Array<Record<string, any>>;
  designPreset: Record<string, any> | null;
}) {
  if (screens.length === 0) {
    return (
      <div className="rounded border border-slate-700/80 p-3 text-xs text-slate-400">
        No screens defined.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-700/80 bg-[#0f0f11] shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between gap-3 border-slate-800 border-b bg-[#141416] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
            Governed ScreenJSON Preview
          </div>
          <div className="mt-1 truncate font-medium text-slate-100">
            {String(screens[0]?.name || screens[0]?.id || 'Screen')}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-[10px] text-slate-500 sm:flex">
          <span>{String(designPreset?.theme || 'nightworkers-dark')}</span>
          <span className="h-1 w-1 rounded-full bg-slate-600" />
          <span>{String(designPreset?.density || 'compact')}</span>
        </div>
      </div>
      <div className="grid min-h-[28rem] bg-[#111113] md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="hidden border-slate-800 border-r bg-[#141416] p-3 md:block">
          <div className="mb-3 px-2 text-[10px] font-semibold uppercase text-slate-500">
            Screens
          </div>
          <div className="grid gap-1">
            {screens.map((screen, index) => (
              <div
                key={String(screen.id || index)}
                className={`rounded-md px-2 py-2 text-xs ${
                  index === 0
                    ? 'bg-cyan-400/10 text-cyan-100 ring-1 ring-cyan-400/25'
                    : 'text-slate-400'
                }`}
              >
                <div className="truncate font-medium">{String(screen.name || screen.id)}</div>
                <div className="mt-0.5 truncate text-[10px] text-slate-500">
                  {String(screen.path || '/')}
                </div>
              </div>
            ))}
          </div>
        </nav>
        <main className="min-w-0 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold tracking-tight text-slate-50">
                {String(screens[0]?.name || 'Overview')}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {String(screens[0]?.componentName || 'DashboardPage')}
              </div>
            </div>
            <div className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1 text-[11px] text-slate-300">
              {toObjectArray(screens[0]?.sections).length} sections
            </div>
          </div>
          <div className="grid gap-4">
            {toObjectArray(screens[0]?.sections).map((section, index) => (
              <BlueprintPreviewSection
                key={String(section.id || index)}
                section={section}
                table={tableForSection(section, bindings, tables)}
                binding={bindingForSection(section, bindings)}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function BlueprintPreviewSection({
  section,
  table,
  binding,
}: {
  section: Record<string, any>;
  table: Record<string, any> | null;
  binding: Record<string, any> | null;
}) {
  const componentName = String(section.componentName || '');
  const props = isObject(section.props) ? section.props : {};
  const title = String(props.title || section.name || section.id || componentName || 'Section');
  const description = String(props.description || section.intent || section.visualIntent || '');
  const body = renderPreviewSectionBody(componentName, props, table, binding);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-700/80 bg-gradient-to-b from-[#1f1f23] to-[#17171a] shadow-sm ring-1 ring-slate-700/30">
      <header className="flex items-start justify-between gap-3 border-slate-700/60 border-b bg-slate-900/35 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-100">{title}</h3>
          {description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{description}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-[10px] text-slate-400">
          {componentName}
        </span>
      </header>
      <div className="p-4">{body}</div>
    </section>
  );
}

function renderPreviewSectionBody(
  componentName: string,
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  if (componentName === 'KpiSummarySection') {
    const items = toObjectArray(props.items);
    const metricItems =
      items.length > 0
        ? items
        : [
            {
              label: 'Records',
              value: table ? String(toObjectArray(table.columns).length * 12) : '24',
            },
            { label: 'Status fields', value: String((binding?.fields || []).length || 3) },
            { label: 'Open work', value: '8' },
          ];
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {metricItems.slice(0, 3).map((item, index) => (
          <div
            key={String(item.label || index)}
            className="rounded-md border border-slate-700/70 bg-slate-950/40 p-3"
          >
            <div className="text-[11px] text-slate-500">{String(item.label || 'Metric')}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-50">
              {String(item.value || item.description || index + 1)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (
    componentName === 'ChartSection' ||
    componentName === 'ChartInsightSection' ||
    componentName === 'ProgressListSection' ||
    componentName === 'StatsTrendCardsSection'
  ) {
    const chartItems = chartPreviewItems(props, table, binding);
    return (
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex h-40 items-end gap-2 rounded-md border border-slate-700/70 bg-slate-950/35 p-3">
          {chartItems.map((item, index) => (
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={item.label}>
              <div
                className="w-full rounded-t bg-cyan-300/80"
                style={{ height: `${Math.max(18, Math.min(100, item.value))}%` }}
              />
              <span className="max-w-full truncate text-[10px] text-slate-500">
                {item.label || `Item ${index + 1}`}
              </span>
            </div>
          ))}
        </div>
        <div className="grid content-start gap-2">
          {chartItems.slice(0, 4).map((item) => (
            <div
              className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/30 px-2 py-1.5 text-xs"
              key={item.label}
            >
              <span className="truncate text-slate-400">{item.label}</span>
              <span className="font-medium text-slate-100">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (componentName === 'DataTableSection') {
    const columns = previewColumns(props, table, binding);
    const rows = previewRows(props, columns);
    return (
      <div className="overflow-hidden rounded-md border border-slate-700/80 bg-slate-950/35">
        <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              {columns.map((column) => (
                <th className="px-3 py-2 font-semibold uppercase" key={column.key}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr className="border-slate-800 border-t odd:bg-slate-950/20" key={rowIndex}>
                {columns.map((column) => (
                  <td className="px-3 py-2 text-slate-200" key={column.key}>
                    {String(row[column.key] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (
    componentName === 'MainSearchNavigationSection' ||
    componentName === 'NavigationPanel' ||
    componentName === 'HoldingsListSection'
  ) {
    const links = toObjectArray(props.links).map((link) => String(link.label || link.href));
    const tabs = Array.isArray(props.tabs) ? props.tabs.map(String) : [];
    const labels = [...links, ...tabs];
    const navLabels = labels.length > 0 ? labels : ['Overview', 'Active', 'Archived'];
    return (
      <div className="grid gap-3">
        {componentName === 'MainSearchNavigationSection' ? (
          <div className="flex h-10 overflow-hidden rounded-md border border-slate-700 bg-slate-950/50">
            <div className="flex-1 px-3 py-2 text-xs text-slate-500">
              {String(props.searchPlaceholder || 'Search...')}
            </div>
            <div className="bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950">
              {String(props.searchButtonLabel || 'Search')}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {navLabels.map((label, index) => (
            <span
              className={`rounded-full border px-3 py-1 text-xs ${
                index === 0
                  ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100'
                  : 'border-slate-700 text-slate-400'
              }`}
              key={`${label}-${index}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (componentName === 'FormSection') {
    const fields = previewColumns(props, table, binding).slice(0, 4);
    return (
      <div className="grid gap-3">
        {fields.map((field) => (
          <div className="grid gap-1.5" key={field.key}>
            <span className="text-[11px] font-medium text-slate-400">{field.label}</span>
            <span className="h-9 rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-500">
              {field.label}
            </span>
          </div>
        ))}
        <div className="mt-1 h-9 w-fit rounded-md bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950">
          {String(props.submitLabel || 'Save')}
        </div>
      </div>
    );
  }

  if (componentName === 'KanbanSection') {
    const propColumns = toObjectArray(props.columns);
    const columns =
      propColumns.length > 0
        ? propColumns
        : ['Backlog', 'In progress', 'Done'].map((title, index) => ({
            title,
            cards: [
              {
                title: `${title} item`,
                description: index === 0 ? binding?.name : table?.label || table?.name,
              },
            ],
          }));
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {columns.slice(0, 4).map((column, index) => (
          <div
            className="rounded-md border border-slate-700/80 bg-slate-950/30 p-3"
            key={String(column.title || index)}
          >
            <div className="mb-3 text-xs font-semibold uppercase text-slate-400">
              {String(column.title || `Column ${index + 1}`)}
            </div>
            <div className="grid gap-2">
              {toObjectArray(column.cards)
                .slice(0, 3)
                .map((card, cardIndex) => (
                  <div
                    className="rounded border border-slate-700 bg-slate-900/50 p-2"
                    key={String(card.title || cardIndex)}
                  >
                    <div className="text-xs font-medium text-slate-100">
                      {String(card.title || 'Card')}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                      {String(card.description || '')}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (componentName === 'CardGridSection') {
    const items = toObjectArray(props.items);
    const cards =
      items.length > 0
        ? items
        : previewColumns(props, table, binding)
            .slice(0, 3)
            .map((column) => ({
              title: column.label,
              description: `Bound to ${column.key}`,
              badge: table ? String(table.label || table.name) : 'Blueprint',
            }));
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, index) => (
          <article
            key={String(card.title || index)}
            className="rounded-md border border-slate-700/80 bg-slate-950/35 p-3"
          >
            <div className="mb-3 h-20 rounded bg-gradient-to-br from-cyan-400/20 via-slate-800 to-slate-950" />
            <div className="font-medium text-slate-100">{String(card.title || 'Card')}</div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
              {String(card.description || '')}
            </p>
            {card.badge ? (
              <div className="mt-3 w-fit rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                {String(card.badge)}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    );
  }

  if (
    componentName === 'CalendarSection' ||
    componentName === 'ScheduleSection' ||
    componentName === 'CheckoutSummarySection'
  ) {
    const entries = toObjectArray(props.entries || props.events || props.lines);
    const rows =
      entries.length > 0
        ? entries
        : [
            { title: 'Planning review', date: '2026-06-03', amount: '$1,240' },
            { title: 'Implementation', date: '2026-06-04', amount: '$860' },
            { title: 'Validation', date: '2026-06-05', amount: '$420' },
          ];
    return (
      <div className="grid gap-2">
        {rows.slice(0, 5).map((row, index) => (
          <div
            className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs"
            key={String(row.title || row.label || index)}
          >
            <div>
              <div className="font-medium text-slate-100">
                {String(row.title || row.label || `Item ${index + 1}`)}
              </div>
              <div className="mt-0.5 text-slate-500">{String(row.date || row.status || '')}</div>
            </div>
            <div className="text-slate-300">{String(row.amount || row.value || '')}</div>
          </div>
        ))}
      </div>
    );
  }

  if (
    componentName === 'ActivityFeedSection' ||
    componentName === 'NotificationCenterSection' ||
    componentName === 'ChatPanelSection'
  ) {
    const items = toObjectArray(props.items || props.messages);
    const feed =
      items.length > 0
        ? items
        : [
            { actor: 'System', action: 'validated', target: binding?.name || 'Blueprint' },
            { actor: 'Agent', action: 'mapped', target: table?.label || table?.name || 'Data' },
            { actor: 'User', action: 'reviewed', target: 'Preview' },
          ];
    return (
      <div className="grid gap-2">
        {feed.slice(0, 5).map((item, index) => (
          <div className="rounded-md border border-slate-800 bg-slate-950/30 p-3" key={index}>
            <div className="text-xs font-medium text-slate-100">
              {String(item.title || item.author || item.actor || `Update ${index + 1}`)}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-400">
              {String(
                item.body || item.content || `${item.action || 'updated'} ${item.target || ''}`
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (
    componentName === 'AccordionSection' ||
    componentName === 'ComparisonSection' ||
    componentName === 'QuickActionsSection' ||
    componentName === 'ControlPanelSection' ||
    componentName === 'EditorPreviewSection' ||
    componentName === 'InsightPanel' ||
    componentName === 'EmptyState' ||
    componentName === 'ErrorState'
  ) {
    const items = previewGenericItems(props, table, binding);
    return (
      <div className="grid gap-2">
        {items.map((item, index) => (
          <div
            className="rounded-md border border-slate-800 bg-slate-950/30 px-3 py-2"
            key={`${item.title}-${index}`}
          >
            <div className="text-xs font-medium text-slate-100">{item.title}</div>
            <div className="mt-1 text-[11px] leading-5 text-slate-400">{item.description}</div>
          </div>
        ))}
      </div>
    );
  }

  if (componentName === 'StepperSection' || componentName === 'TimelineSection') {
    const steps = toObjectArray(props.steps || props.items);
    const timeline =
      steps.length > 0
        ? steps
        : ['Draft', 'Validate', 'Implement'].map((label) => ({
            title: label,
            description: binding?.name,
          }));
    return (
      <div className="grid gap-3">
        {timeline.slice(0, 4).map((step, index) => (
          <div className="flex gap-3" key={String(step.title || index)}>
            <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-300" />
            <div>
              <div className="text-sm font-medium text-slate-100">
                {String(step.title || ('label' in step ? step.label : `Step ${index + 1}`))}
              </div>
              <div className="text-xs leading-5 text-slate-400">
                {String(step.description || '')}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-slate-700 bg-slate-950/25 p-3 text-xs leading-5 text-slate-400">
      {String(sectionFallbackText(componentName, table, binding))}
    </div>
  );
}

function bindingForSection(section: Record<string, any>, bindings: Array<Record<string, any>>) {
  return (
    bindings.find((binding) => binding.id && binding.id === section.dataBindingId) ||
    bindings.find((binding) => binding.mode === section.source) ||
    null
  );
}

function tableForSection(
  section: Record<string, any>,
  bindings: Array<Record<string, any>>,
  tables: Array<Record<string, any>>
) {
  const binding = bindingForSection(section, bindings);
  return tables.find((table) => table.name && table.name === binding?.table) || tables[0] || null;
}

function previewColumns(
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const propColumns = toObjectArray(props.columns);
  if (propColumns.length > 0) {
    return propColumns.map((column, index) => ({
      key: String(column.key || column.name || index),
      label: String(column.label || column.name || column.key || `Column ${index + 1}`),
    }));
  }

  const tableColumns = toObjectArray(table?.columns);
  const bindingFields = Array.isArray(binding?.fields) ? binding.fields.map(String) : [];
  const visibleColumns =
    bindingFields.length > 0
      ? tableColumns.filter((column) => bindingFields.includes(String(column.name)))
      : tableColumns;

  const columns = visibleColumns.length > 0 ? visibleColumns : tableColumns;
  return columns.slice(0, 5).map((column, index) => ({
    key: String(column.name || index),
    label: titleCase(String(column.label || column.name || `Column ${index + 1}`)),
  }));
}

function previewRows(props: Record<string, any>, columns: Array<{ key: string; label: string }>) {
  const rows = toObjectArray(props.rows);
  if (rows.length > 0) return rows.slice(0, 4);

  return Array.from({ length: 3 }, (_, rowIndex) =>
    Object.fromEntries(
      columns.map((column, columnIndex) => [
        column.key,
        columnIndex === 0
          ? `${column.label} ${rowIndex + 1}`
          : sampleCellValue(column.key, rowIndex),
      ])
    )
  );
}

function chartPreviewItems(
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const sourceItems = toObjectArray(props.data || props.items || props.cards);
  if (sourceItems.length > 0) {
    return sourceItems.slice(0, 6).map((item, index) => ({
      label: String(item.label || item.title || `Item ${index + 1}`),
      value: Number(item.value || item.max || 24 + index * 14),
    }));
  }

  const columns = previewColumns(props, table, binding);
  return columns.slice(0, 5).map((column, index) => ({
    label: column.label,
    value: 24 + index * 14,
  }));
}

function previewGenericItems(
  props: Record<string, any>,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const propItems = toObjectArray(
    props.items || props.columns || props.controls || props.lines || props.insights
  );
  if (propItems.length > 0) {
    return propItems.slice(0, 5).map((item, index) => ({
      title: String(item.title || item.label || item.id || `Item ${index + 1}`),
      description: String(item.description || item.body || item.content || item.value || ''),
    }));
  }

  const columns = previewColumns(props, table, binding);
  if (columns.length > 0) {
    return columns.slice(0, 4).map((column) => ({
      title: column.label,
      description: binding
        ? `Mapped from ${String(binding.name || binding.id)}`
        : `Field ${column.key}`,
    }));
  }

  return [
    {
      title: String(
        props.title || binding?.name || table?.label || table?.name || 'Blueprint section'
      ),
      description: String(
        props.description || props.body || 'Catalog-backed section preview placeholder.'
      ),
    },
  ];
}

function sampleCellValue(key: string, rowIndex: number) {
  if (key.includes('status')) return ['Ready', 'In review', 'Queued'][rowIndex % 3];
  if (key.includes('date') || key.includes('created')) return `2026-06-0${rowIndex + 1}`;
  if (key.includes('count') || key.includes('total')) return String((rowIndex + 1) * 12);
  return ['Primary', 'Secondary', 'Tertiary'][rowIndex % 3];
}

function sectionFallbackText(
  componentName: string,
  table: Record<string, any> | null,
  binding: Record<string, any> | null
) {
  const source = binding
    ? `binding "${String(binding.name || binding.id)}"`
    : 'static blueprint data';
  const tableName = table ? ` over "${String(table.label || table.name)}"` : '';
  return `${componentName || 'Section'} preview uses ${source}${tableName}.`;
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function ComponentDesignViewer({ artifact, markdown }: { artifact: unknown; markdown?: string }) {
  if (!isObject(artifact)) return <MarkdownViewer content={markdown || 'No component design'} />;
  const variants = toObjectArray(artifact.variants);
  const tokenChanges = toObjectArray(artifact.tokenChanges);
  const discussionPrompts = Array.isArray(artifact.discussionPrompts)
    ? artifact.discussionPrompts.map(String)
    : [];
  return (
    <div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
      <div className="mb-5 border-slate-700 border-b pb-4">
        <div className="text-xs font-semibold uppercase text-cyan-200">Component Design</div>
        <h1 className="mt-1 text-xl font-semibold text-slate-50">
          {String(artifact.componentName || 'Component')}
        </h1>
        <div className="mt-1 text-xs text-slate-400">{String(artifact.scope || '')}</div>
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-300">
          {String(artifact.summary || 'No summary')}
        </p>
      </div>
      <div className="grid gap-4">
        <BlueprintSection title="Variant Preview">
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
                  <span className="text-[10px] uppercase text-slate-500">Button</span>
                </div>
                <button
                  type="button"
                  className={componentButtonClass(String(variant.name || 'primary'))}
                >
                  {buttonLabelForVariant(String(variant.name || 'primary'))}
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
        <BlueprintSection title="Token Changes">
          {tokenChanges.map((change, index) => (
            <div
              key={String(change.token || index)}
              className="rounded border border-slate-700/80 p-3 text-xs"
            >
              <div className="font-medium text-slate-100">{String(change.token || '')}</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <TokenValue label="Before" value={String(change.before || '')} />
                <TokenValue label="Proposed" value={String(change.proposed || '')} />
              </div>
              <p className="mt-2 leading-5 text-slate-400">{String(change.rationale || '')}</p>
            </div>
          ))}
        </BlueprintSection>
        <BlueprintSection title="Discussion">
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

function buttonLabelForVariant(variant: string): string {
  if (variant === 'danger') return 'Delete';
  if (variant === 'secondary') return 'Cancel';
  if (variant === 'icon-only') return '+';
  return 'Save';
}

function BlueprintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase text-slate-400">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toObjectArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

const FileViewer = memo(function FileViewer({ file }: { file: ProjectFileContent }) {
  const isMarkdown = /\.(md|mdx|markdown)$/i.test(file.path);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {file.truncated ? (
        <div className="shrink-0 border-b border-[#313244] bg-[#1e1e2e] px-3 py-2 text-xs text-amber-300">
          truncated
        </div>
      ) : null}
      {isMarkdown ? (
        <MarkdownViewer content={file.content || ''} />
      ) : (
        <CodeBlock
          className="dark nightworkers-artifact-code min-h-0 flex-1 [&_.line]:whitespace-pre-wrap [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:overflow-x-hidden"
          data={[
            {
              code: file.content || 'No content',
              filename: file.path,
              language: inferLanguage(file.path),
            },
          ]}
          maxHeight="none"
          showHeader={false}
          themes={artifactCodeBlockThemes}
        />
      )}
    </div>
  );
});

const MarkdownViewer = memo(function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#1e1e2e] px-8 py-6 text-[#cdd6f4]">
      <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={markdownComponents}>
        {content || 'No content'}
      </ReactMarkdown>
    </div>
  );
});

function DiffViewer({ diff }: { diff: string }) {
  const files = getChangedFiles(diff);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-xs font-medium text-slate-100">Changed files</div>
        {files.length > 0 ? (
          <ul className="grid gap-1">
            {files.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/35 px-2 py-1 text-xs"
              >
                <span className="min-w-0 truncate text-slate-200">{file.path}</span>
                <span className="shrink-0 text-slate-400">
                  <span className="text-emerald-300">+{file.added}</span>{' '}
                  <span className="text-rose-300">-{file.deleted}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No changed files parsed.</p>
        )}
      </div>
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs leading-5 text-slate-200">
        {diff || 'No diff'}
      </pre>
    </div>
  );
}

function ProjectTree({
  entries,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFilePath,
  onToggleDirectory,
  onOpenFile,
}: {
  entries: ProjectFileEntry[];
  entriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <ProjectTreeNode
          key={`${entry.type}-${entry.path}`}
          entry={entry}
          entriesByDirectory={entriesByDirectory}
          expandedDirectories={expandedDirectories}
          loadingDirectories={loadingDirectories}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onOpenFile={onOpenFile}
        />
      ))}
    </ul>
  );
}

function ProjectTreeNode({
  entry,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFilePath,
  onToggleDirectory,
  onOpenFile,
  depth = 0,
}: {
  entry: ProjectFileEntry;
  entriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  depth?: number;
}) {
  const isDirectory = entry.type === 'directory';
  const isExpanded = Boolean(expandedDirectories[entry.path]);
  const isLoading = Boolean(loadingDirectories[entry.path]);
  const children = entriesByDirectory[entry.path] || [];
  return (
    <li>
      <button
        type="button"
        className={`flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] ${
          selectedFilePath === entry.path
            ? 'bg-slate-800 text-slate-100'
            : 'text-slate-300 hover:bg-slate-800/60'
        }`}
        onClick={() => (isDirectory ? void onToggleDirectory(entry.path) : onOpenFile(entry.path))}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {isDirectory ? (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-slate-500 transition-transform ${
              isExpanded ? 'rotate-90' : ''
            }`}
          />
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        {isDirectory ? (
          <Folder className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <File className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {isDirectory && isExpanded ? (
        <div className="mt-0.5">
          {isLoading ? (
            <div
              className="px-2 py-1 text-[11px] text-slate-500"
              style={{ paddingLeft: `${28 + (depth + 1) * 14}px` }}
            >
              Loading...
            </div>
          ) : children.length > 0 ? (
            <ul className="space-y-0.5">
              {children.map((child) => (
                <ProjectTreeNode
                  key={`${child.type}-${child.path}`}
                  entry={child}
                  entriesByDirectory={entriesByDirectory}
                  expandedDirectories={expandedDirectories}
                  loadingDirectories={loadingDirectories}
                  selectedFilePath={selectedFilePath}
                  onToggleDirectory={onToggleDirectory}
                  onOpenFile={onOpenFile}
                  depth={depth + 1}
                />
              ))}
            </ul>
          ) : (
            <div
              className="px-2 py-1 text-[11px] text-slate-600"
              style={{ paddingLeft: `${28 + (depth + 1) * 14}px` }}
            >
              Empty
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function inferLanguage(filePath: string) {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (!extension) return 'text';
  const languageByExtension: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'bash',
    sql: 'sql',
  };
  return languageByExtension[extension] || 'text';
}
