import fs from "node:fs";
import path from "node:path";
import {
	missionPilotArtifactProviderExecutionPolicy,
	missionPilotToolTurnProviderExecutionPolicy,
} from "@nightworkers/mission-pilot/testing";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRUCTURED_PROVIDER_EXECUTION_POLICY } from "../../api/modules/agentsShare/contracts/provider-execution";
import { codingAgentProviderExecutionPolicy } from "../../api/modules/codingAgent/adapters/coding-agent-provider.adapter";
import { buildCodexStructuredExecutionMode } from "../../api/services/structured-llm/codex-provider";
import { createSystemContextBindingSnapshot } from "../../api/systemContexts/catalog";

describe("structured provider execution policy", () => {
	it("keeps structured artifact context isolated by default", () => {
		expect(DEFAULT_STRUCTURED_PROVIDER_EXECUTION_POLICY).toMatchObject({
			isolatedHome: true,
			enableMcp: false,
			enableMemory: false,
			allowProviderTools: false,
		});
		const bound =
			DEFAULT_STRUCTURED_PROVIDER_EXECUTION_POLICY.bindDeveloperInstructions?.(
				createSystemContextBindingSnapshot({
					version: 1,
					instructionLocale: "ja-JP",
					fallbackLocales: [],
				}),
			);
		expect(bound?.text).toContain(
			"SystemContext、User Prompt、JSON schemaだけ",
		);
		expect(bound?.systemContextAudit[0]).toMatchObject({
			promptPart: "developer",
			manifest: {
				key: "providerExecution.artifact-lane",
				requestedLocale: "ja-JP",
				resolvedLocale: "ja-JP",
			},
		});
	});

	it("keeps Mission Pilot provider capabilities explicit and role-neutral", () => {
		expect(missionPilotToolTurnProviderExecutionPolicy).toMatchObject({
			isolatedHome: true,
			enableMcp: false,
			enableMemory: false,
			allowProviderTools: true,
			authorizeProviderCall: expect.any(Function),
		});
		expect(missionPilotArtifactProviderExecutionPolicy).toMatchObject({
			isolatedHome: true,
			enableMcp: false,
			enableMemory: false,
			allowProviderTools: false,
			authorizeProviderCall: expect.any(Function),
		});
		expect(codingAgentProviderExecutionPolicy).toMatchObject({
			isolatedHome: false,
			enableMcp: true,
			enableMemory: true,
			allowProviderTools: false,
		});
		expect(
			buildCodexStructuredExecutionMode({
				policy: missionPilotToolTurnProviderExecutionPolicy,
				model: "model",
				schemaName: "schema",
			}),
		).not.toBe(
			buildCodexStructuredExecutionMode({
				policy: codingAgentProviderExecutionPolicy,
				model: "model",
				schemaName: "schema",
			}),
		);
	});

	it("does not classify provider behavior by role string", () => {
		const providerSource = fs.readFileSync(
			path.join(process.cwd(), "api/services/structured-llm/codex-provider.ts"),
			"utf8",
		);
		expect(providerSource).not.toMatch(/role\s*===\s*["']mission_pilot["']/);
		expect(providerSource).not.toContain("MISSION_PILOT_");
		expect(providerSource).toContain("executionPolicy");
		const codingAgentAdapterSource = fs.readFileSync(
			path.join(
				process.cwd(),
				"api/modules/codingAgent/runtime/native-api-runner/native-api-request-adapter.ts",
			),
			"utf8",
		);
		expect(codingAgentAdapterSource).toContain(
			"executionPolicy: codingAgentProviderExecutionPolicy",
		);
	});
});
