import {
	type DedicatedDesignView,
	dedicatedDesignViewSchema,
	type PlanModeArtifactKind,
	type PlanModeCapability,
	type PlanModeViewDecision,
} from "./schemas/plan-mode-artifact.schema";
import type { PlanModeRoutingView } from "./schemas/plan-mode-routing.schema";

export const PLAN_MODE_EXECUTION_VIEW_ORDER = [
	"questionnaire",
	"blueprint",
	"data_model",
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
	"feature_plan",
] as const satisfies readonly PlanModeRoutingView[];

export const PLAN_MODE_UPSTREAM_VIEW_ORDER =
	PLAN_MODE_EXECUTION_VIEW_ORDER.filter(
		(view) => view !== "questionnaire" && view !== "feature_plan",
	);

export type PlanModeStepAction =
	| (() => boolean)
	| (() => void)
	| (() => Promise<boolean>)
	| (() => Promise<void>);

export type PlanModeExecutionStepKind =
	| "questionnaire"
	| "blueprint"
	| "data_model"
	| "dedicated_view"
	| "feature_plan";

export type PlanModeExecutionStep = {
	key: string;
	kind: PlanModeExecutionStepKind;
	view: PlanModeArtifactKind | null;
	ordinal: number;
	required: boolean;
	enabled: boolean;
	decision: "include" | "omit";
	status: "pending" | "completed" | "skipped";
};

export function buildPlanModeExecutionSteps(input: {
	capabilities: Record<PlanModeCapability, boolean>;
	viewDecisions: PlanModeViewDecision[];
	questionnaireExists: boolean;
	questionnaireComplete: boolean;
	existingArtifactKinds: Iterable<PlanModeArtifactKind>;
}): PlanModeExecutionStep[] {
	const existing = new Set(input.existingArtifactKinds);
	const decisionByView = new Map(
		input.viewDecisions.map((item) => [item.view, item.decision]),
	);
	const hasRouting = input.viewDecisions.length > 0;
	const result: Omit<PlanModeExecutionStep, "ordinal">[] = [];
	const push = (
		step: Omit<PlanModeExecutionStep, "ordinal">,
		visible = true,
	) => {
		if (visible) result.push(step);
	};
	const decisionFor = (view: DedicatedDesignView) =>
		view === "questionnaire"
			? "include"
			: decisionByView.get(view) === "omit"
				? "omit"
				: "include";
	const visibleDefault = (
		view: DedicatedDesignView,
		exists: boolean,
		defaultWhenUnrouted = false,
	) =>
		decisionFor(view) !== "omit" &&
		(exists ||
			decisionByView.get(view) === "include" ||
			(!hasRouting && defaultWhenUnrouted && input.capabilities[view]));

	push(
		{
			key: "questionnaire",
			kind: "questionnaire",
			view: "questionnaire",
			required: true,
			enabled: true,
			decision: "include",
			status: input.questionnaireComplete ? "completed" : "pending",
		},
		true,
	);

	for (const view of ["blueprint", "data_model"] as const) {
		const enabled = input.capabilities[view];
		const decision = decisionFor(view);
		push(
			{
				key: view,
				kind: view,
				view,
				required: decision === "include",
				enabled,
				decision,
				status:
					decision === "omit" || !enabled
						? "skipped"
						: existing.has(view)
							? "completed"
							: "pending",
			},
			visibleDefault(view, existing.has(view)),
		);
	}

	for (const candidate of PLAN_MODE_EXECUTION_VIEW_ORDER) {
		const parsedView = dedicatedDesignViewSchema.safeParse(candidate);
		if (!parsedView.success) continue;
		const view = parsedView.data;
		if (
			view === "questionnaire" ||
			view === "blueprint" ||
			view === "data_model" ||
			decisionByView.get(view) !== "include"
		)
			continue;
		const enabled = input.capabilities[view];
		result.push({
			key: `view:${view}`,
			kind: "dedicated_view",
			view,
			required: true,
			enabled,
			decision: "include",
			status: !enabled
				? "skipped"
				: existing.has(view)
					? "completed"
					: "pending",
		});
	}

	result.push({
		key: "feature_plan",
		kind: "feature_plan",
		view: "feature_plan",
		required: true,
		enabled: true,
		decision: "include",
		status: existing.has("feature_plan") ? "completed" : "pending",
	});

	return result.map((step, index) => ({ ...step, ordinal: index + 1 }));
}

export function buildPlanModeBatchGenerationSteps<
	T extends {
		view: PlanModeRoutingView;
		autoGenerate: boolean;
		done: boolean;
		disabled: boolean;
	},
>(steps: readonly T[]): T[] {
	const stepByView = new Map(steps.map((step) => [step.view, step]));
	const ordered = PLAN_MODE_EXECUTION_VIEW_ORDER.flatMap((view) => {
		const step = stepByView.get(view);
		return step ? [step] : [];
	});
	const pending = ordered.filter(
		(step) => step.autoGenerate && !step.done && !step.disabled,
	);
	const pendingUpstream = pending.filter(
		(step) => step.view !== "feature_plan",
	);
	if (pendingUpstream.length === 0) return pending;
	const featurePlan = stepByView.get("feature_plan");
	if (!featurePlan?.autoGenerate || featurePlan.disabled)
		return pendingUpstream;
	return [...pendingUpstream, featurePlan];
}

export async function executePlanModeBatchGenerationSteps<
	T extends { onClick: PlanModeStepAction },
>(steps: readonly T[]) {
	for (const step of steps) {
		if ((await step.onClick()) === false) return false;
	}
	return true;
}

export function isPlanModeArtifactCurrentForRouting(
	artifact: { routingRevision?: number | null },
	currentRoutingRevision: number | null | undefined,
) {
	if (currentRoutingRevision === undefined || currentRoutingRevision === null)
		return true;
	if (artifact.routingRevision === currentRoutingRevision) return true;
	return currentRoutingRevision === 0 && artifact.routingRevision == null;
}

export function resolveIncludedPlanModeViews(input: {
	routingEntries?: Iterable<{
		view: string;
		decision: "include" | "omit";
		capabilityEnabled?: boolean;
	}>;
	viewDecisions?: Iterable<{
		view: string;
		decision: "include" | "omit";
	}>;
}) {
	if (input.routingEntries) {
		return new Set(
			[...input.routingEntries]
				.filter(
					(entry) =>
						entry.decision === "include" && entry.capabilityEnabled !== false,
				)
				.map((entry) => entry.view),
		);
	}
	return new Set(
		[...(input.viewDecisions ?? [])]
			.filter((entry) => entry.decision === "include")
			.map((entry) => entry.view),
	);
}

export function findMissingPlanModeUpstreamViews(input: {
	includedViews: Iterable<string>;
	existingArtifactKinds: Iterable<string>;
}) {
	const included = new Set(input.includedViews);
	const existing = new Set(input.existingArtifactKinds);
	return PLAN_MODE_UPSTREAM_VIEW_ORDER.filter(
		(view) => included.has(view) && !existing.has(view),
	);
}
