import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const bedrock = vi.hoisted(() => ({
	commands: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	ConverseCommand: class {
		input: Record<string, unknown>;
		constructor(input: Record<string, unknown>) {
			this.input = input;
			bedrock.commands.push(input);
		}
	},
	BedrockRuntimeClient: class {
		async send() {
			return {
				output: {
					message: {
						content: [
							{
								toolUse: {
									toolUseId: "tool-1",
									name: "finalize_answer",
									input: { finalReport: "image reviewed" },
								},
							},
						],
					},
				},
				usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
			};
		}
	},
}));

import { callBedrockProviderToolTurn } from "../api/services/structured-llm/bedrock-provider";

describe("Bedrock prompt image input", () => {
	it("sends image bytes through Converse together with native tools", async () => {
		bedrock.commands.length = 0;
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nw-bedrock-image-"));
		const imagePath = path.join(dir, "sample.png");
		await fs.writeFile(imagePath, Buffer.from([1, 2, 3]));

		const result = await callBedrockProviderToolTurn(
			{
				systemPrompt: "Follow the runtime contract",
				userPrompt: "Describe this image",
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "Describe this image" },
							{
								type: "image",
								image: {
									id: "image-1",
									name: "sample.png",
									mediaType: "image/png",
									size: 3,
									path: imagePath,
								},
							},
						],
					},
				],
				tools: [
					{
						name: "finalize_answer",
						description: "Finish",
						inputSchema: { type: "object" },
					},
				],
				options: {
					normalizedRequest: {
						providerId: "bedrock",
						modelOrDeployment: "anthropic.claude-3-5-sonnet",
						region: "us-east-1",
					},
					toolChoice: "required",
				},
				signal: AbortSignal.timeout(1000),
				setProviderDebug: vi.fn(),
			} as never,
			() => true,
			{
				AWS_ACCESS_KEY_ID: "key",
				AWS_SECRET_ACCESS_KEY: "secret",
				AWS_REGION: "us-east-1",
			} as never,
		);

		expect(result).toMatchObject({
			type: "supported",
			toolCalls: [
				{
					id: "tool-1",
					name: "finalize_answer",
					arguments: { finalReport: "image reviewed" },
				},
			],
		});
		const message = (
			bedrock.commands[0].messages as Array<{
				content: Array<{ image?: { source?: { bytes?: Uint8Array } } }>;
			}>
		)[0];
		expect(Buffer.from(message.content[1].image?.source?.bytes ?? [])).toEqual(
			Buffer.from([1, 2, 3]),
		);
		expect(bedrock.commands[0].system).toEqual([
			{ text: "Follow the runtime contract" },
		]);
	});
});
