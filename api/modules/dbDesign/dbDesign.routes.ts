import { createOpenApiRouter } from '../../lib/openapi';
import { withOpenApiRouteError } from '../nightworkers/nightworkers.route-utils';
import * as service from './dbDesign.service';
import {
  generateSpecificationStatusDbDesignRoute,
  getBlueprintDbDesignAdoptionRoute,
  saveBlueprintDbDesignAdoptionRoute,
} from './dbDesign-route-definitions';

export const dbDesignRouter = createOpenApiRouter()
  .openapi(
    getBlueprintDbDesignAdoptionRoute,
    withOpenApiRouteError(getBlueprintDbDesignAdoptionRoute, async (c) => {
      const adoption = await service.getDbDesignAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    saveBlueprintDbDesignAdoptionRoute,
    withOpenApiRouteError(saveBlueprintDbDesignAdoptionRoute, async (c) => {
      const body = c.req.valid('json');
      const adoption = await service.saveDbDesignAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    generateSpecificationStatusDbDesignRoute,
    withOpenApiRouteError(generateSpecificationStatusDbDesignRoute, async (c) => {
      const result = await service.generateDbDesignArtifact(c.req.param('id'), c.req.valid('json'));
      return c.json(result, 200);
    })
  );
