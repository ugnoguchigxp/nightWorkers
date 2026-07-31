export type MissionPilotPrincipal = {
	kind: "delegated_user";
	userId: string;
	delegate: "mission_pilot";
	sessionId: string;
	authorizationRef: string;
	grantedAt: string;
	capabilityDigest: string;
};
