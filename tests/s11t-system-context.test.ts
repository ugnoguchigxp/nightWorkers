import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyRenderedHash } from "@s11t/runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = vi.hoisted(() => ({
	language: "ja" as "ja" | "en",
	readCount: 0,
}));

vi.mock("../api/services/settings/general-settings", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../api/services/settings/general-settings")
		>();
	return {
		...actual,
		readGeneralSettings: () => {
			settingsMock.readCount += 1;
			return {
				...actual.DEFAULT_GENERAL_SETTINGS,
				language: settingsMock.language,
			};
		},
	};
});

import { buildCodingAgentSystemContext } from "../api/modules/codingAgent/context/system-context";
import { renderCodingAgentRuntimeSystemContext } from "../api/modules/codingAgent/context/todo-prompt-context";
import { buildCodexRuntimePromptParts } from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt";
import {
	buildInitialNativeApiHistory,
	extractNativeApiSystemContextAudit,
} from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-history";
import { buildMissionPilotSystemContext } from "../api/modules/missionPilot/prompts/mission-pilot-system-context";
import {
	bindSystemContextCatalog,
	bindSystemContextCatalogSnapshot,
	bindSystemContextTextCatalog,
	createSystemContextBindingSnapshot,
	describeSystemContext,
	p,
	readSystemContextBindingSnapshot,
} from "../api/systemContexts/catalog";
import { createAppCatalog } from "../api/systemContexts/generated/catalog.generated";
import catalogArtifact from "../api/systemContexts/generated/catalog.json" with {
	type: "json",
};

