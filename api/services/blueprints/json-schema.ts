import { z } from 'zod';
import { appBlueprintSchema } from '../../../shared/schemas/app-blueprint.schema';

export function renderAppBlueprintJsonSchema(): string {
  return JSON.stringify(z.toJSONSchema(appBlueprintSchema), null, 2);
}

export function buildAppBlueprintStructuredOutputJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'name',
      'version',
      'designPreset',
      'screens',
      'databaseSchema',
      'dataBindings',
      'implementationTasks',
      'learningHooks',
    ],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      version: { type: 'integer' },
      description: { type: 'string' },
      designPreset: { type: 'object' },
      screens: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'name', 'path', 'componentName', 'sections'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            path: { type: 'string' },
            componentName: { type: 'string' },
            sections: {
              type: 'array',
              minItems: 1,
              items: { type: 'object' },
            },
            actions: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
      },
      databaseSchema: { type: 'object' },
      dataBindings: {
        type: 'array',
        items: { type: 'object' },
      },
      implementationTasks: {
        type: 'array',
        items: { type: 'object' },
      },
      learningHooks: {
        type: 'array',
        items: { type: 'object' },
      },
    },
  } as const;
}
