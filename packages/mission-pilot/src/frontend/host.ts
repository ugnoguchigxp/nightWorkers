import type { ComponentType, ReactNode } from "react";

export type MissionPilotTask = {
	id: string;
	title: string;
	objective?: string | null;
};

export type MissionPilotTaskRun = {
	taskId: string;
	status: string;
	contextSnapshot?: unknown | null;
};

export type MissionPilotTaskMessage = {
	id: string;
	content: string;
	role: "user" | "assistant" | "system" | "tool";
	messageType?: string | null;
	metadataJson?: unknown;
	traceOwner: string;
	traceChannel: string;
	createdAt: unknown;
};

export type MissionPilotTaskEvent = {
	id: string;
	runId?: string;
	seq?: number;
	type?: string;
	eventType?: string | null;
	actor?: string;
	message: string;
	payloadJson?: Record<string, unknown>;
	createdAt: unknown;
};

export type MissionPilotActivityEvent = {
	id: string;
	taskId: string;
	runId?: string | null;
	seq: number;
	kind: string;
	source: string;
	text?: string | null;
	payloadJson?: unknown;
	artifactId?: string | null;
	traceOwner: string;
	traceChannel: string;
	createdAt: unknown;
};

export type MissionPilotPlanModeWorkspace = {
	featurePlanArtifacts: MissionPilotPlanModeWorkspaceArtifact[];
	blueprintArtifacts: MissionPilotPlanModeWorkspaceArtifact[];
	dataModelArtifacts: MissionPilotPlanModeWorkspaceArtifact[];
	dedicatedViewArtifacts: MissionPilotPlanModeWorkspaceArtifact[];
	questionnaireSessions: Array<{
		id: string;
		status: string;
	}>;
};

export type MissionPilotPlanModeWorkspaceArtifact = {
	id: string;
	kind: string;
	createdAt: unknown;
};

export type MissionPilotWorkbenchArtifactRef = {
	kind: string;
	metadata?: Record<string, unknown>;
};

export type MissionPilotWorkbenchRouteState = {
	kind: string;
	sessionId?: string;
};

export type MissionPilotSessionRouteState = {
	kind: "session";
	sessionId: string;
	artifact:
		| {
				kind: "plan_mode_workspace";
				tab:
					| "feature-plan"
					| "blueprint"
					| "data-model"
					| "user-flow"
					| "api-io-contract"
					| "activity-flow"
					| "sequence-flow"
					| "zod-schema-design"
					| "questionnaire";
		  }
		| { kind: "todo" }
		| { kind: "review_status" }
		| null;
};

export type MissionPilotFrontendHost = {
	request(input: string, init?: RequestInit): Promise<Response>;
	ThreadMessage: ComponentType<{
		messageRole: "user";
		children: ReactNode;
	}>;
	AgentDebugEventCard: ComponentType<{
		event: MissionPilotTaskEvent;
		variant: "dock";
		timestamp: string;
	}>;
	formatRelativeTimestamp(value: unknown): string;
};

let frontendHost: MissionPilotFrontendHost | null = null;

export function configureMissionPilotFrontendHost(
	host: MissionPilotFrontendHost,
) {
	frontendHost = host;
}

export function getMissionPilotFrontendHost(): MissionPilotFrontendHost {
	if (!frontendHost)
		throw new Error(
			"Mission Pilot frontend host has not been configured by the composition root.",
		);
	return frontendHost;
}
