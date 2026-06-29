import type { AppCurrency, AppLanguage } from './types';

export function formatTokenCount(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function formatCurrency(value: number | null, currency: AppCurrency, language: AppLanguage) {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 4,
  }).format(value);
}

export function formatDateTime(value: string | null, language: AppLanguage, timezone: string) {
  if (!value) return 'N/A';
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}
