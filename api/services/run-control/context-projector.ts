import * as repo from "../../modules/nightworkers/nightworkers.repository";
import { compactModelVisibleText } from "../agent-runtime/model-visible-payload";
import type { AgentRunContext } from "../agent-runtime/types";
import { digestJson } from "./action-identity";
import type { RunControlPhase } from "./contracts";
import { RunControlRepository } from "./run-control-repository";

export type RunStateCard = {
	version: 1;
	objectiveDigest: string;
	specificationRefs: string[];
	constraints: string[];
	phase: RunControlPhase;
	activeTodoSummary: unknown;
	revisions: {
		progress: number;
		workspace: number;
		workflow: number;
		todo: number;
		evidence: number;
		contextEpoch: number;
	};
	changedPathSummary: string[];
	evidenceRefs: string[];
	recentFailureDigests: string[];
	unresolvedRisks: string[];
	recoveryRequirement: string | null;
};

export class RunStateCardProjector {
	constructor(private readonly repository = new RunControlRepository()) {}

	async build(context: AgentRunContext): Promise<{
		card: RunStateCard;
		content: string;
	}> {
		const [state, actions, latestTodos] = await Promise.all([
			this.repository.getOrCreateState(context.runId),
			this.repository.listRecentActions(context.runId, 12),
			repo.listTaskRunTodosForRun(context.runId).catch(() => null),
		]);
		const changedPaths = new Set<string>();
		const evidenceRefs = new Set<string>();
		const recentFailureDigests: string[] = [];
		for (const action of actions) {
			for (const ref of action.evidenceRefsJson ?? []) evidenceRefs.add(ref);
			collectChangedPaths(action.modelViewJson, changedPaths);
			if (action.domainOutcome === "failed" && action.resultDigest) {
				recentFailureDigests.push(action.resultDigest);
			}
		}
		const card: RunStateCard = {
			version: 1,
			objectiveDigest: digestJson({
				compiledPrompt: context.compiledPrompt,
				latestUserMessage: context.latestUserMessage,
			}),
			specificationRefs: collectSpecificationRefs(context),
			constraints: collectConstraints(context),
			phase: state.phase,
			activeTodoSummary:
				latestTodos === null
					? (context.currentTodo ?? null)
					: summarizeActiveTodo(latestTodos),
			revisions: {
				progress: state.progressRevision,
				workspace: state.workspaceRevision,
				workflow: state.workflowRevision,
				todo: state.todoRevision,
				evidence: state.evidenceRevision,
				contextEpoch: state.contextEpoch,
			},
			changedPathSummary: [...changedPaths].slice(0, 100),
			evidenceRefs: [...evidenceRefs].slice(0, 100),
			recentFailureDigests: recentFailureDigests.slice(0, 8),
			unresolvedRisks: [],
			recoveryRequirement:
				state.phase === "recovery"
					? "新しい観測、workspace/workflowの変更、新しい証跡、または明示的blockerのいずれかを一つ生成する"
					: null,
		};
		const content = compactModelVisibleText({
			content: JSON.stringify(card, null, 2),
			limitChars: 12_000,
			strategy: "json_summary",
			omittedReason: "run_state_card_limit",
		}).content;
		return { card, content };
	}
}

function summarizeActiveTodo(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
) {
	const todo =
		todos.find((candidate) => candidate.status === "running") ??
		todos.find((candidate) => candidate.status === "pending") ??
		null;
	if (!todo) return null;
	return {
		id: todo.id,
		seq: todo.seq,
		title: todo.title,
		taskType: todo.taskType,
		status: todo.status,
		procedureId: todo.procedureId,
	};
}

function collectSpecificationRefs(context: AgentRunContext) {
	const refs = new Set<string>();
	const conversation = context.contextSnapshot.conversationContext;
	if (conversation?.snapshotId)
		refs.add(`conversation:${conversation.snapshotId}`);
	if (context.contextSnapshot.roleContext?.handoff.eventId) {
		refs.add(`handoff:${context.contextSnapshot.roleContext.handoff.eventId}`);
	}
	return [...refs];
}

function collectConstraints(context: AgentRunContext) {
	const constraints: string[] = [];
	if (context.safetyPolicy?.allowedPaths?.length)
		constraints.push(
			`allowedPaths:${context.safetyPolicy.allowedPaths.length}`,
		);
	if (context.safetyPolicy?.deniedPaths?.length)
		constraints.push(`deniedPaths:${context.safetyPolicy.deniedPaths.length}`);
	if (context.safetyPolicy?.blockedCommands?.length)
		constraints.push(
			`blockedCommands:${context.safetyPolicy.blockedCommands.length}`,
		);
	return constraints;
}

function collectChangedPaths(value: unknown, target: Set<string>) {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value.slice(0, 100)) collectChangedPaths(item, target);
		return;
	}
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (
			(key === "path" || key === "filePath" || key === "targetPath") &&
			typeof entry === "string"
		) {
			target.add(entry);
			continue;
		}
		if (key === "changedFiles" || key === "files")
			collectChangedPaths(entry, target);
	}
}

export const runStateCardProjector = new RunStateCardProjector();
