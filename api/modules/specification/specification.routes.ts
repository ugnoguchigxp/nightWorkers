import { createOpenApiRouter } from '../../lib/openapi';
import { withOpenApiRouteError } from '../nightworkers/nightworkers.route-utils';
import * as service from './specification.service';
import {
  generateSpecificationStatusDesignDocumentRoute,
  getPlanModeWorkspaceCompatibilityRoute,
  getSpecificationWorkspaceRoute,
} from './specification-route-definitions';

export const specificationRouter = createOpenApiRouter()
  .openapi(
    getPlanModeWorkspaceCompatibilityRoute,
    withOpenApiRouteError(getPlanModeWorkspaceCompatibilityRoute, async (c) => {
      const workspace = await service.getPlanModeWorkspace(c.req.param('id'));
      return c.json(workspace, 200);
    })
  )
  .openapi(
    getSpecificationWorkspaceRoute,
    withOpenApiRouteError(getSpecificationWorkspaceRoute, async (c) => {
      const workspace = await service.getSpecificationWorkspace(c.req.param('id'));
      return c.json(workspace, 200);
    })
  )
  .openapi(
    generateSpecificationStatusDesignDocumentRoute,
    withOpenApiRouteError(generateSpecificationStatusDesignDocumentRoute, async (c) => {
      const result = await service.generateSpecificationArtifact(
        c.req.param('id'),
        c.req.valid('json')
      );
      return c.json(result, 200);
    })
  );
