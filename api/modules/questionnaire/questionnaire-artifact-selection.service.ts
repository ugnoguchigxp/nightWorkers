import { z } from "@hono/zod-openapi";
import type { DesignQuestionnaireSession } from "../../../shared/schemas/design-questionnaire.schema";
import {
	EDITABLE_PLAN_MODE_ROUTING_VIEWS,
	type EditablePlanModeRoutingView,
	type PlanModeRoutingEntry,
} from "../../../shared/schemas/plan-mode-routing.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import {
	createStructuredOutputContract,
	type StructuredLlmRole,
} from "../../services/structured-llm";
import { p } from "../../systemContexts/catalog";
import type { StructuredProviderExecutionPolicy } from "../agentsShare";
import { renderQuestionnaireAnswer } from "../specification/specification-schema-reference-renderer";
import { getSessionQuestions } from "./questionnaire-parser.service";

const DESIGN_DEPTH_LABELS = {
	none: "個別設計書なし",
	focused: "要点限定",
	standard: "標準",
	comprehensive: "詳細",
} as const;

const artifactRoutingDecisionSchema = z
	.object({
		view: z.enum(EDITABLE_PLAN_MODE_ROUTING_VIEWS),
		decision: z.enum(["include", "omit"]),
		depth: z.enum(["none", "focused", "standard", "comprehensive"]),
		reason: z.string().min(1).max(180),
	})
	.superRefine((decision, context) => {
		if (decision.decision === "omit" && decision.depth !== "none") {
			context.addIssue({
				code: "custom",
				path: ["depth"],
				message: "omitするArtifactのdepthはnoneにしてください。",
			});
		}
		if (decision.decision === "include" && decision.depth === "none") {
			context.addIssue({
				code: "custom",
				path: ["depth"],
				message: "includeするArtifactには設計粒度を指定してください。",
			});
		}
	});

export async function selectQuestionnaireArtifactRouting(
	input: {
		taskId: string;
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
	},
	options: {
		scope?: "all_optional" | "unresolved_omissions";
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
		usageTrace?: TraceProvenance;
	} = {},
) {
	const scope = options.scope ?? "all_optional";
	const candidates = input.routing.entries
		.filter(
			(
				entry,
			): entry is PlanModeRoutingEntry & {
				view: EditablePlanModeRoutingView;
			} =>
				entry.view !== "questionnaire" &&
				entry.view !== "feature_plan" &&
				(scope === "all_optional" ||
					(entry.decision === "omit" && !entry.reason?.trim())),
		)
		.map((entry) => ({
			view: entry.view,
			currentDecision: entry.decision,
			currentReason: entry.reason ?? null,
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
					if (disabledSet.has(decision.view) && decision.decision !== "omit") {
						context.addIssue({
							code: "custom",
							path: [index, "decision"],
							message: "無効なArtifact viewはomitにしてください。",
						});
					}
					seen.add(decision.view);
				}
			}),
	});

	const answerByQuestionId = new Map(
		input.questionnaire.answers.map((answer) => [
			answer.questionId,
			answer.answer,
		]),
	);
	const confirmedDecisions = getSessionQuestions(input.questionnaire)
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
		systemPrompt: p("questionnaire.artifact-selection", {}),
		userPrompt: [
			"## Task",
			JSON.stringify(input.task, null, 2),
			"",
			"## Confirmed Questionnaire Decisions",
			JSON.stringify(confirmedDecisions, null, 2),
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
			"候補viewをすべてdecisionsへ含め、include/omit、depth、要件固有のreasonを返してください。",
		].join("\n"),
		options: {
			contract: createStructuredOutputContract({
				name: "questionnaire_artifact_routing",
				runtimeSchema: questionnaireArtifactRoutingSchema,
				providerJsonSchema: z.toJSONSchema(questionnaireArtifactRoutingSchema),
			}),
			taskId: input.taskId,
			role: options.role ?? "plan",
			executionPolicy: options.executionPolicy,
			usageTrace: options.usageTrace,
		},
	});

	return questionnaireArtifactRoutingSchema
		.parse(result.value)
		.decisions.map((decision) => ({
			view: decision.view,
			decision: decision.decision,
			reason: `${decision.reason}（推奨粒度: ${DESIGN_DEPTH_LABELS[decision.depth]}）`,
		}));
}
