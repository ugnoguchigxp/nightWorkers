import {
	EDITABLE_PLAN_MODE_ROUTING_VIEWS,
	type PlanModeRoutingEntry,
	type PlanModeRoutingView,
	REQUIRED_PLAN_MODE_ROUTING_VIEWS,
} from "../../../shared/schemas/plan-mode-routing.schema";

export const ALL_PLAN_MODE_ROUTING_VIEWS: readonly PlanModeRoutingView[] = [
	...REQUIRED_PLAN_MODE_ROUTING_VIEWS,
	...EDITABLE_PLAN_MODE_ROUTING_VIEWS,
];

const REQUIRED_VIEWS = new Set<PlanModeRoutingView>(
	REQUIRED_PLAN_MODE_ROUTING_VIEWS,
);
const LEGACY_INITIAL_OMIT_REASON = "初期 routing では省略されています。";
type RoutingMessage = { metadataJson: unknown };
type RoutingCapabilities = Partial<Record<PlanModeRoutingView, boolean>>;

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function defaultRoutingReason(input: {
	required: boolean;
	generated: boolean;
	capabilityEnabled: boolean;
	decision: "include" | "omit";
}) {
	if (input.required) return "Plan Mode の必須 Artifact です。";
	if (!input.capabilityEnabled)
		return "Settingsで無効なため、今回のPlan Artifact対象外です。";
	if (input.generated) return "既存 Artifact を初期 routing に引き継ぎました。";
	return input.decision === "include"
		? "現在のPlan Mode判断で必要なArtifactとして選択されています。"
		: "Questionnaire確定後に、このTaskで必要かを判断します。";
}

export function planModeRoutingTerminalReason(_status: string) {
	// Routing is revisioned configuration. Task lifecycle state must not make it
	// read-only; concurrent generation and revision checks protect active writes.
	return null;
}

export function buildInitialPlanModeRoutingEntries(
	messages: RoutingMessage[],
	capabilities: RoutingCapabilities,
): PlanModeRoutingEntry[] {
	const explicit = new Map<PlanModeRoutingView, PlanModeRoutingEntry>();
	const generated = new Set<PlanModeRoutingView>();
	for (const message of messages) {
		const metadata = record(message.metadataJson) ?? {};
		const planModeGate = record(metadata.planModeGate);
		const originalGate = record(planModeGate?.originalGate);
		const planMode = record(metadata.planMode);
		for (const candidate of [
			originalGate?.dedicatedViews,
			planMode?.dedicatedViews,
			planModeGate?.dedicatedViews,
			metadata.dedicatedViews,
			metadata.viewDecisions,
		]) {
			if (!Array.isArray(candidate)) continue;
			for (const item of candidate) {
				const value = record(item);
				if (!value) continue;
				const view = value.view;
				const decision = value.decision;
				if (
					typeof view !== "string" ||
					!ALL_PLAN_MODE_ROUTING_VIEWS.includes(view as PlanModeRoutingView) ||
					(decision !== "include" && decision !== "omit")
				)
					continue;
				const typedView = view as PlanModeRoutingView;
				explicit.set(typedView, {
					view: typedView,
					decision: REQUIRED_VIEWS.has(typedView) ? "include" : decision,
					required: REQUIRED_VIEWS.has(typedView),
					capabilityEnabled:
						REQUIRED_VIEWS.has(typedView) || capabilities[typedView] === true,
					reason:
						typeof value.reason === "string" && value.reason.trim()
							? value.reason.trim()
							: defaultRoutingReason({
									required: REQUIRED_VIEWS.has(typedView),
									generated: false,
									capabilityEnabled:
										REQUIRED_VIEWS.has(typedView) ||
										capabilities[typedView] === true,
									decision: REQUIRED_VIEWS.has(typedView)
										? "include"
										: decision,
								}),
				});
			}
		}
		if (
			metadata.intent === "app_blueprint" ||
			metadata.intent === "mock_blueprint"
		)
			generated.add("blueprint");
		if (
			metadata.intent === "design_questionnaire_ready" ||
			typeof metadata.questionnaireSessionId === "string"
		)
			generated.add("questionnaire");
		if (
			metadata.artifactKind === "plan_mode_dedicated_view" ||
			metadata.artifactKind === "plan_mode_api_contract" ||
			metadata.artifactKind === "plan_mode_zod_schema"
		) {
			const view = metadata.view;
			if (
				typeof view === "string" &&
				ALL_PLAN_MODE_ROUTING_VIEWS.includes(view as PlanModeRoutingView)
			)
				generated.add(view as PlanModeRoutingView);
		}
	}
	return ALL_PLAN_MODE_ROUTING_VIEWS.map((view): PlanModeRoutingEntry => {
		const required = REQUIRED_VIEWS.has(view);
		const generatedArtifact = generated.has(view);
		const capabilityEnabled = required || capabilities[view] === true;
		const decision =
			required || generatedArtifact ? ("include" as const) : ("omit" as const);
		return (
			explicit.get(view) ?? {
				view,
				decision,
				required,
				capabilityEnabled,
				reason: defaultRoutingReason({
					required,
					generated: generatedArtifact,
					capabilityEnabled,
					decision,
				}),
			}
		);
	});
}

export function normalizePlanModeRoutingEntries(
	entries: PlanModeRoutingEntry[],
	capabilities: RoutingCapabilities,
) {
	const byView = new Map(entries.map((entry) => [entry.view, entry]));
	return ALL_PLAN_MODE_ROUTING_VIEWS.map((view): PlanModeRoutingEntry => {
		const entry = byView.get(view);
		const required = REQUIRED_VIEWS.has(view);
		return {
			view,
			decision: required ? "include" : (entry?.decision ?? "omit"),
			required,
			capabilityEnabled: required || capabilities[view] === true,
			reason:
				entry?.reason && entry.reason !== LEGACY_INITIAL_OMIT_REASON
					? entry.reason
					: defaultRoutingReason({
							required,
							generated: false,
							capabilityEnabled: required || capabilities[view] === true,
							decision: required ? "include" : (entry?.decision ?? "omit"),
						}),
		};
	});
}
