import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	taskRuns,
	tasks,
} from "../../../db/schema";
import { NotFoundError } from "../../../lib/errors";
import { planModeRoutingTerminalReason } from "../../agentsShare";

export { planModeRoutingTerminalReason } from "../../agentsShare";

export async function readPlanModeRoutingLockedReason(
	taskId: string,
	options: { allowTaskRuns?: boolean } = {},
) {
	const [task, session, queueEntries, runs] = await Promise.all([
		db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }),
		db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, taskId),
		}),
		db
			.select({ id: implementationQueueEntries.id })
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.taskId, taskId)),
		db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(eq(taskRuns.taskId, taskId)),
	]);
	if (!task) throw new NotFoundError("Task not found");
	if (
		queueEntries.length ||
		(!options.allowTaskRuns && runs.length) ||
		session?.queueHandoffJson
	)
		return "Implementation Queue 投入後は routing を変更できません。";
	return planModeRoutingTerminalReason(task.status);
}
