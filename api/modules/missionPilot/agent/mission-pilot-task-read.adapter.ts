import {
	getTaskOperatorActionDefinition,
	readTaskOperatorProjection,
	readTaskOperatorResource,
} from "../../taskOperator";
import { createMissionPilotTaskOperatorAccess } from "../mission-pilot-delegation";
import type { MissionPilotTaskReadPort } from "./mission-pilot-agent.ports";
import { getMissionPilotActionUnavailableReason } from "./mission-pilot-task-action.registry";

export const missionPilotTaskReadPort: MissionPilotTaskReadPort = {
	async readTaskOperatorView(input) {
		const access = await createMissionPilotTaskOperatorAccess(input);
		return readTaskOperatorProjection(
			input.taskId,
			access.context,
			access.delegatedAuthorization,
		);
	},
	async readTaskResource(input) {
		const access = await createMissionPilotTaskOperatorAccess(input);
		return readTaskOperatorResource({
			taskId: input.taskId,
			resourceKind: input.resourceKind,
			resourceId: input.resourceId,
			cursor: input.cursor,
			limit: input.limit,
			context: access.context,
			delegatedAuthorization: access.delegatedAuthorization,
		});
	},
	async listAvailableTaskActions(input) {
		const projection = await this.readTaskOperatorView(input);
		return projection.commandCatalog.availableIds.flatMap((id) => {
			if (getMissionPilotActionUnavailableReason(id)) return [];
			const definition = getTaskOperatorActionDefinition(id);
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
		if (getMissionPilotActionUnavailableReason(input.actionId))
			throw new Error("Task action is not delegated to Mission Pilot");
		const definition = getTaskOperatorActionDefinition(input.actionId);
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
