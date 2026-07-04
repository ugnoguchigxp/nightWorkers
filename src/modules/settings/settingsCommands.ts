import { apiFetch } from '../../lib/api-base';
import { jsonRequest } from '../../lib/api-request';
import type {
  GeneralSettings,
  LlmProviderEndpoint,
  LlmSettings,
  TestQualitySettings,
} from '../nightworkers/types';

export function fetchLlmSettings() {
  return apiFetch('/api/settings/llm');
}

export function saveLlmSettings(settings: LlmSettings) {
  return apiFetch('/api/settings/llm', jsonRequest('POST', settings));
}

export function fetchGeneralSettings(init?: RequestInit) {
  return apiFetch('/api/settings/general', init);
}

export function saveGeneralSettings(settings: GeneralSettings) {
  return apiFetch('/api/settings/general', jsonRequest('POST', settings));
}

export function refreshFxRates() {
  return apiFetch('/api/settings/fx/refresh', { method: 'POST' });
}

export function fetchPricingRows() {
  return apiFetch('/api/settings/pricing');
}

export function importPublicPricingRows() {
  return apiFetch('/api/settings/pricing/import-public', { method: 'POST' });
}

export function fetchTestQualitySettings(repositoryId: string) {
  return apiFetch(`/api/repositories/${repositoryId}/settings/test-quality`);
}

export function saveTestQualitySettings(repositoryId: string, settings: TestQualitySettings) {
  return apiFetch(
    `/api/repositories/${repositoryId}/settings/test-quality`,
    jsonRequest('PUT', settings)
  );
}

export function fetchLlmModelOptions() {
  return apiFetch('/api/settings/llm/models');
}

export function fetchCodexSdkStatus() {
  return apiFetch('/api/settings/codex/status');
}

export function runLlmSmokeTest() {
  return apiFetch('/api/settings/llm/smoke', { method: 'POST' });
}

export function testLlmProviderHealth(id: string, endpoint?: LlmProviderEndpoint) {
  return apiFetch(`/api/settings/llm/providers/${encodeURIComponent(id)}/health`, {
    method: 'POST',
    ...(endpoint
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) }
      : {}),
  });
}
