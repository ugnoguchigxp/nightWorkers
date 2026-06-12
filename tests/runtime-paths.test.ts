import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getResourceRoot, getRuntimePaths, isDesktopMode } from '../api/runtime/paths';

describe('runtime paths', () => {
  it('keeps development settings under api/.runtime by default', () => {
    const paths = getRuntimePaths({});
    expect(paths.runtimeRoot).toBe(path.resolve(process.cwd()));
    expect(paths.settingsDir).toBe(path.resolve(process.cwd(), 'api/.runtime'));
    expect(paths.logsDir).toBe(path.resolve(process.cwd(), 'logs'));
  });

  it('uses desktop runtime root for writable state', () => {
    const paths = getRuntimePaths({
      NIGHTWORKERS_DESKTOP: '1',
      NIGHTWORKERS_RUNTIME_DIR: '/tmp/nightworkers-app',
    });
    expect(paths.runtimeRoot).toBe('/tmp/nightworkers-app');
    expect(paths.settingsDir).toBe('/tmp/nightworkers-app/settings');
    expect(paths.logsDir).toBe('/tmp/nightworkers-app/logs');
    expect(paths.databasePath).toBe('/tmp/nightworkers-app/sqlite.db');
  });

  it('defaults desktop runtime state to project data when no runtime dir is set', () => {
    const paths = getRuntimePaths({
      NIGHTWORKERS_DESKTOP: '1',
      NIGHTWORKERS_RESOURCE_DIR: '/repo/nightWorkers',
    });
    expect(paths.runtimeRoot).toBe('/repo/nightWorkers/data');
    expect(paths.settingsDir).toBe('/repo/nightWorkers/data/settings');
    expect(paths.logsDir).toBe('/repo/nightWorkers/data/logs');
    expect(paths.databasePath).toBe('/repo/nightWorkers/data/sqlite.db');
  });

  it('keeps bundled resources separate from runtime state', () => {
    expect(isDesktopMode({ NIGHTWORKERS_DESKTOP: 'true' })).toBe(true);
    expect(getResourceRoot({ NIGHTWORKERS_RESOURCE_DIR: '/tmp/resources' })).toBe('/tmp/resources');
  });
});
