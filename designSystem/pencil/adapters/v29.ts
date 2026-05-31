import type { NormalizedVariables, PenFileAdapter, ThemeAxesValues } from './types.js';

export class V29Adapter implements PenFileAdapter {
  readonly supportedVersion = '2.9';

  updateVariablesAndThemes(raw: any, variables: NormalizedVariables, themes: ThemeAxesValues): any {
    // 2.9 schema specific structure
    const updatedVariables: any = {};
    for (const [name, variable] of Object.entries(variables)) {
      const varKey = name.startsWith('--') ? name : `--${name}`;
      updatedVariables[varKey] = {
        type: variable.type,
        value: Array.isArray(variable.value) ? variable.value : variable.value,
      };
    }

    return {
      ...raw,
      variables: updatedVariables,
      themes: themes,
    };
  }
}
