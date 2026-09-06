import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
	return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function productionFiles(directory: string): string[] {
	return fs
		.readdirSync(path.join(root, directory), { withFileTypes: true })
		.flatMap((entry) => {
			const relativePath = path.join(directory, entry.name);
			if (entry.isDirectory()) return productionFiles(relativePath);
			return /\.(ts|tsx)$/.test(entry.name) ? [relativePath] : [];
		});
}

describe("LLM semantic freedom architecture boundary", () => {
	it("keeps provider schema selection independent of product artifact names", () => {
		const providerSource = [
			read("api/services/structured-llm/codex-output-schema.ts"),
			read("api/services/structured-llm/codex-provider.ts"),
			read("api/services/structured-llm/request.ts"),
		].join("\n");

		expect(providerSource).not.toMatch(
			/CODEX_PROMPT_VALIDATED_SCHEMA_NAMES|mock_blueprint|app_blueprint|feature_plan|design_questionnaire|design_decision_review/,
		);
	});

	it("keeps legacy string-only structured calls out of product services", () => {
		const callsites = productionFiles("api")
			.filter((filePath) => filePath !== "api/services/structured-llm/index.ts")
			.filter((filePath) => read(filePath).includes("callStructuredJsonLLM("));

		expect(callsites).toEqual([]);
		expect(read("api/services/structured-llm/types.ts")).not.toContain(
			"allowRawOutputOnJsonParseFailure",
		);
	});

	it("does not restore removed semantic mutation helpers", () => {
		const sources = [
			read(
				"api/modules/taskOperator/policies/task-operator-action.registry.ts",
			),
			read("api/modules/questionnaire/questionnaire-parser.service.ts"),
			read("api/modules/taskGeneration/task-candidate-semantics.ts"),
			read("api/modules/blueprint/mock-blueprint-generation.service.ts"),
		].join("\n");

		expect(sources).not.toMatch(
			/normalizeMissionPilotPlanReview|reconcileArtifactSourceMessageId|normalizeLegacyDesignQuestionnaireOutput|applyMissionTaskCandidateSemantics|normalizeBlueprintCandidate|normalizeRegularBlueprintBindings/,
		);
	});

	it("passes questionnaire context facts to the LLM without keyword classification", () => {
		const source = read("api/modules/questionnaire/questionnaire-context.ts");

		expect(source).toContain("contentExcerpt=");
		expect(source).not.toMatch(/detectAuthBoundarySignals|\.test\(joined\)/);
	});

	it("keeps the common repair instruction in Japanese and domain neutral", () => {
		const promptSource = read(
			"api/systemContexts/contexts/structuredGeneration/repair.context.toml",
		);

		expect(promptSource).toContain(
			"元の回答の意味、判断、主張、自由記述を維持",
		);
		expect(promptSource).not.toMatch(/Todo|CRM|BBS|thread|mock_blueprint/);
	});
});
