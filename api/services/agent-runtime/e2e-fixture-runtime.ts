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
	const fixtureBehavior = readFixtureBehavior(context.compiledPrompt);
	if (fixtureBehavior === "policy-block") {
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
	if (fixtureBehavior === "hold_until_stopped") {
		await sink.emit({
			type: "runtime_started",
			message: "Deterministic fixture is holding until stopped.",
			payload: { fixture: true, behavior: fixtureBehavior },
		});
		while (true) {
			const run = await repo.getTaskRun(context.runId);
			if (!run || run.status === "cancelled") break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return {
			terminalState: "cancelled",
			summary: "Deterministic fixture stopped by request.",
			finalReport: "Deterministic fixture stopped by request.",
			stoppedBy: "cancelled",
			riskLevel: "low",
			testResults: { fixture: true, behavior: fixtureBehavior },
		};
	}
	if (fixtureBehavior === "timeout") {
		await sink.emit({
			type: "runtime_started",
			message: "Deterministic fixture is waiting for its run timeout.",
			payload: { fixture: true, behavior: fixtureBehavior },
		});
		await new Promise((resolve) =>
			setTimeout(resolve, Math.max(1, context.timeoutSeconds) * 1000),
		);
		return {
			terminalState: "timed_out",
			summary: "Deterministic fixture timed out.",
			finalReport: `Deterministic fixture timed out after ${context.timeoutSeconds}s.`,
			stoppedBy: "budget",
			riskLevel: "medium",
			testResults: { fixture: true, behavior: fixtureBehavior },
		};
	}
	if (fixtureBehavior === "tool_failure") {
		await sink.emit({
			type: "runtime_error",
			message: "Deterministic fixture tool failure.",
			payload: { fixture: true, behavior: fixtureBehavior },
		});
		return {
			terminalState: "failed",
			summary: "Deterministic fixture tool failure.",
			finalReport:
				"Deterministic fixture tool failure before any workspace mutation.",
			stoppedBy: "tool_failure",
			riskLevel: "medium",
			testResults: { fixture: true, behavior: fixtureBehavior },
		};
	}
	if (fixtureBehavior === "verification_failure") {
		await sink.emit({
			type: "verification_finished",
			message: "Deterministic verification failed.",
			payload: { command: "fixture verify", exitCode: 1, ok: false },
		});
		return {
			terminalState: "needs_human",
			summary: "Deterministic verification requires follow-up.",
			finalReport: "Required deterministic verification failed.",
			stoppedBy: "tool_failure",
			riskLevel: "medium",
			testResults: { fixture: true, behavior: fixtureBehavior },
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

function readFixtureBehavior(message: string) {
	const matches = [
		...message.matchAll(
			/\[fixture:(policy-block|hold_until_stopped|timeout|tool_failure|verification_failure|success)\]/g,
		),
	];
	return matches.at(-1)?.[1] ?? null;
}
