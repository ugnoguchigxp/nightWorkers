import { describe, expect, it } from "vitest";
import { buildSpecificationVerificationSidecar } from "../api/modules/specification/specification-verification-sidecar";
import type { PlanModeWorkspace } from "../shared/schemas/plan-mode-artifact.schema";

const dummyWorkspace: PlanModeWorkspace = {
	taskId: "task-1",
	repositoryId: "repo-1",
	generatedAt: "2026-07-08T00:00:00Z",
	featurePlanArtifacts: [
		{
			id: "fp-1",
			kind: "feature_plan",
			title: "Feature Plan",
			sourceMessageId: "msg-1",
			createdAt: "2026-07-08T00:00:00Z",
		},
	],
	blueprintArtifacts: [],
	dataModelArtifacts: [],
	dedicatedViewArtifacts: [],
	questionnaireSessions: [],
	decisionReviews: [],
	implementationReferences: [],
};

describe("Specification Verification Sidecar", () => {
	it("annotates completion conditions (AC-xxx) automatically", () => {
		const content = [
			"# Specification Document",
			"",
			"## 完了条件",
			"- APIエンドポイントが正常に動作すること。 (test command: `bun run test`)",
			"- 手動で表示を確認する。",
			"- [AC-005] 既存のIDはそのまま残すこと。",
		].join("\n");

		const result = buildSpecificationVerificationSidecar({
			taskId: "task-1",
			specId: "spec-1",
			specPath: "spec.md",
			content,
			sourceMessageIds: ["msg-1"],
			workspace: dummyWorkspace,
		});

		expect(result.document.conditions).toHaveLength(3);
		expect(result.document.conditions[0].id).toBe("AC-001");
		expect(result.document.conditions[0].text).toContain(
			"APIエンドポイントが正常に動作すること。",
		);
		expect(result.document.conditions[0].verificationKind).toBe("command_gate");

		expect(result.document.conditions[1].id).toBe("AC-002");
		expect(result.document.conditions[1].verificationKind).toBe("manual");

		expect(result.document.conditions[2].id).toBe("AC-005");
	});

	it("extracts verification commands correctly", () => {
		const content = [
			"# Specification Document",
			"",
			"## 完了条件",
			"- APIが動くこと。",
			"",
			"## 検証",
			"以下を実行すること：",
			"- `bun test` を実行する",
			"- `npm run test:api` を実行する",
		].join("\n");

		const result = buildSpecificationVerificationSidecar({
			taskId: "task-1",
			specId: "spec-1",
			specPath: "spec.md",
			content,
			sourceMessageIds: ["msg-1"],
			workspace: dummyWorkspace,
		});

		expect(result.document.commands).toHaveLength(2);
		expect(result.document.commands[0].command).toBe("bun test");
		expect(result.document.commands[1].command).toBe("npm run test:api");
	});

	it("keeps generated acceptance criteria as structured unit-test evidence", () => {
		const result = buildSpecificationVerificationSidecar({
			taskId: "task-1",
			specId: "spec-1",
			specPath: "spec.md",
			content: ["## 完了条件", "- [AC-001] 空白だけのtitleを拒否する"].join(
				"\n",
			),
			sourceMessageIds: ["msg-1"],
			workspace: dummyWorkspace,
			acceptanceCriteria: [
				{
					title: "空白だけのtitleを拒否する",
					category: "validation",
					testCase: {
						target: "CreateTodoInput schema",
						preconditions: ["titleに全角空白2文字を指定する"],
						action: "safeParseを実行する",
						assertions: [
							"successがfalseになる",
							"repository.createが呼ばれない",
						],
					},
				},
			],
		});

		expect(result.document.conditions).toEqual([
			expect.objectContaining({
				id: "AC-001",
				category: "validation",
				verificationKind: "automated_test",
				expectedEvidence: ["unit_test"],
				expectedResult: "successがfalseになる / repository.createが呼ばれない",
				testCase: {
					target: "CreateTodoInput schema",
					preconditions: ["titleに全角空白2文字を指定する"],
					action: "safeParseを実行する",
					assertions: ["successがfalseになる", "repository.createが呼ばれない"],
				},
			}),
		]);
	});
});
