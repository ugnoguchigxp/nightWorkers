import { AppError } from "../../../lib/errors";
import {
	readPublicRunChangeSummary,
	readPublicRunOutcome,
	readPublicRunVerification,
} from "../../../services/agent-runtime/public-run-outcome";
import { sliceMissionPilotUtf8Page } from "./mission-pilot-content-page";

export async function readMissionPilotRunOutcome(
	runId: string,
	options?: { cursor?: number; maxChars?: number },
) {
	const outcome = await readPublicRunOutcome(runId);
	if (!outcome)
		throw new AppError(404, "RUN_NOT_FOUND", "Run outcome not found");
	if (!outcome.finalReport) return outcome;
	const page = sliceMissionPilotUtf8Page(outcome.finalReport, {
		cursor: options?.cursor,
		maxChars: Math.min(24_000, Math.max(1_000, options?.maxChars ?? 8_000)),
		maxBytes: 16_000,
	});
	return { ...outcome, finalReport: page.content, finalReportPage: page.page };
}

export async function readMissionPilotRunChangeSummary(runId: string) {
	const summary = await readPublicRunChangeSummary(runId);
	if (!summary)
		throw new AppError(404, "RUN_NOT_FOUND", "Run change summary not found");
	return summary;
}

export async function readMissionPilotRunVerification(
	runId: string,
	options?: { cursor?: number; limit?: number },
) {
	const verification = await readPublicRunVerification(runId, options);
	if (!verification)
		throw new AppError(404, "RUN_NOT_FOUND", "Run verification not found");
	return verification;
}
