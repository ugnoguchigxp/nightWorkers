import { Dialog } from '@base-ui/react';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/cn';

interface IModalProps extends React.ComponentPropsWithoutRef<typeof Dialog.Root> {
  children?: React.ReactNode;
  trigger?: React.ReactNode;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  footerClassName?: string;
  className?: string;
  contentClassName?: string;
  onClose?: () => void;
  noHeader?: boolean;
  noPadding?: boolean;
  draggable?: boolean;
}

const isButtonLikeTrigger = (trigger: React.ReactElement): boolean => {
  if (typeof trigger.type === 'string') {
    return trigger.type === 'button';
  }

  if (typeof trigger.type === 'function') {
    const fnType = trigger.type as { displayName?: string; name?: string };
    const name = fnType.displayName ?? fnType.name ?? '';
    return /button/i.test(name);
  }

  if (typeof trigger.type === 'object' && trigger.type !== null) {
    const maybeType = trigger.type as {
      displayName?: string;
      render?: { displayName?: string; name?: string };
      type?: { displayName?: string; name?: string };
    };
    const name =
      maybeType.displayName ??
      maybeType.render?.displayName ??
      maybeType.render?.name ??
      maybeType.type?.displayName ??
      maybeType.type?.name ??
      '';
    return /button/i.test(name);
  }

  return false;
};

const DraggableModalContent = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode;
    draggable: boolean;
    className?: string;
    style?: React.CSSProperties;
    descriptionId: string;
  } & any
>(({ children, draggable, className, style: propStyle, descriptionId, ...props }, forwardedRef) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: 'modal-drag',
    disabled: !draggable,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.delta) {
      setPosition((prev) => ({
        x: prev.x + event.delta.x,
        y: prev.y + event.delta.y,
      }));
    }
  };

  const combinedTransform = {
    x: position.x + (transform?.x ?? 0),
    y: position.y + (transform?.y ?? 0),
  };

  const style: React.CSSProperties = {
    transform: `translate(calc(-50% + ${combinedTransform.x}px), calc(-50% + ${combinedTransform.y}px))`,
    cursor: isDragging ? 'grabbing' : undefined,
    ...propStyle,
  };

  const combinedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
      <Dialog.Popup
        ref={combinedRef}
        aria-describedby={descriptionId}
        data-gxp-top-layer="true"
        className={cn(
          'fixed z-modal flex flex-col gap-0 bg-background',
          !draggable && 'duration-200',
          !draggable &&
            'data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0',
          !draggable &&
            'bottom-0 left-0 right-0 w-full h-[90vh] rounded-t-xl border-t border-border',
          !draggable && 'data-[closed]:slide-out-to-bottom data-[open]:slide-in-from-bottom',
          draggable &&
            'left-[50%] top-[50%] h-auto max-h-[90vh] w-[90vw] max-w-lg rounded-[var(--radius,0.5rem)] border border-border',
          !draggable &&
            'sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:right-auto sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-[var(--radius,0.5rem)] sm:border sm:border-border',
          !draggable && 'sm:data-[closed]:zoom-out-95 sm:data-[open]:zoom-in-95',
          !draggable &&
            'sm:data-[closed]:slide-out-to-left-1/2 sm:data-[closed]:slide-out-to-top-[48%]',
          !draggable &&
            'sm:data-[open]:slide-in-from-left-1/2 sm:data-[open]:slide-in-from-top-[48%]',
          className
        )}
        style={style}
        {...props}
      >
        {React.Children.map(children, (child) => {
          if (
            React.isValidElement(child) &&
            (child.props as { 'data-drag-handle'?: string })['data-drag-handle']
          ) {
            return React.cloneElement(child as React.ReactElement, {
              ...attributes,
              ...listeners,
            });
          }
          return child;
        })}
      </Dialog.Popup>
    </DndContext>
  );
});

