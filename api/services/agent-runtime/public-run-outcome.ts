import { and, desc, eq, inArray } from "drizzle-orm";
import type { MissionPilotRunOutcome } from "../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../db/client";
import { nativeApiTurns, taskRuns } from "../../db/schema";

export type PublicRunOutcome = MissionPilotRunOutcome;

export async function readPublicRunOutcome(
	runId: string,
): Promise<PublicRunOutcome | null> {
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId));
	if (!run) return null;
	const [terminalNativeTurn] = await db
		.select()
		.from(nativeApiTurns)
		.where(
			and(
				eq(nativeApiTurns.runId, runId),
				inArray(nativeApiTurns.status, ["completed", "failed", "cancelled"]),
			),
		)
		.orderBy(desc(nativeApiTurns.turnIndex))
		.limit(1);
	const judgment = asRecord(run.finalJudgment);
	const context = asRecord(run.contextSnapshot);
	const nativeAssistant = terminalNativeTurn
		? lastAssistantContent(terminalNativeTurn.historyJson)
		: null;
	const finalReport = nativeAssistant ?? nonEmpty(run.finalReport);
	const blockerRecord = asRecord(judgment.blocker);
	const blockerMessage =
		nonEmpty(blockerRecord.message) ?? nonEmpty(judgment.blockerMessage);
	const verificationSummary =
		nonEmpty(judgment.verificationSummary) ??
		nonEmpty(asRecord(run.testResults).summary);
	return {
		runId: run.id,
		executionMode:
			nonEmpty(context.executionMode) ?? nonEmpty(judgment.executionMode),
		terminalState: run.status,
		finalReport,
		blocker: blockerMessage
			? {
					code: nonEmpty(blockerRecord.code) ?? nonEmpty(judgment.blockerCode),
					message: blockerMessage,
				}
			: null,
		verificationSummary,
		artifactRefs: readArtifactRefs(judgment.artifactRefs),
		completedAt: (run.finishedAt ?? run.endedAt)?.toISOString() ?? null,
		diagnostic: terminalNativeTurn?.errorJson ?? null,
	};
}

function lastAssistantContent(history: unknown) {
	if (!Array.isArray(history)) return null;
	for (let index = history.length - 1; index >= 0; index--) {
		const item = asRecord(history[index]);
		if (item.type !== "assistant") continue;
		const content = nonEmpty(item.content);
		if (content) return content;
	}
	return null;
}

function readArtifactRefs(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const record = asRecord(item);
		const kind = nonEmpty(record.kind);
		const id = nonEmpty(record.id);
		return kind && id ? [{ kind, id }] : [];
	});
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function nonEmpty(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}
