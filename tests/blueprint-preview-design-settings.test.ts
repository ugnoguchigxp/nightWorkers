import { describe, expect, it } from 'vitest';
import {
  createBlueprintDesignReference,
  createBlueprintPreviewDesignSettings,
  designReferenceSummary,
} from '../src/modules/nightworkers/components/blueprint-preview/designSettings';

describe('Blueprint Preview design settings', () => {
  it('defaults generated dark NightWorkers presets to a light preview', () => {
    const settings = createBlueprintPreviewDesignSettings({
      theme: 'nightworkers-dark',
      density: 'compact',
      radius: 'rounded',
      shadow: 'medium',
      fontScale: 'default',
      contrast: 'high',
      motion: 'reduced',
    });

    expect(settings).toMatchObject({
      theme: 'light',
      density: 'compact',
      shape: 'rounded',
      shadow: 'medium',
      font: 'geist',
      contrast: 'high',
      motion: 'reduced',
    });
  });

  it('falls back to governed options for unknown preset values', () => {
    const settings = createBlueprintPreviewDesignSettings({
      theme: 'unknown-brand',
      density: 'loose',
      radius: 'blob',
      shadow: 'glow',
      fontScale: 'huge',
      contrast: 'extreme',
      motion: 'busy',
    });

    expect(settings).toMatchObject({
      theme: 'light',
      density: 'compact',
      shape: 'default',
      shadow: 'subtle',
      font: 'geist',
      contrast: 'standard',
      motion: 'standard',
    });
  });

  it('returns independent default settings for missing presets', () => {
    const first = createBlueprintPreviewDesignSettings(undefined);
    const second = createBlueprintPreviewDesignSettings(undefined);

    first.componentVariants.button = 'outline';

    expect(second.componentVariants.button).toBe('solid');
  });

  it('accepts shape and component variants from existing design references', () => {
    const settings = createBlueprintPreviewDesignSettings({
      theme: 'dark',
      density: 'default',
      shape: 'pill',
      shadow: 'none',
      fontScale: 'mono',
      contrast: 'standard',
      motion: 'standard',
      componentVariants: {
        button: 'outline',
        card: 'plain',
        table: 'dense-grid',
        input: 'underline',
      },
    });

    expect(settings).toMatchObject({
      theme: 'dark',
      density: 'default',
      shape: 'pill',
      shadow: 'none',
      font: 'mono',
      componentVariants: {
        button: 'outline',
        card: 'plain',
        table: 'dense-grid',
        input: 'underline',
      },
    });
  });

  it('creates an implementation-plan design reference from selected settings', () => {
    const settings = createBlueprintPreviewDesignSettings({
      theme: 'nightworkers-light',
      density: 'comfortable',
      radius: 'pill',
      shadow: 'strong',
      fontScale: 'large',
      contrast: 'standard',
      motion: 'standard',
    });
    const reference = createBlueprintDesignReference({
      blueprintId: 'customer-portal',
      capturedAt: '2026-06-03T11:35:00.000Z',
      settings: {
        ...settings,
        componentVariants: {
          button: 'soft',
          card: 'elevated',
          table: 'dense-grid',
          input: 'filled',
        },
      },
    });

    expect(reference).toMatchObject({
      source: 'blueprint-preview',
      blueprintId: 'customer-portal',
      tokenMapping: {
        theme: 'light',
        density: 'comfortable',
        radius: 'pill',
        shadow: 'strong',
        font: 'geist',
        contrast: 'standard',
        motion: 'standard',
      },
    });
    expect(reference.notes.join(' ')).toContain('specification-review mock');
    expect(designReferenceSummary(reference.settings)).toContain(
      'Component variants: button=soft, card=elevated, table=dense-grid, input=filled'
    );
  });
});
