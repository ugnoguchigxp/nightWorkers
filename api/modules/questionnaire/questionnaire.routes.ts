import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import {
	executeTaskOperatorCommand,
	humanTaskOperatorCommandContext,
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../taskOperator";
import * as service from "./questionnaire.service";
import * as additionalService from "./questionnaire-additional.service";
import {
	acceptDesignQuestionnaireReviewRoute,
	createDesignQuestionnaireRoute,
	generateAdditionalDesignQuestionnaireRoute,
	generateDesignQuestionnaireFollowUpRoute,
	generateDesignQuestionnaireReviewRoute,
	getDesignQuestionnaireRoute,
	leaveDesignQuestionnaireReviewUnadoptedRoute,
	listDesignQuestionnairesRoute,
	saveDesignQuestionnaireAnswersRoute,
} from "./questionnaire-route-definitions";

export const questionnaireRouter = createOpenApiRouter()
	.openapi(
		createDesignQuestionnaireRoute,
		withOpenApiRouteError(createDesignQuestionnaireRoute, async (c) => {
			const session = await service.createDesignQuestionnaire(
				c.req.param("id"),
				c.req.valid("json").sourceBlueprintMessageId,
			);
			return c.json(session, 201);
		}),
	)
	.openapi(
		listDesignQuestionnairesRoute,
		withOpenApiRouteError(listDesignQuestionnairesRoute, async (c) => {
			const sessions = await service.listDesignQuestionnaires(
				c.req.param("id"),
			);
			return c.json(sessions, 200);
		}),
	)
	.openapi(
		getDesignQuestionnaireRoute,
		withOpenApiRouteError(getDesignQuestionnaireRoute, async (c) => {
			const session = await service.getDesignQuestionnaireSession(
				c.req.param("id"),
				c.req.param("sessionId"),
			);
			return c.json(session, 200);
		}),
	)
	.openapi(
		saveDesignQuestionnaireAnswersRoute,
		withOpenApiRouteError(saveDesignQuestionnaireAnswersRoute, async (c) => {
			const taskId = c.req.param("id");
			const projection = await readTaskOperatorProjection(taskId, {
				...humanTaskOperatorQueryContext(),
			});
			const session = await executeTaskOperatorCommand({
				taskId,
				actionId: "questionnaire.submit",
				expectedTaskRevision: projection.task.revision,
				arguments: {
					questionnaireSessionId: c.req.param("sessionId"),
					answers: c.req.valid("json").answers,
				},
				context: humanTaskOperatorCommandContext({
					idempotencyKey: c.req.header("Idempotency-Key"),
				}),
			});
			return c.json(session.data, 200);
		}),
	)
	.openapi(
		generateAdditionalDesignQuestionnaireRoute,
		withOpenApiRouteError(
			generateAdditionalDesignQuestionnaireRoute,
			async (c) => {
				const result =
					await additionalService.generateAdditionalDesignQuestionnaireQuestions(
						c.req.param("id"),
						c.req.valid("json"),
					);
				return c.json(result, 200);
			},
		),
	)
	.openapi(
		generateDesignQuestionnaireFollowUpRoute,
		withOpenApiRouteError(
			generateDesignQuestionnaireFollowUpRoute,
			async (c) => {
				const session = await service.generateDesignQuestionnaireFollowUp(
					c.req.param("id"),
					c.req.param("sessionId"),
				);
				return c.json(session, 200);
			},
		),
	)
	.openapi(
		generateDesignQuestionnaireReviewRoute,
		withOpenApiRouteError(generateDesignQuestionnaireReviewRoute, async (c) => {
			const result = await service.generateDesignQuestionnaireReview(
				c.req.param("id"),
				c.req.param("sessionId"),
			);
			return c.json(result, 200);
		}),
	)
	.openapi(
		acceptDesignQuestionnaireReviewRoute,
		withOpenApiRouteError(acceptDesignQuestionnaireReviewRoute, async (c) => {
			const session = await service.acceptDesignQuestionnaireReview(
				c.req.param("id"),
				c.req.param("sessionId"),
			);
			return c.json(session, 200);
		}),
	)
	.openapi(
		leaveDesignQuestionnaireReviewUnadoptedRoute,
		withOpenApiRouteError(
			leaveDesignQuestionnaireReviewUnadoptedRoute,
			async (c) => {
				const session = await service.leaveDesignQuestionnaireReviewUnadopted(
					c.req.param("id"),
					c.req.param("sessionId"),
				);
				return c.json(session, 200);
			},
		),
	);
