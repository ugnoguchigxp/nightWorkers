import { PanelsTopLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isDeepRecord, toDeepRecord } from "../../../../shared/json-record";
import { isWorkspaceOnlyTaskMessage } from "../messageVisibility";
import type { TaskMessage, WorkbenchArtifactRef } from "../types";
import { ChatMarkdown, NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";

export function MessagePayload({
	message,
	onOpenArtifact,
	onOpenProjectFile,
	onOpenTestModeArtifact,
	onOpenReviewModeArtifact,
}: {
	message: TaskMessage;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onOpenProjectFile?: (path: string) => void;
	onOpenTestModeArtifact?: () => void;
	onOpenReviewModeArtifact?: () => void;
}) {
	const { t } = useTranslation();
	const metadata = toDeepRecord(message.metadataJson);
	if (isWorkspaceOnlyTaskMessage(message)) return null;
	if (message.role === "user" && metadata?.artifactContext) {
		const artifactContext = toDeepRecord(metadata.artifactContext);
		return (
			<div className="space-y-2">
				<div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-2.5 py-1.5 text-[11px] text-cyan-50">
					<span className="font-semibold">
						{t("timeline.referencedArtifact")}
					</span>
					<span className="min-w-0 max-w-[26rem] truncate text-cyan-100/90">
						{String(artifactContext.title || artifactContext.artifactId || "")}
					</span>
					{artifactContext.kind ? (
						<span className="rounded border border-cyan-500/30 px-1.5 py-0.5 text-[10px] uppercase text-cyan-100/70">
							{String(artifactContext.kind)}
						</span>
					) : null}
				</div>
				<div>{message.content}</div>
			</div>
		);
	}
	if (String(metadata.intent) === "tool_diff") {
		const codeBlock = toDeepRecord(metadata.codeBlock);
		const code =
			typeof codeBlock.code === "string" ? codeBlock.code : message.content;
		return (
			<div className="space-y-2">
				<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
					<span className="rounded-[var(--radius-sm)] border border-border bg-muted px-1.5 py-0.5 text-card-foreground">
						{t("timeline.codeChange")}
					</span>
					{metadata.toolName ? <span>{String(metadata.toolName)}</span> : null}
				</div>
				<NightWorkersCodeBlock
					code={code}
					filename={
						typeof codeBlock.filename === "string"
							? codeBlock.filename
							: "tool-output.diff"
					}
					language={
						typeof codeBlock.language === "string" ? codeBlock.language : "diff"
					}
				/>
			</div>
		);
	}
	if (
		message.messageType === "markdown_document" &&
		(metadata?.appBlueprint || metadata?.mockBlueprint || metadata?.artifactRef)
	) {
		const appBlueprint = toDeepRecord(
			metadata.appBlueprint || metadata.mockBlueprint,
		);
		const display = toDeepRecord(metadata.display);
		const validation = toDeepRecord(metadata.validation);
		const artifactRef = toDeepRecord(metadata.artifactRef);
		const issueCount = Array.isArray(validation?.issues)
			? validation.issues.length
			: 0;
		const title = String(
			appBlueprint.name ||
				display.title ||
				metadata.title ||
				t("timeline.appBlueprintFallback"),
		);
		return (
			<div className="nightworkers-artifact-message space-y-3">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="nightworkers-artifact-kicker text-xs font-semibold uppercase text-cyan-200">
							{t("timeline.blueprintArtifact")}
						</div>
						<div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
							{title}
						</div>
						<div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
							{t("timeline.screensCount", {
								count: appBlueprint.screens?.length || 0,
							})}{" "}
							/{" "}
							{t("timeline.sectionsCount", {
								count: countBlueprintSections(appBlueprint),
							})}{" "}
							/ {t("timeline.issuesCount", { count: issueCount })}
						</div>
					</div>
					<button
						type="button"
						className="nightworkers-artifact-open-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-500/60 text-cyan-100 hover:bg-cyan-950/30"
						onClick={() =>
							onOpenArtifact({
								id: `message-${message.id}`,
								taskId: message.taskId,
								runId: message.runId || undefined,
								kind: "app_blueprint",
								title: `Blueprint: ${title || t("timeline.draftFallback")}`,
								summary: String(
									display.summary || message.content.slice(0, 160),
								),
								source:
									typeof artifactRef.artifactId === "string"
										? {
												type: "artifact_row",
												artifactId: artifactRef.artifactId,
											}
										: { type: "task_message", messageId: message.id },
								createdAt: String(message.createdAt),
								metadata,
							})
						}
						title={t("timeline.openBlueprintArtifact")}
					>
						<PanelsTopLeft className="h-4 w-4" />
					</button>
				</div>
				<p className="nightworkers-artifact-summary line-clamp-3 text-xs leading-5 text-slate-300">
					{summarizeBlueprintCard(
						appBlueprint,
						String(display.summary || message.content),
					)}
				</p>
			</div>
		);
	}
	if (
		message.messageType === "markdown_document" &&
		metadata?.componentDesign
	) {
		const componentDesign = toDeepRecord(metadata.componentDesign);
		return (
			<div className="nightworkers-artifact-message space-y-3">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="nightworkers-artifact-kicker text-xs font-semibold uppercase text-cyan-200">
							{t("timeline.componentDesignArtifact")}
						</div>
						<div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
							{String(
								componentDesign.componentName ||
									metadata.title ||
									t("timeline.componentDesignFallback"),
							)}
						</div>
						<div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
							{t("timeline.variantsCount", {
								count: componentDesign.variants?.length || 0,
							})}{" "}
							/{" "}
							{t("timeline.tokenChangesCount", {
								count: componentDesign.tokenChanges?.length || 0,
							})}
						</div>
					</div>
					<button
						type="button"
						className="nightworkers-artifact-open-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-500/60 text-cyan-100 hover:bg-cyan-950/30"
						onClick={() =>
							onOpenArtifact({
								id: `message-${message.id}`,
								taskId: message.taskId,
								runId: message.runId || undefined,
								kind: "component_design",
								title: `Component: ${
									componentDesign.componentName ||
									metadata.title ||
									t("timeline.componentDesignTitleFallback")
								}`,
								summary: message.content.slice(0, 160),
								source: { type: "task_message", messageId: message.id },
								createdAt: String(message.createdAt),
								metadata,
							})
						}
						title={t("timeline.openComponentDesignArtifact")}
					>
						<PanelsTopLeft className="h-4 w-4" />
					</button>
				</div>
				<p className="nightworkers-artifact-summary line-clamp-3 text-xs leading-5 text-slate-300">
					{String(componentDesign.summary || message.content)}
				</p>
			</div>
		);
	}
	if (message.messageType === "chart" && metadata?.chartData) {
		return (
			<div className="space-y-2">
				<div className="text-xs font-semibold text-zinc-300">
					{t("timeline.chart")}
				</div>
				<pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
					{JSON.stringify(metadata.chartData, null, 2)}
				</pre>
			</div>
		);
	}
	if (message.messageType === "browser" && metadata?.browserFrameData?.url) {
		const browserFrameData = toDeepRecord(metadata.browserFrameData);
		return (
			<div className="space-y-2">
				<div className="text-xs font-semibold text-zinc-300">
					{t("timeline.browser")}
				</div>
				<a
					className="text-cyan-300 underline"
					href={String(browserFrameData.url)}
					target="_blank"
					rel="noreferrer"
				>
					{String(browserFrameData.url)}
				</a>
			</div>
		);
	}
	if (message.messageType === "flow" && metadata?.flowData) {
		return (
			<div className="space-y-2">
				<div className="text-xs font-semibold text-zinc-300">
					{t("timeline.flow")}
				</div>
				<pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
					{JSON.stringify(metadata.flowData, null, 2)}
				</pre>
			</div>
		);
	}
	if (message.messageType === "playwright" && metadata?.playwrightResult) {
		return (
			<div className="space-y-2">
				<div className="text-xs font-semibold text-zinc-300">
					{t("timeline.playwright")}
				</div>
				<pre className="whitespace-pre-wrap break-all rounded-md bg-black/30 p-2 text-xs">
					{JSON.stringify(metadata.playwrightResult, null, 2)}
				</pre>
			</div>
		);
	}
	if (
		message.messageType === "api_contract" &&
		String(metadata.artifactKind) === "plan_mode_api_contract"
	) {
		const apiContract = toDeepRecord(
			metadata.apiContract || metadata.artifactPayload || metadata,
		);
		const openapi = toDeepRecord(apiContract.openapi);
		const paths = toDeepRecord(openapi.paths);
		const endpointCount = Object.values(paths).reduce((total, methods) => {
			const methodRecord = toDeepRecord(methods);
			return (
				total +
				Object.keys(methodRecord).filter((method) =>
					["get", "post", "put", "patch", "delete", "options", "head"].includes(
						method.toLowerCase(),
					),
				).length
			);
		}, 0);
		const title = String(apiContract.title || metadata.title || "API Contract");
		const summary = String(apiContract.summary || "");
		return (
			<div className="nightworkers-artifact-message space-y-3">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="nightworkers-artifact-kicker text-xs font-semibold uppercase text-cyan-200">
							API Contract
						</div>
						<div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
							{title}
						</div>
						<div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
							OpenAPI 3.1 / {endpointCount} endpoints
						</div>
					</div>
					<button
						type="button"
						className="nightworkers-artifact-open-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-500/60 text-cyan-100 hover:bg-cyan-950/30"
						onClick={() =>
							onOpenArtifact({
								id: `plan-mode-workspace-${message.taskId}`,
								taskId: message.taskId,
								runId: message.runId || undefined,
								kind: "plan_mode_workspace",
								title: `Plan Mode Workspace: ${title}`,
								summary,
								source: { type: "task_message", messageId: message.id },
								createdAt: String(message.createdAt),
								metadata: {
									...metadata,
									initialTab: "api-io-contract",
								},
							})
						}
						title="Open API Contract"
					>
						<PanelsTopLeft className="h-4 w-4" />
					</button>
				</div>
				{summary ? (
					<p className="nightworkers-artifact-summary line-clamp-3 text-xs leading-5 text-slate-300">
						{summary}
					</p>
				) : null}
			</div>
		);
	}
	if (
		message.messageType === "zod_schema" &&
		String(metadata.artifactKind) === "plan_mode_zod_schema"
	) {
		const zodSchema = toDeepRecord(
			metadata.zodSchema || metadata.artifactPayload || metadata,
		);
		const title = String(zodSchema.title || metadata.title || "Zod Schema");
		const summary = String(zodSchema.summary || "");
		const fields = Array.isArray(zodSchema.fields) ? zodSchema.fields : [];
		return (
			<div className="nightworkers-artifact-message space-y-3">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="nightworkers-artifact-kicker text-xs font-semibold uppercase text-cyan-200">
							Zod Schema
						</div>
						<div className="nightworkers-artifact-title mt-1 truncate text-sm font-semibold text-slate-100">
							{title}
						</div>
						<div className="nightworkers-artifact-meta mt-1 text-xs text-slate-400">
							{String(zodSchema.schemaName || "Schema")} / {fields.length}{" "}
							fields
						</div>
					</div>
					<button
						type="button"
						className="nightworkers-artifact-open-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-500/60 text-cyan-100 hover:bg-cyan-950/30"
						onClick={() =>
							onOpenArtifact({
								id: `plan-mode-workspace-${message.taskId}`,
								taskId: message.taskId,
								runId: message.runId || undefined,
								kind: "plan_mode_workspace",
								title: `Plan Mode Workspace: ${title}`,
								summary,
								source: { type: "task_message", messageId: message.id },
								createdAt: String(message.createdAt),
								metadata: {
									...metadata,
									initialTab: "zod-schema-design",
								},
							})
						}
						title="Open Zod Schema"
					>
						<PanelsTopLeft className="h-4 w-4" />
					</button>
				</div>
				{summary ? (
					<p className="nightworkers-artifact-summary line-clamp-3 text-xs leading-5 text-slate-300">
						{summary}
					</p>
				) : null}
			</div>
		);
	}
	if (
		message.messageType === "markdown_document" &&
		metadata?.markdownDocumentData?.content
	) {
		const markdownDocumentData = toDeepRecord(metadata.markdownDocumentData);
		return (
			<ChatMarkdown
				content={String(markdownDocumentData.content)}
				onOpenProjectFile={onOpenProjectFile}
				onOpenTestModeArtifact={onOpenTestModeArtifact}
				onOpenReviewModeArtifact={onOpenReviewModeArtifact}
			/>
		);
	}
	if (message.role === "assistant") {
		return (
			<ChatMarkdown
				content={message.content}
				onOpenProjectFile={onOpenProjectFile}
				onOpenTestModeArtifact={onOpenTestModeArtifact}
				onOpenReviewModeArtifact={onOpenReviewModeArtifact}
			/>
		);
	}
	return <>{message.content}</>;
}

function summarizeBlueprintCard(blueprint: unknown, fallback: string) {
	if (!isDeepRecord(blueprint)) return fallback;
	const screens = Array.isArray(blueprint.screens) ? blueprint.screens : [];
	const sectionNames = screens
		.flatMap((screen) => {
			const screenRecord = toDeepRecord(screen);
			return Array.isArray(screenRecord.sections) ? screenRecord.sections : [];
		})
		.map((section) => {
			const sectionRecord = toDeepRecord(section);
			return String(sectionRecord.name || sectionRecord.id || "").trim();
		})
		.filter(Boolean)
		.slice(0, 4);
	const description = String(blueprint.description || "").trim();
	const details = [
		sectionNames.length > 0 ? `Sections: ${sectionNames.join(", ")}` : "",
	].filter(Boolean);
	return [description, ...details].filter(Boolean).join(" ");
}

function countBlueprintSections(blueprint: unknown) {
	const blueprintRecord = toDeepRecord(blueprint);
	const screens = Array.isArray(blueprintRecord.screens)
		? blueprintRecord.screens
		: [];
	return screens.reduce((total: number, screen) => {
		const screenRecord = toDeepRecord(screen);
		return (
			total +
			(Array.isArray(screenRecord.sections) ? screenRecord.sections.length : 0)
		);
	}, 0);
}
