import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PilotEvaluatorProfileId, PilotTask } from "./tasks";

export type EvaluatorCommand = {
	id: string;
	argv: readonly string[];
	timeoutSeconds: number;
};

export type IndependentEvaluatorProfile = {
	id: PilotEvaluatorProfileId;
	assertion: {
		filePath: string;
		requiredPattern: string;
	};
	allowedChangedPaths?: readonly string[];
	commands: readonly EvaluatorCommand[];
};

export type IndependentEvaluation = {
	profileId: PilotEvaluatorProfileId;
	profileFingerprint: string;
	passed: boolean;
	verificationPassed: boolean;
	commands: Array<{
		id: string;
		exitCode: number | null;
		durationMs: number;
		outputDigest: string;
		outputBytes: number;
		timedOut: boolean;
	}>;
	beforeDiffDigest: string;
	afterDiffDigest: string;
	evaluatorMutatedWorktree: boolean;
};

const TYPECHECK: EvaluatorCommand = {
	id: "typecheck",
	argv: ["bun", "run", "typecheck"],
	timeoutSeconds: 180,
};

const DIFF_CHECK: EvaluatorCommand = {
	id: "diff-check",
	argv: ["git", "diff", "--check"],
	timeoutSeconds: 30,
};

function focusedTest(id: string, file: string): EvaluatorCommand {
	return { id, argv: ["bun", "test", file], timeoutSeconds: 120 };
}

function focusedVitestTest(id: string, file: string): EvaluatorCommand {
	return { id, argv: ["bunx", "vitest", "run", file], timeoutSeconds: 120 };
}

/**
 * Controller-owned commands. This file is never placed in an assigned worktree
 * or projected into the task prompt, so a task agent cannot edit its own rubric.
 */
export const INDEPENDENT_EVALUATOR_PROFILES = [
	{
		id: "login-redirects-v1",
		assertion: {
			filePath: "web/src/auth-context.tsx",
			requiredPattern: "startsWith",
		},
		commands: [
			DIFF_CHECK,
			focusedVitestTest("auth-context", "web/src/auth-context.test.tsx"),
			TYPECHECK,
		],
	},
	{
		id: "cors-origins-v1",
		assertion: { filePath: "api/app/env.ts", requiredPattern: "new Set" },
		commands: [DIFF_CHECK, focusedTest("app-env", "api/app/env.test.ts"), TYPECHECK],
	},
	{
		id: "login-email-v1",
		assertion: {
			filePath: "shared/schemas/auth.schema.ts",
			requiredPattern: "toLowerCase",
		},
		commands: [DIFF_CHECK, focusedTest("auth-types", "api/modules/auth/types.test.ts"), TYPECHECK],
	},
	{
		id: "sqlite-path-v1",
		assertion: { filePath: "api/db/path.ts", requiredPattern: ".trim()" },
		commands: [DIFF_CHECK, focusedTest("database-path", "api/db/path.test.ts"), TYPECHECK],
	},
	{
		id: "csp-serialization-v1",
		assertion: {
			filePath: "api/app/security-headers.ts",
			requiredPattern: "new Set",
		},
		commands: [DIFF_CHECK, focusedTest("security-headers", "api/app/security-headers.test.ts"), TYPECHECK],
	},
	{
		id: "display-name-v1",
		assertion: {
			filePath: "shared/schemas/auth.schema.ts",
			requiredPattern: "value.trim().length > 0",
		},
		commands: [DIFF_CHECK, focusedTest("auth-schema", "api/modules/auth/types.test.ts"), TYPECHECK],
	},
	{
		id: "showcase-page-size-v1",
		assertion: {
			filePath: "web/src/showcase-table-search.ts",
			requiredPattern: 'typeof value === "string"',
		},
		commands: [
			DIFF_CHECK,
			focusedVitestTest("showcase-search", "web/src/web-search.test.ts"),
			TYPECHECK,
		],
	},
	{
		id: "jwt-payload-v1",
		assertion: {
			filePath: "api/modules/auth/types.ts",
			requiredPattern: ".strict()",
		},
		commands: [DIFF_CHECK, focusedTest("token-service", "api/modules/auth/token.service.test.ts"), TYPECHECK],
	},
	{
		id: "auth-duration-v1",
		assertion: {
			filePath: "api/modules/auth/auth-cookies.ts",
			requiredPattern: "duration.trim()",
		},
		commands: [DIFF_CHECK, focusedTest("auth-cookies", "api/modules/auth/auth-cookies.test.ts"), TYPECHECK],
	},
	{
		id: "health-cache-v1",
		assertion: {
			filePath: "api/routes/health.route.ts",
			requiredPattern: "Cache-Control",
		},
		commands: [DIFF_CHECK, focusedTest("health-route", "api/routes/health.route.test.ts"), TYPECHECK],
	},
	{
		id: "pilot-preflight-canary-v1",
		assertion: {
			filePath: "PROJECT_INTELLIGENCE_PILOT_CANARY.md",
			requiredPattern: "project-intelligence-pilot-canary-v1",
		},
		allowedChangedPaths: ["PROJECT_INTELLIGENCE_PILOT_CANARY.md"],
		commands: [DIFF_CHECK],
	},
] as const satisfies readonly IndependentEvaluatorProfile[];

