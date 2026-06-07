import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

export function installSupervisorLlmProviderEnvHooks() {
  const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
  const originalOpenAiEnabled = process.env.OPENAI_ENABLED;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  const originalOpenAiModel = process.env.OPENAI_MODEL;
  const originalStreaming = process.env.OPENAI_STREAMING_ENABLED;
  const originalFixtureOutput = process.env.SUPERVISOR_FIXTURE_OUTPUT;
  const originalFixtureRound1Output = process.env.SUPERVISOR_FIXTURE_ROUND1_OUTPUT;
  const originalFixtureRound2Output = process.env.SUPERVISOR_FIXTURE_ROUND2_OUTPUT;
  const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
  const originalFetch = globalThis.fetch;
  let tempDir: string | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-llm-provider-'));
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = path.join(tempDir, 'llm-settings.json');
  });

  afterEach(() => {
    restoreEnv('ACTIVE_LLM_PROVIDER', originalProvider);
    restoreEnv('OPENAI_ENABLED', originalOpenAiEnabled);
    restoreEnv('OPENAI_API_KEY', originalOpenAiApiKey);
    restoreEnv('OPENAI_MODEL', originalOpenAiModel);
    restoreEnv('OPENAI_STREAMING_ENABLED', originalStreaming);
    restoreEnv('SUPERVISOR_FIXTURE_OUTPUT', originalFixtureOutput);
    restoreEnv('SUPERVISOR_FIXTURE_ROUND1_OUTPUT', originalFixtureRound1Output);
    restoreEnv('SUPERVISOR_FIXTURE_ROUND2_OUTPUT', originalFixtureRound2Output);
    restoreEnv('NIGHTWORKERS_LLM_SETTINGS_PATH', originalSettingsPath);
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
