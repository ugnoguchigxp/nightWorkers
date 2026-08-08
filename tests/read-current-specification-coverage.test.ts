import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
	dbError: null as unknown,
	limit: vi.fn(),
}));

const repo = vi.hoisted(() => ({
	listTaskMessages: vi.fn(),
	getTask: vi.fn(),
}));

const verification = vi.hoisted(() => ({
	getVerificationDocument: vi.fn(),
	listVerificationChecklistItems: vi.fn(),
}));

const questionnaire = vi.hoisted(() => ({ listDesignQuestionnaires: vi.fn() }));
const workspace = vi.hoisted(() => ({
	getPlanModeWorkspaceReferenceContext: vi.fn(),
}));
const renderer = vi.hoisted(() => ({ buildAssembledDesignContext: vi.fn() }));

vi.mock("../api/db/client", () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					orderBy: vi.fn(() => ({
						limit: state.limit,
					})),
				})),
			})),
		})),
	},
}));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => repo);
vi.mock(
	"../api/modules/nightworkers/nightworkers.verification.repository",
	() => verification,
);
vi.mock(
	"../api/modules/questionnaire/questionnaire-query.service",
	() => questionnaire,
);
vi.mock(
	"../api/modules/specification/plan-mode-workspace.service",
	() => workspace,
);
vi.mock(
	"../api/modules/specification/specification-document-renderer",
	() => renderer,
);

import {
	listRecentSpecificationsTool,
	readCurrentSpecificationTool,
} from "../api/services/worker-tools/read-current-specification";

