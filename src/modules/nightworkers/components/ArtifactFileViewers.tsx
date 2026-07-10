import { ChevronRight, File, Folder } from "lucide-react";
import { isValidElement, memo, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/components/ui/CodeBlock";
import type { ProjectFileContent, ProjectFileEntry } from "../types";
import { getChangedFiles } from "../utils/diff";
import { normalizeProjectFileLinkTarget } from "../utils/projectFileLinks";
import { DiffCodeBlock } from "./ThreadTimelineDiffView";

const artifactCodeBlockThemes = {
	light: "github-dark-default",
	dark: "github-dark-default",
} as const;
const markdownRemarkPlugins = [remarkGfm];
const baseMarkdownComponents: Components = {
	blockquote: ({ children }) => (
		<blockquote className="nightworkers-artifact-markdown-blockquote border-l-2 pl-4">
			{children}
		</blockquote>
	),
	code: ({ children }) => (
		<code className="nightworkers-artifact-markdown-code rounded px-1 py-0.5 font-mono text-[0.92em]">
			{children}
		</code>
	),
	h1: ({ children }) => (
		<h1 className="nightworkers-artifact-markdown-heading mt-0 mb-4 border-b pb-2 text-2xl font-semibold">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="nightworkers-artifact-markdown-heading mt-8 mb-3 border-b pb-1 text-xl font-semibold">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="nightworkers-artifact-markdown-heading mt-6 mb-2 text-lg font-semibold">
			{children}
		</h3>
	),
	li: ({ children }) => <li className="my-1 pl-1">{children}</li>,
	ol: ({ children }) => (
		<ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>
	),
	p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
	pre: ({ children }) => (
		<pre className="nightworkers-artifact-markdown-pre my-4 overflow-x-hidden whitespace-pre-wrap break-words rounded p-3 font-mono text-sm">
			{children}
		</pre>
	),
	table: ({ children }) => (
		<div className="my-4 overflow-x-hidden">
			<table className="w-full table-fixed border-collapse text-sm">
				{children}
			</table>
		</div>
	),
	td: ({ children }) => (
		<td className="nightworkers-artifact-markdown-cell break-words border px-2 py-1 align-top">
			{children}
		</td>
	),
	th: ({ children }) => (
		<th className="nightworkers-artifact-markdown-header-cell break-words border px-2 py-1 text-left font-medium">
			{children}
		</th>
	),
	ul: ({ children }) => (
		<ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>
	),
};

function markdownChildrenText(children: ReactNode): string {
	if (typeof children === "string" || typeof children === "number")
		return String(children);
	if (Array.isArray(children))
		return children.map(markdownChildrenText).join("");
	if (isValidElement<{ children?: ReactNode }>(children))
		return markdownChildrenText(children.props.children);
	return "";
}

function buildMarkdownComponents(
	onOpenProjectFile?: (path: string) => void,
): Components {
	return {
		...baseMarkdownComponents,
		a: ({ children, href, ...props }) => {
			const projectFilePath =
				normalizeProjectFileLinkTarget(href) ||
				normalizeProjectFileLinkTarget(markdownChildrenText(children));
			return (
				<a
					{...props}
					className="nightworkers-artifact-markdown-link underline underline-offset-2"
					href={href}
					data-project-file-link={projectFilePath || undefined}
					title={projectFilePath ? "ソースコードを開く" : props.title}
					onClick={
						projectFilePath && onOpenProjectFile
							? (event) => {
									event.preventDefault();
									onOpenProjectFile(projectFilePath);
								}
							: props.onClick
					}
				>
					{children}
				</a>
			);
		},
	};
}
export const FileViewer = memo(function FileViewer({
	file,
	onOpenProjectFile,
}: {
	file: ProjectFileContent;
	onOpenProjectFile?: (path: string) => void;
}) {
	const { t } = useTranslation();
	const isMarkdown = /\.(md|mdx|markdown)$/i.test(file.path);
	return (
		<div className="flex h-full min-h-0 flex-col">
			{file.truncated ? (
				<div className="shrink-0 border-b border-[#313244] bg-[#1e1e2e] px-3 py-2 text-xs text-amber-300">
					{t("artifact.truncated")}
				</div>
			) : null}
			{isMarkdown ? (
				<MarkdownViewer
					content={file.content || ""}
					onOpenProjectFile={onOpenProjectFile}
				/>
			) : (
				<CodeBlock
					className="dark nightworkers-artifact-code min-h-0 flex-1 [&_.line]:whitespace-pre-wrap [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:overflow-x-hidden"
					data={[
						{
							code: file.content || t("artifact.noContent"),
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

export const MarkdownViewer = memo(function MarkdownViewer({
	content,
	onOpenProjectFile,
}: {
	content: string;
	onOpenProjectFile?: (path: string) => void;
}) {
	const { t } = useTranslation();
	const markdownComponents = useMemo(
		() => buildMarkdownComponents(onOpenProjectFile),
		[onOpenProjectFile],
	);

	return (
		<div
			className="nightworkers-artifact-markdown min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-8 py-6"
			data-artifact-export-expand
		>
			<ReactMarkdown
				remarkPlugins={markdownRemarkPlugins}
				components={markdownComponents}
			>
				{content || t("artifact.noContent")}
			</ReactMarkdown>
		</div>
	);
});

export function DiffViewer({
	diff,
	onOpenProjectFile,
}: {
	diff: string;
	onOpenProjectFile?: (path: string) => void;
}) {
	const { t } = useTranslation();
	const files = getChangedFiles(diff);
	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<div className="text-xs font-medium text-slate-100">
					{t("artifact.changedFiles")}
				</div>
				{files.length > 0 ? (
					<ul className="grid gap-1">
						{files.map((file) => (
							<li
								key={file.path}
								className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/35 px-2 py-1 text-xs"
							>
								<button
									type="button"
									className="min-w-0 flex-1 truncate text-left text-slate-200 underline-offset-2 hover:text-cyan-200 hover:underline disabled:cursor-default disabled:text-slate-200 disabled:no-underline"
									disabled={!onOpenProjectFile}
									data-project-file-link={file.path}
									onClick={() => onOpenProjectFile?.(file.path)}
									title={file.path}
								>
									{file.path}
								</button>
								<span className="shrink-0 text-slate-400">
									<span className="text-emerald-300">+{file.added}</span>{" "}
									<span className="text-rose-300">-{file.deleted}</span>
								</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-xs text-slate-500">
						{t("artifact.noChangedFiles")}
					</p>
				)}
			</div>
			{diff ? (
				<DiffCodeBlock
					className="nightworkers-artifact-diff-block"
					code={diff}
					label={t("artifact.diff")}
				/>
			) : (
				<div className="rounded border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs leading-5 text-slate-500">
					{t("artifact.noDiff")}
				</div>
			)}
		</div>
	);
}

export function ProjectTree({
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
	const { t } = useTranslation();
	const isDirectory = entry.type === "directory";
	const isExpanded = Boolean(expandedDirectories[entry.path]);
	const isLoading = Boolean(loadingDirectories[entry.path]);
	const children = entriesByDirectory[entry.path] || [];
	return (
		<li>
			<button
				type="button"
				className={`flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] ${
					selectedFilePath === entry.path
						? "bg-slate-800 text-slate-100"
						: "text-slate-300 hover:bg-slate-800/60"
				}`}
				onClick={() =>
					isDirectory
						? void onToggleDirectory(entry.path)
						: onOpenFile(entry.path)
				}
				style={{ paddingLeft: `${8 + depth * 14}px` }}
			>
				{isDirectory ? (
					<ChevronRight
						className={`h-3 w-3 shrink-0 text-slate-500 transition-transform ${
							isExpanded ? "rotate-90" : ""
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
							{t("artifact.loading")}
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
							{t("artifact.empty")}
						</div>
					)}
				</div>
			) : null}
		</li>
	);
}

function inferLanguage(filePath: string) {
	const extension = filePath.split(".").pop()?.toLowerCase();
	if (!extension) return "text";
	const languageByExtension: Record<string, string> = {
		js: "javascript",
		jsx: "jsx",
		ts: "typescript",
		tsx: "tsx",
		json: "json",
		md: "markdown",
		css: "css",
		html: "html",
		yml: "yaml",
		yaml: "yaml",
		sh: "bash",
		sql: "sql",
	};
	return languageByExtension[extension] || "text";
}
