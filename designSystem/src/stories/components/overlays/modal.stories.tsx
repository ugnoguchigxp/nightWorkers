import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../../../components/ui/button';
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalSubtitle,
  ModalTitle,
  ModalTrigger,
} from '../../../components/ui/modal';

const meta = {
  title: 'Components/Overlays/Modal',
  component: Modal,
  tags: ['autodocs'],
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Modal>
      <ModalTrigger>Open Modal</ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Delete this item?</ModalTitle>
          <ModalSubtitle>This action cannot be undone.</ModalSubtitle>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  ),
};
