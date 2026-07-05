export const PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY =
  'nightworkers.planMode.sequentialAutoGenerate';

export function readPlanModeSequentialAutoGeneratePreference(storage?: Storage | null) {
  try {
    const source = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    return source?.getItem(PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writePlanModeSequentialAutoGeneratePreference(
  enabled: boolean,
  storage?: Storage | null
) {
  try {
    const source = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    if (!source) return;
    source.setItem(PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage is a UI preference only; the Status flow still works without persistence.
  }
}
