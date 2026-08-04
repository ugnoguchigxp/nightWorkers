import { digestText } from "../../services/text-digest";
import type { RuntimePromptSnapshot } from "../../services/todo-context";

export const INTERACTIVE_REVIEW_CONTEXT_POLICY = "codex_default" as const;

export function buildInteractiveReviewRuntimeProfile(
	reviewedRunId: string | null,
) {
	return {
		version: 1 as const,
		contextPolicy: INTERACTIVE_REVIEW_CONTEXT_POLICY,
		completionPolicy: "provider_turn" as const,
		nightworkersMcp: "disabled" as const,
		reviewedRunId,
	};
}

export function buildInteractiveReviewRuntimeOptions(input: {
	reviewedRunId: string | null;
	gitCommonDir: string;
}) {
	return {
		...buildInteractiveReviewRuntimeProfile(input.reviewedRunId),
		additionalDirectories: [input.gitCommonDir],
	};
}

export function buildInteractiveReviewPromptSnapshot(input: {
	compiledPrompt: string;
	repositoryPath: string;
	taskTitle: string;
	reviewedRunId: string | null;
	runtimeLane: NonNullable<RuntimePromptSnapshot["runtimeLane"]>;
	runtimeLaneResolution: NonNullable<
		RuntimePromptSnapshot["runtimeLaneResolution"]
	>;
	effectiveLlmRouting: unknown;
}): RuntimePromptSnapshot {
	const digest = digestText(input.compiledPrompt);
	return {
		compiledPrompt: input.compiledPrompt,
		source: "task_prompt",
		degraded: false,
		executionMode: "review",
		executionPhase: "review",
		executionModeSource: "workbench_review_prompt",
		runtimeLane: input.runtimeLane,
		runtimeLaneResolution: input.runtimeLaneResolution,
		effectiveLlmRouting: input.effectiveLlmRouting,
		reviewRuntime: buildInteractiveReviewRuntimeProfile(input.reviewedRunId),
		request: {
			repositoryPath: input.repositoryPath,
			taskTitle: input.taskTitle,
			taskDescriptionDigest: digest,
		},
		result: {
			digest,
			charCount: input.compiledPrompt.length,
		},
	};
}

export function isInteractiveReviewRuntimeSnapshot(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const snapshot = value as Record<string, unknown>;
	if (snapshot.executionMode !== "review") return false;
	const reviewRuntime = snapshot.reviewRuntime;
	return (
		Boolean(reviewRuntime) &&
		typeof reviewRuntime === "object" &&
		!Array.isArray(reviewRuntime) &&
		(reviewRuntime as Record<string, unknown>).contextPolicy ===
			INTERACTIVE_REVIEW_CONTEXT_POLICY
	);
}
