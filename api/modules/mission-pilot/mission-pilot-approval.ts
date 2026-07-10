import { createHash } from "node:crypto";
import {
	type MissionTaskCandidateSnapshot,
	missionTaskCandidateSnapshotSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import type { MissionTaskProposal } from "../../../shared/schemas/mission-planner.schema";

function compareObjectKeys(left: string, right: string) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function canonicalizeMissionSnapshot(value: unknown): string {
	if (value === null || typeof value !== "object") {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) {
			throw new TypeError("Mission snapshot contains a non-JSON value");
		}
		return serialized;
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalizeMissionSnapshot).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).sort(
		([left], [right]) => compareObjectKeys(left, right),
	);
	return `{${entries
		.map(
			([key, entry]) =>
				`${JSON.stringify(key)}:${canonicalizeMissionSnapshot(entry)}`,
		)
		.join(",")}}`;
}

export function createMissionTaskCandidateSnapshot(
	proposal: MissionTaskProposal,
): MissionTaskCandidateSnapshot {
	return missionTaskCandidateSnapshotSchema.parse({
		schemaVersion: "nightworkers.mission-task-candidate-snapshot/v1",
		missionId: proposal.missionId,
		planningResultId: proposal.planningResultId,
		taskCandidateId: proposal.id,
		workPackageId: proposal.workPackageId,
		decompositionTaskId: proposal.decompositionTaskId,
		title: proposal.title,
		summary: proposal.summary,
		initialPrompt: proposal.initialPrompt,
		expectedOutcome: proposal.expectedOutcome,
		implementationFocus: proposal.implementationFocus,
		acceptanceCriteria: proposal.acceptanceCriteria,
		verificationGate: proposal.verificationGate,
		dependencies: proposal.dependencies,
		targetFilesOrModules: proposal.targetFilesOrModules,
		risk: proposal.risk,
		approvalRequired: proposal.approvalRequired,
		scheduling: proposal.scheduling,
	});
}

export function hashMissionTaskCandidateSnapshot(
	snapshot: MissionTaskCandidateSnapshot,
) {
	const parsed = missionTaskCandidateSnapshotSchema.parse(snapshot);
	return createHash("sha256")
		.update(canonicalizeMissionSnapshot(parsed), "utf8")
		.digest("hex");
}

export function buildMissionTaskCandidateSnapshot(
	proposal: MissionTaskProposal,
) {
	const snapshot = createMissionTaskCandidateSnapshot(proposal);
	const canonicalJson = canonicalizeMissionSnapshot(snapshot);
	return {
		snapshot,
		canonicalJson,
		hash: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
	};
}
