import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	PromptImageAttachment,
	PromptImageInput,
} from "../../../shared/prompt-image";
import {
	isPromptImageMediaType,
	PROMPT_IMAGE_MAX_BYTES,
	PROMPT_IMAGE_MAX_COUNT,
} from "../../../shared/prompt-image";
import { AppError } from "../../lib/errors";
import { getRuntimePaths } from "../../runtime/paths";

const IMAGE_EXTENSION_BY_MEDIA_TYPE = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
} as const;

export async function persistPromptImageAttachments(input: {
	taskId: string;
	images?: PromptImageInput[];
}): Promise<PromptImageAttachment[]> {
	const images = input.images ?? [];
	if (images.length > PROMPT_IMAGE_MAX_COUNT) {
		throw new AppError(
			400,
			"TOO_MANY_PROMPT_IMAGES",
			`A prompt can include at most ${PROMPT_IMAGE_MAX_COUNT} images.`,
		);
	}
	if (images.length === 0) return [];

	const prepared = images.map((image) => {
		if (!isPromptImageMediaType(image.mediaType)) {
			throw new AppError(
				400,
				"UNSUPPORTED_PROMPT_IMAGE",
				`Unsupported prompt image type: ${image.mediaType}`,
			);
		}
		const prefix = `data:${image.mediaType};base64,`;
		if (!image.dataUrl.startsWith(prefix)) {
			throwInvalidPromptImage();
		}
		const encoded = image.dataUrl.slice(prefix.length);
		if (!isCanonicalBase64(encoded)) throwInvalidPromptImage();
		const bytes = Buffer.from(encoded, "base64");
		if (bytes.length === 0 || bytes.length > PROMPT_IMAGE_MAX_BYTES) {
			throw new AppError(
				400,
				"PROMPT_IMAGE_SIZE_INVALID",
				`Prompt images must be between 1 byte and ${PROMPT_IMAGE_MAX_BYTES} bytes.`,
			);
		}
		if (!matchesImageSignature(bytes, image.mediaType)) {
			throwInvalidPromptImage();
		}
		return { image, bytes };
	});

	const targetDir = path.join(
		getRuntimePaths().artifactsDir,
		"prompt-images",
		input.taskId,
	);
	await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });

	const attachments: PromptImageAttachment[] = [];
	try {
		for (const { image, bytes } of prepared) {
			const id = crypto.randomUUID();
			const filePath = path.join(
				targetDir,
				`${id}.${IMAGE_EXTENSION_BY_MEDIA_TYPE[image.mediaType]}`,
			);
			await fs.writeFile(filePath, bytes, { mode: 0o600 });
			attachments.push({
				id,
				name: path.basename(image.name).slice(0, 240) || `image-${id}`,
				mediaType: image.mediaType,
				size: bytes.length,
				path: filePath,
			});
		}
		return attachments;
	} catch (error) {
		await deletePromptImageAttachmentFiles(attachments);
		throw error;
	}
}

function throwInvalidPromptImage(): never {
	throw new AppError(
		400,
		"INVALID_PROMPT_IMAGE",
		"Prompt image data must be valid image bytes in a matching base64 data URL.",
	);
}

function isCanonicalBase64(value: string) {
	return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
		value,
	);
}

function matchesImageSignature(
	bytes: Buffer,
	mediaType: PromptImageInput["mediaType"],
) {
	if (mediaType === "image/png") {
		return bytes
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	}
	if (mediaType === "image/jpeg") {
		return (
			bytes.length >= 3 &&
			bytes[0] === 0xff &&
			bytes[1] === 0xd8 &&
			bytes[2] === 0xff
		);
	}
	if (mediaType === "image/gif") {
		const signature = bytes.subarray(0, 6).toString("ascii");
		return signature === "GIF87a" || signature === "GIF89a";
	}
	return (
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "WEBP"
	);
}

export function readPromptImageAttachments(
	metadata: unknown,
): PromptImageAttachment[] {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return [];
	}
	const value = (metadata as Record<string, unknown>).imageAttachments;
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const record = item as Record<string, unknown>;
		if (
			typeof record.id !== "string" ||
			typeof record.name !== "string" ||
			typeof record.path !== "string" ||
			typeof record.size !== "number" ||
			typeof record.mediaType !== "string" ||
			!isPromptImageMediaType(record.mediaType)
		) {
			return [];
		}
		return [
			{
				id: record.id,
				name: record.name,
				path: record.path,
				size: record.size,
				mediaType: record.mediaType,
			},
		];
	});
}

export async function deletePromptImageAttachments(taskId: string) {
	const targetDir = path.join(
		getRuntimePaths().artifactsDir,
		"prompt-images",
		taskId,
	);
	await fs.rm(targetDir, { recursive: true, force: true });
}

export async function deletePromptImageAttachmentFiles(
	attachments: readonly PromptImageAttachment[],
) {
	await Promise.allSettled(
		attachments.map((attachment) => fs.rm(attachment.path, { force: true })),
	);
}
