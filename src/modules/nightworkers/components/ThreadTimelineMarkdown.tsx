import { isValidElement, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CodeBlockData, CodeBlockProps } from "@/components/ui/CodeBlock";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { cn } from "@/lib/utils";
import { normalizeProjectFileLinkTarget } from "../utils/projectFileLinks";

const chatCodeBlockThemes = {
	light: "github-dark-default",
	dark: "github-dark-default",
} as const;
const chatCodeBlockClassName =
	"nightworkers-code-block dark max-w-full rounded-[var(--radius-md)] border-[color:var(--nw-border)] bg-[var(--nw-surface)] text-[var(--nw-text)] text-xs shadow-none [&_.line]:whitespace-pre-wrap [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:overflow-x-hidden";
const _UNKNOWN_ACTIVITY_TITLE_KEY = "timeline.unknownActivity";

type NightWorkersCodeBlockProps = Omit<
	CodeBlockProps,
	"data" | "themes" | "className" | "children"
> & {
	data?: CodeBlockData[];
	code?: string;
	filename?: string;
	language?: CodeBlockData["language"];
	className?: string;
};

export function NightWorkersCodeBlock({
	className,
	data,
	code,
	filename = "text",
	language = "text",
	lineNumbers = false,
	maxHeight = 360,
	showHeader = true,
	syntaxHighlighting = true,
	...props
}: NightWorkersCodeBlockProps) {
	const codeData = data ?? [
		{
			code: code ?? "",
			filename,
			language,
		},
	];

	return (
		<CodeBlock
			className={cn(chatCodeBlockClassName, className)}
			data={codeData}
			lineNumbers={lineNumbers}
			maxHeight={maxHeight}
			showHeader={showHeader}
			syntaxHighlighting={syntaxHighlighting}
			themes={chatCodeBlockThemes}
			{...props}
		/>
	);
}

