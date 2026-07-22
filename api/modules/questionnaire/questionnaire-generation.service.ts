import {
	type DesignQuestionnaireSession,
	designDecisionReviewSchema,
	designQuestionnaireFollowUpDecisionSchema,
	generatedQuestionnaireChoiceFormSchema,
	questionnaireChoiceFormSchema,
} from "../../../shared/schemas/design-questionnaire.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import {
	buildDesignQuestionnaireFollowUpDecisionSystemPrompt,
	buildDesignQuestionnaireFollowUpDecisionUserPrompt,
	buildDesignQuestionnaireFollowUpUserPrompt,
	buildDesignQuestionnaireInitialUserPrompt,
	buildDesignQuestionnaireReviewSystemPrompt,
	buildDesignQuestionnaireReviewUserPrompt,
	buildDesignQuestionnaireSystemPrompt,
} from "../../services/structured-generation/prompts/design-questionnaire";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../services/structured-llm";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import type { StructuredProviderExecutionPolicy } from "../agentsShare";
import {
	listPlanModeTaskMessages,
	type PlanModeTaskMessage,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import {
	type PlanModeQuestionnaireRepositoryPolicy,
	resolvePlanModeQuestionnaireProjectContext,
} from "../specification/plan-mode-project-stack-context";
import { buildQuestionnairePlanModeContext } from "./questionnaire-context";
import {
	designDecisionReviewJsonSchema,
	designQuestionnaireFollowUpDecisionJsonSchema,
	generatedQuestionnaireChoiceFormJsonSchema,
	questionnaireChoiceFormJsonSchema,
} from "./questionnaire-parser.service";

export async function generateDesignQuestionnaireRawOutput(input: {
	taskId: string;
	repositoryId: string;
	sourceBlueprintMessage: PlanModeTaskMessage | null;
	taskPrompt: string;
	projectStackContext?: string | null;
	repositoryPolicy: PlanModeQuestionnaireRepositoryPolicy;
	planModeContext?: string | null;
	routeOverride?: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	usageTrace?: TraceProvenance;
	signal?: AbortSignal;
}) {
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireSystemPrompt(input.repositoryPolicy),
		buildDesignQuestionnaireInitialUserPrompt(input),
		{
			name: "design_questionnaire",
			runtimeSchema: generatedQuestionnaireChoiceFormSchema,
			providerJsonSchema: generatedQuestionnaireChoiceFormJsonSchema,
			taskId: input.taskId,
			role: input.role,
			executionPolicy: input.executionPolicy,
			usageTrace: input.usageTrace,
			routeOverride: input.routeOverride || null,
			signal: input.signal,
		},
	);
}

export async function generateDesignQuestionnaireFollowUpRawOutput(
	session: DesignQuestionnaireSession,
	options: {
		signal?: AbortSignal;
		usageTrace?: TraceProvenance;
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
	} = {},
) {
	const projectContext = await resolvePlanModeQuestionnaireProjectContext(
		session.repositoryId,
	);
	const planModeContext = buildQuestionnairePlanModeContext(
		await listPlanModeTaskMessages(session.taskId),
	);
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireSystemPrompt(projectContext.repositoryPolicy),
		buildDesignQuestionnaireFollowUpUserPrompt(
			session,
			projectContext.projectStackContext,
			planModeContext,
		),
		{
			name: "design_questionnaire_follow_up",
			runtimeSchema: questionnaireChoiceFormSchema,
			providerJsonSchema: questionnaireChoiceFormJsonSchema,
			taskId: session.taskId,
			role: options.role ?? "plan",
			executionPolicy: options.executionPolicy,
			usageTrace: options.usageTrace,
			signal: options.signal,
		},
	);
}

export async function generateDesignQuestionnaireFollowUpDecisionRawOutput(
	session: DesignQuestionnaireSession,
	options: {
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
		usageTrace?: TraceProvenance;
	} = {},
) {
	const projectContext = await resolvePlanModeQuestionnaireProjectContext(
		session.repositoryId,
	);
	const planModeContext = buildQuestionnairePlanModeContext(
		await listPlanModeTaskMessages(session.taskId),
	);
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireFollowUpDecisionSystemPrompt(
			projectContext.repositoryPolicy,
		),
		buildDesignQuestionnaireFollowUpDecisionUserPrompt(
			session,
			projectContext.projectStackContext,
			planModeContext,
		),
		{
			name: "design_questionnaire_follow_up_decision",
			runtimeSchema: designQuestionnaireFollowUpDecisionSchema,
			providerJsonSchema: designQuestionnaireFollowUpDecisionJsonSchema,
			taskId: session.taskId,
			role: options.role ?? "plan",
			executionPolicy: options.executionPolicy,
			usageTrace: options.usageTrace,
		},
	);
}

export async function generateDesignQuestionnaireReviewRawOutput(
	session: DesignQuestionnaireSession,
	options: {
		signal?: AbortSignal;
		usageTrace?: TraceProvenance;
		role?: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
	} = {},
) {
	return generateQuestionnaireRawOutput(
		buildDesignQuestionnaireReviewSystemPrompt(),
		buildDesignQuestionnaireReviewUserPrompt(session),
		{
			name: "design_decision_review",
			runtimeSchema: designDecisionReviewSchema,
			providerJsonSchema: designDecisionReviewJsonSchema,
			taskId: session.taskId,
			role: options.role ?? "review",
			executionPolicy: options.executionPolicy,
			usageTrace: options.usageTrace,
			signal: options.signal,
		},
	);
}

async function generateQuestionnaireRawOutput<T>(
	systemPrompt: string,
	userPrompt: string,
	input: {
		name: string;
		runtimeSchema: import("zod").ZodType<T>;
		providerJsonSchema: unknown;
		taskId: string;
		role: StructuredLlmRole;
		executionPolicy?: StructuredProviderExecutionPolicy;
		usageTrace?: TraceProvenance;
		routeOverride?: StructuredLlmModelTarget | null;
		signal?: AbortSignal;
	},
) {
	const generated = await callStructuredOutputWithRepair({
		systemPrompt,
		userPrompt,
		options: {
			contract: createStructuredOutputContract({
				name: input.name,
				runtimeSchema: input.runtimeSchema,
				providerJsonSchema: input.providerJsonSchema,
			}),
			taskId: input.taskId,
			role: input.role,
			executionPolicy: input.executionPolicy,
			usageTrace: input.usageTrace,
			routeOverride: input.routeOverride,
			signal: input.signal,
		},
	});
	return generated.attempts.at(-1)?.rawText ?? JSON.stringify(generated.value);
}
