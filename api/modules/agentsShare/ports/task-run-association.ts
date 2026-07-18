export type TaskRunAssociationRequest = {
	kind: string;
	payload: unknown;
};

export type TaskRunAssociationHandler = (input: {
	taskId: string;
	runId: string;
	payload: unknown;
}) => Promise<void> | void;

const handlers = new Map<string, TaskRunAssociationHandler>();

export function registerTaskRunAssociationHandler(
	kind: string,
	handler: TaskRunAssociationHandler,
) {
	handlers.set(kind, handler);
	return () => {
		if (handlers.get(kind) === handler) handlers.delete(kind);
	};
}

export async function associatePreparedTaskRun(input: {
	taskId: string;
	runId: string;
	request?: TaskRunAssociationRequest;
}) {
	if (!input.request) return;
	const handler = handlers.get(input.request.kind);
	if (!handler) {
		throw new Error(
			`Task run association handler is not registered: ${input.request.kind}`,
		);
	}
	await handler({
		taskId: input.taskId,
		runId: input.runId,
		payload: input.request.payload,
	});
}
