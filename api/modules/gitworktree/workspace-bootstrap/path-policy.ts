import { WorkspaceBootstrapError } from "./types";

export function assertWorkspaceBootstrapId(value: string) {
	if (/^[A-Za-z0-9_-]{1,128}$/.test(value)) return;
	throw new WorkspaceBootstrapError(
		"DEPENDENCY_STATE_INVALID",
		"Workspace bootstrap identifier is invalid.",
		{ stage: "validation", retryable: false },
	);
}
