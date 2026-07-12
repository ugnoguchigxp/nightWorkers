import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../shared/json-record";
import type { MissionPilotQuestionnaireDraft } from "../../../shared/schemas/mission-pilot.schema";
import type { PlanModeRegenerationTarget } from "../../../shared/schemas/plan-mode-artifact.schema";
import { generateBlueprintArtifact } from "../blueprint";
import { generateDataModelArtifact } from "../dataModel";
import {
	fetchMissionPilotQuestionnaireDraft,
	missionPilotPlanProgressQueryOptions,
	submitMissionPilotQuestionnaireDraft,
	updateMissionPilotQuestionnaireDraft,
} from "../missionPilot";
import {
	type ArtifactExportDescriptor,
	artifactFileStem,
	buildMarkdownFromValue,
	markdownCodeBlock,
} from "../nightworkers/artifactExport";
import { MarkdownViewer } from "../nightworkers/components/ArtifactFileViewers";
import type {
	ActivityArtifact,
	DesignQuestionnaireAnswer,
	DesignQuestionnaireSession,
	GeneralSettings,
	PlanModeWorkspace,
	TaskMessage,
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
	generateFeaturePlanArtifact,
	getPlanModeCapabilities,
	type PlanWorkspaceTab,
	planModeWorkspaceQueryKey,
	planModeWorkspaceQueryOptions,
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
import { usePlanWorkspaceActions } from "./PlanModeWorkspace.controller";
import {
	DedicatedViewPanel,
	type MermaidRenderFailure,
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

const correctionTargetTabs: Record<
	PlanModeRegenerationTarget,
	PlanWorkspaceTab
> = {
	feature_plan: "feature-plan",
	blueprint: "blueprint",
	data_model: "data-model",
	user_flow: "user-flow",
	api_io_contract: "api-io-contract",
	activity_flow: "activity-flow",
	sequence_flow: "sequence-flow",
	zod_schema_design: "zod-schema-design",
};

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
			planModeFocus: { kind: "artifact" },
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

function planModeMessageMarkdown(title: string, message: TaskMessage | null) {
	if (!message) return `# ${title}\n`;
	const metadata = toDeepRecord(message.metadataJson);
	if (message.messageType === "api_contract") {
		return buildMarkdownFromValue(
			title,
			metadata.apiContract ||
				metadata.artifactPayload ||
				parseJson(message.content),
		);
	}
	if (message.messageType === "zod_schema") {
		return `# ${title}\n\n${markdownCodeBlock(message.content, "typescript")}\n`;
	}
	const parsed = parseJson(message.content);
	return parsed === null
		? message.content || `# ${title}\n`
		: buildMarkdownFromValue(title, parsed);
}

function parseJson(value: string) {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

export function buildPlanModeExportDescriptor(input: {
	scopeId: string | null;
	activeTab: PlanWorkspaceTab;
	workspace: PlanModeWorkspace | null;
	viewDecisions: PlanViewDecision[];
	activeQuestionnaireSession: DesignQuestionnaireSession | null;
	featurePlanMessage: TaskMessage | null;
	activeBlueprintMessage: TaskMessage | null;
	activeDataModelMessage: TaskMessage | null;
	activeDedicatedMessage: TaskMessage | null;
}): ArtifactExportDescriptor {
	const title = getPlanWorkspaceTabLabel(input.activeTab);
	let markdown: string;
	if (input.activeTab === "status") {
		markdown = buildMarkdownFromValue(title, {
			workspace: input.workspace,
			viewDecisions: input.viewDecisions,
		});
	} else if (input.activeTab === "questionnaire") {
		markdown = buildMarkdownFromValue(
			title,
			input.activeQuestionnaireSession || { status: "not_started" },
		);
	} else if (input.activeTab === "feature-plan") {
		markdown = input.featurePlanMessage?.content || `# ${title}\n`;
	} else if (input.activeTab === "blueprint") {
		markdown = planModeMessageMarkdown(title, input.activeBlueprintMessage);
	} else if (input.activeTab === "data-model") {
		markdown = planModeMessageMarkdown(title, input.activeDataModelMessage);
	} else {
		markdown = planModeMessageMarkdown(title, input.activeDedicatedMessage);
	}
	return {
		title,
		fileStem: artifactFileStem(`plan-mode-${title}`),
		markdown,
		...(input.scopeId ? { scopeId: input.scopeId } : {}),
	};
}

export function shouldShowQuestionnaireStartAction(input: {
	sessionId: string | null;
	questionnaireComplete: boolean;
}) {
	return Boolean(input.sessionId) && !input.questionnaireComplete;
}

export function resolveInitialPlanWorkspaceTabUpdate(
	initialTab: PlanWorkspaceTab | undefined,
): PlanWorkspaceTab | null {
	if (!initialTab) return null;
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
export function buildVisiblePlanWorkspaceTabs(input: {
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
	onExportDescriptorChange,
	onQueueSession,
	onAddToQueue,
	isImplementationLocked = false,
}: {
	sessionId: string | null;
	taskMessages: TaskMessage[];
	activityArtifacts?: ActivityArtifact[];
	initialTab?: PlanWorkspaceTab;
	onTabChange?: (tab: PlanWorkspaceTab) => void;
	onArtifactContextChange?: (context: WorkbenchArtifactContext | null) => void;
	onExportDescriptorChange?: (
		descriptor: ArtifactExportDescriptor | null,
	) => void;
	onQueueSession?: () => Promise<void>;
	onAddToQueue?: () => Promise<void>;
	isImplementationLocked?: boolean;
}) {
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
	const [generalSettings, setGeneralSettings] =
		useState<GeneralSettings | null>(null);
	const [, setAssemblyReadySessionIds] = useState<Set<string>>(new Set());
	const [generatedMessages, setGeneratedMessages] = useState<TaskMessage[]>([]);
	const [missionPilotDraft, setMissionPilotDraft] =
		useState<MissionPilotQuestionnaireDraft | null>(null);
	const [countdownNow, setCountdownNow] = useState(() => Date.now());
	const missionPilotDraftRef = useRef<MissionPilotQuestionnaireDraft | null>(
		null,
	);
	const draftUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
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
	const didSelectUnlockedDefaultTab = useRef(false);
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
					setAnswers(
						Object.fromEntries(
							selected.answers.map((item) => [item.questionId, item.answer]),
						),
					);
				}
			}
		},
		[
			activeSessionId,
			blueprintMessages.length,
			refetchWorkspace,
			selectActiveTab,
			sessionId,
		],
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

	const activeQuestionnaireSession =
		sessions.find((session) => session.id === activeSessionId) ||
		sessions[0] ||
		null;

	useEffect(() => {
		missionPilotDraftRef.current = missionPilotDraft;
	}, [missionPilotDraft]);

	useEffect(() => {
		if (!sessionId || !activeQuestionnaireSession?.id) {
			setMissionPilotDraft(null);
			return;
		}
		const controller = new AbortController();
		void fetchMissionPilotQuestionnaireDraft(sessionId)
			.then(async (response) => {
				if (!response.ok) return null;
				return (await response.json()) as MissionPilotQuestionnaireDraft | null;
			})
			.then((draft) => {
				if (controller.signal.aborted) return;
				if (
					draft &&
					draft.questionnaireSessionId !== activeQuestionnaireSession.id
				) {
					setActiveSessionId(draft.questionnaireSessionId);
					return;
				}
				if (!draft) {
					setMissionPilotDraft(null);
					return;
				}
				setMissionPilotDraft(draft);
				setAnswers(
					Object.fromEntries(
						draft.answers.map((answer) => [answer.questionId, answer]),
					),
				);
			})
			.catch(() => undefined);
		return () => controller.abort();
	}, [activeQuestionnaireSession?.id, sessionId]);

	useEffect(() => {
		if (missionPilotDraft?.state !== "waiting_user") return;
		const timer = window.setInterval(() => setCountdownNow(Date.now()), 250);
		return () => window.clearInterval(timer);
	}, [missionPilotDraft?.state]);

	const missionPilotSecondsRemaining = missionPilotDraft
		? Math.max(
				0,
				Math.ceil(
					(new Date(missionPilotDraft.deadlineAt).getTime() - countdownNow) /
						1000,
				),
			)
		: null;
	const missionPilotDraftState = missionPilotDraft?.state;

	useEffect(() => {
		if (
			!sessionId ||
			(missionPilotDraftState !== "waiting_user" &&
				missionPilotDraftState !== "submitting") ||
			missionPilotSecondsRemaining !== 0
		)
			return;
		const poll = () => {
			void fetchMissionPilotQuestionnaireDraft(sessionId)
				.then(async (response) =>
					response.ok
						? ((await response.json()) as MissionPilotQuestionnaireDraft | null)
						: null,
				)
				.then((draft) => {
					if (draft) setMissionPilotDraft(draft);
					if (draft?.state === "submitted") void refresh();
				});
		};
		const timer = window.setInterval(poll, 1_000);
		poll();
		return () => window.clearInterval(timer);
	}, [
		missionPilotDraftState,
		missionPilotSecondsRemaining,
		refresh,
		sessionId,
	]);

	const handleQuestionnaireAnswersChange = useCallback(
		(nextAnswers: Record<string, DesignQuestionnaireAnswer>) => {
			setAnswers(nextAnswers);
			if (!sessionId || missionPilotDraftRef.current?.state !== "waiting_user")
				return;
			const snapshot = Object.values(nextAnswers);
			draftUpdateQueueRef.current = draftUpdateQueueRef.current.then(
				async () => {
					const current = missionPilotDraftRef.current;
					if (!current || current.state !== "waiting_user") return;
					const response = await updateMissionPilotQuestionnaireDraft(
						sessionId,
						current.version,
						snapshot,
					);
					if (!response.ok) return;
					const updated =
						(await response.json()) as MissionPilotQuestionnaireDraft;
					missionPilotDraftRef.current = updated;
					setMissionPilotDraft(updated);
				},
			);
		},
		[sessionId],
	);
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

	const { runAction, runSessionAction } = usePlanWorkspaceActions({
		isImplementationLocked,
		refresh,
		selectActiveTab,
		resetWorkspaceScrollTop,
		setBusyAction,
		setActionError,
		setActionNotice,
	});

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
			if (missionPilotDraft?.state === "waiting_user") {
				await draftUpdateQueueRef.current;
				const current = missionPilotDraftRef.current;
				if (current?.state === "waiting_user") {
					const response = await submitMissionPilotQuestionnaireDraft(
						sessionId,
						current.version,
						buildSubmittableQuestionnaireAnswers(questionGroups, answers),
					);
					if (!response.ok) throw new Error(await response.text());
					const payload = (await response.json()) as {
						draft: MissionPilotQuestionnaireDraft | null;
						questionnaire: DesignQuestionnaireSession;
					};
					setMissionPilotDraft(payload.draft);
					setSessions((prev) =>
						prev.map((item) =>
							item.id === payload.questionnaire.id
								? payload.questionnaire
								: item,
						),
					);
					await refresh();
					return;
				}
			}
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
			if (result.workspace)
				queryClient.setQueryData(
					planModeWorkspaceQueryKey(sessionId),
					result.workspace,
				);
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
			if (latestWorkspace)
				queryClient.setQueryData(
					planModeWorkspaceQueryKey(sessionId),
					latestWorkspace,
				);
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

	async function repairDedicatedViewAfterMermaidFailure(
		failure: MermaidRenderFailure,
	) {
		if (
			(failure.stage !== "chart_parse" && failure.stage !== "chart_render") ||
			!sessionId ||
			isImplementationLocked ||
			!activeDedicatedView ||
			!isGenericPlanView(activeDedicatedView) ||
			!activeDedicatedMessage
		) {
			return;
		}
		const repairStage = failure.stage;
		const repairKey = `${sessionId}:${activeDedicatedView}`;
		if (attemptedMermaidRenderRepairs.current.has(repairKey)) return;
		attemptedMermaidRenderRepairs.current.add(repairKey);
		await runAction(`view:${activeDedicatedView}:mermaid-repair`, async () => {
			const res = await generatePlanViewArtifact(
				sessionId,
				activeDedicatedView,
				{
					questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
					featurePlanMessageId: featurePlanMessage?.id ?? null,
					sourceBlueprintMessageId: activeBlueprintSourceMessageId || null,
					sourceDataModelMessageId: activeDataModelMessage?.id ?? null,
					mermaidRenderRepair: {
						sourceMessageId: activeDedicatedMessage.id,
						stage: repairStage,
						error: failure.message,
						chart: failure.chart,
					},
				},
			);
			if (!res.ok) throw new Error(await res.text());
			const result = (await res.json()) as {
				message?: TaskMessage;
				workspace?: PlanModeWorkspace;
			};
			if (result.message) {
				setGeneratedMessages((prev) => [
					...prev,
					result.message as TaskMessage,
				]);
			}
			if (result.workspace) {
				queryClient.setQueryData(
					planModeWorkspaceQueryKey(sessionId),
					result.workspace,
				);
			}
			return { focusTab: planViewToTab[activeDedicatedView] };
		});
	}
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
	const activeExportDescriptor = useMemo<ArtifactExportDescriptor>(() => {
		return buildPlanModeExportDescriptor({
			scopeId: sessionId,
			activeTab,
			workspace,
			viewDecisions,
			activeQuestionnaireSession,
			featurePlanMessage,
			activeBlueprintMessage,
			activeDataModelMessage,
			activeDedicatedMessage,
		});
	}, [
		activeBlueprintMessage,
		activeDataModelMessage,
		activeDedicatedMessage,
		activeQuestionnaireSession,
		activeTab,
		featurePlanMessage,
		sessionId,
		viewDecisions,
		workspace,
	]);

	useEffect(() => {
		onArtifactContextChange?.(activePlanModeArtifactContext);
		return () => onArtifactContextChange?.(null);
	}, [activePlanModeArtifactContext, onArtifactContextChange]);
	useEffect(() => {
		onExportDescriptorChange?.(activeExportDescriptor);
		return () => onExportDescriptorChange?.(null);
	}, [activeExportDescriptor, onExportDescriptorChange]);

	return (
		<div
			className="flex h-full min-h-0 flex-col bg-[#1e1e2e] text-slate-100"
			data-artifact-export-expand
		>
			<div
				className="shrink-0 border-slate-800 border-b px-5 py-3"
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
					<div className="grid gap-3">
						{featurePlanVerification ? (
							<FeaturePlanVerificationBar model={featurePlanVerification} />
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
									onChange={handleQuestionnaireAnswersChange}
									readOnly={questionnaireSubmissionState.readOnly}
									answerEvidence={missionPilotDraft?.answerEvidence}
								/>
								{missionPilotDraft?.state === "waiting_user" ? (
									<div
										className="flex items-center gap-2 rounded bg-slate-800/55 px-3 py-2 text-xs text-slate-300"
										data-mission-pilot-questionnaire-countdown
									>
										<span>Mission Pilotの回答案を表示中</span>
										<span className="font-mono font-semibold text-slate-100">
											{missionPilotSecondsRemaining}秒
										</span>
										<span className="text-slate-500">
											未操作ならこの内容で自動確定します
										</span>
									</div>
								) : null}
								{missionPilotDraft?.state === "failed" ? (
									<div className="rounded bg-red-950/35 px-3 py-2 text-xs text-red-200">
										自動確定に失敗しました。回答案は保持されています。Mission
										Pilotを再開して再試行してください。
									</div>
								) : null}
								{missionPilotDraft?.state === "submitted" ? (
									<div
										className="rounded bg-emerald-950/35 px-3 py-2 text-xs text-emerald-200"
										data-mission-pilot-questionnaire-submitted
									>
										Mission Pilotが{missionPilotDraft.answers.length}
										件の回答を確定しました。選択内容と根拠はこの画面に証跡として保持されています。
									</div>
								) : null}
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
						missionPilotPlanProgress={missionPilotPlanProgress}
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
						onMermaidRenderFailure={(failure) => {
							void repairDedicatedViewAfterMermaidFailure(failure);
						}}
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
	conditions: Array<{
		id: string;
		text: string;
		status: string;
		required: boolean;
	}>;
};

function buildFeaturePlanVerificationModel(input: {
	featurePlanMessage: TaskMessage | null;
	taskMessages: TaskMessage[];
}): FeaturePlanVerificationModel | null {
	const message = input.featurePlanMessage;
	if (!message) return null;
	const metadata = toDeepRecord(message.metadataJson);
	if (readRecordString(metadata, "intent") !== "feature_plan") return null;
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
	return conditions.length > 0 ? { conditions } : null;
}

function FeaturePlanVerificationBar({
	model,
}: {
	model: FeaturePlanVerificationModel;
}) {
	const { t } = useTranslation();
	return (
		<div className="nightworkers-structured-artifact nightworkers-structured-artifact-section rounded-md border px-3 py-2">
			{model.conditions.length > 0 ? (
				<div className="grid gap-1">
					{model.conditions.slice(0, 3).map((condition) => {
						return (
							<div
								key={condition.id}
								className="nightworkers-structured-artifact-row grid grid-cols-[4.5rem_6rem_minmax(0,1fr)] items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs"
							>
								<span className="nightworkers-structured-artifact-muted font-mono leading-5">
									{condition.id}
								</span>
								<span className="nightworkers-structured-artifact-muted whitespace-nowrap leading-5">
									{t(`testMode.conditionStatus.${condition.status}`, {
										defaultValue: condition.status,
									})}
								</span>
								<span className="nightworkers-structured-artifact-text min-w-0 whitespace-normal break-words leading-5">
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
