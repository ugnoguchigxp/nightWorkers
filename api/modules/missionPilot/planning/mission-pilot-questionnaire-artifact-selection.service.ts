import { z } from "@hono/zod-openapi";
import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import {
	EDITABLE_PLAN_MODE_ROUTING_VIEWS,
	type EditablePlanModeRoutingView,
	type PlanModeRoutingEntry,
} from "../../../../shared/schemas/plan-mode-routing.schema";
import { callStructuredOutputWithRepair } from "../../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../../services/structured-llm";
import { missionPilotThoughtTrace } from "../../nightworkers/nightworkers.trace-provenance";
import { getSessionQuestions } from "../../questionnaire/questionnaire-parser.service";
import { renderQuestionnaireAnswer } from "../../specification/specification-schema-reference-renderer";
import { missionPilotArtifactProviderExecutionPolicy } from "../adapters/mission-pilot-provider.adapter";

const artifactRoutingDecisionSchema = z.object({
	view: z.enum(EDITABLE_PLAN_MODE_ROUTING_VIEWS),
	decision: z.enum(["include", "omit"]),
	reason: z.string().min(1).max(120),
});

export async function selectQuestionnaireArtifacts(input: {
	taskId: string;
	sessionId: string;
	task: {
		title: string;
		objective: string | null;
		acceptanceCriteria: string | null;
	};
	questionnaire: DesignQuestionnaireSession;
	routing: {
		revision: number;
		entries: PlanModeRoutingEntry[];
	};
	capabilities: Record<string, boolean>;
}) {
	const candidates = input.routing.entries
		.filter(
			(
				entry,
			): entry is PlanModeRoutingEntry & {
				view: EditablePlanModeRoutingView;
			} =>
				entry.view !== "questionnaire" &&
				entry.view !== "feature_plan" &&
				entry.decision === "omit" &&
				!entry.reason?.trim(),
		)
		.map((entry) => ({
			view: entry.view,
			capabilityEnabled:
				entry.capabilityEnabled && input.capabilities[entry.view] === true,
		}));
	const candidateViews = candidates.map((candidate) => candidate.view);
	if (candidateViews.length === 0) return [];
	const candidateSet = new Set(candidateViews);
	const disabledSet = new Set(
		candidates
			.filter((candidate) => !candidate.capabilityEnabled)
			.map((candidate) => candidate.view),
	);
	const questionnaireArtifactRoutingSchema = z.object({
		decisions: z
			.array(artifactRoutingDecisionSchema)
			.length(candidateViews.length)
			.superRefine((decisions, context) => {
				const seen = new Set<string>();
				let includedCount = 0;
				for (const [index, decision] of decisions.entries()) {
					if (!candidateSet.has(decision.view)) {
						context.addIssue({
							code: "custom",
							path: [index, "view"],
							message: "候補にないArtifact viewは判断できません。",
						});
					}
					if (seen.has(decision.view)) {
						context.addIssue({
							code: "custom",
							path: [index, "view"],
							message: "同じArtifact viewを重複指定できません。",
						});
					}
					if (decision.decision === "include") includedCount += 1;
					if (disabledSet.has(decision.view) && decision.decision !== "omit") {
						context.addIssue({
							code: "custom",
							path: [index, "decision"],
							message: "無効なArtifact viewはomitにしてください。",
						});
					}
					seen.add(decision.view);
				}
				if (includedCount > 2) {
					context.addIssue({
						code: "custom",
						path: [],
						message: "任意Artifactの選出は最大2件です。",
					});
				}
			}),
	});

	const answerByQuestionId = new Map(
		input.questionnaire.answers.map((answer) => [
			answer.questionId,
			answer.answer,
		]),
	);
	const decisions = getSessionQuestions(input.questionnaire)
		.map((question) => ({
			questionId: String(question.id),
			question: question.question,
			answer: renderQuestionnaireAnswer(
				question,
				answerByQuestionId.get(String(question.id)),
			),
			why: question.why ?? null,
			outputSection: question.outputSection ?? null,
		}))
		.filter((decision) => decision.answer !== "未回答");
	const result = await callStructuredOutputWithRepair({
		systemPrompt: [
			"Questionnaireの確定回答を読み、任意の設計Artifactを選出または不選出にするMission Pilotです。",
			"判断はTask、acceptance criteria、Questionnaire回答、現在のroutingを意味的に比較してください。文言のkeyword一致や固定のArtifact一式に依存しないでください。",
			"QuestionnaireとFeature Planは必須なので判断対象外です。候補の全viewを一度ずつ返し、capabilityが無効なview、回答から直接必要と判断できないviewはomitにしてください。",
			"Feature Planに実装手順・検証観点として安全に含められる内容を、別Artifactへ分解しないでください。",
			"通常は任意Artifactを0〜1件だけincludeし、回答から独立した設計契約が必要な場合に限り最大2件までincludeしてください。",
			"includeのreasonは実装前に別Artifactが必要な理由を、omitのreasonは今回そのArtifactを分けて作らない理由を、Taskと回答に結び付いた短い一文（120文字以内）で記載してください。",
			"『初期routingでは省略』『不要なため』のような汎用文ではなく、そのTask固有の根拠を記載してください。",
		].join("\n"),
		userPrompt: [
			"## Task",
			JSON.stringify(input.task, null, 2),
			"",
			"## Confirmed Questionnaire Decisions",
			JSON.stringify(decisions, null, 2),
			"",
			"## Current Routing",
			JSON.stringify(
				input.routing.entries.map((entry) => ({
					view: entry.view,
					decision: entry.decision,
					capabilityEnabled: entry.capabilityEnabled,
				})),
				null,
			),
			"",
			"## Candidate Views",
			JSON.stringify(candidates, null, 2),
			"",
			"候補viewをすべてdecisionsへ含め、各viewのinclude/omitとTask固有の短いreasonを返してください。",
		].join("\n"),
		options: {
			contract: createStructuredOutputContract({
				name: "mission_pilot_questionnaire_artifact_routing",
				runtimeSchema: questionnaireArtifactRoutingSchema,
				providerJsonSchema: z.toJSONSchema(questionnaireArtifactRoutingSchema),
			}),
			taskId: input.taskId,
			role: "mission_pilot",
			executionPolicy: missionPilotArtifactProviderExecutionPolicy,
			usageTrace: missionPilotThoughtTrace({ sessionId: input.sessionId }),
		},
	});

	return questionnaireArtifactRoutingSchema.parse(result.value).decisions;
}
