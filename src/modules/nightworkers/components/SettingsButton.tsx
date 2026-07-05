import { Section, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { handleWorkbenchAnchorClick } from '../routing/workbench-link-click';
import { serializeWorkbenchRoute } from '../routing/workbench-route-state';

export function SettingsButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <a
      href={serializeWorkbenchRoute({ kind: 'settings', section: 'general' })}
      onClick={(event) => handleWorkbenchAnchorClick(event, onClick)}
      className="nightworkers-settings-button fixed bottom-3 left-3 z-[90] flex h-10 w-10 items-center justify-center rounded-md border border-[#45475a] bg-[#1e1e2e] text-[#cdd6f4] shadow-none transition-colors hover:bg-[#313244] hover:text-white"
      title={t('settings.button.title')}
      aria-label={t('settings.button.title')}
    >
      <Settings className="h-5 w-5" />
    </a>
  );
}

export function BlueprintShowcaseButton() {
  return (
    <a
      href="/blueprint-showcase"
      className="nightworkers-blueprint-showcase-button fixed bottom-3 left-16 z-[90] flex h-10 items-center gap-2 rounded-md border border-[#45475a] bg-[#1e1e2e] px-3 text-[#cdd6f4] text-xs font-semibold shadow-none transition-colors hover:bg-[#313244] hover:text-white"
      title="Blueprint showcase"
      aria-label="Blueprint showcase"
    >
      <Section className="h-4 w-4" />
      <span>Blueprint showcase</span>
    </a>
  );
}
