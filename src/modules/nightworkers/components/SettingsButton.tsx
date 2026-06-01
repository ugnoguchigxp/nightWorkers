import { Settings } from 'lucide-react';

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed right-4 top-3 z-[60] flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-800/70 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      title="LLM Settings"
    >
      <Settings className="h-4 w-4" />
    </button>
  );
}
