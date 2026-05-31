import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/components/Button';

import { DropdownMenu } from './DropdownMenu';

const meta: Meta<typeof DropdownMenu> = {
  title: 'Components/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <>
        <div
          style={{
            padding: '2rem',
            backgroundColor: 'hsl(var(--background))',
            minHeight: '60vh',
          }}
        >
          <Story />
        </div>
      </>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DropdownMenu>;

export const Default: Story = {
  render: () => (
    <DropdownMenu
      trigger={<Button variant="outline">Open menu</Button>}
      items={[
        { label: 'Item A', onClick: () => {} },
        { label: 'Item B', onClick: () => {} },
        { label: 'Item C', onClick: () => {} },
      ]}
      align="start"
    />
  ),
};

export const Alignment: Story = {
  render: () => (
    <div className="flex gap-8 justify-center w-full">
      <div className="flex flex-col items-center gap-2">
        <div className="text-sm font-semibold">Left (Start)</div>
        <DropdownMenu
          trigger={<Button variant="outline">Left</Button>}
          items={[
            { label: 'Aligned Left', onClick: () => {} },
            { label: 'Item 2', onClick: () => {} },
          ]}
          align="left"
        />
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="text-sm font-semibold">Center</div>
        <DropdownMenu
          trigger={<Button variant="outline">Center</Button>}
          items={[
            { label: 'Aligned Center', onClick: () => {} },
            { label: 'Item 2', onClick: () => {} },
          ]}
          align="center"
        />
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="text-sm font-semibold">Right (End)</div>
        <DropdownMenu
          trigger={<Button variant="outline">Right</Button>}
          items={[
            { label: 'Aligned Right', onClick: () => {} },
            { label: 'Item 2', onClick: () => {} },
          ]}
          align="right"
        />
      </div>
    </div>
  ),
};

export const Scrollable: Story = {
  render: () => (
    <DropdownMenu
      trigger={<Button variant="outline">Open scrollable menu (Default 5)</Button>}
      items={Array.from({ length: 30 }).map((_, i) => ({
        label: `Scrollable Item ${i + 1}`,
        onClick: () => {},
      }))}
      visibleItemCount={5}
    />
  ),
};

export const CustomVisibleCount: Story = {
  render: () => (
    <div className="flex flex-wrap gap-8 justify-center w-full">
      {[5, 6, 7, 8].map((count) => (
        <div key={count} className="flex flex-col items-center gap-2">
          <div className="text-sm font-semibold">{count} Items Visible</div>
          <DropdownMenu
            trigger={<Button variant="outline">Open ({count} items)</Button>}
            items={Array.from({ length: 20 }).map((_, i) => ({
              label: `Item ${i + 1}`,
              onClick: () => {},
            }))}
            visibleItemCount={count}
          />
        </div>
      ))}
    </div>
  ),
};

export const AutoFlipNearEdges: Story = {
  render: () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div className="rounded border border-border bg-card p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Near right edge</div>
        <div className="flex justify-end">
          <DropdownMenu
            trigger={<Button variant="outline">Open</Button>}
            items={Array.from({ length: 8 }).map((_, i) => ({
              label: `Menu item ${i + 1}`,
              onClick: () => {},
            }))}
            align="right"
          />
        </div>
      </div>

      <div className="rounded border border-border bg-card p-4">
        <div className="text-sm font-semibold text-foreground mb-2">Near bottom edge</div>
        <div className="h-56 flex items-end">
          <DropdownMenu
            trigger={<Button variant="outline">Open</Button>}
            items={Array.from({ length: 12 }).map((_, i) => ({
              label: `Menu item ${i + 1}`,
              onClick: () => {},
            }))}
            align="left"
          />
        </div>
      </div>
    </div>
  ),
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: 'iphone6' },
    layout: 'fullscreen',
  },
  render: () => (
    <div className="p-4 min-h-screen bg-background">
      <div className="text-sm text-muted-foreground mb-3">
        Mobile viewport (use toolbar to switch sizes)
      </div>
      <div className="flex justify-between items-center">
        <div className="text-sm font-semibold text-foreground">Header</div>
        <DropdownMenu
          trigger={<Button variant="outline">Menu</Button>}
          items={Array.from({ length: 14 }).map((_, i) => ({
            label: `Menu item ${i + 1}`,
            onClick: () => {},
          }))}
          align="right"
        />
      </div>
      <div className="mt-6 h-[70vh] rounded border border-border bg-card p-3 text-sm text-muted-foreground">
        Scroll/space placeholder
      </div>
    </div>
  ),
};
