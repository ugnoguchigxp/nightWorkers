import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { apiFetch } from '../../../lib/api-base';
import { i18next } from './setup';

type GeneralSettingsResponse = {
  language?: 'ja' | 'en';
};

export function NightWorkersI18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cancelled = false;

    async function loadLanguage() {
      try {
        const res = await apiFetch('/api/settings/general');
        if (!res.ok) return;
        const settings = (await res.json()) as GeneralSettingsResponse;
        if (cancelled || !settings.language) return;
        await applyNightWorkersLanguage(settings.language);
      } catch {
        // The default Japanese UI remains available if runtime settings cannot be loaded.
      }
    }

    void loadLanguage();

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}

export async function applyNightWorkersLanguage(language: 'ja' | 'en') {
  await i18next.changeLanguage(language);
  document.documentElement.lang = language;
}
