import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type {
	EditablePlanModeRoutingView,
	PlanModeRoutingEntry,
	PlanModeRoutingView,
} from "../../../../shared/schemas/plan-mode-routing.schema";
import { Button } from "../../../components/ui/Button";
import type {
	PlanModeSettings,
	PlanModeWorkspace,
} from "../../nightworkers/types";
import type { PlanViewDecision, PlanWorkspaceStatusStep } from "./types";
import { formatViewLabel } from "./types";

export type PlanArtifactStatusItem = {
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

export function buildPlanArtifactStatusItems({
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

export function PlanArtifactStatusCard({
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

export function StatusActionButton({
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
