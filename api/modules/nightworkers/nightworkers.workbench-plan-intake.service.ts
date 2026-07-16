import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import type { buildPlanModeSettingsSnapshot } from "../../services/settings/general-settings";
import type { createDesignQuestionnaire } from "../questionnaire/questionnaire.service";
import * as repo from "./nightworkers.repository";
import type { WorkbenchPlanModeGate } from "./nightworkers.workbench.service";
import { toRecord } from "./nightworkers.workbench.service";

export async function ensureDesignQuestionnaireReadyMessage(input: {
	taskId: string;
	runId?: string;
	questionnaireSession: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
	planModeGate: WorkbenchPlanModeGate & Record<string, unknown>;
	planModeSettingsSnapshot: ReturnType<typeof buildPlanModeSettingsSnapshot>;
	source: "workbench" | "mission_pilot" | "coding_agent";
	trace?: TraceProvenance;
}) {
	const messages = await repo.listTaskMessages(input.taskId);
	const existing = messages.find((message) => {
		const metadata = toRecord(message.metadataJson);
		const planModeGate = toRecord(metadata?.planModeGate);
		return (
			metadata?.intent === "design_questionnaire_ready" &&
			metadata.questionnaireSessionId === input.questionnaireSession.id &&
			Array.isArray(planModeGate?.dedicatedViews)
		);
	});
	if (existing) return existing;
	const totalQuestionCount = input.questionnaireSession.questionSets.reduce(
		(total, set) =>
			total +
			(set.questionnaire?.questionSets || []).reduce(
				(setTotal, questionSet) => setTotal + questionSet.questions.length,
				0,
			),
		0,
	);
	return repo.createTaskMessage({
		taskId: input.taskId,
		runId: input.runId,
		role: "system",
		content: `Design Questionnaire を生成しました。${totalQuestionCount} 件の質問に回答できます。`,
		messageType: "text",
		payloadJson: {
			intent: "design_questionnaire_ready",
			source: input.source,
			questionnaireSessionId: input.questionnaireSession.id,
			questionnaireStatus: input.questionnaireSession.status,
			totalQuestionCount,
			planModeGate: input.planModeGate,
			planModeSettingsSnapshot: input.planModeSettingsSnapshot,
		},
		trace: input.trace,
	});
}
