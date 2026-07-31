import { z } from "@hono/zod-openapi";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type {
	MissionPilotActionFailure,
	MissionPilotTaskEventType,
} from "../../../contracts";
import {
	MISSION_PILOT_TASK_EVENT_TYPES,
	missionPilotTaskEventTypeSchema,
} from "../../../contracts";
import { db } from "../../../db/client";
import type { ProviderToolCall } from "../../../services/structured-llm/public";
import {
	missionPilotActionExecutions,
	missionPilotAgentSessions,
	missionPilotSessions,
	missionPilotTaskEventInbox,
	missionPilotToolCalls,
} from "../../storage";

const waitInputSchema = z.object({
	eventTypes: z.array(missionPilotTaskEventTypeSchema).min(1),
	reason: z.string().min(1),
});
const finishInputSchema = z.object({ summary: z.string().min(1) });

export const MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS = [
	{
		name: "agent.wait_for_event",
		description:
			"明示したtask eventが到着するまで、このturnをwait状態にする。ユーザーへ見えるmessage送信など必要な前処理を同じturnで完了してから呼ぶ。",
		inputSchema: {
			type: "object",
			properties: {
				eventTypes: {
					type: "array",
					items: {
						type: "string",
						enum: MISSION_PILOT_TASK_EVENT_TYPES,
					},
					minItems: 1,
				},
				reason: { type: "string", minLength: 1 },
			},
			required: ["eventTypes", "reason"],
			additionalProperties: false,
		},
	},
	{
		name: "agent.finish",
		description:
			"現在のTask目的が達成されたと判断し、未確定receipt・未処理event・未完了tool callがないときにMission Pilotを完了する。",
		inputSchema: {
			type: "object",
			properties: { summary: { type: "string", minLength: 1 } },
			required: ["summary"],
			additionalProperties: false,
		},
	},
] as const;

export type MissionPilotAgentControlResult =
	| {
			ok: true;
			actionId: "agent.wait_for_event";
			data: unknown;
			directive: "wait";
			waitFor: MissionPilotTaskEventType[];
	  }
	| {
			ok: true;
			actionId: "agent.finish";
			data: unknown;
			directive: "finish";
	  }
	| { ok: false; failure: MissionPilotActionFailure; directive: "continue" };

