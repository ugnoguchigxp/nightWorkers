export type ImplementationQueueHandoff =
	| {
			kind: "blocked";
			code: string;
			message: string;
			hold: () => Promise<void>;
	  }
	| {
			kind: "ready";
			codingAgentInvocationSource: "user" | "mission_pilot";
			implementationPlanConstraint?: {
				sourceMessageId: string;
				digest: string;
			};
			runtimeOptionsPatch?: Record<string, unknown>;
			associate: (input: { taskId: string; runId: string }) => Promise<void>;
	  };

export type ImplementationQueueHandoffResolver = (
	entry: unknown,
) => Promise<ImplementationQueueHandoff | null>;

let resolver: ImplementationQueueHandoffResolver | null = null;

export function registerImplementationQueueHandoffResolver(
	nextResolver: ImplementationQueueHandoffResolver,
) {
	resolver = nextResolver;
	return () => {
		if (resolver === nextResolver) resolver = null;
	};
}

export async function resolveImplementationQueueHandoff(entry: unknown) {
	return resolver?.(entry) ?? null;
}
