import type { MissionPilotHostPorts } from "../contracts";
import {
	clearMissionPilotRuntimeHost,
	configureMissionPilotRuntimeHost,
	type MissionPilotRuntimeHostBindings,
} from "./host-bindings";
import {
	initializeMissionPilotAgentQuestionnaireEvents,
	initializeMissionPilotAgentTaskMessageEvents,
	initializeMissionPilotRunSync,
	missionPilotAgentFixtureRouter,
	missionPilotRouter,
	reconcileMissionPilotStartup,
	submitDueQuestionnaireDrafts,
} from "./runtime";
import {
	bootstrapMissionPilotTables,
	type MissionPilotSqlClient,
} from "./storage/bootstrap";
import { configureMissionPilotDatabase } from "./storage/database";

export type { MissionPilotRuntimeHostBindings } from "./host-bindings";
export * from "./runtime";
export * from "./storage/agent-schema";
export {
	configureMissionPilotDatabase,
	createMissionPilotDatabase,
	getMissionPilotDatabase,
	type MissionPilotDatabase,
	type MissionPilotTransaction,
} from "./storage/database";
export * from "./storage/repository";
export * from "./storage/schema";

export type MissionPilotBackendDependencies = {
	host: MissionPilotHostPorts;
	bindings: MissionPilotRuntimeHostBindings;
};

export type MissionPilotStorageDependencies = {
	client: MissionPilotSqlClient;
	logger: MissionPilotHostPorts["logger"];
};

export type MissionPilotRuntimeDependencies = MissionPilotBackendDependencies;

export function createMissionPilotRouter(
	dependencies: MissionPilotBackendDependencies,
) {
	configureMissionPilotRuntimeHost(dependencies.bindings);
	return missionPilotRouter;
}

export function createMissionPilotFixtureRouter(
	dependencies: MissionPilotBackendDependencies,
) {
	configureMissionPilotRuntimeHost(dependencies.bindings);
	return missionPilotAgentFixtureRouter;
}

export async function bootstrapMissionPilotStorage(
	dependencies: MissionPilotStorageDependencies,
): Promise<void> {
	await bootstrapMissionPilotTables(dependencies.client);
	configureMissionPilotDatabase(dependencies.client as never);
}

export async function startMissionPilotRuntime(
	dependencies: MissionPilotRuntimeDependencies,
): Promise<{ stop(): Promise<void> }> {
	configureMissionPilotRuntimeHost(dependencies.bindings);
	initializeMissionPilotRunSync();
	initializeMissionPilotAgentTaskMessageEvents();
	initializeMissionPilotAgentQuestionnaireEvents();
	await reconcileMissionPilotStartup();
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const tick = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void submitDueQuestionnaireDrafts()
				.catch((error) =>
					dependencies.host.logger.error(
						"mission pilot questionnaire scheduler failed",
						{
							errorMessage:
								error instanceof Error ? error.message : String(error),
						},
					),
				)
				.finally(tick);
		}, 1_000);
		timer.unref?.();
	};
	tick();
	return {
		async stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			clearMissionPilotRuntimeHost();
		},
	};
}
