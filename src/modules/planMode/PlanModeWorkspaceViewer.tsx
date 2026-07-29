import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	missionPilotPlanProgressQueryOptions,
	useMissionPilotQuestionnaireDraft,
} from "../missionPilot";
import type {
	DesignQuestionnaireAnswer,
	DesignQuestionnaireSession,
	TaskMessage,
} from "../nightworkers/types";
import { fetchDesignQuestionnaireSessions } from "../questionnaire";
import {
	getPlanModeCapabilities,
	type PlanWorkspaceTab,
	planModeWorkspaceQueryOptions,
	resolvePlanWorkspaceViewDecisions,
	selectPlanModeWorkspaceMessages,
} from "../specification";
import {
	getAnswerProgress,
	getQuestionnaireSubmissionState,
	getUnansweredQuestions,
} from "./PlanModeQuestionnaire";
import { usePlanWorkspaceActions } from "./PlanModeWorkspace.controller";
import { PlanModeWorkspaceView } from "./PlanModeWorkspaceView";
import {
	extractViewDecisions,
	isCompletedQuestionnaireSession,
	isCompletedStatus,
} from "./PlanModeWorkspaceViewer.helpers";
import {
	buildVisiblePlanWorkspaceTabs,
	correctionTargetTabs,
	resetPlanWorkspaceScrollToTop,
	resolveInitialPlanWorkspaceTabUpdate,
	resolveQuestionnaireGenerationState,
	shouldOpenQuestionnaireForEmptyBlueprint,
	shouldShowQuestionnaireStartAction,
} from "./PlanModeWorkspaceViewer.model";
import type { PlanModeWorkspaceViewerProps } from "./PlanModeWorkspaceViewer.types";
import { usePlanModeArtifactGenerationForWorkspace } from "./usePlanModeArtifactGeneration";
import { usePlanModeGeneralSettings } from "./usePlanModeGeneralSettings";
import { usePlanModeQuestionnaireActions } from "./usePlanModeQuestionnaireActions";
import { usePlanModeRoutingEditor } from "./usePlanModeRoutingEditor";
import { usePlanModeWorkspaceOutputs } from "./usePlanModeWorkspaceOutputs";

