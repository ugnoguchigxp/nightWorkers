import type { MissionPilotRealtimeEvent } from "./realtime";
import type { MissionPilotPrincipal } from "./principal";

export type MissionPilotPublicResourceQuery = {
	taskId: string;
	resource: string;
	resourceId?: string;
	cursor?: number;
	limit?: number;
	principal: MissionPilotPrincipal;
};

export type MissionPilotPublicActionCommand = {
	taskId: string;
	action: string;
	expectedTaskRevision: number;
	arguments: Record<string, unknown>;
	principal: MissionPilotPrincipal;
	requestId: string;
	idempotencyKey: string;
};

export type MissionPilotHostPorts = {
	taskOperator: {
		query(input: MissionPilotPublicResourceQuery): Promise<unknown>;
		execute(input: MissionPilotPublicActionCommand): Promise<unknown>;
	};
	taskIntake: {
		submitUserMessage(input: {
			taskId: string;
			prompt: string;
			principal: MissionPilotPrincipal;
			requestId: string;
			idempotencyKey: string;
		}): Promise<unknown>;
	};
	events: {
		subscribe(listener: (event: unknown) => void): () => void;
	};
	realtime: {
		publish(event: MissionPilotRealtimeEvent): Promise<void>;
	};
	systemContext: {
		resolve(input: {
			binding: unknown;
			promptKey: string;
			values: Record<string, unknown>;
		}): Promise<unknown>;
	};
	structuredLlm: {
		generate(input: Record<string, unknown>): Promise<unknown>;
	};
	authorization: {
		assertTaskAction(input: {
			taskId: string;
			principal: MissionPilotPrincipal;
			action: string;
		}): Promise<void>;
	};
	clock: {
		now(): Date;
		setTimeout(callback: () => void, delayMs: number): unknown;
		clearTimeout(handle: unknown): void;
	};
	ids: {
		random(): string;
	};
	logger: {
		info(message: string, context?: Record<string, unknown>): void;
		error(message: string, context?: Record<string, unknown>): void;
	};
};
