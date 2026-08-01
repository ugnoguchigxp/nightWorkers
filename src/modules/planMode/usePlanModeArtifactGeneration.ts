import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { generateBlueprintArtifact } from "../blueprint";
import { generateDataModelArtifact } from "../dataModel";
import type { PlanModeWorkspace, TaskMessage } from "../nightworkers/types";
import type { PlanWorkspaceTab } from "../specification";
import {
	generateFeaturePlanArtifact,
	planModeWorkspaceQueryKey,
	resolveLatestPlanArtifactSourceMessageIds,
} from "../specification";
import type { MermaidRenderFailure } from "./PlanModeWorkspacePanels";
import {
	isGenericPlanView,
	parseJsonRecord,
	planViewToTab,
} from "./PlanModeWorkspaceViewer.helpers";
import { tabToPlanView } from "./PlanModeWorkspaceViewer.model";
import type { GenericPlanView } from "./planViewCommands";
import { generatePlanViewArtifact } from "./planViewCommands";

export function usePlanModeArtifactGeneration(input: {
	sessionId: string | null;
	isImplementationLocked: boolean;
	planModeCapabilities: Record<string, boolean>;
	activeQuestionnaireSummary: { blockingUnansweredCount?: number } | null;
	readyQuestionnaireSession: { id: string } | null;
	featurePlanMessage: Pick<TaskMessage, "id"> | null;
	activeBlueprintSourceMessageId: string | null;
	activeDataModelMessage: Pick<TaskMessage, "id"> | null;
	activeDedicatedView: GenericPlanView | null;
	activeDedicatedMessage: Pick<TaskMessage, "id"> | null;
	attemptedMermaidRenderRepairs: MutableRefObject<Set<string>>;
	queryClient: QueryClient;
	setGeneratedMessages: Dispatch<SetStateAction<TaskMessage[]>>;
	runAction: (
		action: string,
		fn: () => Promise<{ focusTab?: PlanWorkspaceTab | null } | undefined>,
	) => Promise<boolean>;
	selectActiveTab: (tab: PlanWorkspaceTab) => void;
}) {
	const {
		sessionId,
		isImplementationLocked,
		planModeCapabilities,
		activeQuestionnaireSummary,
		readyQuestionnaireSession,
		featurePlanMessage,
		activeBlueprintSourceMessageId,
		activeDataModelMessage,
		activeDedicatedView,
		activeDedicatedMessage,
		attemptedMermaidRenderRepairs,
		queryClient,
		setGeneratedMessages,
		runAction,
		selectActiveTab,
	} = input;
	async function generatePlanModeArtifact(
		action: "blueprint" | "data-model" | "feature-plan",
		nextTab: PlanWorkspaceTab,
	) {
		if (!sessionId) return false;
		if (isImplementationLocked) return false;
		const capability =
			action === "blueprint"
				? "blueprint"
				: action === "data-model"
					? "data_model"
					: "feature_plan";
		if (!planModeCapabilities[capability]) return false;
		return runAction(action, async () => {
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
			const latestSources = resolveLatestPlanArtifactSourceMessageIds(
				queryClient.getQueryData<PlanModeWorkspace>(
					planModeWorkspaceQueryKey(sessionId),
				) ?? null,
			);
			const res =
				action === "blueprint"
					? await generateBlueprintArtifact(sessionId, {
							questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
							sourceBlueprintMessageId: activeBlueprintSourceMessageId || null,
						})
					: action === "data-model"
						? await generateDataModelArtifact(sessionId, {
								questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
								featurePlanMessageId:
									latestSources.featurePlanMessageId ??
									featurePlanMessage?.id ??
									null,
								sourceBlueprintMessageId:
									latestSources.blueprintMessageId ??
									activeBlueprintSourceMessageId ??
									null,
							})
						: await generateFeaturePlanArtifact(sessionId, {
								questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
								sourceBlueprintMessageId:
									latestSources.blueprintMessageId ??
									activeBlueprintSourceMessageId ??
									null,
								sourceDataModelMessageId: latestSources.dataModelMessageId,
								sourceDedicatedViewMessageIds:
									latestSources.dedicatedViewMessageIds,
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
				void queryClient.invalidateQueries({
					queryKey: ["taskMessages", sessionId],
				});
				void queryClient.invalidateQueries({
					queryKey: ["evidenceCheck", "latest", sessionId],
				});
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
		if (!sessionId || isImplementationLocked) return false;
		const targetViews = views
			.filter(isGenericPlanView)
			.filter((view) => planModeCapabilities[view]);
		if (targetViews.length === 0) return false;
		return runAction(`view:${targetViews[0]}`, async () => {
			const generated: TaskMessage[] = [];
			let latestWorkspace: PlanModeWorkspace | null = null;
			for (const view of targetViews) {
				const latestSources = resolveLatestPlanArtifactSourceMessageIds(
					latestWorkspace ??
						queryClient.getQueryData<PlanModeWorkspace>(
							planModeWorkspaceQueryKey(sessionId),
						) ??
						null,
				);
				const res = await generatePlanViewArtifact(sessionId, view, {
					questionnaireSessionId: readyQuestionnaireSession?.id ?? null,
					featurePlanMessageId:
						latestSources.featurePlanMessageId ??
						featurePlanMessage?.id ??
						null,
					sourceBlueprintMessageId:
						latestSources.blueprintMessageId ??
						activeBlueprintSourceMessageId ??
						null,
					sourceDataModelMessageId:
						latestSources.dataModelMessageId ??
						activeDataModelMessage?.id ??
						null,
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

	return {
		generatePlanModeArtifact,
		generateDedicatedViews,
		repairDedicatedViewAfterMermaidFailure,
	};
}

export function usePlanModeArtifactGenerationForWorkspace(
	input: Omit<
		Parameters<typeof usePlanModeArtifactGeneration>[0],
		"activeDedicatedView" | "activeDedicatedMessage"
	> & {
		activeTab: PlanWorkspaceTab;
		workspace: PlanModeWorkspace | null;
		combinedTaskMessages: TaskMessage[];
	},
) {
	const activeDedicatedView =
		input.activeTab in tabToPlanView
			? tabToPlanView[input.activeTab as keyof typeof tabToPlanView]
			: null;
	const activeDedicatedArtifact = activeDedicatedView
		? [...(input.workspace?.dedicatedViewArtifacts || [])]
				.filter((artifact) => artifact.kind === activeDedicatedView)
				.sort((a, b) =>
					String(b.createdAt).localeCompare(String(a.createdAt)),
				)[0] || null
		: null;
	const activeDedicatedMessage = activeDedicatedArtifact
		? input.combinedTaskMessages.find(
				(message) => message.id === activeDedicatedArtifact.sourceMessageId,
			) || null
		: null;
	const actions = usePlanModeArtifactGeneration({
		...input,
		activeDedicatedView: isGenericPlanView(activeDedicatedView || "")
			? activeDedicatedView
			: null,
		activeDedicatedMessage,
	});
	return {
		activeDedicatedView,
		activeDedicatedArtifact,
		activeDedicatedMessage,
		...actions,
	};
}
