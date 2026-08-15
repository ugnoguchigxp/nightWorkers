import { eq } from "drizzle-orm";
import {
	deriveSecurityFinalJudgmentV1,
	requestPostSecurityAssessmentCommandV1Schema,
	submitSecurityFinalJudgmentToolInputSchema,
	writeCompletionConditionCommandSchema,
	writeSecurityContractCommandSchema,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { proposeSecurityKnowledgeCandidateBatchCommandSchema } from "../../../shared/schemas/security-knowledge-candidate-batch.schema";
import { proposeSecurityKnowledgeFeedbackBatchCommandSchema } from "../../../shared/schemas/security-knowledge-feedback-batch.schema";
import { db } from "../../db/client";
import { taskRuns } from "../../db/schema-task-runs";
import { requestPostSecurityAssessment } from "../../modules/securityIntelligence/post-security-assessment.service";
import {
	writeCompletionCondition,
	writeSecurityContract,
} from "../../modules/securityIntelligence/security-contract.service";
import { submitSecurityFinalJudgment } from "../../modules/securityIntelligence/security-final-judgment.service";
import {
	proposeSecurityKnowledgeCandidateBatch,
	proposeSecurityKnowledgeFeedbackBatch,
} from "../../modules/securityIntelligence/security-knowledge-outbox.service";
import type { WorkerToolResult } from "./types";

type SecurityIntelligenceWorkerToolName =
	| "request_post_security_assessment"
	| "submit_security_final_judgment"
	| "write_security_contract"
	| "write_security_completion_condition"
	| "propose_security_knowledge_candidate_batch"
	| "propose_security_knowledge_feedback_batch";

function toolError(
	toolName: SecurityIntelligenceWorkerToolName,
	startedAt: string,
	error: unknown,
): WorkerToolResult<unknown> {
	return {
		ok: false,
		toolName,
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: {},
		error: {
			code:
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "SECURITY_INTELLIGENCE_COMMAND_FAILED",
			message: error instanceof Error ? error.message : "Command failed.",
			retryable: Boolean(
				error &&
					typeof error === "object" &&
					"details" in error &&
					(error.details as { retryable?: unknown } | undefined)?.retryable,
			),
		},
	};
}

async function requireRequestScopedRun(
	runId: string | undefined,
	command: { runId?: string; taskId?: string; taskRevisionSnapshotId?: string },
) {
	if (!runId || (command.runId && command.runId !== runId)) {
		throw Object.assign(new Error("request-scoped Run identity mismatch."), {
			code: "RUN_CONTEXT_MISMATCH",
		});
	}
	const [run] = await db
		.select({
			taskId: taskRuns.taskId,
			taskRevisionSnapshotId: taskRuns.taskRevisionSnapshotId,
		})
		.from(taskRuns)
		.where(eq(taskRuns.id, runId))
		.limit(1);
	if (
		!run ||
		(command.taskId !== undefined && command.taskId !== run.taskId) ||
		(command.taskRevisionSnapshotId !== undefined &&
			command.taskRevisionSnapshotId !== run.taskRevisionSnapshotId)
	) {
		throw Object.assign(new Error("request-scoped Task identity mismatch."), {
			code: "TASK_CONTEXT_MISMATCH",
		});
	}
	return run;
}

export async function requestPostSecurityAssessmentTool(input: {
	runId?: string;
	args: unknown;
}): Promise<WorkerToolResult<unknown>> {
	const startedAt = new Date().toISOString();
	try {
		const command = requestPostSecurityAssessmentCommandV1Schema.parse(
			input.args,
		);
		if (!input.runId || command.runId !== input.runId) {
			throw Object.assign(new Error("request-scoped Run identity mismatch."), {
				code: "RUN_CONTEXT_MISMATCH",
			});
		}
		return {
			ok: true,
			toolName: "request_post_security_assessment",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: await requestPostSecurityAssessment(command),
		};
	} catch (error) {
		return toolError("request_post_security_assessment", startedAt, error);
	}
}

export async function writeSecurityContractTool(input: {
	runId?: string;
	args: unknown;
}): Promise<WorkerToolResult<unknown>> {
	const startedAt = new Date().toISOString();
	try {
		const command = writeSecurityContractCommandSchema.parse(input.args);
		await requireRequestScopedRun(input.runId, command);
		return {
			ok: true,
			toolName: "write_security_contract",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: await writeSecurityContract({
				...command,
				authorPrincipalRef: `coding-agent-run:${input.runId}`,
			}),
		};
	} catch (error) {
		return toolError("write_security_contract", startedAt, error);
	}
}

export async function writeSecurityCompletionConditionTool(input: {
	runId?: string;
	args: unknown;
}): Promise<WorkerToolResult<unknown>> {
	const startedAt = new Date().toISOString();
	try {
		const command = writeCompletionConditionCommandSchema.parse(input.args);
		await requireRequestScopedRun(input.runId, command);
		return {
			ok: true,
			toolName: "write_security_completion_condition",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: await writeCompletionCondition({
				...command,
				authorPrincipalRef: `coding-agent-run:${input.runId}`,
			}),
		};
	} catch (error) {
		return toolError("write_security_completion_condition", startedAt, error);
	}
}

export async function proposeSecurityKnowledgeCandidateBatchTool(input: {
	runId?: string;
	args: unknown;
}): Promise<WorkerToolResult<unknown>> {
	const startedAt = new Date().toISOString();
	try {
		const command = proposeSecurityKnowledgeCandidateBatchCommandSchema.parse(
			input.args,
		);
		await requireRequestScopedRun(input.runId, command);
		return {
			ok: true,
			toolName: "propose_security_knowledge_candidate_batch",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: await proposeSecurityKnowledgeCandidateBatch(command, {
				producerPrincipalRef: `coding-agent-run:${input.runId}`,
			}),
		};
	} catch (error) {
		return toolError(
			"propose_security_knowledge_candidate_batch",
			startedAt,
			error,
		);
	}
}

export async function proposeSecurityKnowledgeFeedbackBatchTool(input: {
	runId?: string;
	args: unknown;
}): Promise<WorkerToolResult<unknown>> {
	const startedAt = new Date().toISOString();
	try {
		const command = proposeSecurityKnowledgeFeedbackBatchCommandSchema.parse(
			input.args,
		);
		await requireRequestScopedRun(input.runId, command);
		return {
			ok: true,
			toolName: "propose_security_knowledge_feedback_batch",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: await proposeSecurityKnowledgeFeedbackBatch(command, {
				producerPrincipalRef: `coding-agent-run:${input.runId}`,
			}),
		};
	} catch (error) {
		return toolError(
			"propose_security_knowledge_feedback_batch",
			startedAt,
			error,
		);
	}
}

export async function submitSecurityFinalJudgmentTool(input: {
	runId?: string;
	args: unknown;
}): Promise<WorkerToolResult<unknown>> {
	const startedAt = new Date().toISOString();
	try {
		const toolInput = submitSecurityFinalJudgmentToolInputSchema.parse(
			input.args,
		);
		const command = {
			...toolInput,
			judgment: deriveSecurityFinalJudgmentV1({
				...toolInput.judgment,
				createdAt: new Date().toISOString(),
			}),
		};
		if (!input.runId || command.runId !== input.runId) {
			throw Object.assign(new Error("request-scoped Run identity mismatch."), {
				code: "RUN_CONTEXT_MISMATCH",
			});
		}
		return {
			ok: true,
			toolName: "submit_security_final_judgment",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: await submitSecurityFinalJudgment(command),
		};
	} catch (error) {
		return toolError("submit_security_final_judgment", startedAt, error);
	}
}
