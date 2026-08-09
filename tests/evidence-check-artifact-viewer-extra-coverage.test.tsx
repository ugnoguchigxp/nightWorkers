import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	queryData: null as Record<string, unknown> | null,
	isLoading: false,
	isError: false,
	queryCalls: [] as Array<{ model: unknown; options: unknown }>,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));

vi.mock("lucide-react", () => ({
	AlertTriangle: () => <mock-alert />,
	CheckCircle2: () => <mock-check />,
	Circle: () => <mock-circle />,
}));

vi.mock("../shared/modules/codingAgent", () => ({
	legacyEvidenceAssuranceSnapshot: {
		policyVersion: "legacy-policy",
		status: "legacy-unavailable",
		verificationDocumentDigest: null,
		receiptDigest: null,
		conditions: [],
	},
}));

vi.mock("../src/modules/codingAgent/EvidenceCheckArtifactModel", () => ({
	useEvidenceCheckSnapshot: (model: unknown, options: unknown) => {
		controls.queryCalls.push({ model, options });
		return {
			data: controls.queryData,
			isLoading: controls.isLoading,
			isError: controls.isError,
		};
	},
}));

import { EvidenceCheckArtifactViewer } from "../src/modules/codingAgent/EvidenceCheckArtifactViewer";

const model = {
	taskId: "task-1",
	specArtifactId: "feature-plan-1",
	specMessageId: "message-1",
	verificationDocumentId: "document-1",
	verificationSidecarMessageId: "sidecar-1",
};

function snapshot(overrides: Record<string, unknown> = {}) {
	return {
		taskId: "task-1",
		verificationDocumentId: "document-1",
		evaluatedAt: "2026-08-01T00:00:00.000Z",
		sourceStateHash: "1234567890abcdef",
		scope: {
			testScope: "unit",
			e2eAllowed: false,
			authorizedVerifyCommand: null,
		},
		mapping: {
			status: "matched",
			matched: 0,
			total: 0,
			items: [],
		},
		verify: {
			status: "not_run",
			command: null,
			exitCode: null,
			finishedAt: null,
		},
		confirmation: null,
		assurance: null,
		ready: false,
		suggestedAction: "run_tests",
		...overrides,
	} as never;
}

beforeEach(() => {
	controls.queryData = null;
	controls.isLoading = false;
	controls.isError = false;
	controls.queryCalls = [];
});

