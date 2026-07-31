import type { MissionPilotAuthorizationV4 } from "@nightworkers/mission-pilot/contracts";
import {
	digestTaskOperatorCapabilityGrant,
	readCurrentTaskOperatorUserCapabilities,
	type TaskOperatorCapability,
} from "../../taskOperator";

const DELEGATED_CAPABILITIES: readonly TaskOperatorCapability[] = [
	"plan",
	"queue",
	"implementation",
	"testMutation",
	"review",
	"localCommit",
	"taskComplete",
	"taskArchive",
];

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
}): MissionPilotAuthorizationV4 {
	const userCapabilities = new Set(
		readCurrentTaskOperatorUserCapabilities({
			subjectUserId: input.principal.actorId,
			authorizationRef: input.principal.authorizationRef,
		}),
	);
	const granted = new Set(
		DELEGATED_CAPABILITIES.filter((capability) =>
			userCapabilities.has(capability),
		),
	);
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
	const capabilities = (
		Object.entries(scopes) as Array<[TaskOperatorCapability, boolean]>
	)
		.filter(([, enabled]) => enabled)
		.map(([capability]) => capability);
	const capabilityDigest = digestTaskOperatorCapabilityGrant({
		subjectUserId: input.principal.actorId,
		authorizationRef: input.principal.authorizationRef,
		sessionId: input.sessionId,
		taskId: input.taskId,
		grantedAt: input.grantedAt,
		capabilities,
	});
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
		capabilityDigest,
		scopes,
		pushPolicy: "never",
	};
}
