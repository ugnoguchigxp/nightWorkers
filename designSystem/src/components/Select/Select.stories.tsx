import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '../Field';
import { Switch } from '../Switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './Select';

const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-8 w-full flex justify-center bg-background min-h-[400px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Select>;

const items = [
  { label: 'Select a fruit', value: null },
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Blueberry', value: 'blueberry' },
  { label: 'Grapes', value: 'grapes' },
  { label: 'Pineapple', value: 'pineapple' },
];

export function SelectAlignExample() {
  const [alignItemWithTrigger, setAlignItemWithTrigger] = React.useState(true);
  const [isScrollable, setIsScrollable] = React.useState(true);

  return (
    <div className="flex flex-col gap-8 w-full max-w-sm">
      <FieldGroup className="w-full">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="align-item">Align Item</FieldLabel>
            <FieldDescription>Toggle to align the item with the trigger.</FieldDescription>
          </FieldContent>
          <Switch
            id="align-item"
            checked={alignItemWithTrigger}
            onCheckedChange={setAlignItemWithTrigger}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="scrollable">Scrollable</FieldLabel>
            <FieldDescription>Toggle max-height constraint.</FieldDescription>
          </FieldContent>
          <Switch id="scrollable" checked={isScrollable} onCheckedChange={setIsScrollable} />
        </Field>

        <Field>
          <FieldLabel>Fruit Selection</FieldLabel>
          {/* Use non-null assertion or fallback if value is possibly null */}
          <Select defaultValue={items[1]?.value ?? ''}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Fruits</SelectLabel>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
                {/* Simulate many items for scrolling */}
                {Array.from({ length: 20 }).map((_, i) => (
                  <SelectItem key={`extra-${i}`} value={`extra-${i}`}>
                    Extra Item {i}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <SelectAlignExample />,
};

export const Variants: Story = {
  render: () => (
    <div className="space-y-8 w-full max-w-sm">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Default</h3>
        <Select defaultValue="apple">
          <SelectTrigger variant="default">
            <SelectValue placeholder="Select a fruit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Ghost</h3>
        <Select defaultValue="apple">
          <SelectTrigger variant="ghost">
            <SelectValue placeholder="Select a fruit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Disabled</h3>
        <Select defaultValue="apple" disabled>
          <SelectTrigger>
            <SelectValue placeholder="Select a fruit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  ),
};