export function evaluatorProfileFor(task: PilotTask): IndependentEvaluatorProfile {
	const profile = INDEPENDENT_EVALUATOR_PROFILES.find(
		(candidate) => candidate.id === task.evaluatorProfileId,
	);
	if (!profile) throw new Error(`Unknown evaluator profile: ${task.evaluatorProfileId}`);
	return profile;
}

export function evaluatorProfileFingerprint(profile: IndependentEvaluatorProfile) {
	return sha256(JSON.stringify(profile));
}

export function evaluatorSetFingerprint(tasks: readonly PilotTask[]) {
	return sha256(
		JSON.stringify(
			tasks.map((task) => ({
				taskId: task.id,
				profile: evaluatorProfileFor(task),
			})),
		),
	);
}

export async function runIndependentEvaluator(input: {
	worktreePath: string;
	task: PilotTask;
}): Promise<IndependentEvaluation> {
	const profile = evaluatorProfileFor(input.task);
	const beforeDiffDigest = await worktreeDiffDigest(input.worktreePath);
	const commands: IndependentEvaluation["commands"] = [];
	const assertion = await runControllerAssertion(input.worktreePath, profile);
	commands.push(assertion);
	for (const command of assertion.exitCode === 0 ? profile.commands : []) {
		const startedAt = Date.now();
		const result = await runCommand(input.worktreePath, command);
		commands.push({
			id: command.id,
			exitCode: result.exitCode,
			durationMs: Date.now() - startedAt,
			outputDigest: sha256(result.output),
			outputBytes: Buffer.byteLength(result.output, "utf8"),
			timedOut: result.timedOut,
		});
		if (result.exitCode !== 0 || result.timedOut) break;
	}
	const afterDiffDigest = await worktreeDiffDigest(input.worktreePath);
	const passed =
		commands.length === profile.commands.length + 1 &&
		commands.every((command) => command.exitCode === 0 && !command.timedOut);
	return {
		profileId: profile.id,
		profileFingerprint: evaluatorProfileFingerprint(profile),
		passed,
		verificationPassed: passed,
		commands,
		beforeDiffDigest,
		afterDiffDigest,
		evaluatorMutatedWorktree: beforeDiffDigest !== afterDiffDigest,
	};
}

