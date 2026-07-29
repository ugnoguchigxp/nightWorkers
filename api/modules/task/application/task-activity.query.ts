import { and, asc, eq } from "drizzle-orm";
import type {
	TraceChannel,
	TraceOwner,
} from "../../../../shared/schemas/trace-provenance.schema";
import { db } from "../../../db/client";
import { activityEvents } from "../../../db/schema";

export function readTaskActivityEvents(
	taskId: string,
	filter: {
		traceOwner?: TraceOwner;
		traceChannel?: TraceChannel;
	},
) {
	const predicates = [eq(activityEvents.taskId, taskId)];
	if (filter.traceOwner)
		predicates.push(eq(activityEvents.traceOwner, filter.traceOwner));
	if (filter.traceChannel)
		predicates.push(eq(activityEvents.traceChannel, filter.traceChannel));
	return db
		.select()
		.from(activityEvents)
		.where(and(...predicates))
		.orderBy(asc(activityEvents.seq), asc(activityEvents.createdAt));
}
