import { Code2, Layers3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectStackProfile } from '../../../../../shared/schemas/project-detail.schema';
import { EmptyTableRow, KpiTile, SectionHeading, SectionLabel } from './ProjectDetailCommon';
import { panelStyle, subtleTextStyle, tableBorderStyle } from './styles';

export function StackSummaryBadge({ stackProfile }: { stackProfile: ProjectStackProfile }) {
  const { t } = useTranslation();
  const summary = stackProfile.summary || t('projectDetail.stack.unknown');
  return (
    <div
      className="flex min-h-8 max-w-full items-center gap-2 border px-3 text-xs font-semibold"
      style={{
        background: 'color-mix(in srgb, var(--nw-primary) 9%, var(--nw-panel))',
        borderColor: 'color-mix(in srgb, var(--nw-primary) 35%, var(--nw-border))',
        borderRadius: 'var(--nw-control-radius)',
        color: 'var(--nw-primary)',
      }}
      title={summary}
    >
      <Code2 className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{summary}</span>
    </div>
  );
}

export function StackProfilePanel({
  stackProfile,
  projectPath,
}: {
  stackProfile: ProjectStackProfile;
  projectPath: string;
}) {
  const { t } = useTranslation();
  const summary = stackProfile.summary || t('projectDetail.stack.unknown');
  return (
    <section className="space-y-3">
      <SectionHeading
        icon={<Layers3 className="h-4 w-4" />}
        title={t('projectDetail.stack.title')}
        description={t('projectDetail.stack.description')}
        aside={<StackSummaryBadge stackProfile={stackProfile} />}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <KpiTile
          label={t('projectDetail.stack.summary')}
          value={summary}
          sub={t('projectDetail.stack.summarySub')}
        />
        <KpiTile
          label={t('projectDetail.stack.packageManager')}
          value={stackProfile.packageManager || '—'}
          sub={t('projectDetail.stack.packageManagerSub')}
        />
        <KpiTile
          label={t('projectDetail.stack.manifest')}
          value={t(`projectDetail.stack.manifestStatus.${stackProfile.manifestStatus}`)}
          sub={projectPath}
        />
      </div>
      <div className="overflow-hidden border" style={panelStyle}>
        <div className="border-b p-3" style={tableBorderStyle}>
          <SectionLabel
            icon={<Code2 className="h-4 w-4" />}
            title={t('projectDetail.stack.detectedTechnologies')}
          />
        </div>
        <div className="nightworkers-scrollbar overflow-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">{t('projectDetail.field.technology')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.category')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.source')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.version')}</th>
                <th className="py-2 pr-4 text-right">{t('projectDetail.field.confidence')}</th>
              </tr>
            </thead>
            <tbody>
              {stackProfile.technologies.length > 0 ? (
                stackProfile.technologies.map((technology) => (
                  <tr
                    key={`${technology.name}:${technology.packageName ?? technology.source}`}
                    className="border-t"
                    style={tableBorderStyle}
                  >
                    <td className="py-3 pl-4">
                      <div className="font-semibold">{technology.name}</div>
                      <div className="text-[10px]" style={subtleTextStyle}>
                        {technology.packageName || '—'}
                      </div>
                    </td>
                    <td className="py-3">
                      {t(`projectDetail.stack.category.${technology.category}`)}
                    </td>
                    <td className="py-3">{t(`projectDetail.stack.source.${technology.source}`)}</td>
                    <td className="py-3 font-mono">{technology.version || '—'}</td>
                    <td className="py-3 pr-4 text-right">
                      {t(`projectDetail.stack.confidence.${technology.confidence}`)}
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow colSpan={5} message={t('projectDetail.stack.empty')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
