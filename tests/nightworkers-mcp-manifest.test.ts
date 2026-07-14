import { describe, expect, it } from "vitest";
import {
	buildNightWorkersCodexToolApprovalConfig,
	buildNightWorkersCodexToolConfigLines,
	nightWorkersCheckBoundaryInputSchema,
	nightWorkersClassifyGoalInputSchema,
	nightWorkersCompileModuleContextInputSchema,
	nightWorkersGetModuleOntologyInputSchema,
	nightWorkersGetVerificationPlanInputSchema,
	nightWorkersImportProjectInputSchema,
	nightWorkersListOntologyModulesInputSchema,
	nightWorkersReadCurrentSpecificationInputSchema,
	nightWorkersTodoListInputSchema,
	toNightWorkersJsonSchema,
} from "../api/mcp/nightworkers-tool-manifest";
import { buildCodexRuntimeSdkOptions } from "../api/services/agent-runtime/codex-runtime-config";
import { getAllowedToolsForJobType } from "../api/services/supervisor/prompt-tool-registry";

describe("nightworkers MCP manifest", () => {
	it("drives the runtime tool approval config", () => {
		const options = buildCodexRuntimeSdkOptions({
			env: {
				PATH: "/usr/bin",
				NIGHTWORKERS_CODEX_MCP_URL: "http://127.0.0.1:39173/mcp/nightworkers",
			} as never,
		});

		expect(options.config).toMatchObject({
			mcp_servers: {
				nightworkers: {
					transport: "streamable_http",
					url: "http://127.0.0.1:39173/mcp/nightworkers",
					tools: buildNightWorkersCodexToolApprovalConfig(),
				},
			},
		});
	});

	it("adds per-run request context to the runtime MCP URL", () => {
		const options = buildCodexRuntimeSdkOptions({
			env: {
				PATH: "/usr/bin",
				NIGHTWORKERS_CODEX_MCP_URL: "http://127.0.0.1:39173/mcp/nightworkers",
				NIGHTWORKERS_TASK_ID: "task-123",
				NIGHTWORKERS_RUN_ID: "run-456",
				NIGHTWORKERS_EXECUTION_MODE: "implementation",
			} as never,
		});

		const url = new URL(
			String(
				(
					options.config as
						| { mcp_servers?: { nightworkers?: { url?: unknown } } }
						| undefined
				)?.mcp_servers?.nightworkers?.url ?? "",
			),
		);

		expect(url.origin + url.pathname).toBe(
			"http://127.0.0.1:39173/mcp/nightworkers",
		);
		expect(url.searchParams.get("taskId")).toBe("task-123");
		expect(url.searchParams.get("runId")).toBe("run-456");
		expect(url.searchParams.get("executionMode")).toBe("implementation");
	});

	it("drives the installer tool config lines without ontology tools by default", () => {
		const lines = buildNightWorkersCodexToolConfigLines().join("\n");

		expect(lines).toContain(
			"[mcp_servers.nightworkers.tools.read_current_specification]",
		);
		expect(lines).toContain(
			"[mcp_servers.nightworkers.tools.list_recent_specifications]",
		);
		expect(lines).toContain("[mcp_servers.nightworkers.tools.todo_list]");
		expect(lines).toContain("[mcp_servers.nightworkers.tools.import_project]");
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.list_modules]",
		);
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.get_module_ontology]",
		);
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.classify_goal]",
		);
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.compile_module_context]",
		);
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.check_boundary]",
		);
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.get_verification_plan]",
		);
		expect(lines).not.toContain("replace_todo_list");
	});

	it("adds ontology tools to installer config lines when explicitly enabled", () => {
		const lines = buildNightWorkersCodexToolConfigLines({
			ontologyMcpEnabled: true,
		}).join("\n");

		expect(lines).toContain("[mcp_servers.nightworkers.tools.list_modules]");
		expect(lines).toContain(
			"[mcp_servers.nightworkers.tools.get_module_ontology]",
		);
		expect(lines).toContain("[mcp_servers.nightworkers.tools.classify_goal]");
		expect(lines).toContain(
			"[mcp_servers.nightworkers.tools.compile_module_context]",
		);
		expect(lines).toContain("[mcp_servers.nightworkers.tools.check_boundary]");
		expect(lines).toContain(
			"[mcp_servers.nightworkers.tools.get_verification_plan]",
		);
		expect(lines).not.toContain("replace_todo_list");
	});

	it("omits ontology MCP tools when ontology MCP is disabled for smaller projects", () => {
		const lines = buildNightWorkersCodexToolConfigLines({
			ontologyMcpEnabled: false,
		}).join("\n");
		const tools = buildNightWorkersCodexToolApprovalConfig({
			ontologyMcpEnabled: false,
		});

		expect(lines).toContain(
			"[mcp_servers.nightworkers.tools.read_current_specification]",
		);
		expect(lines).toContain("[mcp_servers.nightworkers.tools.todo_list]");
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.list_modules]",
		);
		expect(lines).not.toContain(
			"[mcp_servers.nightworkers.tools.compile_module_context]",
		);
		expect(tools).not.toHaveProperty("list_modules");
		expect(tools).not.toHaveProperty("compile_module_context");
		expect(tools).not.toHaveProperty("check_boundary");
	});

	it("drives the supervisor prompt schemas for shared NightWorkers tools", () => {
		const majorTools = getAllowedToolsForJobType("major_code_edit");
		const readCurrentSpecification = majorTools.find(
			(tool) => tool.name === "read_current_specification",
		);
		const importProject = majorTools.find(
			(tool) => tool.name === "import_project",
		);
		const todoList = majorTools.find((tool) => tool.name === "todo_list");

		expect(readCurrentSpecification?.inputSchema).toEqual(
			toNightWorkersJsonSchema(nightWorkersReadCurrentSpecificationInputSchema),
		);
		expect(
			(
				readCurrentSpecification?.inputSchema.properties as
					| Record<string, unknown>
					| undefined
			)?.includeDesignContext,
		).toMatchObject({ type: "boolean" });
		expect(importProject?.inputSchema).toEqual(
			toNightWorkersJsonSchema(nightWorkersImportProjectInputSchema),
		);
		const sharedTodoSchema = toNightWorkersJsonSchema(
			nightWorkersTodoListInputSchema,
		);
		expect(
			(
				(
					todoList?.inputSchema.properties as
						| Record<string, unknown>
						| undefined
				)?.operation as { enum?: unknown[] } | undefined
			)?.enum ?? [],
		).toEqual(["replace", "start", "done", "block", "fail"]);
		expect(
			(
				(sharedTodoSchema.properties as Record<string, unknown> | undefined)
					?.operation as { enum?: unknown[] } | undefined
			)?.enum ?? [],
		).toContain("list");
	});

	it("rejects presentation labels as starter variants", () => {
		expect(
			nightWorkersImportProjectInputSchema.safeParse({
				source: "starter",
				stack: "hono",
				variant: "react-vite",
			}).success,
		).toBe(false);
		expect(
			nightWorkersImportProjectInputSchema.safeParse({
				source: "starter",
				stack: "hono",
				variant: "sqlite",
			}).success,
		).toBe(true);
		expect(
			nightWorkersImportProjectInputSchema.safeParse({
				source: "starter",
				stack: "java",
				variant: "java8-sqlite",
			}).success,
		).toBe(true);
		expect(
			nightWorkersImportProjectInputSchema.safeParse({
				source: "starter",
				stack: "rust",
				variant: "pgsql",
			}).success,
		).toBe(true);
		expect(
			nightWorkersImportProjectInputSchema.safeParse({
				source: "starter",
				stack: "hono",
				variant: "java8-sqlite",
			}).success,
		).toBe(false);
		expect(
			nightWorkersImportProjectInputSchema.safeParse({
				source: "starter",
				stack: "rust",
				variant: "postgres",
			}).success,
		).toBe(false);
		expect(
			nightWorkersImportProjectInputSchema.safeParse({
				source: "starter",
				stack: "python",
				variant: "auth",
			}).success,
		).toBe(false);
	});

	it("accepts SystemContext-echoed managed Todo taskTypes in replace input", () => {
		expect(() =>
			nightWorkersTodoListInputSchema.parse({
				operation: "replace",
				runId: "7c943012-84a7-4b3e-a05f-559079db78dc",
				todoListReplaceReason: "newly_required_work",
				todos: [
					{
						seq: 1,
						title: "todo_tasks の schema と migration を追加する",
						taskType: "data_migration",
						procedureId: "data_migration.create_migration",
					},
					{
						seq: 2,
						title: "todo の保存層と API 契約を実装する",
						taskType: "implementation",
					},
					{
						seq: 3,
						title: "完了報告を行う",
						taskType: "completion_report",
						procedureId: "final_completion_report",
						dependsOn: [2],
					},
				],
			}),
		).not.toThrow();

		const sharedTodoSchema = toNightWorkersJsonSchema(
			nightWorkersTodoListInputSchema,
		);
		const todosDescription = (
			(sharedTodoSchema.properties as Record<string, unknown> | undefined)
				?.todos as { description?: string } | undefined
		)?.description;
		expect(todosDescription).toContain("creating/updating migration files");
		expect(todosDescription).toContain("apply_migration");
		expect(todosDescription).toContain("real target DB");
		expect(todosDescription).toContain("schema/API/test verification");
		const taskTypeSchema = ((
			(sharedTodoSchema.properties as Record<string, unknown> | undefined)
				?.todos as
				| { items?: { properties?: Record<string, unknown> } }
				| undefined
		)?.items?.properties?.taskType ?? {}) as {
			enum?: unknown[];
			type?: unknown;
		};
		expect(taskTypeSchema.type).toBe("string");
		expect(taskTypeSchema.enum).toBeUndefined();
	});

	it("accepts unknown Todo taskTypes so runtime can normalize them fail-soft", () => {
		expect(() =>
			nightWorkersTodoListInputSchema.parse({
				operation: "replace",
				runId: "7c943012-84a7-4b3e-a05f-559079db78dc",
				todoListReplaceReason: "newly_required_work",
				todos: [
					{
						seq: 1,
						title: "DB-backed Todo API を実装する",
						taskType: "backend_api",
					},
				],
			}),
		).not.toThrow();
	});

	it("defines JSON schemas for ontology MCP tools", () => {
		expect(
			toNightWorkersJsonSchema(nightWorkersListOntologyModulesInputSchema),
		).toMatchObject({
			type: "object",
		});
		expect(
			toNightWorkersJsonSchema(nightWorkersGetModuleOntologyInputSchema),
		).toMatchObject({
			required: ["module"],
		});
		expect(
			toNightWorkersJsonSchema(nightWorkersClassifyGoalInputSchema),
		).toMatchObject({
			required: ["goal"],
		});
		expect(
			toNightWorkersJsonSchema(nightWorkersCompileModuleContextInputSchema),
		).toMatchObject({
			required: ["goal"],
		});
		expect(
			toNightWorkersJsonSchema(nightWorkersCheckBoundaryInputSchema),
		).toMatchObject({
			required: ["primaryModule", "plannedFiles"],
		});
		expect(
			toNightWorkersJsonSchema(nightWorkersGetVerificationPlanInputSchema),
		).toMatchObject({
			required: ["primaryModule"],
		});
	});
});
