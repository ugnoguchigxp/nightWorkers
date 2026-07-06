import { AppError } from "../../lib/errors";

const PLAN_MODE_READ_ONLY_TASK_STATUSES = new Set([
	"completed",
	"cancelled",
	"failed",
	"timed_out",
]);

export function assertPlanModeMutable(task: { status: string }) {
	if (!PLAN_MODE_READ_ONLY_TASK_STATUSES.has(task.status)) return;
	throw new AppError(
		409,
		"PLAN_MODE_READ_ONLY",
		"Terminal sessions cannot modify Plan Mode artifacts.",
	);
}
