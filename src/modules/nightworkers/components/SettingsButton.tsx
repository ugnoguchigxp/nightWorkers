import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function SettingsButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      className="nightworkers-settings-button fixed bottom-3 left-3 z-[90] flex h-10 w-10 items-center justify-center rounded-md border border-[#45475a] bg-[#1e1e2e] text-[#cdd6f4] shadow-none transition-colors hover:bg-[#313244] hover:text-white"
      title={t('settings.button.title')}
      aria-label={t('settings.button.title')}
    >
      <Settings className="h-5 w-5" />
    </button>
  );
}
