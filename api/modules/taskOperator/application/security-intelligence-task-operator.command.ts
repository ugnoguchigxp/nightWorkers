import { createHash } from "node:crypto";
import type { TaskOperatorCommandContext } from "../../../../shared/modules/taskOperator";
import { requestPostSecurityAssessmentCommandV1Schema } from "../../../../shared/schemas/security-intelligence-runtime.schema";
import { AppError } from "../../../lib/errors";
import { readRunOperatorOutcome } from "../../run";
import {
	bindPreImplementationAssessment,
	proposeSecurityKnowledgeCandidateBatch,
	proposeSecurityKnowledgeFeedbackBatch,
	requestPostSecurityAssessment,
	writeCompletionCondition,
	writeSecurityContract,
} from "../../securityIntelligence";

function requiredText(value: unknown) {
	if (typeof value !== "string" || value.length === 0) {
		throw new AppError(
			422,
			"TASK_OPERATOR_ARGUMENT_REQUIRED",
			"A non-empty string is required.",
		);
	}
	return value;
}

function requiredInteger(value: unknown) {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new AppError(
			422,
			"TASK_OPERATOR_ARGUMENT_REQUIRED",
			"A non-negative integer is required.",
		);
	}
	return value as number;
}

function optionalText(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function authorPrincipalRef(context: TaskOperatorCommandContext) {
	const actorDigest = createHash("sha256")
		.update(context.principal.actorId)
		.digest("hex");
	return `task-operator:${context.principal.kind}:${actorDigest}`;
}

async function requireTaskRun(taskId: string, runId: unknown) {
	const parsedRunId = requiredText(runId);
	const run = await readRunOperatorOutcome({ taskId, runId: parsedRunId });
	if (!run) {
		throw new AppError(
			404,
			"TASK_OPERATOR_RUN_NOT_FOUND",
			"Taskに属するRunが見つかりません。",
		);
	}
	return parsedRunId;
}

export async function executeSecurityIntelligenceTaskOperatorAction(input: {
	actionId: string;
	taskId: string;
	arguments: Record<string, unknown>;
	context: TaskOperatorCommandContext;
}): Promise<{ handled: false } | { handled: true; value: unknown }> {
	const args = input.arguments;
	switch (input.actionId) {
		case "security.assessment.pre.bind":
			return {
				handled: true,
				value: await bindPreImplementationAssessment({
					repositoryId: requiredText(args.repositoryId),
					taskId: input.taskId,
					taskRevisionSnapshotId: requiredText(args.taskRevisionSnapshotId),
					assessmentReceiptRef: requiredText(args.assessmentReceiptRef),
					expectedRepositoryIdentityRevision: requiredInteger(
						args.expectedRepositoryIdentityRevision,
					),
					expectedBaseWorktreeId: requiredText(args.expectedBaseWorktreeId),
					expectedBaseHeadSha: requiredText(args.expectedBaseHeadSha),
				}),
			};
		case "security.contract.write":
			return {
				handled: true,
				value: await writeSecurityContract({
					taskId: input.taskId,
					taskRevisionSnapshotId: requiredText(args.taskRevisionSnapshotId),
					expectedCurrentContractRef: optionalText(
						args.expectedCurrentContractRef,
					),
					expectedHeadRevision: requiredInteger(args.expectedHeadRevision),
					authorPrincipalRef: authorPrincipalRef(input.context),
					semantic: record(args.semantic) as never,
				}),
			};
		case "security.condition.write":
			return {
				handled: true,
				value: await writeCompletionCondition({
					taskId: input.taskId,
					taskRevisionSnapshotId: requiredText(args.taskRevisionSnapshotId),
					expectedCurrentConditionRef: optionalText(
						args.expectedCurrentConditionRef,
					),
					expectedHeadRevision: requiredInteger(args.expectedHeadRevision),
					authorPrincipalRef: authorPrincipalRef(input.context),
					semantic: record(args.semantic) as never,
				}),
			};
		case "security.assessment.post.request":
			await requireTaskRun(input.taskId, args.runId);
			return {
				handled: true,
				value: await requestPostSecurityAssessment(
					requestPostSecurityAssessmentCommandV1Schema.parse({
						...args,
						version: 1,
					}),
				),
			};
		case "security.knowledge.candidates.propose":
			await requireTaskRun(input.taskId, args.runId);
			return {
				handled: true,
				value: await proposeSecurityKnowledgeCandidateBatch(
					{ ...args, version: 1 },
					{ producerPrincipalRef: authorPrincipalRef(input.context) },
				),
			};
		case "security.knowledge.feedback.propose":
			await requireTaskRun(input.taskId, args.runId);
			return {
				handled: true,
				value: await proposeSecurityKnowledgeFeedbackBatch(
					{ ...args, version: 1 },
					{ producerPrincipalRef: authorPrincipalRef(input.context) },
				),
			};
		default:
			return { handled: false };
	}
}
