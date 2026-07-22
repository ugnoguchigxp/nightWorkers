import type { StructuredOutputContract } from "../../../services/structured-llm/contract";
import { bindSystemContextTextCatalog } from "../../../systemContexts/catalog";
import {
	getMissionPilotPlanReviewThresholdContext,
	getMissionPilotPlanSystemContext,
} from "./mission-pilot-system-context";

export function buildMissionPilotPlanReviewSystemPrompt<T>(
	contract: StructuredOutputContract<T>,
) {
	const { p } = bindSystemContextTextCatalog();
	return p("missionPilot.plan-review", {
		planSystem: getMissionPilotPlanSystemContext(p).trimEnd(),
		planReviewThreshold: getMissionPilotPlanReviewThresholdContext(p).trimEnd(),
		domainBoundaryReview: p("specification.ddd-boundary-review", {}).trimEnd(),
		outputRequirements: contract.renderOutputRequirements(p),
	});
}
