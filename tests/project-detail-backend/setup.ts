import { afterEach, beforeAll, vi } from "vitest";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";

const structuredLlmFixture = vi.hoisted(() => ({
	nextOutput: null as string | null,
}));

vi.mock("../../api/services/structured-llm", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../api/services/structured-llm")>();
	return {
		...actual,
		callStructuredJsonLLM: vi.fn(
			async (_systemPrompt, _userPrompt, options) => {
				await options.emitEvent?.({
					type: "model.request_started",
					severity: "info",
					message: "fixture request started",
					data: {
						provider: "fixture",
						providerEndpointId: "fixture-mission",
						routeSource: "primary",
						model: "fixture-mission-model",
					},
				});
				if (structuredLlmFixture.nextOutput)
					return structuredLlmFixture.nextOutput;
				return JSON.stringify({
					schemaVersion: "nightworkers.mission-task-candidates/v1",
					candidates: [
						{
							title: "package.json に coverage と E2E scripts を追加する",
							summary:
								"Quality capability 欠落を解消するため test:coverage と test:e2e を整備する。",
							rationale:
								"Quality 実行 API は存在しない script を推測実行しないため。",
							goalId: null,
							candidateKind: "constraint_enablement",
							moduleRouting: {
								primaryModule: "quality",
								secondaryModules: [],
								confidencePercent: 80,
								reason: "Quality capability scripts が不足している。",
							},
							constraintGoalIds: [],
							planModeOpenQuestions: [],
							evidence: [
								{
									source: "quality",
									label: "missing capability",
									value: "coverage / e2e scripts are missing in package.json",
								},
							],
							evaluationContribution: 12,
							importancePercent: 96,
							confidencePercent: 86,
							tokenSize: "small",
							complexity: "simple",
							taskPrompt:
								"package.json に test:coverage と test:e2e scripts を追加してください。",
							acceptanceCriteria:
								"Quality capability が runnable として検出される。",
							verificationPlan:
								"GET /quality で missingCapabilities が解消されることを確認する。",
						},
					],
				});
			},
		),
	};
});

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

afterEach(() => {
	structuredLlmFixture.nextOutput = null;
});

export function setStructuredLlmFixtureOutput(output: string) {
	structuredLlmFixture.nextOutput = output;
}