describe("S11t SystemContext catalog", () => {
	beforeEach(() => {
		settingsMock.language = "ja";
		settingsMock.readCount = 0;
	});

	it("keeps every role in one generated catalog", () => {
		expect(
			describeSystemContext("codingAgent.role-instructions"),
		).toMatchObject({
			key: "codingAgent.role-instructions",
			owner: "coding-agent",
			variableNames: [],
		});
		expect(describeSystemContext("missionPilot.plan-system")).toMatchObject({
			key: "missionPilot.plan-system",
			owner: "mission-pilot",
			variableNames: [],
		});
		expect(
			describeSystemContext("questionnaire.starter-tech-stack-question"),
		).toMatchObject({
			key: "questionnaire.starter-tech-stack-question",
			owner: "questionnaire",
			variableNames: [],
		});
		expect(Object.keys(catalogArtifact.contexts)).toEqual(
			expect.arrayContaining([
				"codingAgent.role-instructions",
				"codingAgent.runtime-system",
				"codingAgent.initial-preparation-todo",
				"codingAgent.completion-report-format",
				"codingAgent.completion-report-todo",
				"missionPilot.plan-system",
				"missionPilot.compaction",
				"supervisor.round1",
				"specification.repository-materialization-required",
				"structuredGeneration.output-requirements",
				"questionnaire.starter-selection-applicability",
				"questionnaire.starter-tech-stack-question",
				"questionnaire.starter-database-question",
				"questionnaire.completion-verification-guidance",
			]),
		);
		expect(Object.keys(catalogArtifact.contexts)).toHaveLength(82);
		expect(catalogArtifact.aliases).toEqual({});
		expect(
			catalogArtifact.contexts["codingAgent.runtime-system"].variables,
		).toMatchObject({
			taskGoal: { trust: "untrusted", encoding: "json-string" },
			projectRules: { trust: "untrusted", encoding: "json-value" },
		});
	});

	it("renders Japanese and uses the explicit Japanese fallback", () => {
		settingsMock.language = "en";
		const invoke = bindSystemContextCatalog();
		const coding = invoke("codingAgent.role-instructions", {});
		const mission = invoke("missionPilot.plan-system", {});
		const reviewer = invoke("review.llm-reviewer", {});

		expect(coding.content.text).toContain("Coding Agentです");
		expect(mission.content.text).toContain("Mission Pilot SystemContext");
		expect(coding.manifest).toMatchObject({
			requestedLocale: "en-US",
			fallbackLocales: ["ja-JP"],
			resolvedLocale: "ja-JP",
			fallbackUsed: true,
		});
		expect(reviewer.content.text).toContain("Review the code");
		expect(reviewer.manifest).toMatchObject({
			requestedLocale: "en-US",
			resolvedLocale: "en-US",
			fallbackUsed: false,
		});
	});

	it("keeps implementation preparation and completion reporting in Todo-owned SystemContext", () => {
		const context = buildCodingAgentSystemContext({
			taskGoal: "Todo CRUDを実装する",
			registeredRepositoryRoot: "/repo",
		});
		const rendered = renderCodingAgentRuntimeSystemContext(context);

		expect(rendered).toContain("planの先頭に「実装準備」Todo");
		expect(rendered).toContain("workspace変更前のcontext_compile");
		expect(rendered).toContain("検証scopeはQuestionnaireと採用済みPlanを正本");
		expect(rendered).toContain("理由に拡張しないでください");
		expect(rendered).toContain("planの末尾に「完了報告準備」Todo");
		expect(rendered).toContain("commit・merge状態");
		expect(rendered).toContain("Todo・verification・Run・commitの各証跡");
		expect(rendered).toContain("未commit・未mergeを含む実際の状態");
		expect(rendered).toContain("品質ゲートがPassした証跡を持つ");
		expect(rendered).toContain("## 実装結果");
		expect(rendered).toContain("## 主な変更");
		expect(rendered).toContain("## 検証結果");
		expect(rendered).toContain("## 状態");
		expect(rendered).toContain("[Todo API](api/modules/todos/routing.ts)");
		expect(rendered).toContain("変更説明をリンクだけで代替しない");
	});

	it("renders task-generation implementation context without embedding the full output schema", () => {
		const rendered = p("taskGeneration.mission-tasks", {
			maxCount: 5,
			generationContext: {
				schemaVersion: "nightworkers.task-generation-system-context/v1",
				implementation: {
					source: "detected_stack",
					stackProfile: {
						summary: "TypeScript + Hono",
					},
				},
				moduleOntology: null,
				canonicalSignalDigest: `sha256:${"0".repeat(64)}`,
			},
		});

		expect(rendered).toContain("TypeScript + Hono");
		expect(rendered).toContain("原則1-3件、最大 5 件");
		expect(rendered).not.toContain("次の JSON Schema");
		expect(rendered).not.toContain('"properties"');
		expect(
			catalogArtifact.contexts["taskGeneration.mission-tasks"].variables,
		).toMatchObject({
			generationContext: { trust: "untrusted", encoding: "json-value" },
		});
	});

	it("rebinds p() and the catalog from the single top-level language variable", () => {
		const jaBinding = bindSystemContextCatalog();
		const ja = jaBinding("codingAgent.role-instructions", {});

		settingsMock.language = "en";
		const enBinding = bindSystemContextCatalog();
		const en = enBinding("codingAgent.role-instructions", {});
		const jaSnapshotAfterSwitch = jaBinding(
			"codingAgent.role-instructions",
			{},
		);

		expect(ja.manifest).toMatchObject({
			requestedLocale: "ja-JP",
			fallbackLocales: [],
			resolvedLocale: "ja-JP",
		});
		expect(en.manifest).toMatchObject({
			requestedLocale: "en-US",
			fallbackLocales: ["ja-JP"],
			resolvedLocale: "ja-JP",
		});
		expect(jaSnapshotAfterSwitch.manifest).toMatchObject({
			requestedLocale: "ja-JP",
			fallbackLocales: [],
			resolvedLocale: "ja-JP",
		});
		expect(settingsMock.readCount).toBe(2);

		p("codingAgent.role-instructions", {});
		expect(settingsMock.readCount).toBe(3);
	});

	it("uses the S11t text object's p() as an immutable snapshot", () => {
		const bound = bindSystemContextTextCatalog();
		expect(settingsMock.readCount).toBe(1);
		expect(bound.byKey["codingAgent.role-instructions"]({})).toBe(
			bound.p("codingAgent.role-instructions", {}),
		);
		expect(Object.isFrozen(bound)).toBe(true);
		expect(Object.isFrozen(bound.byKey)).toBe(true);

		settingsMock.language = "en";
		bound.p("missionPilot.plan-system", {});
		expect(settingsMock.readCount).toBe(1);

		const { p: snapshotP } = bindSystemContextTextCatalog();
		snapshotP("codingAgent.role-instructions", {});
		expect(settingsMock.readCount).toBe(2);
	});

	it("persists one locale binding snapshot across a run", () => {
		const runBinding = createSystemContextBindingSnapshot();
		const runSystemContexts = bindSystemContextCatalogSnapshot(runBinding);
		const codingAgentSystemContext = buildCodingAgentSystemContext(
			{
				taskGoal: "run snapshotを検証する",
				registeredRepositoryRoot: "/repo",
			},
			runSystemContexts.p,
		);
		expect(settingsMock.readCount).toBe(1);
		expect(runBinding).toEqual({
			version: 1,
			instructionLocale: "ja-JP",
			fallbackLocales: [],
		});

		settingsMock.language = "en";
		const rebound = bindSystemContextCatalogSnapshot(runBinding);
		const reviewer = rebound.invoke("review.llm-reviewer", {});
		expect(settingsMock.readCount).toBe(1);
		expect(reviewer.content.text).toContain("コードレビュー");
		expect(reviewer.manifest.requestedLocale).toBe("ja-JP");
		const runContext = {
			runId: "run-s11t-snapshot",
			taskId: "task-s11t-snapshot",
			repositoryId: "repository-s11t-snapshot",
			repoRoot: "/repo",
			compiledPrompt: "run snapshotを検証する",
			latestUserMessage: "run snapshotを検証する",
			timeoutSeconds: 30,
			contextSnapshot: {
				compiledPrompt: "run snapshotを検証する",
				source: "task_prompt" as const,
				systemContextBinding: runBinding,
			},
			codingAgentSystemContext,
			currentTodo: {
				id: "todo-s11t-snapshot",
				seq: 1,
				title: "監査境界を検証する",
				taskType: "code_change",
				status: "running",
			},
		};
		const codex = buildCodexRuntimePromptParts(runContext);
		const nativeHistory = buildInitialNativeApiHistory(runContext);
		const nativeSystem = nativeHistory.find((item) => item.type === "system");
		const nativeTodo = nativeHistory.find(
			(item) => item.type === "user" && item.source === "todo",
		);
		expect(codex.systemContextAudit[0]?.manifest.requestedLocale).toBe("ja-JP");
		expect(codex.systemContextAudit[0]?.requestAudit).toMatchObject({
			binding: {
				instructionLocale: "ja-JP",
				fallbackLocales: [],
			},
			finalManifest: codex.systemContextAudit[0]?.manifest,
		});
		expect(
			codex.systemContextAudit[0]?.requestAudit.renderTrace.at(-1)?.via,
		).toBe("invoke");
		expect(
			codex.systemContextAudit[0]?.requestAudit.renderTrace.length,
		).toBeGreaterThan(1);
		expect(
			codex.systemContextAudit[0]?.requestAudit.renderTrace.map(
				(entry) => entry.manifest.requestedKey,
			),
		).toEqual(
			expect.arrayContaining([
				"codingAgent.role-instructions",
				"codingAgent.todo-policy",
				"codingAgent.runtime-system-without-task-goal",
				"codingAgent.codex-developer-instructions",
			]),
		);
		expect(
			nativeSystem?.systemContextAudit?.[0]?.manifest.requestedLocale,
		).toBe("ja-JP");
		expect(
			verifyRenderedHash(
				nativeSystem?.content ?? "",
				nativeSystem?.systemContextAudit?.[0]?.manifest.renderedHash ?? "",
			),
		).toBe(true);
		expect(
			nativeSystem?.systemContextAudit?.[0]?.requestAudit.renderTrace.length,
		).toBeGreaterThan(1);
		expect(
			nativeSystem?.systemContextAudit?.[0]?.requestAudit.renderTrace.map(
				(entry) => entry.manifest.requestedKey,
			),
		).toEqual(
			expect.arrayContaining([
				"codingAgent.role-instructions",
				"codingAgent.todo-policy",
				"codingAgent.runtime-system",
				"codingAgent.native-runtime",
			]),
		);
		expect(nativeTodo?.systemContextAudit?.[0]).toMatchObject({
			promptPart: "user",
			manifest: {
				requestedKey: "codingAgent.current-todo",
			},
		});
		expect(
			verifyRenderedHash(
				nativeTodo?.content ?? "",
				nativeTodo?.systemContextAudit?.[0]?.manifest.renderedHash ?? "",
			),
		).toBe(true);
		expect(
			extractNativeApiSystemContextAudit(nativeHistory).map(
				(audit) => audit.promptPart,
			),
		).toEqual(["system", "user"]);
		expect(settingsMock.readCount).toBe(1);
		expect(
			readSystemContextBindingSnapshot({
				systemContextBinding: runBinding,
			}),
		).toEqual(runBinding);
		expect(() => createSystemContextBindingSnapshot(null)).toThrow(
			"Invalid persisted SystemContext binding snapshot.",
		);
	});

	it("fails closed for invalid artifacts, digest mismatches, and extra values", () => {
		expect(() => createAppCatalog({})).toThrowError(
			expect.objectContaining({ code: "S11T_ARTIFACT_INVALID" }),
		);
		const mismatchedArtifact = structuredClone(catalogArtifact);
		mismatchedArtifact.catalogDigest = `sha256:${"0".repeat(64)}`;
		expect(() => createAppCatalog(mismatchedArtifact)).toThrowError(
			expect.objectContaining({ code: "S11T_ARTIFACT_DIGEST_MISMATCH" }),
		);

		const invoke = bindSystemContextCatalog();
		expect(() =>
			(invoke as (key: string, values: Record<string, unknown>) => unknown)(
				"codingAgent.role-instructions",
				{ undeclared: true },
			),
		).toThrowError(expect.objectContaining({ code: "S11T_VALUE_EXTRA" }));
	});

	it("uses the vendored runtime compiler version and preserves public text shape", () => {
		const manifest = JSON.parse(
			readFileSync(
				new URL("../vendor/s11t/manifest.json", import.meta.url),
				"utf8",
			),
		) as { packages: Array<{ name: string; version: string }> };
		const runtimeVersion = manifest.packages.find(
			(item) => item.name === "@s11t/runtime",
		)?.version;
		const invocation = bindSystemContextCatalog()(
			"codingAgent.role-instructions",
			{},
		);

		expect(invocation.manifest.compilerVersion).toBe(runtimeVersion);
		expect(invocation.manifest).toMatchObject({
			artifactSchemaVersion: 3,
			renderingContract: "delimited-context-v1",
		});
		expect(p("codingAgent.role-instructions", {})).toMatch(/\n$/);
		expect(p("missionPilot.compaction", {})).toMatch(/\n$/);
	});

	it("keeps deterministic baselines after moving final rendering into S11t", () => {
		const codingAgent = buildCodingAgentSystemContext({
			taskGoal: "認証を実装",
			projectRulesJa: ["規約A", "規約B"],
			registeredRepositoryRoot: "/repo",
			planModeRequested: true,
		});
		const outputHashes = {
			codingAgent: sha256(renderCodingAgentRuntimeSystemContext(codingAgent)),
			missionPilotPushAllowed: sha256(
				buildMissionPilotSystemContext({ pushPolicy: "allowed" }),
			),
			missionPilotPushDenied: sha256(buildMissionPilotSystemContext()),
		};
		expect(renderCodingAgentRuntimeSystemContext(codingAgent)).toContain(
			'<S11T_DELIMITED_CONTEXT variable="taskGoal">',
		);

		expect(outputHashes).toEqual({
			codingAgent:
				"797196e658bcf86e681edd9be852e2ccae05916d519ac55b5750168526c341b3",
			missionPilotPushAllowed:
				"a46747840adc5b71e34029f82414f7430468b6989be46fbfc54757d5b61bb189",
			missionPilotPushDenied:
				"13917a6f3be36bf87e3d1221f008badbcac5c57232573b75da4842989876295c",
		});
	});

	it("leaves TypeScript with central catalog rendering instead of final prompt assembly", () => {
		for (const [relativePath, removedLiteral] of [
			[
				"../api/modules/codingAgent/context/todo-prompt-context.ts",
				"<CODING_AGENT_SYSTEM_CONTEXT",
			],
			[
				"../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-history.ts",
				"[NightWorkers Coding Agent Runtime]",
			],
			[
				"../api/modules/codingAgent/intake/plan-mode-gate.ts",
				"ユーザー直結のCoding Agentを開始する前に",
			],
			[
				"../api/modules/missionPilot/prompts/mission-pilot-system-context.ts",
				"Playでpush",
			],
			[
				"../api/modules/missionPilot/prompts/mission-pilot-plan-review.ts",
				"Queue投入前",
			],
			[
				"../api/modules/missionPilot/agent/mission-pilot-agent-runtime.ts",
				"[Mission Pilot 現在のStep文脈]",
			],
			[
				"../api/modules/missionPilot/adapters/mission-pilot-provider.adapter.ts",
				"Mission Pilotのtool判断専用レーンです。",
			],
			[
				"../api/modules/specification/specification-generation.service.ts",
				"Target ProjectにはGit HEADがありません。",
			],
			[
				"../api/modules/ontology/exploration/project-exploration-agent-workflow.ts",
				"広いlist_dirやsearch_filesより先に",
			],
			[
				"../api/modules/codingAgent/runtime/runtime-workspace-context.ts",
				"登録元で実装・検証しない。",
			],
			[
				"../api/services/supervisor/prompt.ts",
				"jobType と goal を1つずつ選んでください。",
			],
			[
				"../api/services/codex-global-config/agents-guidance.ts",
				"AGENTS.md の raw 本文は provider prompt に渡さず",
			],
			[
				"../api/services/structured-llm/contract.ts",
				"JSON object だけを返してください。",
			],
		]) {
			const source = readFileSync(
				new URL(relativePath, import.meta.url),
				"utf8",
			);
			expect(source).toMatch(/\b(?:p|invoke)\(/);
			expect(source).not.toContain(removedLiteral);
		}
	});
});

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
