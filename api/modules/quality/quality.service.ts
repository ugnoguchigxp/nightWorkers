import { spawn } from "node:child_process";
import path from "node:path";
import type {
	CreateCoverageImprovementTaskRequest,
	ProjectQualityCapabilities,
	ProjectQualityRun,
} from "../../../shared/schemas/quality.schema";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";
import { buildChildProcessEnvironment } from "../../services/execution/child-process-environment";
import { redactSecretText } from "../../services/security/secret-redaction";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as repo from "./quality.repository";
import {
	coverageCommandWithSummaryReporter,
	e2eCommandWithJsonReporter,
	readCoverageArtifacts,
	readE2eArtifacts,
} from "./quality-artifacts";
import { detectQualityCapabilities } from "./quality-capabilities";

export { getCoverageFileReport } from "./quality-coverage-report.service";

const MAX_OUTPUT_CHARS = 120_000;
const RECENT_QUALITY_RUN_LIMIT = 10;
const activeQualityProcesses = new Map<string, ReturnType<typeof spawn>>();

function repositoryExecutionRoot(
	repository: Awaited<ReturnType<typeof nightworkersRepo.getRepository>>,
) {
	if (!repository) throw new NotFoundError("Repository not found");
	return repository.registeredRootCanonical ?? repository.localPath;
}

async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

function commandForQualityRun(
	capabilities: ProjectQualityCapabilities,
	runType: "unit" | "e2e" | "all",
) {
	if (runType === "unit") {
		if (!capabilities.unit.runnable || !capabilities.unit.command) {
			throw new ValidationError("missing_quality_capability", {
				missingCapabilities: ["unit"],
			});
		}
		return (
			coverageCommandWithSummaryReporter(capabilities) ??
			capabilities.unit.command
		);
	}
	if (runType === "e2e") {
		if (!capabilities.e2e.runnable || !capabilities.e2e.command) {
			throw new ValidationError("missing_quality_capability", {
				missingCapabilities: ["e2e"],
			});
		}
		return e2eCommandWithJsonReporter(capabilities.e2e.command);
	}
	if (!capabilities.all.runnable || !capabilities.all.command) {
		throw new ValidationError("missing_quality_capability", {
			missingCapabilities: capabilities.all.missingCapabilities,
		});
	}
	return [
		capabilities.unit.command,
		coverageCommandWithSummaryReporter(capabilities),
		capabilities.e2e.command
			? e2eCommandWithJsonReporter(capabilities.e2e.command)
			: undefined,
	]
		.filter(Boolean)
		.join(" && ");
}

async function runShellCommand(input: {
	command: string;
	cwd: string;
	timeoutSeconds: number;
	onSpawn?: (child: ReturnType<typeof spawn>) => void;
}) {
	return new Promise<{
		exitCode: number | null;
		output: string;
		timedOut: boolean;
	}>((resolve) => {
		const child = spawn(input.command, {
			cwd: input.cwd,
			shell: true,
			detached: process.platform !== "win32",
			env: buildChildProcessEnvironment({
				purpose: "workspace_command",
				overrides: { CI: process.env.CI ?? "1" },
			}),
		});
		input.onSpawn?.(child);
		let output = "";
		let settled = false;
		let timer: ReturnType<typeof setTimeout>;
		const finish = (result: {
			exitCode: number | null;
			output: string;
			timedOut: boolean;
		}) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const append = (chunk: Buffer) => {
			output += redactSecretText(chunk.toString("utf8"));
			if (output.length > MAX_OUTPUT_CHARS)
				output = output.slice(-MAX_OUTPUT_CHARS);
		};
		timer = setTimeout(() => {
			stopQualityProcess(child);
			finish({ exitCode: null, output, timedOut: true });
		}, input.timeoutSeconds * 1000);
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		child.on("close", (exitCode) => {
			finish({ exitCode, output, timedOut: false });
		});
		child.on("error", (error) => {
			finish({
				exitCode: null,
				output: `${output}\n${error.message}`,
				timedOut: false,
			});
		});
	});
}

function stopQualityProcess(child: ReturnType<typeof spawn> | undefined) {
	if (!child || child.killed) return;
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, "SIGTERM");
			return;
		} catch {
			// The process group may already have exited.
		}
	}
	child.kill("SIGTERM");
}

function selectLatestQualityRunWithArtifact(
	runs: ProjectQualityRun[],
	artifact: "coverage" | "e2e",
) {
	return (
		runs.find((run) =>
			artifact === "coverage"
				? Boolean(run.coverageSummary)
				: Boolean(run.e2eSummary),
		) ?? null
	);
}

