import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as repo from "../../modules/nightworkers/nightworkers.repository";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";

export async function runE2eFixtureRuntime(
	context: AgentRunContext,
	sink: AgentRuntimeSink,
): Promise<AgentRuntimeResult> {
	if (context.latestUserMessage.includes("[fixture:policy-block]")) {
		await sink.emit({
			type: "runtime_warning",
			message: "Deterministic fixture policy block.",
			payload: {
				code: "e2e_fixture_policy_block",
				severity: "warning",
				message: "Policy blocked the deterministic fixture mutation.",
			},
		});
		return {
			terminalState: "needs_human",
			summary: "Deterministic fixture requires human retry approval.",
			finalReport: "Policy block persisted; retry after approval.",
			stoppedBy: "policy",
			riskLevel: "medium",
			testResults: { fixture: true, policyBlocked: true },
		};
	}

	await sink.emit({
		type: "runtime_started",
		message: "Deterministic E2E runtime started.",
		payload: { fixture: true },
	});
	const target = path.join(context.repoRoot, "src/greeting.txt");
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, "Hello from NightWorkers E2E\n", "utf8");
	await sink.emit({
		type: "tool_call_finished",
		message: "Fixture wrote src/greeting.txt.",
		payload: {
			toolName: "write_file",
			path: "src/greeting.txt",
			ok: true,
			exitCode: 0,
		},
	});
	await sink.emit({
		type: "verification_finished",
		message: "Deterministic verification passed.",
		payload: { command: "fixture verify", exitCode: 0, ok: true },
	});
	const now = new Date();
	for (const todo of await repo.listTaskRunTodosForRun(context.runId)) {
		await repo.updateTaskRunTodo(
			todo.id,
			{
				status: "passed",
				startedAt: todo.startedAt ? new Date(todo.startedAt) : now,
				completedAt: now,
				statusReason: "deterministic_e2e_fixture",
			},
			{ notifyTaskId: context.taskId, notifyRunId: context.runId },
		);
	}
	const diffPatch = execFileSync("git", ["diff", "--", "."], {
		cwd: context.repoRoot,
		encoding: "utf8",
	});
	await sink.emit({
		type: "diff_collected",
		message: "Deterministic fixture diff collected.",
		payload: { diffPatch, changedFiles: ["src/greeting.txt"] },
	});
	const finalReport =
		"Deterministic E2E implementation and verification completed.";
	await sink.emit({
		type: "runtime_finished",
		message: finalReport,
		payload: { terminalState: "completed", finalReport, fixture: true },
	});
	return {
		terminalState: "completed",
		summary: finalReport,
		finalReport,
		stoppedBy: "decision",
		riskLevel: "low",
		diffPatch,
		testResults: {
			fixture: true,
			verification: { command: "fixture verify", exitCode: 0 },
		},
		logContent: finalReport,
	};
}
