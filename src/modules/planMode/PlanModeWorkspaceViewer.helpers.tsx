import type {
	DesignQuestionnaireSession,
	PlanModeWorkspace,
	TaskMessage,
} from "../nightworkers/types";
import type { PlanWorkspaceTab } from "../specification";
import type { PlanViewDecision } from "./PlanModeWorkspacePanels";
import type { GenericPlanView } from "./planViewCommands";

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

export const planViewToTab: Record<GenericPlanView, PlanWorkspaceTab> = {
	user_flow: "user-flow",
	api_io_contract: "api-io-contract",
	activity_flow: "activity-flow",
	sequence_flow: "sequence-flow",
	zod_schema_design: "zod-schema-design",
};

export function isGenericPlanView(view: string): view is GenericPlanView {
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

export function isCompletedQuestionnaireSession(
	session: DesignQuestionnaireSession,
) {
	return isCompletedStatus(session.status);
}

export function isCompletedStatus(status: string) {
	return status === "review_ready" || status === "accepted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseJsonRecord(value: string) {
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
