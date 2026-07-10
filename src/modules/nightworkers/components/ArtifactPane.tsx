import {
	AlertTriangle,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Circle,
	Copy,
	Download,
	FlaskConical,
	FolderTree,
	GitCompare,
	LoaderCircle,
	Maximize2,
	Minimize2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../../shared/json-record";
import { TEST_MODE_WORKFLOW_ACTION } from "../../../../shared/test-mode-workflow";
import { PlanModeWorkspaceViewer } from "../../planMode";
import type { PlanWorkspaceTab } from "../../specification";
import { TodoRailList, type TodoRailListStatus } from "../../todo/TodoRailList";
import {
	logArtifactPaneRendered,
	measureArtifactPerf,
} from "../artifactPerformance";
import { startTestModeRun } from "../nightWorkersCommands";
import {
	buildTestModeWorkflowSteps,
	isTestModeWorkflowComplete,
	isTestModeWorkflowInProgress,
	isTestModeWorkflowRun,
	readTestModeWorkflowActionStatus,
	selectTestModeWorkflowSteps,
	type TestModeWorkflowStepView,
} from "../testModeWorkflowView";
import type {
	ActivityArtifact,
	GitCloseoutState,
	ProjectDiff,
	ProjectFileContent,
	ProjectFileEntry,
	Repository,
	ReviewRunOptions,
	ReviewSessionDetail,
	TaskEvent,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactContext,
	WorkbenchArtifactRef,
} from "../types";
import { DiffViewer, FileViewer, MarkdownViewer } from "./ArtifactFileViewers";
import {
	asArtifactRecord as asRecord,
	cloneTestModeWorkflowSteps,
	isMockBlueprintCandidate,
	type ProjectArtifactMode,
	parseArtifactContentJson,
	resolveArtifactWorkspaceInitialTab,
	testModeWorkflowSignature,
	useProjectArtifactRefresh,
} from "./ArtifactPane.controller";
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
	latestRunEvents?: TaskEvent[];
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
	onOpenReviewArtifact?: () => Promise<void>;
	onCommitGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	activeTaskStatus?: string | null;
	onCompleteAndArchiveTask?: (taskId: string) => Promise<unknown>;
	onRestoreArchivedTask?: (taskId: string) => Promise<unknown>;
	isImplementationLocked?: boolean;
};

type FrozenTestModeWorkflow = {
	taskId: string;
	signature: string;
	steps: TestModeWorkflowStepView[];
};

type TestModeAction =
	| "discover_tests"
	| "plan_and_implement_tests"
	| "run_unit_tests";

