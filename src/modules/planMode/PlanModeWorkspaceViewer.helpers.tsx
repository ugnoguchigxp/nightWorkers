import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../shared/json-record";
import type {
	DesignQuestionnaireSession,
	PlanModeWorkspace,
	TaskMessage,
} from "../nightworkers/types";
import type { PlanWorkspaceTab } from "../specification";
import type { PlanViewDecision } from "./PlanModeWorkspacePanels";
import type { GenericPlanView } from "./planViewCommands";

type FeaturePlanVerificationModel = {
	conditions: Array<{
		id: string;
		text: string;
		status: string;
		required: boolean;
	}>;
};

export function buildFeaturePlanVerificationModel(input: {
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

export function FeaturePlanVerificationBar({
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

export function parseJsonRecord(value: string) {
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
