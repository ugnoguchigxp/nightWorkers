import { useState } from "react";
import { buildPlanModeExecutionSteps } from "../../../../shared/plan-mode-execution";
import type { EditablePlanModeRoutingView } from "../../../../shared/schemas/plan-mode-routing.schema";
import { Button } from "../../../components/ui/Button";
import type {
	DesignQuestionnaireSession,
	PlanModeSettings,
	PlanModeWorkspace,
} from "../../nightworkers/types";
import { getQuestionCount } from "../PlanModeQuestionnaire";
import {
	buildPlanArtifactStatusItems,
	PlanArtifactStatusCard,
	StatusActionButton,
} from "./PlanArtifactStatusCards";
import type {
	AdditionalPlanView,
	PlanViewDecision,
	PlanWorkspaceStatusStep,
} from "./types";
import { formatViewLabel, isAdditionalView } from "./types";

export { ViewDecisionSummary } from "./PlanArtifactStatusCards";

export function PlanWorkspaceStatusView({
	workspace,
	questionnaireSession,
	questionnaireSummary,
	busyAction,
	canGenerateDataModel,
	hasFeaturePlan,
	isImplementationLocked = false,
	planModeSettings,
	viewDecisions = [],
	onUpdateRouting,
	onOpenQuestionnaire,
	onGenerateAdditionalQuestions,
	onGenerateBlueprint,
	onGenerateDataModel,
	onGenerateFeaturePlan,
	onGenerateDedicatedViews,
	onQueueSession,
	onAddToQueue,
}: {
	workspace: PlanModeWorkspace | null;
	questionnaireSession: DesignQuestionnaireSession | null;
	questionnaireSummary?:
		| PlanModeWorkspace["questionnaireSessions"][number]
		| null;
	busyAction: string | null;
	canGenerateDataModel: boolean;
	hasFeaturePlan: boolean;
	isImplementationLocked?: boolean;
	planModeSettings?: PlanModeSettings;
	viewDecisions?: PlanViewDecision[];
	onUpdateRouting?: (
		view: EditablePlanModeRoutingView,
		decision: "include" | "omit",
	) => void | Promise<void>;
	onOpenQuestionnaire: () => void | Promise<void>;
	onGenerateAdditionalQuestions?: () => void | Promise<void>;
	onGenerateBlueprint: () => void | Promise<void>;
	onGenerateDataModel: () => void | Promise<void>;
	onGenerateFeaturePlan: () => void | Promise<void>;
	onGenerateDedicatedViews: (views: string[]) => void | Promise<void>;
	onQueueSession?: () => void | Promise<void>;
	onAddToQueue?: () => void | Promise<void>;
}) {
	const [isBatchGenerating, setIsBatchGenerating] = useState(false);
	const answeredCount = questionnaireSession?.answers.length || 0;
	const questionCount = questionnaireSession
		? getQuestionCount(questionnaireSession)
		: 0;
	const totalQuestionCount =
		questionnaireSummary?.totalQuestionCount ?? questionCount;
	const completedAnswerCount =
		questionnaireSummary?.answeredCount ?? answeredCount;
	const unansweredCount =
		questionnaireSummary?.unansweredCount ??
		Math.max(totalQuestionCount - completedAnswerCount, 0);
	const blockingUnansweredCount =
		questionnaireSummary?.blockingUnansweredCount ?? 0;
	const nonBlockingUnansweredCount =
		questionnaireSummary?.nonBlockingUnansweredCount ?? 0;
	const hasBlueprint = Boolean(workspace?.blueprintArtifacts.length);
	const hasDataModel = Boolean(workspace?.dataModelArtifacts.length);
	const capabilities = planModeSettings?.capabilities ?? {
		feature_plan: true,
		questionnaire: true,
		user_flow: true,
		blueprint: true,
		data_model: true,
		api_io_contract: true,
		activity_flow: true,
		sequence_flow: true,
		zod_schema_design: true,
	};
	const effectiveViewDecisions = workspace?.routing
		? workspace.routing.entries.map((entry) => ({
				view: entry.view,
				decision: entry.decision,
				reason: entry.reason,
			}))
		: viewDecisions;
	const includedAdditionalViews = effectiveViewDecisions.filter(
		(item): item is PlanViewDecision & { view: AdditionalPlanView } =>
			item.decision === "include" && isAdditionalView(item.view),
	);
	const generatedAdditionalViews = new Set<AdditionalPlanView>(
		(workspace?.dedicatedViewArtifacts || [])
			.map((artifact) => artifact.kind)
			.filter(isAdditionalView),
	);
	const disabledReason = "Settings で無効です。";
	const questionnaireDone = Boolean(
		questionnaireSession &&
			(questionnaireSession.status === "review_ready" ||
				questionnaireSession.status === "accepted"),
	);
	const executionSteps = buildPlanModeExecutionSteps({
		capabilities,
		viewDecisions: effectiveViewDecisions,
		questionnaireExists: Boolean(questionnaireSession),
		questionnaireComplete: questionnaireDone,
		existingArtifactKinds: [
			...(hasBlueprint ? (["blueprint"] as const) : []),
			...(hasDataModel ? (["data_model"] as const) : []),
			...generatedAdditionalViews,
			...(hasFeaturePlan ? (["feature_plan"] as const) : []),
		],
	});
	const executionStepByKey = new Map(
		executionSteps.map((step) => [step.key, step]),
	);
	const rawSteps: Array<PlanWorkspaceStatusStep | null> = [
		executionStepByKey.has("questionnaire")
			? {
					view: "questionnaire",
					progressKey: "questionnaire",
					number: 1,
					title: "Questionnaire",
					detail:
						totalQuestionCount > 0
							? `回答済み ${completedAnswerCount} / 未回答 ${unansweredCount} / 要回答 ${blockingUnansweredCount} / 任意 ${nonBlockingUnansweredCount}`
							: "回答済み 0 / 未回答 0 / 要回答 0 / 任意 0",
					badges: [
						blockingUnansweredCount > 0 ? "要回答" : null,
						blockingUnansweredCount === 0 && nonBlockingUnansweredCount > 0
							? "追加質問あり"
							: null,
					].filter((label): label is string => Boolean(label)),
					done: questionnaireDone,
					buttonLabel: questionnaireDone ? "回答を確認" : "回答する",
					busy: false,
					disabled: !capabilities.questionnaire,
					disabledReason: capabilities.questionnaire ? null : disabledReason,
					onClick: onOpenQuestionnaire,
					secondaryAction: onGenerateAdditionalQuestions
						? {
								label: "追加確認",
								busy: busyAction === "questionnaire-additional",
								disabled:
									isImplementationLocked ||
									!capabilities.questionnaire ||
									busyAction === "questionnaire-additional",
								onClick: onGenerateAdditionalQuestions,
							}
						: null,
					autoGenerate: false,
					autoGenerateKey: "questionnaire",
				}
			: null,
		executionStepByKey.has("blueprint")
			? {
					view: "blueprint",
					progressKey: "blueprint",
					number: 2,
					title: "Blueprint",
					detail: hasBlueprint
						? `${workspace?.blueprintArtifacts.length || 0}件のBlueprintがあります。`
						: "画面構成と主要UIセクションを生成します。",
					done: hasBlueprint,
					buttonLabel: hasBlueprint ? "再生成" : "生成",
					busy: busyAction === "blueprint",
					disabled: isImplementationLocked || !capabilities.blueprint,
					disabledReason: !capabilities.blueprint ? disabledReason : null,
					onClick: onGenerateBlueprint,
					autoGenerate: true,
					autoGenerateKey: "blueprint",
				}
			: null,
		executionStepByKey.has("data_model")
			? {
					view: "data_model",
					progressKey: "data_model",
					number: 3,
					title: "Data Model",
					detail: hasDataModel
						? `${workspace?.dataModelArtifacts.length || 0}件のData Modelがあります。`
						: "Data Modelでテーブル、カラム、リレーションを確認します。",
					done: hasDataModel,
					buttonLabel: hasDataModel ? "再生成" : "生成",
					busy: busyAction === "data-model",
					disabled:
						!canGenerateDataModel ||
						isImplementationLocked ||
						!capabilities.data_model,
					disabledReason: !capabilities.data_model ? disabledReason : null,
					onClick: onGenerateDataModel,
					autoGenerate: true,
					autoGenerateKey: "data-model",
				}
			: null,
		...includedAdditionalViews
			.filter((item) => executionStepByKey.has(`view:${item.view}`))
			.map((item, index) => {
				const view = item.view;
				const label = formatViewLabel(view);
				const generated = generatedAdditionalViews.has(view);
				const enabled = capabilities[view];
				return {
					view,
					progressKey: `view:${view}`,
					number: 4 + index,
					title: label,
					detail: generated
						? `${label}が作成済みです。`
						: item.reason || `${label}をPlan Mode Artifactとして作成します。`,
					done: generated,
					buttonLabel: generated ? "再生成" : "生成",
					busy: busyAction === `view:${view}`,
					disabled: isImplementationLocked || !enabled,
					disabledReason: enabled ? null : disabledReason,
					onClick: () => onGenerateDedicatedViews([view]),
					autoGenerate: true,
					autoGenerateKey: `view:${view}`,
				};
			}),
		{
			view: "feature_plan",
			progressKey: "feature_plan",
			number: 5,
			title: "仕様書",
			detail: hasFeaturePlan
				? "仕様書が作成済みです。"
				: "利用可能なPlan Mode Artifactを要約して仕様書を生成します。",
			done: hasFeaturePlan,
			buttonLabel: hasFeaturePlan ? "再生成" : "生成",
			busy: busyAction === "feature-plan",
			disabled: isImplementationLocked || !capabilities.feature_plan,
			disabledReason: !capabilities.feature_plan ? disabledReason : null,
			onClick: onGenerateFeaturePlan,
			autoGenerate: true,
			autoGenerateKey: "feature-plan",
		},
	];
	const steps = rawSteps.filter(
		(step): step is PlanWorkspaceStatusStep => step !== null,
	);
	const allIncludedArtifactsCreated = rawSteps
		.filter((step): step is PlanWorkspaceStatusStep => step !== null)
		.every((step) => step.done);
	const pendingGenerationSteps = steps.filter(
		(step) => step.autoGenerate && !step.done && !step.disabled,
	);
	const artifactItems = buildPlanArtifactStatusItems({
		steps,
		routingEntries: workspace?.routing?.entries ?? [],
		viewDecisions: effectiveViewDecisions,
		capabilities,
	});

	async function handleGenerateMissingArtifacts() {
		if (isBatchGenerating || pendingGenerationSteps.length === 0) return;
		setIsBatchGenerating(true);
		try {
			for (const step of pendingGenerationSteps) {
				await step.onClick();
			}
		} finally {
			setIsBatchGenerating(false);
		}
	}

	return (
		<div className="nightworkers-structured-artifact grid gap-3 text-xs">
			<h2 className="nightworkers-structured-artifact-text text-base font-semibold">
				設計アーティファクト
			</h2>
			<div className="nightworkers-plan-artifact-list">
				{artifactItems.map((item) => (
					<PlanArtifactStatusCard
						key={item.view}
						item={item}
						busyAction={busyAction}
						routing={workspace?.routing ?? null}
						routingDisabled={isImplementationLocked}
						onUpdateRouting={onUpdateRouting}
					/>
				))}
			</div>
			{workspace?.routing?.lockedReason ? (
				<div className="nightworkers-structured-artifact-warning">
					{workspace.routing.lockedReason}
				</div>
			) : null}
			{workspace?.routing ? (
				<div className="nightworkers-structured-artifact-muted">
					Routing revision: {workspace.routing.revision}
				</div>
			) : null}
			{pendingGenerationSteps.length > 0 ? (
				<div className="flex justify-end">
					<Button
						loading={isBatchGenerating}
						disabled={Boolean(busyAction)}
						maxLabelLength={30}
						onClick={() => void handleGenerateMissingArtifacts()}
					>
						未作成をまとめて生成
					</Button>
				</div>
			) : null}
			{allIncludedArtifactsCreated ? (
				<div className="mt-4">
					<div className="flex flex-wrap justify-center gap-3">
						<StatusActionButton
							label="今すぐ実装開始"
							busy={busyAction === "start-session"}
							disabled={!onQueueSession || isImplementationLocked}
							onClick={() => onQueueSession?.()}
							size="lg"
						/>
						<StatusActionButton
							label="キューに追加"
							busy={busyAction === "add-to-queue"}
							disabled={!onAddToQueue || isImplementationLocked}
							onClick={() => onAddToQueue?.()}
							size="lg"
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}
