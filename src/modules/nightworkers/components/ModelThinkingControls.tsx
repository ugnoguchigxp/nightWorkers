import { useTranslation } from "react-i18next";
import type {
	ComposerThinkingDepth,
	ModelOption,
	ThinkingDepthOption,
} from "../types";

type ModelThinkingControlsProps = {
	model: string;
	thinkingDepth: ComposerThinkingDepth;
	modelOptions: ModelOption[];
	thinkingDepthOptions: ThinkingDepthOption[];
	onModelChange: (model: string) => void;
	onThinkingDepthChange: (depth: ComposerThinkingDepth) => void;
};

export function ModelThinkingControls({
	model,
	thinkingDepth,
	modelOptions,
	thinkingDepthOptions = [],
	onModelChange,
	onThinkingDepthChange,
}: ModelThinkingControlsProps) {
	const { t } = useTranslation();

	return (
		<div className="flex flex-wrap items-center gap-2">
			<label
				className="nightworkers-control-label text-xs text-zinc-400"
				htmlFor="model-select"
			>
				{t("modelControls.model")}
			</label>
			<select
				id="model-select"
				className="nightworkers-control-select h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
				value={model}
				onChange={(e) => onModelChange(e.target.value)}
			>
				{modelOptions.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{thinkingDepthOptions.length ? (
				<>
					<label
						className="nightworkers-control-label text-xs text-zinc-400"
						htmlFor="thinking-select"
					>
						{t("modelControls.thinking")}
					</label>
					<select
						id="thinking-select"
						className="nightworkers-control-select h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
						value={thinkingDepth}
						onChange={(e) =>
							onThinkingDepthChange(e.target.value as ComposerThinkingDepth)
						}
					>
						{thinkingDepthOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</>
			) : null}
		</div>
	);
}
