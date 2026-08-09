import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	queryOptions: [] as Array<Record<string, unknown>>,
	apiFetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: (options: Record<string, unknown>) => {
		controls.queryOptions.push(options);
		return { data: undefined, ...options };
	},
}));

vi.mock("../shared/json-record", () => ({
	toDeepRecord: (value: unknown) =>
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {},
}));

vi.mock("../shared/modules/codingAgent", () => ({
	legacyEvidenceAssuranceSnapshot: {
		policyVersion: "legacy",
		status: "unavailable",
		verificationDocumentDigest: null,
		receiptDigest: null,
		conditions: [],
	},
}));

vi.mock("../src/lib/api-base", () => ({
	apiFetch: controls.apiFetch,
}));

import {
	buildEvidenceCheckArtifact,
	buildEvidenceCheckArtifactFromDescriptor,
	buildEvidenceCheckExportCsv,
	buildEvidenceCheckExportMarkdown,
	buildEvidenceCheckPanelModel,
	findLatestEvidenceCheckSource,
	useEvidenceCheckSnapshot,
	useLatestEvidenceCheckDescriptor,
} from "../src/modules/codingAgent/EvidenceCheckArtifactModel";

function message(
	id: string,
	metadataJson: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		taskId: "task-1",
		runId: null,
		messageType: "markdown_document",
		content: `# ${id}`,
		metadataJson,
		createdAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	} as never;
}

function artifact(overrides: Record<string, unknown> = {}) {
	return {
		id: "evidence-check-document-1",
		taskId: "task-1",
		kind: "evidence_check",
		title: "Evidence Check",
		source: {
			type: "verification_document",
			verificationDocumentId: "document-1",
		},
		createdAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	} as never;
}

function snapshot(overrides: Record<string, unknown> = {}) {
	return {
		taskId: "task-1",
		verificationDocumentId: "document-1",
		scope: { testScope: "unit", e2eAllowed: false },
		mapping: { status: "matched", matched: 0, total: 0, items: [] },
		verify: { status: "not_run", command: null, exitCode: null },
		sourceStateHash: null,
		confirmation: { status: "pending", confirmedAt: null },
		suggestedAction: "run tests",
		evaluatedAt: "2026-08-01T00:01:00.000Z",
		...overrides,
	} as never;
}

function response(
	overrides: Record<string, unknown> = {},
	jsonValue: unknown = { ok: true },
) {
	return {
		status: 200,
		ok: true,
		json: vi.fn(async () => jsonValue),
		...overrides,
	};
}

beforeEach(() => {
	controls.queryOptions = [];
	vi.clearAllMocks();
});

