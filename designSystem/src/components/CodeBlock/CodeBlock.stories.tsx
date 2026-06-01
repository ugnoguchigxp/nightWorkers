import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeBlock } from './CodeBlock';

const meta: Meta<typeof CodeBlock> = {
  title: 'Components/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-full p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CodeBlock>;

const reactExample = `type WorkerStatus = 'running' | 'needs_review' | 'failed';

export function RunStatusBadge({ status }: { status: WorkerStatus }) {
  return (
    <span data-status={status}>
      {status.replace('_', ' ')}
    </span>
  );
}`;

export const Default: Story = {
  args: {
    data: [
      {
        filename: 'RunStatusBadge.tsx',
        language: 'tsx',
        code: reactExample,
      },
    ],
  },
};

export const MultipleFiles: Story = {
  args: {
    data: [
      {
        filename: 'runner.ts',
        language: 'typescript',
        code: `export async function startRun(runId: string) {
  await emitEvent(runId, 'state_change', { status: 'running' });
  await collectGitStatus(runId);
}`,
      },
      {
        filename: 'package.json',
        language: 'json',
        code: `{
  "scripts": {
    "verify": "pnpm typecheck && pnpm test run"
  }
}`,
      },
      {
        filename: 'verify.sh',
        language: 'bash',
        code: `pnpm typecheck
pnpm test run`,
      },
    ],
  },
};

export const Diff: Story = {
  args: {
    data: [
      {
        filename: 'worker-tools.ts',
        language: 'typescript',
        code: `export const commandPolicy = {
  allowNetwork: true, // [!code --]
  allowNetwork: false, // [!code ++]
  requireReadBeforeEdit: true,
};`,
      },
    ],
  },
};

export const HighlightedLines: Story = {
  args: {
    data: [
      {
        filename: 'supervisor-loop.ts',
        language: 'typescript',
        code: `if (decision.riskLevel === 'high') {
  await markRunNeedsHuman(run.id); // [!code highlight]
  return;
}

await worker.sendInstruction(decision.instruction);`,
      },
    ],
  },
};

export const Numberless: Story = {
  args: {
    data: [
      {
        filename: '.env.example',
        language: 'bash',
        code: `DATABASE_URL=sqlite.db
AUTH_MODE=local
VITE_ENABLE_MSW=false`,
      },
    ],
    lineNumbers: false,
  },
};

export const PlainText: Story = {
  args: {
    data: [
      {
        filename: 'run.log',
        language: 'text',
        code: `[10:41:02] context_compile completed
[10:41:03] git_status dirty=false
[10:41:04] verification passed`,
      },
    ],
    syntaxHighlighting: false,
  },
};
