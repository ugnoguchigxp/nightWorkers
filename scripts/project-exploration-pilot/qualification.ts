import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	evaluatorProfileFor,
	evaluatorProfileFingerprint,
	evaluatorSetFingerprint,
	runIndependentEvaluator,
	type IndependentEvaluation,
} from "./evaluator";
import { parseStrictJson } from "./strict-json";
import { PILOT_TASKS, type PilotTask } from "./tasks";

export const EVALUATOR_QUALIFICATION_MANIFEST_SCHEMA =
	"project-intelligence-value-pilot-evaluator-qualification-manifest-v1";
export const EVALUATOR_QUALIFICATION_SCHEMA =
	"project-intelligence-value-pilot-evaluator-qualification-v1";

export type EvaluatorQualificationManifest = {
	schemaVersion: typeof EVALUATOR_QUALIFICATION_MANIFEST_SCHEMA;
	targetCommit: string;
	qualifications: Array<{
		taskId: PilotTask["id"];
		baseWorktree: string;
		positiveWorktree: string;
	}>;
};

export type EvaluatorQualificationArtifact = {
	schemaVersion: typeof EVALUATOR_QUALIFICATION_SCHEMA;
	status: "READY" | "BLOCKED";
	targetCommit: string;
	evaluatorSetFingerprint: string;
	qualifications: Array<{
		taskId: PilotTask["id"];
		profileId: PilotTask["evaluatorProfileId"];
		profileFingerprint: string;
		baseCommit: string;
		positiveCommit: string;
		baseClean: boolean;
		positiveClean: boolean;
		baseFails: boolean;
		positivePasses: boolean;
		base: IndependentEvaluation;
		positive: IndependentEvaluation;
	}>;
};

export type LoadedEvaluatorQualificationArtifact = {
	artifact: EvaluatorQualificationArtifact;
	hash: string;
};

export async function loadEvaluatorQualificationManifest(
	manifestPath: string,
): Promise<EvaluatorQualificationManifest> {
	const contents = await readFile(manifestPath, "utf8");
	let parsed: unknown;
	try {
		parsed = parseStrictJson(contents);
	} catch (error) {
		throw new Error(`Evaluator qualification manifest is not valid JSON: ${manifestPath}`, {
			cause: error,
		});
	}
	return parseEvaluatorQualificationManifest(parsed);
}

export function parseEvaluatorQualificationManifest(
	value: unknown,
): EvaluatorQualificationManifest {
	const record = object(value, "evaluator qualification manifest");
	assertKeys(
		record,
		["schemaVersion", "targetCommit", "qualifications"],
		"evaluator qualification manifest",
	);
	if (record.schemaVersion !== EVALUATOR_QUALIFICATION_MANIFEST_SCHEMA) {
		throw new Error("Unsupported evaluator qualification manifest schema.");
	}
	const qualifications = array(record.qualifications, "qualifications").map(
		(entry, index) => {
			const item = object(entry, `qualifications[${index}]`);
			assertKeys(
				item,
				["taskId", "baseWorktree", "positiveWorktree"],
				`qualifications[${index}]`,
			);
			return {
				taskId: pilotTaskId(item.taskId),
				baseWorktree: absolutePath(item.baseWorktree, "baseWorktree"),
				positiveWorktree: absolutePath(
					item.positiveWorktree,
					"positiveWorktree",
				),
			};
		},
	);
	assertFixedTaskSet(qualifications.map((entry) => entry.taskId));
	return {
		schemaVersion: EVALUATOR_QUALIFICATION_MANIFEST_SCHEMA,
		targetCommit: gitCommit(record.targetCommit, "targetCommit"),
		qualifications,
	};
}

