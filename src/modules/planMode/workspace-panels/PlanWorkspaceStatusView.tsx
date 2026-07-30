import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { buildPlanModeExecutionSteps } from "../../../../shared/plan-mode-execution";
import type {
	EditablePlanModeRoutingView,
	PlanModeRoutingEntry,
	PlanModeRoutingView,
} from "../../../../shared/schemas/plan-mode-routing.schema";
import { Button } from "../../../components/ui/Button";
import type {
	DesignQuestionnaireSession,
	PlanModeSettings,
	PlanModeWorkspace,
} from "../../nightworkers/types";
import { getQuestionCount } from "../PlanModeQuestionnaire";
import type {
	AdditionalPlanView,
	PlanViewDecision,
	PlanWorkspaceStatusStep,
} from "./types";
import { formatViewLabel, isAdditionalView } from "./types";

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

type PlanArtifactStatusItem = {
	view: PlanModeRoutingView;
	label: string;
	included: boolean;
	required: boolean;
	capabilityEnabled: boolean;
	reason?: string;
	step?: PlanWorkspaceStatusStep;
};

const PLAN_MODE_ROUTING_VIEWS: readonly PlanModeRoutingView[] = [
	"questionnaire",
	"blueprint",
	"data_model",
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
	"feature_plan",
];

const PLAN_ARTIFACT_DESCRIPTIONS: Record<PlanModeRoutingView, string> = {
	questionnaire: "実装前に確認が必要な仕様判断を整理します。",
	blueprint: "画面構成と主要UIの方向性を確認します。",
	data_model: "データ構造とリレーションを確認します。",
	user_flow: "ユーザー操作の流れを確認します。",
	api_io_contract: "APIの入出力と境界を確認します。",
	activity_flow: "主要な処理と状態遷移を確認します。",
	sequence_flow: "処理の呼び出し順序を確認します。",
	zod_schema_design: "入力検証スキーマを確認します。",
	feature_plan: "確定した設計を実装仕様としてまとめます。",
};

function isPlanModeRoutingView(value: string): value is PlanModeRoutingView {
	return (PLAN_MODE_ROUTING_VIEWS as readonly string[]).includes(value);
}

function buildPlanArtifactStatusItems({
	steps,
	routingEntries,
	viewDecisions,
	capabilities,
}: {
	steps: PlanWorkspaceStatusStep[];
	routingEntries: PlanModeRoutingEntry[];
	viewDecisions: PlanViewDecision[];
	capabilities: PlanModeSettings["capabilities"];
}): PlanArtifactStatusItem[] {
	const stepByView = new Map(steps.map((step) => [step.view, step]));
	const routingEntryByView = new Map(
		routingEntries.map((entry) => [entry.view, entry]),
	);
	const decisionByView = new Map(
		viewDecisions
			.filter((decision) => isPlanModeRoutingView(decision.view))
			.map((decision) => [decision.view, decision]),
	);
	const orderedViews = new Set<PlanModeRoutingView>();
	for (const entry of routingEntries) orderedViews.add(entry.view);
	for (const step of steps) orderedViews.add(step.view);
	for (const decision of viewDecisions) {
		if (isPlanModeRoutingView(decision.view)) orderedViews.add(decision.view);
	}

	return [...orderedViews].map((view) => {
		const routingEntry = routingEntryByView.get(view);
		const decision = decisionByView.get(view);
		const step = stepByView.get(view);
		const required = Boolean(
			routingEntry?.required ||
				view === "questionnaire" ||
				view === "feature_plan",
		);
		const included = required
			? true
			: routingEntry
				? routingEntry.decision === "include"
				: step
					? true
					: decision?.decision === "include";
		return {
			view,
			label: formatViewLabel(view),
			included,
			required,
			capabilityEnabled: routingEntry?.capabilityEnabled ?? capabilities[view],
			reason: routingEntry
				? routingEntry.decision === (included ? "include" : "omit")
					? routingEntry.reason
					: undefined
				: decision?.decision === (included ? "include" : "omit")
					? decision.reason
					: undefined,
			step,
		};
	});
}

