import crypto from "node:crypto";
import type { MissionPilotBackendDependencies } from "@nightworkers/mission-pilot/backend";
import { logEvent } from "../../lib/logger";
import { submitTaskUserIntake } from "../../modules/agentsShare";
import {
	executeTaskOperatorCommand,
	humanTaskOperatorCommandContext,
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
	readTaskOperatorResource,
} from "../../modules/taskOperator";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { p } from "../../systemContexts/catalog";
import { createMissionPilotHostPorts } from "./mission-pilot-host-ports";
import { createMissionPilotRuntimeBindings } from "./mission-pilot-runtime-bindings";

export function createMissionPilotDependencies(): MissionPilotBackendDependencies {
	const host = createMissionPilotHostPorts({
		query(input) {
			return readTaskOperatorResource({
				taskId: input.taskId,
				resourceKind: input.resource,
				resourceId: input.resourceId,
				cursor: input.cursor,
				limit: input.limit,
				context: humanTaskOperatorQueryContext(),
			});
		},
		execute(input) {
			return executeTaskOperatorCommand({
				taskId: input.taskId,
				actionId: input.action,
				expectedTaskRevision: input.expectedTaskRevision,
				arguments: input.arguments,
				context: humanTaskOperatorCommandContext({
					idempotencyKey: input.idempotencyKey,
				}),
			});
		},
		submitUserMessage(input) {
			return submitTaskUserIntake({
				taskId: input.taskId,
				prompt: input.prompt,
				requestId: input.requestId,
				idempotencyKey: input.idempotencyKey,
				actor: {
					kind: "delegated_user",
					actorId: input.principal.sessionId,
				},
			});
		},
		subscribe: () => () => {},
		async publish(event) {
			nightWorkersRealtimeBroker.publish(event.taskId, event);
		},
		async resolveSystemContext(input) {
			const render = p as unknown as (
				key: string,
				values: Record<string, unknown>,
			) => string;
			return render(input.promptKey, input.values);
		},
		async generateStructured() {
			throw new Error(
				"Mission Pilot structured LLM calls use the configured provider tool-turn port",
			);
		},
		async assertTaskAction(input) {
			const projection = await readTaskOperatorProjection(
				input.taskId,
				humanTaskOperatorQueryContext(),
			);
			if (!projection.commandCatalog.availableIds.includes(input.action)) {
				throw new Error(`Task action is unavailable: ${input.action}`);
			}
		},
		now: () => new Date(),
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>),
		randomId: () => crypto.randomUUID(),
		logInfo(message, context) {
			logEvent({
				channel: "api",
				level: "info",
				message,
				meta: context,
			});
		},
		logError(message, context) {
			logEvent({
				channel: "api",
				level: "error",
				message,
				meta: context,
			});
		},
	});
	return { host, bindings: createMissionPilotRuntimeBindings() };
}
