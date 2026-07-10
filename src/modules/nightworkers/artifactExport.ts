export type ArtifactExportDescriptor = {
	title: string;
	fileStem: string;
	markdown: string;
	scopeId?: string;
};

const MAX_EXPORT_PIXELS = 40_000_000;
const MAX_EXPORT_DIMENSION = 16_000;

export function artifactFileStem(title: string) {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || "artifact";
}

export function buildMarkdownFromValue(
	title: string,
	value: unknown,
	language = "json",
) {
	if (typeof value === "string" && value.trim()) return value;
	const serialized =
		JSON.stringify(value ?? {}, null, 2) ?? String(value ?? "");
	return `# ${title}\n\n${markdownCodeBlock(serialized, language)}\n`;
}

export function markdownCodeBlock(content: string, language = "") {
	const longestBacktickRun = Math.max(
		0,
		...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
	);
	const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
	return `${fence}${language}\n${content}\n${fence}`;
}

export async function downloadElementAsPng(
	element: HTMLElement,
	filename: string,
) {
	await document.fonts?.ready;
	const clone = element.cloneNode(true) as HTMLElement;
	clone.dataset.artifactExportCapture = "true";
	for (const excluded of clone.querySelectorAll(
		"[data-artifact-export-exclude]",
	)) {
		excluded.remove();
	}

	const sourceWidth = Math.ceil(element.getBoundingClientRect().width);
	const exportWidth = Math.max(720, sourceWidth);
	clone.style.width = `${exportWidth}px`;
	clone.style.height = "auto";
	clone.style.maxHeight = "none";
	clone.style.overflow = "visible";
	clone.style.position = "relative";
	clone.style.inset = "auto";

	const expansionStyles = document.createElement("style");
	expansionStyles.textContent = `
		[data-artifact-export-capture] [data-artifact-export-expand] {
			height: auto !important;
			max-height: none !important;
			overflow: visible !important;
		}
	`;
	clone.prepend(expansionStyles);

	const staging = document.createElement("div");
	staging.setAttribute("aria-hidden", "true");
	staging.style.position = "fixed";
	staging.style.left = "-100000px";
	staging.style.top = "0";
	staging.style.width = `${exportWidth}px`;
	staging.style.pointerEvents = "none";
	staging.style.zIndex = "-1";
	staging.appendChild(clone);
	document.body.appendChild(staging);

	try {
		await nextAnimationFrame();
		await Promise.all(
			Array.from(clone.querySelectorAll("img")).map(async (image) => {
				try {
					await image.decode();
				} catch {
					// html-to-image will preserve the fallback state for failed images.
				}
			}),
		);
		const width = Math.ceil(Math.max(exportWidth, clone.scrollWidth));
		const height = Math.ceil(
			Math.max(clone.scrollHeight, clone.getBoundingClientRect().height),
		);
		const pixelRatio = resolveArtifactImagePixelRatio(width, height);
		const { toBlob } = await import("html-to-image");
		const blob = await toBlob(clone, {
			backgroundColor: "#1e1e2e",
			cacheBust: true,
			height,
			pixelRatio,
			width,
		});
		if (!blob) throw new Error("artifact_image_empty");
		downloadBlob(blob, filename);
	} finally {
		staging.remove();
	}
}

export function resolveArtifactImagePixelRatio(width: number, height: number) {
	const basePixels = width * height;
	if (
		width <= 0 ||
		height <= 0 ||
		basePixels > MAX_EXPORT_PIXELS ||
		Math.max(width, height) > MAX_EXPORT_DIMENSION
	) {
		throw new Error("artifact_image_too_large");
	}
	return Math.min(
		2,
		Math.sqrt(MAX_EXPORT_PIXELS / basePixels),
		MAX_EXPORT_DIMENSION / Math.max(width, height),
	);
}

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.style.display = "none";
	try {
		document.body.appendChild(anchor);
		anchor.click();
	} finally {
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1_000);
	}
}

function nextAnimationFrame() {
	return new Promise<void>((resolve) => {
		requestAnimationFrame(() => resolve());
	});
}
