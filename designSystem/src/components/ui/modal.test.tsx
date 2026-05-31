import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalTrigger } from './modal';

describe('Modal', () => {
  it('renders correctly as a variant of Dialog', async () => {
    render(
      <Modal>
        <ModalTrigger>Open Modal</ModalTrigger>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Modal Title</ModalTitle>
          </ModalHeader>
          <div>Modal Content</div>
        </ModalContent>
      </Modal>
    );

    await userEvent.click(screen.getByRole('button', { name: /open modal/i }));
    expect(await screen.findByText('Modal Title')).toBeInTheDocument();
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });
});
