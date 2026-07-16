import { z } from "zod";
import { nightWorkersPlanModeInputSchema } from "../../../mcp/nightworkers-tool-schemas";
import type { ProviderToolDefinition } from "../../structured-llm/tool-calls";

export const nativeApiPlanModeToolDefinition: ProviderToolDefinition = {
	name: "plan_mode",
	description:
		"Plan Modeの状態を確認し、Taskとrepositoryを読んだCoding Agent自身の判断で、必要な設計Artifactのrouting、ユーザー入力要求、Artifact生成を明示実行します。",
	inputSchema: withoutSchemaKeyword(
		z.toJSONSchema(
			nightWorkersPlanModeInputSchema.omit({
				taskId: true,
				runId: true,
			}),
		) as Record<string, unknown>,
	),
};

function withoutSchemaKeyword(schema: Record<string, unknown>) {
	const { $schema: _ignored, ...inputSchema } = schema;
	return inputSchema;
}
