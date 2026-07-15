import { AppError } from "../../../lib/errors";
import { readPublicRunOutcome } from "../../../services/agent-runtime/public-run-outcome";

export async function readMissionPilotRunOutcome(runId: string) {
	const outcome = await readPublicRunOutcome(runId);
	if (!outcome)
		throw new AppError(404, "RUN_NOT_FOUND", "Run outcome not found");
	return outcome;
}