export async function getProjectQuality(repositoryId: string) {
	const repository = await requireRepository(repositoryId);
	const [latestUnitRun, latestE2eRun, latestAllRun, runningRuns, allRuns] =
		await Promise.all([
			repo.getLatestProjectQualityRun({ repositoryId, runType: "unit" }),
			repo.getLatestProjectQualityRun({ repositoryId, runType: "e2e" }),
			repo.getLatestProjectQualityRun({ repositoryId, runType: "all" }),
			repo.listRunningProjectQualityRuns(repositoryId),
			repo.listProjectQualityRuns(repositoryId),
		]);
	return {
		capabilities: detectQualityCapabilities(
			repositoryExecutionRoot(repository),
		),
		latestUnitRun,
		latestE2eRun,
		latestCoverageRun: selectLatestQualityRunWithArtifact(allRuns, "coverage"),
		latestE2eResultRun: selectLatestQualityRunWithArtifact(allRuns, "e2e"),
		latestAllRun,
		recentRuns: allRuns.slice(0, RECENT_QUALITY_RUN_LIMIT),
		runningRuns,
	};
}

export async function listProjectQualityRuns(repositoryId: string) {
	await requireRepository(repositoryId);
	return repo.listProjectQualityRuns(repositoryId);
}

export async function getProjectQualityRun(
	repositoryId: string,
	runId: string,
) {
	await requireRepository(repositoryId);
	const run = await repo.getProjectQualityRun(runId);
	if (!run || run.repositoryId !== repositoryId)
		throw new NotFoundError("Project quality run not found");
	return run;
}

export async function createProjectQualityRun(input: {
	repositoryId: string;
	runType: "unit" | "e2e" | "all";
}) {
	const repository = await requireRepository(input.repositoryId);
	const executionRoot = repositoryExecutionRoot(repository);
	const capabilities = detectQualityCapabilities(executionRoot);
	const command = commandForQualityRun(capabilities, input.runType);
	const run = await repo.createProjectQualityRun({
		repositoryId: repository.id,
		runType: input.runType,
		command,
	});
	const timeoutSeconds = repository.safetyPolicy?.maxCommandSeconds ?? 600;
	const commandResult = await runShellCommand({
		command,
		cwd: executionRoot,
		timeoutSeconds,
		onSpawn: (child) => activeQualityProcesses.set(run.id, child),
	});
	activeQualityProcesses.delete(run.id);
	const current = await repo.getProjectQualityRun(run.id);
	if (current?.status === "cancelled") return current;
	const needsCoverage = input.runType === "unit" || input.runType === "all";
	const needsE2e = input.runType === "e2e" || input.runType === "all";
	const coverage = needsCoverage
		? readCoverageArtifacts(executionRoot)
		: { coverageSummary: null, error: null };
	const e2e = needsE2e
		? readE2eArtifacts(executionRoot, commandResult.exitCode)
		: { e2eSummary: null, error: null };
	const errorMessage = [
		commandResult.timedOut
			? `command timed out after ${timeoutSeconds}s`
			: null,
		coverage.error,
		e2e.error,
	]
		.filter(Boolean)
		.join("; ");
	const completed = await repo.completeProjectQualityRun({
		runId: run.id,
		status:
			commandResult.exitCode === 0 && !commandResult.timedOut
				? "completed"
				: "failed",
		exitCode: commandResult.exitCode,
		latestOutput: commandResult.output,
		coverageSummary: coverage.coverageSummary,
		e2eSummary: e2e.e2eSummary,
		errorMessage: errorMessage || null,
		onlyIfRunning: true,
	});
	if (!completed) {
		const latest = await repo.getProjectQualityRun(run.id);
		if (latest) return latest;
		throw new NotFoundError("Project quality run not found");
	}
	return completed;
}

export async function cancelProjectQualityRun(
	repositoryId: string,
	runId: string,
) {
	await requireRepository(repositoryId);
	const run = await repo.getProjectQualityRun(runId);
	if (!run || run.repositoryId !== repositoryId)
		throw new NotFoundError("Project quality run not found");
	if (run.status !== "running" && run.status !== "queued") return run;
	stopQualityProcess(activeQualityProcesses.get(runId));
	activeQualityProcesses.delete(runId);
	const cancelled = await repo.completeProjectQualityRun({
		runId,
		status: "cancelled",
		errorMessage: "cancelled",
	});
	if (!cancelled) throw new NotFoundError("Project quality run not found");
	return cancelled;
}

type CoverageEntry = {
	key: string;
	file: string;
	statements: number | null;
	branches: number | null;
	functions: number | null;
	lines: number | null;
	uncovered: string;
};

function coverageSummaryRecord(summary: unknown) {
	if (!summary || typeof summary !== "object" || Array.isArray(summary))
		throw new ValidationError("Coverage summary is not available for this run");
	return summary as Record<string, unknown>;
}

function metricPercent(entry: Record<string, unknown>, metric: string) {
	const value = entry[metric];
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const pct = (value as Record<string, unknown>).pct;
	return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
}

function uncoveredLines(entry: Record<string, unknown>) {
	const value = entry.uncoveredLines;
	if (!Array.isArray(value)) return "—";
	const lines = value
		.filter((line) => typeof line === "number" || typeof line === "string")
		.map(String);
	return lines.length > 0 ? lines.join(", ") : "—";
}

