export const PROMPT_IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;

export type PromptImageMediaType = (typeof PROMPT_IMAGE_MEDIA_TYPES)[number];

export type PromptImageInput = {
	id: string;
	name: string;
	mediaType: PromptImageMediaType;
	size: number;
	dataUrl: string;
};

export type PromptImageAttachment = {
	id: string;
	name: string;
	mediaType: PromptImageMediaType;
	size: number;
	path: string;
};

export const PROMPT_IMAGE_MAX_COUNT = 5;
export const PROMPT_IMAGE_MAX_BYTES = 3_750_000;

export function isPromptImageMediaType(
	value: string,
): value is PromptImageMediaType {
	return (PROMPT_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}
