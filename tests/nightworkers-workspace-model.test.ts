import { describe, expect, it } from "vitest";
import {
	isActiveRunStatus,
	isActiveTaskStatus,
} from "../src/modules/nightworkers/hooks/useNightWorkersWorkspaceModel";

describe("NightWorkers workspace active status", () => {
	it.each([
		"queued",
		"running",
		"context_compiling",
		"finalizing",
		"verifying",
	])("keeps %s Runs and Tasks in the active presentation state", (status) => {
		expect(isActiveRunStatus(status)).toBe(true);
		expect(isActiveTaskStatus(status)).toBe(true);
	});

	it.each([
		"draft",
		"ready",
		"needs_review",
		"completed",
		"failed",
	])("does not present %s as active work", (status) => {
		expect(isActiveRunStatus(status)).toBe(false);
		expect(isActiveTaskStatus(status)).toBe(false);
	});
});
