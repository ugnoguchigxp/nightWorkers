import {
	readTaskOperatorProjection,
	readTaskOperatorResource,
} from "../../taskOperator";
import type { MissionPilotTaskReadPort } from "./mission-pilot-agent.ports";
import { getMissionPilotActionDefinition } from "./mission-pilot-task-action.registry";

export const missionPilotTaskReadPort: MissionPilotTaskReadPort = {
	readTaskOperatorView(input) {
		return readTaskOperatorProjection(
			input.taskId,
			automationContext(input.sessionId),
		);
	},
	readTaskResource(input) {
		return readTaskOperatorResource({
			taskId: input.taskId,
			resourceKind: input.resourceKind,
			resourceId: input.resourceId,
			cursor: input.cursor,
			limit: input.limit,
			context: automationContext(input.sessionId),
		});
	},
	async listAvailableTaskActions(input) {
		const projection = await this.readTaskOperatorView(input);
		return projection.commandCatalog.availableIds.map((id) => {
			const definition = getMissionPilotActionDefinition(id);
			return {
				id,
				title: definition?.title ?? id,
				description: definition?.description ?? id,
				availability: "available" as const,
				expectedRevision: projection.task.revision,
			};
		});
	},
	async readTaskActionContract(input) {
		const projection = await this.readTaskOperatorView(input);
		if (!projection.commandCatalog.availableIds.includes(input.actionId))
			throw new Error("Task action is not currently available");
		const definition = getMissionPilotActionDefinition(input.actionId);
		if (!definition) throw new Error("Task action contract not found");
		return {
			id: definition.actionId,
			title: definition.title,
			description: definition.description,
			expectedRevision: projection.task.revision,
			inputSchema: definition.inputSchema,
		};
	},
};

function automationContext(sessionId: string) {
	return {
		principal: {
			kind: "automation" as const,
			actorId: sessionId,
			authorizationRef: `mission-pilot-session:${sessionId}`,
		},
	};
}
