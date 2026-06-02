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
  TaskRun,
  WorkbenchArtifactRef,
} from '../types';
import { getChangedFiles } from '../utils/diff';

type ArtifactPaneProps = {
  activeProject: Repository | null;
  latestRun?: TaskRun;
  selectedArtifact: WorkbenchArtifactRef | null;
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
  const artifactTitle = showDiff ? 'Diff' : selectedFilePath || 'Project tree';
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
        <div className="min-h-0 w-56 shrink-0 overflow-auto border-r border-slate-800 p-2">
          {latestRun?.diffPatch?.trim() ? (
            <button
              type="button"
              className={`mb-2 flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-[11px] ${
                showDiff
                  ? 'border-cyan-400/60 bg-cyan-950/30 text-cyan-100'
                  : 'border-slate-700/70 text-slate-200 hover:border-slate-500'
              }`}
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
        </div>
        <div className="min-w-0 flex-1 overflow-hidden bg-[#1e1e2e]">
          {showDiff ? (
            <DiffViewer diff={latestRun?.diffPatch || ''} />
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
