import { eq } from "drizzle-orm";
import {
	type implementationQueueEntries,
	taskGitWorkspaces,
} from "../../db/schema";
import {
	type ClaimSkipEvidence,
	normalizeExecutionType,
	type QueueDb,
	resolveImplementationQueueExecutionLockKey,
} from "./queue-repository-row-mapper";

export async function workspaceClaimSkipEvidence(
	tx: QueueDb,
	candidate: typeof implementationQueueEntries.$inferSelect,
): Promise<ClaimSkipEvidence | null> {
	if (!candidate.workspaceRequired) return null;
	let ready = false;
	if (candidate.workspaceId) {
		const [workspace] = await tx
			.select({ status: taskGitWorkspaces.status })
			.from(taskGitWorkspaces)
			.where(eq(taskGitWorkspaces.id, candidate.workspaceId))
			.limit(1);
		ready = Boolean(
			workspace && ["ready", "active"].includes(workspace.status),
		);
	}
	if (ready) return null;
	return {
		entryId: candidate.id,
		reason: "workspace_not_ready",
		executionType: normalizeExecutionType(candidate.executionType),
		lockKey: resolveImplementationQueueExecutionLockKey(candidate),
		activeEntryIds: [],
		readyNonNormalEntryIds: [],
	};
}
