import type { MissionPilotRealtimeEvent } from "./realtime";

export type MissionPilotPublicResourceQuery = {
	taskId: string;
	resource: string;
	input?: Record<string, unknown>;
};

export type MissionPilotPublicActionCommand = {
	taskId: string;
	action: string;
	input: Record<string, unknown>;
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
			message: string;
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
		resolve(input: { bindingId: string }): Promise<unknown>;
	};
	structuredLlm: {
		generate(input: Record<string, unknown>): Promise<unknown>;
	};
	authorization: {
		assertTaskAction(input: {
			taskId: string;
			userId: string;
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
