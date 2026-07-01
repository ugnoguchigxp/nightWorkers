import { createOpenApiRouter } from '../../lib/openapi';
import { withOpenApiRouteError } from '../nightworkers/nightworkers.route-utils';
import { generateDataModelArtifact } from './dataModel-generation.service';
import { generateDataModelRoute } from './dataModel-route-definitions';

export const dataModelRouter = createOpenApiRouter().openapi(
  generateDataModelRoute,
  withOpenApiRouteError(generateDataModelRoute, async (c) => {
    const result = await generateDataModelArtifact(c.req.param('id'), c.req.valid('json'));
    return c.json(result, 200);
  })
);
