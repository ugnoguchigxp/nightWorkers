import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotCloseouts,
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { digestText } from "../../services/text-digest";

const execFileAsync = promisify(execFile);
const _closeoutLocks = new Map<string, Promise<unknown>>();

export async function appendFinalMissionPilotContext(input: {
	sessionId: string;
	closeoutId: string | null;
	commitSha: string | null;
	pushStatus: string | null;
	archiveRecordId: string | null;
}) {
	const [[session], [latestContext]] = await Promise.all([
		db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId))
			.limit(1),
		db
			.select()
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, input.sessionId))
			.orderBy(desc(missionPilotContextSnapshots.revision))
			.limit(1),
	]);
	if (!session || !latestContext)
		throw new Error("Mission Pilot final Context source is missing");
	const execution = readRecord(latestContext.contextJson.execution);
	const lifecycle = readRecord(execution.lifecycle);
	if (
		input.archiveRecordId &&
		lifecycle.archiveRecordId === input.archiveRecordId
	) {
		return { revision: latestContext.revision, digest: latestContext.digest };
	}
	const nextContext = {
		...latestContext.contextJson,
		execution: {
			...execution,
			closeout: {
				closeoutId: input.closeoutId,
				commitSha: input.commitSha,
				pushStatus: input.pushStatus,
			},
			lifecycle: {
				taskStatus: "archived",
				archiveRecordId: input.archiveRecordId,
			},
		},
	};
	const revision = session.contextRevision + 1;
	const digest = digestText(JSON.stringify(nextContext));
	await db.transaction(async (tx) => {
		const [updatedSession] = await tx
			.update(missionPilotSessions)
			.set({
				contextRevision: revision,
				contextDigest: digest,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.phase, "archived"),
					eq(missionPilotSessions.contextDigest, session.contextDigest),
				),
			)
			.returning({ id: missionPilotSessions.id });
		if (!updatedSession)
			throw new Error("Mission Pilot final Context admission changed");
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			revision,
			reason: "task_archived",
			contextJson: nextContext,
			digest,
			tokenEstimate: Math.ceil(JSON.stringify(nextContext).length / 4),
			createdAt: new Date(),
		});
	});
	return { revision, digest };
}

export async function markAttention(
	session: typeof missionPilotSessions.$inferSelect,
	closeoutId: string,
	reason: string,
) {
	const now = new Date();
	await db
		.update(missionPilotCloseouts)
		.set({ status: "needs_human", statusReason: reason, updatedAt: now })
		.where(eq(missionPilotCloseouts.id, closeoutId));
	await db
		.update(missionPilotSessions)
		.set({
			phase: "attention",
			lastErrorCode: "MISSION_PILOT_CLOSEOUT_BLOCKED",
			lastErrorMessage: reason,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotSessions.id, session.id),
				eq(missionPilotSessions.activeCloseoutId, closeoutId),
			),
		);
	return { status: "attention", reason } as const;
}

export function normalizeOwnedPaths(paths: string[]) {
	return [
		...new Set(
			paths
				.map((path) => path.trim())
				.filter(
					(path) =>
						path && !path.startsWith("/") && !path.split("/").includes(".."),
				),
		),
	].sort();
}

export function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function readArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function readPorcelainPath(line: string) {
	const path = line.length > 3 ? line.slice(3).trim() : "";
	const renamed = path.includes(" -> ") ? path.split(" -> ").at(-1) : path;
	return renamed?.replace(/^"|"$/g, "") ?? "";
}

export async function readPathHashes(repoRoot: string, paths: string[]) {
	const hashes = new Map<string, string>();
	for (const path of paths) {
		hashes.set(path, await hashWorkingTreePath(repoRoot, path));
	}
	return hashes;
}

export async function hashWorkingTreePath(repoRoot: string, path: string) {
	return git(repoRoot, ["hash-object", "--", path], true);
}

export function lines(value: string) {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export async function recoverMissionPilotCommittedCloseout(input: {
	repoRoot: string;
	currentHead: string;
	baselineHead: string;
	stageablePaths: string[];
}) {
	const parentHead = await git(
		input.repoRoot,
		["rev-parse", "--verify", `${input.currentHead}^`],
		true,
	);
	if (parentHead !== input.baselineHead) return false;
	const committedPaths = lines(
		await git(input.repoRoot, [
			"diff-tree",
			"--no-commit-id",
			"--name-only",
			"-r",
			input.currentHead,
		]),
	).sort();
	return (
		JSON.stringify(committedPaths) ===
		JSON.stringify([...input.stageablePaths].sort())
	);
}

export async function git(
	repoRoot: string,
	args: string[],
	allowFailure = false,
) {
	try {
		const result = await execFileAsync("git", args, {
			cwd: repoRoot,
			maxBuffer: 8 * 1024 * 1024,
		});
		return result.stdout.trim();
	} catch (error) {
		if (allowFailure) return "";
		throw error;
	}
}
