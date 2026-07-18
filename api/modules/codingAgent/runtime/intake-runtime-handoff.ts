import { resolveCodexAuthScopeFingerprint } from "../../../services/structured-llm/codex-auth-scope";
import type { ResolvedStructuredLlmRoute } from "../../../services/structured-llm/role-routing";
import type { CodingAgentPlanModeRuntimeThreadHandoff } from "../intake";
import type { NativeApiExecutionMode } from "./native-api-runner/native-api-mode";

export function resolveCodingAgentRuntimeRole(planModeRequested: boolean) {
	return planModeRequested ? ("plan" as const) : ("implementation" as const);
}

export function resolveCodexIntakeRuntimeHandoff(input: {
	handoff?: CodingAgentPlanModeRuntimeThreadHandoff;
	executionMode: NativeApiExecutionMode;
	runtimeRoute: ResolvedStructuredLlmRoute | null;
	resolveAuthScopeFingerprint?: (providerEndpointId: string | null) => string;
}) {
	const { handoff, runtimeRoute } = input;
	if (!handoff) return null;
	if (runtimeRoute?.providerId !== "codex") return null;
	const targetAuthScopeFingerprint = (
		input.resolveAuthScopeFingerprint ?? resolveCodexAuthScopeFingerprint
	)(runtimeRoute.providerEndpointId);
	if (targetAuthScopeFingerprint !== handoff.authScopeFingerprint) return null;
	return {
		kind: "codex_thread" as const,
		status: "available" as const,
		stateId: handoff.stateId ?? null,
		providerThreadId: handoff.providerThreadId,
		executionMode: input.executionMode,
		model: runtimeRoute.model,
		source: "intake_gate_handoff" as const,
	};
}
