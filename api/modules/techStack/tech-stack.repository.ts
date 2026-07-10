import { eq } from "drizzle-orm";
import {
	type ProjectCodeSizeSnapshot,
	projectCodeSizeSnapshotSchema,
} from "../../../shared/schemas/tech-stack.schema";
import { db } from "../../db/client";
import { projectCodeSizeSnapshots } from "../../db/tech-stack-schema";
import type { MeasuredProjectCodeSize } from "./project-code-size.service";

function mapSnapshot(
	row: typeof projectCodeSizeSnapshots.$inferSelect,
): ProjectCodeSizeSnapshot {
	const payload = row.resultJson;
	return projectCodeSizeSnapshotSchema.parse({
		...payload,
		id: row.id,
		repositoryId: row.repositoryId,
		schemaVersion: row.schemaVersion,
		algorithmVersion: row.algorithmVersion,
		measuredAt: row.measuredAt,
		scanDurationMs: row.scanDurationMs,
		totals: {
			...(typeof payload.totals === "object" && payload.totals
				? payload.totals
				: {}),
			totalFiles: row.totalFiles,
			sourceFiles: row.sourceFiles,
			testFiles: row.testFiles,
			totalEffectiveLines: row.totalEffectiveLines,
			sourceEffectiveLines: row.sourceEffectiveLines,
			testEffectiveLines: row.testEffectiveLines,
		},
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

export async function getProjectCodeSizeSnapshot(repositoryId: string) {
	const [row] = await db
		.select()
		.from(projectCodeSizeSnapshots)
		.where(eq(projectCodeSizeSnapshots.repositoryId, repositoryId));
	return row ? mapSnapshot(row) : null;
}

export async function upsertProjectCodeSizeSnapshot(input: {
	repositoryId: string;
	measured: MeasuredProjectCodeSize;
}) {
	const now = new Date();
	const values = {
		repositoryId: input.repositoryId,
		schemaVersion: input.measured.schemaVersion,
		algorithmVersion: input.measured.algorithmVersion,
		measuredAt: input.measured.measuredAt,
		scanDurationMs: input.measured.scanDurationMs,
		gitHead: input.measured.git.head,
		gitDirty: input.measured.git.dirty,
		totalFiles: input.measured.totals.totalFiles,
		sourceFiles: input.measured.totals.sourceFiles,
		testFiles: input.measured.totals.testFiles,
		totalEffectiveLines: input.measured.totals.totalEffectiveLines,
		sourceEffectiveLines: input.measured.totals.sourceEffectiveLines,
		testEffectiveLines: input.measured.totals.testEffectiveLines,
		resultJson: input.measured as unknown as Record<string, unknown>,
		updatedAt: now,
	};
	await db.insert(projectCodeSizeSnapshots).values(values).onConflictDoUpdate({
		target: projectCodeSizeSnapshots.repositoryId,
		set: values,
	});
	const saved = await getProjectCodeSizeSnapshot(input.repositoryId);
	if (!saved) throw new Error("Project code size snapshot was not saved");
	return saved;
}
