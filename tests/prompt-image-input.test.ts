import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodexRuntimeInput } from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt";
import {
	buildInitialNativeApiHistory,
	projectNativeApiHistoryToProviderMessages,
} from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-history";
import type { AgentRunContext } from "../api/modules/codingAgent/runtime/types";
import { persistPromptImageAttachments } from "../api/modules/nightworkers/prompt-image-attachments";
import { toOpenAIToolMessages } from "../api/services/structured-llm/openai-tool-messages";

const originalRuntimeDir = process.env.NIGHTWORKERS_RUNTIME_DIR;

afterEach(() => {
	if (originalRuntimeDir === undefined)
		delete process.env.NIGHTWORKERS_RUNTIME_DIR;
	else process.env.NIGHTWORKERS_RUNTIME_DIR = originalRuntimeDir;
});

function context(imagePath: string): AgentRunContext {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: process.cwd(),
		compiledPrompt: "Describe the image",
		latestUserMessage: "Describe the image",
		imageAttachments: [
			{
				id: "image-1",
				name: "sample.png",
				mediaType: "image/png",
				size: 3,
				path: imagePath,
			},
		],
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: "Describe the image",
			source: "task_prompt",
		},
	};
}

describe("prompt image input", () => {
	it("persists base64 prompt images outside the project workspace", async () => {
		const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "nw-image-"));
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeDir;
		const [attachment] = await persistPromptImageAttachments({
			taskId: "task-1",
			images: [
				{
					id: "client-image-1",
					name: "sample.png",
					mediaType: "image/png",
					size: 8,
					dataUrl: "data:image/png;base64,iVBORw0KGgo=",
				},
			],
		});

		expect(attachment.path).toContain(
			path.join(runtimeDir, "artifacts", "prompt-images", "task-1"),
		);
		expect(await fs.readFile(attachment.path)).toEqual(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		);
	});

	it("rejects content whose bytes do not match the declared image type", async () => {
		const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "nw-image-"));
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeDir;

		await expect(
			persistPromptImageAttachments({
				taskId: "task-invalid",
				images: [
					{
						id: "client-image-1",
						name: "not-an-image.png",
						mediaType: "image/png",
						size: 3,
						dataUrl: "data:image/png;base64,AQID",
					},
				],
			}),
		).rejects.toMatchObject({ code: "INVALID_PROMPT_IMAGE", statusCode: 400 });
		await expect(
			fs.access(
				path.join(runtimeDir, "artifacts", "prompt-images", "task-invalid"),
			),
		).rejects.toBeDefined();
	});

	it("projects the same attachment into Codex and native API inputs", () => {
		const runContext = context("/runtime/sample.png");

		expect(buildCodexRuntimeInput(runContext, "Describe the image")).toEqual([
			{ type: "text", text: "Describe the image" },
			{ type: "local_image", path: "/runtime/sample.png" },
		]);
		const messages = projectNativeApiHistoryToProviderMessages(
			buildInitialNativeApiHistory(runContext),
		);
		expect(messages.find((message) => message.role === "user")).toMatchObject({
			role: "user",
			content: [
				{ type: "text", text: "Describe the image" },
				{
					type: "image",
					image: { path: "/runtime/sample.png", mediaType: "image/png" },
				},
			],
		});
	});

	it("encodes native API image parts for OpenAI and Azure chat completions", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nw-openai-image-"));
		const imagePath = path.join(dir, "sample.png");
		await fs.writeFile(imagePath, Buffer.from([1, 2, 3]));

		const [message] = toOpenAIToolMessages([
			{
				role: "user",
				content: [
					{ type: "text", text: "Describe the image" },
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
		]);

		expect(message).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "Describe the image" },
				{
					type: "image_url",
					image_url: { url: "data:image/png;base64,AQID" },
				},
			],
		});
	});
});
