import path from "node:path";
import { hasFixtureProviderToolTurns } from "../../../../services/structured-llm/fixture-tool-provider";
import type { AgentRunContext } from "../types";

/**
 * The direct-provider fixture is a capability of the isolated Playwright
 * runtime, not a fallback route available to ordinary Coding Agent runs.
 */
export function hasRegisteredIsolatedNativeApiFixture(
	context: AgentRunContext,
) {
	const workspaceRoot = process.env.NIGHTWORKERS_E2E_WORKSPACE_ROOT?.trim();
	if (
		process.env.NODE_ENV === "production" ||
		process.env.NIGHTWORKERS_E2E !== "1" ||
		process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
		process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE !== "1" ||
		!workspaceRoot ||
		!isPathInside(workspaceRoot, context.repoRoot)
	) {
		return false;
	}
	return hasFixtureProviderToolTurns(
		context.taskId,
		fixtureScopeForContext(context),
	);
}

export function fixtureScopeForContext(context: AgentRunContext) {
	const activeRole = readActiveRole(context);
	return activeRole === "implementation" ? "implementation" : "default";
}

function readActiveRole(context: AgentRunContext) {
	const snapshot = context.contextSnapshot.effectiveLlmRouting;
	if (isRecord(snapshot) && typeof snapshot.activeRole === "string") {
		return snapshot.activeRole;
	}
	const routing = context.runtimeOptions?.llmRouting;
	if (isRecord(routing) && typeof routing.activeRole === "string") {
		return routing.activeRole;
	}
	return "implementation";
}

function isPathInside(root: string, candidate: string) {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
