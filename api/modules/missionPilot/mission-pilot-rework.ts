import {
	type MissionPilotReworkPacket,
	missionPilotReworkPacketSchema,
} from "../../../shared/modules/missionPilot";
import type { ImplementationTodoInput } from "../../services/todo-runtime";

export function parseMissionPilotReworkPacket(
	value: unknown,
): MissionPilotReworkPacket | null {
	const parsed = missionPilotReworkPacketSchema.safeParse(value);
	if (!parsed.success) return null;
	const packet = parsed.data;
	const hasPayload = Boolean(
		packet.summary ||
			packet.objective ||
			packet.reason ||
			packet.findings?.length ||
			packet.acceptanceCriteria?.length ||
			packet.evidenceRefs?.length ||
			packet.failedConditionIds?.length ||
			packet.affectedPaths?.length ||
			packet.mutationPaths?.length,
	);
	return hasPayload ? packet : null;
}

export function missionPilotReworkPaths(packetValue: unknown): string[] {
	const packet = parseMissionPilotReworkPacket(packetValue);
	if (!packet) return [];
	return [
		...(packet.affectedPaths ?? []),
		...(packet.mutationPaths ?? []),
		...(packet.findings ?? [])
			.map((finding) => finding.file)
			.filter((file): file is string => Boolean(file)),
	].filter((path, index, paths) => paths.indexOf(path) === index);
}

export function buildMissionPilotReworkTodos(
	packetValue: unknown,
): ImplementationTodoInput[] {
	const packet = parseMissionPilotReworkPacket(packetValue);
	if (!packet) return [];
	const findings = packet.findings ?? [];
	const todos: ImplementationTodoInput[] = [];
	const append = (todo: Omit<ImplementationTodoInput, "dependsOn">) => {
		const previousSeq = todos.length;
		todos.push({
			...todo,
			...(previousSeq > 0 ? { dependsOn: [previousSeq] } : {}),
		});
	};

	if (findings.length === 0) {
		append({
			title: "Reviewから引き継いだ修正要求を確認する",
			description: formatMissionPilotReworkPacket(packet),
			taskType: "inspection",
			procedureId: "mission_pilot.rework_inspect",
		});
	} else {
		for (const [index, finding] of findings.entries()) {
			const location = [
				finding.file,
				finding.line ? `line ${finding.line}` : null,
			]
				.filter(Boolean)
				.join(":");
			append({
				title: `Review指摘 ${index + 1} を修正: ${finding.category}`,
				description: [
					location ? `対象: ${location}` : null,
					`指摘: ${finding.evidence}`,
					`対応: ${finding.recommendedAction}`,
					finding.blockingReason
						? `blocking理由: ${finding.blockingReason}`
						: null,
				]
					.filter(Boolean)
					.join("\n"),
				taskType: "code_change",
				procedureId: "mission_pilot.rework_finding",
			});
		}
	}
	append({
		title: "Review指摘に対する局所確認を行う",
		description: [
			"今回のReview指摘と受け入れ条件だけを確認する。",
			packet.acceptanceCriteria?.length
				? `受け入れ条件:\n${packet.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
				: null,
			missionPilotReworkPaths(packet).length
				? `対象パス:\n${missionPilotReworkPaths(packet)
						.map((item) => `- ${item}`)
						.join("\n")}`
				: null,
		]
			.filter(Boolean)
			.join("\n"),
		taskType: "focused_verification",
		procedureId: "mission_pilot.rework_verify",
	});
	return todos;
}

export function formatMissionPilotReworkPacket(packetValue: unknown): string {
	const packet = parseMissionPilotReworkPacket(packetValue);
	if (!packet) return "Reviewから引き継いだ修正要求はありません。";
	return [
		packet.summary
			? `概要: ${packet.summary}`
			: packet.reason
				? `理由: ${packet.reason}`
				: null,
		packet.objective ? `目的: ${packet.objective}` : null,
		packet.findings?.length
			? `blocking指摘:\n${packet.findings
					.map(
						(finding, index) =>
							`${index + 1}. [${finding.category}] ${finding.evidence}\n   対応: ${finding.recommendedAction}`,
					)
					.join("\n")}`
			: null,
		packet.acceptanceCriteria?.length
			? `受け入れ条件:\n${packet.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
			: null,
		packet.affectedPaths?.length
			? `対象パス:\n${packet.affectedPaths.map((item) => `- ${item}`).join("\n")}`
			: null,
		packet.mutationPaths?.length
			? `mutation対象パス:\n${packet.mutationPaths.map((item) => `- ${item}`).join("\n")}`
			: null,
		packet.failedConditionIds?.length
			? `失敗条件:\n${packet.failedConditionIds.map((item) => `- ${item}`).join("\n")}`
			: null,
		packet.evidenceRefs?.length
			? `証跡:\n${packet.evidenceRefs.map((item) => `- ${item}`).join("\n")}`
			: null,
	]
		.filter(Boolean)
		.join("\n\n");
}

export function hasMissionPilotReworkPacket(value: unknown) {
	return parseMissionPilotReworkPacket(value) !== null;
}
