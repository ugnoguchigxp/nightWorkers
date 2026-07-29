import { describe, expect, it, vi } from "vitest";
import { shouldAutoDrainImplementationQueue } from "../api/modules/nightworkers/run-orchestration/queues";
import { readTaskExecutorMode } from "../api/services/execution/executor-mode";
import { dispatchStructuredLlmProvider } from "../api/services/structured-llm/provider-dispatch";
import {
	asArtifactRecord,
	resolveArtifactWorkspaceInitialTab,
} from "../src/modules/nightworkers/components/ArtifactPane.controller";
import { findExternalPathPermissionRequest } from "../src/modules/nightworkers/components/ThreadTimelinePermission.controller";

describe("P2 boundary contracts", () => {
	it("keeps artifact route compatibility in the extracted selector", () => {
		expect(resolveArtifactWorkspaceInitialTab("design-doc")).toBe(
			"feature-plan",
		);
		expect(resolveArtifactWorkspaceInitialTab(["db", "design"].join("-"))).toBe(
			"data-model",
		);
		expect(resolveArtifactWorkspaceInitialTab("unknown")).toBeUndefined();
		expect(asArtifactRecord(null)).toEqual({});
	});

	it("extracts external path permission state without rendering concerns", () => {
		expect(
			findExternalPathPermissionRequest([
				{
					payloadJson: {
						agentEventType: "run.needs_human",
						payload: {
							reason: "path_access_denied",
							arguments: { sourcePath: "/outside/repository" },
						},
					},
				} as never,
			]),
		).toBe("/outside/repository");
	});

	it("dispatches provider adapters without embedding workflow decisions", async () => {
		const openai = vi.fn(() => Promise.resolve("ok"));
		await expect(
			dispatchStructuredLlmProvider({
				provider: "openai",
				adapters: { openai },
				onUnsupported: (provider) => Promise.reject(new Error(provider)),
			}),
		).resolves.toBe("ok");
		expect(openai).toHaveBeenCalledOnce();
	});

	it("uses process isolation by default and limits in-process execution", () => {
		expect(readTaskExecutorMode({ NODE_ENV: "production" })).toBe("in_process");
		expect(readTaskExecutorMode({ NODE_ENV: "test" })).toBe("in_process");
		expect(
			readTaskExecutorMode({
				NODE_ENV: "production",
				NIGHTWORKERS_EXECUTION_ROLE: "worker",
			}),
		).toBe("in_process");
	});

	it("lets the queue worker own sequential draining", () => {
		expect(shouldAutoDrainImplementationQueue({})).toBe(true);
		expect(
			shouldAutoDrainImplementationQueue({ NIGHTWORKERS_QUEUE_WORKER: "1" }),
		).toBe(false);
	});
});
