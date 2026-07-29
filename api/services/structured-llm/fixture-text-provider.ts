const outputsByTaskId = new Map<string, string[]>();

export function registerFixtureProviderTextOutputs(
	taskId: string,
	outputs: string[],
) {
	assertIsolatedFixtureAccess();
	outputsByTaskId.set(taskId, structuredClone(outputs));
}

export function hasFixtureProviderTextOutputs(taskId: string) {
	return (
		process.env.NODE_ENV !== "production" &&
		process.env.NIGHTWORKERS_E2E_ISOLATED === "1" &&
		outputsByTaskId.has(taskId)
	);
}

export function takeFixtureProviderTextOutput(taskId: string) {
	assertIsolatedFixtureAccess();
	const outputs = outputsByTaskId.get(taskId);
	if (!outputs) {
		throw new Error(
			`No structured fixture output is registered for Task ${taskId}.`,
		);
	}
	const output = outputs.shift();
	if (output === undefined) {
		throw new Error(
			`Structured fixture output queue is exhausted for Task ${taskId}.`,
		);
	}
	return output;
}

export function clearFixtureProviderTextOutputs(taskId: string) {
	outputsByTaskId.delete(taskId);
}

function assertIsolatedFixtureAccess() {
	if (
		process.env.NODE_ENV === "production" ||
		process.env.NIGHTWORKERS_E2E_ISOLATED !== "1"
	) {
		throw new Error("Fixture text outputs are available only in isolated E2E.");
	}
}