function PlanArtifactStatusCard({
	item,
	busyAction,
	routing,
	routingDisabled,
	onUpdateRouting,
}: {
	item: PlanArtifactStatusItem;
	busyAction: string | null;
	routing: PlanModeWorkspace["routing"] | null;
	routingDisabled: boolean;
	onUpdateRouting?: (
		view: EditablePlanModeRoutingView,
		decision: "include" | "omit",
	) => void | Promise<void>;
}) {
	const step = item.step;
	const changing = busyAction === `routing:${item.view}`;
	const routingEntry = routing?.entries.find(
		(entry) => entry.view === item.view,
	);
	const routingLocked =
		!routingEntry ||
		item.required ||
		!item.capabilityEnabled ||
		routingDisabled ||
		!routing?.editable ||
		!onUpdateRouting ||
		Boolean(busyAction);
	const status = !item.included
		? "omitted"
		: step?.progressStatus === "failed"
			? "failed"
			: step?.progressStatus === "running" || step?.busy
				? "running"
				: step?.done
					? "done"
					: "pending";
	const statusLabel = {
		omitted: "対象外",
		failed: "生成失敗",
		running: "生成中",
		done: "作成済み",
		pending: "未作成",
	}[status];
	const statusPillClass =
		status === "done"
			? "nightworkers-structured-artifact-success-pill"
			: status === "failed"
				? "nightworkers-structured-artifact-warning-pill"
				: "nightworkers-structured-artifact-neutral-pill";
	const showQuestionnaireProgress =
		item.view === "questionnaire" && item.included && step;
	const showProgressMessage =
		item.included &&
		step &&
		(step.progressStatus === "running" || step.progressStatus === "failed");

	return (
		<article
			className="nightworkers-plan-artifact-card"
			data-included={item.included}
			data-status={status}
		>
			<div className="nightworkers-plan-artifact-card-main">
				<input
					aria-label={
						item.required
							? `${item.label}は必須です`
							: `${item.label}を${item.included ? "対象外" : "有効"}にする`
					}
					checked={item.included}
					className="nightworkers-plan-artifact-toggle"
					disabled={routingLocked}
					onChange={(event) => {
						if (!routingEntry || item.required) return;
						void onUpdateRouting?.(
							item.view as EditablePlanModeRoutingView,
							event.target.checked ? "include" : "omit",
						);
					}}
					type="checkbox"
				/>
				<div className="min-w-0 flex-1">
					<div className="nightworkers-plan-artifact-card-title-row">
						<h3 className="nightworkers-structured-artifact-text text-sm font-semibold">
							{item.label}
						</h3>
						{item.required ? (
							<span className="nightworkers-structured-artifact-action nightworkers-plan-artifact-badge">
								必須
							</span>
						) : null}
						<span
							className={`${statusPillClass} nightworkers-plan-artifact-badge`}
						>
							{statusLabel}
						</span>
						{changing ? (
							<span className="nightworkers-structured-artifact-muted">
								更新中…
							</span>
						) : null}
					</div>
					{item.reason ? (
						<p className="nightworkers-structured-artifact-muted mt-1">
							{item.included ? "必要な理由" : "対象外の理由"}: {item.reason}
						</p>
					) : null}
					{showQuestionnaireProgress ? (
						<p className="nightworkers-structured-artifact-muted mt-1">
							{step.detail}
						</p>
					) : null}
					{showProgressMessage ? (
						<p className="nightworkers-structured-artifact-warning mt-1">
							{step.detail}
						</p>
					) : null}
					{step?.badges?.length ? (
						<div className="mt-2 flex flex-wrap gap-1">
							{step.badges.map((badge) => (
								<span
									key={badge}
									className={`${
										badge === "要回答"
											? "nightworkers-structured-artifact-warning-pill"
											: "nightworkers-structured-artifact-action"
									} nightworkers-plan-artifact-badge`}
								>
									{badge}
								</span>
							))}
						</div>
					) : null}
					{!item.capabilityEnabled ? (
						<p className="nightworkers-structured-artifact-warning mt-1">
							Settings で無効です。
						</p>
					) : step?.disabledReason ? (
						<p className="nightworkers-structured-artifact-warning mt-1">
							{step.disabledReason}
						</p>
					) : null}
				</div>
				{status === "done" ? (
					<div
						aria-label={`${item.label}は作成済みです`}
						className="nightworkers-plan-artifact-complete-mark"
						role="img"
					>
						<Check aria-hidden="true" />
					</div>
				) : status === "running" ? (
					<div className="nightworkers-plan-artifact-state-mark">
						<LoaderCircle aria-label="生成中" className="animate-spin" />
					</div>
				) : status === "failed" ? (
					<div className="nightworkers-plan-artifact-state-mark">
						<CircleAlert aria-label="生成失敗" />
					</div>
				) : null}
			</div>
			{item.included && step ? (
				<div className="nightworkers-plan-artifact-actions">
					<p className="nightworkers-plan-artifact-description">
						{PLAN_ARTIFACT_DESCRIPTIONS[item.view]}
					</p>
					<div className="nightworkers-plan-artifact-action-buttons">
						{step.secondaryAction ? (
							<StatusActionButton
								label={step.secondaryAction.label}
								ariaLabel={`${item.label}${step.secondaryAction.label}`}
								busy={step.secondaryAction.busy}
								disabled={step.secondaryAction.disabled}
								onClick={step.secondaryAction.onClick}
							/>
						) : null}
						<StatusActionButton
							label={step.buttonLabel}
							ariaLabel={
								item.view === "questionnaire"
									? step.buttonLabel
									: `${item.label}${step.done ? "を再生成" : "を生成"}`
							}
							busy={step.busy}
							disabled={step.disabled}
							onClick={step.onClick}
							primary={!step.done}
						/>
					</div>
				</div>
			) : null}
		</article>
	);
}

export function ViewDecisionSummary({
	decisions,
}: {
	decisions: PlanViewDecision[];
}) {
	if (decisions.length === 0) return null;
	return (
		<div className="nightworkers-structured-artifact-card grid gap-2 rounded border p-3 text-xs">
			<div className="nightworkers-structured-artifact-text font-semibold">
				View decisions
			</div>
			<div className="flex flex-wrap gap-2">
				{decisions.map((decision) => (
					<span
						key={`${decision.view}-${decision.decision}`}
						className={`rounded border px-2 py-1 ${
							decision.decision === "include"
								? "nightworkers-structured-artifact-success-pill"
								: "nightworkers-structured-artifact-neutral-pill"
						}`}
					>
						{formatViewLabel(decision.view)}: {decision.decision}
						{decision.reason ? ` - ${decision.reason}` : ""}
					</span>
				))}
			</div>
		</div>
	);
}

function StatusActionButton({
	label,
	ariaLabel,
	busy,
	disabled,
	onClick,
	size = "sm",
	primary = false,
}: {
	label: string;
	ariaLabel?: string;
	busy: boolean;
	disabled?: boolean;
	onClick: () => void | Promise<void>;
	size?: "sm" | "lg";
	primary?: boolean;
}) {
	return (
		<Button
			aria-label={ariaLabel}
			variant={primary ? "default" : "outline"}
			size={size}
			loading={busy}
			disabled={disabled}
			maxLabelLength={30}
			onClick={onClick}
		>
			{label}
		</Button>
	);
}
