import { Settings } from 'lucide-react';

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nightworkers-settings-button fixed top-1 right-1 z-[70] flex h-8 w-8 items-center justify-center rounded-md border border-[#45475a] bg-[#1e1e2e] text-[#cdd6f4] shadow-none transition-colors hover:bg-[#313244] hover:text-white"
      title="LLM Settings"
    >
      <Settings className="h-4 w-4" />
    </button>
  );
}
