import { CheckCircle2, RefreshCw, Trash2, Workflow, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { AgentHookEvent } from '../nightworkers/types';
import { Field, NumberField, SelectField } from '../settings/SettingsFields';
import {
  emptyHookForm,
  formFromAgentHook,
  hookEventOptions,
  hookFormToInput,
} from './agentHookSettingsForms';
import { useAgentHooks } from './useAgentHooks';

export function SettingsHooksPanel() {
  const { t } = useTranslation();
  const agentHooksSettings = useAgentHooks();
  const [hookForm, setHookForm] = useState(emptyHookForm);
  const [hookMessage, setHookMessage] = useState<string>('');
  const [hookMessageStatus, setHookMessageStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hookBusy, setHookBusy] = useState(false);

  const saveAgentHook = async () => {
    setHookBusy(true);
    setHookMessage('');
    setHookMessageStatus('idle');
    try {
      const input = hookFormToInput(hookForm);
      if (hookForm.id) {
        await agentHooksSettings.updateAgentHook(hookForm.id, input);
        setHookMessage('Agent Hook を更新しました');
        setHookMessageStatus('success');
      } else {
        const created = await agentHooksSettings.createAgentHook(input);
        setHookForm(formFromAgentHook(created));
        setHookMessage('Agent Hook を追加しました');
        setHookMessageStatus('success');
      }
    } catch (err) {
      setHookMessage(err instanceof Error ? err.message : String(err));
      setHookMessageStatus('error');
    } finally {
      setHookBusy(false);
    }
  };

  const testAgentHook = async (id: string) => {
    setHookBusy(true);
    setHookMessage('');
    setHookMessageStatus('idle');
    try {
      const result = await agentHooksSettings.testAgentHook(id);
      setHookMessage(`${result.ok ? 'OK' : 'NG'} ${result.message}`);
      setHookMessageStatus(result.ok ? 'success' : 'error');
    } catch (err) {
      setHookMessage(err instanceof Error ? err.message : String(err));
      setHookMessageStatus('error');
    } finally {
      setHookBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Workflow className="h-4 w-4 text-cyan-400" />
            {t('settings.hooks.title')}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">{t('settings.hooks.description')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setHookForm(emptyHookForm);
            setHookMessage('');
            setHookMessageStatus('idle');
          }}
          className="h-9 px-4 text-xs"
        >
          {t('settings.hooks.add')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          {agentHooksSettings.agentHooks.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-500">
              {t('settings.hooks.empty')}
            </p>
          ) : (
            agentHooksSettings.agentHooks.map((hook) => (
              <button
                key={hook.id}
                type="button"
                onClick={() => {
                  setHookForm(formFromAgentHook(hook));
                  setHookMessage('');
                  setHookMessageStatus('idle');
                }}
                className={`w-full rounded-lg border p-3 text-left text-xs ${
                  hookForm.id === hook.id
                    ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-100'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{hook.name}</span>
                  <span className={hook.enabled ? 'text-emerald-300' : 'text-zinc-500'}>
                    {hook.enabled ? t('settings.hooks.enabled') : t('settings.hooks.paused')}
                  </span>
                </div>
                <div className="mt-1 truncate text-[10px] text-zinc-500">
                  {hook.event} / {hook.matcher || '*'} / {hook.handler.type}
                </div>
                {hook.lastRun ? (
                  <div className="mt-1 truncate text-[10px] text-zinc-500">
                    {hook.lastRun.ok ? 'OK' : 'NG'}: {hook.lastRun.message}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              id="hook-name"
              label={t('settings.field.name')}
              value={hookForm.name}
              onChange={(value) => setHookForm((prev) => ({ ...prev, name: value }))}
            />
            <SelectField
              id="hook-event"
              label={t('settings.field.event')}
              value={hookForm.event}
              options={hookEventOptions}
              onChange={(value) =>
                setHookForm((prev) => ({
                  ...prev,
                  event: value as AgentHookEvent,
                }))
              }
            />
            <SelectField
              id="hook-handler"
              label={t('settings.field.handler')}
              value={hookForm.handlerType}
              options={[
                { value: 'command', label: 'Command' },
                { value: 'http', label: 'HTTP' },
              ]}
              onChange={(value) =>
                setHookForm((prev) => ({
                  ...prev,
                  handlerType: value as 'command' | 'http',
                }))
              }
            />
            <Field
              id="hook-matcher"
              label={t('settings.field.matcher')}
              value={hookForm.matcher}
              onChange={(value) => setHookForm((prev) => ({ ...prev, matcher: value }))}
            />
            <NumberField
              id="hook-timeout"
              label={t('settings.field.timeoutSeconds')}
              value={hookForm.timeoutSeconds}
              min={1}
              onChange={(value) =>
                setHookForm((prev) => ({ ...prev, timeoutSeconds: Math.min(value, 120) }))
              }
            />
            <label className="flex items-end gap-2 pb-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={hookForm.enabled}
                onChange={(event) =>
                  setHookForm((prev) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              {t('settings.hooks.enabled')}
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={hookForm.failClosed}
                onChange={(event) =>
                  setHookForm((prev) => ({ ...prev, failClosed: event.target.checked }))
                }
              />
              {t('settings.hooks.failClosed')}
            </label>
          </div>

          {hookForm.handlerType === 'command' ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                id="hook-command"
                label={t('settings.field.command')}
                value={hookForm.command}
                onChange={(value) => setHookForm((prev) => ({ ...prev, command: value }))}
              />
              <Field
                id="hook-args"
                label={t('settings.field.args')}
                value={hookForm.argsText}
                onChange={(value) => setHookForm((prev) => ({ ...prev, argsText: value }))}
              />
              <Field
                id="hook-cwd"
                label={t('settings.field.cwd')}
                value={hookForm.cwd}
                onChange={(value) => setHookForm((prev) => ({ ...prev, cwd: value }))}
              />
              <div className="space-y-1.5">
                <label htmlFor="hook-env" className="block text-[11px] font-semibold text-zinc-400">
                  {t('settings.field.nonSecretEnv')}
                </label>
                <textarea
                  id="hook-env"
                  value={hookForm.envText}
                  onChange={(event) =>
                    setHookForm((prev) => ({ ...prev, envText: event.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                  placeholder={t('settings.placeholder.keyValue')}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                id="hook-url"
                label={t('settings.field.url')}
                value={hookForm.url}
                onChange={(value) => setHookForm((prev) => ({ ...prev, url: value }))}
              />
              <div className="space-y-1.5">
                <label
                  htmlFor="hook-headers"
                  className="block text-[11px] font-semibold text-zinc-400"
                >
                  {t('settings.field.nonSecretHeaders')}
                </label>
                <textarea
                  id="hook-headers"
                  value={hookForm.headersText}
                  onChange={(event) =>
                    setHookForm((prev) => ({ ...prev, headersText: event.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100"
                  placeholder="X-Hook-Source=nightworkers"
                />
              </div>
            </div>
          )}

          <p className="text-[10px] text-zinc-500">{t('settings.hooks.note')}</p>
          <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
            {hookForm.id ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void testAgentHook(hookForm.id as string)}
                  disabled={hookBusy}
                  className="h-9 px-4 text-xs"
                >
                  {t('settings.hooks.test')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    if (!hookForm.id) return;
                    setHookBusy(true);
                    setHookMessage('');
                    setHookMessageStatus('idle');
                    try {
                      await agentHooksSettings.deleteAgentHook(hookForm.id);
                      setHookForm(emptyHookForm);
                      setHookMessage('Agent Hook を削除しました');
                      setHookMessageStatus('success');
                    } catch (err) {
                      setHookMessage(err instanceof Error ? err.message : String(err));
                      setHookMessageStatus('error');
                    } finally {
                      setHookBusy(false);
                    }
                  }}
                  disabled={hookBusy}
                  className="h-9 px-4 text-xs text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('settings.hooks.delete')}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              onClick={() => void saveAgentHook()}
              disabled={hookBusy}
              className="h-9 px-5 text-xs"
            >
              {hookBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
              {hookForm.id ? t('settings.hooks.update') : t('settings.hooks.add')}
            </Button>
          </div>
          {hookMessage ? (
            <p
              role={hookMessageStatus === 'error' ? 'alert' : 'status'}
              className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                hookMessageStatus === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              {hookMessageStatus === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{hookMessage}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