function planMessage(overrides: Record<string, unknown> = {}) {
	return {
		id: "message-1",
		taskId: "task-1",
		messageType: "markdown_document",
		content: "# Purpose\nShip it",
		metadataJson: { intent: "feature_plan" },
		createdAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

function longPlan(withMatchingHeadings = true) {
	if (!withMatchingHeadings) return `# Unknown\n${"x".repeat(9_000)}`;
	return [
		"# Purpose",
		`Goal ${"g".repeat(2_000)}`,
		"# Implementation",
		`Steps ${"i".repeat(2_000)}`,
		"# Migration and schema",
		`DDL ${"m".repeat(2_000)}`,
		"# UI screen interaction",
		`UX ${"u".repeat(2_000)}`,
		"# Verification and acceptance",
		`Tests ${"v".repeat(2_000)}`,
	].join("\n");
}

describe("read current specification tool coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.rows = [];
		state.dbError = null;
		state.limit.mockImplementation(async () => {
			if (state.dbError) throw state.dbError;
			return state.rows;
		});
		repo.listTaskMessages.mockResolvedValue([]);
		repo.getTask.mockResolvedValue({ id: "task-1", title: "Task" });
		workspace.getPlanModeWorkspaceReferenceContext.mockResolvedValue({
			repositoryId: "repo-1",
		});
		questionnaire.listDesignQuestionnaires.mockResolvedValue([]);
		renderer.buildAssembledDesignContext.mockReturnValue({
			sourceMessageIds: ["message-1"],
		});
		verification.getVerificationDocument.mockResolvedValue(null);
		verification.listVerificationChecklistItems.mockResolvedValue([]);
	});

	it("rejects blank task ids and returns a stable not-found payload", async () => {
		const invalid = await readCurrentSpecificationTool({ taskId: "  " });
		expect(invalid).toMatchObject({
			ok: false,
			error: { code: "INVALID_TOOL_ARGS" },
			payload: { taskId: "", view: "compact" },
		});

		const missing = await readCurrentSpecificationTool({
			taskId: " task-1 ",
			view: "invalid" as never,
		});
		expect(missing).toMatchObject({
			ok: true,
			payload: {
				taskId: "task-1",
				found: false,
				view: "compact",
				fullContentChars: 0,
			},
		});
	});

	it("reads markdown data, generation sources, and lightweight verification", async () => {
		repo.listTaskMessages.mockResolvedValue([
			planMessage({ messageType: "note", metadataJson: null }),
			planMessage({
				id: "message-latest",
				metadataJson: {
					intent: "draft_spec",
					title: "Fallback title",
					markdownDocumentData: {
						title: "Canonical Feature Plan",
						content: "# Scope\nCanonical content",
					},
					questionnaireSessionId: "questionnaire-1",
					verificationDocumentId: "verification-1",
					verificationArtifactId: "artifact-1",
					generation: {
						context: {
							blueprintSummaryIncluded: true,
							dataModelDdlReferenceIncluded: false,
							dbDdlReferenceIncluded: true,
						},
					},
				},
			}),
		]);

		const result = await readCurrentSpecificationTool({
			taskId: "task-1",
			view: "implementation",
		});
		expect(result).toMatchObject({
			ok: true,
			payload: {
				found: true,
				messageId: "message-latest",
				title: "Canonical Feature Plan",
				content: "# Scope\nCanonical content",
				verification: {
					verificationDocumentId: "verification-1",
					verificationArtifactId: "artifact-1",
				},
				sources: {
					questionnaireSessionId: "questionnaire-1",
					blueprintSummaryIncluded: true,
					dataModelReferenceIncluded: false,
					dbDdlReferenceIncluded: true,
				},
			},
		});
		expect(result.payload.digest).toMatch(/^sha256:/);
	});

	it.each([
		"compact",
		"implementation",
		"migration",
		"ui",
	] as const)("projects long plans for the %s view", async (view) => {
		repo.listTaskMessages.mockResolvedValue([
			planMessage({
				content: longPlan(),
				metadataJson: { intent: "feature_plan" },
			}),
		]);
		const result = await readCurrentSpecificationTool({
			taskId: "task-1",
			view,
		});
		expect(result.ok).toBe(true);
		expect(result.payload.content).toContain("[specification-compact-view]");
		expect(result.payload.content.length).toBeLessThanOrEqual(8_000);
	});

	it("returns full content and uses the uncertain compact fallback", async () => {
		const content = longPlan(false);
		repo.listTaskMessages.mockResolvedValue([planMessage({ content })]);

		const compact = await readCurrentSpecificationTool({
			taskId: "task-1",
			view: "compact",
		});
		expect(compact.payload.compactWarning).toContain("view='full'");
		expect(compact.payload.content).toContain("[specification-compact-view]");

		const full = await readCurrentSpecificationTool({
			taskId: "task-1",
			view: "full",
		});
		expect(full.payload.content).toBe(content);
		expect(full.payload.compactWarning).toBeUndefined();
	});

	it("includes detailed verification and assembled design context", async () => {
		repo.listTaskMessages.mockResolvedValue([
			planMessage({
				metadataJson: {
					intent: "feature_plan",
					questionnaireSessionId: "preferred",
					verificationDocumentId: "verification-1",
					verificationArtifactId: 42,
				},
			}),
		]);
		questionnaire.listDesignQuestionnaires.mockResolvedValue([
			{ id: "first", status: "draft" },
			{ id: "ready", status: "review_ready" },
			{ id: "preferred", status: "accepted" },
		]);
		verification.getVerificationDocument.mockResolvedValue({
			documentJson: { version: 1 },
		});
		verification.listVerificationChecklistItems.mockResolvedValue([
			{ required: true, status: "failed" },
			{ required: true, status: "unknown" },
			{ required: false, status: "unknown" },
		]);

		const result = await readCurrentSpecificationTool({
			taskId: "task-1",
			view: "verification",
			includeDesignContext: true,
		});
		expect(renderer.buildAssembledDesignContext).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({ id: "preferred" }),
			}),
		);
		expect(result.payload).toMatchObject({
			assembledDesignContext: { sourceMessageIds: ["message-1"] },
			verification: {
				verificationArtifactId: null,
				document: { version: 1 },
				summary: { total: 3, failedRequired: 1, unknownRequired: 1 },
			},
			sources: {
				assembledDesignContextIncluded: true,
				sourceMessageIds: ["message-1"],
			},
		});
	});

	it("selects fallback questionnaire sessions and tolerates absent tasks", async () => {
		repo.listTaskMessages.mockResolvedValue([planMessage()]);
		questionnaire.listDesignQuestionnaires.mockResolvedValue([
			{ id: "draft", status: "draft" },
			{ id: "accepted", status: "accepted" },
		]);
		await readCurrentSpecificationTool({
			taskId: "task-1",
			includeDesignContext: true,
		});
		expect(renderer.buildAssembledDesignContext).toHaveBeenLastCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({ id: "accepted" }),
			}),
		);

		questionnaire.listDesignQuestionnaires.mockResolvedValue([
			{ id: "only", status: "draft" },
		]);
		await readCurrentSpecificationTool({
			taskId: "task-1",
			includeDesignContext: true,
		});
		expect(renderer.buildAssembledDesignContext).toHaveBeenLastCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({ id: "only" }),
			}),
		);

		repo.getTask.mockResolvedValue(null);
		const result = await readCurrentSpecificationTool({
			taskId: "task-1",
			includeDesignContext: true,
		});
		expect(result.payload.assembledDesignContext).toBeUndefined();
	});

	it("keeps the specification when design context assembly fails", async () => {
		repo.listTaskMessages.mockResolvedValue([planMessage()]);
		workspace.getPlanModeWorkspaceReferenceContext.mockRejectedValue(
			new Error("workspace unavailable"),
		);
		const errorResult = await readCurrentSpecificationTool({
			taskId: "task-1",
			includeDesignContext: true,
		});
		expect(errorResult.payload.sources.assembledDesignContextWarning).toBe(
			"workspace unavailable",
		);

		workspace.getPlanModeWorkspaceReferenceContext.mockRejectedValue("offline");
		const stringResult = await readCurrentSpecificationTool({
			taskId: "task-1",
			includeDesignContext: true,
		});
		expect(stringResult.payload.sources.assembledDesignContextWarning).toBe(
			"offline",
		);
	});

	it("returns typed failures when repository reads fail", async () => {
		repo.listTaskMessages.mockRejectedValueOnce(new Error("database down"));
		const errorResult = await readCurrentSpecificationTool({
			taskId: "task-1",
		});
		expect(errorResult).toMatchObject({
			ok: false,
			error: { code: "READ_SPECIFICATION_FAILED", message: "database down" },
		});

		repo.listTaskMessages.mockRejectedValueOnce("offline");
		const stringResult = await readCurrentSpecificationTool({
			taskId: "task-1",
		});
		expect(stringResult.error?.message).toBe("offline");
	});
});

