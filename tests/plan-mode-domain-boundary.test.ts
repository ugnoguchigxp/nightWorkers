import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

function readProjectFile(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('Plan Mode domain boundaries', () => {
  it('keeps moved Questionnaire and Blueprint modules off NightWorkers aggregate internals', () => {
    const movedDomainFiles = [
      'api/modules/questionnaire/questionnaire.service.ts',
      'api/modules/questionnaire/questionnaire-parser.service.ts',
      'api/modules/questionnaire/questionnaire-validation.ts',
      'api/modules/questionnaire/questionnaire.repository.ts',
      'api/modules/blueprint/blueprint-adoption.service.ts',
      'api/modules/blueprint/blueprint-design-settings.service.ts',
      'api/modules/blueprint/blueprint-generation.service.ts',
      'api/modules/blueprint/blueprint.repository.ts',
      'api/modules/dbDesign/dbDesign-generation.service.ts',
      'api/modules/specification/specification-generation.service.ts',
      'api/modules/specification/specification-workspace.service.ts',
      'api/modules/specification/specification-document-renderer.ts',
    ];

    for (const path of movedDomainFiles) {
      const source = readProjectFile(path);
      expect(source, path).not.toContain('nightworkers.repository');
      expect(source, path).not.toContain('nightworkers.service');
      expect(source, path).not.toContain('nightworkers.design-questionnaire.service');
      expect(source, path).not.toContain('nightworkers.blueprint-adoption');
    }
  });

  it('keeps NightWorkers compatibility files as re-export shims for moved Plan Mode UI', () => {
    const compatibilityExports = {
      'src/modules/nightworkers/components/ArtifactQuestionnaire.tsx':
        "export * from '../../planMode/PlanModeQuestionnaire';",
      'src/modules/nightworkers/components/ArtifactWorkspacePanels.tsx':
        "export * from '../../planMode/PlanModeWorkspacePanels';",
      'src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx':
        "export * from '../../planMode/PlanModeWorkspaceViewer';",
    };

    for (const [path, expectedSource] of Object.entries(compatibilityExports)) {
      expect(readProjectFile(path).trim(), path).toBe(expectedSource);
    }
  });

  it('does not keep Questionnaire lifecycle implementation in the legacy NightWorkers service', () => {
    const source = readProjectFile(
      'api/modules/nightworkers/nightworkers.design-questionnaire.service.ts'
    );

    expect(source).not.toContain('export async function createDesignQuestionnaire');
    expect(source).not.toContain('export async function saveDesignQuestionnaireAnswers');
    expect(source).not.toContain('export async function generateDesignQuestionnaireFollowUp');
    expect(source).not.toContain('export async function generateDesignQuestionnaireReview');
    expect(source).not.toContain('export async function acceptDesignQuestionnaireReview');
    expect(source).not.toContain('export async function leaveDesignQuestionnaireReviewUnadopted');
    expect(source).not.toContain('export async function generateSpecificationStatusBlueprint');
    expect(source).not.toContain('export async function generateSpecificationStatusDbDesign');
    expect(source).not.toContain('export async function generateSpecificationStatusDesignDocument');
    expect(source).not.toContain('export async function getBlueprintSpecificationWorkspace');
    expect(source).not.toContain('export async function getSpecificationWorkspace');
  });

  it('keeps Plan Mode API ownership out of the NightWorkers aggregate router', () => {
    const nightworkersRouteFiles = [
      'api/modules/nightworkers/routes/task-routes.ts',
      'api/modules/nightworkers/nightworkers.routes.ts',
      'api/modules/nightworkers/nightworkers.route-handlers.ts',
    ];
    const planModeRouteMarkers = [
      'blueprint-design-settings',
      'blueprint-adoption',
      'blueprint-db-design-adoption',
      'blueprint-design-token-adoption',
      'design-questionnaire',
      'blueprint-specification-workspace',
      'specification-workspace/blueprint',
      'specification-workspace/db-design',
      'specification-workspace/design-doc',
      'getBlueprintSpecificationWorkspaceHandler',
      'generateSpecificationStatusBlueprintHandler',
      'generateSpecificationStatusDbDesignHandler',
      'generateSpecificationStatusDesignDocumentHandler',
    ];

    for (const path of nightworkersRouteFiles) {
      const source = readProjectFile(path);
      for (const marker of planModeRouteMarkers) {
        expect(source, `${path} should not contain ${marker}`).not.toContain(marker);
      }
    }
  });

  it('exposes the Plan Mode core bridge as an explicit NightWorkers port', () => {
    expect(existsSync(resolve(root, 'api/modules/planMode/plan-mode-core.port.ts'))).toBe(false);
    expect(
      readProjectFile('api/modules/nightworkers/nightworkers.plan-mode-core.port.ts')
    ).toContain("import * as repo from './nightworkers.repository';");
  });
});
