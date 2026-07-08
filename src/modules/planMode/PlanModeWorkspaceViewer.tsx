import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	FlaskConical,
	LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../shared/json-record";
import type { PlanModeRegenerationTarget } from "../../../shared/schemas/plan-mode-artifact.schema";
import { TEST_MODE_WORKFLOW_ACTION } from "../../../shared/test-mode-workflow";
import { generateBlueprintArtifact } from "../blueprint";
import { generateDataModelArtifact } from "../dataModel";
import { MarkdownViewer } from "../nightworkers/components/ArtifactFileViewers";
import {
	buildTestModeWorkflowSteps,
	isTestModeWorkflowInProgress,
	readTestModeWorkflowActionStatus,
	type TestModeWorkflowStepStatus,
	type TestModeWorkflowStepView,
} from "../nightworkers/testModeWorkflowView";
import type {
	ActivityArtifact,
	DesignQuestionnaireAnswer,
	DesignQuestionnaireSession,
	GeneralSettings,
	PlanModeWorkspace,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactContext,
} from "../nightworkers/types";
import {
	fetchDesignQuestionnaireSessions,
	generateAdditionalDesignQuestionnaireQuestions,
	startDesignQuestionnaire,
	submitDesignQuestionnaireAnswers,
} from "../questionnaire";
import { fetchGeneralSettings } from "../settings";
import {
	fetchPlanModeWorkspace,
	generateFeaturePlanArtifact,
	getPlanModeCapabilities,
	type PlanWorkspaceTab,
	resolvePlanWorkspaceViewDecisions,
	selectPlanModeWorkspaceMessages,
} from "../specification";
import {
	ActionButton,
	buildSubmittableQuestionnaireAnswers,
	getAnswerProgress,
	getQuestionCount,
	getQuestionnaireSubmissionState,
	getUnansweredQuestions,
	QuestionnaireForm,
} from "./PlanModeQuestionnaire";
import {
	DedicatedViewPanel,
	type PlanViewDecision,
	PlanWorkspaceStatusView,
	ViewDecisionSummary,
	WorkspaceBlueprintPreview,
	WorkspaceDataModelPanel,
} from "./PlanModeWorkspacePanels";
import {
	type GenericPlanView,
	generatePlanViewArtifact,
} from "./planViewCommands";

type TestModeAction =
	| "discover_tests"
	| "plan_and_implement_tests"
	| "run_unit_tests";

const additionalPlanViewTabs = [
	"user-flow",
	"api-io-contract",
	"activity-flow",
	"sequence-flow",
	"zod-schema-design",
] as const;

const tabToPlanView = {
	"user-flow": "user_flow",
	"api-io-contract": "api_io_contract",
	"activity-flow": "activity_flow",
	"sequence-flow": "sequence_flow",
	"zod-schema-design": "zod_schema_design",
} as const;

const tabLabels: Record<PlanWorkspaceTab, string> = {
	"feature-plan": "spec",
	status: "Status",
	questionnaire: "Questionnaire",
	blueprint: "Blueprint",
	"data-model": "Data Model",
	"user-flow": "User Flow",
	"api-io-contract": "API Contract",
	"activity-flow": "Activity",
	"sequence-flow": "Sequence",
	"zod-schema-design": "Zod",
};

const planWorkspaceRegenerationTargets = {
	"feature-plan": "feature_plan",
	blueprint: "blueprint",
	"data-model": "data_model",
	"user-flow": "user_flow",
	"api-io-contract": "api_io_contract",
	"activity-flow": "activity_flow",
	"sequence-flow": "sequence_flow",
	"zod-schema-design": "zod_schema_design",
} as const satisfies Record<string, PlanModeRegenerationTarget>;

type PlanWorkspaceRegenerationTab =
	keyof typeof planWorkspaceRegenerationTargets;

const planWorkspaceTargetLabels: Record<PlanModeRegenerationTarget, string> = {
	feature_plan: "Feature Plan",
	blueprint: "Blueprint",
	data_model: "Data Model",
	user_flow: "User Flow",
	api_io_contract: "API Contract",
	activity_flow: "Activity",
	sequence_flow: "Sequence",
	zod_schema_design: "Zod Schema",
};

function isPlanWorkspaceRegenerationTab(
	tab: PlanWorkspaceTab,
): tab is PlanWorkspaceRegenerationTab {
	return Object.hasOwn(planWorkspaceRegenerationTargets, tab);
}

function planWorkspaceDisplayKind(target: string) {
	return `PLAN_MODE:${target.toUpperCase()}`;
}

