import type { ModelOption, ThinkingDepth, ThinkingDepthOption } from '../types';

type ModelThinkingControlsProps = {
  model: string;
  thinkingDepth: ThinkingDepth;
  modelOptions: ModelOption[];
  thinkingDepthOptions: ThinkingDepthOption[];
  onModelChange: (model: string) => void;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
};

export function ModelThinkingControls({
  model,
  thinkingDepth,
  modelOptions,
  thinkingDepthOptions,
  onModelChange,
  onThinkingDepthChange,
}: ModelThinkingControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-zinc-400" htmlFor="model-select">
        Model
      </label>
      <select
        id="model-select"
        className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {modelOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="text-xs text-zinc-400" htmlFor="thinking-select">
        Thinking
      </label>
      <select
        id="thinking-select"
        className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
        value={thinkingDepth}
        onChange={(e) => onThinkingDepthChange(e.target.value as ThinkingDepth)}
      >
        {thinkingDepthOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
