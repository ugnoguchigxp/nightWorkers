import { PreviewButton } from '../BlueprintPreviewPrimitives';
import type { SectionRendererInput } from './types';

export function renderPaymentFormSection({ componentName, props, t }: SectionRendererInput) {
  const amount = String(props.amount || props.total || '$128.00');
  return (
    <div className="grid overflow-hidden rounded-md border border-border bg-card md:grid-cols-[minmax(0,1fr)_13rem]">
      <div className="grid gap-3 p-4">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {String(props.title || 'Payment details')}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {String(props.description || 'Secure card checkout preview')}
          </div>
        </div>
        <div className="grid gap-2">
          <div className="rounded border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            Email address
          </div>
          <div className="grid gap-2 rounded-md border border-border bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Card information</span>
              <span className="rounded bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                VISA
              </span>
            </div>
            <div className="rounded border border-border bg-card px-3 py-2 font-mono text-xs text-foreground">
              4242 4242 4242 4242
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                MM / YY
              </div>
              <div className="rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                CVC
              </div>
            </div>
          </div>
          <PreviewButton className="w-full justify-center">
            {String(props.actionLabel || `Pay ${amount}`)}
          </PreviewButton>
        </div>
      </div>
      <div className="grid content-start gap-3 border-border border-t bg-muted p-4 md:border-t-0 md:border-l">
        <div className="text-xs font-semibold text-foreground">Order</div>
        {['Plan subscription', 'Usage credits', 'Tax'].map((label, index) => (
          <div className="flex justify-between gap-3 text-xs" key={label}>
            <span className="text-muted-foreground">{label}</span>
            <span className="text-foreground">
              {index === 0 ? '$99.00' : index === 1 ? '$19.00' : '$10.00'}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-border border-t pt-3 text-sm font-semibold text-foreground">
          <span>Total</span>
          <span>{amount}</span>
        </div>
      </div>
    </div>
  );
}