async function runControllerAssertion(
	worktreePath: string,
	profile: IndependentEvaluatorProfile,
): Promise<IndependentEvaluation["commands"][number]> {
	const startedAt = Date.now();
	const resolved = path.resolve(worktreePath, profile.assertion.filePath);
	const contained =
		resolved === worktreePath || resolved.startsWith(`${worktreePath}${path.sep}`);
	let output: string;
	let exitCode = 0;
	if (!contained) {
		exitCode = 1;
		output = "controller_assertion_path_escape";
	} else {
		try {
			const source = await readFile(resolved, "utf8");
			output = source.includes(profile.assertion.requiredPattern)
				? "controller_assertion_passed"
				: "controller_assertion_failed";
			if (output === "controller_assertion_passed" && profile.allowedChangedPaths) {
				const changedPaths = await worktreeChangedPaths(worktreePath);
				if (
					changedPaths.some(
						(candidate) => !profile.allowedChangedPaths?.includes(candidate),
					)
				) {
					output = "controller_changed_paths_failed";
				}
			}
			if (output === "controller_assertion_failed") exitCode = 1;
			if (output === "controller_changed_paths_failed") exitCode = 1;
		} catch {
			exitCode = 1;
			output = "controller_assertion_file_unreadable";
		}
	}
	return {
		id: "controller-assertion",
		exitCode,
		durationMs: Date.now() - startedAt,
		outputDigest: sha256(output),
		outputBytes: Buffer.byteLength(output, "utf8"),
		timedOut: false,
	};
}

async function worktreeChangedPaths(worktreePath: string) {
	const [workingTree, staged, untracked] = await Promise.all([
		runCommand(worktreePath, {
			id: "changed-paths",
			argv: ["git", "diff", "--name-only", "--no-ext-diff"],
			timeoutSeconds: 30,
		}),
		runCommand(worktreePath, {
			id: "staged-changed-paths",
			argv: ["git", "diff", "--cached", "--name-only", "--no-ext-diff"],
			timeoutSeconds: 30,
		}),
		runCommand(worktreePath, {
			id: "untracked-changed-paths",
			argv: ["git", "ls-files", "--others", "--exclude-standard"],
			timeoutSeconds: 30,
		}),
	]);
	if (
		workingTree.exitCode !== 0 ||
		workingTree.timedOut ||
		staged.exitCode !== 0 ||
		staged.timedOut ||
		untracked.exitCode !== 0 ||
		untracked.timedOut
	) {
		throw new Error("Unable to inspect evaluator worktree changes.");
	}
	return [...new Set(`${workingTree.output}\n${staged.output}\n${untracked.output}`.split("\n"))]
		.map((value) => value.trim())
		.filter(Boolean);
}

async function worktreeDiffDigest(worktreePath: string) {
	const [diff, status] = await Promise.all([
		runCommand(worktreePath, {
			id: "diff-digest",
			argv: ["git", "diff", "--no-ext-diff", "--binary"],
			timeoutSeconds: 30,
		}),
		runCommand(worktreePath, {
			id: "status-digest",
			argv: ["git", "status", "--porcelain=v1", "--untracked-files=all"],
			timeoutSeconds: 30,
		}),
	]);
	if (
		diff.exitCode !== 0 ||
		diff.timedOut ||
		status.exitCode !== 0 ||
		status.timedOut
	) {
		throw new Error("Unable to record evaluator worktree diff.");
	}
	return sha256(`${diff.output}\n--worktree-status--\n${status.output}`);
}

async function runCommand(
	cwd: string,
	command: EvaluatorCommand,
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
	const child = Bun.spawn(command.argv, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: evaluatorEnvironment(),
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, command.timeoutSeconds * 1_000);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	clearTimeout(timeout);
	return { exitCode, output: `${stdout}${stderr}`, timedOut };
}

function evaluatorEnvironment(): Record<string, string> {
	const allowedKeys = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "NO_COLOR"];
	return Object.fromEntries(
		allowedKeys.flatMap((key) =>
			typeof process.env[key] === "string" ? [[key, process.env[key] as string]] : [],
		),
	);
}

function sha256(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
