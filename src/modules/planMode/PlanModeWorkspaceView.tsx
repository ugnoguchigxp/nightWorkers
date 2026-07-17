import type { RefObject } from "react";
import { MarkdownViewer } from "../nightworkers/components/ArtifactFileViewers";
import type {
	ActivityArtifact,
	PlanModeWorkspace,
	TaskMessage,
} from "../nightworkers/types";
import type { PlanWorkspaceTab } from "../specification";
import { PlanModeQuestionnairePanel } from "./PlanModeQuestionnairePanel";
import type { MermaidRenderFailure } from "./PlanModeWorkspacePanels";
import {
	DedicatedViewPanel,
	PlanWorkspaceStatusView,
	ViewDecisionSummary,
	WorkspaceBlueprintPreview,
	WorkspaceDataModelPanel,
} from "./PlanModeWorkspacePanels";
import { getPlanWorkspaceTabLabel } from "./PlanModeWorkspaceViewer.model";

type StatusProps = Parameters<typeof PlanWorkspaceStatusView>[0];

export function PlanModeWorkspaceView({
	visibleTabs,
	activeTab,
	selectActiveTab,
	workspaceScrollRef,
	featurePlanMessage,
	sessionId,
	activeBlueprintMessage,
	activityArtifacts,
	activeDataModelMessage,
	showQuestionnaireStartAction,
	isQuestionnaireGenerating,
	startQuestionnaire,
	busyAction,
	isImplementationLocked,
	planModeCapabilities,
	planModeDisabledReason,
	requestAdditionalQuestionnaireQuestions,
	sessions,
	activeQuestionnaireSession,
	questionGroups,
	answers,
	handleQuestionnaireAnswersChange,
	onSelectSession,
	questionnaireSubmissionState,
	missionPilotDraft,
	missionPilotSecondsRemaining,
	submitAnswersForNextStep,
	answerProgress,
	unansweredQuestions,
	workspace,
	missionPilotPlanProgress,
	activeQuestionnaireSummary,
	canGenerateDataModel,
	hasFeaturePlan,
	generalSettings,
	viewDecisions,
	onUpdateRouting,
	generatePlanModeArtifact,
	generateDedicatedViews,
	onQueueSession,
	onAddToQueue,
	runSessionAction,
	activeDedicatedView,
	activeDedicatedArtifact,
	activeDedicatedMessage,
	repairDedicatedViewAfterMermaidFailure,
	actionError,
	actionNotice,
}: {
	visibleTabs: PlanWorkspaceTab[];
	activeTab: PlanWorkspaceTab;
	selectActiveTab: (tab: PlanWorkspaceTab) => void;
	workspaceScrollRef: RefObject<HTMLDivElement | null>;
	featurePlanMessage: TaskMessage | null;
	sessionId: string | null;
	activeBlueprintMessage: TaskMessage | null;
	activityArtifacts: ActivityArtifact[];
	activeDataModelMessage: TaskMessage | null;
	showQuestionnaireStartAction: boolean;
	isQuestionnaireGenerating: boolean;
	startQuestionnaire: () => void | Promise<void>;
	busyAction: string | null;
	isImplementationLocked: boolean;
	planModeCapabilities: { questionnaire: boolean };
	planModeDisabledReason: string;
	requestAdditionalQuestionnaireQuestions: () => void | Promise<void>;
	sessions: Parameters<typeof PlanModeQuestionnairePanel>[0]["sessions"];
	activeQuestionnaireSession: Parameters<
		typeof PlanModeQuestionnairePanel
	>[0]["activeQuestionnaireSession"];
	questionGroups: Parameters<
		typeof PlanModeQuestionnairePanel
	>[0]["questionGroups"];
	answers: Parameters<typeof PlanModeQuestionnairePanel>[0]["answers"];
	handleQuestionnaireAnswersChange: Parameters<
		typeof PlanModeQuestionnairePanel
	>[0]["onAnswersChange"];
	onSelectSession: Parameters<
		typeof PlanModeQuestionnairePanel
	>[0]["onSelectSession"];
	questionnaireSubmissionState: Parameters<
		typeof PlanModeQuestionnairePanel
	>[0]["questionnaireSubmissionState"];
	missionPilotDraft: Parameters<
		typeof PlanModeQuestionnairePanel
	>[0]["missionPilotDraft"];
	missionPilotSecondsRemaining: number | null;
	submitAnswersForNextStep: () => void | Promise<void>;
	answerProgress: { answeredCount: number; totalCount: number };
	unansweredQuestions: Array<{ question?: unknown }>;
	workspace: PlanModeWorkspace | null;
	missionPilotPlanProgress: StatusProps["missionPilotPlanProgress"];
	activeQuestionnaireSummary: StatusProps["questionnaireSummary"];
	canGenerateDataModel: boolean;
	hasFeaturePlan: boolean;
	generalSettings: { planMode?: StatusProps["planModeSettings"] } | null;
	viewDecisions: StatusProps["viewDecisions"];
	onUpdateRouting: StatusProps["onUpdateRouting"];
	generatePlanModeArtifact: (
		action: "blueprint" | "data-model" | "feature-plan",
		tab: PlanWorkspaceTab,
	) => Promise<void>;
	generateDedicatedViews: (views: string[]) => Promise<void>;
	onQueueSession?: () => Promise<void>;
	onAddToQueue?: () => Promise<void>;
	runSessionAction: (action: string, fn?: () => Promise<void>) => Promise<void>;
	activeDedicatedView: string | null;
	activeDedicatedArtifact:
		| PlanModeWorkspace["dedicatedViewArtifacts"][number]
		| null;
	activeDedicatedMessage: TaskMessage | null;
	repairDedicatedViewAfterMermaidFailure: (
		failure: MermaidRenderFailure,
	) => Promise<void>;
	actionError: string | null;
	actionNotice: string | null;
}) {
	return (
		<div
			className="nightworkers-structured-artifact flex h-full min-h-0 flex-col"
			data-artifact-export-expand
		>
			<div
				className="nightworkers-structured-artifact-section shrink-0 border-b px-5 py-3"
				data-artifact-export-exclude
			>
				<div className="flex flex-wrap gap-1">
					{visibleTabs.map((id) => (
						<button
							key={id}
							type="button"
							className={`rounded border px-2 py-1 text-xs ${
								activeTab === id
									? "nightworkers-plan-workspace-tab nightworkers-plan-workspace-tab-active"
									: "nightworkers-plan-workspace-tab"
							}`}
							onClick={() => selectActiveTab(id)}
						>
							{getPlanWorkspaceTabLabel(id)}
						</button>
					))}
				</div>
			</div>
			<div
				ref={workspaceScrollRef}
				className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4"
				data-artifact-export-expand
			>
				{activeTab === "feature-plan" ? (
					<MarkdownViewer
						content={
							featurePlanMessage?.content || "仕様書 artifact はありません。"
						}
					/>
				) : activeTab === "blueprint" ? (
					<div className="grid gap-3">
						<WorkspaceBlueprintPreview
							sessionId={sessionId}
							message={activeBlueprintMessage}
							activityArtifacts={activityArtifacts}
						/>
					</div>
				) : activeTab === "data-model" ? (
					<div className="grid gap-4">
						<WorkspaceDataModelPanel
							message={activeDataModelMessage}
							empty="No Data Model artifact."
						/>
					</div>
				) : activeTab === "questionnaire" ? (
					<PlanModeQuestionnairePanel
						showQuestionnaireStartAction={showQuestionnaireStartAction}
						isQuestionnaireGenerating={isQuestionnaireGenerating}
						onStartQuestionnaire={startQuestionnaire}
						busyAction={busyAction}
						isImplementationLocked={isImplementationLocked}
						questionnaireEnabled={planModeCapabilities.questionnaire}
						activeBlueprintMessage={activeBlueprintMessage}
						planModeDisabledReason={planModeDisabledReason}
						onRequestAdditionalQuestionnaireQuestions={
							requestAdditionalQuestionnaireQuestions
						}
						sessions={sessions}
						activeQuestionnaireSession={activeQuestionnaireSession}
						onSelectSession={onSelectSession}
						questionGroups={questionGroups}
						answers={answers}
						onAnswersChange={handleQuestionnaireAnswersChange}
						questionnaireSubmissionState={questionnaireSubmissionState}
						missionPilotDraft={missionPilotDraft}
						missionPilotSecondsRemaining={missionPilotSecondsRemaining}
						onSubmitAnswers={submitAnswersForNextStep}
						answerProgress={answerProgress}
						unansweredQuestions={unansweredQuestions}
					/>
				) : activeTab === "status" ? (
					<PlanWorkspaceStatusView
						workspace={workspace}
						missionPilotPlanProgress={missionPilotPlanProgress}
						questionnaireSession={activeQuestionnaireSession}
						questionnaireSummary={activeQuestionnaireSummary}
						busyAction={busyAction}
						canGenerateDataModel={canGenerateDataModel}
						hasFeaturePlan={hasFeaturePlan}
						isImplementationLocked={isImplementationLocked}
						planModeSettings={generalSettings?.planMode}
						viewDecisions={viewDecisions || []}
						onUpdateRouting={onUpdateRouting}
						onOpenQuestionnaire={() => selectActiveTab("questionnaire")}
						onGenerateAdditionalQuestions={
							requestAdditionalQuestionnaireQuestions
						}
						onGenerateBlueprint={() =>
							generatePlanModeArtifact("blueprint", "blueprint")
						}
						onGenerateDataModel={() =>
							generatePlanModeArtifact("data-model", "data-model")
						}
						onGenerateFeaturePlan={() =>
							generatePlanModeArtifact("feature-plan", "feature-plan")
						}
						onGenerateDedicatedViews={generateDedicatedViews}
						onQueueSession={
							onQueueSession
								? () => runSessionAction("start-session", onQueueSession)
								: undefined
						}
						onAddToQueue={
							onAddToQueue
								? () => runSessionAction("add-to-queue", onAddToQueue)
								: undefined
						}
					/>
				) : activeDedicatedView ? (
					<DedicatedViewPanel
						artifact={activeDedicatedArtifact}
						message={activeDedicatedMessage}
						onMermaidRenderFailure={(failure) => {
							void repairDedicatedViewAfterMermaidFailure(failure);
						}}
					/>
				) : (
					<div className="grid gap-4">
						<ViewDecisionSummary decisions={viewDecisions || []} />
						<MarkdownViewer content="Select a Plan Mode view." />
					</div>
				)}
				{actionError ? (
					<p
						role="alert"
						className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
					>
						{actionError}
					</p>
				) : null}
				{actionNotice ? (
					<p className="mt-3 rounded border border-cyan-500/40 bg-cyan-500/10 p-3 text-xs text-cyan-100">
						{actionNotice}
					</p>
				) : null}
			</div>
		</div>
	);
}