function displayCoverageFilePath(fileKey: string, projectRoot: string) {
	const normalizedFile = fileKey.replace(/\\/g, "/");
	const normalizedRoot = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
	if (normalizedFile.startsWith(`${normalizedRoot}/`))
		return normalizedFile.slice(normalizedRoot.length + 1);
	if (!path.isAbsolute(normalizedFile)) return normalizedFile;
	return path.basename(normalizedFile);
}

function selectedCoverageEntries(input: {
	summary: unknown;
	fileKeys: string[];
	projectRoot: string;
}): CoverageEntry[] {
	const summary = coverageSummaryRecord(input.summary);
	const keys = [...new Set(input.fileKeys)];
	const entries = keys.map((key) => {
		if (key === "total")
			throw new ValidationError("Coverage total row cannot become a task");
		const raw = summary[key];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new ValidationError("Coverage file was not found in this run", {
				fileKey: key,
			});
		}
		const entry = raw as Record<string, unknown>;
		return {
			key,
			file: displayCoverageFilePath(key, input.projectRoot),
			statements: metricPercent(entry, "statements"),
			branches: metricPercent(entry, "branches"),
			functions: metricPercent(entry, "functions"),
			lines: metricPercent(entry, "lines"),
			uncovered: uncoveredLines(entry),
		};
	});
	return entries.sort((left, right) => left.file.localeCompare(right.file));
}

function formatPercent(value: number | null) {
	return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatMeasuredAt(value: string | Date) {
	const date = value instanceof Date ? value : new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function buildCoverageTaskDescription(
	run: ProjectQualityRun,
	entries: CoverageEntry[],
) {
	return [
		`Quality Run: ${run.id}`,
		`Run type: ${run.runType}`,
		`Measured at: ${formatMeasuredAt(run.completedAt ?? run.startedAt)}`,
		"",
		"対象ファイル:",
		...entries.flatMap((entry) => [
			`- ${entry.file}`,
			`  - coverage key: ${entry.key}`,
			`  - statements: ${formatPercent(entry.statements)}`,
			`  - branches: ${formatPercent(entry.branches)}`,
			`  - functions: ${formatPercent(entry.functions)}`,
			`  - lines: ${formatPercent(entry.lines)}`,
			`  - uncovered lines: ${entry.uncovered}`,
		]),
	].join("\n");
}

const COVERAGE_TASK_OBJECTIVE = [
	"選択したファイルの未検証挙動を特定し、意味のあるテストを追加してカバレッジを改善してください。",
	"",
	"まず対象 source、既存 test、coverage gap を確認し、未カバー行や低い branch / function coverage の原因を整理してください。数値だけを上げるために production behavior を変更したり、coverage ignore directive や test-only branch を追加したりしないでください。",
	"",
	"対象はこのTaskに記録されたファイルへ限定し、関連しないリファクタリングを行わないでください。",
].join("\n");

const COVERAGE_TASK_ACCEPTANCE_CRITERIA = [
	"1. 選択 file の未カバー挙動に対応する、意味のある regression test が追加または改善されている。",
	"2. 選択 file の coverage が baseline より改善する。改善できない項目がある場合は、理由と残課題が記録されている。",
	"3. Repository の coverage summary を再生成し、全体 coverage を悪化させていない。",
	"4. 対象に関連する focused test が成功する。",
	"5. Repository の代表 verification gate が成功する、または今回の変更と無関係な失敗が明確に切り分けられている。",
	"6. Coverage 回避のための production source change、ignore directive、test-only behavior が追加されていない。",
].join("\n");

export async function createCoverageImprovementTask(input: {
	repositoryId: string;
	runId: string;
	request: CreateCoverageImprovementTaskRequest;
}) {
	const repository = await requireRepository(input.repositoryId);
	const run = await getProjectQualityRun(input.repositoryId, input.runId);
	const allRuns = await repo.listProjectQualityRuns(input.repositoryId);
	const latestCoverageRun = selectLatestQualityRunWithArtifact(
		allRuns,
		"coverage",
	);
	if (latestCoverageRun?.id !== run.id) {
		throw new AppError(
			409,
			"STALE_COVERAGE_RUN",
			"Coverage report has been updated. Select files again.",
		);
	}
	const entries = selectedCoverageEntries({
		summary: run.coverageSummary,
		fileKeys: input.request.fileKeys,
		projectRoot: repositoryExecutionRoot(repository),
	});
	const task = await nightworkersRepo.createTask({
		repositoryId: repository.id,
		title:
			entries.length === 1
				? `カバレッジ改善: ${entries[0]?.file ?? "対象ファイル"}`
				: `カバレッジ改善: ${entries.length}ファイル`,
		description: buildCoverageTaskDescription(run, entries),
		objective: COVERAGE_TASK_OBJECTIVE,
		acceptanceCriteria: COVERAGE_TASK_ACCEPTANCE_CRITERIA,
		status: "draft",
		createdBy: "quality-coverage",
	});
	return { task };
}
