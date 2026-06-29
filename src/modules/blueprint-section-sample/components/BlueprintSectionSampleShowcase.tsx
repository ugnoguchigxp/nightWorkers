import { Link } from '@tanstack/react-router';
import { ArrowLeft, Boxes, Section } from 'lucide-react';
import { blueprintCatalog } from '../../../../shared/blueprint-catalog';
import type { BlueprintComponentDefinition } from '../../../../shared/schemas/blueprint-catalog.schema';
import { BlueprintPreviewSection } from '../../blueprint-preview/BlueprintPreviewSection';
import '../../blueprint-preview/blueprintPreview.css';
import { sampleSectionProps } from '../section-samples';

const navigationComponentNames = new Set([
  'TopMenuSection',
  'TabNavigationSection',
  'SidebarMenuSection',
  'LeftSidebarSection',
  'ExplorerSidebarSection',
  'RightSidebarLinksSection',
  'FooterNavigationSection',
]);

const navigationDefinitions = blueprintCatalog.filter(
  (definition) =>
    definition.placement === 'section' && navigationComponentNames.has(definition.name)
);

const sectionDefinitions = blueprintCatalog.filter(
  (definition) =>
    definition.placement === 'section' && !navigationComponentNames.has(definition.name)
);

const sampleImage =
  'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20768%20432%22%3E%3Crect%20width=%22768%22%20height=%22432%22%20fill=%22%230f172a%22/%3E%3Cpath%20d=%22M0%20320L180%20230L310%20275L470%20145L768%20240V432H0Z%22%20fill=%22%2306b6d4%22%20opacity=%22.5%22/%3E%3Ccircle%20cx=%22615%22%20cy=%22108%22%20r=%2250%22%20fill=%22%23f59e0b%22%20opacity=%22.85%22/%3E%3C/svg%3E';

export function BlueprintSectionSampleShowcase() {
  return (
    <div className="min-h-screen bg-[#141416] text-zinc-100">
      <div className="mx-auto grid min-w-0 max-w-7xl gap-8 px-3 py-8 pb-20 sm:px-6">
        <header className="grid min-w-0 gap-5 border-zinc-800 border-b pb-6">
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            NightWorkers
          </Link>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-950/30 text-cyan-200">
                <Section className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-cyan-200">
                  Blueprint section samples
                </p>
                <h1 className="font-semibold text-3xl tracking-normal text-white">
                  Blueprint sections
                </h1>
              </div>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-zinc-400">
              Sample props and visual fixtures for section components accepted by the Blueprint
              catalog.
            </p>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <SummaryTile
              label="Section components"
              value={sectionDefinitions.length + navigationDefinitions.length}
            />
            <SummaryTile label="Navigation sections" value={navigationDefinitions.length} />
            <SummaryTile label="Preview cards" value={sectionDefinitions.length} />
          </div>
        </header>

        <section className="grid min-w-0 gap-4">
          <SectionHeading
            icon={Boxes}
            title="Navigation sections"
            description="Common application navigation surfaces used in real product screens."
          />
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            {navigationDefinitions.map((definition) => (
              <SectionComponentCard key={definition.name} definition={definition} />
            ))}
          </div>
        </section>

        <section className="grid min-w-0 gap-4">
          <SectionHeading
            icon={Boxes}
            title="Section components"
            description="Catalog entries validated as screen section components."
          />
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            {sectionDefinitions.map((definition) => (
              <SectionComponentCard key={definition.name} definition={definition} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function BlueprintSectionSampleShowcaseError() {
  return (
    <div className="min-h-screen bg-[#141416] px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-2xl rounded-md border border-red-900/60 bg-red-950/30 p-5">
        <h1 className="font-semibold text-lg text-white">
          Blueprint section samples failed to render.
        </h1>
        <p className="mt-2 text-sm leading-6 text-red-100">
          The section sample catalog could not be loaded in this route.
        </p>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950/70 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 font-semibold text-2xl text-white">{value}</div>
    </div>
  );
}

function SectionComponentCard({ definition }: { definition: BlueprintComponentDefinition }) {
  const sampleSection = sampleComponentSection(definition);
  return (
    <article key={definition.name} className="grid min-w-0 gap-3 border-zinc-800 border-b pb-6">
      <div className="grid gap-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words font-semibold text-base text-white">
            {sectionDisplayName(definition.name)}
          </h2>
        </div>
      </div>
      <div className="blueprint-preview min-w-0 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-ui">
        <BlueprintPreviewSection section={sampleSection} />
      </div>
    </article>
  );
}

function SectionHeading({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: typeof Section;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h2 className="font-semibold text-xl text-white">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p>
      </div>
    </div>
  );
}

function sampleComponentSection(definition: BlueprintComponentDefinition) {
  return {
    kind: 'component_section',
    id: definition.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    name: definition.name,
    componentName: definition.name,
    source: definition.allowedSources[0] || 'none',
    props: sampleComponentProps(definition),
    actions: [],
  };
}

function sampleComponentProps(definition: BlueprintComponentDefinition): Record<string, unknown> {
  const displayName = sectionDisplayName(definition.name);
  const base = {
    title: displayName,
    description: `Representative ${displayName} content.`,
  };

  return sampleSectionProps(definition.name, {
    base,
    sampleImage,
    sampleCards,
    sampleColumns,
    sampleRows,
  });
}

function sampleColumns() {
  return [
    { key: 'section', label: 'Section' },
    { key: 'source', label: 'Source' },
    { key: 'status', label: 'Status' },
  ];
}

function sampleRows() {
  return [
    { section: 'DataTableSection', source: 'table', status: 'ready' },
    { section: 'ChartSection', source: 'computed', status: 'mapped' },
    { section: 'FormSection', source: 'record', status: 'draft' },
    { section: 'KanbanSection', source: 'app', status: 'review' },
    { section: 'MapSection', source: 'api', status: 'queued' },
    { section: 'VideoSection', source: 'static', status: 'ready' },
    { section: 'EmailInboxSection', source: 'table', status: 'mapped' },
    { section: 'CodeEditorSection', source: 'markdown', status: 'draft' },
  ];
}

function sampleCards() {
  return [
    {
      title: 'Section shape',
      description: 'Shows the visible layout pattern and expected content density.',
      badge: 'preview',
    },
    {
      title: 'Data contract',
      description: 'Shows representative fields, rows, actions, or messages.',
      badge: 'mock',
    },
    {
      title: 'Review signal',
      description: 'Makes the section easier to accept, revise, or remove.',
      badge: 'review',
    },
    {
      title: 'Source mapping',
      description: 'Connects the section to static, table, API, or app context.',
      badge: 'source',
    },
    {
      title: 'Interaction model',
      description: 'Shows the controls, commands, or transitions users expect.',
      badge: 'flow',
    },
    {
      title: 'Implementation note',
      description: 'Captures the handoff detail needed for build planning.',
      badge: 'handoff',
    },
  ];
}

function sectionDisplayName(componentName: string) {
  return componentName.replace(/Section$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}
