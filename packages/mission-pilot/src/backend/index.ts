import type { MissionPilotHostPorts } from "../contracts";
import {
	clearMissionPilotRuntimeHost,
	configureMissionPilotRuntimeHost,
	type MissionPilotPersistenceHostBinding,
	type MissionPilotRuntimeHostBindings,
} from "./host-bindings";
import {
	initializeMissionPilotAgentQuestionnaireEvents,
	initializeMissionPilotAgentTaskMessageEvents,
	initializeMissionPilotRunSync,
	missionPilotAgentFixtureRouter,
	missionPilotRouter,
	reconcileMissionPilotRunOutcomes,
	reconcileMissionPilotStartup,
	stopMissionPilotRuntimeEventListeners,
} from "./runtime";

export type {
	MissionPilotPersistenceHostBinding,
	MissionPilotRuntimeHostBindings,
} from "./host-bindings";

export type MissionPilotBackendDependencies = {
	host: MissionPilotHostPorts;
	bindings: MissionPilotRuntimeHostBindings &
		MissionPilotPersistenceHostBinding;
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

export async function startMissionPilotRuntime(
	dependencies: MissionPilotRuntimeDependencies,
): Promise<{ stop(): Promise<void> }> {
	configureMissionPilotRuntimeHost(dependencies.bindings);
	initializeMissionPilotRunSync();
	initializeMissionPilotAgentTaskMessageEvents();
	initializeMissionPilotAgentQuestionnaireEvents();
	try {
		await reconcileMissionPilotStartup();
	} catch (error) {
		stopMissionPilotRuntimeEventListeners();
		clearMissionPilotRuntimeHost();
		throw error;
	}
	let stopped = false;
	let timer: unknown = null;
	let reconciliationInFlight: Promise<void> | null = null;
	const scheduleReconciliation = () => {
		if (stopped) return;
		timer = dependencies.host.clock.setTimeout(() => {
			const reconciliation = reconcileMissionPilotRunOutcomes()
				.catch((error) =>
					dependencies.host.logger.error(
						"mission pilot run outcome reconciliation failed",
						{
							errorMessage:
								error instanceof Error ? error.message : String(error),
						},
					),
				)
				.then(() => undefined);
			reconciliationInFlight = reconciliation;
			void reconciliation.finally(() => {
				if (reconciliationInFlight === reconciliation)
					reconciliationInFlight = null;
				scheduleReconciliation();
			});
		}, 1_000);
	};
	scheduleReconciliation();
	return {
		async stop() {
			stopped = true;
			if (timer !== null) dependencies.host.clock.clearTimeout(timer);
			await reconciliationInFlight;
			stopMissionPilotRuntimeEventListeners();
			clearMissionPilotRuntimeHost();
		},
	};
}
