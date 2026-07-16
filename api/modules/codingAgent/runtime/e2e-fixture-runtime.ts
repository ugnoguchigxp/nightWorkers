import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as repo from "../../nightworkers/nightworkers.repository";
import { getLatestVerificationDocumentForTask } from "../../nightworkers/nightworkers.verification.repository";
import { runCompletionCheck } from "../../nightworkers/nightworkers.verification.service";
import { createReviewerEvaluation } from "../../review/review-files.service";
import type {
	AgentRunContext,
	AgentRuntimeResult,
	AgentRuntimeSink,
} from "./types";

export async function runE2eFixtureRuntime(
	context: AgentRunContext,
	sink: AgentRuntimeSink,
): Promise<AgentRuntimeResult> {
	const behavior = readFixtureBehavior(
		context.latestUserMessage || context.compiledPrompt,
	);
	if (behavior === "policy-block") {
		await sink.emit({
			type: "runtime_warning",
			message: "Deterministic fixture policy block.",
			payload: {
				code: "e2e_fixture_policy_block",
				severity: "warning",
				message: "Policy blocked the deterministic fixture mutation.",
			},
		});
		return fixtureResult({
			terminalState: "needs_human",
			finalReport: "Policy block persisted; retry after approval.",
			stoppedBy: "policy",
			riskLevel: "medium",
			behavior,
		});
	}
	if (behavior === "hold_until_stopped") {
		await sink.emit({
			type: "runtime_started",
			message: "Deterministic fixture is holding until stopped.",
			payload: { fixture: true, behavior },
		});
		while (true) {
			const run = await repo.getTaskRun(context.runId);
			if (!run || run.status === "cancelled") break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return fixtureResult({
			terminalState: "cancelled",
			finalReport: "Deterministic fixture stopped by request.",
			stoppedBy: "cancelled",
			riskLevel: "low",
			behavior,
		});
	}
	if (behavior === "timeout") {
		await sink.emit({
			type: "runtime_started",
			message: "Deterministic fixture is waiting for its run timeout.",
			payload: { fixture: true, behavior },
		});
		await new Promise((resolve) =>
			setTimeout(resolve, Math.max(1, context.timeoutSeconds) * 1000),
		);
		return fixtureResult({
			terminalState: "timed_out",
			finalReport: `Deterministic fixture timed out after ${context.timeoutSeconds}s.`,
			stoppedBy: "budget",
			riskLevel: "medium",
			behavior,
		});
	}
	if (behavior === "tool_failure") {
		await sink.emit({
			type: "runtime_error",
			message: "Deterministic fixture tool failure.",
			payload: { fixture: true, behavior },
		});
		return fixtureResult({
			terminalState: "failed",
			finalReport:
				"Deterministic fixture tool failure before any workspace mutation.",
			stoppedBy: "tool_failure",
			riskLevel: "medium",
			behavior,
		});
	}
	if (behavior === "verification_failure") {
		await sink.emit({
			type: "verification_finished",
			message: "Deterministic verification failed.",
			payload: { command: "fixture verify", exitCode: 1, ok: false },
		});
		return fixtureResult({
			terminalState: "needs_human",
			finalReport: "Required deterministic verification failed.",
			stoppedBy: "tool_failure",
			riskLevel: "medium",
			behavior,
		});
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
	const testRuntime =
		typeof context.runtimeOptions?.verificationDocumentId === "string";
	const verificationCommand = testRuntime ? "bun run verify" : "fixture verify";
	if (testRuntime) {
		const hasTransientTestFailure = context.compiledPrompt.includes(
			"[fixture:test-transient-failure]",
		);
		if (hasTransientTestFailure) {
			await sink.emit({
				type: "tool_call_finished",
				message: "Deterministic fixture verification retryable failure.",
				payload: {
					toolName: "command_execution",
					command: verificationCommand,
					aggregatedOutput: "fixture verification transient failure",
					conditionIds: ["mission-pilot-archive"],
					ok: false,
					exitCode: 1,
					status: "completed",
				},
			});
			// Verification evidence timestamps are persisted with second precision.
			// Keep the retry in a later persisted second so the fixture remains
			// deterministic when the successful result supersedes this failure.
			await new Promise((resolve) => setTimeout(resolve, 1_100));
		}
		await sink.emit({
			type: "tool_call_finished",
			message: "Deterministic fixture verification completed.",
			payload: {
				toolName: "command_execution",
				command: verificationCommand,
				aggregatedOutput: "fixture verification passed",
				conditionIds: ["mission-pilot-archive"],
				ok: true,
				exitCode: 0,
				status: "completed",
			},
		});
	}
	await sink.emit({
		type: "verification_finished",
		message: "Deterministic verification passed.",
		payload: { command: verificationCommand, exitCode: 0, ok: true },
	});
	const verificationDocument = testRuntime
		? await getLatestVerificationDocumentForTask(context.taskId)
		: null;
	if (verificationDocument) {
		const completionCheck = await runCompletionCheck({
			taskId: context.taskId,
			verificationDocumentId: verificationDocument.id,
		});
		await sink.emit({
			type: "tool_call_finished",
			message: "Deterministic fixture completion check completed.",
			payload: {
				toolName: "completion_check",
				arguments: { verificationDocumentId: verificationDocument.id },
				ok: completionCheck.ok,
				status: completionCheck.ok ? "completed" : "failed",
				result: {
					ok: completionCheck.ok,
					verificationDocumentId: verificationDocument.id,
					payload: { result: completionCheck },
				},
			},
		});
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
	const reviewRuntime = isReviewRuntime(context.runtimeOptions?.reviewRun);
	if (reviewRuntime) {
		await createReviewerEvaluation(context.runId, {
			rubricId: "basic-coding-run",
			mode: "deterministic_only",
		});
	}
	const finalReport = reviewRuntime
		? JSON.stringify({
				verdict: "pass",
				summary: "Deterministic E2E review approved.",
				findings: [],
			})
		: "Deterministic E2E implementation and verification completed.";
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
			verification: { command: verificationCommand, exitCode: 0 },
		},
		logContent: finalReport,
	};
}

function isReviewRuntime(value: unknown) {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function fixtureResult(input: {
	terminalState: AgentRuntimeResult["terminalState"];
	finalReport: string;
	stoppedBy: AgentRuntimeResult["stoppedBy"];
	riskLevel: AgentRuntimeResult["riskLevel"];
	behavior: string;
}): AgentRuntimeResult {
	return {
		terminalState: input.terminalState,
		summary: input.finalReport,
		finalReport: input.finalReport,
		stoppedBy: input.stoppedBy,
		riskLevel: input.riskLevel,
		testResults: { fixture: true, behavior: input.behavior },
	};
}

function readFixtureBehavior(message: string) {
	const matches = [
		...message.matchAll(
			/\[fixture:(policy-block|hold_until_stopped|timeout|tool_failure|verification_failure|success)\]/g,
		),
	];
	return matches[0]?.[1] ?? "success";
}
