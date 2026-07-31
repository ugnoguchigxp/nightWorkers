import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { config } from "../config";
import * as missionPilotAgentSchema from "../modules/missionPilot/persistence/agent-schema";
import * as missionPilotSchema from "../modules/missionPilot/persistence/schema";
import { createPersistenceOwnerIpcClient } from "../services/execution/persistence-owner-ipc-client";
import * as designQuestionnaireSchema from "./design-questionnaire-schema";
import * as missionPlannerSchema from "./mission-planner-schema";
import * as planModeSchema from "./plan-mode-schema";
import * as projectDetailSchema from "./project-detail-schema";
import * as projectEvaluationSchema from "./project-evaluation-schema";
import * as reviewModeSchema from "./review-mode-schema";
import * as baseSchema from "./schema";
import { wrapClientWithBusyRetry } from "./sqlite-client-wrapper";
import * as taskArchiveSchema from "./task-archive-schema";
import * as taskGenerationSchema from "./task-generation-schema";

export { wrapClientWithBusyRetry };

const isPersistenceWorker =
	process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker";

export const client = isPersistenceWorker
	? createPersistenceOwnerIpcClient()
	: wrapClientWithBusyRetry(
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
		...missionPilotAgentSchema,
		...planModeSchema,
		...projectDetailSchema,
		...projectEvaluationSchema,
		...reviewModeSchema,
		...taskGenerationSchema,
		...taskArchiveSchema,
	},
});

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
