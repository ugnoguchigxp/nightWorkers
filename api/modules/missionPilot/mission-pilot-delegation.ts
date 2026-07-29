import { eq } from "drizzle-orm";
import type { MissionPilotAuthorizationV4 } from "../../../shared/modules/missionPilot";
import { db } from "../../db/client";
import { missionPilotSessions } from "../../db/mission-pilot-schema";
import {
	digestTaskOperatorCapabilityGrant,
	readCurrentTaskOperatorUserCapabilities,
	type TaskOperatorCapability,
	type TaskOperatorDelegatedAuthorizationPort,
	taskOperatorPermissionDenied,
} from "../taskOperator";

type HumanPrincipal = {
	kind: "human";
	actorId: string;
	authorizationRef: string;
};

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

export function createMissionPilotAuthorization(input: {
	sessionId: string;
	taskId: string;
	activationContextRevision: number;
	activationContextDigest: string;
	grantedAt: string;
	principal: HumanPrincipal;
}): MissionPilotAuthorizationV4 {
	const userCapabilities = new Set(
		readCurrentTaskOperatorUserCapabilities({
			subjectUserId: input.principal.actorId,
			authorizationRef: input.principal.authorizationRef,
		}),
	);
	const delegatedCapabilities = DELEGATED_CAPABILITIES.filter((capability) =>
		userCapabilities.has(capability),
	);
	const granted = new Set(delegatedCapabilities);
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
	const capabilityDigest = digestTaskOperatorCapabilityGrant({
		subjectUserId: input.principal.actorId,
		authorizationRef: input.principal.authorizationRef,
		sessionId: input.sessionId,
		taskId: input.taskId,
		grantedAt: input.grantedAt,
		capabilities: capabilitiesFromScopes(scopes),
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

export const missionPilotDelegatedAuthorizationPort: TaskOperatorDelegatedAuthorizationPort =
	{
		async authorize({ principal, taskId }) {
			const session = await readMissionPilotDelegationSession(
				principal.delegationRef.sessionId,
			);
			const authorization = session?.authorizationJson;
			if (
				session?.desiredState !== "playing" ||
				session.taskId !== taskId ||
				authorization?.version !== 4 ||
				authorization.sessionId !== session.id ||
				authorization.taskId !== taskId ||
				authorization.taskRef.id !== taskId ||
				authorization.subjectUserId !== principal.subjectUserId ||
				authorization.grantedAt !== principal.delegationRef.grantedAt ||
				authorization.capabilityDigest !==
					principal.delegationRef.capabilityDigest ||
				principal.actorId !== session.id ||
				principal.authorizationRef !== delegationAuthorizationRef(session.id)
			)
				throw taskOperatorPermissionDenied(
					"Mission Pilot delegation is invalid or no longer active.",
				);
			const delegatedCapabilities = capabilitiesFromScopes(
				authorization.scopes,
			);
			const expectedDigest = digestTaskOperatorCapabilityGrant({
				subjectUserId: authorization.subjectUserId,
				authorizationRef: authorization.userAuthorizationRef,
				sessionId: authorization.sessionId,
				taskId: authorization.taskId,
				grantedAt: authorization.grantedAt,
				capabilities: delegatedCapabilities,
			});
			if (expectedDigest !== authorization.capabilityDigest)
				throw taskOperatorPermissionDenied(
					"Mission Pilot delegation capability digest is invalid.",
				);
			const currentUserCapabilities = new Set(
				readCurrentTaskOperatorUserCapabilities({
					subjectUserId: authorization.subjectUserId,
					authorizationRef: authorization.userAuthorizationRef,
				}),
			);
			return {
				capabilities: delegatedCapabilities.filter((capability) =>
					currentUserCapabilities.has(capability),
				),
			};
		},
	};

export async function createMissionPilotTaskOperatorAccess(input: {
	sessionId: string;
	taskId: string;
}) {
	const session = await readMissionPilotDelegationSession(input.sessionId);
	const authorization = session?.authorizationJson;
	if (
		!session ||
		session.taskId !== input.taskId ||
		authorization?.version !== 4
	)
		throw taskOperatorPermissionDenied(
			"Mission Pilot does not have an active delegated user authorization.",
		);
	return {
		context: {
			principal: {
				kind: "delegated_user" as const,
				actorId: session.id,
				authorizationRef: delegationAuthorizationRef(session.id),
				subjectUserId: authorization.subjectUserId,
				delegationRef: {
					sessionId: session.id,
					taskId: session.taskId,
					grantedAt: authorization.grantedAt,
					capabilityDigest: authorization.capabilityDigest,
				},
			},
		},
		delegatedAuthorization: missionPilotDelegatedAuthorizationPort,
	};
}

function capabilitiesFromScopes(
	scopes: MissionPilotAuthorizationV4["scopes"],
): TaskOperatorCapability[] {
	return (Object.entries(scopes) as Array<[TaskOperatorCapability, boolean]>)
		.filter(([, granted]) => granted)
		.map(([capability]) => capability);
}

function delegationAuthorizationRef(sessionId: string) {
	return `mission-pilot-delegation:${sessionId}`;
}

async function readMissionPilotDelegationSession(sessionId: string) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, sessionId));
	return session ?? null;
}