const Modal = React.memo(
  React.forwardRef<HTMLDivElement, IModalProps>(
    (
      {
        children,
        trigger,
        title,
        description,
        footer,
        footerClassName,
        className,
        contentClassName,
        open,
        onOpenChange,
        onClose,
        defaultOpen,
        draggable = true,
        ...props
      },
      ref
    ) => {
      const [internalOpen, setInternalOpen] = React.useState(defaultOpen || false);

      const isControlled = open !== undefined;
      const show = isControlled ? open : internalOpen;

      const handleOpenChange = (newOpen: boolean, eventDetails: unknown) => {
        if (!isControlled) {
          setInternalOpen(newOpen);
        }
        onOpenChange?.(newOpen, eventDetails as any);
        if (!newOpen && onClose) {
          onClose();
        }
      };

      const generatedDescriptionId = React.useId();
      const descriptionId = description ? description : generatedDescriptionId;

      const headerContent = (
        <div
          data-testid="modal-header"
          {...(draggable ? { role: 'button', 'aria-label': 'Drag modal', tabIndex: 0 } : {})}
          data-drag-handle={draggable ? 'true' : undefined}
          className={cn(
            'relative flex flex-col space-y-1.5 border-b border-border bg-card/50 flex-shrink-0',
            draggable && 'cursor-move',
            props.noPadding ? 'p-1' : 'p-[var(--ui-component-padding-y)]'
          )}
        >
          <div className="relative z-10 w-full">
            <div className="flex items-center justify-between">
              <Dialog.Title
                className={cn(
                  'text-lg font-semibold leading-none tracking-tight text-foreground',
                  !title && 'sr-only'
                )}
              >
                {title || 'Dialog'}
              </Dialog.Title>
              <Dialog.Close className="rounded-full p-1 opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-accent focus:outline-none disabled:pointer-events-none cursor-pointer">
                <X className="h-5 w-5 text-foreground" />
                <span className="sr-only">Close</span>
              </Dialog.Close>
            </div>
            {description ? (
              <Dialog.Description
                id={descriptionId}
                className="text-sm text-muted-foreground mt-1.5"
              >
                {description}
              </Dialog.Description>
            ) : (
              <Dialog.Description id={descriptionId} className="sr-only">
                Dialog Content
              </Dialog.Description>
            )}
          </div>
        </div>
      );

      return (
        <Dialog.Root open={show} onOpenChange={handleOpenChange} {...props}>
          {trigger &&
            (React.isValidElement(trigger) ? (
              <Dialog.Trigger render={trigger} nativeButton={isButtonLikeTrigger(trigger)} />
            ) : (
              <Dialog.Trigger>{trigger}</Dialog.Trigger>
            ))}
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-backdrop bg-black/50 backdrop-blur-sm data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0" />
            <DraggableModalContent
              ref={ref}
              draggable={draggable}
              className={className}
              descriptionId={descriptionId}
            >
              {!props.noHeader && headerContent}
              {props.noHeader && (
                <Dialog.Description id={descriptionId} className="sr-only">
                  Dialog Content
                </Dialog.Description>
              )}

              <div
                className={cn(
                  'flex-1 overflow-y-auto',
                  props.noPadding ? 'p-0' : 'p-[var(--ui-modal-padding)]',
                  contentClassName
                )}
              >
                {children}
              </div>

              {footer && (
                <div
                  className={cn(
                    'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 bg-background flex-shrink-0',
                    'p-[var(--ui-component-padding-y)]',
                    footerClassName
                  )}
                >
                  {footer}
                </div>
              )}
            </DraggableModalContent>
          </Dialog.Portal>
        </Dialog.Root>
      );
    }
  )
);

Modal.displayName = 'Modal';

// ModalFooter component for consistent footer styling
export const ModalFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => {
  return (
    <div
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2 bg-background flex-shrink-0 p-[var(--ui-component-padding-y)]',
        className
      )}
    >
      {children}
    </div>
  );
};

ModalFooter.displayName = 'ModalFooter';

export { Modal };
export default Modal;
