import { describe, expect, it } from 'vitest';
import { createBlueprintPreviewDesignSettings } from '../src/modules/blueprint-preview/designSettings';
import { createWorkspaceAppearanceAttributes } from '../src/modules/nightworkers/contexts/WorkspaceAppearanceContext';

describe('Workspace appearance settings', () => {
  it('maps Blueprint Preview design tokens to NightWorkers shell data attributes', () => {
    const settings = createBlueprintPreviewDesignSettings({
      theme: 'mint',
      density: 'comfortable',
      shape: 'pill',
      shadow: 'strong',
      shadowDirection: '315deg',
      font: 'mono',
      contrast: 'high',
      motion: 'reduced',
      componentVariants: {
        button: 'soft',
        card: 'elevated',
        table: 'dense-grid',
        input: 'filled',
      },
    });

    expect(createWorkspaceAppearanceAttributes(settings)).toEqual({
      'data-theme': 'mint',
      'data-density': 'comfortable',
      'data-shape': 'pill',
      'data-shadow': 'strong',
      'data-shadow-direction': '315deg',
      'data-font': 'mono',
      'data-contrast': 'high',
      'data-motion': 'reduced',
      'data-button-variant': 'soft',
      'data-card-variant': 'elevated',
      'data-table-variant': 'dense-grid',
      'data-input-variant': 'filled',
    });
  });
});
