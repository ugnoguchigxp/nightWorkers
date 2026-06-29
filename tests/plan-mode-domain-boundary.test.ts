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
      'api/modules/blueprint/blueprint.repository.ts',
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
  });

  it('exposes the Plan Mode core bridge as an explicit NightWorkers port', () => {
    expect(existsSync(resolve(root, 'api/modules/planMode/plan-mode-core.port.ts'))).toBe(false);
    expect(
      readProjectFile('api/modules/nightworkers/nightworkers.plan-mode-core.port.ts')
    ).toContain("import * as repo from './nightworkers.repository';");
  });
});
