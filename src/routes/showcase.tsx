import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import {
  PreviewBadge,
  PreviewButton,
  PreviewCard,
  PreviewField,
  PreviewProgress,
  PreviewTable,
} from '../modules/blueprint-preview/BlueprintPreviewPrimitives';

export const Route = createFileRoute('/showcase')({
  component: ShowcasePage,
});

function ShowcasePage() {
  const [progress, setProgress] = useState(42);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 pb-24">
      <header className="space-y-2">
        <h1 className="font-bold text-3xl tracking-tight text-foreground">NightWorkers UI</h1>
        <p className="max-w-2xl text-muted-foreground text-sm leading-6">
          Local UI primitives owned by the NightWorkers app.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold text-foreground text-xl">App Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-foreground text-xl">Code Block</h2>
        <CodeBlock
          data={[
            {
              filename: 'example.ts',
              language: 'typescript',
              code: "export function greet(name: string) {\n  return 'Hello ' + name;\n}",
            },
            {
              filename: 'package.json',
              language: 'json',
              code: '{\n  "name": "nightworkers"\n}',
            },
          ]}
          maxHeight={260}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-foreground text-xl">Blueprint Preview Primitives</h2>
        <div className="blueprint-preview grid gap-[var(--blueprint-preview-gap)] rounded-xl border border-border p-4 text-ui">
          <div className="flex flex-wrap items-center gap-2">
            <PreviewButton>Primary action</PreviewButton>
            <PreviewButton tone="secondary">Secondary action</PreviewButton>
            <PreviewBadge>Queued</PreviewBadge>
            <PreviewBadge tone="success">Valid</PreviewBadge>
            <PreviewBadge tone="warning">Needs review</PreviewBadge>
          </div>
          <PreviewCard className="grid gap-3 p-3">
            <PreviewField>Search blueprint sections</PreviewField>
            <PreviewProgress label="Implementation coverage" value={progress} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-fit"
              onClick={() => setProgress((value) => (value + 13) % 101)}
            >
              Update progress
            </Button>
          </PreviewCard>
          <PreviewTable
            columns={[
              { key: 'section', label: 'Section' },
              { key: 'status', label: 'Status' },
            ]}
            rows={[
              { section: 'Search header', status: 'Ready' },
              { section: 'Table workspace', status: 'Mapped' },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
