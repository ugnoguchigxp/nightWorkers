import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '../Input';
import { Switch } from '../Switch';
import { Textarea } from '../Textarea';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from './Field';

const meta: Meta<typeof Field> = {
  title: 'Components/Field',
  component: Field,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-6 bg-background max-w-md">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Field>;

export const Default: Story = {
  render: () => (
    <Field>
      <FieldLabel>Email</FieldLabel>
      <Input placeholder="hello@example.com" />
      <FieldDescription>Enter your email address.</FieldDescription>
    </Field>
  ),
};

export const WithTextarea: Story = {
  render: () => (
    <Field>
      <FieldLabel>Bio</FieldLabel>
      <Textarea placeholder="Tell us about yourself" />
      <FieldDescription>Max 500 characters.</FieldDescription>
    </Field>
  ),
};

export const AlignmentSamples: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {/* Horizontal Text Alignment Section */}
      <section className="space-y-4">
        <h3 className="font-bold border-b pb-2">Label Text Alignment</h3>
        <FieldGroup>
          <Field variant="inline">
            <FieldLabel className="w-32 text-left" nowrap>
              Left Align (Default)
            </FieldLabel>
            <Input placeholder="Label text-left" />
          </Field>
          <Field variant="inline">
            <FieldLabel className="w-32 text-center" nowrap>
              Center Align
            </FieldLabel>
            <Input placeholder="Label text-center" />
          </Field>
          <Field variant="inline">
            <FieldLabel className="w-32 text-right" nowrap>
              Right Align
            </FieldLabel>
            <Input placeholder="Label text-right" />
          </Field>
        </FieldGroup>
      </section>

      {/* Vertical Alignment Section */}
      <section className="space-y-4">
        <h3 className="font-bold border-b pb-2">Vertical Alignment (vAlign)</h3>
        <FieldGroup>
          <Field variant="inline" align="start">
            <FieldLabel className="w-32 mt-2" nowrap>
              Top (Start)
            </FieldLabel>
            <Textarea placeholder="align='start'" />
          </Field>
          <Field variant="inline" align="center">
            <FieldLabel className="w-32" nowrap>
              Center
            </FieldLabel>
            <Textarea placeholder="align='center'" />
          </Field>
          <Field variant="inline" align="endpoint">
            <FieldLabel className="w-32 mb-2" nowrap>
              Bottom (End)
            </FieldLabel>
            <Textarea placeholder="align='endpoint'" />
          </Field>
          <Field variant="inline" align="baseline">
            <FieldLabel className="w-32" nowrap>
              Baseline
            </FieldLabel>
            <Textarea placeholder="align='baseline' (Default)" />
          </Field>
        </FieldGroup>
      </section>
    </div>
  ),
};

export const Inline: Story = {
  render: () => (
    <FieldGroup>
      <Field variant="inline" align="center">
        <FieldLabel className="w-[100px]" nowrap>
          Center Align
        </FieldLabel>
        <Input placeholder="Aligned center" />
      </Field>
      <Field variant="inline" align="baseline">
        <FieldLabel className="w-[100px]" nowrap>
          Baseline
        </FieldLabel>
        <div className="flex flex-col gap-1 w-full">
          <Textarea placeholder="Multi-line input aligned baseline" />
          <FieldDescription>Label aligns with first line.</FieldDescription>
        </div>
      </Field>
      <Field variant="inline" align="start">
        <FieldLabel className="w-[100px] mt-2" nowrap>
          Top Align
        </FieldLabel>
        <div className="flex flex-col gap-1 w-full">
          <Textarea placeholder="Multi-line input aligned top" />
          <FieldDescription>Label aligns with top of container.</FieldDescription>
        </div>
      </Field>
    </FieldGroup>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field invalid>
      <FieldLabel>Username</FieldLabel>
      <Input placeholder="username" defaultValue="invalid user" />
      <FieldError>Username is already taken.</FieldError>
    </Field>
  ),
};

export const GroupedForm: Story = {
  render: () => (
    <FieldGroup>
      <div className="mb-2">
        <h3 className="text-lg font-medium">Profile Settings</h3>
        <p className="text-sm text-muted-foreground">Update your public profile.</p>
      </div>

      <Field>
        <FieldLabel>Display Name</FieldLabel>
        <Input defaultValue="Jane Doe" />
      </Field>

      <Field>
        <FieldLabel>Bio</FieldLabel>
        <Textarea placeholder="Write a short bio..." />
        <FieldDescription>Brief description for your profile card.</FieldDescription>
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>Public Profile</FieldLabel>
          <FieldDescription>Allow others to see your profile.</FieldDescription>
        </FieldContent>
        <Switch defaultChecked />
      </Field>
    </FieldGroup>
  ),
};
