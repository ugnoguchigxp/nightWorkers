import {
	buildCodingAgentRecoveryGuidance,
	contentDigest,
} from "../../agentsShare";
import type { CodingAgentContextPacket } from "./types";

export function buildCodingAgentTodoRecoveryGuidance(input: {
	taskId: string;
	runId: string;
	repositoryRoot: string;
	packet: CodingAgentContextPacket | null;
	latestUserMessage?: string;
	finalCandidate?: string;
}) {
	const current = input.packet?.currentTodo ?? null;
	const planSummary = input.packet?.planSummary ?? null;
	const latestUserMessage = input.latestUserMessage?.trim() ?? "";
	const finalCandidate = input.finalCandidate?.trim() ?? "";
	return buildCodingAgentRecoveryGuidance({
		authoritativeContext: {
			taskId: input.taskId,
			runId: input.runId,
			repositoryRoot: input.repositoryRoot,
			...(planSummary ? { planRevision: planSummary.planRevision } : {}),
			currentTodoId: current?.id,
		},
		observations: [
			...(planSummary
				? [
						{
							kind: "event" as const,
							summary: `Todo plan: ${planSummary.todos
								.map(
									(todo) =>
										`${todo.todoKey}:${todo.status}:r${todo.revision}:${todo.id}`,
								)
								.join(" | ")}`,
							digest: contentDigest(JSON.stringify(planSummary)),
						},
					]
				: []),
			...(latestUserMessage
				? [
						{
							kind: "source" as const,
							summary: "最新のユーザー依頼はRun contextに保持されています。",
							digest: contentDigest(latestUserMessage),
							rawRef: "agentRunContext.latestUserMessage",
						},
					]
				: []),
		],
		discrepancies: [],
		unresolvedItems: [
			...(current?.lastFailure ? [current.lastFailure] : []),
			...(current ? [current.nextAction] : []),
		],
		recoveryRefs: [
			...(planSummary
				? [
						{
							kind: "todo" as const,
							digest: contentDigest(JSON.stringify(planSummary)),
							itemCount: planSummary.todos.length,
						},
					]
				: []),
			...(finalCandidate
				? [
						{
							kind: "candidate" as const,
							digest: contentDigest(finalCandidate),
							itemCount: 1,
						},
					]
				: []),
		],
		satisfactionConditions: current?.acceptanceCriteria ?? [],
	});
}

export function renderCodingAgentTodoRecoveryGuidance(input: {
	taskId: string;
	runId: string;
	repositoryRoot: string;
	packet: CodingAgentContextPacket | null;
}) {
	if (!input.packet || input.packet.planSummary.todos.length === 0) return null;
	const guidance = buildCodingAgentTodoRecoveryGuidance(input);
	return `<CODING_AGENT_RECOVERY_GUIDANCE>\n${JSON.stringify(
		guidance,
		null,
		2,
	)}\n</CODING_AGENT_RECOVERY_GUIDANCE>`;
}

export function buildCodingAgentCompletionRecoveryFeedback(input: {
	taskId: string;
	runId: string;
	repositoryRoot: string;
	latestUserMessage: string;
	packet: CodingAgentContextPacket | null;
	finalCandidate: string;
	precondition: { code: string; message: string };
	currentSnapshot: unknown;
}) {
	const currentSnapshot = compactCompletionSnapshot(input.currentSnapshot);
	const recoveryContext = buildCodingAgentTodoRecoveryGuidance({
		taskId: input.taskId,
		runId: input.runId,
		repositoryRoot: input.repositoryRoot,
		packet: input.packet,
		latestUserMessage: input.latestUserMessage,
		finalCandidate: input.finalCandidate,
	});
	return JSON.stringify({
		ok: false,
		error: input.precondition,
		currentSnapshot,
		currentSnapshotDigest: contentDigest(JSON.stringify(input.currentSnapshot)),
		currentSnapshotRef: "runFinalizeController.currentSnapshot",
		finalCandidate: input.finalCandidate,
		currentRecoveryContext: compactCompletionRecoveryContext(
			recoveryContext,
			currentSnapshot,
		),
	});
}

function compactCompletionSnapshot(value: unknown): unknown {
	const snapshot = record(value);
	if (!snapshot) return value;
	const readiness = record(snapshot.readiness);
	if (!readiness) return value;
	const verification = record(readiness.verification);
	const result = record(verification?.result);
	return {
		planRevision: snapshot.planRevision,
		readiness: {
			ready: readiness.ready,
			authority: readiness.authority,
			workspace: readiness.workspace,
			verification: {
				applicability: verification?.applicability,
				checkedSourceStateHash: verification?.checkedSourceStateHash,
				result: result
					? {
							ok: result.ok,
							verificationDocumentId: result.verificationDocumentId,
							summary: result.summary,
							reason: result.reason,
						}
					: null,
			},
			candidate: readiness.candidate,
			discrepancies: readiness.discrepancies,
			satisfactionConditions: readiness.satisfactionConditions,
		},
	};
}

function compactCompletionRecoveryContext(
	guidance: ReturnType<typeof buildCodingAgentTodoRecoveryGuidance>,
	currentSnapshot: unknown,
) {
	const readiness = record(record(currentSnapshot)?.readiness);
	return {
		authoritativeContext: guidance.authoritativeContext,
		discrepancies: readiness?.discrepancies ?? [],
		unresolvedItems: guidance.unresolvedItems,
		recoveryRefs: guidance.recoveryRefs,
		satisfactionConditions:
			readiness?.satisfactionConditions ?? guidance.satisfactionConditions,
	};
}
function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
