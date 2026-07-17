import type { TraceProvenance } from "../../../../shared/schemas/trace-provenance.schema";

export type RunOrchestrationRef = NonNullable<
	TraceProvenance["orchestrationRef"]
>;
export type RunOrchestrationRefResolver = (
	runId: string,
) => Promise<RunOrchestrationRef | null>;

let resolver: RunOrchestrationRefResolver | null = null;

export function registerRunOrchestrationRefResolver(
	nextResolver: RunOrchestrationRefResolver,
) {
	resolver = nextResolver;
	return () => {
		if (resolver === nextResolver) resolver = null;
	};
}

export async function resolveRunOrchestrationRef(runId: string) {
	return resolver?.(runId) ?? null;
}