export function buildPlanModeArtifactContext(input: {
	sessionId: string | null;
	activeTab: PlanWorkspaceTab;
	featurePlanMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeBlueprintMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeBlueprintSourceMessageId?: string | null;
	activeDataModelMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeDedicatedMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeDedicatedArtifact?: Pick<
		PlanModeWorkspace["dedicatedViewArtifacts"][number],
		"sourceMessageId"
	> | null;
	readyQuestionnaireSessionId?: string | null;
}): WorkbenchArtifactContext | null {
	if (!input.sessionId || !isPlanWorkspaceRegenerationTab(input.activeTab))
		return null;
	const target = planWorkspaceRegenerationTargets[input.activeTab];
	const sourceMessageId =
		target === "feature_plan"
			? input.featurePlanMessage?.id || ""
			: target === "blueprint"
				? input.activeBlueprintSourceMessageId ||
					input.activeBlueprintMessage?.id ||
					""
				: target === "data_model"
					? input.activeDataModelMessage?.id || ""
					: input.activeDedicatedMessage?.id ||
						input.activeDedicatedArtifact?.sourceMessageId ||
						"";
	const summary =
		target === "feature_plan"
			? input.featurePlanMessage?.content.slice(0, 160)
			: target === "blueprint"
				? input.activeBlueprintMessage?.content.slice(0, 160)
				: target === "data_model"
					? input.activeDataModelMessage?.content.slice(0, 160)
					: input.activeDedicatedMessage?.content.slice(0, 160);
	return {
		artifactId: `plan-mode-workspace-${input.sessionId}:${target}`,
		kind: "plan_mode_workspace",
		title: planWorkspaceTargetLabels[target],
		summary,
		source: { type: "task_message", messageId: sourceMessageId },
		metadata: {
			intent: "plan_mode_artifact_regeneration",
			artifactType: target,
			initialTab: input.activeTab,
			instructionMode: "regenerate_artifact",
			planModeTarget: target,
			displayKind: planWorkspaceDisplayKind(target),
			questionnaireSessionId: input.readyQuestionnaireSessionId ?? null,
			featurePlanMessageId: input.featurePlanMessage?.id ?? null,
			sourceBlueprintMessageId:
				input.activeBlueprintSourceMessageId ||
				input.activeBlueprintMessage?.id ||
				null,
			sourceDataModelMessageId: input.activeDataModelMessage?.id ?? null,
		},
	};
}

export function getPlanWorkspaceTabLabel(tab: PlanWorkspaceTab) {
	return tabLabels[tab];
}

export function shouldShowQuestionnaireStartAction(input: {
	sessionId: string | null;
	questionnaireComplete: boolean;
}) {
	return Boolean(input.sessionId) && !input.questionnaireComplete;
}

export function resolveInitialPlanWorkspaceTabUpdate(
	initialTab: PlanWorkspaceTab | undefined,
	questionnaireGateLocked: boolean,
): PlanWorkspaceTab | null {
	if (!initialTab) return null;
	if (questionnaireGateLocked) return "questionnaire";
	return initialTab === "questionnaire" ? null : initialTab;
}

export function shouldOpenQuestionnaireForEmptyBlueprint(input: {
	hasQuestionnaireSessions: boolean;
	hasBlueprintMessages: boolean;
	activeTab: PlanWorkspaceTab;
	preserveGeneratedBlueprintFocus?: boolean;
}) {
	return (
		input.hasQuestionnaireSessions &&
		!input.hasBlueprintMessages &&
		input.activeTab === "blueprint" &&
		!input.preserveGeneratedBlueprintFocus
	);
}

type PlanWorkspaceScrollContainer = {
	scrollTop: number;
	scrollTo?: (options: ScrollToOptions) => void;
};
type PlanWorkspaceScrollScheduler = {
	requestAnimationFrame?: (callback: () => void) => unknown;
};

export function scrollPlanWorkspaceToTop(
	element: PlanWorkspaceScrollContainer | null,
) {
	if (!element) return;
	if (typeof element.scrollTo === "function") {
		element.scrollTo({ top: 0, left: 0, behavior: "auto" });
		return;
	}
	element.scrollTop = 0;
}

export function resetPlanWorkspaceScrollToTop(
	getElement: () => PlanWorkspaceScrollContainer | null,
	scheduler?: PlanWorkspaceScrollScheduler,
) {
	const reset = () => scrollPlanWorkspaceToTop(getElement());
	if (typeof scheduler?.requestAnimationFrame === "function") {
		scheduler.requestAnimationFrame(reset);
		return;
	}
	reset();
}

type PlanModeCapabilities = ReturnType<typeof getPlanModeCapabilities>;
type PlanWorkspaceActionResult =
	| { focusTab?: PlanWorkspaceTab | null }
	| undefined;

