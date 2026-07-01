import { describe, expect, it } from 'vitest';
import { shouldOmitCodexOutputSchema } from '../../api/services/structured-llm/codex-output-schema';

describe('Codex structured LLM output schema routing', () => {
  it('omits Codex outputSchema for prompt-validated Blueprint artifacts', () => {
    expect(shouldOmitCodexOutputSchema('app_blueprint')).toBe(true);
    expect(shouldOmitCodexOutputSchema('app_blueprint_data_design')).toBe(true);
    expect(shouldOmitCodexOutputSchema('mock_blueprint')).toBe(true);
  });

  it('keeps Codex outputSchema for compact schema-first calls', () => {
    expect(shouldOmitCodexOutputSchema('design_questionnaire')).toBe(false);
    expect(shouldOmitCodexOutputSchema('supervisor')).toBe(false);
    expect(shouldOmitCodexOutputSchema(undefined)).toBe(false);
  });
});
