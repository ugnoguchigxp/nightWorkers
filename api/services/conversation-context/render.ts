import { estimateTokens } from "./token-budget";
import type {
	ConversationContextOptions,
	ConversationContextSnapshotV1,
	PromptWithStateCardParts,
} from "./types";

const CODE_EDIT_JOB_TYPES = new Set([
	"code_change",
	"code_edit",
	"minor_code_edit",
]);

export function buildPromptWithStateCard(input: {
	latestUserMessage: string;
	stateCardText?: string | null;
}) {
	return buildPromptWithStateCardParts(input).promptText;
}

export function buildPromptWithStateCardParts(input: {
	latestUserMessage: string;
	stateCardText?: string | null;
}): PromptWithStateCardParts {
	const request = input.latestUserMessage.trim();
	const card = input.stateCardText?.trim();
	const promptText = card
		? `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}`
		: request;
	return {
		latestUserMessage: request,
		stateCardText: card || null,
		promptText,
		estimates: {
			latestUserMessageTokens: estimateTokens(request),
			stateCardTokens: card ? estimateTokens(card) : 0,
			promptTokens: estimateTokens(promptText),
		},
	};
}

export function renderStateCard(
	snapshot: ConversationContextSnapshotV1,
	options?: ConversationContextOptions,
) {
	const maxTokens = options?.maxTokens ?? 1200;
	const truncated = new Set(snapshot.limits.truncatedFields);
	if (snapshot.contextBaseline?.unchangedFromPrevious) {
		const lines = [
			"<STATE_CARD>",
			`Task: ${snapshot.task.id} | ${snapshot.classification.jobType || "unknown"} | unchanged continuity`,
			`Baseline: ${snapshot.contextBaseline.stateCardDigest}`,
			`Source refs: files=${snapshot.contextBaseline.relevantFilesDigest || "none"} workerEvidence=${
				snapshot.contextBaseline.workerEvidenceRefsDigest || "none"
			}`,
		];
		const lastProblem =
			snapshot.runState.lastError || snapshot.runState.lastToolFailure;
		if (lastProblem) lines.push(`Last problem: ${truncate(lastProblem, 240)}`);
		const recovery = snapshot.runState.workerEvidence?.recoveryDirective;
		if (recovery) {
			lines.push(
				`Recovery: ${truncate(
					[recovery.kind, recovery.targetPath, recovery.reason]
						.filter(Boolean)
						.join(" | "),
					260,
				)}`,
			);
		}
		if (snapshot.files.target.length) {
			lines.push(`Targets: ${snapshot.files.target.slice(0, 5).join(", ")}`);
		}
		lines.push("</STATE_CARD>");
		const text = lines.join("\n");
		snapshot.limits.tokenEstimate = estimateTokens(text);
		return text;
	}
	let renderSnapshot = snapshot;
	const build = (
		variant: "full" | "short-action" | "no-next" | "minimal",
		cardSnapshot: ConversationContextSnapshotV1 = renderSnapshot,
	) => {
		const userMax = variant === "minimal" ? 160 : 360;
		const goalMax = variant === "minimal" ? 160 : 360;
		const userRequest =
			truncate(cardSnapshot.task.latestUserRequest, userMax) || "";
		const goal = truncate(cardSnapshot.classification.goal, goalMax);
		if (cardSnapshot.task.latestUserRequest.length > userRequest.length) {
			truncated.add("task.latestUserRequest");
		}
		if (
			cardSnapshot.classification.goal &&
			goal &&
			cardSnapshot.classification.goal.length > goal.length
		) {
			truncated.add("classification.goal");
		}
		const lines: string[] = [
			"<STATE_CARD>",
			`Task: ${cardSnapshot.task.id} | ${cardSnapshot.classification.jobType || "unknown"} | ${
				cardSnapshot.continuity.isContinuation ? "continuation" : "new"
			}`,
			`User: ${userRequest}`,
		];
		if (goal) lines.push(`Goal: ${goal}`);

		if (variant !== "minimal") {
			lines.push("", "Continuity:");
			const previousAction =
				variant === "short-action"
					? truncate(cardSnapshot.continuity.previousAction, 160)
					: cardSnapshot.continuity.previousAction;
			lines.push(`- ${previousAction || "none"}`);
			if (CODE_EDIT_JOB_TYPES.has(cardSnapshot.classification.jobType || "")) {
				lines.push(
					"- current intent: continue/edit existing work, not re-plan",
				);
			}
		}

		lines.push("", "Files:");
		lines.push(
			`- target: ${cardSnapshot.files.target.length ? cardSnapshot.files.target.join(", ") : "none"}`,
		);

		if (variant === "minimal") {
			const lastProblem =
				cardSnapshot.runState.lastError ||
				cardSnapshot.runState.lastToolFailure;
			if (lastProblem) lines.push(`- problem: ${truncate(lastProblem, 180)}`);
			const workerEvidence = cardSnapshot.runState.workerEvidence;
			if (workerEvidence?.recoveryDirective) {
				const recovery = workerEvidence.recoveryDirective;
				lines.push(
					`- recovery: ${truncate(
						[recovery.kind, recovery.targetPath, recovery.reason]
							.filter(Boolean)
							.join(" | "),
						220,
					)}`,
				);
			}
			const critical = workerEvidence?.criticalEvidence[0];
			if (critical) {
				lines.push(
					`- evidence: ${truncate(
						[
							critical.toolName,
							critical.failureKind,
							critical.targetPath,
							critical.reason,
						]
							.filter(Boolean)
							.join(" | "),
						180,
					)}`,
				);
			}
		}

		if (variant !== "minimal") {
			lines.push("", "Current state:");
			lines.push(
				`- previous run: ${cardSnapshot.continuity.previousTerminalState || "unknown"}`,
			);
			lines.push(`- last error: ${cardSnapshot.runState.lastError || "none"}`);
			if (cardSnapshot.runState.lastToolFailure) {
				lines.push(
					`- last tool failure: ${truncate(cardSnapshot.runState.lastToolFailure, 300)}`,
				);
			}
			const workerEvidence = cardSnapshot.runState.workerEvidence;
			if (workerEvidence?.recoveryDirective) {
				const recovery = workerEvidence.recoveryDirective;
				lines.push(
					`- recovery: ${truncate(
						[recovery.kind, recovery.targetPath, recovery.reason]
							.filter(Boolean)
							.join(" | "),
						320,
					)}`,
				);
			}
			if (workerEvidence?.criticalEvidence.length) {
				for (const item of workerEvidence.criticalEvidence.slice(0, 2)) {
					lines.push(
						`- evidence: ${truncate(
							[item.toolName, item.failureKind, item.targetPath, item.reason]
								.filter(Boolean)
								.join(" | "),
							260,
						)}`,
					);
				}
			}
			if (cardSnapshot.runState.lastFinalReport) {
				lines.push(
					`- last final report: ${truncate(cardSnapshot.runState.lastFinalReport, 360)}`,
				);
			}
		}

		if (variant === "full" || variant === "short-action") {
			const snippets = cardSnapshot.code.snippets.filter((snippet) =>
				snippet.content.trim(),
			);
			if (snippets.length > 0) {
				lines.push("", "Relevant code:");
				for (const snippet of snippets.slice(0, 3)) {
					lines.push(
						`File: ${snippet.path} (${snippet.reason}${snippet.truncated ? ", truncated" : ""})`,
					);
					lines.push("```");
					lines.push(snippet.content);
					lines.push("```");
				}
			}
		}

		if (variant !== "minimal" && variant !== "no-next") {
			const next = deterministicNextAction(cardSnapshot);
			if (next) lines.push("", "Next:", `- ${next}`);
		}

		lines.push("</STATE_CARD>");
		return lines.join("\n");
	};

	let text = build("full");
	if (estimateTokens(text) > maxTokens) {
		truncated.add("code.snippets");
		renderSnapshot = {
			...snapshot,
			code: {
				snippets: [],
			},
		};
		text = build("full");
	}
	if (estimateTokens(text) > maxTokens) {
		truncated.add("continuity.previousAction");
		text = build("short-action");
	}
	if (estimateTokens(text) > maxTokens) {
		truncated.add("next");
		text = build("no-next");
	}
	if (estimateTokens(text) > maxTokens) {
		truncated.add("minimal");
		text = build("minimal");
	}
	snapshot.limits.truncatedFields = Array.from(truncated);
	snapshot.limits.tokenEstimate = estimateTokens(text);
	return text;
}

function deterministicNextAction(snapshot: ConversationContextSnapshotV1) {
	const recovery = snapshot.runState.workerEvidence?.recoveryDirective;
	if (recovery) {
		if (recovery.kind === "read_target_once" && recovery.targetPath) {
			return `${recovery.targetPath} を一度だけ読み直し、前回失敗を踏まえて corrected edit に進む`;
		}
		if (recovery.kind === "choose_existing_path") {
			return "前回失敗した path を繰り返さず、実在 path を使って作業を続ける";
		}
		if (recovery.kind === "advance_current_todo") {
			return "Todo 状態確認ではなく、現在 Todo に対応する worker tool で作業を進める";
		}
	}
	if (
		CODE_EDIT_JOB_TYPES.has(snapshot.classification.jobType || "") &&
		snapshot.files.target[0]
	) {
		return `${snapshot.files.target[0]} の既存変更を踏まえて最新依頼を実装する`;
	}
	return null;
}

function truncate(value: string | null, max: number) {
	if (!value) return null;
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > max
		? `${normalized.slice(0, max - 1)}…`
		: normalized;
}
