import { createFileRoute } from '@tanstack/react-router';
import {
  BlueprintSectionSampleShowcase,
  BlueprintSectionSampleShowcaseError,
} from '../modules/blueprint-section-sample';

export const Route = createFileRoute('/blueprint-showcase')({
  component: BlueprintSectionSampleShowcase,
  errorComponent: BlueprintSectionSampleShowcaseError,
});
