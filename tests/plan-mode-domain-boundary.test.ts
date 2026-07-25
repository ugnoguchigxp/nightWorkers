import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	dedicatedDesignViewSchema,
	planModeArtifactKindSchema,
} from "../shared/schemas/plan-mode-artifact.schema";

const root = resolve(__dirname, "..");

function readProjectFile(path: string) {
	return readFileSync(resolve(root, path), "utf8");
}

describe("Plan Mode domain boundaries", () => {
	it("keeps every Plan View representable as a workspace artifact kind", () => {
		for (const view of dedicatedDesignViewSchema.options) {
			expect(planModeArtifactKindSchema.safeParse(view).success, view).toBe(
				true,
			);
		}
	});

	it("keeps moved Questionnaire and Blueprint modules off NightWorkers aggregate internals", () => {
		const movedDomainFiles = [
			"api/modules/questionnaire/questionnaire.service.ts",
			"api/modules/questionnaire/questionnaire-parser.service.ts",
			"api/modules/questionnaire/questionnaire-validation.ts",
			"api/modules/questionnaire/questionnaire.repository.ts",
			"api/modules/blueprint/blueprint-adoption.service.ts",
			"api/modules/blueprint/blueprint-design-settings.service.ts",
			"api/modules/blueprint/blueprint-generation.service.ts",
			"api/modules/blueprint/blueprint.repository.ts",
			"api/modules/dataModel/dataModel-generation.service.ts",
			"api/modules/specification/specification-generation.service.ts",
			"api/modules/specification/plan-mode-workspace.service.ts",
			"api/modules/specification/specification-document-renderer.ts",
		];

		for (const path of movedDomainFiles) {
			const source = readProjectFile(path);
			expect(source, path).not.toContain("nightworkers.repository");
			expect(source, path).not.toContain("nightworkers.service");
			expect(source, path).not.toContain(
				"nightworkers.design-questionnaire.service",
			);
			expect(source, path).not.toContain("nightworkers.blueprint-adoption");
		}
	});

	it("keeps NightWorkers compatibility files as re-export shims for moved Plan Mode UI", () => {
		const compatibilityExports = {
			"src/modules/nightworkers/components/ArtifactQuestionnaire.tsx":
				'export * from "../../planMode/PlanModeQuestionnaire";',
			"src/modules/nightworkers/components/ArtifactWorkspacePanels.tsx":
				'export * from "../../planMode/PlanModeWorkspacePanels";',
			"src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx":
				'export * from "../../planMode/PlanModeWorkspaceViewer";',
		};

		for (const [path, expectedSource] of Object.entries(compatibilityExports)) {
			expect(readProjectFile(path).trim(), path).toBe(expectedSource);
		}
	});

	it("does not keep Questionnaire lifecycle implementation in the legacy NightWorkers service", () => {
		const source = readProjectFile(
			"api/modules/nightworkers/nightworkers.design-questionnaire.service.ts",
		);

		expect(source).not.toContain(
			"export async function createDesignQuestionnaire",
		);
		expect(source).not.toContain(
			"export async function saveDesignQuestionnaireAnswers",
		);
		expect(source).not.toContain(
			"export async function generateDesignQuestionnaireFollowUp",
		);
		expect(source).not.toContain(
			"export async function generateDesignQuestionnaireReview",
		);
		expect(source).not.toContain(
			"export async function acceptDesignQuestionnaireReview",
		);
		expect(source).not.toContain(
			"export async function leaveDesignQuestionnaireReviewUnadopted",
		);
		expect(source).not.toContain(
			"export async function generateSpecificationStatusBlueprint",
		);
		expect(source).not.toContain(
			"export async function generateSpecificationStatusDataModel",
		);
		expect(source).not.toContain(
			"export async function generateSpecificationStatusDesignDocument",
		);
		expect(source).not.toContain(
			"export async function getBlueprintPlanModeWorkspace",
		);
		expect(source).not.toContain("export async function getPlanModeWorkspace");
	});

	it("keeps Plan Mode API ownership out of the NightWorkers aggregate router", () => {
		const nightworkersRouteFiles = [
			"api/modules/nightworkers/routes/task-routes.ts",
			"api/modules/nightworkers/nightworkers.routes.ts",
			"api/modules/nightworkers/nightworkers.route-handlers.ts",
		];
		const planModeRouteMarkers = [
			"blueprint-design-settings",
			"blueprint-adoption",
			"data-model-adoption",
			"blueprint-design-token-adoption",
			"design-questionnaire",
			"plan-mode/workspace",
			"plan-mode/blueprint",
			"plan-mode/data-model",
			"plan-mode/feature-plan",
			"getBlueprintPlanModeWorkspaceHandler",
			"generateSpecificationStatusBlueprintHandler",
			"generateSpecificationStatusDataModelHandler",
			"generateSpecificationStatusDesignDocumentHandler",
		];

		for (const path of nightworkersRouteFiles) {
			const source = readProjectFile(path);
			for (const marker of planModeRouteMarkers) {
				expect(source, `${path} should not contain ${marker}`).not.toContain(
					marker,
				);
			}
		}
	});

	it("keeps frontend Questionnaire and Specification domain logic out of the PlanMode shell", () => {
		expect(
			readProjectFile("src/modules/questionnaire/questionnaireModel.ts"),
		).toContain("export function buildSubmittableQuestionnaireAnswers");
		expect(
			readProjectFile("src/modules/specification/planModeWorkspaceModel.ts"),
		).toContain("export function selectPlanModeWorkspaceMessages");

		const questionnaireShell = readProjectFile(
			"src/modules/planMode/PlanModeQuestionnaire.tsx",
		);
		expect(questionnaireShell).not.toContain(
			"function evaluateQuestionDependency",
		);
		expect(questionnaireShell).not.toContain(
			"export function buildSubmittableQuestionnaireAnswers",
		);

		const workspaceShell = readProjectFile(
			"src/modules/planMode/PlanModeWorkspaceViewer.tsx",
		);
		expect(workspaceShell).toContain("selectPlanModeWorkspaceMessages");
		expect(workspaceShell).not.toContain("mergeWorkspaceTaskMessages");
		expect(workspaceShell).not.toContain("isReviewedSpecificationMessage");
	});

	it("allows Plan Mode Questionnaire creation without a Blueprint source", () => {
		const questionnaireActions = readProjectFile(
			"src/modules/planMode/usePlanModeQuestionnaireActions.ts",
		);
		const questionnairePanel = readProjectFile(
			"src/modules/planMode/PlanModeQuestionnairePanel.tsx",
		);
		const questionnaireCommands = readProjectFile(
			"src/modules/questionnaire/questionnaireCommands.ts",
		);

		expect(questionnaireActions).not.toContain(
			"if (!sessionId || !activeBlueprintMessage) return;",
		);
		expect(questionnaireActions).toContain(
			"sourceBlueprintMessageId: activeBlueprintMessage?.id ?? null",
		);
		expect(questionnairePanel).toMatch(
			/activeBlueprintMessage\s*\?\s*['"]この画面案から質問を作成['"]\s*:\s*['"]質問を作成['"]/,
		);
		expect(questionnaireCommands).toContain(
			"sourceBlueprintMessageId?: string | null",
		);
	});

	it("exposes the Plan Mode core bridge as an explicit NightWorkers port", () => {
		expect(
			existsSync(resolve(root, "api/modules/planMode/plan-mode-core.port.ts")),
		).toBe(false);
		expect(
			readProjectFile(
				"api/modules/nightworkers/nightworkers.plan-mode-core.port.ts",
			),
		).toMatch(/import \* as repo from ['"]\.\/nightworkers\.repository['"];/);
	});

	it("does not introduce user wording classifier helpers or split Plan mode generations", () => {
		const supervisorFlowFiles = [
			"api/services/supervisor/prompt.ts",
			"api/services/supervisor/schema-first.ts",
		];

		for (const path of supervisorFlowFiles) {
			const source = readProjectFile(path);
			expect(source, path).not.toMatch(/classif(?:y|ier).*user.*wording/i);
			expect(source, path).not.toMatch(/user.*wording.*regex/i);
			expect(source, path).not.toMatch(/\b(?:new|legacy)[ -]?plan\b/i);
			expect(source, path).not.toMatch(/\bplan(?:Mode)?V[12]\b/);
			expect(source, path).not.toMatch(/\bV[12]Plan\b/);
		}
	});
});
