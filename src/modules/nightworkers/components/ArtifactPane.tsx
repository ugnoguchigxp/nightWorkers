import {
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	FlaskConical,
	FolderTree,
	GitCompare,
	Maximize2,
	Minimize2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../../shared/json-record";
import { PlanModeWorkspaceViewer } from "../../planMode";
import type { PlanWorkspaceTab } from "../../specification";
import { startTestModeRun } from "../nightWorkersCommands";
import type {
	ActivityArtifact,
	GitCloseoutState,
	ProjectDiff,
	ProjectFileContent,
	ProjectFileEntry,
	Repository,
	ReviewRunOptions,
	ReviewSessionDetail,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactContext,
	WorkbenchArtifactRef,
} from "../types";
import { DiffViewer, FileViewer, MarkdownViewer } from "./ArtifactFileViewers";
import {
	BlueprintViewer,
	ComponentDesignViewer,
	FilesOutline,
	ProjectDiffContent,
} from "./ArtifactPaneContentViewers";
import {
	artifactFileName,
	buildArtifactVersions,
	buildExportedArtifactContent,
	copyText,
	saveTextFile,
} from "./ArtifactPaneVersions";
import { ReviewStatusViewer } from "./ReviewStatusViewer";

type ArtifactPaneProps = {
	activeProject: Repository | null;
	activeSessionId: string | null;
	latestRun?: TaskRun;
	focusType: "project_tree" | "artifact";
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
	projectArtifactMode?: ProjectArtifactMode;
	onProjectArtifactModeChange?: (mode: ProjectArtifactMode) => void;
	onPlanWorkspaceTabChange?: (tab: PlanWorkspaceTab) => void;
	onPlanWorkspaceArtifactContextChange?: (
		context: WorkbenchArtifactContext | null,
	) => void;
	onToggleDirectory: (path: string) => Promise<void>;
	onOpenFile: (path: string) => void;
	onRefreshFiles: () => Promise<void>;
	onRefreshDiff: () => Promise<void>;
	onQueueSession?: () => Promise<void>;
	onAddToQueue?: () => Promise<void>;
	activeReviewSession?: ReviewSessionDetail | null;
	gitCloseout?: GitCloseoutState | null;
	onStartReviewRun?: (
		reviewSessionId: string,
		options: Partial<ReviewRunOptions>,
	) => Promise<ReviewSessionDetail>;
	onCommitGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	activeTaskStatus?: string | null;
	onCompleteAndArchiveTask?: (taskId: string) => Promise<unknown>;
	onRestoreArchivedTask?: (taskId: string) => Promise<unknown>;
	isImplementationLocked?: boolean;
};

type ProjectArtifactMode = "tree" | "diff";

function workspaceInitialTab(value: unknown): PlanWorkspaceTab | undefined {
	if (value === "design-doc" || value === "specification")
		return "feature-plan";
	if (value === "specification-status") return "status";
	if (value === "blueprints") return "blueprint";
	if (value === "db-design") return "data-model";
	return value === "feature-plan" ||
		value === "blueprint" ||
		value === "data-model" ||
		value === "user-flow" ||
		value === "api-io-contract" ||
		value === "activity-flow" ||
		value === "sequence-flow" ||
		value === "zod-schema-design" ||
		value === "questionnaire" ||
		value === "status"
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
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function isMockBlueprintCandidate(value: unknown) {
	return asRecord(value).artifactKind === "mock_blueprint";
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
	projectArtifactMode: controlledProjectArtifactMode,
	onProjectArtifactModeChange,
	onPlanWorkspaceTabChange,
	onPlanWorkspaceArtifactContextChange,
	onToggleDirectory,
	onOpenFile,
	onRefreshFiles,
	onRefreshDiff,
	onQueueSession,
	onAddToQueue,
	activeReviewSession,
	gitCloseout,
	onStartReviewRun,
	onCommitGitCloseout,
	activeTaskStatus,
	onCompleteAndArchiveTask,
	onRestoreArchivedTask,
	isImplementationLocked = false,
}: ArtifactPaneProps) {
	const { t } = useTranslation();
	const [versionArtifactId, setVersionArtifactId] = useState<string | null>(
		null,
	);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [testModeStatus, setTestModeStatus] = useState<string | null>(null);
	const [localProjectArtifactMode, setLocalProjectArtifactMode] =
		useState<ProjectArtifactMode>("tree");
	const projectArtifactMode =
		controlledProjectArtifactMode ?? localProjectArtifactMode;
	const setProjectArtifactMode = (mode: ProjectArtifactMode) => {
		if (!controlledProjectArtifactMode) setLocalProjectArtifactMode(mode);
		onProjectArtifactModeChange?.(mode);
	};
	const refreshProjectFilesRef = useRef(onRefreshFiles);
	const refreshProjectDiffRef = useRef(onRefreshDiff);
	const showProjectTree = focusType === "project_tree";
	const showProjectDiff = showProjectTree && projectArtifactMode === "diff";
	const artifactVersions = useMemo(
		() =>
			buildArtifactVersions(selectedArtifact, taskMessages, activityArtifacts),
		[activityArtifacts, selectedArtifact, taskMessages],
	);
	useEffect(() => {
		setVersionArtifactId(selectedArtifact?.id || null);
		setIsFullscreen(false);
		setTestModeStatus(null);
	}, [selectedArtifact?.id]);
	useEffect(() => {
		refreshProjectFilesRef.current = onRefreshFiles;
	}, [onRefreshFiles]);
	useEffect(() => {
		refreshProjectDiffRef.current = onRefreshDiff;
	}, [onRefreshDiff]);
	useEffect(() => {
		if (!showProjectTree) return;
		const refreshCurrentProjectArtifact = () => {
			if (document.visibilityState === "hidden") return;
			if (projectArtifactMode === "diff") {
				void refreshProjectDiffRef.current();
				return;
			}
			void refreshProjectFilesRef.current();
		};
		refreshCurrentProjectArtifact();
		window.addEventListener("focus", refreshCurrentProjectArtifact);
		document.addEventListener(
			"visibilitychange",
			refreshCurrentProjectArtifact,
		);
		return () => {
			window.removeEventListener("focus", refreshCurrentProjectArtifact);
			document.removeEventListener(
				"visibilitychange",
				refreshCurrentProjectArtifact,
			);
		};
	}, [projectArtifactMode, showProjectTree]);
	const currentVersionIndex = Math.max(
		0,
		artifactVersions.findIndex(
			(artifact) => artifact.id === (versionArtifactId || selectedArtifact?.id),
		),
	);
	const displayArtifact =
		artifactVersions[currentVersionIndex] || selectedArtifact;
	const showDiff = displayArtifact?.kind === "diff";
	const showBlueprintWorkspace =
		displayArtifact?.kind === "plan_mode_workspace";
	const showReviewStatus = displayArtifact?.kind === "review_status";
	const showTestMode = displayArtifact?.kind === "test_mode";
	const showBlueprint = displayArtifact?.kind === "app_blueprint";
	const showComponentDesign =
		displayArtifact?.kind === "component_design" ||
		displayArtifact?.kind === "design_delta";
	const taskMessageId =
		displayArtifact?.source.type === "task_message"
			? displayArtifact.source.messageId
			: null;
	const selectedMessage = taskMessageId
		? taskMessages.find((message) => message.id === taskMessageId) || null
		: null;
	const artifactRowId =
		displayArtifact?.source.type === "artifact_row"
			? displayArtifact.source.artifactId
			: null;
	const selectedActivityArtifact = artifactRowId
		? activityArtifacts.find((artifact) => artifact.id === artifactRowId) ||
			null
		: null;
	const selectedActivityArtifactContent = parseArtifactContentJson(
		selectedActivityArtifact?.contentText,
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
		(String(activityArtifactMetadata.schemaName || "") === "mock_blueprint" ||
		isMockBlueprintCandidate(selectedActivityArtifactContent)
			? selectedActivityArtifactContent
			: null);
	const artifactValidation = activityArtifactMetadata.validation;
	const artifactGeneration =
		activityArtifactMetadata.generation ||
		displayArtifact?.metadata?.generation ||
		null;
	const verificationPanel = buildVerificationPanelModel({
		message: selectedMessage,
		taskMessages,
		artifactId: displayArtifact?.id || selectedArtifact?.id || null,
	});
	const testModePanel = buildLatestVerificationPanelModel({
		taskMessages,
	});
	const showDocument =
		Boolean(selectedArtifact) &&
		!showDiff &&
		!showBlueprintWorkspace &&
		!showReviewStatus &&
		!showTestMode &&
		!showBlueprint &&
		!showComponentDesign &&
		Boolean(selectedMessage);
	const artifactTitle =
		showProjectTree || !selectedArtifact
			? showProjectDiff
				? t("artifact.gitDiff")
				: selectedFilePath || t("artifact.projectTree")
			: showReviewStatus
				? t("reviewStatus.title")
				: showTestMode
					? "Test Mode"
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
		? "fixed inset-3 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#1e1e2e] shadow-2xl"
		: "nightworkers-artifact-pane flex min-h-0 min-w-0 flex-col overflow-hidden";
	return (
		<aside className={artifactFrameClass}>
			<div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[#313244] bg-[#1e1e2e] px-3 pr-12">
				<div className="flex min-w-0 items-center gap-2 text-sm">
					<span className="truncate text-[#a6adc8]">
						{activeProject?.name || t("artifact.project")}
					</span>
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6c7086]" />
					<span className="truncate font-medium text-[#cdd6f4]">
						{artifactTitle}
					</span>
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
							setVersionArtifactId(
								artifactVersions[currentVersionIndex - 1]?.id || null,
							)
						}
						onNext={() =>
							setVersionArtifactId(
								artifactVersions[currentVersionIndex + 1]?.id || null,
							)
						}
						onCopy={() => void copyText(exportedContent)}
						onSave={() =>
							saveTextFile(exportedContent, artifactFileName(displayArtifact))
						}
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
							diff={projectDiff?.diff || ""}
							isLoading={
								isDiffLoading || Boolean(activeProject && !projectDiff)
							}
							onOpenProjectFile={onOpenFile}
						/>
					) : showDiff ? (
						<DiffViewer
							diff={latestRun?.diffPatch || ""}
							onOpenProjectFile={onOpenFile}
						/>
					) : showBlueprintWorkspace ? (
						<PlanModeWorkspaceViewer
							sessionId={activeSessionId}
							taskMessages={taskMessages}
							activityArtifacts={activityArtifacts}
							initialTab={workspaceInitialTab(
								displayArtifact?.metadata?.initialTab,
							)}
							onTabChange={onPlanWorkspaceTabChange}
							onArtifactContextChange={onPlanWorkspaceArtifactContextChange}
							onQueueSession={onQueueSession}
							onAddToQueue={onAddToQueue}
							onStartTestModeRun={async (input) => {
								if (!activeProject?.id || !activeSessionId) return false;
								const response = await startTestModeRun(activeSessionId, {
									projectId: activeProject.id,
									specArtifactId: input.specArtifactId,
									verificationDocumentId: input.verificationDocumentId,
									mode: "test",
								});
								return response.ok;
							}}
							isImplementationLocked={isImplementationLocked}
						/>
					) : showReviewStatus ? (
						<ReviewStatusViewer
							detail={
								activeReviewSession ||
								(displayArtifact?.metadata?.reviewSession as
									| ReviewSessionDetail
									| undefined) ||
								null
							}
							onStartReviewRun={onStartReviewRun}
							gitCloseout={gitCloseout}
							onCommitGitCloseout={onCommitGitCloseout}
							activeTaskStatus={activeTaskStatus}
							onCompleteAndArchiveTask={onCompleteAndArchiveTask}
							onRestoreArchivedTask={onRestoreArchivedTask}
						/>
					) : showTestMode ? (
						<TestModeArtifactViewer
							model={testModePanel}
							projectId={activeProject?.id || null}
							taskId={activeSessionId}
							status={testModeStatus}
							onStart={async () => {
								if (
									!activeProject?.id ||
									!activeSessionId ||
									!testModePanel?.verificationDocumentId
								) {
									return;
								}
								setTestModeStatus("starting");
								const response = await startTestModeRun(activeSessionId, {
									projectId: activeProject.id,
									specArtifactId: testModePanel.specArtifactId,
									verificationDocumentId: testModePanel.verificationDocumentId,
									mode: "test",
								});
								setTestModeStatus(response.ok ? "started" : "failed");
							}}
						/>
					) : showBlueprint ? (
						<BlueprintViewer
							sessionId={activeSessionId}
							messageId={taskMessageId}
							blueprint={
								artifactBlueprint || displayArtifact?.metadata?.appBlueprint
							}
							mockBlueprint={
								artifactMockBlueprint ||
								displayArtifact?.metadata?.mockBlueprint
							}
							validation={
								artifactValidation || displayArtifact?.metadata?.validation
							}
							generation={artifactGeneration}
							markdown={
								selectedMessage?.content ||
								selectedActivityArtifact?.contentText ||
								undefined
							}
							onOpenProjectFile={onOpenFile}
						/>
					) : showComponentDesign ? (
						<ComponentDesignViewer
							artifact={
								displayArtifact?.metadata?.componentDesign ||
								displayArtifact?.metadata?.designDelta
							}
							markdown={selectedMessage?.content}
							onOpenProjectFile={onOpenFile}
						/>
					) : showDocument ? (
						<div className="flex h-full min-h-0 flex-col">
							{verificationPanel ? (
								<VerificationChecklistPanel
									model={verificationPanel}
									projectId={activeProject?.id || null}
									taskId={activeSessionId}
									status={testModeStatus}
									onStart={async (rerun) => {
										if (
											!activeProject?.id ||
											!activeSessionId ||
											!verificationPanel.verificationDocumentId
										) {
											return;
										}
										setTestModeStatus("starting");
										const response = await startTestModeRun(activeSessionId, {
											projectId: activeProject.id,
											specArtifactId: verificationPanel.specArtifactId,
											verificationDocumentId:
												verificationPanel.verificationDocumentId,
											mode: "test",
											rerun,
										});
										if (!response.ok) {
											setTestModeStatus("failed");
											return;
										}
										setTestModeStatus("started");
									}}
								/>
							) : null}
							<div className="min-h-0 flex-1 overflow-hidden">
								<MarkdownViewer
									content={selectedMessage?.content || ""}
									onOpenProjectFile={onOpenFile}
								/>
							</div>
						</div>
					) : showProjectTree && selectedFile ? (
						<FileViewer file={selectedFile} onOpenProjectFile={onOpenFile} />
					) : showProjectTree && isFileLoading ? (
						<p className="text-xs text-slate-400">
							{t("artifact.loadingFile")}
						</p>
					) : showProjectTree ? (
						<div className="flex h-full items-center justify-center text-xs text-slate-500">
							{t("artifact.selectFileOrDiff")}
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

type VerificationPanelModel = {
	specArtifactId: string;
	verificationDocumentId: string | null;
	missingReason?: string;
	conditions: Array<{
		id: string;
		text: string;
		status: string;
		required: boolean;
	}>;
};

function buildVerificationPanelModel(input: {
	message: TaskMessage | null;
	taskMessages: TaskMessage[];
	artifactId: string | null;
}): VerificationPanelModel | null {
	if (!input.message) return null;
	const metadata = toDeepRecord(input.message.metadataJson);
	const intent = readRecordString(metadata, "intent");
	if (intent !== "feature_plan" && intent !== "implementation_plan")
		return null;
	const verificationDocumentId =
		readRecordString(metadata, "verificationDocumentId") ?? null;
	const sidecarMessageId =
		readRecordString(metadata, "verificationSidecarMessageId") ?? null;
	const sidecarMessage = sidecarMessageId
		? input.taskMessages.find((message) => message.id === sidecarMessageId) ||
			null
		: null;
	const sidecarMetadata = toDeepRecord(sidecarMessage?.metadataJson);
	const document = toDeepRecord(sidecarMetadata.verificationDocument);
	const sidecarConditions = Array.isArray(document.conditions)
		? document.conditions
				.map((condition) => toDeepRecord(condition))
				.map((condition) => ({
					id: String(condition.id || ""),
					text: String(condition.text || ""),
					status: String(condition.status || "pending"),
					required: readRecordBoolean(condition, "required") !== false,
				}))
				.filter((condition) => condition.id && condition.text)
		: [];
	const conditions =
		sidecarConditions.length > 0
			? sidecarConditions
			: extractCompletionConditionsFromMarkdown(input.message.content);
	return {
		specArtifactId:
			input.artifactId ||
			`${intent === "implementation_plan" ? "implementation-plan" : "feature-plan"}-${input.message.id}`,
		verificationDocumentId,
		missingReason: verificationDocumentId
			? undefined
			: "verification JSON is missing",
		conditions,
	};
}

function buildLatestVerificationPanelModel(input: {
	taskMessages: TaskMessage[];
}): VerificationPanelModel | null {
	const latestPlan =
		[...input.taskMessages].reverse().find((message) => {
			const metadata = toDeepRecord(message.metadataJson);
			const intent = readRecordString(metadata, "intent");
			return (
				message.messageType === "markdown_document" &&
				(intent === "implementation_plan" || intent === "feature_plan")
			);
		}) || null;
	return buildVerificationPanelModel({
		message: latestPlan,
		taskMessages: input.taskMessages,
		artifactId: latestPlan
			? `${readRecordString(toDeepRecord(latestPlan.metadataJson), "intent") === "implementation_plan" ? "implementation-plan" : "feature-plan"}-${latestPlan.id}`
			: null,
	});
}

function extractCompletionConditionsFromMarkdown(
	content: string,
): VerificationPanelModel["conditions"] {
	const lines = content.split(/\r?\n/);
	let inCompletionSection = false;
	let conditionIndex = 1;
	const usedIds = new Set<string>();
	const conditions: VerificationPanelModel["conditions"] = [];
	for (const line of lines) {
		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
		if (heading) {
			inCompletionSection =
				/完了条件|completion conditions?|acceptance criteria/i.test(
					heading[2] || "",
				);
			continue;
		}
		if (!inCompletionSection) continue;
		const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/);
		if (!bullet) continue;
		const rawText = stripMarkdownCheckbox(bullet[1] || "").trim();
		if (!rawText) continue;
		const existingId = rawText.match(/^\[?(AC-\d{3})\]?\s*[:：-]?\s*(.+)$/);
		const id =
			existingId?.[1] && !usedIds.has(existingId[1])
				? existingId[1]
				: nextConditionId(usedIds, conditionIndex);
		usedIds.add(id);
		conditionIndex += 1;
		conditions.push({
			id,
			text: (existingId?.[2] || rawText).trim(),
			status: "pending",
			required: true,
		});
	}
	return conditions;
}

function stripMarkdownCheckbox(value: string) {
	return value.replace(/^\[[xX\s]\]\s*/, "");
}

function nextConditionId(usedIds: Set<string>, startIndex: number) {
	let index = Math.max(1, startIndex);
	let id = `AC-${String(index).padStart(3, "0")}`;
	while (usedIds.has(id)) {
		index += 1;
		id = `AC-${String(index).padStart(3, "0")}`;
	}
	return id;
}

function TestModeArtifactViewer({
	model,
	projectId,
	taskId,
	status,
	onStart,
}: {
	model: VerificationPanelModel | null;
	projectId: string | null;
	taskId: string | null;
	status: string | null;
	onStart: () => Promise<void>;
}) {
	return (
		<div className="h-full overflow-auto bg-slate-950 p-5 text-slate-100">
			<div className="mx-auto grid max-w-5xl gap-4">
				<div className="border-b border-slate-800 pb-4">
					<div className="text-sm font-semibold text-slate-100">Test Mode</div>
					<div className="mt-1 text-xs text-slate-400">
						Verification Checklist から独立した Test Mode run を開始します。
					</div>
				</div>
				{model ? (
					<VerificationChecklistPanel
						model={model}
						projectId={projectId}
						taskId={taskId}
						status={status}
						onStart={async () => {
							await onStart();
						}}
					/>
				) : (
					<div className="rounded-md border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400">
						実装計画の完了条件がまだありません。
					</div>
				)}
			</div>
		</div>
	);
}

function VerificationChecklistPanel({
	model,
	projectId,
	taskId,
	status,
	onStart,
}: {
	model: VerificationPanelModel;
	projectId: string | null;
	taskId: string | null;
	status: string | null;
	onStart: (rerun: boolean) => Promise<void>;
}) {
	const disabled =
		!projectId ||
		!taskId ||
		!model.verificationDocumentId ||
		status === "starting";
	return (
		<div className="border-b border-slate-800 bg-slate-950/50 px-4 py-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="text-xs font-semibold uppercase text-slate-300">
						Verification Checklist
					</div>
					<div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
						<span>{model.conditions.length} conditions</span>
						{model.missingReason ? <span>{model.missingReason}</span> : null}
						{status === "started" ? <span>Test Mode run started</span> : null}
						{status === "failed" ? <span>Test Mode start failed</span> : null}
					</div>
				</div>
				<button
					type="button"
					className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
					disabled={disabled}
					onClick={() => void onStart(false)}
					title={model.missingReason || "Start Test Mode"}
				>
					<FlaskConical className="h-3.5 w-3.5" />
					Test Artifact
				</button>
			</div>
			{model.conditions.length > 0 ? (
				<div className="mt-3 grid gap-1.5">
					{model.conditions.slice(0, 5).map((condition) => (
						<div
							key={condition.id}
							className="grid grid-cols-[4.5rem_7rem_minmax(0,1fr)] items-center gap-2 text-xs"
						>
							<span className="font-mono text-slate-400">{condition.id}</span>
							<span className="text-slate-400">{condition.status}</span>
							<span className="truncate text-slate-200">{condition.text}</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function readRecordString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function readRecordBoolean(
	record: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
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
				aria-label={t("artifact.previousVersion")}
				title={t("artifact.previousVersion")}
			>
				<ChevronLeft className="h-3.5 w-3.5" />
			</button>
			<span className="min-w-[4.5rem] text-center text-[11px] text-slate-400">
				{t("artifact.versionLabel", {
					current: currentVersionIndex + 1,
					total: Math.max(versionCount, 1),
				})}
			</span>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
				disabled={currentVersionIndex >= versionCount - 1}
				onClick={onNext}
				aria-label={t("artifact.nextVersion")}
				title={t("artifact.nextVersion")}
			>
				<ChevronRight className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
				onClick={onCopy}
				aria-label={t("artifact.copyVersion")}
				title={t("artifact.copyVersion")}
			>
				<Copy className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
				onClick={onSave}
				aria-label={t("artifact.saveVersion")}
				title={t("artifact.saveVersion")}
			>
				<Download className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
				onClick={onToggleFullscreen}
				aria-label={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
				title={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
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
					mode === "tree"
						? "border-sky-500/80 bg-sky-500/15 text-sky-100"
						: "border-slate-700 hover:border-slate-500"
				}`}
				onClick={() => onModeChange("tree")}
				aria-label={t("artifact.showProjectTree")}
				title={t("artifact.showProjectTree")}
			>
				<FolderTree className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				className={`inline-flex h-7 w-7 items-center justify-center rounded border text-slate-300 ${
					mode === "diff"
						? "border-sky-500/80 bg-sky-500/15 text-sky-100"
						: "border-slate-700 hover:border-slate-500"
				}`}
				onClick={() => onModeChange("diff")}
				aria-label={t("artifact.showGitDiff")}
				title={t("artifact.showGitDiff")}
			>
				<GitCompare className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 text-slate-300 hover:border-slate-500"
				onClick={onToggleFullscreen}
				aria-label={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
				title={
					isFullscreen ? t("artifact.exitFullscreen") : t("artifact.fullscreen")
				}
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
