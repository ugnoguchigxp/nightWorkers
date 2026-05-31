import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { FileTree, type FileTreeItem } from './FileTree';

const meta: Meta<typeof FileTree> = {
  title: 'Components/FileTree',
  component: FileTree,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[300px] border rounded-md p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const initialItems: FileTreeItem[] = [
  {
    id: '1',
    name: 'components',
    items: [
      {
        id: '1-1',
        name: 'ui',
        items: [
          { id: '1-1-1', name: 'button.tsx' },
          { id: '1-1-2', name: 'card.tsx' },
        ],
      },
      { id: '1-2', name: 'header.tsx' },
    ],
  },
  {
    id: '2',
    name: 'lib',
    items: [{ id: '2-1', name: 'utils.ts' }],
  },
  { id: '3', name: 'app.tsx' },
  { id: '4', name: 'package.json' },
];

export const Default: Story = {
  args: {
    items: initialItems,
    setItems: () => {},
  },
  render: () => {
    const [items, setItems] = React.useState(initialItems);
    return <FileTree items={items} setItems={setItems} />;
  },
};