export async function createEvaluatorQualification(
	manifest: EvaluatorQualificationManifest,
): Promise<EvaluatorQualificationArtifact> {
	const byTask = new Map(
		manifest.qualifications.map((qualification) => [
			qualification.taskId,
			qualification,
		]),
	);
	const qualifications = [] as EvaluatorQualificationArtifact["qualifications"];
	for (const task of PILOT_TASKS) {
		const worktrees = byTask.get(task.id);
		if (!worktrees) throw new Error(`Missing evaluator qualification: ${task.id}`);
		const [baseState, positiveState] = await Promise.all([
			gitState(worktrees.baseWorktree),
			gitState(worktrees.positiveWorktree),
		]);
		if (baseState.commit !== manifest.targetCommit) {
			throw new Error(
				`Base qualification worktree for ${task.id} is not at the registered target commit.`,
			);
		}
		const [base, positive] = await Promise.all([
			runIndependentEvaluator({ worktreePath: worktrees.baseWorktree, task }),
			runIndependentEvaluator({ worktreePath: worktrees.positiveWorktree, task }),
		]);
		qualifications.push({
			taskId: task.id,
			profileId: task.evaluatorProfileId,
			profileFingerprint: evaluatorProfileFingerprintForTask(task),
			baseCommit: baseState.commit,
			positiveCommit: positiveState.commit,
			baseClean: baseState.clean,
			positiveClean: positiveState.clean,
			baseFails: !base.passed && !base.evaluatorMutatedWorktree,
			positivePasses: positive.passed && !positive.evaluatorMutatedWorktree,
			base,
			positive,
		});
	}
	const status = qualifications.every(
		(qualification) =>
			qualification.baseClean &&
			qualification.positiveClean &&
			qualification.baseFails &&
			qualification.positivePasses,
	)
		? "READY"
		: "BLOCKED";
	return {
		schemaVersion: EVALUATOR_QUALIFICATION_SCHEMA,
		status,
		targetCommit: manifest.targetCommit,
		evaluatorSetFingerprint: evaluatorSetFingerprint(PILOT_TASKS),
		qualifications,
	};
}

export async function loadEvaluatorQualificationArtifact(
	artifactPath: string,
): Promise<LoadedEvaluatorQualificationArtifact> {
	const contents = await readFile(artifactPath, "utf8");
	let parsed: unknown;
	try {
		parsed = parseStrictJson(contents);
	} catch (error) {
		throw new Error(`Evaluator qualification artifact is not valid JSON: ${artifactPath}`, {
			cause: error,
		});
	}
	return {
		artifact: parseEvaluatorQualificationArtifact(parsed),
		hash: contentHash(contents),
	};
}

export function parseEvaluatorQualificationArtifact(
	value: unknown,
): EvaluatorQualificationArtifact {
	const record = object(value, "evaluator qualification artifact");
	assertKeys(
		record,
		[
			"schemaVersion",
			"status",
			"targetCommit",
			"evaluatorSetFingerprint",
			"qualifications",
		],
		"evaluator qualification artifact",
	);
	if (record.schemaVersion !== EVALUATOR_QUALIFICATION_SCHEMA) {
		throw new Error("Unsupported evaluator qualification artifact schema.");
	}
	if (record.status !== "READY" && record.status !== "BLOCKED") {
		throw new Error("Evaluator qualification status must be READY or BLOCKED.");
	}
	const qualifications = array(record.qualifications, "qualifications").map(
		(entry, index) => parseQualificationEntry(entry, index),
	);
	assertFixedTaskSet(qualifications.map((entry) => entry.taskId));
	return {
		schemaVersion: EVALUATOR_QUALIFICATION_SCHEMA,
		status: record.status,
		targetCommit: gitCommit(record.targetCommit, "targetCommit"),
		evaluatorSetFingerprint: sha256(
			record.evaluatorSetFingerprint,
			"evaluatorSetFingerprint",
		),
		qualifications,
	};
}

