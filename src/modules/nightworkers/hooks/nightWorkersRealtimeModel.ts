import { toDeepRecord } from "../../../../shared/json-record";
import type { TaskMessage } from "../types";

export function isPlanModeWorkspaceMessage(message: TaskMessage) {
	const metadata = toDeepRecord(message.metadataJson);
	const intent = String(metadata.intent || "");
	const artifactKind = String(metadata.artifactKind || "");
	return (
		intent === "design_questionnaire_starting" ||
		intent === "design_questionnaire_ready" ||
		intent === "mock_blueprint" ||
		intent === "feature_plan" ||
		intent === "design_decision_review" ||
		intent === "implementation_plan" ||
		artifactKind === "plan_mode_dedicated_view" ||
		artifactKind === "plan_mode_api_contract" ||
		artifactKind === "plan_mode_zod_schema"
	);
}
