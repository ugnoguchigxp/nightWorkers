import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
	type ProjectQualityRun,
	projectQualityRunSchema,
} from "../../../shared/schemas/quality.schema";
import { db } from "../../db/client";
import { projectQualityRuns } from "../../db/project-detail-schema";

function mapQualityRun(
	row: typeof projectQualityRuns.$inferSelect,
): ProjectQualityRun {
	return projectQualityRunSchema.parse({
		id: row.id,
		repositoryId: row.repositoryId,
		runType: row.runType,
		status: row.status,
		command: row.command,
		exitCode: row.exitCode ?? null,
		startedAt: row.startedAt,
		completedAt: row.completedAt ?? null,
		outputArtifactId: row.outputArtifactId ?? null,
		latestOutput: row.latestOutput ?? null,
		coverageSummary: row.coverageSummaryJson ?? null,
		e2eSummary: row.e2eSummaryJson ?? null,
		errorMessage: row.errorMessage ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

export async function createProjectQualityRun(input: {
	repositoryId: string;
	runType: "unit" | "e2e" | "all";
	command: string;
}) {
	const now = new Date();
	const [row] = await db
		.insert(projectQualityRuns)
		.values({
			repositoryId: input.repositoryId,
			runType: input.runType,
			status: "running",
			command: input.command,
			startedAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return mapQualityRun(row);
}

export async function completeProjectQualityRun(input: {
	runId: string;
	status: "completed" | "failed" | "cancelled";
	exitCode?: number | null;
	latestOutput?: string | null;
	coverageSummary?: unknown;
	e2eSummary?: unknown;
	errorMessage?: string | null;
	onlyIfRunning?: boolean;
}) {
	const [row] = await db
		.update(projectQualityRuns)
		.set({
			status: input.status,
			exitCode: input.exitCode ?? null,
			latestOutput: input.latestOutput ?? null,
			coverageSummaryJson: input.coverageSummary ?? null,
			e2eSummaryJson: input.e2eSummary ?? null,
			errorMessage: input.errorMessage ?? null,
			completedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			input.onlyIfRunning
				? and(
						eq(projectQualityRuns.id, input.runId),
						eq(projectQualityRuns.status, "running"),
					)
				: eq(projectQualityRuns.id, input.runId),
		)
		.returning();
	return row ? mapQualityRun(row) : null;
}

export async function listProjectQualityRuns(repositoryId: string) {
	const rows = await db
		.select()
		.from(projectQualityRuns)
		.where(eq(projectQualityRuns.repositoryId, repositoryId))
		.orderBy(desc(projectQualityRuns.createdAt), desc(sql`rowid`));
	return rows.map(mapQualityRun);
}

export async function getProjectQualityRun(runId: string) {
	const [row] = await db
		.select()
		.from(projectQualityRuns)
		.where(eq(projectQualityRuns.id, runId));
	return row ? mapQualityRun(row) : null;
}

export async function getLatestProjectQualityRun(input: {
	repositoryId: string;
	runType?: string;
}) {
	const filters = [eq(projectQualityRuns.repositoryId, input.repositoryId)];
	if (input.runType)
		filters.push(eq(projectQualityRuns.runType, input.runType));
	const [row] = await db
		.select()
		.from(projectQualityRuns)
		.where(and(...filters))
		.orderBy(desc(projectQualityRuns.createdAt), desc(sql`rowid`))
		.limit(1);
	return row ? mapQualityRun(row) : null;
}

export async function listRunningProjectQualityRuns(repositoryId: string) {
	const rows = await db
		.select()
		.from(projectQualityRuns)
		.where(
			and(
				eq(projectQualityRuns.repositoryId, repositoryId),
				eq(projectQualityRuns.status, "running"),
			),
		)
		.orderBy(desc(projectQualityRuns.createdAt), desc(sql`rowid`));
	return rows.map(mapQualityRun);
}

export async function retainLatestCoverageSummary(input: {
	repositoryId: string;
	keepRunId: string;
}) {
	await db
		.update(projectQualityRuns)
		.set({
			coverageSummaryJson: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(projectQualityRuns.repositoryId, input.repositoryId),
				ne(projectQualityRuns.id, input.keepRunId),
			),
		);
}
