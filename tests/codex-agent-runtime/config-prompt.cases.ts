import { describe, expect, it, vi } from "vitest";
import { getNightWorkersCodexToolNames } from "../../api/mcp/nightworkers-tool-manifest";
import {
	buildCodexRuntimePrompt,
	buildCodexRuntimePromptParts,
	CodexAgentRuntime,
} from "../../api/services/agent-runtime/CodexAgentRuntime";
import {
	buildCodexRuntimeSdkOptions,
	buildCodexRuntimeThreadOptions,
	resolveCodexRuntimeMcpConfigState,
} from "../../api/services/agent-runtime/codex-runtime-config";
import { createCodexRuntimeThread } from "../../api/services/agent-runtime/codex-sdk/codex-sdk-client";
import { buildOntologyBoundaryAuditSnapshot } from "../../api/services/agent-runtime/ontology-runtime-context";
import { buildContext, fakeThread } from "./helpers";
import "./setup";

describe("CodexAgentRuntime config and prompt", () => {
	it("builds runtime Codex options without structured provider feature suppression", () => {
		const options = buildCodexRuntimeSdkOptions({
			accessToken: "runtime-token",
			env: {
				PATH: "/usr/bin",
				CODEX_THREAD_ID: "parent-thread",
				CODEX_SHELL: "1",
				NIGHTWORKERS_CODEX_MCP_URL: "http://127.0.0.1:39173/mcp/nightworkers",
				NIGHTWORKERS_TASK_ID: "task-codex",
				NIGHTWORKERS_RUN_ID: "run-codex",
				DATABASE_URL: "file:/tmp/nightworkers.sqlite",
				JWT_SECRET: "secret-with-enough-length-for-tests",
				NIGHTWORKERS_DESKTOP: "1",
				NIGHTWORKERS_RUNTIME_DIR: "/tmp/nightworkers-runtime",
			} as never,
		});

		expect(options.config).toMatchObject({
			features: { mcp: true },
			mcp_servers: {
				nightworkers: {
					transport: "streamable_http",
					url: "http://127.0.0.1:39173/mcp/nightworkers?taskId=task-codex&runId=run-codex",
					tools: {
						read_current_specification: { approval_mode: "approve" },
						list_recent_specifications: { approval_mode: "approve" },
						todo_list: { approval_mode: "approve" },
						import_project: { approval_mode: "approve" },
					},
				},
			},
		});
		expect(options.env).toMatchObject({
			PATH: "/usr/bin",
			CODEX_ACCESS_TOKEN: "runtime-token",
		});
		expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
		expect(options.env?.CODEX_SHELL).toBeUndefined();
	});

	it("configures the Hono-hosted NightWorkers MCP by default", () => {
		const options = buildCodexRuntimeSdkOptions({
			accessToken: "runtime-token",
			env: {
				PATH: "/usr/bin",
				CODEX_THREAD_ID: "parent-thread",
				PORT: "49200",
			} as never,
		});

		expect(options.config).toMatchObject({
			features: { mcp: true },
			mcp_servers: {
				nightworkers: {
					transport: "streamable_http",
					url: "http://127.0.0.1:49200/mcp/nightworkers",
				},
			},
		});
		expect(options.env).toMatchObject({
			PATH: "/usr/bin",
			CODEX_ACCESS_TOKEN: "runtime-token",
		});
		expect(options.env?.CODEX_THREAD_ID).toBeUndefined();
	});

	it("resumes a compatible Codex SDK thread when runtime resume state is present", async () => {
		const resumedThread = fakeThread([]);
		const freshThread = fakeThread([]);
		const codexClient = {
			resumeThread: vi.fn(() => resumedThread),
			startThread: vi.fn(() => freshThread),
		};
		const resumeEvents: unknown[] = [];

		const thread = await createCodexRuntimeThread({
			context: {
				...buildContext(),
				contextSnapshot: {
					...buildContext().contextSnapshot,
					runtimeResume: {
						kind: "codex_thread",
						stateId: "state-1",
						providerThreadId: "codex-thread-1",
					},
				},
			},
			codexClient,
			onResumeEvent: (event) => {
				resumeEvents.push(event);
			},
		});

		expect(thread).toBe(resumedThread);
		expect(codexClient.resumeThread).toHaveBeenCalledWith(
			"codex-thread-1",
			expect.objectContaining({ workingDirectory: expect.any(String) }),
		);
		expect(codexClient.startThread).not.toHaveBeenCalled();
		expect(resumeEvents).toEqual([
			{
				status: "reused",
				providerThreadId: "codex-thread-1",
				stateId: "state-1",
			},
		]);
	});

	it("falls back to a fresh Codex SDK thread when resumeThread is rejected", async () => {
		const freshThread = fakeThread([]);
		const codexClient = {
			resumeThread: vi.fn(() => {
				throw new Error("resume rejected");
			}),
			startThread: vi.fn(() => freshThread),
		};
		const resumeEvents: unknown[] = [];

		const thread = await createCodexRuntimeThread({
			context: {
				...buildContext(),
				contextSnapshot: {
					...buildContext().contextSnapshot,
					runtimeResume: {
						kind: "codex_thread",
						stateId: "state-stale",
						providerThreadId: "codex-thread-stale",
					},
				},
			},
			codexClient,
			onResumeEvent: (event) => {
				resumeEvents.push(event);
			},
		});

		expect(thread).toBe(freshThread);
		expect(codexClient.resumeThread).toHaveBeenCalledOnce();
		expect(codexClient.startThread).toHaveBeenCalledOnce();
		expect(resumeEvents).toEqual([
			{
				status: "fallback_started_fresh",
				providerThreadId: "codex-thread-stale",
				stateId: "state-stale",
				error: "resume rejected",
			},
		]);
	});

	it("starts a fresh Codex SDK thread when runtime resume is disabled", async () => {
		const freshThread = fakeThread([]);
		const codexClient = {
			resumeThread: vi.fn(),
			startThread: vi.fn(() => freshThread),
		};
		const resumeEvents: unknown[] = [];

		const thread = await createCodexRuntimeThread({
			context: {
				...buildContext(),
				runtimeOptions: {
					runtimeResume: {
						kind: "codex_thread",
						status: "disabled",
						executionMode: "review",
						reason: "review_fresh_context",
					},
				},
			},
			codexClient,
			onResumeEvent: (event) => {
				resumeEvents.push(event);
			},
		});

		expect(thread).toBe(freshThread);
		expect(codexClient.resumeThread).not.toHaveBeenCalled();
		expect(codexClient.startThread).toHaveBeenCalledOnce();
		expect(resumeEvents).toEqual([{ status: "unavailable" }]);
	});

	it("derives the Hono-hosted NightWorkers MCP URL from the API origin", () => {
		const originOptions = buildCodexRuntimeSdkOptions({
			env: {
				NIGHTWORKERS_API_ORIGIN: "http://127.0.0.1:49300",
			} as never,
		});
		expect(originOptions.config).toMatchObject({
			mcp_servers: {
				nightworkers: {
					url: "http://127.0.0.1:49300/mcp/nightworkers",
				},
			},
		});

		const explicitPathOptions = buildCodexRuntimeSdkOptions({
			env: {
				NIGHTWORKERS_API_ORIGIN: "http://127.0.0.1:49300/mcp/nightworkers",
			} as never,
		});
		expect(explicitPathOptions.config).toMatchObject({
			mcp_servers: {
				nightworkers: {
					url: "http://127.0.0.1:49300/mcp/nightworkers",
				},
			},
		});
	});

	it("resolves Codex MCP config source to the Hono-hosted inline server", () => {
		expect(
			resolveCodexRuntimeMcpConfigState({
				env: {
					NIGHTWORKERS_CODEX_MCP_URL: "http://127.0.0.1:39173/mcp/nightworkers",
				} as never,
			}),
		).toMatchObject({
			source: "inline_configured",
			hasInlineNightWorkersMcp: true,
			serverName: "nightworkers",
			expectedTools: getNightWorkersCodexToolNames(),
		});
		expect(
			resolveCodexRuntimeMcpConfigState({ env: {} as never }),
		).toMatchObject({
			source: "inline_configured",
			hasInlineNightWorkersMcp: true,
			serverName: "nightworkers",
		});
		expect(
			resolveCodexRuntimeMcpConfigState({ enableNightworkersMcp: false }),
		).toMatchObject({
			source: "disabled",
			hasInlineNightWorkersMcp: false,
		});
	});

	it("can explicitly disable MCP for Codex runtime", () => {
		const options = buildCodexRuntimeSdkOptions({
			enableNightworkersMcp: false,
			env: { PATH: "/usr/bin" } as never,
		});

		expect(options.config).toMatchObject({
			features: { mcp: false },
			mcp_servers: {},
		});
	});

	it("builds runtime thread options from the repository root", () => {
		const options = buildCodexRuntimeThreadOptions(
			buildContext({
				repoRoot: "/repo/project",
				codex: { model: "gpt-5.3-codex", thinkingDepth: "very_high" },
			}),
		);

		expect(options).toMatchObject({
			model: "gpt-5.3-codex",
			modelReasoningEffort: "xhigh",
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
			networkAccessEnabled: false,
			webSearchMode: "disabled",
			skipGitRepoCheck: true,
			workingDirectory: "/repo/project",
		});
	});

	it("adds NightWorkers MCP planning guidance to the Codex runtime prompt", () => {
		const prompt = buildCodexRuntimePrompt(
			buildContext({
				latestUserMessage: "実装計画書を作ってください",
				ontologyMcp: { enabled: true, fileScale: "large" },
			}),
		);

		expect(prompt).toContain("実装計画書を作ってください");
		expect(prompt).toContain("[NightWorkers Runtime Contract]");
		expect(prompt).toContain("taskId: task-codex");
		expect(prompt).toContain("runId: run-codex");
		expect(prompt).toContain("executionMode: implementation");
		expect(prompt).toContain("Plan mode: disabled");
		expect(prompt).toContain("Plan Mode を明示していない");
		expect(prompt).toContain("context-still.initial_instructions");
		expect(prompt).toContain(
			getNightWorkersCodexToolNames({ ontologyMcpEnabled: true }).join(", "),
		);
		expect(prompt).toContain("nightworkers.todo_list");
		expect(prompt).toContain("operation=replace");
		expect(prompt).toContain("operation=done");
		expect(prompt).not.toContain("Minimal implementation behavior:");
		expect(prompt).toContain("実装時の最小実行方針:");
		expect(prompt).not.toContain("最小確認後に実装する");
		expect(prompt).toContain("対象変更と必要な局所確認を同じ実作業 Todo");
		expect(prompt).toContain("ユーザー依頼にない独立検証 Todo を追加しない");
		expect(prompt).toContain("詳細な implementation-plan artifact を作らない");
		expect(prompt).toContain(
			"Todo tracking、quality_gate_verify、closeout は省略しない",
		);
		expect(prompt).toContain("DB migration を実行する");
		expect(prompt).toContain("read-only focused test / smoke");
		expect(prompt).toContain(
			"migration ファイル、DB schema、DB bootstrap / seed / persistence table 定義を作成・更新する必要が分かった時点",
		);
		expect(prompt).toContain("todoListReplaceReason=newly_required_work");
		expect(prompt).toContain("隔離 DB の smoke だけ");
		expect(prompt).toContain("Questionnaire が unit 主軸なら");
		expect(prompt).toContain("E2E Todo / E2E command を追加・実行しない");
		expect(prompt).toContain("verify が format / typecheck / lint / test");
		expect(prompt).toContain("個別コマンドを重複実行しない");
		expect(prompt).toContain("対象 DB での schema/table 存在確認");
		expect(prompt).toContain("API が no such table");
		expect(prompt).toContain("仕様が正本の場合");
		expect(prompt).toContain("実行順は specification -> Todo execution");
		expect(prompt).toContain(
			"context-still.initial_instructions は、この task で未実行の場合だけ作業前に一度実行して従う",
		);
		expect(prompt).toContain("チャット入力ごとに再実行しない");
		expect(prompt).not.toContain("ContextStill:");
		expect(prompt).not.toContain("contextStill tool details");
		expect(prompt).not.toContain("context-still.compile_eval is required");
		expect(prompt).toContain("closeout は実装と検証が終わり");
		expect(prompt).toContain("「完了報告を行う」gate");
		expect(prompt).toContain("Todo 作成結果、計画共有、途中経過");
		expect(prompt).not.toContain("register_candidates");
		expect(prompt).not.toContain("知識登録を行う");
		expect(prompt).toContain("TodoList pane がユーザー向け進捗");
		expect(prompt).toContain("Timeline cards は Todo 進捗");
		expect(prompt).toContain("operation=list は診断専用");
		expect(prompt).toContain(
			"未確認 mutation や未実施 verification を done にしない",
		);
		expect(prompt).toContain(
			"ファイルを編集する前に、対象ファイルまたは直接関係する既存ファイルを読む",
		);
		expect(prompt).toContain("rg --files や ls は探索");
		expect(prompt).toContain("nightworkers.read_current_specification");
		expect(prompt).toContain("nightworkers.list_recent_specifications");
		expect(prompt).toContain(
			"planning / specification / design-doc / requirement-check",
		);
		expect(prompt).toContain("includeDesignContext=true");
		expect(prompt).toContain("nightworkers.import_project");
		expect(prompt).not.toContain("nightworkers.materialize_template");
		expect(prompt).not.toContain("nightworkers.clone_git_repo");
		expect(prompt).not.toContain("nightworkers.run_command");
		expect(prompt).not.toContain("nightworkers.run_verification");
		expect(prompt).toContain("source=starter, stack=hono");
		expect(prompt).toContain("既定 SQLite variant");
		expect(prompt).toContain(
			"targetPath 内の package.json や source files を shell/read tools で読まない",
		);
		expect(prompt).toContain("空の targetPath は未 materialized");
		expect(prompt).toContain("zsh の先行展開を避けるため quote する");
		expect(prompt).toContain("例: -name 'vite.config.*'");
		expect(prompt).toContain(
			"NightWorkers task_run id を外部 MCP runId として渡さない",
		);
		expect(prompt).toContain(
			"context-still compile_eval では context_compile が返した runId",
		);
		expect(prompt).toContain(
			"ユーザーへ保存可否を Yes / No で質問せず、常に保存許可として扱ってください",
		);
		expect(prompt).toContain(
			"NightWorkers-managed gate の Todo に紐づく場合も",
		);
		expect(prompt).toContain(
			"作成または大幅編集後は、検証や closeout の前に関係箇所を読み返す",
		);
		expect(prompt).toContain("Codex native command_execution events");
		expect(prompt).toContain("fallback static app や代替実装を作らない");
		expect(prompt).toContain(
			"plan-only answer や next-steps summary で止まらず",
		);
		expect(prompt).toContain("Module ontology protocol:");
		expect(prompt).toContain("nightworkers.classify_goal");
		expect(prompt).toContain("nightworkers.compile_module_context");
		expect(prompt).toContain("nightworkers.check_boundary");
		expect(prompt).toContain("nightworkers.get_verification_plan");
		expect(prompt).toContain(
			"primary module, secondary modules, boundary crossings",
		);
	});

	it("includes ontology runtime snapshot in Codex prompt when present", () => {
		const prompt = buildCodexRuntimePrompt(
			buildContext({
				ontologyMcp: { enabled: true, fileScale: "large" },
				ontologyContext: {
					version: 1,
					available: true,
					primaryModule: "project-detail",
					secondaryModules: ["mission-planner"],
					summaryType: "task_scoped",
					taskGenerationEvidence: true,
					taskCandidateId: "candidate-1",
					ownedPaths: ["api/modules/project-detail/**"],
					invariants: ["candidate-routing"],
					focusedVerification: [
						"bunx vitest run tests/project-detail-backend.test.ts",
					],
					boundaryWarnings: ["Do not change provider routing policy."],
					warnings: [],
				},
			}),
		);

		expect(prompt).toContain("Ontology runtime snapshot:");
		expect(prompt).toContain("primary module: project-detail");
		expect(prompt).toContain("secondary modules: mission-planner");
		expect(prompt).toContain("task generation evidence: present");
		expect(prompt).toContain("focused verification candidates");
		expect(prompt).toContain("Ontology closeout requirements:");
	});

	it("omits ontology prompt guidance when ontology flag is absent", () => {
		const prompt = buildCodexRuntimePrompt(
			buildContext({
				ontologyContext: {
					version: 1,
					available: true,
					primaryModule: "project-detail",
				},
			}),
		);

		expect(prompt).not.toContain("Module ontology protocol:");
		expect(prompt).not.toContain("Ontology runtime snapshot:");
	});

	it("omits ontology MCP tools and prompt guidance when disabled by project scale", () => {
		const prompt = buildCodexRuntimePrompt(
			buildContext({
				ontologyMcp: { enabled: false, fileScale: "medium" },
				ontologyContext: {
					version: 1,
					available: true,
					primaryModule: "project-detail",
				},
			}),
		);
		const options = buildCodexRuntimeSdkOptions({
			env: {
				NIGHTWORKERS_EXECUTION_MODE: "implementation",
				NIGHTWORKERS_ONTOLOGY_MCP_ENABLED: "false",
				NIGHTWORKERS_CODEX_MCP_URL: "http://127.0.0.1:39173/mcp/nightworkers",
			} as never,
		});
		const tools = (
			options.config as {
				mcp_servers?: { nightworkers?: { tools?: Record<string, unknown> } };
			}
		).mcp_servers?.nightworkers?.tools;

		expect(prompt).not.toContain("Module ontology protocol:");
		expect(prompt).not.toContain("nightworkers.classify_goal");
		expect(prompt).not.toContain("nightworkers.compile_module_context");
		expect(prompt).not.toContain("Ontology runtime snapshot:");
		expect(tools).not.toHaveProperty("list_modules");
		expect(tools).not.toHaveProperty("compile_module_context");
		expect(
			resolveCodexRuntimeMcpConfigState({
				env: {
					NIGHTWORKERS_EXECUTION_MODE: "implementation",
					NIGHTWORKERS_ONTOLOGY_MCP_ENABLED: "false",
				} as never,
			}).expectedTools,
		).toEqual(
			getNightWorkersCodexToolNames({
				executionMode: "implementation",
				ontologyMcpEnabled: false,
			}),
		);
	});

	it("keeps boundary audit unavailable when no touched files are present", async () => {
		const audit = await buildOntologyBoundaryAuditSnapshot({
			repoRoot: process.cwd(),
			ontologyContext: {
				version: 1,
				available: true,
				primaryModule: "project-detail",
				secondaryModules: [],
				focusedVerification: [
					"bunx vitest run tests/project-detail-backend.test.ts",
				],
			},
			touchedFiles: [],
		});

		expect(audit).toMatchObject({
			available: false,
			source: "unavailable",
			verificationSelection: {
				focused: ["bunx vitest run tests/project-detail-backend.test.ts"],
			},
		});
		expect(audit.warnings[0]).toContain("No touched files");
	});

	it("records declared secondary module crossings in boundary audit", async () => {
		const audit = await buildOntologyBoundaryAuditSnapshot({
			repoRoot: process.cwd(),
			ontologyContext: {
				version: 1,
				available: true,
				primaryModule: "project-detail",
				secondaryModules: ["mission-planner"],
				focusedVerification: [
					"bunx vitest run tests/project-detail-backend.test.ts",
				],
			},
			touchedFiles: ["api/modules/mission-planner/mission-planner.service.ts"],
		});

		expect(audit).toMatchObject({
			available: true,
			decision: "allow_with_crossing",
			primaryModule: "project-detail",
			boundaryCrossings: [
				expect.objectContaining({
					module: "mission-planner",
					declaredSecondary: true,
					paths: ["api/modules/mission-planner/mission-planner.service.ts"],
				}),
			],
			verificationSelection: {
				focused: ["bunx vitest run tests/project-detail-backend.test.ts"],
				warnings: [],
			},
		});
	});

	it("builds Codex runtime prompt parts without changing the prompt string", () => {
		const context = buildContext({
			latestUserMessage: "仕様に沿って実装してください",
		});
		const prompt = buildCodexRuntimePrompt(context);
		const parts = buildCodexRuntimePromptParts(context);

		expect(parts.prompt).toBe(prompt);
		expect(parts.request).toBe("仕様に沿って実装してください");
		expect(parts.runtimeContract).toContain("[NightWorkers Runtime Contract]");
		expect(parts.estimates.requestTokens).toBeGreaterThan(0);
		expect(parts.estimates.runtimeContractTokens).toBeGreaterThan(0);
		expect(parts.estimates.fullPromptTokens).toBeGreaterThan(
			parts.estimates.requestTokens,
		);
	});

	it("uses a lightweight completed-task contract for Codex review mode", () => {
		const reviewParts = buildCodexRuntimePromptParts(
			buildContext({
				executionMode: "review",
				latestUserMessage: "完了済みの差分をレビューしてください",
			}),
		);
		const implementationParts = buildCodexRuntimePromptParts(
			buildContext({
				executionMode: "implementation",
				latestUserMessage: "仕様に沿って実装してください",
			}),
		);

		expect(reviewParts.prompt).toContain(
			"完了済みの差分をレビューしてください",
		);
		expect(reviewParts.runtimeContract).toContain("executionMode: review");
		expect(reviewParts.runtimeContract).toContain("completed-task review only");
		expect(reviewParts.runtimeContract).toContain(
			"実装中の会話履歴を前提にしない",
		);
		expect(reviewParts.runtimeContract).not.toContain(
			"Minimal implementation behavior:",
		);
		expect(reviewParts.runtimeContract).not.toContain("operation=replace");
		expect(reviewParts.runtimeContract).not.toContain(
			"Module ontology protocol:",
		);
		expect(reviewParts.estimates.runtimeContractTokens).toBeLessThan(
			implementationParts.estimates.runtimeContractTokens,
		);
	});

	it("marks Codex runtime prompt as planning only for planning executionMode", () => {
		const prompt = buildCodexRuntimePrompt(
			buildContext({
				latestUserMessage: "実装計画書を作ってください",
				executionMode: "planning",
			}),
		);

		expect(prompt).toContain("executionMode: planning");
		expect(prompt).toContain("Plan mode: enabled");
		expect(prompt).toContain("実装編集は行わない");
		expect(prompt).toContain(
			getNightWorkersCodexToolNames({ executionMode: "planning" }).join(", "),
		);
		expect(prompt).not.toContain("nightworkers.todo_list");
		expect(prompt).not.toContain("nightworkers.import_project");
	});

	it("removes mutating NightWorkers MCP tools from planning Codex inline config", () => {
		const options = buildCodexRuntimeSdkOptions({
			env: {
				NIGHTWORKERS_EXECUTION_MODE: "planning",
				NIGHTWORKERS_CODEX_MCP_URL: "http://127.0.0.1:39173/mcp/nightworkers",
			} as never,
		});

		expect(options.config).toMatchObject({
			mcp_servers: {
				nightworkers: {
					tools: {
						read_current_specification: { approval_mode: "approve" },
						list_recent_specifications: { approval_mode: "approve" },
					},
				},
			},
		});
		expect(
			(
				options.config as {
					mcp_servers?: { nightworkers?: { tools?: Record<string, unknown> } };
				}
			).mcp_servers?.nightworkers?.tools,
		).not.toHaveProperty("todo_list");
		expect(
			(
				options.config as {
					mcp_servers?: { nightworkers?: { tools?: Record<string, unknown> } };
				}
			).mcp_servers?.nightworkers?.tools,
		).not.toHaveProperty("import_project");
		expect(
			resolveCodexRuntimeMcpConfigState({
				env: { NIGHTWORKERS_EXECUTION_MODE: "planning" } as never,
			}).expectedTools,
		).toEqual(getNightWorkersCodexToolNames({ executionMode: "planning" }));
	});

	it("emits planning runtime contract with read-only NightWorkers MCP tools", async () => {
		const runtime = new CodexAgentRuntime({
			threadFactory: () =>
				fakeThread([
					{ type: "thread.started", thread_id: "codex-thread-1" },
					{
						type: "item.completed",
						item: { id: "msg-1", type: "agent_message", text: "plan" },
					},
				] as never),
		});
		const events: unknown[] = [];

		await runtime.start(buildContext({ executionMode: "planning" }), {
			emit: async (event) => {
				events.push(event);
			},
		});

		const runtimeStarted = events.find(
			(event) => (event as { type?: string }).type === "runtime_started",
		) as {
			payload?: { runtimeContract?: { mcp?: { expectedTools?: string[] } } };
		};
		expect(
			runtimeStarted?.payload?.runtimeContract?.mcp?.expectedTools,
		).toEqual(getNightWorkersCodexToolNames({ executionMode: "planning" }));
		expect(
			runtimeStarted?.payload?.runtimeContract?.mcp?.expectedTools,
		).not.toContain("nightworkers.todo_list");
		expect(
			runtimeStarted?.payload?.runtimeContract?.mcp?.expectedTools,
		).not.toContain("nightworkers.import_project");
	});

	it("keeps general answer prompts separate from implementation contracts", () => {
		const prompt = buildCodexRuntimePrompt(
			buildContext({
				latestUserMessage: "バックエンド使わない構成でしょうか？",
				executionMode: "general_answer",
			}),
		);

		expect(prompt).toContain("executionMode: general_answer");
		expect(prompt).toContain("General answer behavior:");
		expect(prompt).toContain("質問に答えるための読み取り確認だけ");
		expect(prompt).toContain(
			"Plan Mode artifact、Plan Mode Workspace、TodoList",
		);
		expect(prompt).not.toContain("Minimal implementation behavior:");
		expect(prompt).not.toContain("nightworkers.todo_list");
		expect(prompt).not.toContain("quality_gate_verify、closeout は省略しない");
		expect(prompt).not.toContain(
			"Execution order: specification -> Todo execution",
		);
		expect(prompt).not.toContain("implementation-plan artifact を主成果物");
	});

	it("passes the composed runtime prompt to Codex threads", async () => {
		const thread = fakeThread([
			{ type: "turn.started" },
			{
				type: "item.completed",
				item: { id: "msg-1", type: "agent_message", text: "done" },
			},
		]);
		const runtime = new CodexAgentRuntime({
			threadFactory: () => thread,
		});

		await runtime.start(
			buildContext({ latestUserMessage: "仕様に沿って計画して" }),
			{
				emit: async () => {},
			},
		);

		expect(thread.runStreamed).toHaveBeenCalledWith(
			expect.stringContaining("nightworkers.read_current_specification"),
			expect.any(Object),
		);
	});
});
