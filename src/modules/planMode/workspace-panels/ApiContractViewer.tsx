import { Download } from 'lucide-react';
import type { PlanModeWorkspaceArtifact } from '../../nightworkers/types';
import {
  firstRecord,
  isRecord,
  stringValue,
  toNumberArray,
  toRecordArray,
  toStringArray,
} from './record-utils';

export function ApiContractViewer({
  artifact,
  apiContract,
}: {
  artifact: PlanModeWorkspaceArtifact | null;
  apiContract: Record<string, unknown>;
}) {
  const title = stringValue(apiContract.title) || artifact?.title || 'API Contract';
  const summary = stringValue(apiContract.summary);
  const openapi = firstRecord(apiContract.openapi);
  const paths = firstRecord(openapi?.paths);
  const stateTransitions = toRecordArray(apiContract.stateTransitions);
  const validation = toRecordArray(apiContract.validation);
  const operations = apiContractOperations(paths);
  const rawJson = JSON.stringify(apiContract, null, 2);

  function handleDownload() {
    const blob = new Blob([rawJson], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugFileName(title)}.openapi.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-3 text-xs">
      <div className="rounded border border-slate-800 bg-slate-950/20 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-slate-100">{title}</div>
            <div className="mt-1 text-slate-500">
              {artifact?.kind || 'api_io_contract'}{' '}
              {artifact?.sourceMessageId ? `message ${artifact.sourceMessageId.slice(0, 8)}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-950/90 text-slate-200 hover:border-cyan-400/70 hover:text-cyan-100"
            title="Download OpenAPI JSON"
            aria-label="Download OpenAPI JSON"
            onClick={handleDownload}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
        {summary ? <p className="mt-2 text-slate-400">{summary}</p> : null}
      </div>

      <div className="grid gap-2">
        {operations.length > 0 ? (
          operations.map((operation) => (
            <ApiOperationPanel
              key={`${operation.method}-${operation.path}-${operation.operationId}`}
              operation={operation}
              transitions={stateTransitions.filter(
                (transition) => stringValue(transition.operationId) === operation.operationId
              )}
            />
          ))
        ) : (
          <div className="rounded border border-amber-700/70 bg-amber-950/20 p-3 text-amber-100">
            OpenAPI paths are empty.
          </div>
        )}
      </div>

      {validation.length > 0 ? (
        <div className="rounded border border-slate-800 bg-slate-950/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">Validation</div>
          <div className="grid gap-2">
            {validation.map((item, index) => (
              <div
                key={`${stringValue(item.schemaName)}-${index}`}
                className="rounded border border-slate-800 bg-slate-950/30 p-2"
              >
                <div className="font-semibold text-slate-100">
                  {stringValue(item.schemaName) || 'Schema'}
                </div>
                <div className="mt-1 text-slate-500">
                  {[
                    stringValue(item.owner),
                    stringValue(item.strictness),
                    stringValue(item.zodOwnerFile),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="mt-2 grid gap-1">
                  {toRecordArray(item.examples).map((example, exampleIndex) => (
                    <div
                      key={`${stringValue(example.name)}-${exampleIndex}`}
                      className="rounded border border-slate-800 bg-slate-950/40 p-2"
                    >
                      <div className="font-medium text-slate-200">
                        {stringValue(example.name) || 'Example'}:{' '}
                        {example.valid === true ? 'valid' : 'invalid'}
                      </div>
                      {toStringArray(example.expectedIssues).length > 0 ? (
                        <div className="mt-1 text-amber-200">
                          {toStringArray(example.expectedIssues).join(' / ')}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <details className="rounded border border-slate-800 bg-slate-950/20 p-3">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase text-slate-300">
          Raw OpenAPI JSON
        </summary>
        <pre className="nightworkers-code-block mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-[11px] text-slate-200">
          <code>{rawJson}</code>
        </pre>
      </details>
    </div>
  );
}

function ApiOperationPanel({
  operation,
  transitions,
}: {
  operation: {
    path: string;
    method: string;
    operationId: string;
    summary: string;
    description: string;
    responses: Record<string, unknown>;
  };
  transitions: Array<Record<string, unknown>>;
}) {
  const responseEntries = Object.entries(operation.responses);
  return (
    <div className="rounded border border-cyan-500/30 bg-slate-950/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-cyan-100">
          {operation.method.toUpperCase()}
        </span>
        <span className="font-mono text-sm text-slate-100">{operation.path}</span>
        <span className="text-[11px] text-slate-500">{operation.operationId}</span>
      </div>
      {operation.summary ? (
        <div className="mt-2 font-medium text-slate-200">{operation.summary}</div>
      ) : null}
      {operation.description ? (
        <p className="mt-1 text-slate-400">{operation.description}</p>
      ) : null}
      <div className="mt-3 grid gap-2">
        {responseEntries.map(([status, response]) => (
          <div key={status} className="rounded border border-slate-800 bg-slate-950/40 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-cyan-100">{status}</span>
              <span className="text-slate-300">{responseDescription(response)}</span>
            </div>
          </div>
        ))}
      </div>
      {transitions.length > 0 ? (
        <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-950/10 p-2">
          <div className="text-[11px] font-semibold uppercase text-emerald-100">
            State transitions
          </div>
          <div className="mt-2 grid gap-1 text-emerald-50">
            {transitions.map((transition, index) => (
              <div key={`${stringValue(transition.operationId)}-${index}`}>
                {(stringValue(transition.fromState) || 'unknown') +
                  ' -> ' +
                  (stringValue(transition.toState) || 'unknown')}{' '}
                ({String(transition.successStatus || '')}
                {toNumberArray(transition.conflictStatuses).length > 0
                  ? `; conflicts ${toNumberArray(transition.conflictStatuses).join(', ')}`
                  : ''}
                {stringValue(transition.stateField)
                  ? `; ${stringValue(transition.stateField)}`
                  : ''}
                )
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function apiContractOperations(paths: Record<string, unknown> | null) {
  if (!paths) return [];
  const methodOrder = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
  const methodRank = new Map(methodOrder.map((method, index) => [method, index]));
  return Object.entries(paths).flatMap(([path, methods]) => {
    if (!isRecord(methods)) return [];
    return Object.entries(methods)
      .filter(([method, operation]) => methodRank.has(method.toLowerCase()) && isRecord(operation))
      .sort(([a], [b]) => {
        return (methodRank.get(a.toLowerCase()) ?? 99) - (methodRank.get(b.toLowerCase()) ?? 99);
      })
      .map(([method, operation]) => {
        const record = operation as Record<string, unknown>;
        return {
          path,
          method,
          operationId: stringValue(record.operationId) || `${method}-${path}`,
          summary: stringValue(record.summary),
          description: stringValue(record.description),
          responses: firstRecord(record.responses) || {},
        };
      });
  });
}

function responseDescription(value: unknown) {
  if (!isRecord(value)) return '';
  return stringValue(value.description) || 'Response';
}

function slugFileName(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'api-contract'
  );
}
