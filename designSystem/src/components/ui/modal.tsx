import * as React from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

const Modal = Dialog;
const ModalTrigger = DialogTrigger;
const ModalClose = DialogClose;
const ModalContent = DialogContent;
const ModalHeader = DialogHeader;
const ModalFooter = DialogFooter;
const ModalTitle = DialogTitle;

const ModalSubtitle = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentProps<typeof DialogDescription>
>((props, ref) => <DialogDescription ref={ref} {...props} />);
ModalSubtitle.displayName = 'ModalSubtitle';

export {
  Modal,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalSubtitle,
  ModalTitle,
  ModalTrigger,
};