describe("recent specifications coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.rows = [];
		state.dbError = null;
		state.limit.mockImplementation(async () => {
			if (state.dbError) throw state.dbError;
			return state.rows;
		});
	});

	it("filters, normalizes, truncates, and limits recent plans", async () => {
		state.rows = [
			{
				messageId: "not-plan",
				taskId: "task-x",
				taskTitle: "Ignored",
				content: "ignored",
				metadataJson: null,
				createdAt: "2026-01-01",
				messageType: "note",
			},
			{
				messageId: "plan-1",
				taskId: "task-1",
				taskTitle: "First",
				content: "fallback",
				metadataJson: {
					intent: "feature_plan",
					markdownDocumentData: { title: "Plan One", content: "x".repeat(600) },
				},
				createdAt: "2026-02-01",
				messageType: "markdown_document",
			},
			{
				messageId: "plan-2",
				taskId: "task-2",
				taskTitle: "Second",
				content: "second content",
				metadataJson: { intent: "draft_spec", title: "Metadata title" },
				createdAt: "2026-03-01",
				messageType: "markdown_document",
			},
		];

		const result = await listRecentSpecificationsTool({ limit: 2.9 });
		expect(state.limit).toHaveBeenCalledWith(20);
		expect(result.payload.specifications).toHaveLength(2);
		expect(result.payload.specifications[0]).toMatchObject({
			title: "Plan One",
			contentPreview: "x".repeat(500),
		});
		expect(result.payload.specifications[1]).toMatchObject({
			title: "Metadata title",
			contentPreview: "second content",
		});

		await listRecentSpecificationsTool({ limit: 100 });
		expect(state.limit).toHaveBeenLastCalledWith(200);
		await listRecentSpecificationsTool({ limit: 0 });
		expect(state.limit).toHaveBeenLastCalledWith(20);
		await listRecentSpecificationsTool({ limit: Number.NaN });
		expect(state.limit).toHaveBeenLastCalledWith(40);
	});

	it("returns typed database failures for Error and non-Error values", async () => {
		state.dbError = new Error("query failed");
		const errorResult = await listRecentSpecificationsTool();
		expect(errorResult).toMatchObject({
			ok: false,
			payload: { specifications: [] },
			error: { code: "LIST_SPECIFICATIONS_FAILED", message: "query failed" },
		});

		state.dbError = "offline";
		const stringResult = await listRecentSpecificationsTool();
		expect(stringResult.error?.message).toBe("offline");
	});
});
