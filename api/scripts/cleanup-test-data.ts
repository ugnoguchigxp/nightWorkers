import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import {
	artifacts,
	repositories,
	taskEvents,
	taskMessages,
	taskRuns,
	tasks,
} from "../db/schema";

type CleanupMode = "dry-run" | "execute";

const DEFAULT_TEST_PATTERNS = [/^TEST:/];

const LEGACY_TEST_PATTERNS = [
	/review route workspace/i,
	/valid test workspace/i,
	/missing path workspace/i,
	/to be deleted/i,
];

type CleanupPlan = {
	repositoryIds: string[];
	repositories: Array<{
		id: string;
		name: string;
		localPath: string;
		createdAt: Date;
	}>;
	counts: {
		repositories: number;
		tasks: number;
		taskRuns: number;
		taskEvents: number;
		taskMessages: number;
		artifacts: number;
	};
};

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		result.push(items.slice(index, index + size));
	}
	return result;
}

function sqlString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function sqlIn(values: string[]) {
	return values.map(sqlString).join(", ");
}

function databasePath() {
	return config.DATABASE_URL.startsWith("file:")
		? config.DATABASE_URL.slice("file:".length)
		: config.DATABASE_URL;
}

function runSqliteCleanup(statements: string[]) {
	if (statements.length === 0) return;
	execFileSync("sqlite3", [databasePath()], {
		input: [
			"PRAGMA busy_timeout=10000;",
			"PRAGMA foreign_keys=ON;",
			"BEGIN;",
			...statements,
			"COMMIT;",
		].join("\n"),
		encoding: "utf-8",
	});
}

function parseArgs(argv: string[]) {
	const args = {
		mode: "dry-run" as CleanupMode,
		all: false,
		patterns: [] as string[],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--execute") {
			args.mode = "execute";
			continue;
		}
		if (arg === "--dry-run") {
			args.mode = "dry-run";
			continue;
		}
		if (arg === "--all") {
			args.all = true;
			continue;
		}
		if (arg === "--pattern") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--pattern requires a value");
			}
			args.patterns.push(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--pattern=")) {
			args.patterns.push(arg.slice("--pattern=".length));
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printHelpAndExit();
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return args;
}

function printHelpAndExit() {
	console.log(`
Cleanup NightWorkers test data.

Usage:
  pnpm cleanup:test-data
  pnpm cleanup:test-data:dry-run
  pnpm cleanup:test-data:all

Flags:
  --execute        Actually delete matching data.
  --dry-run        Preview deletions only.
  --all            Delete every repository and its dependent data.
  --pattern <re>   Add a custom test-name regular expression.
`);
	process.exit(0);
}

export function buildPatternList(patterns: string[]) {
	const sources =
		patterns.length > 0
			? patterns
			: [...DEFAULT_TEST_PATTERNS, ...LEGACY_TEST_PATTERNS].map(
					(pattern) => pattern.source,
				);
	return sources.map((source) => {
		try {
			return new RegExp(source, "i");
		} catch (error) {
			throw new Error(`Invalid pattern "${source}": ${String(error)}`);
		}
	});
}

function selectRepositories(
	allRepositories: Array<{
		id: string;
		name: string;
		localPath: string;
		createdAt: Date;
	}>,
	all: boolean,
	patterns: RegExp[],
) {
	if (all) return allRepositories;
	return allRepositories.filter((repository) =>
		patterns.some(
			(pattern) =>
				pattern.test(repository.name) || pattern.test(repository.localPath),
		),
	);
}

