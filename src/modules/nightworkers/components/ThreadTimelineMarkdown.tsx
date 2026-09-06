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
	"nightworkers-code-block dark max-w-full rounded-[var(--radius-md)] text-xs shadow-none [&_.line]:whitespace-pre-wrap [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:overflow-x-hidden";

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
		<blockquote className="nightworkers-chat-markdown-muted my-3 border-l-2 pl-3">
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
		<h1 className="nightworkers-chat-markdown-heading mt-1 mb-3 text-lg font-semibold">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="nightworkers-chat-markdown-heading mt-4 mb-2 text-base font-semibold">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="nightworkers-chat-markdown-heading mt-3 mb-2 text-sm font-semibold">
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
		<td className="nightworkers-chat-markdown-cell border px-2 py-1 align-top">
			{children}
		</td>
	),
	th: ({ children }) => (
		<th className="nightworkers-chat-markdown-header-cell border px-2 py-1 text-left font-medium">
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

function isEvidenceCheckArtifactLink(href: string | undefined): boolean {
	if (!href) return false;
	try {
		const url = new URL(href, "http://nightworkers.local");
		return (
			url.pathname.startsWith("/sessions/") &&
			url.searchParams.get("artifact") === "evidence_check"
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
	onOpenEvidenceCheckArtifact?: () => void,
	onOpenReviewModeArtifact?: () => void,
	evidenceCheckArtifactTitle?: string,
	reviewModeArtifactTitle?: string,
): Components {
	return {
		...baseChatMarkdownComponents,
		a: ({ children, href, ...props }) => {
			const projectFilePath =
				normalizeProjectFileLinkTarget(href) ||
				normalizeProjectFileLinkTarget(markdownChildrenText(children));
			const evidenceCheckArtifactLink = isEvidenceCheckArtifactLink(href);
			const reviewModeArtifactLink = isReviewModeArtifactLink(href);
			const workbenchArtifactLink =
				evidenceCheckArtifactLink || reviewModeArtifactLink;
			return (
				<a
					{...props}
					className={cn(
						"nightworkers-chat-markdown-link underline underline-offset-2",
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
						evidenceCheckArtifactLink
							? "evidence_check"
							: reviewModeArtifactLink
								? "review_status"
								: undefined
					}
					title={
						projectFilePath
							? "ソースコードを開く"
							: evidenceCheckArtifactLink
								? evidenceCheckArtifactTitle
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
							: evidenceCheckArtifactLink && onOpenEvidenceCheckArtifact
								? (event) => {
										event.preventDefault();
										onOpenEvidenceCheckArtifact();
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
	onOpenEvidenceCheckArtifact,
	onOpenReviewModeArtifact,
}: {
	content: string;
	onOpenProjectFile?: (path: string) => void;
	onOpenEvidenceCheckArtifact?: () => void;
	onOpenReviewModeArtifact?: () => void;
}) {
	const { t } = useTranslation();
	const evidenceCheckArtifactTitle = t("evidenceCheck.openArtifact");
	const reviewModeArtifactTitle = t("reviewStatus.title");
	const markdownComponents = useMemo(
		() =>
			buildChatMarkdownComponents(
				onOpenProjectFile,
				onOpenEvidenceCheckArtifact,
				onOpenReviewModeArtifact,
				evidenceCheckArtifactTitle,
				reviewModeArtifactTitle,
			),
		[
			onOpenProjectFile,
			onOpenEvidenceCheckArtifact,
			onOpenReviewModeArtifact,
			evidenceCheckArtifactTitle,
			reviewModeArtifactTitle,
		],
	);

	return (
		<div className="nightworkers-message-content max-w-full whitespace-normal break-words text-sm leading-6">
			<ReactMarkdown
				components={markdownComponents}
				remarkPlugins={chatMarkdownRemarkPlugins}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