export function assertEvaluatorQualificationMatchesRuntime(input: {
	artifact: EvaluatorQualificationArtifact;
	targetCommit: string;
}): void {
	const expectedSetFingerprint = evaluatorSetFingerprint(PILOT_TASKS);
	if (input.artifact.status !== "READY") {
		throw new Error("Formal pilot requires a READY evaluator qualification artifact.");
	}
	if (input.artifact.targetCommit !== input.targetCommit) {
		throw new Error(
			"Evaluator qualification target commit does not match the formal pilot target.",
		);
	}
	if (input.artifact.evaluatorSetFingerprint !== expectedSetFingerprint) {
		throw new Error(
			"Evaluator qualification fingerprint does not match the current evaluator set.",
		);
	}
	for (const task of PILOT_TASKS) {
		const qualification = input.artifact.qualifications.find(
			(entry) => entry.taskId === task.id,
		);
		if (!qualification) throw new Error(`Missing evaluator qualification: ${task.id}`);
		if (qualification.profileId !== task.evaluatorProfileId) {
			throw new Error(`Evaluator profile mismatch: ${task.id}`);
		}
		if (qualification.profileFingerprint !== evaluatorProfileFingerprintForTask(task)) {
			throw new Error(`Evaluator profile fingerprint mismatch: ${task.id}`);
		}
		const expectedProfileFingerprint = evaluatorProfileFingerprintForTask(task);
		if (
			qualification.baseCommit !== input.targetCommit ||
			!qualification.baseClean ||
			!qualification.positiveClean ||
			!qualification.baseFails ||
			!qualification.positivePasses ||
			qualification.base.evaluatorMutatedWorktree ||
			qualification.positive.evaluatorMutatedWorktree
		) {
			throw new Error(`Evaluator qualification is incomplete: ${task.id}`);
		}
		if (
			qualification.base.profileId !== task.evaluatorProfileId ||
			qualification.positive.profileId !== task.evaluatorProfileId ||
			qualification.base.profileFingerprint !== expectedProfileFingerprint ||
			qualification.positive.profileFingerprint !== expectedProfileFingerprint ||
			qualification.baseFails !== !qualification.base.passed ||
			qualification.positivePasses !== qualification.positive.passed
		) {
			throw new Error(`Evaluator qualification evidence does not match: ${task.id}`);
		}
	}
}

function parseQualificationEntry(
	value: unknown,
	index: number,
): EvaluatorQualificationArtifact["qualifications"][number] {
	const entry = object(value, `qualifications[${index}]`);
	assertKeys(
		entry,
		[
			"taskId",
			"profileId",
			"profileFingerprint",
			"baseCommit",
			"positiveCommit",
			"baseClean",
			"positiveClean",
			"baseFails",
			"positivePasses",
			"base",
			"positive",
		],
		`qualifications[${index}]`,
	);
	const task = PILOT_TASKS.find((candidate) => candidate.id === entry.taskId);
	if (!task) throw new Error(`Unknown evaluator qualification task: ${String(entry.taskId)}`);
	if (entry.profileId !== task.evaluatorProfileId) {
		throw new Error(`Evaluator profile mismatch: ${task.id}`);
	}
	return {
		taskId: task.id,
		profileId: task.evaluatorProfileId,
		profileFingerprint: sha256(entry.profileFingerprint, "profileFingerprint"),
		baseCommit: gitCommit(entry.baseCommit, "baseCommit"),
		positiveCommit: gitCommit(entry.positiveCommit, "positiveCommit"),
		baseClean: boolean(entry.baseClean, "baseClean"),
		positiveClean: boolean(entry.positiveClean, "positiveClean"),
		baseFails: boolean(entry.baseFails, "baseFails"),
		positivePasses: boolean(entry.positivePasses, "positivePasses"),
		base: parseEvaluation(entry.base, "base"),
		positive: parseEvaluation(entry.positive, "positive"),
	};
}