export async function executeMissionPilotAgentControlTool(input: {
	call: ProviderToolCall;
	toolCallId: string;
	turnId?: string;
	leaseOwner: string;
	sessionId: string;
	taskId: string;
}): Promise<MissionPilotAgentControlResult> {
	if (input.call.name === "agent.wait_for_event") {
		const parsed = waitInputSchema.safeParse(input.call.arguments);
		if (!parsed.success)
			return failure(
				input.call.name,
				"agent.wait_for_event arguments are invalid.",
			);
		const turnId = input.turnId ?? (await toolCallTurnId(input.toolCallId));
		if (!turnId)
			return failure(
				input.call.name,
				"The current tool turn could not be resolved.",
			);
		if (!(await hasActiveTurn(input, turnId)))
			return failure(
				input.call.name,
				"現在のAgent turnのleaseが有効ではありません。",
			);
		if (parsed.data.eventTypes.includes("task.user_message_added")) {
			const [messageAction] = await db
				.select({ id: missionPilotToolCalls.id })
				.from(missionPilotToolCalls)
				.where(
					and(
						eq(missionPilotToolCalls.sessionId, input.sessionId),
						eq(missionPilotToolCalls.turnId, turnId),
						eq(missionPilotToolCalls.actionId, "task.message.send"),
						eq(missionPilotToolCalls.status, "succeeded"),
					),
				)
				.limit(1);
			if (!messageAction)
				return failure(
					input.call.name,
					"A visible task message must succeed before waiting for task.user_message_added.",
				);
		}
		return {
			ok: true,
			actionId: input.call.name,
			directive: "wait",
			waitFor: parsed.data.eventTypes,
			data: {
				kind: "wait_for_event",
				eventTypes: parsed.data.eventTypes,
				reason: parsed.data.reason,
			},
		};
	}
	if (input.call.name !== "agent.finish")
		return failure(input.call.name, "Unknown Mission Pilot control tool.");
	const parsed = finishInputSchema.safeParse(input.call.arguments);
	if (!parsed.success || !parsed.data.summary.trim())
		return failure(input.call.name, "agent.finish arguments are invalid.");
	const turnId = input.turnId ?? (await toolCallTurnId(input.toolCallId));
	if (!turnId)
		return failure(input.call.name, "現在のAgent turnを解決できません。");
	const unresolved = await db.transaction(async (tx) => {
		const [session] = await tx
			.select({ taskId: missionPilotSessions.taskId })
			.from(missionPilotSessions)
			.innerJoin(
				missionPilotAgentSessions,
				eq(missionPilotAgentSessions.sessionId, missionPilotSessions.id),
			)
			.where(
				and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.taskId, input.taskId),
					eq(missionPilotSessions.desiredState, "playing"),
					eq(missionPilotAgentSessions.engineMode, "agent"),
					eq(missionPilotAgentSessions.runtimeState, "running"),
					eq(missionPilotAgentSessions.currentTurnId, turnId),
					eq(missionPilotAgentSessions.leaseOwner, input.leaseOwner),
				),
			)
			.limit(1);
		if (!session) return "現在のAgent turnのleaseが有効ではありません。";
		const [receipt] = await tx
			.select({ id: missionPilotActionExecutions.id })
			.from(missionPilotActionExecutions)
			.where(
				and(
					eq(missionPilotActionExecutions.sessionId, input.sessionId),
					inArray(missionPilotActionExecutions.status, [
						"pending",
						"executing",
						"outcome_unknown",
					]),
				),
			)
			.limit(1);
		const [unreadEvent] = await tx
			.select({ id: missionPilotTaskEventInbox.id })
			.from(missionPilotTaskEventInbox)
			.where(
				and(
					eq(missionPilotTaskEventInbox.sessionId, input.sessionId),
					isNull(missionPilotTaskEventInbox.consumedAt),
				),
			)
			.limit(1);
		const [pendingToolCall] = await tx
			.select({ id: missionPilotToolCalls.id })
			.from(missionPilotToolCalls)
			.where(
				and(
					eq(missionPilotToolCalls.sessionId, input.sessionId),
					inArray(missionPilotToolCalls.status, ["pending", "running"]),
					ne(missionPilotToolCalls.id, input.toolCallId),
				),
			)
			.limit(1);
		return receipt || unreadEvent || pendingToolCall
			? "Mission Pilotに未解決の作業があります。"
			: null;
	});
	if (unresolved) return failure(input.call.name, unresolved);
	return {
		ok: true,
		actionId: input.call.name,
		directive: "finish",
		data: { kind: "finish", summary: parsed.data.summary },
	};
}

async function hasActiveTurn(
	input: {
		sessionId: string;
		taskId: string;
		leaseOwner: string;
	},
	turnId: string,
) {
	const [row] = await db
		.select({ taskId: missionPilotSessions.taskId })
		.from(missionPilotSessions)
		.innerJoin(
			missionPilotAgentSessions,
			eq(missionPilotAgentSessions.sessionId, missionPilotSessions.id),
		)
		.where(
			and(
				eq(missionPilotSessions.id, input.sessionId),
				eq(missionPilotSessions.taskId, input.taskId),
				eq(missionPilotSessions.desiredState, "playing"),
				eq(missionPilotAgentSessions.engineMode, "agent"),
				eq(missionPilotAgentSessions.runtimeState, "running"),
				eq(missionPilotAgentSessions.currentTurnId, turnId),
				eq(missionPilotAgentSessions.leaseOwner, input.leaseOwner),
			),
		)
		.limit(1);
	return Boolean(row);
}

async function toolCallTurnId(toolCallId: string) {
	const [row] = await db
		.select({ turnId: missionPilotToolCalls.turnId })
		.from(missionPilotToolCalls)
		.where(eq(missionPilotToolCalls.id, toolCallId))
		.limit(1);
	return row?.turnId ?? null;
}

function failure(
	actionId: string,
	message: string,
): MissionPilotAgentControlResult {
	return {
		ok: false,
		directive: "continue",
		failure: {
			kind: "domain_precondition",
			retryable: false,
			providerCode: null,
			httpStatus: null,
			message,
			retryAfterMs: null,
			attempt: 1,
			actionId,
			idempotencyKey: null,
		},
	};
}

export function isMissionPilotAgentControlTool(name: string) {
	return name === "agent.wait_for_event" || name === "agent.finish";
}

export function readMissionPilotAgentControlEventTypes(value: unknown) {
	const parsed = z.array(missionPilotTaskEventTypeSchema).safeParse(value);
	return parsed.success ? (parsed.data as MissionPilotTaskEventType[]) : null;
}
