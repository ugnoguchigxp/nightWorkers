import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildPlanModeExecutionSteps } from "../../../../shared/plan-mode-execution";
import type { MissionPilotPlanProgress } from "../../../../shared/schemas/mission-pilot-plan-progress.schema";
import type {
	DesignQuestionnaireSession,
	PlanModeSettings,
	PlanModeWorkspace,
} from "../../nightworkers/types";
import { getQuestionCount } from "../PlanModeQuestionnaire";
import {
	readPlanModeSequentialAutoGeneratePreference,
	writePlanModeSequentialAutoGeneratePreference,
} from "./storage";
import type {
	AdditionalPlanView,
	PlanViewDecision,
	PlanWorkspaceStatusStep,
} from "./types";
import { formatViewLabel, isAdditionalView } from "./types";

export function PlanWorkspaceStatusView({
	workspace,
	missionPilotPlanProgress,
	questionnaireSession,
	questionnaireSummary,
	busyAction,
	canGenerateDataModel,
	hasFeaturePlan,
	isImplementationLocked = false,
	planModeSettings,
	viewDecisions = [],
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
	missionPilotPlanProgress?: MissionPilotPlanProgress | null;
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
	onOpenQuestionnaire: () => void;
	onGenerateAdditionalQuestions?: () => void;
	onGenerateBlueprint: () => void;
	onGenerateDataModel: () => void;
	onGenerateFeaturePlan: () => void;
	onGenerateDedicatedViews: (views: string[]) => void;
	onQueueSession?: () => void;
	onAddToQueue?: () => void;
}) {
	const [sequentialAutoGenerate, setSequentialAutoGenerate] = useState(
		readPlanModeSequentialAutoGeneratePreference,
	);
	const autoGenerateInFlightStepRef = useRef<string | null>(null);
	const autoGenerateBlockedStepRef = useRef<string | null>(null);
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
	const includedAdditionalViews = viewDecisions.filter(
		(item): item is PlanViewDecision & { view: AdditionalPlanView } =>
			item.decision === "include" && isAdditionalView(item.view),
	);
	const generatedAdditionalViews = new Set<AdditionalPlanView>(
		(workspace?.dedicatedViewArtifacts || [])
			.map((artifact) => artifact.kind)
			.filter(isAdditionalView),
	);
	const disabledReason = "Plan Mode capability is disabled in Settings.";
	const questionnaireDone = Boolean(
		questionnaireSession &&
			(questionnaireSession.status === "review_ready" ||
				questionnaireSession.status === "accepted"),
	);
	const executionSteps = buildPlanModeExecutionSteps({
		capabilities,
		viewDecisions,
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
					progressKey: "questionnaire",
					number: 1,
					title: "仕様に関する質問を回答してください",
					detail:
						totalQuestionCount > 0
							? `回答済み ${completedAnswerCount} / 未回答 ${unansweredCount} / 要回答 ${blockingUnansweredCount} / 任意 ${nonBlockingUnansweredCount}`
							: "仕様判断に必要な質問を先に確認します。",
					badges: [
						blockingUnansweredCount > 0 ? "要回答" : null,
						blockingUnansweredCount === 0 && nonBlockingUnansweredCount > 0
							? "追加質問あり"
							: null,
					].filter((label): label is string => Boolean(label)),
					done: questionnaireDone,
					buttonLabel: questionnaireDone ? "アンケートを確認" : "アンケートへ",
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
					progressKey: "blueprint",
					number: 2,
					title: "インスタントMockUpを作成し、大筋UIの方向性を決めます",
					detail: hasBlueprint
						? `${workspace?.blueprintArtifacts.length || 0}件のBlueprintがあります。`
						: "画面構成と主要UIセクションを生成します。",
					done: hasBlueprint,
					buttonLabel: hasBlueprint ? "Blueprintを再生成" : "Blueprint作成",
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
					progressKey: "data_model",
					number: 3,
					title: "どの様なデータモデルが必要になるかプレビュー出来ます",
					detail: hasDataModel
						? `${workspace?.dataModelArtifacts.length || 0}件のData Modelがあります。`
						: "Data Modelでテーブル、カラム、リレーションを確認します。",
					done: hasDataModel,
					buttonLabel: hasDataModel ? "Data Modelを再生成" : "Data Model作成",
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
					progressKey: `view:${view}`,
					number: 4 + index,
					title: `${label}を作成します`,
					detail: generated
						? `${label}が作成済みです。`
						: item.reason || `${label}をPlan Mode Artifactとして作成します。`,
					done: generated,
					buttonLabel: generated ? `${label}を再生成` : `${label}作成`,
					busy: busyAction === `view:${view}`,
					disabled: isImplementationLocked || !enabled,
					disabledReason: enabled ? null : disabledReason,
					onClick: () => onGenerateDedicatedViews([view]),
					autoGenerate: true,
					autoGenerateKey: `view:${view}`,
				};
			}),
		{
			progressKey: "feature_plan",
			number: 5,
			title: "仕様書を作成します",
			detail: hasFeaturePlan
				? "仕様書が作成済みです。"
				: "利用可能なPlan Mode Artifactを要約して仕様書を生成します。",
			done: hasFeaturePlan,
			buttonLabel: hasFeaturePlan ? "仕様書を再生成" : "仕様書作成",
			busy: busyAction === "feature-plan",
			disabled: isImplementationLocked || !capabilities.feature_plan,
			disabledReason: !capabilities.feature_plan ? disabledReason : null,
			onClick: onGenerateFeaturePlan,
			autoGenerate: true,
			autoGenerateKey: "feature-plan",
		},
	];
	const persistedStepByKey = new Map(
		(missionPilotPlanProgress?.steps || []).map((step) => [step.key, step]),
	);
	const missionPilotIsRunning =
		missionPilotPlanProgress?.desiredState === "playing";
	const steps = rawSteps
		.filter((step): step is PlanWorkspaceStatusStep => step !== null)
		.map((step) => {
			const persisted = persistedStepByKey.get(step.progressKey);
			if (!persisted) return step;
			const running = persisted.status === "running";
			const failed = persisted.status === "failed";
			return {
				...step,
				done: persisted.status === "completed",
				busy: running || step.busy,
				disabled: step.disabled || Boolean(missionPilotIsRunning),
				detail: running
					? `${formatViewLabel(persisted.view || persisted.kind)}を生成中です。`
					: failed
						? persisted.lastError || "生成に失敗しました。"
						: step.detail,
				progressStatus: persisted.status,
				progressError: persisted.lastError,
			};
		});
	const allStepsDone = steps.every((step) => step.done);
	const implementationActionsReady =
		allStepsDone &&
		(!missionPilotPlanProgress ||
			missionPilotPlanProgress.review?.status === "passed");
	const implementationActionsBlockedReason =
		allStepsDone && !implementationActionsReady
			? missionPilotPlanProgress?.desiredState === "stopped"
				? "Mission Pilotを再生してレビュー修正を完了してください。"
				: "Mission Pilotのレビューが完了すると実装できます。"
			: null;
	const nextAutoGenerateStep = steps.find(
		(step) => step.autoGenerate && !step.done && !step.disabled,
	);

	useEffect(() => {
		if (!sequentialAutoGenerate || busyAction || !nextAutoGenerateStep) {
			if (!nextAutoGenerateStep) autoGenerateBlockedStepRef.current = null;
			return;
		}
		if (autoGenerateInFlightStepRef.current) return;
		if (
			autoGenerateBlockedStepRef.current ===
			nextAutoGenerateStep.autoGenerateKey
		)
			return;
		autoGenerateInFlightStepRef.current = nextAutoGenerateStep.autoGenerateKey;
		void Promise.resolve(nextAutoGenerateStep.onClick()).finally(() => {
			autoGenerateInFlightStepRef.current = null;
			autoGenerateBlockedStepRef.current = nextAutoGenerateStep.autoGenerateKey;
		});
	}, [busyAction, nextAutoGenerateStep, sequentialAutoGenerate]);

	function handleSequentialAutoGenerateChange(enabled: boolean) {
		setSequentialAutoGenerate(enabled);
		writePlanModeSequentialAutoGeneratePreference(enabled);
		autoGenerateBlockedStepRef.current = null;
	}

	return (
		<div className="nightworkers-structured-artifact grid gap-3 text-xs">
			<div>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="nightworkers-structured-artifact-text text-base font-semibold">
						Status
					</h2>
					<label className="nightworkers-structured-artifact-muted inline-flex items-center gap-2 text-[11px]">
						<input
							type="checkbox"
							checked={sequentialAutoGenerate}
							onChange={(event) =>
								handleSequentialAutoGenerateChange(event.target.checked)
							}
						/>
						順次自動生成
					</label>
				</div>
				<p className="nightworkers-structured-artifact-muted mt-1">
					必要なArtifactを確認し、仕様書を作成します。
				</p>
			</div>
			<ViewDecisionSummary decisions={viewDecisions} />
			{missionPilotPlanProgress ? (
				<MissionPilotPlanPhase progress={missionPilotPlanProgress} />
			) : null}
			<div className="grid gap-3">
				{steps.map((step, index) => {
					const displayNumber = index + 1;
					return (
						<div
							key={`${step.number}-${step.title}`}
							className="nightworkers-structured-artifact-card grid gap-3 rounded border p-3 md:grid-cols-[1fr_auto] md:items-center"
						>
							<div className="flex gap-3">
								<div className="flex flex-col items-center">
									<div
										className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
											step.progressStatus === "failed"
												? "nightworkers-structured-artifact-warning-pill"
												: step.done
													? "nightworkers-structured-artifact-success-pill"
													: "nightworkers-structured-artifact-neutral-pill"
										}`}
									>
										{step.progressStatus === "running" ? (
											<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
										) : step.progressStatus === "failed" ? (
											<CircleAlert className="h-3.5 w-3.5" />
										) : step.done ? (
											<Check className="h-3.5 w-3.5" />
										) : (
											displayNumber
										)}
									</div>
									{index < steps.length - 1 ? (
										<div className="mt-2 min-h-8 w-px flex-1 bg-slate-800" />
									) : null}
								</div>
								<div className="min-w-0">
									<div className="nightworkers-structured-artifact-text text-sm font-semibold">
										{displayNumber}. {step.title}
									</div>
									<div className="nightworkers-structured-artifact-muted mt-1">
										{step.detail}
									</div>
									{step.badges?.length ? (
										<div className="mt-2 flex flex-wrap gap-1">
											{step.badges.map((badge) => (
												<span
													key={badge}
													className={`rounded border px-2 py-0.5 text-[10px] ${
														badge === "要回答"
															? "nightworkers-structured-artifact-warning-pill"
															: "nightworkers-structured-artifact-action"
													}`}
												>
													{badge}
												</span>
											))}
										</div>
									) : null}
									{step.disabledReason ? (
										<div className="nightworkers-structured-artifact-warning mt-1 text-[11px]">
											{step.disabledReason}
										</div>
									) : null}
								</div>
							</div>
							<div className="flex flex-wrap justify-end gap-2">
								{step.secondaryAction ? (
									<StatusActionButton
										label={step.secondaryAction.label}
										busy={step.secondaryAction.busy}
										disabled={step.secondaryAction.disabled}
										onClick={step.secondaryAction.onClick}
									/>
								) : null}
								<StatusActionButton
									label={step.buttonLabel}
									busy={step.busy}
									disabled={step.disabled}
									onClick={step.onClick}
								/>
							</div>
						</div>
					);
				})}
			</div>
			{allStepsDone ? (
				<div className="mt-4">
					<div className="flex flex-wrap justify-center gap-3">
						<StatusActionButton
							label="今すぐ実装開始"
							busy={busyAction === "start-session"}
							disabled={
								!onQueueSession ||
								isImplementationLocked ||
								!implementationActionsReady
							}
							onClick={() => onQueueSession?.()}
							size="lg"
						/>
						<StatusActionButton
							label="キューに追加"
							busy={busyAction === "add-to-queue"}
							disabled={
								!onAddToQueue ||
								isImplementationLocked ||
								!implementationActionsReady
							}
							onClick={() => onAddToQueue?.()}
							size="lg"
						/>
					</div>
					{implementationActionsBlockedReason ? (
						<div className="nightworkers-structured-artifact-warning mt-2 text-center text-xs">
							{implementationActionsBlockedReason}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function MissionPilotPlanPhase({
	progress,
}: {
	progress: MissionPilotPlanProgress;
}) {
	const labels: Record<string, string> = {
		generating_artifacts: "Plan Artifactを生成しています",
		reviewing_plan: "実装計画をレビューしています",
		revising_plan: "レビュー指摘を反映しています",
		awaiting_artifact_correction: "Artifact修正の準備をしています",
		correcting_artifact: "Plan Mode agentがArtifactを修正しています",
		validating_artifact: "Artifact修正結果を確認しています",
		revising_dependencies: "依存Artifactを最新状態へ揃えています",
		attention: "確認が必要です",
		queued: "Implementation Queueへ追加済みです",
	};
	const label = labels[progress.phase];
	if (!label && !progress.lastError) return null;
	return (
		<div
			className={`nightworkers-structured-artifact-card rounded border p-3 ${
				progress.phase === "attention"
					? "nightworkers-structured-artifact-warning"
					: "nightworkers-structured-artifact-muted"
			}`}
		>
			<div className="font-semibold">{label || progress.phase}</div>
			{progress.lastError ? (
				<div className="mt-1">{progress.lastError}</div>
			) : null}
			{progress.activeCorrection ? (
				<div className="mt-1">
					対象: {formatViewLabel(progress.activeCorrection.target)} /{" "}
					{progress.activeCorrection.status}
				</div>
			) : null}
			{progress.review && progress.review.status !== "pending" ? (
				<div className="mt-1">
					Self-review: {progress.review.status}（{progress.review.attempt}回目）
				</div>
			) : null}
		</div>
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
	busy,
	disabled,
	onClick,
	size = "sm",
}: {
	label: string;
	busy: boolean;
	disabled?: boolean;
	onClick: () => void;
	size?: "sm" | "lg";
}) {
	return (
		<button
			type="button"
			className={`nightworkers-structured-artifact-action inline-flex items-center gap-1.5 rounded border disabled:cursor-not-allowed disabled:opacity-45 ${
				size === "lg" ? "px-4 py-2 text-sm font-semibold" : "px-2 py-1 text-xs"
			}`}
			disabled={busy || disabled}
			onClick={onClick}
		>
			{busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
			{label}
		</button>
	);
}