describe("EvidenceCheckArtifactViewer extra coverage", () => {
	it("renders unavailable without a model and still configures the default fetch", () => {
		const markup = renderToStaticMarkup(
			<EvidenceCheckArtifactViewer model={null} />,
		);
		expect(markup).toContain("evidenceCheck.unavailable");
		expect(controls.queryCalls).toEqual([
			{ model: null, options: { enabled: true } },
		]);
	});

	it("renders loading and error states from query values and explicit overrides", () => {
		controls.isLoading = true;
		controls.isError = true;
		let markup = renderToStaticMarkup(
			<EvidenceCheckArtifactViewer model={model} fetchSnapshot={false} />,
		);
		expect(markup).toContain("evidenceCheck.loading");
		expect(markup).toContain("evidenceCheck.loadFailed");
		expect(markup).not.toContain("data-evidence-readiness");
		expect(controls.queryCalls.at(-1)).toEqual({
			model,
			options: { enabled: false },
		});

		markup = renderToStaticMarkup(
			<EvidenceCheckArtifactViewer
				model={model}
				isLoading={false}
				isError={false}
			/>,
		);
		expect(markup).not.toContain("evidenceCheck.loading");
		expect(markup).not.toContain("evidenceCheck.loadFailed");
	});

	it("renders all populated sections, merged assurance rows, and test result kinds", () => {
		const full = snapshot({
			evaluatedAt: "2026-08-01T00:00:00.000Z",
			sourceStateHash: "abcdefghijklmnop",
			scope: {
				testScope: "integration",
				e2eAllowed: true,
				authorizedVerifyCommand: { command: "authorized command" },
			},
			mapping: {
				status: "partial",
				matched: 1,
				total: 3,
				items: [
					{
						id: "AC-1",
						text: "mapped and assured",
						status: "matched",
						matches: [
							{
								caseKey: "executed",
								name: "executed test",
								filePath: "executed.test.ts",
								runner: "vitest",
							},
							{
								caseKey: "mapping-only",
								name: "mapping only test",
								filePath: "mapping.test.ts",
								runner: "manual",
							},
						],
					},
					{
						id: "AC-2",
						text: "mapping without assurance",
						status: "matched",
						matches: [],
					},
				],
			},
			assurance: {
				policyVersion: "strict-v1",
				status: "ambiguous",
				verificationDocumentDigest: "document-digest",
				receiptDigest: "receipt-digest",
				conditions: [
					{
						conditionId: "AC-1",
						text: "assured text",
						assuranceStatus: "safe_pass",
						reasonCode: "reason-code",
						tests: [
							{
								caseKey: "executed",
								name: "executed test",
								filePath: "executed.test.ts",
								runner: "vitest",
								execution: { status: "passed" },
							},
						],
					},
					{
						conditionId: "AC-3",
						text: "condition only",
						assuranceStatus: "failed",
						reasonCode: null,
						tests: [
							{
								caseKey: "failed-case",
								name: "failed test",
								filePath: null,
								runner: "vitest",
								execution: { status: "failed" },
							},
						],
					},
				],
			},
			verify: {
				status: "failed",
				command: "direct command",
				exitCode: 0,
				finishedAt: "invalid-finished-at",
			},
			confirmation: {
				status: "settled",
				confirmedAt: "2026-08-01T01:00:00.000Z",
			},
			ready: true,
			suggestedAction: "write_final_report",
		});
		const markup = renderToStaticMarkup(
			<EvidenceCheckArtifactViewer
				model={model}
				snapshot={full}
				isLoading
				isError
			/>,
		);

		expect(markup).toContain("data-evidence-readiness");
		expect(markup).not.toContain("evidenceCheck.loading");
		expect(markup).toContain("evidenceCheck.loadFailed");
		expect(markup).toContain('data-e2e-allowed="true"');
		expect(markup).toContain("abcdefghijkl");
		expect(markup).toContain('data-evidence-assurance="ambiguous"');
		expect(markup).toContain("reason-code");
		expect(markup).toContain("executed test");
		expect(markup).toContain("mapping only test");
		expect(markup).toContain("failed test");
		expect(markup).toContain("executed.test.ts");
		expect(markup).toContain("mapping.test.ts");
		expect(markup).toContain("evidenceCheck.unavailable");
		expect(markup).toContain('data-evidence-test-status="passed"');
		expect(markup).toContain('data-evidence-test-status="matched"');
		expect(markup).toContain('data-evidence-test-status="failed"');
		expect(markup).toContain("document-digest");
		expect(markup).toContain("receipt-digest");
		expect(markup).toContain('data-evidence-confirmation="settled"');
		expect(markup).toContain("direct command");
		expect(markup).not.toContain("authorized command");
		expect(markup).toContain("invalid-finished-at");
		expect(markup).toContain('data-evidence-next-action="write_final_report"');
		expect(markup).toContain("mock-check");
		expect(markup).toContain("mock-alert");
	});

	it("renders legacy, empty, unavailable, authorized-command, and awaiting fallbacks", () => {
		const fallback = snapshot({
			evaluatedAt: "invalid-evaluated-at",
			sourceStateHash: null,
			scope: {
				testScope: "unit",
				e2eAllowed: false,
				authorizedVerifyCommand: { command: "authorized command" },
			},
			verify: {
				status: "not_run",
				command: null,
				exitCode: null,
				finishedAt: null,
			},
			confirmation: null,
			assurance: null,
			ready: false,
		});
		const markup = renderToStaticMarkup(
			<EvidenceCheckArtifactViewer model={model} snapshot={fallback} />,
		);

		expect(markup).toContain("invalid-evaluated-at");
		expect(markup).toContain("evidenceCheck.unavailable");
		expect(markup).toContain('data-e2e-allowed="false"');
		expect(markup).toContain('data-evidence-assurance="legacy-unavailable"');
		expect(markup).toContain("legacy-policy");
		expect(markup).toContain("evidenceCheck.assurance.documentDigest: -");
		expect(markup).toContain("evidenceCheck.assurance.receiptDigest: -");
		expect(markup).toContain(
			'data-evidence-confirmation="awaiting_initial_verify"',
		);
		expect(markup).toContain("authorized command");
		expect(markup).toContain("mock-circle");
	});

	it("uses query data, snapshot precedence, ready confirmation, and no-command fallback", () => {
		controls.queryData = snapshot({
			ready: true,
			confirmation: null,
			scope: {
				testScope: "unit",
				e2eAllowed: false,
				authorizedVerifyCommand: null,
			},
		});
		let markup = renderToStaticMarkup(
			<EvidenceCheckArtifactViewer model={model} />,
		);
		expect(markup).toContain('data-evidence-confirmation="settled"');
		expect(markup).toContain("evidenceCheck.verify.notSelected");

		const explicit = snapshot({ suggestedAction: "explicit_action" });
		markup = renderToStaticMarkup(
			<EvidenceCheckArtifactViewer model={model} snapshot={explicit} />,
		);
		expect(markup).toContain('data-evidence-next-action="explicit_action"');
		expect(markup).not.toContain('data-evidence-next-action="run_tests"');
	});
});