export function PlanModeWorkspaceViewer({
	sessionId,
	taskMessages,
	activityArtifacts = [],
	initialTab,
	onTabChange,
	onArtifactContextChange,
	onExportDescriptorChange,
	onQueueSession,
	onAddToQueue,
	isImplementationLocked = false,
}: PlanModeWorkspaceViewerProps) {
	const queryClient = useQueryClient();
	const { data: workspace = null, refetch: refetchWorkspace } = useQuery(
		planModeWorkspaceQueryOptions(sessionId),
	);
	const { data: missionPilotPlanProgress = null } = useQuery(
		missionPilotPlanProgressQueryOptions(sessionId),
	);
	const [sessions, setSessions] = useState<DesignQuestionnaireSession[]>([]);
	const [activeTab, setActiveTab] = useState<PlanWorkspaceTab>(
		initialTab || "questionnaire",
	);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [answers, setAnswers] = useState<
		Record<string, DesignQuestionnaireAnswer>
	>({});
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionNotice, setActionNotice] = useState<string | null>(null);
	const generalSettings = usePlanModeGeneralSettings();
	const [, setAssemblyReadySessionIds] = useState<Set<string>>(new Set());
	const [generatedMessages, setGeneratedMessages] = useState<TaskMessage[]>([]);
	const activeQuestionnaireSession =
		sessions.find((session) => session.id === activeSessionId) ||
		sessions[0] ||
		null;
	const missionPilotSubmittedHandlerRef = useRef<() => void>(() => undefined);
	const handleMissionPilotDraftSubmitted = useCallback(
		() => missionPilotSubmittedHandlerRef.current(),
		[],
	);
	const {
		draft: missionPilotDraft,
		setDraft: setMissionPilotDraft,
		draftRef: missionPilotDraftRef,
		updateQueueRef: draftUpdateQueueRef,
		secondsRemaining: missionPilotSecondsRemaining,
		updateAnswers: handleQuestionnaireAnswersChange,
		projectAnswers: projectMissionPilotAnswers,
	} = useMissionPilotQuestionnaireDraft({
		taskId: sessionId,
		questionnaireSessionId: activeQuestionnaireSession?.id ?? null,
		setQuestionnaireSessionId: setActiveSessionId,
		setAnswers,
		setError: setActionError,
		onSubmitted: handleMissionPilotDraftSubmitted,
	});
	const workspaceMessages = useMemo(
		() =>
			selectPlanModeWorkspaceMessages({
				taskMessages,
				activityArtifacts,
				generatedMessages,
				workspace,
			}),
		[activityArtifacts, generatedMessages, taskMessages, workspace],
	);
	const {
		blueprintMessages,
		designDocMessages,
		activeFeaturePlanMessage,
		activeBlueprintMessage,
		activeDataModelMessage,
		activeBlueprintSourceMessageId,
	} = workspaceMessages;
	const featurePlanMessage =
		activeFeaturePlanMessage || designDocMessages.at(-1) || null;
	const messageViewDecisions = useMemo(
		() => extractViewDecisions(taskMessages),
		[taskMessages],
	);
	const questionnaireGeneration = useMemo(
		() => resolveQuestionnaireGenerationState(taskMessages),
		[taskMessages],
	);
	const viewDecisions = useMemo(
		() => resolvePlanWorkspaceViewDecisions(workspace, messageViewDecisions),
		[messageViewDecisions, workspace],
	);
	const includedViews = useMemo(
		() =>
			new Set(
				viewDecisions
					.filter((item) => item.decision === "include")
					.map((item) => item.view),
			),
		[viewDecisions],
	);
	const planModeCapabilities = getPlanModeCapabilities(generalSettings);
	const hasFeaturePlan = Boolean(
		featurePlanMessage || workspace?.featurePlanArtifacts.length,
	);
	const hasQuestionnaire =
		sessions.length > 0 || Boolean(workspace?.questionnaireSessions.length);
	const hasBlueprint = Boolean(
		activeBlueprintMessage || workspace?.blueprintArtifacts.length,
	);
	const hasDataModel = Boolean(
		activeDataModelMessage || workspace?.dataModelArtifacts.length,
	);
	const questionnaireComplete =
		sessions.some(isCompletedQuestionnaireSession) ||
		Boolean(
			workspace?.questionnaireSessions.some((session) =>
				isCompletedStatus(session.status),
			),
		);
	const didSelectUnlockedDefaultTab = useRef(false);
	const refreshedQuestionnaireReadyMessageIdRef = useRef<string | null>(null);
	const focusedCorrectionIdRef = useRef<string | null>(null);
	const attemptedMermaidRenderRepairs = useRef(new Set<string>());
	const workspaceScrollRef = useRef<HTMLDivElement | null>(null);
	const activeTabRef = useRef(activeTab);
	const onTabChangeRef = useRef(onTabChange);
	onTabChangeRef.current = onTabChange;
	const visibleTabs = useMemo<PlanWorkspaceTab[]>(() => {
		return buildVisiblePlanWorkspaceTabs({
			hasFeaturePlan,
			hasQuestionnaire,
			hasBlueprint,
			hasDataModel,
			includedViews,
			planModeCapabilities,
			dedicatedViewArtifacts: workspace?.dedicatedViewArtifacts,
		});
	}, [
		hasBlueprint,
		hasDataModel,
		hasFeaturePlan,
		hasQuestionnaire,
		includedViews,
		planModeCapabilities,
		workspace?.dedicatedViewArtifacts,
	]);
	const selectActiveTab = useCallback((tab: PlanWorkspaceTab) => {
		if (activeTabRef.current === tab) return;
		activeTabRef.current = tab;
		setActiveTab(tab);
		onTabChangeRef.current?.(tab);
	}, []);
	const resetWorkspaceScrollTop = useCallback(() => {
		resetPlanWorkspaceScrollToTop(() => workspaceScrollRef.current, window);
	}, []);
	const refresh = useCallback(
		async (options?: { preserveGeneratedBlueprintFocus?: boolean }) => {
			if (!sessionId) return;
			const nextWorkspace = (await refetchWorkspace()).data ?? null;
			const sessionsRes = await fetchDesignQuestionnaireSessions(sessionId);
			if (sessionsRes.ok) {
				const nextSessions =
					(await sessionsRes.json()) as DesignQuestionnaireSession[];
				setSessions(nextSessions);
				if (
					shouldOpenQuestionnaireForEmptyBlueprint({
						hasQuestionnaireSessions: nextSessions.length > 0,
						hasBlueprintMessages:
							blueprintMessages.length > 0 ||
							Boolean(nextWorkspace?.blueprintArtifacts.length),
						activeTab: activeTabRef.current,
						preserveGeneratedBlueprintFocus:
							options?.preserveGeneratedBlueprintFocus,
					})
				) {
					selectActiveTab("questionnaire");
				}
				const selected =
					nextSessions.find((item) => item.id === activeSessionId) ||
					nextSessions[0];
				if (selected) {
					setActiveSessionId(selected.id);
					setAnswers(projectMissionPilotAnswers(selected));
				}
			}
		},
		[
			activeSessionId,
			blueprintMessages.length,
			refetchWorkspace,
			projectMissionPilotAnswers,
			selectActiveTab,
			sessionId,
		],
	);
	missionPilotSubmittedHandlerRef.current = () => void refresh();
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useEffect(() => {
		if (
			questionnaireGeneration.status !== "ready" ||
			refreshedQuestionnaireReadyMessageIdRef.current ===
				questionnaireGeneration.messageId
		)
			return;
		refreshedQuestionnaireReadyMessageIdRef.current =
			questionnaireGeneration.messageId;
		void refresh();
	}, [questionnaireGeneration, refresh]);
	useEffect(() => {
		const nextTab = resolveInitialPlanWorkspaceTabUpdate(initialTab);
		if (nextTab) selectActiveTab(nextTab);
	}, [initialTab, selectActiveTab]);
	useEffect(() => {
		const correction = missionPilotPlanProgress?.activeCorrection;
		if (!correction || focusedCorrectionIdRef.current === correction.id) return;
		const targetTab = correctionTargetTabs[correction.target];
		if (!visibleTabs.includes(targetTab)) return;
		focusedCorrectionIdRef.current = correction.id;
		selectActiveTab(targetTab);
	}, [
		missionPilotPlanProgress?.activeCorrection,
		selectActiveTab,
		visibleTabs,
	]);
	useEffect(() => {
		if (initialTab) return;
		if (!didSelectUnlockedDefaultTab.current && activeTab === "questionnaire") {
			didSelectUnlockedDefaultTab.current = true;
			selectActiveTab("status");
			return;
		}
		if (!visibleTabs.includes(activeTab)) selectActiveTab("status");
	}, [activeTab, initialTab, selectActiveTab, visibleTabs]);
	const activeQuestionnaireSummary =
		workspace?.questionnaireSessions.find(
			(session) => session.id === activeQuestionnaireSession?.id,
		) ||
		workspace?.questionnaireSessions[0] ||
		null;
	const questionGroups =
		activeQuestionnaireSession?.questionSets.flatMap(
			(set) => set.questionnaire?.questionSets || [],
		) || [];
	const answerProgress = getAnswerProgress(questionGroups, answers);
	const unansweredQuestions = getUnansweredQuestions(questionGroups, answers);
	const canGenerateDataModel = Boolean(sessionId);
	const readyQuestionnaireSession =
		activeQuestionnaireSession &&
		(activeQuestionnaireSession.status === "review_ready" ||
			activeQuestionnaireSession.status === "accepted")
			? activeQuestionnaireSession
			: null;
	const isActiveQuestionnaireComplete = Boolean(
		activeQuestionnaireSession &&
			isCompletedQuestionnaireSession(activeQuestionnaireSession),
	);
	const questionnaireSubmissionState = getQuestionnaireSubmissionState({
		unansweredCount: unansweredQuestions.length,
		isCompleted: isActiveQuestionnaireComplete,
		isImplementationLocked,
		isCapabilityEnabled: planModeCapabilities.questionnaire,
	});
	const showQuestionnaireStartAction =
		shouldShowQuestionnaireStartAction({
			sessionId,
			questionnaireComplete,
		}) && questionnaireGeneration.status !== "generating";

	const { runAction, runSessionAction } = usePlanWorkspaceActions({
		isImplementationLocked,
		refresh,
		selectActiveTab,
		resetWorkspaceScrollTop,
		setBusyAction,
		setActionError,
		setActionNotice,
	});
	const updateRouting = usePlanModeRoutingEditor({
		sessionId,
		routing: workspace?.routing,
		runAction,
	});
	const planModeDisabledReason =
		"Plan Mode capability is disabled in Settings.";
	const {
		startQuestionnaire,
		submitAnswersForNextStep,
		requestAdditionalQuestionnaireQuestions,
	} = usePlanModeQuestionnaireActions({
		sessionId,
		isImplementationLocked,
		questionnaireEnabled: planModeCapabilities.questionnaire,
		activeBlueprintMessage,
		activeQuestionnaireSession,
		unansweredQuestions,
		missionPilotDraft,
		missionPilotDraftRef,
		draftUpdateQueueRef,
		questionGroups,
		answers,
		runAction,
		selectActiveTab,
		refresh,
		setActiveSessionId,
		setAnswers,
		setSessions,
		setMissionPilotDraft,
		setAssemblyReadySessionIds,
		setActionNotice,
	});
	const {
		activeDedicatedView,
		activeDedicatedArtifact,
		activeDedicatedMessage,
		generatePlanModeArtifact,
		generateDedicatedViews,
		repairDedicatedViewAfterMermaidFailure,
	} = usePlanModeArtifactGenerationForWorkspace({
		activeTab,
		workspace,
		combinedTaskMessages: workspaceMessages.combinedTaskMessages,
		sessionId,
		isImplementationLocked,
		planModeCapabilities,
		activeQuestionnaireSummary,
		readyQuestionnaireSession,
		featurePlanMessage,
		activeBlueprintSourceMessageId,
		activeDataModelMessage,
		attemptedMermaidRenderRepairs,
		queryClient,
		setGeneratedMessages,
		runAction,
		selectActiveTab,
	});

	usePlanModeWorkspaceOutputs({
		sessionId,
		activeTab,
		featurePlanMessage,
		activeBlueprintMessage,
		activeBlueprintSourceMessageId,
		activeDataModelMessage,
		activeDedicatedMessage,
		activeDedicatedArtifact,
		readyQuestionnaireSessionId: readyQuestionnaireSession?.id ?? null,
		workspace,
		viewDecisions: viewDecisions || [],
		activeQuestionnaireSession,
		onArtifactContextChange,
		onExportDescriptorChange,
	});

	return (
		<PlanModeWorkspaceView
			visibleTabs={visibleTabs}
			activeTab={activeTab}
			selectActiveTab={selectActiveTab}
			workspaceScrollRef={workspaceScrollRef}
			featurePlanMessage={featurePlanMessage}
			sessionId={sessionId}
			activeBlueprintMessage={activeBlueprintMessage}
			activityArtifacts={activityArtifacts}
			activeDataModelMessage={activeDataModelMessage}
			showQuestionnaireStartAction={showQuestionnaireStartAction}
			isQuestionnaireGenerating={
				questionnaireGeneration.status === "generating"
			}
			startQuestionnaire={startQuestionnaire}
			busyAction={busyAction}
			isImplementationLocked={isImplementationLocked}
			planModeCapabilities={planModeCapabilities}
			planModeDisabledReason={planModeDisabledReason}
			requestAdditionalQuestionnaireQuestions={
				requestAdditionalQuestionnaireQuestions
			}
			sessions={sessions}
			activeQuestionnaireSession={activeQuestionnaireSession}
			questionGroups={questionGroups}
			answers={answers}
			handleQuestionnaireAnswersChange={handleQuestionnaireAnswersChange}
			onSelectSession={(session) => {
				setActiveSessionId(session.id);
				setAnswers(
					Object.fromEntries(
						session.answers.map((item) => [item.questionId, item.answer]),
					),
				);
			}}
			questionnaireSubmissionState={questionnaireSubmissionState}
			missionPilotDraft={missionPilotDraft}
			missionPilotSecondsRemaining={missionPilotSecondsRemaining}
			submitAnswersForNextStep={submitAnswersForNextStep}
			answerProgress={answerProgress}
			unansweredQuestions={unansweredQuestions}
			workspace={workspace}
			missionPilotPlanProgress={missionPilotPlanProgress}
			activeQuestionnaireSummary={activeQuestionnaireSummary}
			canGenerateDataModel={canGenerateDataModel}
			hasFeaturePlan={hasFeaturePlan}
			generalSettings={generalSettings}
			viewDecisions={viewDecisions}
			onUpdateRouting={updateRouting}
			generatePlanModeArtifact={generatePlanModeArtifact}
			generateDedicatedViews={generateDedicatedViews}
			onQueueSession={onQueueSession}
			onAddToQueue={onAddToQueue}
			runSessionAction={runSessionAction}
			activeDedicatedView={activeDedicatedView}
			activeDedicatedArtifact={activeDedicatedArtifact}
			activeDedicatedMessage={activeDedicatedMessage}
			repairDedicatedViewAfterMermaidFailure={
				repairDedicatedViewAfterMermaidFailure
			}
			actionError={actionError}
			actionNotice={actionNotice}
		/>
	);
}
