import type { DesignPreset } from '../../../shared/schemas/design-governance.schema';

export const defaultDesignPreset: DesignPreset = {
  id: 'nightworkers-default',
  name: 'NightWorkers Default',
  mode: 'hybrid',
  theme: 'nightworkers-dark',
  density: 'compact',
  radius: 'default',
  shadow: 'subtle',
  fontScale: 'default',
  contrast: 'standard',
  motion: 'standard',
};

const knownThemes = new Set(['nightworkers-dark', 'nightworkers-light']);

export type DesignGovernanceIssue = {
  path: string;
  code: 'unknown_theme';
  message: string;
};

export function validateDesignPreset(preset: DesignPreset): DesignGovernanceIssue[] {
  if (knownThemes.has(preset.theme)) return [];
  return [
    {
      path: 'designPreset.theme',
      code: 'unknown_theme',
      message: `Unknown design theme "${preset.theme}".`,
    },
  ];
}