export function buildVisiblePlanWorkspaceTabs(input: {
	questionnaireGateLocked: boolean;
	hasFeaturePlan: boolean;
	hasQuestionnaire: boolean;
	hasBlueprint: boolean;
	hasDataModel: boolean;
	includedViews: ReadonlySet<string>;
	planModeCapabilities: PlanModeCapabilities;
	dedicatedViewArtifacts:
		| PlanModeWorkspace["dedicatedViewArtifacts"]
		| undefined;
}): PlanWorkspaceTab[] {
	if (input.questionnaireGateLocked) return ["questionnaire"];
	const additionalTabs = additionalPlanViewTabs.filter((tab) => {
		const view = tabToPlanView[tab];
		return input.dedicatedViewArtifacts?.some(
			(artifact) => artifact.kind === view,
		);
	});
	return [
		"status",
		...(input.hasFeaturePlan ? (["feature-plan"] as const) : []),
		...(input.planModeCapabilities.questionnaire && input.hasQuestionnaire
			? (["questionnaire"] as const)
			: []),
		...(input.hasBlueprint ? (["blueprint"] as const) : []),
		...(input.hasDataModel ? (["data-model"] as const) : []),
		...additionalTabs,
	];
}

export function PlanModeWorkspaceViewer({
	sessionId,
	taskMessages,
	activityArtifacts = [],
	initialTab,
	onTabChange,
	onArtifactContextChange,
	onQueueSession,
	onAddToQueue,
	onStartTestModeRun,
	latestRun,
	isImplementationLocked = false,
}: {
	sessionId: string | null;
	taskMessages: TaskMessage[];
	activityArtifacts?: ActivityArtifact[];
	initialTab?: PlanWorkspaceTab;
	onTabChange?: (tab: PlanWorkspaceTab) => void;
	onArtifactContextChange?: (context: WorkbenchArtifactContext | null) => void;
	onQueueSession?: () => Promise<void>;
	onAddToQueue?: () => Promise<void>;
	onStartTestModeRun?: (input: {
		specArtifactId: string;
		verificationDocumentId?: string | null;
		action: TestModeAction;
	}) => Promise<boolean>;
	latestRun?: TaskRun | null;
	isImplementationLocked?: boolean;
}) {
	const [workspace, setWorkspace] = useState<PlanModeWorkspace | null>(null);
	const [sessions, setSessions] = useState<DesignQuestionnaireSession[]>([]);
	const [activeTab, setActiveTab] = useState<PlanWorkspaceTab>(
		initialTab === "status" ? "questionnaire" : initialTab || "questionnaire",
	);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [answers, setAnswers] = useState<
		Record<string, DesignQuestionnaireAnswer>
	>({});
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionNotice, setActionNotice] = useState<string | null>(null);
	const [testModeStatus, setTestModeStatus] = useState<string | null>(null);
	const [generalSettings, setGeneralSettings] =
		useState<GeneralSettings | null>(null);
	const [, setAssemblyReadySessionIds] = useState<Set<string>>(new Set());
	const [generatedMessages, setGeneratedMessages] = useState<TaskMessage[]>([]);
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
	const featurePlanVerification = useMemo(
		() =>
			activeTab === "feature-plan"
				? buildFeaturePlanVerificationModel({
						featurePlanMessage,
						taskMessages,
					})
				: null,
		[activeTab, featurePlanMessage, taskMessages],
	);
	const messageViewDecisions = useMemo(
		() => extractViewDecisions(taskMessages),
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
	const questionnaireGateLocked =
		planModeCapabilities.questionnaire && !questionnaireComplete;
	const didSelectUnlockedDefaultTab = useRef(false);
	const workspaceScrollRef = useRef<HTMLDivElement | null>(null);
	const activeTabRef = useRef(activeTab);
	const onTabChangeRef = useRef(onTabChange);
	onTabChangeRef.current = onTabChange;
	const visibleTabs = useMemo<PlanWorkspaceTab[]>(() => {
		return buildVisiblePlanWorkspaceTabs({
			questionnaireGateLocked,
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
		questionnaireGateLocked,
		workspace?.dedicatedViewArtifacts,
	]);
	const defaultTab: PlanWorkspaceTab = questionnaireGateLocked
		? "questionnaire"
		: "status";
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
			const workspaceRes = await fetchPlanModeWorkspace(sessionId);
			const nextWorkspace = workspaceRes.ok
				? ((await workspaceRes.json()) as PlanModeWorkspace)
				: null;
			if (nextWorkspace) setWorkspace(nextWorkspace);
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
					setAnswers(
						Object.fromEntries(
							selected.answers.map((item) => [item.questionId, item.answer]),
						),
					);
				}
			}
		},
		[activeSessionId, blueprintMessages.length, selectActiveTab, sessionId],
	);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		const controller = new AbortController();
		fetchGeneralSettings({ signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) return null;
				return (await res.json()) as GeneralSettings;
			})
			.then((settings) => {
				if (!controller.signal.aborted) setGeneralSettings(settings);
			})
			.catch((error) => {
				if (error?.name !== "AbortError")
					console.warn("Failed to load Plan Mode settings", error);
			});
		return () => controller.abort();
	}, []);

	useEffect(() => {
		const nextTab = resolveInitialPlanWorkspaceTabUpdate(
			initialTab,
			questionnaireGateLocked,
		);
		if (nextTab) selectActiveTab(nextTab);
	}, [initialTab, questionnaireGateLocked, selectActiveTab]);

	useEffect(() => {
		if (questionnaireGateLocked) {
			didSelectUnlockedDefaultTab.current = false;
			if (activeTab !== "questionnaire") selectActiveTab("questionnaire");
			return;
		}
		if (initialTab) return;
		if (!didSelectUnlockedDefaultTab.current && activeTab === "questionnaire") {
			didSelectUnlockedDefaultTab.current = true;
			selectActiveTab(defaultTab);
			return;
		}
		if (!visibleTabs.includes(activeTab)) selectActiveTab(defaultTab);
	}, [
		activeTab,
		defaultTab,
		initialTab,
		questionnaireGateLocked,
		selectActiveTab,
		visibleTabs,
	]);

	const activeQuestionnaireSession =
		sessions.find((session) => session.id === activeSessionId) ||
		sessions[0] ||
		null;
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
	const showQuestionnaireStartAction = shouldShowQuestionnaireStartAction({
		sessionId,
		questionnaireComplete,
	});

	async function runAction(
		action: string,
		fn: () => Promise<PlanWorkspaceActionResult>,
	) {
		setBusyAction(action);
		setActionError(null);
		setActionNotice(null);
		try {
			const result = await fn();
			const focusTab = result?.focusTab ?? null;
			await refresh({
				preserveGeneratedBlueprintFocus: focusTab === "blueprint",
			});
			if (focusTab) {
				selectActiveTab(focusTab);
				resetWorkspaceScrollTop();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setActionError(message);
		} finally {
			setBusyAction(null);
		}
	}

	async function runSessionAction(action: string, fn?: () => Promise<void>) {
		if (!fn || isImplementationLocked) return;
		await runAction(action, async () => {
			await fn();
			return undefined;
		});
	}

	const planModeDisabledReason =
		"Plan Mode capability is disabled in Settings.";

	async function startQuestionnaire() {
		if (!sessionId) return;
		if (isImplementationLocked) return;
		if (!planModeCapabilities.questionnaire) return;
		await runAction("start", async () => {
			const res = await startDesignQuestionnaire(sessionId, {
				sourceBlueprintMessageId: activeBlueprintMessage?.id ?? null,
			});
			if (!res.ok) throw new Error(await res.text());
			const created = (await res.json()) as DesignQuestionnaireSession;
			setActiveSessionId(created.id);
			selectActiveTab("questionnaire");
		});
	}

	async function submitAnswersForNextStep() {
		if (!sessionId || !activeQuestionnaireSession) return;
		if (isCompletedQuestionnaireSession(activeQuestionnaireSession)) {
			selectActiveTab("status");
			return;
		}
		if (unansweredQuestions.length > 0) return;
		if (isImplementationLocked) return;
		await runAction("submit-answers", async () => {
			const answersRes = await submitDesignQuestionnaireAnswers(
				sessionId,
				activeQuestionnaireSession.id,
				{
					answers: buildSubmittableQuestionnaireAnswers(
						questionGroups,
						answers,
					),
				},
			);
			if (!answersRes.ok) throw new Error(await answersRes.text());
			const updatedSession =
				(await answersRes.json()) as DesignQuestionnaireSession;
			setSessions((prev) => {
				const exists = prev.some((session) => session.id === updatedSession.id);
				if (!exists) return [updatedSession, ...prev];
				return prev.map((session) =>
					session.id === updatedSession.id ? updatedSession : session,
				);
			});
			setActiveSessionId(updatedSession.id);
			setAnswers(
				Object.fromEntries(
					updatedSession.answers.map((item) => [item.questionId, item.answer]),
				),
			);
			if (isCompletedQuestionnaireSession(updatedSession)) {
				setAssemblyReadySessionIds(
					(prev) => new Set([...prev, updatedSession.id]),
				);
				selectActiveTab("status");
			}
		});
	}

	async function requestAdditionalQuestionnaireQuestions() {
		if (!sessionId) return;
		if (isImplementationLocked) return;
		if (!planModeCapabilities.questionnaire) return;
		await runAction("questionnaire-additional", async () => {
			const res = await generateAdditionalDesignQuestionnaireQuestions(
				sessionId,
				{
					source: "user_requested",
					reason: "Plan Mode Status からの追加確認",
					maxQuestions: 5,
				},
			);
			if (!res.ok) throw new Error(await res.text());
			const payload = (await res.json()) as {
				session: DesignQuestionnaireSession | null;
				result: {
					addedCount: number;
					skippedDuplicateCount: number;
				};
			};
			if (payload.session) {
				setActiveSessionId(payload.session.id);
				setAnswers(
					Object.fromEntries(
						payload.session.answers.map((item) => [
							item.questionId,
							item.answer,
						]),
					),
				);
			}
			if (payload.result.addedCount > 0) {
				setActionNotice(
					`追加質問を ${payload.result.addedCount} 件作成しました。`,
				);
				selectActiveTab("questionnaire");
			} else {
				setActionNotice("追加質問はありません。");
			}
		});
	}

	async function generatePlanModeArtifact(
		action: "blueprint" | "data-model" | "feature-plan",
		nextTab: PlanWorkspaceTab,
	) {
		if (!sessionId) return;
		if (isImplementationLocked) return;
		const capability =
			action === "blueprint"
				? "blueprint"
				: action === "data-model"
					? "data_model"
					: "feature_plan";
		if (!planModeCapabilities[capability]) return;
		await runAction(action, async () => {
			let proceedWithUnansweredBlocking = false;
			if (
				action === "feature-plan" &&
				(activeQuestionnaireSummary?.blockingUnansweredCount || 0) > 0
			) {
				const confirmed = window.confirm(
					"要回答の未回答質問があります。未回答のまま仕様書を作成しますか？",
				);
				if (!confirmed) {
					selectActiveTab("questionnaire");
					return;
				}
				proceedWithUnansweredBlocking = true;
			}
			const res =
				action === "blueprint"
					? await generateBlueprintArtifact(sessionId, {
							questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
							sourceBlueprintMessageId: activeBlueprintSourceMessageId || null,
						})
					: action === "data-model"
						? await generateDataModelArtifact(sessionId, {
								questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
								featurePlanMessageId: featurePlanMessage?.id ?? null,
								sourceBlueprintMessageId:
									activeBlueprintSourceMessageId || null,
							})
						: await generateFeaturePlanArtifact(sessionId, {
								questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
								sourceBlueprintMessageId:
									activeBlueprintSourceMessageId || null,
								proceedWithUnansweredBlocking,
							});
			if (!res.ok) {
				const errorText = await res.text();
				const parsedError = parseJsonRecord(errorText);
				if (
					String(parsedError?.code || "") ===
					"BLOCKING_QUESTIONNAIRE_ANSWERS_REQUIRED"
				) {
					selectActiveTab("questionnaire");
					throw new Error(
						"要回答の未回答質問があります。Questionnaire で回答してください。",
					);
				}
				throw new Error(errorText);
			}
			const result = (await res.json()) as {
				message?: TaskMessage;
				workspace?: PlanModeWorkspace;
			};
			const generatedMessage = result.message;
			if (generatedMessage) {
				setGeneratedMessages((prev) => [...prev, generatedMessage]);
			}
			if (result.workspace) setWorkspace(result.workspace);
			return { focusTab: nextTab };
		});
	}

	async function generateDedicatedViews(views: string[]) {
		if (!sessionId || isImplementationLocked) return;
		const targetViews = views
			.filter(isGenericPlanView)
			.filter((view) => planModeCapabilities[view]);
		if (targetViews.length === 0) return;
		await runAction(`view:${targetViews[0]}`, async () => {
			const generated: TaskMessage[] = [];
			let latestWorkspace: PlanModeWorkspace | null = null;
			for (const view of targetViews) {
				const res = await generatePlanViewArtifact(sessionId, view, {
					questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
					featurePlanMessageId: featurePlanMessage?.id ?? null,
					sourceBlueprintMessageId: activeBlueprintSourceMessageId || null,
					sourceDataModelMessageId: activeDataModelMessage?.id ?? null,
				});
				if (!res.ok) throw new Error(await res.text());
				const result = (await res.json()) as {
					message?: TaskMessage;
					workspace?: PlanModeWorkspace;
				};
				if (result.message) generated.push(result.message);
				if (result.workspace) latestWorkspace = result.workspace;
			}
			if (generated.length > 0)
				setGeneratedMessages((prev) => [...prev, ...generated]);
			if (latestWorkspace) setWorkspace(latestWorkspace);
			const firstTab = planViewToTab[targetViews[0]];
			if (firstTab) return { focusTab: firstTab };
		});
	}

	const activeDedicatedView =
		activeTab in tabToPlanView
			? tabToPlanView[activeTab as keyof typeof tabToPlanView]
			: null;
	const activeDedicatedArtifact = activeDedicatedView
		? selectActiveDedicatedArtifact(
				workspace?.dedicatedViewArtifacts,
				activeDedicatedView,
			)
		: null;
	const activeDedicatedMessage = activeDedicatedArtifact
		? workspaceMessages.combinedTaskMessages.find(
				(message) => message.id === activeDedicatedArtifact.sourceMessageId,
			) || null
		: null;
	const activePlanModeArtifactContext =
		useMemo<WorkbenchArtifactContext | null>(() => {
			return buildPlanModeArtifactContext({
				sessionId,
				activeTab,
				featurePlanMessage,
				activeBlueprintMessage,
				activeBlueprintSourceMessageId,
				activeDataModelMessage,
				activeDedicatedMessage,
				activeDedicatedArtifact,
				readyQuestionnaireSessionId: readyQuestionnaireSession?.id ?? null,
			});
		}, [
			activeBlueprintMessage,
			activeBlueprintSourceMessageId,
			activeDataModelMessage,
			activeDedicatedArtifact,
			activeDedicatedMessage,
			activeTab,
			featurePlanMessage,
			readyQuestionnaireSession,
			sessionId,
		]);

	useEffect(() => {
		onArtifactContextChange?.(activePlanModeArtifactContext);
		return () => onArtifactContextChange?.(null);
	}, [activePlanModeArtifactContext, onArtifactContextChange]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#1e1e2e] text-slate-100">
			<div className="shrink-0 border-slate-800 border-b px-5 py-3">
				<div className="flex flex-wrap gap-1">
					{visibleTabs.map((id) => (
						<button
							key={id}
							type="button"
							className={`rounded border px-2 py-1 text-xs ${
								activeTab === id
									? "border-cyan-400/70 bg-cyan-950/40 text-cyan-100"
									: "border-slate-700 bg-slate-950/20 text-slate-300 hover:border-slate-500"
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
			>
				{activeTab === "feature-plan" ? (
					<div className="grid gap-3">
						{featurePlanVerification ? (
							<FeaturePlanVerificationBar
								model={featurePlanVerification}
								latestRun={latestRun}
								canStart={
									Boolean(onStartTestModeRun) && !isImplementationLocked
								}
								status={testModeStatus}
								onStart={async (action) => {
									if (!onStartTestModeRun) return;
									setTestModeStatus(`${action}:starting`);
									const ok = await onStartTestModeRun({
										specArtifactId: featurePlanVerification.specArtifactId,
										verificationDocumentId:
											featurePlanVerification.verificationDocumentId,
										action,
									});
									setTestModeStatus(
										ok ? `${action}:started` : `${action}:failed`,
									);
								}}
							/>
						) : null}
						<MarkdownViewer
							content={
								featurePlanMessage?.content || "仕様書 artifact はありません。"
							}
						/>
					</div>
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
					<div className="grid gap-4">
						<div className="flex flex-wrap items-center gap-2">
							{showQuestionnaireStartAction ? (
								<button
									type="button"
									className="inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
									onClick={startQuestionnaire}
									disabled={
										Boolean(busyAction) ||
										isImplementationLocked ||
										!planModeCapabilities.questionnaire
									}
								>
									{busyAction === "start" ? (
										<LoaderCircle className="h-3 w-3 animate-spin" />
									) : null}
									{activeBlueprintMessage
										? "この画面案から質問を作成"
										: "質問を作成"}
								</button>
							) : null}
							{!planModeCapabilities.questionnaire ? (
								<span className="text-[11px] text-amber-300">
									{planModeDisabledReason}
								</span>
							) : null}
							{planModeCapabilities.questionnaire ? (
								<button
									type="button"
									className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-950/20 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
									onClick={requestAdditionalQuestionnaireQuestions}
									disabled={
										Boolean(busyAction) ||
										isImplementationLocked ||
										!planModeCapabilities.questionnaire
									}
								>
									{busyAction === "questionnaire-additional" ? (
										<LoaderCircle className="h-3 w-3 animate-spin" />
									) : null}
									追加確認
								</button>
							) : null}
							{sessions.map((session) => (
								<button
									key={session.id}
									type="button"
									className={`rounded border px-2 py-1 text-xs ${
										activeQuestionnaireSession?.id === session.id
											? "border-cyan-400/70 bg-cyan-950/40 text-cyan-100"
											: "border-slate-700 text-slate-300"
									}`}
									onClick={() => {
										setActiveSessionId(session.id);
										setAnswers(
											Object.fromEntries(
												session.answers.map((item) => [
													item.questionId,
													item.answer,
												]),
											),
										);
									}}
								>
									{session.status} {session.answers.length}/
									{getQuestionCount(session)}
								</button>
							))}
						</div>
						{activeQuestionnaireSession ? (
							<>
								<QuestionnaireForm
									questionGroups={questionGroups}
									answers={answers}
									onChange={setAnswers}
									readOnly={questionnaireSubmissionState.readOnly}
								/>
								<div className="flex flex-wrap items-center gap-2">
									<ActionButton
										label={questionnaireSubmissionState.label}
										icon={questionnaireSubmissionState.icon}
										busy={busyAction === "submit-answers"}
										disabled={questionnaireSubmissionState.disabled}
										onClick={submitAnswersForNextStep}
									/>
									<span
										className="text-[11px] text-slate-500"
										aria-live="polite"
										data-questionnaire-state={
											questionnaireSubmissionState.state
										}
									>
										{answerProgress.answeredCount}/{answerProgress.totalCount}{" "}
										回答済み
									</span>
									{unansweredQuestions.length > 0 ? (
										<span
											className="text-[11px] text-amber-300"
											aria-live="polite"
										>
											未回答:{" "}
											{unansweredQuestions
												.map((question) => String(question.question || ""))
												.join(" / ")}
										</span>
									) : null}
									{!planModeCapabilities.questionnaire ? (
										<span className="text-[11px] text-amber-300">
											{planModeDisabledReason}
										</span>
									) : null}
								</div>
							</>
						) : (
							<p className="text-xs text-slate-500">
								No questionnaire session.
							</p>
						)}
					</div>
				) : activeTab === "status" ? (
					<PlanWorkspaceStatusView
						workspace={workspace}
						questionnaireSession={activeQuestionnaireSession}
						questionnaireSummary={activeQuestionnaireSummary}
						busyAction={busyAction}
						canGenerateDataModel={canGenerateDataModel}
						hasFeaturePlan={hasFeaturePlan}
						isImplementationLocked={isImplementationLocked}
						planModeSettings={generalSettings?.planMode}
						viewDecisions={viewDecisions}
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
					/>
				) : (
					<div className="grid gap-4">
						<ViewDecisionSummary decisions={viewDecisions} />
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

type FeaturePlanVerificationModel = {
	specArtifactId: string;
	verificationDocumentId: string | null;
	conditions: Array<{
		id: string;
		text: string;
		status: string;
		required: boolean;
	}>;
};

type FeaturePlanVerificationBarProps = {
	model: FeaturePlanVerificationModel;
	latestRun?: TaskRun | null;
	canStart: boolean;
	status: string | null;
	onStart: (action: TestModeAction) => Promise<void>;
};

function buildFeaturePlanVerificationModel(input: {
	featurePlanMessage: TaskMessage | null;
	taskMessages: TaskMessage[];
}): FeaturePlanVerificationModel | null {
	const message = input.featurePlanMessage;
	if (!message) return null;
	const metadata = toDeepRecord(message.metadataJson);
	if (readRecordString(metadata, "intent") !== "feature_plan") return null;
	const verificationDocumentId =
		readRecordString(metadata, "verificationDocumentId") ?? null;
	const sidecarMessageId =
		readRecordString(metadata, "verificationSidecarMessageId") ?? null;
	const sidecarMessage = sidecarMessageId
		? input.taskMessages.find((item) => item.id === sidecarMessageId) || null
		: null;
	const sidecarMetadata = toDeepRecord(sidecarMessage?.metadataJson);
	const document = toDeepRecord(sidecarMetadata.verificationDocument);
	const conditions = Array.isArray(document.conditions)
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
	if (!verificationDocumentId && conditions.length === 0) return null;
	return {
		specArtifactId: `feature-plan-${message.id}`,
		verificationDocumentId,
		conditions,
	};
}

function FeaturePlanVerificationBar({
	model,
	latestRun,
	canStart,
	status,
	onStart,
}: FeaturePlanVerificationBarProps) {
	const { t } = useTranslation();
	const canShowStartButton = canStart && Boolean(model.specArtifactId);
	const workflowActionStatus = readTestModeWorkflowActionStatus(status);
	const workflowSteps = buildTestModeWorkflowSteps({
		latestRun,
		localStatus: status,
	});
	const workflowInProgress =
		workflowActionStatus === "starting" ||
		isTestModeWorkflowInProgress(workflowSteps);
	return (
		<div className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="text-xs font-semibold uppercase text-slate-300">
						{t("testMode.checklist.title")}
					</div>
					<div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
						<span>
							{t("testMode.checklist.conditionsCount", {
								count: model.conditions.length,
							})}
						</span>
						{workflowActionStatus === "failed" ? (
							<span>{t("testMode.status.planFailed")}</span>
						) : null}
					</div>
				</div>
				{canShowStartButton ? (
					<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
						<FeaturePlanTestModeActionButton
							action={TEST_MODE_WORKFLOW_ACTION}
							label={t("testMode.action.startWorkflow")}
							status={workflowActionStatus}
							disabled={workflowInProgress}
							onStart={onStart}
						/>
					</div>
				) : null}
			</div>
			<FeaturePlanTestModeWorkflowProgress steps={workflowSteps} />
			{model.conditions.length > 0 ? (
				<div className="mt-2 grid gap-1">
					{model.conditions.slice(0, 3).map((condition) => (
						<div
							key={condition.id}
							className="grid grid-cols-[4.5rem_6rem_minmax(0,1fr)] items-start gap-2 rounded-md border border-slate-800/80 bg-slate-900/35 px-2.5 py-1.5 text-xs"
						>
							<span className="font-mono leading-5 text-slate-400">
								{condition.id}
							</span>
							<span className="whitespace-nowrap leading-5 text-slate-400">
								{t(`testMode.conditionStatus.${condition.status}`, {
									defaultValue: condition.status,
								})}
							</span>
							<span className="min-w-0 whitespace-normal break-words leading-5 text-slate-100">
								{condition.text}
							</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function FeaturePlanTestModeWorkflowProgress({
	steps,
}: {
	steps: TestModeWorkflowStepView[];
}) {
	const { t } = useTranslation();
	return (
		<div className="mt-2 grid gap-2 sm:grid-cols-4">
			{steps.map((step, index) => (
				<div
					key={step.id}
					className="min-w-0 rounded-md border border-slate-800 bg-slate-900/35 px-2.5 py-2"
				>
					<div className="flex min-w-0 items-center gap-2">
						<FeaturePlanTestModeWorkflowStatusIcon status={step.status} />
						<span className="truncate text-xs font-medium text-slate-100">
							{t(`testMode.workflow.step.${step.id}`)}
						</span>
					</div>
					<div className="mt-1 text-[11px] text-slate-400">
						{index + 1}. {t(`testMode.workflow.status.${step.status}`)}
					</div>
				</div>
			))}
		</div>
	);
}

function FeaturePlanTestModeWorkflowStatusIcon({
	status,
}: {
	status: TestModeWorkflowStepStatus;
}) {
	if (status === "passed") {
		return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />;
	}
	if (status === "running") {
		return (
			<LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
		);
	}
	if (status === "failed" || status === "needs_human") {
		return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />;
	}
	return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-500" />;
}

function FeaturePlanTestModeActionButton({
	action,
	label,
	status,
	disabled = false,
	onStart,
}: {
	action: TestModeAction;
	label: string;
	status: string | null;
	disabled?: boolean;
	onStart: (action: TestModeAction) => Promise<void>;
}) {
	const { t } = useTranslation();
	const isDisabled = disabled || status === "starting";
	return (
		<button
			type="button"
			className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
			disabled={isDisabled}
			onClick={() => void onStart(action)}
			title={label}
		>
			<FlaskConical className="h-3.5 w-3.5" />
			{status === "starting" ? t("testMode.status.starting") : label}
		</button>
	);
}

export function extractViewDecisions(
	messages: TaskMessage[],
): PlanViewDecision[] {
	const decisionsByView = new Map<string, PlanViewDecision>();
	for (const message of messages) {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		const planModeGate = isRecord(metadata.planModeGate)
			? metadata.planModeGate
			: null;
		const originalGate =
			planModeGate && isRecord(planModeGate.originalGate)
				? planModeGate.originalGate
				: null;
		const candidates = [
			originalGate?.dedicatedViews,
			isRecord(metadata.planMode) ? metadata.planMode.dedicatedViews : null,
			planModeGate?.dedicatedViews,
			metadata.dedicatedViews,
			metadata.viewDecisions,
		];
		for (const candidate of candidates) {
			if (!Array.isArray(candidate)) continue;
			for (const item of candidate) {
				if (!isRecord(item)) continue;
				const view = typeof item.view === "string" ? item.view : "";
				const decision =
					item.decision === "include" || item.decision === "omit"
						? item.decision
						: null;
				if (!view || !decision) continue;
				decisionsByView.set(view, {
					view,
					decision,
					reason: typeof item.reason === "string" ? item.reason : undefined,
				});
			}
		}
	}
	return [...decisionsByView.values()];
}

const planViewToTab: Record<GenericPlanView, PlanWorkspaceTab> = {
	user_flow: "user-flow",
	api_io_contract: "api-io-contract",
	activity_flow: "activity-flow",
	sequence_flow: "sequence-flow",
	zod_schema_design: "zod-schema-design",
};

function isGenericPlanView(view: string): view is GenericPlanView {
	return Object.hasOwn(planViewToTab, view);
}

export function selectActiveDedicatedArtifact(
	artifacts: PlanModeWorkspace["dedicatedViewArtifacts"] | undefined,
	view: string,
) {
	return (
		[...(artifacts || [])]
			.filter((artifact) => artifact.kind === view)
			.sort((a, b) => toTimeValue(b.createdAt) - toTimeValue(a.createdAt))[0] ||
		null
	);
}

function toTimeValue(value: unknown) {
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) return numeric;
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function isCompletedQuestionnaireSession(session: DesignQuestionnaireSession) {
	return isCompletedStatus(session.status);
}

function isCompletedStatus(status: string) {
	return status === "review_ready" || status === "accepted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRecordString(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function readRecordBoolean(record: Record<string, unknown>, key: string) {
	const value = record[key];
	return typeof value === "boolean" ? value : null;
}

function parseJsonRecord(value: string) {
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
