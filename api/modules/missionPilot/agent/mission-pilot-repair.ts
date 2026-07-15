import type { MissionPilotRepairRequest } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { createMissionPilotRepairRequest } from "./mission-pilot-repair.repository";

export async function persistMissionPilotRepairRequest(
	input: Parameters<typeof createMissionPilotRepairRequest>[0],
) {
	return createMissionPilotRepairRequest(input);
}
export function buildMissionPilotRepairPrompt(
	request: MissionPilotRepairRequest,
) {
	return [
		"Coding Agentへ、Task全体のやり直しではなく対象を絞った修正を依頼します。",
		`Goal: ${request.goal}`,
		`Observed problem: ${request.observedProblem}`,
		`Failure: ${request.failure.kind ?? "unknown"} ${request.failure.message}`,
		`Requested outcome: ${request.requestedOutcome}`,
		`Preserve: ${request.preserve.join("、") || "既存の正しい部分"}`,
		`Verification: ${request.verification.join("、") || "現在のTask完了条件"}`,
		`Canonical refs: ${request.canonicalRefs.map((ref) => `${ref.kind}:${ref.id}`).join(", ")}`,
	].join("\n");
}
