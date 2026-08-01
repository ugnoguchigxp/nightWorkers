import { useRef } from "react";
import type { ArtifactExportDescriptor } from "../artifactExport";
import { downloadElementAsPng } from "../artifactExport";
import { copyText, saveTextFile } from "./ArtifactPaneVersions";

export function useArtifactPaneExportActions(input: {
	descriptor: ArtifactExportDescriptor;
	setExportError: (value: string | null) => void;
	setIsExportingImage: (value: boolean) => void;
	isExportingImage: boolean;
	translate: (key: string) => string;
}) {
	const artifactCaptureRef = useRef<HTMLElement | null>(null);
	const {
		descriptor,
		setExportError,
		setIsExportingImage,
		isExportingImage,
		translate,
	} = input;
	const handleCopyMarkdown = async () => {
		try {
			await copyText(descriptor.markdown);
			setExportError(null);
		} catch {
			setExportError(translate("artifact.exportCopyFailed"));
		}
	};
	const handleDownloadMarkdown = () => {
		try {
			saveTextFile(descriptor.markdown, `${descriptor.fileStem}.md`);
			setExportError(null);
		} catch {
			setExportError(translate("artifact.exportMarkdownFailed"));
		}
	};
	const handleDownloadCsv = () => {
		if (descriptor.csv === undefined) return;
		try {
			saveTextFile(descriptor.csv, `${descriptor.fileStem}.csv`);
			setExportError(null);
		} catch {
			setExportError(translate("artifact.exportCsvFailed"));
		}
	};
	const handleDownloadImage = async () => {
		if (!artifactCaptureRef.current || isExportingImage) return;
		setIsExportingImage(true);
		setExportError(null);
		try {
			await downloadElementAsPng(
				artifactCaptureRef.current,
				`${descriptor.fileStem}.png`,
			);
		} catch (error) {
			setExportError(
				translate(
					error instanceof Error && error.message === "artifact_image_too_large"
						? "artifact.exportImageTooLarge"
						: "artifact.exportImageFailed",
				),
			);
		} finally {
			setIsExportingImage(false);
		}
	};
	return {
		artifactCaptureRef,
		handleCopyMarkdown,
		handleDownloadMarkdown,
		handleDownloadCsv,
		handleDownloadImage,
	};
}
