import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlanModeWorkspaceViewer } from "../../planMode";
import { ReviewStatusViewer } from "../../review";
import type { PlanWorkspaceTab } from "../../specification";
import {
	type ArtifactExportDescriptor,
	artifactFileStem,
	buildMarkdownFromValue,
} from "../artifactExport";
import { logArtifactPaneRendered } from "../artifactPerformance";
import { startTestModeRun } from "../nightWorkersCommands";
import {
	buildTestModeWorkflowSteps,
	isTestModeWorkflowComplete,
	isTestModeWorkflowRun,
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
	cloneTestModeWorkflowSteps,
	type ProjectArtifactMode,
	resolveArtifactWorkspaceInitialTab,
	testModeWorkflowSignature,
	useProjectArtifactRefresh,
} from "./ArtifactPane.controller";
import {
	ArtifactHeaderActions,
	ProjectTreeHeaderActions,
} from "./ArtifactPaneActions";
import {
	BlueprintViewer,
	ComponentDesignViewer,
	FilesOutline,
	ProjectDiffContent,
} from "./ArtifactPaneContentViewers";
import { useArtifactPaneExportActions } from "./ArtifactPaneExportActions";
import { useArtifactPaneSelection } from "./ArtifactPaneSelection";
import {
	buildLatestVerificationPanelModel,
	buildTestModeExportMarkdown,
	buildVerificationPanelModel,
	TestModeArtifactViewer,
	VerificationChecklistPanel,
} from "./ArtifactPaneTestMode";
import { buildExportedArtifactContent } from "./ArtifactPaneVersions";

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
	const [localProjectArtifactMode, setLocalProjectArtifactMode] =
		useState<ProjectArtifactMode>("tree");
	const [planModeExportDescriptor, setPlanModeExportDescriptor] =
		useState<ArtifactExportDescriptor | null>(null);
	const [isExportingImage, setIsExportingImage] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);
	const projectArtifactMode =
		controlledProjectArtifactMode ?? localProjectArtifactMode;
	const setProjectArtifactMode = (mode: ProjectArtifactMode) => {
		if (!controlledProjectArtifactMode) setLocalProjectArtifactMode(mode);
		onProjectArtifactModeChange?.(mode);
	};
	const showProjectTree = focusType === "project_tree";
	const showProjectDiff = showProjectTree && projectArtifactMode === "diff";
	useProjectArtifactRefresh({
		isProjectTreeVisible: showProjectTree,
		mode: projectArtifactMode,
		onRefreshFiles,
		onRefreshDiff,
	});
	const selection = useArtifactPaneSelection({
		selectedArtifact,
		taskMessages,
		activityArtifacts,
		versionArtifactId,
	});
	const {
		artifactVersions,
		currentVersionIndex,
		displayArtifact,
		showDiff,
		showBlueprintWorkspace,
		showReviewStatus,
		showTestMode,
		showBlueprint,
		showComponentDesign,
		taskMessageId,
		selectedMessage,
		selectedActivityArtifact,
		artifactBlueprint,
		artifactMockBlueprint,
		artifactValidation,
		artifactGeneration,
	} = selection;
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
	const activeReviewDetail =
		activeReviewSession ||
		(displayArtifact?.metadata?.reviewSession as
			| ReviewSessionDetail
			| undefined) ||
		null;
	const isReviewSessionLoading = Boolean(
		displayArtifact?.metadata?.reviewSessionLoading,
	);
	const defaultExportedMarkdown = buildExportedArtifactContent({
		showDiff,
		latestRun,
		selectedMessage,
		selectedActivityArtifact,
		selectedFile,
		selectedArtifact: displayArtifact,
	});
	const currentExportDescriptor: ArtifactExportDescriptor =
		showBlueprintWorkspace &&
		planModeExportDescriptor &&
		planModeExportDescriptor.scopeId === activeSessionId
			? planModeExportDescriptor
			: {
					title: artifactTitle,
					fileStem: artifactFileStem(artifactTitle),
					markdown: showReviewStatus
						? buildMarkdownFromValue(artifactTitle, activeReviewDetail || {})
						: showTestMode
							? buildTestModeExportMarkdown({
									title: artifactTitle,
									model: testModePanel,
									workflowSteps: displayedTestModeWorkflowSteps,
									latestRun: latestRunForTestMode,
								})
							: defaultExportedMarkdown,
				};
	const {
		artifactCaptureRef,
		handleCopyMarkdown,
		handleDownloadMarkdown,
		handleDownloadImage,
	} = useArtifactPaneExportActions({
		descriptor: currentExportDescriptor,
		setExportError,
		setIsExportingImage,
		isExportingImage,
		translate: t,
	});
	const artifactFrameClass = isFullscreen
		? "fixed inset-3 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#1e1e2e] shadow-2xl"
		: "nightworkers-artifact-pane flex min-h-0 min-w-0 flex-col overflow-hidden";
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
		<aside
			ref={artifactCaptureRef}
			className={artifactFrameClass}
			data-artifact-export-root
		>
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
						onCopyMarkdown={() => void handleCopyMarkdown()}
						onDownloadMarkdown={handleDownloadMarkdown}
						onDownloadImage={() => void handleDownloadImage()}
						isExportingImage={isExportingImage}
						exportError={exportError}
						onToggleFullscreen={() => setIsFullscreen((value) => !value)}
					/>
				) : null}
			</div>
			<div className="flex min-h-0 flex-1" data-artifact-export-expand>
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
				<div
					className="min-w-0 flex-1 overflow-hidden bg-[#1e1e2e]"
					data-artifact-export-expand
				>
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
							onTabChange={onPlanWorkspaceTabChange}
							onArtifactContextChange={onPlanWorkspaceArtifactContextChange}
							onExportDescriptorChange={setPlanModeExportDescriptor}
							onQueueSession={onQueueSession}
							onAddToQueue={onAddToQueue}
							isImplementationLocked={isImplementationLocked}
						/>
					) : showReviewStatus ? (
						<ReviewStatusViewer
							detail={activeReviewDetail}
							loading={isReviewSessionLoading}
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
