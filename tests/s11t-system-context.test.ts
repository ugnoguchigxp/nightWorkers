import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyPromptMessageHash, verifyRenderedHash } from "s11tnext";
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
	runWithSystemContextBinding,
	systemContextPromptAudit,
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
		expect(catalogArtifact.artifactVersion).toBe(2);
		expect(
			describeSystemContext("codingAgent.role-instructions"),
		).toMatchObject({
			key: "codingAgent.role-instructions",
			owner: "coding-agent",
			messageRole: "system",
			variableNames: [],
		});
		expect(describeSystemContext("codingAgent.current-todo")).toMatchObject({
			key: "codingAgent.current-todo",
			owner: "coding-agent",
			messageRole: "user",
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
		expect(Object.keys(catalogArtifact.contexts)).toHaveLength(83);
		expect("aliases" in catalogArtifact).toBe(false);
		expect(
			catalogArtifact.contexts["codingAgent.runtime-system"].variables,
		).toMatchObject({
			taskGoal: { trust: "untrusted", encoding: "json-string" },
			projectRules: { trust: "untrusted", encoding: "json-value" },
			registeredRepositoryRoot: {
				trust: "untrusted",
				encoding: "json-string",
			},
		});
		expect(
			catalogArtifact.contexts["codingAgent.workspace-context"].variables,
		).toMatchObject({
			executionRoot: { trust: "untrusted", encoding: "json-string" },
			registeredRepoRoot: { trust: "untrusted", encoding: "json-string" },
			workspaceSource: { trust: "untrusted", encoding: "json-string" },
		});
		expect(
			catalogArtifact.contexts["supervisor.codex-guidance"].variables,
		).toMatchObject({
			lifecycleSummaries: { trust: "untrusted", encoding: "json-string" },
			safeGuidance: { trust: "untrusted", encoding: "json-string" },
		});
	});

	it("renders a real English translation and fails closed when it is missing", () => {
		settingsMock.language = "en";
		const invoke = bindSystemContextCatalog();
		const reviewer = invoke("review.llm-reviewer", {});
		const supervisor = invoke("supervisor.codex-guidance", {
			safeGuidance: "none",
			lifecycleSummaries: "none",
		});

		expect(reviewer.content.text).toContain("Review the code");
		expect(reviewer.manifest).toMatchObject({
			requestedLocale: "en-US",
			fallbackLocales: [],
			resolvedLocale: "en-US",
			fallbackUsed: false,
		});
		expect(supervisor.content.text).toContain(
			"The following Codex guidance was read",
		);
		expect(supervisor.manifest).toMatchObject({
			requestedLocale: "en-US",
			fallbackLocales: [],
			resolvedLocale: "en-US",
			fallbackUsed: false,
		});
		expect(() => invoke("codingAgent.role-instructions", {})).toThrow(
			/locale|en-US/i,
		);
	});

	it("keeps Todo planning minimal while retaining fixed completion reporting", () => {
		const context = buildCodingAgentSystemContext({
			taskGoal: "Todo CRUDを実装する",
			registeredRepositoryRoot: "/repo",
		});
		const rendered = renderCodingAgentRuntimeSystemContext(context);

		expect(rendered).toContain(
			"Plan Modeで採用済みimplementationPlanがあるRunでは",
		);
		expect(rendered).toContain("titleと600文字以内");
		expect(rendered).toContain("complete_current");
		expect(rendered).toContain(
			"品質ゲートと完了報告は固定項目であり、Todo stepとして追加しない",
		);
		expect(rendered).toContain("commit・merge状態");
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

	it("rebinds independent requests from the single top-level language variable", () => {
		const jaBinding = bindSystemContextCatalog();
		const ja = jaBinding("review.llm-reviewer", {});

		settingsMock.language = "en";
		const enBinding = bindSystemContextCatalog();
		const en = enBinding("review.llm-reviewer", {});
		const jaSnapshotAfterSwitch = jaBinding("review.llm-reviewer", {});

		expect(ja.manifest).toMatchObject({
			requestedLocale: "ja-JP",
			fallbackLocales: [],
			resolvedLocale: "ja-JP",
		});
		expect(en.manifest).toMatchObject({
			requestedLocale: "en-US",
			fallbackLocales: [],
			resolvedLocale: "en-US",
		});
		expect(en.content.text).toContain("Review the code");
		expect(ja.content.text).toContain("コードレビュー");
		expect(jaSnapshotAfterSwitch.manifest).toMatchObject({
			requestedLocale: "ja-JP",
			fallbackLocales: [],
			resolvedLocale: "ja-JP",
		});
		expect(settingsMock.readCount).toBe(2);

		p("review.llm-reviewer", {});
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
		snapshotP("review.llm-reviewer", {});
		expect(settingsMock.readCount).toBe(2);
	});

	it("does not expose a live locale renderer from the production catalog", () => {
		const source = readFileSync(
			new URL("../api/systemContexts/catalog.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toContain("createTextRenderer");
		expect(source).toMatch(/export const p\b/);
	});

	it("keeps the simple p() facade on one request-local locale snapshot", () => {
		runWithSystemContextBinding(() => {
			expect(p("review.llm-reviewer", {})).toContain("コードレビュー");
			settingsMock.language = "en";
			expect(p("review.llm-reviewer", {})).toContain("コードレビュー");
			expect(createSystemContextBindingSnapshot().instructionLocale).toBe(
				"ja-JP",
			);
		});
		expect(settingsMock.readCount).toBe(1);
		expect(p("review.llm-reviewer", {})).toContain("Review the code");
		expect(settingsMock.readCount).toBe(2);
	});

	it("isolates concurrent asynchronous p() request scopes", async () => {
		const render = (
			instructionLocale: "ja-JP" | "en-US",
			expectedText: string,
		) =>
			runWithSystemContextBinding(
				async () => {
					await Promise.resolve();
					const rendered = p("review.llm-reviewer", {});
					expect(rendered).toContain(expectedText);
					return createSystemContextBindingSnapshot().instructionLocale;
				},
				{ version: 1, instructionLocale, fallbackLocales: [] },
			);
		await expect(
			Promise.all([
				render("ja-JP", "コードレビュー"),
				render("en-US", "Review the code"),
			]),
		).resolves.toEqual(["ja-JP", "en-US"]);
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
				(entry) => entry.manifest.key,
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
				(entry) => entry.manifest.key,
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
				key: "codingAgent.current-todo",
				messageRole: "user",
				messageHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
			},
		});
		expect(
			verifyPromptMessageHash(
				{ role: "user", text: nativeTodo?.content ?? "" },
				nativeTodo?.systemContextAudit?.[0]?.manifest.messageHash ?? "",
			),
		).toBe(true);
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
			expect.objectContaining({
				code: "S11TNEXT_ARTIFACT_VERSION_UNSUPPORTED",
			}),
		);
		const mismatchedArtifact = structuredClone(catalogArtifact);
		mismatchedArtifact.catalogDigest = `sha256:${"0".repeat(64)}`;
		expect(() => createAppCatalog(mismatchedArtifact)).toThrowError(
			expect.objectContaining({ code: "S11TNEXT_ARTIFACT_DIGEST_MISMATCH" }),
		);

		const invoke = bindSystemContextCatalog();
		expect(() =>
			(invoke as (key: string, values: Record<string, unknown>) => unknown)(
				"codingAgent.role-instructions",
				{ undeclared: true },
			),
		).toThrowError(expect.objectContaining({ code: "S11TNEXT_VALUE_EXTRA" }));

		const request = bindSystemContextCatalogSnapshot();
		const userInvocation = request.invoke("codingAgent.current-todo", {
			todo: { id: "todo-role-check" },
		});
		expect(() =>
			systemContextPromptAudit("system", request, userInvocation),
		).toThrow(/message role "user".*"system"/);
	});

	it("uses the published runtime compiler version and preserves public text shape", () => {
		const packageManifest = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { dependencies: { s11tnext: string } };
		const invocation = bindSystemContextCatalog()(
			"codingAgent.role-instructions",
			{},
		);

		expect(invocation.manifest.compilerVersion).toBe(
			packageManifest.dependencies.s11tnext,
		);
		expect(invocation.manifest).toMatchObject({
			key: "codingAgent.role-instructions",
			messageRole: "system",
			messageHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
			sectionIds: ["context.text"],
			releaseProfile: "development",
		});
		expect(
			verifyPromptMessageHash(
				{ role: invocation.role, text: invocation.content.text },
				invocation.manifest.messageHash,
			),
		).toBe(true);
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
			'<S11TNEXT_DELIMITED_CONTEXT variable="taskGoal">',
		);

		expect(outputHashes).toEqual({
			codingAgent:
				"d055d5df5594c310c04cfcb4eeabe1af83ebf70aa447d72ba06f34acc04ae5cd",
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
