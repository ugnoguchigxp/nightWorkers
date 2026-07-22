import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { tasks } from "../../../db/schema";
import { NotFoundError } from "../../../lib/errors";
import { planModeRoutingTerminalReason } from "../../agentsShare";

export { planModeRoutingTerminalReason } from "../../agentsShare";

export async function readPlanModeRoutingLockedReason(
	taskId: string,
	_options: { allowTaskRuns?: boolean } = {},
) {
	const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
	if (!task) throw new NotFoundError("Task not found");
	return planModeRoutingTerminalReason(task.status);
}
