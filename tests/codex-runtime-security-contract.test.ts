import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexAgentRuntime } from "../api/modules/codingAgent/runtime/CodexAgentRuntime";
import {
	preflightCodexRuntimeSecurityContract,
	type RuntimeSecurityPreflight,
	resolveCodexRuntimeSecurityCapability,
} from "../api/modules/codingAgent/runtime/runtime-security-contract";
import type { AgentRunContext } from "../api/modules/codingAgent/runtime/types";

const fixtureRoot = path.join(
	process.cwd(),
	"tests/fixtures/codex-runtime-security-capabilities/workspace",
);

function context(): AgentRunContext {
	return {
		runId: "run-security",
		taskId: "task-security",
		repositoryId: "repository-security",
		repoRoot: fixtureRoot,
		compiledPrompt: "security",
		latestUserMessage: "security",
		timeoutSeconds: 30,
		contextSnapshot: { compiledPrompt: "security", source: "task_prompt" },
	};
}

describe("Codex runtime security contract", () => {
	it("records the measured workspace-write capability without marking it equivalent", async () => {
		const snapshotPath = path.join(
			fixtureRoot,
			"../codex-cli-0.144.4-darwin-arm64-workspace-write.json",
		);
		const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
		expect(snapshot).toMatchObject({
			matrix: {
				sdkVersion: "0.144.4",
				cliVersion: "0.144.4",
				platform: "darwin",
				arch: "arm64",
				sandboxMode: "workspace-write",
				approvalPolicy: "never",
			},
			results: {
				projectEnvRead: true,
				projectEnvLocalRead: true,
				projectPemRead: true,
				registryCredentialRead: true,
				outsideFileRead: true,
				outsideFileWrite: true,
				networkAccess: false,
			},
			assessment: { securityEquivalentToNativeWorkerTools: false },
		});
	});

	it("fails closed when the measured sandbox cannot protect secrets and workspace bounds", async () => {
		const capability = resolveCodexRuntimeSecurityCapability("darwin", "arm64");
		expect(capability).toMatchObject({
			results: {
				projectEnvRead: true,
				projectEnvLocalRead: true,
				registryCredentialRead: true,
				outsideFileWrite: true,
			},
		});
		const preflight = await preflightCodexRuntimeSecurityContract(context());
		expect(preflight).toMatchObject({
			ok: false,
			code: "CODEX_RUNTIME_SECURITY_CONTRACT_UNSATISFIED",
			contract: {
				workspaceRoot: fixtureRoot,
				secretPathDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			},
		});
	});

	it("blocks the Codex runtime before a provider thread is created", async () => {
		const threadFactory = vi.fn(() => {
			throw new Error("provider thread must not be created");
		});
		const blocked: RuntimeSecurityPreflight = {
			ok: false,
			code: "CODEX_RUNTIME_SECURITY_CONTRACT_UNSATISFIED",
			message: "measured fixture is unsafe",
			contract: {
				version: 1,
				workspaceRoot: fixtureRoot,
				secretPathCount: 0,
				secretPathDigest: "sha256:test",
				capability: null,
			},
		};
		const sink = { emit: vi.fn(async () => undefined) };
		const result = await new CodexAgentRuntime({
			threadFactory,
			securityPreflight: async () => blocked,
		}).start(context(), sink);
		expect(result).toMatchObject({
			terminalState: "blocked",
			stoppedBy: "policy",
			humanActionRequired: true,
		});
		expect(threadFactory).not.toHaveBeenCalled();
		expect(sink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_error",
				payload: expect.objectContaining({
					code: "CODEX_RUNTIME_SECURITY_CONTRACT_UNSATISFIED",
				}),
			}),
		);
	});
});
