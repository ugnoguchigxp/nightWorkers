import type { MissionPilotAuthorizationV4 } from "@nightworkers/mission-pilot/contracts";

export const MISSION_PILOT_DELEGATED_CAPABILITIES = [
	"plan",
	"queue",
	"implementation",
	"testMutation",
	"review",
	"localCommit",
	"taskComplete",
	"taskArchive",
] as const;

export type MissionPilotDelegatedCapability =
	(typeof MISSION_PILOT_DELEGATED_CAPABILITIES)[number];

export function createMissionPilotPersistenceAuthorization(input: {
	sessionId: string;
	taskId: string;
	activationContextRevision: number;
	activationContextDigest: string;
	grantedAt: string;
	principal: {
		kind: "human";
		actorId: string;
		authorizationRef: string;
	};
	capabilities: readonly MissionPilotDelegatedCapability[];
	capabilityDigest: string;
}): MissionPilotAuthorizationV4 {
	const granted = new Set(input.capabilities);
	const scopes = {
		plan: granted.has("plan"),
		queue: granted.has("queue"),
		implementation: granted.has("implementation"),
		testMutation: granted.has("testMutation"),
		review: granted.has("review"),
		localCommit: granted.has("localCommit"),
		taskComplete: granted.has("taskComplete"),
		taskArchive: granted.has("taskArchive"),
		push: false,
	} as const;
	return {
		version: 4,
		sessionId: input.sessionId,
		taskId: input.taskId,
		taskRef: { source: "task", id: input.taskId },
		activationContextRevision: input.activationContextRevision,
		activationContextDigest: input.activationContextDigest,
		grantedByAction: "mission_pilot_play",
		grantedAt: input.grantedAt,
		subjectUserId: input.principal.actorId,
		userAuthorizationRef: input.principal.authorizationRef,
		capabilityDigest: input.capabilityDigest,
		scopes,
		pushPolicy: "never",
	};
}
