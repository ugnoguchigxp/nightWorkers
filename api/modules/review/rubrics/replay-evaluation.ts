import { randomUUID } from "node:crypto";
import { AppError } from "../../../lib/errors";
import { parseRunJsonl } from "../../../services/run-events/jsonl-parse";
import { replayRunJsonl } from "../../../services/run-events/replay";
import type {
	ParsedRunJsonl,
	ReplayResult,
} from "../../../services/run-events/types";
import { evaluateDeterministicRubric } from "./deterministic-evaluator";
import {
	buildEvaluationFinishedEvent,
	buildEvaluationStartedEvent,
	buildLlmFinishedEvent,
	buildLlmStartedEvent,
	buildRubricLoadedEvent,
} from "./events";
import { buildReviewEvidencePackFromReplay } from "./evidence-pack";
import { applyReviewerFirewall } from "./firewall";
import { callLlmReviewer } from "./llm-reviewer";
import { loadRubric } from "./loader";
import { buildAgentReviewResult, countBlockingFindings } from "./merger";
import type {
	FirewallResult,
	LlmReviewerResult,
	ReviewEvidencePack,
	ReviewerEvaluation,
	ReviewerEvaluationMode,
	RunReviewReplayEvaluationInput,
} from "./types";

type EvaluatePackInput = {
	pack: ReviewEvidencePack;
	rubricId: string;
	mode: ReviewerEvaluationMode | "replay";
	run: {
		id: string;
		taskId: string;
		status: string;
		summary?: string | null;
	};
	mockLlmOutput?: unknown;
};

const SYNTHETIC_REPLAY_TASK_ID = "00000000-0000-4000-8000-000000000000";

export async function runReviewerEvaluationFromPack(
	input: EvaluatePackInput,
): Promise<ReviewerEvaluation> {
	const evaluationId = randomUUID();
	const loaded = loadRubric(input.rubricId);
	const deterministic = evaluateDeterministicRubric(loaded.rubric, input.pack);
	const degradedReasons = [...deterministic.degradedReasons];
	let firewall: FirewallResult | undefined;
	let llm: LlmReviewerResult | undefined;

	if (input.mode === "llm_assisted") {
		llm = await callLlmReviewer({
			rubric: loaded.rubric,
			evidencePack: input.pack,
			mockDraft:
				input.mockLlmOutput === undefined
					? undefined
					: (input.mockLlmOutput as string | Record<string, unknown>),
		});
		degradedReasons.push(...llm.degradedReasons);
		const rawLlmOutput = input.mockLlmOutput ?? llm.rawOutput ?? llm.draft;
		if (rawLlmOutput) {
			firewall = applyReviewerFirewall({
				rawOutput: rawLlmOutput,
				evidencePack: input.pack,
				deterministic,
			});
			degradedReasons.push(...firewall.degradedReasons);
		}
	}

	const reviewResult = buildAgentReviewResult({
		run: input.run,
		evidencePack: input.pack,
		deterministic,
		firewall,
	});
	const blockingFindingCount = countBlockingFindings(reviewResult);
	const status = degradedReasons.length > 0 ? "degraded" : "completed";
	const baseEvent = { runId: input.run.id, taskId: input.run.taskId };
	const events = [
		buildRubricLoadedEvent({ ...baseEvent, loaded }),
		buildEvaluationStartedEvent({
			...baseEvent,
			evaluationId,
			rubricId: loaded.rubric.id,
			mode: input.mode,
		}),
		...(llm
			? [
					buildLlmStartedEvent({ ...baseEvent, evaluationId, llm }),
					buildLlmFinishedEvent({
						...baseEvent,
						evaluationId,
						llm,
						firewallFindings: firewall?.findings.map(
							(finding) => finding.title,
						),
					}),
				]
			: []),
		buildEvaluationFinishedEvent({
			...baseEvent,
			evaluationId,
			rubricId: loaded.rubric.id,
			status,
			deterministicVerdict: deterministic.verdict,
			llmVerdict: firewall?.draft?.verdict,
			finalReviewerVerdict: reviewResult.verdict,
			reviewResultId: reviewResult.id,
			blockingFindingCount,
			degradedReasons,
			reviewResult,
		}),
	];

	return {
		evaluationId,
		rubricId: loaded.rubric.id,
		status,
		mode: input.mode,
		deterministicVerdict: deterministic.verdict,
		llmVerdict: firewall?.draft?.verdict,
		finalReviewerVerdict: reviewResult.verdict,
		reviewResult,
		blockingFindingCount,
		degradedReasons,
		evidencePack: input.pack,
		events,
		llm,
	};
}

export async function runReviewReplayEvaluation(
	input: RunReviewReplayEvaluationInput,
): Promise<ReviewerEvaluation> {
	const parsed = input.parsedJsonl;
	assertParsedJsonlIsUsable(parsed);
	const replay = input.replayResult ?? replayFromParsed(parsed);
	if (!replay.sourceRunId) {
		throw new AppError(
			400,
			"INVALID_REPLAY_RESULT",
			"Replay result is missing sourceRunId",
		);
	}
	const pack = buildReviewEvidencePackFromReplay(
		replay,
		parsed?.events ?? [],
		parsed?.summary,
	);
	return runReviewerEvaluationFromPack({
		pack,
		rubricId: input.rubricId,
		mode: input.mode === "llm_assisted" ? "llm_assisted" : "replay",
		run: {
			id: pack.runId,
			taskId: pack.taskId || parsed?.header?.taskId || SYNTHETIC_REPLAY_TASK_ID,
			status: pack.status,
			summary: pack.outcome?.summary,
		},
	});
}

export function runReviewReplayEvaluationFromJsonl(input: {
	jsonl: string;
	rubricId: string;
	mode: ReviewerEvaluationMode;
}): Promise<ReviewerEvaluation> {
	const parsed = parseRunJsonl(input.jsonl);
	return runReviewReplayEvaluation({
		parsedJsonl: parsed,
		rubricId: input.rubricId,
		mode: input.mode,
	});
}

function replayFromParsed(parsed?: ParsedRunJsonl): ReplayResult {
	if (!parsed) {
		throw new Error(
			"Either parsedJsonl or replayResult is required for replay evaluation.",
		);
	}
	return replayRunJsonl(parsed);
}

function assertParsedJsonlIsUsable(parsed?: ParsedRunJsonl): void {
	if (!parsed) return;
	const error = parsed.diagnostics.find(
		(diagnostic) => diagnostic.level === "error",
	);
	if (error) {
		throw new AppError(400, "INVALID_REPLAY_JSONL", error.message, {
			diagnosticCode: error.code,
			line: error.line,
		});
	}
	if (!parsed.header?.runId) {
		throw new AppError(
			400,
			"INVALID_REPLAY_JSONL",
			"Replay JSONL is missing a run header",
		);
	}
}
