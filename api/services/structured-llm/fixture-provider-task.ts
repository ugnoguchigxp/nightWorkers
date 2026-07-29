import { clearFixtureProviderTextOutputs } from "./fixture-text-provider";
import { clearFixtureProviderToolTurns } from "./fixture-tool-provider";

export function clearFixtureProviderTask(taskId: string) {
	clearFixtureProviderToolTurns(taskId);
	clearFixtureProviderTextOutputs(taskId);
}
