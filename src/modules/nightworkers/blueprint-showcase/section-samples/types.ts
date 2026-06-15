import type { BlueprintComponentName } from '../../../../../shared/schemas/blueprint-catalog.schema';

export type SectionSampleContext = {
  base: Record<string, unknown>;
  sampleImage: string;
  sampleCards: () => Array<Record<string, unknown>>;
  sampleColumns: () => Array<{ key: string; label: string }>;
  sampleRows: () => Array<Record<string, unknown>>;
};

export type SectionSampleDefinition = {
  name: BlueprintComponentName;
  props: (context: SectionSampleContext) => Record<string, unknown>;
};