export async function buildPlan(
	all: boolean,
	patterns: RegExp[],
): Promise<CleanupPlan> {
	const allRepositories = await db
		.select({
			id: repositories.id,
			name: repositories.name,
			localPath: repositories.localPath,
			createdAt: repositories.createdAt,
		})
		.from(repositories)
		.orderBy(desc(repositories.createdAt));

	const selectedRepositories = selectRepositories(
		allRepositories,
		all,
		patterns,
	);
	const repositoryIds = selectedRepositories.map((repository) => repository.id);

	if (repositoryIds.length === 0) {
		return {
			repositoryIds,
			repositories: selectedRepositories,
			counts: {
				repositories: 0,
				tasks: 0,
				taskRuns: 0,
				taskEvents: 0,
				taskMessages: 0,
				artifacts: 0,
			},
		};
	}

	const [
		tasksCountRows,
		taskRunsCountRows,
		taskMessagesCountRows,
		artifactsCountRows,
	] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)` })
			.from(tasks)
			.where(inArray(tasks.repositoryId, repositoryIds)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(taskRuns)
			.where(inArray(taskRuns.repositoryId, repositoryIds)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(taskMessages)
			.innerJoin(tasks, eq(taskMessages.taskId, tasks.id))
			.where(inArray(tasks.repositoryId, repositoryIds)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(artifacts)
			.innerJoin(taskRuns, eq(artifacts.runId, taskRuns.id))
			.innerJoin(tasks, eq(taskRuns.taskId, tasks.id))
			.where(inArray(tasks.repositoryId, repositoryIds)),
	]);

	const runIds = (
		await db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.innerJoin(tasks, eq(taskRuns.taskId, tasks.id))
			.where(inArray(tasks.repositoryId, repositoryIds))
	).map((row) => row.id);

	const taskEventsCountRows =
		runIds.length === 0
			? [{ count: 0 }]
			: await db
					.select({ count: sql<number>`count(*)` })
					.from(taskEvents)
					.where(inArray(taskEvents.taskRunId, runIds));

	return {
		repositoryIds,
		repositories: selectedRepositories,
		counts: {
			repositories: selectedRepositories.length,
			tasks: tasksCountRows[0]?.count ?? 0,
			taskRuns: taskRunsCountRows[0]?.count ?? 0,
			taskEvents: taskEventsCountRows[0]?.count ?? 0,
			taskMessages: taskMessagesCountRows[0]?.count ?? 0,
			artifacts: artifactsCountRows[0]?.count ?? 0,
		},
	};
}

export async function deleteRepositories(repositoryIds: string[]) {
	if (repositoryIds.length === 0) return 0;
	const chunkSize = 100;

	const taskIds = (
		await db
			.select({ id: tasks.id })
			.from(tasks)
			.where(inArray(tasks.repositoryId, repositoryIds))
	).map((row) => row.id);
	const runIds = (
		await db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(inArray(taskRuns.repositoryId, repositoryIds))
	).map((row) => row.id);
	if (taskIds.length > 0) {
		const taskRunIds = (
			await db
				.select({ id: taskRuns.id })
				.from(taskRuns)
				.where(inArray(taskRuns.taskId, taskIds))
		).map((row) => row.id);
		for (const id of taskRunIds) {
			if (!runIds.includes(id)) runIds.push(id);
		}
	}

	const statements: string[] = [];
	for (const ids of chunks(runIds, chunkSize)) {
		const list = sqlIn(ids);
		statements.push(`DELETE FROM artifacts WHERE run_id IN (${list});`);
		statements.push(`DELETE FROM task_events WHERE task_run_id IN (${list});`);
	}
	for (const ids of chunks(taskIds, chunkSize)) {
		const list = sqlIn(ids);
		statements.push(`DELETE FROM activity_events WHERE task_id IN (${list});`);
		statements.push(
			`DELETE FROM activity_artifacts WHERE task_id IN (${list});`,
		);
		statements.push(`DELETE FROM task_messages WHERE task_id IN (${list});`);
	}
	for (const ids of chunks(runIds, chunkSize)) {
		statements.push(`DELETE FROM task_runs WHERE id IN (${sqlIn(ids)});`);
	}
	for (const ids of chunks(taskIds, chunkSize)) {
		statements.push(`DELETE FROM tasks WHERE id IN (${sqlIn(ids)});`);
	}
	for (const ids of chunks(repositoryIds, chunkSize)) {
		statements.push(`DELETE FROM repositories WHERE id IN (${sqlIn(ids)});`);
	}
	runSqliteCleanup(statements);
	return repositoryIds.length;
}

export async function cleanupNightWorkersTestData(
	input: { mode?: CleanupMode; all?: boolean; patterns?: string[] } = {},
) {
	const patterns = buildPatternList(input.patterns || []);
	const plan = await buildPlan(input.all ?? false, patterns);
	let deleted = 0;

	if (
		(input.mode || "dry-run") === "execute" &&
		plan.repositoryIds.length > 0
	) {
		deleted = await deleteRepositories(plan.repositoryIds);
	}

	return { plan, deleted };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const { plan, deleted } = await cleanupNightWorkersTestData(args);

	console.log(
		`Matched ${plan.counts.repositories} repositories, ${plan.counts.tasks} tasks, ${plan.counts.taskRuns} runs, ${plan.counts.taskEvents} events, ${plan.counts.taskMessages} messages, ${plan.counts.artifacts} artifacts.`,
	);

	if (plan.repositories.length > 0) {
		for (const repository of plan.repositories) {
			console.log(`- ${repository.name} (${repository.localPath})`);
		}
	}

	if (args.mode === "dry-run") {
		console.log(
			"Dry run only. Pass --execute to delete the matched repositories.",
		);
		return;
	}

	if (plan.repositoryIds.length === 0) {
		console.log("No repositories matched. Nothing to delete.");
		return;
	}

	console.log(`Deleted ${deleted} repositories and their dependent data.`);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
