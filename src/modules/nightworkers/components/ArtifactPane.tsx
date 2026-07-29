import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	buildEvidenceCheckExportMarkdown,
	buildEvidenceCheckPanelModel,
	EvidenceCheckArtifactViewer,
} from "../../codingAgent";
import { PlanModeWorkspaceViewer } from "../../planMode";
import {
	ReviewStatusViewer,
	resolveReviewImplementationCompletionReport,
} from "../../review";
import type { PlanWorkspaceTab } from "../../specification";
import {
	type ArtifactExportDescriptor,
	artifactFileStem,
	buildMarkdownFromValue,
} from "../artifactExport";
import { logArtifactPaneRendered } from "../artifactPerformance";
import type {
	ActivityArtifact,
	GitCloseoutState,
	ProjectDiff,
	ProjectFileContent,
	ProjectFileEntry,
	Repository,
	ReviewSessionDetail,
	TaskEvent,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactContext,
	WorkbenchArtifactRef,
} from "../types";
import { DiffViewer, FileViewer, MarkdownViewer } from "./ArtifactFileViewers";
import {
	type ProjectArtifactMode,
	resolveArtifactWorkspaceInitialTab,
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
	onCommitGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	onPushGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	activeTaskStatus?: string | null;
	onCompleteAndArchiveTask?: (
		taskId: string,
		options?: { discardPendingCloseouts?: boolean },
	) => Promise<unknown>;
	onRestoreArchivedTask?: (taskId: string) => Promise<unknown>;
	isImplementationLocked?: boolean;
	onSubmitReviewPrompt?: (prompt: string) => Promise<boolean>;
	isReviewPromptDisabled?: boolean;
};

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
	onCommitGitCloseout,
	onPushGitCloseout,
	activeTaskStatus,
	onCompleteAndArchiveTask,
	onRestoreArchivedTask,
	isImplementationLocked = false,
	onSubmitReviewPrompt,
	isReviewPromptDisabled = false,
}: ArtifactPaneProps) {
	const { t } = useTranslation();
	const [versionArtifactId, setVersionArtifactId] = useState<string | null>(
		null,
	);
	const [isFullscreen, setIsFullscreen] = useState(false);
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
		showEvidenceCheck,
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
	const evidenceCheckPanel = useMemo(
		() =>
			buildEvidenceCheckPanelModel({
				artifact: showEvidenceCheck ? displayArtifact || null : null,
				taskMessages,
			}),
		[displayArtifact, showEvidenceCheck, taskMessages],
	);
	const showDocument =
		Boolean(selectedArtifact) &&
		!showDiff &&
		!showBlueprintWorkspace &&
		!showReviewStatus &&
		!showEvidenceCheck &&
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
				: showEvidenceCheck
					? t("evidenceCheck.title")
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
	const implementationCompletionReport = useMemo(
		() =>
			showReviewStatus
				? resolveReviewImplementationCompletionReport({
						artifact: displayArtifact || null,
						detail: activeReviewDetail,
						latestRun,
						taskMessages,
					})
				: null,
		[
			activeReviewDetail,
			displayArtifact,
			latestRun,
			showReviewStatus,
			taskMessages,
		],
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
						? buildMarkdownFromValue(artifactTitle, {
								implementationCompletionReport,
								review: activeReviewDetail,
							})
						: showEvidenceCheck
							? buildEvidenceCheckExportMarkdown({
									title: artifactTitle,
									model: evidenceCheckPanel,
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
							activeTaskId={activeSessionId}
							latestRun={latestRun}
							implementationCompletionReport={implementationCompletionReport}
							gitCloseout={gitCloseout}
							onCommitGitCloseout={onCommitGitCloseout}
							onPushGitCloseout={onPushGitCloseout}
							activeTaskStatus={activeTaskStatus}
							onCompleteAndArchiveTask={onCompleteAndArchiveTask}
							onRestoreArchivedTask={onRestoreArchivedTask}
							onSubmitReviewPrompt={onSubmitReviewPrompt}
							isReviewPromptDisabled={isReviewPromptDisabled}
						/>
					) : showEvidenceCheck ? (
						<EvidenceCheckArtifactViewer model={evidenceCheckPanel} />
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
						<MarkdownViewer
							content={selectedMessage?.content || ""}
							onOpenProjectFile={onOpenFile}
						/>
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