function parseEvaluation(value: unknown, name: string): IndependentEvaluation {
	const record = object(value, name);
	assertKeys(
		record,
		[
			"profileId",
			"profileFingerprint",
			"passed",
			"verificationPassed",
			"commands",
			"beforeDiffDigest",
			"afterDiffDigest",
			"evaluatorMutatedWorktree",
		],
		name,
	);
	return {
		profileId: text(record.profileId, `${name}.profileId`) as PilotTask["evaluatorProfileId"],
		profileFingerprint: sha256(record.profileFingerprint, `${name}.profileFingerprint`),
		passed: boolean(record.passed, `${name}.passed`),
		verificationPassed: boolean(
			record.verificationPassed,
			`${name}.verificationPassed`,
		),
		commands: array(record.commands, `${name}.commands`).map((command, index) => {
			const item = object(command, `${name}.commands[${index}]`);
			assertKeys(
				item,
				["id", "exitCode", "durationMs", "outputDigest", "outputBytes", "timedOut"],
				`${name}.commands[${index}]`,
			);
			return {
				id: text(item.id, `${name}.commands[${index}].id`),
				exitCode:
					item.exitCode === null
						? null
						: integer(item.exitCode, `${name}.commands[${index}].exitCode`),
				durationMs: nonNegativeInteger(
					item.durationMs,
					`${name}.commands[${index}].durationMs`,
				),
				outputDigest: sha256(
					item.outputDigest,
					`${name}.commands[${index}].outputDigest`,
				),
				outputBytes: nonNegativeInteger(
					item.outputBytes,
					`${name}.commands[${index}].outputBytes`,
				),
				timedOut: boolean(item.timedOut, `${name}.commands[${index}].timedOut`),
			};
		}),
		beforeDiffDigest: sha256(record.beforeDiffDigest, `${name}.beforeDiffDigest`),
		afterDiffDigest: sha256(record.afterDiffDigest, `${name}.afterDiffDigest`),
		evaluatorMutatedWorktree: boolean(
			record.evaluatorMutatedWorktree,
			`${name}.evaluatorMutatedWorktree`,
		),
	};
}

function evaluatorProfileFingerprintForTask(task: PilotTask) {
	return evaluatorProfileFingerprint(evaluatorProfileFor(task));
}

async function gitState(worktreePath: string) {
	const [commit, status] = await Promise.all([
		runGit(worktreePath, ["rev-parse", "HEAD"]),
		runGit(worktreePath, ["status", "--porcelain=v1"]),
	]);
	return { commit: gitCommit(commit.trim(), "worktree commit"), clean: status.length === 0 };
}

async function runGit(cwd: string, argv: string[]) {
	const child = Bun.spawn(["git", ...argv], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: process.env.PATH ?? "" },
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`Qualification Git command failed: ${stderr.trim()}`);
	return stdout;
}

function assertFixedTaskSet(taskIds: string[]) {
	const expected = PILOT_TASKS.map((task) => task.id).sort();
	if (taskIds.length !== expected.length || [...taskIds].sort().some((id, index) => id !== expected[index])) {
		throw new Error("Evaluator qualification must cover the fixed ten-task task set exactly once.");
	}
}

function assertKeys(value: Record<string, unknown>, allowed: string[], name: string) {
	const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
	const missing = allowed.filter((key) => !(key in value));
	if (unexpected.length > 0 || missing.length > 0) {
		throw new Error(
			`${name} must have exactly the allowed fields (unexpected: ${unexpected.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}).`,
		);
	}
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
	return value;
}

function boolean(value: unknown, name: string) {
	if (typeof value !== "boolean") throw new Error(`${name} must be boolean.`);
	return value;
}

function text(value: unknown, name: string) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

function absolutePath(value: unknown, name: string) {
	const result = text(value, name);
	if (!result.startsWith("/")) throw new Error(`${name} must be an absolute path.`);
	return result;
}

function pilotTaskId(value: unknown): PilotTask["id"] {
	const task = PILOT_TASKS.find((candidate) => candidate.id === value);
	if (!task) throw new Error(`Unknown pilot task: ${String(value)}`);
	return task.id;
}

function gitCommit(value: unknown, name: string) {
	const result = text(value, name);
	if (!/^[a-f0-9]{40}$/.test(result)) {
		throw new Error(`${name} must be a full Git SHA.`);
	}
	return result;
}

function sha256(value: unknown, name: string) {
	const result = text(value, name);
	if (!/^sha256:[a-f0-9]{64}$/.test(result)) {
		throw new Error(`${name} must be a sha256 fingerprint.`);
	}
	return result;
}

function contentHash(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function integer(value: unknown, name: string) {
	if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
	return value as number;
}

function nonNegativeInteger(value: unknown, name: string) {
	const result = integer(value, name);
	if (result < 0) throw new Error(`${name} must be non-negative.`);
	return result;
}
