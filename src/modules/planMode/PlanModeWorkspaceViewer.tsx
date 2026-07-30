import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	DesignQuestionnaireAnswer,
	DesignQuestionnaireSession,
	TaskMessage,
} from "../nightworkers/types";
import {
	designQuestionnaireSessionsQueryKey,
	designQuestionnaireSessionsQueryOptions,
	getQuestionnaireSessionProjectionKey,
} from "../questionnaire";
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
	const { data: questionnaireSessions, refetch: refetchQuestionnaireSessions } =
		useQuery(designQuestionnaireSessionsQueryOptions(sessionId));
	const sessions = questionnaireSessions ?? [];
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
	const setSessions = useCallback(
		(update: SetStateAction<DesignQuestionnaireSession[]>) => {
			queryClient.setQueryData<DesignQuestionnaireSession[]>(
				designQuestionnaireSessionsQueryKey(sessionId),
				(previous = []) =>
					typeof update === "function" ? update(previous) : update,
			);
		},
		[queryClient, sessionId],
	);
	const activeQuestionnaireSession =
		sessions.find((session) => session.id === activeSessionId) ||
		sessions[0] ||
		null;
	const activeQuestionnaireProjectionKey = getQuestionnaireSessionProjectionKey(
		activeQuestionnaireSession,
	);
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
	const projectedQuestionnaireKeyRef = useRef<string | null>(null);
	const refreshedQuestionnaireReadyMessageIdRef = useRef<string | null>(null);
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
			const [workspaceResult, questionnaireResult] = await Promise.all([
				refetchWorkspace(),
				refetchQuestionnaireSessions(),
			]);
			const nextWorkspace = workspaceResult.data ?? null;
			const nextSessions = questionnaireResult.data ?? [];
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
		},
		[
			blueprintMessages.length,
			refetchQuestionnaireSessions,
			refetchWorkspace,
			selectActiveTab,
			sessionId,
		],
	);
	useEffect(() => {
		const selected = activeQuestionnaireSession;
		const selectionChanged = (selected?.id ?? null) !== activeSessionId;
		if (
			!selectionChanged &&
			projectedQuestionnaireKeyRef.current === activeQuestionnaireProjectionKey
		)
			return;
		projectedQuestionnaireKeyRef.current = activeQuestionnaireProjectionKey;
		if (!selected) {
			setActiveSessionId(null);
			setAnswers({});
			return;
		}
		if (selected.id !== activeSessionId) setActiveSessionId(selected.id);
		setAnswers(
			Object.fromEntries(
				selected.answers.map((item) => [item.questionId, item.answer]),
			),
		);
	}, [
		activeQuestionnaireProjectionKey,
		activeQuestionnaireSession,
		activeSessionId,
	]);
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
		questionGroups,
		answers,
		runAction,
		selectActiveTab,
		setActiveSessionId,
		setAnswers,
		setSessions,
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
			handleQuestionnaireAnswersChange={setAnswers}
			onSelectSession={(session) => {
				setActiveSessionId(session.id);
				setAnswers(
					Object.fromEntries(
						session.answers.map((item) => [item.questionId, item.answer]),
					),
				);
			}}
			questionnaireSubmissionState={questionnaireSubmissionState}
			submitAnswersForNextStep={submitAnswersForNextStep}
			answerProgress={answerProgress}
			unansweredQuestions={unansweredQuestions}
			workspace={workspace}
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
