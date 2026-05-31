import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from '../components/ui/checkbox';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxTrigger,
} from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { InputGroup, InputGroupLabel } from '../components/ui/input-group';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '../components/ui/input-otp';
import { Label } from '../components/ui/label';
import { Radio } from '../components/ui/radio';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';

const meta = {
  title: 'Components/Forms & Selection',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Showcase: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <section className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" placeholder="name@example.com" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="message">Message</Label>
          <Textarea id="message" placeholder="Type your message..." />
        </div>
        <InputGroup className="max-w-sm">
          <InputGroupLabel htmlFor="project-name">Project Name</InputGroupLabel>
          <Input id="project-name" placeholder="hono-standard" />
        </InputGroup>
      </section>

      <section className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <Checkbox id="agree" defaultChecked />
          <Label htmlFor="agree">Agree</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="notify">Notify</Label>
          <Switch id="notify" defaultChecked />
        </div>
        <div className="flex items-center gap-2">
          <Radio value="radio-only" id="radio-only" />
          <Label htmlFor="radio-only">Radio</Label>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <RadioGroup defaultValue="option-1" className="gap-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="option-1" id="option-1" />
            <Label htmlFor="option-1">Option 1</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="option-2" id="option-2" />
            <Label htmlFor="option-2">Option 2</Label>
          </div>
        </RadioGroup>

        <Select defaultValue="apple">
          <SelectTrigger>
            <SelectValue placeholder="Select fruit" />
          </SelectTrigger>
          <SelectContent>
            <SelectLabel>Fruits</SelectLabel>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectItem value="orange">Orange</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Combobox defaultValue="react">
          <div className="relative">
            <ComboboxInput placeholder="Select framework..." />
            <ComboboxTrigger />
          </div>
          <ComboboxContent>
            <ComboboxEmpty>No framework found.</ComboboxEmpty>
            <ComboboxGroup>
              <ComboboxLabel>Frameworks</ComboboxLabel>
              <ComboboxItem value="react">React</ComboboxItem>
              <ComboboxItem value="vue">Vue</ComboboxItem>
              <ComboboxItem value="svelte">Svelte</ComboboxItem>
            </ComboboxGroup>
          </ComboboxContent>
        </Combobox>

        <InputOTP>
          <InputOTPGroup>
            <InputOTPSlot defaultValue="1" />
            <InputOTPSlot />
            <InputOTPSlot />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot />
            <InputOTPSlot />
            <InputOTPSlot />
          </InputOTPGroup>
        </InputOTP>
      </section>
    </div>
  ),
};
