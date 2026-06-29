import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { apiFetch } from '../lib/api-base';
import { i18next } from './setup';
import type { AppLanguage } from './types';

type GeneralSettingsResponse = {
  language?: AppLanguage;
};

export function AppI18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cancelled = false;

    async function loadLanguage() {
      try {
        const res = await fetchGeneralSettings();
        if (!res.ok) return;
        const settings = (await res.json()) as GeneralSettingsResponse;
        if (cancelled || !settings.language) return;
        await applyAppLanguage(settings.language);
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

export async function applyAppLanguage(language: AppLanguage) {
  await i18next.changeLanguage(language);
  document.documentElement.lang = language;
}

function fetchGeneralSettings(init?: RequestInit) {
  return apiFetch('/api/settings/general', init);
}
