import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { config } from "../config";
import * as designQuestionnaireSchema from "./design-questionnaire-schema";
import * as missionPilotSchema from "./mission-pilot-schema";
import * as missionPlannerSchema from "./mission-planner-schema";
import * as projectDetailSchema from "./project-detail-schema";
import * as projectEvaluationSchema from "./project-evaluation-schema";
import * as reviewModeSchema from "./review-mode-schema";
import * as baseSchema from "./schema";
import { wrapClientWithBusyRetry } from "./sqlite-client-wrapper";
import * as taskGenerationSchema from "./task-generation-schema";

export { wrapClientWithBusyRetry };

export const client = wrapClientWithBusyRetry(
	createClient({
		url: config.DATABASE_URL.startsWith("file:")
			? config.DATABASE_URL
			: `file:${config.DATABASE_URL}`,
	}),
);

export const db = drizzle(client, {
	schema: {
		...baseSchema,
		...designQuestionnaireSchema,
		...missionPlannerSchema,
		...missionPilotSchema,
		...projectDetailSchema,
		...projectEvaluationSchema,
		...reviewModeSchema,
		...taskGenerationSchema,
	},
});

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
