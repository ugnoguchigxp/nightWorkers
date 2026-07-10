import type { RunEventBase } from "../../../services/run-events/types";
import type { ReviewVerdict } from "../results/types";
import type {
	LlmReviewerResult,
	LoadedRubric,
	ReviewerEvaluationMode,
	ReviewerEvaluationStatus,
} from "./types";

type BaseEventInput = {
	runId: string;
	taskId?: string;
	timestamp?: string;
};

function base(
	input: BaseEventInput,
): Omit<RunEventBase, "type" | "severity" | "actor" | "message"> {
	return {
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: input.timestamp ?? new Date().toISOString(),
	};
}

export function buildRubricLoadedEvent(
	input: BaseEventInput & { loaded: LoadedRubric },
): RunEventBase {
	return {
		...base(input),
		type: "review.rubric_loaded",
		severity: "info",
		actor: "system",
		message: `Review rubric loaded: ${input.loaded.rubric.id}@${input.loaded.rubric.version}`,
		data: {
			rubricId: input.loaded.rubric.id,
			rubricVersion: String(input.loaded.rubric.version),
			source: input.loaded.source,
			digest: input.loaded.digest,
			criteriaCount: input.loaded.criteriaCount,
			reviewer: { kind: "deterministic" },
		},
	};
}

export function buildEvaluationStartedEvent(
	input: BaseEventInput & {
		evaluationId: string;
		rubricId: string;
		mode: ReviewerEvaluationMode | "replay";
	},
): RunEventBase {
	return {
		...base(input),
		type: "review.evaluation_started",
		severity: "info",
		actor: "system",
		message: `Reviewer evaluation started: ${input.rubricId}`,
		data: {
			evaluationId: input.evaluationId,
			rubricId: input.rubricId,
			runId: input.runId,
			mode: input.mode,
			reviewer: {
				kind: input.mode === "llm_assisted" ? "combined" : "deterministic",
			},
		},
	};
}

export function buildLlmStartedEvent(
	input: BaseEventInput & { evaluationId: string; llm: LlmReviewerResult },
): RunEventBase {
	return {
		...base(input),
		type: "review.llm_started",
		severity: "info",
		actor: "system",
		message: `LLM reviewer started: ${input.llm.provider}`,
		data: {
			evaluationId: input.evaluationId,
			provider: input.llm.provider,
			model: input.llm.model,
			promptDigest: input.llm.promptDigest,
			evidencePackDigest: input.llm.evidencePackDigest,
			reviewer: { kind: "llm" },
		},
	};
}

export function buildLlmFinishedEvent(
	input: BaseEventInput & {
		evaluationId: string;
		llm: LlmReviewerResult;
		firewallFindings?: string[];
	},
): RunEventBase {
	return {
		...base(input),
		type: "review.llm_finished",
		severity:
			input.llm.status === "failed"
				? "error"
				: input.llm.status === "degraded"
					? "warning"
					: "info",
		actor: "system",
		message: `LLM reviewer finished: ${input.llm.status}`,
		data: {
			evaluationId: input.evaluationId,
			status: input.llm.status,
			outputDigest: input.llm.outputDigest,
			errorCode: input.llm.errorCode,
			firewallFindings: input.firewallFindings,
			reviewer: { kind: "llm" },
		},
	};
}

export function buildEvaluationFinishedEvent(
	input: BaseEventInput & {
		evaluationId: string;
		rubricId: string;
		status: ReviewerEvaluationStatus;
		deterministicVerdict: ReviewVerdict;
		llmVerdict?: ReviewVerdict;
		finalReviewerVerdict: ReviewVerdict;
		reviewResultId: string;
		blockingFindingCount: number;
		degradedReasons: string[];
		reviewResult?: unknown;
	},
): RunEventBase {
	return {
		...base(input),
		type: "review.evaluation_finished",
		severity:
			input.status === "failed"
				? "error"
				: input.status === "degraded"
					? "warning"
					: "checkpoint",
		actor: "system",
		message: `Reviewer evaluation finished: ${input.finalReviewerVerdict}`,
		data: {
			evaluationId: input.evaluationId,
			rubricId: input.rubricId,
			status: input.status,
			deterministicVerdict: input.deterministicVerdict,
			llmVerdict: input.llmVerdict,
			finalReviewerVerdict: input.finalReviewerVerdict,
			reviewResultId: input.reviewResultId,
			blockingFindingCount: input.blockingFindingCount,
			degradedReasons: input.degradedReasons,
			reviewResult: input.reviewResult,
			reviewer: { kind: input.llmVerdict ? "combined" : "deterministic" },
		},
	};
}