describe("EvidenceCheckArtifactModel extra coverage", () => {
	it("finds the latest valid feature or implementation plan and skips invalid entries", () => {
		const messages = [
			undefined,
			message("wrong-type", {}, { messageType: "text" }),
			message("wrong-intent", { intent: "spec" }),
			message("missing-document", {
				intent: "feature_plan",
				verificationSidecarMessageId: "sidecar",
			}),
			message("missing-sidecar", {
				intent: "feature_plan",
				verificationDocumentId: "document",
			}),
			message("feature", {
				intent: "feature_plan",
				verificationDocumentId: "feature-document",
				verificationSidecarMessageId: "feature-sidecar",
			}),
			message("implementation", {
				intent: "implementation_plan",
				verificationDocumentId: "implementation-document",
				verificationSidecarMessageId: "implementation-sidecar",
			}),
		] as never;

		expect(findLatestEvidenceCheckSource(messages)).toEqual({
			specMessageId: "implementation",
			verificationDocumentId: "implementation-document",
			verificationSidecarMessageId: "implementation-sidecar",
			specArtifactId: "implementation-plan-implementation",
		});
		expect(findLatestEvidenceCheckSource(messages.slice(0, -1))).toMatchObject({
			specArtifactId: "feature-plan-feature",
		});
		expect(findLatestEvidenceCheckSource(messages.slice(0, 5))).toBeNull();
	});

	it("builds artifacts from messages and descriptors and returns null without a source", () => {
		expect(
			buildEvidenceCheckArtifact({
				taskId: "task-1",
				updatedAt: "updated",
				taskMessages: [],
				title: "Evidence",
				summary: "Summary",
			}),
		).toBeNull();
		const built = buildEvidenceCheckArtifact({
			taskId: "task-1",
			updatedAt: "updated",
			taskMessages: [
				message("feature", {
					intent: "feature_plan",
					verificationDocumentId: "document-2",
					verificationSidecarMessageId: "sidecar-2",
				}),
			],
			title: "Evidence",
			summary: "Summary",
		});
		expect(built).toMatchObject({
			id: "evidence-check-document-2",
			taskId: "task-1",
			kind: "evidence_check",
			createdAt: "updated",
			source: {
				type: "verification_document",
				verificationDocumentId: "document-2",
			},
		});

		expect(
			buildEvidenceCheckArtifactFromDescriptor({
				descriptor: {
					taskId: "task-descriptor",
					verificationDocumentId: "descriptor-document",
					generatedAt: "generated",
					specMessageId: null,
					specArtifactId: "spec-artifact",
				} as never,
				title: "Descriptor Evidence",
				summary: "Descriptor Summary",
			}),
		).toMatchObject({
			id: "evidence-check-descriptor-document",
			taskId: "task-descriptor",
			createdAt: "generated",
			metadata: {
				specMessageId: null,
				specArtifactId: "spec-artifact",
			},
		});
	});

	it("builds panel models from metadata, source, legacy messages, and invalid artifacts", () => {
		expect(
			buildEvidenceCheckPanelModel({ artifact: null, taskMessages: [] }),
		).toBeNull();
		expect(
			buildEvidenceCheckPanelModel({
				artifact: artifact({ kind: "spec" }),
				taskMessages: [],
			}),
		).toBeNull();

		expect(
			buildEvidenceCheckPanelModel({
				artifact: artifact({
					metadata: {
						verificationDocumentId: "metadata-document",
						specMessageId: "spec-message",
						verificationSidecarMessageId: "sidecar-message",
						specArtifactId: "spec-artifact",
					},
				}),
				taskMessages: [],
			}),
		).toEqual({
			taskId: "task-1",
			verificationDocumentId: "metadata-document",
			specMessageId: "spec-message",
			verificationSidecarMessageId: "sidecar-message",
			specArtifactId: "spec-artifact",
		});

		expect(
			buildEvidenceCheckPanelModel({
				artifact: artifact({ metadata: {} }),
				taskMessages: [],
			}),
		).toMatchObject({
			verificationDocumentId: "document-1",
			specMessageId: null,
		});

		const legacyMessage = message("legacy", {
			intent: "feature_plan",
			verificationDocumentId: "legacy-document",
			verificationSidecarMessageId: "legacy-sidecar",
		});
		expect(
			buildEvidenceCheckPanelModel({
				artifact: artifact({
					metadata: null,
					source: { type: "task_message", messageId: "legacy" },
				}),
				taskMessages: [legacyMessage],
			}),
		).toMatchObject({
			verificationDocumentId: "legacy-document",
			specMessageId: "legacy",
		});
		expect(
			buildEvidenceCheckPanelModel({
				artifact: artifact({
					metadata: null,
					source: { type: "task_message", messageId: "missing" },
				}),
				taskMessages: [],
			}),
		).toBeNull();
	});

	it("configures and executes every latest-descriptor query response", async () => {
		useLatestEvidenceCheckDescriptor(null);
		let options = controls.queryOptions.at(-1) as Record<string, unknown>;
		expect(options).toMatchObject({
			queryKey: ["evidenceCheck", "latest", null],
			enabled: false,
			refetchInterval: false,
			refetchOnMount: "always",
			refetchOnWindowFocus: true,
		});
		expect(await (options.queryFn as () => Promise<unknown>)()).toBeNull();

		controls.apiFetch.mockResolvedValueOnce(response({ status: 204 }));
		useLatestEvidenceCheckDescriptor("task / id", true);
		options = controls.queryOptions.at(-1) as Record<string, unknown>;
		expect(options).toMatchObject({ enabled: true, refetchInterval: 1_500 });
		expect(await (options.queryFn as () => Promise<unknown>)()).toBeNull();
		expect(controls.apiFetch).toHaveBeenCalledWith(
			"/api/coding-agent/tasks/task%20%2F%20id/evidence-check/latest",
		);

		controls.apiFetch.mockResolvedValueOnce(
			response({ ok: false, status: 500 }),
		);
		await expect(options.queryFn as () => Promise<unknown>).rejects.toThrow(
			"Failed to fetch the latest Evidence Check",
		);

		const descriptor = { verificationDocumentId: "document-ok" };
		controls.apiFetch.mockResolvedValueOnce(response({}, descriptor));
		expect(await (options.queryFn as () => Promise<unknown>)()).toBe(
			descriptor,
		);
	});

	it("configures and executes snapshot query disabled, error, and success states", async () => {
		useEvidenceCheckSnapshot(null);
		let options = controls.queryOptions.at(-1) as Record<string, unknown>;
		expect(options).toMatchObject({
			queryKey: ["evidenceCheck", undefined, undefined],
			enabled: false,
			refetchInterval: false,
		});
		expect(await (options.queryFn as () => Promise<unknown>)()).toBeNull();

		const model = {
			taskId: "task / id",
			verificationDocumentId: "document / id",
			specArtifactId: null,
			specMessageId: null,
			verificationSidecarMessageId: null,
		};
		useEvidenceCheckSnapshot(model, { enabled: false, refetchInterval: 2_000 });
		options = controls.queryOptions.at(-1) as Record<string, unknown>;
		expect(options).toMatchObject({ enabled: false, refetchInterval: 2_000 });

		controls.apiFetch.mockResolvedValueOnce(
			response({ ok: false, status: 404 }),
		);
		await expect(options.queryFn as () => Promise<unknown>).rejects.toThrow(
			"Failed to fetch evidence readiness",
		);
		expect(controls.apiFetch).toHaveBeenCalledWith(
			"/api/coding-agent/tasks/task%20%2F%20id/evidence-check/document%20%2F%20id",
		);

		const value = snapshot();
		controls.apiFetch.mockResolvedValueOnce(response({}, value));
		expect(await (options.queryFn as () => Promise<unknown>)()).toBe(value);

		useEvidenceCheckSnapshot(model, { enabled: true });
		options = controls.queryOptions.at(-1) as Record<string, unknown>;
		expect(options).toMatchObject({ enabled: true, refetchInterval: false });
	});

	it("exports complete and legacy Markdown with all optional fallbacks", () => {
		expect(
			buildEvidenceCheckExportMarkdown({
				title: "Unavailable",
				model: null,
			}),
		).toBe("# Unavailable\n\nEvidence readiness is unavailable.");

		const full = snapshot({
			scope: { testScope: "integration", e2eAllowed: true },
			mapping: {
				status: "partial",
				matched: 1,
				total: 2,
				items: [
					{
						id: "AC-1",
						text: "works",
						status: "matched",
						matches: [
							{ name: "named", runner: "vitest", filePath: "test.ts" },
							{ name: "unknown file", runner: "manual", filePath: null },
						],
					},
				],
			},
			verify: { status: "passed", command: "npm test", exitCode: 0 },
			sourceStateHash: "source-hash",
			assurance: {
				policyVersion: "strict",
				status: "failed",
				verificationDocumentDigest: "document-digest",
				receiptDigest: "receipt-digest",
				conditions: [
					{
						conditionId: "AC-1",
						text: "works",
						assuranceStatus: "unsafe",
						reasonCode: "missing_evidence",
					},
					{
						conditionId: "AC-2",
						text: "optional",
						assuranceStatus: "safe",
						reasonCode: null,
					},
				],
			},
			confirmation: { status: "settled", confirmedAt: "confirmed" },
		});
		const markdown = buildEvidenceCheckExportMarkdown({
			title: "Full",
			model: null,
			snapshot: full,
		});
		expect(markdown).toContain("E2E allowed: yes");
		expect(markdown).toContain("named; vitest; test.ts");
		expect(markdown).toContain("unknown file; manual; file unknown");
		expect(markdown).toContain("Exit code: 0");
		expect(markdown).toContain("unsafe; missing_evidence");
		expect(markdown).toContain("safe)");

		const legacy = buildEvidenceCheckExportMarkdown({
			title: "Legacy",
			model: null,
			snapshot: snapshot(),
		});
		expect(legacy).toContain("E2E allowed: no");
		expect(legacy).toContain("Command: not selected");
		expect(legacy).toContain("Exit code: not run");
		expect(legacy).toContain("Source state: unavailable");
		expect(legacy).toContain("Policy: legacy");
		expect(legacy).toContain("Verification Document digest: unavailable");
		expect(legacy).toContain("Receipt digest: not confirmed");
		expect(legacy).toContain("Confirmed at: not confirmed");
	});

	it("exports CSV rows for matches, missing matches, assurance, legacy, and injection-safe cells", () => {
		const full = snapshot({
			mapping: {
				status: "matched",
				matched: 2,
				total: 2,
				items: [
					{
						id: "=AC-1",
						text: ' +danger "quoted"',
						status: "matched",
						matches: [
							{ name: "@test", filePath: "-file.ts", runner: "vitest" },
							{ name: "plain", filePath: null, runner: null },
						],
					},
					{
						id: "AC-2",
						text: "\tformula",
						status: "missing",
						matches: [],
					},
				],
			},
			verify: { status: "passed", command: "npm test", exitCode: 0 },
			confirmation: { status: "settled", confirmedAt: "confirmed" },
			sourceStateHash: "hash",
			assurance: {
				policyVersion: "strict",
				status: "passed",
				verificationDocumentDigest: "digest",
				receiptDigest: "receipt",
				conditions: [
					{
						conditionId: "=AC-1",
						assuranceStatus: "safe_pass",
						reasonCode: "ok",
					},
				],
			},
		});
		const csv = buildEvidenceCheckExportCsv(full);
		expect(csv.startsWith("\uFEFF")).toBe(true);
		expect(csv).toContain('"\'=AC-1"');
		expect(csv).toContain('"\' +danger ""quoted"""');
		expect(csv).toContain('"\'@test"');
		expect(csv).toContain('"\'-file.ts"');
		expect(csv).toContain('"\'\tformula"');
		expect(csv).toContain('"safe_pass","ok"');
		expect(csv).toContain('"passed","npm test","0"');

		const legacyCsv = buildEvidenceCheckExportCsv(
			snapshot({
				mapping: {
					status: "unmatched",
					matched: 0,
					total: 1,
					items: [
						{ id: "AC-legacy", text: "plain", status: "missing", matches: [] },
					],
				},
			}),
		);
		expect(legacyCsv).toContain('"legacy","unavailable","",""');
		expect(legacyCsv).toContain('"not_run","",""');
	});
});
