import * as repo from "../../modules/nightworkers/nightworkers.repository";
import type { RunControlState, RunTerminalReason } from "./contracts";
import { RunControlRepository } from "./run-control-repository";

export type FinalizeGuardResult = {
	allowFinalize: boolean;
	code: string;
	message: string;
	missingConditions: string[];
	recoveryCard: string | null;
	state: RunControlState | null;
	idempotent: boolean;
};

export class RunFinalizeController {
	constructor(private readonly repository = new RunControlRepository()) {}

	async evaluateCandidate(input: {
		runId: string;
		allowedOpenTodoProcedureIds?: string[];
		requireFreshEvidence?: boolean;
	}): Promise<FinalizeGuardResult> {
		let state: RunControlState;
		try {
			state = await this.repository.getOrCreateState(input.runId);
		} catch {
			return blocked(
				"RUN_CONTROL_UNAVAILABLE",
				"Run control state could not be loaded; finalization is blocked.",
				["run_control_state"],
				null,
			);
		}
		if (state.phase === "terminal") {
			return {
				allowFinalize: state.terminalReason === "completed",
				code: "RUN_ALREADY_TERMINAL",
				message: `Run is already terminal (${state.terminalReason ?? "unknown"}).`,
				missingConditions: [],
				recoveryCard: null,
				state,
				idempotent: true,
			};
		}

		const allowedProcedures = new Set(input.allowedOpenTodoProcedureIds ?? []);
		let openTodos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>;
		try {
			openTodos = (await repo.listTaskRunTodosForRun(input.runId)).filter(
				(todo) =>
					["pending", "running"].includes(todo.status) &&
					!allowedProcedures.has(todo.procedureId ?? ""),
			);
		} catch {
			return blocked(
				"TODO_STATE_UNAVAILABLE",
				"Todo state could not be loaded; finalization is blocked.",
				["todo_state"],
				state,
			);
		}

		const missingConditions: string[] = [];
		if (openTodos.length > 0) {
			missingConditions.push(
				`open_todos:${openTodos
					.sort((left, right) => left.seq - right.seq)
					.map((todo) => todo.seq)
					.join(",")}`,
			);
		}
		if (
			input.requireFreshEvidence &&
			(state.lastEvidenceSequence === null ||
				(state.lastMutationSequence !== null &&
					state.lastEvidenceSequence < state.lastMutationSequence))
		) {
			missingConditions.push("fresh_evidence_after_last_mutation");
		}

		if (missingConditions.length > 0) {
			const recoveryState = await this.repository
				.transition({ runId: input.runId, type: "finalize_rejected" })
				.catch(() => state);
			return blocked(
				"FINALIZE_GUARD_NOT_MET",
				"Finalization is blocked until the current run state is reconciled.",
				missingConditions,
				recoveryState,
			);
		}

		const closeoutState = await this.repository.transition({
			runId: input.runId,
			type: "enter_closeout",
		});
		return {
			allowFinalize: true,
			code: "FINALIZE_ALLOWED",
			message: "Run control finalize guard passed.",
			missingConditions: [],
			recoveryCard: null,
			state: closeoutState,
			idempotent: false,
		};
	}

	async terminalize(runId: string, reason: RunTerminalReason) {
		return this.repository.terminalize(runId, reason);
	}
}

function blocked(
	code: string,
	message: string,
	missingConditions: string[],
	state: RunControlState | null,
): FinalizeGuardResult {
	return {
		allowFinalize: false,
		code,
		message,
		missingConditions,
		recoveryCard: [
			"[NightWorkers Run Control Recovery]",
			`code: ${code}`,
			`progressRevision: ${state?.progressRevision ?? "unknown"}`,
			`workspaceRevision: ${state?.workspaceRevision ?? "unknown"}`,
			`required: ${missingConditions.join(", ")}`,
			"不足条件だけを解消してください。既に得た完全なツール出力を再取得しないでください。",
		].join("\n"),
		state,
		idempotent: false,
	};
}

export const runFinalizeController = new RunFinalizeController();