export function ArtifactPane({
	activeProject,
	activeSessionId,
	latestRun,
	latestRunEvents,
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
	onOpenReviewArtifact,
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
	const [frozenTestModeWorkflow, setFrozenTestModeWorkflow] =
		useState<FrozenTestModeWorkflow | null>(null);
	const [bodyRenderArtifactId, setBodyRenderArtifactId] = useState<
		string | null
	>(null);
	const [localProjectArtifactMode, setLocalProjectArtifactMode] =
		useState<ProjectArtifactMode>("tree");
	const projectArtifactMode =
		controlledProjectArtifactMode ?? localProjectArtifactMode;
	const setProjectArtifactMode = (mode: ProjectArtifactMode) => {
		if (!controlledProjectArtifactMode) setLocalProjectArtifactMode(mode);
		onProjectArtifactModeChange?.(mode);
	};
	const showProjectTree = focusType === "project_tree";
	const showProjectDiff = showProjectTree && projectArtifactMode === "diff";
	const artifactVersions = useMemo(
		() =>
			measureArtifactPerf(
				"artifactPane.buildArtifactVersions",
				() =>
					buildArtifactVersions(
						selectedArtifact,
						taskMessages,
						activityArtifacts,
					),
				{
					artifactId: selectedArtifact?.id || null,
					taskMessageCount: taskMessages.length,
					activityArtifactCount: activityArtifacts.length,
				},
			),
		[activityArtifacts, selectedArtifact, taskMessages],
	);
	useEffect(() => {
		setVersionArtifactId(selectedArtifact?.id || null);
		setIsFullscreen(false);
		setTestModeStatus(null);
	}, [selectedArtifact?.id]);
	useProjectArtifactRefresh({
		isProjectTreeVisible: showProjectTree,
		mode: projectArtifactMode,
		onRefreshFiles,
		onRefreshDiff,
	});
	const currentVersionIndex = Math.max(
		0,
		artifactVersions.findIndex(
			(artifact) => artifact.id === (versionArtifactId || selectedArtifact?.id),
		),
	);
	const displayArtifact =
		artifactVersions[currentVersionIndex] || selectedArtifact;
	const displayArtifactId = displayArtifact?.id || null;
	useEffect(() => {
		setBodyRenderArtifactId(null);
		if (!displayArtifactId) return;
		const frame = requestAnimationFrame(() => {
			setBodyRenderArtifactId(displayArtifactId);
		});
		return () => cancelAnimationFrame(frame);
	}, [displayArtifactId]);
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
	const selectedMessage = useMemo(
		() =>
			taskMessageId
				? taskMessages.find((message) => message.id === taskMessageId) || null
				: null,
		[taskMessageId, taskMessages],
	);
	const artifactRowId =
		displayArtifact?.source.type === "artifact_row"
			? displayArtifact.source.artifactId
			: null;
	const selectedActivityArtifact = useMemo(
		() =>
			artifactRowId
				? activityArtifacts.find((artifact) => artifact.id === artifactRowId) ||
					null
				: null,
		[activityArtifacts, artifactRowId],
	);
	const selectedActivityArtifactContent = useMemo(
		() =>
			measureArtifactPerf(
				"artifactPane.parseActivityArtifactContent",
				() => parseArtifactContentJson(selectedActivityArtifact?.contentText),
				{
					artifactRowId,
					contentLength: selectedActivityArtifact?.contentText?.length || 0,
				},
			),
		[artifactRowId, selectedActivityArtifact?.contentText],
	);
	const activityArtifactMetadata = useMemo(
		() =>
			measureArtifactPerf(
				"artifactPane.mergeArtifactMetadata",
				() => ({
					...asRecord(selectedActivityArtifactContent),
					...toDeepRecord(selectedActivityArtifact?.metadataJson),
					...asRecord(selectedArtifact?.metadata),
					...asRecord(displayArtifact?.metadata),
				}),
				{
					artifactId: displayArtifact?.id || selectedArtifact?.id || null,
					hasActivityArtifact: Boolean(selectedActivityArtifact),
				},
			),
		[
			displayArtifact?.id,
			displayArtifact?.metadata,
			selectedActivityArtifact,
			selectedActivityArtifactContent,
			selectedArtifact?.id,
			selectedArtifact?.metadata,
		],
	);
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
	const verificationPanel = useMemo(
		() =>
			selectedMessage && !showTestMode
				? buildVerificationPanelModel({
						message: selectedMessage,
						taskMessages,
						artifactId: displayArtifact?.id || selectedArtifact?.id || null,
					})
				: null,
		[
			displayArtifact?.id,
			selectedArtifact?.id,
			selectedMessage,
			showTestMode,
			taskMessages,
		],
	);
	const testModePanel = useMemo(
		() =>
			showTestMode
				? buildLatestVerificationPanelModel({
						taskMessages,
					})
				: null,
		[showTestMode, taskMessages],
	);
	const latestRunForTestMode = useMemo(
		() =>
			latestRun && latestRunEvents
				? { ...latestRun, events: latestRunEvents }
				: latestRun,
		[latestRun, latestRunEvents],
	);
	const liveTestModeWorkflowSteps = useMemo(
		() =>
			buildTestModeWorkflowSteps({
				latestRun: latestRunForTestMode,
				localStatus: testModeStatus,
			}),
		[latestRunForTestMode, testModeStatus],
	);
	const activeFrozenTestModeSteps =
		frozenTestModeWorkflow?.taskId === activeSessionId
			? frozenTestModeWorkflow.steps
			: null;
	const displayedTestModeWorkflowSteps = selectTestModeWorkflowSteps({
		liveSteps: liveTestModeWorkflowSteps,
		frozenSteps: activeFrozenTestModeSteps,
		latestRun: latestRunForTestMode,
	});
	useEffect(() => {
		if (!activeSessionId) return;
		if (!isTestModeWorkflowRun(latestRunForTestMode)) return;
		if (!isTestModeWorkflowComplete(liveTestModeWorkflowSteps)) return;
		const signature = testModeWorkflowSignature(liveTestModeWorkflowSteps);
		setFrozenTestModeWorkflow((current) => {
			if (
				current?.taskId === activeSessionId &&
				current.signature === signature
			) {
				return current;
			}
			return {
				taskId: activeSessionId,
				signature,
				steps: cloneTestModeWorkflowSteps(liveTestModeWorkflowSteps),
			};
		});
	}, [activeSessionId, latestRunForTestMode, liveTestModeWorkflowSteps]);
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
					? t("testMode.title")
					: showBlueprintWorkspace
						? t("thread.planModeWorkspace")
						: displayArtifact?.title || selectedArtifact.title;
	const buildCurrentExportedContent = () =>
		buildExportedArtifactContent({
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
	const shouldDeferArtifactBody =
		typeof window !== "undefined" &&
		Boolean(displayArtifact) &&
		!showProjectTree &&
		bodyRenderArtifactId !== displayArtifactId;
	useEffect(() => {
		logArtifactPaneRendered(displayArtifact, {
			activityArtifactCount: activityArtifacts.length,
			artifactVersionCount: artifactVersions.length,
			taskMessageCount: taskMessages.length,
		});
	}, [
		activityArtifacts.length,
		artifactVersions.length,
		displayArtifact,
		taskMessages.length,
	]);
	return (
		<aside className={artifactFrameClass}>
			<div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[#313244] bg-[#1e1e2e] px-3 pr-12">
				<div className="flex min-w-0 items-center gap-2 text-sm">
					<span className="truncate font-medium text-cyan-200">
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
						onCopy={() => void copyText(buildCurrentExportedContent())}
						onSave={() =>
							saveTextFile(
								buildCurrentExportedContent(),
								artifactFileName(displayArtifact),
							)
						}
						onToggleFullscreen={() => setIsFullscreen((value) => !value)}
					/>
				) : null}
			</div>
			<div className="flex min-h-0 flex-1">
				{shouldDeferArtifactBody ? (
					<div className="flex min-h-0 flex-1 items-center justify-center text-xs text-slate-500">
						{t("artifact.loading")}
					</div>
				) : showProjectTree && !showProjectDiff ? (
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
							initialTab={resolveArtifactWorkspaceInitialTab(
								displayArtifact?.metadata?.initialTab,
							)}
							latestRun={latestRunForTestMode}
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
									action: input.action,
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
							latestRun={latestRun}
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
							latestRun={latestRunForTestMode}
							workflowSteps={displayedTestModeWorkflowSteps}
							status={testModeStatus}
							canStartRun={true}
							onStart={async (action, rerun) => {
								if (
									!activeProject?.id ||
									!activeSessionId ||
									!testModePanel?.specArtifactId
								) {
									return;
								}
								setTestModeStatus(`${action}:starting`);
								const response = await startTestModeRun(activeSessionId, {
									projectId: activeProject.id,
									specArtifactId: testModePanel.specArtifactId,
									verificationDocumentId: testModePanel.verificationDocumentId,
									mode: "test",
									action,
									rerun,
								});
								setTestModeStatus(
									response.ok ? `${action}:started` : `${action}:failed`,
								);
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
									latestRun={latestRunForTestMode}
									workflowSteps={displayedTestModeWorkflowSteps}
									status={testModeStatus}
									canStartRun={true}
									onOpenReviewArtifact={onOpenReviewArtifact}
									onStart={async (action, rerun) => {
										if (
											!activeProject?.id ||
											!activeSessionId ||
											!verificationPanel.specArtifactId
										) {
											return;
										}
										setTestModeStatus(`${action}:starting`);
										const response = await startTestModeRun(activeSessionId, {
											projectId: activeProject.id,
											specArtifactId: verificationPanel.specArtifactId,
											verificationDocumentId:
												verificationPanel.verificationDocumentId,
											mode: "test",
											action,
											rerun,
										});
										if (!response.ok) {
											setTestModeStatus(`${action}:failed`);
											return;
										}
										setTestModeStatus(`${action}:started`);
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
			: "verification_json_missing",
		conditions,
	};
}

function buildLatestVerificationPanelModel(input: {
	taskMessages: TaskMessage[];
}): VerificationPanelModel | null {
	let latestPlan: TaskMessage | null = null;
	for (let index = input.taskMessages.length - 1; index >= 0; index -= 1) {
		const message = input.taskMessages[index];
		if (!message) continue;
		const metadata = toDeepRecord(message.metadataJson);
		const intent = readRecordString(metadata, "intent");
		if (
			message.messageType === "markdown_document" &&
			(intent === "implementation_plan" || intent === "feature_plan")
		) {
			latestPlan = message;
			break;
		}
	}
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
	latestRun,
	workflowSteps,
	status,
	canStartRun,
	onStart,
	onOpenReviewArtifact,
}: {
	model: VerificationPanelModel | null;
	projectId: string | null;
	taskId: string | null;
	latestRun?: TaskRun | null;
	workflowSteps: TestModeWorkflowStepView[];
	status: string | null;
	canStartRun: boolean;
	onStart: (action: TestModeAction, rerun: boolean) => Promise<void>;
	onOpenReviewArtifact?: () => Promise<void>;
}) {
	const { t } = useTranslation();
	return (
		<div className="h-full overflow-auto bg-slate-950 p-5 text-slate-100">
			<div className="mx-auto grid max-w-5xl gap-4">
				{model ? (
					<VerificationChecklistPanel
						model={model}
						projectId={projectId}
						taskId={taskId}
						latestRun={latestRun}
						workflowSteps={workflowSteps}
						status={status}
						canStartRun={canStartRun}
						onOpenReviewArtifact={onOpenReviewArtifact}
						onStart={onStart}
					/>
				) : (
					<div className="rounded-md border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400">
						{t("testMode.emptyConditions")}
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
	latestRun,
	workflowSteps,
	status,
	canStartRun,
	onStart,
	onOpenReviewArtifact,
}: {
	model: VerificationPanelModel;
	projectId: string | null;
	taskId: string | null;
	latestRun?: TaskRun | null;
	workflowSteps: TestModeWorkflowStepView[];
	status: string | null;
	canStartRun: boolean;
	onStart: (action: TestModeAction, rerun: boolean) => Promise<void>;
	onOpenReviewArtifact?: () => Promise<void>;
}) {
	const { t } = useTranslation();
	const canShowStartButton = Boolean(model.specArtifactId);
	const workflowActionStatus = readTestModeWorkflowActionStatus(status);
	const canEnterMaintenanceMode = isTestModeWorkflowComplete(workflowSteps);
	const workflowInProgress =
		workflowActionStatus === "starting" ||
		isTestModeWorkflowInProgress(workflowSteps);
	const startDisabled =
		!canStartRun ||
		!projectId ||
		!taskId ||
		!model.specArtifactId ||
		workflowInProgress;
	const checkResults = readLatestTestModeCheckResults(latestRun).filter(
		(result) => result.checkKind !== "completion_check",
	);
	const completionCheck = readLatestCompletionCheckConditionStatuses(latestRun);
	return (
		<div className="border-b border-slate-800 bg-slate-950/50 px-4 py-3">
			<div>
				{workflowActionStatus === "failed" ? (
					<div className="text-[11px] text-amber-300">
						{t("testMode.status.planFailed")}
					</div>
				) : null}
				<TestModeWorkflowProgress steps={workflowSteps} />
				{canShowStartButton ? (
					<div className="mt-2 flex flex-wrap gap-1.5">
						<TestModeActionButton
							action={TEST_MODE_WORKFLOW_ACTION}
							label={t("testMode.action.startWorkflow")}
							status={workflowActionStatus}
							disabled={startDisabled}
							onStart={onStart}
						/>
					</div>
				) : null}
				{canEnterMaintenanceMode ? (
					<TestModeMaintenanceTransition
						taskId={taskId}
						onOpenReviewArtifact={onOpenReviewArtifact}
					/>
				) : null}
				<TestModeCheckResults results={checkResults} />
			</div>
			{model.conditions.length > 0 ? (
				<div className="mt-3 grid gap-1.5">
					{model.conditions.slice(0, 5).map((condition) => {
						const displayStatus = resolveConditionDisplayStatus(
							condition,
							completionCheck,
						);
						return (
							<div
								key={condition.id}
								className="grid grid-cols-[4.5rem_1.25rem_7rem_minmax(0,1fr)] items-start gap-2 rounded-md border border-slate-800/80 bg-slate-900/35 px-2.5 py-1.5 text-xs"
							>
								<span className="font-mono leading-5 text-slate-400">
									{condition.id}
								</span>
								<span className="flex h-5 items-center">
									<TestModeConditionStatusIcon status={displayStatus} />
								</span>
								<span className="whitespace-nowrap leading-5 text-slate-400">
									{t(`testMode.conditionStatus.${displayStatus}`, {
										defaultValue: displayStatus,
									})}
								</span>
								<span className="min-w-0 whitespace-normal break-words leading-5 text-slate-100">
									{condition.text}
								</span>
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

function TestModeMaintenanceTransition({
	taskId,
	onOpenReviewArtifact,
}: {
	taskId: string | null;
	onOpenReviewArtifact?: () => Promise<void>;
}) {
	const { t } = useTranslation();
	if (!taskId) return null;
	const href = `/sessions/${encodeURIComponent(taskId)}?artifact=review_status`;
	return (
		<div className="mt-2">
			<a
				href={href}
				className="inline-flex h-8 items-center gap-2 rounded-md border border-cyan-500/45 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-500/15"
				onClick={(event) => {
					if (!onOpenReviewArtifact) return;
					event.preventDefault();
					void onOpenReviewArtifact();
				}}
			>
				<GitCompare className="h-3.5 w-3.5" />
				{t("testMode.action.enterMaintenanceMode")}
			</a>
		</div>
	);
}

function TestModeWorkflowProgress({
	steps,
}: {
	steps: TestModeWorkflowStepView[];
}) {
	const { t } = useTranslation();
	return (
		<TodoRailList
			variant="embedded"
			className="mt-3"
			items={steps.map((step, index) => ({
				id: step.id,
				seq: index + 1,
				title: t(`testMode.workflow.step.${step.id}`),
				status: toTodoRailListStatus(step.status),
				statusLabel: t(`testMode.workflow.status.${step.status}`),
				activeLabel:
					step.status === "running"
						? t(`testMode.workflow.status.${step.status}`)
						: null,
				instruction: step.todoTitle,
			}))}
		/>
	);
}

function toTodoRailListStatus(
	status: TestModeWorkflowStepView["status"],
): TodoRailListStatus {
	return status;
}

type TestModeCheckResult = {
	key: string;
	checkKind: string;
	label: string;
	status: "passed" | "failed" | "running" | "needs_action";
	summary: string;
};

type TestModeCompletionConditionStatuses = {
	ok: boolean | null;
	statuses: Map<string, string>;
};

function TestModeCheckResults({ results }: { results: TestModeCheckResult[] }) {
	if (results.length === 0) return null;
	return (
		<div className="mt-3 grid gap-2">
			{results.map((result) => (
				<div
					key={result.key}
					className="rounded-md border border-slate-800 bg-slate-900/35 px-2.5 py-2 text-xs"
				>
					<div className="flex min-w-0 items-center justify-between gap-2">
						<span className="min-w-0 whitespace-normal break-words font-medium text-slate-100">
							{result.label}
						</span>
						<span
							className={
								result.status === "passed"
									? "shrink-0 text-emerald-300"
									: result.status === "needs_action"
										? "shrink-0 text-amber-300"
										: result.status === "failed"
											? "shrink-0 text-amber-300"
											: "shrink-0 text-cyan-300"
							}
						>
							{result.status === "passed"
								? "OK"
								: result.status === "needs_action"
									? "改善点あり"
									: result.status === "failed"
										? "ERROR"
										: "RUNNING"}
						</span>
					</div>
					<div className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-400">
						{result.summary}
					</div>
				</div>
			))}
		</div>
	);
}

function readLatestTestModeCheckResults(
	latestRun?: TaskRun | null,
): TestModeCheckResult[] {
	const events = latestRun?.events ?? [];
	const results: TestModeCheckResult[] = [];
	const seen = new Set<string>();
	for (const event of [...events].reverse()) {
		const payload = asRecord(event.payloadJson);
		const runEvent = asRecord(payload.runEvent);
		const runEventData = asRecord(runEvent.data);
		const commandExecutionCheck = readCommandExecutionCheckResult(
			event,
			runEvent,
			runEventData,
		);
		if (commandExecutionCheck) {
			if (seen.has(commandExecutionCheck.key)) continue;
			seen.add(commandExecutionCheck.key);
			results.push(commandExecutionCheck);
			continue;
		}
		const rawResult = firstRecord(
			runEventData.result,
			runEventData.toolResult,
			payload.result,
			asRecord(payload.payload).result,
		);
		const parsedTextResult = parseToolTextResult(rawResult);
		const rawResultRecord = asRecord(rawResult.result);
		const structuredContent = firstRecord(
			rawResult.structuredContent,
			rawResult.structured_content,
			rawResultRecord.structuredContent,
			rawResultRecord.structured_content,
		);
		const resultPayload = firstRecord(
			parsedTextResult.payload,
			rawResult.payload,
			rawResultRecord.payload,
			asRecord(structuredContent.payload),
			rawResult.result,
			rawResult,
			asRecord(payload.payload).payload,
		);
		const toolName = readFirstString(
			runEventData.mcpTool,
			runEventData.toolName,
			parsedTextResult.toolName,
			rawResult.toolName,
			payload.toolName,
			asRecord(payload.payload).toolName,
		);
		const normalizedToolName = toolName ? normalizeToolName(toolName) : null;
		if (
			normalizedToolName !== "run_check" &&
			normalizedToolName !== "completion_check"
		)
			continue;
		const argumentsPayload = asRecord(runEventData.arguments);
		const checkKind =
			normalizedToolName === "run_check"
				? readFirstString(
						readRecordString(resultPayload, "checkKind"),
						readRecordString(argumentsPayload, "checkKind"),
					) || "other"
				: "completion_check";
		if (
			normalizedToolName === "run_check" &&
			checkKind === "other" &&
			Object.keys(resultPayload).length === 0
		) {
			continue;
		}
		const key =
			normalizedToolName === "completion_check"
				? "check:completion_check"
				: `check:${checkKind}`;
		if (seen.has(key)) continue;
		seen.add(key);
		results.push({
			key,
			checkKind,
			label: formatTestModeCheckLabel(checkKind),
			status: readCheckResultStatus(
				parsedTextResult,
				readFirstBoolean(
					parsedTextResult.ok,
					rawResult.ok,
					runEventData.ok,
					payload.ok,
				),
				readFirstString(
					readRecordString(resultPayload, "status"),
					parsedTextResult.status,
					rawResult.status,
					runEventData.status,
					payload.status,
				) || readOptionalEventStatus(event),
			),
			summary: formatTestModeCheckSummary(resultPayload, rawResult),
		});
	}
	return results.reverse();
}

function readCommandExecutionCheckResult(
	event: NonNullable<TaskRun["events"]>[number],
	runEvent: Record<string, unknown>,
	runEventData: Record<string, unknown>,
): TestModeCheckResult | null {
	const toolName = readRecordString(runEventData, "toolName");
	if (toolName !== "command_execution") return null;
	const eventType = readFirstString(
		readRecordString(runEvent, "type"),
		event.eventType,
		event.type,
	);
	if (eventType !== "tool.call_finished") return null;
	const commandClass = readRecordString(runEventData, "commandClass");
	if (
		commandClass !== "verification" &&
		commandClass !== "broad_verification"
	) {
		return null;
	}
	const command = readRecordString(runEventData, "command") || "";
	const checkKind = inferCommandExecutionCheckKind(command, commandClass);
	if (checkKind === "other") return null;
	const exitCode = readFirstNumber(runEventData.exitCode);
	const status = readCheckResultStatus(
		{},
		typeof exitCode === "number" ? exitCode === 0 : undefined,
		readFirstString(
			readRecordString(runEventData, "status"),
			readOptionalEventStatus(event),
		),
	);
	return {
		key: `check:${checkKind}`,
		checkKind,
		label: formatTestModeCheckLabel(checkKind),
		status,
		summary: formatCommandExecutionCheckSummary({
			checkKind,
			command,
			exitCode,
			output: readRecordString(runEventData, "aggregatedOutput") || "",
		}),
	};
}

function readLatestCompletionCheckConditionStatuses(
	latestRun?: TaskRun | null,
): TestModeCompletionConditionStatuses | null {
	const events = latestRun?.events ?? [];
	for (const event of [...events].reverse()) {
		const payload = asRecord(event.payloadJson);
		const runEvent = asRecord(payload.runEvent);
		const runEventData = asRecord(runEvent.data);
		const rawResult = firstRecord(
			runEventData.result,
			runEventData.toolResult,
			payload.result,
			asRecord(payload.payload).result,
		);
		const parsedTextResult = parseToolTextResult(rawResult);
		const rawResultRecord = asRecord(rawResult.result);
		const structuredContent = firstRecord(
			rawResult.structuredContent,
			rawResult.structured_content,
			rawResultRecord.structuredContent,
			rawResultRecord.structured_content,
		);
		const resultPayload = firstRecord(
			parsedTextResult.payload,
			rawResult.payload,
			rawResultRecord.payload,
			asRecord(structuredContent.payload),
			rawResult.result,
			rawResult,
			asRecord(payload.payload).payload,
		);
		const toolName = readFirstString(
			runEventData.mcpTool,
			runEventData.toolName,
			parsedTextResult.toolName,
			rawResult.toolName,
			payload.toolName,
			asRecord(payload.payload).toolName,
		);
		if (!toolName || normalizeToolName(toolName) !== "completion_check")
			continue;
		const completionResult = firstRecord(resultPayload.result, resultPayload);
		const statuses = new Map<string, string>();
		const conditions = Array.isArray(completionResult.conditions)
			? completionResult.conditions
			: [];
		for (const condition of conditions) {
			const record = asRecord(condition);
			const conditionId = readFirstString(record.conditionId, record.id);
			const status = readRecordString(record, "status");
			if (conditionId && status) statuses.set(conditionId, status);
		}
		for (const failed of readConditionList(completionResult.failedRequired)) {
			statuses.set(failed, "failed");
		}
		for (const unknown of readConditionList(completionResult.unknownRequired)) {
			if (statuses.get(unknown) !== "failed") statuses.set(unknown, "unknown");
		}
		return {
			ok:
				readFirstBoolean(
					completionResult.ok,
					parsedTextResult.ok,
					rawResult.ok,
					runEventData.ok,
					payload.ok,
				) ?? null,
			statuses,
		};
	}
	return null;
}

function readConditionList(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			const record = asRecord(entry);
			return readFirstString(record.conditionId, record.id);
		})
		.filter((conditionId): conditionId is string => Boolean(conditionId));
}

function resolveConditionDisplayStatus(
	condition: VerificationPanelModel["conditions"][number],
	completionCheck: TestModeCompletionConditionStatuses | null,
) {
	const explicitStatus = completionCheck?.statuses.get(condition.id);
	if (explicitStatus) return explicitStatus;
	if (completionCheck?.ok === true && condition.required) return "covered";
	return condition.status;
}

function readOptionalEventStatus(
	event: NonNullable<TaskRun["events"]>[number],
) {
	const status = (event as { status?: unknown }).status;
	return typeof status === "string" ? status : undefined;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
	for (const value of values) {
		const record = asRecord(value);
		if (Object.keys(record).length > 0) return record;
	}
	return {};
}

function parseToolTextResult(result: Record<string, unknown>) {
	const content = result.content;
	if (!Array.isArray(content)) return {};
	for (const item of content) {
		const record = asRecord(item);
		if (record.type !== "text" || typeof record.text !== "string") continue;
		try {
			return asRecord(JSON.parse(record.text));
		} catch {
			return {};
		}
	}
	return {};
}

function readFirstString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

function readFirstBoolean(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "boolean") return value;
	}
	return undefined;
}

function readFirstNumber(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}

function readCheckResultStatus(
	result: Record<string, unknown>,
	ok?: boolean,
	eventStatus?: string | null,
): TestModeCheckResult["status"] {
	if (result.ok === true || ok === true) return "passed";
	if (result.ok === false || ok === false) return "failed";
	if (eventStatus === "completed") return "passed";
	return eventStatus === "running" ||
		eventStatus === "started" ||
		eventStatus === "in_progress"
		? "running"
		: "failed";
}

function formatTestModeCheckLabel(checkKind: string) {
	if (checkKind === "test") return "ユニットテスト実行結果";
	if (checkKind === "verify") return "verify 実行結果";
	if (checkKind === "completion_check") return "証跡テストチェック結果";
	if (checkKind === "typecheck") return "typecheck 実行結果";
	if (checkKind === "lint") return "lint 実行結果";
	if (checkKind === "build") return "build 実行結果";
	return `${checkKind} 実行結果`;
}

function formatTestModeCheckSummary(
	payload: Record<string, unknown>,
	result: Record<string, unknown>,
) {
	const llmSummary = readRecordString(payload, "llmSummary");
	if (llmSummary) return llmSummary;
	const exitCode = payload.exitCode;
	if (typeof exitCode === "number") return `exitCode=${exitCode}`;
	const completionResult = asRecord(payload.result);
	const reason = readRecordString(completionResult, "reason");
	if (reason) return reason;
	const error = asRecord(result.error);
	const errorMessage = readRecordString(error, "message");
	return errorMessage || "結果の要約がありません。";
}

function formatCommandExecutionCheckSummary(input: {
	checkKind: string;
	command: string;
	exitCode?: number;
	output: string;
}) {
	const lines = [
		input.exitCode === 0 ? `OK ${input.checkKind}` : `ERROR ${input.checkKind}`,
		typeof input.exitCode === "number" ? `exitCode=${input.exitCode}` : null,
		input.command ? `command=${input.command}` : null,
		...input.output
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean)
			.slice(0, 8),
	];
	return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function inferCommandExecutionCheckKind(
	command: string,
	commandClass?: string | null,
) {
	if (commandClass === "broad_verification") return "verify";
	const normalized = command.toLowerCase();
	if (/\b(?:typecheck|tsc)\b/.test(normalized)) return "typecheck";
	if (/\b(?:lint|eslint)\b/.test(normalized)) return "lint";
	if (/\b(?:format|biome\s+check)\b/.test(normalized)) return "format_check";
	if (/\bcoverage\b/.test(normalized)) return "coverage";
	if (/\bbuild\b/.test(normalized)) return "build";
	if (/\b(?:test|vitest|jest|playwright)\b/.test(normalized)) return "test";
	return "other";
}

function normalizeToolName(toolName: string) {
	return toolName.startsWith("nightworkers.")
		? toolName.slice("nightworkers.".length)
		: toolName;
}

function TestModeConditionStatusIcon({ status }: { status: string }) {
	if (isCompleteConditionStatus(status)) {
		return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />;
	}
	if (status === "failed" || status === "missing") {
		return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />;
	}
	if (status === "running") {
		return (
			<LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
		);
	}
	return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
}

function isCompleteConditionStatus(status: string) {
	return (
		status === "covered" ||
		status === "passed" ||
		status === "verified_by_gate" ||
		status === "manual" ||
		status === "not_applicable" ||
		status === "completed" ||
		status === "done"
	);
}

function TestModeActionButton({
	action,
	label,
	status,
	disabled,
	onStart,
}: {
	action: TestModeAction;
	label: string;
	status: string | null;
	disabled: boolean;
	onStart: (action: TestModeAction, rerun: boolean) => Promise<void>;
}) {
	const { t } = useTranslation();
	const isDisabled = disabled || status === "starting";
	return (
		<button
			type="button"
			className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
			disabled={isDisabled}
			onClick={() => void onStart(action, false)}
			title={label}
		>
			<FlaskConical className="h-3.5 w-3.5" />
			{status === "starting" ? t("testMode.status.starting") : label}
		</button>
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
