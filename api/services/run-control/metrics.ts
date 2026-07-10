import { RunControlRepository } from "./run-control-repository";

export async function getRunControlMetrics(
	runId: string,
	repository = new RunControlRepository(),
) {
	try {
		return await repository.readMetrics(runId);
	} catch {
		return null;
	}
}