const chatMarkdownRemarkPlugins = [remarkGfm];
const baseChatMarkdownComponents: Components = {
	blockquote: ({ children }) => (
		<blockquote className="my-3 border-slate-600 border-l-2 pl-3 text-slate-300">
			{children}
		</blockquote>
	),
	code: ({ children, className }) => {
		const language = /language-(\w+)/.exec(className || "")?.[1];
		if (language) {
			return (
				<NightWorkersCodeBlock
					className="my-3"
					code={String(children).replace(/\n$/, "")}
					filename={language}
					language={language}
				/>
			);
		}
		return (
			<code
				className="rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[0.92em]"
				style={{
					backgroundColor:
						"color-mix(in srgb, var(--nw-surface-soft) 52%, transparent)",
					boxShadow:
						"inset 0 0 0 1px color-mix(in srgb, var(--nw-primary) 14%, transparent)",
					color: "color-mix(in srgb, var(--nw-primary) 68%, var(--nw-text))",
				}}
			>
				{children}
			</code>
		);
	},
	h1: ({ children }) => (
		<h1 className="mt-1 mb-3 text-lg font-semibold text-slate-50">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="mt-4 mb-2 text-base font-semibold text-slate-50">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="mt-3 mb-2 text-sm font-semibold text-slate-50">
			{children}
		</h3>
	),
	li: ({ children }) => <li className="my-1 pl-1">{children}</li>,
	ol: ({ children }) => (
		<ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
	),
	p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
	pre: ({ children }) => <>{children}</>,
	table: ({ children }) => (
		<div className="my-3 overflow-x-auto">
			<table className="w-full border-collapse text-xs">{children}</table>
		</div>
	),
	td: ({ children }) => (
		<td className="border border-slate-700 px-2 py-1 align-top text-slate-200">
			{children}
		</td>
	),
	th: ({ children }) => (
		<th className="border border-slate-700 bg-slate-950/60 px-2 py-1 text-left font-medium text-slate-100">
			{children}
		</th>
	),
	ul: ({ children }) => (
		<ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
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

function isTestModeArtifactLink(href: string | undefined): boolean {
	if (!href) return false;
	try {
		const url = new URL(href, "http://nightworkers.local");
		return (
			url.pathname.startsWith("/sessions/") &&
			url.searchParams.get("artifact") === "test_mode"
		);
	} catch {
		return false;
	}
}

function isReviewModeArtifactLink(href: string | undefined): boolean {
	if (!href) return false;
	try {
		const url = new URL(href, "http://nightworkers.local");
		return (
			url.pathname.startsWith("/sessions/") &&
			url.searchParams.get("artifact") === "review_status"
		);
	} catch {
		return false;
	}
}

function buildChatMarkdownComponents(
	onOpenProjectFile?: (path: string) => void,
	onOpenTestModeArtifact?: () => void,
	onOpenReviewModeArtifact?: () => void,
	testModeArtifactTitle?: string,
	reviewModeArtifactTitle?: string,
): Components {
	return {
		...baseChatMarkdownComponents,
		a: ({ children, href, ...props }) => {
			const projectFilePath =
				normalizeProjectFileLinkTarget(href) ||
				normalizeProjectFileLinkTarget(markdownChildrenText(children));
			const testModeArtifactLink = isTestModeArtifactLink(href);
			const reviewModeArtifactLink = isReviewModeArtifactLink(href);
			const workbenchArtifactLink =
				testModeArtifactLink || reviewModeArtifactLink;
			return (
				<a
					{...props}
					className={cn(
						"text-cyan-200 underline underline-offset-2 hover:text-cyan-100",
						workbenchArtifactLink && "mt-1 block w-fit",
					)}
					href={href}
					target={
						projectFilePath || workbenchArtifactLink ? undefined : "_blank"
					}
					rel={
						projectFilePath || workbenchArtifactLink ? undefined : "noreferrer"
					}
					data-project-file-link={projectFilePath || undefined}
					data-workbench-artifact-link={
						testModeArtifactLink
							? "test_mode"
							: reviewModeArtifactLink
								? "review_status"
								: undefined
					}
					title={
						projectFilePath
							? "ソースコードを開く"
							: testModeArtifactLink
								? testModeArtifactTitle
								: reviewModeArtifactLink
									? reviewModeArtifactTitle
									: props.title
					}
					onClick={
						projectFilePath && onOpenProjectFile
							? (event) => {
									event.preventDefault();
									onOpenProjectFile(projectFilePath);
								}
							: testModeArtifactLink && onOpenTestModeArtifact
								? (event) => {
										event.preventDefault();
										onOpenTestModeArtifact();
									}
								: reviewModeArtifactLink && onOpenReviewModeArtifact
									? (event) => {
											event.preventDefault();
											onOpenReviewModeArtifact();
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

export function ChatMarkdown({
	content,
	onOpenProjectFile,
	onOpenTestModeArtifact,
	onOpenReviewModeArtifact,
}: {
	content: string;
	onOpenProjectFile?: (path: string) => void;
	onOpenTestModeArtifact?: () => void;
	onOpenReviewModeArtifact?: () => void;
}) {
	const { t } = useTranslation();
	const testModeArtifactTitle = t("testMode.openArtifact");
	const reviewModeArtifactTitle = t("reviewStatus.title");
	const markdownComponents = useMemo(
		() =>
			buildChatMarkdownComponents(
				onOpenProjectFile,
				onOpenTestModeArtifact,
				onOpenReviewModeArtifact,
				testModeArtifactTitle,
				reviewModeArtifactTitle,
			),
		[
			onOpenProjectFile,
			onOpenTestModeArtifact,
			onOpenReviewModeArtifact,
			testModeArtifactTitle,
			reviewModeArtifactTitle,
		],
	);

	return (
		<div className="nightworkers-message-content max-w-full whitespace-normal break-words text-sm leading-6 text-slate-100">
			<ReactMarkdown
				components={markdownComponents}
				remarkPlugins={chatMarkdownRemarkPlugins}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
