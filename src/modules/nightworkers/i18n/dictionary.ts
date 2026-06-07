import type { NightWorkersLanguage } from '../types';
import { enDictionary } from './dictionaries/en';
import { jaDictionary } from './dictionaries/ja';

export const DEFAULT_LANGUAGE: NightWorkersLanguage = 'ja';

export const dictionary = {
  ja: jaDictionary,
  en: enDictionary,
} as const;

export const resources = {
  ja: { translation: dictionary.ja },
  en: { translation: dictionary.en },
} as const;

export type DictionaryKey = keyof typeof dictionary.ja;

export function t(language: NightWorkersLanguage | undefined, key: DictionaryKey) {
  const lang = language === 'en' ? 'en' : DEFAULT_LANGUAGE;
  return dictionary[lang][key] || dictionary.ja[key];
}
