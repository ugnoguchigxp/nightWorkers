import { ChevronDown, Database, Loader2, Send, Table2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type BlueprintDbDesignTarget,
  bindingCountForTable,
  buildBlueprintDbDesignPrompt,
  columnsForTable,
  relationsForTable,
  targetLabel,
} from './dbDesignModel';

type BlueprintDbDesignPanelProps = {
  id?: string;
  blueprint: Record<string, any>;
  screens: Array<Record<string, any>>;
  tables: Array<Record<string, any>>;
  bindings: Array<Record<string, any>>;
  validationIssues: Array<Record<string, any>>;
  adoption?: ReactNode;
  isSubmitting?: boolean;
  onSubmitDbDesignRequest?: (prompt: string) => Promise<void>;
};

export function BlueprintDbDesignPanel({
  id,
  blueprint,
  screens,
  tables,
  bindings,
  validationIssues,
  adoption,
  isSubmitting = false,
  onSubmitDbDesignRequest,
}: BlueprintDbDesignPanelProps) {
  const { t } = useTranslation();
  const relations = useMemo(
    () =>
      blueprint.databaseSchema && Array.isArray(blueprint.databaseSchema.relations)
        ? blueprint.databaseSchema.relations.filter(
            (relation: unknown): relation is Record<string, any> =>
              Boolean(relation && typeof relation === 'object' && !Array.isArray(relation))
          )
        : [],
    [blueprint.databaseSchema]
  );
  const blueprintId = String(blueprint.id || blueprint.name || 'draft-blueprint');
  const [target, setTarget] = useState<BlueprintDbDesignTarget>({ kind: 'schema' });
  const [prompt, setPrompt] = useState('');
  const [openTable, setOpenTable] = useState<string | null>(tables[0]?.name || null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isSubmitting || !onSubmitDbDesignRequest) return;
    await onSubmitDbDesignRequest(
      buildBlueprintDbDesignPrompt({
        blueprintId,
        currentBlueprint: blueprint,
        prompt: trimmed,
        target,
        validationIssues,
      })
    );
    setPrompt('');
  };

  return (
    <div id={id} className="blueprint-preview-card grid gap-3 rounded-lg border p-3 text-xs">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Database className="h-3.5 w-3.5 text-primary" />
            {t('blueprint.db.title')}
          </div>
          <p className="mt-1 text-muted-foreground leading-5">{t('blueprint.db.description')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {adoption}
          <Badge>{t('blueprint.db.tablesCount', { count: tables.length })}</Badge>
          <Badge>{t('blueprint.db.relationsCount', { count: relations.length })}</Badge>
          <Badge>{t('blueprint.db.bindingsCount', { count: bindings.length })}</Badge>
          <Badge tone={validationIssues.length === 0 ? 'success' : 'warning'}>
            {validationIssues.length === 0
              ? t('blueprint.db.valid')
              : t('blueprint.db.issuesCount', { count: validationIssues.length })}
          </Badge>
        </div>
      </header>

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-foreground">{t('blueprint.db.tables')}</h3>
          <button
            type="button"
            className={target.kind === 'schema' ? selectedTargetClass : targetButtonClass}
            onClick={() => setTarget({ kind: 'schema' })}
          >
            {t('blueprint.db.wholeSchema')}
          </button>
        </div>
        {tables.length > 0 ? (
          <div className="grid gap-2">
            {tables.map((table) => {
              const tableName = String(table.name || '');
              const columns = columnsForTable(table);
              const tableRelations = relationsForTable(tableName, relations);
              const tableBindingCount = bindingCountForTable(tableName, bindings);
              const isOpen = openTable === tableName;
              return (
                <article className="rounded border border-border bg-card" key={tableName}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-2 text-left"
                    onClick={() => setOpenTable(isOpen ? null : tableName)}
                  >
                    <Table2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-foreground">
                        {String(table.label || table.name)}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        <Badge>{t('blueprint.db.columnsCount', { count: columns.length })}</Badge>
                        <Badge>
                          {t('blueprint.db.indexesCount', {
                            count: Array.isArray(table.indexes) ? table.indexes.length : 0,
                          })}
                        </Badge>
                        <Badge>
                          {t('blueprint.db.bindingsCount', { count: tableBindingCount })}
                        </Badge>
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen ? (
                    <div className="grid gap-3 border-border border-t p-3">
                      <ColumnTable columns={columns} />
                      {tableRelations.length > 0 ? (
                        <div className="grid gap-1.5">
                          <div className="text-muted-foreground">{t('blueprint.db.relations')}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {tableRelations.map((relation, index) => (
                              <button
                                type="button"
                                className={
                                  target.kind === 'relation' &&
                                  target.relationId === String(relation.id || index)
                                    ? selectedTargetClass
                                    : targetButtonClass
                                }
                                key={String(relation.id || index)}
                                onClick={() =>
                                  setTarget({
                                    kind: 'relation',
                                    relationId: String(relation.id || index),
                                  })
                                }
                              >
                                {String(relation.fromTable)} -&gt; {String(relation.toTable)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <RelatedBindings
                          bindings={bindings.filter((binding) => binding.table === tableName)}
                          selectedTarget={target}
                          onSelect={setTarget}
                        />
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed border-border p-3 text-muted-foreground">
            {t('blueprint.db.noTables')}
          </div>
        )}
      </section>

      <BindingSummary bindings={bindings} selectedTarget={target} onSelect={setTarget} />
      <ScreenTargets screens={screens} selectedTarget={target} onSelect={setTarget} />

      <form className="grid gap-2 border-border border-t pt-3" onSubmit={handleSubmit}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-muted-foreground">
            {t('blueprint.db.selectedTarget')}{' '}
            <span className="font-semibold text-foreground">{targetLabel(target)}</span>
          </div>
          <span className="text-muted-foreground">{prompt.length}/4000</span>
        </div>
        <textarea
          className="min-h-24 resize-none rounded border border-input bg-background px-3 py-2 leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('blueprint.db.placeholder')}
          value={prompt}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            className="blueprint-preview-button inline-flex h-8 items-center gap-2 border border-border bg-primary px-3 font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!prompt.trim() || isSubmitting || !onSubmitDbDesignRequest}
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {t('blueprint.db.askAgent')}
          </button>
        </div>
      </form>
    </div>
  );
}

function ColumnTable({ columns }: { columns: Array<Record<string, unknown>> }) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto rounded border border-border bg-background">
      <table className="w-full min-w-[34rem] text-left text-[11px]">
        <thead className="text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">{t('blueprint.db.column')}</th>
            <th className="px-2 py-1.5 font-medium">{t('blueprint.db.type')}</th>
            <th className="px-2 py-1.5 font-medium">{t('blueprint.db.constraints')}</th>
            <th className="px-2 py-1.5 font-medium">{t('blueprint.db.ui')}</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr className="border-border border-t" key={String(column.name)}>
              <td className="px-2 py-1.5 font-mono text-foreground">{String(column.name)}</td>
              <td className="px-2 py-1.5 font-mono">{String(column.type || '')}</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {[
                  column.primaryKey ? 'PK' : '',
                  column.unique ? 'unique' : '',
                  column.nullable ? 'nullable' : 'not null',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">{String(column.uiHint || '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RelatedBindings({
  bindings,
  selectedTarget,
  onSelect,
}: {
  bindings: Array<Record<string, any>>;
  selectedTarget: BlueprintDbDesignTarget;
  onSelect: (target: BlueprintDbDesignTarget) => void;
}) {
  if (bindings.length === 0) {
    return <NoBindingsForTable />;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {bindings.map((binding) => (
        <button
          type="button"
          className={
            selectedTarget.kind === 'binding' && selectedTarget.bindingId === String(binding.id)
              ? selectedTargetClass
              : targetButtonClass
          }
          key={String(binding.id)}
          onClick={() => onSelect({ kind: 'binding', bindingId: String(binding.id) })}
        >
          {String(binding.id)}
        </button>
      ))}
    </div>
  );
}

function NoBindingsForTable() {
  const { t } = useTranslation();
  return <span className="text-muted-foreground">{t('blueprint.db.noBindingsForTable')}</span>;
}

function BindingSummary({
  bindings,
  selectedTarget,
  onSelect,
}: {
  bindings: Array<Record<string, any>>;
  selectedTarget: BlueprintDbDesignTarget;
  onSelect: (target: BlueprintDbDesignTarget) => void;
}) {
  const { t } = useTranslation();

  if (bindings.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h3 className="font-semibold text-foreground">{t('blueprint.db.bindings')}</h3>
      <div className="grid gap-1.5">
        {bindings.map((binding) => (
          <button
            type="button"
            className={`rounded border px-3 py-2 text-left ${
              selectedTarget.kind === 'binding' && selectedTarget.bindingId === String(binding.id)
                ? 'border-primary bg-primary/10'
                : 'border-border bg-card hover:bg-background'
            }`}
            key={String(binding.id)}
            onClick={() => onSelect({ kind: 'binding', bindingId: String(binding.id) })}
          >
            <span className="font-mono text-foreground">{String(binding.id)}</span>
            <span className="ml-2 text-muted-foreground">
              {String(binding.mode)} {String(binding.table)} [
              {Array.isArray(binding.fields) ? binding.fields.join(', ') : ''}]
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ScreenTargets({
  screens,
  selectedTarget,
  onSelect,
}: {
  screens: Array<Record<string, any>>;
  selectedTarget: BlueprintDbDesignTarget;
  onSelect: (target: BlueprintDbDesignTarget) => void;
}) {
  const { t } = useTranslation();
  const targets = screens.flatMap((screen) =>
    Array.isArray(screen.sections)
      ? screen.sections.map((section: Record<string, unknown>) => ({
          screenId: String(screen.id),
          sectionId: String(section.id),
          label: `${String(screen.name || screen.id)} / ${String(section.name || section.id)}`,
        }))
      : []
  );
  if (targets.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h3 className="font-semibold text-foreground">{t('blueprint.db.screenContext')}</h3>
      <div className="flex flex-wrap gap-1.5">
        {targets.map((item) => (
          <button
            type="button"
            className={
              selectedTarget.kind === 'screen' &&
              selectedTarget.screenId === item.screenId &&
              selectedTarget.sectionId === item.sectionId
                ? selectedTargetClass
                : targetButtonClass
            }
            key={`${item.screenId}:${item.sectionId}`}
            onClick={() =>
              onSelect({ kind: 'screen', screenId: item.screenId, sectionId: item.sectionId })
            }
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Badge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-500/10 text-emerald-700'
      : tone === 'warning'
        ? 'bg-amber-500/10 text-amber-700'
        : 'bg-muted text-muted-foreground';
  return <span className={`rounded px-2 py-1 ${toneClass}`}>{children}</span>;
}

const targetButtonClass =
  'inline-flex min-h-7 items-center rounded border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-background hover:text-foreground';
const selectedTargetClass =
  'inline-flex min-h-7 items-center rounded border border-primary bg-primary/10 px-2 py-1 font-semibold text-foreground';
