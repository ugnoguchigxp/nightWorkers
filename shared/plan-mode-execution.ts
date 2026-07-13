import {
	type DedicatedDesignView,
	dedicatedDesignViewSchema,
	type PlanModeArtifactKind,
	type PlanModeCapability,
	type PlanModeViewDecision,
} from "./schemas/plan-mode-artifact.schema";

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

	const addedAdditionalViews = new Set<DedicatedDesignView>();
	for (const item of input.viewDecisions) {
		const parsedView = dedicatedDesignViewSchema.safeParse(item.view);
		if (!parsedView.success) continue;
		const view = parsedView.data;
		if (
			view === "questionnaire" ||
			view === "blueprint" ||
			view === "data_model" ||
			item.decision !== "include"
		)
			continue;
		if (addedAdditionalViews.has(view)) continue;
		addedAdditionalViews.add(view);
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
