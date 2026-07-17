import { isDeepRecord } from "../../../shared/json-record";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import type { buildPlanModeSettingsSnapshot } from "../../services/settings/general-settings";
import type { StructuredLlmModelTarget } from "../../services/structured-llm/settings";
import type { createDesignQuestionnaire } from "../questionnaire/questionnaire.service";
import {
	createDesignQuestionnaire as createQuestionnaire,
	listDesignQuestionnaires,
} from "../questionnaire/questionnaire.service";
import * as repo from "./nightworkers.repository";

type WorkbenchPlanModeGate = {
	shouldStartPlanMode: boolean;
	action: "plan_mode" | "coding_agent";
	reason: string;
};

const RESUMABLE_QUESTIONNAIRE_STATUSES = new Set([
	"draft",
	"answering",
	"review_ready",
	"needs_edit",
]);

function planModeQuestionnaireGate(gate: WorkbenchPlanModeGate) {
	return {
		...gate,
		dedicatedViews: [
			{
				view: "questionnaire" as const,
				decision: "include" as const,
				reason:
					"実装前に残る仕様判断をユーザーがPlan Mode Artifactで確定するためです。",
			},
		],
		specificationLenses: [],
	};
}

export async function startWorkbenchPlanModeIntake(input: {
	taskId: string;
	prompt: string;
	planModeGate: WorkbenchPlanModeGate;
	planModeSettingsSnapshot: ReturnType<typeof buildPlanModeSettingsSnapshot>;
	routeOverride?: StructuredLlmModelTarget | null;
}) {
	const enrichedGate = planModeQuestionnaireGate(input.planModeGate);
	await repo.createTaskMessage({
		taskId: input.taskId,
		role: "system",
		content:
			"Plan Mode Workspaceを開き、Design Questionnaireを生成しています。",
		messageType: "text",
		payloadJson: {
			intent: "design_questionnaire_starting",
			source: "workbench",
			questionnaireStatus: "generating",
			planModeGate: enrichedGate,
			planModeSettingsSnapshot: input.planModeSettingsSnapshot,
		},
	});

	const existing = (await listDesignQuestionnaires(input.taskId)).find(
		(session) => RESUMABLE_QUESTIONNAIRE_STATUSES.has(session.status),
	);
	const questionnaireSession =
		existing ??
		(await createQuestionnaire(input.taskId, null, input.prompt, {
			role: "plan",
			routeOverride: input.routeOverride ?? null,
		}));
	await ensureDesignQuestionnaireReadyMessage({
		taskId: input.taskId,
		questionnaireSession,
		planModeGate: enrichedGate,
		planModeSettingsSnapshot: input.planModeSettingsSnapshot,
		source: "workbench",
		forceNewMessage: true,
	});
	return questionnaireSession;
}

export async function ensureDesignQuestionnaireReadyMessage(input: {
	taskId: string;
	runId?: string;
	questionnaireSession: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
	planModeGate: Record<string, unknown>;
	planModeSettingsSnapshot: ReturnType<typeof buildPlanModeSettingsSnapshot>;
	source: "workbench" | "mission_pilot" | "coding_agent";
	trace?: TraceProvenance;
	forceNewMessage?: boolean;
}) {
	const messages = await repo.listTaskMessages(input.taskId);
	const existing = input.forceNewMessage
		? null
		: messages.find((message) => {
				const metadata = isDeepRecord(message.metadataJson)
					? message.metadataJson
					: null;
				const planModeGate = isDeepRecord(metadata?.planModeGate)
					? metadata.planModeGate
					: null;
				return (
					String(metadata?.intent || "") === "design_questionnaire_ready" &&
					String(metadata?.questionnaireSessionId || "") ===
						input.questionnaireSession.id &&
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
