import { ChevronDown, Database, Table2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { columnsForTable, relationsForTable } from './dbDesignModel';

type BlueprintDbDesignPanelProps = {
  id?: string;
  blueprint: Record<string, any>;
  tables: Array<Record<string, any>>;
  validationIssues: Array<Record<string, any>>;
  adoption?: ReactNode;
};

export function BlueprintDbDesignPanel({
  id,
  blueprint,
  tables,
  validationIssues,
  adoption,
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
  const [openTable, setOpenTable] = useState<string | null>(tables[0]?.name || null);

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
        </div>
        {tables.length > 0 ? (
          <div className="grid gap-2">
            {tables.map((table) => {
              const tableName = String(table.name || '');
              const columns = columnsForTable(table);
              const tableRelations = relationsForTable(tableName, relations);
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
                              <span className={targetBadgeClass} key={String(relation.id || index)}>
                                {String(relation.fromTable)} -&gt; {String(relation.toTable)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
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

const targetBadgeClass =
  'inline-flex min-h-7 items-center rounded border border-border bg-card px-2 py-1 text-muted-foreground hover:bg-background hover:text-foreground';
